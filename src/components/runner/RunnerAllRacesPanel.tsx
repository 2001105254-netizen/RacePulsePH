import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flag,
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
import DialogSurface from '../ui/DialogSurface';
import { ValueSkeleton } from '../ui/MotionPrimitives';
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
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: CatalogStatusFilter;
  onStatusFilterChange: (value: CatalogStatusFilter) => void;
  onMetricsChange?: (metrics: { all: number; upcoming: number; completed: number; showing: number }) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

export default function RunnerAllRacesPanel({
  races,
  racesLoaded,
  racesError,
  registeredRaceIds,
  onRegister,
  isDesktop,
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
  useAndroidBackHandler(!isDesktop && mobileInspecting, () => setMobileInspecting(false));

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
  const showMobileDetailOnly = !isDesktop && mobileInspecting && Boolean(selectedRace);

  const selectedIsCompleted = selectedRace ? !!selectedRace.completedAt || selectedRace.date < today : false;
  const selectedRegOpen = selectedRace ? isRaceRegistrationOpen(selectedRace) : false;

  return (
    <div id="runner_catalog_main" className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* Mobile / Tablet Compact Command Bar (< 1024px) */}
      {!isDesktop && !showMobileDetailOnly && (
        <div className="space-y-3 mb-3">
          <div className="glass-panel p-3.5 space-y-2.5">
            <div>
              <h2 className="text-base font-display font-semibold text-[var(--text-primary)]">All Race Events</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Official leaderboards, route previews, and finisher certificates
              </p>
            </div>

            <div className="relative">
              <Search
                className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="runner_catalog_mobile_search" className="sr-only">
                Search all race events by name, date, or distance
              </label>
              <input
                ref={mobileSearchRef}
                id="runner_catalog_mobile_search"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Search race, date, or distance..."
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-11 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  aria-label="Clear event search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter catalog by status">
              {(
                [
                  { key: 'all', label: 'All', count: statusCounts.all },
                  { key: 'upcoming', label: 'Upcoming', count: statusCounts.upcoming },
                  { key: 'completed', label: 'Completed', count: statusCounts.completed },
                ] as const
              ).map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onStatusFilterChange(item.key)}
                    aria-pressed={active}
                    className={`min-h-11 min-w-11 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono tabular-nums">{item.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Split Workspace: 42% Event Catalog Left / 58% Official Results & Leaderboard Right */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] gap-4 lg:gap-0">
        {!showMobileDetailOnly && (
          <section
            aria-label="Published race catalog"
            className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-page)] rounded-2xl lg:rounded-none border border-[var(--border-default)] lg:border-y-0 lg:border-l-0 lg:border-r overflow-hidden"
          >
            {availableDistances.length > 0 && (
              <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex items-center gap-2 overflow-x-auto racepulse-horizontal-scroll touch-pan-x">
                <span className="text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                  Distance:
                </span>
                <button
                  type="button"
                  onClick={() => setDistanceFilter('all')}
                  aria-pressed={distanceFilter === 'all'}
                  className={`min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 px-3.5 lg:px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
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
                    className={`min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 px-3.5 lg:px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
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

            <div
              tabIndex={0}
              role="region"
              aria-label="Race catalog list"
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain"
            >
              {!racesLoaded ? (
                <div role="status" aria-label="Loading race catalog" className="p-4 space-y-3">
                  {[0, 1, 2, 3].map((rowIdx) => (
                    <div
                      key={rowIdx}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <ValueSkeleton widthClass="w-12 shrink-0" heightClass="h-8 rounded" />
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <ValueSkeleton widthClass="w-40 max-w-full" heightClass="h-4" />
                          <ValueSkeleton widthClass="w-24" heightClass="h-3" />
                        </div>
                      </div>
                      <ValueSkeleton widthClass="w-16 shrink-0" heightClass="h-5 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : racesError ? (
                <div role="alert" className="flex flex-col items-center justify-center py-20 px-4 text-center">
                  <AlertTriangle className="w-7 h-7 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Unable to load race catalog</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{racesError}</p>
                </div>
              ) : sortedRaces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                  <LayoutGrid className="w-8 h-8 text-[var(--text-secondary)] mb-3" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">No published races yet</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                    Published RacePulsePH events and finisher leaderboards will appear here.
                  </p>
                </div>
              ) : filteredRaces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                  <Search className="w-8 h-8 text-[var(--text-secondary)] mb-3" aria-hidden="true" />
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
                      className="mt-4 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Reset filters
                    </button>
                  )}
                </div>
              ) : !isDesktop ? (
                <div id="runner_catalog_cards" className="p-3 space-y-3">
                  {filteredRaces.map((race) => {
                    const isSelected = selectedRace?.id === race.id;
                    const isDone = !!race.completedAt || race.date < today;
                    const regOpen = isRaceRegistrationOpen(race);
                    const isJoined = registeredRaceIds.has(race.id);
                    const dists = sortedRaceDistances(race);
                    return (
                      <article
                        key={race.id}
                        className={`rounded-2xl border border-[var(--border-default)] border-l-4 ${
                          isSelected
                            ? 'border-l-red-600 bg-red-500/[0.06] ring-2 ring-red-600/70'
                            : isDone
                              ? 'border-l-zinc-500 bg-[var(--surface-card)]'
                              : 'border-l-emerald-600 bg-[var(--surface-card)]'
                        } p-4 space-y-3`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                            {race.posterImage ? (
                              <img
                                src={race.posterImage}
                                alt={`${race.name} poster`}
                                width={64}
                                height={44}
                                className="w-16 h-11 object-cover block"
                              />
                            ) : (
                              <Trophy className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-base font-display font-semibold text-[var(--text-primary)] leading-snug">
                                {race.name}
                              </h3>
                              <span
                                className={`shrink-0 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                                  isDone
                                    ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                    : regOpen
                                      ? 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                      : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                                }`}
                              >
                                {isDone ? 'Finished' : regOpen ? 'Reg Open' : 'Upcoming'}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[var(--text-secondary)] mt-1">
                              <span>{race.date}</span>
                              {isJoined && (
                                <span className="px-2 py-0.5 rounded bg-red-600/10 text-red-700 dark:text-red-400 font-semibold">
                                  Registered
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {dists.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {dists.map((d) => (
                              <span
                                key={d.id}
                                className="px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-xs font-mono font-semibold text-[var(--text-secondary)]"
                              >
                                {d.label}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRaceId(race.id);
                              setMobileInspecting(true);
                            }}
                            className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                          >
                            <span>{isDone ? 'View Official Results' : 'View Race & Standings'}</span>
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div id="runner_catalog_list" className="divide-y divide-[var(--border-subtle)]">
                  {filteredRaces.map((race) => {
                    const isSelected = selectedRace?.id === race.id;
                    const isDone = !!race.completedAt || race.date < today;
                    const regOpen = isRaceRegistrationOpen(race);
                    const isJoined = registeredRaceIds.has(race.id);
                    const distSummary = sortedRaceDistances(race)
                      .map((d) => d.label)
                      .join(' · ');

                    return (
                      <div
                        key={race.id}
                        className={`border-l-4 transition-colors px-4 py-3 flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-l-red-600 bg-red-500/[0.08]'
                            : isDone
                              ? 'border-l-zinc-400 dark:border-l-zinc-600 hover:bg-[var(--surface-hover)]/65'
                              : 'border-l-emerald-600 dark:border-l-emerald-500 hover:bg-[var(--surface-hover)]/65'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedRaceId(race.id)}
                          aria-pressed={isSelected}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline"
                        >
                          <div className="w-12 h-8 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                            {race.posterImage ? (
                              <img
                                src={race.posterImage}
                                alt={`${race.name} thumbnail`}
                                width={48}
                                height={32}
                                className="w-12 h-8 object-cover block"
                              />
                            ) : (
                              <Trophy className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-display font-semibold text-sm leading-tight text-[var(--text-primary)] truncate">
                              {race.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)] mt-1">
                              <span className="font-mono tabular-nums">{race.date}</span>
                              {distSummary && <span className="truncate">{distSummary}</span>}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isJoined && (
                            <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs font-semibold">
                              Joined
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded border text-xs font-semibold ${
                              isDone
                                ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                : regOpen
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                  : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {isDone ? 'Finished' : regOpen ? 'Open' : 'Upcoming'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* RIGHT LEADERBOARD & EVENT DETAILS INSPECTOR (58% Desktop / Focused Screen on Mobile) */}
        {(isDesktop || showMobileDetailOnly) && (
          <aside
            id="runner_catalog_inspector"
            aria-label="Selected race leaderboard and details"
            className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-card)] rounded-2xl lg:rounded-none border lg:border-0 border-[var(--border-default)] overflow-hidden"
          >
            {selectedRace ? (
              <>
                <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 space-y-2">
                  {!isDesktop && (
                    <button
                      type="button"
                      onClick={() => setMobileInspecting(false)}
                      className="min-h-11 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                      <span>Back to All Races</span>
                    </button>
                  )}

                  <div className="flex flex-wrap items-start justify-between gap-2">
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
                        <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[var(--text-secondary)]">
                          <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                          {selectedRace.date}
                        </span>
                        {selectedRace.liveBroadcastEnabled && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-red-600/35 bg-red-500/10 text-red-700 dark:text-red-400 text-xs font-semibold">
                            Live Hub Active
                          </span>
                        )}
                      </div>
                      <h2 className="text-base sm:text-lg font-display font-semibold text-[var(--text-primary)] line-clamp-2 lg:truncate mt-1">
                        {selectedRace.name}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {selectedRegOpen && (
                        <button
                          type="button"
                          onClick={() => onRegister(selectedRace.id)}
                          className="min-h-11 lg:min-h-8 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{registeredRaceIds.has(selectedRace.id) ? 'Edit Entry' : 'Register'}</span>
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

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 sm:p-5 space-y-4">
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
                    registerLabel={registeredRaceIds.has(selectedRace.id) ? 'Edit entry' : 'Register for this race'}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Trophy className="w-8 h-8 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Race Standings Ready</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                  Select any race from the catalog on the left to inspect its official leaderboard, 3D route, and finisher
                  certificates.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>

      {posterLightbox && posterLightbox.posterImage && (
        <DialogSurface
          titleId="runner_catalog_poster_lightbox"
          onRequestClose={() => setPosterLightbox(null)}
          className="fixed inset-0 m-auto h-fit rounded-2xl w-[calc(100%-2rem)] max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-2xl"
        >
          <div className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="runner_catalog_poster_lightbox"
                  className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
                >
                  {posterLightbox.name}
                </h2>
                <p className="text-xs font-mono text-[var(--text-secondary)]">{posterLightbox.date}</p>
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
            <div className="max-h-[75vh] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 flex items-center justify-center overflow-hidden">
              <img
                src={posterLightbox.posterImage}
                alt={`${posterLightbox.name} full poster`}
                width={1200}
                height={800}
                className="max-w-full max-h-[70vh] w-auto h-auto object-contain rounded"
              />
            </div>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}
