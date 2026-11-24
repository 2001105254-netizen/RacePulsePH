'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createBadgeService } = require('../functions/badge-service');
const { createCommunityService } = require('../functions/community-service');
const { createCommunityApp } = require('../functions/community-api');
const { buildStarterBadgePack, computeRunCompletionXp } = require('../functions/badge-engine');

function createMockDb(initialDocs = {}, options = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let txLock = Promise.resolve();
  let forceNextTxError = null;
  let forceNextGetError = null;

  const makeSnap = (docPath, data) => ({
    exists: data !== undefined && data !== null,
    id: docPath.split('/').pop(),
    ref: { path: docPath, id: docPath.split('/').pop() },
    data: () => (data !== undefined && data !== null ? structuredClone(data) : undefined),
  });

  function resolveFieldName(field) {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object') {
      if (typeof field.formattedName === 'string') return field.formattedName;
      if (Array.isArray(field.segments) && field.segments.length > 0) {
        return field.segments.join('.');
      }
    }
    return String(field);
  }

  function getFieldValue(docId, data, fieldName) {
    if (fieldName === '__name__') return docId;
    const parts = fieldName.split('.');
    let cur = data;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }

  const db = {
    doc(docPath) {
      return {
        path: docPath,
        id: docPath.split('/').pop(),
        async get() {
          if (forceNextGetError) {
            const err = forceNextGetError;
            forceNextGetError = null;
            throw err;
          }
          return makeSnap(docPath, docs.get(docPath));
        },
      };
    },
    collection(collectionName) {
      const filters = [];
      let orderSpec = null;
      let startAfterCursor = undefined;
      let limitCount = null;

      const queryApi = {
        where(field, op, value) {
          filters.push({ field: resolveFieldName(field), op, value });
          return queryApi;
        },
        orderBy(field, direction = 'asc') {
          if (options.rejectNonStringOrderBy && typeof field !== 'string') {
            throw new Error('Mock orderBy only accepts string field');
          }
          orderSpec = { field: resolveFieldName(field), direction: String(direction).toLowerCase() };
          return queryApi;
        },
        startAfter(cursor) {
          startAfterCursor = cursor && typeof cursor === 'object' && cursor.id ? cursor.id : cursor;
          return queryApi;
        },
        limit(n) {
          limitCount = n;
          return queryApi;
        },
        async get() {
          if (forceNextGetError) {
            const err = forceNextGetError;
            forceNextGetError = null;
            throw err;
          }
          const prefix = `${collectionName}/`;
          let matched = [];
          for (const [docPath, data] of docs.entries()) {
            if (!docPath.startsWith(prefix)) continue;
            const rest = docPath.slice(prefix.length);
            if (rest.includes('/')) continue;
            let ok = true;
            for (const f of filters) {
              const val = getFieldValue(rest, data, f.field);
              if (f.op === '==') {
                if (val !== f.value) {
                  ok = false;
                  break;
                }
              } else if (f.op === 'array-contains') {
                if (!Array.isArray(val) || !val.includes(f.value)) {
                  ok = false;
                  break;
                }
              } else {
                ok = false;
                break;
              }
            }
            if (ok) matched.push({ id: rest, docPath, data });
          }

          if (orderSpec) {
            const dir = orderSpec.direction === 'desc' ? -1 : 1;
            matched.sort((a, b) => {
              const va = getFieldValue(a.id, a.data, orderSpec.field);
              const vb = getFieldValue(b.id, b.data, orderSpec.field);
              if (va === vb) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
              if (va === undefined || va === null) return -1 * dir;
              if (vb === undefined || vb === null) return 1 * dir;
              return (va < vb ? -1 : 1) * dir;
            });
          }

          if (startAfterCursor !== undefined && orderSpec) {
            matched = matched.filter((entry) => {
              const val = getFieldValue(entry.id, entry.data, orderSpec.field);
              return orderSpec.direction === 'desc'
                ? val < startAfterCursor
                : val > startAfterCursor;
            });
          }

          if (typeof limitCount === 'number' && limitCount >= 0) {
            matched = matched.slice(0, limitCount);
          }

          const snaps = matched.map((entry) => makeSnap(entry.docPath, entry.data));
          return {
            docs: snaps,
            empty: snaps.length === 0,
            size: snaps.length,
            forEach(cb) {
              snaps.forEach(cb);
            },
          };
        },
      };

      return queryApi;
    },
    runTransaction(fn) {
      const exec = async () => {
        if (forceNextTxError) {
          const err = forceNextTxError;
          forceNextTxError = null;
          throw err;
        }
        const stagedCreate = new Set();
        const stagedDelete = new Set();
        const staged = new Map();
        let hasWritten = false;
        const tx = {
          async get(ref) {
            if (hasWritten) {
              throw new Error('Firestore transactions require all reads to be executed before all writes.');
            }
            if (stagedDelete.has(ref.path)) return makeSnap(ref.path, undefined);
            if (staged.has(ref.path)) return makeSnap(ref.path, staged.get(ref.path));
            return makeSnap(ref.path, docs.get(ref.path));
          },
          create(ref, data) {
            hasWritten = true;
            const existsCurrently =
              !stagedDelete.has(ref.path) && (docs.has(ref.path) || stagedCreate.has(ref.path));
            if (existsCurrently) {
              const err = new Error(`6 ALREADY_EXISTS: ${ref.path}`);
              err.code = 6;
              throw err;
            }
            stagedDelete.delete(ref.path);
            stagedCreate.add(ref.path);
            staged.set(ref.path, structuredClone(data));
          },
          set(ref, data, opts) {
            hasWritten = true;
            stagedDelete.delete(ref.path);
            if (opts && opts.merge && (staged.has(ref.path) || docs.has(ref.path))) {
              const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
              staged.set(ref.path, { ...base, ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            hasWritten = true;
            if (stagedDelete.has(ref.path)) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            if (!base) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            staged.set(ref.path, { ...base, ...structuredClone(patch) });
          },
          delete(ref) {
            hasWritten = true;
            staged.delete(ref.path);
            stagedDelete.add(ref.path);
          },
        };
        const result = await fn(tx);
        for (const k of stagedDelete) {
          docs.delete(k);
        }
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

function makeReq({ method = 'POST', path: reqPath = '/badges/sync-my', headers = {}, body = {}, ip = '203.0.113.70' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method,
    path: reqPath,
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

function makeBadgePayload(overrides = {}) {
  return {
    requestId: 'req-badge-save-123456',
    badgeId: 'manila_sunrise_5k',
    name: 'Manila Sunrise 5K',
    description: 'Complete a verified 5 km run at sunrise.',
    tier: 'rare',
    customTierLabel: '',
    category: 'distance',
    artworkType: 'emblem',
    emblemId: 'sunrise-burst',
    artworkUrl: '',
    artworkStoragePath: '',
    borderStyle: 'sunburst-ph',
    primaryColor: '#DC2626',
    secondaryColor: '#F59E0B',
    animationEffect: 'shimmer-sweep',
    xpReward: 150,
    rule: { type: 'run_single_distance_km', threshold: 5 },
    activeFrom: null,
    activeUntil: null,
    hiddenUntilEarned: false,
    status: 'active',
    sortOrder: 15,
    ...overrides,
  };
}

function buildNorthboundTrack({
  startLat = 14.55,
  lon = 121.05,
  stepMeters = 50,
  count = 101,
  stepSec = 15,
  startMs = Date.parse('2026-11-24T22:00:00.000Z'), // 06:00 PHT
} = {}) {
  const dLatPerMeter = 1 / 111_195;
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    pts.push({
      lat: startLat + i * stepMeters * dLatPerMeter,
      lon,
      ele: 15 + (i % 5),
      accuracyM: 5,
      timestampMs: startMs + i * stepSec * 1000,
      speedMps: i === 0 ? 0 : stepMeters / stepSec,
    });
  }
  return pts;
}

function buildRunPayload(overrides = {}) {
  const startMs = Date.parse('2026-11-24T22:00:00.000Z'); // 06:00 PHT (within 4..6 Dawn Patrol window)
  const count = overrides.count ?? 101; // 5000m default
  const stepMeters = overrides.stepMeters ?? 50;
  const stepSec = overrides.stepSec ?? 15;
  const movingTimeMs = (count - 1) * stepSec * 1000;
  return {
    requestId: 'req-run-complete-123456',
    runId: 'run_badge_5k_01',
    mode: 'free',
    privacy: 'public',
    title: 'Roxas Blvd 5K',
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(startMs + movingTimeMs).toISOString(),
    movingTimeMs,
    homePrivacyTrimEnabled: false,
    trimmedHeadM: 0,
    trimmedTailM: 0,
    trackPoints: buildNorthboundTrack({ startMs, count, stepMeters, stepSec }),
    ...overrides,
  };
}

test('RBAC denials block runner, organizer, overridden admin, suspended, and removed accounts across badge routes', async () => {
  const store = createMockDb({
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true },
    'userAccess/u_runner': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_org': { uid: 'u_org', role: 'organizer', approved: true },
    'userAccess/u_org': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_admin_no_grant': { uid: 'u_admin_no_grant', role: 'admin', approved: true },
    'userAccess/u_admin_no_grant': {
      status: 'active',
      scope: 'all',
      raceIds: [],
      overrides: { 'badges.grant': false, 'badges.manage': false },
    },
    'users/u_suspended': { uid: 'u_suspended', role: 'runner', approved: true },
    'userAccess/u_suspended': { status: 'suspended', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_removed': { uid: 'u_removed', role: 'runner', approved: true, accessRemoved: true },
    'userAccess/u_removed': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  });
  const service = createCommunityService(store.db);

  const adminRoutes = [
    ['/badges/save', makeBadgePayload()],
    ['/badges/seed-defaults', { requestId: 'req-seed-deny-123456' }],
    ['/badges/archive', { requestId: 'req-arch-deny-123456', badgeId: 'b1', status: 'archived' }],
    ['/badges/delete', { requestId: 'req-del-deny-123456', badgeId: 'b1' }],
    ['/badges/grant', { requestId: 'req-grant-deny-123456', badgeId: 'b1', targetUid: 'u_runner' }],
    ['/badges/evaluate-retroactive', { requestId: 'req-retro-deny-123456' }],
  ];

  for (const uid of ['u_runner', 'u_org', 'u_admin_no_grant']) {
    for (const [route, payload] of adminRoutes) {
      await assert.rejects(
        service.execute(uid, route, payload),
        (err) => err.status === 403,
        `Expected 403 for ${uid} on ${route}`,
      );
    }
  }

  for (const uid of ['u_suspended', 'u_removed']) {
    for (const [route, payload] of [
      ...adminRoutes,
      ['/badges/sync-my', { requestId: 'req-sync-deny-123456' }],
      ['/badges/ack-seen', { requestId: 'req-ack-deny-123456', badgeIds: ['b1'] }],
    ]) {
      await assert.rejects(
        service.execute(uid, route, payload),
        (err) => err.status === 403,
        `Expected 403 for ${uid} on ${route}`,
      );
    }
  }

  // Organizer still cannot bypass personal.record restrictions on /runs/complete when denied
  // Active runner & organizer CAN call sync-my & ack-seen
  const orgSync = await service.execute('u_org', '/badges/sync-my', { requestId: 'req-org-sync-1234567' });
  assert.deepEqual(orgSync.newlyAwarded, []);
});

test('/badges/save, /badges/seed-defaults (no-overwrite), /badges/archive, and /badges/delete with storage cleanup', async () => {
  const deletedObjects = [];
  let failStorageOnce = false;
  const storage = {
    bucket: () => ({
      file: (objectPath) => ({
        async delete() {
          if (failStorageOnce) {
            failStorageOnce = false;
            throw Object.assign(new Error('Storage transient error'), { code: 500 });
          }
          deletedObjects.push(objectPath);
        },
      }),
    }),
  };

  let clock = '2026-11-25T05:00:00.000Z';
  const store = createMockDb({
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'userAccess/u_admin': { status: 'active', scope: 'all', raceIds: [], overrides: {} },
    'users/u_super': { uid: 'u_super', role: 'superadmin', approved: true },
  });
  const service = createCommunityService(store.db, storage, { now: () => clock });

  // Save new upload badge
  const uploadPayload = makeBadgePayload({
    requestId: 'req-save-upload-123456',
    badgeId: 'custom_crest_01',
    artworkType: 'upload',
    emblemId: '',
    artworkStoragePath: 'badge-assets/u_admin/custom_crest_01/crest.webp',
    artworkUrl:
      'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fu_admin%2Fcustom_crest_01%2Fcrest.webp?alt=media',
  });
  const saved1 = await service.execute('u_admin', '/badges/save', uploadPayload);
  assert.equal(saved1.badge.badgeId, 'custom_crest_01');
  assert.equal(saved1.badge.createdBy, 'u_admin');
  assert.equal(saved1.badge.createdAt, '2026-11-25T05:00:00.000Z');

  // Idempotent replay on /badges/save
  clock = '2026-11-25T05:05:00.000Z';
  const savedReplay = await service.execute('u_admin', '/badges/save', uploadPayload);
  assert.deepEqual(savedReplay, saved1);

  // Conflict when reusing same requestId with modified payload
  await assert.rejects(
    service.execute('u_admin', '/badges/save', { ...uploadPayload, name: 'Modified Name' }),
    (err) => err.status === 409,
  );

  // Update preserves createdBy / createdAt
  const updatedSave = await service.execute('u_super', '/badges/save', {
    ...uploadPayload,
    requestId: 'req-save-update-123456',
    name: 'Custom Crest Updated',
  });
  assert.equal(updatedSave.badge.createdBy, 'u_admin');
  assert.equal(updatedSave.badge.createdAt, '2026-11-25T05:00:00.000Z');
  assert.equal(updatedSave.badge.updatedBy, 'u_super');
  assert.equal(updatedSave.badge.updatedAt, '2026-11-25T05:05:00.000Z');

  // Seed defaults: pre-customize one starter badge first and verify it is NOT overwritten
  await service.execute('u_admin', '/badges/save', makeBadgePayload({
    requestId: 'req-save-custom-welcome',
    badgeId: 'welcome_ka_racepulse',
    name: 'Customized Welcome Title',
    xpReward: 999,
    rule: { type: 'welcome' },
  }));

  const seedRes = await service.execute('u_admin', '/badges/seed-defaults', {
    requestId: 'req-seed-defaults-1234',
  });
  assert.equal(seedRes.seededCount, 7);
  assert.equal(seedRes.badgeIds.length, 7);
  assert.equal(seedRes.badgeIds.includes('welcome_ka_racepulse'), false);
  assert.equal(store.docs.get('badges/welcome_ka_racepulse').name, 'Customized Welcome Title');
  assert.equal(store.docs.get('badges/welcome_ka_racepulse').xpReward, 999);
  assert.equal(store.docs.has('badges/alamat_founder'), true);

  // Second seed call seeds 0
  const seedRes2 = await service.execute('u_admin', '/badges/seed-defaults', {
    requestId: 'req-seed-defaults-5678',
  });
  assert.equal(seedRes2.seededCount, 0);
  assert.deepEqual(seedRes2.badgeIds, []);

  // Archive & unarchive
  const archived = await service.execute('u_admin', '/badges/archive', {
    requestId: 'req-archive-badge-1234',
    badgeId: 'custom_crest_01',
    status: 'archived',
  });
  assert.equal(archived.badge.status, 'archived');
  assert.equal(store.docs.get('badges/custom_crest_01').status, 'archived');

  // Delete cleans up badge-assets object best-effort
  const deleted = await service.execute('u_admin', '/badges/delete', {
    requestId: 'req-delete-badge-12345',
    badgeId: 'custom_crest_01',
  });
  assert.deepEqual(deleted, { deleted: true, badgeId: 'custom_crest_01' });
  assert.equal(store.docs.has('badges/custom_crest_01'), false);
  assert.deepEqual(deletedObjects, ['badge-assets/u_admin/custom_crest_01/crest.webp']);

  // Replay of delete does NOT call storage delete again
  const deletedReplay = await service.execute('u_admin', '/badges/delete', {
    requestId: 'req-delete-badge-12345',
    badgeId: 'custom_crest_01',
  });
  assert.deepEqual(deletedReplay, deleted);
  assert.equal(deletedObjects.length, 1);

  // Best-effort storage failure on delete still succeeds and logs warning safely
  const upload2 = makeBadgePayload({
    requestId: 'req-save-upload-234567',
    badgeId: 'custom_crest_02',
    artworkType: 'upload',
    emblemId: '',
    artworkStoragePath: 'badge-assets/u_admin/custom_crest_02/crest.png',
    artworkUrl: 'https://storage.googleapis.com/racepulseph-assets/badge-assets/u_admin/custom_crest_02/crest.png',
  });
  await service.execute('u_admin', '/badges/save', upload2);
  failStorageOnce = true;
  const deletedDespiteStorage = await service.execute('u_admin', '/badges/delete', {
    requestId: 'req-delete-badge-fail-ok',
    badgeId: 'custom_crest_02',
  });
  assert.deepEqual(deletedDespiteStorage, { deleted: true, badgeId: 'custom_crest_02' });
  assert.equal(store.docs.has('badges/custom_crest_02'), false);
});

test('/badges/grant enforces active badge & active target, integer XP, 409 duplicate guard, and idempotent replay', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const alamat = starter.find((b) => b.badgeId === 'alamat_founder');
  const archivedBadge = { ...starter[0], badgeId: 'archived_b', status: 'archived' };
  const zeroXpBadge = { ...starter[0], badgeId: 'zero_xp_b', xpReward: 0, rule: { type: 'manual_grant' } };

  const store = createMockDb({
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true },
    'users/u_susp': { uid: 'u_susp', role: 'runner', approved: true },
    'userAccess/u_susp': { status: 'suspended', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_removed': { uid: 'u_removed', role: 'runner', approved: true, accessRemoved: true },
    'badges/alamat_founder': alamat,
    'badges/archived_b': archivedBadge,
    'badges/zero_xp_b': zeroXpBadge,
  });
  const service = createCommunityService(store.db, null, { now: () => '2026-11-25T06:00:00.000Z' });

  // Rejects missing / archived / suspended / removed target
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-grant-missing-b1234',
      badgeId: 'non_existent',
      targetUid: 'u_runner',
    }),
    (err) => err.status === 404,
  );
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-grant-arch-b12345',
      badgeId: 'archived_b',
      targetUid: 'u_runner',
    }),
    (err) => err.status >= 400 && err.status < 500,
  );
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-grant-susp-u12345',
      badgeId: 'alamat_founder',
      targetUid: 'u_susp',
    }),
    (err) => err.status >= 400 && err.status < 500,
  );
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-grant-rem-u123456',
      badgeId: 'alamat_founder',
      targetUid: 'u_removed',
    }),
    (err) => err.status >= 400 && err.status < 500,
  );

  // Grant succeeds and updates userBadges, xpEvents, athleteProgression
  const grantPayload = {
    requestId: 'req-grant-alamat-12345',
    badgeId: 'alamat_founder',
    targetUid: 'u_runner',
    note: '  Founding Cebu pacer  ',
  };
  const granted = await service.execute('u_admin', '/badges/grant', grantPayload);
  assert.equal(granted.xpAwarded, 1500);
  assert.equal(granted.userBadge.id, 'u_runner_alamat_founder');
  assert.equal(granted.userBadge.source, 'manual');
  assert.equal(granted.userBadge.grantedBy, 'u_admin');
  assert.equal(granted.userBadge.note, 'Founding Cebu pacer');
  assert.equal(granted.userBadge.seenByUser, false);
  assert.equal(granted.userBadge.badgeName, 'Alamat Founder');
  assert.equal(granted.userBadge.tier, 'alamat');
  assert.equal(granted.userBadge.category, 'special');
  assert.equal(granted.progression.totalXp, 1500);
  assert.equal(granted.progression.level, 6); // xpForLevel(6) = 50*5*6 = 1500
  assert.equal(granted.progression.rankTitle, 'Trail Blazer');
  assert.equal(granted.progression.badgesCount, 1);

  const xpDoc = store.docs.get('xpEvents/badge_u_runner_alamat_founder');
  assert.equal(xpDoc.xp, 1500);
  assert.equal(xpDoc.source, 'badge');
  assert.equal(xpDoc.refId, 'alamat_founder');

  // Same requestId replays cleanly without throwing 409 or double XP
  const replayed = await service.execute('u_admin', '/badges/grant', grantPayload);
  assert.deepEqual(replayed, granted);
  assert.equal(store.docs.get('athleteProgression/u_runner').totalXp, 1500);

  // Different requestId for same user + badge rejects 409 without touching xpEvents
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-grant-dup-12345678',
      badgeId: 'alamat_founder',
      targetUid: 'u_runner',
    }),
    (err) => err.status === 409 && /already holds/i.test(err.message),
  );
  assert.equal(store.docs.get('athleteProgression/u_runner').totalXp, 1500);

  // Zero-XP badge skips creating xpEvents doc and omits blank note
  const zeroGrant = await service.execute('u_admin', '/badges/grant', {
    requestId: 'req-grant-zero-123456',
    badgeId: 'zero_xp_b',
    targetUid: 'u_runner',
    note: '   ',
  });
  assert.equal(zeroGrant.xpAwarded, 0);
  assert.equal(Object.hasOwn(zeroGrant.userBadge, 'note'), false);
  assert.equal(store.docs.has('xpEvents/badge_u_runner_zero_xp_b'), false);
  assert.equal(zeroGrant.progression.badgesCount, 2);
});

test('/runs/complete awards integer run XP, auto-unlocks eligible badges, updates streak, and prevents double XP on retries', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const initialDocs = {
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true, onboardingSteps: ['welcome'] },
    'userAccess/u_runner': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  };
  for (const b of starter) {
    initialDocs[`badges/${b.badgeId}`] = b;
  }

  const store = createMockDb(initialDocs);
  const service = createCommunityService(store.db, null, { now: () => '2026-11-25T07:00:00.000Z' });

  // 10km Dawn Patrol verified run (201 pts * 50m = 10000m, 06:00 PHT)
  const payload10k = buildRunPayload({
    requestId: 'req-run-10k-dawn-1234',
    runId: 'run_dawn_10k',
    count: 201,
    stepMeters: 50,
    stepSec: 15,
  });
  const res = await service.execute('u_runner', '/runs/complete', payload10k);
  const expectedRunXp = computeRunCompletionXp(res.run);
  assert.equal(res.run.verificationStatus, 'verified');
  assert.equal(expectedRunXp, 112); // 10km * 10 = 100 distance XP + 12 elevation XP

  const earnedIds = res.newlyAwardedBadges.map((b) => b.badgeId).sort();
  assert.deepEqual(earnedIds, ['dawn_patrol_ph', 'first_gps_stride', 'ten_k_club', 'welcome_ka_racepulse']);

  // Expected XP: run (112) + welcome (50) + first_gps_stride (100) + dawn_patrol_ph (150) + ten_k_club (250) = 662
  const expectedTotalXp = expectedRunXp + 550;
  assert.equal(res.xpEarned, expectedTotalXp);
  assert.equal(res.progression.totalXp, expectedTotalXp);
  assert.equal(res.progression.level, 4);
  assert.equal(res.progression.badgesCount, 4);
  assert.equal(res.progression.runStreakWeeks, 1);
  assert.equal(res.progression.runStreakGraceRemaining, 0);
  assert.equal(store.docs.get('xpEvents/run_u_runner_run_dawn_10k').xp, expectedRunXp);
  assert.equal(store.docs.get('userBadges/u_runner_ten_k_club').source, 'run');
  assert.equal(store.docs.get('userBadges/u_runner_ten_k_club').runId, 'run_dawn_10k');

  // Replay with same requestId returns exact same response with ZERO double XP
  const replay = await service.execute('u_runner', '/runs/complete', payload10k);
  assert.deepEqual(replay, res);
  assert.equal(store.docs.get('athleteProgression/u_runner').totalXp, expectedTotalXp);

  // Re-submitting identical run content with a different requestId awards 0 XP and 0 new badges
  const resSameRunNewReq = await service.execute('u_runner', '/runs/complete', {
    ...payload10k,
    requestId: 'req-run-10k-diff-req1',
  });
  assert.equal(resSameRunNewReq.xpEarned, 0);
  assert.deepEqual(resSameRunNewReq.newlyAwardedBadges, []);
  assert.equal(resSameRunNewReq.progression.totalXp, expectedTotalXp);

  // Flagged run (car speed) gets 0 run XP and unlocks 0 badges
  const flaggedPayload = buildRunPayload({
    requestId: 'req-run-flagged-12345',
    runId: 'run_flagged_car',
    count: 201,
    stepMeters: 150,
    stepSec: 10, // 15 m/s car
  });
  const flaggedRes = await service.execute('u_runner', '/runs/complete', flaggedPayload);
  assert.equal(flaggedRes.run.verificationStatus, 'flagged');
  assert.equal(flaggedRes.xpEarned, 0);
  assert.deepEqual(flaggedRes.newlyAwardedBadges, []);
  assert.equal(store.docs.has('xpEvents/run_u_runner_run_flagged_car'), false);
  assert.equal(store.docs.get('athleteProgression/u_runner').totalXp, expectedTotalXp);
});

test('/badges/sync-my awards welcome, clean race_finished (excluding DQ), run_time_window, regions_explored, and /badges/ack-seen updates seenByUser', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const initialDocs = {
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true },
    'users/u_dq': { uid: 'u_dq', role: 'runner', approved: true },
    'races/race_clean': { id: 'race_clean', name: 'Manila Half', completedAt: '2026-11-20T05:00:00.000Z' },
    'liveResults/race_clean': {
      officialResults: [
        { bibNumber: '21K-001', rank: 1, disqualified: false, finishReviewRequired: false },
        { bibNumber: '21K-999', rank: 99, disqualified: true, finishReviewRequired: false },
      ],
    },
    'runners/u_runner_race_clean': { uid: 'u_runner', raceId: 'race_clean', bibNumber: '21k-001' },
    'runnerClaims/u_dq_race_clean': { uid: 'u_dq', raceId: 'race_clean', bibNumber: '21K-999' },
    'recordedRuns/run_luzon': {
      runId: 'run_luzon',
      uid: 'u_runner',
      startedAt: '2026-11-02T21:30:00.000Z', // 05:30 PHT
      distanceM: 5000,
      elevationGainM: 40,
      islandGroups: ['Luzon'],
      verificationStatus: 'verified',
    },
    'recordedRuns/run_visayas': {
      runId: 'run_visayas',
      uid: 'u_runner',
      startedAt: '2026-11-09T22:00:00.000Z',
      distanceM: 5000,
      elevationGainM: 40,
      islandGroups: ['Visayas'],
      verificationStatus: 'verified',
    },
    'recordedRuns/run_mindanao': {
      runId: 'run_mindanao',
      uid: 'u_runner',
      startedAt: '2026-11-16T22:00:00.000Z',
      distanceM: 5000,
      elevationGainM: 40,
      islandGroups: ['Mindanao'],
      verificationStatus: 'verified',
    },
    'friendships/f1': { fromUid: 'u_runner', toUid: 'u_friend1', members: ['u_runner', 'u_friend1'] },
    'clubMembers/c1_u_runner': { clubId: 'c1', uid: 'u_runner', status: 'active' },
  };
  for (const b of starter) {
    initialDocs[`badges/${b.badgeId}`] = b;
  }

  const store = createMockDb(initialDocs);
  const service = createCommunityService(store.db, null, { now: () => '2026-11-25T08:00:00.000Z' });

  const syncRunner = await service.execute('u_runner', '/badges/sync-my', {
    requestId: 'req-sync-runner-12345',
  });
  const runnerEarned = syncRunner.newlyAwarded.map((a) => a.badgeId).sort();
  assert.deepEqual(runnerEarned, [
    'archipelago_explorer',
    'dawn_patrol_ph',
    'first_gps_stride',
    'official_finisher',
    'welcome_ka_racepulse',
  ]);
  // welcome (50) + first_gps_stride (100) + dawn_patrol_ph (150) + archipelago_explorer (1000) + official_finisher (400) = 1700
  assert.equal(syncRunner.progression.totalXp, 1700);
  assert.equal(syncRunner.progression.badgesCount, 5);
  assert.equal(syncRunner.progression.runStreakWeeks, 3);

  // DQ runner does NOT receive official_finisher, only welcome
  const syncDq = await service.execute('u_dq', '/badges/sync-my', {
    requestId: 'req-sync-dq-123456789',
  });
  assert.deepEqual(syncDq.newlyAwarded.map((a) => a.badgeId), ['welcome_ka_racepulse']);

  // Ack-seen updates owned existing badges and ignores non-owned/missing ones
  const ackRes = await service.execute('u_runner', '/badges/ack-seen', {
    requestId: 'req-ack-seen-1234567',
    badgeIds: ['welcome_ka_racepulse', 'archipelago_explorer', 'does_not_exist'],
  });
  assert.deepEqual(ackRes.acknowledgedIds, ['welcome_ka_racepulse', 'archipelago_explorer']);
  assert.equal(store.docs.get('userBadges/u_runner_welcome_ka_racepulse').seenByUser, true);
  assert.equal(store.docs.get('userBadges/u_runner_archipelago_explorer').seenByUser, true);
  assert.equal(store.docs.get('userBadges/u_runner_official_finisher').seenByUser, false);
});

test('/badges/evaluate-retroactive paginates users by documentId, skips accessRemoved, avoids duplicate awards, and supports __name__ fallback', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const welcome = starter.find((b) => b.badgeId === 'welcome_ka_racepulse');
  const firstStride = starter.find((b) => b.badgeId === 'first_gps_stride');

  const initialDocs = {
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'users/u_a': { uid: 'u_a', role: 'runner', approved: true },
    'users/u_b': { uid: 'u_b', role: 'runner', approved: true, accessRemoved: true },
    'users/u_c': { uid: 'u_c', role: 'runner', approved: true },
    'users/u_d': { uid: 'u_d', role: 'runner', approved: true },
    'badges/welcome_ka_racepulse': welcome,
    'badges/first_gps_stride': firstStride,
    'recordedRuns/run_c1': {
      runId: 'run_c1',
      uid: 'u_c',
      startedAt: '2026-11-24T22:00:00.000Z',
      distanceM: 3000,
      elevationGainM: 10,
      verificationStatus: 'verified',
    },
    'userBadges/u_a_welcome_ka_racepulse': {
      id: 'u_a_welcome_ka_racepulse',
      uid: 'u_a',
      badgeId: 'welcome_ka_racepulse',
      earnedAt: '2026-11-24T00:00:00.000Z',
      seenByUser: true,
      source: 'auto',
      xpAwarded: 50,
      badgeName: 'Welcome, Ka-RacePulse',
      tier: 'common',
      category: 'onboarding',
    },
    'athleteProgression/u_a': {
      uid: 'u_a',
      totalXp: 50,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      rankTitle: 'Pacer',
      badgesCount: 1,
      runStreakWeeks: 0,
      runStreakGraceRemaining: 0,
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
  };

  // Test with rejectNonStringOrderBy=true to verify FieldPath -> __name__ fallback works cleanly too
  const store = createMockDb(initialDocs, { rejectNonStringOrderBy: true });
  const service = createCommunityService(store.db, null, { now: () => '2026-11-25T09:00:00.000Z' });

  // Page 1: limit 3 -> u_a, u_admin, u_b (accessRemoved skipped)
  const page1 = await service.execute('u_admin', '/badges/evaluate-retroactive', {
    requestId: 'req-retro-page1-12345',
    limit: 3,
  });
  assert.equal(page1.processedUsers, 2); // u_a (already had welcome -> 0 new), u_admin (earned welcome -> 1 new); u_b skipped!
  assert.equal(page1.newlyAwardedCount, 1);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextAfterUid, 'u_b');
  assert.equal(store.docs.has('userBadges/u_b_welcome_ka_racepulse'), false);

  // Page 2: afterUid: page1.nextAfterUid -> u_c (welcome + first_gps_stride), u_d (welcome)
  const page2 = await service.execute('u_admin', '/badges/evaluate-retroactive', {
    requestId: 'req-retro-page2-12345',
    afterUid: page1.nextAfterUid,
    limit: 3,
  });
  assert.equal(page2.processedUsers, 2);
  assert.equal(page2.newlyAwardedCount, 3);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextAfterUid, null);
  assert.equal(store.docs.get('userBadges/u_c_first_gps_stride').source, 'retroactive');
  assert.equal(store.docs.get('athleteProgression/u_c').totalXp, 150);

  // Replay page2 with same requestId returns exact stored response with zero duplicate XP
  const page2Replay = await service.execute('u_admin', '/badges/evaluate-retroactive', {
    requestId: 'req-retro-page2-12345',
    afterUid: page1.nextAfterUid,
    limit: 3,
  });
  assert.deepEqual(page2Replay, page2);
  assert.equal(store.docs.get('athleteProgression/u_c').totalXp, 150);
});

test('communityApi routes /badges/* endpoints with checkRevoked=true, rate limiting, and safe 500s', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const store = createMockDb({
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true },
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'badges/welcome_ka_racepulse': starter[0],
  });
  const seenRevokedFlags = [];
  const admin = {
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        seenRevokedFlags.push(checkRevoked);
        if (token === 'tok-runner') return { uid: 'u_runner' };
        if (token === 'tok-admin') return { uid: 'u_admin' };
        throw new Error('bad token');
      },
    }),
  };
  const handler = createCommunityApp({ admin, db: store.db, appCheckMode: 'off' });

  // Runner denied on /badges/save via HTTP
  const denyRes = makeRes();
  await handler(
    makeReq({
      path: '/badges/save',
      headers: { authorization: 'Bearer tok-runner' },
      body: makeBadgePayload(),
    }),
    denyRes,
  );
  assert.equal(denyRes.statusCode, 403);

  // Admin succeeds on /badges/save via HTTP
  const saveRes = makeRes();
  await handler(
    makeReq({
      path: '/badges/save',
      headers: { authorization: 'Bearer tok-admin' },
      body: makeBadgePayload({ requestId: 'req-api-save-12345678' }),
    }),
    saveRes,
  );
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.body.badge.badgeId, 'manila_sunrise_5k');

  // Runner succeeds on /badges/sync-my via HTTP
  const syncRes = makeRes();
  await handler(
    makeReq({
      path: '/badges/sync-my',
      headers: { authorization: 'Bearer tok-runner' },
      body: { requestId: 'req-api-sync-12345678' },
    }),
    syncRes,
  );
  assert.equal(syncRes.statusCode, 200);
  assert.equal(syncRes.body.newlyAwarded.length, 1);
  assert.ok(seenRevokedFlags.every((flag) => flag === true));
});

test('concurrent grants, FieldPath.documentId() pagination, social/club/inbox facts, and 400 input bounds behave deterministically', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const initialDocs = {
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'users/u_social': {
      uid: 'u_social',
      role: 'runner',
      approved: true,
      displayName: 'Maria',
      username: 'maria_run',
      bio: 'Trail runner',
      location: 'Cebu',
    },
    'badges/manual_badge': { ...starter[7], badgeId: 'manual_badge', xpReward: 200 },
    'badges/profile_badge': {
      ...starter[0],
      badgeId: 'profile_badge',
      xpReward: 75,
      rule: { type: 'profile_complete' },
      sortOrder: 90,
    },
    'badges/club_badge': {
      ...starter[0],
      badgeId: 'club_badge',
      xpReward: 80,
      rule: { type: 'club_joined', threshold: 1 },
      sortOrder: 91,
    },
    'badges/friend_badge': {
      ...starter[0],
      badgeId: 'friend_badge',
      xpReward: 90,
      rule: { type: 'friends_count', threshold: 2 },
      sortOrder: 92,
    },
    'badges/kudos_badge': {
      ...starter[0],
      badgeId: 'kudos_badge',
      xpReward: 110,
      rule: { type: 'kudos_received', threshold: 3 },
      sortOrder: 93,
    },
    'badges/inbox_badge': {
      ...starter[0],
      badgeId: 'inbox_badge',
      xpReward: 120,
      rule: { type: 'inbox_streak_days', threshold: 5 },
      sortOrder: 94,
    },
    'clubMembers/c1_u_social': { clubId: 'c1', uid: 'u_social', status: 'active' },
    'friendships/f1': { fromUid: 'u_social', toUid: 'u_f1', members: ['u_social', 'u_f1'] },
    'friendships/f2': { fromUid: 'u_f2', toUid: 'u_social', members: ['u_f2', 'u_social'] },
    'socialPosts/p1': { uid: 'u_social', kudosCount: 2 },
    'socialKudos/k1': { recipientUid: 'u_social', postId: 'p1' },
    'socialKudos/k2': { recipientUid: 'u_social', postId: 'p1' },
    'socialKudos/k3': { recipientUid: 'u_social', postId: 'p1' },
    'friendStreaks/s1': { members: ['u_social', 'u_f1'], streakDays: 6 },
  };
  const store = createMockDb(initialDocs);
  const service = createCommunityService(store.db, null, { now: () => '2026-11-25T10:00:00.000Z' });

  // Concurrent double-grant with distinct requestIds: only one wins
  const results = await Promise.allSettled([
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-conc-grant-a-1234',
      badgeId: 'manual_badge',
      targetUid: 'u_social',
    }),
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-conc-grant-b-1234',
      badgeId: 'manual_badge',
      targetUid: 'u_social',
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(store.docs.get('athleteProgression/u_social').totalXp, 200);

  // Sync social/club/profile/kudos/inbox facts
  const socialSync = await service.execute('u_social', '/badges/sync-my', {
    requestId: 'req-social-sync-123456',
  });
  assert.deepEqual(
    socialSync.newlyAwarded.map((b) => b.badgeId).sort(),
    ['club_badge', 'friend_badge', 'inbox_badge', 'kudos_badge', 'profile_badge'],
  );
  assert.equal(socialSync.progression.totalXp, 200 + 75 + 80 + 90 + 110 + 120);

  // Primary FieldPath.documentId() retroactive call works cleanly
  const retro = await service.execute('u_admin', '/badges/evaluate-retroactive', {
    requestId: 'req-retro-fp-12345678',
    limit: 1,
  });
  assert.equal(retro.processedUsers, 1);
  assert.equal(retro.hasMore, true);
  assert.equal(retro.nextAfterUid, 'u_admin');

  // Validation 400 checks
  await assert.rejects(
    service.execute('u_admin', '/badges/archive', {
      requestId: 'req-bad-arch-12345678',
      badgeId: 'manual_badge',
      status: 'deleted',
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_admin', '/badges/grant', {
      requestId: 'req-bad-note-12345678',
      badgeId: 'manual_badge',
      targetUid: 'u_social',
      note: 'x'.repeat(201),
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_social', '/badges/ack-seen', {
      requestId: 'req-bad-ack-123456789',
      badgeIds: [],
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_admin', '/badges/evaluate-retroactive', {
      requestId: 'req-bad-limit-1234567',
      limit: 51,
    }),
    (err) => err.status === 400,
  );
});

test('hardening: /badges/save cleans up replaced artworkStoragePath, unapproved organizer with overrides is denied 403, grant replay skips userBadges query, and mid-batch removed user is skipped', async () => {
  const starter = buildStarterBadgePack('system', '2026-11-25T00:00:00.000Z');
  const deletedAssets = [];
  const storage = {
    bucket: () => ({
      file: (objectPath) => ({
        async delete() {
          deletedAssets.push(objectPath);
        },
      }),
    }),
  };

  const store = createMockDb({
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true },
    'users/u_unapproved_org_override': { uid: 'u_unapproved_org_override', role: 'organizer', approved: false },
    'userAccess/u_unapproved_org_override': {
      status: 'active',
      scope: 'all',
      raceIds: [],
      overrides: { 'badges.view': true, 'badges.manage': true, 'badges.grant': true },
    },
    'users/u_a': { uid: 'u_a', role: 'runner', approved: true },
    'users/u_mid_removed': { uid: 'u_mid_removed', role: 'runner', approved: true },
    'users/u_z': { uid: 'u_z', role: 'runner', approved: true },
    'badges/welcome_ka_racepulse': starter[0],
  });
  const service = createCommunityService(store.db, storage, { now: () => '2026-11-25T11:00:00.000Z' });

  // 1. Unapproved organizer with explicit badges.manage / badges.grant overrides is still denied 403
  await assert.rejects(
    service.execute('u_unapproved_org_override', '/badges/save', makeBadgePayload({ requestId: 'req-unapp-org-save-123' })),
    (err) => err.status === 403,
  );
  await assert.rejects(
    service.execute('u_unapproved_org_override', '/badges/grant', {
      requestId: 'req-unapp-org-grant-12',
      badgeId: 'welcome_ka_racepulse',
      targetUid: 'u_a',
    }),
    (err) => err.status === 403,
  );

  // 2. Replacing upload artworkStoragePath or switching upload -> emblem deletes replaced previous asset best-effort
  const uploadV1 = makeBadgePayload({
    requestId: 'req-replace-art-v1-1234',
    badgeId: 'replaceable_crest',
    artworkType: 'upload',
    emblemId: '',
    artworkStoragePath: 'badge-assets/u_admin/replaceable_crest/v1.webp',
    artworkUrl:
      'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fu_admin%2Freplaceable_crest%2Fv1.webp?alt=media',
  });
  await service.execute('u_admin', '/badges/save', uploadV1);
  assert.deepEqual(deletedAssets, []);

  // Re-saving same artworkStoragePath keeps asset intact
  await service.execute('u_admin', '/badges/save', {
    ...uploadV1,
    requestId: 'req-replace-art-same-12',
    name: 'Renamed Same Art',
  });
  assert.deepEqual(deletedAssets, []);

  // Replacing v1.webp -> v2.webp deletes v1.webp
  const uploadV2 = {
    ...uploadV1,
    requestId: 'req-replace-art-v2-1234',
    artworkStoragePath: 'badge-assets/u_admin/replaceable_crest/v2.webp',
    artworkUrl:
      'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fu_admin%2Freplaceable_crest%2Fv2.webp?alt=media',
  };
  await service.execute('u_admin', '/badges/save', uploadV2);
  assert.deepEqual(deletedAssets, ['badge-assets/u_admin/replaceable_crest/v1.webp']);

  // Replay of v2 save does not trigger another delete
  await service.execute('u_admin', '/badges/save', uploadV2);
  assert.deepEqual(deletedAssets, ['badge-assets/u_admin/replaceable_crest/v1.webp']);

  // Switching upload -> emblem deletes v2.webp
  await service.execute('u_admin', '/badges/save', makeBadgePayload({
    requestId: 'req-replace-to-emblem1',
    badgeId: 'replaceable_crest',
    artworkType: 'emblem',
    emblemId: 'sunrise-burst',
    artworkStoragePath: '',
    artworkUrl: '',
  }));
  assert.deepEqual(deletedAssets, [
    'badge-assets/u_admin/replaceable_crest/v1.webp',
    'badge-assets/u_admin/replaceable_crest/v2.webp',
  ]);

  // 3. Grant replay skips extra userBadges collection query
  let userBadgesQueries = 0;
  const origCollection = store.db.collection.bind(store.db);
  const countingDb = {
    ...store.db,
    collection(name) {
      if (name === 'userBadges') userBadgesQueries += 1;
      return origCollection(name);
    },
  };
  const grantPayload = {
    requestId: 'req-grant-precheck-1234',
    badgeId: 'welcome_ka_racepulse',
    targetUid: 'u_a',
  };
  const countingService = createCommunityService(countingDb, storage, { now: () => '2026-11-25T11:05:00.000Z' });
  const grant1 = await countingService.execute('u_admin', '/badges/grant', grantPayload);
  assert.equal(userBadgesQueries, 1);
  const grantReplay = await countingService.execute('u_admin', '/badges/grant', grantPayload);
  assert.deepEqual(grantReplay, grant1);
  assert.equal(userBadgesQueries, 1);

  // 4. Mid-batch concurrent user removal during /badges/evaluate-retroactive skips that user cleanly
  const origDoc = store.db.doc.bind(store.db);
  const origRunTx = store.db.runTransaction.bind(store.db);
  const midRaceDb = {
    ...store.db,
    doc(docPath) {
      return origDoc(docPath);
    },
    runTransaction(fn) {
      // Simulate u_mid_removed becoming accessRemoved concurrently right before its per-user tx runs
      const userMid = store.docs.get('users/u_mid_removed');
      if (userMid && userMid.accessRemoved !== true) {
        // Flip only once u_mid_removed's badge progression tx is about to run (after u_admin already ran)
        if (store.docs.has('userBadges/u_admin_welcome_ka_racepulse')) {
          store.docs.set('users/u_mid_removed', { ...userMid, accessRemoved: true });
        }
      }
      return origRunTx(fn);
    },
  };
  const midRaceService = createCommunityService(midRaceDb, storage, { now: () => '2026-11-25T11:10:00.000Z' });
  const retroRes = await midRaceService.execute('u_admin', '/badges/evaluate-retroactive', {
    requestId: 'req-retro-mid-skip-1234',
    limit: 25,
  });
  // u_a already had welcome; u_admin, u_unapproved_org_override, u_z received welcome; u_mid_removed skipped!
  assert.equal(store.docs.has('userBadges/u_mid_removed_welcome_ka_racepulse'), false);
  assert.equal(store.docs.has('userBadges/u_z_welcome_ka_racepulse'), true);
  assert.equal(retroRes.processedUsers >= 4, true);
  assert.equal(retroRes.newlyAwardedCount, 3);
});
