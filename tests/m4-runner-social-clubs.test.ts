import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as clubHelpers from '../src/lib/clubs/runnerHelpers';
import * as socialHelpers from '../src/lib/social/feedHelpers';
import * as e2eFixtures from '../src/lib/clubs/e2eFixtures';
import type { ClubDefinition, ClubMemberRecord } from '../src/lib/clubs/types';
import type { RouteSnapPin, SocialPostRecord } from '../src/lib/social/types';

function makeClub(overrides: Partial<ClubDefinition> = {}): ClubDefinition {
  return {
    clubId: 'manila_sunrise_pacers',
    name: 'Manila Sunrise Pacers',
    description: 'Roxas Boulevard tempo crew.',
    city: 'Manila',
    scheduleSummary: 'Tue & Sat 05:15 AM PHT',
    joinPolicy: 'open',
    modules: {
      chat: true,
      leaderboard: true,
      events: false,
      badges: true,
      routeLibrary: true,
      announcements: true,
      memberSpotlight: false,
      customTheme: true,
    },
    primaryColor: '#DC2626',
    accentColor: '#F59E0B',
    logoUrl: '',
    coverUrl: '',
    captainUids: ['u_cap'],
    linkedBadgeIds: [],
    featuredRouteIds: [],
    linkedRaceIds: [],
    memberLimit: 300,
    billingTier: 'community',
    subscriptionStatus: 'active',
    billingProvider: 'admin_manual',
    status: 'active',
    memberCount: 12,
    requestCount: 0,
    createdAt: '2026-11-25T00:00:00.000Z',
    createdBy: 'u_admin',
    updatedAt: '2026-11-25T00:00:00.000Z',
    updatedBy: 'u_admin',
    ...overrides,
  };
}

function makePost(overrides: Partial<SocialPostRecord> = {}): SocialPostRecord {
  return {
    postId: 'post_1',
    uid: 'u_author',
    visibility: 'public',
    text: 'Morning 10K along High Street',
    mediaType: 'images',
    mediaItems: [
      {
        storagePath: 'social-media/u_author/post_1/img1.webp',
        mimeType: 'image/webp',
        sizeBytes: 120_000,
        url: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/img1.webp?alt=media',
      },
    ],
    attachedBadgeId: null,
    attachedClubId: null,
    attachedRaceId: null,
    attachedRunId: null,
    location: null,
    repostOfPostId: null,
    kudosCount: 2,
    commentsCount: 0,
    repostsCount: 0,
    createdAt: '2026-11-25T06:00:00.000Z',
    updatedAt: '2026-11-25T06:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

test('filterClubsForRunner, resolveEnabledClubModules, and canManageClubAsRunner behave deterministically', () => {
  const c1 = makeClub();
  const c2 = makeClub({
    clubId: 'cebu_hill_striders',
    name: 'Cebu Hill Striders',
    city: 'Cebu City',
    scheduleSummary: 'Wed 05:30 PM',
    modules: {
      chat: false,
      leaderboard: false,
      events: true,
      badges: false,
      routeLibrary: false,
      announcements: false,
      memberSpotlight: false,
      customTheme: false,
    },
  });
  const memberships: ClubMemberRecord[] = [
    {
      id: 'cebu_hill_striders_u_runner',
      clubId: 'cebu_hill_striders',
      uid: 'u_runner',
      role: 'member',
      status: 'active',
      joinedAt: '2026-11-25T01:00:00.000Z',
      updatedAt: '2026-11-25T01:00:00.000Z',
    },
    {
      id: 'manila_sunrise_pacers_u_runner',
      clubId: 'manila_sunrise_pacers',
      uid: 'u_runner',
      role: 'member',
      status: 'removed',
      joinedAt: '2026-11-25T01:00:00.000Z',
      updatedAt: '2026-11-25T01:00:00.000Z',
    },
  ];

  assert.deepEqual(
    clubHelpers.filterClubsForRunner([c1, c2], memberships, { scope: 'mine' }).map((c) => c.clubId),
    ['cebu_hill_striders'],
  );
  assert.deepEqual(
    clubHelpers.filterClubsForRunner([c1, c2], memberships, { scope: 'all', query: 'Manila' }).map((c) => c.clubId),
    ['manila_sunrise_pacers'],
  );
  assert.deepEqual(clubHelpers.resolveEnabledClubModules(c1), [
    'overview',
    'leaderboard',
    'announcements',
    'roster',
  ]);
  assert.deepEqual(clubHelpers.resolveEnabledClubModules(c2), [
    'overview',
    'events',
    'roster',
  ]);
  assert.equal(clubHelpers.canManageClubAsRunner(c1, 'u_cap', false), true);
  assert.equal(clubHelpers.canManageClubAsRunner(c1, 'u_runner', false), false);
  assert.equal(clubHelpers.canManageClubAsRunner(c1, 'u_runner', true), true);
});

test('social feed helpers enforce public-only reposts, unsigned private media collection, snap filtering, and block isolation', () => {
  const pubPost = makePost();
  const friendsPost = makePost({
    postId: 'post_fr',
    visibility: 'friends',
    mediaItems: [
      {
        storagePath: 'social-media/u_author/post_fr/private.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 90_000,
        url: '',
      },
    ],
  });
  const cfHidden = makePost({
    postId: 'post_hidden',
    uid: 'u_blocked',
    visibility: 'public',
    hiddenByModeration: true,
  });

  assert.equal(socialHelpers.canRepostSocialPost(pubPost), true);
  assert.equal(socialHelpers.canRepostSocialPost(friendsPost), false);
  assert.equal(socialHelpers.canRepostSocialPost(cfHidden), false);

  const snaps: RouteSnapPin[] = [
    {
      snapId: 'snap_1',
      postId: 'post_1',
      uid: 'u_author',
      visibility: 'public',
      lat: 16.41,
      lon: 120.59,
      label: 'Burnham Loop',
      publicationId: 'pub_baguio',
      raceId: 'race_baguio',
      captionPreview: 'Sunrise loop',
      thumbnailPath: 'social-media/u_author/post_1/img1.webp',
      thumbnailUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/img1.webp',
      createdAt: '2026-11-25T06:00:00.000Z',
    },
    {
      snapId: 'snap_2',
      postId: 'post_fr',
      uid: 'u_author',
      visibility: 'friends',
      lat: 16.42,
      lon: 120.6,
      label: 'Camp John Hay',
      publicationId: 'pub_baguio',
      raceId: 'race_baguio',
      captionPreview: 'Trail warmup',
      thumbnailPath: 'social-media/u_author/post_fr/private.jpg',
      thumbnailUrl: '',
      createdAt: '2026-11-25T06:10:00.000Z',
    },
    {
      snapId: 'snap_3',
      postId: 'post_cf',
      uid: 'u_other',
      visibility: 'close_friends',
      lat: 10.31,
      lon: 123.89,
      label: 'Cebu Busay',
      publicationId: 'pub_cebu',
      raceId: 'race_cebu',
      captionPreview: 'Hill climb',
      thumbnailPath: 'social-media/u_other/post_cf/climb.jpg',
      thumbnailUrl: '',
      createdAt: '2026-11-25T06:20:00.000Z',
    },
  ];

  assert.deepEqual(
    socialHelpers.collectUnsignedMediaPaths([pubPost, friendsPost], snaps).sort(),
    [
      'social-media/u_author/post_fr/private.jpg',
      'social-media/u_other/post_cf/climb.jpg',
    ],
  );
  assert.deepEqual(socialHelpers.filterSnapsByScope(snaps, 'off', 'pub_baguio'), []);
  assert.deepEqual(
    socialHelpers.filterSnapsByScope(snaps, 'friends', 'pub_baguio').map((s) => s.snapId),
    ['snap_2'],
  );
  assert.deepEqual(
    socialHelpers.applyBlockedUserToPosts([pubPost, friendsPost, cfHidden], 'u_blocked').map((p) => p.postId),
    ['post_1', 'post_fr'],
  );
});

test('M4 DEV fixtures support runner club joins, club requests, social posts, kudos, comments, close friends, and blocks', () => {
  const starterClubs = e2eFixtures.buildDevStarterClubs('2026-11-25T08:00:00.000Z');
  assert.equal(starterClubs.length, 1);

  const openJoin = e2eFixtures.toggleDevClubMembershipFixture(starterClubs, [], {
    clubId: 'manila_sunrise_pacers',
    uid: 'e2e-runner-2',
    displayName: 'Runner Two',
    mode: 'join',
  });
  assert.equal(openJoin.members.some((m) => m.uid === 'e2e-runner-2' && m.status === 'active'), true);

  const posts0 = e2eFixtures.buildDevStarterSocialPosts('2026-11-25T08:00:00.000Z');
  assert.equal(posts0.some((p) => p.visibility === 'public'), true);

  const posted = e2eFixtures.createDevSocialPostFixture(posts0, {
    postId: 'e2e_post_new',
    uid: 'e2e-runner',
    displayName: 'E2E Runner',
    visibility: 'public',
    text: 'Evening intervals done!',
  });
  assert.equal(posted[0].postId, 'e2e_post_new');

  const kudosRes = e2eFixtures.toggleDevKudosFixture(posted, new Set(), 'e2e_post_new');
  assert.equal(kudosRes.liked, true);
  assert.equal(kudosRes.posts[0].kudosCount, 1);

  const cfEdges = e2eFixtures.toggleDevCloseFriendFixture(new Set(), 'u_friend_1', true);
  assert.equal(cfEdges.has('u_friend_1'), true);
});
