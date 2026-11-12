const crypto = require('node:crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { createAccountSecurity, AccountError } = require('./account-security');
const { accountMessage } = require('./account-email');

const smtpPassword = defineSecret('SMTP_APP_PASSWORD');
const codeSecret = defineSecret('AUTH_CODE_SECRET');
const smtpUser = defineString('SMTP_USER', { default: 'events@racepulseph.com' });
const appOrigin = defineString('APP_ORIGIN', { default: 'https://racepulseph.com' });

function emailHash(secret, email) {
  return crypto.createHmac('sha256', secret).update(`pref:${email.trim().toLowerCase()}`).digest('hex');
}

function createUnsubscribeToken(secret, email) {
  const normalized = String(email || '').trim().toLowerCase();
  const payload = Buffer.from(JSON.stringify({ email: normalized, iat: Date.now() }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`unsub:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUnsubscribeToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.', 2);
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(`unsub:${payload}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) return null;
    return parsed.email.trim().toLowerCase();
  } catch {
    return null;
  }
}

async function deleteQueryDocs(db, docs, transformBatch) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + 400);
    chunk.forEach((docSnap) => transformBatch(batch, docSnap));
    await batch.commit();
  }
}

/**
 * Purges user PII and anonymizes historical payment/order accounting rows across Firestore,
 * then deletes the Firebase Authentication account.
 */
async function purgeAndAnonymizeUserAccount({ db, auth, uid }) {
  const userDoc = await db.doc(`users/${uid}`).get();
  const username = userDoc.exists ? String(userDoc.data()?.username || '').trim().toLowerCase() : '';

  const [
    runnersSnap,
    claimsSnap,
    pendingSnap,
    sentFriendReqSnap,
    recvFriendReqSnap,
    friendshipsSnap,
    sentInvitesSnap,
    recvInvitesSnap,
    paymentsSnap,
    ordersSnap,
  ] = await Promise.all([
    db.collection('runners').where('uid', '==', uid).get(),
    db.collection('runnerClaims').where('uid', '==', uid).get(),
    db.collection('pendingRegistrations').where('uid', '==', uid).get(),
    db.collection('friendRequests').where('fromUid', '==', uid).get(),
    db.collection('friendRequests').where('toUid', '==', uid).get(),
    db.collection('friendships').where('users', 'array-contains', uid).get(),
    db.collection('raceInvites').where('senderUid', '==', uid).get(),
    db.collection('raceInvites').where('recipientUid', '==', uid).get(),
    db.collection('payments').where('uid', '==', uid).get(),
    db.collection('orders').where('ownerUid', '==', uid).get(),
  ]);

  const toDelete = [
    ...runnersSnap.docs.map((d) => d.ref),
    ...claimsSnap.docs.map((d) => d.ref),
    ...pendingSnap.docs.map((d) => d.ref),
    ...sentFriendReqSnap.docs.map((d) => d.ref),
    ...recvFriendReqSnap.docs.map((d) => d.ref),
    ...friendshipsSnap.docs.map((d) => d.ref),
    ...sentInvitesSnap.docs.map((d) => d.ref),
    ...recvInvitesSnap.docs.map((d) => d.ref),
    db.doc(`friendProfiles/${uid}`),
    db.doc(`friendActivities/${uid}`),
    db.doc(`userAccess/${uid}`),
    db.doc(`users/${uid}`),
  ];

  if (username) {
    toDelete.push(db.doc(`friendDirectory/${username}`));
    toDelete.push(db.doc(`usernameIndex/${username}`));
  }

  let purgedDocs = 0;
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = db.batch();
    toDelete.slice(i, i + 400).forEach((ref) => {
      batch.delete(ref);
      purgedDocs += 1;
    });
    await batch.commit();
  }

  const nowIso = new Date().toISOString();
  let anonymizedDocs = 0;
  await deleteQueryDocs(db, paymentsSnap.docs, (batch, docSnap) => {
    const existing = docSnap.data() || {};
    const sanitizedReg = existing.registration
      ? {
          ...existing.registration,
          fullName: 'Deleted Runner',
          emergencyContactName: '',
          emergencyContactPhone: '',
          medicalNotes: '',
          parentalGuardianName: '',
        }
      : undefined;
    batch.update(docSnap.ref, {
      uid: 'deleted_account',
      anonymizedAt: nowIso,
      ...(sanitizedReg ? { registration: sanitizedReg } : {}),
    });
    anonymizedDocs += 1;
  });

  await deleteQueryDocs(db, ordersSnap.docs, (batch, docSnap) => {
    batch.update(docSnap.ref, {
      ownerUid: 'deleted_account',
      runnerName: 'Deleted Runner',
      customInscription: '',
      anonymizedAt: nowIso,
    });
    anonymizedDocs += 1;
  });

  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }

  return { deleted: true, purgedDocs, anonymizedDocs };
}

async function applyMarketingPreference({ db, secret, email, marketingOptIn }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new AccountError(400, 'Enter a valid email address.');
  }
  const nowIso = new Date().toISOString();
  await db.doc(`emailPreferences/${emailHash(secret, normalizedEmail)}`).set(
    {
      emailHash: emailHash(secret, normalizedEmail),
      marketingOptIn: Boolean(marketingOptIn),
      updatedAt: nowIso,
    },
    { merge: true }
  );

  const usersSnap = await db.collection('users').where('email', '==', normalizedEmail).limit(5).get();
  if (!usersSnap.empty) {
    const batch = db.batch();
    usersSnap.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        marketingOptIn: Boolean(marketingOptIn),
        marketingUpdatedAt: nowIso,
      });
    });
    await batch.commit();
  }
}

exports.accountApi = onRequest({
  region: 'asia-southeast1',
  secrets: [smtpPassword, codeSecret],
  cors: ['https://racepulseph.com', 'https://www.racepulseph.com', 'https://racepulseph.web.app', 'https://racepulseph.firebaseapp.com', 'http://localhost', 'https://localhost', 'capacitor://localhost', 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  maxInstances: 10,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const route = (request.path || '/').replace(/\/+$/, '');
  const db = admin.firestore();
  const auth = admin.auth();
  const secret = codeSecret.value();

  try {
    // Unauthenticated RFC 8058 one-click unsubscribe GET or POST handler.
    if (route === '/unsubscribe' && (request.method === 'POST' || request.method === 'GET')) {
      const tokenParam = request.method === 'GET' ? request.query?.token : request.body?.token;
      const emailParam = request.method === 'GET' ? request.query?.email : request.body?.email;
      const optIn = request.method === 'POST' && request.body?.marketingOptIn === true;

      let targetEmail = tokenParam ? verifyUnsubscribeToken(secret, String(tokenParam)) : null;
      if (tokenParam && !targetEmail) {
        throw new AccountError(400, 'This unsubscribe link is invalid or corrupted.');
      }
      if (!targetEmail && typeof emailParam === 'string') {
        targetEmail = emailParam.trim().toLowerCase();
      }
      if (!targetEmail) {
        throw new AccountError(400, 'Provide a valid unsubscribe token or email address.');
      }

      await applyMarketingPreference({ db, secret, email: targetEmail, marketingOptIn: optIn });
      return response.json({ unsubscribed: !optIn, email: targetEmail, marketingOptIn: optIn });
    }

    if (request.method !== 'POST') return response.status(405).json({ error: 'Use POST for account requests.' });
    if (!request.is('application/json') || (request.rawBody?.length || 0) > 8192) {
      return response.status(400).json({ error: 'Invalid account request.' });
    }

    if (route === '/account/delete') {
      const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AccountError(401, 'Please sign in again before deleting your account.');
      let decoded;
      try {
        decoded = await auth.verifyIdToken(token, true);
      } catch {
        throw new AccountError(401, 'Your session has expired. Please sign in again.');
      }
      if (String(request.body?.confirmation || '').trim().toUpperCase() !== 'DELETE') {
        throw new AccountError(400, 'Confirmation keyword DELETE is required.');
      }
      const outcome = await purgeAndAnonymizeUserAccount({ db, auth, uid: decoded.uid });
      return response.json(outcome);
    }

    if (route === '/account/preferences') {
      const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AccountError(401, 'Please sign in to update communication preferences.');
      let decoded;
      try {
        decoded = await auth.verifyIdToken(token, true);
      } catch {
        throw new AccountError(401, 'Your session has expired. Please sign in again.');
      }
      const userRecord = await auth.getUser(decoded.uid);
      if (!userRecord.email) throw new AccountError(400, 'Account has no email address.');
      const nextOptIn = Boolean(request.body?.marketingOptIn);
      await applyMarketingPreference({ db, secret, email: userRecord.email, marketingOptIn: nextOptIn });
      return response.json({ updated: true, marketingOptIn: nextOptIn });
    }

    const service = createAccountSecurity({
      db, auth, secret,
      sendCode: async ({ email, name, purpose, code }) => {
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com', port: 465, secure: true,
          auth: { user: smtpUser.value(), pass: smtpPassword.value().replace(/\s/g, '') },
          connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
          logger: false, debug: false,
        });
        const unsubToken = createUnsubscribeToken(secret, email);
        const unsubscribeUrl = `${appOrigin.value().replace(/\/$/, '')}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
        await transporter.sendMail(accountMessage({ sender: smtpUser.value(), email, purpose, name, code, unsubscribeUrl }));
      },
    });
    const input = { ...request.body, ip: request.ip, uid: undefined };
    if (route.startsWith('/verification/')) {
      const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AccountError(401, 'Please sign in again to verify your email.');
      try { input.uid = (await auth.verifyIdToken(token, true)).uid; }
      catch { throw new AccountError(401, 'Your session has expired. Please sign in again.'); }
      input.purpose = 'verify';
    } else {
      input.purpose = 'reset';
    }
    let result;
    if (route === '/verification/request' || route === '/password/request') result = await service.requestCode(input);
    else if (route === '/verification/confirm' || route === '/password/confirm') result = await service.checkCode(input);
    else if (route === '/password/complete') result = await service.resetPassword(input);
    else return response.status(404).json({ error: 'Account route not found.' });
    return response.json(result);
  } catch (error) {
    if (error instanceof AccountError) {
      if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
      return response.status(error.status).json({ error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    // Never include request bodies, tokens, codes, passwords or SMTP errors in logs.
    console.error('Account request failed', { route, category: 'internal' });
    return response.status(500).json({ error: 'Could not complete this request. Please try again.' });
  }
});
