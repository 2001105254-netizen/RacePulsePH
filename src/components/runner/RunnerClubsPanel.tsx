import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Flag,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trophy,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { useAccess } from '../../lib/access';
import { isClientNavigationClick } from '../../lib/appRouting';
import type { BadgeDefinition } from '../../lib/badges/types';
import {
  deleteClubMeetup,
  fetchClubLeaderboard,
  isSafeClubAssetUrl,
  joinClub,
  leaveClub,
  manageClubMember,
  saveClubAnnouncement,
  saveClubMeetup,
  saveClubSpotlight,
  setPrimaryClub,
  submitClubRequest,
  subscribeClubAnnouncements,
  subscribeClubCatalog,
  subscribeClubMeetups,
  subscribeClubMembers,
  subscribeClubRequests,
  subscribeClubSpotlight,
  subscribeMyClubMemberships,
} from '../../lib/clubs/client';
import {
  E2E_CLUBS_KEY,
  E2E_CLUB_ANNOUNCEMENTS_KEY,
  E2E_CLUB_MEETUPS_KEY,
  E2E_CLUB_MEMBERS_KEY,
  E2E_CLUB_REQUESTS_KEY,
  E2E_CLUB_SPOTLIGHTS_KEY,
  buildDevStarterClubs,
  manageDevClubMemberFixture,
  readDevSessionJson,
  submitDevClubRequestFixture,
  toggleDevClubMembershipFixture,
  writeDevSessionJson,
} from '../../lib/clubs/e2eFixtures';
import {
  CLUB_JOIN_POLICY_META,
  CLUB_MODULES,
  CLUB_MODULE_META,
  DEFAULT_CLUB_MODULES,
} from '../../lib/clubs/presets';
import {
  canManageClubAsRunner,
  filterClubsForRunner,
  resolveEnabledClubModules,
  type ClubDirectoryScope,
  type RunnerClubModuleTab,
} from '../../lib/clubs/runnerHelpers';
import { normalizeStudioHexColor } from '../../lib/clubs/studioDraft';
import type {
  ClubAnnouncementRecord,
  ClubDefinition,
  ClubLeaderboardEntry,
  ClubMeetupRecord,
  ClubMemberRecord,
  ClubModuleKey,
  ClubModuleMap,
  ClubRequestRecord,
  ClubSpotlightRecord,
} from '../../lib/clubs/types';
import { LEGAL_CONFIG } from '../../lib/legalConfig';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import type { RaceRouteCatalogEntry } from '../../lib/routes/types';
import { buildClubRequestMailtoHref } from '../../lib/runnerShell';
import { createCommunityRequestId } from '../../lib/runs/communityRunsClient';
import { formatDuration } from '../../lib/runs/runLiveHelpers';
import type { Race, UserProfile } from '../../types';
import BadgeArtwork from '../badges/BadgeArtwork';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import ReportContentDialog from './ReportContentDialog';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

export interface RunnerClubsPanelProps {
  uid: string;
  profile: UserProfile;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  races: Race[];
  publishedRoutes: RaceRouteCatalogEntry[];
  badgeCatalog: BadgeDefinition[];
  onOpenProfile?: () => void;
  onStartCourseRun?: (course: {
    raceId: string;
    distanceId: string;
    label: string;
    publicationId?: string;
  }) => void;
  onOpenClubChat?: (clubId: string) => void;
  onOpenExploreRace?: (raceId: string) => void;
  isDesktop: boolean;
  isSplitPane: boolean;
}

const MODULE_TAB_LABELS: Readonly<Record<RunnerClubModuleTab, string>> = {
  overview: 'Overview',
  leaderboard: 'Leaderboard',
  events: 'Meetups',
  announcements: 'Notices',
  roster: 'Roster',
};

function dispatchAppNavigate(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url } }));
}

export default function RunnerClubsPanel({
  uid,
  profile,
  searchQuery,
  onSearchQueryChange,
  races,
  publishedRoutes,
  badgeCatalog,
  onOpenProfile,
  onStartCourseRun,
  onOpenClubChat,
  onOpenExploreRace,
  isDesktop,
  isSplitPane,
}: RunnerClubsPanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { confirm, notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canViewClubsAdmin = isSuperAdmin || can('clubs.view');
  const canManageClubsAdmin = isSuperAdmin || can('clubs.manage');
  const canJoinClubs = can('personal.clubs');
  const isE2e = import.meta.env.DEV && uid.startsWith('e2e-');

  const [scope, setScope] = useState<ClubDirectoryScope>('all');
  const [clubs, setClubs] = useState<ClubDefinition[]>([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubsError, setClubsError] = useState<string | null>(null);

  const [myMemberships, setMyMemberships] = useState<ClubMemberRecord[]>([]);
  const [myRequests, setMyRequests] = useState<ClubRequestRecord[]>([]);
  const [primaryClubOverride, setPrimaryClubOverride] = useState<string | null | undefined>(undefined);

  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [moduleTab, setModuleTab] = useState<RunnerClubModuleTab>('overview');
  const moduleTabRefs = useRef<Partial<Record<RunnerClubModuleTab, HTMLButtonElement | null>>>({});

  const [members, setMembers] = useState<ClubMemberRecord[]>([]);
  const [meetups, setMeetups] = useState<ClubMeetupRecord[]>([]);
  const [announcements, setAnnouncements] = useState<ClubAnnouncementRecord[]>([]);
  const [spotlight, setSpotlight] = useState<ClubSpotlightRecord | null>(null);
  const [leaderboardWindow, setLeaderboardWindow] = useState<'7d' | '30d' | 'all'>('30d');
  const [leaderboardEntries, setLeaderboardEntries] = useState<ClubLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const [actionBusy, setActionBusy] = useState(false);
  const [reportClubTarget, setReportClubTarget] = useState<ClubDefinition | null>(null);

  // Request a Club dialog state
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqClubName, setReqClubName] = useState('');
  const [reqCity, setReqCity] = useState('');
  const [reqSchedule, setReqSchedule] = useState('');
  const [reqHandle, setReqHandle] = useState(profile.username ? `@${profile.username}` : '');
  const [reqNotes, setReqNotes] = useState('');
  const [reqModules, setReqModules] = useState<ClubModuleMap>({ ...DEFAULT_CLUB_MODULES });
  const [reqError, setReqError] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'fallback'>('idle');

  // Captain inline forms
  const [meetupFormOpen, setMeetupFormOpen] = useState(false);
  const [meetupTitle, setMeetupTitle] = useState('');
  const [meetupWhen, setMeetupWhen] = useState('');
  const [meetupPlace, setMeetupPlace] = useState('');
  const [meetupDistance, setMeetupDistance] = useState('5K / 10K');
  const [meetupNotes, setMeetupNotes] = useState('');

  const [noticeFormOpen, setNoticeFormOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticePinned, setNoticePinned] = useState(true);

  const [inviteUid, setInviteUid] = useState('');

  const activePrimaryClubId =
    primaryClubOverride !== undefined ? primaryClubOverride : profile.primaryClubId ?? null;

  useEffect(() => {
    if (isE2e) {
      const storedClubs = readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY);
      const initialClubs = storedClubs && storedClubs.length > 0 ? storedClubs : buildDevStarterClubs();
      if (!storedClubs) writeDevSessionJson(E2E_CLUBS_KEY, initialClubs);
      setClubs(initialClubs.filter((c) => c.status === 'active'));
      setClubsLoaded(true);
      setClubsError(null);

      const allMembers = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
      setMyMemberships(allMembers.filter((m) => m.uid === uid));
      const allReqs = readDevSessionJson<ClubRequestRecord>(E2E_CLUB_REQUESTS_KEY) ?? [];
      setMyRequests(allReqs.filter((r) => r.requesterUid === uid));
      return;
    }

    const unsubClubs = subscribeClubCatalog(
      (res) => {
        setClubs(res.clubs);
        setClubsLoaded(res.loaded);
        setClubsError(res.error);
      },
      { includeArchived: false },
    );
    const unsubMine = subscribeMyClubMemberships(uid, (res) => {
      setMyMemberships(res.memberships);
    });
    const unsubReqs = subscribeClubRequests(
      (res) => {
        setMyRequests(res.requests);
      },
      { requesterUid: uid },
    );
    return () => {
      unsubClubs();
      unsubMine();
      unsubReqs();
    };
  }, [isE2e, uid]);

  const filteredClubs = useMemo(
    () => filterClubsForRunner(clubs, myMemberships, { scope, query: searchQuery }),
    [clubs, myMemberships, scope, searchQuery],
  );

  const selectedClub = useMemo(() => {
    if (selectedClubId) {
      const found = filteredClubs.find((c) => c.clubId === selectedClubId) || clubs.find((c) => c.clubId === selectedClubId);
      if (found) return found;
    }
    if (activePrimaryClubId) {
      const primary = filteredClubs.find((c) => c.clubId === activePrimaryClubId);
      if (primary) return primary;
    }
    return filteredClubs[0] || clubs[0] || null;
  }, [selectedClubId, filteredClubs, clubs, activePrimaryClubId]);

  const mySelectedMembership = useMemo(
    () =>
      selectedClub
        ? myMemberships.find((m) => m.clubId === selectedClub.clubId) || null
        : null,
    [selectedClub, myMemberships],
  );
  const isActiveMember = mySelectedMembership?.status === 'active';
  const isPendingMember = mySelectedMembership?.status === 'pending';
  const isClubManager = canManageClubAsRunner(selectedClub, uid, canManageClubsAdmin);
  const canReadSelectedClubContent = Boolean(
    selectedClub &&
      (canViewClubsAdmin || isActiveMember || selectedClub.joinPolicy !== 'invite_only'),
  );

  const moduleTabs = useMemo(
    () => (selectedClub ? resolveEnabledClubModules(selectedClub) : ['overview' as RunnerClubModuleTab]),
    [selectedClub],
  );

  const effectiveModuleTab: RunnerClubModuleTab = moduleTabs.includes(moduleTab)
    ? moduleTab
    : 'overview';

  useEffect(() => {
    if (!selectedClub) {
      setMembers([]);
      setMeetups([]);
      setAnnouncements([]);
      setSpotlight(null);
      return;
    }
    if (isE2e) {
      const allMems = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
      setMembers(
        allMems.filter(
          (m) => m.clubId === selectedClub.clubId && (isClubManager || canViewClubsAdmin || m.status === 'active'),
        ),
      );
      if (canReadSelectedClubContent) {
        const allMeetups = readDevSessionJson<ClubMeetupRecord>(E2E_CLUB_MEETUPS_KEY) ?? [];
        setMeetups(allMeetups.filter((m) => m.clubId === selectedClub.clubId && m.status === 'scheduled'));
        const allNotices = readDevSessionJson<ClubAnnouncementRecord>(E2E_CLUB_ANNOUNCEMENTS_KEY) ?? [];
        setAnnouncements(allNotices.filter((a) => a.clubId === selectedClub.clubId));
        const allSpots = readDevSessionJson<ClubSpotlightRecord>(E2E_CLUB_SPOTLIGHTS_KEY) ?? [];
        setSpotlight(allSpots.find((s) => s.clubId === selectedClub.clubId) || null);
      } else {
        setMeetups([]);
        setAnnouncements([]);
        setSpotlight(null);
      }
      return;
    }

    const unsubMembers = subscribeClubMembers(
      selectedClub.clubId,
      (res) => setMembers(res.members),
      { includePending: isClubManager || canViewClubsAdmin },
    );
    const unsubMeetups =
      canReadSelectedClubContent && selectedClub.modules.events
        ? subscribeClubMeetups(selectedClub.clubId, (res) => setMeetups(res.meetups))
        : () => {
            setMeetups([]);
          };
    const unsubAnnouncements =
      canReadSelectedClubContent && selectedClub.modules.announcements
        ? subscribeClubAnnouncements(selectedClub.clubId, (res) => setAnnouncements(res.announcements))
        : () => {
            setAnnouncements([]);
          };
    const unsubSpotlight =
      canReadSelectedClubContent && selectedClub.modules.memberSpotlight
        ? subscribeClubSpotlight(selectedClub.clubId, (res) => setSpotlight(res.spotlight))
        : () => {
            setSpotlight(null);
          };

    return () => {
      unsubMembers();
      unsubMeetups();
      unsubAnnouncements();
      unsubSpotlight();
    };
  }, [
    selectedClub?.clubId,
    selectedClub?.modules.events,
    selectedClub?.modules.announcements,
    selectedClub?.modules.memberSpotlight,
    isClubManager,
    canViewClubsAdmin,
    canReadSelectedClubContent,
    isE2e,
  ]);

  useEffect(() => {
    if (
      !selectedClub ||
      effectiveModuleTab !== 'leaderboard' ||
      !selectedClub.modules.leaderboard ||
      !canReadSelectedClubContent
    ) {
      return;
    }
    if (isE2e) {
      setLeaderboardEntries([
        {
          uid,
          displayName: profile.nickname || profile.displayName || 'Runner',
          username: profile.username,
          role: isClubManager ? 'captain' : 'member',
          totalDistanceM: 42_500,
          totalMovingTimeMs: 13_800_000,
          totalElevationGainM: 310,
          verifiedRunsCount: 5,
        },
      ]);
      setLeaderboardLoading(false);
      return;
    }
    let cancelled = false;
    setLeaderboardLoading(true);
    void fetchClubLeaderboard(selectedClub.clubId, leaderboardWindow)
      .then((res) => {
        if (!cancelled) setLeaderboardEntries(res.entries || []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[RunnerClubsPanel] fetchClubLeaderboard failed:', err);
          setLeaderboardEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLeaderboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedClub?.clubId,
    selectedClub?.modules.leaderboard,
    effectiveModuleTab,
    leaderboardWindow,
    canReadSelectedClubContent,
    isE2e,
    uid,
    profile.nickname,
    profile.displayName,
    profile.username,
    isClubManager,
  ]);

  const badgeById = useMemo(
    () => new Map(badgeCatalog.map((b) => [b.badgeId, b])),
    [badgeCatalog],
  );
  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  const routeByKey = useMemo(() => {
    const map = new Map<string, RaceRouteCatalogEntry>();
    for (const r of publishedRoutes) {
      map.set(`${r.raceId}:${r.distanceId}`, r);
      map.set(r.id, r);
      if (r.currentPublicationId) map.set(r.currentPublicationId, r);
    }
    return map;
  }, [publishedRoutes]);

  const handleModuleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = moduleTabs.indexOf(effectiveModuleTab);
    if (currentIndex === -1) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % moduleTabs.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + moduleTabs.length) % moduleTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = moduleTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKey = moduleTabs[nextIndex];
    setModuleTab(nextKey);
    moduleTabRefs.current[nextKey]?.focus();
  };

  const handleJoin = async (club: ClubDefinition) => {
    if (!canJoinClubs || actionBusy) return;
    setActionBusy(true);
    try {
      if (isE2e) {
        const allClubs = readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY) ?? clubs;
        const allMems = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
        const out = toggleDevClubMembershipFixture(allClubs, allMems, {
          clubId: club.clubId,
          uid,
          displayName: profile.nickname || profile.displayName || 'Runner',
          username: profile.username,
          mode: 'join',
        });
        if (!mountedRef.current) return;
        setClubs(out.clubs.filter((c) => c.status === 'active'));
        setMyMemberships(out.members.filter((m) => m.uid === uid));
        setMembers(out.members.filter((m) => m.clubId === club.clubId));
        notify({
          tone: 'success',
          title: out.status === 'pending' ? 'Join request sent' : `Joined ${club.name}`,
        });
        return;
      }

      const res = await joinClub(club.clubId);
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: res.member.status === 'pending' ? 'Join request sent' : `Joined ${club.name}`,
        message:
          res.member.status === 'pending'
            ? 'A club captain or admin will review your membership.'
            : 'Club features and leaderboard are now active.',
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Unable to join club',
        message: err instanceof Error ? err.message : 'Try again shortly.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleLeave = async (club: ClubDefinition) => {
    if (actionBusy) return;
    if (!isPendingMember) {
      const ok = await confirm({
        title: `Leave ${club.name}?`,
        message: 'You will leave the club roster and club chat room until rejoining.',
        confirmLabel: 'Leave Club',
        destructive: true,
      });
      if (!ok) return;
    }
    setActionBusy(true);
    try {
      if (isE2e) {
        const allClubs = readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY) ?? clubs;
        const allMems = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
        const out = toggleDevClubMembershipFixture(allClubs, allMems, {
          clubId: club.clubId,
          uid,
          displayName: profile.displayName || 'Runner',
          mode: 'leave',
        });
        if (!mountedRef.current) return;
        setClubs(out.clubs.filter((c) => c.status === 'active'));
        setMyMemberships(out.members.filter((m) => m.uid === uid));
        setMembers(out.members.filter((m) => m.clubId === club.clubId));
        if (activePrimaryClubId === club.clubId) setPrimaryClubOverride(null);
      } else {
        await leaveClub(club.clubId);
        if (!mountedRef.current) return;
        if (activePrimaryClubId === club.clubId) setPrimaryClubOverride(null);
      }
      notify({
        tone: 'info',
        title: isPendingMember ? 'Join request canceled' : `Left ${club.name}`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Action failed',
        message: err instanceof Error ? err.message : 'Unable to leave club.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleTogglePrimary = async (club: ClubDefinition) => {
    if (!isActiveMember || actionBusy) return;
    const nextId = activePrimaryClubId === club.clubId ? null : club.clubId;
    setActionBusy(true);
    try {
      if (!isE2e) {
        await setPrimaryClub(nextId);
      }
      if (!mountedRef.current) return;
      setPrimaryClubOverride(nextId);
      notify({
        tone: 'success',
        title: nextId ? 'Primary club updated' : 'Primary club cleared',
        message: nextId ? `${club.name} now appears on your public runner card.` : undefined,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Primary club update failed',
        message: err instanceof Error ? err.message : 'Try again shortly.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleManageMember = async (
    club: ClubDefinition,
    targetUid: string,
    action: 'approve' | 'reject' | 'remove' | 'invite',
  ) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      if (isE2e) {
        const allMems = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
        const allClubs = readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY) ?? clubs;
        const out = manageDevClubMemberFixture(allMems, allClubs, {
          clubId: club.clubId,
          targetUid,
          action,
        });
        if (!mountedRef.current) return;
        setMembers(out.members.filter((m) => m.clubId === club.clubId));
        setClubs(out.clubs.filter((c) => c.status === 'active'));
      } else {
        await manageClubMember({ clubId: club.clubId, targetUid, action });
      }
      if (!mountedRef.current) return;
      notify({ tone: 'success', title: 'Member roster updated' });
      if (action === 'invite') setInviteUid('');
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Member update failed',
        message: err instanceof Error ? err.message : 'Unable to update member.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleCreateMeetup = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedClub || actionBusy) return;
    if (meetupTitle.trim().length < 2 || meetupPlace.trim().length < 2 || !meetupWhen) {
      notify({ tone: 'error', title: 'Enter meetup title, time, and meetup point.' });
      return;
    }
    const iso = new Date(meetupWhen).toISOString();
    setActionBusy(true);
    try {
      const meetupId = `mtu_${createCommunityRequestId().replace(/-/g, '').slice(0, 16)}`;
      if (isE2e) {
        const existing = readDevSessionJson<ClubMeetupRecord>(E2E_CLUB_MEETUPS_KEY) ?? [];
        const nowIso = new Date().toISOString();
        const created: ClubMeetupRecord = {
          meetupId,
          clubId: selectedClub.clubId,
          title: meetupTitle.trim(),
          description: meetupNotes.trim(),
          startAtIso: iso,
          locationName: meetupPlace.trim(),
          lat: null,
          lon: null,
          routeId: null,
          distanceLabel: meetupDistance.trim() || 'Open',
          status: 'scheduled',
          createdAt: nowIso,
          createdBy: uid,
          updatedAt: nowIso,
        };
        const next = [created, ...existing];
        writeDevSessionJson(E2E_CLUB_MEETUPS_KEY, next);
        setMeetups(next.filter((m) => m.clubId === selectedClub.clubId && m.status === 'scheduled'));
      } else {
        await saveClubMeetup({
          meetupId,
          clubId: selectedClub.clubId,
          title: meetupTitle.trim(),
          description: meetupNotes.trim(),
          startAtIso: iso,
          locationName: meetupPlace.trim(),
          distanceLabel: meetupDistance.trim() || 'Open',
        });
      }
      if (!mountedRef.current) return;
      setMeetupTitle('');
      setMeetupPlace('');
      setMeetupNotes('');
      setMeetupFormOpen(false);
      notify({ tone: 'success', title: 'Meetup scheduled' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Unable to save meetup',
        message: err instanceof Error ? err.message : 'Check fields and retry.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleCancelMeetup = async (meetup: ClubMeetupRecord) => {
    if (!selectedClub || actionBusy) return;
    setActionBusy(true);
    try {
      if (isE2e) {
        const existing = readDevSessionJson<ClubMeetupRecord>(E2E_CLUB_MEETUPS_KEY) ?? [];
        const next = existing.filter((m) => m.meetupId !== meetup.meetupId);
        writeDevSessionJson(E2E_CLUB_MEETUPS_KEY, next);
        setMeetups(next.filter((m) => m.clubId === selectedClub.clubId && m.status === 'scheduled'));
      } else {
        await deleteClubMeetup(selectedClub.clubId, meetup.meetupId);
      }
      if (!mountedRef.current) return;
      notify({ tone: 'info', title: 'Meetup removed' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Unable to remove meetup',
        message: err instanceof Error ? err.message : 'Try again shortly.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleCreateNotice = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedClub || actionBusy) return;
    if (noticeTitle.trim().length < 2 || noticeBody.trim().length < 2) {
      notify({ tone: 'error', title: 'Enter notice headline and message.' });
      return;
    }
    setActionBusy(true);
    try {
      const announcementId = `ann_${createCommunityRequestId().replace(/-/g, '').slice(0, 16)}`;
      if (isE2e) {
        const existing = readDevSessionJson<ClubAnnouncementRecord>(E2E_CLUB_ANNOUNCEMENTS_KEY) ?? [];
        const nowIso = new Date().toISOString();
        const created: ClubAnnouncementRecord = {
          announcementId,
          clubId: selectedClub.clubId,
          title: noticeTitle.trim(),
          body: noticeBody.trim(),
          pinned: noticePinned,
          createdAt: nowIso,
          createdBy: uid,
          updatedAt: nowIso,
        };
        const next = [created, ...existing];
        writeDevSessionJson(E2E_CLUB_ANNOUNCEMENTS_KEY, next);
        setAnnouncements(next.filter((a) => a.clubId === selectedClub.clubId));
      } else {
        await saveClubAnnouncement({
          announcementId,
          clubId: selectedClub.clubId,
          title: noticeTitle.trim(),
          body: noticeBody.trim(),
          pinned: noticePinned,
        });
      }
      if (!mountedRef.current) return;
      setNoticeTitle('');
      setNoticeBody('');
      setNoticeFormOpen(false);
      notify({ tone: 'success', title: 'Announcement posted' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Unable to post announcement',
        message: err instanceof Error ? err.message : 'Check fields and retry.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleFeatureSpotlight = async (member: ClubMemberRecord) => {
    if (!selectedClub || actionBusy) return;
    setActionBusy(true);
    try {
      if (isE2e) {
        const existing = readDevSessionJson<ClubSpotlightRecord>(E2E_CLUB_SPOTLIGHTS_KEY) ?? [];
        const spot: ClubSpotlightRecord = {
          clubId: selectedClub.clubId,
          targetUid: member.uid,
          headline: `Featured Club Runner: ${member.displayName || member.uid}`,
          note: `${selectedClub.name} crew highlight`,
          featuredAt: new Date().toISOString(),
          featuredBy: uid,
        };
        const next = [spot, ...existing.filter((s) => s.clubId !== selectedClub.clubId)];
        writeDevSessionJson(E2E_CLUB_SPOTLIGHTS_KEY, next);
        setSpotlight(spot);
      } else {
        await saveClubSpotlight({
          clubId: selectedClub.clubId,
          targetUid: member.uid,
          headline: `Featured Club Runner: ${member.displayName || member.uid}`,
          note: `${selectedClub.name} crew highlight`,
        });
      }
      if (!mountedRef.current) return;
      notify({ tone: 'success', title: 'Member Spotlight updated' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Unable to update spotlight',
        message: err instanceof Error ? err.message : 'Try again shortly.',
      });
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const handleSubmitClubRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (reqSubmitting) return;
    if (reqClubName.trim().length < 2 || reqCity.trim().length < 2 || reqSchedule.trim().length < 2) {
      setReqError('Enter your club name, city, and weekly meetup schedule.');
      return;
    }
    setReqSubmitting(true);
    setReqError('');
    try {
      const reqId = `cr_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      if (isE2e) {
        const existing = readDevSessionJson<ClubRequestRecord>(E2E_CLUB_REQUESTS_KEY) ?? [];
        const out = submitDevClubRequestFixture(existing, {
          requestId: reqId,
          requesterUid: uid,
          clubName: reqClubName.trim(),
          city: reqCity.trim(),
          scheduleSummary: reqSchedule.trim(),
          notes: reqNotes.trim(),
          contactHandle: reqHandle.trim(),
          desiredModules: reqModules,
        });
        if (!mountedRef.current) return;
        setMyRequests(out.requests.filter((r) => r.requesterUid === uid));
      } else {
        await submitClubRequest({
          clubRequestId: reqId,
          clubName: reqClubName.trim(),
          city: reqCity.trim(),
          scheduleSummary: reqSchedule.trim(),
          notes: reqNotes.trim(),
          contactHandle: reqHandle.trim(),
          desiredModules: reqModules,
        });
      }
      if (!mountedRef.current) return;
      setReqClubName('');
      setReqCity('');
      setReqSchedule('');
      setReqNotes('');
      setRequestOpen(false);
      notify({
        tone: 'success',
        title: 'Club request sent',
        message: 'RacePulsePH admins will review your club request shortly.',
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setReqError(err instanceof Error && err.message ? err.message : 'Unable to send club request.');
    } finally {
      if (mountedRef.current) setReqSubmitting(false);
    }
  };

  const clubMailtoHref = useMemo(
    () =>
      buildClubRequestMailtoHref({
        supportEmail: LEGAL_CONFIG.supportEmail,
        runnerDisplayName: profile.nickname || profile.displayName,
        runnerUsername: profile.username,
        currentRunClub: profile.runClub,
      }),
    [profile.nickname, profile.displayName, profile.username, profile.runClub],
  );

  const handleCopyEmail = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(LEGAL_CONFIG.supportEmail);
        setCopyStatus('copied');
        return;
      }
    } catch {
      // Clipboard blocked
    }
    setCopyStatus('fallback');
  };

  const showDirectoryPane = isSplitPane || !mobileDetailOpen || !selectedClub;
  const showDetailPane = isSplitPane || (mobileDetailOpen && Boolean(selectedClub));

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--surface-page)]">
      {/* Compact Sticky Filter & Action Header */}
      <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Filter clubs by membership" className="inline-flex items-center gap-1.5">
            {(
              [
                ['all', 'All Clubs', clubs.length],
                [
                  'mine',
                  'My Clubs',
                  myMemberships.filter((m) => m.status === 'active' || m.status === 'pending').length,
                ],
              ] as const
            ).map(([key, label, count]) => {
              const active = scope === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(key)}
                  className={`min-h-11 lg:min-h-9 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
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

          <div className="flex items-center gap-2">
            {onOpenProfile && !activePrimaryClubId && profile.runClub && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="min-h-11 lg:min-h-9 px-3 rounded-lg border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap cursor-pointer"
              >
                Profile Club: {profile.runClub}
              </button>
            )}
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="min-h-11 lg:min-h-9 px-3.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Request a Club</span>
            </button>
          </div>
        </div>

        {!isDesktop && (
          <div className="relative">
            <Search
              className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor={`${baseId}-mobile-search`} className="sr-only">
              Search running clubs
            </label>
            <input
              id={`${baseId}-mobile-search`}
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search clubs, cities, schedules..."
              className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-11 text-sm font-normal text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus-visible:ring-red-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                aria-label="Clear club search"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Split-Pane / Master-Detail Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {showDirectoryPane && (
          <aside
            aria-label="Running clubs directory"
            className={`${
              isSplitPane
                ? 'w-[340px] lg:w-[360px] shrink-0 border-r border-[var(--border-default)]'
                : 'w-full'
            } min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll bg-[var(--surface-card)]`}
          >
            {clubsError && (
              <p role="alert" className="m-3 rounded-xl border border-red-600/35 bg-red-500/10 p-3 text-xs font-semibold text-red-700 dark:text-red-300">
                {clubsError}
              </p>
            )}
            {!clubsLoaded ? (
              <RunnerQueueSkeleton rows={4} label="Loading Philippine running clubs" />
            ) : filteredClubs.length === 0 ? (
              <div className="p-6 text-center space-y-2.5">
                <Users2 className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {scope === 'mine' ? 'No joined clubs yet' : 'No matching running clubs'}
                </p>
                <p className="text-xs font-normal text-[var(--text-secondary)]">
                  {scope === 'mine'
                    ? 'Join an open Philippine club or submit a club creation request.'
                    : 'Clear search or request your local running crew.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {filteredClubs.map((club) => {
                  const selected = selectedClub?.clubId === club.clubId && isSplitPane;
                  const mem = myMemberships.find((m) => m.clubId === club.clubId);
                  const primaryColor = club.modules.customTheme
                    ? normalizeStudioHexColor(club.primaryColor, '#DC2626')
                    : '#DC2626';
                  return (
                    <button
                      key={club.clubId}
                      type="button"
                      onClick={() => {
                        setSelectedClubId(club.clubId);
                        setModuleTab('overview');
                        if (!isSplitPane) setMobileDetailOpen(true);
                      }}
                      className={`w-full text-left p-3.5 space-y-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                        selected
                          ? 'bg-red-500/10 border-l-4 border-l-red-600'
                          : 'hover:bg-[var(--surface-hover)] border-l-4 border-l-transparent'
                      }`}
                    >
                      <div
                        className="h-1 w-full rounded-full"
                        style={{ backgroundColor: primaryColor }}
                        aria-hidden="true"
                      />
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-10 h-10 rounded-xl overflow-hidden bg-[var(--surface-inset)] flex items-center justify-center shrink-0 text-sm font-semibold text-[var(--text-primary)]"
                            style={{ border: `2px solid ${primaryColor}` }}
                          >
                            {club.logoUrl && isSafeClubAssetUrl(club.logoUrl, club.logoStoragePath) ? (
                              <img src={club.logoUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              club.name.charAt(0).toUpperCase()
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="font-display font-semibold text-sm text-[var(--text-primary)] truncate">
                              {club.name}
                            </p>
                            <p className="text-xs font-normal text-[var(--text-secondary)] truncate">
                              {club.city} · {club.scheduleSummary}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] shrink-0">
                          {club.memberCount}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)]">
                          {CLUB_JOIN_POLICY_META[club.joinPolicy]?.label || club.joinPolicy}
                        </span>
                        {mem?.status === 'active' && (
                          <span className="px-2 py-0.5 rounded-md border border-emerald-600/35 bg-emerald-500/10 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                            {activePrimaryClubId === club.clubId ? 'Primary' : 'Joined'}
                          </span>
                        )}
                        {mem?.status === 'pending' && (
                          <span className="px-2 py-0.5 rounded-md border border-amber-600/35 bg-amber-500/10 text-xs font-semibold text-amber-900 dark:text-amber-300">
                            Pending
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {showDetailPane && (
          <section
            aria-label="Selected club details"
            className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll p-3 sm:p-4 space-y-4"
          >
            {!selectedClub ? (
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-2">
                <Users2 className="w-8 h-8 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Select a club to explore its schedule and modules
                </p>
              </div>
            ) : (
              <>
                {!isSplitPane && (
                  <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-[var(--surface-page)]/95 backdrop-blur border-b border-[var(--border-subtle)]">
                    <button
                      type="button"
                      onClick={() => setMobileDetailOpen(false)}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Back to Clubs</span>
                    </button>
                  </div>
                )}

                {/* Club Hero Summary Card */}
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
                  <div
                    className="h-2 w-full"
                    style={{
                      background: `linear-gradient(90deg, ${
                        selectedClub.modules.customTheme
                          ? normalizeStudioHexColor(selectedClub.primaryColor, '#DC2626')
                          : '#DC2626'
                      }, ${
                        selectedClub.modules.customTheme
                          ? normalizeStudioHexColor(selectedClub.accentColor, '#F59E0B')
                          : '#F59E0B'
                      })`,
                    }}
                    aria-hidden="true"
                  />
                  <div className="p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className="w-12 h-12 rounded-2xl overflow-hidden bg-[var(--surface-inset)] flex items-center justify-center shrink-0 text-base font-semibold text-[var(--text-primary)]"
                          style={{
                            border: `2px solid ${
                              selectedClub.modules.customTheme
                                ? normalizeStudioHexColor(selectedClub.primaryColor, '#DC2626')
                                : '#DC2626'
                            }`,
                          }}
                        >
                          {selectedClub.logoUrl &&
                          isSafeClubAssetUrl(selectedClub.logoUrl, selectedClub.logoStoragePath) ? (
                            <img src={selectedClub.logoUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            selectedClub.name.charAt(0).toUpperCase()
                          )}
                        </span>
                        <div className="min-w-0 space-y-1">
                          <h2 className="font-display font-semibold text-lg sm:text-xl text-[var(--text-primary)] leading-tight">
                            {selectedClub.name}
                          </h2>
                          <p className="text-xs font-normal text-[var(--text-secondary)]">
                            {selectedClub.city} · {selectedClub.scheduleSummary}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                              {selectedClub.memberCount}{' '}
                              {selectedClub.memberCount === 1 ? 'member' : 'members'}
                              {selectedClub.memberLimit ? ` / ${selectedClub.memberLimit}` : ''}
                            </span>
                            <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)]">
                              {CLUB_JOIN_POLICY_META[selectedClub.joinPolicy]?.label || selectedClub.joinPolicy}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {!isActiveMember && !isPendingMember && selectedClub.joinPolicy !== 'invite_only' && canJoinClubs && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void handleJoin(selectedClub)}
                            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                          >
                            <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>
                              {selectedClub.joinPolicy === 'approval' ? 'Request to Join' : 'Join Club'}
                            </span>
                          </button>
                        )}
                        {isPendingMember && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void handleLeave(selectedClub)}
                            className="min-h-11 px-3.5 rounded-xl border border-amber-600/40 bg-amber-500/10 text-xs font-semibold text-amber-900 dark:text-amber-300 cursor-pointer"
                          >
                            Pending · Cancel Request
                          </button>
                        )}
                        {isActiveMember && (
                          <>
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() => void handleTogglePrimary(selectedClub)}
                              aria-pressed={activePrimaryClubId === selectedClub.clubId}
                              className={`min-h-11 px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                                activePrimaryClubId === selectedClub.clubId
                                  ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                                  : 'border-[var(--border-button)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>
                                {activePrimaryClubId === selectedClub.clubId ? 'Primary Club' : 'Set Primary'}
                              </span>
                            </button>
                            {selectedClub.modules.chat && onOpenClubChat && (
                              <button
                                type="button"
                                onClick={() => onOpenClubChat(selectedClub.clubId)}
                                className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <MessageSquare className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>Open Chat</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() => void handleLeave(selectedClub)}
                              className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Leave</span>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setReportClubTarget(selectedClub)}
                          aria-label={`Report ${selectedClub.name}`}
                          className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Report</span>
                        </button>
                      </div>
                    </div>

                    {/* Instant Module Tabs */}
                    <div
                      role="tablist"
                      aria-label="Club sections"
                      onKeyDown={handleModuleTabKeyDown}
                      className="rp-tablist-scroll items-center gap-1 pt-2 border-t border-[var(--border-subtle)]"
                    >
                      {moduleTabs.map((key) => {
                        const active = effectiveModuleTab === key;
                        return (
                          <button
                            key={key}
                            ref={(el) => {
                              moduleTabRefs.current[key] = el;
                            }}
                            id={`${baseId}-club-tab-${key}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-controls={`${baseId}-club-panel`}
                            tabIndex={active ? 0 : -1}
                            onClick={() => setModuleTab(key)}
                            className={`min-h-11 lg:min-h-9 px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                              active
                                ? 'border-red-600 bg-red-700 text-white'
                                : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                            }`}
                          >
                            {MODULE_TAB_LABELS[key]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Active Module Panel */}
                <div
                  role="tabpanel"
                  id={`${baseId}-club-panel`}
                  aria-labelledby={`${baseId}-club-tab-${effectiveModuleTab}`}
                  className="space-y-4"
                >
                  {effectiveModuleTab === 'overview' && (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-2">
                        <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                          About this club
                        </h3>
                        <p className="text-sm font-normal text-[var(--text-secondary)] leading-relaxed">
                          {selectedClub.description || 'Active Philippine running group.'}
                        </p>
                      </div>

                      {selectedClub.modules.memberSpotlight && canReadSelectedClubContent && spotlight && (
                        <div className="rounded-2xl border border-amber-600/35 bg-[var(--surface-card)] p-4 flex items-start gap-3">
                          <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                          <div className="space-y-1 min-w-0">
                            <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                              {spotlight.headline}
                            </h3>
                            {spotlight.note && (
                              <p className="text-xs font-normal text-[var(--text-secondary)]">
                                {spotlight.note}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {selectedClub.modules.badges && selectedClub.linkedBadgeIds.length > 0 && (
                        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                          <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                            Linked Finisher Badges ({selectedClub.linkedBadgeIds.length})
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {selectedClub.linkedBadgeIds.map((badgeId) => {
                              const badge = badgeById.get(badgeId);
                              if (!badge) {
                                return (
                                  <div key={badgeId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-xs font-mono text-[var(--text-primary)]">
                                    {badgeId}
                                  </div>
                                );
                              }
                              return (
                                <div key={badgeId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 flex items-center gap-3">
                                  <BadgeArtwork badge={badge} size="sm" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                      {badge.name}
                                    </p>
                                    <p className="text-xs font-normal text-[var(--text-secondary)] truncate">
                                      +{badge.xpReward} XP · {badge.tier}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {selectedClub.modules.routeLibrary && selectedClub.featuredRouteIds.length > 0 && (
                        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                          <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                            Featured Club Routes ({selectedClub.featuredRouteIds.length})
                          </h3>
                          <div className="space-y-2">
                            {selectedClub.featuredRouteIds.map((rid) => {
                              const route = routeByKey.get(rid);
                              if (!route) {
                                return (
                                  <p key={rid} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs font-mono text-[var(--text-primary)]">
                                    {rid}
                                  </p>
                                );
                              }
                              const path = buildRaceCoursePath(
                                route.raceId,
                                route.distanceId,
                                route.currentPublicationId,
                              );
                              return (
                                <div key={rid} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 flex flex-wrap items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                      {route.raceName} · {route.distanceLabel}
                                    </p>
                                    <p className="text-xs font-mono text-[var(--text-secondary)]">
                                      {(route.measuredDistanceM / 1000).toFixed(2)} km · {route.region}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <a
                                      href={path}
                                      onClick={(e) => {
                                        if (isClientNavigationClick(e)) {
                                          e.preventDefault();
                                          dispatchAppNavigate(path);
                                        }
                                      }}
                                      className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center"
                                    >
                                      Open Map
                                    </a>
                                    {onStartCourseRun && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onStartCourseRun({
                                            raceId: route.raceId,
                                            distanceId: route.distanceId,
                                            label: `${route.raceName} (${route.distanceLabel})`,
                                            publicationId: route.currentPublicationId,
                                          })
                                        }
                                        className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer"
                                      >
                                        Run Course
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {selectedClub.linkedRaceIds.length > 0 && (
                        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-2.5">
                          <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                            Linked Target Races ({selectedClub.linkedRaceIds.length})
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {selectedClub.linkedRaceIds.map((raceId) => {
                              const race = raceById.get(raceId);
                              return (
                                <button
                                  key={raceId}
                                  type="button"
                                  disabled={!onOpenExploreRace}
                                  onClick={() => onOpenExploreRace?.(raceId)}
                                  className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Trophy className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                                  <span>{race ? `${race.name} (${race.date})` : raceId}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {effectiveModuleTab === 'leaderboard' && (
                    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                          Verified Club Leaderboard
                        </h3>
                        <div role="group" aria-label="Leaderboard timeframe" className="inline-flex items-center gap-1">
                          {(['7d', '30d', 'all'] as const).map((win) => (
                            <button
                              key={win}
                              type="button"
                              aria-pressed={leaderboardWindow === win}
                              onClick={() => setLeaderboardWindow(win)}
                              className={`min-h-11 lg:min-h-9 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                                leaderboardWindow === win
                                  ? 'border-red-600 bg-red-700 text-white'
                                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                              }`}
                            >
                              {win === '7d' ? '7 Days' : win === '30d' ? '30 Days' : 'All Time'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {!canReadSelectedClubContent ? (
                        <p className="text-xs font-normal text-[var(--text-secondary)]">
                          Invite-only leaderboard is visible to active members.
                        </p>
                      ) : leaderboardLoading ? (
                        <RunnerQueueSkeleton rows={3} label="Loading club leaderboard" />
                      ) : leaderboardEntries.length === 0 ? (
                        <p className="text-xs font-normal text-[var(--text-secondary)] py-4">
                          No recorded club runs in this period yet. Record a run with club or public visibility to rank here.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                                <th className="py-2 pr-2 font-semibold">#</th>
                                <th className="py-2 pr-2 font-semibold">Runner</th>
                                <th className="py-2 pr-2 font-semibold text-right">Distance</th>
                                <th className="py-2 pr-2 font-semibold text-right">Time</th>
                                <th className="py-2 font-semibold text-right">Runs</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)] font-mono tabular-nums">
                              {leaderboardEntries.map((entry, idx) => (
                                <tr key={entry.uid}>
                                  <td className="py-2.5 pr-2 font-semibold text-red-700 dark:text-red-400">
                                    {idx + 1}
                                  </td>
                                  <td className="py-2.5 pr-2 font-sans font-semibold text-[var(--text-primary)]">
                                    {entry.displayName}
                                    {entry.role === 'captain' ? ' (Captain)' : ''}
                                  </td>
                                  <td className="py-2.5 pr-2 text-right font-semibold text-[var(--text-primary)]">
                                    {(entry.totalDistanceM / 1000).toFixed(2)} km
                                  </td>
                                  <td className="py-2.5 pr-2 text-right text-[var(--text-secondary)]">
                                    {formatDuration(entry.totalMovingTimeMs)}
                                  </td>
                                  <td className="py-2.5 text-right text-[var(--text-secondary)]">
                                    {entry.verifiedRunsCount}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {effectiveModuleTab === 'events' && (
                    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                          Scheduled Club Meetups
                        </h3>
                        {isClubManager && (
                          <button
                            type="button"
                            onClick={() => setMeetupFormOpen((v) => !v)}
                            className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{meetupFormOpen ? 'Close Form' : 'Schedule Meetup'}</span>
                          </button>
                        )}
                      </div>

                      {isClubManager && meetupFormOpen && (
                        <form onSubmit={handleCreateMeetup} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              aria-label="Meetup title"
                              value={meetupTitle}
                              onChange={(e) => setMeetupTitle(e.target.value)}
                              placeholder="Saturday Long Run"
                              required
                              className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                            />
                            <input
                              aria-label="Meetup start date and time"
                              type="datetime-local"
                              value={meetupWhen}
                              onChange={(e) => setMeetupWhen(e.target.value)}
                              required
                              className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                            />
                            <input
                              aria-label="Meetup location"
                              value={meetupPlace}
                              onChange={(e) => setMeetupPlace(e.target.value)}
                              placeholder="Track Oval Entrance"
                              required
                              className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                            />
                            <input
                              aria-label="Distance group"
                              value={meetupDistance}
                              onChange={(e) => setMeetupDistance(e.target.value)}
                              placeholder="10K / 16K"
                              className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                            />
                          </div>
                          <input
                            aria-label="Meetup pace or hydration notes"
                            value={meetupNotes}
                            onChange={(e) => setMeetupNotes(e.target.value)}
                            placeholder="Pace groups, baggage, and water stop notes"
                            className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                          />
                          <button
                            type="submit"
                            disabled={actionBusy}
                            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                          >
                            Save Meetup
                          </button>
                        </form>
                      )}

                      {!canReadSelectedClubContent ? (
                        <p className="text-xs text-[var(--text-secondary)]">
                          Invite-only meetups are visible to active members.
                        </p>
                      ) : meetups.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] py-3">
                          No upcoming club meetups posted yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-[var(--border-subtle)]">
                          {meetups.map((m) => (
                            <div key={m.meetupId} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <div className="space-y-0.5 min-w-0">
                                <p className="text-sm font-semibold text-[var(--text-primary)]">
                                  {m.title}
                                  {m.distanceLabel ? ` · ${m.distanceLabel}` : ''}
                                </p>
                                <p className="text-xs font-mono text-[var(--text-secondary)] flex flex-wrap items-center gap-3">
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                                    {m.startAtIso.slice(0, 16).replace('T', ' ')}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                                    {m.locationName}
                                  </span>
                                </p>
                                {m.description && (
                                  <p className="text-xs text-[var(--text-secondary)]">{m.description}</p>
                                )}
                              </div>
                              {isClubManager && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleCancelMeetup(m)}
                                  className="min-h-11 px-3 rounded-xl border border-red-600/35 bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 shrink-0 cursor-pointer"
                                >
                                  Cancel Meetup
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {effectiveModuleTab === 'announcements' && (
                    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                          Club Announcements
                        </h3>
                        {isClubManager && (
                          <button
                            type="button"
                            onClick={() => setNoticeFormOpen((v) => !v)}
                            className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{noticeFormOpen ? 'Close Form' : 'Post Notice'}</span>
                          </button>
                        )}
                      </div>

                      {isClubManager && noticeFormOpen && (
                        <form onSubmit={handleCreateNotice} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
                          <input
                            aria-label="Announcement title"
                            value={noticeTitle}
                            onChange={(e) => setNoticeTitle(e.target.value)}
                            placeholder="Announcement headline"
                            required
                            className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
                          />
                          <textarea
                            aria-label="Announcement message"
                            rows={3}
                            value={noticeBody}
                            onChange={(e) => setNoticeBody(e.target.value)}
                            placeholder="Share schedule changes, pacer assignments, or kit reminders"
                            required
                            className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] p-3 text-sm text-[var(--text-primary)]"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer min-h-11">
                              <input
                                type="checkbox"
                                checked={noticePinned}
                                onChange={(e) => setNoticePinned(e.target.checked)}
                                className="w-4 h-4 accent-red-700"
                              />
                              <span>Pin notice at top</span>
                            </label>
                            <button
                              type="submit"
                              disabled={actionBusy}
                              className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                            >
                              Publish Notice
                            </button>
                          </div>
                        </form>
                      )}

                      {!canReadSelectedClubContent ? (
                        <p className="text-xs text-[var(--text-secondary)]">
                          Invite-only notices are visible to active members.
                        </p>
                      ) : announcements.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] py-3">
                          No announcements yet.
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {announcements.map((a) => (
                            <article key={a.announcementId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{a.title}</h4>
                                {a.pinned && (
                                  <span className="px-2 py-0.5 rounded-md bg-red-700/15 text-red-700 dark:text-red-300 text-xs font-semibold">
                                    Pinned
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-normal text-[var(--text-secondary)] whitespace-pre-wrap">
                                {a.body}
                              </p>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {effectiveModuleTab === 'roster' && (
                    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                      <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                        Members & Captains ({members.length})
                      </h3>

                      {isClubManager && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!inviteUid.trim()) return;
                            void handleManageMember(selectedClub, inviteUid.trim(), 'invite');
                          }}
                          className="flex flex-wrap gap-2"
                        >
                          <input
                            aria-label="Invite member by UID"
                            value={inviteUid}
                            onChange={(e) => setInviteUid(e.target.value)}
                            placeholder="Onboard runner UID"
                            className="flex-1 min-w-[180px] min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                          />
                          <button
                            type="submit"
                            disabled={actionBusy || !inviteUid.trim()}
                            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                          >
                            Invite Member
                          </button>
                        </form>
                      )}

                      {members.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] py-3">
                          No visible members yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-[var(--border-subtle)]">
                          {members.map((mem) => (
                            <div key={mem.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                  {mem.displayName || mem.uid}
                                  {mem.role === 'captain' ? ' · Captain' : ''}
                                </p>
                                <p className="text-xs font-mono text-[var(--text-secondary)]">
                                  {mem.username ? `@${mem.username}` : mem.uid} · {mem.status}
                                </p>
                              </div>
                              {isClubManager && (
                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  {mem.status === 'pending' && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() => void handleManageMember(selectedClub, mem.uid, 'approve')}
                                        className="min-h-11 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() => void handleManageMember(selectedClub, mem.uid, 'reject')}
                                        className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)] cursor-pointer"
                                      >
                                        Decline
                                      </button>
                                    </>
                                  )}
                                  {mem.status === 'active' && selectedClub.modules.memberSpotlight && (
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() => void handleFeatureSpotlight(mem)}
                                      className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                                    >
                                      Spotlight
                                    </button>
                                  )}
                                  {mem.uid !== uid && mem.status === 'active' && (
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() => void handleManageMember(selectedClub, mem.uid, 'remove')}
                                      className="min-h-11 px-3 rounded-xl border border-red-600/35 bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 cursor-pointer"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {/* Request a Club Sheet */}
      {requestOpen && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick={!reqSubmitting}
          maxWidthCss="34rem"
          titleId={`${baseId}-req-title`}
          onRequestClose={() => {
            if (!reqSubmitting) setRequestOpen(false);
          }}
          bodyClassName="p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <h2 id={`${baseId}-req-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
                Request a Club Page
              </h2>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                Submit your Philippine running club proposal for RacePulsePH Admin provisioning.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!reqSubmitting) setRequestOpen(false);
              }}
              aria-label="Close request club modal"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={handleSubmitClubRequest} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={`${baseId}-req-name`} className="block text-xs font-semibold text-[var(--text-primary)]">
                  Club Name
                </label>
                <input
                  id={`${baseId}-req-name`}
                  value={reqClubName}
                  onChange={(e) => setReqClubName(e.target.value)}
                  required
                  placeholder="BGC Striders PH"
                  className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${baseId}-req-city`} className="block text-xs font-semibold text-[var(--text-primary)]">
                  Home City / Region
                </label>
                <input
                  id={`${baseId}-req-city`}
                  value={reqCity}
                  onChange={(e) => setReqCity(e.target.value)}
                  required
                  placeholder="Taguig / Metro Manila"
                  className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={`${baseId}-req-sched`} className="block text-xs font-semibold text-[var(--text-primary)]">
                  Meetup Schedule
                </label>
                <input
                  id={`${baseId}-req-sched`}
                  value={reqSchedule}
                  onChange={(e) => setReqSchedule(e.target.value)}
                  required
                  placeholder="Wed & Sat 05:30 AM PHT"
                  className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${baseId}-req-handle`} className="block text-xs font-semibold text-[var(--text-primary)]">
                  Captain Contact / Handle
                </label>
                <input
                  id={`${baseId}-req-handle`}
                  value={reqHandle}
                  onChange={(e) => setReqHandle(e.target.value)}
                  placeholder="@bgcstriders"
                  className="w-full min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--text-primary)]">
                Desired Club Modules
              </span>
              <div className="grid grid-cols-2 gap-2">
                {CLUB_MODULES.map((modKey: ClubModuleKey) => (
                  <label
                    key={modKey}
                    className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={reqModules[modKey]}
                      onChange={(e) =>
                        setReqModules((prev) => ({ ...prev, [modKey]: e.target.checked }))
                      }
                      className="w-4 h-4 accent-red-700"
                    />
                    <span>{CLUB_MODULE_META[modKey].label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor={`${baseId}-req-notes`} className="block text-xs font-semibold text-[var(--text-primary)]">
                Notes for Admin (optional)
              </label>
              <textarea
                id={`${baseId}-req-notes`}
                rows={2}
                maxLength={500}
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
                placeholder="Share typical pace groups, target races, or branding requests"
                className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] p-3 text-sm text-[var(--text-primary)]"
              />
            </div>

            {reqError && (
              <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
                {reqError}
              </p>
            )}

            <button
              type="submit"
              disabled={reqSubmitting}
              className="w-full min-h-11 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {reqSubmitting ? 'Sending Club Request...' : 'Submit Club Request'}
            </button>
          </form>

          {myRequests.length > 0 && (
            <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                Your Club Requests ({myRequests.length})
              </h3>
              <div className="space-y-1.5">
                {myRequests.map((req) => (
                  <div key={req.requestId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-primary)] truncate">
                        {req.clubName} ({req.city})
                      </p>
                      {req.reviewNote && (
                        <p className="text-[var(--text-secondary)] truncate">{req.reviewNote}</p>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] font-semibold capitalize text-[var(--text-primary)] shrink-0">
                      {req.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2">
            <a
              href={clubMailtoHref}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
            >
              <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Email Admin</span>
            </a>
            <button
              type="button"
              onClick={() => void handleCopyEmail()}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{copyStatus === 'copied' ? 'Email Copied' : LEGAL_CONFIG.supportEmail}</span>
            </button>
          </div>
        </DialogSurface>
      )}

      <ReportContentDialog
        open={Boolean(reportClubTarget)}
        actorUid={uid}
        targetType="club"
        targetId={reportClubTarget?.clubId || ''}
        targetLabel={reportClubTarget?.name || ''}
        onClose={() => setReportClubTarget(null)}
      />
    </div>
  );
}
