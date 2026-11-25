'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const policy = require('../functions/access-policy');
const { createAccessApp } = require('../functions/access-api');
const {
  applyStorageObjectTelemetryDelta,
  clearTelemetrySnapshotCache,
  getSystemTelemetrySnapshot,
  recordPresenceHeartbeat,
} = require('../functions/telemetry-service');

function toComparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  if (value && typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return value;
}

function createTelemetryMockDb(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]));
  let txLock = Promise.resolve();

  const makeSnap = (docPath, data) => ({
    exists: data !== undefined && data !== null,
    id: docPath.split('/').pop(),
    ref: { path: docPath, id: docPath.split('/').pop() },
    data: () => (data !== undefined && data !== null ? structuredClone(data) : undefined),
  });

  function buildQuery(collectionPath, filters = []) {
    const queryApi = {
      where(field, op, value) {
        return buildQuery(collectionPath, [...filters, { field, op, value }]);
      },
      orderBy() {
        return queryApi;
      },
      limit() {
        return queryApi;
      },
      count() {
        return {
          async get() {
            const snap = await queryApi.get();
            return { data: () => ({ count: snap.docs.length }) };
          },
        };
      },
      async get() {
        const prefix = `${collectionPath}/`;
        const matched = [];
        for (const [docPath, data] of docs.entries()) {
          if (!docPath.startsWith(prefix)) continue;
          const rest = docPath.slice(prefix.length);
          if (rest.includes('/')) continue;
          let ok = true;
          for (const f of filters) {
            const left = toComparable(data?.[f.field]);
            const right = toComparable(f.value);
            if (f.op === '==') {
              if (left !== right) {
                ok = false;
                break;
              }
            } else if (f.op === '>') {
              if (!(left > right)) {
                ok = false;
                break;
              }
            } else if (f.op === '>=') {
              if (!(left >= right)) {
                ok = false;
                break;
              }
            } else if (f.op === '<') {
              if (!(left < right)) {
                ok = false;
                break;
              }
            } else {
              ok = false;
              break;
            }
          }
          if (ok) matched.push(makeSnap(docPath, data));
        }
        return { docs: matched, empty: matched.length === 0, size: matched.length };
      },
    };
    return queryApi;
  }

  const db = {
    doc(docPath) {
      return {
        path: docPath,
        id: docPath.split('/').pop(),
        async get() {
          return makeSnap(docPath, docs.get(docPath));
        },
        async set(data, opts) {
          if (opts && opts.merge && docs.has(docPath)) {
            docs.set(docPath, { ...docs.get(docPath), ...structuredClone(data) });
          } else {
            docs.set(docPath, structuredClone(data));
          }
        },
      };
    },
    collection(collectionPath) {
      return buildQuery(collectionPath, []);
    },
    runTransaction(fn) {
      const exec = async () => {
        const staged = new Map();
        const stagedDelete = new Set();
        let wrote = false;
        const tx = {
          async get(ref) {
            if (wrote) throw new Error('Reads must precede writes in transaction.');
            if (stagedDelete.has(ref.path)) return makeSnap(ref.path, undefined);
            if (staged.has(ref.path)) return makeSnap(ref.path, staged.get(ref.path));
            return makeSnap(ref.path, docs.get(ref.path));
          },
          set(ref, data, opts) {
            wrote = true;
            if (opts && opts.merge && (staged.has(ref.path) || docs.has(ref.path))) {
              const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
              staged.set(ref.path, { ...base, ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            wrote = true;
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            if (!base) throw new Error(`NOT_FOUND: ${ref.path}`);
            staged.set(ref.path, { ...base, ...structuredClone(patch) });
          },
        };
        const out = await fn(tx);
        for (const [k, v] of staged.entries()) docs.set(k, v);
        return out;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };
  return { db, docs };
}

function invokeApp(app, { uid, path, body = {}, method = 'POST' }) {
  return new Promise((resolve) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers.authorization = `Bearer token-for-${uid}`;
    const req = {
      method,
      path,
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
      headers,
      ip: '127.0.0.1',
      is: (type) => String(type).includes('json'),
      get: (name) => headers[String(name).toLowerCase()],
    };
    let statusCode = 200;
    const resHeaders = {};
    const res = {
      set(k, v) {
        if (typeof k === 'object') Object.assign(resHeaders, k);
        else resHeaders[k] = v;
        return res;
      },
      status(code) {
        statusCode = code;
        return res;
      },
      json(payload) {
        resolve({ status: statusCode, body: payload, headers: resHeaders });
        return res;
      },
    };
    void app(req, res);
  });
}

test('recordPresenceHeartbeat writes zero-PII activePresence and increments sharded uniqueSessions once per day', async () => {
  const { db, docs } = createTelemetryMockDb();
  const now1 = new Date('2026-11-25T05:00:00.000Z');
  const first = await recordPresenceHeartbeat(db, {
    uid: 'runner_alpha_1',
    role: 'runner',
    platform: 'android',
    workspace: 'personal',
    now: now1,
    salt: 'unit-salt-m5',
  });

  assert.equal(first.ok, true);
  assert.equal(first.dayKey, '2026-11-25');
  assert.equal(first.isNewSessionToday, true);

  const presenceDoc = docs.get(`activePresence/${first.sessionHash}`);
  assert.ok(presenceDoc);
  assert.equal('uid' in presenceDoc, false);
  assert.equal('email' in presenceDoc, false);
  assert.equal('ip' in presenceDoc, false);
  assert.equal(presenceDoc.platform, 'android');
  assert.equal(presenceDoc.workspace, 'personal');
  assert.equal(toComparable(presenceDoc.expiresAt) > now1.getTime(), true);

  const second = await recordPresenceHeartbeat(db, {
    uid: 'runner_alpha_1',
    role: 'runner',
    platform: 'android',
    workspace: 'personal',
    now: new Date(now1.getTime() + 15 * 60 * 1000),
    salt: 'unit-salt-m5',
  });
  assert.equal(second.isNewSessionToday, false);

  const shardDoc = docs.get(`systemTelemetry/${first.shardDocId}`);
  assert.equal(shardDoc.uniqueSessions, 1);
  assert.equal(shardDoc.heartbeats, 2);

  await assert.rejects(
    () =>
      recordPresenceHeartbeat(db, {
        uid: 'runner_alpha_1',
        role: 'runner',
        platform: 'smartwatch',
        workspace: 'personal',
        now: now1,
      }),
    /Invalid platform/i,
  );
});

test('applyStorageObjectTelemetryDelta tracks prefix buckets and floors deletions safely at zero', async () => {
  const { db, docs } = createTelemetryMockDb();
  await applyStorageObjectTelemetryDelta(db, {
    name: 'social-media/u1/p1/clip.mp4',
    size: 10_000_000,
    direction: 'finalize',
    now: new Date('2026-11-25T06:00:00.000Z'),
  });
  await applyStorageObjectTelemetryDelta(db, {
    name: 'chat-media/dm_a_b/u1/photo.webp',
    size: 500_000,
    direction: 'finalize',
    now: new Date('2026-11-25T06:01:00.000Z'),
  });
  await applyStorageObjectTelemetryDelta(db, {
    name: 'chat-media/dm_a_b/u1/photo.webp',
    size: 900_000,
    direction: 'delete',
    now: new Date('2026-11-25T06:02:00.000Z'),
  });

  const summary = docs.get('systemTelemetry/storageSummary');
  assert.equal(summary.objectCount, 1);
  assert.equal(summary.totalBytes, 10_000_000);
  assert.equal(summary.prefixes['social-media'].objects, 1);
  assert.equal(summary.prefixes['chat-media'].bytes, 0);
  assert.equal(summary.prefixes['chat-media'].objects, 0);
});

test('getSystemTelemetrySnapshot caches 60s, enforces 10s forceRefresh cooldown, filters expired presence, and degrades cleanly when Monitoring fails', async () => {
  clearTelemetrySnapshotCache();
  const baseNow = new Date('2026-11-25T08:00:00.000Z');
  const { db } = createTelemetryMockDb({
    'users/u1': { uid: 'u1', role: 'runner' },
    'users/u2': { uid: 'u2', role: 'admin' },
    'messages/m1': { messageId: 'm1' },
    'contentReports/r1': { reportId: 'r1', status: 'open' },
    'clubRequests/cr1': { requestId: 'cr1', status: 'pending' },
    'activePresence/live_1': {
      sessionHash: 'live_1',
      role: 'runner',
      platform: 'android',
      workspace: 'personal',
      dayKey: '2026-11-25',
      expiresAt: new Date(baseNow.getTime() + 10 * 60 * 1000),
    },
    'activePresence/expired_1': {
      sessionHash: 'expired_1',
      role: 'runner',
      platform: 'web',
      workspace: 'personal',
      dayKey: '2026-11-25',
      expiresAt: new Date(baseNow.getTime() - 60 * 1000),
    },
    'systemTelemetry/day_2026-11-25_s0': {
      kind: 'daily',
      dayKey: '2026-11-25',
      uniqueSessions: 14,
      heartbeats: 28,
      authenticatedWrites: 9,
    },
    'systemTelemetry/storageSummary': {
      kind: 'storage_summary',
      totalBytes: 25_000_000,
      objectCount: 5,
      prefixes: {
        'social-media': { bytes: 20_000_000, objects: 3 },
        'chat-media': { bytes: 5_000_000, objects: 2 },
      },
    },
  });

  let monitorCalls = 0;
  const first = await getSystemTelemetrySnapshot(db, {
    now: baseNow,
    monitoringFetcher: async () => {
      monitorCalls += 1;
      throw new Error('Monitoring API disabled in emulator');
    },
  });

  assert.equal(first.onlineNow.total, 1);
  assert.equal(first.onlineNow.byPlatform.android, 1);
  assert.equal(first.rollups.dauToday, 14);
  assert.equal(first.storage.objectCount, 5);
  assert.equal(first.firestore.collections.find((c) => c.collection === 'users').documents, 2);
  assert.equal(first.moderation.openReports, 1);
  assert.equal(first.moderation.pendingClubRequests, 1);
  assert.equal(first.monitoring.source, 'unavailable');
  assert.equal(first.triggers.length, 4);
  assert.equal(monitorCalls, 1);

  // Within 10s forceRefresh is throttled to cache
  const throttled = await getSystemTelemetrySnapshot(db, {
    forceRefresh: true,
    now: new Date(baseNow.getTime() + 3000),
    monitoringFetcher: async () => {
      monitorCalls += 1;
      return { source: 'cloud_monitoring', monthlyEgressGb: 120, peakWriteRps: 45, functionP95Ms: 210, errorRatePct: 0.2, requests24h: 12000 };
    },
  });
  assert.equal(throttled.cache.cached, true);
  assert.equal(monitorCalls, 1);

  // After 12s forceRefresh bypasses cache
  const refreshed = await getSystemTelemetrySnapshot(db, {
    forceRefresh: true,
    now: new Date(baseNow.getTime() + 12_000),
    monitoringFetcher: async () => {
      monitorCalls += 1;
      return { source: 'cloud_monitoring', monthlyEgressGb: 120, peakWriteRps: 45, functionP95Ms: 210, errorRatePct: 0.2, requests24h: 12000 };
    },
  });
  assert.equal(refreshed.monitoring.source, 'cloud_monitoring');
  assert.equal(refreshed.monitoring.monthlyEgressGb, 120);
  assert.equal(monitorCalls, 2);
});

test('accessApi enforces RBAC strictly on /presence/heartbeat and /telemetry', async () => {
  clearTelemetrySnapshotCache();
  const initialDocs = {};
  for (const [uid, role, status] of [
    ['sa_active', 'superadmin', 'active'],
    ['sa_suspended', 'superadmin', 'suspended'],
    ['admin_active', 'admin', 'active'],
    ['runner_active', 'runner', 'active'],
  ]) {
    const user = { uid, role, approved: true, displayName: uid, email: `${uid}@example.com` };
    initialDocs[`users/${uid}`] = user;
    const access = policy.accessFor(user);
    access.status = status;
    access.permissions = Object.fromEntries(policy.keys.map((k) => [k, policy.can(user, access, k)]));
    initialDocs[`userAccess/${uid}`] = access;
  }

  const { db } = createTelemetryMockDb(initialDocs);
  const mockAdmin = {
    auth: () => ({
      async verifyIdToken(token) {
        const uid = String(token || '').replace(/^token-for-/, '');
        if (!initialDocs[`users/${uid}`]) throw new Error('Invalid token');
        return { uid };
      },
    }),
  };
  const app = createAccessApp({ admin: mockAdmin, db, appCheckMode: 'monitor' });

  const hbRunner = await invokeApp(app, {
    uid: 'runner_active',
    path: '/presence/heartbeat',
    body: { platform: 'web', workspace: 'personal' },
  });
  assert.equal(hbRunner.status, 200);
  assert.equal(hbRunner.body.ok, true);

  const telRunner = await invokeApp(app, { uid: 'runner_active', path: '/telemetry', body: {} });
  assert.equal(telRunner.status, 403);
  assert.match(telRunner.body.error, /Super Admin access required/i);

  const telAdmin = await invokeApp(app, { uid: 'admin_active', path: '/telemetry', body: {} });
  assert.equal(telAdmin.status, 403);
  assert.match(telAdmin.body.error, /Super Admin access required/i);

  const telSuspended = await invokeApp(app, { uid: 'sa_suspended', path: '/telemetry', body: {} });
  assert.equal(telSuspended.status, 403);

  const telSuperAdmin = await invokeApp(app, { uid: 'sa_active', path: '/telemetry', body: {} });
  assert.equal(telSuperAdmin.status, 200);
  assert.equal(Array.isArray(telSuperAdmin.body.triggers), true);
  assert.equal(telSuperAdmin.body.onlineNow.total >= 1, true);
});
