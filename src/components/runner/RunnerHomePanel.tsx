import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Compass,
  Flag,
  Navigation,
  QrCode,
  Users2,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import {
  computeRunnerPortfolioCounts,
  computeStarterTrailProgress,
  findUpcomingRaceWeekPass,
  normalizeOnboardingStepIds,
  sortHomeDiscoverRaces,
  type ExploreRacesFilter,
  type ExploreSection,
  type HomeFriendFeedItem,
} from '../../lib/runnerShell';
import { formatDuration, formatPace } from '../../lib/runs/runLiveHelpers';
import type { RecordedRunSummary } from '../../lib/runs/types';
import { isRaceRegistrationOpen } from '../../lib/raceRegistration';
import type { Race, RunnerProfile, UserProfile } from '../../types';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';
import { formatFeeRangePH, philippineTodayStr, sortedRaceDistances } from './runnerUtils';

export interface RunnerHomePanelProps {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  races: Race[];
  racesLoaded: boolean;
  friendsCount: number;
  friendFeed: HomeFriendFeedItem[];
  recordedRuns?: RecordedRunSummary[];
  onOpenPass?: (raceId: string) => void;
  onOpenExplore?: (section?: ExploreSection, filter?: ExploreRacesFilter, raceId?: string) => void;
  onOpenRecord?: () => void;
  onOpenRuns?: () => void;
  onOpenFriends?: () => void;
}

type FeedTab = 'discover' | 'following';

function readStarterTrailDismissed(uid: string): boolean {
  if (!uid || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`racepulse_starter_trail_dismissed_${uid}`) === '1';
  } catch {
    return false;
  }
}

export default function RunnerHomePanel({
  profile,
  runnerProfiles,
  races,
  racesLoaded,
  friendsCount,
  friendFeed,
  recordedRuns = [],
  onOpenPass,
  onOpenExplore,
  onOpenRecord,
  onOpenRuns,
  onOpenFriends,
}: RunnerHomePanelProps) {
  const baseId = useId();
  const todayStr = philippineTodayStr();
  const [feedTab, setFeedTab] = useState<FeedTab>('discover');
  const [trailDismissed, setTrailDismissed] = useState<boolean>(() => readStarterTrailDismissed(profile.uid));
  const feedTabRefs = useRef<Record<FeedTab, HTMLButtonElement | null>>({
    discover: null,
    following: null,
  });

  useEffect(() => {
    setTrailDismissed(readStarterTrailDismissed(profile.uid));
  }, [profile.uid]);

  const trailProgress = useMemo(
    () =>
      computeStarterTrailProgress(profile.onboardingSteps, {
        hasRuns: recordedRuns.length > 0,
        hasJoinedRaceOrClub: runnerProfiles.length > 0 || Boolean(profile.primaryClubId || profile.runClub),
        hasFriends: friendsCount > 0,
      }),
    [profile.onboardingSteps, recordedRuns.length, profile.primaryClubId, profile.runClub, runnerProfiles.length, friendsCount],
  );

  const raceWeekMatch = useMemo(
    () => findUpcomingRaceWeekPass(runnerProfiles, races, todayStr),
    [runnerProfiles, races, todayStr],
  );

  const portfolioCounts = useMemo(
    () => computeRunnerPortfolioCounts(runnerProfiles, races, todayStr),
    [runnerProfiles, races, todayStr],
  );

  const discoverRaces = useMemo(() => sortHomeDiscoverRaces(races, todayStr), [races, todayStr]);

  const handleDismissTrail = async () => {
    setTrailDismissed(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`racepulse_starter_trail_dismissed_${profile.uid}`, '1');
      }
    } catch {
      // Restricted browser storage keeps dismissal in component state for this session.
    }
    try {
      const validSteps = normalizeOnboardingStepIds(profile.onboardingSteps, trailProgress.completed);
      await updateDoc(doc(db, 'users', profile.uid), { onboardingSteps: validSteps });
    } catch (error) {
      console.warn('[RunnerHomePanel] Failed to persist onboarding steps:', error);
    }
  };

  const handleFeedKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const order: readonly FeedTab[] = ['discover', 'following'];
    const currentIndex = order.indexOf(feedTab);
    let nextTab: FeedTab | null = null;
    if (event.key === 'ArrowRight') {
      nextTab = order[(currentIndex + 1) % order.length];
    } else if (event.key === 'ArrowLeft') {
      nextTab = order[(currentIndex - 1 + order.length) % order.length];
    } else if (event.key === 'Home') {
      nextTab = order[0];
    } else if (event.key === 'End') {
      nextTab = order[order.length - 1];
    }
    if (!nextTab) return;
    event.preventDefault();
    setFeedTab(nextTab);
    feedTabRefs.current[nextTab]?.focus();
  };

  const starterSteps: Array<{
    id: 'welcome' | 'first_run' | 'explore_community' | 'connect_friend';
    label: string;
    done: boolean;
    onClick?: () => void;
  }> = [
    {
      id: 'welcome',
      label: 'Welcome to RacePulsePH',
      done: trailProgress.completed.includes('welcome'),
      onClick: undefined,
    },
    ...(onOpenRecord
      ? [
          {
            id: 'first_run' as const,
            label: 'Record a GPS Run',
            done: trailProgress.completed.includes('first_run'),
            onClick: onOpenRecord,
          },
        ]
      : []),
    ...(onOpenExplore
      ? [
          {
            id: 'explore_community' as const,
            label: 'Explore Races & Clubs',
            done: trailProgress.completed.includes('explore_community'),
            onClick: () => onOpenExplore('races', 'open'),
          },
        ]
      : []),
    ...(onOpenFriends
      ? [
          {
            id: 'connect_friend' as const,
            label: 'Add a Runner Friend',
            done: trailProgress.completed.includes('connect_friend'),
            onClick: onOpenFriends,
          },
        ]
      : []),
  ];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4 pb-2">
      {!trailDismissed && (
        <section
          aria-labelledby={`${baseId}-starter-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={`${baseId}-starter-heading`}
                  className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]"
                >
                  Starter Trail
                </h2>
                <span className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-red-600/10 border border-red-600/25 text-red-700 dark:text-red-400">
                  {trailProgress.completed.length}/{trailProgress.total} ({trailProgress.percent}%)
                </span>
              </div>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                Complete your race-day setup steps to prepare your passes, courses, and crew.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleDismissTrail()}
              aria-label="Dismiss starter trail"
              className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Dismiss</span>
            </button>
          </div>

          <div
            role="progressbar"
            aria-label="Starter trail progress"
            aria-valuenow={trailProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full rounded-full bg-[var(--surface-inset)] border border-[var(--border-subtle)] overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-red-700 transition-all duration-200"
              style={{ width: `${trailProgress.percent}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {starterSteps.map((step) => {
              const content = (
                <>
                  <span className="flex items-center gap-2.5 min-w-0">
                    {step.done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <Circle className="w-4 h-4 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {step.label}
                    </span>
                  </span>
                  {step.onClick ? (
                    <ChevronRight className="w-4 h-4 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                      Done
                    </span>
                  )}
                </>
              );

              if (!step.onClick) {
                return (
                  <div
                    key={step.id}
                    className="min-h-11 px-3 py-2 rounded-xl border border-emerald-600/25 bg-emerald-500/10 flex items-center justify-between gap-2"
                  >
                    {content}
                  </div>
                );
              }

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={step.onClick}
                  className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50 hover:bg-[var(--surface-hover)] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  {content}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {raceWeekMatch && (
        <section
          aria-labelledby={`${baseId}-raceweek-heading`}
          className="rounded-2xl border border-red-600/35 border-l-4 border-l-red-600 bg-[var(--surface-card)] p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="min-w-0 space-y-1">
            <h2
              id={`${baseId}-raceweek-heading`}
              className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)] truncate"
            >
              {raceWeekMatch.race.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-700 text-white text-xs font-semibold tabular-nums">
                {raceWeekMatch.daysUntil === 0
                  ? 'Today'
                  : raceWeekMatch.daysUntil === 1
                    ? 'Tomorrow'
                    : `In ${raceWeekMatch.daysUntil} days`}
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">
                Bib #{raceWeekMatch.profile.bibNumber}
              </span>
              <span className="font-mono text-xs font-normal text-[var(--text-secondary)]">
                {raceWeekMatch.profile.distance}
              </span>
            </div>
            <p className="text-xs font-normal text-[var(--text-secondary)] tabular-nums">
              Race date: {raceWeekMatch.race.date}. Keep your digital bib and QR pass ready at check-in.
            </p>
          </div>

          {onOpenPass && (
            <button
              type="button"
              onClick={() => onOpenPass(raceWeekMatch.race.id)}
              className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Open Race Pass</span>
            </button>
          )}
        </section>
      )}

      {recordedRuns.length > 0 && (
        <section
          aria-labelledby={`${baseId}-latest-run-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="min-w-0 space-y-1">
            <h2
              id={`${baseId}-latest-run-heading`}
              className="font-display font-semibold text-base text-[var(--text-primary)] truncate"
            >
              Latest Run: {recordedRuns[0].title}
            </h2>
            <p className="font-mono text-xs font-normal tabular-nums text-[var(--text-secondary)] truncate">
              {(recordedRuns[0].distanceM / 1000).toFixed(2)} km · {formatDuration(recordedRuns[0].movingTimeMs)} ·{' '}
              {formatPace(recordedRuns[0].avgPaceSecPerKm)} · {Math.round(recordedRuns[0].caloriesKcal)} kcal
            </p>
          </div>

          {(onOpenRuns || onOpenRecord) && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onOpenRuns && (
                <button
                  type="button"
                  onClick={onOpenRuns}
                  className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <ClipboardList className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <span>View Runs ({recordedRuns.length})</span>
                </button>
              )}
              {onOpenRecord && (
                <button
                  type="button"
                  onClick={onOpenRecord}
                  className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Record Run</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section aria-label="Weekly activity snapshot">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-col gap-0.5">
            <dt className="text-xs font-normal text-[var(--text-secondary)]">My Passes</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {portfolioCounts.totalPasses}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-col gap-0.5">
            <dt className="text-xs font-normal text-[var(--text-secondary)]">Upcoming</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {portfolioCounts.upcomingPasses}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-col gap-0.5">
            <dt className="text-xs font-normal text-[var(--text-secondary)]">Friends</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {friendsCount}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-col gap-0.5">
            <dt className="text-xs font-normal text-[var(--text-secondary)]">Open Races</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-red-700 dark:text-red-400">
              {racesLoaded ? portfolioCounts.openRaces : '...'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Community and race feed" className="space-y-3">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Home feed"
            onKeyDown={handleFeedKeyDown}
            className="rp-tablist-scroll items-center gap-1 min-w-0 flex-1"
          >
            {(
              [
                { key: 'discover', label: 'Discover', count: racesLoaded ? discoverRaces.length : undefined },
                { key: 'following', label: 'Following', count: friendFeed.length },
              ] as const
            ).map((item) => {
              const active = feedTab === item.key;
              return (
                <button
                  key={item.key}
                  ref={(el) => {
                    feedTabRefs.current[item.key] = el;
                  }}
                  id={`${baseId}-tab-${item.key}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setFeedTab(item.key)}
                  className={`relative min-h-11 px-4 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
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

        <div
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${feedTab}`}
          className="space-y-3"
        >
          {feedTab === 'discover' ? (
            <>
              {onOpenRecord && (
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center shrink-0 text-red-700 dark:text-red-400">
                      <Navigation className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)]">
                        Record a GPS Run
                      </h3>
                      <p className="text-xs font-normal text-[var(--text-secondary)]">
                        Track live distance, splits, and elevation on a Free Run or published Philippine course.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenRecord}
                    className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <Navigation className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span>Record Run</span>
                  </button>
                </div>
              )}

              {!racesLoaded ? (
                <RunnerQueueSkeleton rows={4} label="Loading Philippine races" />
              ) : discoverRaces.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3">
                  <Compass className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                  <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    No open or upcoming races right now
                  </h3>
                  <p className="text-xs font-normal text-[var(--text-secondary)] max-w-md mx-auto">
                    Browse all published events and past results in Explore while new Philippine race calendars open.
                  </p>
                  {onOpenExplore && (
                    <button
                      type="button"
                      onClick={() => onOpenExplore('races', 'all')}
                      className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Compass className="w-4 h-4" aria-hidden="true" />
                      <span>Browse Explore Catalog</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {discoverRaces.slice(0, 12).map((race) => {
                      const isOpen = isRaceRegistrationOpen(race, todayStr);
                      const distances = sortedRaceDistances(race);
                      const distanceSummary = distances.map((d) => d.label).join(' / ') || 'Open Category';
                      return (
                        <article
                          key={race.id}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 164px' }}
                          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <h3 className="font-display font-semibold text-base text-[var(--text-primary)] leading-snug">
                              {race.name}
                            </h3>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${
                                  isOpen
                                    ? 'bg-emerald-500/10 border-emerald-600/30 text-emerald-800 dark:text-emerald-300'
                                    : 'bg-[var(--surface-inset)] border-[var(--border-default)] text-[var(--text-secondary)]'
                                }`}
                              >
                                {isOpen ? 'Open Now' : 'Upcoming'}
                              </span>
                              <span className="font-mono text-xs font-normal tabular-nums text-[var(--text-secondary)] inline-flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>{race.date}</span>
                              </span>
                            </div>

                            <p className="text-xs font-normal text-[var(--text-secondary)] truncate tabular-nums">
                              {distanceSummary} · {formatFeeRangePH(race.distances)}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="text-xs font-mono text-[var(--text-secondary)] truncate">
                              {race.onlinePaymentEnabled || race.manualPaymentEnabled ? 'Online checkout ready' : 'Standard entry'}
                            </span>
                            {onOpenExplore && (
                              <button
                                type="button"
                                onClick={() => onOpenExplore('races', 'open', race.id)}
                                className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                              >
                                <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>View in Explore</span>
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {discoverRaces.length > 12 && onOpenExplore && (
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => onOpenExplore('races', 'open')}
                        className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                      >
                        <Compass className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        <span className="tabular-nums">View all {discoverRaces.length} races in Explore</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : friendFeed.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3">
              <Users2 className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
              <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                {friendsCount > 0 ? 'No friend race updates yet' : 'Follow runner friends'}
              </h3>
              <p className="text-xs font-normal text-[var(--text-secondary)] max-w-md mx-auto">
                {friendsCount > 0
                  ? 'Connected friends appear here as soon as they join or complete shared RacePulsePH events.'
                  : 'Add friends by @username to follow their upcoming starts and completed Philippine races.'}
              </p>
              {onOpenFriends && (
                <button
                  type="button"
                  onClick={onOpenFriends}
                  className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Users2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Find Runner Friends</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {friendFeed.map((friend) => {
                const initial = (friend.displayName || friend.username || 'R').charAt(0).toUpperCase();
                return (
                  <article
                    key={friend.uid}
                    className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-10 h-10 rounded-full overflow-hidden bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-600/25 flex items-center justify-center text-sm font-semibold shrink-0">
                          {friend.photoURL ? (
                            <img src={friend.photoURL} alt="" width={40} height={40} className="w-full h-full object-cover" />
                          ) : (
                            initial
                          )}
                        </span>
                        <div className="min-w-0">
                          <h3 className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
                            {friend.displayName}
                          </h3>
                          {friend.username && (
                            <p className="font-mono text-xs font-normal text-[var(--text-secondary)] truncate">
                              @{friend.username}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] shrink-0">
                        {friend.recentRaces.length} {friend.recentRaces.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>

                    <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                      {friend.recentRaces.slice(0, 4).map((raceItem) => (
                        <div
                          key={`${friend.uid}_${raceItem.raceId}_${raceItem.distance}`}
                          className="px-3 py-2 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate">
                              {raceItem.raceName}
                            </p>
                            <p className="text-xs font-mono font-normal text-[var(--text-secondary)] tabular-nums truncate">
                              {raceItem.distance} · {raceItem.date}
                            </p>
                          </div>

                          {onOpenExplore && (
                            <button
                              type="button"
                              onClick={() => onOpenExplore('races', 'all', raceItem.raceId)}
                              className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                            >
                              <span>Open Event</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
