'use strict';

const policy = require('./access-policy');
const {
  ALLOWED_CLUB_ASSET_PATH_RE,
  CLUB_ID_RE,
  MAX_CLUB_CAPTAINS,
  assertSafeText,
  assertValidEntityId,
  computeClubLeaderboard,
  fail,
  slugifyClubId,
  validateClubAnnouncementInput,
  validateClubDefinitionInput,
  validateClubMeetupInput,
  validateClubRequestInput,
  validateClubSpotlightInput,
} = require('./club-engine');
const { buildClubConversationId } = require('./social-engine');
const {
  checkIdempotentReplay,
  deleteDocsInBatches,
  queryCollectionDocs,
  upsertPublicProfileInTx,
} = require('./social-service');

const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const CLUB_ROUTES = new Set([
  '/clubs/save',
  '/clubs/archive',
  '/clubs/delete',
  '/clubs/request',
  '/clubs/requests/resolve',
  '/clubs/join',
  '/clubs/leave',
  '/clubs/primary',
  '/clubs/member/manage',
  '/clubs/meetup/save',
  '/clubs/meetup/delete',
  '/clubs/announcement/save',
  '/clubs/spotlight/save',
  '/clubs/leaderboard',
]);
const CLUB_READ_ROUTES = new Set(['/clubs/leaderboard']);
const MAX_PENDING_REQUESTS_PER_USER = 3;
const VALID_MEMBER_MANAGE_ACTIONS = new Set([
  'approve',
  'reject',
  'remove',
  'invite',
  'promote_captain',
  'demote_captain',
]);

function syncClubConversationInTx(tx, db, club, existingConvSnap, actorUid, now) {
  const convId = buildClubConversationId(club.clubId);
  const convRef = db.doc(`conversations/${convId}`);
  const existingConv = existingConvSnap?.exists ? existingConvSnap.data() : null;
  const status = club.status === 'active' && club.modules?.chat ? 'active' : 'archived';
  const payload = {
    conversationId: convId,
    type: 'club',
    clubId: club.clubId,
    clubName: club.name,
    members: [],
    status,
    lastMessageText: existingConv?.lastMessageText || '',
    lastMessageAt: existingConv?.lastMessageAt || '',
    lastSenderUid: existingConv?.lastSenderUid || actorUid,
    updatedAt: now,
    ...(existingConv?.createdAt ? { createdAt: existingConv.createdAt } : { createdAt: now }),
  };
  tx.set(convRef, payload);
  return payload;
}

function createClubService(db, storage = null) {
  const userRef = (uid) => db.doc(`users/${uid}`);
  const publicProfileRef = (uid) => db.doc(`publicProfiles/${uid}`);

  function canManageClubs(actor, actorAccess) {
    return policy.can(actor, actorAccess, 'clubs.manage');
  }

  function canViewClubsAdmin(actor, actorAccess) {
    return policy.can(actor, actorAccess, 'clubs.view');
  }

  function canPersonalClubs(actor, actorAccess) {
    return policy.can(actor, actorAccess, 'personal.clubs');
  }

  async function deleteClubAssetBestEffort(assetPath) {
    if (
      typeof assetPath !== 'string' ||
      !ALLOWED_CLUB_ASSET_PATH_RE.test(assetPath) ||
      assetPath.includes('..') ||
      !storage ||
      typeof storage.bucket !== 'function'
    ) {
      return;
    }
    try {
      await storage.bucket().file(assetPath).delete();
    } catch (error) {
      console.warn('Best-effort club asset delete skipped', {
        code: error?.code || 'storage_delete_failed',
      });
    }
  }

  async function saveClubAtomically({ actorUid, input, idempRef, reqDigest, now }) {
    const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
    const clubRef = db.doc(`clubs/${clubId}`);
    const convRef = db.doc(`conversations/${buildClubConversationId(clubId)}`);

    const [preClubSnap, existingMemberSnaps] = await Promise.all([
      clubRef.get(),
      queryCollectionDocs(db, 'clubMembers', (c) => c.where('clubId', '==', clubId)),
    ]);
    const existingClub = preClubSnap.exists ? preClubSnap.data() : null;
    const validatedClub = validateClubDefinitionInput(input, actorUid, now, existingClub);

    const oldCaptainUids = existingMemberSnaps
      .map((s) => s.data())
      .filter((m) => m && m.role === 'captain' && m.status === 'active')
      .map((m) => m.uid);
    const demotedUids = oldCaptainUids.filter((u) => !validatedClub.captainUids.includes(u));

    const outcome = await db.runTransaction(async (tx) => {
      const [
        idempSnap,
        clubSnap,
        convSnap,
        capMembers,
        capUsers,
        capPublics,
        demotedMembers,
      ] = await Promise.all([
        tx.get(idempRef),
        tx.get(clubRef),
        tx.get(convRef),
        Promise.all(
          validatedClub.captainUids.map((u) => tx.get(db.doc(`clubMembers/${clubId}_${u}`))),
        ),
        Promise.all(validatedClub.captainUids.map((u) => tx.get(userRef(u)))),
        Promise.all(validatedClub.captainUids.map((u) => tx.get(publicProfileRef(u)))),
        Promise.all(demotedUids.map((u) => tx.get(db.doc(`clubMembers/${clubId}_${u}`)))),
      ]);

      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) {
        return { replayed: true, response: replayed, stalePaths: [] };
      }

      const txExisting = clubSnap.exists ? clubSnap.data() : null;
      const finalClub = validateClubDefinitionInput(input, actorUid, now, txExisting);
      let memberCount = finalClub.memberCount;
      let requestCount = finalClub.requestCount;

      for (let i = 0; i < finalClub.captainUids.length; i += 1) {
        const capUid = finalClub.captainUids[i];
        const capUserSnap = capUsers[i];
        if (!capUserSnap.exists || capUserSnap.data()?.accessRemoved === true) {
          fail(`Captain account "${capUid}" is unavailable.`, 404);
        }
        const mSnap = capMembers[i];
        const mData = mSnap.exists ? mSnap.data() : null;
        if (!mData || mData.status !== 'active') {
          if (mData && mData.status === 'pending') {
            requestCount = Math.max(0, requestCount - 1);
          }
          memberCount += 1;
        }
      }

      if (finalClub.memberLimit !== null && memberCount > finalClub.memberLimit) {
        fail('Club memberLimit exceeded by assigned captains.', 409);
      }

      finalClub.memberCount = memberCount;
      finalClub.requestCount = requestCount;

      tx.set(clubRef, finalClub);
      const conversation = syncClubConversationInTx(tx, db, finalClub, convSnap, actorUid, now);

      for (let i = 0; i < finalClub.captainUids.length; i += 1) {
        const capUid = finalClub.captainUids[i];
        const mSnap = capMembers[i];
        const mData = mSnap.exists ? mSnap.data() : null;
        const capUserSnap = capUsers[i];
        const capPublicSnap = capPublics[i];
        const uData = capUserSnap.data();

        tx.set(db.doc(`clubMembers/${clubId}_${capUid}`), {
          id: `${clubId}_${capUid}`,
          clubId,
          uid: capUid,
          role: 'captain',
          status: 'active',
          displayName: String(uData?.displayName || 'Captain'),
          ...(typeof uData?.username === 'string' && uData.username
            ? { username: uData.username }
            : {}),
          joinedAt: mData?.joinedAt || now,
          updatedAt: now,
        });

        if (!uData.primaryClubId) {
          tx.update(userRef(capUid), { primaryClubId: clubId });
          upsertPublicProfileInTx(tx, {
            db,
            uid: capUid,
            userSnap: capUserSnap,
            publicProfileSnap: capPublicSnap,
            primaryClubId: clubId,
            primaryClubName: finalClub.name,
            nowIso: now,
          });
        }
      }

      for (const dSnap of demotedMembers) {
        if (dSnap.exists && dSnap.data()?.role === 'captain') {
          tx.update(dSnap.ref, { role: 'member', updatedAt: now });
        }
      }

      const stalePaths = [];
      if (txExisting) {
        if (
          txExisting.logoStoragePath &&
          txExisting.logoStoragePath !== finalClub.logoStoragePath
        ) {
          stalePaths.push(txExisting.logoStoragePath);
        }
        if (
          txExisting.coverStoragePath &&
          txExisting.coverStoragePath !== finalClub.coverStoragePath
        ) {
          stalePaths.push(txExisting.coverStoragePath);
        }
      }

      const response = { club: finalClub, conversation };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
      return { replayed: false, response, stalePaths };
    });

    if (!outcome.replayed && outcome.stalePaths.length > 0) {
      await Promise.all(outcome.stalePaths.map((p) => deleteClubAssetBestEffort(p)));
    }
    return outcome.response;
  }

  async function execute({ actor, actorAccess, actorUid, path, input, idempRef, reqDigest, now }) {
    const isAdminMgr = canManageClubs(actor, actorAccess);
    const isAdminView = canViewClubsAdmin(actor, actorAccess);
    const isRunnerClubs = canPersonalClubs(actor, actorAccess);

    if (!CLUB_READ_ROUTES.has(path) && !idempRef) {
      fail('Valid requestId is required.', 400);
    }

    if (path === '/clubs/save') {
      if (!isAdminMgr) fail('Saving clubs requires clubs.manage permission.', 403);
      return saveClubAtomically({ actorUid, input, idempRef, reqDigest, now });
    }

    if (path === '/clubs/archive') {
      if (!isAdminMgr) fail('Archiving clubs requires clubs.manage permission.', 403);
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const clubRef = db.doc(`clubs/${clubId}`);
      const convRef = db.doc(`conversations/${buildClubConversationId(clubId)}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, convSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(convRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const existing = clubSnap.data();
        const nextStatus =
          input?.status === 'active' || input?.archived === false ? 'active' : 'archived';
        const updatedClub = {
          ...existing,
          status: nextStatus,
          updatedAt: now,
          updatedBy: actorUid,
        };
        tx.update(clubRef, { status: nextStatus, updatedAt: now, updatedBy: actorUid });
        if (convSnap.exists) {
          syncClubConversationInTx(tx, db, updatedClub, convSnap, actorUid, now);
        }
        const response = { club: updatedClub };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/delete') {
      if (!isAdminMgr) fail('Deleting clubs requires clubs.manage permission.', 403);
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const clubRef = db.doc(`clubs/${clubId}`);
      const convRef = db.doc(`conversations/${buildClubConversationId(clubId)}`);
      const spotlightRef = db.doc(`clubSpotlights/${clubId}`);

      const outcome = await db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, convSnap, spotlightSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(convRef),
          tx.get(spotlightRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return { replayed: true, response: replayed, stalePaths: [] };
        if (!clubSnap.exists) fail('Club not found.', 404);
        const existing = clubSnap.data();
        const stalePaths = [existing.logoStoragePath, existing.coverStoragePath].filter(Boolean);

        tx.delete(clubRef);
        if (convSnap.exists) tx.delete(convRef);
        if (spotlightSnap.exists) tx.delete(spotlightRef);

        const response = { deleted: true, clubId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return { replayed: false, response, stalePaths };
      });

      if (!outcome.replayed) {
        const [memberDocs, meetupDocs, annDocs, msgDocs, userPrimaryDocs, pubPrimaryDocs] =
          await Promise.all([
            queryCollectionDocs(db, 'clubMembers', (c) => c.where('clubId', '==', clubId)),
            queryCollectionDocs(db, 'clubMeetups', (c) => c.where('clubId', '==', clubId)),
            queryCollectionDocs(db, 'clubAnnouncements', (c) => c.where('clubId', '==', clubId)),
            queryCollectionDocs(db, `conversations/${buildClubConversationId(clubId)}/messages`),
            queryCollectionDocs(db, 'users', (c) => c.where('primaryClubId', '==', clubId)),
            queryCollectionDocs(db, 'publicProfiles', (c) => c.where('primaryClubId', '==', clubId)),
          ]);
        await deleteDocsInBatches(db, [...memberDocs, ...meetupDocs, ...annDocs, ...msgDocs]);

        const primaryRefs = [...userPrimaryDocs, ...pubPrimaryDocs];
        for (let i = 0; i < primaryRefs.length; i += 400) {
          const batch = db.batch();
          primaryRefs.slice(i, i + 400).forEach((docSnap) => {
            const isPublic = docSnap.ref.path.startsWith('publicProfiles/');
            batch.update(
              docSnap.ref,
              isPublic
                ? { primaryClubId: null, primaryClubName: '', updatedAt: now }
                : { primaryClubId: null },
            );
          });
          await batch.commit();
        }
        await Promise.all(outcome.stalePaths.map((p) => deleteClubAssetBestEffort(p)));
      }
      return outcome.response;
    }

    if (path === '/clubs/request') {
      if (!isRunnerClubs) fail('Submitting club requests requires personal.clubs permission.', 403);
      const idempPreview = await idempRef.get();
      const earlyReplay = checkIdempotentReplay(idempPreview, reqDigest);
      if (earlyReplay) return earlyReplay;

      const reqInput = {
        ...input,
        requestId: input?.clubRequestId || input?.requestId,
      };
      const clubReq = validateClubRequestInput(reqInput, actorUid, now);

      const pendingSnaps = await queryCollectionDocs(db, 'clubRequests', (c) =>
        c.where('requesterUid', '==', actorUid).where('status', '==', 'pending'),
      );
      if (pendingSnaps.length >= MAX_PENDING_REQUESTS_PER_USER) {
        fail(
          `You already have ${MAX_PENDING_REQUESTS_PER_USER} pending club requests. Wait for review before submitting another.`,
          409,
        );
      }

      const clubReqRef = db.doc(`clubRequests/${clubReq.requestId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, reqSnap] = await Promise.all([tx.get(idempRef), tx.get(clubReqRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (reqSnap.exists) fail('Club request ID already exists.', 409);
        tx.create(clubReqRef, clubReq);
        const response = { clubRequest: clubReq };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/requests/resolve') {
      if (!isAdminMgr) fail('Resolving club requests requires clubs.manage permission.', 403);
      const targetRequestId = assertValidEntityId(
        input?.clubRequestId || input?.targetRequestId,
        'clubRequestId',
      );
      const decision = typeof input?.decision === 'string' ? input.decision.trim() : '';
      if (decision !== 'approved' && decision !== 'rejected') {
        fail('Decision must be approved or rejected.', 400);
      }
      const reviewNote = assertSafeText(input?.reviewNote ?? '', {
        label: 'Review note',
        min: 0,
        max: 400,
      });

      const reqRef = db.doc(`clubRequests/${targetRequestId}`);
      const preReqSnap = await reqRef.get();
      if (!preReqSnap.exists) fail('Club request not found.', 404);
      const preReq = preReqSnap.data();

      let preparedClub = null;
      if (decision === 'approved' && input?.clubPayload && typeof input.clubPayload === 'object') {
        const cp = input.clubPayload;
        const resolvedClubId = assertValidEntityId(
          cp.clubId || slugifyClubId(cp.name || preReq.clubName),
          'clubId',
          CLUB_ID_RE,
        );
        const captainList =
          Array.isArray(cp.captainUids) && cp.captainUids.length > 0
            ? cp.captainUids
            : preReq.requesterUid
              ? [preReq.requesterUid]
              : [];
        preparedClub = validateClubDefinitionInput(
          {
            ...cp,
            clubId: resolvedClubId,
            name: cp.name || preReq.clubName,
            city: cp.city || preReq.city,
            scheduleSummary: cp.scheduleSummary ?? preReq.scheduleSummary,
            modules: cp.modules || preReq.desiredModules,
            captainUids: captainList,
          },
          actorUid,
          now,
          null,
        );
      }

      return db.runTransaction(async (tx) => {
        const capUids = preparedClub ? preparedClub.captainUids : [];
        const clubRef = preparedClub ? db.doc(`clubs/${preparedClub.clubId}`) : null;
        const convRef = preparedClub
          ? db.doc(`conversations/${buildClubConversationId(preparedClub.clubId)}`)
          : null;

        const [idempSnap, reqSnap, existingClubSnap, convSnap, capUsers, capPublics, capMembers] =
          await Promise.all([
            tx.get(idempRef),
            tx.get(reqRef),
            clubRef ? tx.get(clubRef) : Promise.resolve(null),
            convRef ? tx.get(convRef) : Promise.resolve(null),
            Promise.all(capUids.map((u) => tx.get(userRef(u)))),
            Promise.all(capUids.map((u) => tx.get(publicProfileRef(u)))),
            Promise.all(
              capUids.map((u) => tx.get(db.doc(`clubMembers/${preparedClub.clubId}_${u}`))),
            ),
          ]);

        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!reqSnap.exists) fail('Club request not found.', 404);
        const existingReq = reqSnap.data();
        if (existingReq.status !== 'pending') {
          fail('Club request has already been resolved.', 409);
        }

        let createdClub = null;
        if (preparedClub && clubRef) {
          if (existingClubSnap.exists) {
            fail(`Club "${preparedClub.clubId}" already exists.`, 409);
          }
          createdClub = { ...preparedClub, memberCount: capUids.length };
          tx.create(clubRef, createdClub);
          syncClubConversationInTx(tx, db, createdClub, convSnap, actorUid, now);

          for (let i = 0; i < capUids.length; i += 1) {
            const capUid = capUids[i];
            const capUserSnap = capUsers[i];
            if (!capUserSnap.exists || capUserSnap.data()?.accessRemoved === true) {
              fail(`Captain account "${capUid}" is unavailable.`, 404);
            }
            const uData = capUserSnap.data();
            if (!capMembers[i].exists) {
              tx.create(db.doc(`clubMembers/${createdClub.clubId}_${capUid}`), {
                id: `${createdClub.clubId}_${capUid}`,
                clubId: createdClub.clubId,
                uid: capUid,
                role: 'captain',
                status: 'active',
                displayName: String(uData?.displayName || 'Captain'),
                ...(typeof uData?.username === 'string' && uData.username
                  ? { username: uData.username }
                  : {}),
                joinedAt: now,
                updatedAt: now,
              });
            }
            if (!uData.primaryClubId) {
              tx.update(userRef(capUid), { primaryClubId: createdClub.clubId });
              upsertPublicProfileInTx(tx, {
                db,
                uid: capUid,
                userSnap: capUserSnap,
                publicProfileSnap: capPublics[i],
                primaryClubId: createdClub.clubId,
                primaryClubName: createdClub.name,
                nowIso: now,
              });
            }
          }
        }

        const updatedRequest = {
          ...existingReq,
          status: decision,
          reviewedBy: actorUid,
          reviewedAt: now,
          ...(reviewNote ? { reviewNote } : {}),
          ...(createdClub ? { reviewedClubId: createdClub.clubId } : {}),
          updatedAt: now,
        };
        tx.update(reqRef, {
          status: decision,
          reviewedBy: actorUid,
          reviewedAt: now,
          ...(reviewNote ? { reviewNote } : {}),
          ...(createdClub ? { reviewedClubId: createdClub.clubId } : {}),
          updatedAt: now,
        });

        tx.set(db.doc(`activityNotifications/club_req_${targetRequestId}`), {
          id: `club_req_${targetRequestId}`,
          uid: existingReq.requesterUid,
          kind: 'club_approved',
          actorUid,
          actorName: String(actor.displayName || 'RacePulse Admin'),
          targetId: createdClub ? createdClub.clubId : targetRequestId,
          summary:
            decision === 'approved'
              ? `Your club request for ${existingReq.clubName} was approved.`
              : `Update on your club request for ${existingReq.clubName}.`,
          read: false,
          createdAt: now,
        });

        const response = {
          clubRequest: updatedRequest,
          ...(createdClub ? { club: createdClub } : {}),
        };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/join') {
      if (!isRunnerClubs) fail('Joining clubs requires personal.clubs permission.', 403);
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const clubRef = db.doc(`clubs/${clubId}`);
      const memberRef = db.doc(`clubMembers/${clubId}_${actorUid}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, memberSnap, uSnap, pubSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(memberRef),
          tx.get(userRef(actorUid)),
          tx.get(publicProfileRef(actorUid)),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();
        if (club.status !== 'active') fail('This club is currently archived.', 409);
        if (club.joinPolicy === 'invite_only') {
          fail('This club is invite-only. Contact a club captain or admin to join.', 403);
        }

        const existingMember = memberSnap.exists ? memberSnap.data() : null;
        if (existingMember && existingMember.status === 'active') {
          fail('You are already an active member of this club.', 409);
        }
        if (existingMember && existingMember.status === 'pending') {
          fail('Your request to join this club is already pending approval.', 409);
        }

        const uData = uSnap.data();
        const nextStatus = club.joinPolicy === 'open' ? 'active' : 'pending';
        if (nextStatus === 'active') {
          if (club.memberLimit !== null && club.memberCount >= club.memberLimit) {
            fail('This club has reached its member limit.', 409);
          }
        }

        const memberRecord = {
          id: `${clubId}_${actorUid}`,
          clubId,
          uid: actorUid,
          role: 'member',
          status: nextStatus,
          displayName: String(uData?.displayName || 'Runner'),
          ...(typeof uData?.username === 'string' && uData.username
            ? { username: uData.username }
            : {}),
          joinedAt: now,
          updatedAt: now,
        };
        tx.set(memberRef, memberRecord);

        if (nextStatus === 'active') {
          tx.update(clubRef, { memberCount: (Number(club.memberCount) || 0) + 1, updatedAt: now });
          if (!uData?.primaryClubId) {
            tx.update(userRef(actorUid), { primaryClubId: clubId });
            upsertPublicProfileInTx(tx, {
              db,
              uid: actorUid,
              userSnap: uSnap,
              publicProfileSnap: pubSnap,
              primaryClubId: clubId,
              primaryClubName: club.name,
              nowIso: now,
            });
          }
        } else {
          tx.update(clubRef, {
            requestCount: (Number(club.requestCount) || 0) + 1,
            updatedAt: now,
          });
        }

        const response = { member: memberRecord };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/leave') {
      if (!isRunnerClubs) fail('Leaving a club requires personal.clubs permission.', 403);
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const clubRef = db.doc(`clubs/${clubId}`);
      const memberRef = db.doc(`clubMembers/${clubId}_${actorUid}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, memberSnap, uSnap, pubSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(memberRef),
          tx.get(userRef(actorUid)),
          tx.get(publicProfileRef(actorUid)),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!memberSnap.exists) fail('You are not a member of this club.', 404);

        const member = memberSnap.data();
        tx.delete(memberRef);

        if (clubSnap.exists) {
          const club = clubSnap.data();
          const nextCaptains = Array.isArray(club.captainUids)
            ? club.captainUids.filter((u) => u !== actorUid)
            : [];
          const patch = { captainUids: nextCaptains, updatedAt: now };
          if (member.status === 'active') {
            patch.memberCount = Math.max(0, (Number(club.memberCount) || 0) - 1);
          } else if (member.status === 'pending') {
            patch.requestCount = Math.max(0, (Number(club.requestCount) || 0) - 1);
          }
          tx.update(clubRef, patch);
        }

        if (uSnap.exists && uSnap.data()?.primaryClubId === clubId) {
          tx.update(userRef(actorUid), { primaryClubId: null });
          upsertPublicProfileInTx(tx, {
            db,
            uid: actorUid,
            userSnap: uSnap,
            publicProfileSnap: pubSnap,
            primaryClubId: null,
            primaryClubName: '',
            nowIso: now,
          });
        }

        const response = { left: true, clubId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/primary') {
      if (!isRunnerClubs) fail('Selecting primary club requires personal.clubs permission.', 403);
      const rawClubId = input?.clubId;
      const targetClubId =
        rawClubId === null || rawClubId === ''
          ? null
          : assertValidEntityId(rawClubId, 'clubId', CLUB_ID_RE);

      return db.runTransaction(async (tx) => {
        const clubRef = targetClubId ? db.doc(`clubs/${targetClubId}`) : null;
        const memberRef = targetClubId ? db.doc(`clubMembers/${targetClubId}_${actorUid}`) : null;
        const [idempSnap, clubSnap, memberSnap, uSnap, pubSnap] = await Promise.all([
          tx.get(idempRef),
          clubRef ? tx.get(clubRef) : Promise.resolve(null),
          memberRef ? tx.get(memberRef) : Promise.resolve(null),
          tx.get(userRef(actorUid)),
          tx.get(publicProfileRef(actorUid)),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!uSnap.exists || uSnap.data()?.accessRemoved === true) {
          fail('Your app account is unavailable.', 403);
        }

        let primaryClubName = '';
        if (targetClubId) {
          if (!clubSnap.exists || clubSnap.data()?.status !== 'active') {
            fail('Target club is unavailable.', 404);
          }
          if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
            fail('Join this club as an active member before setting it as primary.', 403);
          }
          primaryClubName = String(clubSnap.data().name || '');
        }

        tx.update(userRef(actorUid), { primaryClubId: targetClubId });
        upsertPublicProfileInTx(tx, {
          db,
          uid: actorUid,
          userSnap: uSnap,
          publicProfileSnap: pubSnap,
          primaryClubId: targetClubId,
          primaryClubName,
          nowIso: now,
        });

        const response = { primaryClubId: targetClubId, primaryClubName };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/member/manage') {
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const targetUid = assertValidEntityId(input?.targetUid, 'targetUid', VALID_UID_RE);
      const action = typeof input?.action === 'string' ? input.action.trim() : '';
      if (!VALID_MEMBER_MANAGE_ACTIONS.has(action)) {
        fail('Unsupported club member management action.', 400);
      }

      const clubRef = db.doc(`clubs/${clubId}`);
      const memberRef = db.doc(`clubMembers/${clubId}_${targetUid}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, memberSnap, targetUserSnap, targetPubSnap] =
          await Promise.all([
            tx.get(idempRef),
            tx.get(clubRef),
            tx.get(memberRef),
            tx.get(userRef(targetUid)),
            tx.get(publicProfileRef(targetUid)),
          ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();

        const isCaptain =
          club.status === 'active' &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);
        if (!isAdminMgr && !isCaptain) {
          fail('Club captain or admin permission required.', 403);
        }
        if ((action === 'promote_captain' || action === 'demote_captain') && !isAdminMgr) {
          fail('Only admins with clubs.manage may promote or demote captains.', 403);
        }

        const existingMember = memberSnap.exists ? memberSnap.data() : null;
        if (action === 'remove' && existingMember?.role === 'captain' && !isAdminMgr) {
          fail('Captains cannot remove another captain.', 403);
        }

        if (!targetUserSnap.exists || targetUserSnap.data()?.accessRemoved === true) {
          fail('Target runner account is unavailable.', 404);
        }
        const tUser = targetUserSnap.data();

        let nextMemberCount = Math.max(0, Number(club.memberCount) || 0);
        let nextRequestCount = Math.max(0, Number(club.requestCount) || 0);
        let nextCaptainUids = Array.isArray(club.captainUids) ? [...club.captainUids] : [];
        let resultMember = existingMember;

        if (action === 'approve' || action === 'invite') {
          if (action === 'approve' && (!existingMember || existingMember.status !== 'pending')) {
            fail('No pending join request exists for this runner.', 404);
          }
          if (existingMember?.status !== 'active') {
            if (club.memberLimit !== null && nextMemberCount >= club.memberLimit) {
              fail('Club has reached its member limit.', 409);
            }
            if (existingMember?.status === 'pending') {
              nextRequestCount = Math.max(0, nextRequestCount - 1);
            }
            nextMemberCount += 1;
          }
          resultMember = {
            id: `${clubId}_${targetUid}`,
            clubId,
            uid: targetUid,
            role: existingMember?.role === 'captain' ? 'captain' : 'member',
            status: 'active',
            displayName: String(tUser?.displayName || 'Runner'),
            ...(typeof tUser?.username === 'string' && tUser.username
              ? { username: tUser.username }
              : {}),
            joinedAt: existingMember?.joinedAt || now,
            updatedAt: now,
          };
          tx.set(memberRef, resultMember);
          if (!tUser.primaryClubId) {
            tx.update(userRef(targetUid), { primaryClubId: clubId });
            upsertPublicProfileInTx(tx, {
              db,
              uid: targetUid,
              userSnap: targetUserSnap,
              publicProfileSnap: targetPubSnap,
              primaryClubId: clubId,
              primaryClubName: club.name,
              nowIso: now,
            });
          }
          tx.set(db.doc(`activityNotifications/club_join_${clubId}_${targetUid}`), {
            id: `club_join_${clubId}_${targetUid}`,
            uid: targetUid,
            kind: 'club_approved',
            actorUid,
            actorName: String(actor.displayName || 'Club Captain'),
            targetId: clubId,
            summary: `Welcome to ${club.name}!`,
            read: false,
            createdAt: now,
          });
        } else if (action === 'reject' || action === 'remove') {
          if (!existingMember) fail('Member record not found.', 404);
          tx.delete(memberRef);
          if (existingMember.status === 'pending') {
            nextRequestCount = Math.max(0, nextRequestCount - 1);
          } else if (existingMember.status === 'active') {
            nextMemberCount = Math.max(0, nextMemberCount - 1);
          }
          nextCaptainUids = nextCaptainUids.filter((u) => u !== targetUid);
          if (tUser.primaryClubId === clubId) {
            tx.update(userRef(targetUid), { primaryClubId: null });
            upsertPublicProfileInTx(tx, {
              db,
              uid: targetUid,
              userSnap: targetUserSnap,
              publicProfileSnap: targetPubSnap,
              primaryClubId: null,
              primaryClubName: '',
              nowIso: now,
            });
          }
          resultMember = null;
        } else if (action === 'promote_captain') {
          if (!existingMember || existingMember.status !== 'active') {
            fail('Runner must be an active club member before promotion.', 409);
          }
          if (!nextCaptainUids.includes(targetUid)) {
            if (nextCaptainUids.length >= MAX_CLUB_CAPTAINS) {
              fail(`Clubs support at most ${MAX_CLUB_CAPTAINS} captains.`, 409);
            }
            nextCaptainUids.push(targetUid);
          }
          resultMember = { ...existingMember, role: 'captain', updatedAt: now };
          tx.update(memberRef, { role: 'captain', updatedAt: now });
        } else if (action === 'demote_captain') {
          if (!existingMember || existingMember.status !== 'active') {
            fail('Member record not found.', 404);
          }
          nextCaptainUids = nextCaptainUids.filter((u) => u !== targetUid);
          resultMember = { ...existingMember, role: 'member', updatedAt: now };
          tx.update(memberRef, { role: 'member', updatedAt: now });
        }

        tx.update(clubRef, {
          memberCount: nextMemberCount,
          requestCount: nextRequestCount,
          captainUids: nextCaptainUids,
          updatedAt: now,
        });

        const response = {
          clubId,
          action,
          member: resultMember,
          memberCount: nextMemberCount,
          requestCount: nextRequestCount,
          captainUids: nextCaptainUids,
        };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/meetup/save') {
      const meetup = validateClubMeetupInput(input, actorUid, now);
      const clubRef = db.doc(`clubs/${meetup.clubId}`);
      const meetupRef = db.doc(`clubMeetups/${meetup.meetupId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, meetupSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(meetupRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();
        const isCaptain =
          club.status === 'active' &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);
        if (!isAdminMgr && !isCaptain) fail('Club captain or admin permission required.', 403);
        if (club.status !== 'active') fail('Archived clubs cannot host new meetups.', 409);
        if (!club.modules?.events) fail('Meetups module is disabled for this club.', 403);

        const storedMeetup = meetupSnap.exists
          ? {
              ...meetup,
              createdAt: meetupSnap.data().createdAt || meetup.createdAt,
              createdBy: meetupSnap.data().createdBy || meetup.createdBy,
            }
          : meetup;
        tx.set(meetupRef, storedMeetup);
        const response = { meetup: storedMeetup };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/meetup/delete') {
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const meetupId = assertValidEntityId(input?.meetupId, 'meetupId');
      const clubRef = db.doc(`clubs/${clubId}`);
      const meetupRef = db.doc(`clubMeetups/${meetupId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, meetupSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(meetupRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();
        const isCaptain =
          club.status === 'active' &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);
        if (!isAdminMgr && !isCaptain) fail('Club captain or admin permission required.', 403);
        if (!meetupSnap.exists || meetupSnap.data()?.clubId !== clubId) {
          fail('Club meetup not found.', 404);
        }
        tx.delete(meetupRef);
        const response = { deleted: true, clubId, meetupId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/announcement/save') {
      const announcement = validateClubAnnouncementInput(input, actorUid, now);
      const clubRef = db.doc(`clubs/${announcement.clubId}`);
      const annRef = db.doc(`clubAnnouncements/${announcement.announcementId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, annSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(annRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();
        const isCaptain =
          club.status === 'active' &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);
        if (!isAdminMgr && !isCaptain) fail('Club captain or admin permission required.', 403);
        if (club.status !== 'active') fail('Archived clubs cannot post announcements.', 409);
        if (!club.modules?.announcements) {
          fail('Announcements module is disabled for this club.', 403);
        }

        const storedAnnouncement = annSnap.exists
          ? {
              ...announcement,
              createdAt: annSnap.data().createdAt || announcement.createdAt,
              createdBy: annSnap.data().createdBy || announcement.createdBy,
            }
          : announcement;
        tx.set(annRef, storedAnnouncement);
        const response = { announcement: storedAnnouncement };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/spotlight/save') {
      const spotlight = validateClubSpotlightInput(input, actorUid, now);
      const clubRef = db.doc(`clubs/${spotlight.clubId}`);
      const targetMemberRef = db.doc(`clubMembers/${spotlight.clubId}_${spotlight.targetUid}`);
      const spotlightRef = db.doc(`clubSpotlights/${spotlight.clubId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, clubSnap, targetMemberSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(clubRef),
          tx.get(targetMemberRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!clubSnap.exists) fail('Club not found.', 404);
        const club = clubSnap.data();
        const isCaptain =
          club.status === 'active' &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);
        if (!isAdminMgr && !isCaptain) fail('Club captain or admin permission required.', 403);
        if (club.status !== 'active') fail('Archived clubs cannot set spotlight.', 409);
        if (!club.modules?.memberSpotlight) {
          fail('Member spotlight module is disabled for this club.', 403);
        }
        if (!targetMemberSnap.exists || targetMemberSnap.data()?.status !== 'active') {
          fail('Spotlight target must be an active member of this club.', 400);
        }

        tx.set(spotlightRef, spotlight);
        const response = { spotlight };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/clubs/leaderboard') {
      if (!isRunnerClubs && !isAdminView && !isAdminMgr) {
        fail('Club leaderboards are not enabled for this account.', 403);
      }
      const clubId = assertValidEntityId(input?.clubId, 'clubId', CLUB_ID_RE);
      const clubSnap = await db.doc(`clubs/${clubId}`).get();
      if (!clubSnap.exists) fail('Club not found.', 404);
      const club = clubSnap.data();
      if (club.status !== 'active' && !isAdminMgr && !isAdminView) {
        fail('Archived club leaderboard is unavailable.', 403);
      }
      if (!club.modules?.leaderboard) {
        fail('Leaderboard module is disabled for this club.', 403);
      }

      const memberSnaps = await queryCollectionDocs(db, 'clubMembers', (c) =>
        c.where('clubId', '==', clubId),
      );
      const activeMembers = memberSnaps
        .map((s) => s.data())
        .filter((m) => m && m.status === 'active')
        .slice(0, 200);

      const memberUids = activeMembers.map((m) => m.uid);
      const [runLists, pubSnaps] = await Promise.all([
        Promise.all(
          memberUids.map((uid) =>
            queryCollectionDocs(db, 'recordedRuns', (c) => c.where('uid', '==', uid)),
          ),
        ),
        Promise.all(memberUids.map((uid) => publicProfileRef(uid).get())),
      ]);

      const runs = [];
      for (const list of runLists) {
        for (const s of list) {
          const r = s.data();
          if (r) runs.push(r);
        }
      }
      const profilesByUid = {};
      for (let i = 0; i < memberUids.length; i += 1) {
        if (pubSnaps[i]?.exists) {
          profilesByUid[memberUids[i]] = pubSnaps[i].data();
        }
      }

      let sinceIso = typeof input?.sinceIso === 'string' ? input.sinceIso : undefined;
      const untilIso = typeof input?.untilIso === 'string' ? input.untilIso : undefined;
      if (!sinceIso && (input?.window === '7d' || input?.window === '30d')) {
        const nowMs = Date.parse(now);
        const days = input.window === '7d' ? 7 : 30;
        sinceIso = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
      }

      const entries = computeClubLeaderboard(activeMembers, runs, profilesByUid, {
        sinceIso,
        untilIso,
      });
      return { clubId, entries };
    }

    fail('Unknown club command.', 404);
  }

  return { execute };
}

module.exports = { CLUB_READ_ROUTES, CLUB_ROUTES, createClubService };
