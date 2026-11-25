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
import type {
  ClubAnnouncementRecord,
  ClubBillingProvider,
  ClubBillingTier,
  ClubDefinition,
  ClubJoinPolicy,
  ClubLeaderboardEntry,
  ClubMeetupRecord,
  ClubMemberRecord,
  ClubModuleMap,
  ClubRequestRecord,
  ClubSpotlightRecord,
  ClubStatus,
  ClubSubscriptionStatus,
} from './types';

export const MAX_CLUB_ASSET_BYTES = 8 * 1024 * 1024;
const CLUB_UPLOAD_TIMEOUT_MS = 15_000;

export const ALLOWED_CLUB_ASSET_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
]);

export const ALLOWED_CLUB_ASSET_PATH_RE =
  /^club-assets\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{2,64}\/[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

const VALID_CLUB_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const VALID_ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
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

export type ClubAssetUploadValidationResult =
  | { ok: true; safeFilename: string; contentType: string }
  | { ok: false; error: string };

export interface ClubAssetFileLike {
  name?: string;
  type?: string;
  size?: number;
}

function assertValidClientId(value: unknown, regex: RegExp, label: string): string {
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

async function postClubApi<T>(
  path: `/${string}`,
  payload: Record<string, unknown>,
  label = 'Club command',
): Promise<T> {
  return (await postCommunityApiJson(path, payload, label)) as unknown as T;
}

function sanitizeClubFilename(rawName: string, extLower: string): string {
  const baseOnly = rawName.trim().split(/[/\\]/).pop() || '';
  const dotIdx = baseOnly.lastIndexOf('.');
  const rawStem = dotIdx > 0 ? baseOnly.slice(0, dotIdx) : baseOnly;
  let cleanStem = rawStem
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!cleanStem || !/^[a-zA-Z0-9_-]/.test(cleanStem)) {
    cleanStem = 'club_asset';
  }
  const maxStemLen = Math.max(1, 128 - (extLower.length + 1));
  return `${cleanStem.slice(0, maxStemLen)}.${extLower}`;
}

export function validateClubAssetUploadFile(
  file: ClubAssetFileLike | null | undefined,
): ClubAssetUploadValidationResult {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'Select an image file to upload.' };
  }
  const size = file.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Image file is empty.' };
  }
  if (size >= MAX_CLUB_ASSET_BYTES) {
    return { ok: false, error: 'Image file must be smaller than 8 MB.' };
  }

  const mime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (mime === 'image/svg+xml' || !ALLOWED_CLUB_ASSET_MIME_TYPES.has(mime)) {
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

  const safeFilename = sanitizeClubFilename(rawName, extLower);
  if (!STORAGE_FILENAME_RE.test(safeFilename) || safeFilename.includes('..')) {
    return { ok: false, error: 'Invalid image filename.' };
  }

  return { ok: true, safeFilename, contentType: mime };
}

export function buildClubAssetStoragePath(
  uid: string,
  clubId: string,
  filename: string,
): string {
  const safeUid = assertValidClientId(uid, VALID_UID_RE, 'uid');
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  const cleanName = typeof filename === 'string' ? filename.trim() : '';
  if (!STORAGE_FILENAME_RE.test(cleanName) || cleanName.includes('..')) {
    throw new CommunityRunApiError('Invalid club asset filename.', 400);
  }
  return `club-assets/${safeUid}/${safeClubId}/${cleanName}`;
}

export function isValidClubAssetStoragePath(
  storagePath: string | null | undefined,
  expectedClubId?: string,
): boolean {
  if (typeof storagePath !== 'string') return false;
  const trimmed = storagePath.trim();
  if (!ALLOWED_CLUB_ASSET_PATH_RE.test(trimmed) || trimmed.includes('..')) {
    return false;
  }
  const segments = trimmed.split('/');
  if (segments.length !== 4 || segments[3].startsWith('.')) return false;
  if (expectedClubId && segments[2] !== expectedClubId.trim()) return false;
  return true;
}

export function isSafeClubAssetUrl(
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
  const markerIdx = decodedPath.indexOf('/club-assets/');
  if (markerIdx === -1) return false;
  const embeddedPath = decodedPath.slice(markerIdx + 1);
  if (!isValidClubAssetStoragePath(embeddedPath)) return false;
  if (expectedStoragePath && embeddedPath !== expectedStoragePath.trim()) return false;
  const isValidBucket = (bucket: string) =>
    BUCKET_NAME_RE.test(bucket) &&
    !bucket.includes('..') &&
    !bucket.startsWith('.') &&
    !bucket.endsWith('.');
  if (host === 'storage.googleapis.com') {
    const gcsMatch = /^\/([^/]+)\/(club-assets\/.+)$/.exec(decodedPath);
    return Boolean(gcsMatch && isValidBucket(gcsMatch[1]));
  }
  const fbMatch = /^\/v0\/b\/([^/]+)\/o\/(club-assets\/.+)$/.exec(decodedPath);
  return Boolean(fbMatch && isValidBucket(fbMatch[1]));
}

export async function uploadClubAsset(
  uid: string,
  clubId: string,
  kind: 'logo' | 'cover',
  file: File,
): Promise<{ url: string; storagePath: string }> {
  const validation = validateClubAssetUploadFile(file);
  if (!validation.ok) {
    throw new CommunityRunApiError(validation.error, 400);
  }
  const ext = validation.safeFilename.split('.').pop()?.toLowerCase() || 'png';
  const stampedName = sanitizeClubFilename(
    `${kind}_${Date.now().toString(36)}_${validation.safeFilename}`,
    ext,
  );
  const storagePath = buildClubAssetStoragePath(uid, clubId, stampedName);
  const storageRef = ref(storage, storagePath);

  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const uploadPromise = uploadBytes(storageRef, file, {
      contentType: validation.contentType,
    });
    uploadPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new CommunityRunApiError(`Club ${kind} upload timed out. Please try again.`, 504));
      }, CLUB_UPLOAD_TIMEOUT_MS);
    });
    await Promise.race([uploadPromise, timeoutPromise]);
    const url = await getDownloadURL(storageRef);
    if (!isSafeClubAssetUrl(url, storagePath)) {
      throw new CommunityRunApiError(`Uploaded club ${kind} returned an unexpected URL.`, 502);
    }
    return { url, storagePath };
  } catch (err) {
    if (err instanceof CommunityRunApiError) throw err;
    const message =
      err instanceof Error && err.message ? err.message : `Unable to upload club ${kind}.`;
    throw new CommunityRunApiError(message, 500, { cause: err });
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }
}

export interface SaveClubDefinitionInput {
  requestId?: string;
  clubId: string;
  name: string;
  description: string;
  city: string;
  scheduleSummary: string;
  joinPolicy: ClubJoinPolicy;
  modules: ClubModuleMap;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  logoStoragePath: string;
  coverUrl: string;
  coverStoragePath: string;
  captainUids: string[];
  linkedBadgeIds: string[];
  featuredRouteIds: string[];
  linkedRaceIds: string[];
  memberLimit: number | null;
  billingTier: ClubBillingTier;
  subscriptionStatus: ClubSubscriptionStatus;
  billingProvider: ClubBillingProvider;
  paymongoCustomerId?: string;
  paymongoSubscriptionId?: string;
  status: ClubStatus;
}

export async function saveClubDefinition(
  input: SaveClubDefinitionInput,
): Promise<{ club: ClubDefinition }> {
  const requestId = resolveRequestId(input.requestId);
  return postClubApi<{ club: ClubDefinition }>(
    '/clubs/save',
    {
      ...input,
      requestId,
    },
    'Save club',
  );
}

export async function archiveClubDefinition(
  clubId: string,
  archived = true,
  requestId?: string,
): Promise<{ club: ClubDefinition }> {
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ club: ClubDefinition }>(
    '/clubs/archive',
    {
      requestId: resolveRequestId(requestId),
      clubId: safeClubId,
      archived,
      status: archived ? 'archived' : 'active',
    },
    'Archive club',
  );
}

export async function deleteClubDefinition(
  clubId: string,
  requestId?: string,
): Promise<{ deleted: true; clubId: string }> {
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ deleted: true; clubId: string }>(
    '/clubs/delete',
    {
      requestId: resolveRequestId(requestId),
      clubId: safeClubId,
    },
    'Delete club',
  );
}

export async function submitClubRequest(input: {
  requestId?: string;
  clubRequestId?: string;
  clubName: string;
  city: string;
  scheduleSummary: string;
  notes?: string;
  contactHandle?: string;
  desiredModules?: ClubModuleMap;
}): Promise<{ clubRequest: ClubRequestRecord }> {
  const reqId = resolveRequestId(input.requestId);
  return postClubApi<{ clubRequest: ClubRequestRecord }>(
    '/clubs/request',
    {
      ...input,
      requestId: reqId,
      clubRequestId: input.clubRequestId || reqId,
    },
    'Submit club request',
  );
}

export async function resolveClubRequest(input: {
  requestId?: string;
  clubRequestId: string;
  decision: 'approved' | 'rejected';
  reviewNote?: string;
  clubPayload?: SaveClubDefinitionInput;
}): Promise<{ clubRequest: ClubRequestRecord; club?: ClubDefinition }> {
  assertValidClientId(input.clubRequestId, VALID_ENTITY_ID_RE, 'clubRequestId');
  return postClubApi<{ clubRequest: ClubRequestRecord; club?: ClubDefinition }>(
    '/clubs/requests/resolve',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Resolve club request',
  );
}

export async function joinClub(
  clubId: string,
  requestId?: string,
): Promise<{ member: ClubMemberRecord }> {
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ member: ClubMemberRecord }>(
    '/clubs/join',
    {
      requestId: resolveRequestId(requestId),
      clubId: safeClubId,
    },
    'Join club',
  );
}

export async function leaveClub(
  clubId: string,
  requestId?: string,
): Promise<{ left: true; clubId: string }> {
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ left: true; clubId: string }>(
    '/clubs/leave',
    {
      requestId: resolveRequestId(requestId),
      clubId: safeClubId,
    },
    'Leave club',
  );
}

export async function setPrimaryClub(
  clubId: string | null,
  requestId?: string,
): Promise<{ primaryClubId: string | null; primaryClubName: string }> {
  const safeClubId =
    clubId === null || clubId === ''
      ? null
      : assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ primaryClubId: string | null; primaryClubName: string }>(
    '/clubs/primary',
    {
      requestId: resolveRequestId(requestId),
      clubId: safeClubId,
    },
    'Set primary club',
  );
}

export async function manageClubMember(input: {
  requestId?: string;
  clubId: string;
  targetUid: string;
  action: 'approve' | 'reject' | 'remove' | 'invite' | 'promote_captain' | 'demote_captain';
}): Promise<{
  clubId: string;
  action: string;
  member: ClubMemberRecord | null;
  memberCount: number;
  requestCount: number;
  captainUids: string[];
}> {
  const safeClubId = assertValidClientId(input.clubId, VALID_CLUB_ID_RE, 'clubId');
  const safeTargetUid = assertValidClientId(input.targetUid, VALID_UID_RE, 'targetUid');
  return postClubApi(
    '/clubs/member/manage',
    {
      ...input,
      clubId: safeClubId,
      targetUid: safeTargetUid,
      requestId: resolveRequestId(input.requestId),
    },
    'Manage club member',
  );
}

export async function saveClubMeetup(input: {
  requestId?: string;
  meetupId: string;
  clubId: string;
  title: string;
  description?: string;
  startAtIso: string;
  locationName: string;
  lat?: number | null;
  lon?: number | null;
  routeId?: string | null;
  distanceLabel?: string;
  status?: 'scheduled' | 'canceled';
}): Promise<{ meetup: ClubMeetupRecord }> {
  assertValidClientId(input.clubId, VALID_CLUB_ID_RE, 'clubId');
  assertValidClientId(input.meetupId, VALID_ENTITY_ID_RE, 'meetupId');
  return postClubApi<{ meetup: ClubMeetupRecord }>(
    '/clubs/meetup/save',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Save club meetup',
  );
}

export async function deleteClubMeetup(
  clubId: string,
  meetupId: string,
  requestId?: string,
): Promise<{ deleted: true; clubId: string; meetupId: string }> {
  assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  assertValidClientId(meetupId, VALID_ENTITY_ID_RE, 'meetupId');
  return postClubApi(
    '/clubs/meetup/delete',
    {
      requestId: resolveRequestId(requestId),
      clubId,
      meetupId,
    },
    'Delete club meetup',
  );
}

export async function saveClubAnnouncement(input: {
  requestId?: string;
  announcementId: string;
  clubId: string;
  title: string;
  body: string;
  pinned?: boolean;
}): Promise<{ announcement: ClubAnnouncementRecord }> {
  assertValidClientId(input.clubId, VALID_CLUB_ID_RE, 'clubId');
  assertValidClientId(input.announcementId, VALID_ENTITY_ID_RE, 'announcementId');
  return postClubApi<{ announcement: ClubAnnouncementRecord }>(
    '/clubs/announcement/save',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Save club announcement',
  );
}

export async function saveClubSpotlight(input: {
  requestId?: string;
  clubId: string;
  targetUid: string;
  headline: string;
  note?: string;
}): Promise<{ spotlight: ClubSpotlightRecord }> {
  assertValidClientId(input.clubId, VALID_CLUB_ID_RE, 'clubId');
  assertValidClientId(input.targetUid, VALID_UID_RE, 'targetUid');
  return postClubApi<{ spotlight: ClubSpotlightRecord }>(
    '/clubs/spotlight/save',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Save club spotlight',
  );
}

export async function fetchClubLeaderboard(
  clubId: string,
  window: '7d' | '30d' | 'all' = '30d',
): Promise<{ clubId: string; entries: ClubLeaderboardEntry[] }> {
  const safeClubId = assertValidClientId(clubId, VALID_CLUB_ID_RE, 'clubId');
  return postClubApi<{ clubId: string; entries: ClubLeaderboardEntry[] }>(
    '/clubs/leaderboard',
    { clubId: safeClubId, window },
    'Load club leaderboard',
  );
}

export function subscribeClubCatalog(
  callback: (res: { clubs: ClubDefinition[]; loaded: boolean; error: string | null }) => void,
  options: { includeArchived?: boolean } = {},
): () => void {
  const q = options.includeArchived
    ? query(collection(db, 'clubs'), orderBy('memberCount', 'desc'))
    : query(collection(db, 'clubs'), where('status', '==', 'active'), orderBy('memberCount', 'desc'));

  return onSnapshot(
    q,
    (snap) => {
      const clubs = snap.docs.map((d) => ({
        ...(d.data() as ClubDefinition),
        clubId: (d.data() as ClubDefinition).clubId || d.id,
      }));
      callback({ clubs, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeClubCatalog failed', err);
      callback({ clubs: [], loaded: true, error: 'Unable to load running clubs.' });
    },
  );
}

export function subscribeClubRequests(
  callback: (res: { requests: ClubRequestRecord[]; loaded: boolean; error: string | null }) => void,
  options: { requesterUid?: string } = {},
): () => void {
  const q = options.requesterUid
    ? query(collection(db, 'clubRequests'), where('requesterUid', '==', options.requesterUid))
    : query(collection(db, 'clubRequests'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs
        .map((d) => ({
          ...(d.data() as ClubRequestRecord),
          requestId: (d.data() as ClubRequestRecord).requestId || d.id,
        }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      callback({ requests, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeClubRequests failed', err);
      callback({ requests: [], loaded: true, error: 'Unable to load club requests.' });
    },
  );
}

export function subscribeClubMembers(
  clubId: string,
  callback: (res: { members: ClubMemberRecord[]; loaded: boolean; error: string | null }) => void,
  options: { includePending?: boolean } = {},
): () => void {
  if (!clubId) {
    callback({ members: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = options.includePending
    ? query(collection(db, 'clubMembers'), where('clubId', '==', clubId))
    : query(
        collection(db, 'clubMembers'),
        where('clubId', '==', clubId),
        where('status', '==', 'active'),
        orderBy('joinedAt', 'desc'),
      );

  return onSnapshot(
    q,
    (snap) => {
      const members = snap.docs
        .map((d) => ({
          ...(d.data() as ClubMemberRecord),
          id: (d.data() as ClubMemberRecord).id || d.id,
        }))
        .sort((a, b) => {
          if (a.status !== b.status) {
            if (a.status === 'pending') return -1;
            if (b.status === 'pending') return 1;
          }
          if (a.role !== b.role) return a.role === 'captain' ? -1 : 1;
          return String(b.joinedAt || '').localeCompare(String(a.joinedAt || ''));
        });
      callback({ members, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeClubMembers failed', err);
      callback({ members: [], loaded: true, error: 'Unable to load club roster.' });
    },
  );
}

export function subscribeMyClubMemberships(
  uid: string,
  callback: (res: { memberships: ClubMemberRecord[]; loaded: boolean; error: string | null }) => void,
): () => void {
  if (!uid) {
    callback({ memberships: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = query(collection(db, 'clubMembers'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const memberships = snap.docs.map((d) => ({
        ...(d.data() as ClubMemberRecord),
        id: (d.data() as ClubMemberRecord).id || d.id,
      }));
      callback({ memberships, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeMyClubMemberships failed', err);
      callback({ memberships: [], loaded: true, error: 'Unable to load your club memberships.' });
    },
  );
}

export function subscribeClubMeetups(
  clubId: string,
  callback: (res: { meetups: ClubMeetupRecord[]; loaded: boolean; error: string | null }) => void,
): () => void {
  if (!clubId) {
    callback({ meetups: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = query(
    collection(db, 'clubMeetups'),
    where('clubId', '==', clubId),
    where('status', '==', 'scheduled'),
    orderBy('startAtIso', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const meetups = snap.docs.map((d) => ({
        ...(d.data() as ClubMeetupRecord),
        meetupId: (d.data() as ClubMeetupRecord).meetupId || d.id,
      }));
      callback({ meetups, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeClubMeetups failed', err);
      callback({ meetups: [], loaded: true, error: 'Unable to load club meetups.' });
    },
  );
}

export function subscribeClubAnnouncements(
  clubId: string,
  callback: (res: {
    announcements: ClubAnnouncementRecord[];
    loaded: boolean;
    error: string | null;
  }) => void,
): () => void {
  if (!clubId) {
    callback({ announcements: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = query(
    collection(db, 'clubAnnouncements'),
    where('clubId', '==', clubId),
    orderBy('pinned', 'desc'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const announcements = snap.docs.map((d) => ({
        ...(d.data() as ClubAnnouncementRecord),
        announcementId: (d.data() as ClubAnnouncementRecord).announcementId || d.id,
      }));
      callback({ announcements, loaded: true, error: null });
    },
    (err) => {
      console.warn('[clubs/client] subscribeClubAnnouncements failed', err);
      callback({ announcements: [], loaded: true, error: 'Unable to load club announcements.' });
    },
  );
}

export function subscribeClubSpotlight(
  clubId: string,
  callback: (res: { spotlight: ClubSpotlightRecord | null; loaded: boolean }) => void,
): () => void {
  if (!clubId) {
    callback({ spotlight: null, loaded: true });
    return () => undefined;
  }
  return onSnapshot(
    doc(db, 'clubSpotlights', clubId),
    (snap) => {
      callback({
        spotlight: snap.exists() ? (snap.data() as ClubSpotlightRecord) : null,
        loaded: true,
      });
    },
    () => {
      callback({ spotlight: null, loaded: true });
    },
  );
}
