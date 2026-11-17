const assert = require('node:assert/strict');
const { test } = require('node:test');
const { searchRunnerDirectory } = require('../functions/friend-search');

function createSearchFixture() {
  const docs = new Map([
    ['users/caller', { uid: 'caller', role: 'runner', approved: true, username: 'juan.runner', displayName: 'Juan Dela Cruz', email: 'juan@example.com' }],
    ['userAccess/caller', { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} }],
    ['users/u1', { uid: 'u1', role: 'superadmin', approved: true, username: 'patrick.anedez', displayName: 'Patrick Josh Anedez', nickname: 'Pat', email: 'patrick@secret.invalid', createdAt: '2026-10-01' }],
    ['users/u2', { uid: 'u2', role: 'runner', approved: true, username: 'patricia_run', displayName: 'Patricia Reyes', email: 'patricia@secret.invalid', createdAt: '2026-10-02' }],
    ['users/u3', { uid: 'u3', role: 'runner', approved: true, username: 'coach_mike', displayName: 'Mike Patrick Santos', email: 'mike@secret.invalid', createdAt: '2026-10-03' }],
    ['users/removed', { uid: 'removed', role: 'runner', approved: true, username: 'patrick_removed', displayName: 'Removed Patrick', accessRemoved: true, email: 'removed@secret.invalid' }],
    ['friendDirectory/patrick.anedez', { uid: 'u1', username: 'patrick.anedez', displayName: 'Patrick Josh Anedez', nickname: 'Pat', updatedAt: '2026-10-01' }],
    ['friendDirectory/patrick_removed', { uid: 'removed', username: 'patrick_removed', displayName: 'Removed Patrick', updatedAt: '2026-10-04' }],
  ]);

  let clock = Date.parse('2026-11-17T01:00:00Z');
  const db = {
    doc: (key) => ({
      key,
      get: async () => ({ exists: docs.has(key), data: () => (docs.has(key) ? structuredClone(docs.get(key)) : undefined) }),
    }),
    collection: (name) => {
      const prefix = `${name}/`;
      const makeSnapshot = () => {
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
        get: async (ref) => ({ exists: docs.has(ref.key), data: () => (docs.has(ref.key) ? structuredClone(docs.get(ref.key)) : undefined) }),
        set: (ref, data) => writes.push(() => docs.set(ref.key, structuredClone(data))),
      });
      writes.forEach((w) => w());
      return res;
    },
  };

  return {
    db,
    secret: 'test-only-secret-that-is-not-a-production-credential',
    advance: (ms) => { clock += ms; },
    now: () => clock,
  };
}

test('searchRunnerDirectory matches partial usernames, display names, and nicknames without leaking email or removed users', async () => {
  const f = createSearchFixture();
  const { results } = await searchRunnerDirectory({
    db: f.db,
    secret: f.secret,
    callerUid: 'caller',
    rawQuery: 'patrick',
    now: f.now,
  });

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.uid),
    ['u1', 'u3'],
  );
  for (const item of results) {
    assert.equal('email' in item, false);
  }
});

test('searchRunnerDirectory supports @handle prefix and multi-token name queries while omitting self', async () => {
  const f = createSearchFixture();
  const byHandle = await searchRunnerDirectory({
    db: f.db,
    secret: f.secret,
    callerUid: 'caller',
    rawQuery: '@pat',
    now: f.now,
  });
  assert.deepEqual(byHandle.results.map((r) => r.username), ['patricia_run', 'patrick.anedez', 'coach_mike']);

  const byTokens = await searchRunnerDirectory({
    db: f.db,
    secret: f.secret,
    callerUid: 'caller',
    rawQuery: 'mike patrick',
    now: f.now,
  });
  assert.deepEqual(byTokens.results.map((r) => r.uid), ['u3']);

  const selfSearch = await searchRunnerDirectory({
    db: f.db,
    secret: f.secret,
    callerUid: 'caller',
    rawQuery: 'juan.runner',
    now: f.now,
  });
  assert.equal(selfSearch.results.length, 0);
});

test('searchRunnerDirectory rejects too-short queries and enforces rate limiting', async () => {
  const f = createSearchFixture();
  await assert.rejects(
    searchRunnerDirectory({ db: f.db, secret: f.secret, callerUid: 'caller', rawQuery: 'p', now: f.now }),
    /at least 2 characters/,
  );

  for (let i = 0; i < 60; i += 1) {
    await searchRunnerDirectory({ db: f.db, secret: f.secret, callerUid: 'caller', rawQuery: 'pat', now: f.now });
  }
  await assert.rejects(
    searchRunnerDirectory({ db: f.db, secret: f.secret, callerUid: 'caller', rawQuery: 'pat', now: f.now }),
    (err) => err.status === 429,
  );

  f.advance(5 * 60 * 1000 + 1);
  const afterWindow = await searchRunnerDirectory({ db: f.db, secret: f.secret, callerUid: 'caller', rawQuery: 'pat', now: f.now });
  assert.ok(afterWindow.results.length > 0);
});
