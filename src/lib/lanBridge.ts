import { computeBackoffMs, parseRetryAfterSeconds } from './resilientFetch';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const isLikelyCloudOrigin = () => {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  if (protocol === 'capacitor:' || protocol === 'file:') return true;
  return (
    hostname.endsWith('.web.app') ||
    hostname.endsWith('.firebaseapp.com') ||
    hostname === 'racepulseph.com' ||
    hostname === 'www.racepulseph.com'
  );
};

export interface LanPollControllerOptions {
  endpoint: string;
  fetcher: FetchLike;
  activeIntervalMs: number;
  idleBackoffMs?: number;
  maxCloudMisses?: number;
  onData: (payload: unknown) => void;
  onDisconnected: () => void;
}

/**
 * Polls an on-site Express LAN endpoint with exponential backoff + jitter,
 * hidden-tab throttling, Retry-After compliance, and cloud-origin miss capping.
 */
export function startLanJsonPoller({
  endpoint,
  fetcher,
  activeIntervalMs,
  idleBackoffMs = 30_000,
  maxCloudMisses = 3,
  onData,
  onDisconnected,
}: LanPollControllerOptions): () => void {
  let stopped = false;
  let timerId: number | null = null;
  let consecutiveMisses = isLikelyCloudOrigin() ? 1 : 0;
  let inFlight = false;
  const cloudOrigin = isLikelyCloudOrigin();

  const scheduleNext = (delay: number) => {
    if (stopped) return;
    if (timerId !== null) window.clearTimeout(timerId);
    timerId = window.setTimeout(() => {
      void tick();
    }, delay);
  };

  const nextFailureDelay = (retryAfterSec = 0) => {
    if (retryAfterSec > 0) {
      return computeBackoffMs(0, {
        baseMs: retryAfterSec * 1000,
        maxMs: 300_000,
        jitterRatio: 0.15,
        retryAfterSec,
      });
    }
    return computeBackoffMs(Math.max(0, consecutiveMisses - 1), {
      baseMs: Math.max(4000, activeIntervalMs * 2),
      maxMs: Math.max(60_000, idleBackoffMs * 2),
      jitterRatio: 0.2,
    });
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      scheduleNext(idleBackoffMs);
      return;
    }

    inFlight = true;
    try {
      const response = await fetcher(endpoint, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        consecutiveMisses += 1;
        onDisconnected();
        if (cloudOrigin && consecutiveMisses >= maxCloudMisses) {
          // Cloud hosting rewrites /api/* to SPA HTML; stop probing to avoid wasted traffic.
          stopped = true;
          return;
        }
        const retryAfterSec =
          response.status === 429
            ? parseRetryAfterSeconds(response)
            : response.status === 401 || response.status === 403
              ? 60
              : 0;
        scheduleNext(nextFailureDelay(retryAfterSec));
        return;
      }

      const payload = await response.json();
      if (stopped) return;
      consecutiveMisses = 0;
      onData(payload);
      const jitteredActive = Math.round(activeIntervalMs * (0.92 + Math.random() * 0.16));
      scheduleNext(jitteredActive);
    } catch {
      if (stopped) return;
      consecutiveMisses += 1;
      onDisconnected();
      if (cloudOrigin && consecutiveMisses >= maxCloudMisses) {
        stopped = true;
        return;
      }
      scheduleNext(nextFailureDelay());
    } finally {
      inFlight = false;
    }
  };

  const onVisibilityChange = () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && consecutiveMisses === 0) {
      void tick();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  void tick();

  return () => {
    stopped = true;
    if (timerId !== null) window.clearTimeout(timerId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}
