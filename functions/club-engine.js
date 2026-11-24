'use strict';

const CLUB_MODULES = [
  'chat',
  'leaderboard',
  'events',
  'badges',
  'routeLibrary',
  'announcements',
  'memberSpotlight',
  'customTheme',
];

const CLUB_MODULE_SET = new Set(CLUB_MODULES);

const DEFAULT_CLUB_MODULES = {
  chat: true,
  leaderboard: true,
  events: true,
  badges: true,
  routeLibrary: false,
  announcements: true,
  memberSpotlight: false,
  customTheme: true,
};

const CLUB_JOIN_POLICIES = ['open', 'approval', 'invite_only'];
const CLUB_JOIN_POLICY_SET = new Set(CLUB_JOIN_POLICIES);

const CLUB_BILLING_TIERS = ['free', 'community', 'pro'];
const CLUB_BILLING_TIER_SET = new Set(CLUB_BILLING_TIERS);

const CLUB_SUBSCRIPTION_STATUSES = ['active', 'trial', 'past_due', 'canceled'];
const CLUB_SUBSCRIPTION_STATUS_SET = new Set(CLUB_SUBSCRIPTION_STATUSES);

const CLUB_BILLING_PROVIDERS = ['admin_manual', 'paymongo'];
const CLUB_BILLING_PROVIDER_SET = new Set(CLUB_BILLING_PROVIDERS);

const CLUB_STATUSES = ['active', 'archived'];
const CLUB_STATUS_SET = new Set(CLUB_STATUSES);

const CLUB_MEMBER_STATUSES = ['active', 'pending', 'removed'];
const CLUB_MEMBER_ROLES = ['member', 'captain'];
const CLUB_REQUEST_STATUSES = ['pending', 'approved', 'rejected'];
const MEETUP_STATUSES = new Set(['scheduled', 'canceled']);

const MAX_CLUB_CAPTAINS = 25;
const MAX_CLUB_LINKED_BADGES = 50;
const MAX_CLUB_FEATURED_ROUTES = 30;
const MAX_CLUB_LINKED_RACES = 30;
const MAX_CLUB_MEMBERS_CAP = 5000;

const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const CLUB_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_3_RE = /^#[0-9a-fA-F]{3}$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_UPLOAD_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);
const ALLOWED_FIREBASESTORAGE_APP_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.firebasestorage\.app$/;
const RASTER_EXT_RE = /\.(png|jpg|jpeg|webp|avif)$/i;
const ALLOWED_CLUB_ASSET_PATH_RE =
  /^club-assets\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{2,64}\/[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function assertValidEntityId(value, label, re = ENTITY_ID_RE) {
  if (typeof value !== 'string') {
    fail(`${label} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (!re.test(trimmed) || FORBIDDEN_IDS.has(trimmed)) {
    fail(`${label} contains invalid characters or length.`);
  }
  return trimmed;
}

function assertSafeText(value, { label, min = 0, max = 500 }) {
  if (value === undefined || value === null) {
    if (min > 0) fail(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') {
    fail(`${label} must be a text string.`);
  }
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (cleaned.length < min || cleaned.length > max) {
    fail(`${label} must be between ${min} and ${max} characters.`);
  }
  return cleaned;
}

function parseStrictIso(value, label) {
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value.trim())) {
    fail(`${label} must be a valid ISO-8601 timestamp.`);
  }
  const trimmed = value.trim();
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    fail(`${label} is not a valid timestamp.`);
  }
  return { iso: trimmed, ms };
}

function normalizeHexColor(value, label, fallback) {
  if ((value === undefined || value === null || value === '') && fallback) {
    return fallback;
  }
  if (typeof value !== 'string') {
    fail(`${label} must be a hex color string.`);
  }
  const trimmed = value.trim();
  if (HEX_6_RE.test(trimmed)) return trimmed.toUpperCase();
  if (HEX_3_RE.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  fail(`${label} must be a valid #RRGGBB hex color.`);
}

function verifyStorageHttpsUrlMatchesPath({
  rawUrl,
  storagePath,
  expectedPrefix,
  allowedExtRe = RASTER_EXT_RE,
  label = 'Media',
}) {
  const urlText = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!urlText || urlText.length > 2048 || /[\u0000-\u001f\u007f]/.test(urlText)) {
    fail(`${label} URL must be a valid HTTPS Firebase Storage URL.`);
  }
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    fail(`${label} URL is malformed.`);
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password) {
    fail(`${label} URL must use HTTPS on default port without credentials.`);
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (!ALLOWED_UPLOAD_HOSTS.has(host) && !ALLOWED_FIREBASESTORAGE_APP_RE.test(host)) {
    fail(`${label} URL must point to an approved Firebase or Cloud Storage host.`);
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    fail(`${label} URL contains malformed path encoding.`);
  }
  if (
    decodedPath.includes('..') ||
    decodedPath.includes('//') ||
    !allowedExtRe.test(decodedPath)
  ) {
    fail(`${label} URL must reference an allowed media file.`);
  }
  const marker = `/${expectedPrefix}/`;
  const idx = decodedPath.indexOf(marker);
  if (idx === -1 || decodedPath.slice(idx + 1) !== storagePath) {
    fail(`${label} URL path must match storagePath.`);
  }
  const bucketPattern = /^[a-z0-9._-]{3,63}$/;
  const isValidBucket = (bucket) =>
    bucketPattern.test(bucket) &&
    !bucket.includes('..') &&
    !bucket.startsWith('.') &&
    !bucket.endsWith('.');
  if (host === 'storage.googleapis.com') {
    const m = /^\/([^/]+)\/(.+)$/.exec(decodedPath);
    if (!m || !isValidBucket(m[1]) || m[2] !== storagePath) {
      fail(`${label} GCS URL bucket path must match storagePath.`);
    }
  } else {
    const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(decodedPath);
    if (!m || !isValidBucket(m[1]) || m[2] !== storagePath) {
      fail(`${label} Firebase Storage URL path must match storagePath.`);
    }
  }
  return urlText;
}

function slugifyClubId(rawName) {
  if (typeof rawName !== 'string') return 'club';
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/g, '');
  if (cleaned.length < 2 || FORBIDDEN_IDS.has(cleaned)) return 'club';
  return cleaned;
}

function normalizeClubModules(rawModules) {
  if (rawModules === undefined || rawModules === null) {
    return { ...DEFAULT_CLUB_MODULES };
  }
  if (typeof rawModules !== 'object' || Array.isArray(rawModules)) {
    fail('Club modules must be a configuration object.');
  }
  for (const key of Object.keys(rawModules)) {
    if (!CLUB_MODULE_SET.has(key)) {
      fail(`Unsupported club module: ${key}.`);
    }
    if (typeof rawModules[key] !== 'boolean') {
      fail(`Club module ${key} must be a boolean.`);
    }
  }
  const out = {};
  for (const key of CLUB_MODULES) {
    out[key] =
      key in rawModules ? rawModules[key] === true : DEFAULT_CLUB_MODULES[key] === true;
  }
  return out;
}

function validateClubAssetUrl(rawUrl, rawStoragePath, expectedClubId, assetKind = 'logo') {
  const urlText = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const pathText = typeof rawStoragePath === 'string' ? rawStoragePath.trim() : '';
  if (!urlText && !pathText) {
    return { url: '', storagePath: '' };
  }
  if (!ALLOWED_CLUB_ASSET_PATH_RE.test(pathText) || pathText.includes('..')) {
    fail(`${assetKind}StoragePath must match club-assets/{uid}/{clubId}/{rasterFile}.`);
  }
  const segments = pathText.split('/');
  if (segments.length !== 4 || segments[2] !== expectedClubId) {
    fail(`${assetKind}StoragePath must reference the target clubId segment.`);
  }
  const verifiedUrl = verifyStorageHttpsUrlMatchesPath({
    rawUrl: urlText,
    storagePath: pathText,
    expectedPrefix: 'club-assets',
    allowedExtRe: RASTER_EXT_RE,
    label: `Club ${assetKind}`,
  });
  return { url: verifiedUrl, storagePath: pathText };
}

function validateIdList(rawList, maxItems, label, itemRe = ENTITY_ID_RE) {
  if (rawList === undefined || rawList === null) return [];
  if (!Array.isArray(rawList)) {
    fail(`${label} must be an array of IDs.`);
  }
  if (rawList.length > maxItems) {
    fail(`${label} supports at most ${maxItems} entries.`);
  }
  const unique = [];
  const seen = new Set();
  for (const entry of rawList) {
    const id = assertValidEntityId(entry, `${label} item`, itemRe);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

function validateClubDefinitionInput(input, actorUid, nowIso = new Date().toISOString(), existingDoc = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Club payload must be an object.');
  }
  const actor = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const clubId = assertValidEntityId(input.clubId, 'clubId', CLUB_ID_RE);
  const name = assertSafeText(input.name, { label: 'Club name', min: 2, max: 80 });
  const description = assertSafeText(input.description, { label: 'Club description', min: 1, max: 500 });
  const city = assertSafeText(input.city, { label: 'Home city', min: 1, max: 80 });
  const scheduleSummary = assertSafeText(input.scheduleSummary ?? '', {
    label: 'Schedule summary',
    min: 0,
    max: 140,
  });

  const joinPolicy = typeof input.joinPolicy === 'string' ? input.joinPolicy.trim() : 'open';
  if (!CLUB_JOIN_POLICY_SET.has(joinPolicy)) {
    fail('Invalid club joinPolicy.');
  }

  const modules = normalizeClubModules(input.modules);
  const primaryColor = normalizeHexColor(input.primaryColor, 'Primary color', '#DC2626');
  const accentColor = normalizeHexColor(input.accentColor, 'Accent color', '#F59E0B');

  const logo = validateClubAssetUrl(input.logoUrl, input.logoStoragePath, clubId, 'logo');
  const cover = validateClubAssetUrl(input.coverUrl, input.coverStoragePath, clubId, 'cover');

  const uidRe = /^[a-zA-Z0-9_-]{1,128}$/;
  const captainUids = validateIdList(input.captainUids, MAX_CLUB_CAPTAINS, 'captainUids', uidRe);
  const linkedBadgeIds = validateIdList(input.linkedBadgeIds, MAX_CLUB_LINKED_BADGES, 'linkedBadgeIds');
  const featuredRouteIds = validateIdList(input.featuredRouteIds, MAX_CLUB_FEATURED_ROUTES, 'featuredRouteIds');
  const linkedRaceIds = validateIdList(input.linkedRaceIds, MAX_CLUB_LINKED_RACES, 'linkedRaceIds');

  let memberLimit = null;
  if (input.memberLimit !== undefined && input.memberLimit !== null && input.memberLimit !== '') {
    const n = Number(input.memberLimit);
    if (!Number.isInteger(n) || n < 2 || n > MAX_CLUB_MEMBERS_CAP) {
      fail(`memberLimit must be an integer between 2 and ${MAX_CLUB_MEMBERS_CAP}.`);
    }
    memberLimit = n;
  }

  const billingTier = typeof input.billingTier === 'string' ? input.billingTier.trim() : 'free';
  if (!CLUB_BILLING_TIER_SET.has(billingTier)) {
    fail('Invalid billingTier.');
  }
  const subscriptionStatus =
    typeof input.subscriptionStatus === 'string' ? input.subscriptionStatus.trim() : 'active';
  if (!CLUB_SUBSCRIPTION_STATUS_SET.has(subscriptionStatus)) {
    fail('Invalid subscriptionStatus.');
  }
  const billingProvider =
    typeof input.billingProvider === 'string' ? input.billingProvider.trim() : 'admin_manual';
  if (!CLUB_BILLING_PROVIDER_SET.has(billingProvider)) {
    fail('Invalid billingProvider.');
  }

  const paymongoCustomerId = assertSafeText(input.paymongoCustomerId ?? '', {
    label: 'paymongoCustomerId',
    min: 0,
    max: 128,
  });
  const paymongoSubscriptionId = assertSafeText(input.paymongoSubscriptionId ?? '', {
    label: 'paymongoSubscriptionId',
    min: 0,
    max: 128,
  });

  const status = typeof input.status === 'string' ? input.status.trim() : 'active';
  if (!CLUB_STATUS_SET.has(status)) {
    fail('Invalid club status.');
  }

  const memberCount =
    existingDoc && Number.isInteger(existingDoc.memberCount) && existingDoc.memberCount >= 0
      ? existingDoc.memberCount
      : 0;
  const requestCount =
    existingDoc && Number.isInteger(existingDoc.requestCount) && existingDoc.requestCount >= 0
      ? existingDoc.requestCount
      : 0;

  return {
    clubId,
    name,
    description,
    city,
    scheduleSummary,
    joinPolicy,
    modules,
    primaryColor,
    accentColor,
    logoUrl: logo.url,
    logoStoragePath: logo.storagePath,
    coverUrl: cover.url,
    coverStoragePath: cover.storagePath,
    captainUids,
    linkedBadgeIds,
    featuredRouteIds,
    linkedRaceIds,
    memberLimit,
    billingTier,
    subscriptionStatus,
    billingProvider,
    ...(paymongoCustomerId ? { paymongoCustomerId } : {}),
    ...(paymongoSubscriptionId ? { paymongoSubscriptionId } : {}),
    status,
    memberCount,
    requestCount,
    createdAt:
      existingDoc && typeof existingDoc.createdAt === 'string' && existingDoc.createdAt.trim()
        ? existingDoc.createdAt.trim()
        : nowParsed.iso,
    createdBy:
      existingDoc && typeof existingDoc.createdBy === 'string' && existingDoc.createdBy.trim()
        ? existingDoc.createdBy.trim()
        : actor,
    updatedAt: nowParsed.iso,
    updatedBy: actor,
  };
}

function validateClubMeetupInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Meetup payload must be an object.');
  }
  const actor = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const meetupId = assertValidEntityId(input.meetupId, 'meetupId');
  const clubId = assertValidEntityId(input.clubId, 'clubId', CLUB_ID_RE);
  const title = assertSafeText(input.title, { label: 'Meetup title', min: 2, max: 100 });
  const description = assertSafeText(input.description ?? '', {
    label: 'Meetup description',
    min: 0,
    max: 500,
  });
  const startAt = parseStrictIso(input.startAtIso, 'startAtIso');
  const locationName = assertSafeText(input.locationName, {
    label: 'Meetup location',
    min: 2,
    max: 120,
  });

  let lat = null;
  let lon = null;
  if (input.lat !== undefined && input.lat !== null && input.lon !== undefined && input.lon !== null) {
    const parsedLat = Number(input.lat);
    const parsedLon = Number(input.lon);
    if (
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLon) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLon < -180 ||
      parsedLon > 180
    ) {
      fail('Meetup coordinates must be valid latitude/longitude numbers.');
    }
    lat = parsedLat;
    lon = parsedLon;
  }

  const routeId =
    input.routeId !== undefined && input.routeId !== null && input.routeId !== ''
      ? assertValidEntityId(input.routeId, 'routeId')
      : null;
  const distanceLabel = assertSafeText(input.distanceLabel ?? '', {
    label: 'Distance label',
    min: 0,
    max: 32,
  });
  const status = typeof input.status === 'string' ? input.status.trim() : 'scheduled';
  if (!MEETUP_STATUSES.has(status)) {
    fail('Invalid meetup status.');
  }

  return {
    meetupId,
    clubId,
    title,
    description,
    startAtIso: startAt.iso,
    locationName,
    lat,
    lon,
    routeId,
    distanceLabel,
    status,
    createdAt: nowParsed.iso,
    createdBy: actor,
    updatedAt: nowParsed.iso,
  };
}

function validateClubAnnouncementInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Announcement payload must be an object.');
  }
  const actor = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const announcementId = assertValidEntityId(input.announcementId, 'announcementId');
  const clubId = assertValidEntityId(input.clubId, 'clubId', CLUB_ID_RE);
  const title = assertSafeText(input.title, { label: 'Announcement title', min: 2, max: 100 });
  const body = assertSafeText(input.body, { label: 'Announcement body', min: 1, max: 1000 });
  return {
    announcementId,
    clubId,
    title,
    body,
    pinned: Boolean(input.pinned),
    createdAt: nowParsed.iso,
    createdBy: actor,
    updatedAt: nowParsed.iso,
  };
}

function validateClubSpotlightInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Spotlight payload must be an object.');
  }
  const actor = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const clubId = assertValidEntityId(input.clubId, 'clubId', CLUB_ID_RE);
  const targetUid = assertSafeText(input.targetUid, { label: 'targetUid', min: 1, max: 128 });
  const headline = assertSafeText(input.headline, { label: 'Spotlight headline', min: 2, max: 120 });
  const note = assertSafeText(input.note ?? '', { label: 'Spotlight note', min: 0, max: 300 });
  return {
    clubId,
    targetUid,
    headline,
    note,
    featuredAt: nowParsed.iso,
    featuredBy: actor,
  };
}

function validateClubRequestInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Club request payload must be an object.');
  }
  const requesterUid = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const requestId = assertValidEntityId(input.requestId, 'requestId');
  const clubName = assertSafeText(input.clubName, { label: 'Club name', min: 2, max: 80 });
  const city = assertSafeText(input.city, { label: 'Home city', min: 2, max: 80 });
  const scheduleSummary = assertSafeText(input.scheduleSummary, {
    label: 'Meetup schedule',
    min: 2,
    max: 140,
  });
  const notes = assertSafeText(input.notes ?? '', { label: 'Request notes', min: 0, max: 500 });
  const contactHandle = assertSafeText(input.contactHandle ?? '', {
    label: 'Contact handle',
    min: 0,
    max: 80,
  });
  const desiredModules = normalizeClubModules(input.desiredModules);

  return {
    requestId,
    requesterUid,
    clubName,
    city,
    scheduleSummary,
    notes,
    contactHandle,
    desiredModules,
    status: 'pending',
    createdAt: nowParsed.iso,
    updatedAt: nowParsed.iso,
  };
}

function computeClubLeaderboard(members = [], runs = [], profilesByUid = {}, options = {}) {
  const sinceMs = options.sinceIso ? Date.parse(options.sinceIso) : null;
  const untilMs = options.untilIso ? Date.parse(options.untilIso) : null;

  const activeMembersByUid = new Map();
  for (const m of members) {
    if (!m || m.status !== 'active' || typeof m.uid !== 'string' || !m.uid.trim()) continue;
    activeMembersByUid.set(m.uid.trim(), m);
  }
  if (activeMembersByUid.size === 0) return [];

  const totals = new Map();
  for (const [uid, member] of activeMembersByUid.entries()) {
    const profile = profilesByUid[uid] || {};
    totals.set(uid, {
      uid,
      displayName: String(profile.displayName || member.displayName || 'Runner'),
      username: typeof profile.username === 'string' ? profile.username : undefined,
      role: member.role === 'captain' ? 'captain' : 'member',
      totalDistanceM: 0,
      totalMovingTimeMs: 0,
      totalElevationGainM: 0,
      verifiedRunsCount: 0,
    });
  }

  for (const run of runs) {
    if (!run || run.verificationStatus !== 'verified') continue;
    const uid = typeof run.uid === 'string' ? run.uid.trim() : '';
    const agg = totals.get(uid);
    if (!agg) continue;

    const tsMs = Date.parse(run.startedAt || run.finishedAt || run.createdAt || '');
    if (sinceMs !== null && Number.isFinite(sinceMs) && (!Number.isFinite(tsMs) || tsMs < sinceMs)) {
      continue;
    }
    if (untilMs !== null && Number.isFinite(untilMs) && (!Number.isFinite(tsMs) || tsMs > untilMs)) {
      continue;
    }

    const dist =
      typeof run.distanceM === 'number' && Number.isFinite(run.distanceM) && run.distanceM > 0
        ? Math.round(run.distanceM)
        : 0;
    const movingMs =
      typeof run.movingTimeMs === 'number' && Number.isFinite(run.movingTimeMs) && run.movingTimeMs > 0
        ? Math.round(run.movingTimeMs)
        : 0;
    const elev =
      typeof run.elevationGainM === 'number' && Number.isFinite(run.elevationGainM) && run.elevationGainM > 0
        ? Math.round(run.elevationGainM)
        : 0;

    agg.totalDistanceM += dist;
    agg.totalMovingTimeMs += movingMs;
    agg.totalElevationGainM += elev;
    agg.verifiedRunsCount += 1;
  }

  return Array.from(totals.values())
    .sort(
      (a, b) =>
        b.totalDistanceM - a.totalDistanceM ||
        b.verifiedRunsCount - a.verifiedRunsCount ||
        b.totalElevationGainM - a.totalElevationGainM ||
        a.uid.localeCompare(b.uid),
    )
    .slice(0, 100);
}

module.exports = {
  ALLOWED_CLUB_ASSET_PATH_RE,
  CLUB_BILLING_PROVIDERS,
  CLUB_BILLING_TIERS,
  CLUB_ID_RE,
  CLUB_JOIN_POLICIES,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODULES,
  CLUB_REQUEST_STATUSES,
  CLUB_STATUSES,
  CLUB_SUBSCRIPTION_STATUSES,
  DEFAULT_CLUB_MODULES,
  MAX_CLUB_CAPTAINS,
  MAX_CLUB_FEATURED_ROUTES,
  MAX_CLUB_LINKED_BADGES,
  MAX_CLUB_LINKED_RACES,
  MAX_CLUB_MEMBERS_CAP,
  assertSafeText,
  assertValidEntityId,
  computeClubLeaderboard,
  fail,
  normalizeClubModules,
  normalizeHexColor,
  parseStrictIso,
  slugifyClubId,
  validateClubAnnouncementInput,
  validateClubAssetUrl,
  validateClubDefinitionInput,
  validateClubMeetupInput,
  validateClubRequestInput,
  validateClubSpotlightInput,
  verifyStorageHttpsUrlMatchesPath,
};
