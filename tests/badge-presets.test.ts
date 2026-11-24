import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as presets from '../src/lib/badges/presets.ts';
import * as badgeClient from '../src/lib/badges/client.ts';
import * as studioDraft from '../src/lib/badges/studioDraft.ts';
import * as e2eFixtures from '../src/lib/badges/e2eFixtures.ts';
import type { CompleteRecordedRunResponse } from '../src/lib/runs/communityRunsClient.ts';
import type {
  AthleteProgression,
  BadgeDefinition,
  BadgeRuleConfig,
  UserBadgeAward,
  XpEventRecord,
} from '../src/lib/badges/types.ts';

const require = createRequire(import.meta.url);
const engine = require('../functions/badge-engine.js');

function makeBadge(overrides: Partial<BadgeDefinition> = {}): BadgeDefinition {
  return {
    badgeId: 'badge_default',
    name: 'Default Badge',
    description: 'Default description.',
    tier: 'common',
    customTierLabel: '',
    category: 'onboarding',
    artworkType: 'emblem',
    emblemId: 'sunrise-burst',
    artworkUrl: '',
    artworkStoragePath: '',
    borderStyle: 'solid-ring',
    primaryColor: '#DC2626',
    secondaryColor: '#F59E0B',
    animationEffect: 'none',
    xpReward: 100,
    rule: { type: 'welcome' },
    activeFrom: null,
    activeUntil: null,
    hiddenUntilEarned: false,
    status: 'active',
    sortOrder: 10,
    createdAt: '2026-11-25T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-11-25T00:00:00.000Z',
    updatedBy: 'system',
    ...overrides,
  };
}

test('frontend badge presets match functions/badge-engine.js constants exactly', () => {
  assert.deepEqual([...presets.BADGE_TIERS], engine.BADGE_TIERS);
  assert.deepEqual([...presets.BADGE_CATEGORIES], engine.BADGE_CATEGORIES);
  assert.deepEqual([...presets.BADGE_BORDER_STYLES], engine.BADGE_BORDER_STYLES);
  assert.deepEqual([...presets.BADGE_ANIMATION_EFFECTS], engine.BADGE_ANIMATION_EFFECTS);
  assert.deepEqual([...presets.BADGE_EMBLEM_IDS], engine.BADGE_EMBLEM_IDS);
  assert.deepEqual([...presets.BADGE_RULE_TYPES], engine.BADGE_RULE_TYPES);
});

test('18 vector emblem presets contain pure SVG primitive descriptors and zero raw HTML strings', () => {
  assert.equal(presets.BADGE_EMBLEM_PRESETS.length, 18);
  assert.deepEqual(
    presets.BADGE_EMBLEM_PRESETS.map((e) => e.id),
    [...presets.BADGE_EMBLEM_IDS],
  );

  const validKinds = new Set(['path', 'circle', 'polygon', 'rect', 'line']);
  for (const emblem of presets.BADGE_EMBLEM_PRESETS) {
    assert.ok(emblem.label.trim().length > 0);
    assert.ok(emblem.summary.trim().length > 0);
    assert.equal(emblem.viewBox, '0 0 64 64');
    assert.ok(emblem.primitives.length >= 1, `${emblem.id} must have primitives`);
    for (const primitive of emblem.primitives) {
      assert.equal(validKinds.has(primitive.kind), true, `${emblem.id} invalid primitive kind`);
    }
    const serialized = JSON.stringify(emblem);
    assert.equal(serialized.includes('<'), false, `${emblem.id} must not contain raw HTML/SVG strings`);
    assert.equal(serialized.includes('\u2014'), false, `${emblem.id} must not contain em dashes`);
  }
});

test('xpForLevel, computeLevelFromXp, and computeRunCompletionXp match server badge engine integer math', () => {
  for (let lvl = 0; lvl <= 30; lvl += 1) {
    assert.equal(presets.xpForLevel(lvl), engine.xpForLevel(lvl));
  }
  for (const xp of [-5, 0, 50, 99, 100, 299, 300, 1499, 1500, 4500, 10500, 29999, 30000, 50000]) {
    assert.deepEqual(presets.computeLevelFromXp(xp), engine.computeLevelFromXp(xp));
  }
  const samples = [
    { distanceM: 300, elevationGainM: 0, verificationStatus: 'verified' as const },
    { distanceM: 5000, elevationGainM: 45, verificationStatus: 'verified' as const },
    { distanceM: 21100, elevationGainM: 420, verificationStatus: 'verified' as const },
    { distanceM: 100000, elevationGainM: 6000, verificationStatus: 'verified' as const },
    { distanceM: 10000, elevationGainM: 100, verificationStatus: 'flagged' as const },
  ];
  for (const run of samples) {
    assert.equal(presets.computeRunCompletionXp(run), engine.computeRunCompletionXp(run));
  }
});

test('sanitizeHexColor normalizes shorthand and lowercase colors to uppercase #RRGGBB', () => {
  assert.equal(presets.sanitizeHexColor('#abc'), '#AABBCC');
  assert.equal(presets.sanitizeHexColor('#ff3b30'), '#FF3B30');
  assert.equal(presets.sanitizeHexColor('  #0ea5e9 '), '#0EA5E9');
  assert.equal(presets.sanitizeHexColor('not-a-color', '#123abc'), '#123ABC');
  assert.equal(presets.sanitizeHexColor(undefined), '#FF3B30');
  assert.equal(presets.sanitizeHexColor('bad', undefined as unknown as string), '#FF3B30');
  assert.equal(presets.sanitizeHexColor('bad', null as unknown as string), '#FF3B30');
});

test('formatBadgeRuleSummary formats all 17 rules cleanly without em dashes', () => {
  const rules: BadgeRuleConfig[] = [
    { type: 'welcome' },
    { type: 'profile_complete' },
    { type: 'race_joined', threshold: 2 },
    { type: 'race_finished', threshold: 1, raceId: 'manila_2026' },
    { type: 'run_count', threshold: 5 },
    { type: 'run_single_distance_km', threshold: 21.1 },
    { type: 'run_total_distance_km', threshold: 100 },
    { type: 'run_total_elevation_m', threshold: 1000 },
    { type: 'run_time_window', threshold: 1, startHourPht: 22, endHourPht: 4 },
    { type: 'regions_explored', threshold: 3, targetRegions: ['Luzon', 'Visayas', 'Mindanao'] },
    { type: 'club_joined', threshold: 1 },
    { type: 'friends_count', threshold: 3 },
    { type: 'social_posts_count', threshold: 4 },
    { type: 'kudos_received', threshold: 20 },
    { type: 'run_streak_weeks', threshold: 4 },
    { type: 'inbox_streak_days', threshold: 7 },
    { type: 'manual_grant' },
  ];

  for (const rule of rules) {
    const summary = presets.formatBadgeRuleSummary(rule);
    assert.ok(summary.trim().length > 0, `Summary empty for ${rule.type}`);
    assert.equal(summary.includes('\u2014'), false, `Em dash found in summary for ${rule.type}`);
  }
  assert.equal(
    presets.formatBadgeRuleSummary({ type: 'run_time_window', threshold: 1, startHourPht: Number.NaN, endHourPht: 6 }),
    'Start 1 verified run between 00:00 and 06:59 PHT',
  );
});

test('selectNextToastBadge prioritizes unseen highest tier, then xpReward, then latest earnedAt', () => {
  const badgesById = new Map<string, BadgeDefinition>([
    ['b_common', makeBadge({ badgeId: 'b_common', tier: 'common', xpReward: 50, sortOrder: 10 })],
    ['b_rare_low', makeBadge({ badgeId: 'b_rare_low', tier: 'rare', xpReward: 150, sortOrder: 20 })],
    ['b_rare_high', makeBadge({ badgeId: 'b_rare_high', tier: 'rare', xpReward: 300, sortOrder: 30 })],
    ['b_alamat_seen', makeBadge({ badgeId: 'b_alamat_seen', tier: 'alamat', xpReward: 1500, sortOrder: 40 })],
    ['b_archived', makeBadge({ badgeId: 'b_archived', tier: 'legendary', xpReward: 1000, status: 'archived' })],
  ]);

  const awards: UserBadgeAward[] = [
    {
      id: 'u1_b_alamat_seen',
      uid: 'u1',
      badgeId: 'b_alamat_seen',
      xpAwarded: 1500,
      earnedAt: '2026-11-25T05:00:00.000Z',
      grantedBy: 'admin_1',
      source: 'manual',
      seenByUser: true,
    },
    {
      id: 'u1_b_archived',
      uid: 'u1',
      badgeId: 'b_archived',
      xpAwarded: 1000,
      earnedAt: '2026-11-25T05:00:00.000Z',
      source: 'auto',
      seenByUser: false,
    },
    {
      id: 'u1_b_common',
      uid: 'u1',
      badgeId: 'b_common',
      xpAwarded: 50,
      earnedAt: '2026-11-25T05:00:00.000Z',
      source: 'auto',
      seenByUser: false,
    },
    {
      id: 'u1_b_rare_low',
      uid: 'u1',
      badgeId: 'b_rare_low',
      xpAwarded: 150,
      earnedAt: '2026-11-25T06:00:00.000Z',
      source: 'run',
      runId: 'run_1',
      seenByUser: false,
    },
    {
      id: 'u1_b_rare_high',
      uid: 'u1',
      badgeId: 'b_rare_high',
      xpAwarded: 300,
      earnedAt: '2026-11-25T04:00:00.000Z',
      source: 'retroactive',
      seenByUser: false,
    },
  ];

  const picked = presets.selectNextToastBadge(awards, badgesById);
  assert.ok(picked);
  assert.equal(picked.badge.badgeId, 'b_rare_high');
  assert.equal(picked.award.id, 'u1_b_rare_high');

  const pickedFromRecord = presets.selectNextToastBadge(
    awards,
    Object.fromEntries(badgesById.entries()),
  );
  assert.equal(pickedFromRecord?.badge.badgeId, 'b_rare_high');

  const allSeen = awards.map((a) => ({ ...a, seenByUser: true }));
  assert.equal(presets.selectNextToastBadge(allSeen, badgesById), null);

  const sampleXp: XpEventRecord = {
    id: 'run_u1_run_1',
    uid: 'u1',
    source: 'run',
    refId: 'run_1',
    xp: 50,
    createdAt: '2026-11-25T06:00:00.000Z',
    label: 'Morning 5K',
  };
  const sampleProgression: AthleteProgression = {
    uid: 'u1',
    totalXp: 350,
    level: 3,
    currentLevelXp: 300,
    nextLevelXp: 600,
    rankTitle: 'Road Runner',
    badgesCount: 2,
    runStreakWeeks: 1,
    runStreakGraceRemaining: 0,
    updatedAt: '2026-11-25T06:00:00.000Z',
  };
  assert.equal(sampleXp.source, 'run');
  assert.equal(sampleProgression.badgesCount, 2);
});

test('validateBadgeAssetUploadFile accepts raster PNG/JPEG/WebP/AVIF under 2 MB and rejects SVG, 0 bytes, >= 2 MB, and unknown MIME', () => {
  const validPng = badgeClient.validateBadgeAssetUploadFile({
    name: 'sunrise-crest.png',
    type: 'image/png',
    size: 1024,
  });
  assert.equal(validPng.ok, true);
  if (validPng.ok) {
    assert.equal(validPng.safeFilename, 'sunrise-crest.png');
    assert.equal(validPng.contentType, 'image/png');
  }

  const validWebp = badgeClient.validateBadgeAssetUploadFile({
    name: '..My Crest (1).webp',
    type: 'image/webp',
    size: badgeClient.MAX_BADGE_ASSET_BYTES - 1,
  });
  assert.equal(validWebp.ok, true);
  if (validWebp.ok) {
    assert.match(validWebp.safeFilename, /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.webp$/);
    assert.equal(validWebp.safeFilename.includes('..'), false);
    assert.equal(validWebp.contentType, 'image/webp');
  }

  const validJpg = badgeClient.validateBadgeAssetUploadFile({
    name: 'medal.JPEG',
    type: 'image/jpeg',
    size: 4096,
  });
  assert.equal(validJpg.ok, true);

  const validAvif = badgeClient.validateBadgeAssetUploadFile({
    name: 'crest.avif',
    type: 'image/avif',
    size: 2048,
  });
  assert.equal(validAvif.ok, true);

  // Explicit SVG rejections
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'icon.svg', type: 'image/svg+xml', size: 512 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'icon.svg', type: 'image/png', size: 512 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'icon.png', type: 'image/svg+xml', size: 512 }).ok,
    false,
  );

  // Size boundaries: 0 bytes, negative, exact 2 MB, > 2 MB
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'empty.png', type: 'image/png', size: 0 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'neg.png', type: 'image/png', size: -10 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({
      name: 'exact2mb.png',
      type: 'image/png',
      size: badgeClient.MAX_BADGE_ASSET_BYTES,
    }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({
      name: 'over2mb.webp',
      type: 'image/webp',
      size: badgeClient.MAX_BADGE_ASSET_BYTES + 1024,
    }).ok,
    false,
  );

  // Unknown / disallowed MIME & mismatched extension
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'file.bin', type: 'application/octet-stream', size: 1024 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'anim.gif', type: 'image/gif', size: 1024 }).ok,
    false,
  );
  assert.equal(
    badgeClient.validateBadgeAssetUploadFile({ name: 'mismatch.jpg', type: 'image/png', size: 1024 }).ok,
    false,
  );
});

test('badge client path and artwork URL helpers enforce backend storage and HTTPS rules', () => {
  const storagePath = badgeClient.buildBadgeAssetStoragePath('admin_1', 'sunrise_badge', 'crest.webp');
  assert.equal(storagePath, 'badge-assets/admin_1/sunrise_badge/crest.webp');
  assert.equal(badgeClient.isValidBadgeAssetStoragePath(storagePath, 'sunrise_badge'), true);
  assert.equal(engine.ALLOWED_BADGE_ASSET_PATH_RE.test(storagePath), true);

  // Path edge cases
  assert.equal(badgeClient.isValidBadgeAssetStoragePath(storagePath, 'other_badge'), false);
  assert.equal(badgeClient.isValidBadgeAssetStoragePath('badge-assets/admin_1/sunrise_badge/.dot.png'), false);
  assert.equal(badgeClient.isValidBadgeAssetStoragePath('badge-assets/admin_1/sunrise_badge/icon.svg'), false);
  assert.equal(badgeClient.isValidBadgeAssetStoragePath('badge-assets/../admin_1/sunrise_badge/icon.png'), false);
  assert.throws(() => badgeClient.buildBadgeAssetStoragePath('../bad', 'sunrise_badge', 'crest.png'));
  assert.throws(() => badgeClient.buildBadgeAssetStoragePath('admin_1', 'bad/id', 'crest.png'));

  // Safe URL validation
  const fbUrl =
    'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsunrise_badge%2Fcrest.webp?alt=media&token=abc';
  const gcsUrl = 'https://storage.googleapis.com/racepulseph-assets/badge-assets/admin_1/sunrise_badge/crest.webp';
  const fbAppUrl =
    'https://racepulseph.firebasestorage.app/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsunrise_badge%2Fcrest.webp?alt=media';

  assert.equal(badgeClient.isSafeBadgeArtworkUrl(fbUrl, storagePath), true);
  assert.equal(badgeClient.isSafeBadgeArtworkUrl(gcsUrl, storagePath), true);
  assert.equal(badgeClient.isSafeBadgeArtworkUrl(fbAppUrl, storagePath), true);

  assert.equal(
    badgeClient.isSafeBadgeArtworkUrl(
      'http://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsunrise_badge%2Fcrest.webp',
      storagePath,
    ),
    false,
  );
  assert.equal(
    badgeClient.isSafeBadgeArtworkUrl('https://evil.example.com/badge-assets/admin_1/sunrise_badge/crest.webp'),
    false,
  );
  assert.equal(
    badgeClient.isSafeBadgeArtworkUrl(
      'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/badge-assets%2Fadmin_1%2Fsunrise_badge%2Ficon.svg',
    ),
    false,
  );
  assert.equal(
    badgeClient.isSafeBadgeArtworkUrl(fbUrl, 'badge-assets/admin_1/other_badge/crest.webp'),
    false,
  );
});

test('athlete progression normalization, empty ack-seen fast path, and CompleteRecordedRunResponse typing', async () => {
  const def = badgeClient.createDefaultAthleteProgression('u_runner');
  assert.equal(def.uid, 'u_runner');
  assert.equal(def.totalXp, 0);
  assert.equal(def.level, 1);
  assert.equal(def.badgesCount, 0);
  assert.equal(def.runStreakWeeks, 0);
  assert.equal(def.runStreakGraceRemaining, 0);

  const normalized = badgeClient.normalizeAthleteProgression('u_runner', {
    totalXp: 350,
    badgesCount: 3,
    runStreakWeeks: 4,
    runStreakGraceRemaining: 1,
  });
  assert.equal(normalized.level, 3);
  assert.equal(normalized.rankTitle, 'Road Runner');
  assert.equal(normalized.badgesCount, 3);
  assert.equal(normalized.runStreakWeeks, 4);
  assert.equal(normalized.runStreakGraceRemaining, 1);

  const emptyAck = await badgeClient.acknowledgeSeenBadges([]);
  assert.deepEqual(emptyAck, { acknowledgedIds: [] });

  const sampleCompleteResponse: CompleteRecordedRunResponse = {
    run: {
      runId: 'run_1',
      uid: 'u_runner',
      mode: 'free',
      privacy: 'public',
      title: 'Morning 5K',
      startedAt: '2026-11-25T00:00:00.000Z',
      finishedAt: '2026-11-25T00:30:00.000Z',
      elapsedTimeMs: 1_800_000,
      movingTimeMs: 1_800_000,
      distanceM: 5000,
      elevationGainM: 20,
      elevationLossM: 20,
      caloriesKcal: 340,
      calorieEstimate: {
        totalKcal: 340,
        netKcal: 300,
        restingKcal: 40,
        weightKgUsed: 65,
        usedReferenceWeight: false,
        methodVersion: 'minetti2002-herrmann2024-v1',
      },
      avgPaceSecPerKm: 360,
      avgSpeedMps: 2.78,
      maxSpeedMps: 3.4,
      splits: [],
      previewPolyline: [],
      islandGroups: ['Luzon'],
      homePrivacyTrimEnabled: false,
      trimmedHeadM: 0,
      trimmedTailM: 0,
      pointCount: 10,
      verificationStatus: 'verified',
      verificationFlags: [],
      createdAt: '2026-11-25T00:30:01.000Z',
    },
    xpEarned: 152,
    newlyAwardedBadges: [],
    progression: normalized,
  };
  assert.equal(sampleCompleteResponse.xpEarned, 152);
});

test('studioDraft slugifies badge IDs, builds all 17 rules, and enforces client validation bounds', () => {
  assert.equal(studioDraft.slugifyBadgeId('Dawn Patrol PH!'), 'dawn_patrol_ph');
  assert.equal(studioDraft.slugifyBadgeId('  10K   Club -- 2026  '), '10k_club_2026');

  const blank = studioDraft.createBlankBadgeDraft(20);
  assert.equal(blank.sortOrder, '20');
  assert.equal(blank.ruleType, 'run_count');

  // Validates all 17 rule types cleanly
  for (const ruleType of presets.BADGE_RULE_TYPES) {
    const draft = {
      ...blank,
      badgeId: `rule_${ruleType}`,
      name: `Test ${ruleType}`,
      description: 'Valid description for testing.',
      ruleType,
      threshold: ruleType === 'run_single_distance_km' ? '21.1' : '2',
      startHourPht: '22',
      endHourPht: '4',
      targetRegions: ruleType === 'regions_explored' ? ['Luzon', 'Visayas'] : [],
      raceId: ruleType === 'race_joined' ? 'race_manila_2026' : '',
    };
    const result = studioDraft.validateAndBuildSavePayload(draft);
    assert.equal(result.ok, true, `Expected rule ${ruleType} to validate cleanly`);
    if (result.ok) {
      assert.equal(result.payload.rule.type, ruleType);
    }
  }

  // Rejects invalid fields
  const badId = studioDraft.validateAndBuildSavePayload({
    ...blank,
    badgeId: '../bad',
    name: 'Valid Name',
    description: 'Valid desc',
  });
  assert.equal(badId.ok, false);

  const badSchedule = studioDraft.validateAndBuildSavePayload({
    ...blank,
    badgeId: 'sched_test',
    name: 'Sched',
    description: 'Sched desc',
    activeFrom: '2026-12-01',
    activeUntil: '2026-11-01',
  });
  assert.equal(badSchedule.ok, false);

  const missingUpload = studioDraft.validateAndBuildSavePayload({
    ...blank,
    badgeId: 'upload_missing',
    name: 'Upload Test',
    description: 'Needs upload url',
    artworkType: 'upload',
    artworkUrl: '',
    artworkStoragePath: '',
  });
  assert.equal(missingUpload.ok, false);

  const overTierLabel = studioDraft.validateAndBuildSavePayload({
    ...blank,
    badgeId: 'tier_test',
    name: 'Tier Test',
    description: 'Too long tier label',
    customTierLabel: 'x'.repeat(25),
  });
  assert.equal(overTierLabel.ok, false);

  const dedupRegions = studioDraft.buildBadgeRuleFromDraft({
    ...blank,
    ruleType: 'regions_explored',
    targetRegions: ['Luzon', 'luzon', '  Visayas ', 'visayas', 'LUZON'],
    threshold: '2',
  });
  assert.equal(dedupRegions.ok, true);
  if (dedupRegions.ok) {
    assert.deepEqual(dedupRegions.rule.targetRegions, ['Luzon', 'Visayas']);
  }
});

test('e2eFixtures performs deterministic offline catalog, artwork, grant, and sync mutations', () => {
  const seeded = e2eFixtures.seedDevBadgesFixture([], 'e2e-admin');
  assert.equal(seeded.seededCount, 8);
  assert.equal(seeded.catalog.length, 8);

  const reseeded = e2eFixtures.seedDevBadgesFixture(seeded.catalog, 'e2e-admin');
  assert.equal(reseeded.seededCount, 0);
  assert.equal(reseeded.catalog.length, 8);

  const pngFile = new File([new Uint8Array([137, 80, 78, 71])], 'crest.png', {
    type: 'image/png',
  });
  const uploadResult = e2eFixtures.uploadDevBadgeArtworkFixture(
    'e2e-admin',
    'custom_e2e',
    pngFile,
  );
  assert.equal(
    badgeClient.isValidBadgeAssetStoragePath(uploadResult.artworkStoragePath, 'custom_e2e'),
    true,
  );
  assert.equal(
    badgeClient.isSafeBadgeArtworkUrl(uploadResult.artworkUrl, uploadResult.artworkStoragePath),
    true,
  );

  const blank = studioDraft.createBlankBadgeDraft(15);
  const built = studioDraft.validateAndBuildSavePayload({
    ...blank,
    badgeId: 'custom_e2e',
    name: 'Custom E2E',
    description: 'Offline E2E badge.',
    artworkType: 'upload',
    artworkUrl: uploadResult.artworkUrl,
    artworkStoragePath: uploadResult.artworkStoragePath,
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    const saved = e2eFixtures.saveDevBadgeFixture(seeded.catalog, built.payload, 'e2e-admin');
    assert.equal(saved.catalog.length, 9);
    const archived = e2eFixtures.archiveDevBadgeFixture(
      saved.catalog,
      'custom_e2e',
      'archived',
      'e2e-admin',
    );
    assert.equal(archived.updated.status, 'archived');
    const deleted = e2eFixtures.deleteDevBadgeFixture(archived.catalog, 'custom_e2e');
    assert.equal(deleted.length, 8);
  }

  const grantRes = e2eFixtures.grantDevBadgeFixture(seeded.catalog[0], 'runner_1', []);
  assert.equal(grantRes.userBadge.source, 'manual');
  assert.equal(grantRes.userBadge.uid, 'runner_1');
  assert.equal(grantRes.xpAwarded, seeded.catalog[0].xpReward);
  assert.equal(grantRes.progression.totalXp, seeded.catalog[0].xpReward);
  assert.throws(() =>
    e2eFixtures.grantDevBadgeFixture(seeded.catalog[0], 'runner_1', [
      { uid: 'runner_1', badgeId: seeded.catalog[0].badgeId },
    ]),
  );

  const syncRes = e2eFixtures.evaluateDevRetroactiveFixture(seeded.catalog, [
    { uid: 'runner_1' },
    { uid: 'runner_removed', accessRemoved: true },
  ]);
  assert.equal(syncRes.processedUsers, 1);
  assert.equal(syncRes.hasMore, false);
  assert.equal(syncRes.nextAfterUid, null);
});

test('XP bar integer percentage, toast announcement formatting, and DEV runner badge fixtures', () => {
  const lv1Start = presets.computeLevelFromXp(0);
  assert.deepEqual(presets.computeLevelXpWindow(lv1Start), {
    xpIntoLevel: 0,
    xpForNextLevel: 100,
    percent: 0,
  });
  assert.equal(presets.computeXpProgressPercent(lv1Start), 0);

  const lv1Half = presets.computeLevelFromXp(50);
  assert.deepEqual(presets.computeLevelXpWindow(lv1Half), {
    xpIntoLevel: 50,
    xpForNextLevel: 100,
    percent: 50,
  });

  const lv2Start = presets.computeLevelFromXp(100);
  assert.deepEqual(presets.computeLevelXpWindow(lv2Start), {
    xpIntoLevel: 0,
    xpForNextLevel: 200,
    percent: 0,
  });

  const lv2Half = presets.computeLevelFromXp(200);
  assert.deepEqual(presets.computeLevelXpWindow(lv2Half), {
    xpIntoLevel: 100,
    xpForNextLevel: 200,
    percent: 50,
  });

  const lv3 = presets.computeLevelFromXp(350);
  assert.deepEqual(presets.computeLevelXpWindow(lv3), {
    xpIntoLevel: 50,
    xpForNextLevel: 300,
    percent: 16,
  });

  assert.equal(presets.computeXpProgressPercent({ totalXp: -10, currentLevelXp: 0, nextLevelXp: 100 }), 0);
  assert.equal(presets.computeXpProgressPercent({ totalXp: 500, currentLevelXp: 100, nextLevelXp: 300 }), 100);
  assert.equal(presets.computeXpProgressPercent({ totalXp: 120, currentLevelXp: 100, nextLevelXp: 100 }), 0);
  assert.equal(presets.computeXpProgressPercent({ totalXp: 25, currentLevelXp: 50, nextLevelXp: 25 }), 0);

  const msgWithAction = presets.formatAchievementToastAnnouncement('Dawn Patrol PH', 150, true);
  assert.equal(msgWithAction, 'Dawn Patrol PH unlocked. +150 XP. Actions available.');
  assert.doesNotMatch(msgWithAction, /\u2014/);

  const msgNoAction = presets.formatAchievementToastAnnouncement('Welcome, Ka-RacePulse', 50, false);
  assert.equal(msgNoAction, 'Welcome, Ka-RacePulse unlocked. +50 XP.');

  // Exercise DEV runner badge/progression sessionStorage helpers cleanly
  const mem = new Map<string, string>();
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
  };
  try {
    const starter = e2eFixtures.buildDevStarterPack('e2e-admin');
    const award1 = e2eFixtures.grantDevBadgeFixture(starter[0], 'e2e-runner-m3', []).userBadge;
    const award2 = e2eFixtures.grantDevBadgeFixture(starter[1], 'e2e-runner-m3', [
      { uid: 'e2e-runner-m3', badgeId: starter[0].badgeId, xpAwarded: starter[0].xpReward },
    ]).userBadge;
    e2eFixtures.writeDevUserBadgesFixture([award1, award2]);
    const readAwards = e2eFixtures.readDevUserBadgesFixture();
    assert.equal(readAwards.length, 2);
    assert.equal(readAwards[0].seenByUser, false);

    const updated = e2eFixtures.acknowledgeDevSeenBadgesFixture([starter[0].badgeId]);
    assert.equal(updated.find((a) => a.badgeId === starter[0].badgeId)?.seenByUser, true);
    assert.equal(updated.find((a) => a.badgeId === starter[1].badgeId)?.seenByUser, false);

    const fallbackProg = e2eFixtures.readDevProgressionFixture('e2e-runner-m3');
    assert.equal(fallbackProg.uid, 'e2e-runner-m3');
    assert.equal(fallbackProg.totalXp, 0);

    mem.set(
      e2eFixtures.E2E_PROGRESSION_KEY,
      JSON.stringify({ uid: 'e2e-runner-m3', totalXp: 320, badgesCount: 2, runStreakWeeks: 4, runStreakGraceRemaining: 1 }),
    );
    const hydratedProg = e2eFixtures.readDevProgressionFixture('e2e-runner-m3');
    assert.equal(hydratedProg.totalXp, 320);
    assert.equal(hydratedProg.level, 3);
    assert.equal(hydratedProg.rankTitle, 'Road Runner');
    assert.equal(hydratedProg.badgesCount, 2);
    assert.equal(hydratedProg.runStreakWeeks, 4);
    assert.equal(hydratedProg.runStreakGraceRemaining, 1);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }
});
