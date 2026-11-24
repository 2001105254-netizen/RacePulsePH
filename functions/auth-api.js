const crypto = require('node:crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { createAccountSecurity, AccountError } = require('./account-security');
const { accountMessage } = require('./account-email');
const { searchRunnerDirectory } = require('./friend-search');
const {
  applyApiSecurityHeaders,
  assertHumanFormSignals,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  GuardError,
  setScopedCors,
  verifyAppCheckRequest,
  verifyTurnstileRequest,
} = require('./request-guard');

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

const UNSUBSCRIBE_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
    if (typeof parsed?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parsed.email)) return null;
    if (typeof parsed?.iat !== 'number' || !Number.isFinite(parsed.iat)) return null;
    const age = Date.now() - parsed.iat;
    if (age > UNSUBSCRIBE_TOKEN_MAX_AGE_MS || parsed.iat > Date.now() + 60_000) return null;
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
/**
 * Purges user PII and anonymizes historical payment/order accounting rows across Firestore,
 * cleans up owned storage prefixes on a best-effort basis, and deletes the Firebase Auth account.
 */
async function purgeAndAnonymizeUserAccount({ db, auth, storage = null, uid }) {
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
    usernameIndexSnap,
    friendDirSnap,
    bibClaimLocksSnap,
    recordedRunsSnap,
  ] = await Promise.all([
    db.collection('runners').where('uid', '==', uid).get(),
    db.collection('runnerClaims').where('uid', '==', uid).get(),
    db.collection('pendingRegistrations').where('uid', '==', uid).get(),
    db.collection('friendRequests').where('fromUid', '==', uid).get(),
    db.collection('friendRequests').where('toUid', '==', uid).get(),
    db.collection('friendships').where('members', 'array-contains', uid).get(),
    db.collection('raceInvites').where('fromUid', '==', uid).get(),
    db.collection('raceInvites').where('toUid', '==', uid).get(),
    db.collection('payments').where('uid', '==', uid).get(),
    db.collection('orders').where('ownerUid', '==', uid).get(),
    db.collection('usernameIndex').where('uid', '==', uid).get(),
    db.collection('friendDirectory').where('uid', '==', uid).get(),
    db.collection('bibClaimLocks').where('uid', '==', uid).get(),
    db.collection('recordedRuns').where('uid', '==', uid).get(),
  ]);

  const deleteByPath = new Map();
  const enqueueDelete = (ref) => {
    if (ref?.path && !deleteByPath.has(ref.path)) {
      deleteByPath.set(ref.path, ref);
    }
  };

  [
    ...runnersSnap.docs,
    ...claimsSnap.docs,
    ...pendingSnap.docs,
    ...sentFriendReqSnap.docs,
    ...recvFriendReqSnap.docs,
    ...friendshipsSnap.docs,
    ...sentInvitesSnap.docs,
    ...recvInvitesSnap.docs,
    ...usernameIndexSnap.docs,
    ...friendDirSnap.docs,
    ...bibClaimLocksSnap.docs,
    ...recordedRunsSnap.docs,
  ].forEach((d) => enqueueDelete(d.ref));

  [
    db.doc(`friendProfiles/${uid}`),
    db.doc(`friendActivities/${uid}`),
    db.doc(`userAccess/${uid}`),
    db.doc(`users/${uid}`),
  ].forEach(enqueueDelete);

  if (username) {
    enqueueDelete(db.doc(`friendDirectory/${username}`));
    enqueueDelete(db.doc(`usernameIndex/${username}`));
  }

  const toDelete = Array.from(deleteByPath.values());
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

  if (storage && typeof storage.bucket === 'function') {
    try {
      const bucket = storage.bucket();
      if (bucket && typeof bucket.deleteFiles === 'function') {
        const prefixes = [
          `race-assets/${uid}/`,
          `route-private/${uid}/`,
          `highlight-assets/${uid}/`,
          `race-bib-fonts/${uid}/`,
          `run-tracks/${uid}/`,
        ];
        await Promise.allSettled(
          prefixes.map((prefix) => bucket.deleteFiles({ prefix, force: true }).catch(() => {})),
        );
      }
    } catch {
      console.warn('Best-effort storage cleanup during account purge encountered an error');
    }
  }

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

function getAccountCorsOrigins() {
  return getDefaultAllowedOrigins();
}

function createAccountApp({
  admin,
  db: providedDb = null,
  auth: providedAuth = null,
  storage: providedStorage = null,
  getCodeSecret,
  getSmtpPassword,
  getSmtpUser = () => 'events@racepulseph.com',
  getAppOrigin = () => 'https://racepulseph.com',
  appCheckMode,
  turnstileMode,
} = {}) {
  return async (request, response) => {
    const db = providedDb || admin.firestore();
    const auth = providedAuth || admin.auth();
    const storage = providedStorage ?? (typeof admin?.storage === 'function' ? admin.storage() : null);
    applyApiSecurityHeaders(response);
    setScopedCors(request, response, {
      allowedOrigins: getAccountCorsOrigins(),
      methods: 'POST, OPTIONS',
    });
    if (request.method === 'OPTIONS') {
      return response.status(204).send('');
    }

    const route = (request.path || '/').replace(/\/+$/, '');
    const secret = getCodeSecret();
    const clientIp = extractClientIp(request);

    async function enforceUnsubscribeIpLimit(ip) {
      await enforceRateLimit({
        db,
        secret,
        namespace: 'unsub',
        identifier: ip,
        limit: 30,
        windowMs: 3600 * 1000,
        message: 'Too many requests. Please try again later.',
        penaltyMultiplier: 1.5,
      });
    }

    try {
      // Unauthenticated GET is rejected (405) so prefetchers/scanners cannot mutate preferences;
      // one-click unsubscribe UI submits via POST /unsubscribe.
      if (route === '/unsubscribe') {
        if (request.method !== 'POST') {
          response.set('Allow', 'POST');
          return response.status(405).json({ error: 'Use POST for unsubscribe requests.' });
        }
        if (!request.is('application/json') || (request.rawBody?.length || 0) > 8192 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
          throw new AccountError(400, 'Invalid unsubscribe request.');
        }
        await enforceUnsubscribeIpLimit(clientIp);
        const tokenParam = request.body?.token;
        const emailParam = request.body?.email;
        const optIn = request.body?.marketingOptIn === true;

        const tokenEmail = tokenParam ? verifyUnsubscribeToken(secret, String(tokenParam)) : null;
        if (tokenParam && !tokenEmail) {
          throw new AccountError(400, 'This unsubscribe link is invalid or corrupted.');
        }
        let targetEmail = tokenEmail;
        if (!targetEmail && typeof emailParam === 'string') {
          const cleaned = emailParam.trim().toLowerCase();
          if (cleaned.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned)) {
            targetEmail = cleaned;
          }
        }
        if (!targetEmail) {
          throw new AccountError(400, 'Provide a valid unsubscribe token or email address.');
        }
        if (optIn) {
          let authorizedOptIn = Boolean(tokenEmail && tokenEmail === targetEmail);
          if (!authorizedOptIn) {
            const bearer = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
            if (bearer) {
              try {
                const decoded = await auth.verifyIdToken(bearer, true);
                authorizedOptIn = typeof decoded.email === 'string' && decoded.email.trim().toLowerCase() === targetEmail;
              } catch {
                authorizedOptIn = false;
              }
            }
          }
          if (!authorizedOptIn) {
            throw new AccountError(403, 'Sign in or use your email unsubscribe link to opt back in.');
          }
        }

        await applyMarketingPreference({ db, secret, email: targetEmail, marketingOptIn: optIn });
        return response.json({ unsubscribed: !optIn, email: targetEmail, marketingOptIn: optIn });
      }

      if (request.method !== 'POST') {
        response.set('Allow', 'POST');
        return response.status(405).json({ error: 'Use POST for account requests.' });
      }
      if (!request.is('application/json') || (request.rawBody?.length || 0) > 8192 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        return response.status(400).json({ error: 'Invalid account request.' });
      }
      await verifyAppCheckRequest(request, { admin, mode: appCheckMode });

      if (route === '/account/delete') {
        const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
        if (!token) throw new AccountError(401, 'Please sign in again before deleting your account.');
        let decoded;
        try {
          decoded = await auth.verifyIdToken(token, true);
        } catch {
          throw new AccountError(401, 'Your session has expired. Please sign in again.');
        }
        await enforceRateLimit({
          db,
          secret,
          namespace: 'acct_del',
          identifier: decoded.uid,
          limit: 5,
          windowMs: 3600 * 1000,
          message: 'Too many account deletion attempts. Please try again later.',
        });
        if (String(request.body?.confirmation || '').trim().toUpperCase() !== 'DELETE') {
          throw new AccountError(400, 'Confirmation keyword DELETE is required.');
        }
        const outcome = await purgeAndAnonymizeUserAccount({ db, auth, storage, uid: decoded.uid });
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
        await enforceRateLimit({
          db,
          secret,
          namespace: 'acct_pref',
          identifier: decoded.uid,
          limit: 20,
          windowMs: 15 * 60 * 1000,
          message: 'Too many preference updates. Please wait a moment.',
        });
        const userRecord = await auth.getUser(decoded.uid);
        if (!userRecord.email) throw new AccountError(400, 'Account has no email address.');
        const nextOptIn = Boolean(request.body?.marketingOptIn);
        await applyMarketingPreference({ db, secret, email: userRecord.email, marketingOptIn: nextOptIn });
        return response.json({ updated: true, marketingOptIn: nextOptIn });
      }

      if (route === '/friends/search') {
        const token = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
        if (!token) throw new AccountError(401, 'Please sign in to search runners.');
        let decoded;
        try {
          decoded = await auth.verifyIdToken(token, true);
        } catch {
          throw new AccountError(401, 'Your session has expired. Please sign in again.');
        }
        const outcome = await searchRunnerDirectory({
          db,
          secret,
          callerUid: decoded.uid,
          rawQuery: request.body?.query,
        });
        return response.json(outcome);
      }

      if (route === '/auth/resolve-username') {
        assertHumanFormSignals(request.body);
        await enforceRateLimit({
          db,
          secret,
          namespace: 'username_lookup',
          identifier: clientIp,
          limit: 20,
          windowMs: 15 * 60 * 1000,
          message: 'Too many sign-in lookup attempts. Please wait a moment.',
          penaltyMultiplier: 1.5,
        });
        const cleaned = String(request.body?.username || '').trim().replace(/^@+/, '').toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(cleaned)) {
          throw new AccountError(400, '3 to 24 characters: letters, numbers, dot, underscore, or hyphen.');
        }
        const indexSnap = await db.doc(`usernameIndex/${cleaned}`).get();
        const email = indexSnap.exists ? String(indexSnap.data()?.email || '').trim().toLowerCase() : '';
        if (!indexSnap.exists || !email) {
          throw new AccountError(404, 'No account found for that username. Try your email address instead.');
        }
        return response.json({ email });
      }

      assertHumanFormSignals(request.body);
      if (route === '/password/request') {
        await verifyTurnstileRequest(request, { expectedAction: 'password_reset', mode: turnstileMode });
      }

      const service = createAccountSecurity({
        db, auth, secret,
        sendCode: async ({ email, name, purpose, code }) => {
          const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 465, secure: true,
            auth: { user: getSmtpUser(), pass: getSmtpPassword().replace(/\s/g, '') },
            connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
            logger: false, debug: false,
          });
          const unsubToken = createUnsubscribeToken(secret, email);
          const unsubscribeUrl = `${getAppOrigin().replace(/\/$/, '')}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
          await transporter.sendMail(accountMessage({ sender: getSmtpUser(), email, purpose, name, code, unsubscribeUrl }));
        },
      });
      const input = { ...request.body, ip: clientIp, uid: undefined };
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
      if (error instanceof AccountError || error instanceof GuardError) {
        if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
        return response.status(error.status).json({ error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
      }
      // Never include request bodies, tokens, codes, passwords or SMTP errors in logs.
      console.error('Account request failed', { route, category: 'internal' });
      return response.status(500).json({ error: 'Could not complete this request. Please try again.' });
    }
  };
}

const accountHandler = createAccountApp({
  admin,
  getCodeSecret: () => codeSecret.value(),
  getSmtpPassword: () => smtpPassword.value(),
  getSmtpUser: () => smtpUser.value(),
  getAppOrigin: () => appOrigin.value(),
});

exports.accountApi = onRequest({
  region: 'asia-southeast1',
  secrets: [smtpPassword, codeSecret],
  cors: getAccountCorsOrigins(),
  maxInstances: 10,
  concurrency: 80,
  timeoutSeconds: 60,
}, accountHandler);

exports.createAccountApp = createAccountApp;
exports.createUnsubscribeToken = createUnsubscribeToken;
exports.purgeAndAnonymizeUserAccount = purgeAndAnonymizeUserAccount;
