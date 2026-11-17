import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Maximize2,
  Search,
  Trophy,
  UserPlus,
  X,
} from 'lucide-react';
import { isRaceRegistrationOpen } from '../../lib/raceRegistration';
import { Race } from '../../types';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';
import PublicRaceResults from '../PublicRaceResults';
import EventCourseRunnerPanel from '../routes/EventCourseRunnerPanel';
import DialogSurface from '../ui/DialogSurface';
import {
  RunnerBottomSheetDetent,
  RunnerFilterRail,
  RunnerFloatingStatusPill,
  RunnerQueueRow,
  RunnerQueueSkeleton,
  RunnerTelemetryStrip,
  type QueueStatusTone,
  type SheetDetent,
} from './RunnerMobilePrimitives';
import { philippineTodayStr, sortedRaceDistances } from './runnerUtils';

export type CatalogStatusFilter = 'all' | 'upcoming' | 'completed';

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface RunnerAllRacesPanelProps {
  races: Race[];
  racesLoaded: boolean;
  racesError: string | null;
  registeredRaceIds: Set<string>;
  onRegister: (raceId: string) => void;
  isDesktop: boolean;
  isSplitPane?: boolean;
  isCompact?: boolean;
  onCanvasModeChange?: (active: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: CatalogStatusFilter;
  onStatusFilterChange: (value: CatalogStatusFilter) => void;
  onMetricsChange?: (metrics: { all: number; upcoming: number; completed: number; showing: number }) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

function CatalogRaceCanvasView({
  race,
  isDone,
  regOpen,
  isJoined,
  onRegister,
  onOpenPoster,
  onBack,
}: {
  race: Race;
  isDone: boolean;
  regOpen: boolean;
  isJoined: boolean;
  onRegister: (raceId: string) => void;
  onOpenPoster: () => void;
  onBack: () => void;
}) {
  const [detent, setDetent] = useState<SheetDetent>('half');
  const dists = sortedRaceDistances(race);
  const statusLabel = isDone ? 'Finished' : regOpen ? 'Reg Open' : 'Upcoming';
  const statusTone: QueueStatusTone = isDone ? 'done' : regOpen ? 'open' : 'upcoming';

  return (
    <div
      data-testid="catalog-run-canvas"
      className="fixed inset-0 z-[45] h-dvh overflow-hidden flex flex-col bg-[var(--surface-page)]"
    >
      <RunnerFloatingStatusPill
        idBadge={dists[0]?.label}
        title={race.name}
        statusLabel={statusLabel}
        statusTone={statusTone}
        onBack={onBack}
        backLabel="Back to All Races"
        rightSlot={
          race.posterImage ? (
            <button
              type="button"
              onClick={onOpenPoster}
              aria-label={`View full poster for ${race.name}`}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] shrink-0"
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : undefined
        }
      />

      {/* Upper 60-70% Course & Overview Canvas */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-[calc(76px+var(--rp-safe-top))] pb-[184px] px-3 space-y-3">
        <RunnerTelemetryStrip
          ariaLabel="Race summary metrics"
          className="rounded-xl border border-[var(--border-default)]"
          items={[
            { key: 'date', label: 'Race Date', value: race.date },
            { key: 'cats', label: 'Categories', value: String(dists.length || 1) },
            {
              key: 'entry',
              label: 'Entry',
              value: isJoined ? 'Joined' : regOpen ? 'Open' : isDone ? 'Closed' : 'Soon',
              accent: regOpen ? 'emerald' : isJoined ? 'red' : 'default',
            },
          ]}
        />

        {race.posterImage && (
          <button
            type="button"
            onClick={onOpenPoster}
            className="w-full h-36 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center justify-center p-2 overflow-hidden"
          >
            <img
              src={race.posterImage}
              alt={`${race.name} uncropped poster`}
              width={640}
              height={360}
              className="max-w-full max-h-full w-auto h-auto object-contain rounded"
            />
          </button>
        )}

        <EventCourseRunnerPanel race={race} preferredDistance={dists[0]?.label} compact />
      </div>

      {/* 3-Detent Bottom Sheet: Official Leaderboards & Registration Action */}
      <RunnerBottomSheetDetent
        detent={detent}
        onDetentChange={setDetent}
        ariaLabel="Race standings and registration"
        peekSummary={
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{race.name}</p>
            <p className="text-xs text-[var(--text-secondary)] truncate tabular-nums">
              {race.date}
              {dists.length > 0 ? ` · ${dists.map((d) => d.label).join(' · ')}` : ''}
            </p>
          </div>
        }
        primaryAction={
          <div className="flex items-center gap-2">
            {regOpen ? (
              <button
                type="button"
                onClick={() => onRegister(race.id)}
                className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>{isJoined ? 'Edit Entry' : 'Register Now'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setDetent((curr) => (curr === 'peek' ? 'half' : 'expanded'))}
                className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Trophy className="w-4 h-4" aria-hidden="true" />
                <span>{detent === 'peek' ? 'View Standings' : 'Expand Leaderboard'}</span>
              </button>
            )}
            {regOpen && detent !== 'expanded' && (
              <button
                type="button"
                onClick={() => setDetent('expanded')}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] shrink-0"
              >
                Standings
              </button>
            )}
          </div>
        }
      >
        <PublicRaceResults
          embedded
          hideCoursePreview
          race={race}
          onRegister={onRegister}
          registerLabel={isJoined ? 'Edit entry' : 'Register for this race'}
        />
      </RunnerBottomSheetDetent>
    </div>
  );
}

export default function RunnerAllRacesPanel({
  races,
  racesLoaded,
  racesError,
  registeredRaceIds,
  onRegister,
  isDesktop,
  isSplitPane = isDesktop,
  isCompact = !isSplitPane,
  onCanvasModeChange,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  onMetricsChange,
  desktopSearchRef,
}: RunnerAllRacesPanelProps) {
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [mobileInspecting, setMobileInspecting] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState('all');
  const [posterLightbox, setPosterLightbox] = useState<Race | null>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  useAndroidBackHandler(Boolean(posterLightbox), () => setPosterLightbox(null));
  useAndroidBackHandler(isCompact && mobileInspecting && !posterLightbox, () => setMobileInspecting(false));

  const today = philippineTodayStr();

  const sortedRaces = useMemo(
    () => [...races].sort((a, b) => b.date.localeCompare(a.date) || NAME_COLLATOR.compare(a.name, b.name)),
    [races],
  );

  const availableDistances = useMemo(() => {
    const labels = new Set<string>();
    sortedRaces.forEach((race) => sortedRaceDistances(race).forEach((d) => labels.add(d.label)));
    return Array.from(labels).sort((a, b) => {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return NAME_COLLATOR.compare(a, b);
    });
  }, [sortedRaces]);

  const statusCounts = useMemo(() => {
    const upcomingCount = sortedRaces.filter((race) => !race.completedAt && race.date >= today).length;
    const completedCount = sortedRaces.length - upcomingCount;
    return { all: sortedRaces.length, upcoming: upcomingCount, completed: completedCount };
  }, [sortedRaces, today]);

  const filteredRaces = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return sortedRaces.filter((race) => {
      const isDone = !!race.completedAt || race.date < today;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'upcoming' && !isDone) ||
        (statusFilter === 'completed' && isDone);
      const matchesSearch =
        !term ||
        race.name.toLowerCase().includes(term) ||
        race.date.includes(term) ||
        (race.distances || []).some((d) => d.label.toLowerCase().includes(term));
      const matchesDistance =
        distanceFilter === 'all' || (race.distances || []).some((d) => d.label === distanceFilter);
      return matchesStatus && matchesSearch && matchesDistance;
    });
  }, [sortedRaces, statusFilter, searchQuery, distanceFilter, today]);

  useEffect(() => {
    onMetricsChange?.({
      all: statusCounts.all,
      upcoming: statusCounts.upcoming,
      completed: statusCounts.completed,
      showing: filteredRaces.length,
    });
  }, [statusCounts.all, statusCounts.upcoming, statusCounts.completed, filteredRaces.length, onMetricsChange]);

  useEffect(() => {
    if (filteredRaces.length === 0) return;
    if (!filteredRaces.some((r) => r.id === selectedRaceId)) {
      setSelectedRaceId(filteredRaces[0].id);
    }
  }, [filteredRaces, selectedRaceId]);

  const selectedIndex = filteredRaces.findIndex((r) => r.id === selectedRaceId);
  const selectedRace = selectedIndex >= 0 ? filteredRaces[selectedIndex] : undefined;

  const stepSelectedRace = (delta: -1 | 1) => {
    if (filteredRaces.length === 0) return;
    if (selectedIndex === -1) {
      setSelectedRaceId(filteredRaces[0].id);
      return;
    }
    const nextIdx = (selectedIndex + delta + filteredRaces.length) % filteredRaces.length;
    setSelectedRaceId(filteredRaces[nextIdx].id);
  };

  // Keyboard shortcuts matching MyRaceEventsPanel
  useEffect(() => {
    if (posterLightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (event.key === '/' && !isFormField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        (isDesktop ? desktopSearchRef?.current : mobileSearchRef.current)?.focus();
        return;
      }
      if (!isFormField && filteredRaces.length > 1) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          stepSelectedRace(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          stepSelectedRace(-1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const hasFilters = Boolean(searchQuery || distanceFilter !== 'all' || statusFilter !== 'all');
  const showCompactCanvas = Boolean(isCompact && mobileInspecting && selectedRace);

  useEffect(() => {
    onCanvasModeChange?.(showCompactCanvas);
    return () => onCanvasModeChange?.(false);
  }, [showCompactCanvas, onCanvasModeChange]);

  const selectedIsCompleted = selectedRace ? !!selectedRace.completedAt || selectedRace.date < today : false;
  const selectedRegOpen = selectedRace ? isRaceRegistrationOpen(selectedRace) : false;
  const selectedJoined = selectedRace ? registeredRaceIds.has(selectedRace.id) : false;

  return (
    <>
      {showCompactCanvas && selectedRace ? (
        <CatalogRaceCanvasView
          race={selectedRace}
          isDone={selectedIsCompleted}
          regOpen={selectedRegOpen}
          isJoined={selectedJoined}
          onRegister={onRegister}
          onOpenPoster={() => setPosterLightbox(selectedRace)}
          onBack={() => setMobileInspecting(false)}
        />
      ) : (
        <div id="runner_catalog_main" className="w-full flex flex-col flex-1 min-h-0 min-[600px]:overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col min-[600px]:grid min-[600px]:grid-cols-[minmax(236px,38%)_minmax(0,1fr)] min-[920px]:grid-cols-[340px_minmax(0,1fr)]">
            <section
              aria-label="Published race catalog"
              className="flex flex-col flex-1 min-h-0 bg-[var(--surface-page)] min-[600px]:border-r min-[600px]:border-[var(--border-default)] overflow-hidden"
            >
              {!isDesktop && (
                <RunnerFilterRail<CatalogStatusFilter>
                  ariaLabel="Filter catalog by status"
                  options={[
                    { key: 'all', label: 'All', count: statusCounts.all },
                    { key: 'upcoming', label: 'Upcoming', count: statusCounts.upcoming },
                    { key: 'completed', label: 'Done', count: statusCounts.completed },
                  ]}
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  searchValue={searchQuery}
                  onSearchChange={onSearchQueryChange}
                  searchPlaceholder="Search race, date, distance..."
                  searchLabel="Search all race events by name, date, or distance"
                  searchInputId="runner_catalog_mobile_search"
                  searchInputRef={mobileSearchRef}
                />
              )}

              <div
                tabIndex={0}
                role="region"
                aria-label="Race catalog list"
                className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll"
              >
                {availableDistances.length > 0 && (
                  <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] flex items-center gap-1.5 overflow-x-auto racepulse-horizontal-scroll touch-pan-x">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                      Distance:
                    </span>
                    <button
                      type="button"
                      onClick={() => setDistanceFilter('all')}
                      aria-pressed={distanceFilter === 'all'}
                      className={`min-h-11 min-w-11 min-[600px]:min-h-8 min-[600px]:min-w-0 px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        distanceFilter === 'all'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                      }`}
                    >
                      All
                    </button>
                    {availableDistances.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setDistanceFilter(label)}
                        aria-pressed={distanceFilter === label}
                        className={`min-h-11 min-w-11 min-[600px]:min-h-8 min-[600px]:min-w-0 px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          distanceFilter === label
                            ? 'border-red-600 bg-red-700 text-white'
                            : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {!racesLoaded ? (
                  <RunnerQueueSkeleton rows={5} label="Loading race catalog" />
                ) : racesError ? (
                  <div role="alert" className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <AlertTriangle className="w-6 h-6 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Unable to load race catalog</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{racesError}</p>
                  </div>
                ) : sortedRaces.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <LayoutGrid className="w-7 h-7 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">No published races yet</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                      Published RacePulsePH events and finisher leaderboards will appear here.
                    </p>
                  </div>
                ) : filteredRaces.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <Search className="w-6 h-6 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">No matching race events</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                      Try another search term or clear your status and distance filters.
                    </p>
                    {hasFilters && (
                      <button
                        type="button"
                        onClick={() => {
                          onSearchQueryChange('');
                          onStatusFilterChange('all');
                          setDistanceFilter('all');
                        }}
                        className="mt-3 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div id="runner_catalog_list" className="divide-y divide-[var(--border-subtle)] bg-[var(--surface-card)]">
                    {filteredRaces.map((race) => {
                      const isSelected = selectedRace?.id === race.id;
                      const isDone = !!race.completedAt || race.date < today;
                      const regOpen = isRaceRegistrationOpen(race);
                      const isJoined = registeredRaceIds.has(race.id);
                      const dists = sortedRaceDistances(race);
                      const distSummary = dists.map((d) => d.label).join(' · ');
                      const statusTone: QueueStatusTone = isDone ? 'done' : regOpen ? 'open' : 'upcoming';

                      return (
                        <RunnerQueueRow
                          key={race.id}
                          selected={isSelected && isSplitPane}
                          idTag={race.date.slice(5)}
                          title={race.name}
                          meta={`${race.date}${distSummary ? ` · ${distSummary}` : ''}${isJoined ? ' · Joined' : ''}`}
                          metric={`${dists.length || 1} cat${dists.length === 1 ? '' : 's'}`}
                          metricAccent={isJoined ? 'red' : 'default'}
                          statusLabel={isDone ? 'Finished' : regOpen ? 'Open' : 'Upcoming'}
                          statusTone={statusTone}
                          onClick={() => {
                            setSelectedRaceId(race.id);
                            if (isCompact) setMobileInspecting(true);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* RIGHT LEADERBOARD & EVENT DETAILS INSPECTOR (>= 600px) */}
            {isSplitPane && (
              <aside
                id="runner_catalog_inspector"
                aria-label="Selected race leaderboard and details"
                className="flex flex-col min-h-0 h-full bg-[var(--surface-card)] overflow-hidden"
              >
                {selectedRace ? (
                  <>
                    <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${
                                selectedIsCompleted
                                  ? 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                  : selectedRegOpen
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                    : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {selectedIsCompleted ? 'Completed' : selectedRegOpen ? 'Reg Open' : 'Upcoming'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums text-[var(--text-secondary)]">
                              <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                              {selectedRace.date}
                            </span>
                            {selectedRace.liveBroadcastEnabled && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-red-600/35 bg-red-500/10 text-red-700 dark:text-red-400 text-xs font-semibold">
                                Live Hub Active
                              </span>
                            )}
                          </div>
                          <h2 className="text-base font-display font-semibold text-[var(--text-primary)] truncate mt-0.5">
                            {selectedRace.name}
                          </h2>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {selectedRegOpen && (
                            <button
                              type="button"
                              onClick={() => onRegister(selectedRace.id)}
                              className="min-h-11 lg:min-h-8 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{selectedJoined ? 'Edit Entry' : 'Register'}</span>
                            </button>
                          )}
                          {selectedRace.posterImage && (
                            <button
                              type="button"
                              onClick={() => setPosterLightbox(selectedRace)}
                              aria-label={`View full poster for ${selectedRace.name}`}
                              title="View full poster"
                              className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                            >
                              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {filteredRaces.length > 1 && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => stepSelectedRace(-1)}
                                aria-label="Previous race"
                                className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                              >
                                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                              </button>
                              <span className="px-1 font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                                {selectedIndex + 1}/{filteredRaces.length}
                              </span>
                              <button
                                type="button"
                                onClick={() => stepSelectedRace(1)}
                                aria-label="Next race"
                                className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                              >
                                <ChevronRight className="w-4 h-4" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3 sm:p-4 space-y-4">
                      {selectedRace.posterImage && (
                        <div className="h-36 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center justify-center p-2 overflow-hidden">
                          <img
                            src={selectedRace.posterImage}
                            alt={`${selectedRace.name} uncropped poster`}
                            width={640}
                            height={360}
                            className="max-w-full max-h-full w-auto h-auto object-contain rounded"
                          />
                        </div>
                      )}

                      <PublicRaceResults
                        embedded
                        race={selectedRace}
                        onRegister={onRegister}
                        registerLabel={selectedJoined ? 'Edit entry' : 'Register for this race'}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                    <Trophy className="w-7 h-7 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">Race Standings Ready</h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                      Select any race from the catalog to inspect its official leaderboard, course route, and finisher certificates.
                    </p>
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>
      )}

      {posterLightbox && posterLightbox.posterImage && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="56rem"
          titleId="runner_catalog_poster_lightbox"
          onRequestClose={() => setPosterLightbox(null)}
          bodyClassName="p-3 sm:p-4 space-y-3"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="runner_catalog_poster_lightbox"
                  className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
                >
                  {posterLightbox.name}
                </h2>
                <p className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">{posterLightbox.date}</p>
              </div>
              <button
                type="button"
                onClick={() => setPosterLightbox(null)}
                aria-label="Close full poster view"
                className="min-h-11 min-w-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[70dvh] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 flex items-center justify-center overflow-hidden">
              <img
                src={posterLightbox.posterImage}
                alt={`${posterLightbox.name} full poster`}
                width={1200}
                height={800}
                className="max-w-full max-h-[66dvh] w-auto h-auto object-contain rounded"
              />
            </div>
          </div>
        </DialogSurface>
      )}
    </>
  );
}
