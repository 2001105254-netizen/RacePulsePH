const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function client(fetch, online = true) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/accountSecurity.ts'), 'utf8').replaceAll('import.meta.env', '({})');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'navigator', javascript)(
    () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-id-token' } } }),
    module, module.exports, fetch, { onLine: online },
  );
  return module.exports;
}

const delivery = { challengeId: 'a'.repeat(48), expiresIn: 600, retryAfter: 60 };

test('a complete delivery response permits the code-entry step', async () => {
  const api = client(async () => Response.json(delivery));
  assert.deepEqual(await api.requestPasswordCode('runner@example.com'), delivery);
});

test('missing endpoint reports service unavailability instead of blaming connectivity', async () => {
  const api = client(async () => new Response('<html>Not Found</html>', { status: 404 }));
  await assert.rejects(api.requestPasswordCode('runner@example.com'), (error) => error.status === 404 && /temporarily unavailable/.test(error.message) && !error.message.includes('Check your connection'));
});

test('HTML or incomplete JSON cannot be treated as a sent code', async () => {
  for (const response of [() => new Response('<html>App shell</html>'), () => Response.json({}), () => Response.json({ ...delivery, challengeId: '' }), () => Response.json({ ...delivery, expiresIn: 0 })]) {
    const api = client(async () => response());
    await assert.rejects(api.requestPasswordCode('runner@example.com'), /temporarily unavailable/);
  }
});

test('offline and unavailable-service messages distinguish the actual conditions', async () => {
  const fail = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(client(fail, false).requestPasswordCode('runner@example.com'), /offline/);
  await assert.rejects(client(fail, true).requestPasswordCode('runner@example.com'), /email delivery is temporarily unavailable/);
});

test('rate-limit responses preserve the retry interval and status', async () => {
  const api = client(async () => Response.json({ error: 'Please wait before requesting another code.', retryAfter: 60 }, { status: 429 }));
  await assert.rejects(api.requestPasswordCode('runner@example.com'), (error) => error.status === 429 && error.retryAfter === 60);
});

test('an already-verified response is valid only for authenticated verification', async () => {
  const api = client(async () => Response.json({ alreadyVerified: true }));
  assert.deepEqual(await api.requestVerificationCode('Juan'), { alreadyVerified: true });
  await assert.rejects(api.requestPasswordCode('runner@example.com'), /temporarily unavailable/);
});

test('incomplete success bodies cannot report verified email or a changed password', async () => {
  const api = client(async () => Response.json({}));
  await assert.rejects(api.confirmVerificationCode('a'.repeat(48), '123456'), /temporarily unavailable/);
  await assert.rejects(api.confirmPasswordCode('runner@example.com', 'a'.repeat(48), '123456'), /temporarily unavailable/);
  await assert.rejects(api.completePasswordReset('b'.repeat(64), 'a-password'), /temporarily unavailable/);
});
