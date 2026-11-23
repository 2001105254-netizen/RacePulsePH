'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createRouteService } = require('../functions/route-service');
const { createRouteApp } = require('../functions/route-api');
const { createAccessApp } = require('../functions/access-api');
const { createAccessService } = require('../functions/access-service');

function createMockDb(initialDocs = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let txLock = Promise.resolve();
  let forceNextTxError = null;
  let forceNextGetError = null;

  const db = {
    doc(path) {
      return {
        path,
        async get() {
          if (forceNextGetError) {
            const err = forceNextGetError;
            forceNextGetError = null;
            throw err;
          }
          const exists = docs.has(path);
          return {
            exists,
            id: path.split('/').pop(),
            data: () => (exists ? structuredClone(docs.get(path)) : undefined),
          };
        },
      };
    },
    runTransaction(fn) {
      const exec = async () => {
        if (forceNextTxError) {
          const err = forceNextTxError;
          forceNextTxError = null;
          throw err;
        }
        const stagedCreate = new Set();
        const staged = new Map();
        const tx = {
          async get(ref) {
            if (staged.has(ref.path)) {
              const val = staged.get(ref.path);
              return { exists: val !== null, id: ref.path.split('/').pop(), data: () => (val ? structuredClone(val) : undefined) };
            }
            const exists = docs.has(ref.path);
            return {
              exists,
              id: ref.path.split('/').pop(),
              data: () => (exists ? structuredClone(docs.get(ref.path)) : undefined),
            };
          },
          create(ref, data) {
            if (docs.has(ref.path) || stagedCreate.has(ref.path)) {
              const err = new Error(`6 ALREADY_EXISTS: Document already exists: ${ref.path}`);
              err.code = 6;
              throw err;
            }
            stagedCreate.add(ref.path);
            staged.set(ref.path, structuredClone(data));
          },
          set(ref, data, opts) {
            if (opts && opts.merge && (staged.has(ref.path) || docs.has(ref.path))) {
              const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
              staged.set(ref.path, { ...base, ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            if (!base) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            staged.set(ref.path, { ...base, ...structuredClone(patch) });
          },
        };
        const result = await fn(tx);
        for (const [k, v] of staged.entries()) {
          docs.set(k, v);
        }
        return result;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };

  return {
    db,
    docs,
    failNextTransaction(err) {
      forceNextTxError = err;
    },
    failNextGet(err) {
      forceNextGetError = err;
    },
  };
}

function makeReq({ method = 'POST', path = '/create-preset', headers = {}, body = {}, ip = '203.0.113.11' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method,
    path,
    ip,
    body,
    rawBody,
    get(name) {
      return lower[String(name).toLowerCase()];
    },
    is(type) {
      return (lower['content-type'] || 'application/json').includes(type);
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
    json(val) {
      body = val;
      return res;
    },
    send(val) {
      body = val;
      return res;
    },
  };
  return res;
}

test('withdraw rejects cross-race publicationId (fixes cross-tenant IDOR)', async () => {
  const store = createMockDb({
    'users/org-a': { uid: 'org-a', role: 'organizer', approved: true, displayName: 'Org A' },
    'userAccess/org-a': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'races/race_a': { id: 'race_a', name: 'Race A', createdBy: 'org-a', organizerIds: [] },
    'races/race_b': { id: 'race_b', name: 'Race B', createdBy: 'org-b', organizerIds: [] },
    'publishedRaceRoutes/pub_b': {
      id: 'pub_b',
      raceId: 'race_b',
      distanceId: '10k',
      status: 'published',
    },
    'raceRouteCatalog/race_a_10k': { id: 'race_a_10k', status: 'published' },
    'raceRouteCatalog/race_b_10k': { id: 'race_b_10k', status: 'published' },
  });

  const service = createRouteService(store.db, null);
  await assert.rejects(
    service.execute('org-a', '/withdraw', {
      requestId: 'req-withdraw-cross-race-1234',
      raceId: 'race_a',
      distanceId: '10k',
      publicationId: 'pub_b',
      reason: 'Attempt cross-race withdraw',
    }),
    (err) => err.status === 400 || err.status === 403,
  );
  assert.equal(store.docs.get('publishedRaceRoutes/pub_b').status, 'published');
});

test('concurrent duplicate requestId replays idempotently inside transaction without ALREADY_EXISTS crash', async () => {
  const store = createMockDb({
    'users/org-a': { uid: 'org-a', role: 'organizer', approved: true, displayName: 'Org A' },
    'userAccess/org-a': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  });
  const service = createRouteService(store.db, null);
  const payload = {
    requestId: 'req-concurrent-create-preset-1234',
    presetId: 'preset_conc_1',
    title: 'Baguio 21K',
    region: 'Cordillera',
    distanceM: 21097,
    elevationGainM: 450,
    elevationLossM: 440,
    canonicalGeometry: { segments: [[[120.59, 16.4], [120.6, 16.41]]] },
    markers: [],
  };

  const [res1, res2] = await Promise.all([
    service.execute('org-a', '/create-preset', payload),
    service.execute('org-a', '/create-preset', payload),
  ]);
  assert.equal(res1.preset.id, 'preset_conc_1');
  assert.equal(res2.preset.id, 'preset_conc_1');
  assert.equal(res2.draft.revision, 1);
});

test('create-preset and save-draft reject NaN, Infinity, negative metrics, >200 markers, and oversized payloads', async () => {
  const store = createMockDb({
    'users/org-a': { uid: 'org-a', role: 'organizer', approved: true, displayName: 'Org A' },
    'userAccess/org-a': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'routePresets/preset_1': { id: 'preset_1', title: 'Test', region: 'PH', ownerUid: 'org-a', revision: 1 },
    'routePresets/preset_1/drafts/draft_main': { id: 'draft_main', revision: 1 },
  });
  const service = createRouteService(store.db, null);

  await assert.rejects(
    service.execute('org-a', '/create-preset', {
      requestId: 'req-invalid-num-123456',
      title: 'Bad Distance',
      distanceM: -5,
    }),
    (err) => err.status === 400,
  );

  await assert.rejects(
    service.execute('org-a', '/save-draft', {
      requestId: 'req-invalid-inf-123456',
      presetId: 'preset_1',
      expectedRevision: 1,
      elevationGainM: Infinity,
    }),
    (err) => err.status === 400,
  );

  await assert.rejects(
    service.execute('org-a', '/save-draft', {
      requestId: 'req-too-many-markers-1234',
      presetId: 'preset_1',
      expectedRevision: 1,
      markers: Array.from({ length: 201 }, (_, i) => ({ id: `m${i}` })),
    }),
    (err) => err.status === 400,
  );

  const hugeCoords = Array.from({ length: 80_000 }, () => [120.59, 16.4]);
  await assert.rejects(
    service.execute('org-a', '/create-preset', {
      requestId: 'req-oversized-draft-123456',
      title: 'Oversized',
      canonicalGeometry: { segments: [hugeCoords] },
    }),
    (err) => err.status === 400,
  );
});

test('routeApi and accessApi map unexpected internal errors to 500 without leaking raw messages', async () => {
  const store = createMockDb({
    'users/sa-1': { uid: 'sa-1', role: 'superadmin', approved: true, displayName: 'Super' },
    'userAccess/sa-1': { status: 'active', scope: 'all', raceIds: [], overrides: {} },
  });
  const admin = {
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        assert.equal(checkRevoked, true);
        if (token === 'tok-sa') return { uid: 'sa-1' };
        throw new Error('bad');
      },
    }),
  };

  const routeHandler = createRouteApp({ admin, db: store.db, appCheckMode: 'off' });
  store.failNextGet(new Error('SECRET_FIRESTORE_GRPC_FAILURE_DETAILS'));
  const routeRes = makeRes();
  await routeHandler(
    makeReq({
      path: '/create-preset',
      headers: { authorization: 'Bearer tok-sa' },
      body: { requestId: 'req-err-500-route-1234', title: 'Test' },
    }),
    routeRes,
  );
  assert.equal(routeRes.statusCode, 500);
  assert.ok(!JSON.stringify(routeRes.body).includes('SECRET_FIRESTORE_GRPC_FAILURE_DETAILS'));

  const accessHandler = createAccessApp({ admin, db: store.db, appCheckMode: 'off' });
  store.failNextGet(new Error('SECRET_ACCESS_DB_FAILURE_DETAILS'));
  const accessRes = makeRes();
  await accessHandler(
    makeReq({
      path: '/session',
      headers: { authorization: 'Bearer tok-sa' },
      body: {},
    }),
    accessRes,
  );
  assert.equal(accessRes.statusCode, 500);
  assert.ok(!JSON.stringify(accessRes.body).includes('SECRET_ACCESS_DB_FAILURE_DETAILS'));

  // Domain validation error in access-service still returns 400.
  const accessSvc = createAccessService(store.db);
  store.docs.set('accessSystem/rollout', { enforcementReady: true });
  store.docs.set('users/u-target', { uid: 'u-target', role: 'runner', approved: true });
  await assert.rejects(
    accessSvc.execute('sa-1', '/save', {
      uid: 'u-target',
      role: 'invalid-role',
      status: 'active',
      scope: 'owned-assigned',
      raceIds: [],
      overrides: {},
      revision: 0,
      requestId: 'req-invalid-role-123456',
    }),
    (err) => err.status === 400,
  );
});
