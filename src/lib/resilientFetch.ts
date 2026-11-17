export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
  retryAfterSec?: number;
}

export interface BoundedFetchOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  circuitKey?: string;
  dedupeGet?: boolean;
}

export class CircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number,
  ) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export function parseRetryAfterSeconds(
  response: Pick<Response, 'headers'> | null | undefined,
  body?: Record<string, unknown> | null,
): number {
  const fromBody = Number(body?.retryAfter);
  if (Number.isFinite(fromBody) && fromBody > 0) {
    return Math.min(3600, Math.ceil(fromBody));
  }
  const headerVal = response?.headers?.get?.('Retry-After')?.trim();
  if (!headerVal) return 0;
  const numeric = Number(headerVal);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.min(3600, Math.ceil(numeric));
  }
  const dateMs = Date.parse(headerVal);
  if (!Number.isNaN(dateMs)) {
    const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSec > 0 ? Math.min(3600, diffSec) : 0;
  }
  return 0;
}

export function computeBackoffMs(
  attempt: number,
  {
    baseMs = 1000,
    maxMs = 30_000,
    jitterRatio = 0.25,
    retryAfterSec = 0,
  }: BackoffOptions = {},
): number {
  const safeAttempt = Math.max(0, Math.min(10, Math.floor(attempt)));
  const exp = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
  const jitterSpan = exp * Math.max(0, Math.min(0.5, jitterRatio));
  const jitterOffset = (Math.random() * 2 - 1) * jitterSpan;
  const computed = Math.max(100, Math.round(exp + jitterOffset));
  const floorMs = retryAfterSec > 0 ? Math.min(3600_000, retryAfterSec * 1000) : 0;
  return Math.max(computed, floorMs);
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

export function createCircuitBreaker({
  failureThreshold = 5,
  resetTimeoutMs = 20_000,
}: {
  failureThreshold?: number;
  resetTimeoutMs?: number;
} = {}) {
  const states = new Map<string, CircuitState>();

  const check = (key: string) => {
    const state = states.get(key);
    if (!state) return;
    if (state.openUntil > Date.now()) {
      const waitSec = Math.max(1, Math.ceil((state.openUntil - Date.now()) / 1000));
      throw new CircuitOpenError(
        `Service temporarily busy. Please wait ${waitSec}s before trying again.`,
        waitSec,
      );
    }
    if (state.openUntil > 0 && state.openUntil <= Date.now()) {
      // Half-open: permit one probe request cleanly.
      states.set(key, { failures: failureThreshold - 1, openUntil: 0 });
    }
  };

  const recordSuccess = (key: string) => {
    states.delete(key);
  };

  const recordFailure = (key: string) => {
    const prev = states.get(key) || { failures: 0, openUntil: 0 };
    const failures = prev.failures + 1;
    const openUntil = failures >= failureThreshold ? Date.now() + resetTimeoutMs : 0;
    states.set(key, { failures, openUntil });
  };

  return { check, recordSuccess, recordFailure };
}

const defaultBreaker = createCircuitBreaker();
const inFlightGets = new Map<string, Promise<Response>>();

function combineAbortSignals(timeoutMs: number, externalSignal?: AbortSignal | null): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch wrapper enforcing bounded retry budgets, exponential backoff + jitter,
 * circuit-breaking on sustained 5xx outages, and concurrent GET deduplication.
 */
export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  options: BoundedFetchOptions = {},
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isIdempotentRead = method === 'GET' || method === 'HEAD';
  const maxRetries = Math.max(0, Math.min(4, options.maxRetries ?? 0));
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 15_000);
  const circuitKey = options.circuitKey || url.split('?')[0];

  defaultBreaker.check(circuitKey);

  const shouldDedupe = Boolean(options.dedupeGet && isIdempotentRead && !init.signal);
  const dedupeKey = shouldDedupe ? `${method}:${url}` : '';
  if (dedupeKey) {
    const existing = inFlightGets.get(dedupeKey);
    if (existing) {
      const sharedResponse = await existing;
      return sharedResponse.clone();
    }
  }

  const execute = async (): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const { signal, cleanup } = combineAbortSignals(timeoutMs, init.signal);
      try {
        const response = await fetch(url, { ...init, signal });
        if (response.status >= 500) {
          defaultBreaker.recordFailure(circuitKey);
          if (isIdempotentRead && attempt < maxRetries) {
            const retryAfterSec = parseRetryAfterSeconds(response);
            const delay = computeBackoffMs(attempt, {
              baseMs: options.baseDelayMs ?? 600,
              maxMs: options.maxDelayMs ?? 10_000,
              retryAfterSec,
            });
            await sleepWithAbort(delay, init.signal);
            continue;
          }
          return response;
        }
        defaultBreaker.recordSuccess(circuitKey);
        return response;
      } catch (error) {
        lastError = error;
        if (init.signal?.aborted) {
          throw error;
        }
        defaultBreaker.recordFailure(circuitKey);
        if (isIdempotentRead && attempt < maxRetries) {
          const delay = computeBackoffMs(attempt, {
            baseMs: options.baseDelayMs ?? 600,
            maxMs: options.maxDelayMs ?? 10_000,
          });
          await sleepWithAbort(delay, init.signal);
          continue;
        }
        throw error;
      } finally {
        cleanup();
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Request failed.');
  };

  if (!dedupeKey) {
    return execute();
  }

  const flight = execute().finally(() => {
    inFlightGets.delete(dedupeKey);
  });
  inFlightGets.set(dedupeKey, flight);
  const res = await flight;
  return res.clone();
}

interface CooldownRecord {
  until: number;
  failures: number;
}

export function createActionCooldownStore(storagePrefix = 'racepulse_cd') {
  const memory = new Map<string, CooldownRecord>();

  const readRecord = (key: string): CooldownRecord => {
    const mem = memory.get(key);
    if (mem) return mem;
    if (typeof sessionStorage !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(`${storagePrefix}:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<CooldownRecord>;
          if (typeof parsed.until === 'number' && typeof parsed.failures === 'number') {
            const rec = { until: parsed.until, failures: parsed.failures };
            memory.set(key, rec);
            return rec;
          }
        }
      } catch {
        // Ignore storage access errors in restricted environments.
      }
    }
    return { until: 0, failures: 0 };
  };

  const writeRecord = (key: string, record: CooldownRecord) => {
    memory.set(key, record);
    if (typeof sessionStorage !== 'undefined') {
      try {
        if (record.until <= Date.now() && record.failures === 0) {
          sessionStorage.removeItem(`${storagePrefix}:${key}`);
        } else {
          sessionStorage.setItem(`${storagePrefix}:${key}`, JSON.stringify(record));
        }
      } catch {
        // Ignore storage quota or sandbox restrictions.
      }
    }
  };

  return {
    getRemainingSeconds(key: string): number {
      const rec = readRecord(key);
      return Math.max(0, Math.ceil((rec.until - Date.now()) / 1000));
    },
    start(key: string, seconds: number) {
      if (seconds <= 0) return;
      const prev = readRecord(key);
      writeRecord(key, {
        until: Math.max(prev.until, Date.now() + seconds * 1000),
        failures: prev.failures,
      });
    },
    recordFailure(key: string, { threshold = 4, baseWaitSec = 15, maxWaitSec = 300 } = {}): number {
      const prev = readRecord(key);
      const failures = prev.failures + 1;
      let waitSec = 0;
      if (failures >= threshold) {
        const exponent = Math.min(5, failures - threshold);
        waitSec = Math.min(maxWaitSec, baseWaitSec * Math.pow(2, exponent));
      }
      const until = waitSec > 0 ? Date.now() + waitSec * 1000 : prev.until;
      writeRecord(key, { until, failures });
      return waitSec;
    },
    clear(key: string) {
      memory.delete(key);
      if (typeof sessionStorage !== 'undefined') {
        try {
          sessionStorage.removeItem(`${storagePrefix}:${key}`);
        } catch {
          // Safe no-op
        }
      }
    },
  };
}
