import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import {
  BellRing,
  Camera,
  CircleDot,
  Compass,
  Home,
  Inbox,
  Search,
  User,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { useAccess } from '../lib/access';
import {
  acknowledgeSeenBadges,
  createDefaultAthleteProgression,
  normalizeAthleteProgression,
  subscribeAthleteProgression,
  subscribeBadgeCatalog,
  subscribeUserBadges,
  syncMyBadges,
} from '../lib/badges/client';
import {
  acknowledgeDevSeenBadgesFixture,
  E2E_BADGES_KEY,
  readDevProgressionFixture,
  readDevSessionJson,
  readDevUserBadgesFixture,
} from '../lib/badges/e2eFixtures';
import { selectNextToastBadge } from '../lib/badges/presets';
import type { AthleteProgression, BadgeDefinition, UserBadgeAward } from '../lib/badges/types';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import { subscribeSharedLiveResults } from '../lib/liveResultsStore';
import { claimRaceBib, claimableEntryLabel, parseRaceBibQr, previewRaceBibClaim, RaceBibClaimPreview } from '../lib/raceBibClaim';
import { subscribeSharedRaces } from '../lib/racesStore';
import {
  buildHomeFriendFeed,
  computeRunnerPortfolioCounts,
  countInboxUnreadTotal,
  mapExploreRacesMode,
  resolveAllowedRunnerTabs,
  resolveBackNavigationTarget,
  resolveDefaultRunnerTab,
  RUNNER_TAB_ORDER,
  type ExploreRacesFilter,
  type ExploreSection,
  type RunnerTab,
  type YouSection,
} from '../lib/runnerShell';
import {
  deleteRecordedRun,
  loadRecordedRunTrackPoints,
  subscribeMyRecordedRuns,
  updateRecordedRun,
  type CompleteRecordedRunResponse,
} from '../lib/runs/communityRunsClient';
import { slugifyFilename } from '../lib/runs/runLiveHelpers';
import { buildRunGpxXml } from '../lib/runs/runRecorderEngine';
import type { RecordedRunPrivacy, RecordedRunSummary } from '../lib/runs/types';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import { FriendActivity, FriendProfile, PublicLiveResults, Race, RunnerProfile, UserProfile } from '../types';
import AccountPrivacyModal from './AccountPrivacyModal';
import type { WorkspaceNavItem } from './BottomNav';
import CustomerForm, { type EngravingRacePrefill } from './CustomerForm';
import type { WorkspaceSwitchProps } from './DesktopSidebar';
import QrScannerModal from './QrScannerModal';
import { RunnerRemindersPanel, useRunnerReminders } from './RunnerReminderCenter';
import WorkspaceShell from './WorkspaceShell';
import AchievementUnlockToast from './runner/AchievementUnlockToast';
import RunnerExplorePanel, { type ExploreCourseRunTarget, type ExploreMetrics } from './runner/RunnerExplorePanel';
import RunnerHomePanel from './runner/RunnerHomePanel';
import RunnerInboxPreviewPanel, {
  type InboxFriendRequestItem,
  type InboxRaceInviteItem,
} from './runner/RunnerInboxPreviewPanel';
import {
  RunnerOfflineBanner,
  RunnerQueueSkeleton,
  RunnerTelemetryStrip,
  type RunnerTelemetryItem,
} from './runner/RunnerMobilePrimitives';
import type { MyPassesFilter } from './runner/RunnerMyRacesPanel';
import RunnerOnboardingHint from './runner/RunnerOnboardingHint';
import RunnerRecordPanel from './runner/RunnerRecordPanel';
import RunnerYouHubPanel from './runner/RunnerYouHubPanel';
import {
  philippineTodayStr,
  useNetworkSyncStatus,
  useRunnerViewport,
  useSoftKeyboardOpen,
} from './runner/runnerUtils';
import DialogSurface from './ui/DialogSurface';
import { useFeedback } from './ui/FeedbackProvider';
import {
  AnimatedTabView,
  resolveTabDirection,
  type NavDirection,
} from './ui/MotionPrimitives';

interface RunnerDashboardProps {
  profile: UserProfile;
  initialRaceId?: string | null;
  onInitialRaceHandled?: () => void;
  workspaceSwitch?: WorkspaceSwitchProps;
  pendingApprovalNotice?: boolean;
}

interface FriendshipDoc {
  fromUid: string;
  toUid: string;
  members: string[];
  createdAt: string;
}

function mergeAwardedBadges(
  existing: readonly UserBadgeAward[],
  incoming: readonly UserBadgeAward[],
): UserBadgeAward[] {
  if (incoming.length === 0) return [...existing];
  const byBadgeId = new Map<string, UserBadgeAward>();
  for (const item of existing) {
    if (item?.badgeId) byBadgeId.set(item.badgeId, item);
  }
  for (const item of incoming) {
    if (!item?.badgeId) continue;
    const prev = byBadgeId.get(item.badgeId);
    byBadgeId.set(
      item.badgeId,
      prev ? { ...item, seenByUser: prev.seenByUser || item.seenByUser } : item,
    );
  }
  return Array.from(byBadgeId.values()).sort((a, b) =>
    b.earnedAt.localeCompare(a.earnedAt),
  );
}

export default function RunnerDashboard({
  profile,
  initialRaceId,
  onInitialRaceHandled,
  workspaceSwitch,
  pendingApprovalNotice,
}: RunnerDashboardProps) {
  const { can } = useAccess();
  const { confirm, notify } = useFeedback();
  const headerCtx = useWorkspaceHeader();
  const { isCompact, isSplitPane, isDesktop } = useRunnerViewport();
  const { online } = useNetworkSyncStatus();
  const [mobileCanvasActive, setMobileCanvasActive] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined);
  const [sharedRaces, setSharedRaces] = useState<Race[]>([]);
  const [racesLoaded, setRacesLoaded] = useState(false);
  const [racesError, setRacesError] = useState<string | null>(null);
  const [friendsCount, setFriendsCount] = useState(0);

  const [incomingRequests, setIncomingRequests] = useState<InboxFriendRequestItem[]>([]);
  const [raceInvites, setRaceInvites] = useState<InboxRaceInviteItem[]>([]);
  const [friendProfilesByUid, setFriendProfilesByUid] = useState<Record<string, FriendProfile>>({});
  const [friendActivitiesByUid, setFriendActivitiesByUid] = useState<Record<string, FriendActivity>>({});
  const [recordedRuns, setRecordedRuns] = useState<RecordedRunSummary[]>([]);
  const [recordedRunsLoaded, setRecordedRunsLoaded] = useState(false);
  const [recordedRunsError, setRecordedRunsError] = useState<string | null>(null);
  const [isRecordingRun, setIsRecordingRun] = useState(false);
  const [badgeCatalog, setBadgeCatalog] = useState<BadgeDefinition[]>([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [badgesError, setBadgesError] = useState<string | null>(null);
  const [userBadges, setUserBadges] = useState<UserBadgeAward[]>([]);
  const [userBadgesLoaded, setUserBadgesLoaded] = useState(false);
  const [athleteProgression, setAthleteProgression] = useState<AthleteProgression>(() =>
    createDefaultAthleteProgression(profile.uid),
  );
  const syncedBadgesUidRef = useRef<string | null>(null);

  const canFriends = can('personal.friends');
  const canInvites = can('personal.invites');
  const canSocial = can('personal.social');
  const canEngraving = can('personal.engraving');
  const canRegister = can('personal.register');
  const canRecord = can('personal.record');
  const canAnyRunnerData =
    can('personal.register') ||
    can('personal.results') ||
    can('personal.bibs') ||
    can('personal.certificates');

  const hasPaymentParam =
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('payment'));

  const allowedTabs = useMemo(() => resolveAllowedRunnerTabs(can), [can]);
  const homeTab = useMemo(() => resolveDefaultRunnerTab(can, false), [can]);

  const [tab, setTab] = useState<RunnerTab>(() => {
    if (initialRaceId && allowedTabs.includes('explore')) {
      return 'explore';
    }
    return resolveDefaultRunnerTab(can, hasPaymentParam);
  });
  const [tabDirection, setTabDirection] = useState<NavDirection>('forward');
  const [showProfile, setShowProfile] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  // Shared QR scanner + Bib Claim dialogs
  const [showEventQrScanner, setShowEventQrScanner] = useState(false);
  const [scannedRaceId, setScannedRaceId] = useState<string | null>(null);
  const [pendingDeepLinkRaceId, setPendingDeepLinkRaceId] = useState<string | null>(() => initialRaceId || null);
  const [requestedPassRaceId, setRequestedPassRaceId] = useState<string | null>(null);
  const [eventQrMessage, setEventQrMessage] = useState('');
  const [eventQrError, setEventQrError] = useState('');
  const [pendingBibClaim, setPendingBibClaim] = useState<
    (RaceBibClaimPreview & { payload: { raceId: string; bibNumber: string } }) | null
  >(null);
  const [claimingBib, setClaimingBib] = useState(false);
  const [bibClaimError, setBibClaimError] = useState('');

  // Explore hub state
  const [exploreSection, setExploreSection] = useState<ExploreSection>('races');
  const [exploreRacesFilter, setExploreRacesFilter] = useState<ExploreRacesFilter>('open');
  const [exploreSearch, setExploreSearch] = useState('');
  const [exploreMetrics, setExploreMetrics] = useState<ExploreMetrics>({
    total: 0,
    unjoined: 0,
    registered: 0,
    catalogAll: 0,
    catalogUpcoming: 0,
    catalogCompleted: 0,
    showing: 0,
    routesCount: 0,
  });
  const [eventsInFormFlow, setEventsInFormFlow] = useState(false);

  // You hub state
  const [youSection, setYouSection] = useState<YouSection>('overview');
  const [myPassesSearch, setMyPassesSearch] = useState('');
  const [myPassesFilter, setMyPassesFilter] = useState<MyPassesFilter>('all');
  const [myPassesMetrics, setMyPassesMetrics] = useState({ all: 0, upcoming: 0, completed: 0, showing: 0 });
  const [friendsSearch, setFriendsSearch] = useState('');

  // Record preview preselected course
  const [preselectedCourse, setPreselectedCourse] = useState<ExploreCourseRunTarget | null>(null);

  const handleExploreMetricsChange = useCallback((next: ExploreMetrics) => {
    setExploreMetrics((prev) =>
      prev.total === next.total &&
      prev.unjoined === next.unjoined &&
      prev.registered === next.registered &&
      prev.catalogAll === next.catalogAll &&
      prev.catalogUpcoming === next.catalogUpcoming &&
      prev.catalogCompleted === next.catalogCompleted &&
      prev.showing === next.showing &&
      prev.routesCount === next.routesCount
        ? prev
        : next,
    );
  }, []);

  const handleMyPassesMetricsChange = useCallback(
    (next: { all: number; upcoming: number; completed: number; showing: number }) => {
      setMyPassesMetrics((prev) =>
        prev.all === next.all &&
        prev.upcoming === next.upcoming &&
        prev.completed === next.completed &&
        prev.showing === next.showing
          ? prev
          : next,
      );
    },
    [],
  );

  const handleEventsDeepLinkHandled = useCallback(() => {
    setScannedRaceId(null);
    setPendingDeepLinkRaceId(null);
  }, []);

  const handlePassDeepLinkHandled = useCallback(() => {
    setRequestedPassRaceId(null);
  }, []);

  const headerSearchRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<RunnerTab>(tab);
  tabRef.current = tab;
  const homeTabRef = useRef<RunnerTab>(homeTab);
  homeTabRef.current = homeTab;
  const exploreSectionRef = useRef<ExploreSection>(exploreSection);
  exploreSectionRef.current = exploreSection;
  const youSectionRef = useRef<YouSection>(youSection);
  youSectionRef.current = youSection;
  const showProfileRef = useRef(showProfile);
  showProfileRef.current = showProfile;
  const alertsOpenRef = useRef(alertsOpen);
  alertsOpenRef.current = alertsOpen;
  const isRecordingRunRef = useRef(isRecordingRun);
  isRecordingRunRef.current = isRecordingRun;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (tab !== 'record') {
      setIsRecordingRun(false);
    }
  }, [tab]);

  const selectTab = useCallback(
    async (
      nextTab: RunnerTab,
      explicitDirection?: NavDirection,
      options?: { force?: boolean },
    ): Promise<boolean> => {
      const currentTab = tabRef.current;
      if (nextTab === currentTab) return true;
      if (!options?.force && isRecordingRunRef.current && currentTab === 'record' && nextTab !== 'record') {
        const leave = await confirm({
          title: 'Leave active run?',
          message:
            'Leaving Record stops live GPS tracking. Your latest saved snapshot stays recoverable when you return to Record.',
          confirmLabel: 'Leave Record',
          cancelLabel: 'Stay on Record',
        });
        if (!leave) return false;
      }
      setMobileCanvasActive(false);
      setEventsInFormFlow(false);
      setTabDirection(explicitDirection ?? resolveTabDirection(RUNNER_TAB_ORDER, currentTab, nextTab));
      setTab(nextTab);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      return true;
    },
    [confirm],
  );

  const switchTabThen = useCallback(
    (nextTab: RunnerTab, afterSwitch?: () => void, explicitDirection?: NavDirection) => {
      if (isRecordingRunRef.current && tabRef.current === 'record' && nextTab !== 'record') {
        void selectTab(nextTab, explicitDirection).then((moved) => {
          if (moved) afterSwitch?.();
        });
        return;
      }
      afterSwitch?.();
      void selectTab(nextTab, explicitDirection);
    },
    [selectTab],
  );

  useEffect(() => {
    if (!allowedTabs.includes(tab)) {
      void selectTab(homeTab, 'back', { force: true });
    }
  }, [allowedTabs, tab, homeTab, selectTab]);

  useEffect(() => {
    if (!canRecord) {
      setRecordedRuns([]);
      setRecordedRunsLoaded(true);
      setRecordedRunsError(null);
      return;
    }
    if (import.meta.env.DEV && profile.uid.startsWith('e2e-') && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem('racepulse_e2e_recorded_runs');
        if (raw !== null) {
          const parsed = JSON.parse(raw) as RecordedRunSummary[];
          if (Array.isArray(parsed)) {
            setRecordedRuns(parsed);
            setRecordedRunsLoaded(true);
            setRecordedRunsError(null);
            return;
          }
        }
      } catch (err) {
        console.warn('[RunnerDashboard] Ignored invalid E2E recordedRuns fixture:', err);
      }
    }
    setRecordedRunsLoaded(false);
    setRecordedRunsError(null);
    return subscribeMyRecordedRuns(profile.uid, (runs, loaded, error) => {
      setRecordedRuns(runs);
      setRecordedRunsLoaded(loaded);
      setRecordedRunsError(error);
    });
  }, [canRecord, profile.uid]);

  useEffect(() => {
    if (import.meta.env.DEV && profile.uid.startsWith('e2e-')) {
      setBadgeCatalog(readDevSessionJson<BadgeDefinition>(E2E_BADGES_KEY) ?? []);
      setBadgesLoaded(true);
      setBadgesError(null);
      setUserBadges(readDevUserBadgesFixture());
      setUserBadgesLoaded(true);
      setAthleteProgression(readDevProgressionFixture(profile.uid));
      return undefined;
    }

    setBadgeCatalog([]);
    setBadgesLoaded(false);
    setBadgesError(null);
    setUserBadges([]);
    setUserBadgesLoaded(false);
    setAthleteProgression(createDefaultAthleteProgression(profile.uid));

    const unsubCatalog = subscribeBadgeCatalog(
      (snap) => {
        setBadgeCatalog(snap.badges);
        setBadgesLoaded(snap.loaded);
        setBadgesError(snap.error);
      },
      { includeArchived: false },
    );

    const unsubUserBadges = subscribeUserBadges(profile.uid, (snap) => {
      setUserBadges((prev) => {
        const seenById = new Map(prev.map((item) => [item.badgeId, item.seenByUser]));
        return snap.awards.map((award) => ({
          ...award,
          seenByUser: award.seenByUser || Boolean(seenById.get(award.badgeId)),
        }));
      });
      setUserBadgesLoaded(snap.loaded);
      if (snap.error) {
        setBadgesError((prevErr) => prevErr ?? snap.error);
      }
    });

    const unsubProgression = subscribeAthleteProgression(profile.uid, (snap) => {
      setAthleteProgression(snap.progression);
    });

    return () => {
      unsubCatalog();
      unsubUserBadges();
      unsubProgression();
    };
  }, [profile.uid]);

  useEffect(() => {
    if (!profile.uid) return;
    if (import.meta.env.DEV && profile.uid.startsWith('e2e-')) return;
    if (syncedBadgesUidRef.current === profile.uid) return;
    syncedBadgesUidRef.current = profile.uid;
    let cancelled = false;
    void syncMyBadges()
      .then((res) => {
        if (cancelled) return;
        if (res.newlyAwarded.length > 0) {
          setUserBadges((prev) => mergeAwardedBadges(prev, res.newlyAwarded));
        }
        if (res.progression) {
          setAthleteProgression(normalizeAthleteProgression(profile.uid, res.progression));
        }
      })
      .catch((err) => {
        console.warn('[RunnerDashboard] syncMyBadges skipped or failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.uid]);

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Runner portal races listener failed:', err);
        setRacesError(err || 'Unable to load race events.');
        setRacesLoaded(true);
        return;
      }
      if (loaded) {
        setSharedRaces(rawList);
        setRacesError(null);
        setRacesLoaded(true);
      }
    });
  }, []);

  // Incoming pending friend requests listener
  useEffect(() => {
    if (!canFriends) {
      setIncomingRequests([]);
      return;
    }
    return onSnapshot(
      query(collection(db, 'friendRequests'), where('toUid', '==', profile.uid)),
      (snapshot) => {
        const items: InboxFriendRequestItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as InboxFriendRequestItem & { status?: string };
          if (data.status === 'pending') {
            items.push({
              fromUid: data.fromUid,
              toUid: data.toUid,
              fromUsername: data.fromUsername,
              fromDisplayName: data.fromDisplayName,
              createdAt: data.createdAt,
            });
          }
        });
        items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setIncomingRequests(items);
      },
      (error) => {
        console.warn('[RunnerDashboard] friendRequests listener failed:', error);
        setIncomingRequests([]);
      },
    );
  }, [canFriends, profile.uid]);

  // Incoming pending race invites listener
  useEffect(() => {
    if (!canInvites) {
      setRaceInvites([]);
      return;
    }
    return onSnapshot(
      query(collection(db, 'raceInvites'), where('toUid', '==', profile.uid)),
      (snapshot) => {
        const items: InboxRaceInviteItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as InboxRaceInviteItem & { status?: string };
          if (data.status === 'pending') {
            items.push({
              fromUid: data.fromUid,
              toUid: data.toUid,
              raceId: data.raceId,
              raceName: data.raceName,
              raceDate: data.raceDate,
              fromDisplayName: data.fromDisplayName,
              createdAt: data.createdAt,
            });
          }
        });
        items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setRaceInvites(items);
      },
      (error) => {
        console.warn('[RunnerDashboard] raceInvites listener failed:', error);
        setRaceInvites([]);
      },
    );
  }, [canInvites, profile.uid]);

  // Accepted friendships + per-friend profile/activity doc listeners (cleanly diffed with zero leaks)
  useEffect(() => {
    if (!canFriends) {
      setFriendsCount(0);
      setFriendProfilesByUid({});
      setFriendActivitiesByUid({});
      return;
    }

    const perFriendUnsubs = new Map<string, () => void>();

    const cleanupFriendListener = (friendUid: string) => {
      const unsub = perFriendUnsubs.get(friendUid);
      if (unsub) {
        unsub();
        perFriendUnsubs.delete(friendUid);
      }
      setFriendProfilesByUid((prev) => {
        if (!(friendUid in prev)) return prev;
        const next = { ...prev };
        delete next[friendUid];
        return next;
      });
      setFriendActivitiesByUid((prev) => {
        if (!(friendUid in prev)) return prev;
        const next = { ...prev };
        delete next[friendUid];
        return next;
      });
    };

    const unsubFriendships = onSnapshot(
      query(collection(db, 'friendships'), where('members', 'array-contains', profile.uid)),
      (snapshot) => {
        setFriendsCount(snapshot.size);

        if (!canSocial) {
          for (const friendUid of Array.from(perFriendUnsubs.keys())) {
            cleanupFriendListener(friendUid);
          }
          return;
        }

        const activeFriendUids = new Set<string>();
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as FriendshipDoc;
          const friendUid = data.fromUid === profile.uid ? data.toUid : data.fromUid;
          if (friendUid && friendUid !== profile.uid) {
            activeFriendUids.add(friendUid);
          }
        });

        for (const existingUid of Array.from(perFriendUnsubs.keys())) {
          if (!activeFriendUids.has(existingUid)) {
            cleanupFriendListener(existingUid);
          }
        }

        for (const friendUid of activeFriendUids) {
          if (perFriendUnsubs.has(friendUid)) continue;
          const unsubProfile = onSnapshot(
            doc(db, 'friendProfiles', friendUid),
            (profileSnap) => {
              setFriendProfilesByUid((prev) => {
                if (!profileSnap.exists()) {
                  if (!(friendUid in prev)) return prev;
                  const next = { ...prev };
                  delete next[friendUid];
                  return next;
                }
                return { ...prev, [friendUid]: profileSnap.data() as FriendProfile };
              });
            },
            (error) => {
              console.warn('[RunnerDashboard] friendProfiles listener failed:', error);
            },
          );
          const unsubActivity = onSnapshot(
            doc(db, 'friendActivities', friendUid),
            (activitySnap) => {
              setFriendActivitiesByUid((prev) => {
                if (!activitySnap.exists()) {
                  if (!(friendUid in prev)) return prev;
                  const next = { ...prev };
                  delete next[friendUid];
                  return next;
                }
                return { ...prev, [friendUid]: activitySnap.data() as FriendActivity };
              });
            },
            (error) => {
              console.warn('[RunnerDashboard] friendActivities listener failed:', error);
            },
          );
          perFriendUnsubs.set(friendUid, () => {
            unsubProfile();
            unsubActivity();
          });
        }
      },
      (error) => {
        console.warn('[RunnerDashboard] friendships listener failed:', error);
        setFriendsCount(0);
      },
    );

    return () => {
      unsubFriendships();
      for (const unsub of perFriendUnsubs.values()) {
        unsub();
      }
      perFriendUnsubs.clear();
    };
  }, [canFriends, canSocial, profile.uid]);

  useAndroidBackHandler(showProfile, () => setShowProfile(false));
  useAndroidBackHandler(alertsOpen, () => setAlertsOpen(false));
  useAndroidBackHandler(Boolean(pendingBibClaim), () => {
    if (!claimingBib) setPendingBibClaim(null);
  });

  useEffect(() => {
    const handleBack = (event: Event) => {
      const hardware = event instanceof CustomEvent && Boolean(event.detail?.hardware);
      if (hardware) {
        if (event.defaultPrevented) return;
        if (showProfileRef.current || alertsOpenRef.current) {
          event.preventDefault();
          setShowProfile(false);
          setAlertsOpen(false);
          return;
        }
        if (tabRef.current === 'record' && isRecordingRunRef.current) {
          event.preventDefault();
          return;
        }
        const target = resolveBackNavigationTarget({
          tab: tabRef.current,
          homeTab: homeTabRef.current,
          exploreSection: exploreSectionRef.current,
          youSection: youSectionRef.current,
        });
        if (!target) return;
        event.preventDefault();
        if (target.exploreSection) setExploreSection(target.exploreSection);
        if (target.youSection) setYouSection(target.youSection);
        void selectTab(target.tab, 'back');
        return;
      }

      if (tabRef.current === 'record' && isRecordingRunRef.current) {
        void selectTab(homeTabRef.current, 'back');
        return;
      }

      setShowProfile(false);
      setAlertsOpen(false);
      setExploreSection('races');
      setYouSection('overview');
      void selectTab(homeTabRef.current, 'back');
    };
    window.addEventListener('racepulse:back', handleBack);
    return () => window.removeEventListener('racepulse:back', handleBack);
  }, [selectTab]);

  useEffect(() => {
    if (!initialRaceId) return;
    setPendingDeepLinkRaceId(initialRaceId);
    setExploreSection('races');
    setExploreRacesFilter('open');
    if (allowedTabs.includes('explore')) {
      selectTab('explore');
    }
    onInitialRaceHandled?.();
  }, [initialRaceId, allowedTabs, onInitialRaceHandled, selectTab]);

  useEffect(() => {
    if (!canAnyRunnerData) {
      setRunnerProfiles([]);
      return;
    }
    let directProfiles: RunnerProfile[] = [];
    let claimedProfiles: RunnerProfile[] = [];
    const publish = () => {
      // In-app registrations win over QR claims for the same event.
      const directRaceIds = new Set(directProfiles.map((item) => item.raceId));
      setRunnerProfiles([...directProfiles, ...claimedProfiles.filter((item) => !directRaceIds.has(item.raceId))]);
    };
    const unsubscribeProfiles = onSnapshot(
      query(collection(db, 'runners'), where('uid', '==', profile.uid)),
      (snapshot) => {
        directProfiles = snapshot.docs.map((docSnap) => docSnap.data() as RunnerProfile);
        publish();
      },
      (err) => {
        console.warn('Runner profiles listener failed:', err.message);
        directProfiles = [];
        publish();
      },
    );
    const unsubscribeClaims = onSnapshot(
      query(collection(db, 'runnerClaims'), where('uid', '==', profile.uid)),
      (snapshot) => {
        claimedProfiles = snapshot.docs
          .map((docSnap) => docSnap.data()?.runner as RunnerProfile | undefined)
          .filter((runner): runner is RunnerProfile => Boolean(runner));
        publish();
      },
      (err) => {
        console.warn('Runner bib claims listener failed:', err.message);
        claimedProfiles = [];
        publish();
      },
    );
    return () => {
      unsubscribeProfiles();
      unsubscribeClaims();
    };
  }, [profile.uid, canAnyRunnerData]);

  // Publish safe public friend card without private account/medical fields
  useEffect(() => {
    const username = profile.username?.trim().toLowerCase();
    if (!username) return;
    const payload = {
      uid: profile.uid,
      username,
      displayName: profile.displayName,
      ...(profile.nickname ? { nickname: profile.nickname } : {}),
      ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
      updatedAt: new Date().toISOString(),
    };
    void Promise.all([
      setDoc(doc(db, 'friendDirectory', username), payload, { merge: true }),
      setDoc(doc(db, 'friendProfiles', profile.uid), payload, { merge: true }),
    ]).catch((err) => console.warn('Failed to update friend profile:', err));
  }, [profile.uid, profile.username, profile.displayName, profile.nickname, profile.photoURL]);

  // Publish short race activity summary for accepted friends
  useEffect(() => {
    if (!runnerProfiles || !racesLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const raceById = new Map(sharedRaces.map((r) => [r.id, r]));
        const recentRaces = [...runnerProfiles]
          .map((runner) => {
            const race = raceById.get(runner.raceId);
            return race ? { raceId: race.id, raceName: race.name, date: race.date, distance: runner.distance } : null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6);
        if (cancelled) return;
        await setDoc(doc(db, 'friendActivities', profile.uid), {
          uid: profile.uid,
          recentRaces,
          updatedAt: new Date().toISOString(),
        } satisfies FriendActivity);
      } catch (err) {
        console.warn('Failed to update friend activity:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.uid, runnerProfiles, racesLoaded, sharedRaces]);

  const { reminders, dismiss, notificationPermission, requestAlerts } = useRunnerReminders(runnerProfiles);

  const inboxUnreadCount = countInboxUnreadTotal({
    pendingRequestsCount: incomingRequests.length,
    pendingInvitesCount: raceInvites.length,
    remindersCount: reminders.length,
  });

  const friendFeed = useMemo(
    () => buildHomeFriendFeed(Object.values(friendProfilesByUid), friendActivitiesByUid),
    [friendProfilesByUid, friendActivitiesByUid],
  );

  // Viewport lock: Explore & You (passes/friends) lock 100dvh; Home, Record, Inbox, You Overview/Engraving, and Forms scroll cleanly
  const isLockedTab =
    (tab === 'explore' && (exploreSection !== 'races' || !eventsInFormFlow)) ||
    (tab === 'you' && (youSection === 'passes' || youSection === 'friends'));
  const isLocked = isDesktop && isLockedTab;
  const isSplitLocked = isLockedTab;
  const imeOpen = useSoftKeyboardOpen(
    isCompact && !showProfile && !showEventQrScanner && !pendingBibClaim && !alertsOpen,
  );

  const setDesktopLocked = headerCtx?.setDesktopLocked;
  const setSplitViewportLocked = headerCtx?.setSplitViewportLocked;
  useEffect(() => {
    if (!setDesktopLocked) return;
    setDesktopLocked(isLocked);
    return () => setDesktopLocked(false);
  }, [isLocked, setDesktopLocked]);

  useEffect(() => {
    if (!setSplitViewportLocked) return;
    setSplitViewportLocked(isSplitLocked);
    return () => setSplitViewportLocked(false);
  }, [isSplitLocked, setSplitViewportLocked]);

  useEffect(() => {
    if (isSplitPane) setMobileCanvasActive(false);
  }, [isSplitPane, tab]);

  // Global desktop `/` focus shortcut for active top-bar search input
  useEffect(() => {
    if (!isDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (showProfile || showEventQrScanner || Boolean(pendingBibClaim)) return;
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (isFormField) return;
      if (!headerSearchRef.current) return;
      event.preventDefault();
      headerSearchRef.current.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, showProfile, showEventQrScanner, pendingBibClaim]);

  const scanEventQr = async (text: string): Promise<boolean> => {
    const bibPayload = parseRaceBibQr(text);
    if (bibPayload) {
      try {
        setEventQrError('');
        setEventQrMessage('Checking your race bib...');
        const preview = await previewRaceBibClaim(bibPayload);
        setPendingBibClaim({ ...preview, payload: bibPayload });
        setEventQrMessage(
          preview.alreadyLinked ? 'This race is already in My Passes.' : 'Race bib found: review the details to add it.',
        );
        window.setTimeout(() => setShowEventQrScanner(false), 300);
        return true;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'We could not find a runner for this race bib QR code.';
        setEventQrError(msg);
        return false;
      }
    }
    try {
      const url = new URL(text.trim());
      const allowedHosts = new Set([
        'racepulseph.com',
        'www.racepulseph.com',
        'racepulseph.web.app',
        'racepulseph.firebaseapp.com',
        'localhost',
      ]);
      const raceId = url.searchParams.get('register')?.trim();
      if (!allowedHosts.has(url.hostname) || !raceId || !/^[A-Za-z0-9_-]{1,64}$/.test(raceId)) {
        setEventQrError('This is not a valid RacePulse event registration QR code.');
        return false;
      }
      setEventQrError('');
      setEventQrMessage('Event found: opening its registration form...');
      switchTabThen('explore', () => {
        setScannedRaceId(raceId);
        setExploreSection('races');
        setExploreRacesFilter('open');
      });
      window.setTimeout(() => setShowEventQrScanner(false), 450);
      return true;
    } catch {
      setEventQrError('This is not a valid RacePulse event registration QR code.');
      return false;
    }
  };

  const confirmBibClaim = async () => {
    if (!pendingBibClaim || pendingBibClaim.alreadyLinked) {
      const raceId = pendingBibClaim?.race.id;
      setPendingBibClaim(null);
      switchTabThen('you', () => {
        if (raceId) {
          setRequestedPassRaceId(raceId);
        }
        setYouSection('passes');
      });
      return;
    }
    setClaimingBib(true);
    setBibClaimError('');
    try {
      await claimRaceBib(pendingBibClaim.payload);
      const raceId = pendingBibClaim.race.id;
      setPendingBibClaim(null);
      switchTabThen('you', () => {
        setRequestedPassRaceId(raceId);
        setYouSection('passes');
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unable to add this race to your account.';
      setBibClaimError(msg);
    } finally {
      setClaimingBib(false);
    }
  };

  const openQrScanner = () => {
    setEventQrError('');
    setEventQrMessage('');
    setBibClaimError('');
    setShowEventQrScanner(true);
  };

  const handleAcceptFriendRequest = useCallback(async (req: InboxFriendRequestItem) => {
    const requestRef = doc(db, 'friendRequests', `${req.fromUid}_${req.toUid}`);
    const batch = writeBatch(db);
    batch.update(requestRef, { status: 'accepted', respondedAt: new Date().toISOString() });
    batch.set(doc(db, 'friendships', `${req.fromUid}_${req.toUid}`), {
      fromUid: req.fromUid,
      toUid: req.toUid,
      members: [req.fromUid, req.toUid],
      createdAt: new Date().toISOString(),
    } satisfies FriendshipDoc);
    await batch.commit();
  }, []);

  const handleDeclineFriendRequest = useCallback(async (req: InboxFriendRequestItem) => {
    await updateDoc(doc(db, 'friendRequests', `${req.fromUid}_${req.toUid}`), {
      status: 'declined',
      respondedAt: new Date().toISOString(),
    });
  }, []);

  const handleOpenRaceInvite = useCallback(
    async (invite: InboxRaceInviteItem) => {
      try {
        await updateDoc(doc(db, 'raceInvites', `${invite.fromUid}_${invite.toUid}_${invite.raceId}`), {
          status: 'opened',
        });
      } catch (error) {
        console.warn('[RunnerDashboard] Failed to update raceInvite status:', error);
      }
      if (!allowedTabs.includes('explore')) return;
      setPendingDeepLinkRaceId(invite.raceId);
      setExploreSection('races');
      setExploreRacesFilter('open');
      selectTab('explore');
    },
    [allowedTabs, selectTab],
  );

  const badgesById = useMemo(
    () => new Map(badgeCatalog.map((item) => [item.badgeId, item])),
    [badgeCatalog],
  );

  const nextToastItem = useMemo(
    () => selectNextToastBadge(userBadges, badgesById),
    [userBadges, badgesById],
  );

  const handleDismissAchievementToast = useCallback(
    (award: UserBadgeAward) => {
      setUserBadges((prev) =>
        prev.map((item) =>
          item.badgeId === award.badgeId ? { ...item, seenByUser: true } : item,
        ),
      );
      if (import.meta.env.DEV && profile.uid.startsWith('e2e-')) {
        acknowledgeDevSeenBadgesFixture([award.badgeId]);
        return;
      }
      void acknowledgeSeenBadges([award.badgeId]).catch((err) => {
        console.warn('[RunnerDashboard] acknowledgeSeenBadges failed:', err);
      });
    },
    [profile.uid],
  );

  const handleRunSaved = useCallback(
    (savedRun: RecordedRunSummary, outcome?: CompleteRecordedRunResponse) => {
      setRecordedRuns((prev) =>
        [savedRun, ...prev.filter((item) => item.runId !== savedRun.runId)].sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        ),
      );
      setRecordedRunsLoaded(true);
      setRecordedRunsError(null);
      if (outcome?.newlyAwardedBadges && outcome.newlyAwardedBadges.length > 0) {
        setUserBadges((prev) => mergeAwardedBadges(prev, outcome.newlyAwardedBadges ?? []));
      }
      if (outcome?.progression) {
        setAthleteProgression(normalizeAthleteProgression(profile.uid, outcome.progression));
      }
    },
    [profile.uid],
  );

  const handleUpdateRunPrivacy = useCallback(
    async (run: RecordedRunSummary, nextPrivacy: RecordedRunPrivacy) => {
      if (run.privacy === nextPrivacy) return;
      try {
        const updated = await updateRecordedRun({ runId: run.runId, privacy: nextPrivacy });
        setRecordedRuns((prev) => prev.map((item) => (item.runId === updated.runId ? updated : item)));
        notify({
          tone: 'success',
          title: 'Run visibility updated',
          message: `"${updated.title}" is now set to ${updated.privacy}.`,
        });
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Unable to update run visibility right now.';
        notify({
          tone: 'error',
          title: 'Visibility update failed',
          message,
        });
      }
    },
    [notify],
  );

  const handleDeleteRun = useCallback(
    async (run: RecordedRunSummary) => {
      const confirmed = await confirm({
        title: 'Delete recorded run?',
        message: `Delete "${run.title}" (${(run.distanceM / 1000).toFixed(2)} km)? This permanently removes the run summary and stored GPS track.`,
        confirmLabel: 'Delete run',
        cancelLabel: 'Keep run',
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await deleteRecordedRun(run.runId);
        setRecordedRuns((prev) => prev.filter((item) => item.runId !== run.runId));
        notify({
          tone: 'info',
          title: 'Recorded run deleted',
          message: `"${run.title}" was removed from your profile.`,
        });
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Unable to delete this recorded run right now.';
        notify({
          tone: 'error',
          title: 'Delete failed',
          message,
        });
      }
    },
    [confirm, notify],
  );

  const handleExportRunGpx = useCallback(
    async (run: RecordedRunSummary) => {
      try {
        const points = await loadRecordedRunTrackPoints(run);
        if (points.length === 0) {
          notify({
            tone: 'info',
            title: 'No GPX points to export',
            message: run.homePrivacyTrimEnabled
              ? 'Runs under 450 m fall inside the 200 m privacy trim zone, so GPS coordinates are omitted.'
              : 'No GPS track points were stored for this recorded run.',
          });
          return;
        }
        const xml = buildRunGpxXml({
          title: run.title,
          startedAt: run.startedAt,
          points,
          privacyTrimApplied: run.homePrivacyTrimEnabled,
        });
        const blob = new Blob([xml], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = `${slugifyFilename(run.title)}.gpx`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } finally {
          URL.revokeObjectURL(url);
        }
        notify({
          tone: 'success',
          title: 'GPX track exported',
          message: `${points.length} track points saved for "${run.title}".`,
        });
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Unable to export GPX track right now.';
        notify({
          tone: 'error',
          title: 'GPX export failed',
          message,
        });
      }
    },
    [notify],
  );

  const navItems: WorkspaceNavItem[] = useMemo(
    () =>
      allowedTabs.map((key) => {
        switch (key) {
          case 'home':
            return {
              key: 'home',
              icon: <Home className="w-4 h-4" />,
              label: 'Home',
              shortLabel: 'Home',
              active: tab === 'home',
              onClick: () => selectTab('home'),
            };
          case 'explore':
            return {
              key: 'explore',
              icon: <Compass className="w-4 h-4" />,
              label: 'Explore',
              shortLabel: 'Explore',
              active: tab === 'explore',
              onClick: () => selectTab('explore'),
            };
          case 'record':
            return {
              key: 'record',
              icon: <CircleDot className="w-4 h-4" />,
              label: 'Record',
              shortLabel: 'Record',
              emphasis: 'primary-record',
              active: tab === 'record',
              onClick: () => selectTab('record'),
            };
          case 'inbox':
            return {
              key: 'inbox',
              icon: <Inbox className="w-4 h-4" />,
              label: 'Inbox',
              shortLabel: 'Inbox',
              badgeCount: inboxUnreadCount,
              active: tab === 'inbox',
              onClick: () => selectTab('inbox'),
            };
          case 'you':
            return {
              key: 'you',
              icon: <User className="w-4 h-4" />,
              label: 'You',
              shortLabel: 'You',
              active: tab === 'you',
              onClick: () => selectTab('you'),
            };
        }
      }),
    [allowedTabs, tab, inboxUnreadCount, selectTab],
  );

  const registeredRaceIds = useMemo(
    () => new Set((runnerProfiles || []).map((rp) => rp.raceId)),
    [runnerProfiles],
  );
  const todayStr = philippineTodayStr();

  const portfolioCounts = useMemo(
    () => computeRunnerPortfolioCounts(runnerProfiles || [], sharedRaces, todayStr),
    [runnerProfiles, sharedRaces, todayStr],
  );

  const activeTabMeta: Record<RunnerTab, { title: string; icon: React.ReactNode }> = {
    home: {
      title: 'Home',
      icon: <Home className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    explore: {
      title: 'Explore',
      icon: <Compass className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    record: {
      title: 'Record',
      icon: <CircleDot className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    inbox: {
      title: 'Inbox',
      icon: <Inbox className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    you: {
      title: 'You',
      icon: <User className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
  };
  const currentMeta = activeTabMeta[tab];

  // Active header search config per tab/sub-section
  const activeSearchConfig =
    tab === 'explore' && (exploreSection === 'races' || exploreSection === 'routes') && !eventsInFormFlow
      ? {
          id: 'runner_explore_header_search',
          value: exploreSearch,
          onChange: setExploreSearch,
          label:
            exploreSection === 'routes'
              ? 'Search published Philippine courses by race, region, or distance'
              : 'Search races by name, date, or distance',
          placeholder:
            exploreSection === 'routes'
              ? 'Search route, province, or distance... (/)'
              : 'Search race, date, or distance... (/)',
        }
      : tab === 'you' && youSection === 'passes'
      ? {
          id: 'runner_passes_header_search',
          value: myPassesSearch,
          onChange: setMyPassesSearch,
          label: 'Search your registered race passes',
          placeholder: 'Search race, bib #, or distance... (/)',
        }
      : tab === 'you' && youSection === 'friends'
      ? {
          id: 'runner_friends_header_search',
          value: friendsSearch,
          onChange: setFriendsSearch,
          label: 'Filter connected friends by name or handle',
          placeholder: 'Filter connected friends... (/)',
        }
      : null;

  const headerLeftMarkup = (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <span className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-2 shrink-0">
        {currentMeta.icon}
        <span className="text-xs font-display font-semibold uppercase tracking-wider text-white whitespace-nowrap">
          {currentMeta.title}
        </span>
      </div>

      {activeSearchConfig && (
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search
            className="w-3.5 h-3.5 text-zinc-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor={activeSearchConfig.id} className="sr-only">
            {activeSearchConfig.label}
          </label>
          <input
            ref={headerSearchRef}
            id={activeSearchConfig.id}
            type="text"
            value={activeSearchConfig.value}
            onChange={(e) => activeSearchConfig.onChange(e.target.value)}
            placeholder={activeSearchConfig.placeholder}
            className="w-full h-9 rounded-lg border border-white/15 bg-white/10 pl-8 pr-9 text-xs font-semibold text-white placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          {activeSearchConfig.value && (
            <button
              type="button"
              onClick={() => activeSearchConfig.onChange('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-md text-zinc-300 hover:text-white"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderSegmentedHeaderFilter = <T extends string>(
    ariaLabel: string,
    options: { key: T; label: string; count: number }[],
    value: T,
    onChange: (next: T) => void,
  ) => (
    <div
      className="inline-flex rounded-lg border border-white/15 bg-white/10 p-1 shrink-0"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((item) => {
        const active = value === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-pressed={active}
            className={`h-8 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
              active ? 'bg-red-700 text-white' : 'text-zinc-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
            <span className={`font-mono text-xs tabular-nums ${active ? 'text-white' : 'text-zinc-300'}`}>
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );

  const headerRightMarkup = (
    <div className="flex items-center gap-2" role="toolbar" aria-label="Runner view controls">
      {tab === 'explore' &&
        exploreSection === 'races' &&
        !eventsInFormFlow &&
        renderSegmentedHeaderFilter<ExploreRacesFilter>(
          'Filter explore races by status',
          [
            { key: 'open', label: 'Open Now', count: exploreMetrics.total },
            { key: 'upcoming', label: 'Upcoming', count: exploreMetrics.catalogUpcoming },
            { key: 'completed', label: 'Completed', count: exploreMetrics.catalogCompleted },
            { key: 'all', label: 'All', count: exploreMetrics.catalogAll },
            { key: 'joined', label: 'Joined', count: exploreMetrics.registered },
          ],
          exploreRacesFilter,
          setExploreRacesFilter,
        )}

      {tab === 'you' &&
        youSection === 'passes' &&
        renderSegmentedHeaderFilter<MyPassesFilter>(
          'Filter my passes by status',
          [
            { key: 'all', label: 'All Passes', count: myPassesMetrics.all },
            { key: 'upcoming', label: 'Upcoming', count: myPassesMetrics.upcoming },
            { key: 'completed', label: 'Done', count: myPassesMetrics.completed },
          ],
          myPassesFilter,
          setMyPassesFilter,
        )}

      <button
        type="button"
        onClick={openQrScanner}
        className="min-h-11 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white border border-red-500/30 text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Scan Race / Bib QR</span>
      </button>
    </div>
  );

  const telemetryLoading = runnerProfiles === undefined;
  const exploreRacesMode = mapExploreRacesMode(exploreRacesFilter);
  const telemetryContextSummary =
    tab === 'home'
      ? `${portfolioCounts.openRaces}`
      : tab === 'explore'
        ? exploreSection === 'routes'
          ? `${exploreMetrics.showing}/${exploreMetrics.routesCount}`
          : exploreSection === 'clubs'
            ? profile.runClub?.trim()
              ? '1'
              : '0'
            : exploreRacesMode.mode === 'events'
              ? `${exploreMetrics.showing}/${exploreMetrics.total}`
              : `${exploreMetrics.showing}/${exploreMetrics.catalogAll}`
        : tab === 'record'
          ? recordedRunsLoaded
            ? `${recordedRuns.length} ${recordedRuns.length === 1 ? 'run' : 'runs'}`
            : profile.weightKg
              ? `${profile.weightKg}kg`
              : 'GNSS'
          : tab === 'inbox'
            ? `${inboxUnreadCount}`
            : youSection === 'runs'
              ? recordedRunsLoaded
                ? `${recordedRuns.length}`
                : '0'
              : youSection === 'badges'
                ? userBadgesLoaded
                  ? `${userBadges.length}`
                  : '0'
                : youSection === 'passes'
                ? `${myPassesMetrics.showing}/${myPassesMetrics.all}`
                : youSection === 'friends'
                  ? `${friendsCount}`
                  : `${portfolioCounts.totalPasses}`;

  const telemetryItems: RunnerTelemetryItem[] = [
    {
      key: 'passes',
      label: 'Passes',
      value: portfolioCounts.totalPasses,
      loading: telemetryLoading,
      active: tab === 'you' && youSection === 'passes' && myPassesFilter === 'all',
      onClick: allowedTabs.includes('you')
        ? () => {
            switchTabThen('you', () => {
              setMyPassesFilter('all');
              setYouSection('passes');
            });
          }
        : undefined,
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      value: portfolioCounts.upcomingPasses,
      loading: telemetryLoading,
      accent: 'emerald',
      active: tab === 'you' && youSection === 'passes' && myPassesFilter === 'upcoming',
      onClick: allowedTabs.includes('you')
        ? () => {
            switchTabThen('you', () => {
              setMyPassesFilter('upcoming');
              setYouSection('passes');
            });
          }
        : undefined,
    },
    ...(canRegister && allowedTabs.includes('explore')
      ? [
          {
            key: 'events',
            label: 'Open',
            value: portfolioCounts.openRaces,
            loading: !racesLoaded,
            accent: 'red' as const,
            active: tab === 'explore' && exploreSection === 'races' && exploreRacesFilter === 'open',
            onClick: () => {
              switchTabThen('explore', () => {
                setExploreSection('races');
                setExploreRacesFilter('open');
              });
            },
          },
        ]
      : []),
    ...(canFriends && allowedTabs.includes('you')
      ? [
          {
            key: 'friends',
            label: 'Friends',
            value: friendsCount,
            active: tab === 'you' && youSection === 'friends',
            onClick: () => {
              switchTabThen('you', () => {
                setYouSection('friends');
              });
            },
          },
        ]
      : []),
  ];

  const showCompactHeader = !isDesktop && !(isCompact && mobileCanvasActive);
  const showTelemetryBar = !(isCompact && (mobileCanvasActive || eventsInFormFlow || tab === 'record'));

  const mobileHeaderLeftMarkup = (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="h-4 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <h1 className="font-display font-semibold text-sm sm:text-base text-white truncate">
        {currentMeta.title}
      </h1>
      {!(tab === 'explore' && eventsInFormFlow) && (
        <span className="font-mono text-xs font-semibold tabular-nums text-zinc-300 shrink-0">
          {telemetryContextSummary}
        </span>
      )}
    </div>
  );

  const mobileHeaderRightMarkup = (
    <div className="flex items-center gap-0.5 shrink-0">
      {(runnerProfiles?.length ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => setAlertsOpen((open) => !open)}
          aria-expanded={alertsOpen}
          aria-label={`Race alerts (${reminders.length})`}
          className={`min-w-[44px] min-h-[44px] px-1.5 rounded-full inline-flex items-center justify-center gap-1 text-xs font-semibold transition-colors ${
            alertsOpen
              ? 'bg-red-700 text-white'
              : reminders.length > 0
                ? 'text-amber-300 hover:bg-white/10'
                : 'text-white/90 hover:bg-white/10'
          }`}
        >
          <BellRing className="w-4 h-4 shrink-0" aria-hidden="true" />
          {reminders.length > 0 && (
            <span className="font-mono text-xs tabular-nums">{reminders.length}</span>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowProfile(true)}
        aria-label="Open profile and account settings"
        className="min-w-[44px] min-h-[44px] rounded-full inline-flex items-center justify-center hover:bg-white/10"
      >
        <span
          className="w-7 h-7 rounded-full overflow-hidden bg-red-700 text-white flex items-center justify-center text-xs font-semibold border border-white/25"
          aria-hidden="true"
        >
          {profile.photoURL ? (
            <img src={profile.photoURL} alt="" width={28} height={28} className="w-full h-full object-cover" />
          ) : (
            (profile.nickname || profile.displayName || 'R').charAt(0).toUpperCase()
          )}
        </span>
      </button>
    </div>
  );

  const hintSuppressed =
    showProfile ||
    alertsOpen ||
    showEventQrScanner ||
    Boolean(pendingBibClaim) ||
    imeOpen ||
    isRecordingRun ||
    (isCompact && mobileCanvasActive) ||
    eventsInFormFlow;

  return (
    <WorkspaceShell
      spaceTitle="Runner Portal"
      navLabel="Runner navigation"
      items={navItems}
      profile={profile}
      workspaceSwitch={workspaceSwitch}
      pendingApprovalNotice={pendingApprovalNotice}
      maxWidthClass="max-w-[1800px]"
      desktopLocked={isLocked}
      splitLocked={isSplitLocked}
      mobileBreakpoint="md600"
      bottomNavVariant="docked"
      hideBottomNav={imeOpen || isRecordingRun || (isCompact && mobileCanvasActive)}
      compactGutters
      onOpenProfile={() => setShowProfile(true)}
    >
      {isDesktop && headerCtx?.leftSlotEl ? createPortal(headerLeftMarkup, headerCtx.leftSlotEl) : null}
      {isDesktop && headerCtx?.rightSlotEl ? createPortal(headerRightMarkup, headerCtx.rightSlotEl) : null}
      {!isDesktop && showCompactHeader && headerCtx?.leftSlotEl
        ? createPortal(mobileHeaderLeftMarkup, headerCtx.leftSlotEl)
        : null}
      {!isDesktop && showCompactHeader && headerCtx?.rightSlotEl
        ? createPortal(mobileHeaderRightMarkup, headerCtx.rightSlotEl)
        : null}

      <RunnerOfflineBanner online={online} />

      {/* Strictly one <h1> in the active DOM at every breakpoint */}
      {isDesktop ? (
        <h1 className="sr-only">{currentMeta.title}</h1>
      ) : showCompactHeader && !headerCtx?.leftSlotEl ? (
        <header className="shrink-0 h-12 px-3 sm:px-4 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-baseline gap-2">
            <h1 className="font-display font-semibold text-base text-[var(--text-primary)] truncate">
              {currentMeta.title}
            </h1>
            <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] shrink-0">
              {telemetryContextSummary}
            </span>
          </div>
        </header>
      ) : !showCompactHeader ? (
        <h1 className="sr-only">{currentMeta.title}</h1>
      ) : null}

      {/* Compact Horizontal Telemetry Strip (< 96px height, divide-x, tabular-nums) */}
      {showTelemetryBar && (
        <div
          id="runner_portfolio_telemetry"
          className="shrink-0 w-full flex items-stretch justify-between bg-[var(--surface-card)] border-b border-[var(--border-default)]"
        >
          <RunnerTelemetryStrip
            items={telemetryItems}
            ariaLabel="Runner portfolio summary"
            className="flex-1 border-b-0"
          />
          {isDesktop && (
            <div className="hidden xl:flex items-center gap-3 px-4 border-l border-[var(--border-subtle)] shrink-0 text-xs text-[var(--text-secondary)]">
              {(runnerProfiles?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setAlertsOpen((open) => !open)}
                  aria-expanded={alertsOpen}
                  aria-controls="runner_alerts_drawer"
                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    alertsOpen
                      ? 'border-red-600 bg-red-700 text-white'
                      : reminders.length > 0
                        ? 'border-amber-600/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <BellRing className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Alerts</span>
                  <span className="font-mono tabular-nums">{reminders.length}</span>
                </button>
              )}
              <span className="font-mono tabular-nums">Showing {telemetryContextSummary}</span>
              <span className="font-mono px-2.5 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
                {profile.username ? `@${profile.username}` : profile.displayName}
              </span>
            </div>
          )}
        </div>
      )}

      {alertsOpen && (runnerProfiles?.length ?? 0) > 0 && (
        isCompact ? (
          <DialogSurface
            variant="sheet"
            dismissOnBackdropClick
            titleId="runner-alerts-sheet-title"
            onRequestClose={() => setAlertsOpen(false)}
          >
            <RunnerRemindersPanel
              titleId="runner-alerts-sheet-title"
              reminders={reminders}
              dismiss={dismiss}
              notificationPermission={notificationPermission}
              requestAlerts={requestAlerts}
              onOpenPass={(raceId) => {
                switchTabThen('you', () => {
                  setAlertsOpen(false);
                  setMyPassesFilter('all');
                  setRequestedPassRaceId(raceId);
                  setYouSection('passes');
                });
              }}
              onClose={() => setAlertsOpen(false)}
            />
          </DialogSurface>
        ) : (
          <div id="runner_alerts_drawer" className="shrink-0">
            <RunnerRemindersPanel
              reminders={reminders}
              dismiss={dismiss}
              notificationPermission={notificationPermission}
              requestAlerts={requestAlerts}
              onOpenPass={(raceId) => {
                switchTabThen('you', () => {
                  setAlertsOpen(false);
                  setMyPassesFilter('all');
                  setRequestedPassRaceId(raceId);
                  setYouSection('passes');
                });
              }}
              onClose={() => setAlertsOpen(false)}
            />
          </div>
        )
      )}

      {showProfile && (
        <AccountPrivacyModal profile={profile} runnerProfiles={runnerProfiles || []} onClose={() => setShowProfile(false)} />
      )}

      {pendingBibClaim && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick={!claimingBib}
          maxWidthCss="28rem"
          titleId="pending-bib-claim-title"
          onRequestClose={() => {
            if (!claimingBib) setPendingBibClaim(null);
          }}
          bodyClassName="p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="pending-bib-claim-title"
                className="text-lg font-semibold font-display text-[var(--text-primary)]"
              >
                {pendingBibClaim.alreadyLinked ? 'Already in My Passes' : 'Add this race bib?'}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 tabular-nums">
                {pendingBibClaim.race.name} · {pendingBibClaim.race.date}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close bib confirmation dialog"
              onClick={() => setPendingBibClaim(null)}
              disabled={claimingBib}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 shrink-0"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <dl className="border-y border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] text-xs">
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">Runner / team</dt>
              <dd className="font-semibold text-[var(--text-primary)] text-right truncate">
                {pendingBibClaim.runner.fullName}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">Bib number</dt>
              <dd className="text-base font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                #{pendingBibClaim.runner.bibNumber}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">Distance · Category</dt>
              <dd className="font-semibold text-[var(--text-primary)] capitalize">
                {pendingBibClaim.runner.distance} · {claimableEntryLabel(pendingBibClaim.runner.entryCategory)} ({pendingBibClaim.runner.gender})
              </dd>
            </div>
          </dl>

          {pendingBibClaim.runner.teamMembers && pendingBibClaim.runner.teamMembers.length > 1 && (
            <p className="text-xs text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Members: </span>
              {pendingBibClaim.runner.teamMembers.join(' · ')}
            </p>
          )}
          {bibClaimError && (
            <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
              {bibClaimError}
            </p>
          )}
          <p className="text-xs text-[var(--text-secondary)]">
            Only confirm if this is your official race bib. Splits and published results appear under My Passes.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPendingBibClaim(null)}
              disabled={claimingBib}
              className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmBibClaim}
              disabled={claimingBib}
              className="min-h-11 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-60"
            >
              {claimingBib ? 'Adding...' : pendingBibClaim.alreadyLinked ? 'Open My Passes' : 'Confirm & Add Race'}
            </button>
          </div>
        </DialogSurface>
      )}

      {runnerProfiles === undefined ? (
        <RunnerQueueSkeleton rows={6} label="Loading runner portal" />
      ) : (
        <AnimatedTabView
          tabKey={tab}
          direction={tabDirection}
          className="flex-1 min-h-0 flex flex-col"
        >
          {tab === 'home' && allowedTabs.includes('home') && (
            <RunnerHomePanel
              profile={profile}
              runnerProfiles={runnerProfiles}
              races={sharedRaces}
              racesLoaded={racesLoaded}
              friendsCount={friendsCount}
              friendFeed={friendFeed}
              recordedRuns={recordedRuns}
              onOpenPass={
                allowedTabs.includes('you')
                  ? (raceId) => {
                      setMyPassesFilter('all');
                      setRequestedPassRaceId(raceId);
                      setYouSection('passes');
                      void selectTab('you');
                    }
                  : undefined
              }
              onOpenExplore={
                allowedTabs.includes('explore')
                  ? (section = 'races', filter = 'open', raceId) => {
                      setExploreSection(section);
                      setExploreRacesFilter(filter);
                      if (raceId) {
                        setPendingDeepLinkRaceId(raceId);
                      }
                      void selectTab('explore');
                    }
                  : undefined
              }
              onOpenRecord={allowedTabs.includes('record') ? () => void selectTab('record') : undefined}
              onOpenRuns={
                allowedTabs.includes('you') && (canRecord || recordedRuns.length > 0)
                  ? () => {
                      setYouSection('runs');
                      void selectTab('you');
                    }
                  : undefined
              }
              onOpenFriends={
                canFriends && allowedTabs.includes('you')
                  ? () => {
                      setYouSection('friends');
                      void selectTab('you');
                    }
                  : undefined
              }
            />
          )}

          {tab === 'explore' && allowedTabs.includes('explore') && (
            <RunnerExplorePanel
              section={exploreSection}
              onSectionChange={setExploreSection}
              racesFilter={exploreRacesFilter}
              onRacesFilterChange={setExploreRacesFilter}
              searchQuery={exploreSearch}
              onSearchQueryChange={setExploreSearch}
              uid={profile.uid}
              friendIdentity={{ username: profile.username, displayName: profile.nickname || profile.displayName }}
              runnerProfiles={runnerProfiles}
              registeredRaceIds={registeredRaceIds}
              initialShirtSize={profile.shirtSize}
              profileRunClub={profile.runClub}
              requestedRaceId={scannedRaceId || pendingDeepLinkRaceId}
              onRequestedRaceHandled={handleEventsDeepLinkHandled}
              onScanQr={openQrScanner}
              onSaved={() => {
                setMyPassesFilter('all');
                setYouSection('passes');
                selectTab('you');
              }}
              onOpenProfile={() => setShowProfile(true)}
              onStartCourseRun={
                allowedTabs.includes('record')
                  ? (course) => {
                      setPreselectedCourse(course);
                      selectTab('record');
                    }
                  : undefined
              }
              races={sharedRaces}
              racesLoaded={racesLoaded}
              racesError={racesError}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              imeOpen={imeOpen}
              onCanvasModeChange={setMobileCanvasActive}
              onMetricsChange={handleExploreMetricsChange}
              onFormViewChange={setEventsInFormFlow}
              desktopSearchRef={headerSearchRef}
            />
          )}

          {tab === 'record' && allowedTabs.includes('record') && (
            <RunnerRecordPanel
              profile={profile}
              preselectedCourse={preselectedCourse}
              onSelectCourse={setPreselectedCourse}
              onOpenProfile={() => setShowProfile(true)}
              onBrowseRoutes={
                allowedTabs.includes('explore')
                  ? () => {
                      switchTabThen('explore', () => {
                        setExploreSection('routes');
                      });
                    }
                  : undefined
              }
              onRecordingStateChange={setIsRecordingRun}
              onRunSaved={handleRunSaved}
              theme={theme}
            />
          )}

          {tab === 'inbox' && allowedTabs.includes('inbox') && (
            <RunnerInboxPreviewPanel
              incomingRequests={incomingRequests}
              raceInvites={raceInvites}
              reminders={reminders}
              canFriends={canFriends}
              canInvites={canInvites}
              onAcceptRequest={handleAcceptFriendRequest}
              onDeclineRequest={handleDeclineFriendRequest}
              onOpenInvite={handleOpenRaceInvite}
              onOpenPass={
                allowedTabs.includes('you')
                  ? (raceId) => {
                      setMyPassesFilter('all');
                      setRequestedPassRaceId(raceId);
                      setYouSection('passes');
                      selectTab('you');
                    }
                  : undefined
              }
              onDismissReminder={dismiss}
              onOpenFriends={
                canFriends && allowedTabs.includes('you')
                  ? () => {
                      setYouSection('friends');
                      selectTab('you');
                    }
                  : undefined
              }
            />
          )}

          {tab === 'you' && allowedTabs.includes('you') && (
            <RunnerYouHubPanel
              section={youSection}
              onSectionChange={setYouSection}
              profile={profile}
              runnerProfiles={runnerProfiles}
              races={sharedRaces}
              racesLoaded={racesLoaded}
              friendsCount={friendsCount}
              canFriends={canFriends}
              canEngraving={canEngraving}
              canRecord={canRecord}
              recordedRuns={recordedRuns}
              recordedRunsLoaded={recordedRunsLoaded}
              recordedRunsError={recordedRunsError}
              onUpdateRunPrivacy={handleUpdateRunPrivacy}
              onDeleteRun={handleDeleteRun}
              onExportRunGpx={handleExportRunGpx}
              badgeCatalog={badgeCatalog}
              badgesLoaded={badgesLoaded}
              badgesError={badgesError}
              userBadges={userBadges}
              userBadgesLoaded={userBadgesLoaded}
              athleteProgression={athleteProgression}
              requestedPassRaceId={requestedPassRaceId}
              onRequestedPassHandled={handlePassDeepLinkHandled}
              onBrowseEvents={() => {
                if (!allowedTabs.includes('explore')) return;
                setExploreSection('races');
                setExploreRacesFilter('open');
                selectTab('explore');
              }}
              onOpenExploreRace={(raceId) => {
                if (!allowedTabs.includes('explore')) return;
                setScannedRaceId(raceId);
                setExploreSection('races');
                setExploreRacesFilter('open');
                selectTab('explore');
              }}
              onScanQr={openQrScanner}
              onOpenProfile={() => setShowProfile(true)}
              onOpenRecord={allowedTabs.includes('record') ? () => selectTab('record') : undefined}
              myPassesSearch={myPassesSearch}
              onMyPassesSearchChange={setMyPassesSearch}
              myPassesFilter={myPassesFilter}
              onMyPassesFilterChange={setMyPassesFilter}
              onMyPassesMetricsChange={handleMyPassesMetricsChange}
              friendsSearch={friendsSearch}
              onFriendsSearchChange={setFriendsSearch}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              onCanvasModeChange={setMobileCanvasActive}
              desktopSearchRef={headerSearchRef}
              engravingNode={
                canEngraving ? (
                  <RunnerEngravingView
                    profile={profile}
                    runnerProfiles={runnerProfiles}
                    races={sharedRaces}
                    onBackToMyRaces={() => setYouSection('passes')}
                  />
                ) : undefined
              }
            />
          )}
        </AnimatedTabView>
      )}

      {tab === 'explore' && (
        <RunnerOnboardingHint
          id="runner-explore-hint"
          storageKey="racepulse_hint_explore_v1"
          title="Events, Routes & Clubs"
          body="Switch between Races, Philippine Course Maps, and Clubs from the Explore bar."
          suppress={hintSuppressed || Boolean(nextToastItem)}
        />
      )}

      {tab === 'record' && (
        <RunnerOnboardingHint
          id="runner-record-hint"
          storageKey="racepulse_hint_record_v1"
          title="Live Run Recorder"
          body="Test your satellite lock, pick an optional race course, and record splits with 200 m home privacy trim."
          suppress={hintSuppressed || Boolean(nextToastItem)}
        />
      )}

      <AchievementUnlockToast
        award={nextToastItem?.award ?? null}
        badge={nextToastItem?.badge ?? null}
        suppress={hintSuppressed || isRecordingRun}
        onOpenBadges={() => switchTabThen('you', () => setYouSection('badges'))}
        onDismiss={handleDismissAchievementToast}
      />

      {showEventQrScanner && (
        <QrScannerModal
          onClose={() => setShowEventQrScanner(false)}
          onScanSuccess={scanEventQr}
          successMessage={eventQrMessage}
          errorMessage={eventQrError}
          title="Scan Race or Bib QR"
          subtitle="OPEN EVENT OR ADD MY RACE"
          instructions="Scan an organizer event QR to open registration, or scan the QR printed on your race bib to add that event and its result to My Passes."
        />
      )}
    </WorkspaceShell>
  );
}

// ========== RUNNER ENGRAVING AUTOFILL ==========

function RunnerEngravingView({
  profile,
  runnerProfiles,
  races,
  onBackToMyRaces,
}: {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  races: Race[];
  onBackToMyRaces: () => void;
}) {
  const [resultsByRaceId, setResultsByRaceId] = useState<Record<string, PublicLiveResults | null>>({});

  const uniqueRaceIds = useMemo(
    () => Array.from(new Set(runnerProfiles.map((rp) => rp.raceId))).sort(),
    [runnerProfiles],
  );

  useEffect(() => {
    if (uniqueRaceIds.length === 0) {
      setResultsByRaceId({});
      return;
    }
    const raceSet = new Set(uniqueRaceIds);
    return subscribeSharedLiveResults((map, loaded, err) => {
      if (err) {
        setResultsByRaceId({});
        return;
      }
      if (!loaded) return;
      const next: Record<string, PublicLiveResults | null> = {};
      raceSet.forEach((raceId) => {
        next[raceId] = map[raceId] ?? null;
      });
      setResultsByRaceId(next);
    });
  }, [uniqueRaceIds]);

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);

  const racePrefills = useMemo<EngravingRacePrefill[]>(() => {
    return [...runnerProfiles]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((rp) => {
        const race = raceById.get(rp.raceId);
        const liveSummary = resultsByRaceId[rp.raceId];
        const entry = liveSummary?.officialResults?.find((item) => item.bibNumber === rp.bibNumber);
        const overallRank = entry ? entry.overallRank ?? entry.rank : undefined;
        const rankText = overallRank
          ? `#${overallRank}${entry?.categoryRank ? ` (${entry.categoryLabel || 'Cat'} #${entry.categoryRank})` : ''}`
          : undefined;
        return {
          key: `${rp.raceId}_${rp.bibNumber}`,
          label: `${race?.name || rp.raceId} · ${rp.distance} · Bib #${rp.bibNumber}`,
          runnerName: rp.fullName || profile.displayName || '',
          bibNumber: rp.bibNumber,
          distance: rp.distance,
          finishingTime: entry?.finishTime,
          rank: rankText,
        };
      });
  }, [runnerProfiles, raceById, resultsByRaceId, profile.displayName]);

  const fallbackProfile = runnerProfiles[0];
  return (
    <CustomerForm
      embedded
      onBackToRoleSelection={onBackToMyRaces}
      backLabel="← Back to My Passes"
      ownerUid={profile.uid}
      initialRunnerName={fallbackProfile?.fullName || profile.displayName || ''}
      initialBibNumber={fallbackProfile?.bibNumber || ''}
      racePrefills={racePrefills}
    />
  );
}
