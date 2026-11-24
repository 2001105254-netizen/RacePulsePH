'use strict';

const crypto = require('node:crypto');
const policy = require('./access-policy');
const {
  ALLOWED_BADGE_ASSET_PATH_RE,
  buildStarterBadgePack,
  computeLevelFromXp,
  computeRunCompletionXp,
  computeRunStreakWeeksPht,
  evaluateBadgeRule,
  isBadgeWithinActiveWindow,
  validateBadgeDefinitionInput,
} = require('./badge-engine');

const VALID_BADGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_ARCHIVE_STATUSES = new Set(['active', 'archived']);
const BADGE_ROUTES = new Set([
  '/badges/save',
  '/badges/seed-defaults',
  '/badges/archive',
  '/badges/delete',
  '/badges/grant',
  '/badges/evaluate-retroactive',
  '/badges/sync-my',
  '/badges/ack-seen',
]);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function assertValidId(value, regex, label) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!regex.test(id) || FORBIDDEN_IDS.has(id)) {
    fail(`Invalid ${label}.`, 400);
  }
  return id;
}

function computeHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function checkIdempotentReplay(idempSnap, reqDigest) {
  if (!idempSnap.exists) return null;
  if (idempSnap.data().digest !== reqDigest) {
    fail('Request ID already used for a different operation.', 409);
  }
  return idempSnap.data().response;
}

function getDocumentIdField() {
  try {
    const admin = require('firebase-admin');
    if (typeof admin?.firestore?.FieldPath?.documentId === 'function') {
      return admin.firestore.FieldPath.documentId();
    }
  } catch {
    // Fallback to canonical Firestore document ID field path when firebase-admin is absent.
  }
  return '__name__';
}

async function queryCollectionDocs(db, collectionName, buildQuery) {
  if (!db || typeof db.collection !== 'function') return [];
  const col = db.collection(collectionName);
  if (!col || typeof col.where !== 'function') return [];
  const snap = await buildQuery(col).get();
  return Array.isArray(snap?.docs) ? snap.docs : [];
}

function toSafeInt(value, fallback = 0) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function resolveProgressionFields({
  uid,
  prevProgression,
  addedXp,
  addedBadgesCount,
  fallbackExistingBadgesCount = 0,
  streak = null,
  nowIso,
}) {
  const prevTotalXp = prevProgression
    ? Math.max(0, Math.floor(Number(prevProgression.totalXp) || 0))
    : 0;
  const safeAddedXp = toSafeInt(addedXp, 0);
  const nextTotalXp = prevTotalXp + safeAddedXp;
  const levelInfo = computeLevelFromXp(nextTotalXp);

  const baseBadgesCount =
    prevProgression && Number.isInteger(prevProgression.badgesCount) && prevProgression.badgesCount >= 0
      ? prevProgression.badgesCount
      : Math.max(0, Math.floor(Number(fallbackExistingBadgesCount) || 0));
  const badgesCount = baseBadgesCount + Math.max(0, Math.floor(Number(addedBadgesCount) || 0));

  const runStreakWeeks = streak
    ? streak.runStreakWeeks
    : toSafeInt(prevProgression?.runStreakWeeks, 0);
  const runStreakGraceRemaining = streak
    ? streak.runStreakGraceRemaining
    : toSafeInt(prevProgression?.runStreakGraceRemaining, 0);

  return {
    uid,
    totalXp: levelInfo.totalXp,
    level: levelInfo.level,
    currentLevelXp: levelInfo.currentLevelXp,
    nextLevelXp: levelInfo.nextLevelXp,
    rankTitle: levelInfo.rankTitle,
    badgesCount,
    runStreakWeeks,
    runStreakGraceRemaining,
    updatedAt: nowIso,
  };
}

function buildUserBadgeRecord({ uid, badge, source, nowIso, grantedBy, note, runId }) {
  const xpAwarded = toSafeInt(badge.xpReward, 0);
  return {
    id: `${uid}_${badge.badgeId}`,
    uid,
    badgeId: badge.badgeId,
    earnedAt: nowIso,
    seenByUser: false,
    source,
    xpAwarded,
    ...(grantedBy ? { grantedBy } : {}),
    ...(note ? { note } : {}),
    ...(runId ? { runId } : {}),
    badgeName: badge.name,
    tier: badge.tier,
    category: badge.category,
  };
}

function buildXpEventRecord({ uid, source, refId, xp, nowIso, label }) {
  const id = source === 'run' ? `run_${uid}_${refId}` : `badge_${uid}_${refId}`;
  return {
    id,
    uid,
    source,
    refId,
    xp,
    createdAt: nowIso,
    ...(label ? { label } : {}),
  };
}

async function loadActiveNonManualBadges(db, nowIso) {
  const badgeSnaps = await queryCollectionDocs(db, 'badges', (col) =>
    col.where('status', '==', 'active'),
  );
  const active = [];
  for (const snap of badgeSnaps) {
    const data = snap.data();
    if (!data || typeof data !== 'object') continue;
    const badge = data.badgeId ? data : { ...data, badgeId: snap.id };
    if (badge.status !== 'active') continue;
    if (!badge.rule || badge.rule.type === 'manual_grant') continue;
    if (!isBadgeWithinActiveWindow(badge, nowIso)) continue;
    active.push(badge);
  }
  active.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      String(a.badgeId).localeCompare(String(b.badgeId)),
  );
  return active;
}

function extractFriendIds(uid, friendshipDocs) {
  const friendIds = new Set();
  for (const docSnap of friendshipDocs) {
    const data = docSnap.data();
    if (!data || typeof data !== 'object') continue;
    if (Array.isArray(data.members)) {
      for (const member of data.members) {
        if (typeof member === 'string' && member.trim() && member !== uid) {
          friendIds.add(member.trim());
        }
      }
    } else if (typeof data.fromUid === 'string' && typeof data.toUid === 'string') {
      const other = data.fromUid === uid ? data.toUid : data.fromUid;
      if (other.trim() && other !== uid) friendIds.add(other.trim());
    }
  }
  return Array.from(friendIds);
}

async function collectUserBadgeFacts(db, uid, userData, options = {}) {
  const raceCache = options.raceCache || new Map();
  const liveResultsCache = options.liveResultsCache || new Map();

  const [
    runDocs,
    runnerDocs,
    claimDocs,
    friendshipDocs,
    clubMemberDocs,
    socialPostDocs,
    socialKudosDocs,
    friendStreakDocs,
  ] = await Promise.all([
    queryCollectionDocs(db, 'recordedRuns', (c) => c.where('uid', '==', uid)),
    queryCollectionDocs(db, 'runners', (c) => c.where('uid', '==', uid)),
    queryCollectionDocs(db, 'runnerClaims', (c) => c.where('uid', '==', uid)),
    queryCollectionDocs(db, 'friendships', (c) => c.where('members', 'array-contains', uid)),
    queryCollectionDocs(db, 'clubMembers', (c) => c.where('uid', '==', uid)),
    queryCollectionDocs(db, 'socialPosts', (c) => c.where('uid', '==', uid)),
    queryCollectionDocs(db, 'socialKudos', (c) => c.where('recipientUid', '==', uid)),
    queryCollectionDocs(db, 'friendStreaks', (c) => c.where('members', 'array-contains', uid)),
  ]);

  const runsById = new Map();
  for (const snap of runDocs) {
    const run = snap.data();
    if (!run || typeof run !== 'object') continue;
    const id = String(run.runId || snap.id || '').trim();
    if (id) runsById.set(id, run);
  }
  if (options.extraRun && typeof options.extraRun === 'object') {
    const extraId = String(options.extraRun.runId || '').trim();
    if (extraId && !runsById.has(extraId)) {
      runsById.set(extraId, options.extraRun);
    }
  }
  const verifiedRuns = Array.from(runsById.values()).filter(
    (run) => run && run.verificationStatus === 'verified',
  );

  const runners = runnerDocs.map((d) => d.data()).filter(Boolean);
  const runnerClaims = claimDocs.map((d) => d.data()).filter(Boolean);

  const raceIds = new Set();
  for (const reg of [...runners, ...runnerClaims]) {
    if (!reg || reg.isFreeSlot === true || reg.runner?.isFreeSlot === true) continue;
    const rawRaceId = String(reg.raceId || reg.runner?.raceId || '').trim();
    if (VALID_BADGE_ID_RE.test(rawRaceId) && !FORBIDDEN_IDS.has(rawRaceId)) {
      raceIds.add(rawRaceId);
    }
  }

  const races = new Map();
  const liveResultsByRaceId = new Map();
  const uncachedRaceIds = Array.from(raceIds).filter(
    (raceId) => !raceCache.has(raceId) || !liveResultsCache.has(raceId),
  );
  if (uncachedRaceIds.length > 0 && typeof db.doc === 'function') {
    await Promise.all(
      uncachedRaceIds.map(async (raceId) => {
        const [raceSnap, liveSnap] = await Promise.all([
          raceCache.has(raceId) ? Promise.resolve(null) : db.doc(`races/${raceId}`).get(),
          liveResultsCache.has(raceId) ? Promise.resolve(null) : db.doc(`liveResults/${raceId}`).get(),
        ]);
        if (raceSnap) {
          raceCache.set(raceId, raceSnap.exists ? { id: raceSnap.id, ...raceSnap.data() } : null);
        }
        if (liveSnap) {
          liveResultsCache.set(raceId, liveSnap.exists ? liveSnap.data() : null);
        }
      }),
    );
  }
  for (const raceId of raceIds) {
    const race = raceCache.get(raceId);
    if (race) races.set(raceId, race);
    const live = liveResultsCache.get(raceId);
    if (live) liveResultsByRaceId.set(raceId, live);
  }

  const socialPosts = socialPostDocs
    .map((d) => d.data())
    .filter((p) => p && !p.deletedAt);
  let postKudosSum = 0;
  for (const post of socialPosts) {
    if (typeof post.kudosCount === 'number' && Number.isFinite(post.kudosCount)) {
      postKudosSum += Math.max(0, Math.floor(post.kudosCount));
    }
  }
  const kudosReceived =
    socialKudosDocs.length > 0 ? Math.max(socialKudosDocs.length, postKudosSum) : undefined;

  let inboxStreakDays = 0;
  for (const docSnap of friendStreakDocs) {
    const data = docSnap.data();
    const days = Math.max(
      0,
      Math.floor(Number(data?.streakDays ?? data?.currentStreak ?? data?.days ?? 0) || 0),
    );
    if (days > inboxStreakDays) inboxStreakDays = days;
  }

  return {
    accountActive: userData?.accessRemoved !== true,
    user: userData || {},
    verifiedRuns,
    runners,
    runnerClaims,
    races,
    liveResultsByRaceId,
    friendIds: extractFriendIds(uid, friendshipDocs),
    clubMemberships: clubMemberDocs.map((d) => d.data()).filter(Boolean),
    socialPosts,
    ...(kudosReceived !== undefined ? { kudosReceived } : {}),
    inboxStreakDays,
  };
}

async function prepareRunProgressionContext({ db, actor, actorUid, summary, nowIso }) {
  if (!summary || summary.verificationStatus !== 'verified') {
    return {
      isVerified: false,
      runXp: 0,
      streak: null,
      candidateBadges: [],
      existingBadgeIds: new Set(),
    };
  }

  const [activeBadges, existingBadgeSnaps, facts] = await Promise.all([
    loadActiveNonManualBadges(db, nowIso),
    queryCollectionDocs(db, 'userBadges', (c) => c.where('uid', '==', actorUid)),
    collectUserBadgeFacts(db, actorUid, actor, { extraRun: summary }),
  ]);

  const existingBadgeIds = new Set(
    existingBadgeSnaps.map((snap) => snap.data()?.badgeId).filter(Boolean),
  );
  const runXp = computeRunCompletionXp(summary);
  const streak = computeRunStreakWeeksPht(facts.verifiedRuns, nowIso);
  const candidateBadges = activeBadges.filter(
    (badge) => !existingBadgeIds.has(badge.badgeId) && evaluateBadgeRule(badge, facts, nowIso),
  );

  return {
    isVerified: true,
    runXp,
    streak,
    candidateBadges,
    existingBadgeIds,
  };
}

function getRunProgressionRefs(db, actorUid, summary, context) {
  const progressionRef = db.doc(`athleteProgression/${actorUid}`);
  const runXpRef =
    context.isVerified && context.runXp > 0
      ? db.doc(`xpEvents/run_${actorUid}_${summary.runId}`)
      : null;
  const candidateRefs = context.candidateBadges.map((badge) => ({
    badge,
    userBadgeRef: db.doc(`userBadges/${actorUid}_${badge.badgeId}`),
    badgeXpRef: db.doc(`xpEvents/badge_${actorUid}_${badge.badgeId}`),
  }));
  return { progressionRef, runXpRef, candidateRefs };
}

function applyRunProgressionInTx({
  tx,
  actorUid,
  storedRun,
  isNewlyCreatedRun,
  nowIso,
  context,
  refs,
  progressionSnap,
  runXpSnap,
  candidateSnaps,
}) {
  const prevProgression = progressionSnap.exists ? progressionSnap.data() : null;

  if (!isNewlyCreatedRun || storedRun.verificationStatus !== 'verified') {
    return {
      xpEarned: 0,
      newlyAwardedBadges: [],
      progression: prevProgression
        ? prevProgression
        : resolveProgressionFields({
            uid: actorUid,
            prevProgression: null,
            addedXp: 0,
            addedBadgesCount: 0,
            fallbackExistingBadgesCount: context.existingBadgeIds.size,
            nowIso,
          }),
    };
  }

  const runXpAwarded =
    context.runXp > 0 && runXpSnap && !runXpSnap.exists ? context.runXp : 0;
  if (runXpAwarded > 0 && refs.runXpRef) {
    tx.create(
      refs.runXpRef,
      buildXpEventRecord({
        uid: actorUid,
        source: 'run',
        refId: storedRun.runId,
        xp: runXpAwarded,
        nowIso,
        label: storedRun.title || 'Verified GPS Run',
      }),
    );
  }

  const newlyAwardedBadges = [];
  let badgeXpTotal = 0;

  for (const entry of candidateSnaps) {
    if (entry.userBadgeSnap.exists) continue;
    const userBadge = buildUserBadgeRecord({
      uid: actorUid,
      badge: entry.badge,
      source: 'run',
      nowIso,
      runId: storedRun.runId,
    });
    tx.create(entry.userBadgeRef, userBadge);
    newlyAwardedBadges.push(userBadge);

    if (userBadge.xpAwarded > 0 && !entry.badgeXpSnap.exists) {
      tx.create(
        entry.badgeXpRef,
        buildXpEventRecord({
          uid: actorUid,
          source: 'badge',
          refId: entry.badge.badgeId,
          xp: userBadge.xpAwarded,
          nowIso,
          label: entry.badge.name,
        }),
      );
      badgeXpTotal += userBadge.xpAwarded;
    }
  }

  const xpEarned = runXpAwarded + badgeXpTotal;
  const progression = resolveProgressionFields({
    uid: actorUid,
    prevProgression,
    addedXp: xpEarned,
    addedBadgesCount: newlyAwardedBadges.length,
    fallbackExistingBadgesCount: context.existingBadgeIds.size,
    streak: context.streak,
    nowIso,
  });
  tx.set(refs.progressionRef, progression);

  return { xpEarned, newlyAwardedBadges, progression };
}

async function awardRunCompletionXpAndBadges({
  db,
  actor,
  actorUid,
  storedRun,
  nowIso = new Date().toISOString(),
}) {
  const context = await prepareRunProgressionContext({
    db,
    actor,
    actorUid,
    summary: storedRun,
    nowIso,
  });
  const refs = getRunProgressionRefs(db, actorUid, storedRun, context);
  return db.runTransaction(async (tx) => {
    const readRefs = [
      refs.progressionRef,
      ...(refs.runXpRef ? [refs.runXpRef] : []),
      ...refs.candidateRefs.flatMap((c) => [c.userBadgeRef, c.badgeXpRef]),
    ];
    const snaps = await Promise.all(readRefs.map((r) => tx.get(r)));
    let idx = 0;
    const progressionSnap = snaps[idx++];
    const runXpSnap = refs.runXpRef ? snaps[idx++] : null;
    const candidateSnaps = refs.candidateRefs.map((c) => ({
      ...c,
      userBadgeSnap: snaps[idx++],
      badgeXpSnap: snaps[idx++],
    }));
    return applyRunProgressionInTx({
      tx,
      actorUid,
      storedRun,
      isNewlyCreatedRun: true,
      nowIso,
      context,
      refs,
      progressionSnap,
      runXpSnap,
      candidateSnaps,
    });
  });
}

function createBadgeService(db, storage = null, options = {}) {
  const userRef = (uid) => db.doc(`users/${uid}`);
  const accessRef = (uid) => db.doc(`userAccess/${uid}`);
  const getNowIso = () =>
    typeof options?.now === 'function' ? options.now() : new Date().toISOString();

  async function deleteStorageAssetBestEffort(artworkStoragePath) {
    if (
      typeof artworkStoragePath !== 'string' ||
      !ALLOWED_BADGE_ASSET_PATH_RE.test(artworkStoragePath) ||
      artworkStoragePath.includes('..') ||
      !storage ||
      typeof storage.bucket !== 'function'
    ) {
      return;
    }
    try {
      await storage.bucket().file(artworkStoragePath).delete();
    } catch (error) {
      console.warn('Best-effort badge asset delete skipped', {
        code: error?.code || 'storage_delete_failed',
      });
    }
  }

  async function awardEligibleBadgesForUser({
    uid,
    userData,
    source,
    nowIso,
    activeBadges,
    raceCache,
    liveResultsCache,
    idempCtx = null,
    syncProgressionWhenEmpty = false,
  }) {
    const [existingBadgeSnaps, facts] = await Promise.all([
      queryCollectionDocs(db, 'userBadges', (c) => c.where('uid', '==', uid)),
      collectUserBadgeFacts(db, uid, userData, { raceCache, liveResultsCache }),
    ]);

    const existingBadgeIds = new Set(
      existingBadgeSnaps.map((snap) => snap.data()?.badgeId).filter(Boolean),
    );
    const candidateBadges = activeBadges.filter(
      (badge) => !existingBadgeIds.has(badge.badgeId) && evaluateBadgeRule(badge, facts, nowIso),
    );
    const streak = computeRunStreakWeeksPht(facts.verifiedRuns, nowIso);

    if (candidateBadges.length === 0 && !syncProgressionWhenEmpty && !idempCtx) {
      return { newlyAwarded: [], progression: null };
    }

    const progressionRef = db.doc(`athleteProgression/${uid}`);
    const candidateRefs = candidateBadges.map((badge) => ({
      badge,
      userBadgeRef: db.doc(`userBadges/${uid}_${badge.badgeId}`),
      badgeXpRef: db.doc(`xpEvents/badge_${uid}_${badge.badgeId}`),
    }));

    return db.runTransaction(async (tx) => {
      const readRefs = [
        ...(idempCtx ? [idempCtx.idempRef] : []),
        userRef(uid),
        accessRef(uid),
        progressionRef,
        ...candidateRefs.flatMap((c) => [c.userBadgeRef, c.badgeXpRef]),
      ];
      const snaps = await Promise.all(readRefs.map((r) => tx.get(r)));
      let idx = 0;
      const idempSnap = idempCtx ? snaps[idx++] : null;
      const userSnap = snaps[idx++];
      const accessSnap = snaps[idx++];
      const progressionSnap = snaps[idx++];

      if (idempCtx) {
        const replayed = checkIdempotentReplay(idempSnap, idempCtx.reqDigest);
        if (replayed) return replayed;
      }
      const targetUser = userSnap.exists ? { ...userSnap.data(), uid } : null;
      if (!targetUser || targetUser.accessRemoved === true) {
        fail('Your app account is unavailable.', 403);
      }
      const targetAccess = policy.accessFor(
        targetUser,
        accessSnap.exists ? accessSnap.data() : undefined,
      );
      if (targetAccess.status !== 'active') {
        fail('Your account access is suspended.', 403);
      }

      const newlyAwarded = [];
      let badgeXpAdded = 0;

      for (const c of candidateRefs) {
        const userBadgeSnap = snaps[idx++];
        const badgeXpSnap = snaps[idx++];
        if (userBadgeSnap.exists) continue;

        const userBadge = buildUserBadgeRecord({
          uid,
          badge: c.badge,
          source,
          nowIso,
        });
        tx.create(c.userBadgeRef, userBadge);
        newlyAwarded.push(userBadge);

        if (userBadge.xpAwarded > 0 && !badgeXpSnap.exists) {
          tx.create(
            c.badgeXpRef,
            buildXpEventRecord({
              uid,
              source: 'badge',
              refId: c.badge.badgeId,
              xp: userBadge.xpAwarded,
              nowIso,
              label: c.badge.name,
            }),
          );
          badgeXpAdded += userBadge.xpAwarded;
        }
      }

      const prevProgression = progressionSnap.exists ? progressionSnap.data() : null;
      const progression = resolveProgressionFields({
        uid,
        prevProgression,
        addedXp: badgeXpAdded,
        addedBadgesCount: newlyAwarded.length,
        fallbackExistingBadgesCount: existingBadgeIds.size,
        streak,
        nowIso,
      });

      if (newlyAwarded.length > 0 || syncProgressionWhenEmpty || !progressionSnap.exists) {
        tx.set(progressionRef, progression);
      }

      const response = { newlyAwarded, progression };
      if (idempCtx) {
        tx.create(idempCtx.idempRef, {
          digest: idempCtx.reqDigest,
          response,
          createdAt: nowIso,
        });
      }
      return response;
    });
  }

  async function handleSaveBadge({ actorUid, input, idempRef, reqDigest, nowIso }) {
    validateBadgeDefinitionInput(input, actorUid, nowIso);
    const badgeId = assertValidId(input.badgeId, VALID_BADGE_ID_RE, 'badgeId');
    const badgeRef = db.doc(`badges/${badgeId}`);

    const outcome = await db.runTransaction(async (tx) => {
      const [idempSnap, badgeSnap] = await Promise.all([tx.get(idempRef), tx.get(badgeRef)]);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) {
        return { replayed: true, response: replayed, replacedStoragePath: null };
      }

      const previous = badgeSnap.exists ? badgeSnap.data() : null;
      const badge = validateBadgeDefinitionInput(input, actorUid, nowIso, previous);
      const prevPath = typeof previous?.artworkStoragePath === 'string' ? previous.artworkStoragePath : '';
      const nextPath = typeof badge.artworkStoragePath === 'string' ? badge.artworkStoragePath : '';
      const replacedStoragePath = prevPath && prevPath !== nextPath ? prevPath : null;

      tx.set(badgeRef, badge);
      const response = { badge };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return { replayed: false, response, replacedStoragePath };
    });

    if (!outcome.replayed && outcome.replacedStoragePath) {
      await deleteStorageAssetBestEffort(outcome.replacedStoragePath);
    }
    return outcome.response;
  }

  async function handleSeedDefaults({ actorUid, idempRef, reqDigest, nowIso }) {
    const defaults = buildStarterBadgePack(actorUid, nowIso);
    const badgeRefs = defaults.map((def) => db.doc(`badges/${def.badgeId}`));

    return db.runTransaction(async (tx) => {
      const [idempSnap, ...badgeSnaps] = await Promise.all([
        tx.get(idempRef),
        ...badgeRefs.map((ref) => tx.get(ref)),
      ]);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;

      const badgeIds = [];
      for (let i = 0; i < defaults.length; i += 1) {
        if (badgeSnaps[i].exists) continue;
        tx.create(badgeRefs[i], defaults[i]);
        badgeIds.push(defaults[i].badgeId);
      }

      const response = { seededCount: badgeIds.length, badgeIds };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return response;
    });
  }

  async function handleArchiveBadge({ actorUid, input, idempRef, reqDigest, nowIso }) {
    const badgeId = assertValidId(input?.badgeId, VALID_BADGE_ID_RE, 'badgeId');
    const status = typeof input?.status === 'string' ? input.status.trim() : '';
    if (!VALID_ARCHIVE_STATUSES.has(status)) {
      fail('Badge status must be active or archived.', 400);
    }
    const badgeRef = db.doc(`badges/${badgeId}`);

    return db.runTransaction(async (tx) => {
      const [idempSnap, badgeSnap] = await Promise.all([tx.get(idempRef), tx.get(badgeRef)]);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;
      if (!badgeSnap.exists) fail('Badge not found.', 404);

      const updatedBadge = {
        ...badgeSnap.data(),
        status,
        updatedAt: nowIso,
        updatedBy: actorUid,
      };
      tx.update(badgeRef, { status, updatedAt: nowIso, updatedBy: actorUid });
      const response = { badge: updatedBadge };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return response;
    });
  }

  async function handleDeleteBadge({ input, idempRef, reqDigest, nowIso }) {
    const badgeId = assertValidId(input?.badgeId, VALID_BADGE_ID_RE, 'badgeId');
    const badgeRef = db.doc(`badges/${badgeId}`);

    const outcome = await db.runTransaction(async (tx) => {
      const [idempSnap, badgeSnap] = await Promise.all([tx.get(idempRef), tx.get(badgeRef)]);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) {
        return { replayed: true, response: replayed, artworkStoragePath: null };
      }
      if (!badgeSnap.exists) fail('Badge not found.', 404);

      const existing = badgeSnap.data();
      tx.delete(badgeRef);
      const response = { deleted: true, badgeId };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return {
        replayed: false,
        response,
        artworkStoragePath: existing?.artworkStoragePath || null,
      };
    });

    if (!outcome.replayed && outcome.artworkStoragePath) {
      await deleteStorageAssetBestEffort(outcome.artworkStoragePath);
    }
    return outcome.response;
  }

  async function handleGrantBadge({ actorUid, input, idempRef, reqDigest, nowIso }) {
    const badgeId = assertValidId(input?.badgeId, VALID_BADGE_ID_RE, 'badgeId');
    const targetUid = assertValidId(input?.targetUid, VALID_UID_RE, 'targetUid');

    let note;
    if (input?.note !== undefined && input?.note !== null) {
      if (typeof input.note !== 'string') {
        fail('Grant note must be a string.', 400);
      }
      const trimmed = input.note.trim();
      if (trimmed.length > 200) {
        fail('Grant note must be 200 characters or fewer.', 400);
      }
      if (trimmed.length > 0) note = trimmed;
    }

    const preIdempSnap = await idempRef.get();
    const preReplayed = checkIdempotentReplay(preIdempSnap, reqDigest);
    if (preReplayed) return preReplayed;

    const existingBadgeSnaps = await queryCollectionDocs(db, 'userBadges', (c) =>
      c.where('uid', '==', targetUid),
    );
    const fallbackExistingBadgesCount = existingBadgeSnaps.length;

    const badgeRef = db.doc(`badges/${badgeId}`);
    const targetUserRef = userRef(targetUid);
    const targetAccessRef = accessRef(targetUid);
    const userBadgeRef = db.doc(`userBadges/${targetUid}_${badgeId}`);
    const xpEventRef = db.doc(`xpEvents/badge_${targetUid}_${badgeId}`);
    const progressionRef = db.doc(`athleteProgression/${targetUid}`);

    return db.runTransaction(async (tx) => {
      const [
        idempSnap,
        badgeSnap,
        targetUserSnap,
        targetAccessSnap,
        userBadgeSnap,
        xpEventSnap,
        progressionSnap,
      ] = await Promise.all([
        tx.get(idempRef),
        tx.get(badgeRef),
        tx.get(targetUserRef),
        tx.get(targetAccessRef),
        tx.get(userBadgeRef),
        tx.get(xpEventRef),
        tx.get(progressionRef),
      ]);

      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;

      if (!badgeSnap.exists) fail('Badge not found.', 404);
      const badge = badgeSnap.data();
      if (badge.status === 'archived') fail('Archived badges cannot be granted.', 409);

      if (!targetUserSnap.exists) fail('Target runner account not found.', 404);
      const targetUser = targetUserSnap.data();
      if (targetUser.accessRemoved === true) fail('Target runner account is unavailable.', 409);
      const targetAccess = policy.accessFor(
        { ...targetUser, uid: targetUid },
        targetAccessSnap.exists ? targetAccessSnap.data() : undefined,
      );
      if (targetAccess.status !== 'active') fail('Target runner account is suspended.', 409);
      if (userBadgeSnap.exists) fail('Runner already holds this badge.', 409);

      const userBadge = buildUserBadgeRecord({
        uid: targetUid,
        badge,
        source: 'manual',
        nowIso,
        grantedBy: actorUid,
        note,
      });
      const shouldWriteXp = userBadge.xpAwarded > 0 && !xpEventSnap.exists;
      const progression = resolveProgressionFields({
        uid: targetUid,
        prevProgression: progressionSnap.exists ? progressionSnap.data() : null,
        addedXp: shouldWriteXp ? userBadge.xpAwarded : 0,
        addedBadgesCount: 1,
        fallbackExistingBadgesCount,
        nowIso,
      });

      tx.create(userBadgeRef, userBadge);
      if (shouldWriteXp) {
        tx.create(
          xpEventRef,
          buildXpEventRecord({
            uid: targetUid,
            source: 'badge',
            refId: badgeId,
            xp: userBadge.xpAwarded,
            nowIso,
            label: badge.name,
          }),
        );
      }
      tx.set(progressionRef, progression);

      const response = { userBadge, xpAwarded: userBadge.xpAwarded, progression };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return response;
    });
  }

  async function handleEvaluateRetroactive({ input, idempRef, reqDigest, nowIso }) {
    let afterUid = null;
    if (input?.afterUid !== undefined && input?.afterUid !== null && input?.afterUid !== '') {
      afterUid = assertValidId(input.afterUid, VALID_UID_RE, 'afterUid');
    }
    const rawLimit = input?.limit;
    const limit = rawLimit === undefined || rawLimit === null ? 25 : rawLimit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      fail('limit must be an integer between 1 and 50.', 400);
    }

    const preIdempSnap = await idempRef.get();
    const preReplayed = checkIdempotentReplay(preIdempSnap, reqDigest);
    if (preReplayed) return preReplayed;

    const activeBadges = await loadActiveNonManualBadges(db, nowIso);
    let userDocs = [];
    if (db && typeof db.collection === 'function') {
      const docIdField = getDocumentIdField();
      let userQuery;
      try {
        userQuery = db.collection('users').orderBy(docIdField);
      } catch {
        userQuery = db.collection('users').orderBy('__name__');
      }
      if (afterUid) userQuery = userQuery.startAfter(afterUid);
      const snap = await userQuery.limit(limit + 1).get();
      userDocs = Array.isArray(snap?.docs) ? snap.docs : [];
    }

    const hasMore = userDocs.length > limit;
    const pageDocs = hasMore ? userDocs.slice(0, limit) : userDocs;
    const nextAfterUid = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;

    let processedUsers = 0;
    let newlyAwardedCount = 0;
    const raceCache = new Map();
    const liveResultsCache = new Map();

    for (const userDoc of pageDocs) {
      const uid = userDoc.id;
      const userData = userDoc.data() || {};
      if (userData.accessRemoved === true) continue;

      const accessSnap = await accessRef(uid).get();
      const targetAccess = policy.accessFor(
        { ...userData, uid },
        accessSnap.exists ? accessSnap.data() : undefined,
      );
      if (targetAccess.status !== 'active') continue;

      if (activeBadges.length === 0) {
        processedUsers += 1;
        continue;
      }

      try {
        const awarded = await awardEligibleBadgesForUser({
          uid,
          userData,
          source: 'retroactive',
          nowIso,
          activeBadges,
          raceCache,
          liveResultsCache,
        });
        processedUsers += 1;
        newlyAwardedCount += awarded.newlyAwarded.length;
      } catch (error) {
        if (error?.status === 403) continue;
        throw error;
      }
    }

    const response = { processedUsers, newlyAwardedCount, nextAfterUid, hasMore };
    return db.runTransaction(async (tx) => {
      const idempSnap = await tx.get(idempRef);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return response;
    });
  }

  async function handleAckSeen({ actorUid, input, idempRef, reqDigest, nowIso }) {
    if (!Array.isArray(input?.badgeIds) || input.badgeIds.length < 1 || input.badgeIds.length > 20) {
      fail('badgeIds must be an array containing between 1 and 20 badge IDs.', 400);
    }
    const uniqueBadgeIds = Array.from(
      new Set(input.badgeIds.map((id) => assertValidId(id, VALID_BADGE_ID_RE, 'badgeId'))),
    );
    const userBadgeRefs = uniqueBadgeIds.map((badgeId) => db.doc(`userBadges/${actorUid}_${badgeId}`));

    return db.runTransaction(async (tx) => {
      const [idempSnap, ...badgeSnaps] = await Promise.all([
        tx.get(idempRef),
        ...userBadgeRefs.map((ref) => tx.get(ref)),
      ]);
      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;

      const acknowledgedIds = [];
      for (let i = 0; i < uniqueBadgeIds.length; i += 1) {
        const snap = badgeSnaps[i];
        if (!snap.exists) continue;
        const data = snap.data();
        if (data?.uid !== actorUid) continue;
        acknowledgedIds.push(uniqueBadgeIds[i]);
        if (data.seenByUser !== true) {
          tx.update(userBadgeRefs[i], { seenByUser: true });
        }
      }

      const response = { acknowledgedIds };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: nowIso });
      return response;
    });
  }

  async function executeWithContext({
    actor,
    actorAccess,
    actorUid,
    path,
    input,
    idempRef,
    reqDigest,
    now,
  }) {
    if (!BADGE_ROUTES.has(path)) {
      fail('Unknown badge command.', 404);
    }
    if (!actor || actor.accessRemoved === true) {
      fail('Your app account is unavailable.', 403);
    }
    if (!actorAccess || actorAccess.status !== 'active') {
      fail('Your account access is suspended.', 403);
    }

    if (path === '/badges/grant') {
      if (!policy.can(actor, actorAccess, 'badges.grant')) {
        fail('Badge granting permission is required.', 403);
      }
    } else if (path !== '/badges/sync-my' && path !== '/badges/ack-seen') {
      if (!policy.can(actor, actorAccess, 'badges.manage')) {
        fail('Badge management permission is required.', 403);
      }
    }

    const requestId = input?.requestId;
    if (typeof requestId !== 'string' || !VALID_REQUEST_ID_RE.test(requestId)) {
      fail('Valid requestId is required.', 400);
    }

    const nowIso = now || getNowIso();
    const resolvedDigest = reqDigest || computeHash({ path, input });
    const resolvedIdempRef = idempRef || db.doc(`communityIdempotency/${actorUid}_${requestId}`);
    const ctx = {
      actorUid,
      input,
      idempRef: resolvedIdempRef,
      reqDigest: resolvedDigest,
      nowIso,
    };

    switch (path) {
      case '/badges/save':
        return handleSaveBadge(ctx);
      case '/badges/seed-defaults':
        return handleSeedDefaults(ctx);
      case '/badges/archive':
        return handleArchiveBadge(ctx);
      case '/badges/delete':
        return handleDeleteBadge(ctx);
      case '/badges/grant':
        return handleGrantBadge(ctx);
      case '/badges/evaluate-retroactive':
        return handleEvaluateRetroactive(ctx);
      case '/badges/sync-my': {
        const activeBadges = await loadActiveNonManualBadges(db, nowIso);
        return awardEligibleBadgesForUser({
          uid: actorUid,
          userData: actor,
          source: 'auto',
          nowIso,
          activeBadges,
          raceCache: new Map(),
          liveResultsCache: new Map(),
          idempCtx: { idempRef: resolvedIdempRef, reqDigest: resolvedDigest },
          syncProgressionWhenEmpty: true,
        });
      }
      case '/badges/ack-seen':
        return handleAckSeen(ctx);
      default:
        fail('Unknown badge command.', 404);
    }
  }

  async function execute(arg1, arg2, arg3) {
    if (arg1 && typeof arg1 === 'object' && typeof arg1.path === 'string') {
      return executeWithContext(arg1);
    }

    const actorUid = arg1;
    const path = arg2;
    const input = arg3;
    const [actorDoc, actorState] = await Promise.all([
      userRef(actorUid).get(),
      accessRef(actorUid).get(),
    ]);
    const actor = actorDoc.exists ? { ...actorDoc.data(), uid: actorUid } : null;
    if (!actor || actor.accessRemoved === true) {
      fail('Your app account is unavailable.', 403);
    }
    const actorAccess = policy.accessFor(actor, actorState.data());
    if (actorAccess.status !== 'active') {
      fail('Your account access is suspended.', 403);
    }

    return executeWithContext({
      actor,
      actorAccess,
      actorUid,
      path,
      input,
      now: getNowIso(),
    });
  }

  return { execute };
}

module.exports = {
  applyRunProgressionInTx,
  awardRunCompletionXpAndBadges,
  createBadgeService,
  getRunProgressionRefs,
  prepareRunProgressionContext,
};
