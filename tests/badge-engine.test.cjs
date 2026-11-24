'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const engine = require('../functions/badge-engine');

const {
  BADGE_TIERS,
  BADGE_CATEGORIES,
  BADGE_BORDER_STYLES,
  BADGE_ANIMATION_EFFECTS,
  BADGE_EMBLEM_IDS,
  BADGE_RULE_TYPES,
  ALLOWED_BADGE_ASSET_PATH_RE,
  validateBadgeDefinitionInput,
  buildStarterBadgePack,
  xpForLevel,
  computeLevelFromXp,
  computeRunCompletionXp,
  getPhtHour,
  getPhtWeekIndex,
  computeRunStreakWeeksPht,
  isBadgeWithinActiveWindow,
  collectVerifiedFinishedRaceIds,
  evaluateBadgeRule,
} = engine;

function makeValidBadgeInput(overrides = {}) {
  return {
    badgeId: 'manila_sunrise_5k',
    name: 'Manila Sunrise 5K',
    description: 'Complete a verified 5 km run along Roxas Boulevard.',
    tier: 'rare',
    customTierLabel: '',
    category: 'distance',
    artworkType: 'emblem',
    emblemId: 'sunrise-burst',
    artworkUrl: '',
    artworkStoragePath: '',
    borderStyle: 'sunburst-ph',
    primaryColor: '#ff3b30',
    secondaryColor: '#f5b731',
    animationEffect: 'shimmer-sweep',
    xpReward: 150,
    rule: { type: 'run_single_distance_km', threshold: 5 },
    activeFrom: null,
    activeUntil: null,
    hiddenUntilEarned: false,
    status: 'active',
    sortOrder: 100,
    ...overrides,
  };
}

function makeVerifiedRun(overrides = {}) {
  return {
    runId: 'run_1',
    uid: 'runner_1',
    mode: 'free',
    privacy: 'public',
    title: 'Morning Run',
    startedAt: '2026-11-24T22:00:00.000Z', // 06:00 PHT on 2026-11-25
    finishedAt: '2026-11-24T22:45:00.000Z',
    elapsedTimeMs: 2_700_000,
    movingTimeMs: 2_700_000,
    distanceM: 5200,
    elevationGainM: 45,
    elevationLossM: 40,
    islandGroups: ['Luzon'],
    verificationStatus: 'verified',
    verificationFlags: [],
    createdAt: '2026-11-24T22:45:05.000Z',
    ...overrides,
  };
}

test('canonical badge engine constants match exact enumerations and counts', () => {
  assert.deepEqual(BADGE_TIERS, ['common', 'rare', 'special', 'epic', 'legendary', 'alamat']);
  assert.deepEqual(BADGE_CATEGORIES, [
    'onboarding',
    'distance',
    'elevation',
    'races',
    'exploration',
    'community',
    'streaks',
    'special',
  ]);
  assert.deepEqual(BADGE_BORDER_STYLES, [
    'solid-ring',
    'double-crest',
    'laurel-wreath',
    'hex-tactical',
    'sunburst-ph',
    'ribbon-medal',
    'diamond-cut',
    'cyber-bezel',
    'alamat-gold',
  ]);
  assert.deepEqual(BADGE_ANIMATION_EFFECTS, [
    'none',
    'shimmer-sweep',
    'gentle-float',
    'pulse-glow',
    'prism-tilt',
    'sparkle-orbit',
    'flame-aura',
  ]);
  assert.equal(BADGE_EMBLEM_IDS.length, 18);
  assert.deepEqual(BADGE_EMBLEM_IDS, [
    'sunrise-burst',
    'mountain-peak',
    'lightning-bolt',
    'trophy-crest',
    'laurel-crown',
    'compass-rose',
    'flame-spirit',
    'shoe-wings',
    'stopwatch-gold',
    'island-archipelago',
    'jeepney-star',
    'volcano-summit',
    'wave-runner',
    'heart-pulse',
    'shield-vanguard',
    'flag-finish',
    'moon-night',
    'diamond-alamat',
  ]);
  assert.equal(BADGE_RULE_TYPES.length, 17);
  assert.deepEqual(BADGE_RULE_TYPES, [
    'welcome',
    'profile_complete',
    'race_joined',
    'race_finished',
    'run_count',
    'run_single_distance_km',
    'run_total_distance_km',
    'run_total_elevation_m',
    'run_time_window',
    'regions_explored',
    'club_joined',
    'friends_count',
    'social_posts_count',
    'kudos_received',
    'run_streak_weeks',
    'inbox_streak_days',
    'manual_grant',
  ]);

  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/manila_5k/crest.png'), true);
  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/manila_5k/crest.PNG'), true);
  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/manila_5k/crest.webp'), true);
  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/manila_5k/crest.avif'), true);
  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/manila_5k/crest.svg'), false);
  assert.equal(ALLOWED_BADGE_ASSET_PATH_RE.test('badge-assets/admin_1/crest.png'), false);
  assert.equal(
    ALLOWED_BADGE_ASSET_PATH_RE.test(`badge-assets/admin_1/manila_5k/${'a'.repeat(129)}.png`),
    false,
  );
});

test('validateBadgeDefinitionInput normalizes colors, preserves existingDoc metadata, and allows valid uploads', () => {
  const nowIso = '2026-11-25T08:00:00.000Z';
  const saved = validateBadgeDefinitionInput(
    makeValidBadgeInput({
      primaryColor: '#abc',
      secondaryColor: '#ff3b30',
      customTierLabel: 'Pinoy Founding',
      artworkUrl: 'https://ignored.example/stale.png',
      artworkStoragePath: 'badge-assets/a/b/c.png',
    }),
    'admin_1',
    nowIso,
  );
  assert.equal(saved.primaryColor, '#AABBCC');
  assert.equal(saved.secondaryColor, '#FF3B30');
  assert.equal(saved.customTierLabel, 'Pinoy Founding');
  assert.equal(saved.artworkUrl, '');
  assert.equal(saved.artworkStoragePath, '');
  assert.equal(saved.createdBy, 'admin_1');
  assert.equal(saved.createdAt, nowIso);
  assert.equal(saved.updatedBy, 'admin_1');
  assert.equal(saved.updatedAt, nowIso);

  const edited = validateBadgeDefinitionInput(
    makeValidBadgeInput({
      badgeId: 'custom_upload_1',
      artworkType: 'upload',
      emblemId: '',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fcustom_upload_1%2Fcrest.webp?alt=media&token=abc',
      artworkStoragePath: 'badge-assets/admin_1/custom_upload_1/crest.webp',
    }),
    'admin_2',
    '2026-11-26T00:00:00.000Z',
    { createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'superadmin_0' },
  );
  assert.equal(edited.createdAt, '2026-11-01T00:00:00.000Z');
  assert.equal(edited.createdBy, 'superadmin_0');
  assert.equal(edited.updatedAt, '2026-11-26T00:00:00.000Z');
  assert.equal(edited.updatedBy, 'admin_2');

  const gcsValid = validateBadgeDefinitionInput(
    makeValidBadgeInput({
      badgeId: 'gcs_badge',
      artworkType: 'upload',
      emblemId: '',
      artworkUrl: 'https://storage.googleapis.com/racepulseph-assets/badge-assets/admin_1/gcs_badge/medal.png',
      artworkStoragePath: 'badge-assets/admin_1/gcs_badge/medal.png',
    }),
    'admin_1',
    nowIso,
  );
  assert.equal(gcsValid.badgeId, 'gcs_badge');

  const fbAppValid = validateBadgeDefinitionInput(
    makeValidBadgeInput({
      badgeId: 'fbapp_badge',
      artworkType: 'upload',
      emblemId: '',
      artworkUrl: 'https://racepulseph.firebasestorage.app/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Ffbapp_badge%2Fcrest.avif?alt=media',
      artworkStoragePath: 'badge-assets/admin_1/fbapp_badge/crest.avif',
    }),
    'admin_1',
    nowIso,
  );
  assert.equal(fbAppValid.badgeId, 'fbapp_badge');

  const upperPngValid = validateBadgeDefinitionInput(
    makeValidBadgeInput({
      badgeId: 'upper_png',
      artworkType: 'upload',
      emblemId: '',
      artworkUrl: 'https://storage.googleapis.com/racepulseph-assets/badge-assets/admin_1/upper_png/CREST.PNG',
      artworkStoragePath: 'badge-assets/admin_1/upper_png/CREST.PNG',
    }),
    'admin_1',
    nowIso,
  );
  assert.equal(upperPngValid.artworkStoragePath, 'badge-assets/admin_1/upper_png/CREST.PNG');
});

test('validateBadgeDefinitionInput rejects invalid bounds, XSS/SVG/private URLs, and mismatched storage paths with status 400', () => {
  const nowIso = '2026-11-25T08:00:00.000Z';
  const expect400 = (patch, label) => {
    assert.throws(
      () => validateBadgeDefinitionInput(makeValidBadgeInput(patch), 'admin_1', nowIso),
      (err) => err instanceof Error && err.status === 400 && err.message.length > 0 && !err.message.includes('\u2014'),
      `Expected 400 for ${label}`,
    );
  };

  expect400({ badgeId: '' }, 'empty badgeId');
  expect400({ badgeId: '../evil' }, 'path traversal badgeId');
  expect400({ badgeId: 'a'.repeat(65) }, 'long badgeId');
  expect400({ name: '   ' }, 'blank name');
  expect400({ name: 'x'.repeat(81) }, 'long name');
  expect400({ description: '' }, 'blank description');
  expect400({ description: 'x'.repeat(241) }, 'long description');
  expect400({ customTierLabel: 'x'.repeat(25) }, 'long customTierLabel');
  expect400({ tier: 'mythic' }, 'unknown tier');
  expect400({ category: 'unknown' }, 'unknown category');
  expect400({ borderStyle: 'neon-unknown' }, 'unknown borderStyle');
  expect400({ animationEffect: 'spin-wildly' }, 'unknown animationEffect');
  expect400({ emblemId: 'not-an-emblem' }, 'unknown emblemId');
  expect400({ primaryColor: 'red' }, 'named color');
  expect400({ secondaryColor: '#12345' }, 'short invalid hex');
  expect400({ xpReward: 12.5 }, 'float xpReward');
  expect400({ xpReward: -1 }, 'negative xpReward');
  expect400({ xpReward: 50001 }, 'excessive xpReward');
  expect400({ sortOrder: -1 }, 'negative sortOrder');
  expect400({ sortOrder: 10001 }, 'excessive sortOrder');
  expect400({ sortOrder: 1.5 }, 'float sortOrder');
  expect400({ hiddenUntilEarned: 'false' }, 'string hiddenUntilEarned');
  expect400({ status: 'draft' }, 'invalid status');
  expect400(
    { activeFrom: '2026-12-10T00:00:00.000Z', activeUntil: '2026-12-01T00:00:00.000Z' },
    'activeFrom after activeUntil',
  );
  expect400({ activeFrom: '2026-02-29' }, 'invalid leap day activeFrom');
  expect400({ activeUntil: '2026-02-29' }, 'invalid leap day activeUntil');
  assert.throws(
    () => validateBadgeDefinitionInput(makeValidBadgeInput(), '__proto__', nowIso),
    (err) => err instanceof Error && err.status === 400,
    'Expected 400 for forbidden actorUid',
  );

  // Upload security checks
  expect400(
    {
      badgeId: 'svg_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsvg_test%2Ficon.svg?alt=media',
      artworkStoragePath: 'badge-assets/admin_1/svg_test/icon.svg',
    },
    'SVG upload rejected',
  );
  expect400(
    {
      badgeId: 'svg_url_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsvg_url_test%2Ficon%2Esvg?alt=media',
      artworkStoragePath: 'badge-assets/admin_1/svg_url_test/icon.png',
    },
    'encoded SVG URL rejected',
  );
  expect400(
    {
      badgeId: 'http_test',
      artworkType: 'upload',
      artworkUrl: 'http://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fhttp_test%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/http_test/icon.png',
    },
    'non-HTTPS URL rejected',
  );
  expect400(
    {
      badgeId: 'port_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com:8443/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fport_test%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/port_test/icon.png',
    },
    'explicit port URL rejected',
  );
  expect400(
    {
      badgeId: 'no_badge_assets_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/chat-media%2Fother.png?alt=media',
      artworkStoragePath: 'badge-assets/admin_1/no_badge_assets_test/icon.png',
    },
    'URL omitting badge-assets/ rejected',
  );
  expect400(
    {
      badgeId: 'bucketless_gcs_test',
      artworkType: 'upload',
      artworkUrl: 'https://storage.googleapis.com/badge-assets/admin_1/bucketless_gcs_test/icon.png',
      artworkStoragePath: 'badge-assets/admin_1/bucketless_gcs_test/icon.png',
    },
    'bucketless GCS URL rejected',
  );
  expect400(
    {
      badgeId: 'extra_seg_gcs_test',
      artworkType: 'upload',
      artworkUrl: 'https://storage.googleapis.com/racepulseph-assets/extra/badge-assets/admin_1/extra_seg_gcs_test/icon.png',
      artworkStoragePath: 'badge-assets/admin_1/extra_seg_gcs_test/icon.png',
    },
    'extra segment GCS URL rejected',
  );
  expect400(
    {
      badgeId: 'extra_seg_fb_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/prefix%2Fbadge-assets%2Fadmin_1%2Fextra_seg_fb_test%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/extra_seg_fb_test/icon.png',
    },
    'extra segment Firebase URL rejected',
  );
  expect400(
    {
      badgeId: 'double_slash_test',
      artworkType: 'upload',
      artworkUrl: 'https://storage.googleapis.com/racepulseph-assets//badge-assets/admin_1/double_slash_test/icon.png',
      artworkStoragePath: 'badge-assets/admin_1/double_slash_test/icon.png',
    },
    'double slash URL rejected',
  );
  expect400(
    {
      badgeId: 'uid_mismatch_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fother_uid%2Fuid_mismatch_test%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/uid_mismatch_test/icon.png',
    },
    'uid mismatch between artworkUrl and artworkStoragePath rejected',
  );
  expect400(
    {
      badgeId: 'file_mismatch_test',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Ffile_mismatch_test%2Fother.png',
      artworkStoragePath: 'badge-assets/admin_1/file_mismatch_test/icon.png',
    },
    'filename mismatch between artworkUrl and artworkStoragePath rejected',
  );
  expect400(
    {
      badgeId: 'xss_test',
      artworkType: 'upload',
      artworkUrl: 'javascript:alert(1)',
      artworkStoragePath: 'badge-assets/admin_1/xss_test/icon.png',
    },
    'javascript URL rejected',
  );
  expect400(
    {
      badgeId: 'data_svg',
      artworkType: 'upload',
      artworkUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      artworkStoragePath: 'badge-assets/admin_1/data_svg/icon.png',
    },
    'data SVG rejected',
  );
  expect400(
    {
      badgeId: 'ssrf_ip',
      artworkType: 'upload',
      artworkUrl: 'https://169.254.169.254/latest/meta-data.png',
      artworkStoragePath: 'badge-assets/admin_1/ssrf_ip/icon.png',
    },
    'private metadata IP rejected',
  );
  expect400(
    {
      badgeId: 'lookalike_host',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com.evil.com/badge-assets/admin_1/lookalike_host/icon.png',
      artworkStoragePath: 'badge-assets/admin_1/lookalike_host/icon.png',
    },
    'lookalike host rejected',
  );
  expect400(
    {
      badgeId: 'mismatch_path',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fother_badge%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/other_badge/icon.png',
    },
    'mismatched badgeId in artworkStoragePath rejected',
  );
  expect400(
    {
      badgeId: 'traversal_path',
      artworkType: 'upload',
      artworkUrl: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Ftraversal_path%2Ficon.png',
      artworkStoragePath: 'badge-assets/admin_1/traversal_path/..evil.png',
    },
    'dot-dot filename rejected',
  );

  // Rule validation bounds
  expect400({ rule: { type: 'unknown_rule', threshold: 1 } }, 'unknown rule type');
  expect400({ rule: { type: 'run_count', threshold: 0 } }, 'zero threshold');
  expect400({ rule: { type: 'run_count', threshold: 1.5 } }, 'float run_count');
  expect400({ rule: { type: 'run_single_distance_km', threshold: -5 } }, 'negative distance');
  expect400({ rule: { type: 'run_single_distance_km', threshold: 501 } }, 'excessive single distance');
  expect400({ rule: { type: 'run_time_window', startHourPht: 24, endHourPht: 6, threshold: 1 } }, 'hour 24');
  expect400({ rule: { type: 'run_time_window', startHourPht: -1, endHourPht: 6, threshold: 1 } }, 'hour -1');
  expect400({ rule: { type: 'run_time_window', startHourPht: 4.5, endHourPht: 6, threshold: 1 } }, 'float hour');
  expect400({ rule: { type: 'race_finished', threshold: 1, raceId: '../races' } }, 'invalid raceId');
  expect400({ rule: { type: 'regions_explored', threshold: 4, targetRegions: ['Luzon', 'Visayas', 'Mindanao'] } }, 'threshold exceeding targetRegions');
});

test('buildStarterBadgePack creates 8 valid PH starter badges with zero em dashes', () => {
  const pack = buildStarterBadgePack('superadmin_1', '2026-11-25T00:00:00.000Z');
  assert.equal(pack.length, 8);
  assert.deepEqual(
    pack.map((b) => b.badgeId),
    [
      'welcome_ka_racepulse',
      'first_gps_stride',
      'dawn_patrol_ph',
      'ten_k_club',
      'cordillera_climber',
      'archipelago_explorer',
      'official_finisher',
      'alamat_founder',
    ],
  );
  for (const badge of pack) {
    const serialized = JSON.stringify(badge);
    assert.equal(serialized.includes('\u2014'), false, `Em dash found in starter badge ${badge.badgeId}`);
    const revalidated = validateBadgeDefinitionInput(badge, 'superadmin_1', '2026-11-25T00:00:00.000Z');
    assert.equal(revalidated.badgeId, badge.badgeId);
  }
});

test('xpForLevel, computeLevelFromXp, and computeRunCompletionXp use exact integer math', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 100);
  assert.equal(xpForLevel(3), 300);
  assert.equal(xpForLevel(6), 1500);
  assert.equal(xpForLevel(10), 4500);
  assert.equal(xpForLevel(15), 10500);
  assert.equal(xpForLevel(25), 30000);

  assert.deepEqual(computeLevelFromXp(-10), {
    totalXp: 0,
    level: 1,
    currentLevelXp: 0,
    nextLevelXp: 100,
    rankTitle: 'Pacer',
  });
  assert.deepEqual(computeLevelFromXp(99), {
    totalXp: 99,
    level: 1,
    currentLevelXp: 0,
    nextLevelXp: 100,
    rankTitle: 'Pacer',
  });
  assert.deepEqual(computeLevelFromXp(100), {
    totalXp: 100,
    level: 2,
    currentLevelXp: 100,
    nextLevelXp: 300,
    rankTitle: 'Pacer',
  });
  assert.deepEqual(computeLevelFromXp(300), {
    totalXp: 300,
    level: 3,
    currentLevelXp: 300,
    nextLevelXp: 600,
    rankTitle: 'Road Runner',
  });
  assert.deepEqual(computeLevelFromXp(1500), {
    totalXp: 1500,
    level: 6,
    currentLevelXp: 1500,
    nextLevelXp: 2100,
    rankTitle: 'Trail Blazer',
  });
  assert.deepEqual(computeLevelFromXp(4500), {
    totalXp: 4500,
    level: 10,
    currentLevelXp: 4500,
    nextLevelXp: 5500,
    rankTitle: 'Marathoner',
  });
  assert.deepEqual(computeLevelFromXp(10500), {
    totalXp: 10500,
    level: 15,
    currentLevelXp: 10500,
    nextLevelXp: 12000,
    rankTitle: 'Ultra Strider',
  });
  assert.deepEqual(computeLevelFromXp(30000), {
    totalXp: 30000,
    level: 25,
    currentLevelXp: 30000,
    nextLevelXp: 32500,
    rankTitle: 'Alamat',
  });

  // Integer run XP tests
  assert.equal(computeRunCompletionXp({ distanceM: 5000, elevationGainM: 0, verificationStatus: 'flagged' }), 0);
  assert.equal(computeRunCompletionXp(null), 0);
  assert.equal(computeRunCompletionXp({ distanceM: 400, elevationGainM: 0, verificationStatus: 'verified' }), 15);
  assert.equal(computeRunCompletionXp({ distanceM: 5000, elevationGainM: 0, verificationStatus: 'verified' }), 50);
  assert.equal(computeRunCompletionXp({ distanceM: 10000, elevationGainM: 129, verificationStatus: 'verified' }), 112);
  assert.equal(computeRunCompletionXp({ distanceM: 120000, elevationGainM: 4500, verificationStatus: 'verified' }), 1500);
});

test('getPhtHour, getPhtWeekIndex, and isBadgeWithinActiveWindow obey PHT UTC+8 calendar math', () => {
  assert.equal(getPhtHour('2026-11-24T16:00:00.000Z'), 0);
  assert.equal(getPhtHour('2026-11-24T15:59:59.000Z'), 23);
  assert.equal(getPhtHour('2026-11-24T20:30:00.000Z'), 4);
  assert.equal(getPhtHour('2026-11-25T22:15:00+08:00'), 22);
  assert.equal(getPhtHour('not-a-date'), null);

  // Sunday 23:59:59 PHT (15:59:59Z) vs Monday 00:00:00 PHT (16:00:00Z)
  const sunLatePht = getPhtWeekIndex('2026-11-22T15:59:59.000Z');
  const monStartPht = getPhtWeekIndex('2026-11-22T16:00:00.000Z');
  const sunEndOfMonWeekPht = getPhtWeekIndex('2026-11-29T15:59:59.000Z');
  assert.equal(monStartPht, sunLatePht + 1);
  assert.equal(sunEndOfMonWeekPht, monStartPht);

  // Year boundary continuity (Dec 28 2026 Monday .. Jan 4 2027 Monday)
  const dec28Week = getPhtWeekIndex('2026-12-28T06:00:00+08:00');
  const jan4Week = getPhtWeekIndex('2027-01-04T06:00:00+08:00');
  assert.equal(jan4Week, dec28Week + 1);

  assert.equal(isBadgeWithinActiveWindow({ activeFrom: null, activeUntil: null }, '2026-11-25T00:00:00.000Z'), true);
  assert.equal(
    isBadgeWithinActiveWindow(
      { activeFrom: '2026-11-20T00:00:00.000Z', activeUntil: '2026-11-30T23:59:59.000Z' },
      '2026-11-25T00:00:00.000Z',
    ),
    true,
  );
  assert.equal(
    isBadgeWithinActiveWindow(
      { activeFrom: '2026-11-26T00:00:00.000Z', activeUntil: '2026-11-30T23:59:59.000Z' },
      '2026-11-25T23:59:59.000Z',
    ),
    false,
  );
  assert.equal(
    isBadgeWithinActiveWindow(
      { activeFrom: '2026-11-20T00:00:00.000Z', activeUntil: '2026-11-24T23:59:59.000Z' },
      '2026-11-25T00:00:00.000Z',
    ),
    false,
  );
  assert.equal(
    isBadgeWithinActiveWindow(
      { activeFrom: '2026-11-25', activeUntil: '2026-11-25' },
      '2026-11-25T14:00:00.000Z',
    ),
    true,
  );
});

test('computeRunStreakWeeksPht computes consecutive PHT weeks with 1 grace freeze per 4 consecutive weeks', () => {
  const weekRun = (mondayDateIso, status = 'verified') =>
    makeVerifiedRun({ startedAt: `${mondayDateIso}T06:00:00+08:00`, verificationStatus: status });

  // 3 consecutive weeks, now in week 4 (current week not yet run -> streak 3 still alive, 0 grace)
  const threeWeeks = [
    weekRun('2026-11-02'),
    weekRun('2026-11-09'),
    weekRun('2026-11-16'),
  ];
  assert.deepEqual(computeRunStreakWeeksPht(threeWeeks, '2026-11-18T10:00:00+08:00'), {
    runStreakWeeks: 3,
    runStreakGraceRemaining: 0,
  });
  assert.deepEqual(computeRunStreakWeeksPht(threeWeeks, '2026-11-24T10:00:00+08:00'), {
    runStreakWeeks: 3,
    runStreakGraceRemaining: 0,
  });
  // Missing week 4 entirely breaks the 3-week streak by week 5
  assert.deepEqual(computeRunStreakWeeksPht(threeWeeks, '2026-12-01T10:00:00+08:00'), {
    runStreakWeeks: 0,
    runStreakGraceRemaining: 0,
  });

  // 4 consecutive weeks earns 1 grace freeze; flagged week does NOT extend streak
  const fourWeeksPlusFlagged = [
    weekRun('2026-10-19'),
    weekRun('2026-10-26'),
    weekRun('2026-11-02'),
    weekRun('2026-11-09'),
    weekRun('2026-11-16', 'flagged'),
  ];
  assert.deepEqual(computeRunStreakWeeksPht(fourWeeksPlusFlagged, '2026-11-10T10:00:00+08:00'), {
    runStreakWeeks: 4,
    runStreakGraceRemaining: 1,
  });
  // Missed 2026-11-16 (flagged ignored), now on 2026-11-24 -> grace freeze bridges 2026-11-16
  assert.deepEqual(computeRunStreakWeeksPht(fourWeeksPlusFlagged, '2026-11-24T10:00:00+08:00'), {
    runStreakWeeks: 4,
    runStreakGraceRemaining: 0,
  });

  // Running again on 2026-11-23 preserves streak (5 active weeks, 0 grace remaining)
  const bridgedRun = [...fourWeeksPlusFlagged, weekRun('2026-11-23')];
  assert.deepEqual(computeRunStreakWeeksPht(bridgedRun, '2026-11-24T10:00:00+08:00'), {
    runStreakWeeks: 5,
    runStreakGraceRemaining: 0,
  });

  // Running 3 more consecutive weeks after the bridged run reaches 4 consecutive active weeks again -> earns new freeze
  const reEarned = [
    ...bridgedRun,
    weekRun('2026-11-30'),
    weekRun('2026-12-07'),
    weekRun('2026-12-14'),
  ];
  assert.deepEqual(computeRunStreakWeeksPht(reEarned, '2026-12-15T10:00:00+08:00'), {
    runStreakWeeks: 8,
    runStreakGraceRemaining: 1,
  });

  // Two consecutive missed weeks when only 1 freeze is held breaks the streak
  assert.deepEqual(computeRunStreakWeeksPht(fourWeeksPlusFlagged, '2026-12-01T10:00:00+08:00'), {
    runStreakWeeks: 0,
    runStreakGraceRemaining: 0,
  });
});

test('collectVerifiedFinishedRaceIds requires completedAt, matching runner/claim bib, and excludes DQ or review-flagged', () => {
  const races = [
    { id: 'race_done', completedAt: '2026-11-10T12:00:00Z' },
    { id: 'race_live', completedAt: '' },
    { id: 'race_dq', completedAt: '2026-11-12T12:00:00Z' },
    { id: 'race_review', completedAt: '2026-11-15T12:00:00Z' },
    { id: 'race_claimed', completedAt: '2026-11-18T12:00:00Z' },
    { id: 'race_free_slot', completedAt: '2026-11-19T12:00:00Z' },
  ];
  const liveResults = {
    race_done: {
      officialResults: [{ bibNumber: '101', disqualified: false, finishReviewRequired: false }],
    },
    race_live: {
      officialResults: [{ bibNumber: '102', disqualified: false, finishReviewRequired: false }],
    },
    race_dq: {
      officialResults: [{ bibNumber: '103', disqualified: true, finishReviewRequired: false }],
    },
    race_review: {
      officialResults: [{ bibNumber: '104', disqualified: false, finishReviewRequired: true }],
    },
    race_claimed: {
      officialResults: [{ bibNumber: 'CLM-09', disqualified: false, finishReviewRequired: false }],
    },
    race_free_slot: {
      officialResults: [
        { bibNumber: 'FS-1', isFreeSlot: true, disqualified: false, finishReviewRequired: false },
      ],
    },
  };
  const registrations = [
    { raceId: 'race_done', bibNumber: '101', uid: 'u1' },
    { raceId: 'race_live', bibNumber: '102', uid: 'u1' },
    { raceId: 'race_dq', bibNumber: '103', uid: 'u1' },
    { raceId: 'race_review', bibNumber: '104', uid: 'u1' },
    { raceId: 'race_claimed', bibNumber: 'clm-09', uid: 'u1', runner: { raceId: 'race_claimed', bibNumber: 'CLM-09' } },
    { raceId: 'race_free_slot', bibNumber: 'FS-1', uid: 'u1', isFreeSlot: true },
    { raceId: 'race_free_slot', bibNumber: 'FS-1', uid: 'u1' },
  ];

  const finished = collectVerifiedFinishedRaceIds(races, liveResults, registrations);
  assert.deepEqual([...finished].sort(), ['race_claimed', 'race_done']);
});

test('evaluateBadgeRule accurately evaluates all 17 declarative rule types and rejects flagged/manual/archived', () => {
  const nowIso = '2026-11-25T10:00:00+08:00';
  const badgeForRule = (rule, extra = {}) =>
    validateBadgeDefinitionInput(makeValidBadgeInput({ rule, ...extra }), 'admin_1', nowIso);

  // 1. welcome
  assert.equal(evaluateBadgeRule(badgeForRule({ type: 'welcome' }), {}, nowIso), true);
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'welcome' }, { status: 'archived' }), {}, nowIso),
    false,
  );

  // 2. profile_complete
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'profile_complete' }), { user: { displayName: 'Juan', username: 'juan' } }, nowIso),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'profile_complete' }),
      {
        user: {
          displayName: 'Juan',
          username: 'juan',
          location: 'BGC, Taguig',
          favoriteDistance: '21K',
        },
      },
      nowIso,
    ),
    true,
  );

  // 3. race_joined (blocks pending payment & free slots)
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_joined', threshold: 1, raceId: 'race_manila' }),
      { joinedRaceIds: ['race_cebu'] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_joined', threshold: 1, raceId: 'race_pending' }),
      { userRegistrations: [{ raceId: 'race_pending', bibNumber: '101', paymentStatus: 'pending' }] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_joined', threshold: 1, raceId: 'race_slot' }),
      { runnerClaims: [{ uid: 'u1', runner: { raceId: 'race_slot', bibNumber: 'S1', isFreeSlot: true } }] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_joined', threshold: 1, raceId: 'race_manila' }),
      { userRegistrations: [{ raceId: 'race_manila', bibNumber: '101', paymentStatus: 'paid' }] },
      nowIso,
    ),
    true,
  );

  // 4. race_finished
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_finished', threshold: 2 }),
      { verifiedFinishedRaceIds: ['race_1', 'race_2'] },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_finished', threshold: 1, raceId: 'race_2' }),
      { verifiedFinishedRaceIds: ['race_1'] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'race_finished', threshold: 1, raceId: 'race_ok' }),
      {
        races: [{ id: 'race_ok', completedAt: '2026-11-20T12:00:00Z' }],
        liveResultsByRaceId: {
          race_ok: { officialResults: [{ bibNumber: 'B-12', disqualified: false, finishReviewRequired: false }] },
        },
        runnerClaims: [{ uid: 'u1', runner: { raceId: 'race_ok', bibNumber: 'b-12' } }],
      },
      nowIso,
    ),
    true,
  );

  // 5-8. run_count, run_single_distance_km, run_total_distance_km, run_total_elevation_m (flagged excluded!)
  const mixedRuns = [
    makeVerifiedRun({ runId: 'r1', distanceM: 6000, elevationGainM: 250, verificationStatus: 'verified' }),
    makeVerifiedRun({ runId: 'r2', distanceM: 10500, elevationGainM: 400, verificationStatus: 'verified' }),
    makeVerifiedRun({ runId: 'r_flag', distanceM: 50000, elevationGainM: 3000, verificationStatus: 'flagged' }),
  ];
  assert.equal(evaluateBadgeRule(badgeForRule({ type: 'run_count', threshold: 2 }), { runs: mixedRuns }, nowIso), true);
  assert.equal(evaluateBadgeRule(badgeForRule({ type: 'run_count', threshold: 3 }), { runs: mixedRuns }, nowIso), false);
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_single_distance_km', threshold: 21.1 }), { runs: mixedRuns }, nowIso),
    false,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_single_distance_km', threshold: 10 }), { runs: mixedRuns }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_total_distance_km', threshold: 16 }), { runs: mixedRuns }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_total_distance_km', threshold: 20 }), { runs: mixedRuns }, nowIso),
    false,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_total_elevation_m', threshold: 650 }), { runs: mixedRuns }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'run_total_elevation_m', threshold: 700 }), { runs: mixedRuns }, nowIso),
    false,
  );

  // 9. run_time_window overnight PHT wrap-around (22..4)
  const nightOwlRule = badgeForRule({ type: 'run_time_window', startHourPht: 22, endHourPht: 4, threshold: 1 });
  assert.equal(
    evaluateBadgeRule(
      nightOwlRule,
      { verifiedRuns: [makeVerifiedRun({ startedAt: '2026-11-24T21:59:00+08:00' })] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      nightOwlRule,
      { verifiedRuns: [makeVerifiedRun({ startedAt: '2026-11-25T05:00:00+08:00' })] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      nightOwlRule,
      { verifiedRuns: [makeVerifiedRun({ startedAt: '2026-11-24T22:15:00+08:00' })] },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      nightOwlRule,
      { verifiedRuns: [makeVerifiedRun({ startedAt: '2026-11-25T04:45:00+08:00' })] },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'run_time_window', startHourPht: 0, endHourPht: 23, threshold: 1 }),
      {
        verifiedRuns: [
          makeVerifiedRun({ startedAt: '2026-11-25T00:05:00+08:00' }),
        ],
      },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'run_time_window', startHourPht: 22, endHourPht: 4, threshold: 2 }),
      {
        verifiedRuns: [
          makeVerifiedRun({ runId: 'nw1', startedAt: '2026-11-24T23:59:00+08:00' }),
          makeVerifiedRun({ runId: 'nw2', startedAt: '2026-11-25T00:01:00+08:00' }),
        ],
      },
      nowIso,
    ),
    true,
  );

  // 10. regions_explored
  const archipelagoRule = badgeForRule({
    type: 'regions_explored',
    threshold: 3,
    targetRegions: ['Luzon', 'Visayas', 'Mindanao'],
  });
  assert.equal(
    evaluateBadgeRule(
      archipelagoRule,
      {
        verifiedRuns: [
          makeVerifiedRun({ islandGroups: ['Luzon'], courseRef: { region: 'Manila' } }),
          makeVerifiedRun({ islandGroups: ['Luzon'], courseRef: { region: 'Baguio' } }),
        ],
      },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      archipelagoRule,
      {
        verifiedRuns: [
          makeVerifiedRun({ islandGroups: ['Luzon'] }),
          makeVerifiedRun({ islandGroups: ['Visayas', 'Mindanao'] }),
        ],
      },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'regions_explored', threshold: 2 }),
      { verifiedRuns: [makeVerifiedRun({ islandGroups: ['Luzon'], courseRef: { region: 'Cordillera' } })] },
      nowIso,
    ),
    true,
  );

  // 11-16. club_joined, friends_count, social_posts_count, kudos_received, run_streak_weeks, inbox_streak_days
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'club_joined', threshold: 1 }), { joinedClubIds: ['club_bgc'] }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'club_joined', threshold: 1 }),
      { user: { primaryClubId: 'forged_club' } },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'club_joined', threshold: 1 }),
      {
        clubMemberships: [
          { clubId: 'c_rem', status: 'removed' },
          { clubId: 'c_left', status: 'left' },
          { clubId: 'c_pend', status: 'pending' },
          { clubId: 'c_ban', status: 'banned' },
        ],
      },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'club_joined', threshold: 1 }),
      { clubMemberships: [{ clubId: 'c_ok', status: 'active' }] },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'club_joined', threshold: 2 }), { joinedClubIds: ['club_bgc'] }, nowIso),
    false,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'friends_count', threshold: 2 }),
      { friendIds: ['f1', '  ', '', 'f1', 'f2'] },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'friends_count', threshold: 3 }),
      { friendIds: ['f1', '  ', '', 'f1', 'f2'] },
      nowIso,
    ),
    false,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'friends_count', threshold: 5 }), { friendsCount: 5 }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'social_posts_count', threshold: 3 }), { socialPostsCount: 2 }, nowIso),
    false,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'kudos_received', threshold: 25 }), { kudosReceived: 30 }, nowIso),
    true,
  );
  assert.equal(
    evaluateBadgeRule(
      badgeForRule({ type: 'run_streak_weeks', threshold: 2 }),
      {
        verifiedRuns: [
          makeVerifiedRun({ startedAt: '2026-11-16T06:00:00+08:00' }),
          makeVerifiedRun({ startedAt: '2026-11-23T06:00:00+08:00' }),
        ],
      },
      nowIso,
    ),
    true,
  );
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'inbox_streak_days', threshold: 7 }), { inboxStreakDays: 7 }, nowIso),
    true,
  );

  // 17. manual_grant never auto-awards
  assert.equal(
    evaluateBadgeRule(badgeForRule({ type: 'manual_grant' }), { user: { displayName: 'Juan', username: 'juan' } }, nowIso),
    false,
  );
});
