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
