'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadResilientFetch(mockFetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/resilientFetch.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const store = new Map();
  const mockSessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  new Function('require', 'module', 'exports', 'fetch', 'sessionStorage', js)(
    () => ({}),
    module,
    module.exports,
    mockFetch,
    mockSessionStorage,
  );
  return module.exports;
}

test('parseRetryAfterSeconds parses body retryAfter, numeric headers, and HTTP-date headers', () => {
  const rf = loadResilientFetch(async () => new Response('{}'));
  assert.equal(rf.parseRetryAfterSeconds(new Response('', { headers: { 'Retry-After': '45' } })), 45);
  assert.equal(rf.parseRetryAfterSeconds(new Response(''), { retryAfter: 30 }), 30);
  const futureDate = new Date(Date.now() + 20_000).toUTCString();
  const parsedDate = rf.parseRetryAfterSeconds(new Response('', { headers: { 'Retry-After': futureDate } }));
  assert.ok(parsedDate >= 15 && parsedDate <= 25);
});

test('computeBackoffMs enforces exponential bounds and respects Retry-After floor', () => {
  const rf = loadResilientFetch(async () => new Response('{}'));
  const b0 = rf.computeBackoffMs(0, { baseMs: 1000, maxMs: 10_000, jitterRatio: 0 });
  const b3 = rf.computeBackoffMs(3, { baseMs: 1000, maxMs: 10_000, jitterRatio: 0 });
  const b10 = rf.computeBackoffMs(10, { baseMs: 1000, maxMs: 10_000, jitterRatio: 0 });
  const withRetryAfter = rf.computeBackoffMs(0, { baseMs: 1000, maxMs: 10_000, retryAfterSec: 25 });
  assert.equal(b0, 1000);
  assert.equal(b3, 8000);
  assert.equal(b10, 10_000);
  assert.ok(withRetryAfter >= 25_000);
});

test('boundedFetch caps GET retries, never retries non-idempotent POSTs, and dedupes concurrent GETs', async () => {
  let getCalls = 0;
  let postCalls = 0;
  const rf = loadResilientFetch(async (url, init) => {
    if ((init?.method || 'GET') === 'POST') {
      postCalls += 1;
      return new Response('unavailable', { status: 503 });
    }
    getCalls += 1;
    if (String(url).includes('/dedupe')) {
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('unavailable', { status: 503 });
  });

  // 1. Bounded GET retries stop cleanly after maxRetries=2 (3 total attempts).
  const getRes = await rf.boundedFetch('https://example.test/fail', { method: 'GET' }, {
    maxRetries: 2,
    baseDelayMs: 5,
    maxDelayMs: 10,
  });
  assert.equal(getRes.status, 503);
  assert.equal(getCalls, 3);

  // 2. Non-idempotent POST never retries even if maxRetries is passed.
  const postRes = await rf.boundedFetch('https://example.test/mutate', { method: 'POST' }, {
    maxRetries: 3,
    baseDelayMs: 5,
  });
  assert.equal(postRes.status, 503);
  assert.equal(postCalls, 1);

  // 3. Concurrent GETs share one network call.
  const prevGets = getCalls;
  const results = await Promise.all([
    rf.boundedFetch('https://example.test/dedupe', { method: 'GET' }, { dedupeGet: true }),
    rf.boundedFetch('https://example.test/dedupe', { method: 'GET' }, { dedupeGet: true }),
    rf.boundedFetch('https://example.test/dedupe', { method: 'GET' }, { dedupeGet: true }),
  ]);
  assert.equal(getCalls - prevGets, 1);
  for (const r of results) {
    assert.deepEqual(await r.json(), { ok: true });
  }
});

test('circuit breaker opens after repeated 5xx failures and prevents retry storms', async () => {
  let calls = 0;
  const rf = loadResilientFetch(async () => {
    calls += 1;
    return new Response('bad gateway', { status: 502 });
  });

  for (let i = 0; i < 5; i += 1) {
    const res = await rf.boundedFetch('https://example.test/storm', { method: 'GET' }, {
      maxRetries: 0,
      circuitKey: 'storm-endpoint',
    });
    assert.equal(res.status, 502);
  }
  assert.equal(calls, 5);

  await assert.rejects(
    rf.boundedFetch('https://example.test/storm', { method: 'GET' }, {
      maxRetries: 0,
      circuitKey: 'storm-endpoint',
    }),
    (err) => err instanceof rf.CircuitOpenError && err.retryAfter > 0,
  );
  assert.equal(calls, 5);
});

test('createActionCooldownStore tracks progressive failure penalties and clears cleanly', () => {
  const rf = loadResilientFetch(async () => new Response('{}'));
  const cd = rf.createActionCooldownStore('test_cd');
  assert.equal(cd.recordFailure('login', { threshold: 3, baseWaitSec: 10, maxWaitSec: 60 }), 0);
  assert.equal(cd.recordFailure('login', { threshold: 3, baseWaitSec: 10, maxWaitSec: 60 }), 0);
  assert.equal(cd.recordFailure('login', { threshold: 3, baseWaitSec: 10, maxWaitSec: 60 }), 10);
  assert.equal(cd.recordFailure('login', { threshold: 3, baseWaitSec: 10, maxWaitSec: 60 }), 20);
  assert.ok(cd.getRemainingSeconds('login') >= 18);
  cd.clear('login');
  assert.equal(cd.getRemainingSeconds('login'), 0);
});
