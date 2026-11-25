'use strict';

const policy = require('./access-policy');
const {
  assertSafeText,
  assertValidEntityId,
  fail,
} = require('./club-engine');
const {
  ALLOWED_CHAT_MEDIA_PATH_RE,
  ALLOWED_SOCIAL_MEDIA_PATH_RE,
  ROUTE_SNAP_LINK_RADIUS_M,
  decodeCursor,
  encodeCursor,
  findNearestCourseCorridorMatch,
  validateCommentInput,
  validateContentReportInput,
  validatePostRepostPermission,
  validateSocialPostInput,
} = require('./social-engine');

const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SOCIAL_ROUTES = new Set([
  '/social/post/create',
  '/social/post/delete',
  '/social/post/kudos',
  '/social/post/comment',
  '/social/post/repost',
  '/social/feed',
  '/social/snaps',
  '/social/close-friends/toggle',
  '/social/block/toggle',
  '/social/report/create',
  '/moderation/reports/resolve',
  '/media/sign',
]);
const SOCIAL_READ_ROUTES = new Set(['/social/feed', '/social/snaps', '/media/sign']);
const VALID_FEED_MODES = new Set(['discover', 'following']);
const VALID_SNAP_SCOPES = new Set(['all', 'public', 'friends', 'close_friends']);
const VALID_MODERATION_ACTIONS = new Set(['dismiss', 'hide_content', 'delete_content']);
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
const MAX_MEDIA_SIGN_PATHS = 24;

function checkIdempotentReplay(idempSnap, reqDigest) {
  if (!idempSnap || !idempSnap.exists) return null;
  if (idempSnap.data().digest !== reqDigest) {
    fail('Request ID already used for a different operation.', 409);
  }
  return idempSnap.data().response;
}

async function queryCollectionDocs(db, collectionPath, buildQuery = (c) => c) {
  if (!db || typeof db.collection !== 'function') return [];
  const col = db.collection(collectionPath);
  if (!col) return [];
  const snap = await buildQuery(col).get();
  return Array.isArray(snap?.docs) ? snap.docs : [];
}

async function deleteDocsInBatches(db, docs) {
  if (!db || typeof db.batch !== 'function' || !Array.isArray(docs) || docs.length === 0) {
    return 0;
  }
  const uniqueRefs = [];
  const seenPaths = new Set();
  for (const item of docs) {
    const ref = item?.ref || item;
    if (ref?.path && !seenPaths.has(ref.path)) {
      seenPaths.add(ref.path);
      uniqueRefs.push(ref);
    }
  }
  let deletedCount = 0;
  for (let i = 0; i < uniqueRefs.length; i += 400) {
    const batch = db.batch();
    uniqueRefs.slice(i, i + 400).forEach((ref) => {
      batch.delete(ref);
      deletedCount += 1;
    });
    await batch.commit();
  }
  return deletedCount;
}

function buildSafePublicProfileData({
  uid,
  userData,
  existingPublicData,
  primaryClubId,
  primaryClubName,
  nowIso,
}) {
  const safeDisplayName = String(
    userData?.displayName || existingPublicData?.displayName || 'Runner',
  ).slice(0, 100);
  const rawUsername =
    typeof userData?.username === 'string' && userData.username.trim()
      ? userData.username.trim().toLowerCase()
      : typeof existingPublicData?.username === 'string'
        ? existingPublicData.username.trim().toLowerCase()
        : '';
  const safePhoto =
    typeof userData?.photoURL === 'string' && /^https:\/\//i.test(userData.photoURL)
      ? userData.photoURL.slice(0, 2048)
      : typeof existingPublicData?.photoURL === 'string' && /^https:\/\//i.test(existingPublicData.photoURL)
        ? existingPublicData.photoURL.slice(0, 2048)
        : '';
  const resolvedClubId =
    primaryClubId !== undefined
      ? primaryClubId
      : (userData?.primaryClubId ?? existingPublicData?.primaryClubId ?? null);
  const resolvedClubName =
    primaryClubName !== undefined
      ? primaryClubName
      : String(existingPublicData?.primaryClubName || '');

  return {
    uid,
    displayName: safeDisplayName,
    ...(rawUsername ? { username: rawUsername } : {}),
    ...(safePhoto ? { photoURL: safePhoto } : {}),
    ...(typeof userData?.bio === 'string' && userData.bio.trim()
      ? { bio: userData.bio.trim().slice(0, 160) }
      : {}),
    ...(typeof userData?.location === 'string' && userData.location.trim()
      ? { location: userData.location.trim().slice(0, 80) }
      : {}),
    ...(typeof userData?.favoriteDistance === 'string' && userData.favoriteDistance.trim()
      ? { favoriteDistance: userData.favoriteDistance.trim().slice(0, 30) }
      : {}),
    primaryClubId: resolvedClubId || null,
    primaryClubName: resolvedClubId ? resolvedClubName : '',
    updatedAt: nowIso,
  };
}

function upsertPublicProfileInTx(
  tx,
  { db, uid, userSnap, publicProfileSnap, primaryClubId, primaryClubName, nowIso },
) {
  const userData = userSnap?.exists ? userSnap.data() : null;
  const existingPublic = publicProfileSnap?.exists ? publicProfileSnap.data() : null;
  const payload = buildSafePublicProfileData({
    uid,
    userData,
    existingPublicData: existingPublic,
    primaryClubId,
    primaryClubName,
    nowIso,
  });
  tx.set(db.doc(`publicProfiles/${uid}`), payload);
  return payload;
}

async function loadBlockedUidSet(db, viewerUid) {
  const [outSnaps, inSnaps] = await Promise.all([
    queryCollectionDocs(db, 'userBlocks', (c) => c.where('blockerUid', '==', viewerUid)),
    queryCollectionDocs(db, 'userBlocks', (c) => c.where('blockedUid', '==', viewerUid)),
  ]);
  const blockedUidSet = new Set();
  for (const snap of outSnaps) {
    const uid = snap.data()?.blockedUid;
    if (typeof uid === 'string' && uid.trim()) blockedUidSet.add(uid.trim());
  }
  for (const snap of inSnaps) {
    const uid = snap.data()?.blockerUid;
    if (typeof uid === 'string' && uid.trim()) blockedUidSet.add(uid.trim());
  }
  return blockedUidSet;
}

async function loadFriendUidSet(db, viewerUid) {
  const snaps = await queryCollectionDocs(db, 'friendships', (c) =>
    c.where('members', 'array-contains', viewerUid),
  );
  const friendUidSet = new Set();
  for (const snap of snaps) {
    const data = snap.data();
    if (!data || typeof data !== 'object') continue;
    if (Array.isArray(data.members)) {
      for (const m of data.members) {
        if (typeof m === 'string' && m.trim() && m.trim() !== viewerUid) {
          friendUidSet.add(m.trim());
        }
      }
    }
  }
  return friendUidSet;
}

async function loadCloseFriendOwnerSet(db, viewerUid) {
  const snaps = await queryCollectionDocs(db, 'closeFriendEdges', (c) =>
    c.where('targetUid', '==', viewerUid),
  );
  const set = new Set();
  for (const snap of snaps) {
    const ownerUid = snap.data()?.ownerUid;
    if (typeof ownerUid === 'string' && ownerUid.trim()) set.add(ownerUid.trim());
  }
  return set;
}

async function loadSocialGraphForViewer(db, viewerUid) {
  const [friendUidSet, blockedUidSet, closeFriendOwnersSet] = await Promise.all([
    loadFriendUidSet(db, viewerUid),
    loadBlockedUidSet(db, viewerUid),
    loadCloseFriendOwnerSet(db, viewerUid),
  ]);
  return { friendUidSet, blockedUidSet, closeFriendOwnersSet };
}

function canViewerReadPost(post, viewerUid, graph = {}) {
  if (!post || typeof post !== 'object') return false;
  const isModerator = graph.isModerator === true;
  if (post.deletedAt || post.hiddenByModeration === true) {
    return isModerator;
  }
  if (post.uid === viewerUid || isModerator) return true;
  if (graph.blockedUidSet && graph.blockedUidSet.has(post.uid)) return false;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'friends') {
    return Boolean(graph.friendUidSet && graph.friendUidSet.has(post.uid));
  }
  if (post.visibility === 'close_friends') {
    return Boolean(
      graph.friendUidSet &&
        graph.friendUidSet.has(post.uid) &&
        graph.closeFriendOwnersSet &&
        graph.closeFriendOwnersSet.has(post.uid),
    );
  }
  return false;
}

function sanitizePostForViewer(post) {
  if (!post || typeof post !== 'object') return post;
  if (post.visibility === 'public') return post;
  const sanitizedItems = Array.isArray(post.mediaItems)
    ? post.mediaItems.map((item) => ({ ...item, url: '' }))
    : [];
  return { ...post, mediaItems: sanitizedItems };
}

function createSocialService(db, storage = null, options = {}) {
  const userRef = (uid) => db.doc(`users/${uid}`);
  const publicProfileRef = (uid) => db.doc(`publicProfiles/${uid}`);

  function hasSocialPermission(actor, actorAccess) {
    return policy.can(actor, actorAccess, 'personal.social');
  }

  function isModeratorActor(actor, actorAccess) {
    return (
      policy.isAuthority(actor, actorAccess) ||
      policy.can(actor, actorAccess, 'moderation.manage')
    );
  }

  async function deleteSocialPrefixBestEffort(uid, postId) {
    if (!storage || typeof storage.bucket !== 'function') return;
    try {
      const bucket = storage.bucket();
      if (bucket && typeof bucket.deleteFiles === 'function') {
        await bucket.deleteFiles({ prefix: `social-media/${uid}/${postId}/`, force: true });
      }
    } catch (error) {
      console.warn('Best-effort social media cleanup skipped', {
        code: error?.code || 'storage_delete_failed',
      });
    }
  }

  async function readPairGraphInTx(tx, actorUid, authorUid) {
    if (!authorUid || authorUid === actorUid) {
      return { isFriend: true, isBlocked: false, isCloseFriend: true };
    }
    const [f1, f2, b1, b2, cf] = await Promise.all([
      tx.get(db.doc(`friendships/${actorUid}_${authorUid}`)),
      tx.get(db.doc(`friendships/${authorUid}_${actorUid}`)),
      tx.get(db.doc(`userBlocks/${actorUid}_${authorUid}`)),
      tx.get(db.doc(`userBlocks/${authorUid}_${actorUid}`)),
      tx.get(db.doc(`closeFriendEdges/${authorUid}_${actorUid}`)),
    ]);
    return {
      isFriend: f1.exists || f2.exists,
      isBlocked: b1.exists || b2.exists,
      isCloseFriend: cf.exists,
    };
  }

  function checkPairPostRead(post, actorUid, pair, isModerator = false) {
    if (!post || post.deletedAt || post.hiddenByModeration === true) {
      return isModerator;
    }
    if (post.uid === actorUid || isModerator) return true;
    if (pair.isBlocked) return false;
    if (post.visibility === 'public') return true;
    if (post.visibility === 'friends') return pair.isFriend;
    if (post.visibility === 'close_friends') return pair.isFriend && pair.isCloseFriend;
    return false;
  }

  async function executeCreatePost({ actor, actorUid, input, idempRef, reqDigest, now }) {
    const validated = validateSocialPostInput(input, actorUid, now);

    let linkedCourse = null;
    if (validated.location) {
      const courseSnaps = await queryCollectionDocs(db, 'publishedRaceRoutes', (c) =>
        c.where('status', '==', 'published'),
      );
      const courses = courseSnaps.map((s) => s.data()).filter(Boolean);
      linkedCourse = findNearestCourseCorridorMatch(
        validated.location,
        courses,
        ROUTE_SNAP_LINK_RADIUS_M,
      );
    }

    let sourceAuthorUid = null;
    if (validated.repostOfPostId) {
      const sourcePreview = await db.doc(`socialPosts/${validated.repostOfPostId}`).get();
      if (!sourcePreview.exists) {
        fail('Source post is unavailable for reposting.', 404);
      }
      sourceAuthorUid = sourcePreview.data()?.uid || null;
    }

    const actorPrimaryClubId =
      typeof actor.primaryClubId === 'string' && actor.primaryClubId.trim()
        ? actor.primaryClubId.trim()
        : null;

    const postRef = db.doc(`socialPosts/${validated.postId}`);
    const snapRef = db.doc(`routeSnaps/${validated.postId}`);
    const sourcePostRef = validated.repostOfPostId
      ? db.doc(`socialPosts/${validated.repostOfPostId}`)
      : null;

    return db.runTransaction(async (tx) => {
      const blockRefs =
        sourceAuthorUid && sourceAuthorUid !== actorUid
          ? [
              db.doc(`userBlocks/${actorUid}_${sourceAuthorUid}`),
              db.doc(`userBlocks/${sourceAuthorUid}_${actorUid}`),
            ]
          : [];
      const clubRef = actorPrimaryClubId ? db.doc(`clubs/${actorPrimaryClubId}`) : null;

      const [
        idempSnap,
        postSnap,
        userSnap,
        publicSnap,
        clubSnap,
        sourceSnap,
        ...blockSnaps
      ] = await Promise.all([
        tx.get(idempRef),
        tx.get(postRef),
        tx.get(userRef(actorUid)),
        tx.get(publicProfileRef(actorUid)),
        clubRef ? tx.get(clubRef) : Promise.resolve(null),
        sourcePostRef ? tx.get(sourcePostRef) : Promise.resolve(null),
        ...blockRefs.map((r) => tx.get(r)),
      ]);

      const replayed = checkIdempotentReplay(idempSnap, reqDigest);
      if (replayed) return replayed;
      if (postSnap.exists) fail('A post with this postId already exists.', 409);
      if (!userSnap.exists || userSnap.data()?.accessRemoved === true) {
        fail('Your app account is unavailable.', 403);
      }

      const userData = userSnap.data();
      let sourcePost = null;
      if (sourcePostRef) {
        if (!sourceSnap || !sourceSnap.exists) {
          fail('Source post is unavailable for reposting.', 404);
        }
        sourcePost = sourceSnap.data();
        if (sourcePost.hiddenByModeration === true) {
          fail('Source post is unavailable for reposting.', 404);
        }
        validatePostRepostPermission(sourcePost);
        if (blockSnaps.some((s) => s.exists)) {
          fail('Cannot repost content from a blocked account.', 403);
        }
        tx.update(sourcePostRef, {
          repostsCount: (Number(sourcePost.repostsCount) || 0) + 1,
          updatedAt: now,
        });
        if (sourcePost.uid !== actorUid) {
          tx.set(db.doc(`activityNotifications/repost_${validated.postId}`), {
            id: `repost_${validated.postId}`,
            uid: sourcePost.uid,
            kind: 'repost',
            actorUid,
            actorName: String(userData.displayName || 'Runner'),
            targetId: validated.postId,
            summary: `${userData.displayName || 'A runner'} reposted your update.`,
            read: false,
            createdAt: now,
          });
        }
      }

      const clubName =
        clubSnap && clubSnap.exists && clubSnap.data()?.status === 'active'
          ? String(clubSnap.data().name || '')
          : '';
      const publicProfile = upsertPublicProfileInTx(tx, {
        db,
        uid: actorUid,
        userSnap,
        publicProfileSnap: publicSnap,
        primaryClubId: clubName ? actorPrimaryClubId : (publicSnap?.exists ? publicSnap.data().primaryClubId : null),
        primaryClubName: clubName || (publicSnap?.exists ? publicSnap.data().primaryClubName : ''),
        nowIso: now,
      });

      const storedPost = {
        ...validated,
        authorDisplayName: publicProfile.displayName,
        ...(publicProfile.username ? { authorUsername: publicProfile.username } : {}),
        ...(publicProfile.photoURL ? { authorPhotoURL: publicProfile.photoURL } : {}),
        linkedCourse,
        hiddenByModeration: false,
      };
      tx.create(postRef, storedPost);

      let storedSnap = null;
      if (validated.location) {
        const firstImage =
          validated.mediaType === 'images' && Array.isArray(validated.mediaItems)
            ? validated.mediaItems[0]
            : null;
        storedSnap = {
          snapId: validated.postId,
          postId: validated.postId,
          uid: actorUid,
          visibility: validated.visibility,
          lat: validated.location.lat,
          lon: validated.location.lon,
          label: validated.location.label,
          publicationId: linkedCourse ? linkedCourse.publicationId : null,
          raceId: linkedCourse ? linkedCourse.raceId : null,
          corridorDistanceM: linkedCourse ? linkedCourse.distanceM : null,
          captionPreview: (validated.text || validated.location.label || 'Route snap').slice(0, 120),
          thumbnailPath: firstImage ? firstImage.storagePath : '',
          thumbnailUrl: validated.visibility === 'public' && firstImage ? firstImage.url : '',
          hiddenByModeration: false,
          deletedAt: null,
          createdAt: now,
        };
        tx.create(snapRef, storedSnap);
      }

      const response = { post: storedPost, routeSnap: storedSnap };
      tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
      return response;
    });
  }

  async function resolveSignRequest({ actorUid, isModerator, graph, storagePaths, now }) {
    if (!storage || typeof storage.bucket !== 'function') {
      fail('Media signing is temporarily unavailable.', 503);
    }
    const bucket = storage.bucket();
    const expiresMs = (typeof options.nowMs === 'function' ? options.nowMs() : Date.now.call(Date)) + SIGNED_URL_TTL_MS;
    const effectiveExpiresMs = Number.isFinite(Date.parse(now))
      ? Date.parse(now) + SIGNED_URL_TTL_MS
      : expiresMs;

    const authorizedPaths = [];
    const denied = [];

    for (const storagePath of storagePaths) {
      if (typeof storagePath !== 'string' || storagePath.includes('..')) {
        denied.push(String(storagePath || ''));
        continue;
      }
      if (ALLOWED_SOCIAL_MEDIA_PATH_RE.test(storagePath)) {
        const parts = storagePath.split('/');
        const ownerUid = parts[1];
        const postId = parts[2];
        const postSnap = await db.doc(`socialPosts/${postId}`).get();
        if (!postSnap.exists) {
          denied.push(storagePath);
          continue;
        }
        const post = postSnap.data();
        const referencesPath =
          post.uid === ownerUid &&
          Array.isArray(post.mediaItems) &&
          post.mediaItems.some((item) => item && item.storagePath === storagePath);
        if (!referencesPath || !canViewerReadPost(post, actorUid, { ...graph, isModerator })) {
          denied.push(storagePath);
          continue;
        }
        authorizedPaths.push(storagePath);
      } else if (ALLOWED_CHAT_MEDIA_PATH_RE.test(storagePath)) {
        const parts = storagePath.split('/');
        const conversationId = parts[1];
        const convSnap = await db.doc(`conversations/${conversationId}`).get();
        if (!convSnap.exists) {
          denied.push(storagePath);
          continue;
        }
        const conv = convSnap.data();
        if (isModerator) {
          authorizedPaths.push(storagePath);
          continue;
        }
        if (conv.type === 'dm') {
          const members = Array.isArray(conv.members) ? conv.members : [];
          const peerUid = members.find((m) => m !== actorUid);
          const isMember = members.includes(actorUid);
          if (!isMember || (peerUid && graph.blockedUidSet.has(peerUid))) {
            denied.push(storagePath);
            continue;
          }
          authorizedPaths.push(storagePath);
        } else if (conv.type === 'club' && conv.clubId) {
          const memberSnap = await db.doc(`clubMembers/${conv.clubId}_${actorUid}`).get();
          if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
            denied.push(storagePath);
            continue;
          }
          authorizedPaths.push(storagePath);
        } else {
          denied.push(storagePath);
        }
      } else {
        denied.push(storagePath);
      }
    }

    const signedUrls = {};
    for (const storagePath of authorizedPaths) {
      try {
        const [url] = await bucket.file(storagePath).getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: effectiveExpiresMs,
        });
        if (!url || typeof url !== 'string') {
          fail('Media signing is temporarily unavailable.', 503);
        }
        signedUrls[storagePath] = url;
      } catch (err) {
        if (err && typeof err.status === 'number') throw err;
        fail('Media signing is temporarily unavailable.', 503);
      }
    }

    return {
      signedUrls,
      expiresAt: new Date(effectiveExpiresMs).toISOString(),
      denied,
    };
  }

  async function execute({ actor, actorAccess, actorUid, path, input, idempRef, reqDigest, now }) {
    const canSocial = hasSocialPermission(actor, actorAccess);
    const isMod = isModeratorActor(actor, actorAccess);

    if (!SOCIAL_READ_ROUTES.has(path) && !idempRef) {
      fail('Valid requestId is required.', 400);
    }

    if (path === '/social/post/create') {
      if (!canSocial) fail('Social posting is not enabled for this account.', 403);
      return executeCreatePost({ actor, actorUid, input, idempRef, reqDigest, now });
    }

    if (path === '/social/post/repost') {
      if (!canSocial) fail('Social posting is not enabled for this account.', 403);
      const sourcePostId = assertValidEntityId(input?.sourcePostId, 'sourcePostId');
      return executeCreatePost({
        actor,
        actorUid,
        input: {
          ...input,
          repostOfPostId: sourcePostId,
          mediaType: input?.mediaType || 'none',
          mediaItems: Array.isArray(input?.mediaItems) ? input.mediaItems : [],
        },
        idempRef,
        reqDigest,
        now,
      });
    }

    if (path === '/social/post/delete') {
      const postId = assertValidEntityId(input?.postId, 'postId');
      if (!canSocial && !isMod) fail('Permission denied.', 403);
      const postRef = db.doc(`socialPosts/${postId}`);
      const snapRef = db.doc(`routeSnaps/${postId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const [idempSnap, postSnap, snapSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(postRef),
          tx.get(snapRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return { replayed: true, response: replayed, postUid: null };
        if (!postSnap.exists) fail('Post not found.', 404);
        const post = postSnap.data();
        if (post.uid !== actorUid && !isMod) {
          fail('You do not have permission to delete this post.', 403);
        }
        tx.update(postRef, { deletedAt: now, updatedAt: now });
        if (snapSnap.exists) tx.delete(snapRef);
        const response = { deleted: true, postId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return { replayed: false, response, postUid: post.uid };
      });
      if (!outcome.replayed && outcome.postUid) {
        await deleteSocialPrefixBestEffort(outcome.postUid, postId);
      }
      return outcome.response;
    }

    if (path === '/social/post/kudos') {
      if (!canSocial) fail('Social reactions require personal.social permission.', 403);
      const postId = assertValidEntityId(input?.postId, 'postId');
      const postRef = db.doc(`socialPosts/${postId}`);
      const prePost = await postRef.get();
      if (!prePost.exists) fail('Post not found.', 404);
      const authorUid = prePost.data().uid;
      const kudoRef = db.doc(`socialKudos/${postId}_${actorUid}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, postSnap, kudoSnap, actorUserSnap, pair] = await Promise.all([
          tx.get(idempRef),
          tx.get(postRef),
          tx.get(kudoRef),
          tx.get(userRef(actorUid)),
          readPairGraphInTx(tx, actorUid, authorUid),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!postSnap.exists) fail('Post not found.', 404);
        const post = postSnap.data();
        if (!checkPairPostRead(post, actorUid, pair, false)) {
          fail('You do not have permission to react to this post.', 403);
        }

        let liked = false;
        let nextKudosCount = Math.max(0, Math.floor(Number(post.kudosCount) || 0));
        if (kudoSnap.exists) {
          tx.delete(kudoRef);
          nextKudosCount = Math.max(0, nextKudosCount - 1);
          liked = false;
        } else {
          tx.create(kudoRef, {
            id: `${postId}_${actorUid}`,
            postId,
            uid: actorUid,
            recipientUid: post.uid,
            createdAt: now,
          });
          nextKudosCount += 1;
          liked = true;
          if (post.uid !== actorUid) {
            const actorName = String(actorUserSnap.data()?.displayName || 'A runner');
            tx.set(db.doc(`activityNotifications/kudo_${postId}_${actorUid}`), {
              id: `kudo_${postId}_${actorUid}`,
              uid: post.uid,
              kind: 'kudos',
              actorUid,
              actorName,
              targetId: postId,
              summary: `${actorName} gave kudos to your post.`,
              read: false,
              createdAt: now,
            });
          }
        }
        tx.update(postRef, { kudosCount: nextKudosCount, updatedAt: now });
        const response = { postId, liked, kudosCount: nextKudosCount };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/social/post/comment') {
      if (!canSocial) fail('Commenting requires personal.social permission.', 403);
      const comment = validateCommentInput(input, actorUid, now);
      const postRef = db.doc(`socialPosts/${comment.postId}`);
      const prePost = await postRef.get();
      if (!prePost.exists) fail('Post not found.', 404);
      const authorUid = prePost.data().uid;
      const commentRef = db.doc(`socialComments/${comment.commentId}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, postSnap, commentSnap, actorUserSnap, pair] = await Promise.all([
          tx.get(idempRef),
          tx.get(postRef),
          tx.get(commentRef),
          tx.get(userRef(actorUid)),
          readPairGraphInTx(tx, actorUid, authorUid),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!postSnap.exists) fail('Post not found.', 404);
        if (commentSnap.exists) fail('Comment already exists.', 409);
        const post = postSnap.data();
        if (!checkPairPostRead(post, actorUid, pair, false)) {
          fail('You do not have permission to comment on this post.', 403);
        }

        const actorData = actorUserSnap.exists ? actorUserSnap.data() : actor;
        const storedComment = {
          ...comment,
          authorDisplayName: String(actorData?.displayName || 'Runner'),
          ...(typeof actorData?.username === 'string' && actorData.username
            ? { authorUsername: actorData.username }
            : {}),
          hiddenByModeration: false,
        };
        tx.create(commentRef, storedComment);
        const nextCount = Math.max(0, Math.floor(Number(post.commentsCount) || 0)) + 1;
        tx.update(postRef, { commentsCount: nextCount, updatedAt: now });

        if (post.uid !== actorUid) {
          tx.set(db.doc(`activityNotifications/comment_${comment.commentId}`), {
            id: `comment_${comment.commentId}`,
            uid: post.uid,
            kind: 'comment',
            actorUid,
            actorName: storedComment.authorDisplayName,
            targetId: comment.postId,
            summary: `${storedComment.authorDisplayName} commented on your post.`,
            read: false,
            createdAt: now,
          });
        }
        const response = { comment: storedComment, commentsCount: nextCount };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/social/feed') {
      if (!canSocial && !isMod) fail('Feed access is not enabled for this account.', 403);
      const mode = typeof input?.mode === 'string' ? input.mode.trim() : 'discover';
      if (!VALID_FEED_MODES.has(mode)) fail('Invalid feed mode.', 400);
      const rawLimit = Number(input?.limit ?? 15);
      const limit = Number.isInteger(rawLimit) ? Math.min(30, Math.max(1, rawLimit)) : 15;
      const cursor = decodeCursor(input?.cursor);
      const authorFilterUid = input?.authorUid
        ? assertValidEntityId(input.authorUid, 'authorUid', VALID_UID_RE)
        : null;

      const graph = await loadSocialGraphForViewer(db, actorUid);
      let candidatePosts = [];

      if (authorFilterUid) {
        const snaps = await queryCollectionDocs(db, 'socialPosts', (c) =>
          c.where('uid', '==', authorFilterUid).orderBy('createdAt', 'desc').limit(limit * 3 + 15),
        );
        candidatePosts = snaps.map((s) => s.data()).filter(Boolean);
      } else if (mode === 'discover') {
        const snaps = await queryCollectionDocs(db, 'socialPosts', (c) =>
          c.where('visibility', '==', 'public').orderBy('createdAt', 'desc').limit(limit * 3 + 15),
        );
        candidatePosts = snaps.map((s) => s.data()).filter(Boolean);
      } else {
        const targetUids = [actorUid, ...Array.from(graph.friendUidSet)]
          .filter((u) => !graph.blockedUidSet.has(u))
          .slice(0, 60);
        const perUidLists = await Promise.all(
          targetUids.map((uid) =>
            queryCollectionDocs(db, 'socialPosts', (c) =>
              c.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(limit + 15),
            ),
          ),
        );
        for (const list of perUidLists) {
          for (const snap of list) {
            const p = snap.data();
            if (p) candidatePosts.push(p);
          }
        }
      }

      const uniqueById = new Map();
      for (const p of candidatePosts) {
        if (!p || !p.postId) continue;
        if (!canViewerReadPost(p, actorUid, graph)) continue;
        uniqueById.set(p.postId, sanitizePostForViewer(p));
      }

      const sorted = Array.from(uniqueById.values()).sort(
        (a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)) ||
          String(b.postId).localeCompare(String(a.postId)),
      );

      const afterCursor = cursor
        ? sorted.filter(
            (p) =>
              String(p.createdAt) < String(cursor.createdAt) ||
              (String(p.createdAt) === String(cursor.createdAt) &&
                String(p.postId) < String(cursor.postId)),
          )
        : sorted;

      const page = afterCursor.slice(0, limit);
      const hasMore = afterCursor.length > limit;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, postId: last.postId })
          : null;

      return { posts: page, nextCursor };
    }

    if (path === '/social/snaps') {
      const canViewRoutes = policy.can(actor, actorAccess, 'routes.view');
      if (!canSocial && !canViewRoutes && !isMod) {
        fail('Route snaps access denied.', 403);
      }
      const scope = typeof input?.scope === 'string' ? input.scope.trim() : 'all';
      if (!VALID_SNAP_SCOPES.has(scope)) fail('Invalid snaps scope.', 400);
      const publicationId = input?.publicationId
        ? assertValidEntityId(input.publicationId, 'publicationId')
        : null;
      const rawLimit = Number(input?.limit ?? 60);
      const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 60;

      const bounds = input?.bounds && typeof input.bounds === 'object' ? input.bounds : null;
      const hasValidBounds =
        bounds &&
        [bounds.north, bounds.south, bounds.east, bounds.west].every((n) => Number.isFinite(Number(n)));

      const [graph, snapDocs] = await Promise.all([
        loadSocialGraphForViewer(db, actorUid),
        publicationId
          ? queryCollectionDocs(db, 'routeSnaps', (c) =>
              c.where('publicationId', '==', publicationId).orderBy('createdAt', 'desc').limit(200),
            )
          : queryCollectionDocs(db, 'routeSnaps', (c) =>
              c.orderBy('createdAt', 'desc').limit(200),
            ),
      ]);

      const filtered = [];
      for (const docSnap of snapDocs) {
        const snap = docSnap.data();
        if (!snap) continue;
        if (!canViewerReadPost(snap, actorUid, graph)) continue;
        if (scope !== 'all' && snap.visibility !== scope) continue;
        if (hasValidBounds) {
          if (
            snap.lat < Number(bounds.south) ||
            snap.lat > Number(bounds.north) ||
            snap.lon < Number(bounds.west) ||
            snap.lon > Number(bounds.east)
          ) {
            continue;
          }
        }
        filtered.push(
          snap.visibility === 'public' ? snap : { ...snap, thumbnailUrl: '' },
        );
      }

      filtered.sort(
        (a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)) ||
          String(b.snapId).localeCompare(String(a.snapId)),
      );
      return { snaps: filtered.slice(0, limit) };
    }

    if (path === '/social/close-friends/toggle') {
      if (!canSocial) fail('Close friends requires personal.social permission.', 403);
      const targetUid = assertValidEntityId(input?.targetUid, 'targetUid', VALID_UID_RE);
      if (targetUid === actorUid) fail('Cannot add yourself as a close friend.', 400);

      const edgeRef = db.doc(`closeFriendEdges/${actorUid}_${targetUid}`);
      const targetUserRef = userRef(targetUid);
      return db.runTransaction(async (tx) => {
        const [idempSnap, targetSnap, edgeSnap, pair] = await Promise.all([
          tx.get(idempRef),
          tx.get(targetUserRef),
          tx.get(edgeRef),
          readPairGraphInTx(tx, actorUid, targetUid),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!targetSnap.exists || targetSnap.data()?.accessRemoved === true) {
          fail('Target runner account is unavailable.', 404);
        }
        if (pair.isBlocked) fail('Cannot manage close friends for a blocked account.', 403);
        if (!pair.isFriend) fail('Close friends must be accepted friends first.', 403);

        const enabled = typeof input?.enabled === 'boolean' ? input.enabled : !edgeSnap.exists;
        if (enabled && !edgeSnap.exists) {
          tx.create(edgeRef, {
            id: `${actorUid}_${targetUid}`,
            ownerUid: actorUid,
            targetUid,
            createdAt: now,
          });
        } else if (!enabled && edgeSnap.exists) {
          tx.delete(edgeRef);
        }
        const response = { targetUid, enabled };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/social/block/toggle') {
      const canAct =
        canSocial ||
        policy.can(actor, actorAccess, 'personal.inbox') ||
        policy.can(actor, actorAccess, 'personal.clubs') ||
        isMod;
      if (!canAct) fail('Account blocking requires active account access.', 403);
      const targetUid = assertValidEntityId(input?.targetUid, 'targetUid', VALID_UID_RE);
      if (targetUid === actorUid) fail('Cannot block your own account.', 400);

      const blockRef = db.doc(`userBlocks/${actorUid}_${targetUid}`);
      const cfOutRef = db.doc(`closeFriendEdges/${actorUid}_${targetUid}`);
      const cfInRef = db.doc(`closeFriendEdges/${targetUid}_${actorUid}`);

      return db.runTransaction(async (tx) => {
        const [idempSnap, blockSnap, cfOutSnap, cfInSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(blockRef),
          tx.get(cfOutRef),
          tx.get(cfInRef),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;

        const blocked = typeof input?.blocked === 'boolean' ? input.blocked : !blockSnap.exists;
        if (blocked) {
          if (!blockSnap.exists) {
            tx.create(blockRef, {
              id: `${actorUid}_${targetUid}`,
              blockerUid: actorUid,
              blockedUid: targetUid,
              createdAt: now,
            });
          }
          if (cfOutSnap.exists) tx.delete(cfOutRef);
          if (cfInSnap.exists) tx.delete(cfInRef);
        } else if (blockSnap.exists) {
          tx.delete(blockRef);
        }
        const response = { targetUid, blocked };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/social/report/create') {
      const canAct =
        canSocial ||
        policy.can(actor, actorAccess, 'personal.inbox') ||
        policy.can(actor, actorAccess, 'personal.clubs') ||
        isMod;
      if (!canAct) fail('Reporting requires an active community account.', 403);
      const report = validateContentReportInput(input, actorUid, now);
      const reportRef = db.doc(`contentReports/${report.reportId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap, reportSnap] = await Promise.all([tx.get(idempRef), tx.get(reportRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (reportSnap.exists) fail('Content report already exists.', 409);
        tx.create(reportRef, report);
        const response = { report };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/moderation/reports/resolve') {
      if (!isMod) fail('Moderation requires moderation.manage permission.', 403);
      const reportId = assertValidEntityId(input?.reportId, 'reportId');
      const action = typeof input?.action === 'string' ? input.action.trim() : '';
      if (!VALID_MODERATION_ACTIONS.has(action)) fail('Invalid moderation action.', 400);
      const resolutionNote = assertSafeText(input?.resolutionNote ?? '', {
        label: 'Resolution note',
        min: 0,
        max: 300,
      });

      const reportRef = db.doc(`contentReports/${reportId}`);
      const preReportSnap = await reportRef.get();
      if (!preReportSnap.exists) fail('Report not found.', 404);
      const preReport = preReportSnap.data();

      let targetRef = null;
      let routeSnapRef = null;
      if (action !== 'dismiss') {
        if (preReport.targetType === 'post') {
          targetRef = db.doc(`socialPosts/${preReport.targetId}`);
          routeSnapRef = db.doc(`routeSnaps/${preReport.targetId}`);
        } else if (preReport.targetType === 'comment') {
          targetRef = db.doc(`socialComments/${preReport.targetId}`);
        } else if (preReport.targetType === 'message' && preReport.targetParentId) {
          targetRef = db.doc(
            `conversations/${preReport.targetParentId}/messages/${preReport.targetId}`,
          );
        }
      }

      return db.runTransaction(async (tx) => {
        const [idempSnap, reportSnap, targetSnap, snapSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(reportRef),
          targetRef ? tx.get(targetRef) : Promise.resolve(null),
          routeSnapRef ? tx.get(routeSnapRef) : Promise.resolve(null),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!reportSnap.exists) fail('Report not found.', 404);

        const existing = reportSnap.data();
        if (action !== 'dismiss' && targetRef && targetSnap && targetSnap.exists) {
          const patch =
            action === 'hide_content'
              ? { hiddenByModeration: true, updatedAt: now }
              : { deletedAt: now, hiddenByModeration: true, updatedAt: now };
          tx.update(targetRef, patch);
          if (routeSnapRef && snapSnap && snapSnap.exists) {
            if (action === 'delete_content') {
              tx.delete(routeSnapRef);
            } else {
              tx.update(routeSnapRef, { hiddenByModeration: true });
            }
          }
        }

        const updatedReport = {
          ...existing,
          status: action === 'dismiss' ? 'dismissed' : 'action_taken',
          resolutionAction: action,
          reviewedBy: actorUid,
          reviewedAt: now,
          ...(resolutionNote ? { resolutionNote } : {}),
          updatedAt: now,
        };
        tx.update(reportRef, {
          status: updatedReport.status,
          resolutionAction: action,
          reviewedBy: actorUid,
          reviewedAt: now,
          ...(resolutionNote ? { resolutionNote } : {}),
          updatedAt: now,
        });
        const response = { report: updatedReport };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/media/sign') {
      const canInbox = policy.can(actor, actorAccess, 'personal.inbox');
      if (!canSocial && !canInbox && !isMod) {
        fail('Signed media access is not enabled for this account.', 403);
      }
      const rawPaths = [];
      if (Array.isArray(input?.storagePaths)) {
        for (const p of input.storagePaths) {
          if (typeof p === 'string' && p.trim()) rawPaths.push(p.trim());
        }
      }
      if (typeof input?.storagePath === 'string' && input.storagePath.trim()) {
        rawPaths.push(input.storagePath.trim());
      }
      const uniquePaths = Array.from(new Set(rawPaths));
      if (uniquePaths.length === 0) fail('At least one storagePath is required.', 400);
      if (uniquePaths.length > MAX_MEDIA_SIGN_PATHS) {
        fail(`At most ${MAX_MEDIA_SIGN_PATHS} storagePaths may be signed per call.`, 400);
      }

      const graph = await loadSocialGraphForViewer(db, actorUid);
      return resolveSignRequest({
        actorUid,
        isModerator: isMod,
        graph,
        storagePaths: uniquePaths,
        now,
      });
    }

    fail('Unknown social command.', 404);
  }

  return { execute };
}

module.exports = {
  SOCIAL_READ_ROUTES,
  SOCIAL_ROUTES,
  canViewerReadPost,
  checkIdempotentReplay,
  createSocialService,
  deleteDocsInBatches,
  loadBlockedUidSet,
  loadCloseFriendOwnerSet,
  loadFriendUidSet,
  loadSocialGraphForViewer,
  queryCollectionDocs,
  upsertPublicProfileInTx,
};
