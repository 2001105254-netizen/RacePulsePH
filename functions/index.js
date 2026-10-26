/*
 * RacePulsePH payments backend.
 *
 * PayMongo secret keys intentionally live only in Firebase Functions secrets.
 * The browser can request a Checkout URL and view its own payment status, but
 * a signed PayMongo webhook is the sole path that issues a paid registration
 * and its race bib.
 */
const crypto = require('crypto');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');

admin.initializeApp();
exports.accountApi = require('./auth-api').accountApi;
const db = admin.firestore();

const paymongoSecretKey = defineSecret('PAYMONGO_SECRET_KEY');
const paymongoWebhookSecret = defineSecret('PAYMONGO_WEBHOOK_SECRET');
const appUrl = defineString('PAYMENTS_APP_URL', { default: 'https://racepulseph.web.app' });

const allowedOrigins = new Set([
  'https://racepulseph.web.app',
  'https://racepulseph.firebaseapp.com',
  'http://localhost:3000',
  'http://localhost:5173',
]);
const allowedEntryCategories = new Set(['solo', 'duo', 'trio', 'group']);

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function setCors(request, response) {
  const origin = request.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
  }
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function safeText(value, maxLength, field, required = true) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > maxLength) throw new Error(`${field} is too long.`);
  return text;
}

function registrationFromRequest(input) {
  const entryCategory = safeText(input?.entryCategory, 10, 'Entry category').toLowerCase();
  if (!allowedEntryCategories.has(entryCategory)) throw new Error('Choose a valid entry category.');
  const age = Number(input?.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) throw new Error('Enter a valid age.');
  const gender = safeText(input?.gender, 10, 'Gender').toLowerCase();
  if (gender !== 'male' && gender !== 'female') throw new Error('Choose a valid gender.');
  const fullName = safeText(input?.fullName, 100, 'Full name').toUpperCase();
  const teamName = safeText(input?.teamName, 100, 'Team name', entryCategory !== 'solo').toUpperCase();
  const teamMembers = Array.isArray(input?.teamMembers)
    ? input.teamMembers.map((member) => safeText(member, 100, 'Team member').toUpperCase())
    : [];
  const memberCount = entryCategory === 'solo' ? 1 : entryCategory === 'duo' ? 2 : entryCategory === 'trio' ? 3 : 4;
  if (entryCategory !== 'solo' && teamMembers.length !== memberCount) {
    throw new Error(`A ${entryCategory} entry needs ${memberCount} member names.`);
  }
  return {
    raceId: safeText(input?.raceId, 64, 'Race'),
    distance: safeText(input?.distance, 40, 'Distance'),
    entryCategory,
    fullName,
    gender,
    age,
    emergencyContactName: safeText(input?.emergencyContactName, 100, 'Emergency contact').toUpperCase(),
    emergencyContactPhone: safeText(input?.emergencyContactPhone, 30, 'Emergency contact number'),
    ...(safeText(input?.shirtSize, 20, 'Shirt size', false) ? { shirtSize: safeText(input?.shirtSize, 20, 'Shirt size', false).toUpperCase() } : {}),
    ...(entryCategory !== 'solo' ? { teamName, teamMembers } : {}),
  };
}

async function requireUser(request) {
  const header = request.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Error('Please sign in to continue.');
  const user = await admin.auth().verifyIdToken(header.slice(7), true);
  if (!user.email_verified) throw new Error('Verify your email before continuing.');
  return user;
}

function publicPayment(payment) {
  return {
    paymentId: payment.paymentId,
    raceId: payment.raceId,
    raceName: payment.raceName,
    amount: payment.amount / 100,
    status: payment.status,
    ...(payment.registrationId ? { registrationId: payment.registrationId } : {}),
  };
}

function verifyWebhookSignature(request) {
  const signature = request.get('paymongo-signature');
  if (!signature) return false;
  const fields = Object.fromEntries(signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = fields.t;
  const rawBody = Buffer.isBuffer(request.rawBody) ? request.rawBody.toString('utf8') : JSON.stringify(request.body || {});
  if (!timestamp || !rawBody) return false;
  const expected = crypto.createHmac('sha256', paymongoWebhookSecret.value()).update(`${timestamp}.${rawBody}`).digest('hex');
  const payload = request.body || {};
  const candidate = payload?.data?.attributes?.livemode ? fields.li : fields.te;
  if (!candidate || candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function counterIdFor(raceId, distance, entryCategory) {
  // Must match the existing browser-side free-registration counter exactly,
  // so a paid 5K and a free/manual 5K can never receive the same bib number.
  return `${raceId}_${distance}_${entryCategory}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function bibPrefix(km, entryCategory) {
  const numericKm = Number(km);
  const base = Number.isFinite(numericKm) && numericKm > 0 ? String(numericKm) : 'CUSTOM';
  if (entryCategory === 'duo') return `${base}-D`;
  if (entryCategory === 'trio') return `${base}-T`;
  if (entryCategory === 'group') return `${base}-G`;
  return base;
}

async function createCheckout(request, response) {
  let decoded;
  let registration;
  try {
    decoded = await requireUser(request);
    registration = registrationFromRequest(request.body?.registration);
  } catch (error) {
    return sendJson(response, 400, { error: error.message || 'Invalid registration.' });
  }

  const raceRef = db.doc(`races/${registration.raceId}`);
  const runnerRef = db.doc(`runners/${decoded.uid}_${registration.raceId}`);
  const pendingRef = db.doc(`pendingRegistrations/${decoded.uid}_${registration.raceId}`);
  let race;
  try {
    const raceSnapshot = await raceRef.get();
    if (!raceSnapshot.exists) throw new Error('This race is no longer available.');
    race = raceSnapshot.data();
    if (race.registrationOpen === false || !race.onlinePaymentEnabled) throw new Error('Online registration is not open for this race.');
    if (race.registrationCloseDate && race.registrationCloseDate < new Date().toISOString().slice(0, 10)) throw new Error('Registration for this race has closed.');
    const distance = (race.distances || []).find((item) => item.label === registration.distance);
    if (!distance || !Number.isFinite(Number(distance.price)) || Number(distance.price) <= 0) throw new Error('Choose a paid race distance configured by the organizer.');
    const allowedEntries = Array.isArray(race.entryCategories) && race.entryCategories.length ? race.entryCategories : ['solo'];
    if (!allowedEntries.includes(registration.entryCategory)) throw new Error('This entry category is unavailable for the selected race.');
  } catch (error) {
    return sendJson(response, 400, { error: error.message || 'Unable to validate this race.' });
  }

  const distance = race.distances.find((item) => item.label === registration.distance);
  const amount = Math.round(Number(distance.price) * 100);
  const paymentId = `pay_${Date.now()}_${crypto.randomBytes(9).toString('hex')}`;
  const paymentRef = db.doc(`payments/${paymentId}`);
  let reusable;
  try {
    await db.runTransaction(async (transaction) => {
      const [runnerSnapshot, pendingSnapshot] = await Promise.all([transaction.get(runnerRef), transaction.get(pendingRef)]);
      if (runnerSnapshot.exists) throw new Error('You are already registered for this race.');
      const pending = pendingSnapshot.exists ? pendingSnapshot.data() : null;
      const freshPending = pending && ['creating', 'pending'].includes(pending.status)
        && Date.now() - new Date(pending.createdAt || 0).getTime() < 30 * 60 * 1000;
      if (freshPending && pending.checkoutUrl && pending.paymentId) {
        reusable = { paymentId: pending.paymentId, checkoutUrl: pending.checkoutUrl };
        return;
      }
      const now = new Date().toISOString();
      const record = {
        paymentId,
        uid: decoded.uid,
        raceId: registration.raceId,
        raceName: race.name,
        km: distance.km,
        amount,
        currency: 'PHP',
        status: 'creating',
        registration,
        createdAt: now,
      };
      transaction.set(paymentRef, record);
      transaction.set(pendingRef, { ...record, status: 'creating' });
    });
  } catch (error) {
    return sendJson(response, 409, { error: error.message || 'Unable to start another registration.' });
  }
  if (reusable) return sendJson(response, 200, reusable);

  try {
    const origin = appUrl.value().replace(/\/$/, '');
    const paymongoResponse = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${paymongoSecretKey.value()}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': paymentId,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            billing: { name: registration.fullName, email: decoded.email || '', phone: registration.emergencyContactPhone },
            line_items: [{ name: `${race.name} — ${registration.distance}`, amount, currency: 'PHP', quantity: 1 }],
            payment_method_types: ['card', 'gcash', 'paymaya', 'qrph'],
            reference_number: paymentId,
            success_url: `${origin}/?payment=${encodeURIComponent(paymentId)}`,
            cancel_url: `${origin}/?payment=${encodeURIComponent(paymentId)}`,
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            ...(race.paymentFeeMode === 'passed_on' ? { pass_on_fees: true } : {}),
          },
        },
      }),
    });
    const result = await paymongoResponse.json();
    const checkoutUrl = result?.data?.attributes?.checkout_url;
    if (!paymongoResponse.ok || !checkoutUrl) throw new Error(result?.errors?.[0]?.detail || 'PayMongo did not create a checkout session.');
    const checkoutSessionId = result.data.id;
    await Promise.all([
      paymentRef.update({ status: 'pending', checkoutSessionId, checkoutUrl, updatedAt: new Date().toISOString() }),
      pendingRef.update({ status: 'pending', checkoutSessionId, checkoutUrl, updatedAt: new Date().toISOString() }),
    ]);
    return sendJson(response, 200, { paymentId, checkoutUrl });
  } catch (error) {
    console.error('PayMongo checkout creation failed', { paymentId, message: error.message });
    await Promise.all([
      paymentRef.update({ status: 'failed', failureReason: 'checkout_creation_failed', updatedAt: new Date().toISOString() }).catch(() => {}),
      pendingRef.update({ status: 'failed', updatedAt: new Date().toISOString() }).catch(() => {}),
    ]);
    return sendJson(response, 502, { error: 'Unable to open secure checkout. Please try again.' });
  }
}

async function getStatus(request, response, paymentId) {
  try {
    const decoded = await requireUser(request);
    const paymentSnapshot = await db.doc(`payments/${paymentId}`).get();
    if (!paymentSnapshot.exists || paymentSnapshot.data().uid !== decoded.uid) return sendJson(response, 404, { error: 'Payment not found.' });
    return sendJson(response, 200, publicPayment(paymentSnapshot.data()));
  } catch (error) {
    return sendJson(response, 401, { error: 'Please sign in to view this payment.' });
  }
}

async function handleWebhook(request, response) {
  if (!verifyWebhookSignature(request)) return sendJson(response, 401, { error: 'Invalid webhook signature.' });
  const event = request.body?.data?.attributes;
  if (event?.type !== 'checkout_session.payment.paid') return sendJson(response, 200, { received: true });
  const checkoutSession = event.data;
  const checkoutAttributes = checkoutSession?.attributes || {};
  const paymentId = checkoutAttributes.reference_number;
  if (typeof paymentId !== 'string' || !paymentId.startsWith('pay_')) return sendJson(response, 200, { received: true });

  const paymentRef = db.doc(`payments/${paymentId}`);
  try {
    await db.runTransaction(async (transaction) => {
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists) throw new Error('Unknown payment reference.');
      const payment = paymentSnapshot.data();
      if (payment.status === 'paid') return;
      if (payment.checkoutSessionId && payment.checkoutSessionId !== checkoutSession.id) throw new Error('Checkout session does not match payment reference.');
      const registration = payment.registration;
      const runnerRef = db.doc(`runners/${payment.uid}_${payment.raceId}`);
      const pendingRef = db.doc(`pendingRegistrations/${payment.uid}_${payment.raceId}`);
      const counterRef = db.doc(`bibCounters/${counterIdFor(payment.raceId, registration.distance, registration.entryCategory)}`);
      const [runnerSnapshot, counterSnapshot] = await Promise.all([transaction.get(runnerRef), transaction.get(counterRef)]);
      if (runnerSnapshot.exists && runnerSnapshot.data().paymentId !== paymentId) throw new Error('Registration already exists for this runner.');
      const next = Number(counterSnapshot.exists ? counterSnapshot.data().count : 0) + 1;
      const bibNumber = `${bibPrefix(payment.km, registration.entryCategory)}-${String(next).padStart(3, '0')}`;
      const paidAt = new Date().toISOString();
      const paidPayment = checkoutAttributes.payments?.find((entry) => entry?.attributes?.status === 'paid');
      const paymentMethod = paidPayment?.attributes?.source?.type || 'paymongo';
      transaction.set(counterRef, { count: next }, { merge: true });
      transaction.set(runnerRef, {
        uid: payment.uid,
        raceId: payment.raceId,
        fullName: registration.fullName,
        bibNumber,
        distance: registration.distance,
        entryCategory: registration.entryCategory,
        gender: registration.gender,
        age: registration.age,
        emergencyContactName: registration.emergencyContactName,
        emergencyContactPhone: registration.emergencyContactPhone,
        ...(registration.shirtSize ? { shirtSize: registration.shirtSize } : {}),
        ...(registration.teamName ? { teamName: registration.teamName, teamMembers: registration.teamMembers } : {}),
        paymentStatus: 'paid',
        paymentId,
        paymentMethod,
        paymentAmount: payment.amount / 100,
        paymentPaidAt: paidAt,
        createdAt: paidAt,
      }, { merge: true });
      transaction.set(paymentRef, { status: 'paid', paymentMethod, paidAt, registrationId: `${payment.uid}_${payment.raceId}`, updatedAt: paidAt }, { merge: true });
      transaction.set(pendingRef, { status: 'paid', paymentId, registrationId: `${payment.uid}_${payment.raceId}`, updatedAt: paidAt }, { merge: true });
    });
  } catch (error) {
    console.error('PayMongo webhook processing failed', { paymentId, message: error.message });
    return sendJson(response, 500, { error: 'Webhook processing failed.' });
  }
  return sendJson(response, 200, { received: true });
}

exports.paymentsApi = onRequest({
  region: 'asia-southeast1',
  secrets: [paymongoSecretKey, paymongoWebhookSecret],
}, async (request, response) => {
  setCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).send('');
  const path = (request.path || '/').replace(/\/+$/, '') || '/';
  if (request.method === 'POST' && path === '/checkout') return createCheckout(request, response);
  if (request.method === 'POST' && path === '/webhooks/paymongo') return handleWebhook(request, response);
  const statusMatch = request.method === 'GET' && path.match(/^\/payments\/(pay_[a-zA-Z0-9_]+)$/);
  if (statusMatch) return getStatus(request, response, statusMatch[1]);
  return sendJson(response, 404, { error: 'Route not found.' });
});
