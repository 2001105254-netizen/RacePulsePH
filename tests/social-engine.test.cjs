'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const socialEngine = require('../functions/social-engine');

const {
  SOCIAL_VISIBILITIES,
  MAX_POST_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  ROUTE_SNAP_LINK_RADIUS_M,
  REPORT_REASONS,
  validateSocialPostInput,
  validatePostRepostPermission,
  findNearestCourseCorridorMatch,
  validateCommentInput,
  validateContentReportInput,
  buildDmConversationId,
  buildClubConversationId,
  validateChatMessageInput,
  getPhtDateKey,
  updateFriendChatStreak,
  encodeCursor,
  decodeCursor,
} = socialEngine;

test('validateSocialPostInput enforces visibility, <= 4 images <= 8MB, 1 video <= 30MB / <= 60s, and no mixing', () => {
  assert.deepEqual(SOCIAL_VISIBILITIES, ['public', 'friends', 'close_friends']);
  assert.equal(MAX_POST_IMAGES, 4);
  assert.equal(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_VIDEO_BYTES, 30 * 1024 * 1024);
  assert.equal(MAX_VIDEO_DURATION_SEC, 60);

  const imgPath = 'social-media/u1/post_1/photo1.webp';
  const publicImgPost = validateSocialPostInput(
    {
      postId: 'post_1',
      visibility: 'public',
      text: 'Sunrise 10K along Manila Bay!',
      mediaType: 'images',
      mediaItems: [
        {
          storagePath: imgPath,
          mimeType: 'image/webp',
          sizeBytes: 1_200_000,
          width: 1200,
          height: 900,
        },
      ],
      attachedBadgeId: 'dawn_patrol_ph',
      location: { lat: 14.5794, lon: 120.9794, label: 'Roxas Boulevard' },
    },
    'u1',
    '2026-11-25T05:30:00.000Z',
  );
  assert.equal(publicImgPost.mediaType, 'images');
  assert.equal(publicImgPost.mediaItems.length, 1);
  assert.equal(publicImgPost.kudosCount, 0);

  const videoPost = validateSocialPostInput(
    {
      postId: 'post_2',
      visibility: 'close_friends',
      text: 'Last 400m kick!',
      mediaType: 'video',
      mediaItems: [
        {
          storagePath: 'social-media/u1/post_2/finish.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 12_000_000,
          durationSec: 45,
        },
      ],
    },
    'u1',
    '2026-11-25T05:30:00.000Z',
  );
  assert.equal(videoPost.visibility, 'close_friends');
  assert.equal(videoPost.mediaItems[0].durationSec, 45);

  // Reject > 4 photos
  assert.throws(() =>
    validateSocialPostInput(
      {
        postId: 'post_3',
        visibility: 'public',
        text: 'Too many',
        mediaType: 'images',
        mediaItems: Array.from({ length: 5 }, (_, i) => ({
          storagePath: `social-media/u1/post_3/p${i}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 1000,
        })),
      },
      'u1',
      '2026-11-25T05:30:00.000Z',
    ),
  );

  // Reject video > 60s or > 30MB
  assert.throws(() =>
    validateSocialPostInput(
      {
        postId: 'post_4',
        visibility: 'public',
        text: 'Long clip',
        mediaType: 'video',
        mediaItems: [
          {
            storagePath: 'social-media/u1/post_4/clip.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 5_000_000,
            durationSec: 61,
          },
        ],
      },
      'u1',
      '2026-11-25T05:30:00.000Z',
    ),
  );

  // Reject mixed video extension in images or foreign uid path
  assert.throws(() =>
    validateSocialPostInput(
      {
        postId: 'post_5',
        visibility: 'public',
        text: 'Foreign owner path',
        mediaType: 'images',
        mediaItems: [
          {
            storagePath: 'social-media/other_user/post_5/pic.png',
            mimeType: 'image/png',
            sizeBytes: 1000,
          },
        ],
      },
      'u1',
      '2026-11-25T05:30:00.000Z',
    ),
  );
});

test('validatePostRepostPermission allows only active public posts and rejects friends/close_friends', () => {
  assert.doesNotThrow(() =>
    validatePostRepostPermission({ postId: 'p1', visibility: 'public', deletedAt: null }),
  );
  assert.throws(
    () => validatePostRepostPermission({ postId: 'p2', visibility: 'friends', deletedAt: null }),
    { status: 403 },
  );
  assert.throws(
    () => validatePostRepostPermission({ postId: 'p3', visibility: 'close_friends', deletedAt: null }),
    { status: 403 },
  );
});

test('findNearestCourseCorridorMatch snaps location pins within 100 m and excludes > 100 m', () => {
  assert.equal(ROUTE_SNAP_LINK_RADIUS_M, 100);
  const courses = [
    {
      publicationId: 'pub_bgc_5k',
      raceId: 'bgc_run_2026',
      raceName: 'BGC Night Run',
      distanceLabel: '5K',
      previewPolyline: [
        [121.0507, 14.5504],
        [121.052, 14.552],
      ],
    },
  ];
  const near = findNearestCourseCorridorMatch(
    { lat: 14.5508, lon: 121.0507 }, // ~44m from first vertex
    courses,
  );
  assert.ok(near);
  assert.equal(near.publicationId, 'pub_bgc_5k');
  assert.ok(near.distanceM <= 100);

  const far = findNearestCourseCorridorMatch({ lat: 14.6, lon: 121.0507 }, courses);
  assert.equal(far, null);
});

test('comments, reports, DM IDs, and chat message validation enforce strict security invariants', () => {
  assert.ok(REPORT_REASONS.includes('harassment'));
  const comment = validateCommentInput(
    { commentId: 'c1', postId: 'p1', text: 'Great pace!' },
    'u2',
    '2026-11-25T06:00:00.000Z',
  );
  assert.equal(comment.uid, 'u2');

  const report = validateContentReportInput(
    {
      reportId: 'rep_1',
      targetType: 'post',
      targetId: 'p1',
      targetUid: 'u9',
      reason: 'spam',
      details: 'Repeated promo links.',
    },
    'u2',
    '2026-11-25T06:00:00.000Z',
  );
  assert.equal(report.status, 'open');

  const dmA = buildDmConversationId('u_zeta', 'u_alpha');
  const dmB = buildDmConversationId('u_alpha', 'u_zeta');
  assert.equal(dmA, 'dm_u_alpha_u_zeta');
  assert.equal(dmA, dmB);
  assert.equal(buildClubConversationId('bgc_striders_ph'), 'club_bgc_striders_ph');

  const msg = validateChatMessageInput(
    {
      messageId: 'm1',
      text: 'Meet at 5 AM!',
      shareCard: { type: 'race', targetId: 'race_1', title: 'Cebu 21K' },
      media: {
        storagePath: 'chat-media/dm_u_alpha_u_zeta/u_alpha/spot.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 512_000,
      },
    },
    'dm_u_alpha_u_zeta',
    'u_alpha',
    '2026-11-25T06:00:00.000Z',
  );
  assert.equal(msg.shareCard.type, 'race');

  assert.throws(() =>
    validateChatMessageInput(
      {
        messageId: 'm2',
        text: 'Spoofed sender path',
        media: {
          storagePath: 'chat-media/dm_u_alpha_u_zeta/u_other/spot.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 512_000,
        },
      },
      'dm_u_alpha_u_zeta',
      'u_alpha',
      '2026-11-25T06:00:00.000Z',
    ),
  );
});

test('PHT Daily Friend Chat Streak requires both participants and grants 1 freeze per 7 consecutive days (cap 2)', () => {
  const members = ['u_a', 'u_b'];
  assert.equal(getPhtDateKey('2026-11-24T17:00:00.000Z'), '2026-11-25'); // 01:00 PHT

  let state = null;
  // Run 7 consecutive PHT days (2026-11-01 to 2026-11-07)
  for (let day = 1; day <= 7; day += 1) {
    const isoA = `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`; // 09:00 PHT
    const isoB = `2026-11-${String(day).padStart(2, '0')}T02:00:00.000Z`; // 10:00 PHT
    state = updateFriendChatStreak(state, 'u_a', members, isoA);
    assert.equal(state.streakDays, day - 1);
    state = updateFriendChatStreak(state, 'u_b', members, isoB);
    assert.equal(state.streakDays, day);
  }
  assert.equal(state.graceRemaining, 1);

  // Miss 2026-11-08 cleanly, then complete both sides on 2026-11-09 -> consumes 1 freeze, keeps streak!
  state = updateFriendChatStreak(state, 'u_a', members, '2026-11-09T01:00:00.000Z');
  state = updateFriendChatStreak(state, 'u_b', members, '2026-11-09T02:00:00.000Z');
  assert.equal(state.streakDays, 8);
  assert.equal(state.graceRemaining, 0);

  // Build up to 2 freezes across 14 consecutive active days (cap check)
  for (let day = 10; day <= 23; day += 1) {
    const isoA = `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`;
    const isoB = `2026-11-${String(day).padStart(2, '0')}T02:00:00.000Z`;
    state = updateFriendChatStreak(state, 'u_a', members, isoA);
    state = updateFriendChatStreak(state, 'u_b', members, isoB);
  }
  assert.equal(state.streakDays, 22);
  assert.equal(state.graceRemaining, 2);

  // Miss 3 days (exceeds 2 freezes) -> resets cleanly to streakDays = 1 on new pair day
  state = updateFriendChatStreak(state, 'u_a', members, '2026-11-27T01:00:00.000Z');
  state = updateFriendChatStreak(state, 'u_b', members, '2026-11-27T02:00:00.000Z');
  assert.equal(state.streakDays, 1);
  assert.equal(state.graceRemaining, 0);
});

test('encodeCursor and decodeCursor round-trip safely and reject malformed or oversized tokens', () => {
  const token = encodeCursor({ sortAt: '2026-11-25T05:00:00.000Z', id: 'post_9' });
  const parsed = decodeCursor(token);
  assert.equal(parsed.id, 'post_9');
  assert.equal(decodeCursor(null), null);
  assert.throws(() => decodeCursor('not-valid-cursor!!!'));
  assert.throws(() => decodeCursor('x'.repeat(600)));
});
