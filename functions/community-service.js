'use strict';

const crypto = require('node:crypto');
const policy = require('./access-policy');
const { validateAndVerifyRecordedRun } = require('./run-math');

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const VALID_PRIVACY = new Set(['private', 'friends', 'public']);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function hasSameRunContent(existing, candidate) {
  return (
    existing.uid === candidate.uid &&
    existing.mode === candidate.mode &&
    existing.privacy === candidate.privacy &&
    existing.title === candidate.title &&
    existing.startedAt === candidate.startedAt &&
    existing.finishedAt === candidate.finishedAt &&
    existing.movingTimeMs === candidate.movingTimeMs &&
    existing.distanceM === candidate.distanceM &&
    existing.trimmedHeadM === candidate.trimmedHeadM &&
    existing.trimmedTailM === candidate.trimmedTailM &&
    existing.pointCount === candidate.pointCount &&
    (existing.courseRef?.raceId || '') === (candidate.courseRef?.raceId || '') &&
    (existing.courseRef?.distanceId || '') === (candidate.courseRef?.distanceId || '')
  );
}

function buildUpdatedOnboardingSteps(userData) {
  const existing = Array.isArray(userData?.onboardingSteps)
    ? Array.from(
        new Set(
          userData.onboardingSteps.filter(
            (step) =>
              typeof step === 'string' &&
              step.length > 0 &&
              step.length <= 40 &&
              /^[a-zA-Z0-9_:-]+$/.test(step),
          ),
        ),
      ).slice(0, 10)
    : [];
  if (existing.includes('first_run') || existing.length >= 10) {
    return null;
  }
  return [...existing, 'first_run'];
}

function createCommunityService(db, storage = null) {
  const userRef = (uid) => db.doc(`users/${uid}`);
  const accessRef = (uid) => db.doc(`userAccess/${uid}`);

  async function deleteStorageTrackBestEffort(actorUid, trackStoragePath) {
    if (!trackStoragePath || !storage || typeof storage.bucket !== 'function') return;
    const ownerTrackRe = new RegExp(
      `^run-tracks/${escapeRegExp(actorUid)}/[a-zA-Z0-9_-]{1,64}\\.json$`,
    );
    if (!ownerTrackRe.test(trackStoragePath)) return;
    try {
      await storage.bucket().file(trackStoragePath).delete();
    } catch (error) {
      console.warn('Best-effort run track delete skipped', {
        code: error?.code || 'storage_delete_failed',
      });
    }
  }

  async function execute(actorUid, path, input) {
    const [actorDoc, actorState] = await Promise.all([
      userRef(actorUid).get(),
      accessRef(actorUid).get(),
    ]);
    const actor = actorDoc.exists ? { ...actorDoc.data(), uid: actorUid } : null;
    if (!actor) fail('Your app account is unavailable.', 403);
    const actorAccess = policy.accessFor(actor, actorState.data());
    if (actorAccess.status !== 'active') fail('Your account access is suspended.', 403);
    if (!policy.can(actor, actorAccess, 'personal.record')) {
      fail('Run recording is not enabled for this account.', 403);
    }

    const requestId = input?.requestId;
    if (typeof requestId !== 'string' || !VALID_REQUEST_ID_RE.test(requestId)) {
      fail('Valid requestId is required.', 400);
    }

    const reqDigest = computeHash({ path, input });
    const idempRef = db.doc(`communityIdempotency/${actorUid}_${requestId}`);
    const now = new Date().toISOString();

    if (path === '/runs/complete') {
      const summary = validateAndVerifyRecordedRun({
        input,
        actorUid,
        profileWeightKg: actor.weightKg,
        nowIso: now,
      });
      const runRef = db.doc(`recordedRuns/${summary.runId}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, userSnap, runSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(userRef(actorUid)),
          tx.get(runRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!userSnap.exists) fail('Your app account is unavailable.', 403);

        let storedRun = summary;
        if (runSnap.exists) {
          const existing = runSnap.data();
          if (existing.uid !== actorUid || !hasSameRunContent(existing, summary)) {
            fail('Recorded run already exists with different ownership or content.', 409);
          }
          storedRun = existing;
        } else {
          tx.create(runRef, summary);
        }

        const nextOnboarding = buildUpdatedOnboardingSteps(userSnap.data());
        if (nextOnboarding) {
          tx.update(userRef(actorUid), { onboardingSteps: nextOnboarding });
        }

        const response = { run: storedRun };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/runs/update') {
      const runId = typeof input?.runId === 'string' ? input.runId.trim() : '';
      if (!VALID_ID_RE.test(runId)) fail('Invalid runId.', 400);

      const patch = {};
      if (input.title !== undefined) {
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!title || title.length > 120) {
          fail('Run title must be between 1 and 120 characters.', 400);
        }
        patch.title = title;
      }
      if (input.privacy !== undefined) {
        if (!VALID_PRIVACY.has(input.privacy)) {
          fail('Invalid run privacy.', 400);
        }
        patch.privacy = input.privacy;
      }
      if (Object.keys(patch).length === 0) {
        fail('Provide title or privacy to update.', 400);
      }

      const runRef = db.doc(`recordedRuns/${runId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, runSnap] = await Promise.all([tx.get(idempRef), tx.get(runRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!runSnap.exists) fail('Recorded run not found.', 404);
        const existing = runSnap.data();
        if (existing.uid !== actorUid) fail('You do not own this recorded run.', 403);

        tx.update(runRef, patch);
        const response = { run: { ...existing, ...patch } };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/runs/delete') {
      const runId = typeof input?.runId === 'string' ? input.runId.trim() : '';
      if (!VALID_ID_RE.test(runId)) fail('Invalid runId.', 400);

      const runRef = db.doc(`recordedRuns/${runId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const [idempSnap, runSnap] = await Promise.all([tx.get(idempRef), tx.get(runRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) {
          return { replayed: true, response: replayed, trackStoragePath: null };
        }
        if (!runSnap.exists) fail('Recorded run not found.', 404);
        const existing = runSnap.data();
        if (existing.uid !== actorUid) fail('You do not own this recorded run.', 403);

        tx.delete(runRef);
        const response = { deleted: true, runId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return {
          replayed: false,
          response,
          trackStoragePath: existing.trackStoragePath || null,
        };
      });

      if (!outcome.replayed && outcome.trackStoragePath) {
        await deleteStorageTrackBestEffort(actorUid, outcome.trackStoragePath);
      }
      return outcome.response;
    }

    fail('Unknown community command.', 404);
  }

  return { execute };
}

module.exports = { createCommunityService };
