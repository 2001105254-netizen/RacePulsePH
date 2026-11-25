import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  ClipboardList,
  Download,
  Lock,
  Navigation,
  QrCode,
  RefreshCw,
  Scale,
  Settings,
  ShieldCheck,
  Trash2,
  Trophy,
  User,
  Users2,
} from 'lucide-react';
import { computeLevelXpWindow } from '../../lib/badges/presets';
import type { AthleteProgression, BadgeDefinition, UserBadgeAward } from '../../lib/badges/types';
import { computeRunnerPortfolioCounts, type YouSection } from '../../lib/runnerShell';
import { formatDuration, formatPace, PRIVACY_OPTIONS } from '../../lib/runs/runLiveHelpers';
import type { RecordedRunPrivacy, RecordedRunSummary } from '../../lib/runs/types';
import type { Race, RunnerProfile, UserProfile } from '../../types';
import BadgeArtwork from '../badges/BadgeArtwork';
import Select from '../ui/Select';
import RunnerBadgesPanel, { buildAwardFallbackBadge } from './RunnerBadgesPanel';
import RunnerFriendsPanel from './RunnerFriendsPanel';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';
import RunnerMyRacesPanel, { type MyPassesFilter } from './RunnerMyRacesPanel';
import { philippineTodayStr } from './runnerUtils';

const manilaRunDateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatManilaRunTimestamp(isoString: string): string {
  const parsedMs = Date.parse(isoString);
  if (!Number.isFinite(parsedMs)) return isoString;
  try {
    return manilaRunDateFormatter.format(new Date(parsedMs));
  } catch {
    return isoString;
  }
}

type RunCardBusyAction = 'privacy' | 'gpx' | 'delete';

export interface RunnerYouHubPanelProps {
  section: YouSection;
  onSectionChange: (next: YouSection) => void;
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  races: Race[];
  racesLoaded: boolean;
  friendsCount: number;
  canFriends: boolean;
  canEngraving: boolean;
  canRecord: boolean;
  recordedRuns: RecordedRunSummary[];
  recordedRunsLoaded: boolean;
  recordedRunsError?: string | null;
  onUpdateRunPrivacy?: (run: RecordedRunSummary, nextPrivacy: RecordedRunPrivacy) => Promise<void>;
  onDeleteRun?: (run: RecordedRunSummary) => Promise<void>;
  onExportRunGpx?: (run: RecordedRunSummary) => Promise<void> | void;
  badgeCatalog: BadgeDefinition[];
  badgesLoaded: boolean;
  badgesError: string | null;
  userBadges: UserBadgeAward[];
  userBadgesLoaded: boolean;
  athleteProgression: AthleteProgression;
  requestedPassRaceId?: string | null;
  onRequestedPassHandled?: () => void;
  onBrowseEvents: () => void;
  onOpenExploreRace: (raceId: string) => void;
  onScanQr: () => void;
  onOpenProfile: () => void;
  onOpenRecord?: () => void;
  onStartDm?: (targetUid: string) => void;
  myPassesSearch: string;
  onMyPassesSearchChange: (value: string) => void;
  myPassesFilter: MyPassesFilter;
  onMyPassesFilterChange: (value: MyPassesFilter) => void;
  onMyPassesMetricsChange?: (metrics: { all: number; upcoming: number; completed: number; showing: number }) => void;
  friendsSearch: string;
  onFriendsSearchChange: (value: string) => void;
  isDesktop: boolean;
  isSplitPane: boolean;
  isCompact: boolean;
  onCanvasModeChange?: (active: boolean) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
  engravingNode?: React.ReactNode;
}

export default function RunnerYouHubPanel({
  section,
  onSectionChange,
  profile,
  runnerProfiles,
  races,
  racesLoaded,
  friendsCount,
  canFriends,
  canEngraving,
  canRecord,
  recordedRuns,
  recordedRunsLoaded,
  recordedRunsError,
  onUpdateRunPrivacy,
  onDeleteRun,
  onExportRunGpx,
  badgeCatalog,
  badgesLoaded,
  badgesError,
  userBadges,
  userBadgesLoaded,
  athleteProgression,
  requestedPassRaceId,
  onRequestedPassHandled,
  onBrowseEvents,
  onOpenExploreRace,
  onScanQr,
  onOpenProfile,
  onOpenRecord,
  onStartDm,
  myPassesSearch,
  onMyPassesSearchChange,
  myPassesFilter,
  onMyPassesFilterChange,
  onMyPassesMetricsChange,
  friendsSearch,
  onFriendsSearchChange,
  isDesktop,
  isSplitPane,
  isCompact,
  onCanvasModeChange,
  desktopSearchRef,
  engravingNode,
}: RunnerYouHubPanelProps) {
  const baseId = useId();
  const [mobileCanvasActive, setMobileCanvasActive] = useState(false);
  const [busyByRunId, setBusyByRunId] = useState<Record<string, RunCardBusyAction | undefined>>({});
  const tabRefs = useRef<Record<YouSection, HTMLButtonElement | null>>({
    overview: null,
    runs: null,
    badges: null,
    passes: null,
    friends: null,
    engraving: null,
  });

  const xpWindow = useMemo(
    () => computeLevelXpWindow(athleteProgression),
    [athleteProgression],
  );

  const recentEarnedBadges = useMemo(() => {
    const byId = new Map(badgeCatalog.map((b) => [b.badgeId, b]));
    return userBadges
      .slice(0, 3)
      .map((award) => byId.get(award.badgeId) ?? buildAwardFallbackBadge(award));
  }, [badgeCatalog, userBadges]);

  const showRunsSection = canRecord || recordedRuns.length > 0;

  const privacySelectOptions = useMemo(
    () =>
      PRIVACY_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        sublabel: opt.hint,
      })),
    [],
  );

  const sections = useMemo(() => {
    const items: Array<{ key: YouSection; label: string; count?: number }> = [
      { key: 'overview', label: 'Overview' },
    ];
    if (showRunsSection) {
      items.push({
        key: 'runs',
        label: 'Runs',
        count: recordedRunsLoaded ? recordedRuns.length : undefined,
      });
    }
    items.push({
      key: 'badges',
      label: 'Badges',
      count: userBadgesLoaded ? userBadges.length : undefined,
    });
    items.push({ key: 'passes', label: 'My Passes', count: runnerProfiles.length });
    if (canFriends) {
      items.push({ key: 'friends', label: 'Friends', count: friendsCount });
    }
    if (canEngraving) {
      items.push({ key: 'engraving', label: 'Engraving' });
    }
    return items;
  }, [
    showRunsSection,
    recordedRunsLoaded,
    recordedRuns.length,
    userBadgesLoaded,
    userBadges.length,
    runnerProfiles.length,
    canFriends,
    friendsCount,
    canEngraving,
  ]);

  const setRunBusy = useCallback((runId: string, action: RunCardBusyAction | undefined) => {
    setBusyByRunId((prev) => {
      if (action === undefined) {
        if (!(runId in prev)) return prev;
        const next = { ...prev };
        delete next[runId];
        return next;
      }
      return { ...prev, [runId]: action };
    });
  }, []);

  const handlePrivacyChange = useCallback(
    async (run: RecordedRunSummary, nextPrivacy: RecordedRunPrivacy) => {
      if (!onUpdateRunPrivacy || run.privacy === nextPrivacy) return;
      setRunBusy(run.runId, 'privacy');
      try {
        await onUpdateRunPrivacy(run, nextPrivacy);
      } finally {
        setRunBusy(run.runId, undefined);
      }
    },
    [onUpdateRunPrivacy, setRunBusy],
  );

  const handleExportGpx = useCallback(
    async (run: RecordedRunSummary) => {
      if (!onExportRunGpx) return;
      setRunBusy(run.runId, 'gpx');
      try {
        await onExportRunGpx(run);
      } finally {
        setRunBusy(run.runId, undefined);
      }
    },
    [onExportRunGpx, setRunBusy],
  );

  const handleDelete = useCallback(
    async (run: RecordedRunSummary) => {
      if (!onDeleteRun) return;
      setRunBusy(run.runId, 'delete');
      try {
        await onDeleteRun(run);
      } finally {
        setRunBusy(run.runId, undefined);
      }
    },
    [onDeleteRun, setRunBusy],
  );

  const effectiveSection: YouSection =
    sections.some((item) => item.key === section) ? section : 'overview';

  useEffect(() => {
    if (effectiveSection !== 'passes') {
      setMobileCanvasActive(false);
      onCanvasModeChange?.(false);
    }
  }, [effectiveSection, onCanvasModeChange]);

  const handleCanvasModeChange = useCallback(
    (active: boolean) => {
      setMobileCanvasActive(active);
      onCanvasModeChange?.(active);
    },
    [onCanvasModeChange],
  );

  const handleSectionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = sections.findIndex((item) => item.key === effectiveSection);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % sections.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = sections.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKey = sections[nextIndex].key;
    onSectionChange(nextKey);
    tabRefs.current[nextKey]?.focus();
  };

  const todayStr = philippineTodayStr();
  const portfolioCounts = useMemo(
    () => computeRunnerPortfolioCounts(runnerProfiles, races, todayStr),
    [runnerProfiles, races, todayStr],
  );

  const isLockedSection = effectiveSection === 'passes' || effectiveSection === 'friends';
  const hideTopSwitcher = isCompact && mobileCanvasActive && effectiveSection === 'passes';
  const displayName = (profile.nickname || profile.displayName || 'Runner').trim();
  const avatarInitial = displayName.charAt(0).toUpperCase() || 'R';
  const trimmedRunClub = (profile.runClub || '').trim();
  const hasWeight = profile.weightKg != null && Number.isFinite(profile.weightKg);

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col ${
        isLockedSection ? 'overflow-hidden bg-[var(--surface-page)]' : ''
      }`}
    >
      {!hideTopSwitcher && (
        <div
          className={`shrink-0 bg-[var(--surface-card)] ${
            isLockedSection
              ? 'border-b border-[var(--border-default)] px-3 py-2'
              : 'rounded-2xl border border-[var(--border-default)] p-2 mb-3'
          }`}
        >
          <div
            role="tablist"
            aria-label="You hub sections"
            onKeyDown={handleSectionKeyDown}
            className="rp-tablist-scroll items-center gap-1 min-w-0"
          >
            {sections.map((item) => {
              const active = effectiveSection === item.key;
              return (
                <button
                  key={item.key}
                  ref={(el) => {
                    tabRefs.current[item.key] = el;
                  }}
                  id={`${baseId}-tab-${item.key}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSectionChange(item.key)}
                  className={`relative min-h-11 px-3 sm:px-4 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    active
                      ? 'border-red-600 bg-red-700 text-white after:content-[""] after:absolute after:inset-x-2.5 after:bottom-1 after:border-b-2 after:border-white'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.count !== undefined && (
                    <span className={`font-mono text-xs tabular-nums ${active ? 'text-white/95' : 'text-[var(--text-secondary)]'}`}>
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        role="tabpanel"
        aria-labelledby={hideTopSwitcher ? undefined : `${baseId}-tab-${effectiveSection}`}
        aria-label={
          hideTopSwitcher
            ? sections.find((item) => item.key === effectiveSection)?.label ?? 'You hub'
            : undefined
        }
        className={`flex-1 min-h-0 flex flex-col ${isLockedSection ? 'overflow-hidden' : ''}`}
      >
        {effectiveSection === 'overview' && (
          <div className="w-full max-w-5xl mx-auto space-y-4 pb-2">
            <section
              aria-labelledby={`${baseId}-athlete-heading`}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-12 h-12 rounded-full overflow-hidden bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-600/25 flex items-center justify-center text-base font-semibold shrink-0">
                    {profile.photoURL ? (
                      <img src={profile.photoURL} alt="" width={48} height={48} className="w-full h-full object-cover" />
                    ) : (
                      avatarInitial
                    )}
                  </span>

                  <div className="min-w-0 space-y-0.5">
                    <h2
                      id={`${baseId}-athlete-heading`}
                      className="font-display font-semibold text-lg sm:text-xl text-[var(--text-primary)] truncate"
                    >
                      {displayName}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                      <span className="font-mono truncate">
                        {profile.username ? `@${profile.username}` : 'No @username set'}
                      </span>
                      {trimmedRunClub && (
                        <span className="truncate font-semibold text-[var(--text-primary)]">
                          {trimmedRunClub}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <Scale className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span className="tabular-nums">
                      {hasWeight ? `${profile.weightKg} kg` : 'Set Weight for Calories'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <Settings className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Profile &amp; Settings</span>
                  </button>
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5 flex flex-col gap-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Passes</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                    {portfolioCounts.totalPasses}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5 flex flex-col gap-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Upcoming</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {portfolioCounts.upcomingPasses}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5 flex flex-col gap-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Completed</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                    {portfolioCounts.completedPasses}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2.5 flex flex-col gap-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Friends</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                    {friendsCount}
                  </dd>
                </div>
              </dl>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="w-9 h-9 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-red-700 dark:text-red-400">
                    <ClipboardList className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    My Race Passes
                  </h3>
                  <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                    Open your digital race bibs, live splits, finisher certificates, and QR check-in passes.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSectionChange('passes')}
                    className="min-h-11 flex-1 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Open Passes</span>
                  </button>
                  <button
                    type="button"
                    onClick={onScanQr}
                    className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span>Claim Bib</span>
                  </button>
                </div>
              </article>

              {(showRunsSection || onOpenRecord) && (
                <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="w-9 h-9 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-red-700 dark:text-red-400">
                      <Navigation className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                      Recorded Runs &amp; GPS
                    </h3>
                    {!recordedRunsLoaded ? (
                      <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                        Loading your recorded runs and live GPS activity.
                      </p>
                    ) : recordedRuns.length > 0 ? (
                      <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed tabular-nums">
                        {recordedRuns.length} {recordedRuns.length === 1 ? 'saved run' : 'saved runs'}. Latest:{' '}
                        <strong className="font-semibold text-[var(--text-primary)]">
                          {recordedRuns[0].title}
                        </strong>{' '}
                        ({(recordedRuns[0].distanceM / 1000).toFixed(2)} km,{' '}
                        {(Number.isFinite(recordedRuns[0].caloriesKcal) ? recordedRuns[0].caloriesKcal : 0).toFixed(1)} kcal).
                      </p>
                    ) : (
                      <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                        No saved GPS runs yet. Start a Free Run or follow a published Philippine course with 200 m home privacy trim.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {showRunsSection && (
                      <button
                        type="button"
                        onClick={() => onSectionChange('runs')}
                        className="min-h-11 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                      >
                        <ClipboardList className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        <span>View Runs</span>
                      </button>
                    )}
                    {onOpenRecord && (
                      <button
                        type="button"
                        onClick={onOpenRecord}
                        className="min-h-11 flex-1 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                      >
                        <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Record Run</span>
                      </button>
                    )}
                  </div>
                </article>
              )}

              <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0">
                        <Trophy className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <h3 className="font-display font-semibold text-base text-[var(--text-primary)] truncate">
                        Badges &amp; Level
                      </h3>
                    </div>
                    <span className="px-2.5 py-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap tabular-nums">
                      Lv {athleteProgression.level} {athleteProgression.rankTitle}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div
                      role="progressbar"
                      aria-label="Level XP progress"
                      aria-valuenow={xpWindow.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2 w-full rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] overflow-hidden"
                    >
                      <div
                        className="h-full rounded-full bg-red-600 dark:bg-red-500 transition-all duration-200"
                        style={{ width: `${xpWindow.percent}%` }}
                      />
                    </div>
                    <p className="text-xs font-normal text-[var(--text-secondary)] tabular-nums">
                      {xpWindow.xpIntoLevel.toLocaleString('en-US')} /{' '}
                      {xpWindow.xpForNextLevel.toLocaleString('en-US')} XP ({userBadges.length}{' '}
                      {userBadges.length === 1 ? 'badge' : 'badges'} earned)
                    </p>
                  </div>

                  {recentEarnedBadges.length > 0 ? (
                    <div className="flex items-center gap-2.5 pt-0.5">
                      {recentEarnedBadges.map((badgeItem) => (
                        <BadgeArtwork key={badgeItem.badgeId} badge={badgeItem} size="sm" />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                      Log verified runs or finish official events to unlock badges and climb ranks.
                    </p>
                  )}
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSectionChange('badges')}
                    className="min-h-11 w-full px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Trophy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Open Trophy Case</span>
                  </button>

                  {(canFriends || canEngraving) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canFriends && (
                        <button
                          type="button"
                          onClick={() => onSectionChange('friends')}
                          className="min-h-11 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                        >
                          <Users2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                          <span>Friends</span>
                        </button>
                      )}
                      {canEngraving && (
                        <button
                          type="button"
                          onClick={() => onSectionChange('engraving')}
                          className="min-h-11 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                        >
                          <Award className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                          <span>Engraving</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            </div>
          </div>
        )}

        {effectiveSection === 'badges' && (
          <section
            aria-labelledby={`${baseId}-badges-heading`}
            className="w-full max-w-5xl mx-auto space-y-4 pb-2"
          >
            <div className="min-w-0 px-1">
              <h2
                id={`${baseId}-badges-heading`}
                className="font-display font-semibold text-lg text-[var(--text-primary)]"
              >
                Trophy Case &amp; Level
              </h2>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                Verified distance, streak, and official race milestones on your RacePulsePH profile.
              </p>
            </div>
            <RunnerBadgesPanel
              badges={badgeCatalog}
              badgesLoaded={badgesLoaded}
              badgesError={badgesError}
              userBadges={userBadges}
              userBadgesLoaded={userBadgesLoaded}
              athleteProgression={athleteProgression}
            />
          </section>
        )}

        {effectiveSection === 'runs' && (
          <section
            aria-labelledby={`${baseId}-runs-heading`}
            className="w-full max-w-5xl mx-auto space-y-4 pb-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <h2
                  id={`${baseId}-runs-heading`}
                  className="font-display font-semibold text-lg text-[var(--text-primary)]"
                >
                  Recorded Runs
                </h2>
                <p className="text-xs font-normal text-[var(--text-secondary)] tabular-nums">
                  {recordedRunsLoaded
                    ? `${recordedRuns.length} ${recordedRuns.length === 1 ? 'activity' : 'activities'} saved to your RacePulsePH profile.`
                    : 'Loading your recorded GPS activities...'}
                </p>
              </div>
              {onOpenRecord && (
                <button
                  type="button"
                  onClick={onOpenRecord}
                  className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Record Run</span>
                </button>
              )}
            </div>

            {recordedRunsError && (
              <div
                role="alert"
                className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{recordedRunsError}</span>
              </div>
            )}

            {!recordedRunsLoaded ? (
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
                <RunnerQueueSkeleton rows={4} label="Loading recorded runs" />
              </div>
            ) : !recordedRunsError && recordedRuns.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3">
                <Navigation className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                  No recorded runs yet
                </h3>
                <p className="text-xs font-normal text-[var(--text-secondary)] max-w-md mx-auto">
                  Record a Free Run or follow a published Philippine race course to save splits, elevation gain, and GPX tracks.
                </p>
                {onOpenRecord && (
                  <button
                    type="button"
                    onClick={onOpenRecord}
                    className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <Navigation className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Start Recording</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {recordedRuns.map((run) => {
                  const busyAction = busyByRunId[run.runId];
                  const isBusy = Boolean(busyAction);
                  const isFlagged = run.verificationStatus === 'flagged';
                  const modeLabel =
                    run.mode === 'course' && run.courseRef
                      ? `${run.courseRef.raceName} (${run.courseRef.distanceLabel})`
                      : 'Free Run';
                  const privacyControlId = `${baseId}-run-privacy-${run.runId}`;

                  return (
                    <article
                      key={run.runId}
                      className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display font-semibold text-base text-[var(--text-primary)] break-words">
                              {run.title}
                            </h3>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-semibold whitespace-nowrap ${
                                isFlagged
                                  ? 'border-amber-600/35 bg-amber-500/10 text-amber-900 dark:text-amber-300'
                                  : 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {isFlagged ? (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              )}
                              <span>{isFlagged ? 'Flagged / Under Review' : 'Verified'}</span>
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                            <time dateTime={run.startedAt} className="font-mono tabular-nums">
                              {formatManilaRunTimestamp(run.startedAt)}
                            </time>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] font-semibold text-[var(--text-primary)]">
                              {modeLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
                          <dt className="text-xs font-normal text-[var(--text-secondary)]">Distance</dt>
                          <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            {(run.distanceM / 1000).toFixed(2)} km
                          </dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
                          <dt className="text-xs font-normal text-[var(--text-secondary)]">Moving Time</dt>
                          <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            {formatDuration(run.movingTimeMs)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
                          <dt className="text-xs font-normal text-[var(--text-secondary)]">Avg Pace</dt>
                          <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            {formatPace(run.avgPaceSecPerKm)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
                          <dt className="text-xs font-normal text-[var(--text-secondary)]">Elev Gain</dt>
                          <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            +{Math.round(run.elevationGainM)} m
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
                          <dt className="text-xs font-normal text-[var(--text-secondary)]">Calories</dt>
                          <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            {(Number.isFinite(run.caloriesKcal) ? run.caloriesKcal : 0).toFixed(1)} kcal
                          </dd>
                        </div>
                      </dl>

                      {run.homePrivacyTrimEnabled && (
                        <p className="text-xs font-normal text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                          <span>
                            200 m home privacy trim
                            {run.pointCount === 0 ? ' (GPS track omitted under 450 m)' : ''}
                          </span>
                        </p>
                      )}

                      <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 sm:w-56">
                          <label
                            htmlFor={privacyControlId}
                            className="text-xs font-semibold text-[var(--text-secondary)] shrink-0 cursor-pointer"
                          >
                            Visibility
                          </label>
                          <div className="flex-1 min-w-0">
                            <Select
                              id={privacyControlId}
                              ariaLabel={`Visibility for ${run.title}`}
                              value={run.privacy}
                              options={privacySelectOptions}
                              onChange={(nextValue) =>
                                void handlePrivacyChange(run, nextValue as RecordedRunPrivacy)
                              }
                              disabled={isBusy || !onUpdateRunPrivacy}
                              size="md"
                              surface="inset"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleExportGpx(run)}
                            disabled={isBusy || !onExportRunGpx}
                            className="min-h-11 flex-1 sm:flex-initial px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                          >
                            {busyAction === 'gpx' ? (
                              <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                            ) : (
                              <Download className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                            )}
                            <span>{busyAction === 'gpx' ? 'Exporting...' : 'Export GPX'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDelete(run)}
                            disabled={isBusy || !onDeleteRun}
                            aria-label={`Delete ${run.title}`}
                            className="min-h-11 px-3.5 rounded-xl border border-red-600/30 bg-red-500/10 hover:bg-red-500/15 text-xs font-semibold text-red-800 dark:text-red-300 inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                          >
                            {busyAction === 'delete' ? (
                              <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>{busyAction === 'delete' ? 'Deleting...' : 'Delete'}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {effectiveSection === 'passes' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <RunnerMyRacesPanel
              runnerProfiles={runnerProfiles}
              races={races}
              racesLoaded={racesLoaded}
              onBrowseEvents={onBrowseEvents}
              onScanQr={onScanQr}
              onOpenEngraving={canEngraving ? () => onSectionChange('engraving') : undefined}
              requestedRaceId={requestedPassRaceId}
              onRequestedRaceHandled={onRequestedPassHandled}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              isCompact={isCompact}
              onCanvasModeChange={handleCanvasModeChange}
              searchQuery={myPassesSearch}
              onSearchQueryChange={onMyPassesSearchChange}
              statusFilter={myPassesFilter}
              onStatusFilterChange={onMyPassesFilterChange}
              onMetricsChange={onMyPassesMetricsChange}
              desktopSearchRef={desktopSearchRef}
            />
          </div>
        )}

        {effectiveSection === 'friends' && canFriends && (
          <div className="flex-1 min-h-0 flex flex-col">
            <RunnerFriendsPanel
              profile={profile}
              onOpenRace={onOpenExploreRace}
              onOpenProfile={onOpenProfile}
              onStartDm={onStartDm}
              searchQuery={friendsSearch}
              onSearchQueryChange={onFriendsSearchChange}
              isDesktop={isDesktop}
              isSplitPane={isSplitPane}
              desktopSearchRef={desktopSearchRef}
            />
          </div>
        )}

        {effectiveSection === 'engraving' && canEngraving && (
          <div className="flex-1 min-h-0 flex flex-col">{engravingNode}</div>
        )}
      </div>
    </div>
  );
}
