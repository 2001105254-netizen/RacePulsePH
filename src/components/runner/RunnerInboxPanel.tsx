import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  Flame,
  Inbox as InboxIcon,
  MessageCircle,
  MessageSquarePlus,
  PackageCheck,
  Search,
  Trophy,
  UserCheck,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import type { BadgeDefinition, UserBadgeAward } from '../../lib/badges/types';
import { subscribeClubCatalog, subscribeMyClubMemberships } from '../../lib/clubs/client';
import {
  E2E_CLUB_MEMBERS_KEY,
  E2E_CLUBS_KEY,
  E2E_CONVERSATIONS_KEY,
  E2E_INBOX_MESSAGES_KEY,
  E2E_NOTIFICATIONS_KEY,
  E2E_STREAKS_KEY,
  buildDevStarterClubs,
  buildDevStarterInboxData,
  markDevInboxReadFixture,
  readDevSessionJson,
  startDevDmFixture,
  writeDevSessionJson,
} from '../../lib/clubs/e2eFixtures';
import type { ClubDefinition, ClubMemberRecord } from '../../lib/clubs/types';
import {
  markInboxRead,
  startDmConversation,
  subscribeActivityNotifications,
  subscribeClubConversations,
  subscribeDmConversations,
  subscribeFriendStreaks,
} from '../../lib/inbox/client';
import {
  computeTotalInboxUnread,
  mergeAndSortConversations,
  partitionInboxConversations,
  resolveConversationDisplayMeta,
} from '../../lib/inbox/helpers';
import {
  buildClubConversationId,
  buildDmConversationId,
  type ActivityNotificationRecord,
  type FriendStreakRecord,
  type InboxConversationRecord,
  type InboxShareCard,
} from '../../lib/inbox/types';
import type { RecordedRunSummary } from '../../lib/runs/types';
import type { FriendProfile, Race, UserProfile } from '../../types';
import type { RunnerReminder } from '../RunnerReminderCenter';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import InboxThreadView from './InboxThreadView';
import {
  type InboxFriendRequestItem,
  type InboxRaceInviteItem,
} from './RunnerInboxPreviewPanel';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

export type { InboxFriendRequestItem, InboxRaceInviteItem };

export type InboxFilterMode = 'all' | 'dm' | 'club';
export type InboxTriageKey = 'friendRequests' | 'messageRequests' | 'activity' | 'eventsReminders';

export interface RunnerInboxPanelProps {
  profile: UserProfile;
  incomingRequests: InboxFriendRequestItem[];
  raceInvites: InboxRaceInviteItem[];
  reminders: RunnerReminder[];
  friends: FriendProfile[];
  races: Race[];
  recordedRuns: RecordedRunSummary[];
  badgeCatalog: BadgeDefinition[];
  userBadges: UserBadgeAward[];
  canFriends: boolean;
  canInvites: boolean;
  isDesktop: boolean;
  isSplitPane: boolean;
  isCompact: boolean;
  requestedTarget?: { type: 'club'; clubId: string } | { type: 'dm'; targetUid: string } | null;
  onRequestedTargetHandled?: () => void;
  onMobileThreadOpenChange?: (open: boolean) => void;
  onUnreadSummaryChange?: (extraUnread: number) => void;
  onAcceptRequest: (req: InboxFriendRequestItem) => Promise<void>;
  onDeclineRequest: (req: InboxFriendRequestItem) => Promise<void>;
  onOpenInvite: (invite: InboxRaceInviteItem) => Promise<void>;
  onOpenPass?: (raceId: string) => void;
  onDismissReminder: (id: string) => void;
  onOpenFriends?: () => void;
  onOpenExploreRace?: (raceId: string) => void;
  onOpenExploreClub?: (clubId: string) => void;
  onOpenBadges?: () => void;
  onOpenRuns?: () => void;
}

function formatShortStamp(iso?: string): string {
  if (!iso) return '';
  if (iso.length >= 16) return iso.slice(5, 10);
  return iso.slice(0, 10);
}

export default function RunnerInboxPanel({
  profile,
  incomingRequests,
  raceInvites,
  reminders,
  friends,
  races,
  recordedRuns,
  badgeCatalog,
  userBadges,
  canFriends,
  canInvites,
  isDesktop,
  isSplitPane,
  isCompact,
  requestedTarget,
  onRequestedTargetHandled,
  onMobileThreadOpenChange,
  onUnreadSummaryChange,
  onAcceptRequest,
  onDeclineRequest,
  onOpenInvite,
  onOpenPass,
  onDismissReminder,
  onOpenFriends,
  onOpenExploreRace,
  onOpenExploreClub,
  onOpenBadges,
  onOpenRuns,
}: RunnerInboxPanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);
  const handlingTargetRef = useRef<string | null>(null);
  const isE2e = import.meta.env.DEV && profile.uid.startsWith('e2e-');

  const [dmConversations, setDmConversations] = useState<InboxConversationRecord[]>([]);
  const [dmLoaded, setDmLoaded] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [clubConversations, setClubConversations] = useState<InboxConversationRecord[]>([]);

  const [clubs, setClubs] = useState<ClubDefinition[]>([]);
  const [myMemberships, setMyMemberships] = useState<ClubMemberRecord[]>([]);
  const [streaks, setStreaks] = useState<FriendStreakRecord[]>([]);
  const [notifications, setNotifications] = useState<ActivityNotificationRecord[]>([]);

  const [filterMode, setFilterMode] = useState<InboxFilterMode>('all');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);

  const [allowRequests, setAllowRequests] = useState<boolean>(
    profile.allowMessageRequests !== false,
  );
  const [savingRequestsPref, setSavingRequestsPref] = useState(false);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [startingChatUid, setStartingChatUid] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [openFolders, setOpenFolders] = useState<Record<InboxTriageKey, boolean>>({
    friendRequests: false,
    messageRequests: false,
    activity: false,
    eventsReminders: false,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setAllowRequests(profile.allowMessageRequests !== false);
  }, [profile.allowMessageRequests]);

  // Seed or subscribe to inbox, club chat, streak, and notification streams
  useEffect(() => {
    if (isE2e) {
      let storedClubs = readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY);
      if (!storedClubs || storedClubs.length === 0) {
        storedClubs = buildDevStarterClubs();
        writeDevSessionJson(E2E_CLUBS_KEY, storedClubs);
      }
      const storedMembers = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
      const myMem = storedMembers.filter((m) => m.uid === profile.uid);

      let storedConvs = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY);
      let storedMsgs = readDevSessionJson(E2E_INBOX_MESSAGES_KEY);
      let storedStreaks = readDevSessionJson<FriendStreakRecord>(E2E_STREAKS_KEY);
      let storedNotifs = readDevSessionJson<ActivityNotificationRecord>(E2E_NOTIFICATIONS_KEY);
      if (!storedConvs || !storedMsgs || !storedStreaks || !storedNotifs) {
        const seed = buildDevStarterInboxData(profile.uid, profile.displayName || 'Runner');
        if (!storedConvs) {
          storedConvs = seed.conversations;
          writeDevSessionJson(E2E_CONVERSATIONS_KEY, storedConvs);
        }
        if (!storedMsgs) {
          storedMsgs = seed.messages;
          writeDevSessionJson(E2E_INBOX_MESSAGES_KEY, storedMsgs);
        }
        if (!storedStreaks) {
          storedStreaks = seed.streaks;
          writeDevSessionJson(E2E_STREAKS_KEY, storedStreaks);
        }
        if (!storedNotifs) {
          storedNotifs = seed.notifications;
          writeDevSessionJson(E2E_NOTIFICATIONS_KEY, storedNotifs);
        }
      }

      setClubs(storedClubs.filter((c) => c.status === 'active'));
      setMyMemberships(myMem);
      setDmConversations(storedConvs.filter((c) => c.type === 'dm'));
      setClubConversations(storedConvs.filter((c) => c.type === 'club'));
      setStreaks(storedStreaks);
      setNotifications(storedNotifs);
      setDmLoaded(true);
      setDmError(null);
      return;
    }

    const unsubDm = subscribeDmConversations(profile.uid, (res) => {
      setDmConversations(res.conversations);
      setDmLoaded(res.loaded);
      setDmError(res.error);
    });
    const unsubClubs = subscribeClubCatalog(
      (res) => setClubs(res.clubs),
      { includeArchived: false },
    );
    const unsubMembers = subscribeMyClubMemberships(profile.uid, (res) => {
      setMyMemberships(res.memberships);
    });
    const unsubStreaks = subscribeFriendStreaks(profile.uid, setStreaks);
    const unsubNotifs = subscribeActivityNotifications(profile.uid, (res) => {
      setNotifications(res.notifications);
    });

    return () => {
      unsubDm();
      unsubClubs();
      unsubMembers();
      unsubStreaks();
      unsubNotifs();
    };
  }, [isE2e, profile.uid, profile.displayName]);

  const clubsById = useMemo(() => {
    const map = new Map<string, ClubDefinition>();
    for (const c of clubs) map.set(c.clubId, c);
    return map;
  }, [clubs]);

  const activeChatClubs = useMemo(() => {
    const activeIds = new Set(
      myMemberships.filter((m) => m.status === 'active').map((m) => m.clubId),
    );
    return clubs.filter((c) => activeIds.has(c.clubId) && c.modules.chat);
  }, [clubs, myMemberships]);

  const activeChatClubIds = useMemo(
    () => activeChatClubs.map((c) => c.clubId),
    [activeChatClubs],
  );

  useEffect(() => {
    if (isE2e) return;
    return subscribeClubConversations(activeChatClubIds, setClubConversations);
  }, [isE2e, activeChatClubIds]);

  const friendsByUid = useMemo(() => {
    const map = new Map<string, FriendProfile>();
    for (const f of friends) map.set(f.uid, f);
    return map;
  }, [friends]);

  const streakByDmId = useMemo(() => {
    const map = new Map<string, FriendStreakRecord>();
    for (const s of streaks) map.set(s.id, s);
    return map;
  }, [streaks]);

  // Include joined chat-enabled clubs even before the first club message creates a Firestore doc
  const effectiveClubConversations = useMemo(() => {
    const byId = new Map<string, InboxConversationRecord>();
    for (const conv of clubConversations) {
      byId.set(conv.conversationId, conv);
    }
    for (const club of activeChatClubs) {
      const convId = buildClubConversationId(club.clubId);
      if (!byId.has(convId)) {
        byId.set(convId, {
          conversationId: convId,
          type: 'club',
          clubId: club.clubId,
          clubName: club.name,
          members: [],
          status: 'active',
          lastMessageText: '',
          lastMessageAt: '',
          lastSenderUid: '',
          updatedAt: club.updatedAt || club.createdAt,
        });
      }
    }
    return Array.from(byId.values());
  }, [clubConversations, activeChatClubs]);

  const mergedConversations = useMemo(
    () => mergeAndSortConversations(dmConversations, effectiveClubConversations),
    [dmConversations, effectiveClubConversations],
  );

  const partitioned = useMemo(
    () => partitionInboxConversations(mergedConversations, profile.uid),
    [mergedConversations, profile.uid],
  );

  const filteredActiveChats = useMemo(() => {
    if (filterMode === 'all') return partitioned.activeChats;
    return partitioned.activeChats.filter((c) => c.type === filterMode);
  }, [partitioned.activeChats, filterMode]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const extraUnreadCount = useMemo(
    () =>
      computeTotalInboxUnread({
        conversations: mergedConversations,
        myUid: profile.uid,
        unreadNotificationsCount,
      }),
    [mergedConversations, profile.uid, unreadNotificationsCount],
  );

  useEffect(() => {
    onUnreadSummaryChange?.(extraUnreadCount);
  }, [extraUnreadCount, onUnreadSummaryChange]);

  // Auto-expand triage folders when items arrive; keep empty ones collapsed
  useEffect(() => {
    setOpenFolders((prev) => ({
      friendRequests: incomingRequests.length > 0 ? true : prev.friendRequests,
      messageRequests: partitioned.incomingRequests.length > 0 ? true : prev.messageRequests,
      activity: unreadNotificationsCount > 0 ? true : prev.activity,
      eventsReminders:
        raceInvites.length + reminders.length > 0 ? true : prev.eventsReminders,
    }));
  }, [
    incomingRequests.length,
    partitioned.incomingRequests.length,
    unreadNotificationsCount,
    raceInvites.length,
    reminders.length,
  ]);

  const selectedConversation = useMemo(
    () =>
      selectedConversationId
        ? mergedConversations.find((c) => c.conversationId === selectedConversationId) || null
        : null,
    [mergedConversations, selectedConversationId],
  );

  // Notify dashboard shell when mobile opens/closes full-screen thread
  const showDetailPane = isSplitPane || (mobileThreadOpen && Boolean(selectedConversation));
  const showRailPane = isSplitPane || !showDetailPane;
  const mobileActive = !isSplitPane && mobileThreadOpen && Boolean(selectedConversation);

  useEffect(() => {
    onMobileThreadOpenChange?.(mobileActive);
  }, [mobileActive, onMobileThreadOpenChange]);

  useEffect(() => {
    return () => {
      onMobileThreadOpenChange?.(false);
    };
  }, [onMobileThreadOpenChange]);

  const openOrStartDm = useCallback(
    async (targetUid: string) => {
      if (!targetUid || targetUid === profile.uid) return;
      const expectedId = buildDmConversationId(profile.uid, targetUid);
      const existing = mergedConversations.find((c) => c.conversationId === expectedId);
      if (existing) {
        setSelectedConversationId(existing.conversationId);
        if (!isSplitPane) setMobileThreadOpen(true);
        setNewChatOpen(false);
        return;
      }

      setStartingChatUid(targetUid);
      setActionError('');
      try {
        if (isE2e) {
          const friend = friendsByUid.get(targetUid);
          const stored = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [];
          const res = startDevDmFixture(stored, {
            myUid: profile.uid,
            myDisplayName: profile.displayName || 'Runner',
            targetUid,
            targetDisplayName: friend?.nickname || friend?.displayName || 'Runner Member',
            targetUsername: friend?.username,
          });
          setDmConversations(res.conversations.filter((c) => c.type === 'dm'));
          setSelectedConversationId(res.conversation.conversationId);
          if (!isSplitPane) setMobileThreadOpen(true);
          setNewChatOpen(false);
        } else {
          const res = await startDmConversation(targetUid);
          if (!mountedRef.current) return;
          setDmConversations((prev) => {
            const exists = prev.some((c) => c.conversationId === res.conversation.conversationId);
            return exists
              ? prev.map((c) =>
                  c.conversationId === res.conversation.conversationId ? res.conversation : c,
                )
              : [res.conversation, ...prev];
          });
          setSelectedConversationId(res.conversation.conversationId);
          if (!isSplitPane) setMobileThreadOpen(true);
          setNewChatOpen(false);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error && err.message ? err.message : 'Unable to start DM.';
        setActionError(msg);
        notify({ tone: 'error', title: 'Could not open chat', message: msg });
      } finally {
        if (mountedRef.current) setStartingChatUid(null);
      }
    },
    [profile.uid, profile.displayName, mergedConversations, isSplitPane, isE2e, friendsByUid, notify],
  );

  // Handle deep-link targets from Friends ("Chat"), Public Profile ("Message"), or Clubs ("Club Chat")
  useEffect(() => {
    if (!requestedTarget) {
      handlingTargetRef.current = null;
      return;
    }
    const targetKey =
      requestedTarget.type === 'club'
        ? `club:${requestedTarget.clubId}`
        : `dm:${requestedTarget.targetUid}`;
    if (handlingTargetRef.current === targetKey) return;
    handlingTargetRef.current = targetKey;

    if (requestedTarget.type === 'club') {
      const convId = buildClubConversationId(requestedTarget.clubId);
      const club = clubsById.get(requestedTarget.clubId);
      const exists = mergedConversations.some((c) => c.conversationId === convId);
      if (!exists) {
        const stub: InboxConversationRecord = {
          conversationId: convId,
          type: 'club',
          clubId: requestedTarget.clubId,
          clubName: club?.name || requestedTarget.clubId,
          members: [],
          status: 'active',
          lastMessageText: '',
          lastMessageAt: '',
          lastSenderUid: '',
          updatedAt: new Date().toISOString(),
        };
        setClubConversations((prev) =>
          prev.some((c) => c.conversationId === convId) ? prev : [stub, ...prev],
        );
      }
      setFilterMode('all');
      setSelectedConversationId(convId);
      if (!isSplitPane) setMobileThreadOpen(true);
      onRequestedTargetHandled?.();
      return;
    }

    setFilterMode('all');
    void openOrStartDm(requestedTarget.targetUid).finally(() => {
      onRequestedTargetHandled?.();
    });
  }, [
    requestedTarget,
    clubsById,
    mergedConversations,
    isSplitPane,
    openOrStartDm,
    onRequestedTargetHandled,
  ]);

  const handleToggleAllowRequests = async (nextAllowed: boolean) => {
    if (savingRequestsPref) return;
    const prevValue = allowRequests;
    setAllowRequests(nextAllowed);
    setSavingRequestsPref(true);
    try {
      if (!isE2e) {
        await updateDoc(doc(db, 'users', profile.uid), {
          allowMessageRequests: nextAllowed,
        });
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: nextAllowed ? 'Message requests enabled' : 'Message requests friends-only',
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setAllowRequests(prevValue);
      notify({
        tone: 'error',
        title: 'Preference save failed',
        message:
          err instanceof Error && err.message
            ? err.message
            : 'Unable to update message request privacy setting.',
      });
    } finally {
      if (mountedRef.current) setSavingRequestsPref(false);
    }
  };

  const handleMarkAllActivityRead = async () => {
    if (busyKey || unreadNotificationsCount === 0) return;
    setBusyKey('mark_all_activity');
    try {
      if (isE2e) {
        const storedConvs = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [];
        const res = markDevInboxReadFixture(storedConvs, notifications, {
          myUid: profile.uid,
          markAllNotifications: true,
        });
        setNotifications(res.notifications);
      } else {
        await markInboxRead({ markAllNotifications: true });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : 'Unable to mark notifications read.',
      });
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  };

  const handleMarkSingleActivityRead = async (notif: ActivityNotificationRecord) => {
    if (!notif.read) {
      if (isE2e) {
        const storedConvs = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [];
        const res = markDevInboxReadFixture(storedConvs, notifications, {
          myUid: profile.uid,
          notificationIds: [notif.id],
        });
        setNotifications(res.notifications);
      } else {
        void markInboxRead({ notificationIds: [notif.id] }).catch(() => undefined);
      }
    }
    if (notif.kind === 'badge') {
      onOpenBadges?.();
    } else if ((notif.kind === 'club_approved' || notif.kind === 'meetup') && notif.targetId) {
      onOpenExploreClub?.(notif.targetId);
    }
  };

  const runAsyncAction = async (key: string, fn: () => Promise<void>, fallbackMessage: string) => {
    if (busyKey) return;
    setBusyKey(key);
    setActionError('');
    try {
      await fn();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setActionError(err instanceof Error && err.message ? err.message : fallbackMessage);
      }
    } finally {
      if (mountedRef.current) setBusyKey(null);
    }
  };

  const handleOpenShareTarget = useCallback(
    (card: InboxShareCard) => {
      if (card.type === 'race') {
        onOpenExploreRace?.(card.targetId);
      } else if (card.type === 'club') {
        onOpenExploreClub?.(card.targetId);
      } else if (card.type === 'badge') {
        onOpenBadges?.();
      } else if (card.type === 'run') {
        onOpenRuns?.();
      }
    },
    [onOpenExploreRace, onOpenExploreClub, onOpenBadges, onOpenRuns],
  );

  // Sort Active Friends & Streaks rail items: streak holders first, then alphabetical
  const activeFriendsRail = useMemo(() => {
    return [...friends]
      .map((f) => {
        const dmId = buildDmConversationId(profile.uid, f.uid);
        const streak = streakByDmId.get(dmId);
        return {
          friend: f,
          streakDays: streak?.streakDays || 0,
        };
      })
      .sort((a, b) => b.streakDays - a.streakDays || a.friend.displayName.localeCompare(b.friend.displayName));
  }, [friends, profile.uid, streakByDmId]);

  const pickerFriends = useMemo(() => {
    const q = newChatSearch.trim().toLowerCase();
    if (!q) return activeFriendsRail;
    return activeFriendsRail.filter(({ friend }) => {
      const hay = `${friend.displayName} ${friend.nickname || ''} ${friend.username || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeFriendsRail, newChatSearch]);

  const selectedMeta = useMemo(() => {
    if (!selectedConversation) return null;
    return resolveConversationDisplayMeta(selectedConversation, profile.uid, friendsByUid, clubsById);
  }, [selectedConversation, profile.uid, friendsByUid, clubsById]);

  const selectedStreak = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'dm') return null;
    return streakByDmId.get(selectedConversation.conversationId) || null;
  }, [selectedConversation, streakByDmId]);

  const selectedCanModerateClub = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'club') return false;
    if (isSuperAdmin || can('moderation.manage')) return true;
    const clubId = selectedConversation.clubId;
    if (!clubId) return false;
    return myMemberships.some(
      (m) => m.clubId === clubId && m.role === 'captain' && m.status === 'active',
    );
  }, [selectedConversation, isSuperAdmin, can, myMemberships]);

  const msgRequestTotal = partitioned.incomingRequests.length + partitioned.outgoingRequests.length;
  const eventsRemindersTotal = raceInvites.length + reminders.length;
  const switchId = `${baseId}-msg-requests-switch`;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--surface-page)]">
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Conversation & Triage Rail */}
        {showRailPane && (
          <aside
            aria-label="Inbox threads and activity"
            className={`${
              isSplitPane
                ? `${isDesktop ? 'w-[380px]' : 'w-[320px]'} shrink-0 border-r border-[var(--border-default)]`
                : 'w-full'
            } min-h-0 flex flex-col overflow-hidden bg-[var(--surface-card)]`}
          >
            {/* Compact Sticky Header */}
            <div className="shrink-0 border-b border-[var(--border-default)] px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="font-display font-semibold text-base text-[var(--text-primary)] truncate">
                    Inbox
                  </h2>
                  {extraUnreadCount + incomingRequests.length + eventsRemindersTotal > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-red-700 text-white font-mono text-xs font-semibold tabular-nums shrink-0">
                      {extraUnreadCount + incomingRequests.length + eventsRemindersTotal}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {canFriends && onOpenFriends && (
                    <button
                      type="button"
                      onClick={onOpenFriends}
                      aria-label="Find friends"
                      className="min-h-11 min-w-11 lg:min-h-9 px-2.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      {!isCompact && <span>Friends</span>}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNewChatSearch('');
                      setNewChatOpen(true);
                    }}
                    className="min-h-11 lg:min-h-9 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <MessageSquarePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>New Chat</span>
                  </button>
                </div>
              </div>

              {/* Conversation Scope Filter */}
              <div role="group" aria-label="Filter conversations" className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['all', 'All', partitioned.activeChats.length],
                    ['dm', 'DMs', partitioned.activeChats.filter((c) => c.type === 'dm').length],
                    ['club', 'Clubs', partitioned.activeChats.filter((c) => c.type === 'club').length],
                  ] as const
                ).map(([mode, label, count]) => {
                  const active = filterMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilterMode(mode)}
                      className={`min-h-11 lg:min-h-9 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                        active
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <span>{label}</span>
                      <span className={`font-mono text-xs tabular-nums ${active ? 'text-white/95' : 'text-[var(--text-secondary)]'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {actionError && (
              <div
                role="alert"
                aria-live="assertive"
                className="m-3 rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300"
              >
                {actionError}
              </div>
            )}

            {/* Scrollable Feed */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll divide-y divide-[var(--border-subtle)] pb-[max(12px,var(--rp-safe-bottom))]">
              {/* Message Request Privacy Switch */}
              <div className="px-3 py-2.5">
                <label
                  htmlFor={switchId}
                  className="min-h-11 flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 cursor-pointer"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[var(--text-primary)]">
                      Allow message requests
                    </span>
                    <span className="block text-xs font-normal text-[var(--text-secondary)] truncate">
                      {allowRequests ? 'Clubmates can send 1 intro message' : 'Friends and club chats only'}
                    </span>
                  </span>
                  <input
                    id={switchId}
                    type="checkbox"
                    role="switch"
                    aria-checked={allowRequests}
                    {...({ switch: '' } as Record<string, unknown>)}
                    disabled={savingRequestsPref}
                    checked={allowRequests}
                    onChange={(e) => void handleToggleAllowRequests(e.target.checked)}
                    className="access-switch shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  />
                </label>
              </div>

              {/* Horizontal Active Friends & Daily Streaks Strip */}
              {(activeFriendsRail.length > 0 || activeChatClubs.length > 0) && (
                <section aria-label="Active friends and chat streaks" className="px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Active Streaks &amp; Crews
                    </h3>
                    <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                      {activeFriendsRail.filter((r) => r.streakDays > 0).length} active
                    </span>
                  </div>

                  <div className="flex items-stretch gap-2 overflow-x-auto racepulse-horizontal-scroll touch-pan-x pb-0.5">
                    {activeFriendsRail.map(({ friend, streakDays }) => (
                      <button
                        key={friend.uid}
                        type="button"
                        disabled={startingChatUid === friend.uid}
                        onClick={() => void openOrStartDm(friend.uid)}
                        className="min-h-11 min-w-[78px] max-w-[104px] px-2.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex flex-col items-center justify-center gap-1 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                      >
                        <div className="relative">
                          <span className="w-9 h-9 rounded-full bg-red-600/15 border border-red-600/35 text-xs font-semibold text-red-800 dark:text-red-300 flex items-center justify-center">
                            {(friend.nickname || friend.displayName || 'R').charAt(0).toUpperCase()}
                          </span>
                          {streakDays > 0 && (
                            <span className="absolute -right-2 -bottom-1 px-1 rounded-full bg-amber-800 text-white font-mono text-xs font-semibold inline-flex items-center gap-0.5 tabular-nums">
                              <Flame className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                              <span>{streakDays}</span>
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-full">
                          {friend.nickname || friend.displayName}
                        </span>
                      </button>
                    ))}

                    {activeChatClubs.map((club) => {
                      const clubConvId = buildClubConversationId(club.clubId);
                      return (
                        <button
                          key={club.clubId}
                          type="button"
                          onClick={() => {
                            setSelectedConversationId(clubConvId);
                            if (!isSplitPane) setMobileThreadOpen(true);
                          }}
                          className="min-h-11 min-w-[82px] max-w-[112px] px-2.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex flex-col items-center justify-center gap-1 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                        >
                          <span className="w-9 h-9 rounded-xl bg-[var(--surface-card)] border border-[var(--border-default)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center">
                            <Users2 className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                          </span>
                          <span className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-full">
                            {club.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Collapsible Triage Folders */}
              <section aria-label="Inbox triage folders" className="divide-y divide-[var(--border-subtle)]">
                {/* 1. Friend Requests */}
                {(canFriends || incomingRequests.length > 0) && (
                  <div>
                    <button
                      type="button"
                      aria-expanded={openFolders.friendRequests}
                      onClick={() =>
                        setOpenFolders((prev) => ({
                          ...prev,
                          friendRequests: !prev.friendRequests,
                        }))
                      }
                      className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--surface-hover)] cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <UserPlus className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          Friend Requests
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                            incomingRequests.length > 0
                              ? 'bg-red-700 text-white'
                              : 'bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {incomingRequests.length}
                        </span>
                        {openFolders.friendRequests ? (
                          <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                        )}
                      </span>
                    </button>

                    {openFolders.friendRequests && (
                      <div className="px-3 pb-3 space-y-2 bg-[var(--surface-inset)]/50">
                        {incomingRequests.length === 0 ? (
                          <div className="py-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-[var(--text-secondary)]">
                              No pending friend requests.
                            </p>
                            {canFriends && onOpenFriends && (
                              <button
                                type="button"
                                onClick={onOpenFriends}
                                className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                              >
                                Find Friends
                              </button>
                            )}
                          </div>
                        ) : (
                          incomingRequests.map((req) => {
                            const reqId = `${req.fromUid}_${req.toUid}`;
                            return (
                              <div
                                key={reqId}
                                className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                    {req.fromDisplayName}
                                  </p>
                                  <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                                    @{req.fromUsername}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={busyKey !== null}
                                    onClick={() =>
                                      void runAsyncAction(
                                        `decline_${reqId}`,
                                        () => onDeclineRequest(req),
                                        'Could not decline request.',
                                      )
                                    }
                                    className="min-h-11 px-2.5 rounded-lg border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
                                  >
                                    Decline
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyKey !== null}
                                    onClick={() =>
                                      void runAsyncAction(
                                        `accept_${reqId}`,
                                        () => onAcceptRequest(req),
                                        'Could not accept request.',
                                      )
                                    }
                                    className="min-h-11 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                                  >
                                    <UserCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                    <span>Accept</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Message Requests */}
                <div>
                  <button
                    type="button"
                    aria-expanded={openFolders.messageRequests}
                    onClick={() =>
                      setOpenFolders((prev) => ({
                        ...prev,
                        messageRequests: !prev.messageRequests,
                      }))
                    }
                    className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--surface-hover)] cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <InboxIcon className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        Message Requests
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                          partitioned.incomingRequests.length > 0
                            ? 'bg-amber-800 text-white'
                            : 'bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {msgRequestTotal}
                      </span>
                      {openFolders.messageRequests ? (
                        <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                      )}
                    </span>
                  </button>

                  {openFolders.messageRequests && (
                    <div className="px-3 pb-3 space-y-1.5 bg-[var(--surface-inset)]/50">
                      {msgRequestTotal === 0 ? (
                        <p className="py-1.5 text-xs text-[var(--text-secondary)]">
                          No pending message requests.
                        </p>
                      ) : (
                        [...partitioned.incomingRequests, ...partitioned.outgoingRequests].map((conv) => {
                          const meta = resolveConversationDisplayMeta(
                            conv,
                            profile.uid,
                            friendsByUid,
                            clubsById,
                          );
                          const isOutgoing = conv.requestedByUid === profile.uid;
                          const selected =
                            selectedConversation?.conversationId === conv.conversationId && isSplitPane;
                          return (
                            <button
                              key={conv.conversationId}
                              type="button"
                              onClick={() => {
                                setSelectedConversationId(conv.conversationId);
                                if (!isSplitPane) setMobileThreadOpen(true);
                              }}
                              className={`w-full min-h-11 rounded-xl border p-2.5 text-left flex items-center justify-between gap-2 cursor-pointer ${
                                selected
                                  ? 'border-red-600 bg-red-600/10'
                                  : 'border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                  {meta.title}
                                </p>
                                <p className="text-xs text-[var(--text-secondary)] truncate">
                                  {conv.lastMessageText || (isOutgoing ? 'Awaiting reply' : 'Wants to message you')}
                                </p>
                              </div>
                              <span className="px-2 py-0.5 rounded-md border border-amber-600/35 bg-amber-500/10 text-xs font-semibold text-amber-800 dark:text-amber-300 shrink-0">
                                {isOutgoing ? 'Sent' : 'Review'}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Social & Achievement Activity */}
                <div>
                  <button
                    type="button"
                    aria-expanded={openFolders.activity}
                    onClick={() =>
                      setOpenFolders((prev) => ({
                        ...prev,
                        activity: !prev.activity,
                      }))
                    }
                    className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--surface-hover)] cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <BellRing className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        Activity
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                          unreadNotificationsCount > 0
                            ? 'bg-red-700 text-white'
                            : 'bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {unreadNotificationsCount > 0 ? unreadNotificationsCount : notifications.length}
                      </span>
                      {openFolders.activity ? (
                        <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                      )}
                    </span>
                  </button>

                  {openFolders.activity && (
                    <div className="px-3 pb-3 space-y-2 bg-[var(--surface-inset)]/50">
                      {unreadNotificationsCount > 0 && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => void handleMarkAllActivityRead()}
                            className="min-h-11 px-2.5 rounded-lg border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                            <span>Mark all read</span>
                          </button>
                        </div>
                      )}
                      {notifications.length === 0 ? (
                        <p className="py-1 text-xs text-[var(--text-secondary)]">
                          Kudos, post comments, badge unlocks, and streak updates appear here.
                        </p>
                      ) : (
                        notifications.slice(0, 10).map((notif) => (
                          <button
                            key={notif.id}
                            type="button"
                            onClick={() => void handleMarkSingleActivityRead(notif)}
                            className={`w-full min-h-11 rounded-xl border p-2.5 text-left flex items-start justify-between gap-2 cursor-pointer ${
                              notif.read
                                ? 'border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-secondary)]'
                                : 'border-red-600/35 bg-[var(--surface-card)] text-[var(--text-primary)]'
                            }`}
                          >
                            <span className="text-xs leading-snug">{notif.summary}</span>
                            {!notif.read && (
                              <span
                                className="w-2 h-2 rounded-full bg-red-600 shrink-0 mt-1"
                                aria-label="Unread notification"
                              />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* 4. Race Invites & Reminders */}
                {(canInvites || eventsRemindersTotal > 0) && (
                  <div>
                    <button
                      type="button"
                      aria-expanded={openFolders.eventsReminders}
                      onClick={() =>
                        setOpenFolders((prev) => ({
                          ...prev,
                          eventsReminders: !prev.eventsReminders,
                        }))
                      }
                      className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-[var(--surface-hover)] cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Flag className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          Race Invites &amp; Reminders
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                            eventsRemindersTotal > 0
                              ? 'bg-emerald-700 text-white'
                              : 'bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {eventsRemindersTotal}
                        </span>
                        {openFolders.eventsReminders ? (
                          <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                        )}
                      </span>
                    </button>

                    {openFolders.eventsReminders && (
                      <div className="px-3 pb-3 space-y-2 bg-[var(--surface-inset)]/50">
                        {eventsRemindersTotal === 0 ? (
                          <p className="py-1 text-xs text-[var(--text-secondary)]">
                            All race invites, passes, and kit reminders are caught up.
                          </p>
                        ) : (
                          <>
                            {raceInvites.map((invite) => {
                              const inviteId = `${invite.fromUid}_${invite.toUid}_${invite.raceId}`;
                              return (
                                <div
                                  key={inviteId}
                                  className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                      {invite.raceName}
                                    </p>
                                    <p className="text-xs text-[var(--text-secondary)] truncate">
                                      From {invite.fromDisplayName} · {invite.raceDate}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={busyKey !== null}
                                    onClick={() =>
                                      void runAsyncAction(
                                        `invite_${inviteId}`,
                                        () => onOpenInvite(invite),
                                        'Could not open invite.',
                                      )
                                    }
                                    className="min-h-11 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-60"
                                  >
                                    Open Event
                                  </button>
                                </div>
                              );
                            })}
                            {reminders.map((rem) => {
                              const Icon =
                                rem.kind === 'result'
                                  ? Trophy
                                  : rem.kind === 'kit'
                                    ? PackageCheck
                                    : CalendarDays;
                              return (
                                <div
                                  key={rem.id}
                                  className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 space-y-2"
                                >
                                  <div className="flex items-start gap-2 min-w-0">
                                    <Icon className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                                        {rem.title}
                                      </p>
                                      <p className="text-xs text-[var(--text-secondary)] leading-snug">
                                        {rem.detail}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {onOpenPass && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenPass(rem.raceId)}
                                        className="min-h-11 px-3 rounded-lg border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                                      >
                                        Open Pass
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => onDismissReminder(rem.id)}
                                      className="min-h-11 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)] cursor-pointer"
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Conversations List */}
              <section aria-label="Conversations">
                <div className="px-3 py-2.5 flex items-center justify-between gap-2 bg-[var(--surface-inset)]/40">
                  <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    Messages
                  </h3>
                  <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                    {filteredActiveChats.length}
                  </span>
                </div>

                {dmError && (
                  <p role="alert" className="m-3 rounded-xl border border-red-600/35 bg-red-500/10 p-3 text-xs font-semibold text-red-700 dark:text-red-300">
                    {dmError}
                  </p>
                )}

                {!dmLoaded ? (
                  <RunnerQueueSkeleton rows={4} label="Loading conversations" />
                ) : filteredActiveChats.length === 0 ? (
                  <div className="p-6 text-center space-y-2.5">
                    <MessageCircle className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      No conversations yet
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Start a chat with a friend or open a joined club thread.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {filteredActiveChats.map((conv) => {
                      const meta = resolveConversationDisplayMeta(
                        conv,
                        profile.uid,
                        friendsByUid,
                        clubsById,
                      );
                      const unread = conv.unreadByUid?.[profile.uid] ?? 0;
                      const streak =
                        conv.type === 'dm' ? streakByDmId.get(conv.conversationId) : undefined;
                      const selected =
                        selectedConversation?.conversationId === conv.conversationId && isSplitPane;

                      return (
                        <button
                          key={conv.conversationId}
                          type="button"
                          onClick={() => {
                            setSelectedConversationId(conv.conversationId);
                            if (!isSplitPane) setMobileThreadOpen(true);
                          }}
                          className={`w-full min-h-[68px] px-3 py-2.5 text-left flex items-center justify-between gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                            selected
                              ? 'bg-red-600/10 border-l-4 border-l-red-600'
                              : 'hover:bg-[var(--surface-hover)] border-l-4 border-l-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span
                              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${
                                conv.type === 'club'
                                  ? 'border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                                  : 'border border-red-600/35 bg-red-600/15 text-red-800 dark:text-red-300'
                              }`}
                            >
                              {conv.type === 'club' ? (
                                <Users2 className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                              ) : (
                                meta.title.charAt(0).toUpperCase()
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                  {meta.title}
                                </span>
                                {streak && streak.streakDays > 0 && (
                                  <span className="px-1.5 py-0.5 rounded-md border border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200 font-mono text-xs font-semibold inline-flex items-center gap-0.5 shrink-0 tabular-nums">
                                    <Flame className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span>{streak.streakDays}d</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                                {conv.lastMessageText || meta.subtitle}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                              {formatShortStamp(conv.lastMessageAt || conv.updatedAt)}
                            </span>
                            {unread > 0 && (
                              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-700 text-white font-mono text-xs font-semibold flex items-center justify-center tabular-nums">
                                {unread}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </aside>
        )}

        {/* Right Conversation Detail Pane */}
        {showDetailPane && (
          <section
            aria-label="Conversation thread"
            className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[var(--surface-page)]"
          >
            {selectedConversation && selectedMeta ? (
              <InboxThreadView
                conversation={selectedConversation}
                title={selectedMeta.title}
                subtitle={selectedMeta.subtitle}
                peerUid={selectedMeta.peerUid}
                streak={selectedStreak}
                profile={profile}
                canModerateClub={selectedCanModerateClub}
                isMobile={!isSplitPane}
                races={races}
                recordedRuns={recordedRuns}
                clubs={clubs}
                badgeCatalog={badgeCatalog}
                userBadges={userBadges}
                onBack={() => {
                  setMobileThreadOpen(false);
                }}
                onConversationUpdated={(updated) => {
                  if (updated.type === 'club') {
                    setClubConversations((prev) =>
                      prev.some((c) => c.conversationId === updated.conversationId)
                        ? prev.map((c) => (c.conversationId === updated.conversationId ? updated : c))
                        : [updated, ...prev],
                    );
                  } else {
                    setDmConversations((prev) =>
                      prev.some((c) => c.conversationId === updated.conversationId)
                        ? prev.map((c) => (c.conversationId === updated.conversationId ? updated : c))
                        : [updated, ...prev],
                    );
                  }
                }}
                onConversationRemoved={(removedId) => {
                  setDmConversations((prev) => prev.filter((c) => c.conversationId !== removedId));
                  if (selectedConversationId === removedId) {
                    setSelectedConversationId(null);
                    setMobileThreadOpen(false);
                  }
                }}
                onStreakUpdated={(updatedStreak) => {
                  setStreaks((prev) =>
                    prev.some((s) => s.id === updatedStreak.id)
                      ? prev.map((s) => (s.id === updatedStreak.id ? updatedStreak : s))
                      : [...prev, updatedStreak],
                  );
                }}
                onOpenShareTarget={handleOpenShareTarget}
              />
            ) : (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <MessageCircle className="w-10 h-10 text-[var(--text-secondary)]" aria-hidden="true" />
                <div className="space-y-1 max-w-sm">
                  <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    Select a conversation
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Open a direct message to build a daily PHT chat streak, join a club chatroom, or start a new conversation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewChatSearch('');
                    setNewChatOpen(true);
                  }}
                  className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <MessageSquarePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>New Chat</span>
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* New Chat Friend Picker Sheet */}
      {newChatOpen && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="28rem"
          titleId={`${baseId}-new-chat-title`}
          onRequestClose={() => setNewChatOpen(false)}
          bodyClassName="p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 id={`${baseId}-new-chat-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
              Start a Chat
            </h3>
            <button
              type="button"
              onClick={() => setNewChatOpen(false)}
              aria-label="Close new chat picker"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <div className="relative">
            <Search
              className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor={`${baseId}-picker-search`} className="sr-only">
              Search friends to message
            </label>
            <input
              id={`${baseId}-picker-search`}
              type="search"
              value={newChatSearch}
              onChange={(e) => setNewChatSearch(e.target.value)}
              placeholder="Search friends by name or @handle..."
              className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            />
          </div>

          {pickerFriends.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-4 text-center space-y-2.5">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                {friends.length === 0 ? 'No connected friends yet' : 'No matching friends'}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Connect with runners in Friends or open a public runner profile in Socials to send a message request.
              </p>
              {canFriends && onOpenFriends && (
                <button
                  type="button"
                  onClick={() => {
                    setNewChatOpen(false);
                    onOpenFriends();
                  }}
                  className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Find Friends</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
              {pickerFriends.map(({ friend, streakDays }) => (
                <button
                  key={friend.uid}
                  type="button"
                  disabled={startingChatUid !== null}
                  onClick={() => void openOrStartDm(friend.uid)}
                  className="w-full min-h-11 px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {friend.nickname || friend.displayName}
                    </p>
                    <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                      @{friend.username}
                    </p>
                  </div>
                  {streakDays > 0 && (
                    <span className="px-2 py-0.5 rounded-md border border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200 font-mono text-xs font-semibold inline-flex items-center gap-1 shrink-0 tabular-nums">
                      <Flame className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>{streakDays}d</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogSurface>
      )}
    </div>
  );
}
