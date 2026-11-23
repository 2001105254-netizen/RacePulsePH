'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const { createPaymentsApp } = require('../functions/payments-service');

function createMockFirestore(initialDocs = {}) {
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
            data: () => (exists ? structuredClone(docs.get(path)) : undefined),
          };
        },
        async update(patch) {
          const prev = docs.get(path) || {};
          docs.set(path, { ...prev, ...structuredClone(patch) });
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
        const staged = new Map();
        const tx = {
          async get(ref) {
            const exists = docs.has(ref.path);
            return {
              exists,
              data: () => (exists ? structuredClone(docs.get(ref.path)) : undefined),
            };
          },
          set(ref, data, opts) {
            if (opts && opts.merge && docs.has(ref.path)) {
              staged.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path) || {};
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

function createMockAdmin(usersByToken = {}) {
  return {
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        assert.equal(checkRevoked, true);
        if (!usersByToken[token]) {
          throw new Error('Invalid token');
        }
        return usersByToken[token];
      },
    }),
  };
}

function makeReq({
  method = 'POST',
  path = '/checkout',
  headers = {},
  body = {},
  rawBody,
  ip = '203.0.113.42',
} = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const serialized = rawBody !== undefined ? rawBody : JSON.stringify(body);
  return {
    method,
    path,
    ip,
    body,
    rawBody: Buffer.from(serialized, 'utf8'),
    get(name) {
      return lower[String(name).toLowerCase()];
    },
    is(type) {
      const ct = lower['content-type'] || 'application/json';
      return ct.includes(type);
    },
  };
}

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let jsonBody;
  let sentBody;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return jsonBody !== undefined ? jsonBody : sentBody;
    },
    set(key, val) {
      headers[String(key).toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      jsonBody = payload;
      return res;
    },
    send(payload) {
      sentBody = payload;
      return res;
    },
  };
  return res;
}

function signWebhook({ secret, timestampSec, body, livemode = true }) {
  const rawBody = JSON.stringify(body);
  const digest = crypto.createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return {
    rawBody,
    signature: livemode ? `t=${timestampSec},te=,li=${digest}` : `t=${timestampSec},te=${digest},li=`,
  };
}

function baseDocs() {
  return {
    'users/runner-1': { uid: 'runner-1', role: 'runner', approved: true, email: 'runner@example.com' },
    'races/race_1': {
      id: 'race_1',
      name: 'Manila Half 2026',
      registrationOpen: true,
      onlinePaymentEnabled: true,
      entryCategories: ['solo'],
      distances: [{ label: '21K', km: 21, price: 1500 }],
    },
  };
}

function validRegistration() {
  return {
    raceId: 'race_1',
    distance: '21K',
    entryCategory: 'solo',
    fullName: 'Juan Dela Cruz',
    gender: 'male',
    age: 11,
    emergencyContactName: 'Maria Dela Cruz',
    emergencyContactPhone: '09171234567',
    parentalConsentConfirmed: true,
    parentalGuardianName: 'Maria Dela Cruz',
    parentalGuardianRelationship: 'Mother',
    termsAcceptedAt: '2026-11-20T01:00:00Z',
    marketingOptIn: true,
  };
}

test('concurrent createCheckout calls while status is creating block second session with 409 + Retry-After', async () => {
  const store = createMockFirestore(baseDocs());
  const admin = createMockAdmin({ 'tok-1': { uid: 'runner-1', email: 'runner@example.com' } });
  let clock = 1_795_000_000_000;
  let paymongoCalls = 0;
  let releasePaymongo;
  const paymongoStarted = new Promise((resolve) => {
    // resolved when fetchImpl runs
    releasePaymongo = resolve;
  });
  let finishPaymongo;

  const handler = createPaymentsApp({
    admin,
    db: store.db,
    getPaymongoSecretKey: () => ['sk', 'test', 'unit000000000000'].join('_'),
    getPaymongoWebhookSecret: () => ['whsec', 'unit000000000000'].join('_'),
    getAppUrl: () => 'https://racepulseph.web.app',
    appCheckMode: 'off',
    turnstileMode: 'off',
    now: () => clock,
    fetchImpl: async () => {
      paymongoCalls += 1;
      releasePaymongo();
      await new Promise((resolve) => {
        finishPaymongo = resolve;
      });
      return {
        ok: true,
        async json() {
          return { data: { id: 'cs_123', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_123' } } };
        },
      };
    },
  });

  const reqA = makeReq({ headers: { authorization: 'Bearer tok-1' }, body: { registration: validRegistration() } });
  const resA = makeRes();
  const reqB = makeReq({ headers: { authorization: 'Bearer tok-1' }, body: { registration: validRegistration() } });
  const resB = makeRes();

  const callA = handler(reqA, resA);
  await paymongoStarted;
  await handler(reqB, resB);

  assert.equal(resB.statusCode, 409);
  assert.ok(Number(resB.headers['retry-after']) >= 1);
  assert.equal(paymongoCalls, 1);

  finishPaymongo();
  await callA;
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.body.checkoutUrl, 'https://checkout.paymongo.com/cs_123');
});

test('createCheckout recovers stale creating record (>60s) and reuses fresh pending checkoutUrl', async () => {
  let clock = 1_795_000_000_000;
  const store = createMockFirestore({
    ...baseDocs(),
    'pendingRegistrations/runner-1_race_1': {
      paymentId: 'pay_stale',
      status: 'creating',
      createdAt: new Date(clock - 65_000).toISOString(),
    },
  });
  const admin = createMockAdmin({ 'tok-1': { uid: 'runner-1', email: 'runner@example.com' } });
  let paymongoCalls = 0;

  const handler = createPaymentsApp({
    admin,
    db: store.db,
    getPaymongoSecretKey: () => ['sk', 'test', 'unit000000000000'].join('_'),
    getPaymongoWebhookSecret: () => ['whsec', 'unit000000000000'].join('_'),
    getAppUrl: () => 'https://racepulseph.web.app',
    appCheckMode: 'off',
    turnstileMode: 'off',
    now: () => clock,
    fetchImpl: async () => {
      paymongoCalls += 1;
      return {
        ok: true,
        async json() {
          return { data: { id: 'cs_fresh', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_fresh' } } };
        },
      };
    },
  });

  const res1 = makeRes();
  await handler(makeReq({ headers: { authorization: 'Bearer tok-1' }, body: { registration: validRegistration() } }), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(paymongoCalls, 1);
  assert.equal(res1.body.checkoutUrl, 'https://checkout.paymongo.com/cs_fresh');

  // Second call while pending should reuse existing checkoutUrl without calling PayMongo.
  const res2 = makeRes();
  await handler(makeReq({ headers: { authorization: 'Bearer tok-1' }, body: { registration: validRegistration() } }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(paymongoCalls, 1);
  assert.equal(res2.body.paymentId, res1.body.paymentId);
  assert.equal(res2.body.checkoutUrl, 'https://checkout.paymongo.com/cs_fresh');
});

test('verifyWebhookSignature enforces 300s timestamp window and rejects test events under live secret', async () => {
  const webhookSecret = ['whsec', 'unit000000000000'].join('_');
  const liveKey = ['sk', 'live', 'unit000000000000'].join('_');
  const store = createMockFirestore(baseDocs());
  const admin = createMockAdmin({});
  const clockMs = 1_795_000_000_000;
  const nowSec = Math.floor(clockMs / 1000);

  const handler = createPaymentsApp({
    admin,
    db: store.db,
    getPaymongoSecretKey: () => liveKey,
    getPaymongoWebhookSecret: () => webhookSecret,
    getAppUrl: () => 'https://racepulseph.web.app',
    appCheckMode: 'off',
    turnstileMode: 'off',
    now: () => clockMs,
  });

  const payload = (livemode) => ({
    data: {
      attributes: {
        livemode,
        type: 'checkout_session.payment.paid',
        data: { id: 'cs_1', attributes: { reference_number: 'pay_missing' } },
      },
    },
  });

  // 301 seconds stale must be rejected with 401.
  const stale = signWebhook({ secret: webhookSecret, timestampSec: nowSec - 301, body: payload(true), livemode: true });
  const resStale = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': stale.signature },
      body: payload(true),
      rawBody: stale.rawBody,
    }),
    resStale,
  );
  assert.equal(resStale.statusCode, 401);

  // Test-mode event under sk_live_ must be rejected with 401.
  const testMode = signWebhook({ secret: webhookSecret, timestampSec: nowSec, body: payload(false), livemode: false });
  const resTestMode = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': testMode.signature },
      body: payload(false),
      rawBody: testMode.rawBody,
    }),
    resTestMode,
  );
  assert.equal(resTestMode.statusCode, 401);

  // Invalid HMAC rejected with 401.
  const resBadSig = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': `t=${nowSec},te=,li=${'0'.repeat(64)}` },
      body: payload(true),
      rawBody: JSON.stringify(payload(true)),
    }),
    resBadSig,
  );
  assert.equal(resBadSig.statusCode, 401);
});

test('handleWebhook rejects amount/currency mismatch with 400, persists minor consent/centavos idempotently, and returns 500 on DB failures', async () => {
  const webhookSecret = ['whsec', 'unit000000000000'].join('_');
  const liveKey = ['sk', 'live', 'unit000000000000'].join('_');
  const clockMs = 1_795_000_000_000;
  const nowSec = Math.floor(clockMs / 1000);
  const reg = validRegistration();
  const store = createMockFirestore({
    ...baseDocs(),
    'payments/pay_ok': {
      paymentId: 'pay_ok',
      uid: 'runner-1',
      raceId: 'race_1',
      raceName: 'Manila Half 2026',
      km: 21,
      amount: 150_000,
      currency: 'PHP',
      passOnFees: false,
      status: 'pending',
      checkoutSessionId: 'cs_ok',
      registration: reg,
      createdAt: new Date(clockMs).toISOString(),
    },
  });

  const handler = createPaymentsApp({
    admin: createMockAdmin({}),
    db: store.db,
    getPaymongoSecretKey: () => liveKey,
    getPaymongoWebhookSecret: () => webhookSecret,
    getAppUrl: () => 'https://racepulseph.web.app',
    appCheckMode: 'off',
    turnstileMode: 'off',
    now: () => clockMs,
  });

  const makeWebhookBody = (amount, currency) => ({
    data: {
      attributes: {
        livemode: true,
        type: 'checkout_session.payment.paid',
        data: {
          id: 'cs_ok',
          attributes: {
            reference_number: 'pay_ok',
            payments: [{ attributes: { status: 'paid', amount, currency, source: { type: 'gcash' } } }],
          },
        },
      },
    },
  });

  // Underpaid / mismatched amount returns non-retryable 400.
  const badAmtBody = makeWebhookBody(100, 'PHP');
  const badAmtSig = signWebhook({ secret: webhookSecret, timestampSec: nowSec, body: badAmtBody, livemode: true });
  const resBadAmt = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': badAmtSig.signature },
      body: badAmtBody,
      rawBody: badAmtSig.rawBody,
    }),
    resBadAmt,
  );
  assert.equal(resBadAmt.statusCode, 400);
  assert.equal(store.docs.has('runners/runner-1_race_1'), false);

  // Valid paid webhook succeeds and writes runner + counter + consent metadata + amountCentavos.
  const goodBody = makeWebhookBody(150_000, 'PHP');
  const goodSig = signWebhook({ secret: webhookSecret, timestampSec: nowSec, body: goodBody, livemode: true });
  const resGood = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': goodSig.signature },
      body: goodBody,
      rawBody: goodSig.rawBody,
    }),
    resGood,
  );
  assert.equal(resGood.statusCode, 200);
  const runnerDoc = store.docs.get('runners/runner-1_race_1');
  assert.equal(runnerDoc.bibNumber, '21-001');
  assert.equal(runnerDoc.amountCentavos, 150_000);
  assert.equal(runnerDoc.paymentAmount, 1500);
  assert.equal(runnerDoc.parentalConsentConfirmed, true);
  assert.equal(runnerDoc.parentalGuardianName, 'MARIA DELA CRUZ');
  assert.equal(runnerDoc.parentalGuardianRelationship, 'MOTHER');
  assert.equal(runnerDoc.termsAcceptedAt, '2026-11-20T01:00:00Z');
  assert.equal(runnerDoc.marketingOptIn, true);

  // Duplicate paid webhook is idempotent and keeps counter at 1.
  const resDup = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': goodSig.signature },
      body: goodBody,
      rawBody: goodSig.rawBody,
    }),
    resDup,
  );
  assert.equal(resDup.statusCode, 200);
  assert.equal(store.docs.get('bibCounters/race_1_21K_solo').count, 1);

  // Transient DB failure on an unpaid payment returns retryable 500.
  store.docs.set('payments/pay_retry', {
    paymentId: 'pay_retry',
    uid: 'runner-1',
    raceId: 'race_1',
    km: 21,
    amount: 150_000,
    currency: 'PHP',
    status: 'pending',
    checkoutSessionId: 'cs_retry',
    registration: reg,
  });
  const retryBody = {
    data: {
      attributes: {
        livemode: true,
        type: 'checkout_session.payment.paid',
        data: {
          id: 'cs_retry',
          attributes: {
            reference_number: 'pay_retry',
            payments: [{ attributes: { status: 'paid', amount: 150_000, currency: 'PHP', source: { type: 'card' } } }],
          },
        },
      },
    },
  };
  const retrySig = signWebhook({ secret: webhookSecret, timestampSec: nowSec, body: retryBody, livemode: true });
  store.failNextTransaction(new Error('DEADLINE_EXCEEDED: Firestore transient error'));
  const res500 = makeRes();
  await handler(
    makeReq({
      path: '/webhooks/paymongo',
      headers: { 'paymongo-signature': retrySig.signature },
      body: retryBody,
      rawBody: retrySig.rawBody,
    }),
    res500,
  );
  assert.equal(res500.statusCode, 500);
});

test('requireUser returns 401/403 accurately and internal Firestore errors return 500 without leaking raw messages', async () => {
  const store = createMockFirestore({
    ...baseDocs(),
    'users/denied': { uid: 'denied', role: 'runner', approved: true },
    'userAccess/denied': { status: 'suspended', overrides: {} },
  });
  const admin = createMockAdmin({
    'tok-valid': { uid: 'runner-1', email: 'runner@example.com' },
    'tok-noprofile': { uid: 'ghost', email: 'ghost@example.com' },
    'tok-denied': { uid: 'denied', email: 'denied@example.com' },
  });

  const handler = createPaymentsApp({
    admin,
    db: store.db,
    getPaymongoSecretKey: () => ['sk', 'test', 'unit000000000000'].join('_'),
    getPaymongoWebhookSecret: () => ['whsec', 'unit000000000000'].join('_'),
    getAppUrl: () => 'https://racepulseph.web.app',
    appCheckMode: 'off',
    turnstileMode: 'off',
  });

  // Missing bearer -> 401
  const resNoAuth = makeRes();
  await handler(makeReq({ body: { registration: validRegistration() } }), resNoAuth);
  assert.equal(resNoAuth.statusCode, 401);

  // Missing profile -> 403
  const resNoProf = makeRes();
  await handler(makeReq({ headers: { authorization: 'Bearer tok-noprofile' }, body: { registration: validRegistration() } }), resNoProf);
  assert.equal(resNoProf.statusCode, 403);

  // Suspended user -> 403
  const resDenied = makeRes();
  await handler(makeReq({ headers: { authorization: 'Bearer tok-denied' }, body: { registration: validRegistration() } }), resDenied);
  assert.equal(resDenied.statusCode, 403);

  // Unexpected Firestore error on getStatus -> 500 with safe message
  store.failNextGet(new Error('INTERNAL_GRPC_SECRET_HOST: timeout'));
  const resGetErr = makeRes();
  await handler(makeReq({ method: 'GET', path: '/payments/pay_123', headers: { authorization: 'Bearer tok-valid' } }), resGetErr);
  assert.equal(resGetErr.statusCode, 500);
  assert.ok(!JSON.stringify(resGetErr.body).includes('INTERNAL_GRPC_SECRET_HOST'));

  // Unexpected Firestore transaction error on createCheckout -> 500 with safe message
  store.failNextTransaction(new Error('INTERNAL_TX_FAILURE'));
  const resTxErr = makeRes();
  await handler(makeReq({ headers: { authorization: 'Bearer tok-valid' }, body: { registration: validRegistration() } }), resTxErr);
  assert.equal(resTxErr.statusCode, 500);
  assert.ok(!JSON.stringify(resTxErr.body).includes('INTERNAL_TX_FAILURE'));
});

test('CORS gates localhost origins unless emulator or RACEPULSE_ALLOW_LOCALHOST_CORS is enabled', async () => {
  const prevEmul = process.env.FUNCTIONS_EMULATOR;
  const prevLocal = process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;
  delete process.env.FUNCTIONS_EMULATOR;
  delete process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;

  try {
    const store = createMockFirestore(baseDocs());
    const handler = createPaymentsApp({
      admin: createMockAdmin({}),
      db: store.db,
      getPaymongoSecretKey: () => ['sk', 'test', 'unit000000000000'].join('_'),
      getPaymongoWebhookSecret: () => ['whsec', 'unit000000000000'].join('_'),
      getAppUrl: () => 'https://racepulseph.web.app',
    });

    const prodLocalhostRes = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), prodLocalhostRes);
    assert.equal(prodLocalhostRes.headers['access-control-allow-origin'], undefined);

    const prodOriginRes = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: { origin: 'https://racepulseph.com' } }), prodOriginRes);
    assert.equal(prodOriginRes.headers['access-control-allow-origin'], 'https://racepulseph.com');

    process.env.RACEPULSE_ALLOW_LOCALHOST_CORS = 'true';
    const devLocalhostRes = makeRes();
    await handler(makeReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), devLocalhostRes);
    assert.equal(devLocalhostRes.headers['access-control-allow-origin'], 'http://localhost:5173');
  } finally {
    if (prevEmul === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = prevEmul;
    if (prevLocal === undefined) delete process.env.RACEPULSE_ALLOW_LOCALHOST_CORS;
    else process.env.RACEPULSE_ALLOW_LOCALHOST_CORS = prevLocal;
  }
});
