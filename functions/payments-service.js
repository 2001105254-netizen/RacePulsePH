'use strict';

const crypto = require('node:crypto');
const defaultAccessPolicy = require('./access-policy');
const {
  applyApiSecurityHeaders,
  assertHumanFormSignals,
  enforceRateLimit,
  extractClientIp,
  GuardError,
  sendGuardError,
  setScopedCors,
  verifyAppCheckRequest,
  verifyTurnstileRequest,
} = require('./request-guard');

const PROD_ALLOWED_ORIGINS = [
  'https://racepulseph.com',
  'https://www.racepulseph.com',
  'https://racepulseph.web.app',
  'https://racepulseph.firebaseapp.com',
  'capacitor://localhost',
];

const LOCALHOST_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const ALLOWED_ENTRY_CATEGORIES = new Set(['solo', 'duo', 'trio', 'group']);
const CREATING_LOCK_WINDOW_MS = 60 * 1000;
const PENDING_REUSE_WINDOW_MS = 30 * 60 * 1000;
const WEBHOOK_MAX_AGE_SECONDS = 300;

class HttpError extends Error {
  constructor(status, message, retryAfter = 0, code = 'payment_rejected') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

function getPaymentsAllowedOrigins() {
  const allowLocalhost =
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.RACEPULSE_ALLOW_LOCALHOST_CORS === 'true';
  return new Set(
    allowLocalhost
      ? [...PROD_ALLOWED_ORIGINS, ...LOCALHOST_ALLOWED_ORIGINS]
      : PROD_ALLOWED_ORIGINS,
  );
}

function sendJson(response, status, body) {
  return response.status(status).json(body);
}

function safeText(value, maxLength, field, required = true) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new HttpError(400, `${field} is required.`);
  if (text.length > maxLength) throw new HttpError(400, `${field} is too long.`);
  return text;
}

function registrationFromRequest(input) {
  const entryCategory = safeText(input?.entryCategory, 10, 'Entry category').toLowerCase();
  if (!ALLOWED_ENTRY_CATEGORIES.has(entryCategory)) {
    throw new HttpError(400, 'Choose a valid entry category.');
  }
  const age = Number(input?.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    throw new HttpError(400, 'Enter a valid age.');
  }
  const parentalConsentConfirmed = Boolean(input?.parentalConsentConfirmed);
  const parentalGuardianName = safeText(input?.parentalGuardianName, 100, 'Parent or guardian name', age < 13);
  const parentalGuardianRelationship = safeText(input?.parentalGuardianRelationship, 40, 'Guardian relationship', age < 13);
  if (age < 13 && !parentalConsentConfirmed) {
    throw new HttpError(400, 'Verifiable parent or legal guardian consent is required for participants under 13.');
  }
  const gender = safeText(input?.gender, 10, 'Gender').toLowerCase();
  if (gender !== 'male' && gender !== 'female') {
    throw new HttpError(400, 'Choose a valid gender.');
  }
  const fullName = safeText(input?.fullName, 100, 'Full name').toUpperCase();
  const teamName = safeText(input?.teamName, 100, 'Team name', entryCategory !== 'solo').toUpperCase();
  const teamMembers = Array.isArray(input?.teamMembers)
    ? input.teamMembers.map((member) => safeText(member, 100, 'Team member').toUpperCase())
    : [];
  const memberCount = entryCategory === 'solo' ? 1 : entryCategory === 'duo' ? 2 : entryCategory === 'trio' ? 3 : 4;
  if (entryCategory !== 'solo' && teamMembers.length !== memberCount) {
    throw new HttpError(400, `A ${entryCategory} entry needs ${memberCount} member names.`);
  }
  const shirtSize = safeText(input?.shirtSize, 20, 'Shirt size', false);
  return {
    raceId: safeText(input?.raceId, 64, 'Race'),
    distance: safeText(input?.distance, 40, 'Distance'),
    entryCategory,
    fullName,
    gender,
    age,
    emergencyContactName: safeText(input?.emergencyContactName, 100, 'Emergency contact').toUpperCase(),
    emergencyContactPhone: safeText(input?.emergencyContactPhone, 30, 'Emergency contact number'),
    ...(shirtSize ? { shirtSize: shirtSize.toUpperCase() } : {}),
    ...(entryCategory !== 'solo' ? { teamName, teamMembers } : {}),
    ...(age < 13
      ? {
          parentalConsentConfirmed: true,
          parentalGuardianName: parentalGuardianName.toUpperCase(),
          parentalGuardianRelationship: parentalGuardianRelationship.toUpperCase(),
        }
      : {}),
    ...(typeof input?.termsAcceptedAt === 'string' && input.termsAcceptedAt
      ? { termsAcceptedAt: input.termsAcceptedAt.slice(0, 64) }
      : {}),
    ...(typeof input?.marketingOptIn === 'boolean' ? { marketingOptIn: input.marketingOptIn } : {}),
  };
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

function manilaDateToday(nowMs = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

function counterIdFor(raceId, distance, entryCategory) {
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

function createPaymentsApp({
  admin,
  db,
  accessPolicy = defaultAccessPolicy,
  fetchImpl = globalThis.fetch,
  getPaymongoSecretKey,
  getPaymongoWebhookSecret,
  getAppUrl = () => 'https://racepulseph.web.app',
  getRateLimitSecret = () => process.env.RATE_LIMIT_SALT || '',
  appCheckMode,
  turnstileMode,
  now = Date.now,
}) {
  async function requireUser(request, action) {
    const header = request.get('authorization') || '';
    if (!header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Please sign in to continue.');
    }
    let user;
    try {
      user = await admin.auth().verifyIdToken(header.slice(7), true);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    const [profile, access] = await Promise.all([
      db.doc(`users/${user.uid}`).get(),
      db.doc(`userAccess/${user.uid}`).get(),
    ]);
    if (!profile.exists) {
      throw new HttpError(403, 'Finish creating your account before continuing.');
    }
    if (action && !accessPolicy.can(profile.data(), access.data(), action)) {
      throw new HttpError(403, 'This action is disabled for your account.');
    }
    return user;
  }

  function verifyWebhookSignature(request) {
    const signature = request.get('paymongo-signature');
    if (!signature) return false;
    const fields = Object.fromEntries(
      signature.split(',').map((part) => {
        const [key, ...rest] = part.trim().split('=');
        return [key, rest.join('=')];
      }),
    );
    const timestamp = fields.t;
    const tsSeconds = Number(timestamp);
    const rawBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.toString('utf8')
      : JSON.stringify(request.body || {});
    const nowSec = now() / 1000;
    if (
      !timestamp ||
      !Number.isFinite(tsSeconds) ||
      Math.abs(nowSec - tsSeconds) > WEBHOOK_MAX_AGE_SECONDS ||
      !rawBody
    ) {
      return false;
    }

    const secretKey = String(getPaymongoSecretKey() || '');
    const expectsLive = secretKey.startsWith('sk_' + 'live_');
    const payload = request.body || {};
    const livemode = Boolean(payload?.data?.attributes?.livemode);
    if (expectsLive && !livemode) {
      return false;
    }

    const candidate = livemode ? fields.li : fields.te;
    const expected = crypto
      .createHmac('sha256', getPaymongoWebhookSecret())
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    if (!candidate || candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  }

  async function createCheckout(request, response) {
    let decoded;
    let registration;
    try {
      await verifyAppCheckRequest(request, { admin, mode: appCheckMode });
      assertHumanFormSignals(request.body);
      await verifyTurnstileRequest(request, { expectedAction: 'checkout', mode: turnstileMode });
      decoded = await requireUser(request, 'personal.checkout');
      const clientIp = extractClientIp(request);
      const secret = getRateLimitSecret();
      await Promise.all([
        enforceRateLimit({
          db,
          secret,
          namespace: 'pay_chk_u',
          identifier: decoded.uid,
          limit: 8,
          windowMs: 15 * 60 * 1000,
          message: 'Too many checkout attempts. Please wait a few minutes before retrying.',
          penaltyMultiplier: 1.5,
          now,
        }),
        enforceRateLimit({
          db,
          secret,
          namespace: 'pay_chk_i',
          identifier: clientIp,
          limit: 30,
          windowMs: 60 * 60 * 1000,
          message: 'Too many checkout attempts from this network. Please try again later.',
          penaltyMultiplier: 1.5,
          now,
        }),
      ]);
      registration = registrationFromRequest(request.body?.registration);
    } catch (error) {
      if (error instanceof GuardError || error instanceof HttpError) {
        return sendGuardError(response, error);
      }
      console.error('Checkout precheck failed', { code: error?.code || 'internal' });
      return sendJson(response, 500, { error: 'Unable to prepare checkout right now. Please try again.' });
    }

    const raceRef = db.doc(`races/${registration.raceId}`);
    const runnerRef = db.doc(`runners/${decoded.uid}_${registration.raceId}`);
    const pendingRef = db.doc(`pendingRegistrations/${decoded.uid}_${registration.raceId}`);
    let race;
    try {
      const raceSnapshot = await raceRef.get();
      if (!raceSnapshot.exists) throw new HttpError(400, 'This race is no longer available.');
      race = raceSnapshot.data();
      if (race.registrationOpen === false || !race.onlinePaymentEnabled) {
        throw new HttpError(400, 'Online registration is not open for this race.');
      }
      if (race.registrationCloseDate && race.registrationCloseDate < manilaDateToday(now())) {
        throw new HttpError(400, 'Registration for this race has closed.');
      }
      const distance = (race.distances || []).find((item) => item.label === registration.distance);
      if (!distance || !Number.isFinite(Number(distance.price)) || Number(distance.price) <= 0) {
        throw new HttpError(400, 'Choose a paid race distance configured by the organizer.');
      }
      const allowedEntries = Array.isArray(race.entryCategories) && race.entryCategories.length
        ? race.entryCategories
        : ['solo'];
      if (!allowedEntries.includes(registration.entryCategory)) {
        throw new HttpError(400, 'This entry category is unavailable for the selected race.');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(response, error.status, { error: error.message });
      }
      console.error('Race checkout validation failed', { raceId: registration.raceId, code: error?.code || 'internal' });
      return sendJson(response, 500, { error: 'Unable to validate this race right now. Please try again.' });
    }

    const distance = race.distances.find((item) => item.label === registration.distance);
    const amount = Math.round(Number(distance.price) * 100);
    const passOnFees = race.paymentFeeMode === 'passed_on';
    const currentMs = now();
    const paymentId = `pay_${currentMs}_${crypto.randomBytes(9).toString('hex')}`;
    const paymentRef = db.doc(`payments/${paymentId}`);
    let reusable;

    try {
      await db.runTransaction(async (transaction) => {
        const [runnerSnapshot, pendingSnapshot] = await Promise.all([
          transaction.get(runnerRef),
          transaction.get(pendingRef),
        ]);
        if (runnerSnapshot.exists) {
          throw new HttpError(409, 'You are already registered for this race.');
        }
        const pending = pendingSnapshot.exists ? pendingSnapshot.data() : null;
        if (pending && pending.status === 'creating') {
          const creatingAgeMs = currentMs - new Date(pending.createdAt || 0).getTime();
          if (Number.isFinite(creatingAgeMs) && creatingAgeMs < CREATING_LOCK_WINDOW_MS) {
            throw new HttpError(
              409,
              'A checkout session is already being prepared for this registration. Wait a moment and retry.',
              5,
              'checkout_in_progress',
            );
          }
        }
        const freshPending =
          pending &&
          pending.status === 'pending' &&
          currentMs - new Date(pending.createdAt || 0).getTime() < PENDING_REUSE_WINDOW_MS;
        if (freshPending && pending.checkoutUrl && pending.paymentId) {
          reusable = { paymentId: pending.paymentId, checkoutUrl: pending.checkoutUrl };
          return;
        }
        const nowIso = new Date(currentMs).toISOString();
        const record = {
          paymentId,
          uid: decoded.uid,
          raceId: registration.raceId,
          raceName: race.name,
          km: distance.km,
          amount,
          currency: 'PHP',
          passOnFees,
          status: 'creating',
          registration,
          createdAt: nowIso,
        };
        transaction.set(paymentRef, record);
        transaction.set(pendingRef, { ...record, status: 'creating' });
      });
    } catch (error) {
      if (error instanceof HttpError || error instanceof GuardError) {
        return sendGuardError(response, error);
      }
      console.error('Checkout reservation transaction failed', { uid: decoded.uid, raceId: registration.raceId, code: error?.code || 'internal' });
      return sendJson(response, 500, { error: 'Unable to start checkout right now. Please try again.' });
    }

    if (reusable) return sendJson(response, 200, reusable);

    try {
      const origin = String(getAppUrl() || 'https://racepulseph.web.app').replace(/\/$/, '');
      const paymongoResponse = await fetchImpl('https://api.paymongo.com/v2/checkout_sessions', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${getPaymongoSecretKey()}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': paymentId,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              billing: {
                name: registration.fullName,
                email: decoded.email || '',
                phone: registration.emergencyContactPhone,
              },
              line_items: [{ name: `${race.name}: ${registration.distance}`, amount, currency: 'PHP', quantity: 1 }],
              payment_method_types: ['card', 'gcash', 'paymaya', 'qrph'],
              reference_number: paymentId,
              success_url: `${origin}/?payment=${encodeURIComponent(paymentId)}`,
              cancel_url: `${origin}/?payment=${encodeURIComponent(paymentId)}`,
              send_email_receipt: true,
              show_description: true,
              show_line_items: true,
              ...(passOnFees ? { pass_on_fees: true } : {}),
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await paymongoResponse.json();
      const checkoutUrl = result?.data?.attributes?.checkout_url;
      if (!paymongoResponse.ok || !checkoutUrl) {
        throw new Error(result?.errors?.[0]?.detail || 'PayMongo did not create a checkout session.');
      }
      const checkoutSessionId = result.data.id;
      const updatedIso = new Date(now()).toISOString();
      await Promise.all([
        paymentRef.update({ status: 'pending', checkoutSessionId, checkoutUrl, updatedAt: updatedIso }),
        pendingRef.update({ status: 'pending', checkoutSessionId, checkoutUrl, updatedAt: updatedIso }),
      ]);
      return sendJson(response, 200, { paymentId, checkoutUrl });
    } catch (error) {
      console.error('PayMongo checkout creation failed', { paymentId, message: error.message });
      const failedIso = new Date(now()).toISOString();
      await Promise.all([
        paymentRef
          .update({ status: 'failed', failureReason: 'checkout_creation_failed', updatedAt: failedIso })
          .catch((cleanupErr) => console.warn('Payment failure record update failed', { paymentId, code: cleanupErr?.code || 'unknown' })),
        pendingRef
          .update({ status: 'failed', updatedAt: failedIso })
          .catch((cleanupErr) => console.warn('Pending registration failure update failed', { paymentId, code: cleanupErr?.code || 'unknown' })),
      ]);
      return sendJson(response, 502, { error: 'Unable to open secure checkout. Please try again.' });
    }
  }

  async function getStatus(request, response, paymentId) {
    try {
      await verifyAppCheckRequest(request, { admin, mode: appCheckMode });
      const decoded = await requireUser(request);
      await enforceRateLimit({
        db,
        secret: getRateLimitSecret(),
        namespace: 'pay_stat_u',
        identifier: decoded.uid,
        limit: 45,
        windowMs: 10 * 60 * 1000,
        message: 'Too many payment status checks. Please wait a moment before refreshing.',
        memoryOnly: true,
        now,
      });
      const paymentSnapshot = await db.doc(`payments/${paymentId}`).get();
      if (!paymentSnapshot.exists || paymentSnapshot.data().uid !== decoded.uid) {
        return sendJson(response, 404, { error: 'Payment not found.' });
      }
      return sendJson(response, 200, publicPayment(paymentSnapshot.data()));
    } catch (error) {
      if (error instanceof GuardError || error instanceof HttpError) {
        return sendGuardError(response, error);
      }
      console.error('Payment status lookup failed', { paymentId, code: error?.code || 'internal' });
      return sendJson(response, 500, { error: 'Unable to check payment status right now.' });
    }
  }

  async function handleWebhook(request, response) {
    const clientIp = extractClientIp(request);
    if (!verifyWebhookSignature(request)) {
      try {
        await enforceRateLimit({
          db,
          secret: getRateLimitSecret(),
          namespace: 'pay_wh_bad',
          identifier: clientIp,
          limit: 20,
          windowMs: 5 * 60 * 1000,
          message: 'Too many invalid webhook signatures.',
          memoryOnly: true,
          penaltyMultiplier: 2,
          now,
        });
      } catch (error) {
        return sendGuardError(response, error);
      }
      return sendJson(response, 401, { error: 'Invalid webhook signature.' });
    }

    const event = request.body?.data?.attributes;
    if (event?.type !== 'checkout_session.payment.paid') {
      return sendJson(response, 200, { received: true });
    }
    const checkoutSession = event.data;
    const checkoutAttributes = checkoutSession?.attributes || {};
    const paymentId = checkoutAttributes.reference_number;
    if (typeof paymentId !== 'string' || !paymentId.startsWith('pay_')) {
      return sendJson(response, 200, { received: true });
    }

    const paymentRef = db.doc(`payments/${paymentId}`);
    try {
      await db.runTransaction(async (transaction) => {
        const paymentSnapshot = await transaction.get(paymentRef);
        if (!paymentSnapshot.exists) {
          throw new HttpError(400, 'Unknown payment reference.');
        }
        const payment = paymentSnapshot.data();
        if (payment.status === 'paid') return;
        if (payment.checkoutSessionId && payment.checkoutSessionId !== checkoutSession.id) {
          throw new HttpError(400, 'Checkout session does not match payment reference.');
        }

        const paidPayment = checkoutAttributes.payments?.find((entry) => entry?.attributes?.status === 'paid');
        if (!paidPayment) {
          throw new HttpError(400, 'No paid payment entry was attached to this checkout session.');
        }
        const paidAmount = Number(paidPayment?.attributes?.amount);
        const paidCurrency = String(paidPayment?.attributes?.currency || '').toUpperCase();
        const expectedCurrency = String(payment.currency || 'PHP').toUpperCase();
        const validAmount = payment.passOnFees
          ? Number.isInteger(paidAmount) && paidAmount >= payment.amount
          : Number.isInteger(paidAmount) && paidAmount === payment.amount;
        if (!validAmount || paidCurrency !== expectedCurrency) {
          throw new HttpError(400, 'Paid amount or currency does not match payment record.');
        }

        const registration = payment.registration;
        const runnerRef = db.doc(`runners/${payment.uid}_${payment.raceId}`);
        const pendingRef = db.doc(`pendingRegistrations/${payment.uid}_${payment.raceId}`);
        const counterRef = db.doc(
          `bibCounters/${counterIdFor(payment.raceId, registration.distance, registration.entryCategory)}`,
        );
        const [runnerSnapshot, counterSnapshot] = await Promise.all([
          transaction.get(runnerRef),
          transaction.get(counterRef),
        ]);
        if (runnerSnapshot.exists && runnerSnapshot.data().paymentId !== paymentId) {
          throw new HttpError(409, 'Registration already exists for this runner.');
        }
        const next = Number(counterSnapshot.exists ? counterSnapshot.data().count : 0) + 1;
        const bibNumber = `${bibPrefix(payment.km, registration.entryCategory)}-${String(next).padStart(3, '0')}`;
        const paidAt = new Date(now()).toISOString();
        const paymentMethod = paidPayment?.attributes?.source?.type || 'paymongo';

        transaction.set(counterRef, { count: next, raceId: payment.raceId }, { merge: true });
        transaction.set(
          runnerRef,
          {
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
            ...(registration.parentalConsentConfirmed
              ? {
                  parentalConsentConfirmed: true,
                  parentalGuardianName: String(registration.parentalGuardianName || '').toUpperCase(),
                  parentalGuardianRelationship: String(registration.parentalGuardianRelationship || '').toUpperCase(),
                }
              : {}),
            ...(registration.termsAcceptedAt ? { termsAcceptedAt: registration.termsAcceptedAt } : {}),
            ...(typeof registration.marketingOptIn === 'boolean' ? { marketingOptIn: registration.marketingOptIn } : {}),
            paymentStatus: 'paid',
            paymentId,
            paymentMethod,
            amountCentavos: payment.amount,
            paymentAmount: payment.amount / 100,
            paymentPaidAt: paidAt,
            createdAt: paidAt,
          },
          { merge: true },
        );
        transaction.set(
          paymentRef,
          {
            status: 'paid',
            paymentMethod,
            paidAt,
            registrationId: `${payment.uid}_${payment.raceId}`,
            updatedAt: paidAt,
          },
          { merge: true },
        );
        transaction.set(
          pendingRef,
          {
            status: 'paid',
            paymentId,
            registrationId: `${payment.uid}_${payment.raceId}`,
            updatedAt: paidAt,
          },
          { merge: true },
        );
      });
    } catch (error) {
      if (error instanceof HttpError) {
        console.warn('PayMongo webhook rejected', { paymentId, status: error.status, code: error.code });
        return sendJson(response, error.status, { error: error.message });
      }
      console.error('PayMongo webhook processing failed', { paymentId, code: error?.code || 'internal' });
      return sendJson(response, 500, { error: 'Webhook processing failed.' });
    }

    return sendJson(response, 200, { received: true });
  }

  return async function handlePaymentsRequest(request, response) {
    applyApiSecurityHeaders(response);
    setScopedCors(request, response, {
      allowedOrigins: getPaymentsAllowedOrigins(),
      methods: 'GET, POST, OPTIONS',
    });
    if (request.method === 'OPTIONS') return response.status(204).send('');
    if (
      request.method === 'POST' &&
      (!request.is('application/json') ||
        (request.rawBody?.length || 0) > 65536 ||
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body))
    ) {
      return sendJson(response, 400, { error: 'Invalid request.' });
    }
    const path = (request.path || '/').replace(/\/+$/, '') || '/';
    if (request.method === 'POST' && path === '/checkout') return createCheckout(request, response);
    if (request.method === 'POST' && path === '/webhooks/paymongo') return handleWebhook(request, response);
    const statusMatch = request.method === 'GET' && path.match(/^\/payments\/(pay_[a-zA-Z0-9_]+)$/);
    if (statusMatch) return getStatus(request, response, statusMatch[1]);
    return sendJson(response, 404, { error: 'Route not found.' });
  };
}

module.exports = {
  createPaymentsApp,
  getPaymentsAllowedOrigins,
  HttpError,
};
