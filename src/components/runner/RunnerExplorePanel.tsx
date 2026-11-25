import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Compass,
  ExternalLink,
  Flag,
  MapPin,
  Mountain,
  Play,
  Search,
  X,
} from 'lucide-react';
import { isClientNavigationClick } from '../../lib/appRouting';
import type { BadgeDefinition } from '../../lib/badges/types';
import { isRaceRegistrationOpen } from '../../lib/raceRegistration';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import {
  ensureDemoCoursesSeeded,
  ensurePilotCoursesSeeded,
  isDemoSeedEnabled,
  subscribePublishedCatalog,
} from '../../lib/routes/routeStore';
import type { RaceRouteCatalogEntry } from '../../lib/routes/types';
import {
  buildClubRequestMailtoHref,
  filterPublishedExploreRoutes,
  mapExploreRacesMode,
  resolveExploreCatalogIslandGroup,
  type ClubRequestMailtoOptions,
  type ExploreIslandGroupFilter,
  type ExploreRacesFilter,
  type ExploreSection,
  type FilterExploreRoutesOptions,
} from '../../lib/runnerShell';
import type { Race, RunnerProfile, UserProfile } from '../../types';
import RunnerAllRacesPanel, { type CatalogStatusFilter } from './RunnerAllRacesPanel';
import RunnerClubsPanel from './RunnerClubsPanel';
import RunnerEventsPanel, { type OpenEventsFilter } from './RunnerEventsPanel';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';
import { philippineTodayStr } from './runnerUtils';

export {
  buildClubRequestMailtoHref,
  filterPublishedExploreRoutes,
  resolveExploreCatalogIslandGroup,
  type ClubRequestMailtoOptions,
  type ExploreIslandGroupFilter,
  type FilterExploreRoutesOptions,
};

export interface ExploreMetrics {
  total: number;
  unjoined: number;
  registered: number;
  catalogAll: number;
  catalogUpcoming: number;
  catalogCompleted: number;
  showing: number;
  routesCount: number;
}

export interface ExploreCourseRunTarget {
  raceId: string;
  distanceId: string;
  label: string;
  publicationId?: string;
}

export interface RunnerExplorePanelProps {
  section: ExploreSection;
  onSectionChange: (next: ExploreSection) => void;
  racesFilter: ExploreRacesFilter;
  onRacesFilterChange: (next: ExploreRacesFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  uid: string;
  profile: UserProfile;
  friendIdentity?: { username?: string; displayName: string };
  runnerProfiles: RunnerProfile[];
  registeredRaceIds: Set<string>;
  initialShirtSize?: string;
  profileRunClub?: string;
  badgeCatalog?: BadgeDefinition[];
  requestedRaceId?: string | null;
  onRequestedRaceHandled?: () => void;
  onScanQr?: () => void;
  onSaved: () => void;
  onOpenProfile?: () => void;
  onStartCourseRun?: (course: ExploreCourseRunTarget) => void;
  onOpenClubChat?: (clubId: string) => void;
  races: Race[];
  racesLoaded: boolean;
  racesError: string | null;
  isDesktop: boolean;
  isSplitPane?: boolean;
  isCompact?: boolean;
  imeOpen?: boolean;
  onCanvasModeChange?: (active: boolean) => void;
  onMetricsChange?: (metrics: ExploreMetrics) => void;
  onFormViewChange?: (inFormFlow: boolean) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

const EXPLORE_SECTIONS: readonly { key: ExploreSection; label: string }[] = [
  { key: 'races', label: 'Races' },
  { key: 'routes', label: 'Routes' },
  { key: 'clubs', label: 'Clubs' },
];

const RACE_FILTER_OPTIONS: readonly { key: ExploreRacesFilter; label: string }[] = [
  { key: 'open', label: 'Open Now' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
  { key: 'joined', label: 'Joined' },
];

const ISLAND_GROUP_OPTIONS: readonly { key: ExploreIslandGroupFilter; label: string }[] = [
  { key: 'all', label: 'All Philippines' },
  { key: 'Luzon', label: 'Luzon' },
  { key: 'Visayas', label: 'Visayas' },
  { key: 'Mindanao', label: 'Mindanao' },
];

function dispatchAppNavigate(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url } }));
}

function formatMeasuredDistanceKm(entry: RaceRouteCatalogEntry): string {
  const meters = entry.measuredDistanceM > 0 ? entry.measuredDistanceM : entry.advertisedKm * 1000;
  return `${(meters / 1000).toFixed(2)} km`;
}

export default function RunnerExplorePanel({
  section,
  onSectionChange,
  racesFilter,
  onRacesFilterChange,
  searchQuery,
  onSearchQueryChange,
  uid,
  profile,
  friendIdentity,
  runnerProfiles,
  registeredRaceIds,
  initialShirtSize,
  profileRunClub,
  badgeCatalog = [],
  requestedRaceId,
  onRequestedRaceHandled,
  onScanQr,
  onSaved,
  onOpenProfile,
  onStartCourseRun,
  onOpenClubChat,
  races,
  racesLoaded,
  racesError,
  isDesktop,
  isSplitPane,
  isCompact,
  imeOpen = false,
  onCanvasModeChange,
  onMetricsChange,
  onFormViewChange,
  desktopSearchRef,
}: RunnerExplorePanelProps) {
  const resolvedSplitPane = isSplitPane ?? isDesktop;
  const resolvedCompact = isCompact ?? !resolvedSplitPane;
  const baseId = useId();
  const routesSearchId = `${baseId}-routes-search`;

  const [mobileCanvasActive, setMobileCanvasActive] = useState(false);
  const [eventsInFormFlow, setEventsInFormFlow] = useState(false);
  const [eventsSubFilter, setEventsSubFilter] = useState<'all' | 'unjoined'>('all');
  const [catalogRegisterRaceId, setCatalogRegisterRaceId] = useState<string | null>(null);

  const [eventsLiveMetrics, setEventsLiveMetrics] = useState<{
    total: number;
    unjoined: number;
    registered: number;
    showing: number;
  } | null>(null);
  const [catalogLiveMetrics, setCatalogLiveMetrics] = useState<{
    all: number;
    upcoming: number;
    completed: number;
    showing: number;
  } | null>(null);

  const [publishedRoutes, setPublishedRoutes] = useState<RaceRouteCatalogEntry[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [islandGroup, setIslandGroup] = useState<ExploreIslandGroupFilter>('all');

  const lastRequestedRaceIdRef = useRef<string | null>(null);
  const tabButtonRefs = useRef<Record<ExploreSection, HTMLButtonElement | null>>({
    races: null,
    routes: null,
    clubs: null,
  });
  const lastEmittedMetricsRef = useRef<ExploreMetrics | null>(null);

  useEffect(() => {
    if (isDemoSeedEnabled()) {
      void ensurePilotCoursesSeeded();
      void ensureDemoCoursesSeeded();
    }
    const unsubscribe = subscribePublishedCatalog((entries) => {
      setPublishedRoutes(filterPublishedExploreRoutes(entries));
      setRoutesLoaded(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!requestedRaceId) {
      lastRequestedRaceIdRef.current = null;
      return;
    }
    if (lastRequestedRaceIdRef.current === requestedRaceId) {
      return;
    }
    lastRequestedRaceIdRef.current = requestedRaceId;
    setEventsSubFilter('all');
    onSectionChange('races');
    onRacesFilterChange('open');
  }, [requestedRaceId, onSectionChange, onRacesFilterChange]);

  useEffect(() => {
    if (racesFilter !== 'open') {
      setEventsSubFilter('all');
    }
  }, [racesFilter]);

  const mode = mapExploreRacesMode(racesFilter);

  useEffect(() => {
    if (section !== 'races') {
      setMobileCanvasActive(false);
      setEventsInFormFlow(false);
      onCanvasModeChange?.(false);
      onFormViewChange?.(false);
      return;
    }
    if (mode.mode !== 'events') {
      setEventsInFormFlow(false);
      onFormViewChange?.(false);
    }
  }, [section, mode.mode, onCanvasModeChange, onFormViewChange]);

  const handleCanvasModeChange = useCallback(
    (active: boolean) => {
      setMobileCanvasActive(active);
      onCanvasModeChange?.(active);
    },
    [onCanvasModeChange],
  );

  const handleFormViewChange = useCallback(
    (inFormFlow: boolean) => {
      setEventsInFormFlow(inFormFlow);
      onFormViewChange?.(inFormFlow);
    },
    [onFormViewChange],
  );

  const handleRequestedRaceHandled = useCallback(() => {
    setCatalogRegisterRaceId(null);
    onRequestedRaceHandled?.();
  }, [onRequestedRaceHandled]);

  const handleBrowseAllRaces = useCallback(() => {
    onRacesFilterChange('all');
  }, [onRacesFilterChange]);

  const handleEventsStatusFilterChange = useCallback(
    (next: OpenEventsFilter) => {
      if (next === 'registered') {
        setEventsSubFilter('all');
        onRacesFilterChange('joined');
        return;
      }
      setEventsSubFilter(next);
      onRacesFilterChange('open');
    },
    [onRacesFilterChange],
  );

  const handleCatalogStatusFilterChange = useCallback(
    (next: CatalogStatusFilter) => {
      onRacesFilterChange(next);
    },
    [onRacesFilterChange],
  );

  const handleCatalogRegister = useCallback(
    (raceId: string) => {
      setCatalogRegisterRaceId(raceId);
      setEventsSubFilter('all');
      onSectionChange('races');
      onRacesFilterChange('open');
    },
    [onSectionChange, onRacesFilterChange],
  );

  const handleEventsMetricsChange = useCallback(
    (next: { total: number; unjoined: number; registered: number; showing: number }) => {
      setEventsLiveMetrics((prev) =>
        prev &&
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
      setCatalogLiveMetrics((prev) =>
        prev &&
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

  const baselineCounts = useMemo(() => {
    const today = philippineTodayStr();
    let total = 0;
    let registered = 0;
    let catalogUpcoming = 0;

    for (const race of races) {
      if (isRaceRegistrationOpen(race)) {
        total += 1;
        if (registeredRaceIds.has(race.id)) {
          registered += 1;
        }
      }
      if (!race.completedAt && race.date >= today) {
        catalogUpcoming += 1;
      }
    }

    const catalogAll = races.length;
    return {
      total,
      registered,
      unjoined: total - registered,
      catalogAll,
      catalogUpcoming,
      catalogCompleted: catalogAll - catalogUpcoming,
    };
  }, [races, registeredRaceIds]);

  const filteredRoutes = useMemo(
    () => filterPublishedExploreRoutes(publishedRoutes, { islandGroup, searchQuery }),
    [publishedRoutes, islandGroup, searchQuery],
  );

  const islandCounts = useMemo(() => {
    const counts: Record<ExploreIslandGroupFilter, number> = {
      all: publishedRoutes.length,
      Luzon: 0,
      Visayas: 0,
      Mindanao: 0,
    };
    for (const entry of publishedRoutes) {
      const group = resolveExploreCatalogIslandGroup(entry);
      if (group) {
        counts[group] += 1;
      }
    }
    return counts;
  }, [publishedRoutes]);

  const trimmedRunClub = (profileRunClub || '').trim();

  const unifiedMetrics = useMemo<ExploreMetrics>(() => {
    const showing =
      section === 'races'
        ? mode.mode === 'events'
          ? (eventsLiveMetrics?.showing ??
            (racesFilter === 'joined'
              ? baselineCounts.registered
              : eventsSubFilter === 'unjoined'
                ? baselineCounts.unjoined
                : baselineCounts.total))
          : (catalogLiveMetrics?.showing ?? baselineCounts.catalogAll)
        : section === 'routes'
          ? filteredRoutes.length
          : trimmedRunClub
            ? 1
            : 0;

    return {
      total: baselineCounts.total,
      unjoined: baselineCounts.unjoined,
      registered: baselineCounts.registered,
      catalogAll: baselineCounts.catalogAll,
      catalogUpcoming: baselineCounts.catalogUpcoming,
      catalogCompleted: baselineCounts.catalogCompleted,
      showing,
      routesCount: publishedRoutes.length,
    };
  }, [
    section,
    mode.mode,
    racesFilter,
    eventsSubFilter,
    eventsLiveMetrics?.showing,
    catalogLiveMetrics?.showing,
    baselineCounts,
    filteredRoutes.length,
    trimmedRunClub,
    publishedRoutes.length,
  ]);

  useEffect(() => {
    if (!onMetricsChange) return;
    const prev = lastEmittedMetricsRef.current;
    if (
      prev &&
      prev.total === unifiedMetrics.total &&
      prev.unjoined === unifiedMetrics.unjoined &&
      prev.registered === unifiedMetrics.registered &&
      prev.catalogAll === unifiedMetrics.catalogAll &&
      prev.catalogUpcoming === unifiedMetrics.catalogUpcoming &&
      prev.catalogCompleted === unifiedMetrics.catalogCompleted &&
      prev.showing === unifiedMetrics.showing &&
      prev.routesCount === unifiedMetrics.routesCount
    ) {
      return;
    }
    lastEmittedMetricsRef.current = unifiedMetrics;
    onMetricsChange(unifiedMetrics);
  }, [unifiedMetrics, onMetricsChange]);

  const hideTopSwitcher = (resolvedCompact && mobileCanvasActive) || eventsInFormFlow;

  const handleSectionTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = EXPLORE_SECTIONS.findIndex((item) => item.key === section);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % EXPLORE_SECTIONS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + EXPLORE_SECTIONS.length) % EXPLORE_SECTIONS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = EXPLORE_SECTIONS.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = EXPLORE_SECTIONS[nextIndex].key;
    onSectionChange(nextSection);
    tabButtonRefs.current[nextSection]?.focus();
  };

  const raceFilterCounts: Record<ExploreRacesFilter, number | undefined> = {
    open: racesLoaded ? baselineCounts.total : undefined,
    upcoming: racesLoaded ? baselineCounts.catalogUpcoming : undefined,
    completed: racesLoaded ? baselineCounts.catalogCompleted : undefined,
    all: racesLoaded ? baselineCounts.catalogAll : undefined,
    joined: racesLoaded ? baselineCounts.registered : undefined,
  };

  const activeTabId = `${baseId}-tab-${section}`;
  const activeTabLabel =
    EXPLORE_SECTIONS.find((item) => item.key === section)?.label ?? 'Explore';
  const allowStickyFormScroll = section === 'races' && eventsInFormFlow;

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col bg-[var(--surface-page)] ${
        allowStickyFormScroll ? 'overflow-visible' : 'overflow-hidden'
      }`}
    >
      {!hideTopSwitcher && (
        <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)]">
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Explore sections"
              onKeyDown={handleSectionTabKeyDown}
              className="rp-tablist-scroll items-center gap-1 min-w-0 flex-1"
            >
              {EXPLORE_SECTIONS.map((item) => {
                const active = section === item.key;
                const count =
                  item.key === 'races'
                    ? racesLoaded
                      ? baselineCounts.catalogAll
                      : undefined
                    : item.key === 'routes'
                      ? routesLoaded
                        ? publishedRoutes.length
                        : undefined
                      : undefined;

                return (
                  <button
                    key={item.key}
                    ref={(el) => {
                      tabButtonRefs.current[item.key] = el;
                    }}
                    id={`${baseId}-tab-${item.key}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => onSectionChange(item.key)}
                    className={`relative min-h-11 px-3 sm:px-4 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                      active
                        ? 'border-red-600 bg-red-700 text-white after:content-[""] after:absolute after:inset-x-2 after:bottom-1 after:border-b-2 after:border-white'
                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    {count !== undefined && (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          active ? 'text-white/95' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {section === 'races' && (
            <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)]/60">
              <div
                role="group"
                aria-label="Explore race filter"
                className="flex items-center gap-2 overflow-x-auto racepulse-horizontal-scroll touch-pan-x"
              >
                {RACE_FILTER_OPTIONS.map((opt) => {
                  const active = racesFilter === opt.key;
                  const count = raceFilterCounts[opt.key];
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onRacesFilterChange(opt.key)}
                      aria-pressed={active}
                      className={`min-h-11 lg:min-h-9 min-w-11 lg:min-w-0 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                        active
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/60 hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {count !== undefined && (
                        <span
                          className={`font-mono text-xs tabular-nums ${
                            active ? 'text-white/95' : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        role="tabpanel"
        aria-labelledby={hideTopSwitcher ? undefined : activeTabId}
        aria-label={hideTopSwitcher ? activeTabLabel : undefined}
        className={`flex-1 min-h-0 flex flex-col ${
          allowStickyFormScroll ? 'overflow-visible' : 'overflow-hidden'
        }`}
      >
        {section === 'races' &&
          (mode.mode === 'events' ? (
            <RunnerEventsPanel
              uid={uid}
              friendIdentity={friendIdentity}
              runnerProfiles={runnerProfiles}
              registeredRaceIds={registeredRaceIds}
              initialShirtSize={initialShirtSize}
              requestedRaceId={requestedRaceId || catalogRegisterRaceId}
              onRequestedRaceHandled={handleRequestedRaceHandled}
              onBrowseAllRaces={handleBrowseAllRaces}
              onScanQr={onScanQr}
              onSaved={onSaved}
              races={races}
              racesLoaded={racesLoaded}
              racesError={racesError}
              isDesktop={isDesktop}
              isSplitPane={resolvedSplitPane}
              isCompact={resolvedCompact}
              imeOpen={imeOpen}
              onCanvasModeChange={handleCanvasModeChange}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              statusFilter={racesFilter === 'open' ? eventsSubFilter : mode.eventsFilter}
              onStatusFilterChange={handleEventsStatusFilterChange}
              onMetricsChange={handleEventsMetricsChange}
              onFormViewChange={handleFormViewChange}
              desktopSearchRef={desktopSearchRef}
            />
          ) : (
            <RunnerAllRacesPanel
              races={races}
              racesLoaded={racesLoaded}
              racesError={racesError}
              registeredRaceIds={registeredRaceIds}
              onRegister={handleCatalogRegister}
              isDesktop={isDesktop}
              isSplitPane={resolvedSplitPane}
              isCompact={resolvedCompact}
              onCanvasModeChange={handleCanvasModeChange}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              statusFilter={mode.catalogFilter}
              onStatusFilterChange={handleCatalogStatusFilterChange}
              onMetricsChange={handleCatalogMetricsChange}
              desktopSearchRef={desktopSearchRef}
            />
          ))}

        {section === 'routes' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 space-y-2">
              {!isDesktop && (
                <div className="relative">
                  <Search
                    className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <label htmlFor={routesSearchId} className="sr-only">
                    Search published Philippine courses by race, region, or distance
                  </label>
                  <input
                    id={routesSearchId}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    placeholder="Search race, province, or distance..."
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-11 text-sm font-normal text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => onSearchQueryChange('')}
                      aria-label="Clear route search"
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div
                  role="group"
                  aria-label="Filter routes by Philippine island group"
                  className="flex items-center gap-2 overflow-x-auto racepulse-horizontal-scroll touch-pan-x min-w-0"
                >
                  {ISLAND_GROUP_OPTIONS.map((opt) => {
                    const active = islandGroup === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setIslandGroup(opt.key)}
                        aria-pressed={active}
                        className={`min-h-11 lg:min-h-9 min-w-11 lg:min-w-0 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                          active
                            ? 'border-red-600 bg-red-700 text-white'
                            : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/60 hover:bg-[var(--surface-hover)]'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {routesLoaded && (
                          <span
                            className={`font-mono text-xs tabular-nums ${
                              active ? 'text-white/95' : 'text-[var(--text-secondary)]'
                            }`}
                          >
                            {islandCounts[opt.key]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <a
                  href="/routes"
                  onClick={(e) => {
                    if (isClientNavigationClick(e)) {
                      e.preventDefault();
                      dispatchAppNavigate('/routes');
                    }
                  }}
                  className="min-h-11 lg:min-h-9 px-3 rounded-lg border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Compass className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <span>Browse National Route Explorer</span>
                  <ExternalLink className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll p-3 sm:p-4">
              {!routesLoaded ? (
                <RunnerQueueSkeleton rows={4} label="Loading published Philippine routes" />
              ) : publishedRoutes.length === 0 ? (
                <div className="max-w-lg mx-auto my-6 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3">
                  <Compass className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                  <h2 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    No published courses yet
                  </h2>
                  <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                    Published race routes with elevation profiles and verified checkpoints will appear here once organizers publish their courses.
                  </p>
                  <a
                    href="/routes"
                    onClick={(e) => {
                      if (isClientNavigationClick(e)) {
                        e.preventDefault();
                        dispatchAppNavigate('/routes');
                      }
                    }}
                    className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors duration-150"
                  >
                    <Compass className="w-4 h-4" aria-hidden="true" />
                    <span>Browse National Route Explorer</span>
                  </a>
                </div>
              ) : filteredRoutes.length === 0 ? (
                <div className="max-w-lg mx-auto my-6 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3">
                  <Search className="w-6 h-6 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
                  <h2 className="font-display font-semibold text-base text-[var(--text-primary)]">
                    No matching published routes
                  </h2>
                  <p className="text-xs font-normal text-[var(--text-secondary)]">
                    Try another island group or clear your route search query.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIslandGroup('all');
                      onSearchQueryChange('');
                    }}
                    className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    Reset route filters
                  </button>
                </div>
              ) : (
                <div className="@container">
                  <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 gap-3">
                    {filteredRoutes.map((entry) => {
                      const coursePath = buildRaceCoursePath(
                        entry.raceId,
                        entry.distanceId,
                        entry.currentPublicationId,
                      );
                      const resolvedIsland = resolveExploreCatalogIslandGroup(entry);
                      const locationLabel = entry.mapLayerProvenance?.province || entry.region;

                      return (
                        <article
                          key={entry.id}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
                          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center px-2 py-1 rounded-md bg-red-700 text-white text-xs font-semibold">
                                  {entry.distanceLabel}
                                </span>
                                {resolvedIsland && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-normal text-[var(--text-secondary)]">
                                    {resolvedIsland}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-xs font-normal tabular-nums text-[var(--text-secondary)]">
                                {entry.raceDate}
                              </span>
                            </div>

                            <h3 className="font-display font-semibold text-base text-[var(--text-primary)] leading-snug">
                              {entry.raceName}
                            </h3>

                            <p className="text-xs font-normal text-[var(--text-secondary)] flex items-center gap-2 min-w-0">
                              <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                              <span className="truncate">{locationLabel}</span>
                            </p>
                          </div>

                          <dl className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] py-2 text-center font-mono tabular-nums">
                            <div className="px-2 min-w-0">
                              <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">Measured</dt>
                              <dd className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                {formatMeasuredDistanceKm(entry)}
                              </dd>
                            </div>
                            <div className="px-2 min-w-0">
                              <dt className="font-sans text-xs font-normal text-[var(--text-secondary)] inline-flex items-center justify-center gap-1">
                                <Mountain className="w-3 h-3 shrink-0" aria-hidden="true" />
                                <span>Gain</span>
                              </dt>
                              <dd className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                {entry.elevationStatus === 'unavailable'
                                  ? 'N/A'
                                  : `+${Math.round(entry.elevationGainM)} m`}
                              </dd>
                            </div>
                            <div className="px-2 min-w-0">
                              <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">CP / Pins</dt>
                              <dd className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                {entry.checkpointCount} / {entry.landmarkCount}
                              </dd>
                            </div>
                          </dl>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <a
                              href={coursePath}
                              onClick={(e) => {
                                if (isClientNavigationClick(e)) {
                                  e.preventDefault();
                                  dispatchAppNavigate(coursePath);
                                }
                              }}
                              className="min-h-11 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                            >
                              <Flag className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                              <span>Open Course Map</span>
                            </a>

                            {onStartCourseRun && (
                              <button
                                type="button"
                                onClick={() =>
                                  onStartCourseRun({
                                    raceId: entry.raceId,
                                    distanceId: entry.distanceId,
                                    label: `${entry.raceName} (${entry.distanceLabel})`,
                                    publicationId: entry.currentPublicationId,
                                  })
                                }
                                className="min-h-11 flex-1 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                              >
                                <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>Run Course</span>
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'clubs' && (
          <RunnerClubsPanel
            uid={uid}
            profile={profile}
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            races={races}
            publishedRoutes={publishedRoutes}
            badgeCatalog={badgeCatalog}
            onOpenProfile={onOpenProfile}
            onStartCourseRun={onStartCourseRun}
            onOpenClubChat={onOpenClubChat}
            onOpenExploreRace={handleCatalogRegister}
            isDesktop={isDesktop}
            isSplitPane={resolvedSplitPane}
          />
        )}
      </div>
    </div>
  );
}
