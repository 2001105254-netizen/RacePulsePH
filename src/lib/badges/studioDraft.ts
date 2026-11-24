import {
  isSafeBadgeArtworkUrl,
  isValidBadgeAssetStoragePath,
  type SaveBadgeDefinitionInput,
} from './client';
import {
  BADGE_BORDER_STYLES,
  BADGE_EMBLEM_IDS,
  BADGE_TIER_META,
  sanitizeHexColor,
} from './presets';
import type {
  BadgeAnimationEffect,
  BadgeArtworkType,
  BadgeBorderStyle,
  BadgeCategory,
  BadgeDefinition,
  BadgeEmblemId,
  BadgeRuleConfig,
  BadgeRuleType,
  BadgeStatus,
  BadgeTier,
} from './types';

export const PHILIPPINE_BADGE_REGIONS = ['Luzon', 'Visayas', 'Mindanao'] as const;

export const BADGE_STUDIO_COLOR_SWATCHES = [
  '#64748B',
  '#0EA5E9',
  '#DC2626',
  '#10B981',
  '#2563EB',
  '#F59E0B',
  '#FBBF24',
  '#22D3EE',
] as const;

const BADGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BadgeFormDraft {
  badgeId: string;
  name: string;
  description: string;
  tier: BadgeTier;
  customTierLabel: string;
  category: BadgeCategory;
  artworkType: BadgeArtworkType;
  emblemId: BadgeEmblemId;
  artworkUrl: string;
  artworkStoragePath: string;
  borderStyle: BadgeBorderStyle;
  primaryColor: string;
  secondaryColor: string;
  animationEffect: BadgeAnimationEffect;
  xpReward: string;
  sortOrder: string;
  ruleType: BadgeRuleType;
  threshold: string;
  raceId: string;
  startHourPht: string;
  endHourPht: string;
  targetRegions: string[];
  activeFrom: string;
  activeUntil: string;
  hiddenUntilEarned: boolean;
  status: BadgeStatus;
}

export function slugifyBadgeId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function createBlankBadgeDraft(nextSortOrder = 10): BadgeFormDraft {
  const tierMeta = BADGE_TIER_META.common;
  return {
    badgeId: '',
    name: '',
    description: '',
    tier: 'common',
    customTierLabel: '',
    category: 'onboarding',
    artworkType: 'emblem',
    emblemId: 'sunrise-burst',
    artworkUrl: '',
    artworkStoragePath: '',
    borderStyle: 'solid-ring',
    primaryColor: tierMeta.defaultPrimary,
    secondaryColor: tierMeta.defaultSecondary,
    animationEffect: 'none',
    xpReward: '100',
    sortOrder: String(Math.max(0, Math.min(10000, Math.floor(nextSortOrder)))),
    ruleType: 'run_count',
    threshold: '1',
    raceId: '',
    startHourPht: '4',
    endHourPht: '6',
    targetRegions: [],
    activeFrom: '',
    activeUntil: '',
    hiddenUntilEarned: false,
    status: 'active',
  };
}

function toDateInputValue(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  return '';
}

export function badgeDefinitionToDraft(badge: BadgeDefinition): BadgeFormDraft {
  const tierMeta = BADGE_TIER_META[badge.tier] ?? BADGE_TIER_META.common;
  const emblemId = BADGE_EMBLEM_IDS.includes(badge.emblemId as BadgeEmblemId)
    ? (badge.emblemId as BadgeEmblemId)
    : 'sunrise-burst';
  const borderStyle = BADGE_BORDER_STYLES.includes(badge.borderStyle)
    ? badge.borderStyle
    : 'solid-ring';

  return {
    badgeId: badge.badgeId,
    name: badge.name,
    description: badge.description,
    tier: badge.tier,
    customTierLabel: badge.customTierLabel ?? '',
    category: badge.category,
    artworkType: badge.artworkType,
    emblemId,
    artworkUrl: badge.artworkUrl ?? '',
    artworkStoragePath: badge.artworkStoragePath ?? '',
    borderStyle,
    primaryColor: sanitizeHexColor(badge.primaryColor, tierMeta.defaultPrimary),
    secondaryColor: sanitizeHexColor(badge.secondaryColor, tierMeta.defaultSecondary),
    animationEffect: badge.animationEffect,
    xpReward: String(badge.xpReward ?? 0),
    sortOrder: String(badge.sortOrder ?? 10),
    ruleType: badge.rule?.type ?? 'manual_grant',
    threshold:
      badge.rule?.threshold !== undefined && badge.rule?.threshold !== null
        ? String(badge.rule.threshold)
        : '1',
    raceId: badge.rule?.raceId ?? '',
    startHourPht:
      badge.rule?.startHourPht !== undefined && badge.rule?.startHourPht !== null
        ? String(badge.rule.startHourPht)
        : '4',
    endHourPht:
      badge.rule?.endHourPht !== undefined && badge.rule?.endHourPht !== null
        ? String(badge.rule.endHourPht)
        : '6',
    targetRegions: Array.isArray(badge.rule?.targetRegions)
      ? [...badge.rule.targetRegions]
      : [],
    activeFrom: toDateInputValue(badge.activeFrom),
    activeUntil: toDateInputValue(badge.activeUntil),
    hiddenUntilEarned: Boolean(badge.hiddenUntilEarned),
    status: badge.status === 'archived' ? 'archived' : 'active',
  };
}

function parseStrictInteger(raw: string, min: number, max: number, label: string): number | string {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return `${label} must be a whole number between ${min} and ${max}.`;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return value;
}

function parseStrictNumber(raw: string, min: number, max: number, label: string): number | string {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value) || value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return value;
}

export function buildBadgeRuleFromDraft(
  draft: BadgeFormDraft,
): { ok: true; rule: BadgeRuleConfig } | { ok: false; error: string } {
  const type = draft.ruleType;
  if (type === 'welcome' || type === 'profile_complete' || type === 'manual_grant') {
    return { ok: true, rule: { type } };
  }

  if (type === 'race_joined' || type === 'race_finished') {
    const raceId = draft.raceId.trim();
    if (raceId && (!BADGE_ID_RE.test(raceId) || FORBIDDEN_IDS.has(raceId))) {
      return { ok: false, error: 'Selected event ID is invalid.' };
    }
    const threshold = raceId
      ? 1
      : parseStrictInteger(draft.threshold || '1', 1, 1000, 'Race threshold');
    if (typeof threshold === 'string') return { ok: false, error: threshold };
    return {
      ok: true,
      rule: { type, threshold, ...(raceId ? { raceId } : {}) },
    };
  }

  if (type === 'run_count') {
    const threshold = parseStrictInteger(draft.threshold, 1, 10000, 'Verified runs threshold');
    return typeof threshold === 'string'
      ? { ok: false, error: threshold }
      : { ok: true, rule: { type, threshold } };
  }

  if (type === 'run_single_distance_km') {
    const threshold = parseStrictNumber(draft.threshold, 0.1, 500, 'Target distance (km)');
    return typeof threshold === 'string'
      ? { ok: false, error: threshold }
      : { ok: true, rule: { type, threshold } };
  }

  if (type === 'run_total_distance_km') {
    const threshold = parseStrictNumber(draft.threshold, 0.1, 100000, 'Total distance (km)');
    return typeof threshold === 'string'
      ? { ok: false, error: threshold }
      : { ok: true, rule: { type, threshold } };
  }

  if (type === 'run_total_elevation_m') {
    const threshold = parseStrictInteger(draft.threshold, 1, 1000000, 'Total elevation (m)');
    return typeof threshold === 'string'
      ? { ok: false, error: threshold }
      : { ok: true, rule: { type, threshold } };
  }

  if (type === 'run_time_window') {
    const threshold = parseStrictInteger(draft.threshold || '1', 1, 1000, 'Qualifying runs');
    if (typeof threshold === 'string') return { ok: false, error: threshold };
    const startHourPht = parseStrictInteger(draft.startHourPht, 0, 23, 'Start hour (PHT)');
    if (typeof startHourPht === 'string') return { ok: false, error: startHourPht };
    const endHourPht = parseStrictInteger(draft.endHourPht, 0, 23, 'End hour (PHT)');
    if (typeof endHourPht === 'string') return { ok: false, error: endHourPht };
    return {
      ok: true,
      rule: { type, threshold, startHourPht, endHourPht },
    };
  }

  if (type === 'regions_explored') {
    const targetRegions: string[] = [];
    const seenRegions = new Set<string>();
    for (const rawItem of draft.targetRegions) {
      const trimmed = rawItem.trim().slice(0, 64);
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenRegions.has(key)) continue;
      seenRegions.add(key);
      targetRegions.push(trimmed);
      if (targetRegions.length >= 20) break;
    }
    const maxThreshold = targetRegions.length > 0 ? targetRegions.length : 100;
    const rawThreshold =
      draft.threshold.trim() || String(targetRegions.length > 0 ? targetRegions.length : 1);
    const threshold = parseStrictInteger(rawThreshold, 1, maxThreshold, 'Regions required');
    if (typeof threshold === 'string') return { ok: false, error: threshold };
    return {
      ok: true,
      rule: {
        type,
        threshold,
        ...(targetRegions.length > 0 ? { targetRegions } : {}),
      },
    };
  }

  const intBounds: Readonly<Record<string, [number, number, string]>> = {
    club_joined: [1, 100, 'Clubs joined'],
    friends_count: [1, 5000, 'Friends count'],
    social_posts_count: [1, 10000, 'Posts shared'],
    kudos_received: [1, 1000000, 'Kudos total'],
    run_streak_weeks: [1, 520, 'Streak weeks'],
    inbox_streak_days: [1, 3650, 'Streak days'],
  };
  const spec = intBounds[type];
  const threshold = parseStrictInteger(draft.threshold, spec[0], spec[1], spec[2]);
  return typeof threshold === 'string'
    ? { ok: false, error: threshold }
    : { ok: true, rule: { type, threshold } };
}

export function draftToPreviewBadge(draft: BadgeFormDraft): BadgeDefinition {
  const tierMeta = BADGE_TIER_META[draft.tier] ?? BADGE_TIER_META.common;
  const ruleRes = buildBadgeRuleFromDraft(draft);
  const xpParsed = Number.parseInt(draft.xpReward, 10);
  const sortParsed = Number.parseInt(draft.sortOrder, 10);
  const nowIso = new Date().toISOString();

  return {
    badgeId: draft.badgeId.trim() || 'preview_badge',
    name: draft.name.trim() || 'Untitled Badge',
    description: draft.description.trim() || 'Configure rule details and preview artwork live.',
    tier: draft.tier,
    customTierLabel: draft.customTierLabel.trim(),
    category: draft.category,
    artworkType: draft.artworkType,
    emblemId: draft.emblemId,
    artworkUrl: draft.artworkUrl.trim(),
    artworkStoragePath: draft.artworkStoragePath.trim(),
    borderStyle: draft.borderStyle,
    primaryColor: sanitizeHexColor(draft.primaryColor, tierMeta.defaultPrimary),
    secondaryColor: sanitizeHexColor(draft.secondaryColor, tierMeta.defaultSecondary),
    animationEffect: draft.animationEffect,
    xpReward: Number.isFinite(xpParsed) && xpParsed >= 0 ? Math.min(50000, xpParsed) : 0,
    rule: ruleRes.ok ? ruleRes.rule : { type: draft.ruleType },
    activeFrom: draft.activeFrom.trim() || null,
    activeUntil: draft.activeUntil.trim() || null,
    hiddenUntilEarned: draft.hiddenUntilEarned,
    status: draft.status,
    sortOrder: Number.isFinite(sortParsed) && sortParsed >= 0 ? Math.min(10000, sortParsed) : 10,
    createdAt: nowIso,
    createdBy: 'preview',
    updatedAt: nowIso,
    updatedBy: 'preview',
  };
}

export function validateAndBuildSavePayload(
  draft: BadgeFormDraft,
): { ok: true; payload: SaveBadgeDefinitionInput } | { ok: false; error: string } {
  const badgeId = draft.badgeId.trim();
  if (!BADGE_ID_RE.test(badgeId) || FORBIDDEN_IDS.has(badgeId)) {
    return {
      ok: false,
      error: 'Badge ID must be 1 to 64 characters using letters, numbers, underscores, or hyphens.',
    };
  }

  const name = draft.name.trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'Badge name must be between 1 and 80 characters.' };
  }

  const description = draft.description.trim();
  if (description.length < 1 || description.length > 240) {
    return { ok: false, error: 'Badge description must be between 1 and 240 characters.' };
  }

  const customTierLabel = draft.customTierLabel.trim();
  if (customTierLabel.length > 24) {
    return { ok: false, error: 'Custom tier label must be 24 characters or fewer.' };
  }

  if (!HEX_COLOR_RE.test(draft.primaryColor.trim()) || !HEX_COLOR_RE.test(draft.secondaryColor.trim())) {
    return { ok: false, error: 'Primary and secondary colors must be valid #RRGGBB hex codes.' };
  }

  const xpReward = parseStrictInteger(draft.xpReward, 0, 50000, 'XP reward');
  if (typeof xpReward === 'string') return { ok: false, error: xpReward };

  const sortOrder = parseStrictInteger(draft.sortOrder, 0, 10000, 'Sort order');
  if (typeof sortOrder === 'string') return { ok: false, error: sortOrder };

  const ruleResult = buildBadgeRuleFromDraft(draft);
  if (!ruleResult.ok) return ruleResult;

  const activeFrom = draft.activeFrom.trim() || null;
  const activeUntil = draft.activeUntil.trim() || null;
  if (activeFrom && !ISO_DATE_RE.test(activeFrom)) {
    return { ok: false, error: 'Active From must be a valid YYYY-MM-DD date.' };
  }
  if (activeUntil && !ISO_DATE_RE.test(activeUntil)) {
    return { ok: false, error: 'Active Until must be a valid YYYY-MM-DD date.' };
  }
  if (activeFrom && activeUntil && activeFrom > activeUntil) {
    return { ok: false, error: 'Active From date must be earlier than or equal to Active Until.' };
  }

  let artworkUrl = '';
  let artworkStoragePath = '';
  if (draft.artworkType === 'upload') {
    artworkUrl = draft.artworkUrl.trim();
    artworkStoragePath = draft.artworkStoragePath.trim();
    if (!isValidBadgeAssetStoragePath(artworkStoragePath, badgeId)) {
      return {
        ok: false,
        error: 'Upload a custom raster artwork image for this Badge ID before saving.',
      };
    }
    if (!isSafeBadgeArtworkUrl(artworkUrl, artworkStoragePath)) {
      return {
        ok: false,
        error: 'Uploaded artwork URL must match the verified Firebase Storage file.',
      };
    }
  }

  return {
    ok: true,
    payload: {
      badgeId,
      name,
      description,
      tier: draft.tier,
      customTierLabel,
      category: draft.category,
      artworkType: draft.artworkType,
      emblemId: draft.emblemId,
      artworkUrl,
      artworkStoragePath,
      borderStyle: draft.borderStyle,
      primaryColor: sanitizeHexColor(draft.primaryColor),
      secondaryColor: sanitizeHexColor(draft.secondaryColor),
      animationEffect: draft.animationEffect,
      xpReward,
      rule: ruleResult.rule,
      activeFrom,
      activeUntil,
      hiddenUntilEarned: draft.hiddenUntilEarned,
      status: draft.status,
      sortOrder,
    },
  };
}
