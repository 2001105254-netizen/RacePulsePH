'use strict';

const BADGE_TIERS = ['common', 'rare', 'special', 'epic', 'legendary', 'alamat'];

const BADGE_CATEGORIES = [
  'onboarding',
  'distance',
  'elevation',
  'races',
  'exploration',
  'community',
  'streaks',
  'special',
];

const BADGE_BORDER_STYLES = [
  'solid-ring',
  'double-crest',
  'laurel-wreath',
  'hex-tactical',
  'sunburst-ph',
  'ribbon-medal',
  'diamond-cut',
  'cyber-bezel',
  'alamat-gold',
];

const BADGE_ANIMATION_EFFECTS = [
  'none',
  'shimmer-sweep',
  'gentle-float',
  'pulse-glow',
  'prism-tilt',
  'sparkle-orbit',
  'flame-aura',
];

const BADGE_EMBLEM_IDS = [
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
];

const BADGE_RULE_TYPES = [
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
];

const ALLOWED_BADGE_ASSET_PATH_RE =
  /^badge-assets\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9._-]{1,128}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

const BADGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_3_RE = /^#[0-9a-fA-F]{3}$/;
const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_UPLOAD_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);
const ALLOWED_FIREBASESTORAGE_APP_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.firebasestorage\.app$/;
const RASTER_URL_EXT_RE = /\.(png|jpg|jpeg|webp|avif)$/i;

const TIER_SET = new Set(BADGE_TIERS);
const CATEGORY_SET = new Set(BADGE_CATEGORIES);
const BORDER_SET = new Set(BADGE_BORDER_STYLES);
const ANIMATION_SET = new Set(BADGE_ANIMATION_EFFECTS);
const EMBLEM_SET = new Set(BADGE_EMBLEM_IDS);
const RULE_TYPE_SET = new Set(BADGE_RULE_TYPES);
const VALID_STATUSES = new Set(['active', 'archived']);
const VALID_ARTWORK_TYPES = new Set(['emblem', 'upload']);

const PHT_OFFSET_MS = 8 * 3600 * 1000;
const MS_PER_DAY = 86_400_000;

const RANK_THRESHOLDS = [
  { minLevel: 25, title: 'Alamat' },
  { minLevel: 15, title: 'Ultra Strider' },
  { minLevel: 10, title: 'Marathoner' },
  { minLevel: 6, title: 'Trail Blazer' },
  { minLevel: 3, title: 'Road Runner' },
  { minLevel: 1, title: 'Pacer' },
];

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function assertValidBadgeId(rawId, label = 'badgeId') {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!BADGE_ID_RE.test(id) || FORBIDDEN_IDS.has(id)) {
    fail(`Invalid ${label}.`);
  }
  return id;
}

function assertTextRange(value, minLen, maxLen, label) {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    fail(`${label} must be between ${minLen} and ${maxLen} characters.`);
  }
  return trimmed;
}

function normalizeHexColor(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a hex color string.`);
  const trimmed = value.trim();
  if (HEX_6_RE.test(trimmed)) return trimmed.toUpperCase();
  if (HEX_3_RE.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  fail(`${label} must be a valid hex color.`);
}

function assertBoundedInteger(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function assertBoundedNumber(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function isValidCalendarYmd(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function parseOptionalIsoDate(value, label, isUpperBound = false) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    fail(`${label} must be an ISO timestamp string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = ISO_DATE_ONLY_RE.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isValidCalendarYmd(year, month, day)) {
      fail(`${label} is not a valid calendar date.`);
    }
    const suffix = isUpperBound ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    return { iso: trimmed, ms: Date.parse(`${trimmed}${suffix}`) };
  }

  const dtMatch = ISO_DATETIME_RE.exec(trimmed);
  if (!dtMatch) {
    fail(`${label} must be a valid ISO-8601 date or timestamp.`);
  }
  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const ms = Date.parse(trimmed);
  if (!isValidCalendarYmd(year, month, day) || !Number.isFinite(ms)) {
    fail(`${label} is not a valid ISO timestamp.`);
  }
  return { iso: trimmed, ms };
}

function isAllowedUploadHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (ALLOWED_UPLOAD_HOSTS.has(host)) return true;
  return ALLOWED_FIREBASESTORAGE_APP_RE.test(host);
}

function validateUploadArtwork(badgeId, rawUrl, rawPath) {
  const storagePath = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!ALLOWED_BADGE_ASSET_PATH_RE.test(storagePath) || storagePath.includes('..')) {
    fail('artworkStoragePath must match badge-assets/{uid}/{badgeId}/{rasterFile}.');
  }
  const segments = storagePath.split('/');
  if (segments.length !== 4 || segments[2] !== badgeId || segments[3].startsWith('.')) {
    fail('artworkStoragePath must match the target badgeId path segment.');
  }

  const urlText = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!urlText || urlText.length > 2048 || /[\u0000-\u001f\u007f]/.test(urlText)) {
    fail('artworkUrl is required for uploaded badge artwork.');
  }
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    fail('artworkUrl must be a valid HTTPS Firebase Storage URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password) {
    fail('artworkUrl must use HTTPS on default port without embedded credentials.');
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (!isAllowedUploadHost(host)) {
    fail('artworkUrl must point to an approved Firebase or Cloud Storage host.');
  }
  let decodedPath = parsed.pathname;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    fail('artworkUrl contains malformed path encoding.');
  }
  if (
    decodedPath.includes('..') ||
    decodedPath.includes('//') ||
    !RASTER_URL_EXT_RE.test(decodedPath)
  ) {
    fail('artworkUrl must reference an approved raster image (.png, .jpg, .jpeg, .webp, .avif).');
  }
  const markerIdx = decodedPath.indexOf('/badge-assets/');
  if (markerIdx === -1 || decodedPath.slice(markerIdx + 1) !== storagePath) {
    fail('artworkUrl must match artworkStoragePath.');
  }
  const bucketPattern = /^[a-z0-9._-]{3,63}$/;
  const isValidBucket = (bucket) =>
    bucketPattern.test(bucket) &&
    !bucket.includes('..') &&
    !bucket.startsWith('.') &&
    !bucket.endsWith('.');
  if (host === 'storage.googleapis.com') {
    const gcsMatch = /^\/([^/]+)\/(badge-assets\/.+)$/.exec(decodedPath);
    if (!gcsMatch || !isValidBucket(gcsMatch[1]) || gcsMatch[2] !== storagePath) {
      fail('artworkUrl GCS bucket path must match artworkStoragePath.');
    }
  } else {
    const fbMatch = /^\/v0\/b\/([^/]+)\/o\/(badge-assets\/.+)$/.exec(decodedPath);
    if (!fbMatch || !isValidBucket(fbMatch[1]) || fbMatch[2] !== storagePath) {
      fail('artworkUrl Firebase Storage path must match artworkStoragePath.');
    }
  }

  return { artworkUrl: urlText, artworkStoragePath: storagePath };
}

function validateBadgeRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
    fail('Badge rule must be an object.');
  }
  const type = typeof rawRule.type === 'string' ? rawRule.type.trim() : '';
  if (!RULE_TYPE_SET.has(type)) {
    fail('Unsupported badge rule type.');
  }

  if (type === 'welcome' || type === 'profile_complete' || type === 'manual_grant') {
    if (rawRule.threshold !== undefined && rawRule.threshold !== null) {
      assertBoundedInteger(rawRule.threshold, 1, 1, `${type} threshold`);
    }
    return { type };
  }

  if (type === 'race_joined' || type === 'race_finished') {
    const threshold =
      rawRule.threshold === undefined || rawRule.threshold === null
        ? 1
        : assertBoundedInteger(rawRule.threshold, 1, 1000, `${type} threshold`);
    const out = { type, threshold };
    if (rawRule.raceId !== undefined && rawRule.raceId !== null && rawRule.raceId !== '') {
      out.raceId = assertValidBadgeId(rawRule.raceId, 'rule.raceId');
    }
    return out;
  }

  if (type === 'run_count') {
    return {
      type,
      threshold: assertBoundedInteger(rawRule.threshold, 1, 10000, 'run_count threshold'),
    };
  }

  if (type === 'run_single_distance_km') {
    return {
      type,
      threshold: assertBoundedNumber(
        rawRule.threshold,
        0.1,
        500,
        'run_single_distance_km threshold',
      ),
    };
  }

  if (type === 'run_total_distance_km') {
    return {
      type,
      threshold: assertBoundedNumber(
        rawRule.threshold,
        0.1,
        100000,
        'run_total_distance_km threshold',
      ),
    };
  }

  if (type === 'run_total_elevation_m') {
    return {
      type,
      threshold: assertBoundedInteger(
        rawRule.threshold,
        1,
        1000000,
        'run_total_elevation_m threshold',
      ),
    };
  }

  if (type === 'run_time_window') {
    const startHourPht = assertBoundedInteger(rawRule.startHourPht, 0, 23, 'startHourPht');
    const endHourPht = assertBoundedInteger(rawRule.endHourPht, 0, 23, 'endHourPht');
    const threshold =
      rawRule.threshold === undefined || rawRule.threshold === null
        ? 1
        : assertBoundedInteger(rawRule.threshold, 1, 1000, 'run_time_window threshold');
    return { type, threshold, startHourPht, endHourPht };
  }

  if (type === 'regions_explored') {
    let targetRegions;
    if (rawRule.targetRegions !== undefined && rawRule.targetRegions !== null) {
      if (!Array.isArray(rawRule.targetRegions) || rawRule.targetRegions.length === 0 || rawRule.targetRegions.length > 20) {
        fail('targetRegions must contain between 1 and 20 region labels.');
      }
      const normalized = [];
      const seen = new Set();
      for (const item of rawRule.targetRegions) {
        const label = assertTextRange(item, 1, 64, 'targetRegions entry');
        const key = label.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          normalized.push(label);
        }
      }
      targetRegions = normalized;
    }
    const maxThreshold = targetRegions ? targetRegions.length : 100;
    const defaultThreshold = targetRegions ? targetRegions.length : 1;
    const threshold =
      rawRule.threshold === undefined || rawRule.threshold === null
        ? defaultThreshold
        : assertBoundedInteger(rawRule.threshold, 1, maxThreshold, 'regions_explored threshold');
    return targetRegions ? { type, threshold, targetRegions } : { type, threshold };
  }

  const countBounds = {
    club_joined: [1, 100],
    friends_count: [1, 5000],
    social_posts_count: [1, 10000],
    kudos_received: [1, 1000000],
    run_streak_weeks: [1, 520],
    inbox_streak_days: [1, 3650],
  };
  const [min, max] = countBounds[type];
  return {
    type,
    threshold: assertBoundedInteger(rawRule.threshold, min, max, `${type} threshold`),
  };
}

function validateBadgeDefinitionInput(input, actorUid = 'system', nowIso = new Date().toISOString(), existingDoc = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Badge definition payload must be an object.');
  }
  const actor = typeof actorUid === 'string' ? actorUid.trim() : '';
  if (!actor || actor.length > 128 || FORBIDDEN_IDS.has(actor)) {
    fail('Valid actorUid is required.');
  }
  const nowParsed = parseOptionalIsoDate(nowIso, 'nowIso');
  if (!nowParsed) {
    fail('Valid nowIso timestamp is required.');
  }

  const badgeId = assertValidBadgeId(input.badgeId, 'badgeId');
  const name = assertTextRange(input.name, 1, 80, 'Badge name');
  const description = assertTextRange(input.description, 1, 240, 'Badge description');

  const tier = typeof input.tier === 'string' ? input.tier.trim() : '';
  if (!TIER_SET.has(tier)) fail('Invalid badge tier.');

  let customTierLabel = '';
  if (input.customTierLabel !== undefined && input.customTierLabel !== null) {
    if (typeof input.customTierLabel !== 'string') {
      fail('customTierLabel must be a string.');
    }
    customTierLabel = input.customTierLabel.trim();
    if (customTierLabel.length > 24) {
      fail('customTierLabel must be 24 characters or fewer.');
    }
  }

  const category = typeof input.category === 'string' ? input.category.trim() : '';
  if (!CATEGORY_SET.has(category)) fail('Invalid badge category.');

  const artworkType = typeof input.artworkType === 'string' ? input.artworkType.trim() : '';
  if (!VALID_ARTWORK_TYPES.has(artworkType)) fail('Invalid artworkType.');

  let emblemId = '';
  let artworkUrl = '';
  let artworkStoragePath = '';
  if (artworkType === 'emblem') {
    emblemId = typeof input.emblemId === 'string' ? input.emblemId.trim() : '';
    if (!EMBLEM_SET.has(emblemId)) fail('Invalid emblemId.');
  } else {
    if (input.emblemId !== undefined && input.emblemId !== null && input.emblemId !== '') {
      const candidateEmblem = typeof input.emblemId === 'string' ? input.emblemId.trim() : '';
      if (!EMBLEM_SET.has(candidateEmblem)) fail('Invalid emblemId.');
      emblemId = candidateEmblem;
    }
    const validatedUpload = validateUploadArtwork(badgeId, input.artworkUrl, input.artworkStoragePath);
    artworkUrl = validatedUpload.artworkUrl;
    artworkStoragePath = validatedUpload.artworkStoragePath;
  }

  const borderStyle = typeof input.borderStyle === 'string' ? input.borderStyle.trim() : '';
  if (!BORDER_SET.has(borderStyle)) fail('Invalid borderStyle.');

  const primaryColor = normalizeHexColor(input.primaryColor, 'primaryColor');
  const secondaryColor = normalizeHexColor(input.secondaryColor, 'secondaryColor');

  const animationEffect =
    typeof input.animationEffect === 'string' ? input.animationEffect.trim() : '';
  if (!ANIMATION_SET.has(animationEffect)) fail('Invalid animationEffect.');

  const xpReward = assertBoundedInteger(input.xpReward, 0, 50000, 'xpReward');
  const rule = validateBadgeRule(input.rule);

  const activeFrom = parseOptionalIsoDate(input.activeFrom, 'activeFrom', false);
  const activeUntil = parseOptionalIsoDate(input.activeUntil, 'activeUntil', true);
  if (activeFrom && activeUntil && activeFrom.ms > activeUntil.ms) {
    fail('activeFrom must be earlier than or equal to activeUntil.');
  }

  if (typeof input.hiddenUntilEarned !== 'boolean') {
    fail('hiddenUntilEarned must be a boolean.');
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (!VALID_STATUSES.has(status)) fail('Invalid badge status.');

  const sortOrder = assertBoundedInteger(input.sortOrder, 0, 10000, 'sortOrder');

  const existingCreatedAt =
    existingDoc && typeof existingDoc.createdAt === 'string' && existingDoc.createdAt.trim()
      ? existingDoc.createdAt.trim()
      : nowParsed.iso;
  const existingCreatedBy =
    existingDoc && typeof existingDoc.createdBy === 'string' && existingDoc.createdBy.trim()
      ? existingDoc.createdBy.trim()
      : actor;

  return {
    badgeId,
    name,
    description,
    tier,
    customTierLabel,
    category,
    artworkType,
    emblemId,
    artworkUrl,
    artworkStoragePath,
    borderStyle,
    primaryColor,
    secondaryColor,
    animationEffect,
    xpReward,
    rule,
    activeFrom: activeFrom ? activeFrom.iso : null,
    activeUntil: activeUntil ? activeUntil.iso : null,
    hiddenUntilEarned: input.hiddenUntilEarned,
    status,
    sortOrder,
    createdAt: existingCreatedAt,
    createdBy: existingCreatedBy,
    updatedAt: nowParsed.iso,
    updatedBy: actor,
  };
}

function buildStarterBadgePack(actorUid = 'system', nowIso = new Date().toISOString()) {
  const definitions = [
    {
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
      status: 'active',
      sortOrder: 10,
    },
    {
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
      status: 'active',
      sortOrder: 20,
    },
    {
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
      status: 'active',
      sortOrder: 30,
    },
    {
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
      status: 'active',
      sortOrder: 40,
    },
    {
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
      status: 'active',
      sortOrder: 50,
    },
    {
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
      status: 'active',
      sortOrder: 60,
    },
    {
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
      status: 'active',
      sortOrder: 70,
    },
    {
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
      status: 'active',
      sortOrder: 80,
    },
  ];

  return definitions.map((entry) => validateBadgeDefinitionInput(entry, actorUid, nowIso));
}

function xpForLevel(level) {
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 1) return 0;
  const wholeLevel = Math.floor(level);
  // (wholeLevel - 1) * wholeLevel is always even, so multiplying by 50 stays exact integer.
  return 50 * (wholeLevel - 1) * wholeLevel;
}

function getRankTitleForLevel(level) {
  for (const tier of RANK_THRESHOLDS) {
    if (level >= tier.minLevel) return tier.title;
  }
  return 'Pacer';
}

function computeLevelFromXp(totalXp) {
  const safeXp =
    typeof totalXp === 'number' && Number.isFinite(totalXp) && totalXp > 0
      ? Math.floor(totalXp)
      : 0;

  let low = 1;
  let high = 1;
  while (xpForLevel(high) <= safeXp) {
    low = high;
    high *= 2;
  }
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (xpForLevel(mid) <= safeXp) low = mid;
    else high = mid;
  }

  return {
    totalXp: safeXp,
    level: low,
    currentLevelXp: xpForLevel(low),
    nextLevelXp: xpForLevel(low + 1),
    rankTitle: getRankTitleForLevel(low),
  };
}

function computeRunCompletionXp(runSummary) {
  if (!runSummary || runSummary.verificationStatus !== 'verified') return 0;
  const distanceM =
    typeof runSummary.distanceM === 'number' &&
    Number.isFinite(runSummary.distanceM) &&
    runSummary.distanceM > 0
      ? runSummary.distanceM
      : 0;
  const elevationGainM =
    typeof runSummary.elevationGainM === 'number' &&
    Number.isFinite(runSummary.elevationGainM) &&
    runSummary.elevationGainM > 0
      ? runSummary.elevationGainM
      : 0;
  const distanceXp = Math.round((distanceM / 1000) * 10);
  const elevationXp = Math.floor(elevationGainM / 10);
  return Math.min(1500, Math.max(15, distanceXp + elevationXp));
}

function parseTimestampMs(isoString) {
  if (typeof isoString !== 'string') return null;
  const trimmed = isoString.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

function getPhtHour(isoString) {
  const ms = parseTimestampMs(isoString);
  if (ms === null) return null;
  return new Date(ms + PHT_OFFSET_MS).getUTCHours();
}

function getPhtWeekIndex(isoString) {
  const ms = parseTimestampMs(isoString);
  if (ms === null) return null;
  // Unix epoch (1970-01-01) was Thursday; shifting by +3 days aligns Monday to multiples of 7.
  const phtDay = Math.floor((ms + PHT_OFFSET_MS) / MS_PER_DAY);
  return Math.floor((phtDay + 3) / 7);
}

function getVerifiedRuns(factsOrRuns) {
  const list = Array.isArray(factsOrRuns)
    ? factsOrRuns
    : Array.isArray(factsOrRuns?.verifiedRuns)
      ? factsOrRuns.verifiedRuns
      : Array.isArray(factsOrRuns?.runs)
        ? factsOrRuns.runs
        : [];
  return list.filter((run) => run && run.verificationStatus === 'verified');
}

function computeRunStreakWeeksPht(verifiedRuns, nowIso = new Date().toISOString()) {
  const nowWeek = getPhtWeekIndex(nowIso) ?? getPhtWeekIndex(new Date().toISOString());
  const runs = getVerifiedRuns(verifiedRuns);
  if (runs.length === 0 || nowWeek === null) {
    return { runStreakWeeks: 0, runStreakGraceRemaining: 0 };
  }

  const weekSet = new Set();
  for (const run of runs) {
    const ts = run.startedAt || run.finishedAt || run.createdAt;
    const wk = getPhtWeekIndex(ts);
    if (wk !== null && wk <= nowWeek) {
      weekSet.add(wk);
    }
  }
  if (weekSet.size === 0) {
    return { runStreakWeeks: 0, runStreakGraceRemaining: 0 };
  }

  const sortedWeeks = Array.from(weekSet).sort((a, b) => a - b);
  let streak = 1;
  let uninterrupted = 1;
  let grace = 0;

  for (let i = 1; i < sortedWeeks.length; i += 1) {
    const missed = sortedWeeks[i] - sortedWeeks[i - 1] - 1;
    if (missed === 0) {
      streak += 1;
      uninterrupted += 1;
      if (uninterrupted % 4 === 0) {
        grace += 1;
      }
    } else if (missed <= grace) {
      grace -= missed;
      streak += 1;
      uninterrupted = 1;
    } else {
      streak = 1;
      uninterrupted = 1;
      grace = 0;
    }
  }

  const lastActiveWeek = sortedWeeks[sortedWeeks.length - 1];
  const completedMissedAfterLast = Math.max(0, nowWeek - 1 - lastActiveWeek);
  if (completedMissedAfterLast > grace) {
    return { runStreakWeeks: 0, runStreakGraceRemaining: 0 };
  }

  return {
    runStreakWeeks: streak,
    runStreakGraceRemaining: grace - completedMissedAfterLast,
  };
}

function parseWindowBoundMs(raw, isUpperBound) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return Number.NaN;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (ISO_DATE_ONLY_RE.test(trimmed)) {
    return Date.parse(`${trimmed}${isUpperBound ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`);
  }
  return Date.parse(trimmed);
}

function isBadgeWithinActiveWindow(badge, nowIso = new Date().toISOString()) {
  if (!badge || typeof badge !== 'object') return false;
  const nowMs = parseTimestampMs(nowIso);
  if (nowMs === null) return false;

  const fromMs = parseWindowBoundMs(badge.activeFrom, false);
  if (fromMs !== null) {
    if (!Number.isFinite(fromMs) || nowMs < fromMs) return false;
  }

  const untilMs = parseWindowBoundMs(badge.activeUntil, true);
  if (untilMs !== null) {
    if (!Number.isFinite(untilMs) || nowMs > untilMs) return false;
  }

  return true;
}

function lookupMapOrObject(container, key) {
  if (!container) return undefined;
  if (typeof container.get === 'function') return container.get(key);
  return Object.prototype.hasOwnProperty.call(container, key) ? container[key] : undefined;
}

function buildRaceLookup(races) {
  const byId = new Map();
  if (!races) return byId;
  if (typeof races.forEach === 'function' && !Array.isArray(races)) {
    races.forEach((race, key) => {
      if (race && typeof race === 'object') {
        const id = String(race.id || race.raceId || key || '').trim();
        if (id) byId.set(id, race);
      }
    });
    return byId;
  }
  if (Array.isArray(races)) {
    for (const race of races) {
      if (!race || typeof race !== 'object') continue;
      const id = String(race.id || race.raceId || '').trim();
      if (id) byId.set(id, race);
    }
    return byId;
  }
  for (const [key, race] of Object.entries(races)) {
    if (race && typeof race === 'object') {
      const id = String(race.id || race.raceId || key || '').trim();
      if (id) byId.set(id, race);
    }
  }
  return byId;
}

function collectVerifiedFinishedRaceIds(races, liveResultsByRaceId, userRegistrations) {
  const finishedRaceIds = new Set();
  const raceById = buildRaceLookup(races);
  const bibsByRaceId = new Map();

  for (const reg of userRegistrations || []) {
    if (!reg || typeof reg !== 'object') continue;
    if (reg.isFreeSlot === true || reg.runner?.isFreeSlot === true) continue;
    const raceId = String(reg.raceId || reg.runner?.raceId || '').trim();
    const bibNumber = String(reg.bibNumber || reg.runner?.bibNumber || '')
      .trim()
      .toUpperCase();
    if (!raceId || !bibNumber) continue;
    let bibs = bibsByRaceId.get(raceId);
    if (!bibs) {
      bibs = new Set();
      bibsByRaceId.set(raceId, bibs);
    }
    bibs.add(bibNumber);
  }

  for (const [raceId, userBibs] of bibsByRaceId.entries()) {
    const race = raceById.get(raceId);
    const hasCompletedAt =
      Boolean(race?.completedAt) &&
      (typeof race.completedAt !== 'string' || race.completedAt.trim().length > 0);
    if (!hasCompletedAt) continue;

    const liveResults = lookupMapOrObject(liveResultsByRaceId, raceId);
    const officialResults = Array.isArray(liveResults?.officialResults)
      ? liveResults.officialResults
      : [];

    const hasCleanFinish = officialResults.some((entry) => {
      if (!entry || entry.isFreeSlot === true || entry.disqualified || entry.finishReviewRequired) {
        return false;
      }
      const bib = String(entry.bibNumber || '')
        .trim()
        .toUpperCase();
      return Boolean(bib) && userBibs.has(bib);
    });
    if (hasCleanFinish) {
      finishedRaceIds.add(raceId);
    }
  }

  return finishedRaceIds;
}

function isUserProfileComplete(facts) {
  if (facts?.profileComplete === true) return true;
  const user = facts?.user || facts?.profile;
  if (!user || typeof user !== 'object') return false;
  const hasText = (val) => typeof val === 'string' && val.trim().length > 0;
  if (!hasText(user.displayName) || !hasText(user.username)) return false;

  let enrichmentSignals = 0;
  if (hasText(user.bio)) enrichmentSignals += 1;
  if (hasText(user.location)) enrichmentSignals += 1;
  if (hasText(user.favoriteDistance)) enrichmentSignals += 1;
  if (typeof user.weightKg === 'number' && Number.isFinite(user.weightKg) && user.weightKg >= 25) {
    enrichmentSignals += 1;
  }
  if (hasText(user.emergencyContactName) && hasText(user.emergencyContactPhone)) {
    enrichmentSignals += 1;
  }
  return enrichmentSignals >= 2;
}

function collectJoinedRaceIds(facts) {
  const joined = new Set();
  for (const id of facts?.joinedRaceIds || []) {
    if (typeof id === 'string' && id.trim()) joined.add(id.trim());
  }
  const regs = [
    ...(facts?.userRegistrations || []),
    ...(facts?.runners || []),
    ...(facts?.runnerClaims || []),
  ];
  for (const reg of regs) {
    if (!reg || reg.isFreeSlot === true || reg.runner?.isFreeSlot === true) continue;
    if (reg.paymentStatus === 'pending' || reg.runner?.paymentStatus === 'pending') continue;
    const raceId = String(reg.raceId || reg.runner?.raceId || '').trim();
    if (raceId) joined.add(raceId);
  }
  return joined;
}

function collectFinishedRaceIds(facts) {
  if (facts?.verifiedFinishedRaceIds) {
    const out = new Set();
    for (const id of facts.verifiedFinishedRaceIds) {
      if (typeof id === 'string') {
        const trimmed = id.trim();
        if (trimmed) out.add(trimmed);
      }
    }
    return out;
  }
  const regs = [
    ...(facts?.userRegistrations || []),
    ...(facts?.runners || []),
    ...(facts?.runnerClaims || []),
  ];
  if (!facts?.races || !facts?.liveResultsByRaceId || regs.length === 0) {
    return new Set();
  }
  return collectVerifiedFinishedRaceIds(facts.races, facts.liveResultsByRaceId, regs);
}

function collectExploredRegions(facts, verifiedRuns) {
  const regions = new Set();
  for (const run of verifiedRuns) {
    for (const group of run.islandGroups || []) {
      if (typeof group === 'string' && group.trim()) {
        regions.add(group.trim().toLowerCase());
      }
    }
    const courseRegion = run.courseRef?.region;
    if (typeof courseRegion === 'string' && courseRegion.trim()) {
      regions.add(courseRegion.trim().toLowerCase());
    }
  }
  for (const r of facts?.exploredRegions || []) {
    if (typeof r === 'string' && r.trim()) {
      regions.add(r.trim().toLowerCase());
    }
  }
  return regions;
}

function collectJoinedClubsCount(facts) {
  const clubIds = new Set();
  for (const id of facts?.joinedClubIds || []) {
    if (typeof id === 'string' && id.trim()) clubIds.add(id.trim());
  }
  for (const membership of facts?.clubMemberships || []) {
    if (!membership || typeof membership !== 'object') continue;
    if (
      membership.status !== undefined &&
      membership.status !== null &&
      membership.status !== 'active'
    ) {
      continue;
    }
    const id = typeof membership.clubId === 'string' ? membership.clubId.trim() : '';
    if (id) clubIds.add(id);
  }
  if (Array.isArray(facts?.joinedClubIds) || Array.isArray(facts?.clubMemberships)) {
    return clubIds.size;
  }
  return typeof facts?.clubsCount === 'number' && Number.isFinite(facts.clubsCount)
    ? Math.max(0, Math.floor(facts.clubsCount))
    : 0;
}

function isHourInPhtWindow(hour, startHour, endHour) {
  if (hour === null) return false;
  if (startHour <= endHour) {
    return hour >= startHour && hour <= endHour;
  }
  return hour >= startHour || hour <= endHour;
}

function evaluateBadgeRule(badge, facts = {}, nowIso = new Date().toISOString()) {
  if (!badge || typeof badge !== 'object') return false;
  if (badge.status && badge.status !== 'active') return false;
  if (!isBadgeWithinActiveWindow(badge, nowIso)) return false;

  const rule = badge.rule;
  if (!rule || typeof rule !== 'object' || typeof rule.type !== 'string') return false;
  if (rule.type === 'manual_grant') return false;

  const verifiedRuns = getVerifiedRuns(facts);

  switch (rule.type) {
    case 'welcome':
      return facts?.accountActive !== false;

    case 'profile_complete':
      return isUserProfileComplete(facts);

    case 'race_joined': {
      const joined = collectJoinedRaceIds(facts);
      if (rule.raceId) return joined.has(rule.raceId);
      return joined.size >= (rule.threshold || 1);
    }

    case 'race_finished': {
      const finished = collectFinishedRaceIds(facts);
      if (rule.raceId) return finished.has(rule.raceId);
      return finished.size >= (rule.threshold || 1);
    }

    case 'run_count':
      return verifiedRuns.length >= rule.threshold;

    case 'run_single_distance_km': {
      const minDistanceM = Math.round(rule.threshold * 1000);
      return verifiedRuns.some(
        (run) =>
          typeof run.distanceM === 'number' &&
          Number.isFinite(run.distanceM) &&
          run.distanceM >= minDistanceM,
      );
    }

    case 'run_total_distance_km': {
      const requiredM = Math.round(rule.threshold * 1000);
      let totalM = 0;
      for (const run of verifiedRuns) {
        if (typeof run.distanceM === 'number' && Number.isFinite(run.distanceM) && run.distanceM > 0) {
          totalM += run.distanceM;
        }
      }
      return totalM >= requiredM;
    }

    case 'run_total_elevation_m': {
      let totalElevationM = 0;
      for (const run of verifiedRuns) {
        if (
          typeof run.elevationGainM === 'number' &&
          Number.isFinite(run.elevationGainM) &&
          run.elevationGainM > 0
        ) {
          totalElevationM += run.elevationGainM;
        }
      }
      return totalElevationM >= rule.threshold;
    }

    case 'run_time_window': {
      let matchingCount = 0;
      for (const run of verifiedRuns) {
        const ts = run.startedAt || run.finishedAt || run.createdAt;
        const hour = getPhtHour(ts);
        if (isHourInPhtWindow(hour, rule.startHourPht, rule.endHourPht)) {
          matchingCount += 1;
        }
      }
      return matchingCount >= (rule.threshold || 1);
    }

    case 'regions_explored': {
      const explored = collectExploredRegions(facts, verifiedRuns);
      if (Array.isArray(rule.targetRegions) && rule.targetRegions.length > 0) {
        let matched = 0;
        for (const target of rule.targetRegions) {
          if (explored.has(String(target).trim().toLowerCase())) {
            matched += 1;
          }
        }
        return matched >= (rule.threshold || rule.targetRegions.length);
      }
      return explored.size >= (rule.threshold || 1);
    }

    case 'club_joined':
      return collectJoinedClubsCount(facts) >= (rule.threshold || 1);

    case 'friends_count': {
      let count = 0;
      if (Array.isArray(facts?.friendIds)) {
        const uniqueFriends = new Set();
        for (const id of facts.friendIds) {
          if (typeof id === 'string') {
            const trimmed = id.trim();
            if (trimmed) uniqueFriends.add(trimmed);
          }
        }
        count = uniqueFriends.size;
      } else if (typeof facts?.friendsCount === 'number' && Number.isFinite(facts.friendsCount)) {
        count = Math.max(0, Math.floor(facts.friendsCount));
      }
      return count >= rule.threshold;
    }

    case 'social_posts_count': {
      const count = Array.isArray(facts?.socialPosts)
        ? facts.socialPosts.filter((p) => p && !p.deletedAt).length
        : typeof facts?.socialPostsCount === 'number' && Number.isFinite(facts.socialPostsCount)
          ? Math.max(0, Math.floor(facts.socialPostsCount))
          : 0;
      return count >= rule.threshold;
    }

    case 'kudos_received': {
      let count = 0;
      if (typeof facts?.kudosReceived === 'number' && Number.isFinite(facts.kudosReceived)) {
        count = Math.max(0, Math.floor(facts.kudosReceived));
      } else if (typeof facts?.kudosCount === 'number' && Number.isFinite(facts.kudosCount)) {
        count = Math.max(0, Math.floor(facts.kudosCount));
      } else if (Array.isArray(facts?.socialPosts)) {
        for (const post of facts.socialPosts) {
          if (post && !post.deletedAt && typeof post.kudosCount === 'number' && Number.isFinite(post.kudosCount)) {
            count += Math.max(0, Math.floor(post.kudosCount));
          }
        }
      }
      return count >= rule.threshold;
    }

    case 'run_streak_weeks': {
      const hasRunArray = Array.isArray(facts?.verifiedRuns) || Array.isArray(facts?.runs);
      const streak = hasRunArray
        ? computeRunStreakWeeksPht(verifiedRuns, nowIso).runStreakWeeks
        : typeof facts?.runStreakWeeks === 'number' && Number.isFinite(facts.runStreakWeeks)
          ? Math.max(0, Math.floor(facts.runStreakWeeks))
          : 0;
      return streak >= rule.threshold;
    }

    case 'inbox_streak_days': {
      const days =
        typeof facts?.inboxStreakDays === 'number' && Number.isFinite(facts.inboxStreakDays)
          ? Math.max(0, Math.floor(facts.inboxStreakDays))
          : typeof facts?.maxInboxStreakDays === 'number' && Number.isFinite(facts.maxInboxStreakDays)
            ? Math.max(0, Math.floor(facts.maxInboxStreakDays))
            : 0;
      return days >= rule.threshold;
    }

    default:
      return false;
  }
}

module.exports = {
  ALLOWED_BADGE_ASSET_PATH_RE,
  BADGE_ANIMATION_EFFECTS,
  BADGE_BORDER_STYLES,
  BADGE_CATEGORIES,
  BADGE_EMBLEM_IDS,
  BADGE_RULE_TYPES,
  BADGE_TIERS,
  buildStarterBadgePack,
  collectVerifiedFinishedRaceIds,
  computeLevelFromXp,
  computeRunCompletionXp,
  computeRunStreakWeeksPht,
  evaluateBadgeRule,
  getPhtHour,
  getPhtWeekIndex,
  isBadgeWithinActiveWindow,
  validateBadgeDefinitionInput,
  xpForLevel,
};
