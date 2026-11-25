export type InboxConversationType = 'dm' | 'club';
export type InboxShareCardType = 'race' | 'run' | 'club' | 'badge';

export interface InboxShareCard {
  type: InboxShareCardType;
  targetId: string;
  title: string;
  subtitle?: string;
}

export interface InboxChatMedia {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface InboxConversationRecord {
  conversationId: string;
  type: InboxConversationType;
  members: string[];
  clubId?: string;
  clubName?: string;
  memberProfiles?: Record<string, { displayName: string; username?: string }>;
  status: 'active' | 'request_pending';
  requestedByUid?: string;
  requestedToUid?: string;
  lastMessageText: string;
  lastMessageAt: string;
  lastSenderUid: string;
  unreadByUid?: Record<string, number>;
  createdAt?: string;
  acceptedAt?: string;
  updatedAt: string;
}

export interface InboxMessageRecord {
  messageId: string;
  conversationId: string;
  senderUid: string;
  text: string;
  shareCard?: InboxShareCard;
  media?: InboxChatMedia;
  senderDisplayName?: string;
  hiddenByModeration?: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export interface FriendStreakRecord {
  id: string;
  members: string[];
  streakDays: number;
  graceRemaining: number;
  consecutiveActiveDays: number;
  lastCompletedDateKey: string | null;
  pendingDateKey: string | null;
  pendingSenderUids: string[];
  updatedAt: string;
}

export interface ActivityNotificationRecord {
  id: string;
  uid: string;
  kind: 'kudos' | 'comment' | 'repost' | 'badge' | 'club_approved' | 'meetup';
  actorUid?: string;
  actorName?: string;
  targetId?: string;
  summary: string;
  read: boolean;
  createdAt: string;
}

const VALID_DM_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_CLUB_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;

export function buildDmConversationId(uidA: string, uidB: string): string {
  const a = uidA.trim();
  const b = uidB.trim();
  if (!VALID_DM_UID_RE.test(a) || !VALID_DM_UID_RE.test(b) || a === b) {
    throw new Error('Direct messages require two distinct valid UIDs.');
  }
  const [first, second] = [a, b].sort();
  return `dm_${first}_${second}`;
}

export function buildClubConversationId(clubId: string): string {
  const id = clubId.trim();
  if (!VALID_CLUB_ID_RE.test(id)) {
    throw new Error('Invalid clubId for club conversation.');
  }
  return `club_${id}`;
}

export function formatChatStreakLabel(streakDays: number, graceRemaining: number): string {
  const days = Math.max(0, Math.floor(streakDays));
  const freezes = Math.max(0, Math.floor(graceRemaining));
  if (days <= 0) return 'Start streak';
  if (freezes > 0) {
    return `${days}d streak (${freezes} ${freezes === 1 ? 'freeze' : 'freezes'})`;
  }
  return `${days}d streak`;
}
