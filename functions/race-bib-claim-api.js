const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const defaultAccessPolicy = require('./access-policy');
const {
  applyApiSecurityHeaders,
  enforceRateLimit,
  extractClientIp,
  getDefaultAllowedOrigins,
  logSecurityEvent,
  resolveRequestId,
  setScopedCors,
  stripPrototypePollution,
  verifyAppCheckRequest,
} = require('./request-guard');

const MAX_CACHED_RACES = 20;
const RACE_BIB_FALLBACK_TTL_MS = 30 * 1000;
const raceBibFallbackCacheByDb = new WeakMap();

function getClaimAllowedOrigins() {
  return getDefaultAllowedOrigins();
}

function isSyntheticRunnerUid(uid) {
  const value = String(uid || '');
  return (
    value.startsWith('import_') ||
    value.startsWith('walkin_') ||
    value.startsWith('slot_') ||
    value.startsWith('free_')
  );
}

function claimLockId(raceId, bibNumber) {
  return `${raceId}_${String(bibNumber || '').replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 128);
}

function isMissingIndexError(err) {
  if (!err) return false;
  if (err.code === 9 || err.code === 'failed-precondition') return true;
  return /FAILED_PRECONDITION|requires an index/i.test(String(err.message || ''));
}

function safeRunner(source, uid) {
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

function publicResponse(race, runner, alreadyLinked = false) {
  return {
    race: { id: race.id, name: race.name || 'Race event', date: race.date || '' },
    runner,
    ...(alreadyLinked ? { alreadyLinked: true } : {}),
  };
}

function createRaceBibClaimApp({
  admin: adminClient,
  db,
  accessPolicy = defaultAccessPolicy,
  getRateLimitSecret = () => process.env.RATE_LIMIT_SALT || '',
  appCheckMode,
  now = Date.now,
} = {}) {
  async function requireRunner(request) {
    const bearer = request.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) throw Object.assign(new Error('Please sign in before adding a race bib.'), { status: 401 });
    let identity;
    try {
      identity = await adminClient.auth().verifyIdToken(bearer, true);
    } catch {
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    const [profile, access] = await Promise.all([
      db.doc(`users/${identity.uid}`).get(),
      db.doc(`userAccess/${identity.uid}`).get(),
    ]);
    if (!profile.exists || !accessPolicy.can(profile.data(), access.data(), 'personal.results')) {
      throw Object.assign(new Error('Race results are not enabled for this account.'), { status: 403 });
    }
    return { uid: identity.uid };
  }

  async function enforceClaimRateLimit(uid, ip) {
    const hourMs = 3600 * 1000;
    const normalizedIp = extractClientIp({ ip });
    const secret = getRateLimitSecret();
    await Promise.all([
      enforceRateLimit({
        db,
        secret,
        namespace: 'claim_burst',
        identifier: uid,
        limit: 8,
        windowMs: 60 * 1000,
        message: 'Slow down slightly before scanning the next bib.',
        memoryOnly: true,
        now,
      }),
      enforceRateLimit({
        db,
        secret,
        namespace: 'claim_u',
        identifier: uid,
        limit: 20,
        windowMs: hourMs,
        message: 'Too many bib lookups. Please try again later.',
        penaltyMultiplier: 1.5,
        now,
      }),
      enforceRateLimit({
        db,
        secret,
        namespace: 'claim_i',
        identifier: normalizedIp,
        limit: 40,
        windowMs: hourMs,
        message: 'Too many bib lookups from this network. Please try again later.',
        penaltyMultiplier: 1.5,
        now,
      }),
    ]);
  }

  async function findRunner(raceId, bibNumber) {
    try {
      const directQuery = await db
        .collection('runners')
        .where('raceId', '==', raceId)
        .where('bibNumber', '==', bibNumber)
        .limit(2)
        .get();
      if (directQuery.empty) {
        throw Object.assign(new Error('No runner was found for this bib in the selected race.'), { status: 404 });
      }
      const match = directQuery.docs[0];
      if (match.data().isFreeSlot) {
        throw Object.assign(new Error('This is an empty race-day slot and cannot be added to an account yet.'), { status: 400 });
      }
      return match;
    } catch (err) {
      if (err && typeof err.status === 'number') throw err;
      if (!isMissingIndexError(err)) throw err;
    }

    let byRace = raceBibFallbackCacheByDb.get(db);
    if (!byRace) {
      byRace = new Map();
      raceBibFallbackCacheByDb.set(db, byRace);
    }
    let entry = byRace.get(raceId);
    const currentMs = now();
    if (entry && entry.map && currentMs - entry.loadedAt < RACE_BIB_FALLBACK_TTL_MS) {
      // Refresh LRU insertion order.
      byRace.delete(raceId);
      byRace.set(raceId, entry);
    } else {
      if (!entry?.inFlight) {
        if (!entry && byRace.size >= MAX_CACHED_RACES) {
          const oldestKey = byRace.keys().next().value;
          if (oldestKey !== undefined) byRace.delete(oldestKey);
        }
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
            if (byRace.size >= MAX_CACHED_RACES && !byRace.has(raceId)) {
              const oldestKey = byRace.keys().next().value;
              if (oldestKey !== undefined) byRace.delete(oldestKey);
            }
            byRace.set(raceId, { loadedAt: now(), map, inFlight: null });
            return map;
          })
          .catch((loadErr) => {
            byRace.delete(raceId);
            throw loadErr;
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

  function assertClaimableOwnership(sourceData, callerUid) {
    const sourceUid = String(sourceData?.uid || '');
    if (!isSyntheticRunnerUid(sourceUid) && sourceUid !== callerUid) {
      throw Object.assign(new Error('This race bib belongs to another registered account.'), { status: 403 });
    }
  }

  async function preview(request, response) {
    const { uid } = await requireRunner(request);
    await enforceClaimRateLimit(uid, request.ip);
    const { raceId, bibNumber } = readPayload(request.body);
    const raceSnapshot = await db.doc(`races/${raceId}`).get();
    if (!raceSnapshot.exists) throw Object.assign(new Error('This race event no longer exists.'), { status: 404 });

    const lockRef = db.doc(`bibClaimLocks/${claimLockId(raceId, bibNumber)}`);
    const [sourceSnapshot, directSnapshot, claimSnapshot, lockSnapshot] = await Promise.all([
      findRunner(raceId, bibNumber),
      db.doc(`runners/${uid}_${raceId}`).get(),
      db.doc(`runnerClaims/${uid}_${raceId}`).get(),
      lockRef.get(),
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

    assertClaimableOwnership(sourceSnapshot.data(), uid);
    if (lockSnapshot.exists && lockSnapshot.data().uid !== uid) {
      throw Object.assign(new Error('This race bib has already been claimed by another account.'), { status: 409 });
    }
    return response.json(publicResponse(raceSnapshot.data(), safeRunner(sourceSnapshot.data(), uid)));
  }

  async function claim(request, response) {
    const { uid } = await requireRunner(request);
    await enforceClaimRateLimit(uid, request.ip);
    const { raceId, bibNumber } = readPayload(request.body);
    const raceSnapshot = await db.doc(`races/${raceId}`).get();
    if (!raceSnapshot.exists) throw Object.assign(new Error('This race event no longer exists.'), { status: 404 });
    const sourceSnapshot = await findRunner(raceId, bibNumber);
    assertClaimableOwnership(sourceSnapshot.data(), uid);

    const directRef = db.doc(`runners/${uid}_${raceId}`);
    const claimRef = db.doc(`runnerClaims/${uid}_${raceId}`);
    const lockRef = db.doc(`bibClaimLocks/${claimLockId(raceId, bibNumber)}`);
    let claimedRunner;
    let alreadyLinked = false;

    await db.runTransaction(async (transaction) => {
      const [directSnapshot, existingClaim, existingLock] = await Promise.all([
        transaction.get(directRef),
        transaction.get(claimRef),
        transaction.get(lockRef),
      ]);
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
      if (existingLock.exists && existingLock.data().uid !== uid) {
        throw Object.assign(new Error('This race bib has already been claimed by another account.'), { status: 409 });
      }
      const claimedAt = new Date(now()).toISOString();
      claimedRunner = safeRunner(sourceSnapshot.data(), uid);
      transaction.set(lockRef, {
        uid,
        raceId,
        bibNumber,
        sourceRunnerId: sourceSnapshot.id,
        claimedAt,
      });
      transaction.set(claimRef, {
        uid,
        raceId,
        bibNumber,
        runner: claimedRunner,
        sourceRunnerId: sourceSnapshot.id,
        claimedAt,
      });
    });
    return response.json(publicResponse(raceSnapshot.data(), claimedRunner, alreadyLinked));
  }

  return async (request, response) => {
    applyApiSecurityHeaders(response);
    const requestId = resolveRequestId(request, response);
    const cors = setScopedCors(request, response, { allowedOrigins: getClaimAllowedOrigins(), methods: 'POST, OPTIONS' });
    const path = (request.path || '/').replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return response.status(cors.hasOrigin && !cors.originAllowed ? 403 : 204).send('');
    if (cors.hasOrigin && !cors.originAllowed) {
      logSecurityEvent({ event: 'cors_origin_rejected', decision: 'deny', route: path, requestId, status: 403, code: 'cors_origin_denied', ipBucket: extractClientIp(request) });
      return response.status(403).json({ error: 'Origin is not allowed.' });
    }
    if (request.method !== 'POST' || !request.is('application/json') || (request.rawBody?.length || 0) > 65536 || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return response.status(400).json({ error: 'Invalid request.' });
    }
    try {
      request.body = stripPrototypePollution(request.body);
      await verifyAppCheckRequest(request, { admin: adminClient, mode: appCheckMode });
      if (path === '/preview') return await preview(request, response);
      if (path === '/claim') return await claim(request, response);
      return response.status(404).json({ error: 'Route not found.' });
    } catch (error) {
      const status = typeof error?.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 500;
      const retryAfter = Number(error?.retryAfter) || 0;
      if (retryAfter > 0) response.set('Retry-After', String(retryAfter));
      if (status === 401 || status === 403 || status === 429) {
        logSecurityEvent({ event: 'bib_claim_denied', decision: 'deny', route: path, requestId, status, code: error?.code || 'rejected', ipBucket: extractClientIp(request) });
      }
      console.warn('Race bib claim request failed', { path, requestId, status, code: error?.code || 'rejected' });
      return response.status(status).json({
        error: status < 500 && error?.message ? error.message : 'Unable to process this race bib.',
        ...(retryAfter > 0 ? { retryAfter } : {}),
      });
    }
  };
}

exports.createRaceBibClaimApp = createRaceBibClaimApp;
exports.raceBibClaimApi = onRequest(
  {
    region: 'asia-southeast1',
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 30,
  },
  (request, response) => createRaceBibClaimApp({ admin, db: admin.firestore() })(request, response),
);
