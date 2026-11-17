const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const accessPolicy = require('./access-policy');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  setScopedCors,
  verifyAppCheckRequest,
} = require('./request-guard');

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://racepulseph.web.app',
  'https://racepulseph.firebaseapp.com',
  'https://racepulseph.com',
  'https://www.racepulseph.com',
  'capacitor://localhost',
];

function setCors(request, response) {
  setScopedCors(request, response, { allowedOrigins, methods: 'POST, OPTIONS' });
}

async function requireRunner(request) {
  const bearer = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) throw Object.assign(new Error('Please sign in before adding a race bib.'), { status: 401 });
  let identity;
  try {
    identity = await admin.auth().verifyIdToken(bearer, true);
  } catch {
    throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
  }
  const db = admin.firestore();
  const [profile, access] = await Promise.all([db.doc(`users/${identity.uid}`).get(), db.doc(`userAccess/${identity.uid}`).get()]);
  if (!profile.exists || !accessPolicy.can(profile.data(), access.data(), 'personal.results')) {
    throw Object.assign(new Error('Race results are not enabled for this account.'), { status: 403 });
  }
  return { db, uid: identity.uid };
}

async function enforceClaimRateLimit(db, uid, ip) {
  const hourMs = 3600 * 1000;
  const normalizedIp = extractClientIp({ ip });
  await Promise.all([
    enforceRateLimit({
      db,
      namespace: 'claim_burst',
      identifier: uid,
      limit: 8,
      windowMs: 60 * 1000,
      message: 'Slow down slightly before scanning the next bib.',
      memoryOnly: true,
    }),
    enforceRateLimit({
      db,
      namespace: 'claim_u',
      identifier: uid,
      limit: 20,
      windowMs: hourMs,
      message: 'Too many bib lookups. Please try again later.',
      penaltyMultiplier: 1.5,
    }),
    enforceRateLimit({
      db,
      namespace: 'claim_i',
      identifier: normalizedIp,
      limit: 40,
      windowMs: hourMs,
      message: 'Too many bib lookups from this network. Please try again later.',
      penaltyMultiplier: 1.5,
    }),
  ]);
}

function safeRunner(source, uid) {
  // A QR bib claim must never copy payment, emergency-contact, or RFID data
  // into the runner's account. It only contains the fields needed for their
  // personal bib, race list, and split/result screen.
  return {
    uid,
    raceId: source.raceId,
    fullName: source.fullName,
    bibNumber: source.bibNumber,
    distance: source.distance,
    entryCategory: source.entryCategory || 'solo',
    gender: source.gender,
    age: source.age,
    ...(source.ageNotProvided ? { ageNotProvided: true } : {}),
    ...(source.shirtSize ? { shirtSize: source.shirtSize } : {}),
    ...(source.teamName ? { teamName: source.teamName } : {}),
    ...(Array.isArray(source.teamMembers) ? { teamMembers: source.teamMembers } : {}),
    createdAt: source.createdAt || new Date().toISOString(),
  };
}

function readPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('This race bib QR code is invalid.'), { status: 400 });
  }
  const raceId = typeof body?.raceId === 'string' ? body.raceId.trim() : '';
  const bibNumber = typeof body?.bibNumber === 'string' ? body.bibNumber.trim().toUpperCase() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raceId) || !bibNumber || bibNumber.length > 20) {
    throw Object.assign(new Error('This race bib QR code is invalid.'), { status: 400 });
  }
  return { raceId, bibNumber };
}

const raceBibFallbackCacheByDb = new WeakMap();
const RACE_BIB_FALLBACK_TTL_MS = 30 * 1000;

async function findRunner(db, raceId, bibNumber) {
  // Fast indexed query (O(1) reads) when composite index (raceId, bibNumber) is ready.
  try {
    const directQuery = await db
      .collection('runners')
      .where('raceId', '==', raceId)
      .where('bibNumber', '==', bibNumber)
      .limit(2)
      .get();
    if (!directQuery.empty) {
      const match = directQuery.docs[0];
      if (match.data().isFreeSlot) {
        throw Object.assign(new Error('This is an empty race-day slot and cannot be added to an account yet.'), { status: 400 });
      }
      return match;
    }
  } catch (err) {
    if (err && typeof err.status === 'number') throw err;
    // Composite index may not be active yet or query fell back; use cached race map below.
  }

  let byRace = raceBibFallbackCacheByDb.get(db);
  if (!byRace) {
    byRace = new Map();
    raceBibFallbackCacheByDb.set(db, byRace);
  }
  let entry = byRace.get(raceId);
  if (!entry || Date.now() - entry.loadedAt >= RACE_BIB_FALLBACK_TTL_MS) {
    if (!entry?.inFlight) {
      const loader = db
        .collection('runners')
        .where('raceId', '==', raceId)
        .get()
        .then((snapshot) => {
          const map = new Map();
          snapshot.docs.forEach((docSnap) => {
            const normBib = String(docSnap.data().bibNumber || '').trim().toUpperCase();
            if (normBib && !map.has(normBib)) {
              map.set(normBib, docSnap);
            }
          });
          byRace.set(raceId, { loadedAt: Date.now(), map, inFlight: null });
          return map;
        })
        .catch((err) => {
          byRace.delete(raceId);
          throw err;
        });
      entry = { loadedAt: 0, map: entry?.map || null, inFlight: loader };
      byRace.set(raceId, entry);
    }
    await entry.inFlight;
    entry = byRace.get(raceId);
  }

  const match = entry?.map?.get(bibNumber);
  if (!match) throw Object.assign(new Error('No runner was found for this bib in the selected race.'), { status: 404 });
  if (match.data().isFreeSlot) throw Object.assign(new Error('This is an empty race-day slot and cannot be added to an account yet.'), { status: 400 });
  return match;
}

function publicResponse(race, runner, alreadyLinked = false) {
  return {
    race: { id: race.id, name: race.name || 'Race event', date: race.date || '' },
    runner,
    ...(alreadyLinked ? { alreadyLinked: true } : {}),
  };
}

async function preview(request, response) {
  const { db, uid } = await requireRunner(request);
  await enforceClaimRateLimit(db, uid, request.ip);
  const { raceId, bibNumber } = readPayload(request.body);
  const raceSnapshot = await db.doc(`races/${raceId}`).get();
  if (!raceSnapshot.exists) throw Object.assign(new Error('This race event no longer exists.'), { status: 404 });

  const [sourceSnapshot, directSnapshot, claimSnapshot] = await Promise.all([
    findRunner(db, raceId, bibNumber),
    db.doc(`runners/${uid}_${raceId}`).get(),
    db.doc(`runnerClaims/${uid}_${raceId}`).get(),
  ]);
  if (directSnapshot.exists) {
    const direct = directSnapshot.data();
    if (String(direct.bibNumber || '').trim().toUpperCase() !== bibNumber) {
      throw Object.assign(new Error('Your account already has a different registration for this race.'), { status: 409 });
    }
    return response.json(publicResponse(raceSnapshot.data(), safeRunner(direct, uid), true));
  }
  if (claimSnapshot.exists) {
    const claim = claimSnapshot.data();
    if (String(claim.bibNumber || '').trim().toUpperCase() !== bibNumber) {
      throw Object.assign(new Error('Your account already has a different race bib linked for this event.'), { status: 409 });
    }
    return response.json(publicResponse(raceSnapshot.data(), claim.runner, true));
  }
  return response.json(publicResponse(raceSnapshot.data(), safeRunner(sourceSnapshot.data(), uid)));
}

async function claim(request, response) {
  const { db, uid } = await requireRunner(request);
  await enforceClaimRateLimit(db, uid, request.ip);
  const { raceId, bibNumber } = readPayload(request.body);
  const raceSnapshot = await db.doc(`races/${raceId}`).get();
  if (!raceSnapshot.exists) throw Object.assign(new Error('This race event no longer exists.'), { status: 404 });
  const sourceSnapshot = await findRunner(db, raceId, bibNumber);
  const directRef = db.doc(`runners/${uid}_${raceId}`);
  const claimRef = db.doc(`runnerClaims/${uid}_${raceId}`);
  let claimedRunner;
  let alreadyLinked = false;

  await db.runTransaction(async (transaction) => {
    const [directSnapshot, existingClaim] = await Promise.all([transaction.get(directRef), transaction.get(claimRef)]);
    if (directSnapshot.exists) {
      const direct = directSnapshot.data();
      if (String(direct.bibNumber || '').trim().toUpperCase() !== bibNumber) {
        throw Object.assign(new Error('Your account already has a different registration for this race.'), { status: 409 });
      }
      claimedRunner = safeRunner(direct, uid);
      alreadyLinked = true;
      return;
    }
    if (existingClaim.exists) {
      const existing = existingClaim.data();
      if (String(existing.bibNumber || '').trim().toUpperCase() !== bibNumber) {
        throw Object.assign(new Error('Your account already has a different race bib linked for this event.'), { status: 409 });
      }
      claimedRunner = existing.runner;
      alreadyLinked = true;
      return;
    }
    claimedRunner = safeRunner(sourceSnapshot.data(), uid);
    transaction.set(claimRef, {
      uid,
      raceId,
      bibNumber,
      runner: claimedRunner,
      sourceRunnerId: sourceSnapshot.id,
      claimedAt: new Date().toISOString(),
    });
  });
  return response.json(publicResponse(raceSnapshot.data(), claimedRunner, alreadyLinked));
}

exports.raceBibClaimApi = onRequest({
  region: 'asia-southeast1',
  maxInstances: 20,
  concurrency: 80,
  timeoutSeconds: 30,
}, async (request, response) => {
  applyApiSecurityHeaders(response);
  setCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).send('');
  if (request.method !== 'POST' || !request.is('application/json') || (request.rawBody?.length || 0) > 65536) {
    return response.status(400).json({ error: 'Invalid request.' });
  }
  try {
    await verifyAppCheckRequest(request, { admin });
    const path = (request.path || '/').replace(/\/+$/, '') || '/';
    if (path === '/preview') return await preview(request, response);
    if (path === '/claim') return await claim(request, response);
    return response.status(404).json({ error: 'Route not found.' });
  } catch (error) {
    const status = typeof error?.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
    const retryAfter = Number(error?.retryAfter) || 0;
    if (retryAfter > 0) response.set('Retry-After', String(retryAfter));
    console.warn('Race bib claim request failed', { status });
    return response.status(status).json({
      error: status < 500 && error?.message ? error.message : 'Unable to process this race bib.',
      ...(retryAfter > 0 ? { retryAfter } : {}),
    });
  }
});
