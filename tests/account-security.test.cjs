const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAccountSecurity } = require('../functions/account-security');
const { accountEmail, accountMessage, LOGO_URL } = require('../functions/account-email');

function fixture() {
  const documents = new Map();
  const deliveries = [];
  const users = new Map([['runner-1', { uid: 'runner-1', email: 'juan@example.com', displayName: 'Juan Dela Cruz', emailVerified: false }]]);
  const revoked = [];
  let clock = Date.parse('2026-10-26T00:00:00Z');
  let failMail = false;
  let queue = Promise.resolve();
  const db = {
    doc: (key) => ({ key }),
    runTransaction(callback) {
      const execute = async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => ({ exists: documents.has(ref.key), data: () => documents.has(ref.key) ? structuredClone(documents.get(ref.key)) : undefined }),
          set: (ref, data) => writes.push(() => documents.set(ref.key, structuredClone(data))),
          update: (ref, data) => writes.push(() => documents.set(ref.key, { ...documents.get(ref.key), ...structuredClone(data) })),
        });
        writes.forEach((write) => write());
        return result;
      };
      const result = queue.then(execute);
      queue = result.catch(() => {});
      return result;
    },
  };
  const auth = {
    getUser: async (uid) => ({ ...users.get(uid) }),
    getUserByEmail: async (email) => {
      const user = [...users.values()].find((entry) => entry.email === email);
      if (!user) throw Object.assign(new Error('Unknown user'), { code: 'auth/user-not-found' });
      return { ...user };
    },
    updateUser: async (uid, data) => users.set(uid, { ...users.get(uid), ...data }),
    revokeRefreshTokens: async (uid) => revoked.push(uid),
  };
  const service = createAccountSecurity({
    db, auth, secret: 'test-only-secret-that-is-not-a-production-credential', now: () => clock,
    sendCode: async (delivery) => { if (failMail) throw new Error('SMTP diagnostics should never escape'); deliveries.push(delivery); },
  });
  const request = (purpose = 'verify', extra = {}) => service.requestCode({ purpose, uid: purpose === 'verify' ? 'runner-1' : undefined, email: 'juan@example.com', ip: 'test-ip', ...extra });
  const confirm = (delivery, purpose = 'verify', extra = {}) => service.checkCode({ purpose, uid: purpose === 'verify' ? 'runner-1' : undefined, email: 'juan@example.com', ip: 'test-ip', challengeId: delivery.challengeId, code: deliveries.at(-1)?.code, ...extra });
  return { service, request, confirm, documents, deliveries, users, revoked, advance: (ms) => { clock += ms; }, failMail: () => { failMail = true; } };
}

test('verification marks only the authenticated account verified and consumes the code', async () => {
  const f = fixture();
  const delivery = await f.request('verify', { email: 'attacker@example.com' });
  assert.equal(f.deliveries[0].email, 'juan@example.com');
  assert.match(f.deliveries[0].code, /^\d{6}$/);
  assert.equal(f.users.get('runner-1').emailVerified, false);
  assert.deepEqual(await f.confirm(delivery), { verified: true });
  assert.equal(f.users.get('runner-1').emailVerified, true);
  await assert.rejects(f.confirm(delivery), /expired|limit/);
});

test('codes are hashed and never stored as plaintext', async () => {
  const f = fixture();
  await f.request();
  const challenge = [...f.documents.entries()].find(([key]) => key.startsWith('accountChallenges/'))[1];
  assert.equal(challenge.code, undefined);
  assert.match(challenge.codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(challenge.codeHash, f.deliveries[0].code);
});

test('wrong codes exhaust five attempts, including a later correct submission', async () => {
  const f = fixture(); const delivery = await f.request();
  const wrongCode = f.deliveries[0].code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await assert.rejects(f.confirm(delivery, 'verify', { code: wrongCode }), /incorrect/);
  await assert.rejects(f.confirm(delivery), /limit/);
  assert.equal(f.users.get('runner-1').emailVerified, false);
});

test('codes expire after ten minutes', async () => {
  const f = fixture(); const delivery = await f.request();
  f.advance(600000);
  await assert.rejects(f.confirm(delivery), /expired/);
});

test('resends enforce cooldown and invalidate the previous code', async () => {
  const f = fixture(); const first = await f.request(); const oldCode = f.deliveries[0].code;
  await assert.rejects(f.request(), (error) => error.status === 429 && error.retryAfter === 60);
  f.advance(60000); const second = await f.request();
  assert.notEqual(first.challengeId, second.challengeId);
  await assert.rejects(f.confirm(first, 'verify', { code: oldCode }), /incorrect/);
  assert.deepEqual(await f.confirm(second), { verified: true });
});

test('a maximum of five codes can be sent per address per hour', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) { await f.request(); f.advance(60000); }
  await assert.rejects(f.request(), (error) => error.status === 429);
  f.advance(3600000);
  await f.request();
});

test('reset requests conceal whether an account exists', async () => {
  const real = fixture(); const unknown = fixture();
  const first = await real.request('reset');
  const second = await unknown.request('reset', { email: 'unknown@example.com' });
  assert.deepEqual(Object.keys(first), Object.keys(second));
  assert.equal(first.expiresIn, second.expiresIn);
  assert.equal(unknown.deliveries.length, 0);
  await assert.rejects(unknown.confirm(second, 'reset', { email: 'unknown@example.com', code: '123456' }));
});

test('reset grants are single-use and revoke existing sessions', async () => {
  const f = fixture(); const delivery = await f.request('reset');
  const result = await f.confirm(delivery, 'reset');
  assert.match(result.resetToken, /^[a-f0-9]{64}$/);
  assert.equal(f.users.get('runner-1').password, undefined);
  await f.service.resetPassword({ resetToken: result.resetToken, password: 'a-new-password', ip: 'test-ip' });
  assert.equal(f.users.get('runner-1').password, 'a-new-password');
  assert.deepEqual(f.revoked, ['runner-1']);
  await assert.rejects(f.service.resetPassword({ resetToken: result.resetToken, password: 'another-password', ip: 'test-ip' }), /expired/);
});

test('reset grants expire and weak passwords do not consume valid grants', async () => {
  const f = fixture(); const delivery = await f.request('reset'); const { resetToken } = await f.confirm(delivery, 'reset');
  await assert.rejects(f.service.resetPassword({ resetToken, password: '1234567', ip: 'test-ip' }), /8 and 128/);
  f.advance(600000);
  await assert.rejects(f.service.resetPassword({ resetToken, password: 'long-enough', ip: 'test-ip' }), /expired/);
});

test('a code cannot be exchanged for another purpose', async () => {
  const f = fixture(); const delivery = await f.request('verify');
  await assert.rejects(f.confirm(delivery, 'reset'));
});

test('concurrent code confirmations issue only one reset grant', async () => {
  const f = fixture(); const delivery = await f.request('reset');
  const results = await Promise.allSettled([f.confirm(delivery, 'reset'), f.confirm(delivery, 'reset')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal([...f.documents.keys()].filter((key) => key.startsWith('accountResetGrants/')).length, 1);
});

test('disabled or changed accounts cannot use a reset grant', async () => {
  for (const changes of [{ disabled: true }, { email: 'changed@example.com' }]) {
    const f = fixture(); const delivery = await f.request('reset'); const { resetToken } = await f.confirm(delivery, 'reset');
    f.users.set('runner-1', { ...f.users.get('runner-1'), ...changes });
    await assert.rejects(f.service.resetPassword({ resetToken, password: 'new-password', ip: 'test-ip' }), /no longer available/);
    assert.equal(f.users.get('runner-1').password, undefined);
  }
});

test('SMTP failures expose a safe error and invalidate the undelivered code', async () => {
  const f = fixture(); f.failMail();
  await assert.rejects(f.request(), (error) => error.status === 503 && !error.message.includes('diagnostics'));
  const challenge = [...f.documents.entries()].find(([key]) => key.startsWith('accountChallenges/'))[1];
  assert.equal(challenge.used, true);
});

test('IP rate limiting also covers malformed confirmation requests', async () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) await assert.rejects(f.confirm({ challengeId: '' }, 'reset', { code: '' }), (error) => error.status === 400);
  await assert.rejects(f.confirm({ challengeId: '' }, 'reset', { code: '' }), (error) => error.status === 429);
});

test('both email templates include brand, personalized greeting, big code and safe escaping', () => {
  const signup = accountEmail({ purpose: 'verify', name: 'Juan Dela Cruz', code: '123456' });
  assert.match(signup.text, /Welcome to Race Pulse, Juan!/);
  assert.match(signup.text, /Happy running ka Racepulse!/);
  assert.match(signup.html, /font-size:40px/);
  assert.ok(signup.html.includes(LOGO_URL));
  assert.match(signup.html, /width="64" height="64"/);
  assert.match(signup.html, /RacePulse<span[^>]*>PH<\/span>/);
  assert.match(signup.html, /123456/);
  const reset = accountEmail({ purpose: 'reset', name: '<script>alert(1)</script>', code: '654321' });
  assert.match(reset.text, /reset your RacePulse password/);
  assert.ok(!reset.html.includes('<script>'));
});

test('transactional messages align sender, envelope and reply address without CID attachments', () => {
  const message = accountMessage({ email: 'runner@example.com', purpose: 'verify', name: 'Juan', code: '123456' });
  assert.equal(message.from.address, 'events@racepulseph.com');
  assert.equal(message.envelope.from, message.from.address);
  assert.equal(message.replyTo.address, message.from.address);
  assert.equal(message.headers['Auto-Submitted'], 'auto-generated');
  assert.equal(message.attachments, undefined);
  assert.ok(!message.html.includes('cid:'));
  assert.equal(message.disableFileAccess, true);
});


test('GET /unsubscribe returns 405 without mutating state, while POST /unsubscribe updates preferences', async () => {
  const { createAccountApp, createUnsubscribeToken } = require('../functions/auth-api');
  const docs = new Map([
    ['users/u1', { uid: 'u1', email: 'runner@example.com', marketingOptIn: true }],
  ]);
  const makeSnap = (key) => ({
    exists: docs.has(key),
    id: key.split('/').pop(),
    ref: { path: key },
    data: () => (docs.has(key) ? structuredClone(docs.get(key)) : undefined),
  });
  const db = {
    doc: (key) => ({
      path: key,
      get: async () => makeSnap(key),
      set: async (data, opts) => docs.set(key, opts?.merge && docs.has(key) ? { ...docs.get(key), ...structuredClone(data) } : structuredClone(data)),
    }),
    collection: (name) => ({
      where: (field, op, val) => ({
        limit: () => ({
          get: async () => {
            const matched = [...docs.entries()]
              .filter(([k, v]) => k.startsWith(`${name}/`) && op === '==' && v[field] === val)
              .map(([k]) => makeSnap(k));
            return { empty: matched.length === 0, forEach: (fn) => matched.forEach(fn), docs: matched };
          },
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        update: (ref, patch) => ops.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(patch) })),
        commit: async () => ops.forEach((o) => o()),
      };
    },
    runTransaction: async (cb) => {
      const ops = [];
      const res = await cb({
        get: async (ref) => makeSnap(ref.path),
        set: (ref, data) => ops.push(() => docs.set(ref.path, structuredClone(data))),
      });
      ops.forEach((o) => o());
      return res;
    },
  };
  const secret = 'test-only-secret-that-is-not-a-production-credential';
  const app = createAccountApp({
    admin: { auth: () => ({}) },
    db,
    getCodeSecret: () => secret,
    getSmtpPassword: () => 'unused',
    appCheckMode: 'off',
    turnstileMode: 'off',
  });

  const makeRes = () => {
    const headers = {};
    let statusCode = 200;
    let body;
    return {
      headers,
      get statusCode() { return statusCode; },
      get body() { return body; },
      set(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { statusCode = c; return this; },
      json(v) { body = v; return this; },
      send(v) { body = v; return this; },
    };
  };

  const token = createUnsubscribeToken(secret, 'runner@example.com');
  const getRes = makeRes();
  await app({
    method: 'GET',
    path: '/unsubscribe',
    query: { token },
    ip: '203.0.113.9',
    get: () => undefined,
    is: () => false,
  }, getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(getRes.headers.allow, 'POST');
  assert.equal(docs.get('users/u1').marketingOptIn, true);

  const postRes = makeRes();
  const bodyObj = { token, marketingOptIn: false };
  await app({
    method: 'POST',
    path: '/unsubscribe',
    body: bodyObj,
    rawBody: Buffer.from(JSON.stringify(bodyObj), 'utf8'),
    ip: '203.0.113.9',
    get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : undefined),
    is: (t) => t === 'application/json',
  }, postRes);
  assert.equal(postRes.statusCode, 200);
  assert.equal(docs.get('users/u1').marketingOptIn, false);
});

test('POST /auth/resolve-username resolves email cleanly and rejects malformed handles', async () => {
  const { createAccountApp } = require('../functions/auth-api');
  const docs = new Map([
    ['usernameIndex/juan.run', { username: 'juan.run', uid: 'u1', email: 'juan@example.com' }],
  ]);
  const makeSnap = (key) => ({
    exists: docs.has(key),
    data: () => (docs.has(key) ? structuredClone(docs.get(key)) : undefined),
  });
  const db = {
    doc: (key) => ({ path: key, get: async () => makeSnap(key) }),
    runTransaction: async (cb) => {
      const ops = [];
      const res = await cb({
        get: async (ref) => makeSnap(ref.path),
        set: (ref, data) => ops.push(() => docs.set(ref.path, structuredClone(data))),
      });
      ops.forEach((o) => o());
      return res;
    },
  };
  const app = createAccountApp({
    admin: { auth: () => ({}) },
    db,
    getCodeSecret: () => 'test-only-secret-that-is-not-a-production-credential',
    getSmtpPassword: () => 'unused',
    appCheckMode: 'off',
    turnstileMode: 'off',
  });
  const makeRes = () => {
    const headers = {};
    let statusCode = 200;
    let body;
    return {
      headers,
      get statusCode() { return statusCode; },
      get body() { return body; },
      set(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { statusCode = c; return this; },
      json(v) { body = v; return this; },
    };
  };

  const okRes = makeRes();
  const okBody = { username: 'Juan.Run' };
  await app({
    method: 'POST',
    path: '/auth/resolve-username',
    body: okBody,
    rawBody: Buffer.from(JSON.stringify(okBody), 'utf8'),
    ip: '203.0.113.10',
    get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : undefined),
    is: (t) => t === 'application/json',
  }, okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.email, 'juan@example.com');

  const badRes = makeRes();
  const badBody = { username: 'x' };
  await app({
    method: 'POST',
    path: '/auth/resolve-username',
    body: badBody,
    rawBody: Buffer.from(JSON.stringify(badBody), 'utf8'),
    ip: '203.0.113.10',
    get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : undefined),
    is: (t) => t === 'application/json',
  }, badRes);
  assert.equal(badRes.statusCode, 400);
});

test('purgeAndAnonymizeUserAccount deletes usernameIndex, friendDirectory, and bibClaimLocks by uid even if users doc is already gone', async () => {
  const { purgeAndAnonymizeUserAccount } = require('../functions/auth-api');
  const docs = new Map([
    ['usernameIndex/orphan.user', { uid: 'u-orphan', username: 'orphan.user', email: 'orphan@example.com' }],
    ['friendDirectory/orphan.user', { uid: 'u-orphan', username: 'orphan.user', displayName: 'Orphan' }],
    ['bibClaimLocks/race1_5-001', { uid: 'u-orphan', raceId: 'race1', bibNumber: '5-001' }],
  ]);
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
          return { docs: matched, empty: matched.length === 0, forEach: (fn) => matched.forEach(fn) };
        },
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        delete: (ref) => ops.push(() => docs.delete(ref.path)),
        update: (ref, patch) => ops.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(patch) })),
        commit: async () => ops.forEach((o) => o()),
      };
    },
  };
  let deletedAuthUid = null;
  const auth = {
    deleteUser: async (uid) => { deletedAuthUid = uid; },
  };
  await purgeAndAnonymizeUserAccount({ db, auth, uid: 'u-orphan' });
  assert.equal(docs.has('usernameIndex/orphan.user'), false);
  assert.equal(docs.has('friendDirectory/orphan.user'), false);
  assert.equal(docs.has('bibClaimLocks/race1_5-001'), false);
  assert.equal(deletedAuthUid, 'u-orphan');
});

test('purgeAndAnonymizeUserAccount deletes recordedRuns and triggers run-tracks storage prefix cleanup', async () => {
  const { purgeAndAnonymizeUserAccount } = require('../functions/auth-api');
  const docs = new Map([
    ['users/u-runs', { uid: 'u-runs', username: 'runner_runs', role: 'runner' }],
    ['recordedRuns/run_1', { runId: 'run_1', uid: 'u-runs', title: 'Run 1' }],
    ['recordedRuns/run_2', { runId: 'run_2', uid: 'u-runs', title: 'Run 2' }],
    ['recordedRuns/run_other', { runId: 'run_other', uid: 'u-someone-else', title: 'Other Run' }],
  ]);
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
            .filter(([k, v]) => k.startsWith(`${name}/`) && op === '==' && v[field] === val)
            .map(([k]) => makeSnap(k));
          return { docs: matched, empty: matched.length === 0, forEach: (fn) => matched.forEach(fn) };
        },
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        delete: (ref) => ops.push(() => docs.delete(ref.path)),
        update: (ref, patch) => ops.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(patch) })),
        commit: async () => ops.forEach((o) => o()),
      };
    },
  };
  const deletedPrefixes = [];
  const storage = {
    bucket: () => ({
      deleteFiles: async ({ prefix }) => {
        deletedPrefixes.push(prefix);
      },
    }),
  };
  const auth = {
    deleteUser: async () => {},
  };
  await purgeAndAnonymizeUserAccount({ db, auth, storage, uid: 'u-runs' });
  assert.equal(docs.has('recordedRuns/run_1'), false);
  assert.equal(docs.has('recordedRuns/run_2'), false);
  assert.equal(docs.has('recordedRuns/run_other'), true);
  assert.ok(deletedPrefixes.includes('run-tracks/u-runs/'));
});
