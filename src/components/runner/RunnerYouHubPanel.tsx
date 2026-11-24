import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Award,
  ClipboardList,
  Navigation,
  QrCode,
  Scale,
  Settings,
  Trophy,
  User,
  Users2,
} from 'lucide-react';
import { computeRunnerPortfolioCounts, type YouSection } from '../../lib/runnerShell';
import type { Race, RunnerProfile, UserProfile } from '../../types';
import RunnerFriendsPanel from './RunnerFriendsPanel';
import RunnerMyRacesPanel, { type MyPassesFilter } from './RunnerMyRacesPanel';
import { philippineTodayStr } from './runnerUtils';

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
  requestedPassRaceId?: string | null;
  onRequestedPassHandled?: () => void;
  onBrowseEvents: () => void;
  onOpenExploreRace: (raceId: string) => void;
  onScanQr: () => void;
  onOpenProfile: () => void;
  onOpenRecord?: () => void;
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
  requestedPassRaceId,
  onRequestedPassHandled,
  onBrowseEvents,
  onOpenExploreRace,
  onScanQr,
  onOpenProfile,
  onOpenRecord,
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
  const tabRefs = useRef<Record<YouSection, HTMLButtonElement | null>>({
    overview: null,
    passes: null,
    friends: null,
    engraving: null,
  });

  const sections = useMemo(() => {
    const items: Array<{ key: YouSection; label: string; count?: number }> = [
      { key: 'overview', label: 'Overview' },
      { key: 'passes', label: 'My Passes', count: runnerProfiles.length },
    ];
    if (canFriends) {
      items.push({ key: 'friends', label: 'Friends', count: friendsCount });
    }
    if (canEngraving) {
      items.push({ key: 'engraving', label: 'Engraving' });
    }
    return items;
  }, [runnerProfiles.length, canFriends, friendsCount, canEngraving]);

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
                  className={`relative min-h-11 px-3 sm:px-4 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
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

              {onOpenRecord && (
                <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="w-9 h-9 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-red-700 dark:text-red-400">
                      <Navigation className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                      GPS Run Check
                    </h3>
                    <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                      Check live satellite accuracy, calibrate body weight for calorie estimates, and select a published course.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenRecord}
                    className="min-h-11 w-full px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Navigation className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span>Open Record Check</span>
                  </button>
                </article>
              )}

              <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="w-9 h-9 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-amber-700 dark:text-amber-300">
                    <Trophy className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    Earned Badges Showcase
                  </h3>
                  <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                    Official finisher and distance milestone badges unlock in Milestone 3 as verified race results sync to your profile.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
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
              </article>
            </div>
          </div>
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
