const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAccountSecurity } = require('../functions/account-security');
const { accountEmail } = require('../functions/account-email');

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
  await assert.rejects(f.service.resetPassword({ resetToken, password: 'short', ip: 'test-ip' }), /6 and 128/);
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
  assert.match(signup.html, /cid:racepulse-logo@racepulseph.com/);
  assert.match(signup.html, /123456/);
  const reset = accountEmail({ purpose: 'reset', name: '<script>alert(1)</script>', code: '654321' });
  assert.match(reset.text, /reset your RacePulse password/);
  assert.ok(!reset.html.includes('<script>'));
});
