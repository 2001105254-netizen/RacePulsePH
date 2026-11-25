import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldBan,
  Star,
  UserCheck,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { AccountRequestError, searchRunnerFriends } from '../../lib/accountSecurity';
import {
  E2E_CLOSE_FRIENDS_KEY,
  E2E_USER_BLOCKS_KEY,
  readDevSessionJson,
  toggleDevCloseFriendFixture,
  toggleDevUserBlockFixture,
} from '../../lib/clubs/e2eFixtures';
import {
  subscribeCloseFriendEdges,
  subscribeUserBlocks,
  toggleCloseFriend,
  toggleUserBlock,
} from '../../lib/social/client';
import type { UserBlockRecord } from '../../lib/social/types';
import { FriendActivity, FriendProfile, UserProfile } from '../../types';
import { useFeedback } from '../ui/FeedbackProvider';
import { ShimmerSweep } from '../ui/MotionPrimitives';
import { usernamePattern } from './runnerUtils';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

interface FriendRequestRecord {
  fromUid: string;
  toUid: string;
  fromUsername: string;
  fromDisplayName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt?: string;
}

interface FriendshipRecord {
  fromUid: string;
  toUid: string;
  members: string[];
  createdAt: string;
}

interface RaceInviteRecord {
  fromUid: string;
  toUid: string;
  raceId: string;
  raceName: string;
  raceDate: string;
  fromDisplayName: string;
  createdAt: string;
  status: 'pending' | 'opened';
}

export interface RunnerFriendsPanelProps {
  profile: UserProfile;
  onOpenRace: (raceId: string) => void;
  onOpenProfile: () => void;
  onStartDm?: (targetUid: string) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isDesktop: boolean;
  isSplitPane?: boolean;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

function matchScoreForFallback(candidate: FriendProfile, normalizedQuery: string, tokens: string[]): number {
  const username = (candidate.username || '').toLowerCase();
  const displayName = (candidate.displayName || '').toLowerCase();
  const nickname = (candidate.nickname || '').toLowerCase();
  const words = `${displayName} ${nickname}`.split(/[\s._-]+/).filter(Boolean);

  if (username && username === normalizedQuery) return 120;
  if (username && username.startsWith(normalizedQuery)) return 100;
  if (words.some((word) => word === normalizedQuery)) return 90;
  if (words.some((word) => word.startsWith(normalizedQuery))) return 80;
  if (username && username.includes(normalizedQuery)) return 70;
  if (displayName.includes(normalizedQuery) || nickname.includes(normalizedQuery)) return 60;
  if (tokens.length > 1) {
    const searchable = `${username} ${displayName} ${nickname}`;
    if (tokens.every((token) => searchable.includes(token))) return 55;
  }
  return 0;
}

export default function RunnerFriendsPanel({
  profile,
  onOpenRace,
  onOpenProfile,
  onStartDm,
  searchQuery,
  onSearchQueryChange,
  isDesktop,
  isSplitPane = isDesktop,
  desktopSearchRef,
}: RunnerFriendsPanelProps) {
  const { can } = useAccess();
  const { confirm, notify } = useFeedback();
  const canInvites = can('personal.invites');
  const canViewUsers = can('users.view');
  const isE2e = import.meta.env.DEV && profile.uid.startsWith('e2e-');
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<FriendProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [activities, setActivities] = useState<Record<string, FriendActivity>>({});
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
  const [invites, setInvites] = useState<RaceInviteRecord[]>([]);
  const [closeFriendUids, setCloseFriendUids] = useState<Set<string>>(() => new Set());
  const [blockedUsers, setBlockedUsers] = useState<UserBlockRecord[]>([]);
  const [safetyBusyUid, setSafetyBusyUid] = useState<string | null>(null);
  const [blockedListOpen, setBlockedListOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [sendingUid, setSendingUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const mobileFilterRef = useRef<HTMLInputElement>(null);
  const searchLockRef = useRef(false);
  const searchCooldownUntilRef = useRef(0);
  const searchCacheRef = useRef<Map<string, { results: FriendProfile[]; expiresAt: number }>>(new Map());

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'friendRequests'), where('toUid', '==', profile.uid)),
        (snapshot) => {
          const records: FriendRequestRecord[] = [];
          snapshot.forEach((item) => records.push(item.data() as FriendRequestRecord));
          setIncoming(
            records
              .filter((item) => item.status === 'pending')
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
        },
        (err) => console.warn('Friend requests listener failed:', err),
      ),
    [profile.uid],
  );

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'friendRequests'), where('fromUid', '==', profile.uid)),
        (snapshot) => {
          const records: FriendRequestRecord[] = [];
          snapshot.forEach((item) => records.push(item.data() as FriendRequestRecord));
          setOutgoing(records.filter((item) => item.status === 'pending'));
        },
        (err) => console.warn('Outgoing friend requests listener failed:', err),
      ),
    [profile.uid],
  );

  useEffect(() => {
    if (!canInvites) {
      setInvites([]);
      return;
    }
    return onSnapshot(
      query(collection(db, 'raceInvites'), where('toUid', '==', profile.uid)),
      (snapshot) => {
        const records: RaceInviteRecord[] = [];
        snapshot.forEach((item) => records.push(item.data() as RaceInviteRecord));
        setInvites(
          records
            .filter((item) => item.status === 'pending')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      },
      (err) => console.warn('Race invites listener failed:', err),
    );
  }, [canInvites, profile.uid]);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'friendships'), where('members', 'array-contains', profile.uid)),
        (snapshot) => {
          const connections: FriendshipRecord[] = [];
          snapshot.forEach((item) => connections.push(item.data() as FriendshipRecord));
          void (async () => {
            try {
              const friendIds = connections.map((item) => (item.fromUid === profile.uid ? item.toUid : item.fromUid));
              const loaded = await Promise.all(
                friendIds.map(async (uid) => {
                  const [friendProfile, activity] = await Promise.all([
                    getDoc(doc(db, 'friendProfiles', uid)),
                    getDoc(doc(db, 'friendActivities', uid)),
                  ]);
                  return {
                    profile: friendProfile.exists() ? (friendProfile.data() as FriendProfile) : null,
                    activity: activity.exists() ? (activity.data() as FriendActivity) : null,
                  };
                }),
              );
              setFriends(
                loaded
                  .map((item) => item.profile)
                  .filter((item): item is FriendProfile => item !== null)
                  .sort((a, b) => a.displayName.localeCompare(b.displayName)),
              );
              setActivities(
                Object.fromEntries(
                  loaded.filter((item) => item.profile && item.activity).map((item) => [item.profile!.uid, item.activity!]),
                ),
              );
            } catch (err) {
              console.warn('Failed to load friend cards:', err);
            } finally {
              setFriendsLoaded(true);
            }
          })();
        },
        (err) => {
          console.warn('Friendships listener failed:', err);
          setFriendsLoaded(true);
        },
      ),
    [profile.uid],
  );

  useEffect(() => {
    if (isE2e) {
      setCloseFriendUids(new Set(readDevSessionJson<string>(E2E_CLOSE_FRIENDS_KEY) ?? []));
      const blkUids = readDevSessionJson<string>(E2E_USER_BLOCKS_KEY) ?? [];
      setBlockedUsers(
        blkUids.map((blockedUid) => ({
          id: `${profile.uid}_${blockedUid}`,
          blockerUid: profile.uid,
          blockedUid,
          createdAt: '',
        })),
      );
      return;
    }
    const unsubCf = subscribeCloseFriendEdges(profile.uid, (res) => {
      setCloseFriendUids(res.targetUids);
    });
    const unsubBlocks = subscribeUserBlocks(profile.uid, (res) => {
      setBlockedUsers(res.blocks);
    });
    return () => {
      unsubCf();
      unsubBlocks();
    };
  }, [isE2e, profile.uid]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (event.key === '/' && !isFormField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        (isDesktop ? desktopSearchRef?.current : mobileFilterRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, desktopSearchRef]);

  const clearLookup = () => {
    setSearchInput('');
    setSearchResults([]);
    setHasSearched(false);
    setLastQuery('');
    setError('');
    setNotice('');
  };

  const search = async () => {
    if (searchLockRef.current) return;
    const normalizedQuery = searchInput.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase();
    setError('');
    setNotice('');
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      setLastQuery('');
      setError('Enter at least 2 characters of a name or @username.');
      return;
    }

    const nowMs = Date.now();
    const cached = searchCacheRef.current.get(normalizedQuery);
    if (cached && cached.expiresAt > nowMs) {
      setSearchResults(cached.results);
      setLastQuery(normalizedQuery);
      setHasSearched(true);
      return;
    }

    if (nowMs < searchCooldownUntilRef.current) {
      const waitSec = Math.max(1, Math.ceil((searchCooldownUntilRef.current - nowMs) / 1000));
      setError(`Too many searches. Wait ${waitSec}s before searching again.`);
      return;
    }

    setSearchResults([]);
    searchLockRef.current = true;
    setSearching(true);
    try {
      const results = await searchRunnerFriends(normalizedQuery);
      if (searchCacheRef.current.size > 25) searchCacheRef.current.clear();
      searchCacheRef.current.set(normalizedQuery, { results, expiresAt: Date.now() + 30_000 });
      setSearchResults(results);
      setLastQuery(normalizedQuery);
      setHasSearched(true);
    } catch (err: unknown) {
      if (err instanceof AccountRequestError && err.status === 429) {
        const waitSec = err.retryAfter > 0 ? err.retryAfter : 15;
        searchCooldownUntilRef.current = Date.now() + waitSec * 1000;
        setError(err.message || `Too many searches. Wait ${waitSec}s before searching again.`);
        return;
      }
      if (err instanceof AccountRequestError && err.status === 404) {
        try {
          const fallbackMatches: Array<{ item: FriendProfile; score: number }> = [];
          const tokens = normalizedQuery.split(' ').filter(Boolean);

          if (canViewUsers) {
            const usersSnap = await getDocs(collection(db, 'users'));
            usersSnap.forEach((docSnap) => {
              const user = docSnap.data() as UserProfile;
              if (user.accessRemoved || user.uid === profile.uid) return;
              const candidate: FriendProfile = {
                uid: user.uid,
                username: (user.username || '').trim().toLowerCase(),
                displayName: (user.displayName || user.username || 'Runner').trim(),
                ...(user.nickname?.trim() ? { nickname: user.nickname.trim() } : {}),
                ...(user.photoURL ? { photoURL: user.photoURL } : {}),
                updatedAt: user.createdAt || '',
              };
              const score = matchScoreForFallback(candidate, normalizedQuery, tokens);
              if (score > 0) fallbackMatches.push({ item: candidate, score });
            });
          } else if (usernamePattern.test(normalizedQuery)) {
            const directory = await getDoc(doc(db, 'friendDirectory', normalizedQuery));
            if (directory.exists()) {
              const entry = directory.data() as FriendProfile;
              if (entry.uid !== profile.uid) {
                fallbackMatches.push({ item: entry, score: 120 });
              }
            }
          }

          fallbackMatches.sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName));
          setSearchResults(fallbackMatches.slice(0, 10).map((entry) => entry.item));
          setLastQuery(normalizedQuery);
          setHasSearched(true);
          return;
        } catch {
          setError('Could not search right now. Please try again.');
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Could not search right now. Please try again.');
    } finally {
      searchLockRef.current = false;
      setSearching(false);
    }
  };

  const sendFriendRequest = async (target: FriendProfile) => {
    if (!profile.username) return;
    if (!target.username) {
      setError(`${target.displayName} has not set a @username yet.`);
      return;
    }
    setSendingUid(target.uid);
    setError('');
    setNotice('');
    try {
      if (friends.some((friend) => friend.uid === target.uid)) {
        setNotice('You are already friends.');
        return;
      }
      if (outgoing.some((request) => request.toUid === target.uid)) {
        setNotice('Friend request already sent.');
        return;
      }
      await setDoc(doc(db, 'friendRequests', `${profile.uid}_${target.uid}`), {
        fromUid: profile.uid,
        toUid: target.uid,
        fromUsername: profile.username,
        fromDisplayName: profile.nickname || profile.displayName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      } satisfies FriendRequestRecord);
      setNotice(`Friend request sent to @${target.username}.`);
    } catch (err: any) {
      setError(err.message || 'Could not send the friend request.');
    } finally {
      setSendingUid(null);
    }
  };

  const respondToRequest = async (request: FriendRequestRecord, accepted: boolean) => {
    setBusy(true);
    setError('');
    try {
      const requestRef = doc(db, 'friendRequests', `${request.fromUid}_${request.toUid}`);
      if (accepted) {
        const batch = writeBatch(db);
        batch.update(requestRef, { status: 'accepted', respondedAt: new Date().toISOString() });
        batch.set(doc(db, 'friendships', `${request.fromUid}_${request.toUid}`), {
          fromUid: request.fromUid,
          toUid: request.toUid,
          members: [request.fromUid, request.toUid],
          createdAt: new Date().toISOString(),
        } satisfies FriendshipRecord);
        await batch.commit();
      } else {
        await updateDoc(requestRef, { status: 'declined', respondedAt: new Date().toISOString() });
      }
    } catch (err: any) {
      setError(err.message || 'Could not update this request.');
    } finally {
      setBusy(false);
    }
  };

  const openInvite = async (invite: RaceInviteRecord) => {
    try {
      await updateDoc(doc(db, 'raceInvites', `${invite.fromUid}_${invite.toUid}_${invite.raceId}`), { status: 'opened' });
    } catch {
      // Safe fallback when opening the invited race.
    }
    onOpenRace(invite.raceId);
  };

  const blockedUidSet = useMemo(
    () => new Set(blockedUsers.map((b) => b.blockedUid)),
    [blockedUsers],
  );

  const handleToggleCloseFriend = async (friend: FriendProfile) => {
    if (safetyBusyUid) return;
    const nextEnabled = !closeFriendUids.has(friend.uid);
    setSafetyBusyUid(friend.uid);
    try {
      if (isE2e) {
        setCloseFriendUids(toggleDevCloseFriendFixture(closeFriendUids, friend.uid, nextEnabled));
      } else {
        await toggleCloseFriend(friend.uid, nextEnabled);
      }
      notify({
        tone: 'success',
        title: nextEnabled ? 'Added to Close Friends' : 'Removed from Close Friends',
        message: nextEnabled
          ? `${friend.nickname || friend.displayName} can now view Close Friends posts and route snaps.`
          : `${friend.nickname || friend.displayName} removed from Close Friends.`,
      });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Close Friends update failed',
        message: err instanceof Error ? err.message : 'Unable to update close friends.',
      });
    } finally {
      setSafetyBusyUid(null);
    }
  };

  const handleToggleBlock = async (targetUid: string, label: string, blocked: boolean) => {
    if (safetyBusyUid) return;
    if (blocked) {
      const ok = await confirm({
        title: `Block ${label}?`,
        message: 'Blocking removes posts, route snaps, comments, and direct messages in both directions.',
        confirmLabel: 'Block Runner',
        destructive: true,
      });
      if (!ok) return;
    }
    setSafetyBusyUid(targetUid);
    try {
      if (isE2e) {
        const nextList = toggleDevUserBlockFixture(
          blockedUsers.map((b) => b.blockedUid),
          targetUid,
          blocked,
        );
        setBlockedUsers(
          nextList.map((u) => ({
            id: `${profile.uid}_${u}`,
            blockerUid: profile.uid,
            blockedUid: u,
            createdAt: '',
          })),
        );
        if (blocked && closeFriendUids.has(targetUid)) {
          setCloseFriendUids(toggleDevCloseFriendFixture(closeFriendUids, targetUid, false));
        }
      } else {
        await toggleUserBlock(targetUid, blocked);
      }
      notify({
        tone: 'info',
        title: blocked ? `Blocked ${label}` : `Unblocked ${label}`,
      });
    } catch (err) {
      notify({
        tone: 'error',
        title: blocked ? 'Block failed' : 'Unblock failed',
        message: err instanceof Error ? err.message : 'Unable to update block status.',
      });
    } finally {
      setSafetyBusyUid(null);
    }
  };

  if (!profile.username) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-6 max-w-md w-full text-center space-y-3">
          <div className="w-11 h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center mx-auto text-red-700 dark:text-red-400">
            <Users2 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-display font-semibold text-[var(--text-primary)]">Choose a username first</h2>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Save a unique username in Profile settings so runners can add you without exposing email addresses.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenProfile}
            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>Set Username in Profile</span>
          </button>
        </div>
      </div>
    );
  }

  const friendFilterTerm = searchQuery.trim().toLowerCase();
  const visibleFriends = friends.filter((friend) => {
    if (blockedUidSet.has(friend.uid)) return false;
    if (!friendFilterTerm) return true;
    return (
      friend.displayName.toLowerCase().includes(friendFilterTerm) ||
      (friend.nickname || '').toLowerCase().includes(friendFilterTerm) ||
      friend.username.toLowerCase().includes(friendFilterTerm)
    );
  });
  const visibleSearchResults = searchResults.filter((c) => !blockedUidSet.has(c.uid));

  return (
    <div
      id="runner_friends_main"
      data-split-pane={isSplitPane ? 'true' : 'false'}
      className="w-full flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll min-[600px]:overflow-hidden"
    >
      <div className="flex-1 min-h-0 flex flex-col min-[600px]:grid min-[600px]:grid-cols-[minmax(236px,38%)_minmax(0,1fr)] min-[920px]:grid-cols-[340px_minmax(0,1fr)]">
        {/* LEFT PANE: Lookup, Race Invitations, Incoming Friend Requests */}
        <section
          aria-label="Find friends and requests"
          className="shrink-0 min-[600px]:shrink flex flex-col min-h-0 min-[600px]:h-full bg-[var(--surface-card)] min-[600px]:border-r border-b min-[600px]:border-b-0 border-[var(--border-default)] min-[600px]:overflow-hidden"
        >
          <div className="min-[600px]:flex-1 min-[600px]:min-h-0 min-[600px]:overflow-y-auto min-[600px]:overscroll-y-contain divide-y divide-[var(--border-subtle)]">
            <div className="p-3 space-y-3">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-700/10 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                  <Users2 className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold font-display uppercase tracking-wider text-[var(--text-primary)]">
                    Find Runner Friends
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    Search by name or @username. Both runners confirm before sharing activity.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative min-w-0 flex-1">
                  <label htmlFor="runner_friend_username_lookup" className="sr-only">
                    Search runners by name or username
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <input
                    id="runner_friend_username_lookup"
                    type="search"
                    enterKeyHint="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Name or @username (e.g. patrick)"
                    autoCapitalize="words"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={64}
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-11 text-sm font-normal text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={clearLookup}
                      aria-label="Clear runner search"
                      className="absolute right-0 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="min-h-11 rounded-xl bg-red-700 hover:bg-red-600 px-3 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60 shrink-0"
                >
                  {searching ? 'Searching' : 'Search'}
                </button>
              </form>

              {error && (
                <div role="alert" className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">{error}</p>
                  {lastQuery.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => void search()}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] shrink-0"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}

              {notice && (
                <p role="status" className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {notice}
                </p>
              )}

              {searching && (
                <div
                  role="status"
                  aria-busy="true"
                  aria-label="Searching runners"
                  className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]"
                >
                  {Array.from({ length: 3 }, (_, idx) => (
                    <div key={idx} className="relative overflow-hidden min-h-14 py-2 flex items-center justify-between gap-3">
                      <ShimmerSweep />
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--surface-inset)]" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="h-3.5 w-32 max-w-[75%] rounded bg-[var(--surface-inset)]" />
                          <div className="h-3 w-20 max-w-[50%] rounded bg-[var(--surface-inset)]" />
                        </div>
                      </div>
                      <div className="h-11 w-20 shrink-0 rounded-xl bg-[var(--surface-inset)]" />
                    </div>
                  ))}
                  <span className="sr-only">Searching runners...</span>
                </div>
              )}

              {!searching && !error && hasSearched && visibleSearchResults.length === 0 && (
                <div className="border-t border-[var(--border-subtle)] pt-3 text-center space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    No runners match &ldquo;{lastQuery}&rdquo;
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Try a first name, last name, or @username.
                  </p>
                  <button
                    type="button"
                    onClick={clearLookup}
                    className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Clear search
                  </button>
                </div>
              )}

              {!searching && visibleSearchResults.length > 0 && (
                <div className="border-t border-[var(--border-subtle)] pt-2">
                  <div className="flex items-center justify-between gap-2 pb-1">
                    <p role="status" className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
                      {visibleSearchResults.length} {visibleSearchResults.length === 1 ? 'match' : 'matches'}
                    </p>
                    <button
                      type="button"
                      onClick={clearLookup}
                      className="min-h-11 px-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Clear
                    </button>
                  </div>
                  <ul role="list" aria-label="Runner search results" className="divide-y divide-[var(--border-subtle)]">
                    {visibleSearchResults.map((candidate) => {
                      const isFriend = friends.some((f) => f.uid === candidate.uid);
                      const isRequested = outgoing.some((r) => r.toUid === candidate.uid);
                      const incomingReq = incoming.find((r) => r.fromUid === candidate.uid);
                      const isSending = sendingUid === candidate.uid;
                      const primaryLabel = candidate.nickname && candidate.nickname !== candidate.displayName
                        ? `${candidate.nickname} · ${candidate.displayName}`
                        : candidate.displayName;

                      return (
                        <li key={candidate.uid} className="min-h-14 py-2 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-700/10 dark:bg-red-500/10 font-semibold text-red-700 dark:text-red-400">
                              {candidate.photoURL ? (
                                <img src={candidate.photoURL} alt="" width={36} height={36} className="h-full w-full object-cover" />
                              ) : (
                                candidate.displayName.charAt(0).toUpperCase()
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                                {primaryLabel}
                              </strong>
                              <small className="block truncate text-xs font-mono text-[var(--text-secondary)]">
                                {candidate.username ? `@${candidate.username}` : 'No @username set'}
                              </small>
                            </span>
                          </div>

                          {isFriend ? (
                            <button
                              type="button"
                              disabled
                              aria-label={`${candidate.displayName} is already your friend`}
                              className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-600/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
                            >
                              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>Friends</span>
                            </button>
                          ) : incomingReq ? (
                            <button
                              type="button"
                              onClick={() => void respondToRequest(incomingReq, true)}
                              disabled={busy}
                              aria-label={`Accept friend request from ${candidate.displayName}`}
                              className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-700 hover:bg-emerald-800 px-3 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>Accept</span>
                            </button>
                          ) : isRequested ? (
                            <button
                              type="button"
                              disabled
                              aria-label={`Friend request pending for ${candidate.displayName}`}
                              className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-secondary)]"
                            >
                              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>Requested</span>
                            </button>
                          ) : !candidate.username ? (
                            <button
                              type="button"
                              disabled
                              title="This runner needs to choose a @username in Profile before receiving friend requests."
                              className="shrink-0 min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)]"
                            >
                              No handle
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void sendFriendRequest(candidate)}
                              disabled={isSending}
                              aria-label={`Add ${candidate.displayName} as friend`}
                              className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center gap-1 rounded-xl border border-red-700/35 bg-red-600/10 px-3 text-xs font-semibold text-red-700 dark:text-red-400 transition hover:bg-red-700 hover:text-white disabled:opacity-60"
                            >
                              {isSending ? (
                                <RefreshCw className="h-3.5 w-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                              ) : (
                                <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span>{isSending ? 'Adding...' : 'Add'}</span>
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {canInvites && invites.length > 0 && (
              <div className="p-3 space-y-2">
                <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-red-700 dark:text-red-400 tabular-nums">
                  Race Invitations ({invites.length})
                </h3>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {invites.map((invite) => (
                    <div
                      key={`${invite.fromUid}_${invite.raceId}`}
                      className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{invite.raceName}</p>
                        <p className="text-xs text-[var(--text-secondary)] truncate tabular-nums">
                          {invite.fromDisplayName} · {invite.raceDate}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openInvite(invite)}
                        className="shrink-0 min-h-11 inline-flex items-center rounded-xl bg-red-700 hover:bg-red-600 px-3 text-xs font-semibold text-white"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {incoming.length > 0 && (
              <div className="p-3 space-y-2">
                <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-amber-800 dark:text-amber-300 tabular-nums">
                  Friend Requests ({incoming.length})
                </h3>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {incoming.map((request) => (
                    <div
                      key={`${request.fromUid}_${request.toUid}`}
                      className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{request.fromDisplayName}</p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                          @{request.fromUsername} wants to connect
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void respondToRequest(request, false)}
                          disabled={busy}
                          className="min-h-11 inline-flex items-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] px-3 text-xs font-semibold text-[var(--text-secondary)]"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => void respondToRequest(request, true)}
                          disabled={busy}
                          className="min-h-11 inline-flex items-center rounded-xl bg-emerald-700 hover:bg-emerald-800 px-3 text-xs font-semibold text-white"
                        >
                          <UserCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Accept
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE: Connected Runner Friends Directory */}
        <aside
          aria-label="Connected runner friends"
          className="shrink-0 min-[600px]:shrink flex flex-col flex-1 min-h-0 min-[600px]:h-full bg-[var(--surface-page)] min-[600px]:overflow-hidden"
        >
          <div className="shrink-0 px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-primary)]">
                Connected Friends
              </h3>
              <span className="text-xs font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-red-700 dark:text-red-400">
                {friends.filter((f) => !blockedUidSet.has(f.uid)).length}
              </span>
            </div>

            {!isDesktop && friends.length > 0 && (
              <div className="relative w-full min-[420px]:w-56">
                <label htmlFor="runner_friends_mobile_filter" className="sr-only">
                  Filter connected friends
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
                <input
                  ref={mobileFilterRef}
                  id="runner_friends_mobile_filter"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder="Filter name or @user..."
                  className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-8 pr-10 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchQueryChange('')}
                    aria-label="Clear friend filter"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll">
            {!friendsLoaded ? (
              <RunnerQueueSkeleton rows={4} label="Loading connected runner friends" />
            ) : friends.length === 0 ? (
              <div className="py-10 px-3 text-center space-y-1.5">
                <Users2 className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No connected friends yet</p>
                <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto">
                  Search a runner&apos;s name or @username above to send your first friend request.
                </p>
              </div>
            ) : visibleFriends.length === 0 ? (
              <p className="p-3 text-xs text-[var(--text-secondary)]">
                {friendFilterTerm
                  ? <>No connected friends match &ldquo;{searchQuery}&rdquo;.</>
                  : 'No visible connected friends. Manage blocked accounts below.'}
              </p>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] bg-[var(--surface-card)]">
                {visibleFriends.map((friend) => {
                  const activity = activities[friend.uid];
                  return (
                    <div key={friend.uid} className="p-3 space-y-2 border-l-4 border-l-red-600">
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-700/10 dark:bg-red-500/10 font-semibold text-red-700 dark:text-red-400">
                            {friend.photoURL ? (
                              <img src={friend.photoURL} alt="" className="h-full w-full object-cover" />
                            ) : (
                              friend.displayName.charAt(0).toUpperCase()
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                              {friend.nickname || friend.displayName}
                            </p>
                            <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                              @{friend.username}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] shrink-0">
                          {activity?.recentRaces?.length || 0} runs
                        </span>
                      </div>

                      {activity?.recentRaces?.length ? (
                        <div className="pl-12 space-y-1">
                          {activity.recentRaces.slice(0, 3).map((race) => (
                            <p key={`${race.raceId}_${race.distance}`} className="text-xs text-[var(--text-secondary)] truncate tabular-nums">
                              <strong className="text-[var(--text-primary)]">{race.raceName}</strong>{' '}
                              <span className="font-mono text-red-700 dark:text-red-400">· {race.distance}</span>{' '}
                              <span className="font-mono">· {race.date}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="pl-12 text-xs text-[var(--text-secondary)]">No shared race activity yet.</p>
                      )}

                      <div className="pl-12 pt-1 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={closeFriendUids.has(friend.uid)}
                          disabled={safetyBusyUid === friend.uid}
                          onClick={() => void handleToggleCloseFriend(friend)}
                          className={`min-h-11 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                            closeFriendUids.has(friend.uid)
                              ? 'border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{closeFriendUids.has(friend.uid) ? 'Close Friend' : 'Add Close Friend'}</span>
                        </button>

                        {onStartDm && (
                          <button
                            type="button"
                            onClick={() => onStartDm(friend.uid)}
                            className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                            <span>Message</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={safetyBusyUid === friend.uid}
                          onClick={() =>
                            void handleToggleBlock(friend.uid, friend.nickname || friend.displayName, true)
                          }
                          aria-label={`Block ${friend.nickname || friend.displayName}`}
                          className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-red-500/10 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <ShieldBan className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Block</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {blockedUsers.length > 0 && (
              <section className="m-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
                <button
                  type="button"
                  aria-expanded={blockedListOpen}
                  onClick={() => setBlockedListOpen((open) => !open)}
                  className="w-full min-h-11 px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
                >
                  <span>Blocked Accounts ({blockedUsers.length})</span>
                  {blockedListOpen ? (
                    <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                </button>
                {blockedListOpen && (
                  <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                    {blockedUsers.map((blk) => (
                      <div key={blk.id} className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[var(--text-secondary)] truncate">{blk.blockedUid}</span>
                        <button
                          type="button"
                          disabled={safetyBusyUid === blk.blockedUid}
                          onClick={() => void handleToggleBlock(blk.blockedUid, blk.blockedUid, false)}
                          className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
