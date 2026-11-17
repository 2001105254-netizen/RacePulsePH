import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import {
  Award,
  BellRing,
  Camera,
  ClipboardList,
  Flag,
  Search,
  Trophy,
  Users2,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { useAccess } from '../lib/access';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import { claimRaceBib, claimableEntryLabel, parseRaceBibQr, previewRaceBibClaim, RaceBibClaimPreview } from '../lib/raceBibClaim';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { subscribeSharedRaces } from '../lib/racesStore';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import { FriendActivity, PublicLiveResults, Race, RunnerProfile, UserProfile } from '../types';
import AccountPrivacyModal from './AccountPrivacyModal';
import CustomerForm, { type EngravingRacePrefill } from './CustomerForm';
import type { WorkspaceSwitchProps } from './DesktopSidebar';
import QrScannerModal from './QrScannerModal';
import { RunnerRemindersPanel, useRunnerReminders } from './RunnerReminderCenter';
import WorkspaceShell from './WorkspaceShell';
import RunnerAllRacesPanel, { type CatalogStatusFilter } from './runner/RunnerAllRacesPanel';
import RunnerEventsPanel, { type OpenEventsFilter } from './runner/RunnerEventsPanel';
import RunnerFriendsPanel from './runner/RunnerFriendsPanel';
import {
  RunnerOfflineBanner,
  RunnerQueueSkeleton,
  RunnerTelemetryStrip,
  type RunnerTelemetryItem,
} from './runner/RunnerMobilePrimitives';
import RunnerMyRacesPanel, { type MyPassesFilter } from './runner/RunnerMyRacesPanel';
import {
  philippineTodayStr,
  useNetworkSyncStatus,
  useRunnerViewport,
  useSoftKeyboardOpen,
} from './runner/runnerUtils';
import DialogSurface from './ui/DialogSurface';
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

type RunnerTab = 'events' | 'allraces' | 'myraces' | 'friends' | 'engraving';

const RUNNER_TAB_ORDER: readonly RunnerTab[] = ['events', 'allraces', 'myraces', 'friends', 'engraving'];

export default function RunnerDashboard({
  profile,
  initialRaceId,
  onInitialRaceHandled,
  workspaceSwitch,
  pendingApprovalNotice,
}: RunnerDashboardProps) {
  const { can } = useAccess();
  const headerCtx = useWorkspaceHeader();
  const { isCompact, isSplitPane, isDesktop } = useRunnerViewport();
  const { online } = useNetworkSyncStatus();
  const [mobileCanvasActive, setMobileCanvasActive] = useState(false);

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined);
  const [sharedRaces, setSharedRaces] = useState<Race[]>([]);
  const [racesLoaded, setRacesLoaded] = useState(false);
  const [racesError, setRacesError] = useState<string | null>(null);
  const [friendsCount, setFriendsCount] = useState(0);

  const hasPaymentParam =
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('payment'));

  const homeTab: RunnerTab = can('personal.register')
    ? 'events'
    : can('personal.results') || can('personal.bibs')
    ? 'myraces'
    : can('personal.friends')
    ? 'friends'
    : 'engraving';

  const [tab, setTab] = useState<RunnerTab>(() => (hasPaymentParam && can('personal.register') ? 'events' : homeTab));
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

  // Per-tab search + status filters synced into desktop top header & telemetry ribbon
  const [eventsSearch, setEventsSearch] = useState('');
  const [eventsFilter, setEventsFilter] = useState<OpenEventsFilter>('all');
  const [eventsMetrics, setEventsMetrics] = useState({ total: 0, unjoined: 0, registered: 0, showing: 0 });
  const [eventsInFormFlow, setEventsInFormFlow] = useState(false);

  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogStatusFilter>('all');
  const [catalogMetrics, setCatalogMetrics] = useState({ all: 0, upcoming: 0, completed: 0, showing: 0 });

  const [myPassesSearch, setMyPassesSearch] = useState('');
  const [myPassesFilter, setMyPassesFilter] = useState<MyPassesFilter>('all');
  const [myPassesMetrics, setMyPassesMetrics] = useState({ all: 0, upcoming: 0, completed: 0, showing: 0 });

  const [friendsSearch, setFriendsSearch] = useState('');

  const handleEventsMetricsChange = useCallback(
    (next: { total: number; unjoined: number; registered: number; showing: number }) => {
      setEventsMetrics((prev) =>
        prev.total === next.total &&
        prev.unjoined === next.unjoined &&
        prev.registered === next.registered &&
        prev.showing === next.showing
          ? prev
          : next,
      );
    },
    [],
  );

  const handleCatalogMetricsChange = useCallback(
    (next: { all: number; upcoming: number; completed: number; showing: number }) => {
      setCatalogMetrics((prev) =>
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
  const showProfileRef = useRef(showProfile);
  showProfileRef.current = showProfile;

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

  useEffect(() => {
    if (!can('personal.friends')) {
      setFriendsCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, 'friendships'), where('members', 'array-contains', profile.uid)),
      (snapshot) => setFriendsCount(snapshot.size),
      () => setFriendsCount(0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.uid]);

  const selectTab = useCallback((nextTab: RunnerTab, explicitDirection?: NavDirection) => {
    const currentTab = tabRef.current;
    if (nextTab === currentTab) return;
    setTabDirection(explicitDirection ?? resolveTabDirection(RUNNER_TAB_ORDER, currentTab, nextTab));
    setTab(nextTab);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  useAndroidBackHandler(showProfile, () => setShowProfile(false));
  useAndroidBackHandler(alertsOpen, () => setAlertsOpen(false));
  useAndroidBackHandler(Boolean(pendingBibClaim), () => {
    if (!claimingBib) setPendingBibClaim(null);
  });

  useEffect(() => {
    const goHome = (event: Event) => {
      const hardware = event instanceof CustomEvent && Boolean(event.detail?.hardware);
      if (hardware) {
        if (event.defaultPrevented || (tabRef.current === homeTabRef.current && !showProfileRef.current)) return;
        event.preventDefault();
      }
      setShowProfile(false);
      setAlertsOpen(false);
      selectTab(hardware ? homeTabRef.current : 'events', 'back');
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, [selectTab]);

  useEffect(() => {
    if (!initialRaceId) return;
    setPendingDeepLinkRaceId(initialRaceId);
    setTab('events');
    onInitialRaceHandled?.();
  }, [initialRaceId, onInitialRaceHandled]);

  useEffect(() => {
    if (!['personal.register', 'personal.results', 'personal.bibs', 'personal.certificates'].some(can)) {
      setRunnerProfiles([]);
      return;
    }
    let directProfiles: RunnerProfile[] = [];
    let claimedProfiles: RunnerProfile[] = [];
    const publish = () => {
      // A normal in-app registration always wins over a QR claim for the
      // same event. QR claims are for Google Form/imported rosters, where the
      // registration was made before the runner had a RacePulse account.
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
        // Older deployments have no runnerClaims rule yet. The normal runner
        // list still works while the rules/function deployment is completed.
        console.warn('Runner bib claims listener failed:', err.message);
        claimedProfiles = [];
        publish();
      },
    );
    return () => {
      unsubscribeProfiles();
      unsubscribeClaims();
    };
  }, [profile.uid]);

  // Legacy accounts get their safe friend card automatically once they open
  // the Runner Portal. No email or private medical/payment fields are copied.
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

  // Publish only a short race summary for accepted friends. Raw registrations,
  // bibs, results, payment state, and medical/emergency data stay private.
  useEffect(() => {
    if (!runnerProfiles) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDocs(collection(db, 'races'));
        if (cancelled) return;
        const raceById = new Map<string, Race>();
        snapshot.forEach((item) => raceById.set(item.id, item.data() as Race));
        const recentRaces = [...runnerProfiles]
          .map((runner) => {
            const race = raceById.get(runner.raceId);
            return race ? { raceId: race.id, raceName: race.name, date: race.date, distance: runner.distance } : null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6);
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
  }, [profile.uid, runnerProfiles]);

  const { reminders, dismiss, notificationPermission, requestAlerts } = useRunnerReminders(runnerProfiles);

  // Viewport lock: list and split tabs lock 100dvh on all viewports, while registration form & engraving scroll freely
  const isLockedTab =
    tab === 'allraces' || tab === 'myraces' || tab === 'friends' || (tab === 'events' && !eventsInFormFlow);
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
          preview.alreadyLinked ? 'This race is already in My Races.' : 'Race bib found: review the details to add it.',
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
      setScannedRaceId(raceId);
      selectTab('events');
      window.setTimeout(() => setShowEventQrScanner(false), 450);
      return true;
    } catch {
      setEventQrError('This is not a valid RacePulse event registration QR code.');
      return false;
    }
  };

  const confirmBibClaim = async () => {
    if (!pendingBibClaim || pendingBibClaim.alreadyLinked) {
      if (pendingBibClaim?.race.id) {
        setRequestedPassRaceId(pendingBibClaim.race.id);
      }
      setPendingBibClaim(null);
      selectTab('myraces');
      return;
    }
    setClaimingBib(true);
    setBibClaimError('');
    try {
      await claimRaceBib(pendingBibClaim.payload);
      setRequestedPassRaceId(pendingBibClaim.race.id);
      setPendingBibClaim(null);
      selectTab('myraces');
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

  const navItems = [
    {
      key: 'events',
      icon: <Flag className="w-4 h-4" />,
      label: 'Events',
      shortLabel: 'Events',
      active: tab === 'events',
      onClick: () => selectTab('events'),
    },
    {
      key: 'allraces',
      icon: <Trophy className="w-4 h-4" />,
      label: 'All Races',
      shortLabel: 'Catalog',
      active: tab === 'allraces',
      onClick: () => selectTab('allraces'),
    },
    {
      key: 'myraces',
      icon: <ClipboardList className="w-4 h-4" />,
      label: 'My Races',
      shortLabel: 'Passes',
      active: tab === 'myraces',
      onClick: () => selectTab('myraces'),
    },
    {
      key: 'friends',
      icon: <Users2 className="w-4 h-4" />,
      label: 'Friends',
      shortLabel: 'Friends',
      active: tab === 'friends',
      onClick: () => selectTab('friends'),
    },
    {
      key: 'engraving',
      icon: <Award className="w-4 h-4" />,
      label: 'Engraving',
      shortLabel: 'Engrave',
      active: tab === 'engraving',
      onClick: () => selectTab('engraving'),
    },
  ].filter((item) => {
    if (item.key === 'myraces') {
      return can('personal.results') || can('personal.bibs') || can('personal.certificates') || can('personal.register');
    }
    if (item.key === 'allraces') {
      return can('personal.results') || can('personal.register');
    }
    return can({ events: 'personal.register', friends: 'personal.friends', engraving: 'personal.engraving' }[item.key]!);
  });

  const registeredRaceIds = useMemo(
    () => new Set((runnerProfiles || []).map((rp) => rp.raceId)),
    [runnerProfiles],
  );
  const sharedRaceById = useMemo(() => new Map(sharedRaces.map((r) => [r.id, r])), [sharedRaces]);
  const todayStr = philippineTodayStr();

  const totalPassesCount = runnerProfiles?.length ?? 0;
  const upcomingPassesCount = useMemo(
    () =>
      (runnerProfiles || []).filter((rp) => {
        const race = sharedRaceById.get(rp.raceId);
        return !race?.completedAt && (race?.date || '9999') >= todayStr;
      }).length,
    [runnerProfiles, sharedRaceById, todayStr],
  );
  const completedPassesCount = Math.max(0, totalPassesCount - upcomingPassesCount);
  const openEventsCount = useMemo(
    () => sharedRaces.filter((race) => isRaceRegistrationOpen(race)).length,
    [sharedRaces],
  );

  const activeTabMeta: Record<RunnerTab, { title: string; icon: React.ReactNode }> = {
    events: {
      title: eventsInFormFlow ? 'Event Registration' : 'Open Events',
      icon: <Flag className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    allraces: {
      title: 'All Race Events',
      icon: <Trophy className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    myraces: {
      title: 'My Race Passes',
      icon: <ClipboardList className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    friends: {
      title: 'Runner Friends',
      icon: <Users2 className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
    engraving: {
      title: 'Medal Engraving',
      icon: <Award className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
    },
  };
  const currentMeta = activeTabMeta[tab];

  // Active header search config per tab
  const activeSearchConfig =
    tab === 'events' && !eventsInFormFlow
      ? {
          id: 'runner_events_header_search',
          value: eventsSearch,
          onChange: setEventsSearch,
          label: 'Search open races by name, date, or distance',
          placeholder: 'Search event, date, or distance... (/)',
        }
      : tab === 'allraces'
      ? {
          id: 'runner_catalog_header_search',
          value: catalogSearch,
          onChange: setCatalogSearch,
          label: 'Search all races by name, date, or distance',
          placeholder: 'Search race, date, or distance... (/)',
        }
      : tab === 'myraces'
      ? {
          id: 'runner_passes_header_search',
          value: myPassesSearch,
          onChange: setMyPassesSearch,
          label: 'Search your registered race passes',
          placeholder: 'Search race, bib #, or distance... (/)',
        }
      : tab === 'friends'
      ? {
          id: 'runner_friends_header_search',
          value: friendsSearch,
          onChange: setFriendsSearch,
          label: 'Filter connected friends by name or handle',
          placeholder: 'Filter connected friends... (/)',
        }
      : null;

  // Admin-consistent Desktop Header Left Cluster: vertical rule + module title + inline search
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

  // Admin-consistent Desktop Header Right Cluster: view-specific status segmented pills + primary CTA
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
      {tab === 'events' &&
        !eventsInFormFlow &&
        renderSegmentedHeaderFilter<OpenEventsFilter>(
          'Filter open races by registration status',
          [
            { key: 'all', label: 'All Open', count: eventsMetrics.total },
            { key: 'unjoined', label: 'Available', count: eventsMetrics.unjoined },
            { key: 'registered', label: 'Joined', count: eventsMetrics.registered },
          ],
          eventsFilter,
          setEventsFilter,
        )}

      {tab === 'allraces' &&
        renderSegmentedHeaderFilter<CatalogStatusFilter>(
          'Filter race catalog by status',
          [
            { key: 'all', label: 'All', count: catalogMetrics.all },
            { key: 'upcoming', label: 'Upcoming', count: catalogMetrics.upcoming },
            { key: 'completed', label: 'Completed', count: catalogMetrics.completed },
          ],
          catalogFilter,
          setCatalogFilter,
        )}

      {tab === 'myraces' &&
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
        className="h-9 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white border border-red-500/30 text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
      >
        <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Scan Race / Bib QR</span>
      </button>
    </div>
  );

  const telemetryLoading = runnerProfiles === undefined;
  const telemetryContextSummary =
    tab === 'events'
      ? `${eventsMetrics.showing}/${eventsMetrics.total}`
      : tab === 'allraces'
        ? `${catalogMetrics.showing}/${catalogMetrics.all}`
        : tab === 'myraces'
          ? `${myPassesMetrics.showing}/${myPassesMetrics.all}`
          : tab === 'friends'
            ? `${friendsCount}`
            : `${totalPassesCount}`;

  const telemetryItems: RunnerTelemetryItem[] = [
    {
      key: 'passes',
      label: 'Passes',
      value: totalPassesCount,
      loading: telemetryLoading,
      active: tab === 'myraces' && myPassesFilter === 'all',
      onClick: () => {
        setMyPassesFilter('all');
        selectTab('myraces');
      },
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      value: upcomingPassesCount,
      loading: telemetryLoading,
      accent: 'emerald',
      active: tab === 'myraces' && myPassesFilter === 'upcoming',
      onClick: () => {
        setMyPassesFilter('upcoming');
        selectTab('myraces');
      },
    },
    ...(can('personal.register')
      ? [
          {
            key: 'events',
            label: 'Open',
            value: openEventsCount,
            loading: !racesLoaded,
            accent: 'red' as const,
            active: tab === 'events',
            onClick: () => selectTab('events'),
          },
        ]
      : []),
    ...(can('personal.friends')
      ? [
          {
            key: 'friends',
            label: 'Friends',
            value: friendsCount,
            active: tab === 'friends',
            onClick: () => selectTab('friends'),
          },
        ]
      : []),
  ];

  const showCompactHeader = !isDesktop && !(isCompact && mobileCanvasActive);
  const showTelemetryBar = !(isCompact && (mobileCanvasActive || eventsInFormFlow));

  const mobileHeaderLeftMarkup = (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="h-4 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <h1 className="font-display font-semibold text-sm sm:text-base text-white truncate">
        {currentMeta.title}
      </h1>
      {!(tab === 'events' && eventsInFormFlow) && (
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
      hideBottomNav={imeOpen || (isCompact && mobileCanvasActive)}
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
            className="bg-[var(--surface-card)] p-0"
          >
            <RunnerRemindersPanel
              titleId="runner-alerts-sheet-title"
              reminders={reminders}
              dismiss={dismiss}
              notificationPermission={notificationPermission}
              requestAlerts={requestAlerts}
              onOpenPass={(raceId) => {
                setAlertsOpen(false);
                setMyPassesFilter('all');
                setRequestedPassRaceId(raceId);
                selectTab('myraces');
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
                setAlertsOpen(false);
                setMyPassesFilter('all');
                setRequestedPassRaceId(raceId);
                selectTab('myraces');
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
          className="bg-[var(--surface-card)] p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="pending-bib-claim-title"
                className="text-lg font-semibold font-display text-[var(--text-primary)]"
              >
                {pendingBibClaim.alreadyLinked ? 'Already in My Races' : 'Add this race bib?'}
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
            Only confirm if this is your official race bib. Splits and published results appear under My Races.
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
              {claimingBib ? 'Adding...' : pendingBibClaim.alreadyLinked ? 'Open My Races' : 'Confirm & Add Race'}
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
          {tab === 'events' && can('personal.register') && (
            <RunnerEventsPanel
              uid={profile.uid}
              friendIdentity={{ username: profile.username, displayName: profile.nickname || profile.displayName }}
              runnerProfiles={runnerProfiles}
              registeredRaceIds={registeredRaceIds}
              initialShirtSize={profile.shirtSize}
              requestedRaceId={scannedRaceId || pendingDeepLinkRaceId}
              onRequestedRaceHandled={handleEventsDeepLinkHandled}
              onBrowseAllRaces={() => selectTab('allraces')}
              onScanQr={openQrScanner}
              onSaved={() => {
                setMyPassesFilter('all');
                selectTab('myraces');
              }}
              races={sharedRaces}
              racesLoaded={racesLoaded}
              racesError={racesError}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              imeOpen={imeOpen}
              onCanvasModeChange={setMobileCanvasActive}
              searchQuery={eventsSearch}
              onSearchQueryChange={setEventsSearch}
              statusFilter={eventsFilter}
              onStatusFilterChange={setEventsFilter}
              onMetricsChange={handleEventsMetricsChange}
              onFormViewChange={setEventsInFormFlow}
              desktopSearchRef={headerSearchRef}
            />
          )}

          {tab === 'allraces' && (can('personal.results') || can('personal.register')) && (
            <RunnerAllRacesPanel
              races={sharedRaces}
              racesLoaded={racesLoaded}
              racesError={racesError}
              registeredRaceIds={registeredRaceIds}
              onRegister={(raceId) => {
                setScannedRaceId(raceId);
                selectTab('events');
              }}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              onCanvasModeChange={setMobileCanvasActive}
              searchQuery={catalogSearch}
              onSearchQueryChange={setCatalogSearch}
              statusFilter={catalogFilter}
              onStatusFilterChange={setCatalogFilter}
              onMetricsChange={handleCatalogMetricsChange}
              desktopSearchRef={headerSearchRef}
            />
          )}

          {tab === 'myraces' && (
            <RunnerMyRacesPanel
              runnerProfiles={runnerProfiles}
              races={sharedRaces}
              racesLoaded={racesLoaded}
              onBrowseEvents={() => selectTab('events')}
              onScanQr={openQrScanner}
              onOpenEngraving={can('personal.engraving') ? () => selectTab('engraving') : undefined}
              requestedRaceId={requestedPassRaceId}
              onRequestedRaceHandled={handlePassDeepLinkHandled}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              onCanvasModeChange={setMobileCanvasActive}
              searchQuery={myPassesSearch}
              onSearchQueryChange={setMyPassesSearch}
              statusFilter={myPassesFilter}
              onStatusFilterChange={setMyPassesFilter}
              onMetricsChange={handleMyPassesMetricsChange}
              desktopSearchRef={headerSearchRef}
            />
          )}

          {tab === 'friends' && can('personal.friends') && (
            <RunnerFriendsPanel
              profile={profile}
              onOpenRace={(raceId) => {
                setScannedRaceId(raceId);
                selectTab('events');
              }}
              onOpenProfile={() => setShowProfile(true)}
              searchQuery={friendsSearch}
              onSearchQueryChange={setFriendsSearch}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              desktopSearchRef={headerSearchRef}
            />
          )}

          {tab === 'engraving' && can('personal.engraving') && (
            <RunnerEngravingView
              profile={profile}
              runnerProfiles={runnerProfiles}
              races={sharedRaces}
              onBackToMyRaces={() => selectTab('myraces')}
            />
          )}
        </AnimatedTabView>
      )}

      {showEventQrScanner && (
        <QrScannerModal
          onClose={() => setShowEventQrScanner(false)}
          onScanSuccess={scanEventQr}
          successMessage={eventQrMessage}
          errorMessage={eventQrError}
          title="Scan Race or Bib QR"
          subtitle="OPEN EVENT OR ADD MY RACE"
          instructions="Scan an organizer event QR to open registration, or scan the QR printed on your race bib to add that event and its result to My Races."
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
    const unsubscribes = uniqueRaceIds.map((raceId) =>
      onSnapshot(
        doc(db, 'liveResults', raceId),
        (snapshot) => {
          setResultsByRaceId((prev) => ({
            ...prev,
            [raceId]: snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null,
          }));
        },
        () => {
          setResultsByRaceId((prev) => ({ ...prev, [raceId]: null }));
        },
      ),
    );
    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
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
      backLabel="← Back to My Races"
      ownerUid={profile.uid}
      initialRunnerName={fallbackProfile?.fullName || profile.displayName || ''}
      initialBibNumber={fallbackProfile?.bibNumber || ''}
      racePrefills={racePrefills}
    />
  );
}
