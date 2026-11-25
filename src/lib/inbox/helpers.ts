import type { ClubDefinition } from '../clubs/types';
import type { FriendProfile } from '../../types';
import type { InboxConversationRecord, InboxMessageRecord } from './types';

export interface PartitionedInboxConversations {
  activeChats: InboxConversationRecord[];
  incomingRequests: InboxConversationRecord[];
  outgoingRequests: InboxConversationRecord[];
}

export interface ConversationDisplayMeta {
  title: string;
  subtitle: string;
  peerUid: string | null;
}

export function mergeAndSortConversations(
  dmConversations: readonly InboxConversationRecord[],
  clubConversations: readonly InboxConversationRecord[],
): InboxConversationRecord[] {
  const byId = new Map<string, InboxConversationRecord>();
  for (const conv of dmConversations) {
    if (conv?.conversationId) byId.set(conv.conversationId, conv);
  }
  for (const conv of clubConversations) {
    if (conv?.conversationId) byId.set(conv.conversationId, conv);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aStamp = a.lastMessageAt || a.updatedAt || '';
    const bStamp = b.lastMessageAt || b.updatedAt || '';
    return bStamp.localeCompare(aStamp) || a.conversationId.localeCompare(b.conversationId);
  });
}

export function partitionInboxConversations(
  conversations: readonly InboxConversationRecord[],
  myUid: string,
): PartitionedInboxConversations {
  const activeChats: InboxConversationRecord[] = [];
  const incomingRequests: InboxConversationRecord[] = [];
  const outgoingRequests: InboxConversationRecord[] = [];

  for (const conv of conversations) {
    if (conv.status === 'request_pending') {
      if (conv.requestedByUid === myUid) {
        outgoingRequests.push(conv);
      } else {
        incomingRequests.push(conv);
      }
      continue;
    }
    activeChats.push(conv);
  }

  return { activeChats, incomingRequests, outgoingRequests };
}

export function computeTotalInboxUnread(input: {
  conversations: readonly InboxConversationRecord[];
  myUid: string;
  unreadNotificationsCount?: number;
  pendingFriendRequestsCount?: number;
  pendingRaceInvitesCount?: number;
  remindersCount?: number;
}): number {
  let unreadMsgs = 0;
  let pendingMsgReqs = 0;

  for (const conv of input.conversations) {
    if (conv.status === 'request_pending') {
      if (conv.requestedByUid !== input.myUid) {
        pendingMsgReqs += 1;
      }
      continue;
    }
    const raw = conv.unreadByUid?.[input.myUid];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      unreadMsgs += Math.floor(raw);
    }
  }

  return (
    unreadMsgs +
    pendingMsgReqs +
    Math.max(0, Math.floor(input.unreadNotificationsCount || 0)) +
    Math.max(0, Math.floor(input.pendingFriendRequestsCount || 0)) +
    Math.max(0, Math.floor(input.pendingRaceInvitesCount || 0)) +
    Math.max(0, Math.floor(input.remindersCount || 0))
  );
}

export function collectUnsignedChatMediaPaths(
  messages: readonly InboxMessageRecord[],
): string[] {
  const paths = new Set<string>();
  for (const msg of messages) {
    if (!msg || msg.deletedAt || msg.hiddenByModeration === true) continue;
    const path = msg.media?.storagePath?.trim();
    if (path) paths.add(path);
  }
  return Array.from(paths);
}

export function resolveConversationDisplayMeta(
  conv: InboxConversationRecord,
  myUid: string,
  friendsByUid: ReadonlyMap<string, FriendProfile>,
  clubsById: ReadonlyMap<string, ClubDefinition>,
): ConversationDisplayMeta {
  if (conv.type === 'club') {
    const clubId = conv.clubId || (conv.conversationId.startsWith('club_') ? conv.conversationId.slice(5) : '');
    const club = clubId ? clubsById.get(clubId) : undefined;
    return {
      title: club?.name || conv.clubName || clubId || 'Club Chat',
      subtitle: club?.city ? `${club.city} · Club Chat` : 'Club Chat',
      peerUid: null,
    };
  }

  const peerUid = (conv.members || []).find((m) => m !== myUid) || null;
  const friend = peerUid ? friendsByUid.get(peerUid) : undefined;
  const metaProfile = peerUid ? conv.memberProfiles?.[peerUid] : undefined;
  const title = friend?.nickname || friend?.displayName || metaProfile?.displayName || peerUid || 'Direct Message';
  const handle = friend?.username || metaProfile?.username;
  return {
    title,
    subtitle: handle ? `@${handle}` : 'Direct Message',
    peerUid,
  };
}
