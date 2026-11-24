import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import {
  CommunityRunApiError,
  createCommunityRequestId,
  postCommunityApiJson,
} from '../runs/communityRunsClient';
import { computeLevelFromXp } from './presets';
import type {
  AthleteProgression,
  BadgeAnimationEffect,
  BadgeArtworkType,
  BadgeBorderStyle,
  BadgeCategory,
  BadgeDefinition,
  BadgeEmblemId,
  BadgeRuleConfig,
  BadgeStatus,
  BadgeTier,
  UserBadgeAward,
} from './types';

export const MAX_BADGE_ASSET_BYTES = 2 * 1024 * 1024;
const BADGE_UPLOAD_TIMEOUT_MS = 15_000;
const ACK_SEEN_BATCH_LIMIT = 20;

export const ALLOWED_BADGE_ASSET_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
]);

export const ALLOWED_BADGE_ASSET_PATH_RE =
  /^badge-assets\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9._-]{1,128}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

const VALID_BADGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const STORAGE_FILENAME_RE =
  /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;
const RASTER_EXT_MIME_MAP: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};
const ALLOWED_UPLOAD_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);
const ALLOWED_FIREBASESTORAGE_APP_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.firebasestorage\.app$/;
const BUCKET_NAME_RE = /^[a-z0-9._-]{3,63}$/;
const RASTER_URL_EXT_RE = /\.(png|jpg|jpeg|webp|avif)$/i;

export interface BadgeFileValidationSuccess {
  ok: true;
  safeFilename: string;
  contentType: string;
}

export interface BadgeFileValidationFailure {
  ok: false;
  error: string;
}

export type BadgeFileValidationResult =
  | BadgeFileValidationSuccess
  | BadgeFileValidationFailure;

export interface BadgeFileLike {
  name?: string;
  type?: string;
  size?: number;
}

function assertValidBadgeClientId(value: unknown, regex: RegExp, label: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!regex.test(id) || FORBIDDEN_IDS.has(id)) {
    throw new CommunityRunApiError(`Invalid ${label}.`, 400);
  }
  return id;
}

function resolveRequestId(raw?: string): string {
  const requestId = raw !== undefined ? raw.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(requestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }
  return requestId;
}

function sanitizeBadgeFilename(rawName: string, extLower: string): string {
  const baseOnly = rawName.trim().split(/[/\\]/).pop() || '';
  const dotIdx = baseOnly.lastIndexOf('.');
  const rawStem = dotIdx > 0 ? baseOnly.slice(0, dotIdx) : baseOnly;
  let cleanStem = rawStem
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!cleanStem || !/^[a-zA-Z0-9_-]/.test(cleanStem)) {
    cleanStem = 'badge_art';
  }
  const maxStemLen = Math.max(1, 128 - (extLower.length + 1));
  return `${cleanStem.slice(0, maxStemLen)}.${extLower}`;
}

export function validateBadgeAssetUploadFile(
  file: BadgeFileLike | null | undefined,
): BadgeFileValidationResult {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'Select an image file to upload.' };
  }

  const size = file.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Image file is empty.' };
  }
  if (size >= MAX_BADGE_ASSET_BYTES) {
    return { ok: false, error: 'Image file must be smaller than 2 MB.' };
  }

  const mime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (mime === 'image/svg+xml' || !ALLOWED_BADGE_ASSET_MIME_TYPES.has(mime)) {
    return {
      ok: false,
      error: 'Unsupported file type. Upload a PNG, JPEG, WebP, or AVIF raster image.',
    };
  }

  const rawName = typeof file.name === 'string' ? file.name.trim() : '';
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(rawName);
  const extLower = extMatch ? extMatch[1].toLowerCase() : '';
  const expectedMime = RASTER_EXT_MIME_MAP[extLower];
  if (!expectedMime || extLower === 'svg') {
    return {
      ok: false,
      error: 'Unsupported file extension. Use .png, .jpg, .jpeg, .webp, or .avif.',
    };
  }
  if (expectedMime !== mime) {
    return {
      ok: false,
      error: 'Image file extension does not match its content type.',
    };
  }

  const safeFilename = sanitizeBadgeFilename(rawName, extLower);
  if (!STORAGE_FILENAME_RE.test(safeFilename) || safeFilename.includes('..')) {
    return { ok: false, error: 'Invalid image filename.' };
  }

  return { ok: true, safeFilename, contentType: mime };
}

export function buildBadgeAssetStoragePath(
  uid: string,
  badgeId: string,
  filename: string,
): string {
  const safeUid = assertValidBadgeClientId(uid, VALID_UID_RE, 'uid');
  const safeBadgeId = assertValidBadgeClientId(badgeId, VALID_BADGE_ID_RE, 'badgeId');
  const cleanName = typeof filename === 'string' ? filename.trim() : '';
  if (!STORAGE_FILENAME_RE.test(cleanName) || cleanName.includes('..')) {
    throw new CommunityRunApiError('Invalid badge asset filename.', 400);
  }
  return `badge-assets/${safeUid}/${safeBadgeId}/${cleanName}`;
}

export function isValidBadgeAssetStoragePath(
  storagePath: string | null | undefined,
  expectedBadgeId?: string,
): boolean {
  if (typeof storagePath !== 'string') return false;
  const trimmed = storagePath.trim();
  if (!ALLOWED_BADGE_ASSET_PATH_RE.test(trimmed) || trimmed.includes('..')) {
    return false;
  }
  const segments = trimmed.split('/');
  if (segments.length !== 4 || segments[3].startsWith('.')) {
    return false;
  }
  if (expectedBadgeId && segments[2] !== expectedBadgeId.trim()) {
    return false;
  }
  return true;
}

function isValidStorageBucketName(bucket: string): boolean {
  return (
    BUCKET_NAME_RE.test(bucket) &&
    !bucket.includes('..') &&
    !bucket.startsWith('.') &&
    !bucket.endsWith('.')
  );
}

export function isSafeBadgeArtworkUrl(
  rawUrl: string | null | undefined,
  expectedStoragePath?: string,
): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_UPLOAD_HOSTS.has(host) && !ALLOWED_FIREBASESTORAGE_APP_RE.test(host)) {
    return false;
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  if (
    decodedPath.includes('..') ||
    decodedPath.includes('//') ||
    !RASTER_URL_EXT_RE.test(decodedPath)
  ) {
    return false;
  }
  const markerIdx = decodedPath.indexOf('/badge-assets/');
  if (markerIdx === -1) return false;
  const embeddedPath = decodedPath.slice(markerIdx + 1);
  if (!isValidBadgeAssetStoragePath(embeddedPath)) {
    return false;
  }
  if (expectedStoragePath && embeddedPath !== expectedStoragePath.trim()) {
    return false;
  }
  if (host === 'storage.googleapis.com') {
    const gcsMatch = /^\/([^/]+)\/(badge-assets\/.+)$/.exec(decodedPath);
    return Boolean(gcsMatch && isValidStorageBucketName(gcsMatch[1]));
  }
  const fbMatch = /^\/v0\/b\/([^/]+)\/o\/(badge-assets\/.+)$/.exec(decodedPath);
  return Boolean(fbMatch && isValidStorageBucketName(fbMatch[1]));
}

export async function uploadBadgeArtwork(
  uid: string,
  badgeId: string,
  file: File,
): Promise<{ artworkUrl: string; artworkStoragePath: string }> {
  const validation = validateBadgeAssetUploadFile(file);
  if (!validation.ok) {
    throw new CommunityRunApiError(validation.error, 400);
  }
  const stampedName = sanitizeBadgeFilename(
    `${Date.now().toString(36)}_${validation.safeFilename}`,
    validation.safeFilename.split('.').pop()?.toLowerCase() || 'png',
  );
  const artworkStoragePath = buildBadgeAssetStoragePath(uid, badgeId, stampedName);
  const storageRef = ref(storage, artworkStoragePath);

  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const uploadPromise = uploadBytes(storageRef, file, {
      contentType: validation.contentType,
    });
    // Prevent unhandled rejection warnings if Firebase Storage rejects after timeout wins.
    uploadPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new CommunityRunApiError('Badge artwork upload timed out. Please try again.', 504));
      }, BADGE_UPLOAD_TIMEOUT_MS);
    });
    await Promise.race([uploadPromise, timeoutPromise]);
    const artworkUrl = await getDownloadURL(storageRef);
    if (!isSafeBadgeArtworkUrl(artworkUrl, artworkStoragePath)) {
      throw new CommunityRunApiError('Uploaded badge artwork returned an unexpected URL.', 502);
    }
    return { artworkUrl, artworkStoragePath };
  } catch (err) {
    if (err instanceof CommunityRunApiError) throw err;
    const message =
      err instanceof Error && err.message ? err.message : 'Unable to upload badge artwork.';
    throw new CommunityRunApiError(message, 500, { cause: err });
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }
}

export interface BadgeCatalogSnapshot {
  badges: BadgeDefinition[];
  loaded: boolean;
  error: string | null;
}

export interface UserBadgesSnapshot {
  awards: UserBadgeAward[];
  loaded: boolean;
  error: string | null;
}

export interface AthleteProgressionSnapshot {
  progression: AthleteProgression;
  loaded: boolean;
  error: string | null;
}

export function createDefaultAthleteProgression(uid: string): AthleteProgression {
  const baseLevel = computeLevelFromXp(0);
  return {
    uid,
    ...baseLevel,
    badgesCount: 0,
    runStreakWeeks: 0,
    runStreakGraceRemaining: 0,
    inboxStreakDays: 0,
    updatedAt: '',
  };
}

function toNonNegInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function normalizeAthleteProgression(
  uid: string,
  raw: Partial<AthleteProgression> | null | undefined,
): AthleteProgression {
  if (!raw || typeof raw !== 'object') {
    return createDefaultAthleteProgression(uid);
  }
  const totalXp = toNonNegInt(raw.totalXp, 0);
  const levelInfo = computeLevelFromXp(totalXp);
  return {
    uid: typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid.trim() : uid,
    ...levelInfo,
    badgesCount: toNonNegInt(raw.badgesCount, 0),
    runStreakWeeks: toNonNegInt(raw.runStreakWeeks, 0),
    runStreakGraceRemaining: toNonNegInt(raw.runStreakGraceRemaining, 0),
    inboxStreakDays: toNonNegInt(raw.inboxStreakDays, 0),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function subscribeBadgeCatalog(
  callback: (snapshot: BadgeCatalogSnapshot) => void,
  options: { includeArchived?: boolean } = {},
): () => void {
  const includeArchived = options.includeArchived === true;
  const catalogQuery = includeArchived
    ? query(collection(db, 'badges'), orderBy('sortOrder', 'asc'))
    : query(
        collection(db, 'badges'),
        where('status', '==', 'active'),
        orderBy('sortOrder', 'asc'),
      );

  return onSnapshot(
    catalogQuery,
    (snapshot) => {
      const badges = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as BadgeDefinition;
          return {
            ...data,
            badgeId: data.badgeId || docSnap.id,
          };
        })
        .sort(
          (a, b) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
            a.badgeId.localeCompare(b.badgeId),
        );
      callback({ badges, loaded: true, error: null });
    },
    (error) => {
      console.warn('[badges/client] badge catalog subscription failed', error);
      callback({ badges: [], loaded: true, error: 'Unable to load badge catalog.' });
    },
  );
}

export function subscribeUserBadges(
  uid: string,
  callback: (snapshot: UserBadgesSnapshot) => void,
): () => void {
  if (!uid) {
    callback({ awards: [], loaded: true, error: null });
    return () => undefined;
  }

  const userBadgesQuery = query(
    collection(db, 'userBadges'),
    where('uid', '==', uid),
    orderBy('earnedAt', 'desc'),
  );

  return onSnapshot(
    userBadgesQuery,
    (snapshot) => {
      const awards = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as UserBadgeAward;
        return {
          ...data,
          id: data.id || docSnap.id,
        };
      });
      callback({ awards, loaded: true, error: null });
    },
    (error) => {
      console.warn('[badges/client] userBadges subscription failed', error);
      callback({ awards: [], loaded: true, error: 'Unable to load earned badges.' });
    },
  );
}

export function subscribeAthleteProgression(
  uid: string,
  callback: (snapshot: AthleteProgressionSnapshot) => void,
): () => void {
  if (!uid) {
    callback({
      progression: createDefaultAthleteProgression(''),
      loaded: true,
      error: null,
    });
    return () => undefined;
  }

  return onSnapshot(
    doc(db, 'athleteProgression', uid),
    (docSnap) => {
      const data = docSnap.exists()
        ? (docSnap.data() as Partial<AthleteProgression>)
        : null;
      callback({
        progression: normalizeAthleteProgression(uid, data),
        loaded: true,
        error: null,
      });
    },
    (error) => {
      console.warn('[badges/client] athleteProgression subscription failed', error);
      callback({
        progression: createDefaultAthleteProgression(uid),
        loaded: true,
        error: 'Unable to load athlete XP progression.',
      });
    },
  );
}

export interface SaveBadgeDefinitionInput {
  requestId?: string;
  badgeId: string;
  name: string;
  description: string;
  tier: BadgeTier;
  customTierLabel?: string;
  category: BadgeCategory;
  artworkType: BadgeArtworkType;
  emblemId?: BadgeEmblemId | '';
  artworkUrl?: string;
  artworkStoragePath?: string;
  borderStyle: BadgeBorderStyle;
  primaryColor: string;
  secondaryColor: string;
  animationEffect: BadgeAnimationEffect;
  xpReward: number;
  rule: BadgeRuleConfig;
  activeFrom?: string | null;
  activeUntil?: string | null;
  hiddenUntilEarned: boolean;
  status: BadgeStatus;
  sortOrder: number;
}

export async function saveBadgeDefinition(
  input: SaveBadgeDefinitionInput,
): Promise<BadgeDefinition> {
  const badgeId = assertValidBadgeClientId(input.badgeId, VALID_BADGE_ID_RE, 'badgeId');
  const requestId = resolveRequestId(input.requestId);
  const payload = {
    requestId,
    badgeId,
    name: input.name,
    description: input.description,
    tier: input.tier,
    customTierLabel: input.customTierLabel ?? '',
    category: input.category,
    artworkType: input.artworkType,
    emblemId: input.emblemId ?? '',
    artworkUrl: input.artworkUrl ?? '',
    artworkStoragePath: input.artworkStoragePath ?? '',
    borderStyle: input.borderStyle,
    primaryColor: input.primaryColor,
    secondaryColor: input.secondaryColor,
    animationEffect: input.animationEffect,
    xpReward: input.xpReward,
    rule: input.rule,
    activeFrom: input.activeFrom || null,
    activeUntil: input.activeUntil || null,
    hiddenUntilEarned: input.hiddenUntilEarned,
    status: input.status,
    sortOrder: input.sortOrder,
  };

  const result = await postCommunityApiJson('/badges/save', payload, 'Save badge');
  if (!result.badge || typeof result.badge !== 'object') {
    throw new CommunityRunApiError('Server did not return saved badge details.', 502, {
      retryable: true,
    });
  }
  return result.badge as BadgeDefinition;
}

export async function seedDefaultBadges(
  requestId?: string,
): Promise<{ seededCount: number; badgeIds: string[] }> {
  const resolvedRequestId = resolveRequestId(requestId);
  const result = await postCommunityApiJson(
    '/badges/seed-defaults',
    { requestId: resolvedRequestId },
    'Seed starter badges',
  );
  return {
    seededCount: typeof result.seededCount === 'number' ? result.seededCount : 0,
    badgeIds: Array.isArray(result.badgeIds) ? (result.badgeIds as string[]) : [],
  };
}

export async function archiveBadgeDefinition(
  badgeId: string,
  status: BadgeStatus,
  requestId?: string,
): Promise<BadgeDefinition> {
  const safeBadgeId = assertValidBadgeClientId(badgeId, VALID_BADGE_ID_RE, 'badgeId');
  const resolvedRequestId = resolveRequestId(requestId);
  const result = await postCommunityApiJson(
    '/badges/archive',
    { requestId: resolvedRequestId, badgeId: safeBadgeId, status },
    'Update badge status',
  );
  if (!result.badge || typeof result.badge !== 'object') {
    throw new CommunityRunApiError('Server did not return updated badge status.', 502, {
      retryable: true,
    });
  }
  return result.badge as BadgeDefinition;
}

export async function deleteBadgeDefinition(
  badgeId: string,
  requestId?: string,
): Promise<{ deleted: true; badgeId: string }> {
  const safeBadgeId = assertValidBadgeClientId(badgeId, VALID_BADGE_ID_RE, 'badgeId');
  const resolvedRequestId = resolveRequestId(requestId);
  await postCommunityApiJson(
    '/badges/delete',
    { requestId: resolvedRequestId, badgeId: safeBadgeId },
    'Delete badge',
  );
  return { deleted: true, badgeId: safeBadgeId };
}

export interface GrantBadgeInput {
  badgeId: string;
  targetUid: string;
  note?: string;
  requestId?: string;
}

export interface GrantBadgeResult {
  userBadge: UserBadgeAward;
  xpAwarded: number;
  progression: AthleteProgression;
}

export async function grantBadgeToRunner(input: GrantBadgeInput): Promise<GrantBadgeResult> {
  const badgeId = assertValidBadgeClientId(input.badgeId, VALID_BADGE_ID_RE, 'badgeId');
  const targetUid = assertValidBadgeClientId(input.targetUid, VALID_UID_RE, 'targetUid');
  const requestId = resolveRequestId(input.requestId);
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 200) {
    throw new CommunityRunApiError('Grant note must be 200 characters or fewer.', 400);
  }

  const result = await postCommunityApiJson(
    '/badges/grant',
    {
      requestId,
      badgeId,
      targetUid,
      ...(note ? { note } : {}),
    },
    'Grant badge',
  );
  if (!result.userBadge || typeof result.userBadge !== 'object') {
    throw new CommunityRunApiError('Server did not return the granted badge award.', 502, {
      retryable: true,
    });
  }
  return {
    userBadge: result.userBadge as UserBadgeAward,
    xpAwarded: typeof result.xpAwarded === 'number' ? result.xpAwarded : 0,
    progression: normalizeAthleteProgression(
      targetUid,
      result.progression as Partial<AthleteProgression> | undefined,
    ),
  };
}

export interface EvaluateRetroactiveInput {
  afterUid?: string | null;
  limit?: number;
  requestId?: string;
}

export interface EvaluateRetroactiveResult {
  processedUsers: number;
  newlyAwardedCount: number;
  nextAfterUid: string | null;
  hasMore: boolean;
}

export async function evaluateRetroactiveBadges(
  input: EvaluateRetroactiveInput = {},
): Promise<EvaluateRetroactiveResult> {
  const requestId = resolveRequestId(input.requestId);
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new CommunityRunApiError('Batch limit must be an integer between 1 and 50.', 400);
  }
  const afterUid =
    typeof input.afterUid === 'string' && input.afterUid.trim()
      ? assertValidBadgeClientId(input.afterUid, VALID_UID_RE, 'afterUid')
      : null;

  const result = await postCommunityApiJson(
    '/badges/evaluate-retroactive',
    {
      requestId,
      limit,
      ...(afterUid ? { afterUid } : {}),
    },
    'Evaluate retroactive badges',
  );

  return {
    processedUsers: typeof result.processedUsers === 'number' ? result.processedUsers : 0,
    newlyAwardedCount:
      typeof result.newlyAwardedCount === 'number' ? result.newlyAwardedCount : 0,
    nextAfterUid: typeof result.nextAfterUid === 'string' ? result.nextAfterUid : null,
    hasMore: Boolean(result.hasMore),
  };
}

export async function syncMyBadges(
  requestId?: string,
): Promise<{ newlyAwarded: UserBadgeAward[]; progression: AthleteProgression | null }> {
  const resolvedRequestId = resolveRequestId(requestId);
  const result = await postCommunityApiJson(
    '/badges/sync-my',
    { requestId: resolvedRequestId },
    'Sync my badges',
  );
  return {
    newlyAwarded: Array.isArray(result.newlyAwarded)
      ? (result.newlyAwarded as UserBadgeAward[])
      : [],
    progression:
      result.progression && typeof result.progression === 'object'
        ? (result.progression as AthleteProgression)
        : null,
  };
}

export async function acknowledgeSeenBadges(
  badgeIds: string[],
  requestId?: string,
): Promise<{ acknowledgedIds: string[] }> {
  if (!Array.isArray(badgeIds) || badgeIds.length === 0) {
    return { acknowledgedIds: [] };
  }
  const uniqueIds = Array.from(
    new Set(
      badgeIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => assertValidBadgeClientId(id, VALID_BADGE_ID_RE, 'badgeId')),
    ),
  );
  if (uniqueIds.length === 0) {
    return { acknowledgedIds: [] };
  }

  const acknowledgedIds: string[] = [];
  for (let i = 0; i < uniqueIds.length; i += ACK_SEEN_BATCH_LIMIT) {
    const chunk = uniqueIds.slice(i, i + ACK_SEEN_BATCH_LIMIT);
    const chunkReqId = i === 0 ? resolveRequestId(requestId) : createCommunityRequestId();
    const result = await postCommunityApiJson(
      '/badges/ack-seen',
      { requestId: chunkReqId, badgeIds: chunk },
      'Acknowledge seen badges',
    );
    if (Array.isArray(result.acknowledgedIds)) {
      for (const id of result.acknowledgedIds) {
        if (typeof id === 'string') acknowledgedIds.push(id);
      }
    }
  }
  return { acknowledgedIds };
}
