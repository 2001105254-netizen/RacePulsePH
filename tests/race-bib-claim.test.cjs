'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createRaceBibClaimApp } = require('../functions/race-bib-claim-api');

function createClaimDb(initialDocs = {}, { throwIndexError = false } = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let fullRaceScanCount = 0;
  let indexedQueryCount = 0;
  let txLock = Promise.resolve();

  const makeSnap = (path, data) => ({
    exists: data !== undefined,
    id: path.split('/').pop(),
    data: () => (data !== undefined ? structuredClone(data) : undefined),
  });

  const db = {
    doc(path) {
      return {
        path,
        async get() {
          return makeSnap(path, docs.get(path));
        },
      };
    },
    collection(name) {
      const filters = [];
      let limitVal = null;
      const q = {
        where(field, op, val) {
          filters.push({ field, op, val });
          return q;
        },
        limit(n) {
          limitVal = n;
          return q;
        },
        async get() {
          const isBibQuery = filters.some((f) => f.field === 'bibNumber');
          if (isBibQuery) {
            indexedQueryCount += 1;
            if (throwIndexError) {
              const err = new Error('9 FAILED_PRECONDITION: The query requires an index.');
              err.code = 9;
              throw err;
            }
          } else {
            fullRaceScanCount += 1;
          }
          const prefix = `${name}/`;
          let matched = [...docs.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => ({ id: k.slice(prefix.length), data: () => structuredClone(v) }))
            .filter((doc) => {
              const d = doc.data();
              return filters.every((f) => f.op === '==' && d[f.field] === f.val);
            });
          if (typeof limitVal === 'number') matched = matched.slice(0, limitVal);
          return {
            empty: matched.length === 0,
            docs: matched,
          };
        },
      };
      return q;
    },
    runTransaction(fn) {
      const exec = async () => {
        const staged = new Map();
        const stagedCreated = new Set();
        const tx = {
          async get(ref) {
            const val = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            return makeSnap(ref.path, val);
          },
          create(ref, data) {
            if (docs.has(ref.path) || stagedCreated.has(ref.path)) {
              const err = new Error(`6 ALREADY_EXISTS: ${ref.path}`);
              err.code = 6;
              throw err;
            }
            stagedCreated.add(ref.path);
            staged.set(ref.path, structuredClone(data));
          },
          set(ref, data) {
            staged.set(ref.path, structuredClone(data));
          },
        };
        const res = await fn(tx);
        for (const [k, v] of staged.entries()) {
          docs.set(k, v);
        }
        return res;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };

  return {
    db,
    docs,
    stats: () => ({ fullRaceScanCount, indexedQueryCount }),
  };
}

function makeAdmin(tokens) {
  return {
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        assert.equal(checkRevoked, true);
        if (!tokens[token]) throw new Error('bad token');
        return tokens[token];
      },
    }),
  };
}

function makeReq({ path = '/preview', token = 'tok-1', body = {}, ip = '203.0.113.55' } = {}) {
  return {
    method: 'POST',
    path,
    ip,
    body,
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
    get(name) {
      const lower = String(name).toLowerCase();
      if (lower === 'authorization') return token ? `Bearer ${token}` : undefined;
      if (lower === 'content-type') return 'application/json';
      return undefined;
    },
    is(type) {
      return type === 'application/json';
    },
  };
}

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    set(k, v) {
      headers[String(k).toLowerCase()] = v;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(v) {
      body = v;
      return res;
    },
    send(v) {
      body = v;
      return res;
    },
  };
  return res;
}

test('nonexistent bib returns 404 from indexed query WITHOUT full-race scan fallback', async () => {
  const store = createClaimDb({
    'users/u1': { uid: 'u1', role: 'runner', approved: true },
    'races/race_1': { id: 'race_1', name: 'Manila 10K', date: '2026-12-01' },
    'runners/import_1_race_1': { uid: 'import_1', raceId: 'race_1', bibNumber: '10-001', fullName: 'Runner One', distance: '10K', gender: 'male', age: 25 },
  });
  const handler = createRaceBibClaimApp({
    admin: makeAdmin({ 'tok-1': { uid: 'u1' } }),
    db: store.db,
    appCheckMode: 'off',
  });

  const res = makeRes();
  await handler(makeReq({ path: '/preview', body: { raceId: 'race_1', bibNumber: '10-999' } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(store.stats().indexedQueryCount, 1);
  assert.equal(store.stats().fullRaceScanCount, 0);
});

test('missing composite index triggers bounded fallback cache (<= 20 races)', async () => {
  const docs = {};
  const tokens = {};
  for (let u = 1; u <= 5; u += 1) {
    docs[`users/u${u}`] = { uid: `u${u}`, role: 'runner', approved: true };
    tokens[`tok-${u}`] = { uid: `u${u}` };
  }
  for (let i = 1; i <= 25; i += 1) {
    docs[`races/race_${i}`] = { id: `race_${i}`, name: `Race ${i}`, date: '2026-12-01' };
    docs[`runners/import_${i}_race_${i}`] = {
      uid: `import_${i}`,
      raceId: `race_${i}`,
      bibNumber: '5-001',
      fullName: `Runner ${i}`,
      distance: '5K',
      gender: 'female',
      age: 26,
    };
  }
  const store = createClaimDb(docs, { throwIndexError: true });
  const handler = createRaceBibClaimApp({
    admin: makeAdmin(tokens),
    db: store.db,
    appCheckMode: 'off',
  });

  for (let i = 1; i <= 25; i += 1) {
    const tok = `tok-${((i - 1) % 5) + 1}`;
    const res = makeRes();
    await handler(makeReq({ path: '/preview', token: tok, body: { raceId: `race_${i}`, bibNumber: '5-001' } }), res);
    assert.equal(res.statusCode, 200);
  }
  // Cache size must remain capped at 20, so re-querying race_1 triggers a fresh scan after eviction.
  const before = store.stats().fullRaceScanCount;
  const resRequery = makeRes();
  await handler(makeReq({ path: '/preview', token: 'tok-1', body: { raceId: 'race_1', bibNumber: '5-001' } }), resRequery);
  assert.equal(resRequery.statusCode, 200);
  assert.equal(store.stats().fullRaceScanCount, before + 1);
});

test('bib belonging to another real user account cannot be previewed or claimed', async () => {
  const store = createClaimDb({
    'users/u1': { uid: 'u1', role: 'runner', approved: true },
    'users/u2': { uid: 'u2', role: 'runner', approved: true },
    'races/race_1': { id: 'race_1', name: 'Manila 10K', date: '2026-12-01' },
    'runners/u2_race_1': {
      uid: 'u2',
      raceId: 'race_1',
      bibNumber: '10-001',
      fullName: 'Real Registered Runner',
      distance: '10K',
      gender: 'female',
      age: 28,
    },
  });
  const handler = createRaceBibClaimApp({
    admin: makeAdmin({ 'tok-1': { uid: 'u1' }, 'tok-2': { uid: 'u2' } }),
    db: store.db,
    appCheckMode: 'off',
  });

  const previewRes = makeRes();
  await handler(makeReq({ path: '/preview', token: 'tok-1', body: { raceId: 'race_1', bibNumber: '10-001' } }), previewRes);
  assert.equal(previewRes.statusCode, 403);

  const claimRes = makeRes();
  await handler(makeReq({ path: '/claim', token: 'tok-1', body: { raceId: 'race_1', bibNumber: '10-001' } }), claimRes);
  assert.equal(claimRes.statusCode, 403);

  // Actual owner can still preview their own bib.
  const ownerPreview = makeRes();
  await handler(makeReq({ path: '/preview', token: 'tok-2', body: { raceId: 'race_1', bibNumber: '10-001' } }), ownerPreview);
  assert.equal(ownerPreview.statusCode, 200);
});

test('concurrent claim calls on import_ bib succeed for only ONE user and block second user preview/claim with 409', async () => {
  const store = createClaimDb({
    'users/u1': { uid: 'u1', role: 'runner', approved: true },
    'users/u2': { uid: 'u2', role: 'runner', approved: true },
    'races/race_1': { id: 'race_1', name: 'Manila 10K', date: '2026-12-01' },
    'runners/import_abc_race_1': {
      uid: 'import_abc',
      raceId: 'race_1',
      bibNumber: '10-077',
      fullName: 'Walkin Athlete',
      distance: '10K',
      gender: 'male',
      age: 30,
    },
  });
  const handler = createRaceBibClaimApp({
    admin: makeAdmin({ 'tok-1': { uid: 'u1' }, 'tok-2': { uid: 'u2' } }),
    db: store.db,
    appCheckMode: 'off',
  });

  const res1 = makeRes();
  const res2 = makeRes();
  await Promise.all([
    handler(makeReq({ path: '/claim', token: 'tok-1', body: { raceId: 'race_1', bibNumber: '10-077' } }), res1),
    handler(makeReq({ path: '/claim', token: 'tok-2', body: { raceId: 'race_1', bibNumber: '10-077' } }), res2),
  ]);

  const statuses = [res1.statusCode, res2.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);

  const winnerToken = res1.statusCode === 200 ? 'tok-1' : 'tok-2';
  const loserToken = res1.statusCode === 200 ? 'tok-2' : 'tok-1';

  // Loser cannot preview already-claimed bib.
  const loserPreview = makeRes();
  await handler(makeReq({ path: '/preview', token: loserToken, body: { raceId: 'race_1', bibNumber: '10-077' } }), loserPreview);
  assert.equal(loserPreview.statusCode, 409);

  // Winner re-previewing gets alreadyLinked: true cleanly.
  const winnerPreview = makeRes();
  await handler(makeReq({ path: '/preview', token: winnerToken, body: { raceId: 'race_1', bibNumber: '10-077' } }), winnerPreview);
  assert.equal(winnerPreview.statusCode, 200);
  assert.equal(winnerPreview.body.alreadyLinked, true);
});
