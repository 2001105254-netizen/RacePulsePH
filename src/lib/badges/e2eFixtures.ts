import { CommunityRunApiError } from '../runs/communityRunsClient';
import {
  type EvaluateRetroactiveResult,
  type GrantBadgeResult,
  type SaveBadgeDefinitionInput,
  buildBadgeAssetStoragePath,
  normalizeAthleteProgression,
  validateBadgeAssetUploadFile,
} from './client';
import { computeLevelFromXp } from './presets';
import type { AthleteProgression, BadgeDefinition, BadgeStatus, UserBadgeAward } from './types';

export const E2E_BADGES_KEY = 'racepulse_e2e_badges';
export const E2E_USERS_KEY = 'racepulse_e2e_users';
export const E2E_RACES_KEY = 'racepulse_e2e_races';
export const E2E_GRANTS_KEY = 'racepulse_e2e_badge_grants';
export const E2E_USER_BADGES_KEY = 'racepulse_e2e_user_badges';
export const E2E_PROGRESSION_KEY = 'racepulse_e2e_progression';

export interface DevBadgeGrantRecord {
  uid: string;
  badgeId: string;
  xpAwarded?: number;
}

export function readDevSessionJson<T>(key: string): T[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function writeDevSessionJson<T>(key: string, items: readonly T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors in ephemeral DEV test runs.
  }
}

function sortBadgesForCatalog(items: readonly BadgeDefinition[]): BadgeDefinition[] {
  return [...items].sort((a, b) => {
    const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.badgeId.localeCompare(b.badgeId);
  });
}

export function buildDevStarterPack(
  actorUid = 'e2e-admin',
  nowIso = new Date().toISOString(),
): BadgeDefinition[] {
  const actor = actorUid.trim() || 'e2e-admin';
  const commonMeta = {
    customTierLabel: '',
    artworkUrl: '',
    artworkStoragePath: '',
    activeFrom: null,
    activeUntil: null,
    status: 'active' as const,
    createdAt: nowIso,
    createdBy: actor,
    updatedAt: nowIso,
    updatedBy: actor,
  };

  return [
    {
      ...commonMeta,
      badgeId: 'welcome_ka_racepulse',
      name: 'Welcome, Ka-RacePulse',
      description: 'Joined the RacePulsePH running community and started your Starter Trail.',
      tier: 'common',
      category: 'onboarding',
      artworkType: 'emblem',
      emblemId: 'shield-vanguard',
      borderStyle: 'solid-ring',
      primaryColor: '#DC2626',
      secondaryColor: '#F59E0B',
      animationEffect: 'shimmer-sweep',
      xpReward: 50,
      rule: { type: 'welcome' },
      hiddenUntilEarned: false,
      sortOrder: 10,
    },
    {
      ...commonMeta,
      badgeId: 'first_gps_stride',
      name: 'First GPS Stride',
      description: 'Completed your first server-verified GPS run in the Record tracker.',
      tier: 'common',
      category: 'onboarding',
      artworkType: 'emblem',
      emblemId: 'shoe-wings',
      borderStyle: 'double-crest',
      primaryColor: '#10B981',
      secondaryColor: '#34D399',
      animationEffect: 'gentle-float',
      xpReward: 100,
      rule: { type: 'run_count', threshold: 1 },
      hiddenUntilEarned: false,
      sortOrder: 20,
    },
    {
      ...commonMeta,
      badgeId: 'dawn_patrol_ph',
      name: 'Dawn Patrol PH',
      description: 'Started a verified run between 4:00 AM and 6:59 AM PHT before the morning heat.',
      tier: 'rare',
      category: 'special',
      artworkType: 'emblem',
      emblemId: 'sunrise-burst',
      borderStyle: 'sunburst-ph',
      primaryColor: '#F59E0B',
      secondaryColor: '#EA580C',
      animationEffect: 'pulse-glow',
      xpReward: 150,
      rule: { type: 'run_time_window', threshold: 1, startHourPht: 4, endHourPht: 6 },
      hiddenUntilEarned: false,
      sortOrder: 30,
    },
    {
      ...commonMeta,
      badgeId: 'ten_k_club',
      name: '10K Club',
      description: 'Logged a verified single run of at least 10 km on road or trail.',
      tier: 'rare',
      category: 'distance',
      artworkType: 'emblem',
      emblemId: 'lightning-bolt',
      borderStyle: 'hex-tactical',
      primaryColor: '#0EA5E9',
      secondaryColor: '#38BDF8',
      animationEffect: 'shimmer-sweep',
      xpReward: 250,
      rule: { type: 'run_single_distance_km', threshold: 10 },
      hiddenUntilEarned: false,
      sortOrder: 40,
    },
    {
      ...commonMeta,
      badgeId: 'cordillera_climber',
      name: 'Cordillera Climber',
      description: 'Accumulated 1,000 m of verified elevation gain across your recorded climbs.',
      tier: 'epic',
      category: 'elevation',
      artworkType: 'emblem',
      emblemId: 'mountain-peak',
      borderStyle: 'laurel-wreath',
      primaryColor: '#059669',
      secondaryColor: '#A3E635',
      animationEffect: 'prism-tilt',
      xpReward: 500,
      rule: { type: 'run_total_elevation_m', threshold: 1000 },
      hiddenUntilEarned: false,
      sortOrder: 50,
    },
    {
      ...commonMeta,
      badgeId: 'archipelago_explorer',
      name: 'Archipelago Explorer',
      description: 'Completed verified runs across Luzon, Visayas, and Mindanao.',
      tier: 'legendary',
      category: 'exploration',
      artworkType: 'emblem',
      emblemId: 'island-archipelago',
      borderStyle: 'diamond-cut',
      primaryColor: '#2563EB',
      secondaryColor: '#22D3EE',
      animationEffect: 'sparkle-orbit',
      xpReward: 1000,
      rule: {
        type: 'regions_explored',
        threshold: 3,
        targetRegions: ['Luzon', 'Visayas', 'Mindanao'],
      },
      hiddenUntilEarned: false,
      sortOrder: 60,
    },
    {
      ...commonMeta,
      badgeId: 'official_finisher',
      name: 'Official Finisher',
      description: 'Crossed the finish mat in a finalized RacePulsePH event with a clean timing record.',
      tier: 'special',
      category: 'races',
      artworkType: 'emblem',
      emblemId: 'trophy-crest',
      borderStyle: 'ribbon-medal',
      primaryColor: '#B91C1C',
      secondaryColor: '#FBBF24',
      animationEffect: 'pulse-glow',
      xpReward: 400,
      rule: { type: 'race_finished', threshold: 1 },
      hiddenUntilEarned: false,
      sortOrder: 70,
    },
    {
      ...commonMeta,
      badgeId: 'alamat_founder',
      name: 'Alamat Founder',
      description: 'Awarded by RacePulsePH stewards to founding athletes and community builders.',
      tier: 'alamat',
      category: 'special',
      artworkType: 'emblem',
      emblemId: 'diamond-alamat',
      borderStyle: 'alamat-gold',
      primaryColor: '#F59E0B',
      secondaryColor: '#EF4444',
      animationEffect: 'flame-aura',
      xpReward: 1500,
      rule: { type: 'manual_grant' },
      hiddenUntilEarned: true,
      sortOrder: 80,
    },
  ];
}

export function seedDevBadgesFixture(
  existingBadges: readonly BadgeDefinition[],
  actorUid: string,
): { seededCount: number; badges: BadgeDefinition[]; catalog: BadgeDefinition[] } {
  const existingIds = new Set(existingBadges.map((item) => item.badgeId));
  const defaults = buildDevStarterPack(actorUid);
  const added = defaults.filter((item) => !existingIds.has(item.badgeId));
  const catalog = sortBadgesForCatalog([...existingBadges, ...added]);
  return {
    seededCount: added.length,
    badges: added,
    catalog,
  };
}

export function uploadDevBadgeArtworkFixture(
  uid: string,
  badgeId: string,
  file: File,
): { artworkUrl: string; artworkStoragePath: string } {
  const validation = validateBadgeAssetUploadFile(file);
  if (!validation.ok) {
    throw new CommunityRunApiError(validation.error, 400);
  }
  const stampedName = `${Date.now().toString(36)}_${validation.safeFilename}`;
  const artworkStoragePath = buildBadgeAssetStoragePath(uid, badgeId, stampedName);
  const encodedPath = artworkStoragePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('%2F');
  const artworkUrl = `https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/${encodedPath}?alt=media`;
  return { artworkUrl, artworkStoragePath };
}

export function saveDevBadgeFixture(
  existingBadges: readonly BadgeDefinition[],
  input: SaveBadgeDefinitionInput,
  actorUid: string,
): { saved: BadgeDefinition; catalog: BadgeDefinition[] } {
  const nowIso = new Date().toISOString();
  const actor = actorUid.trim() || 'e2e-admin';
  const existing = existingBadges.find((item) => item.badgeId === input.badgeId);
  const saved: BadgeDefinition = {
    badgeId: input.badgeId,
    name: input.name,
    description: input.description,
    tier: input.tier,
    customTierLabel: input.customTierLabel ?? '',
    category: input.category,
    artworkType: input.artworkType,
    emblemId: input.emblemId,
    artworkUrl: input.artworkUrl ?? '',
    artworkStoragePath: input.artworkStoragePath ?? '',
    borderStyle: input.borderStyle,
    primaryColor: input.primaryColor,
    secondaryColor: input.secondaryColor,
    animationEffect: input.animationEffect,
    xpReward: input.xpReward,
    rule: input.rule,
    activeFrom: input.activeFrom ?? null,
    activeUntil: input.activeUntil ?? null,
    hiddenUntilEarned: input.hiddenUntilEarned,
    status: input.status,
    sortOrder: input.sortOrder,
    createdAt: existing?.createdAt || nowIso,
    createdBy: existing?.createdBy || actor,
    updatedAt: nowIso,
    updatedBy: actor,
  };
  const nextList = existing
    ? existingBadges.map((item) => (item.badgeId === saved.badgeId ? saved : item))
    : [...existingBadges, saved];
  return { saved, catalog: sortBadgesForCatalog(nextList) };
}

export function archiveDevBadgeFixture(
  existingBadges: readonly BadgeDefinition[],
  badgeId: string,
  status: BadgeStatus,
  actorUid: string,
): { updated: BadgeDefinition; catalog: BadgeDefinition[] } {
  const existing = existingBadges.find((item) => item.badgeId === badgeId);
  if (!existing) {
    throw new CommunityRunApiError('Badge definition not found.', 404);
  }
  const updated: BadgeDefinition = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid.trim() || 'e2e-admin',
  };
  const catalog = existingBadges.map((item) =>
    item.badgeId === badgeId ? updated : item,
  );
  return { updated, catalog };
}

export function deleteDevBadgeFixture(
  existingBadges: readonly BadgeDefinition[],
  badgeId: string,
): BadgeDefinition[] {
  return existingBadges.filter((item) => item.badgeId !== badgeId);
}

export function grantDevBadgeFixture(
  badge: BadgeDefinition,
  targetUid: string,
  existingGrants: readonly DevBadgeGrantRecord[],
  note?: string,
  actorUid = 'e2e-admin',
): GrantBadgeResult & { grants: DevBadgeGrantRecord[] } {
  if (badge.status === 'archived') {
    throw new CommunityRunApiError('Cannot manually grant an archived badge.', 400);
  }
  const duplicate = existingGrants.some(
    (entry) => entry.uid === targetUid && entry.badgeId === badge.badgeId,
  );
  if (duplicate) {
    throw new CommunityRunApiError('Runner already holds this badge.', 409);
  }

  const nowIso = new Date().toISOString();
  const nextGrants: DevBadgeGrantRecord[] = [
    ...existingGrants,
    { uid: targetUid, badgeId: badge.badgeId, xpAwarded: badge.xpReward },
  ];
  const uidGrants = nextGrants.filter((entry) => entry.uid === targetUid);
  const totalXp = uidGrants.reduce((sum, entry) => sum + (entry.xpAwarded ?? 0), 0);
  const level = computeLevelFromXp(totalXp);

  const userBadge: UserBadgeAward = {
    id: `${targetUid}_${badge.badgeId}`,
    uid: targetUid,
    badgeId: badge.badgeId,
    earnedAt: nowIso,
    seenByUser: false,
    source: 'manual',
    xpAwarded: badge.xpReward,
    grantedBy: actorUid,
    note: note?.trim() || '',
    badgeName: badge.name,
    tier: badge.tier,
    category: badge.category,
  };

  return {
    userBadge,
    xpAwarded: badge.xpReward,
    progression: {
      uid: targetUid,
      ...level,
      badgesCount: uidGrants.length,
      runStreakWeeks: 0,
      runStreakGraceRemaining: 0,
      updatedAt: nowIso,
    },
    grants: nextGrants,
  };
}

export function evaluateDevRetroactiveFixture(
  badges: readonly BadgeDefinition[],
  users: ReadonlyArray<{ uid: string; accessRemoved?: boolean }>,
): EvaluateRetroactiveResult {
  const activeUsers = users.filter((u) => !u.accessRemoved);
  const autoBadges = badges.filter(
    (b) => b.status === 'active' && b.rule.type !== 'manual_grant',
  );
  const processedUsers = activeUsers.length;
  const newlyAwardedCount = processedUsers > 0 && autoBadges.length > 0 ? Math.min(processedUsers, autoBadges.length) : 0;
  return {
    processedUsers,
    newlyAwardedCount,
    hasMore: false,
    nextAfterUid: null,
  };
}

export function readDevUserBadgesFixture(): UserBadgeAward[] {
  return readDevSessionJson<UserBadgeAward>(E2E_USER_BADGES_KEY) ?? [];
}

export function writeDevUserBadgesFixture(items: readonly UserBadgeAward[]): void {
  writeDevSessionJson(E2E_USER_BADGES_KEY, items);
}

export function acknowledgeDevSeenBadgesFixture(badgeIds: readonly string[]): UserBadgeAward[] {
  const idSet = new Set(badgeIds.map((id) => id.trim()).filter(Boolean));
  const current = readDevUserBadgesFixture();
  if (idSet.size === 0) return current;
  const updated = current.map((award) =>
    idSet.has(award.badgeId) && !award.seenByUser ? { ...award, seenByUser: true } : award,
  );
  writeDevUserBadgesFixture(updated);
  return updated;
}

export function readDevProgressionFixture(uid: string): AthleteProgression {
  if (typeof window === 'undefined') {
    return normalizeAthleteProgression(uid, null);
  }
  try {
    const raw = window.sessionStorage.getItem(E2E_PROGRESSION_KEY);
    if (!raw) return normalizeAthleteProgression(uid, null);
    const parsed = JSON.parse(raw) as Partial<AthleteProgression> | null;
    return normalizeAthleteProgression(uid, parsed);
  } catch {
    return normalizeAthleteProgression(uid, null);
  }
}
