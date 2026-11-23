const crypto = require('node:crypto');

class GuardError extends Error {
  constructor(status, message, retryAfter = 0, code = 'guard_rejected') {
    super(message);
    this.name = 'GuardError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

const PROD_ALLOWED_ORIGINS = [
  'https://racepulseph.com',
  'https://www.racepulseph.com',
  'https://racepulseph.web.app',
  'https://racepulseph.firebaseapp.com',
  'capacitor://localhost',
  'https://localhost',
];

const LOCALHOST_ALLOWED_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:3100',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:5173',
];

function getDefaultAllowedOrigins() {
  const allowLocalhost =
    process.env.FUNCTIONS_EMULATOR === 'true'
    || process.env.RACEPULSE_ALLOW_LOCALHOST_CORS === 'true';
  return allowLocalhost
    ? [...PROD_ALLOWED_ORIGINS, ...LOCALHOST_ALLOWED_ORIGINS]
    : [...PROD_ALLOWED_ORIGINS];
}

const DEFAULT_ALLOWED_ORIGINS = PROD_ALLOWED_ORIGINS;

const DEFAULT_ALLOWED_HOSTNAMES = new Set([
  'racepulseph.com',
  'www.racepulseph.com',
  'racepulseph.web.app',
  'racepulseph.firebaseapp.com',
  'localhost',
  '127.0.0.1',
]);

function expandIpv6(ip) {
  const withoutZone = ip.split('%')[0];
  const parts = withoutZone.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
  if (parts.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;
  const groups = [
    ...left,
    ...Array.from({ length: parts.length === 2 ? missing : 0 }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, '0').toLowerCase());
}

/**
 * Normalizes IPv4 and IPv6 addresses into rate-limit buckets.
 * IPv6 addresses are masked to /64 so rotating host bits within one allocation
 * cannot evade IP limits.
 */
function normalizeIpBucket(rawIp) {
  let ip = String(rawIp || '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(ip)) {
    return ip.replace(/:\d+$/, '');
  }
  if (ip.includes(':')) {
    const groups = expandIpv6(ip);
    if (groups) {
      return `${groups.slice(0, 4).join(':')}::/64`;
    }
  }
  return ip.slice(0, 128);
}

function extractClientIp(request) {
  const trustCf = process.env.RACEPULSE_TRUST_CF_HEADERS === 'true';
  if (trustCf && typeof request?.get === 'function') {
    const cfIp = request.get('cf-connecting-ip');
    if (cfIp) return normalizeIpBucket(cfIp);
  }
  if (request?.ip) {
    return normalizeIpBucket(request.ip);
  }
  const forwarded = typeof request?.get === 'function' ? request.get('x-forwarded-for') : '';
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return normalizeIpBucket(first);
  }
  return 'unknown';
}

let warnedFallbackRateLimitSalt = false;

function hashIdentifier(secret, namespace, value) {
  const payload = `${namespace}:${String(value ?? '')}`;
  if (secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
  const envSalt = process.env.RATE_LIMIT_SALT;
  if (!envSalt && !warnedFallbackRateLimitSalt && process.env.NODE_ENV !== 'test' && process.env.FUNCTIONS_EMULATOR !== 'true') {
    warnedFallbackRateLimitSalt = true;
    console.warn('RATE_LIMIT_SALT or request secret is unset; using fallback rate-limit hash salt.');
  }
  const salt = envSalt || 'racepulseph-rate-v1';
  return crypto.createHash('sha256').update(`${salt}:${payload}`).digest('hex');
}

function createMemoryLimiter({ maxEntries = 10_000, now = Date.now } = {}) {
  const buckets = new Map();
  const activeConcurrency = new Map();

  function sweepExpired(currentMs) {
    if (buckets.size < maxEntries) return;
    for (const [k, entry] of buckets) {
      if (currentMs >= entry.expiresAt) {
        buckets.delete(k);
      }
      if (buckets.size < maxEntries * 0.8) break;
    }
    while (buckets.size >= maxEntries) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function blockKey(key, retryAfterSec, currentMs = now()) {
    const existing = buckets.get(key);
    const blockedUntil = currentMs + Math.max(1, retryAfterSec) * 1000;
    const expiresAt = Math.max(existing?.expiresAt || 0, blockedUntil);
    if (!existing) sweepExpired(currentMs);
    buckets.set(key, {
      windowStart: existing?.windowStart ?? currentMs,
      count: existing?.count ?? 0,
      strikes: (existing?.strikes || 0) + 1,
      blockedUntil,
      expiresAt,
    });
  }

  function consume(key, { limit = 60, windowMs = 60_000, penaltyMultiplier = 1, maxPenaltySec = 3600 } = {}) {
    const currentMs = now();
    const entry = buckets.get(key);

    if (entry && entry.blockedUntil > currentMs) {
      const retryAfter = Math.max(1, Math.ceil((entry.blockedUntil - currentMs) / 1000));
      return { allowed: false, retryAfter, remaining: 0, blockedInMemory: true };
    }

    const inWindow = Boolean(entry && currentMs - entry.windowStart < windowMs);
    const nextCount = inWindow ? entry.count + 1 : 1;
    const windowStart = inWindow ? entry.windowStart : currentMs;
    const windowEnd = windowStart + windowMs;

    if (nextCount > limit) {
      const strikes = (inWindow ? entry?.strikes || 0 : Math.max(0, (entry?.strikes || 0) - 1)) + 1;
      const baseWaitSec = Math.max(1, Math.ceil((windowEnd - currentMs) / 1000));
      const multiplier = penaltyMultiplier > 1 ? Math.min(8, Math.pow(penaltyMultiplier, Math.min(4, strikes - 1))) : 1;
      const waitSec = Math.min(maxPenaltySec, Math.ceil(baseWaitSec * multiplier));
      const blockedUntil = currentMs + waitSec * 1000;
      buckets.set(key, {
        windowStart,
        count: nextCount,
        strikes,
        blockedUntil,
        expiresAt: Math.max(windowEnd, blockedUntil),
      });
      return { allowed: false, retryAfter: waitSec, remaining: 0, blockedInMemory: true };
    }

    if (!entry) sweepExpired(currentMs);
    buckets.set(key, {
      windowStart,
      count: nextCount,
      strikes: inWindow ? entry?.strikes || 0 : 0,
      blockedUntil: 0,
      expiresAt: windowEnd,
    });
    return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - nextCount), blockedInMemory: false };
  }

  function acquireConcurrency(key, maxConcurrent, message = 'Too many concurrent operations. Wait for one to finish.') {
    const active = activeConcurrency.get(key) || 0;
    if (active >= maxConcurrent) {
      throw new GuardError(429, message, 5, 'concurrency_limit');
    }
    activeConcurrency.set(key, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = activeConcurrency.get(key) || 1;
      if (current <= 1) activeConcurrency.delete(key);
      else activeConcurrency.set(key, current - 1);
    };
  }

  return { consume, blockKey, acquireConcurrency, _buckets: buckets };
}

const memoryLimiterByDb = new WeakMap();
const fallbackMemoryLimiter = createMemoryLimiter();

function getLimiterForDb(db, now = Date.now) {
  if (!db || typeof db !== 'object') return fallbackMemoryLimiter;
  let limiter = memoryLimiterByDb.get(db);
  if (!limiter) {
    limiter = createMemoryLimiter({ now });
    memoryLimiterByDb.set(db, limiter);
  }
  return limiter;
}

/**
 * Two-tier rate limiter:
 * 1) Fast in-memory shield stops flood bursts & blocked IPs with zero DB reads/writes.
 * 2) Firestore distributed counter coordinates enforcement across Function instances.
 */
async function enforceRateLimit({
  db,
  secret = '',
  namespace,
  identifier,
  limit,
  windowMs,
  message = 'Too many requests. Please try again later.',
  memoryOnly = false,
  penaltyMultiplier = 1,
  now = Date.now,
}) {
  const hashed = hashIdentifier(secret, namespace, identifier);
  const memKey = `${namespace}:${hashed}`;
  const limiter = getLimiterForDb(db, now);

  const memCheck = limiter.consume(memKey, {
    limit,
    windowMs,
    penaltyMultiplier,
  });
  if (!memCheck.allowed) {
    throw new GuardError(429, message, memCheck.retryAfter, 'rate_limited');
  }

  if (memoryOnly || !db || typeof db.runTransaction !== 'function' || typeof db.doc !== 'function') {
    return { remaining: memCheck.remaining };
  }

  const ref = db.doc(`accountRateLimits/${namespace}_${hashed}`);
  let remaining = limit;
  await db.runTransaction(async (transaction) => {
    const currentMs = now();
    const snapshot = await transaction.get(ref);
    const prev = snapshot.exists ? snapshot.data() || {} : {};
    const inWindow = typeof prev.windowStart === 'number' && currentMs - prev.windowStart < windowMs;
    const prevCount = inWindow ? Number(prev.count || 0) : 0;
    if (prevCount >= limit) {
      const retryAfter = Math.max(1, Math.ceil((prev.windowStart + windowMs - currentMs) / 1000));
      limiter.blockKey(memKey, retryAfter, currentMs);
      throw new GuardError(429, message, retryAfter, 'rate_limited');
    }
    const nextCount = prevCount + 1;
    remaining = Math.max(0, limit - nextCount);
    transaction.set(ref, {
      windowStart: inWindow ? prev.windowStart : currentMs,
      count: nextCount,
      expiresAt: new Date(currentMs + windowMs),
    });
  });

  return { remaining };
}

/**
 * Verifies Firebase App Check tokens (`X-Firebase-AppCheck`).
 * - mode='off': bypassed
 * - mode='monitor': allows missing token (logs/annotates), rejects forged/invalid tokens
 * - mode='enforce': requires valid App Check token
 */
async function verifyAppCheckRequest(request, { admin, mode, consumeReplay = false } = {}) {
  const resolvedMode = (mode || process.env.RACEPULSE_APP_CHECK_MODE || 'monitor').toLowerCase();
  if (resolvedMode === 'off') {
    return { status: 'off' };
  }

  const token = typeof request?.get === 'function' ? request.get('X-Firebase-AppCheck') : undefined;
  if (!token) {
    if (resolvedMode === 'enforce') {
      throw new GuardError(401, 'Application verification is required. Please reload and try again.', 0, 'app_check_required');
    }
    return { status: 'missing' };
  }

  if (typeof token !== 'string' || token.length > 4096) {
    throw new GuardError(401, 'Invalid application verification token.', 0, 'app_check_invalid');
  }

  if (!admin || typeof admin.appCheck !== 'function') {
    if (resolvedMode === 'enforce') {
      throw new GuardError(503, 'Application verification service is unavailable.', 15, 'app_check_unavailable');
    }
    return { status: 'unverified' };
  }

  try {
    const result = await admin.appCheck().verifyToken(token, { consume: Boolean(consumeReplay) });
    if (consumeReplay && result?.alreadyConsumed) {
      throw new GuardError(401, 'Verification token has already been used. Please retry.', 0, 'app_check_replayed');
    }
    return { status: 'verified', appId: result?.appId };
  } catch (error) {
    if (error instanceof GuardError) throw error;
    throw new GuardError(401, 'Invalid or expired application verification. Please reload and try again.', 0, 'app_check_invalid');
  }
}

const consumedTurnstileTokens = new Map();

function rememberTurnstileToken(token, nowMs) {
  if (consumedTurnstileTokens.size > 5000) {
    for (const [k, exp] of consumedTurnstileTokens) {
      if (nowMs >= exp) consumedTurnstileTokens.delete(k);
    }
    if (consumedTurnstileTokens.size > 5000) consumedTurnstileTokens.clear();
  }
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const existingExp = consumedTurnstileTokens.get(digest);
  if (existingExp && existingExp > nowMs) return false;
  consumedTurnstileTokens.set(digest, nowMs + 5 * 60 * 1000);
  return true;
}

/**
 * Verifies Cloudflare Turnstile response tokens when TURNSTILE_SECRET_KEY is configured.
 */
async function verifyTurnstileRequest(
  request,
  {
    secret = process.env.TURNSTILE_SECRET_KEY || '',
    mode = process.env.RACEPULSE_TURNSTILE_MODE || '',
    expectedAction,
    allowedHostnames = DEFAULT_ALLOWED_HOSTNAMES,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  } = {},
) {
  const effectiveMode = (mode || (secret ? 'monitor' : 'off')).toLowerCase();
  if (effectiveMode === 'off' || !secret) {
    return { status: 'off' };
  }

  const token =
    (typeof request?.body?.turnstileToken === 'string' ? request.body.turnstileToken.trim() : '') ||
    (typeof request?.get === 'function' ? (request.get('X-Turnstile-Token') || '').trim() : '');

  if (!token) {
    if (effectiveMode === 'enforce') {
      throw new GuardError(403, 'Please complete the human verification challenge and try again.', 0, 'turnstile_required');
    }
    return { status: 'missing' };
  }

  if (token.length > 4096 || !rememberTurnstileToken(token, now())) {
    throw new GuardError(403, 'Verification challenge expired or already used. Please try again.', 0, 'turnstile_replayed');
  }

  try {
    const params = new URLSearchParams({
      secret,
      response: token,
      remoteip: extractClientIp(request),
    });
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (!data?.success) {
      throw new GuardError(403, 'Human verification failed. Please retry the challenge.', 0, 'turnstile_failed');
    }
    if (expectedAction && data.action && data.action !== expectedAction) {
      throw new GuardError(403, 'Human verification action mismatch. Please reload and try again.', 0, 'turnstile_action_mismatch');
    }
    if (allowedHostnames && data.hostname && !allowedHostnames.has(String(data.hostname).toLowerCase())) {
      throw new GuardError(403, 'Human verification hostname mismatch.', 0, 'turnstile_hostname_mismatch');
    }
    return { status: 'verified', hostname: data.hostname, action: data.action };
  } catch (error) {
    if (error instanceof GuardError) throw error;
    if (effectiveMode === 'enforce') {
      throw new GuardError(503, 'Human verification service is temporarily unavailable. Please try again shortly.', 15, 'turnstile_unavailable');
    }
    return { status: 'unavailable' };
  }
}

/**
 * Validates optional honeypot and timing anti-bot fields injected by web forms.
 * Keeps legitimate API callers and unit tests working when fields are omitted.
 */
function assertHumanFormSignals(body, { minFillMs = 450 } = {}) {
  if (!body || typeof body !== 'object') return;
  if (Object.hasOwn(body, '_hp') && body._hp !== undefined && body._hp !== null && String(body._hp).trim() !== '') {
    throw new GuardError(400, 'Could not submit this request. Please refresh and try again.', 0, 'honeypot_triggered');
  }
  if (Object.hasOwn(body, '_ft') && body._ft !== undefined) {
    const fillMs = Number(body._ft);
    if (!Number.isFinite(fillMs) || fillMs < 0 || fillMs < minFillMs) {
      throw new GuardError(429, 'Submission was too fast. Please wait a moment and try again.', 3, 'bot_velocity');
    }
  }
}

function applyApiSecurityHeaders(response) {
  response.set('Cache-Control', 'no-store');
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('X-Frame-Options', 'DENY');
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function setScopedCors(request, response, { allowedOrigins = getDefaultAllowedOrigins(), methods = 'GET, POST, OPTIONS' } = {}) {
  const origin = typeof request?.get === 'function' ? request.get('origin') : undefined;
  const allowSet = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins);
  if (origin && allowSet.has(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
  }
  response.set('Access-Control-Allow-Methods', methods);
  response.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Firebase-AppCheck, X-Turnstile-Token, Idempotency-Key',
  );
  response.set('Access-Control-Expose-Headers', 'Retry-After');
}

function sendGuardError(response, error, fallbackMessage = 'Request rejected.') {
  const status = typeof error?.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
  const retryAfter = Number(error?.retryAfter) || 0;
  if (retryAfter > 0) {
    response.set('Retry-After', String(retryAfter));
  }
  return response.status(status).json({
    error: status < 500 && error?.message ? error.message : fallbackMessage,
    ...(retryAfter > 0 ? { retryAfter } : {}),
  });
}

module.exports = {
  DEFAULT_ALLOWED_HOSTNAMES,
  DEFAULT_ALLOWED_ORIGINS,
  LOCALHOST_ALLOWED_ORIGINS,
  PROD_ALLOWED_ORIGINS,
  GuardError,
  applyApiSecurityHeaders,
  assertHumanFormSignals,
  createMemoryLimiter,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  getLimiterForDb,
  hashIdentifier,
  normalizeIpBucket,
  sendGuardError,
  setScopedCors,
  verifyAppCheckRequest,
  verifyTurnstileRequest,
};
