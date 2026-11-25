'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { createAccessService } = require('../functions/access-service');

function createMockStore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  const makeSnap = (key) => ({
    exists: docs.has(key),
    id: key.split('/').pop(),
    ref: { path: key },
    data: () => (docs.has(key) ? structuredClone(docs.get(key)) : undefined),
  });
  const db = {
    doc: (key) => ({ path: key, get: async () => makeSnap(key) }),
    collection: (name) => ({
      where: (field, op, val) => ({
        get: async () => {
          const matched = [...docs.entries()]
            .filter(([k, v]) => {
              if (!k.startsWith(`${name}/`)) return false;
              if (op === '==') return v[field] === val;
              if (op === 'array-contains') return Array.isArray(v[field]) && v[field].includes(val);
              return false;
            })
            .map(([k]) => makeSnap(k));
          return { docs: matched, empty: matched.length === 0 };
        },
      }),
    }),
    runTransaction: async (cb) => {
      const staged = new Map();
      const tx = {
        get: async (ref) => makeSnap(ref.path),
        create: (ref, data) => staged.set(ref.path, structuredClone(data)),
        set: (ref, data) => staged.set(ref.path, structuredClone(data)),
        update: (ref, patch) => staged.set(ref.path, { ...(docs.get(ref.path) || {}), ...structuredClone(patch) }),
        delete: (ref) => staged.set(ref.path, null),
      };
      const result = await cb(tx);
      for (const [k, v] of staged.entries()) {
        if (v === null) docs.delete(k);
        else docs.set(k, v);
      }
      return result;
    },
  };
  return { db, docs };
}

test('createAccessService blocks actors marked accessRemoved even if userAccess is missing', async () => {
  const { db } = createMockStore({
    'users/removed_actor': { uid: 'removed_actor', role: 'runner', approved: true, accessRemoved: true },
  });
  const service = createAccessService(db);
  await assert.rejects(service.execute('removed_actor', '/session', {}), (err) => err.status === 403);
});

test('createAccessService revokes Firebase refresh tokens on /remove, suspension, and admin demotion', async () => {
  const revokedUids = [];
  const auth = {
    revokeRefreshTokens: async (uid) => {
      revokedUids.push(uid);
    },
  };
  const { db } = createMockStore({
    'users/owner': { uid: 'owner', role: 'superadmin', approved: true, displayName: 'Owner' },
    'users/target_admin': { uid: 'target_admin', role: 'admin', approved: true, displayName: 'Target Admin' },
    'userAccess/target_admin': { status: 'active', scope: 'all', raceIds: [], overrides: {}, revision: 0 },
    'accessSystem/rollout': { enforcementReady: true },
    'accessSystem/authority': { members: ['owner'] },
  });
  const service = createAccessService(db, auth);

  // 1) Demote admin -> runner triggers token revocation.
  const demoteRes = await service.execute('owner', '/save', {
    uid: 'target_admin',
    role: 'runner',
    status: 'active',
    scope: 'owned-assigned',
    raceIds: [],
    overrides: {},
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  assert.equal(demoteRes.saved, true);
  assert.equal(demoteRes.tokensRevoked, true);
  assert.deepEqual(revokedUids, ['target_admin']);

  // 2) Suspend user triggers token revocation.
  const suspendRes = await service.execute('owner', '/save', {
    uid: 'target_admin',
    role: 'runner',
    status: 'suspended',
    scope: 'owned-assigned',
    raceIds: [],
    overrides: {},
    revision: 1,
    requestId: crypto.randomUUID(),
  });
  assert.equal(suspendRes.tokensRevoked, true);
  assert.deepEqual(revokedUids, ['target_admin', 'target_admin']);

  // 3) Remove user triggers token revocation.
  const removeRes = await service.execute('owner', '/remove', {
    uid: 'target_admin',
    revision: 2,
    requestId: crypto.randomUUID(),
  });
  assert.equal(removeRes.tokensRevoked, true);
  assert.deepEqual(revokedUids, ['target_admin', 'target_admin', 'target_admin']);
});

test('createAccessService handles missing auth client and auth/user-not-found gracefully', async () => {
  const { db } = createMockStore({
    'users/owner': { uid: 'owner', role: 'superadmin', approved: true, displayName: 'Owner' },
    'users/ghost_user': { uid: 'ghost_user', role: 'runner', approved: true, displayName: 'Ghost' },
    'userAccess/ghost_user': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {}, revision: 0 },
    'accessSystem/rollout': { enforcementReady: true },
    'accessSystem/authority': { members: ['owner'] },
  });

  const serviceNoAuth = createAccessService(db);
  const resNoAuth = await serviceNoAuth.execute('owner', '/remove', {
    uid: 'ghost_user',
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  assert.equal(resNoAuth.saved, true);

  const authNotFound = {
    revokeRefreshTokens: async () => {
      throw Object.assign(new Error('No user'), { code: 'auth/user-not-found' });
    },
  };
  const serviceNotFound = createAccessService(db, authNotFound);
  const resNotFound = await serviceNotFound.execute('owner', '/save', {
    uid: 'ghost_user',
    role: 'runner',
    status: 'suspended',
    scope: 'owned-assigned',
    raceIds: [],
    overrides: {},
    revision: 1,
    requestId: crypto.randomUUID(),
  });
  assert.equal(resNotFound.saved, true);
  assert.equal(resNotFound.tokensRevoked, false);
});
