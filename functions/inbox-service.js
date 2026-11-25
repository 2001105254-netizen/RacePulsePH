'use strict';

const policy = require('./access-policy');
const { assertSafeText, assertValidEntityId, fail } = require('./club-engine');
const {
  buildDmConversationId,
  updateFriendChatStreak,
  validateChatMessageInput,
} = require('./social-engine');
const { checkIdempotentReplay, deleteDocsInBatches, queryCollectionDocs } = require('./social-service');

const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const INBOX_ROUTES = new Set([
  '/inbox/dm/start',
  '/inbox/request/respond',
  '/inbox/message/send',
  '/inbox/message/moderate',
  '/inbox/read',
  '/inbox/push-token/save',
]);
const VALID_PUSH_PLATFORMS = new Set(['android', 'web', 'ios']);

function buildMessagePreviewText(msg) {
  if (msg.text) return msg.text.slice(0, 140);
  if (msg.media) return '[Photo]';
  if (msg.shareCard) return `Shared: ${msg.shareCard.title}`.slice(0, 140);
  return 'New message';
}

function createInboxService(db) {
  const userRef = (uid) => db.doc(`users/${uid}`);

  function canInbox(actor, actorAccess) {
    return policy.can(actor, actorAccess, 'personal.inbox');
  }

  function isModerator(actor, actorAccess) {
    return (
      policy.isAuthority(actor, actorAccess) ||
      policy.can(actor, actorAccess, 'moderation.manage')
    );
  }

  async function execute({ actor, actorAccess, actorUid, path, input, idempRef, reqDigest, now }) {
    if (!idempRef) fail('Valid requestId is required.', 400);

    if (path === '/inbox/dm/start') {
      if (!canInbox(actor, actorAccess)) fail('Direct messaging requires personal.inbox.', 403);
      const targetUid = assertValidEntityId(input?.targetUid, 'targetUid', VALID_UID_RE);
      if (targetUid === actorUid) fail('Direct messages require another runner.', 400);

      const conversationId = buildDmConversationId(actorUid, targetUid);
      const convRef = db.doc(`conversations/${conversationId}`);
      const friendFwdRef = db.doc(`friendships/${actorUid}_${targetUid}`);
      const friendRevRef = db.doc(`friendships/${targetUid}_${actorUid}`);
      const blockFwdRef = db.doc(`userBlocks/${actorUid}_${targetUid}`);
      const blockRevRef = db.doc(`userBlocks/${targetUid}_${actorUid}`);

      return db.runTransaction(async (tx) => {
        const [
          idempSnap,
          convSnap,
          actorSnap,
          targetSnap,
          friendFwdSnap,
          friendRevSnap,
          blockFwdSnap,
          blockRevSnap,
        ] = await Promise.all([
          tx.get(idempRef),
          tx.get(convRef),
          tx.get(userRef(actorUid)),
          tx.get(userRef(targetUid)),
          tx.get(friendFwdRef),
          tx.get(friendRevRef),
          tx.get(blockFwdRef),
          tx.get(blockRevRef),
        ]);

        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!targetSnap.exists || targetSnap.data()?.accessRemoved === true) {
          fail('Runner account not found.', 404);
        }
        if (blockFwdSnap.exists || blockRevSnap.exists) {
          fail('Messaging is unavailable between these accounts.', 403);
        }

        if (convSnap.exists) {
          const response = { conversation: convSnap.data() };
          tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
          return response;
        }

        const areFriends = friendFwdSnap.exists || friendRevSnap.exists;
        const targetData = targetSnap.data();
        if (!areFriends && targetData?.allowMessageRequests !== true) {
          fail('This runner only accepts direct messages from accepted friends.', 403);
        }

        const actorData = actorSnap.exists ? actorSnap.data() : actor;
        const members = [actorUid, targetUid].sort();
        const conversation = {
          conversationId,
          type: 'dm',
          members,
          status: areFriends ? 'active' : 'request_pending',
          ...(areFriends ? {} : { requestedByUid: actorUid, requestedToUid: targetUid }),
          memberProfiles: {
            [actorUid]: {
              displayName: String(actorData?.displayName || 'Runner'),
              ...(typeof actorData?.username === 'string' && actorData.username
                ? { username: actorData.username }
                : {}),
            },
            [targetUid]: {
              displayName: String(targetData?.displayName || 'Runner'),
              ...(typeof targetData?.username === 'string' && targetData.username
                ? { username: targetData.username }
                : {}),
            },
          },
          lastMessageText: '',
          lastMessageAt: '',
          lastSenderUid: '',
          unreadByUid: { [actorUid]: 0, [targetUid]: 0 },
          createdAt: now,
          updatedAt: now,
        };
        tx.create(convRef, conversation);
        const response = { conversation };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/inbox/request/respond') {
      if (!canInbox(actor, actorAccess)) fail('Inbox actions require personal.inbox.', 403);
      const conversationId = assertSafeText(input?.conversationId, {
        label: 'conversationId',
        min: 5,
        max: 300,
      });
      if (!conversationId.startsWith('dm_')) fail('Only DM requests can be responded to.', 400);
      const decision = typeof input?.decision === 'string' ? input.decision.trim() : '';
      if (decision !== 'accept' && decision !== 'decline') {
        fail('Decision must be accept or decline.', 400);
      }

      const convRef = db.doc(`conversations/${conversationId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const [idempSnap, convSnap] = await Promise.all([tx.get(idempRef), tx.get(convRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return { replayed: true, response: replayed, declined: false };
        if (!convSnap.exists) fail('Message request not found.', 404);
        const conv = convSnap.data();
        if (
          conv.type !== 'dm' ||
          conv.status !== 'request_pending' ||
          conv.requestedToUid !== actorUid
        ) {
          fail('You are not authorized to respond to this message request.', 403);
        }

        if (decision === 'accept') {
          const updated = { ...conv, status: 'active', acceptedAt: now, updatedAt: now };
          tx.update(convRef, { status: 'active', acceptedAt: now, updatedAt: now });
          const response = { conversation: updated };
          tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
          return { replayed: false, response, declined: false };
        }

        tx.delete(convRef);
        const response = { declined: true, conversationId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return { replayed: false, response, declined: true };
      });

      if (!outcome.replayed && outcome.declined) {
        const msgDocs = await queryCollectionDocs(db, `conversations/${conversationId}/messages`);
        await deleteDocsInBatches(db, msgDocs);
      }
      return outcome.response;
    }

    if (path === '/inbox/message/send') {
      if (!canInbox(actor, actorAccess)) fail('Sending messages requires personal.inbox.', 403);
      const conversationId = assertSafeText(input?.conversationId, {
        label: 'conversationId',
        min: 5,
        max: 300,
      });
      const msg = validateChatMessageInput(input, conversationId, actorUid, now);

      const isClub = conversationId.startsWith('club_');
      const clubId = isClub ? conversationId.slice(5) : null;
      const convRef = db.doc(`conversations/${conversationId}`);
      const msgRef = db.doc(`conversations/${conversationId}/messages/${msg.messageId}`);

      let peerUid = null;
      if (!isClub) {
        const preConvSnap = await convRef.get();
        if (!preConvSnap.exists) fail('Conversation not found.', 404);
        const preMembers = Array.isArray(preConvSnap.data()?.members)
          ? preConvSnap.data().members
          : [];
        peerUid = preMembers.find((m) => m !== actorUid) || null;
      }

      return db.runTransaction(async (tx) => {
        const clubRef = isClub ? db.doc(`clubs/${clubId}`) : null;
        const clubMemberRef = isClub ? db.doc(`clubMembers/${clubId}_${actorUid}`) : null;
        const blockFwdRef = peerUid ? db.doc(`userBlocks/${actorUid}_${peerUid}`) : null;
        const blockRevRef = peerUid ? db.doc(`userBlocks/${peerUid}_${actorUid}`) : null;
        const friendFwdRef = peerUid ? db.doc(`friendships/${actorUid}_${peerUid}`) : null;
        const friendRevRef = peerUid ? db.doc(`friendships/${peerUid}_${actorUid}`) : null;
        const streakRef = !isClub ? db.doc(`friendStreaks/${conversationId}`) : null;

        const [
          idempSnap,
          convSnap,
          msgSnap,
          actorSnap,
          clubSnap,
          clubMemberSnap,
          blockFwdSnap,
          blockRevSnap,
          friendFwdSnap,
          friendRevSnap,
          streakSnap,
        ] = await Promise.all([
          tx.get(idempRef),
          tx.get(convRef),
          tx.get(msgRef),
          tx.get(userRef(actorUid)),
          clubRef ? tx.get(clubRef) : Promise.resolve(null),
          clubMemberRef ? tx.get(clubMemberRef) : Promise.resolve(null),
          blockFwdRef ? tx.get(blockFwdRef) : Promise.resolve(null),
          blockRevRef ? tx.get(blockRevRef) : Promise.resolve(null),
          friendFwdRef ? tx.get(friendFwdRef) : Promise.resolve(null),
          friendRevRef ? tx.get(friendRevRef) : Promise.resolve(null),
          streakRef ? tx.get(streakRef) : Promise.resolve(null),
        ]);

        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (msgSnap.exists) fail('Duplicate messageId.', 409);

        const actorData = actorSnap.exists ? actorSnap.data() : actor;
        const senderDisplayName = String(actorData?.displayName || 'Runner');
        const previewText = buildMessagePreviewText(msg);

        let updatedConv = null;
        let nextStreak = null;

        if (isClub) {
          if (!clubSnap || !clubSnap.exists) fail('Club not found.', 404);
          const club = clubSnap.data();
          if (club.status !== 'active') fail('This club is archived.', 409);
          if (!club.modules?.chat) fail('Chat module is disabled for this club.', 403);
          const isClubAdmin = policy.can(actor, actorAccess, 'clubs.manage');
          const isActiveMember =
            clubMemberSnap && clubMemberSnap.exists && clubMemberSnap.data()?.status === 'active';
          if (!isActiveMember && !isClubAdmin) {
            fail('Only active club members can post in club chat.', 403);
          }

          const existingConv = convSnap.exists ? convSnap.data() : null;
          updatedConv = {
            conversationId,
            type: 'club',
            clubId,
            clubName: club.name,
            members: [],
            status: 'active',
            lastMessageText: previewText,
            lastMessageAt: now,
            lastSenderUid: actorUid,
            updatedAt: now,
            createdAt: existingConv?.createdAt || now,
          };
          tx.set(convRef, updatedConv);
        } else {
          if (!convSnap.exists) fail('Conversation not found.', 404);
          const conv = convSnap.data();
          if (conv.type !== 'dm' || !Array.isArray(conv.members) || !conv.members.includes(actorUid)) {
            fail('You are not a participant in this conversation.', 403);
          }
          if ((blockFwdSnap && blockFwdSnap.exists) || (blockRevSnap && blockRevSnap.exists)) {
            fail('Messaging is unavailable between these accounts.', 403);
          }
          if (conv.status === 'request_pending') {
            if (conv.requestedByUid !== actorUid || conv.lastMessageAt) {
              fail(
                'Wait for this runner to accept your message request before sending more messages.',
                403,
              );
            }
          } else if (conv.status !== 'active') {
            fail('Conversation is unavailable.', 409);
          }

          const isFriends = Boolean(
            (friendFwdSnap && friendFwdSnap.exists) || (friendRevSnap && friendRevSnap.exists),
          );
          if (conv.status === 'active' && isFriends && streakRef) {
            nextStreak = updateFriendChatStreak(
              streakSnap && streakSnap.exists ? streakSnap.data() : null,
              actorUid,
              conv.members,
              now,
            );
            tx.set(streakRef, nextStreak);
          }

          const unreadByUid = { ...(conv.unreadByUid || {}) };
          for (const m of conv.members) {
            unreadByUid[m] = m === actorUid ? 0 : (Number(unreadByUid[m]) || 0) + 1;
          }
          updatedConv = {
            ...conv,
            lastMessageText: previewText,
            lastMessageAt: now,
            lastSenderUid: actorUid,
            unreadByUid,
            updatedAt: now,
          };
          tx.update(convRef, {
            lastMessageText: previewText,
            lastMessageAt: now,
            lastSenderUid: actorUid,
            unreadByUid,
            updatedAt: now,
          });
        }

        const storedMessage = {
          ...msg,
          senderDisplayName,
          hiddenByModeration: false,
        };
        tx.create(msgRef, storedMessage);

        const response = {
          message: storedMessage,
          conversation: updatedConv,
          ...(nextStreak ? { streak: nextStreak } : {}),
        };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/inbox/message/moderate') {
      const canAct = canInbox(actor, actorAccess) || isModerator(actor, actorAccess);
      if (!canAct) fail('Message moderation permission denied.', 403);
      const conversationId = assertSafeText(input?.conversationId, {
        label: 'conversationId',
        min: 5,
        max: 300,
      });
      const messageId = assertValidEntityId(input?.messageId, 'messageId');
      const isClub = conversationId.startsWith('club_');
      const clubId = isClub ? conversationId.slice(5) : null;

      const convRef = db.doc(`conversations/${conversationId}`);
      const msgRef = db.doc(`conversations/${conversationId}/messages/${messageId}`);
      const clubRef = isClub ? db.doc(`clubs/${clubId}`) : null;

      return db.runTransaction(async (tx) => {
        const [idempSnap, convSnap, msgSnap, clubSnap] = await Promise.all([
          tx.get(idempRef),
          tx.get(convRef),
          tx.get(msgRef),
          clubRef ? tx.get(clubRef) : Promise.resolve(null),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        if (!convSnap.exists || !msgSnap.exists) fail('Message not found.', 404);

        const conv = convSnap.data();
        const msg = msgSnap.data();
        const club = clubSnap && clubSnap.exists ? clubSnap.data() : null;
        const isClubCaptain =
          conv.type === 'club' &&
          club &&
          Array.isArray(club.captainUids) &&
          club.captainUids.includes(actorUid);

        if (msg.senderUid !== actorUid && !isModerator(actor, actorAccess) && !isClubCaptain) {
          fail('Only the sender, club captain, or moderator may delete this message.', 403);
        }

        tx.update(msgRef, {
          deletedAt: now,
          hiddenByModeration: true,
          moderatedBy: actorUid,
        });
        const response = { moderated: true, conversationId, messageId };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    if (path === '/inbox/read') {
      if (!canInbox(actor, actorAccess)) fail('Inbox actions require personal.inbox.', 403);
      const conversationId =
        typeof input?.conversationId === 'string' && input.conversationId.trim()
          ? input.conversationId.trim()
          : null;
      const notificationIds = Array.isArray(input?.notificationIds)
        ? Array.from(
            new Set(
              input.notificationIds
                .filter((id) => typeof id === 'string' && id.trim())
                .slice(0, 50),
            ),
          )
        : [];

      const convRef = conversationId ? db.doc(`conversations/${conversationId}`) : null;
      const clubMemberRef =
        conversationId && conversationId.startsWith('club_')
          ? db.doc(`clubMembers/${conversationId.slice(5)}_${actorUid}`)
          : null;
      const notiRefs = notificationIds.map((id) =>
        db.doc(`activityNotifications/${assertValidEntityId(id, 'notificationId')}`),
      );

      const outcome = await db.runTransaction(async (tx) => {
        const [idempSnap, convSnap, clubMemberSnap, notiSnaps] = await Promise.all([
          tx.get(idempRef),
          convRef ? tx.get(convRef) : Promise.resolve(null),
          clubMemberRef ? tx.get(clubMemberRef) : Promise.resolve(null),
          Promise.all(notiRefs.map((r) => tx.get(r))),
        ]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return { replayed: true, response: replayed };

        if (convRef && convSnap && convSnap.exists) {
          const conv = convSnap.data();
          const canAccessConv =
            (Array.isArray(conv.members) && conv.members.includes(actorUid)) ||
            (conv.type === 'club' && clubMemberSnap?.exists && clubMemberSnap.data()?.status === 'active');
          if (!canAccessConv) fail('Conversation access denied.', 403);
          const unreadByUid = { ...(conv.unreadByUid || {}), [actorUid]: 0 };
          tx.update(convRef, { unreadByUid, updatedAt: now });
        }

        let markedNotifications = 0;
        for (const nSnap of notiSnaps) {
          if (nSnap.exists && nSnap.data()?.uid === actorUid && nSnap.data()?.read !== true) {
            tx.update(nSnap.ref, { read: true });
            markedNotifications += 1;
          }
        }

        const response = { read: true, conversationId, markedNotifications };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return { replayed: false, response };
      });

      if (!outcome.replayed && input?.markAllNotifications === true) {
        const unreadDocs = await queryCollectionDocs(db, 'activityNotifications', (c) =>
          c.where('uid', '==', actorUid).where('read', '==', false),
        );
        for (let i = 0; i < unreadDocs.length; i += 400) {
          const batch = db.batch();
          unreadDocs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { read: true }));
          await batch.commit();
        }
      }
      return outcome.response;
    }

    if (path === '/inbox/push-token/save') {
      if (!canInbox(actor, actorAccess)) fail('Push notification registration requires personal.inbox.', 403);
      const tokenId = assertValidEntityId(input?.tokenId, 'tokenId');
      const token = assertSafeText(input?.token, { label: 'Push token', min: 8, max: 4096 });
      const platform = typeof input?.platform === 'string' ? input.platform.trim() : '';
      if (!VALID_PUSH_PLATFORMS.has(platform)) fail('Unsupported push platform.', 400);

      const tokenRef = db.doc(`userPushTokens/${actorUid}_${tokenId}`);
      return db.runTransaction(async (tx) => {
        const [idempSnap] = await Promise.all([tx.get(idempRef), tx.get(tokenRef)]);
        const replayed = checkIdempotentReplay(idempSnap, reqDigest);
        if (replayed) return replayed;
        const record = {
          id: `${actorUid}_${tokenId}`,
          uid: actorUid,
          token,
          platform,
          updatedAt: now,
        };
        tx.set(tokenRef, record);
        const response = { pushToken: record };
        tx.create(idempRef, { digest: reqDigest, response, createdAt: now });
        return response;
      });
    }

    fail('Unknown inbox command.', 404);
  }

  return { execute };
}

module.exports = { INBOX_ROUTES, createInboxService };
