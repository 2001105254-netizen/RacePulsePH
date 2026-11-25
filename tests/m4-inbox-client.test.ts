import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as inboxHelpers from '../src/lib/inbox/helpers';
import * as inboxClient from '../src/lib/inbox/client';
import * as e2eFixtures from '../src/lib/clubs/e2eFixtures';
import type { ClubDefinition } from '../src/lib/clubs/types';
import type {
  ActivityNotificationRecord,
  InboxConversationRecord,
  InboxMessageRecord,
} from '../src/lib/inbox/types';
import type { FriendProfile } from '../src/types';

test('validateChatMediaUploadFile & buildChatMediaStoragePath enforce <8MB raster-only rules and valid paths', () => {
  const valid = inboxClient.validateChatMediaUploadFile({
    name: 'Finish Line Photo!.webp',
    type: 'image/webp',
    size: 420_000,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.match(valid.safeFilename, /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.webp$/);
    assert.equal(valid.contentType, 'image/webp');
  }

  assert.equal(
    inboxClient.validateChatMediaUploadFile({
      name: 'vector.svg',
      type: 'image/svg+xml',
      size: 1200,
    }).ok,
    false,
  );
  assert.equal(
    inboxClient.validateChatMediaUploadFile({
      name: 'huge.png',
      type: 'image/png',
      size: 8 * 1024 * 1024,
    }).ok,
    false,
  );
  assert.equal(
    inboxClient.validateChatMediaUploadFile({
      name: 'empty.jpg',
      type: 'image/jpeg',
      size: 0,
    }).ok,
    false,
  );
  assert.equal(
    inboxClient.validateChatMediaUploadFile({
      name: 'wrong.png',
      type: 'image/jpeg',
      size: 1024,
    }).ok,
    false,
  );

  const dmPath = inboxClient.buildChatMediaStoragePath('dm_u1_u2', 'u1', 'photo.webp');
  assert.equal(dmPath, 'chat-media/dm_u1_u2/u1/photo.webp');
  const clubPath = inboxClient.buildChatMediaStoragePath('club_manila_pacers', 'u1', 'map.png');
  assert.equal(clubPath, 'chat-media/club_manila_pacers/u1/map.png');

  assert.throws(() =>
    inboxClient.buildChatMediaStoragePath('bad/conv', 'u1', 'photo.png'),
  );
});

test('inbox helpers merge, partition, sum unread counts, collect unsigned media paths, and resolve display metadata', () => {
  const dmActive: InboxConversationRecord = {
    conversationId: 'dm_u_me_u_friend',
    type: 'dm',
    members: ['u_friend', 'u_me'],
    status: 'active',
    lastMessageText: 'Warmup at 5am?',
    lastMessageAt: '2026-11-25T07:00:00.000Z',
    lastSenderUid: 'u_friend',
    unreadByUid: { u_me: 2, u_friend: 0 },
    updatedAt: '2026-11-25T07:00:00.000Z',
  };
  const dmIncomingReq: InboxConversationRecord = {
    conversationId: 'dm_u_me_u_new',
    type: 'dm',
    members: ['u_me', 'u_new'],
    status: 'request_pending',
    requestedByUid: 'u_new',
    requestedToUid: 'u_me',
    memberProfiles: {
      u_me: { displayName: 'Me', username: 'me' },
      u_new: { displayName: 'New Runner', username: 'newrunner' },
    },
    lastMessageText: 'Hi! Saw you in Baguio',
    lastMessageAt: '2026-11-25T08:00:00.000Z',
    lastSenderUid: 'u_new',
    unreadByUid: { u_me: 1, u_new: 0 },
    updatedAt: '2026-11-25T08:00:00.000Z',
  };
  const dmOutgoingReq: InboxConversationRecord = {
    conversationId: 'dm_u_me_u_out',
    type: 'dm',
    members: ['u_me', 'u_out'],
    status: 'request_pending',
    requestedByUid: 'u_me',
    requestedToUid: 'u_out',
    lastMessageText: 'Pinged about relay',
    lastMessageAt: '2026-11-25T06:00:00.000Z',
    lastSenderUid: 'u_me',
    unreadByUid: { u_me: 0 },
    updatedAt: '2026-11-25T06:00:00.000Z',
  };
  const clubConv: InboxConversationRecord = {
    conversationId: 'club_manila_sunrise_pacers',
    type: 'club',
    clubId: 'manila_sunrise_pacers',
    clubName: 'Manila Sunrise Pacers',
    members: [],
    status: 'active',
    lastMessageText: 'Saturday long run route pinned',
    lastMessageAt: '2026-11-25T09:00:00.000Z',
    lastSenderUid: 'u_friend',
    updatedAt: '2026-11-25T09:00:00.000Z',
  };

  const merged = inboxHelpers.mergeAndSortConversations([dmActive, dmIncomingReq, dmOutgoingReq], [clubConv]);
  assert.deepEqual(
    merged.map((c) => c.conversationId),
    [
      'club_manila_sunrise_pacers',
      'dm_u_me_u_new',
      'dm_u_me_u_friend',
      'dm_u_me_u_out',
    ],
  );

  const partitioned = inboxHelpers.partitionInboxConversations(merged, 'u_me');
  assert.deepEqual(
    partitioned.activeChats.map((c) => c.conversationId),
    ['club_manila_sunrise_pacers', 'dm_u_me_u_friend'],
  );
  assert.deepEqual(
    partitioned.incomingRequests.map((c) => c.conversationId),
    ['dm_u_me_u_new'],
  );
  assert.deepEqual(
    partitioned.outgoingRequests.map((c) => c.conversationId),
    ['dm_u_me_u_out'],
  );

  assert.equal(
    inboxHelpers.computeTotalInboxUnread({
      conversations: merged,
      myUid: 'u_me',
      unreadNotificationsCount: 3,
      pendingFriendRequestsCount: 1,
      pendingRaceInvitesCount: 2,
      remindersCount: 1,
    }),
    2 + 1 + 3 + 1 + 2 + 1,
  );

  const friendsMap = new Map<string, FriendProfile>([
    [
      'u_friend',
      { uid: 'u_friend', username: 'ben', displayName: 'Ben', updatedAt: '' },
    ],
  ]);
  const clubsMap = new Map<string, ClubDefinition>([
    [
      'manila_sunrise_pacers',
      {
        clubId: 'manila_sunrise_pacers',
        name: 'Manila Sunrise Pacers',
        description: '',
        city: 'Manila',
        scheduleSummary: 'Sat 5am',
        joinPolicy: 'open',
        modules: {
          chat: true,
          leaderboard: true,
          events: true,
          badges: true,
          routeLibrary: false,
          announcements: true,
          memberSpotlight: false,
          customTheme: true,
        },
        primaryColor: '#DC2626',
        accentColor: '#F59E0B',
        logoUrl: '',
        coverUrl: '',
        captainUids: [],
        linkedBadgeIds: [],
        featuredRouteIds: [],
        linkedRaceIds: [],
        memberLimit: 100,
        billingTier: 'free',
        subscriptionStatus: 'active',
        billingProvider: 'admin_manual',
        status: 'active',
        memberCount: 2,
        requestCount: 0,
        createdAt: '',
        createdBy: '',
        updatedAt: '',
        updatedBy: '',
      },
    ],
  ]);

  const dmMeta = inboxHelpers.resolveConversationDisplayMeta(dmActive, 'u_me', friendsMap, clubsMap);
  assert.equal(dmMeta.title, 'Ben');
  assert.equal(dmMeta.subtitle, '@ben');
  assert.equal(dmMeta.peerUid, 'u_friend');

  const clubMeta = inboxHelpers.resolveConversationDisplayMeta(clubConv, 'u_me', friendsMap, clubsMap);
  assert.equal(clubMeta.title, 'Manila Sunrise Pacers');
  assert.equal(clubMeta.peerUid, null);

  const msgs: InboxMessageRecord[] = [
    {
      messageId: 'm1',
      conversationId: dmActive.conversationId,
      senderUid: 'u_friend',
      text: 'Photo',
      media: { storagePath: 'chat-media/dm_u_me_u_friend/u_friend/a.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
      createdAt: '2026-11-25T07:00:00.000Z',
      deletedAt: null,
    },
    {
      messageId: 'm2',
      conversationId: dmActive.conversationId,
      senderUid: 'u_friend',
      text: '',
      media: { storagePath: 'chat-media/dm_u_me_u_friend/u_friend/del.jpg', mimeType: 'image/jpeg', sizeBytes: 100 },
      createdAt: '2026-11-25T07:01:00.000Z',
      deletedAt: '2026-11-25T07:02:00.000Z',
    },
  ];
  assert.deepEqual(inboxHelpers.collectUnsignedChatMediaPaths(msgs), [
    'chat-media/dm_u_me_u_friend/u_friend/a.jpg',
  ]);
});

test('Inbox DEV fixtures support message send, request accept/decline, moderation, and mark read', () => {
  const starter = e2eFixtures.buildDevStarterInboxData('e2e-runner', 'E2E Runner', '2026-11-25T08:00:00.000Z');
  assert.equal(starter.conversations.length >= 2, true);
  assert.equal(starter.streaks.length >= 1, true);

  const dmConv = starter.conversations.find((c) => c.type === 'dm' && c.status === 'active')!;
  const sent = e2eFixtures.sendDevInboxMessageFixture(
    starter.conversations,
    starter.messages,
    starter.streaks,
    {
      conversationId: dmConv.conversationId,
      messageId: 'msg_test_1',
      senderUid: 'e2e-runner',
      senderDisplayName: 'E2E Runner',
      text: 'On my way to the oval!',
      nowIso: '2026-11-25T08:05:00.000Z',
    },
  );
  assert.equal(sent.messages.some((m) => m.messageId === 'msg_test_1'), true);
  assert.equal(
    sent.conversations.find((c) => c.conversationId === dmConv.conversationId)?.lastMessageText,
    'On my way to the oval!',
  );

  const moderated = e2eFixtures.moderateDevInboxMessageFixture(
    sent.messages,
    dmConv.conversationId,
    'msg_test_1',
    '2026-11-25T08:06:00.000Z',
  );
  assert.ok(moderated.find((m) => m.messageId === 'msg_test_1')?.deletedAt);

  const marked = e2eFixtures.markDevInboxReadFixture(
    sent.conversations,
    starter.notifications,
    { conversationId: dmConv.conversationId, myUid: 'e2e-runner', markAllNotifications: true },
  );
  assert.equal(marked.notifications.every((n) => n.read === true), true);
});

test('inbox client helpers detect missing-index errors and sort conversations and notifications safely', () => {
  assert.equal(inboxClient.isFirestoreMissingIndexError({ code: 'failed-precondition' }), true);
  assert.equal(
    inboxClient.isFirestoreMissingIndexError(new Error('The query requires an index. You can create it here.')),
    true,
  );
  assert.equal(inboxClient.isFirestoreMissingIndexError({ code: 'permission-denied', message: 'Missing permissions' }), false);
  assert.equal(inboxClient.isFirestoreMissingIndexError(null), false);

  const convOlder: InboxConversationRecord = {
    conversationId: 'dm_u1_u2',
    type: 'dm',
    members: ['u1', 'u2'],
    status: 'active',
    lastMessageText: 'Older',
    lastMessageAt: '2026-11-25T06:00:00.000Z',
    lastSenderUid: 'u2',
    updatedAt: '',
    createdAt: '2026-11-25T05:00:00.000Z',
  };
  const convNewer: InboxConversationRecord = {
    conversationId: 'dm_u1_u3',
    type: 'dm',
    members: ['u1', 'u3'],
    status: 'active',
    lastMessageText: 'Newer',
    lastMessageAt: '2026-11-25T09:00:00.000Z',
    lastSenderUid: 'u3',
    updatedAt: '2026-11-25T09:00:00.000Z',
  };
  const inputConvs = [convOlder, convNewer];
  const sortedConvs = inboxClient.sortConversationsDesc(inputConvs);
  assert.deepEqual(sortedConvs.map((c) => c.conversationId), ['dm_u1_u3', 'dm_u1_u2']);
  assert.deepEqual(inputConvs.map((c) => c.conversationId), ['dm_u1_u2', 'dm_u1_u3']);

  const n1: ActivityNotificationRecord = {
    id: 'n1',
    uid: 'u1',
    kind: 'kudos',
    actorUid: 'u2',
    actorName: 'Runner Two',
    targetId: 'p1',
    summary: 'Liked your run',
    read: false,
    createdAt: '2026-11-25T07:00:00.000Z',
  };
  const n2: ActivityNotificationRecord = {
    id: 'n2',
    uid: 'u1',
    kind: 'comment',
    actorUid: 'u3',
    actorName: 'Runner Three',
    targetId: 'p2',
    summary: 'Commented on your run',
    read: false,
    createdAt: '2026-11-25T10:00:00.000Z',
  };
  const inputNotifs = [n1, n2];
  const sortedNotifs = inboxClient.sortActivityNotificationsDesc(inputNotifs);
  assert.deepEqual(sortedNotifs.map((n) => n.id), ['n2', 'n1']);
  assert.deepEqual(inputNotifs.map((n) => n.id), ['n1', 'n2']);
});
