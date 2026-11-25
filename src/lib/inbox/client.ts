import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../firebase';
import {
  CommunityRunApiError,
  createCommunityRequestId,
  postCommunityApiJson,
} from '../runs/communityRunsClient';
import {
  buildClubConversationId,
  type ActivityNotificationRecord,
  type FriendStreakRecord,
  type InboxChatMedia,
  type InboxConversationRecord,
  type InboxMessageRecord,
  type InboxShareCard,
} from './types';

export const MAX_CHAT_MEDIA_BYTES = 8 * 1024 * 1024;
const CHAT_UPLOAD_TIMEOUT_MS = 15_000;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const VALID_CONVERSATION_ID_RE =
  /^(dm_[a-zA-Z0-9_-]{1,128}_[a-zA-Z0-9_-]{1,128}|club_[a-zA-Z0-9_-]{2,64})$/;
const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const CHAT_STORAGE_FILENAME_RE =
  /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

const ALLOWED_CHAT_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
]);

const CHAT_EXT_MIME_MAP: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

export type ChatMediaValidationResult =
  | { ok: true; safeFilename: string; contentType: string }
  | { ok: false; error: string };

export interface ChatMediaFileLike {
  name?: string;
  type?: string;
  size?: number;
}

function resolveRequestId(raw?: string): string {
  const requestId = raw !== undefined ? raw.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(requestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }
  return requestId;
}

async function postInboxApi<T>(
  path: `/${string}`,
  payload: Record<string, unknown>,
  label = 'Inbox command',
): Promise<T> {
  return (await postCommunityApiJson(path, payload, label)) as unknown as T;
}

function sanitizeChatFilename(rawName: string, extLower: string): string {
  const baseOnly = rawName.trim().split(/[/\\]/).pop() || '';
  const dotIdx = baseOnly.lastIndexOf('.');
  const rawStem = dotIdx > 0 ? baseOnly.slice(0, dotIdx) : baseOnly;
  let cleanStem = rawStem
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!cleanStem || !/^[a-zA-Z0-9_-]/.test(cleanStem)) {
    cleanStem = 'chat_img';
  }
  const maxStemLen = Math.max(1, 120 - (extLower.length + 1));
  return `${cleanStem.slice(0, maxStemLen)}.${extLower}`;
}

export function validateChatMediaUploadFile(
  file: ChatMediaFileLike | null | undefined,
): ChatMediaValidationResult {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'Select an image file to send.' };
  }
  const size = file.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Image file is empty.' };
  }
  if (size >= MAX_CHAT_MEDIA_BYTES) {
    return { ok: false, error: 'Chat images must be smaller than 8 MB.' };
  }

  const mime = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (mime === 'image/svg+xml' || !ALLOWED_CHAT_IMAGE_MIME_TYPES.has(mime)) {
    return {
      ok: false,
      error: 'Upload PNG, JPEG, WebP, or AVIF raster images only (SVG is not allowed).',
    };
  }

  const rawName = typeof file.name === 'string' ? file.name.trim() : '';
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(rawName);
  const extLower = extMatch ? extMatch[1].toLowerCase() : '';
  const expectedMime = CHAT_EXT_MIME_MAP[extLower];
  if (!expectedMime || extLower === 'svg') {
    return { ok: false, error: 'Use a .png, .jpg, .jpeg, .webp, or .avif image.' };
  }
  if (expectedMime !== mime) {
    return { ok: false, error: 'Image extension does not match its content type.' };
  }

  const safeFilename = sanitizeChatFilename(rawName, extLower);
  if (!CHAT_STORAGE_FILENAME_RE.test(safeFilename) || safeFilename.includes('..')) {
    return { ok: false, error: 'Invalid chat image filename.' };
  }
  return { ok: true, safeFilename, contentType: mime };
}

export function buildChatMediaStoragePath(
  conversationId: string,
  uid: string,
  filename: string,
): string {
  const safeConv = conversationId.trim();
  const safeUid = uid.trim();
  const cleanName = filename.trim();
  if (!VALID_CONVERSATION_ID_RE.test(safeConv)) {
    throw new CommunityRunApiError('Invalid conversationId.', 400);
  }
  if (!VALID_UID_RE.test(safeUid)) {
    throw new CommunityRunApiError('Invalid uid.', 400);
  }
  if (!CHAT_STORAGE_FILENAME_RE.test(cleanName) || cleanName.includes('..')) {
    throw new CommunityRunApiError('Invalid chat media filename.', 400);
  }
  return `chat-media/${safeConv}/${safeUid}/${cleanName}`;
}

// Chat media stays strictly private: uploadBytes only (never getDownloadURL).
export async function uploadChatMediaImage(
  conversationId: string,
  uid: string,
  file: File,
): Promise<InboxChatMedia> {
  const validation = validateChatMediaUploadFile(file);
  if (!validation.ok) {
    throw new CommunityRunApiError(validation.error, 400);
  }
  const ext = validation.safeFilename.split('.').pop()?.toLowerCase() || 'png';
  const stampedName = sanitizeChatFilename(
    `${Date.now().toString(36)}_${validation.safeFilename}`,
    ext,
  );
  const storagePath = buildChatMediaStoragePath(conversationId, uid, stampedName);
  const storageRef = ref(storage, storagePath);

  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const uploadPromise = uploadBytes(storageRef, file, {
      contentType: validation.contentType,
    });
    uploadPromise.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new CommunityRunApiError('Chat image upload timed out.', 504));
      }, CHAT_UPLOAD_TIMEOUT_MS);
    });
    await Promise.race([uploadPromise, timeoutPromise]);
    return {
      storagePath,
      mimeType: validation.contentType,
      sizeBytes: file.size,
    };
  } catch (err) {
    if (err instanceof CommunityRunApiError) throw err;
    throw new CommunityRunApiError(
      err instanceof Error && err.message ? err.message : 'Unable to upload chat image.',
      500,
      { cause: err },
    );
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

export async function startDmConversation(
  targetUid: string,
  requestId?: string,
): Promise<{ conversation: InboxConversationRecord }> {
  return postInboxApi(
    '/inbox/dm/start',
    { targetUid: targetUid.trim(), requestId: resolveRequestId(requestId) },
    'Start direct message',
  );
}

export async function respondMessageRequest(
  conversationId: string,
  decision: 'accept' | 'decline',
  requestId?: string,
): Promise<{ conversation?: InboxConversationRecord; declined?: true; conversationId?: string }> {
  return postInboxApi(
    '/inbox/request/respond',
    { conversationId: conversationId.trim(), decision, requestId: resolveRequestId(requestId) },
    'Respond to message request',
  );
}

export async function sendInboxMessage(input: {
  requestId?: string;
  conversationId: string;
  messageId: string;
  text?: string;
  shareCard?: InboxShareCard;
  media?: InboxChatMedia;
}): Promise<{
  message: InboxMessageRecord;
  conversation: InboxConversationRecord;
  streak?: FriendStreakRecord;
}> {
  return postInboxApi(
    '/inbox/message/send',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Send message',
  );
}

export async function moderateInboxMessage(
  conversationId: string,
  messageId: string,
  requestId?: string,
): Promise<{ moderated: true; conversationId: string; messageId: string }> {
  return postInboxApi(
    '/inbox/message/moderate',
    {
      conversationId: conversationId.trim(),
      messageId: messageId.trim(),
      requestId: resolveRequestId(requestId),
    },
    'Delete message',
  );
}

export async function markInboxRead(input: {
  requestId?: string;
  conversationId?: string;
  notificationIds?: string[];
  markAllNotifications?: boolean;
}): Promise<{ read: true; conversationId: string | null; markedNotifications: number }> {
  return postInboxApi(
    '/inbox/read',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Mark read',
  );
}

export async function savePushToken(input: {
  requestId?: string;
  tokenId: string;
  token: string;
  platform: 'android' | 'web' | 'ios';
}): Promise<{ pushToken: { id: string; uid: string; token: string; platform: string; updatedAt: string } }> {
  return postInboxApi(
    '/inbox/push-token/save',
    {
      ...input,
      requestId: resolveRequestId(input.requestId),
    },
    'Save push token',
  );
}

export function isFirestoreMissingIndexError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err && typeof err.code === 'string' ? err.code.toLowerCase() : '';
  if (code === 'failed-precondition') return true;
  const message =
    'message' in err && typeof err.message === 'string' ? err.message : '';
  return /requires an index/i.test(message);
}

export function sortConversationsDesc(
  conversations: readonly InboxConversationRecord[],
): InboxConversationRecord[] {
  return [...conversations].sort((a, b) => {
    const aStamp = a.updatedAt || a.lastMessageAt || a.createdAt || '';
    const bStamp = b.updatedAt || b.lastMessageAt || b.createdAt || '';
    return bStamp.localeCompare(aStamp);
  });
}

export function sortActivityNotificationsDesc(
  notifications: readonly ActivityNotificationRecord[],
): ActivityNotificationRecord[] {
  return [...notifications].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  );
}

export function subscribeDmConversations(
  uid: string,
  callback: (res: { conversations: InboxConversationRecord[]; loaded: boolean; error: string | null }) => void,
): () => void {
  if (!uid) {
    callback({ conversations: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = query(
    collection(db, 'conversations'),
    where('members', 'array-contains', uid),
  );
  return onSnapshot(
    q,
    (snap) => {
      const conversations = sortConversationsDesc(
        snap.docs.map((d) => ({
          ...(d.data() as InboxConversationRecord),
          conversationId: (d.data() as InboxConversationRecord).conversationId || d.id,
        })),
      );
      callback({ conversations, loaded: true, error: null });
    },
    (err) => {
      console.warn('[inbox/client] subscribeDmConversations failed', err);
      const code =
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : '';
      callback({
        conversations: [],
        loaded: true,
        error:
          code === 'permission-denied'
            ? 'Direct messages are blocked by permissions right now.'
            : 'Unable to load direct messages.',
      });
    },
  );
}

export function subscribeClubConversations(
  clubIds: readonly string[],
  callback: (conversations: InboxConversationRecord[]) => void,
): () => void {
  const uniqueClubIds = Array.from(new Set(clubIds.map((c) => c.trim()).filter(Boolean))).sort();
  if (uniqueClubIds.length === 0) {
    callback([]);
    return () => undefined;
  }

  const map = new Map<string, InboxConversationRecord>();
  const unsubs = uniqueClubIds.map((clubId) => {
    const convId = buildClubConversationId(clubId);
    return onSnapshot(
      doc(db, 'conversations', convId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as InboxConversationRecord;
          map.set(convId, { ...data, conversationId: data.conversationId || convId });
        } else {
          map.delete(convId);
        }
        callback(Array.from(map.values()));
      },
      (err) => {
        console.warn('[inbox/client] subscribeClubConversation failed', clubId, err);
      },
    );
  });

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export function subscribeConversationMessages(
  conversationId: string,
  callback: (res: { messages: InboxMessageRecord[]; loaded: boolean; error: string | null }) => void,
  limitCount = 100,
): () => void {
  if (!conversationId) {
    callback({ messages: [], loaded: true, error: null });
    return () => undefined;
  }
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(limitCount),
  );
  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs.map((d) => ({
        ...(d.data() as InboxMessageRecord),
        messageId: (d.data() as InboxMessageRecord).messageId || d.id,
      }));
      callback({ messages, loaded: true, error: null });
    },
    (err) => {
      console.warn('[inbox/client] subscribeConversationMessages failed', err);
      callback({ messages: [], loaded: true, error: 'Unable to load chat messages.' });
    },
  );
}

export function subscribeFriendStreaks(
  uid: string,
  callback: (streaks: FriendStreakRecord[]) => void,
): () => void {
  if (!uid) {
    callback([]);
    return () => undefined;
  }
  const q = query(collection(db, 'friendStreaks'), where('members', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const streaks = snap.docs.map((d) => ({
        ...(d.data() as FriendStreakRecord),
        id: (d.data() as FriendStreakRecord).id || d.id,
      }));
      callback(streaks);
    },
    (err) => {
      console.warn('[inbox/client] subscribeFriendStreaks failed', err);
      callback([]);
    },
  );
}

export function subscribeActivityNotifications(
  uid: string,
  callback: (res: {
    notifications: ActivityNotificationRecord[];
    loaded: boolean;
    error: string | null;
  }) => void,
  limitCount = 50,
): () => void {
  if (!uid) {
    callback({ notifications: [], loaded: true, error: null });
    return () => undefined;
  }

  let disposed = false;
  let fellBack = false;
  let activeUnsub: () => void = () => undefined;

  const mapSnapshot = (snap: { docs: Array<{ id: string; data: () => unknown }> }) =>
    sortActivityNotificationsDesc(
      snap.docs.map((d) => {
        const data = d.data() as ActivityNotificationRecord;
        return {
          ...data,
          id: data.id || d.id,
        };
      }),
    );

  const subscribeFallback = () => {
    const fallbackQuery = query(
      collection(db, 'activityNotifications'),
      where('uid', '==', uid),
      limit(limitCount),
    );
    activeUnsub = onSnapshot(
      fallbackQuery,
      (snap) => {
        if (disposed) return;
        callback({ notifications: mapSnapshot(snap), loaded: true, error: null });
      },
      (err) => {
        if (disposed) return;
        console.warn('[inbox/client] subscribeActivityNotifications fallback failed', err);
        callback({ notifications: [], loaded: true, error: 'Unable to load activity notifications.' });
      },
    );
  };

  const indexedQuery = query(
    collection(db, 'activityNotifications'),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  );

  activeUnsub = onSnapshot(
    indexedQuery,
    (snap) => {
      if (disposed) return;
      callback({ notifications: mapSnapshot(snap), loaded: true, error: null });
    },
    (err) => {
      if (disposed) return;
      if (!fellBack && isFirestoreMissingIndexError(err)) {
        fellBack = true;
        activeUnsub();
        subscribeFallback();
        return;
      }
      console.warn('[inbox/client] subscribeActivityNotifications failed', err);
      callback({ notifications: [], loaded: true, error: 'Unable to load activity notifications.' });
    },
  );

  return () => {
    disposed = true;
    activeUnsub();
  };
}
