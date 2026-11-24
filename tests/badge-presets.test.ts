import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as presets from '../src/lib/badges/presets.ts';
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
