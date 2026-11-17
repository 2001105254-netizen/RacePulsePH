import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { Search, UserCheck, UserPlus, Users2, X } from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { FriendActivity, FriendProfile, UserProfile } from '../../types';
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
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isDesktop: boolean;
  isSplitPane?: boolean;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

export default function RunnerFriendsPanel({
  profile,
  onOpenRace,
  onOpenProfile,
  searchQuery,
  onSearchQueryChange,
  isDesktop,
  isSplitPane = isDesktop,
  desktopSearchRef,
}: RunnerFriendsPanelProps) {
  const { can } = useAccess();
  const canInvites = can('personal.invites');
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResult, setSearchResult] = useState<FriendProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [activities, setActivities] = useState<Record<string, FriendActivity>>({});
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
  const [invites, setInvites] = useState<RaceInviteRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const mobileFilterRef = useRef<HTMLInputElement>(null);

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

  const search = async () => {
    const username = searchUsername.trim().toLowerCase();
    setError('');
    setNotice('');
    setSearchResult(null);
    if (!usernamePattern.test(username)) {
      setError('Enter an exact username (3 to 24 letters, numbers, dots, hyphens, or underscores).');
      return;
    }
    setBusy(true);
    try {
      const directory = await getDoc(doc(db, 'friendDirectory', username));
      if (!directory.exists()) {
        setError('No runner profile found for that username.');
      } else if ((directory.data() as FriendProfile).uid === profile.uid) {
        setError('That is your own profile.');
      } else {
        setSearchResult(directory.data() as FriendProfile);
      }
    } catch {
      setError('Could not search right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendFriendRequest = async () => {
    if (!searchResult || !profile.username) return;
    setBusy(true);
    setError('');
    try {
      if (friends.some((friend) => friend.uid === searchResult.uid)) {
        setNotice('You are already friends.');
        return;
      }
      if (outgoing.some((request) => request.toUid === searchResult.uid)) {
        setNotice('Friend request already sent.');
        return;
      }
      await setDoc(doc(db, 'friendRequests', `${profile.uid}_${searchResult.uid}`), {
        fromUid: profile.uid,
        toUid: searchResult.uid,
        fromUsername: profile.username,
        fromDisplayName: profile.nickname || profile.displayName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      } satisfies FriendRequestRecord);
      setNotice(`Friend request sent to @${searchResult.username}.`);
    } catch (err: any) {
      setError(err.message || 'Could not send the friend request.');
    } finally {
      setBusy(false);
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
  const visibleFriends = friendFilterTerm
    ? friends.filter(
        (friend) =>
          friend.displayName.toLowerCase().includes(friendFilterTerm) ||
          (friend.nickname || '').toLowerCase().includes(friendFilterTerm) ||
          friend.username.toLowerCase().includes(friendFilterTerm),
      )
    : friends;

  return (
    <div
      id="runner_friends_main"
      data-split-pane={isSplitPane ? 'true' : 'false'}
      className="w-full flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-y-contain min-[600px]:overflow-hidden"
    >
      <div className="flex-1 min-h-0 flex flex-col min-[600px]:grid min-[600px]:grid-cols-[minmax(236px,38%)_minmax(0,1fr)] min-[920px]:grid-cols-[340px_minmax(0,1fr)]">
        {/* LEFT PANE: Lookup, Race Invitations, Incoming Friend Requests */}
        <section
          aria-label="Find friends and requests"
          className="shrink-0 min-[600px]:shrink flex flex-col min-h-0 min-[600px]:h-full bg-[var(--surface-card)] min-[600px]:border-r border-b min-[600px]:border-b-0 border-[var(--border-default)] min-[600px]:overflow-hidden"
        >
          <div className="min-[600px]:flex-1 min-[600px]:min-h-0 min-[600px]:overflow-y-auto min-[600px]:overscroll-y-contain divide-y divide-[var(--border-subtle)]">
            <div className="p-3 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-700/10 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                  <Users2 className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold font-display uppercase tracking-wider text-[var(--text-primary)]">
                    Find Runner Friends
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    Search exact username. Both runners confirm before sharing activity.
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
                    Search exact runner username
                  </label>
                  <input
                    id="runner_friend_username_lookup"
                    value={searchUsername}
                    onChange={(event) => setSearchUsername(event.target.value.toLowerCase())}
                    placeholder="e.g. juan.runner"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={24}
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-11 rounded-xl bg-red-700 hover:bg-red-600 px-3.5 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60 shrink-0"
                >
                  Search
                </button>
              </form>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {notice}
                </p>
              )}

              {searchResult && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-700/10 dark:bg-red-500/10 font-semibold text-red-700 dark:text-red-400">
                      {searchResult.photoURL ? (
                        <img src={searchResult.photoURL} alt="" className="h-full w-full object-cover" />
                      ) : (
                        searchResult.displayName.charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-[var(--text-primary)]">
                        {searchResult.nickname || searchResult.displayName}
                      </strong>
                      <small className="block text-xs font-mono text-[var(--text-secondary)] truncate">
                        @{searchResult.username}
                      </small>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void sendFriendRequest()}
                    disabled={busy}
                    className="shrink-0 min-h-11 inline-flex items-center rounded-xl border border-red-700/35 bg-red-600/10 px-3 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 transition hover:bg-red-700 hover:text-white disabled:opacity-60"
                  >
                    <UserPlus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Add
                  </button>
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
                {friends.length}
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
                  Search a runner&apos;s exact username above to send your first friend request.
                </p>
              </div>
            ) : visibleFriends.length === 0 ? (
              <p className="p-3 text-xs text-[var(--text-secondary)]">
                No connected friends match &ldquo;{searchQuery}&rdquo;.
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
