import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as clubPresets from '../src/lib/clubs/presets.ts';
import * as socialMedia from '../src/lib/social/mediaValidation.ts';
import * as inboxTypes from '../src/lib/inbox/types.ts';

const require = createRequire(import.meta.url);
const clubEngine = require('../functions/club-engine.js');
const socialEngine = require('../functions/social-engine.js');

test('Club TS presets and modules match functions/club-engine.js constants with zero em dashes', () => {
  assert.deepEqual([...clubPresets.CLUB_MODULES], clubEngine.CLUB_MODULES);
  assert.deepEqual([...clubPresets.CLUB_JOIN_POLICIES], clubEngine.CLUB_JOIN_POLICIES);
  assert.deepEqual([...clubPresets.CLUB_BILLING_TIERS], clubEngine.CLUB_BILLING_TIERS);
  assert.deepEqual(
    [...clubPresets.CLUB_SUBSCRIPTION_STATUSES],
    clubEngine.CLUB_SUBSCRIPTION_STATUSES,
  );
  assert.deepEqual([...clubPresets.CLUB_BILLING_PROVIDERS], clubEngine.CLUB_BILLING_PROVIDERS);
  assert.equal(clubPresets.slugifyClubId('BGC Track Club'), clubEngine.slugifyClubId('BGC Track Club'));

  for (const key of clubPresets.CLUB_MODULES) {
    const meta = clubPresets.CLUB_MODULE_META[key];
    assert.ok(meta.label.length > 0);
    assert.ok(meta.description.length > 0);
    assert.doesNotMatch(meta.label, /\u2014/);
    assert.doesNotMatch(meta.description, /\u2014/);
  }
});

test('Social client media validation enforces 4 photos <= 8MB, 1 video <= 30MB <= 60s, and no SVG', () => {
  assert.deepEqual([...socialMedia.SOCIAL_VISIBILITIES], socialEngine.SOCIAL_VISIBILITIES);
  assert.deepEqual([...socialMedia.REPORT_REASONS], socialEngine.REPORT_REASONS);
  assert.equal(socialMedia.MAX_POST_IMAGES, socialEngine.MAX_POST_IMAGES);
  assert.equal(socialMedia.MAX_IMAGE_BYTES, socialEngine.MAX_IMAGE_BYTES);
  assert.equal(socialMedia.MAX_VIDEO_BYTES, socialEngine.MAX_VIDEO_BYTES);
  assert.equal(socialMedia.MAX_VIDEO_DURATION_SEC, socialEngine.MAX_VIDEO_DURATION_SEC);

  const okImg = socialMedia.validateSocialImageFile({
    name: 'route.webp',
    type: 'image/webp',
    size: 512_000,
  });
  assert.equal(okImg.ok, true);

  const svgRejected = socialMedia.validateSocialImageFile({
    name: 'vector.svg',
    type: 'image/svg+xml',
    size: 1024,
  });
  assert.equal(svgRejected.ok, false);

  const oversizeImg = socialMedia.validateSocialImageFile({
    name: 'huge.jpg',
    type: 'image/jpeg',
    size: socialMedia.MAX_IMAGE_BYTES + 1,
  });
  assert.equal(oversizeImg.ok, false);

  const okVideo = socialMedia.validateSocialVideoMetadata({
    name: 'finish.mp4',
    type: 'video/mp4',
    size: 10_000_000,
    durationSec: 32,
  });
  assert.equal(okVideo.ok, true);

  const longVideo = socialMedia.validateSocialVideoMetadata({
    name: 'long.mp4',
    type: 'video/mp4',
    size: 10_000_000,
    durationSec: 65,
  });
  assert.equal(longVideo.ok, false);

  const oversizeVideo = socialMedia.validateSocialVideoMetadata({
    name: 'heavy.webm',
    type: 'video/webm',
    size: socialMedia.MAX_VIDEO_BYTES + 1,
    durationSec: 15,
  });
  assert.equal(oversizeVideo.ok, false);
});

test('Inbox DM/Club IDs and streak summary formatter match server behavior cleanly', () => {
  assert.equal(inboxTypes.buildDmConversationId('u2', 'u1'), 'dm_u1_u2');
  assert.equal(inboxTypes.buildClubConversationId('bgc_club'), 'club_bgc_club');
  const streakLabel = inboxTypes.formatChatStreakLabel(7, 1);
  assert.equal(streakLabel, '7d streak (1 freeze)');
  assert.doesNotMatch(streakLabel, /\u2014/);
});
