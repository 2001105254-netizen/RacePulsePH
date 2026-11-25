'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const guard = require('../functions/request-guard');
const { searchRunnerDirectory } = require('../functions/friend-search');

test('normalizeIpBucket collapses IPv4-mapped and IPv6 /64 subnets to prevent rotation bypass', () => {
  assert.equal(guard.normalizeIpBucket('::ffff:192.168.1.45'), '192.168.1.45');
  assert.equal(guard.normalizeIpBucket('203.0.113.9:51234'), '203.0.113.9');
  const a = guard.normalizeIpBucket('2001:db8:abcd:0012::1');
  const b = guard.normalizeIpBucket('2001:db8:abcd:0012:ffff:aaaa:bbbb:cccc');
  assert.equal(a, '2001:0db8:abcd:0012::/64');
  assert.equal(a, b);
});

test('two-tier rate limiter stops floods in memory without hitting Firestore after limit is reached', async () => {
  let txCount = 0;
  let clock = 1_700_000_000_000;
  const docs = new Map();
  const db = {
    doc: (key) => ({ key }),
    runTransaction: async (cb) => {
      txCount += 1;
      const writes = [];
      const res = await cb({
        get: async (ref) => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
        set: (ref, data) => writes.push(() => docs.set(ref.key, data)),
      });
      writes.forEach((w) => w());
      return res;
    },
  };

  for (let i = 0; i < 5; i += 1) {
    await guard.enforceRateLimit({
      db,
      secret: 'test-secret',
      namespace: 't_flood',
      identifier: '198.51.100.7',
      limit: 5,
      windowMs: 60_000,
      now: () => clock,
    });
  }
  assert.equal(txCount, 5);

  // Next 50 requests must be rejected in-memory with zero extra Firestore transactions.
  for (let i = 0; i < 50; i += 1) {
    await assert.rejects(
      guard.enforceRateLimit({
        db,
        secret: 'test-secret',
        namespace: 't_flood',
        identifier: '198.51.100.7',
        limit: 5,
        windowMs: 60_000,
        now: () => clock,
      }),
      (err) => err instanceof guard.GuardError && err.status === 429 && err.retryAfter > 0,
    );
  }
  assert.equal(txCount, 5);

  // Window reset allows traffic again.
  clock += 61_000;
  await guard.enforceRateLimit({
    db,
    secret: 'test-secret',
    namespace: 't_flood',
    identifier: '198.51.100.7',
    limit: 5,
    windowMs: 60_000,
    now: () => clock,
  });
  assert.equal(txCount, 6);
});

test('memory limiter bounds stored entries and enforces concurrency caps', () => {
  const limiter = guard.createMemoryLimiter({ maxEntries: 50 });
  for (let i = 0; i < 120; i += 1) {
    limiter.consume(`ip:${i}`, { limit: 10, windowMs: 60_000 });
  }
  assert.ok(limiter._buckets.size <= 50);

  const release1 = limiter.acquireConcurrency('uid:route', 2);
  const release2 = limiter.acquireConcurrency('uid:route', 2);
  assert.throws(
    () => limiter.acquireConcurrency('uid:route', 2),
    (err) => err.status === 429,
  );
  release1();
  const release3 = limiter.acquireConcurrency('uid:route', 2);
  release2();
  release3();
});

test('verifyAppCheckRequest supports monitor and enforce modes and rejects invalid tokens', async () => {
  const mockAdmin = {
    appCheck: () => ({
      verifyToken: async (token) => {
        if (token === 'valid-token') return { appId: 'web-app', alreadyConsumed: false };
        if (token === 'replayed-token') return { appId: 'web-app', alreadyConsumed: true };
        throw new Error('bad token');
      },
    }),
  };

  const makeReq = (token) => ({
    get: (name) => (name.toLowerCase() === 'x-firebase-appcheck' ? token : undefined),
  });

  // Monitor mode allows missing token, accepts valid token, and rejects forged token.
  assert.equal((await guard.verifyAppCheckRequest(makeReq(undefined), { admin: mockAdmin, mode: 'monitor' })).status, 'missing');
  assert.equal((await guard.verifyAppCheckRequest(makeReq('valid-token'), { admin: mockAdmin, mode: 'monitor' })).status, 'verified');
  await assert.rejects(
    guard.verifyAppCheckRequest(makeReq('forged-token'), { admin: mockAdmin, mode: 'monitor' }),
    (err) => err.status === 401,
  );

  // Enforce mode rejects missing and replayed tokens.
  await assert.rejects(
    guard.verifyAppCheckRequest(makeReq(undefined), { admin: mockAdmin, mode: 'enforce' }),
    (err) => err.status === 401,
  );
  await assert.rejects(
    guard.verifyAppCheckRequest(makeReq('replayed-token'), { admin: mockAdmin, mode: 'enforce', consumeReplay: true }),
    (err) => err.status === 401,
  );
});

test('verifyTurnstileRequest validates token, hostname, action, and prevents token replay', async () => {
  let clock = 1_700_000_000_000;
  const makeReq = (token) => ({
    body: token ? { turnstileToken: token } : {},
    ip: '203.0.113.10',
    get: () => '',
  });

  const mockFetch = async () => ({
    json: async () => ({
      success: true,
      action: 'password_reset',
      hostname: 'racepulseph.com',
    }),
  });

  await assert.rejects(
    guard.verifyTurnstileRequest(makeReq(''), {
      secret: 'turnstile-test-secret',
      mode: 'enforce',
      expectedAction: 'password_reset',
      fetchImpl: mockFetch,
      now: () => clock,
    }),
    (err) => err.status === 403,
  );

  const ok = await guard.verifyTurnstileRequest(makeReq('tok-1'), {
    secret: 'turnstile-test-secret',
    mode: 'enforce',
    expectedAction: 'password_reset',
    fetchImpl: mockFetch,
    now: () => clock,
  });
  assert.equal(ok.status, 'verified');

  // Replaying same token must fail.
  await assert.rejects(
    guard.verifyTurnstileRequest(makeReq('tok-1'), {
      secret: 'turnstile-test-secret',
      mode: 'enforce',
      expectedAction: 'password_reset',
      fetchImpl: mockFetch,
      now: () => clock,
    }),
    (err) => err.status === 403,
  );

  // Action mismatch must fail.
  await assert.rejects(
    guard.verifyTurnstileRequest(makeReq('tok-2'), {
      secret: 'turnstile-test-secret',
      mode: 'enforce',
      expectedAction: 'checkout',
      fetchImpl: mockFetch,
      now: () => clock,
    }),
    (err) => err.status === 403,
  );
});

test('assertHumanFormSignals traps filled honeypot and inhuman sub-450ms submissions', () => {
  assert.doesNotThrow(() => guard.assertHumanFormSignals({ email: 'a@b.com' }));
  assert.doesNotThrow(() => guard.assertHumanFormSignals({ _hp: '', _ft: 1200 }));
  assert.throws(
    () => guard.assertHumanFormSignals({ _hp: 'http://spam.example', _ft: 2000 }),
    (err) => err.status === 400,
  );
  assert.throws(
    () => guard.assertHumanFormSignals({ _hp: '', _ft: 120 }),
    (err) => err.status === 429,
  );
});

test('searchRunnerDirectory caches directory reads to prevent traffic amplification', async () => {
  let directoryReads = 0;
  let clock = 1_700_000_000_000;
  const docs = new Map([
    ['users/caller', { uid: 'caller', role: 'runner', approved: true, username: 'juan', displayName: 'Juan Dela Cruz' }],
    ['userAccess/caller', { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} }],
    ['users/u1', { uid: 'u1', role: 'runner', approved: true, username: 'maria.run', displayName: 'Maria Santos' }],
    ['friendDirectory/maria.run', { uid: 'u1', username: 'maria.run', displayName: 'Maria Santos', updatedAt: '2026-10-01' }],
  ]);

  const db = {
    doc: (key) => ({
      key,
      get: async () => ({ exists: docs.has(key), data: () => (docs.has(key) ? structuredClone(docs.get(key)) : undefined) }),
    }),
    collection: (name) => {
      const prefix = `${name}/`;
      const makeSnapshot = () => {
        if (name === 'friendDirectory') directoryReads += 1;
        const matched = [...docs.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }));
        return { forEach: (fn) => matched.forEach(fn) };
      };
      return {
        select: () => ({ get: async () => makeSnapshot() }),
        get: async () => makeSnapshot(),
      };
    },
    runTransaction: async (cb) => {
      const writes = [];
      const res = await cb({
        get: async (ref) => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
        set: (ref, data) => writes.push(() => docs.set(ref.key, data)),
      });
      writes.forEach((w) => w());
      return res;
    },
  };

  // Concurrent burst + sequential calls within 60s TTL should only read friendDirectory once.
  await Promise.all([
    searchRunnerDirectory({ db, secret: 's', callerUid: 'caller', rawQuery: 'maria', now: () => clock }),
    searchRunnerDirectory({ db, secret: 's', callerUid: 'caller', rawQuery: 'mar', now: () => clock }),
    searchRunnerDirectory({ db, secret: 's', callerUid: 'caller', rawQuery: 'santos', now: () => clock }),
  ]);
  assert.equal(directoryReads, 1);

  clock += 61_000;
  await searchRunnerDirectory({ db, secret: 's', callerUid: 'caller', rawQuery: 'maria', now: () => clock });
  assert.equal(directoryReads, 2);
});


test('getDefaultAllowedOrigins excludes localhost unless emulator or RACEPULSE_ALLOW_LOCALHOST_CORS is enabled', () => {
  const prevEmul = process.env.FUNCTIONS_EMULATOR;
  const prevLocal = process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;
  delete process.env.FUNCTIONS_EMULATOR;
  delete process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;
  try {
    const prodOrigins = guard.getDefaultAllowedOrigins();
    assert.equal(prodOrigins.includes('http://localhost:5173'), false);
    assert.equal(prodOrigins.includes('https://racepulseph.com'), true);

    process.env.RACEPULSE_ALLOW_LOCALHOST_CORS = 'true';
    const devOrigins = guard.getDefaultAllowedOrigins();
    assert.equal(devOrigins.includes('http://localhost:5173'), true);
  } finally {
    if (prevEmul === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = prevEmul;
    if (prevLocal === undefined) delete process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;
    else process.env.RACEPULSE_ALLOW_LOCALHOST_CORS = prevLocal;
  }
});

test('applyApiSecurityHeaders sets full Zero Trust HTTP response headers', () => {
  const headers = {};
  const res = { set: (k, v) => { headers[String(k).toLowerCase()] = v; } };
  guard.applyApiSecurityHeaders(res);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers.pragma, 'no-cache');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['x-permitted-cross-domain-policies'], 'none');
  assert.equal(headers['x-xss-protection'], '0');
  assert.match(headers['strict-transport-security'] || '', /max-age=31536000/);
  assert.equal(headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.match(headers['permissions-policy'] || '', /camera=\(\)/);
});

test('stripPrototypePollution removes dangerous keys recursively and bounds depth', () => {
  const dirty = JSON.parse('{"name":"Juan","__proto__":{"admin":true},"nested":{"constructor":{"x":1},"prototype":true,"ok":42},"items":[{"__proto__":{"pwn":1},"v":1}]}');
  const clean = guard.stripPrototypePollution(dirty);
  assert.equal(Object.hasOwn(clean, '__proto__'), false);
  assert.equal(Object.hasOwn(clean.nested, 'constructor'), false);
  assert.equal(Object.hasOwn(clean.nested, 'prototype'), false);
  assert.equal(clean.nested.ok, 42);
  assert.equal(Object.hasOwn(clean.items[0], '__proto__'), false);
  assert.equal(clean.items[0].v, 1);

  let deep = { leaf: true };
  for (let i = 0; i < 16; i += 1) deep = { child: deep };
  assert.throws(
    () => guard.stripPrototypePollution(deep, 12),
    (err) => err instanceof guard.GuardError && err.status === 400 && err.code === 'payload_too_deep',
  );
});

test('resolveRequestId preserves valid correlation IDs and generates UUIDs otherwise', () => {
  const headers = {};
  const makeRes = () => ({ set: (k, v) => { headers[String(k).toLowerCase()] = v; } });
  const validId = guard.resolveRequestId({ get: (k) => (k === 'X-Request-Id' ? 'req_trace-01:abc' : undefined) }, makeRes());
  assert.equal(validId, 'req_trace-01:abc');
  assert.equal(headers['x-request-id'], 'req_trace-01:abc');

  const invalidId = guard.resolveRequestId({ get: () => 'bad id with spaces\n' }, makeRes());
  assert.match(invalidId, /^[0-9a-f-]{36}$/i);
  assert.equal(headers['x-request-id'], invalidId);
});

test('assertRecentAuth enforces fresh auth_time for step-up operations', () => {
  const nowMs = 1_795_000_000_000;
  const nowSec = Math.floor(nowMs / 1000);
  assert.equal(guard.assertRecentAuth({ uid: 'u1', auth_time: nowSec - 120 }, { maxAgeSeconds: 900, now: () => nowMs }).verified, true);
  assert.equal(guard.assertRecentAuth({ uid: 'u1' }, { maxAgeSeconds: 900, now: () => nowMs }).skipped, true);
  assert.throws(
    () => guard.assertRecentAuth({ uid: 'u1' }, { maxAgeSeconds: 900, now: () => nowMs, requireAuthTime: true }),
    (err) => err instanceof guard.GuardError && err.status === 401 && err.code === 'reauth_required',
  );
  assert.throws(
    () => guard.assertRecentAuth({ uid: 'u1', auth_time: nowSec - 901 }, { maxAgeSeconds: 900, now: () => nowMs }),
    (err) => err instanceof guard.GuardError && err.status === 401 && err.code === 'reauth_required',
  );
  assert.throws(
    () => guard.assertRecentAuth({ uid: 'u1', auth_time: nowSec + 301 }, { maxAgeSeconds: 900, now: () => nowMs }),
    (err) => err instanceof guard.GuardError && err.status === 401 && err.code === 'reauth_required',
  );
});

test('validateTrustedEndpointUrl permits HTTPS and loopback HTTP and blocks insecure targets', () => {
  assert.equal(
    guard.validateTrustedEndpointUrl('https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi/'),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi',
  );
  assert.equal(guard.validateTrustedEndpointUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => guard.validateTrustedEndpointUrl('http://evil.example/accessApi'));
  assert.throws(() => guard.validateTrustedEndpointUrl('https://user:pass@evil.example/accessApi'));
  assert.throws(() => guard.validateTrustedEndpointUrl('file:///etc/passwd'));
});

test('HMAC bridge signing and verification rejects tampering, stale timestamps, wrong keys, and nonce replays', () => {
  let clock = 1_795_000_000_000;
  const nowSec = Math.floor(clock / 1000);
  const secret = 'test-pairing-key-012345678901234567890';
  const rawBody = JSON.stringify({ id: 'ev_1', epc: 'DEADBEEF', antenna: 1, timestamp: '2026-10-28T00:00:00Z' });
  const nonce = 'nonce_0123456789abcdef';
  const sig = guard.signHmacBridgePayload({ secret, rawBody, timestampSec: nowSec, nonce });

  const verifier = guard.createBridgeHmacVerifier({ now: () => clock });
  assert.equal(
    verifier.verify({
      secret,
      rawBody,
      timestampHeader: String(nowSec),
      nonceHeader: nonce,
      signatureHeader: sig,
    }).ok,
    true,
  );
  // Replay with same nonce must fail.
  assert.equal(
    verifier.verify({
      secret,
      rawBody,
      timestampHeader: String(nowSec),
      nonceHeader: nonce,
      signatureHeader: sig,
    }).reason,
    'nonce_replayed',
  );
  // Tampered body must fail.
  assert.equal(
    verifier.verify({
      secret,
      rawBody: rawBody.replace('DEADBEEF', 'CAFEBABE'),
      timestampHeader: String(nowSec),
      nonceHeader: 'nonce_fresh_0123456789',
      signatureHeader: sig,
    }).reason,
    'invalid_signature',
  );
  // Stale timestamp must fail.
  assert.equal(
    verifier.verify({
      secret,
      rawBody,
      timestampHeader: String(nowSec - 301),
      nonceHeader: 'nonce_stale_0123456789',
      signatureHeader: sig,
    }).reason,
    'timestamp_skew',
  );
  // Wrong secret must fail.
  assert.equal(
    verifier.verify({
      secret: 'wrong-pairing-key-01234567890123456789',
      rawBody,
      timestampHeader: String(nowSec),
      nonceHeader: 'nonce_wrongkey_0123456',
      signatureHeader: sig,
    }).reason,
    'invalid_signature',
  );
});

test('setScopedCors reports origin validation and exposes X-Request-Id', () => {
  const headersA = {};
  const resA = { set: (k, v) => { headersA[String(k).toLowerCase()] = v; } };
  const allowed = guard.setScopedCors(
    { get: (k) => (k.toLowerCase() === 'origin' ? 'https://racepulseph.com' : undefined) },
    resA,
  );
  assert.deepEqual(allowed, { hasOrigin: true, originAllowed: true });
  assert.equal(headersA['access-control-allow-origin'], 'https://racepulseph.com');
  assert.match(headersA['access-control-expose-headers'], /X-Request-Id/);

  const headersB = {};
  const resB = { set: (k, v) => { headersB[String(k).toLowerCase()] = v; } };
  const blocked = guard.setScopedCors(
    { get: (k) => (k.toLowerCase() === 'origin' ? 'https://evil.example' : undefined) },
    resB,
  );
  assert.deepEqual(blocked, { hasOrigin: true, originAllowed: false });
  assert.equal(headersB['access-control-allow-origin'], undefined);
});
