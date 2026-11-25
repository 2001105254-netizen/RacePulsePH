import {
  collection,
  doc,
  getDoc,
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
import {
  validateSocialImageFile,
  validateSocialVideoMetadata,
} from './mediaValidation';
import type {
  CloseFriendEdgeRecord,
  ContentReportReason,
  ContentReportRecord,
  ContentReportStatus,
  ContentReportTargetType,
  PublicRunnerProfile,
  RouteSnapPin,
  SocialCommentRecord,
  SocialLocationPin,
  SocialMediaItem,
  SocialMediaType,
  SocialPostRecord,
  SocialVisibility,
  UserBlockRecord,
} from './types';

const MEDIA_SIGN_CLIENT_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 30_000;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;

const signedUrlCache = new Map<string, { url: string; expiresAtMs: number }>();

function resolveRequestId(raw?: string): string {
  const requestId = raw !== undefined ? raw.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(requestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }
  return requestId;
}

async function postSocialApi<T>(
  path: `/${string}`,
  payload: Record<string, unknown>,
  label = 'Social command',
): Promise<T> {
  return (await postCommunityApiJson(path, payload, label)) as unknown as T;
}

function sanitizeMediaFilename(rawName: string, fallbackExt: string): string {
  const baseOnly = rawName.trim().split(/[/\\]/).pop() || '';
  const dotIdx = baseOnly.lastIndexOf('.');
  const rawExt = dotIdx > 0 ? baseOnly.slice(dotIdx + 1).toLowerCase() : fallbackExt;
  const rawStem = dotIdx > 0 ? baseOnly.slice(0, dotIdx) : baseOnly;
  let cleanStem = rawStem
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!cleanStem || !/^[a-zA-Z0-9_-]/.test(cleanStem)) {
    cleanStem = 'media';
  }
  const stamp = Date.now().toString(36);
  const maxStemLen = Math.max(1, 110 - rawExt.length);
  return `${stamp}_${cleanStem.slice(0, maxStemLen)}.${rawExt}`;
}

export async function signMediaPaths(
  storagePaths: readonly string[],
): Promise<{ signedUrls: Record<string, string>; denied: string[] }> {
  const unique = Array.from(
    new Set(storagePaths.filter((p) => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())),
  );
  if (unique.length === 0) {
    return { signedUrls: {}, denied: [] };
  }

  const nowMs = Date.now();
  const cached: Record<string, string> = {};
  const toFetch: string[] = [];

  for (const path of unique) {
    const entry = signedUrlCache.get(path);
    if (entry && entry.expiresAtMs > nowMs) {
      cached[path] = entry.url;
    } else {
      toFetch.push(path);
    }
  }

  if (toFetch.length === 0) {
    return { signedUrls: cached, denied: [] };
  }

  const res = await postSocialApi<{
    signedUrls: Record<string, string>;
    expiresAt: string;
    denied: string[];
  }>('/media/sign', { storagePaths: toFetch.slice(0, 24) }, 'Sign media URLs');

  const serverExpiryMs = Date.parse(res.expiresAt);
  const clientExpiryMs = Number.isFinite(serverExpiryMs)
    ? Math.min(serverExpiryMs - 60_000, nowMs + MEDIA_SIGN_CLIENT_TTL_MS)
    : nowMs + MEDIA_SIGN_CLIENT_TTL_MS;

  for (const [path, url] of Object.entries(res.signedUrls || {})) {
    if (typeof url === 'string' && url) {
      signedUrlCache.set(path, { url, expiresAtMs: clientExpiryMs });
      cached[path] = url;
    }
  }
  return {
    signedUrls: cached,
    denied: Array.isArray(res.denied) ? res.denied : [],
  };
}

export async function uploadSocialMediaFile(
  uid: string,
  postId: string,
  file: File,
  visibility: SocialVisibility,
  options: { durationSec?: number; width?: number; height?: number } = {},
): Promise<SocialMediaItem> {
  const isVideo = (file.type || '').toLowerCase().startsWith('video/');
  if (isVideo) {
    const durationSec = Number(options.durationSec || 0);
    const check = validateSocialVideoMetadata({
      name: file.name,
      type: file.type,
      size: file.size,
      durationSec,
    });
    if (!check.ok) throw new CommunityRunApiError(check.error, 400);
    const storagePath = `social-media/${uid}/${postId}/${sanitizeMediaFilename(file.name, check.ext)}`;
    const storageRef = ref(storage, storagePath);
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      const uploadPromise = uploadBytes(storageRef, file, { contentType: check.mimeType });
      uploadPromise.catch(() => undefined);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new CommunityRunApiError('Video upload timed out.', 504));
        }, UPLOAD_TIMEOUT_MS);
      });
      await Promise.race([uploadPromise, timeoutPromise]);
      // Private Friends / Close Friends uploads rely on revocable signed URLs and never call getDownloadURL.
      const url = visibility === 'public' ? await getDownloadURL(storageRef) : '';
      return {
        storagePath,
        mimeType: check.mimeType,
        sizeBytes: file.size,
        url,
        durationSec: Math.round(durationSec * 10) / 10,
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
      };
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  const imgCheck = validateSocialImageFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!imgCheck.ok) throw new CommunityRunApiError(imgCheck.error, 400);

  const storagePath = `social-media/${uid}/${postId}/${sanitizeMediaFilename(file.name, imgCheck.ext)}`;
  const storageRef = ref(storage, storagePath);
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const uploadPromise = uploadBytes(storageRef, file, { contentType: imgCheck.mimeType });
    uploadPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new CommunityRunApiError('Photo upload timed out.', 504));
      }, UPLOAD_TIMEOUT_MS);
    });
    await Promise.race([uploadPromise, timeoutPromise]);
    const url = visibility === 'public' ? await getDownloadURL(storageRef) : '';
    return {
      storagePath,
      mimeType: imgCheck.mimeType,
      sizeBytes: file.size,
      url,
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
    };
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

export async function fetchSocialFeed(input: {
  mode: 'discover' | 'following';
  limit?: number;
  cursor?: string | null;
  authorUid?: string;
}): Promise<{ posts: SocialPostRecord[]; nextCursor: string | null }> {
  return postSocialApi(
    '/social/feed',
    {
      mode: input.mode,
      limit: input.limit ?? 15,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.authorUid ? { authorUid: input.authorUid } : {}),
    },
    'Load social feed',
  );
}

export async function fetchRouteSnaps(input: {
  scope?: 'all' | 'public' | 'friends' | 'close_friends';
  publicationId?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  limit?: number;
}): Promise<{ snaps: RouteSnapPin[] }> {
  return postSocialApi(
    '/social/snaps',
    {
      scope: input.scope || 'all',
      ...(input.publicationId ? { publicationId: input.publicationId } : {}),
      ...(input.bounds ? { bounds: input.bounds } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    },
    'Load route snaps',
  );
}

export async function createSocialPost(input: {
  requestId?: string;
  postId: string;
  visibility: SocialVisibility;
  text: string;
  mediaType: SocialMediaType;
  mediaItems: SocialMediaItem[];
  attachedBadgeId?: string | null;
  attachedClubId?: string | null;
  attachedRaceId?: string | null;
  attachedRunId?: string | null;
  location?: SocialLocationPin | null;
}): Promise<{ post: SocialPostRecord; routeSnap: RouteSnapPin | null }> {
  return postSocialApi(
    '/social/post/create',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Create post',
  );
}

export async function repostSocialPost(input: {
  requestId?: string;
  postId: string;
  sourcePostId: string;
  text?: string;
  visibility?: SocialVisibility;
}): Promise<{ post: SocialPostRecord }> {
  return postSocialApi(
    '/social/post/repost',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Repost update',
  );
}

export async function deleteSocialPost(
  postId: string,
  requestId?: string,
): Promise<{ deleted: true; postId: string }> {
  return postSocialApi(
    '/social/post/delete',
    {
      requestId: resolveRequestId(requestId),
      postId,
    },
    'Delete post',
  );
}

export async function togglePostKudos(
  postId: string,
  requestId?: string,
): Promise<{ postId: string; liked: boolean; kudosCount: number }> {
  return postSocialApi(
    '/social/post/kudos',
    {
      requestId: resolveRequestId(requestId),
      postId,
    },
    'Toggle kudos',
  );
}

export async function createPostComment(input: {
  requestId?: string;
  commentId: string;
  postId: string;
  text: string;
  replyToCommentId?: string | null;
}): Promise<{ comment: SocialCommentRecord; commentsCount: number }> {
  return postSocialApi(
    '/social/post/comment',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Post comment',
  );
}

export async function fetchPostComments(
  postId: string,
  limit = 50,
): Promise<{ comments: SocialCommentRecord[] }> {
  return postSocialApi(
    '/social/post/comments',
    { postId, limit },
    'Load comments',
  );
}

export function subscribeMySocialKudos(
  uid: string,
  callback: (postIds: Set<string>) => void,
): () => void {
  if (!uid) {
    callback(new Set());
    return () => undefined;
  }
  const q = query(collection(db, 'socialKudos'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const ids = new Set<string>();
      snap.forEach((d) => {
        const postId = (d.data() as { postId?: string })?.postId;
        if (typeof postId === 'string' && postId) ids.add(postId);
      });
      callback(ids);
    },
    (err) => {
      console.warn('[social/client] subscribeMySocialKudos failed', err);
      callback(new Set());
    },
  );
}

export function subscribeCloseFriendEdges(
  ownerUid: string,
  callback: (res: { targetUids: Set<string>; loaded: boolean }) => void,
): () => void {
  if (!ownerUid) {
    callback({ targetUids: new Set(), loaded: true });
    return () => undefined;
  }
  const q = query(collection(db, 'closeFriendEdges'), where('ownerUid', '==', ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      const targetUids = new Set<string>();
      snap.forEach((d) => {
        const edge = d.data() as CloseFriendEdgeRecord;
        if (typeof edge?.targetUid === 'string' && edge.targetUid) {
          targetUids.add(edge.targetUid);
        }
      });
      callback({ targetUids, loaded: true });
    },
    (err) => {
      console.warn('[social/client] subscribeCloseFriendEdges failed', err);
      callback({ targetUids: new Set(), loaded: true });
    },
  );
}

export function subscribeUserBlocks(
  blockerUid: string,
  callback: (res: { blocks: UserBlockRecord[]; loaded: boolean }) => void,
): () => void {
  if (!blockerUid) {
    callback({ blocks: [], loaded: true });
    return () => undefined;
  }
  const q = query(collection(db, 'userBlocks'), where('blockerUid', '==', blockerUid));
  return onSnapshot(
    q,
    (snap) => {
      const blocks: UserBlockRecord[] = snap.docs
        .map((d) => {
          const raw = d.data() as UserBlockRecord;
          return {
            id: raw.id || d.id,
            blockerUid: raw.blockerUid || blockerUid,
            blockedUid: raw.blockedUid,
            createdAt: raw.createdAt || '',
          };
        })
        .filter((b) => typeof b.blockedUid === 'string' && b.blockedUid.length > 0);
      callback({ blocks, loaded: true });
    },
    (err) => {
      console.warn('[social/client] subscribeUserBlocks failed', err);
      callback({ blocks: [], loaded: true });
    },
  );
}

export async function loadPublicRunnerProfile(
  targetUid: string,
): Promise<PublicRunnerProfile | null> {
  const clean = targetUid.trim();
  if (!clean) return null;
  const snap = await getDoc(doc(db, 'publicProfiles', clean));
  if (!snap.exists()) return null;
  return snap.data() as PublicRunnerProfile;
}

export async function toggleCloseFriend(
  targetUid: string,
  enabled?: boolean,
  requestId?: string,
): Promise<{ targetUid: string; enabled: boolean }> {
  return postSocialApi(
    '/social/close-friends/toggle',
    {
      requestId: resolveRequestId(requestId),
      targetUid,
      ...(enabled !== undefined ? { enabled } : {}),
    },
    'Update close friends',
  );
}

export async function toggleUserBlock(
  targetUid: string,
  blocked?: boolean,
  requestId?: string,
): Promise<{ targetUid: string; blocked: boolean }> {
  return postSocialApi(
    '/social/block/toggle',
    {
      requestId: resolveRequestId(requestId),
      targetUid,
      ...(blocked !== undefined ? { blocked } : {}),
    },
    'Update block list',
  );
}

export async function submitContentReport(input: {
  requestId?: string;
  reportId: string;
  targetType: ContentReportTargetType;
  targetId: string;
  targetParentId?: string;
  targetUid?: string;
  reason: ContentReportReason;
  details?: string;
}): Promise<{ report: ContentReportRecord }> {
  return postSocialApi(
    '/social/report/create',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Submit report',
  );
}

export async function resolveContentReport(input: {
  requestId?: string;
  reportId: string;
  action: 'dismiss' | 'hide_content' | 'delete_content';
  resolutionNote?: string;
}): Promise<{ report: ContentReportRecord }> {
  return postSocialApi(
    '/moderation/reports/resolve',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Resolve report',
  );
}

export function subscribeContentReports(
  callback: (res: {
    reports: ContentReportRecord[];
    loaded: boolean;
    error: string | null;
  }) => void,
  options: { status?: ContentReportStatus } = {},
): () => void {
  const q = options.status
    ? query(
        collection(db, 'contentReports'),
        where('status', '==', options.status),
        orderBy('createdAt', 'desc'),
      )
    : query(collection(db, 'contentReports'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snap) => {
      const reports = snap.docs.map((d) => ({
        ...(d.data() as ContentReportRecord),
        reportId: (d.data() as ContentReportRecord).reportId || d.id,
      }));
      callback({ reports, loaded: true, error: null });
    },
    (err) => {
      console.warn('[social/client] subscribeContentReports failed', err);
      callback({
        reports: [],
        loaded: true,
        error: 'Unable to load moderation report queue.',
      });
    },
  );
}
