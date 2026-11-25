'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createCommunityService } = require('../functions/community-service');

function createMockDb(initialDocs = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let txLock = Promise.resolve();

  const makeSnap = (docPath, data) => ({
    exists: data !== undefined && data !== null,
    id: docPath.split('/').pop(),
    ref: {
      path: docPath,
      id: docPath.split('/').pop(),
      collection: (sub) => db.collection(`${docPath}/${sub}`),
    },
    data: () => (data !== undefined && data !== null ? structuredClone(data) : undefined),
  });

  function resolveFieldName(field) {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object' && typeof field.formattedName === 'string') {
      return field.formattedName;
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
        collection(sub) {
          return db.collection(`${docPath}/${sub}`);
        },
        async get() {
          return makeSnap(docPath, docs.get(docPath));
        },
      };
    },
    collection(collectionPath) {
      const filters = [];
      const orderSpecs = [];
      let startAfterCursor = undefined;
      let limitCount = null;

      const queryApi = {
        where(field, op, value) {
          filters.push({ field: resolveFieldName(field), op, value });
          return queryApi;
        },
        orderBy(field, direction = 'asc') {
          orderSpecs.push({
            field: resolveFieldName(field),
            direction: String(direction).toLowerCase(),
          });
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
          const prefix = `${collectionPath}/`;
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
              } else if (f.op === '!=') {
                if (val === f.value) {
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

          if (orderSpecs.length > 0) {
            matched.sort((a, b) => {
              for (const spec of orderSpecs) {
                const dir = spec.direction === 'desc' ? -1 : 1;
                const va = getFieldValue(a.id, a.data, spec.field);
                const vb = getFieldValue(b.id, b.data, spec.field);
                if (va === vb) continue;
                if (va === undefined || va === null) return -1 * dir;
                if (vb === undefined || vb === null) return 1 * dir;
                return (va < vb ? -1 : 1) * dir;
              }
              return a.id.localeCompare(b.id);
            });
          }

          if (startAfterCursor !== undefined && orderSpecs.length > 0) {
            const spec = orderSpecs[0];
            matched = matched.filter((entry) => {
              const val = getFieldValue(entry.id, entry.data, spec.field);
              return spec.direction === 'desc'
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
    batch() {
      const ops = [];
      return {
        delete: (ref) => ops.push(() => docs.delete(ref.path)),
        set: (ref, data, opts) =>
          ops.push(() => {
            if (opts && opts.merge && docs.has(ref.path)) {
              docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) });
            } else {
              docs.set(ref.path, structuredClone(data));
            }
          }),
        update: (ref, patch) =>
          ops.push(() => {
            if (!docs.has(ref.path)) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(patch) });
          }),
        commit: async () => ops.forEach((o) => o()),
      };
    },
    runTransaction(fn) {
      const exec = async () => {
        const stagedCreate = new Set();
        const stagedDelete = new Set();
        const staged = new Map();
        let hasWritten = false;
        const tx = {
          async get(ref) {
            if (hasWritten) {
              throw new Error('Firestore transactions require all reads before all writes.');
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
        for (const k of stagedDelete) docs.delete(k);
        for (const [k, v] of staged.entries()) docs.set(k, v);
        return result;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };

  return { db, docs };
}

function createMockStorage() {
  const deletedFiles = [];
  const deletedPrefixes = [];
  return {
    deletedFiles,
    deletedPrefixes,
    bucket() {
      return {
        file(storagePath) {
          return {
            async delete() {
              deletedFiles.push(storagePath);
            },
          };
        },
        async deleteFiles({ prefix }) {
          deletedPrefixes.push(prefix);
        },
      };
    },
  };
}

function baseUsers() {
  return {
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true, displayName: 'Admin One', email: 'admin@example.com' },
    'userAccess/u_admin': { status: 'active', scope: 'all', raceIds: [], overrides: {} },
    'users/u_org': { uid: 'u_org', role: 'organizer', approved: true, displayName: 'Org One', email: 'org@example.com' },
    'userAccess/u_org': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_captain': { uid: 'u_captain', role: 'runner', approved: true, displayName: 'Cap Rey', username: 'caprey', email: 'cap@example.com' },
    'userAccess/u_captain': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true, displayName: 'Ana Santos', username: 'ana.run', email: 'ana@example.com' },
    'userAccess/u_runner': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_runner2': { uid: 'u_runner2', role: 'runner', approved: true, displayName: 'Ben Cruz', username: 'ben.cruz', email: 'ben@example.com' },
    'userAccess/u_runner2': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  };
}

test('admin saves club, delegates captain, provisions club chat, enforces RBAC and idempotency', async () => {
  const store = createMockDb(baseUsers());
  const storage = createMockStorage();
  const service = createCommunityService(store.db, storage, { now: () => '2026-11-25T10:00:00.000Z' });

  const clubPayload = {
    requestId: 'req-club-save-0001',
    clubId: 'manila_pacers',
    name: 'Manila Pacers',
    description: 'Roxas Blvd sunrise mileage crew.',
    city: 'Manila',
    scheduleSummary: 'Sat 05:30 AM PHT',
    joinPolicy: 'open',
    captainUids: ['u_captain'],
    primaryColor: '#DC2626',
    accentColor: '#F59E0B',
    logoUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/club-assets%2Fu_admin%2Fmanila_pacers%2Flogo.png?alt=media',
    logoStoragePath: 'club-assets/u_admin/manila_pacers/logo.png',
    billingTier: 'community',
    subscriptionStatus: 'active',
    billingProvider: 'admin_manual',
  };

  await assert.rejects(
    service.execute('u_org', '/clubs/save', clubPayload),
    (err) => err.status === 403,
  );
  await assert.rejects(
    service.execute('u_runner', '/clubs/save', clubPayload),
    (err) => err.status === 403,
  );

  const saved = await service.execute('u_admin', '/clubs/save', clubPayload);
  assert.equal(saved.club.clubId, 'manila_pacers');
  assert.equal(saved.club.memberCount, 1);
  assert.equal(store.docs.get('clubMembers/manila_pacers_u_captain')?.role, 'captain');
  assert.equal(store.docs.get('clubMembers/manila_pacers_u_captain')?.status, 'active');
  assert.equal(store.docs.get('conversations/club_manila_pacers')?.type, 'club');
  assert.equal(store.docs.get('conversations/club_manila_pacers')?.status, 'active');

  const replay = await service.execute('u_admin', '/clubs/save', clubPayload);
  assert.deepEqual(replay, saved);

  await assert.rejects(
    service.execute('u_admin', '/clubs/save', { ...clubPayload, name: 'Different Name' }),
    (err) => err.status === 409,
  );
});

test('club request submission caps 3 open requests and admin approval creates club + notifies requester', async () => {
  const store = createMockDb(baseUsers());
  const service = createCommunityService(store.db, createMockStorage(), { now: () => '2026-11-25T10:05:00.000Z' });

  for (let i = 1; i <= 3; i += 1) {
    await service.execute('u_runner', '/clubs/request', {
      requestId: `req-club-req-${i}-00001`,
      clubName: `BGC Striders ${i}`,
      city: 'Taguig',
      scheduleSummary: 'Thu 06:00 PM PHT',
      notes: 'Community paced run',
    });
  }

  await assert.rejects(
    service.execute('u_runner', '/clubs/request', {
      requestId: 'req-club-req-4-00001',
      clubName: 'BGC Striders 4',
      city: 'Taguig',
      scheduleSummary: 'Thu 06:00 PM PHT',
    }),
    (err) => err.status === 409,
  );

  await assert.rejects(
    service.execute('u_org', '/clubs/requests/resolve', {
      requestId: 'req-resolve-org-0001',
      clubRequestId: 'req-club-req-1-00001',
      decision: 'approved',
    }),
    (err) => err.status === 403,
  );

  // Get first stored clubRequest doc ID (matches requestId if omitted in payload)
  const firstReq = Array.from(store.docs.entries()).find(([k]) => k.startsWith('clubRequests/'))[1];
  const resolved = await service.execute('u_admin', '/clubs/requests/resolve', {
    requestId: 'req-resolve-adm-0001',
    clubRequestId: firstReq.requestId,
    decision: 'approved',
    reviewNote: 'Approved for Manila community launch.',
    clubPayload: {
      clubId: 'bgc_striders',
      name: 'BGC Striders',
      description: 'Evening tempo crew in High Street.',
      city: 'Taguig',
      scheduleSummary: 'Thu 06:00 PM PHT',
      joinPolicy: 'open',
      captainUids: ['u_runner'],
    },
  });
  assert.equal(resolved.clubRequest.status, 'approved');
  assert.equal(resolved.club.clubId, 'bgc_striders');
  assert.equal(store.docs.get('clubMembers/bgc_striders_u_runner')?.role, 'captain');
  const notifications = Array.from(store.docs.entries())
    .filter(([k, v]) => k.startsWith('activityNotifications/') && v.uid === 'u_runner');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1].kind, 'club_approved');
});

test('join policies (open, approval, invite_only), memberLimit, captain boundaries, primary switch, and leave', async () => {
  const store = createMockDb(baseUsers());
  const service = createCommunityService(store.db, createMockStorage(), { now: () => '2026-11-25T10:10:00.000Z' });

  await service.execute('u_admin', '/clubs/save', {
    requestId: 'req-save-approval-club1',
    clubId: 'cebu_climbers',
    name: 'Cebu Climbers',
    description: 'Busay hill repeats.',
    city: 'Cebu City',
    joinPolicy: 'approval',
    memberLimit: 2,
    captainUids: ['u_captain'],
  });
  await service.execute('u_admin', '/clubs/save', {
    requestId: 'req-save-invite-club1',
    clubId: 'elite_pacer_inv',
    name: 'Elite Pacers',
    description: 'Invite only race pacer squad.',
    city: 'Makati',
    joinPolicy: 'invite_only',
    captainUids: ['u_captain'],
  });

  // invite_only rejects direct join
  await assert.rejects(
    service.execute('u_runner', '/clubs/join', {
      requestId: 'req-join-invite-0001',
      clubId: 'elite_pacer_inv',
    }),
    (err) => err.status === 403,
  );

  // approval club creates pending member
  const joinedPending = await service.execute('u_runner', '/clubs/join', {
    requestId: 'req-join-pending-0001',
    clubId: 'cebu_climbers',
  });
  assert.equal(joinedPending.member.status, 'pending');
  assert.equal(store.docs.get('clubs/cebu_climbers').requestCount, 1);
  assert.equal(store.docs.get('clubs/cebu_climbers').memberCount, 1);

  // primary club rejects pending/non-member
  await assert.rejects(
    service.execute('u_runner', '/clubs/primary', {
      requestId: 'req-primary-denied-01',
      clubId: 'cebu_climbers',
    }),
    (err) => err.status === 403,
  );

  // captain approves pending member -> reaches memberLimit 2
  const approvedRes = await service.execute('u_captain', '/clubs/member/manage', {
    requestId: 'req-cap-approve-0001',
    clubId: 'cebu_climbers',
    targetUid: 'u_runner',
    action: 'approve',
  });
  assert.equal(approvedRes.member.status, 'active');
  assert.equal(store.docs.get('clubs/cebu_climbers').memberCount, 2);
  assert.equal(store.docs.get('clubs/cebu_climbers').requestCount, 0);
  assert.equal(store.docs.get('users/u_runner').primaryClubId, 'cebu_climbers');
  assert.equal(store.docs.get('publicProfiles/u_runner').primaryClubId, 'cebu_climbers');
  assert.equal(store.docs.get('publicProfiles/u_runner').email, undefined);

  // Third member approval blocked by memberLimit = 2
  await service.execute('u_runner2', '/clubs/join', {
    requestId: 'req-join-pending-0002',
    clubId: 'cebu_climbers',
  });
  await assert.rejects(
    service.execute('u_captain', '/clubs/member/manage', {
      requestId: 'req-cap-approve-0002',
      clubId: 'cebu_climbers',
      targetUid: 'u_runner2',
      action: 'approve',
    }),
    (err) => err.status === 409,
  );

  // Captain cannot promote or demote captains (only Admin with clubs.manage can)
  await assert.rejects(
    service.execute('u_captain', '/clubs/member/manage', {
      requestId: 'req-cap-promote-0001',
      clubId: 'cebu_climbers',
      targetUid: 'u_runner',
      action: 'promote_captain',
    }),
    (err) => err.status === 403,
  );
  await service.execute('u_admin', '/clubs/member/manage', {
    requestId: 'req-adm-promote-0001',
    clubId: 'cebu_climbers',
    targetUid: 'u_runner',
    action: 'promote_captain',
  });
  assert.ok(store.docs.get('clubs/cebu_climbers').captainUids.includes('u_runner'));

  // Member leaves primary club -> clears primaryClubId and decrements memberCount
  await service.execute('u_runner', '/clubs/leave', {
    requestId: 'req-leave-primary-001',
    clubId: 'cebu_climbers',
  });
  assert.equal(store.docs.has('clubMembers/cebu_climbers_u_runner'), false);
  assert.equal(store.docs.get('users/u_runner').primaryClubId, null);
  assert.equal(store.docs.get('publicProfiles/u_runner').primaryClubId, null);
  assert.equal(store.docs.get('clubs/cebu_climbers').memberCount, 1);
  assert.equal(store.docs.get('clubs/cebu_climbers').captainUids.includes('u_runner'), false);
});

test('club modules, spotlight, verified-run leaderboard, and delete storage cleanup', async () => {
  const store = createMockDb({
    ...baseUsers(),
    'recordedRuns/r_ver_1': {
      runId: 'r_ver_1',
      uid: 'u_runner',
      verificationStatus: 'verified',
      distanceM: 10000,
      movingTimeMs: 3000000,
      elevationGainM: 80,
      startedAt: '2026-11-24T05:00:00.000Z',
    },
    'recordedRuns/r_flagged': {
      runId: 'r_flagged',
      uid: 'u_runner',
      verificationStatus: 'flagged',
      distanceM: 42195,
      movingTimeMs: 7200000,
      elevationGainM: 500,
      startedAt: '2026-11-24T05:00:00.000Z',
    },
  });
  const storage = createMockStorage();
  const service = createCommunityService(store.db, storage, { now: () => '2026-11-25T10:15:00.000Z' });

  await service.execute('u_admin', '/clubs/save', {
    requestId: 'req-save-mod-club-001',
    clubId: 'davao_track',
    name: 'Davao Track',
    description: 'Track intervals.',
    city: 'Davao',
    joinPolicy: 'open',
    captainUids: ['u_captain'],
    logoUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/club-assets%2Fu_admin%2Fdavao_track%2Fcrest.webp?alt=media',
    logoStoragePath: 'club-assets/u_admin/davao_track/crest.webp',
    modules: {
      chat: true,
      leaderboard: true,
      events: false,
      badges: true,
      routeLibrary: false,
      announcements: true,
      memberSpotlight: true,
      customTheme: true,
    },
  });
  await service.execute('u_runner', '/clubs/join', {
    requestId: 'req-join-davao-0001',
    clubId: 'davao_track',
  });

  // Disabled events module rejects meetup creation
  await assert.rejects(
    service.execute('u_captain', '/clubs/meetup/save', {
      requestId: 'req-meetup-dis-0001',
      clubId: 'davao_track',
      meetupId: 'mu_1',
      title: 'Track Tuesday',
      startAtIso: '2026-11-28T05:30:00.000Z',
      locationName: 'Davao Oval',
    }),
    (err) => err.status === 403,
  );

  // Spotlight requires targetUid to be active member
  await assert.rejects(
    service.execute('u_captain', '/clubs/spotlight/save', {
      requestId: 'req-spot-nonmem-0001',
      clubId: 'davao_track',
      targetUid: 'u_runner2',
      headline: 'Not A Member',
    }),
    (err) => err.status === 400 || err.status === 404,
  );
  await service.execute('u_captain', '/clubs/spotlight/save', {
    requestId: 'req-spot-valid-00001',
    clubId: 'davao_track',
    targetUid: 'u_runner',
    headline: '10K Pacer of the Week',
  });
  assert.equal(store.docs.get('clubSpotlights/davao_track').targetUid, 'u_runner');

  // Leaderboard includes only verified runs
  const lb = await service.execute('u_runner', '/clubs/leaderboard', { clubId: 'davao_track' });
  const runnerEntry = lb.entries.find((e) => e.uid === 'u_runner');
  assert.equal(runnerEntry.totalDistanceM, 10000);
  assert.equal(runnerEntry.verifiedRunsCount, 1);

  // Archive updates club and club conversation status
  await service.execute('u_admin', '/clubs/archive', {
    requestId: 'req-archive-davao-01',
    clubId: 'davao_track',
    archived: true,
  });
  assert.equal(store.docs.get('clubs/davao_track').status, 'archived');
  assert.equal(store.docs.get('conversations/club_davao_track').status, 'archived');

  // Delete cleans club, members, spotlight, conversation, primaryClubId, and storage assets
  await service.execute('u_admin', '/clubs/delete', {
    requestId: 'req-delete-davao-001',
    clubId: 'davao_track',
  });
  assert.equal(store.docs.has('clubs/davao_track'), false);
  assert.equal(store.docs.has('clubMembers/davao_track_u_runner'), false);
  assert.equal(store.docs.has('clubSpotlights/davao_track'), false);
  assert.equal(store.docs.has('conversations/club_davao_track'), false);
  assert.equal(store.docs.get('users/u_runner').primaryClubId, null);
  assert.deepEqual(storage.deletedFiles, ['club-assets/u_admin/davao_track/crest.webp']);
});
