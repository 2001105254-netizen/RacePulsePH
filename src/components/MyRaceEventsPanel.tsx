import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  Flag,
  LayoutGrid,
  Maximize2,
  Plus,
  Radio,
  Search,
  Settings2,
  Timer,
  Tv,
  Users,
  Users2,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { useAccess, useScopedRacesState } from '../lib/access';
import { isRaceRegistrationOpen, philippineDate } from '../lib/raceRegistration';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import { Race, RunnerProfile } from '../types';
import DialogSurface from './ui/DialogSurface';
import { AnimatedMetricValue, ValueSkeleton } from './ui/MotionPrimitives';

const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

export interface MyRaceEventsPanelProps {
  uid: string;
  onManageRace: (raceId: string) => void;
  onOpenTiming?: (raceId: string) => void;
  onOpenEngraving?: (raceId: string) => void;
  onOpenRunners?: (raceId: string) => void;
  onOpenSetup?: (raceId: string) => void;
  onOpenLiveHub?: (raceId: string) => void;
  onCreateEvent?: () => void;
}

type EventStatusFilter = 'all' | 'upcoming' | 'completed';
type SortKey = 'date' | 'name' | 'runners' | 'revenue';
type SortDir = 'asc' | 'desc';

interface DistanceSummary {
  id: string;
  label: string;
  km: number;
  price: number;
  runnerCount: number;
  estRevenue: number;
}

interface EventDirectoryRow {
  race: Race;
  completed: boolean;
  registrationOpen: boolean;
  runnerCount: number;
  estRevenue: number;
  sortedDistances: Race['distances'];
  distanceBreakdown: DistanceSummary[];
  unmappedRunnerCount: number;
  searchHaystack: string;
}

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH');
const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

export function formatCountPH(value: number): string {
  return COUNT_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

export function formatCurrencyPH(value: number): string {
  return PHP_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

export default function MyRaceEventsPanel({
  onManageRace,
  onOpenTiming,
  onOpenEngraving,
  onOpenRunners,
  onOpenSetup,
  onOpenLiveHub,
  onCreateEvent,
}: MyRaceEventsPanelProps) {
  const { can } = useAccess();
  const { races, loading: racesLoading, error: racesError } = useScopedRacesState();
  const headerCtx = useWorkspaceHeader();
  const isDesktop = useIsDesktop();

  const canViewRoster = can('roster.view');
  const canViewRevenue = can('revenue.view');
  const canViewTiming = can('timing.view');
  const canViewEngraving = can('engraving.view');
  const canCreateRace = can('race.create');
  const canViewHub = can('hub.manage') || can('hub.publish');
  const canEditRace = [
    'race.edit',
    'race.categories',
    'race.registration',
    'race.artwork',
    'race.bibs',
    'race.team',
    'payment.configure',
  ].some(can);

  const [runners, setRunners] = useState<RunnerProfile[]>([]);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [settledRaceIds, setSettledRaceIds] = useState<Set<string>>(() => new Set());
  const [runnersWarning, setRunnersWarning] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedRaceId, setSelectedRaceId] = useState<string>(
    () => (typeof window !== 'undefined' ? localStorage.getItem('racepulse_active_race') || '' : ''),
  );
  const [posterLightboxRace, setPosterLightboxRace] = useState<Race | null>(null);

  const headerSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  // Coordinate desktop viewport lock with App shell & WorkspaceShell (matches Engraving v2.0)
  const setDesktopLocked = headerCtx?.setDesktopLocked;
  useEffect(() => {
    if (!setDesktopLocked) return;
    setDesktopLocked(isDesktop);
    return () => setDesktopLocked(false);
  }, [isDesktop, setDesktopLocked]);

  // Read registrations one authorized race at a time to preserve per-race Firestore scope.
  const raceIds = useMemo(() => races.map((race) => race.id).sort(), [races]);
  const raceIdsKey = raceIds.join('|');

  useEffect(() => {
    if (raceIds.length === 0 || !canViewRoster) {
      setRunners([]);
      setSettledRaceIds(new Set());
      setRunnersLoading(false);
      setRunnersWarning(null);
      return;
    }

    let active = true;
    let flushRafId: number | null = null;
    setRunnersLoading(true);
    setSettledRaceIds(new Set());
    setRunnersWarning(null);
    const runnersByRaceMap = new Map<string, RunnerProfile[]>();
    const settledRaces = new Set<string>();

    const flush = () => {
      flushRafId = null;
      if (!active) return;
      const merged: RunnerProfile[] = [];
      for (const list of runnersByRaceMap.values()) {
        for (const item of list) merged.push(item);
      }
      setRunners(merged);
      setSettledRaceIds(new Set(settledRaces));
      if (settledRaces.size >= raceIds.length) {
        setRunnersLoading(false);
      }
    };

    const scheduleFlush = () => {
      if (!active || flushRafId !== null) return;
      flushRafId = window.requestAnimationFrame(flush);
    };

    const unsubscribes = raceIds.map((raceId) =>
      onSnapshot(
        query(collection(db, 'runners'), where('raceId', '==', raceId)),
        (snapshot) => {
          const list: RunnerProfile[] = [];
          snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
          runnersByRaceMap.set(raceId, list);
          settledRaces.add(raceId);
          scheduleFlush();
        },
        (err) => {
          console.warn(`Runners listener failed for race ${raceId}:`, err.message);
          runnersByRaceMap.set(raceId, []);
          settledRaces.add(raceId);
          if (active) {
            setRunnersWarning('Some runner counts could not be loaded cleanly.');
          }
          scheduleFlush();
        },
      ),
    );

    return () => {
      active = false;
      if (flushRafId !== null) {
        window.cancelAnimationFrame(flushRafId);
      }
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [raceIdsKey, canViewRoster]);

  const runnersByRace = useMemo(() => {
    const map = new Map<string, RunnerProfile[]>();
    for (const runner of runners) {
      const list = map.get(runner.raceId) ?? [];
      list.push(runner);
      map.set(runner.raceId, list);
    }
    return map;
  }, [runners]);

  const todayStr = philippineDate();

  const eventRows = useMemo<EventDirectoryRow[]>(() => {
    return races.map((race) => {
      const raceRunners = runnersByRace.get(race.id) || [];
      const sortedDistances = [...(race.distances || [])].sort((a, b) => a.km - b.km);
      const countByLabel = new Map<string, number>();

      for (const runner of raceRunners) {
        const key = (runner.distance || '').trim();
        countByLabel.set(key, (countByLabel.get(key) || 0) + 1);
      }

      const distanceBreakdown: DistanceSummary[] = sortedDistances.map((dist) => {
        const matchedCount = countByLabel.get(dist.label.trim()) || 0;
        const unitPrice = dist.price || 0;
        return {
          id: dist.id,
          label: dist.label,
          km: dist.km,
          price: unitPrice,
          runnerCount: matchedCount,
          estRevenue: matchedCount * unitPrice,
        };
      });

      const configuredLabels = new Set(sortedDistances.map((d) => d.label.trim()));
      let unmappedRunnerCount = 0;
      for (const [label, count] of countByLabel.entries()) {
        if (!configuredLabels.has(label)) {
          unmappedRunnerCount += count;
        }
      }

      const estRevenue = distanceBreakdown.reduce((sum, item) => sum + item.estRevenue, 0);
      const completed = Boolean(race.completedAt) || race.date < todayStr;
      const registrationOpen = !completed && isRaceRegistrationOpen(race, todayStr);
      const searchHaystack = `${race.name} ${race.date} ${sortedDistances
        .map((d) => d.label)
        .join(' ')}`.toLowerCase();

      return {
        race,
        completed,
        registrationOpen,
        runnerCount: raceRunners.length,
        estRevenue,
        sortedDistances,
        distanceBreakdown,
        unmappedRunnerCount,
        searchHaystack,
      };
    });
  }, [races, runnersByRace, todayStr]);

  const portfolioStats = useMemo(() => {
    let upcoming = 0;
    let completed = 0;
    let totalRunners = 0;
    let totalRevenue = 0;
    for (const row of eventRows) {
      if (row.completed) {
        completed += 1;
      } else {
        upcoming += 1;
      }
      totalRunners += row.runnerCount;
      totalRevenue += row.estRevenue;
    }
    return {
      totalEvents: eventRows.length,
      upcoming,
      completed,
      totalRunners,
      totalRevenue,
    };
  }, [eventRows]);

  const filteredEvents = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    const filtered = eventRows.filter((row) => {
      if (statusFilter === 'upcoming' && row.completed) return false;
      if (statusFilter === 'completed' && !row.completed) return false;
      if (needle && !row.searchHaystack.includes(needle)) return false;
      return true;
    });

    const direction = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.race.name.localeCompare(b.race.name);
        return cmp !== 0 ? cmp * direction : b.race.date.localeCompare(a.race.date);
      }
      if (sortKey === 'runners') {
        const cmp = a.runnerCount - b.runnerCount;
        return cmp !== 0 ? cmp * direction : b.race.date.localeCompare(a.race.date);
      }
      if (sortKey === 'revenue') {
        const cmp = a.estRevenue - b.estRevenue;
        return cmp !== 0 ? cmp * direction : b.race.date.localeCompare(a.race.date);
      }
      const dateCmp = a.race.date.localeCompare(b.race.date);
      return dateCmp !== 0 ? dateCmp * direction : a.race.name.localeCompare(b.race.name);
    });
  }, [eventRows, searchTerm, statusFilter, sortKey, sortDir]);

  // Keep an active selection whenever matching events exist
  useEffect(() => {
    if (filteredEvents.length === 0) return;
    if (!filteredEvents.some((row) => row.race.id === selectedRaceId)) {
      setSelectedRaceId(filteredEvents[0].race.id);
    }
  }, [filteredEvents, selectedRaceId]);

  const selectedIndex = filteredEvents.findIndex((row) => row.race.id === selectedRaceId);
  const selectedEvent = selectedIndex >= 0 ? filteredEvents[selectedIndex] : null;

  const selectRace = (raceId: string) => {
    setSelectedRaceId(raceId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('racepulse_active_race', raceId);
    }
  };

  const stepSelectedEvent = (delta: -1 | 1) => {
    if (filteredEvents.length === 0) return;
    if (selectedIndex === -1) {
      selectRace(filteredEvents[0].race.id);
      return;
    }
    const nextIdx = (selectedIndex + delta + filteredEvents.length) % filteredEvents.length;
    selectRace(filteredEvents[nextIdx].race.id);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  };

  // Global keyboard shortcuts: / focuses search, Up/Down steps through events
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (posterLightboxRace) return;
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (event.key === '/' && !isFormField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        (isDesktop ? headerSearchRef.current : mobileSearchRef.current)?.focus();
        return;
      }

      if (!isFormField && event.key === 'ArrowDown') {
        event.preventDefault();
        stepSelectedEvent(1);
      } else if (!isFormField && event.key === 'ArrowUp') {
        event.preventDefault();
        stepSelectedEvent(-1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleLaunchTiming = (raceId: string) => {
    selectRace(raceId);
    if (onOpenTiming) {
      onOpenTiming(raceId);
      return;
    }
    onManageRace(raceId);
  };

  const handleLaunchEngraving = (raceId: string) => {
    if (!onOpenEngraving) return;
    selectRace(raceId);
    onOpenEngraving(raceId);
  };

  const handleLaunchRunners = (raceId: string) => {
    if (!onOpenRunners) return;
    selectRace(raceId);
    onOpenRunners(raceId);
  };

  const handleLaunchSetup = (raceId: string) => {
    if (!onOpenSetup) return;
    selectRace(raceId);
    onOpenSetup(raceId);
  };

  const handleLaunchLiveHub = (raceId: string) => {
    if (!onOpenLiveHub) return;
    selectRace(raceId);
    onOpenLiveHub(raceId);
  };

  const renderSortMarker = (column: SortKey) => {
    if (sortKey !== column) return null;
    return (
      <span className="ml-1 font-mono text-red-700 dark:text-red-400" aria-hidden="true">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  const statusTabs: { key: EventStatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: portfolioStats.totalEvents },
    { key: 'upcoming', label: 'Upcoming', count: portfolioStats.upcoming },
    { key: 'completed', label: 'Completed', count: portfolioStats.completed },
  ];

  // Desktop Top Global Header Left Cluster (Portaled into App.tsx header beside brand mark)
  const headerLeftMarkup = (
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <span className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-2 shrink-0">
        <CalendarDays className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
        <span className="text-xs font-display font-semibold uppercase tracking-wider text-white whitespace-nowrap">
          My Race Events
        </span>
      </div>

      <div className="relative flex-1 min-w-[180px] max-w-sm">
        <Search
          className="w-3.5 h-3.5 text-zinc-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <label htmlFor="events_header_search" className="sr-only">
          Search race events by name, date, or distance
        </label>
        <input
          ref={headerSearchRef}
          id="events_header_search"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search race, date, or distance... (/)"
          className="w-full h-9 rounded-lg border border-white/15 bg-white/10 pl-8 pr-8 text-xs font-semibold text-white placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-red-400"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            aria-label="Clear event search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  // Desktop Top Global Header Right Cluster (Portaled beside Theme Toggle in App.tsx)
  const headerRightMarkup = (
    <div className="flex items-center gap-1.5" role="toolbar" aria-label="Event filters and creation">
      <div
        className="inline-flex rounded-lg border border-white/15 bg-white/10 p-0.5 shrink-0"
        role="group"
        aria-label="Filter events by status"
      >
        {statusTabs.map((item) => {
          const active = statusFilter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              aria-pressed={active}
              className={`h-8 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                active
                  ? 'bg-red-700 text-white'
                  : 'text-zinc-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  active ? 'text-white' : 'text-zinc-300'
                }`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      {canCreateRace && onCreateEvent && (
        <button
          type="button"
          onClick={onCreateEvent}
          className="h-9 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white border border-red-500/30 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Create Event</span>
        </button>
      )}
    </div>
  );

  const telemetryPills: {
    key: EventStatusFilter;
    label: string;
    value: number;
    accentClass: string;
  }[] = [
    {
      key: 'all',
      label: 'Total Events',
      value: portfolioStats.totalEvents,
      accentClass: 'text-[var(--text-primary)]',
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      value: portfolioStats.upcoming,
      accentClass: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      key: 'completed',
      label: 'Completed',
      value: portfolioStats.completed,
      accentClass: 'text-[var(--text-secondary)]',
    },
  ];

  const renderInlineActions = (race: Race, compactMobile = false) => {
    const btnClass = compactMobile
      ? 'min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap'
      : 'h-7 px-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600 hover:text-red-700 dark:hover:text-red-400 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400';

    const timingBtnClass = compactMobile
      ? 'min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap'
      : 'h-7 px-2 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400';

    return (
      <div
        className={`flex items-center ${compactMobile ? 'flex-wrap gap-2' : 'justify-end gap-1'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {canViewTiming && (
          <button
            type="button"
            onClick={() => handleLaunchTiming(race.id)}
            title={`Open Timing console for ${race.name}`}
            aria-label={`Timing for ${race.name}`}
            className={timingBtnClass}
          >
            <Radio className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>Timing</span>
          </button>
        )}
        {canViewEngraving && onOpenEngraving && (
          <button
            type="button"
            onClick={() => handleLaunchEngraving(race.id)}
            title={`Open Medal Engraving queue for ${race.name}`}
            aria-label={`Engrave for ${race.name}`}
            className={btnClass}
          >
            <Award className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>Engrave</span>
          </button>
        )}
        {canViewRoster && onOpenRunners && (
          <button
            type="button"
            onClick={() => handleLaunchRunners(race.id)}
            title={`Open Runner Roster for ${race.name}`}
            aria-label={`Runners for ${race.name}`}
            className={btnClass}
          >
            <Users className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>Runners</span>
          </button>
        )}
        {canEditRace && onOpenSetup && (
          <button
            type="button"
            onClick={() => handleLaunchSetup(race.id)}
            title={`Edit Race Setup for ${race.name}`}
            aria-label={`Setup for ${race.name}`}
            className={btnClass}
          >
            <Settings2 className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>Setup</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      id="race_events_directory_main"
      className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden"
    >
      {/* Semantic H1 for screen readers without consuming vertical space above the fold */}
      <h1 className="sr-only">My Race Events Directory</h1>

      {/* Portaled Desktop Global Header Controls (matches Engraving v2.0 layout contract) */}
      {isDesktop && headerCtx?.leftSlotEl && createPortal(headerLeftMarkup, headerCtx.leftSlotEl)}
      {isDesktop && headerCtx?.rightSlotEl && createPortal(headerRightMarkup, headerCtx.rightSlotEl)}

      {/* Mobile / Tablet Responsive Action & Filter Bar (< 1024px) */}
      {!isDesktop && (
        <div className="space-y-3 mb-4">
          <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">
                  My Race Events
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Directory and operational module launchpad
                </p>
              </div>
              {canCreateRace && onCreateEvent && (
                <button
                  type="button"
                  onClick={onCreateEvent}
                  className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /> Create Event
                </button>
              )}
            </div>

            <div className="relative">
              <Search
                className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="events_mobile_search" className="sr-only">
                Search race events by name, date, or distance
              </label>
              <input
                ref={mobileSearchRef}
                id="events_mobile_search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, date, or distance..."
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-9 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear event search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter events by status">
              {statusTabs.map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatusFilter(item.key)}
                    aria-pressed={active}
                    className={`min-h-11 px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
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

      {/* Portfolio Telemetry Ribbon (48px desktop strip matching Engraving v2.0 ISO 11064-5 ribbon) */}
      <section
        id="events_portfolio_telemetry"
        aria-label="Portfolio telemetry summary"
        className="shrink-0 border border-[var(--border-default)] lg:border-x-0 lg:border-t-0 rounded-2xl lg:rounded-none bg-[var(--surface-card)] mb-4 lg:mb-0 lg:h-12 px-3 sm:px-4 py-2 lg:py-0 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 lg:overflow-x-auto"
      >
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5 sm:gap-2 min-w-0">
          {telemetryPills.map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                aria-pressed={active}
                className={`min-h-11 lg:min-h-0 lg:h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-[var(--text-primary)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'
                }`}
              >
                <span className="font-normal">{item.label}</span>
                <span className={`font-mono font-semibold tabular-nums ${item.accentClass}`}>
                  <AnimatedMetricValue
                    value={item.value}
                    loading={racesLoading && races.length === 0}
                    format={formatCountPH}
                    skeletonWidthClass="w-6"
                    skeletonHeightClass="h-3.5"
                  />
                </span>
              </button>
            );
          })}

          <span
            className="hidden lg:block h-4 w-px bg-[var(--border-subtle)] mx-1 shrink-0"
            aria-hidden="true"
          />

          <div className="min-h-11 lg:min-h-0 lg:h-8 px-2.5 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
            <Users2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span className="text-[var(--text-secondary)]">Total Runners</span>
            <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
              {canViewRoster ? (
                <AnimatedMetricValue
                  value={portfolioStats.totalRunners}
                  loading={(racesLoading && races.length === 0) || (runnersLoading && settledRaceIds.size === 0)}
                  format={formatCountPH}
                  skeletonWidthClass="w-10"
                  skeletonHeightClass="h-3.5"
                />
              ) : 'Restricted'}
            </span>
          </div>

          <div className="min-h-11 lg:min-h-0 lg:h-8 px-2.5 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
            <Coins className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="text-[var(--text-secondary)]">Est. Gross</span>
            <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {canViewRoster && canViewRevenue ? (
                <AnimatedMetricValue
                  value={portfolioStats.totalRevenue}
                  loading={(racesLoading && races.length === 0) || (runnersLoading && settledRaceIds.size === 0)}
                  format={formatCurrencyPH}
                  skeletonWidthClass="w-16"
                  skeletonHeightClass="h-3.5"
                />
              ) : 'Restricted'}
            </span>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-3 shrink-0 text-xs text-[var(--text-secondary)]">
          {runnersLoading && canViewRoster && (
            <span className="inline-flex items-center gap-1.5 font-semibold" role="status" aria-live="polite">
              <ValueSkeleton widthClass="w-8" heightClass="h-2.5" label="Syncing runner counts" />
              <span>Syncing rosters</span>
            </span>
          )}
          {runnersWarning && (
            <span className="text-red-700 dark:text-red-400 font-semibold">{runnersWarning}</span>
          )}
          <span className="font-mono tabular-nums">
            Showing {filteredEvents.length} / {portfolioStats.totalEvents}
          </span>
        </div>
      </section>

      {/* Master-Detail Split Workspace (65% Event Directory Table Left / 35% Event Inspector Dock Right) */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] gap-4 lg:gap-0">
        {/* LEFT MASTER PANE */}
        <section
          aria-label="Race events directory table"
          className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-page)] rounded-2xl lg:rounded-none border border-[var(--border-default)] lg:border-y-0 lg:border-l-0 lg:border-r overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            {racesLoading && races.length === 0 ? (
              <div
                role="status"
                aria-label="Loading race events"
                className="p-4 sm:p-5 space-y-3"
              >
                {[0, 1, 2, 3].map((rowIndex) => (
                  <div
                    key={rowIndex}
                    className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3.5 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <ValueSkeleton widthClass="w-10 shrink-0" heightClass="h-10 rounded-lg" />
                      <div className="space-y-2 min-w-0 flex-1">
                        <ValueSkeleton widthClass="w-44 max-w-full" heightClass="h-4" />
                        <ValueSkeleton widthClass="w-24" heightClass="h-3" />
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-6 shrink-0">
                      <ValueSkeleton widthClass="w-12" heightClass="h-4" />
                      <ValueSkeleton widthClass="w-20" heightClass="h-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : racesError ? (
              <div
                role="alert"
                className="flex flex-col items-center justify-center py-20 px-4 text-center"
              >
                <AlertTriangle
                  className="w-7 h-7 text-red-700 dark:text-red-400 mb-2"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Unable to load race directory
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{racesError}</p>
              </div>
            ) : eventRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <LayoutGrid
                  className="w-8 h-8 text-[var(--text-secondary)] mb-3"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  No race events created yet
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                  Create your first race event in Race Setup to manage timing, medal engraving, and runner registrations.
                </p>
                {canCreateRace && onCreateEvent && (
                  <button
                    type="button"
                    onClick={onCreateEvent}
                    className="mt-4 min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Create First Event</span>
                  </button>
                )}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <Search
                  className="w-8 h-8 text-[var(--text-secondary)] mb-3"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  No matching race events
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                  No events match your current search query or status filter.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                  }}
                  className="mt-4 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                >
                  Reset filters
                </button>
              </div>
            ) : !isDesktop ? (
              /* Mobile / Tablet Compact Directory Cards (< 1024px) */
              <div id="events_cards_list" className="p-3 space-y-3">
                {filteredEvents.map((row) => {
                  const isSelected = selectedEvent?.race.id === row.race.id;
                  return (
                    <div
                      key={row.race.id}
                      onClick={() => selectRace(row.race.id)}
                      className={`rounded-2xl border border-[var(--border-default)] border-l-4 ${
                        isSelected
                          ? 'border-l-red-600 bg-red-500/[0.06] ring-2 ring-red-600/70'
                          : row.completed
                          ? 'border-l-zinc-500 bg-[var(--surface-card)]'
                          : 'border-l-emerald-600 bg-[var(--surface-card)]'
                      } p-4 space-y-3 transition-colors`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                          {row.race.posterImage ? (
                            <img
                              src={row.race.posterImage}
                              alt={`${row.race.name} poster`}
                              width={64}
                              height={44}
                              className="w-16 h-11 object-cover block"
                            />
                          ) : (
                            <Flag className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectRace(row.race.id);
                              }}
                              className="text-left text-base font-display font-semibold text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400"
                            >
                              {row.race.name}
                            </button>
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded-full border text-xs font-semibold ${
                                row.completed
                                  ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                  : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                              }`}
                            >
                              {row.completed ? 'Completed' : 'Upcoming'}
                            </span>
                          </div>
                          <p className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                            {row.race.date}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <div>
                          <span className="text-[var(--text-secondary)]">Registered: </span>
                          <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                            {canViewRoster ? (
                              <AnimatedMetricValue
                                value={row.runnerCount}
                                loading={runnersLoading && !settledRaceIds.has(row.race.id)}
                                format={formatCountPH}
                                skeletonWidthClass="w-10"
                                skeletonHeightClass="h-3.5"
                              />
                            ) : 'Restricted'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-secondary)]">Est. Gross: </span>
                          <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {canViewRoster && canViewRevenue ? (
                              <AnimatedMetricValue
                                value={row.estRevenue}
                                loading={runnersLoading && !settledRaceIds.has(row.race.id)}
                                format={formatCurrencyPH}
                                skeletonWidthClass="w-16"
                                skeletonHeightClass="h-3.5"
                              />
                            ) : 'Restricted'}
                          </span>
                        </div>
                      </div>

                      {row.sortedDistances.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {row.sortedDistances.map((d) => (
                            <span
                              key={d.id}
                              className="px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-xs font-mono font-semibold text-[var(--text-secondary)]"
                            >
                              {d.label}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        {renderInlineActions(row.race, true)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Desktop High-Density Event Directory Table */
              <table id="events_directory_table" className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  <tr>
                    <th
                      className="py-2 pl-4 pr-3"
                      aria-sort={
                        sortKey === 'name'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className="inline-flex items-center hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:underline"
                      >
                        <span>Event</span>
                        {renderSortMarker('name')}
                      </button>
                    </th>
                    <th
                      className="py-2 px-3 w-32"
                      aria-sort={
                        sortKey === 'date'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('date')}
                        className="inline-flex items-center hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:underline"
                      >
                        <span>Date / Status</span>
                        {renderSortMarker('date')}
                      </button>
                    </th>
                    <th
                      className="py-2 px-3 w-24 text-right"
                      aria-sort={
                        sortKey === 'runners'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('runners')}
                        className="inline-flex items-center justify-end ml-auto hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:underline"
                      >
                        <span>Runners</span>
                        {renderSortMarker('runners')}
                      </button>
                    </th>
                    <th
                      className="py-2 px-3 w-28 text-right"
                      aria-sort={
                        sortKey === 'revenue'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('revenue')}
                        className="inline-flex items-center justify-end ml-auto hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:underline"
                      >
                        <span>Est. Gross</span>
                        {renderSortMarker('revenue')}
                      </button>
                    </th>
                    <th className="py-2 pl-2 pr-4 text-right w-56">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                  {filteredEvents.map((row) => {
                    const isSelected = selectedEvent?.race.id === row.race.id;
                    const distSummary = row.sortedDistances.map((d) => d.label).join(' · ');

                    return (
                      <tr
                        key={row.race.id}
                        onClick={() => selectRace(row.race.id)}
                        className={`cursor-pointer border-l-4 transition-colors ${
                          isSelected
                            ? 'border-l-red-600 bg-red-500/[0.08]'
                            : `${
                                row.completed
                                  ? 'border-l-zinc-400 dark:border-l-zinc-600 opacity-85 hover:opacity-100'
                                  : 'border-l-emerald-600 dark:border-l-emerald-500'
                              } hover:bg-[var(--surface-hover)]/65`
                        }`}
                      >
                        <td className="py-2 pl-3 pr-3 align-middle max-w-[260px]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-12 h-8 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                              {row.race.posterImage ? (
                                <img
                                  src={row.race.posterImage}
                                  alt={`${row.race.name} thumbnail`}
                                  width={48}
                                  height={32}
                                  className="w-12 h-8 object-cover block"
                                />
                              ) : (
                                <Flag
                                  className="w-3.5 h-3.5 text-[var(--text-secondary)]"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectRace(row.race.id);
                                }}
                                aria-pressed={isSelected}
                                className="block w-full text-left font-display font-semibold text-sm leading-tight text-[var(--text-primary)] truncate hover:text-red-700 dark:hover:text-red-400 focus-visible:outline-none focus-visible:underline"
                              >
                                {row.race.name}
                              </button>
                              <div className="text-xs text-[var(--text-secondary)] truncate leading-tight mt-0.5">
                                {distSummary || 'No distances configured'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2 px-3 align-middle whitespace-nowrap">
                          <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)] leading-tight">
                            {row.race.date}
                          </div>
                          <span
                            className={`inline-flex items-center mt-0.5 px-1.5 py-px rounded border text-[11px] font-semibold leading-tight ${
                              row.completed
                                ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                            }`}
                          >
                            {row.completed ? 'Completed' : 'Upcoming'}
                          </span>
                        </td>

                        <td className="py-2 px-3 align-middle text-right whitespace-nowrap">
                          <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                            {canViewRoster ? (
                              <AnimatedMetricValue
                                value={row.runnerCount}
                                loading={runnersLoading && !settledRaceIds.has(row.race.id)}
                                format={formatCountPH}
                                skeletonWidthClass="w-10"
                                skeletonHeightClass="h-4"
                              />
                            ) : 'Restricted'}
                          </span>
                        </td>

                        <td className="py-2 px-3 align-middle text-right whitespace-nowrap">
                          <span className="font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {canViewRoster && canViewRevenue ? (
                              <AnimatedMetricValue
                                value={row.estRevenue}
                                loading={runnersLoading && !settledRaceIds.has(row.race.id)}
                                format={formatCurrencyPH}
                                skeletonWidthClass="w-20"
                                skeletonHeightClass="h-4"
                              />
                            ) : 'Restricted'}
                          </span>
                        </td>

                        <td className="py-2 pl-2 pr-4 align-middle text-right whitespace-nowrap">
                          {renderInlineActions(row.race, false)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* RIGHT DETAIL DOCK (35% Width): Event Inspector, Uncropped Poster, Category Breakdown & Launchpad */}
        <aside
          id="event_inspector_dock"
          aria-label="Event inspector dock"
          className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-card)] rounded-2xl lg:rounded-none border lg:border-0 border-[var(--border-default)] overflow-hidden"
        >
          {selectedEvent ? (
            <>
              {/* Pinned Dock Header */}
              <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${
                        selectedEvent.completed
                          ? 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)]'
                          : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                      }`}
                    >
                      {selectedEvent.completed ? 'Completed' : 'Upcoming'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[var(--text-secondary)]">
                      <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      {selectedEvent.race.date}
                    </span>
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                      Reg: {selectedEvent.registrationOpen ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  <h2 className="text-base font-display font-semibold text-[var(--text-primary)] truncate mt-1">
                    {selectedEvent.race.name}
                  </h2>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => stepSelectedEvent(-1)}
                    disabled={filteredEvents.length <= 1}
                    aria-label="Previous event"
                    className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] disabled:opacity-40 flex items-center justify-center text-[var(--text-primary)]"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <span className="px-1.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                    {selectedIndex + 1}/{filteredEvents.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepSelectedEvent(1)}
                    disabled={filteredEvents.length <= 1}
                    aria-label="Next event"
                    className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] disabled:opacity-40 flex items-center justify-center text-[var(--text-primary)]"
                  >
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Scrollable Inspector Body */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {/* Full Uncropped Poster Preview (object-contain prevents top/bottom poster slicing) */}
                <div
                  aria-label="Uncropped event poster preview"
                  className="relative h-56 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center justify-center p-2 overflow-hidden"
                >
                  {selectedEvent.race.posterImage ? (
                    <>
                      <img
                        src={selectedEvent.race.posterImage}
                        alt={`${selectedEvent.race.name} uncropped event poster`}
                        width={640}
                        height={360}
                        className="max-w-full max-h-full w-auto h-auto object-contain rounded"
                      />
                      <button
                        type="button"
                        onClick={() => setPosterLightboxRace(selectedEvent.race)}
                        aria-label={`Inspect full poster for ${selectedEvent.race.name}`}
                        className="absolute top-2 right-2 min-h-11 lg:min-h-0 lg:h-8 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]/95 hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 shadow-sm"
                      >
                        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Full View</span>
                      </button>
                    </>
                  ) : (
                    <div className="text-center px-4">
                      <Flag className="w-6 h-6 text-[var(--text-secondary)] mx-auto mb-1.5" aria-hidden="true" />
                      <p className="text-xs font-semibold text-[var(--text-secondary)]">
                        No promotional poster uploaded for this event.
                      </p>
                      {canEditRace && onOpenSetup && (
                        <button
                          type="button"
                          onClick={() => handleLaunchSetup(selectedEvent.race.id)}
                          className="mt-2 min-h-11 lg:min-h-0 lg:h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                        >
                          Upload Poster in Setup
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Selected Event Financial & Registration KPI Pair */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span>Registered Runners</span>
                      <Users2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                      {canViewRoster ? (
                        <AnimatedMetricValue
                          value={selectedEvent.runnerCount}
                          loading={runnersLoading && !settledRaceIds.has(selectedEvent.race.id)}
                          format={formatCountPH}
                          skeletonWidthClass="w-16"
                          skeletonHeightClass="h-6"
                        />
                      ) : 'Restricted'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span>Est. Gross Revenue</span>
                      <Coins className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {canViewRoster && canViewRevenue ? (
                        <AnimatedMetricValue
                          value={selectedEvent.estRevenue}
                          loading={runnersLoading && !settledRaceIds.has(selectedEvent.race.id)}
                          format={formatCurrencyPH}
                          skeletonWidthClass="w-24"
                          skeletonHeightClass="h-6"
                        />
                      ) : 'Restricted'}
                    </div>
                  </div>
                </div>

                {/* Distance Category Breakdown */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Distance Category Breakdown
                    </h3>
                    <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                      {selectedEvent.distanceBreakdown.length} categories
                    </span>
                  </div>

                  {selectedEvent.distanceBreakdown.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      No distance categories configured yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedEvent.distanceBreakdown.map((item) => {
                        const pct =
                          selectedEvent.runnerCount > 0
                            ? Math.round((item.runnerCount / selectedEvent.runnerCount) * 100)
                            : 0;
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono font-semibold text-[var(--text-primary)]">
                                  {item.label}
                                </span>
                                <span className="font-mono text-[var(--text-secondary)] tabular-nums">
                                  {item.price > 0 ? formatCurrencyPH(item.price) : 'Free'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5 font-mono tabular-nums shrink-0">
                                <span className="font-semibold text-[var(--text-primary)]">
                                  {canViewRoster
                                    ? `${formatCountPH(item.runnerCount)} ${item.runnerCount === 1 ? 'runner' : 'runners'}`
                                    : 'Restricted'}
                                </span>
                                {canViewRoster && canViewRevenue && (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                    {formatCurrencyPH(item.estRevenue)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-red-600 transition-all duration-200"
                                style={{ width: `${canViewRoster ? pct : 0}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {canViewRoster && selectedEvent.unmappedRunnerCount > 0 && (
                        <div className="pt-1 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                          <span>Other / Legacy Distance Labels</span>
                          <span className="font-mono font-semibold tabular-nums">
                            {formatCountPH(selectedEvent.unmappedRunnerCount)}{' '}
                            {selectedEvent.unmappedRunnerCount === 1 ? 'runner' : 'runners'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Operational Specs Readout */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/60 p-3 space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Course &amp; Event Details
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-[var(--text-secondary)]">Checkpoints</dt>
                    <dd className="text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                      {(selectedEvent.race.checkpoints || []).length}
                    </dd>
                    <dt className="text-[var(--text-secondary)]">Entry Formats</dt>
                    <dd className="text-right font-semibold text-[var(--text-primary)] uppercase">
                      {(selectedEvent.race.entryCategories?.length
                        ? selectedEvent.race.entryCategories
                        : ['solo']
                      ).join(', ')}
                    </dd>
                    <dt className="text-[var(--text-secondary)]">Age Brackets</dt>
                    <dd className="text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                      {(selectedEvent.race.ageCategories || []).length}
                    </dd>
                    <dt className="text-[var(--text-secondary)]">Inclusions</dt>
                    <dd className="text-right font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                      {(selectedEvent.race.inclusions || []).length}
                    </dd>
                    <dt className="text-[var(--text-secondary)]">Live Hub</dt>
                    <dd className="text-right font-semibold text-[var(--text-primary)]">
                      {selectedEvent.race.liveBroadcastEnabled ? 'Enabled' : 'Off'}
                    </dd>
                  </dl>
                </div>
              </div>

              {/* Pinned Dock Footer: Direct Module Deep-Link Launchpad */}
              <div className="shrink-0 p-4 border-t border-[var(--border-default)] bg-[var(--surface-inset)]/70 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Module Launchpad
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {canViewTiming && (
                    <button
                      type="button"
                      onClick={() => handleLaunchTiming(selectedEvent.race.id)}
                      className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors col-span-2"
                    >
                      <Timer className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Manage Timing</span>
                      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    </button>
                  )}

                  {canViewEngraving && onOpenEngraving && (
                    <button
                      type="button"
                      onClick={() => handleLaunchEngraving(selectedEvent.race.id)}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Award className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>Engrave Queue</span>
                    </button>
                  )}

                  {canViewRoster && onOpenRunners && (
                    <button
                      type="button"
                      onClick={() => handleLaunchRunners(selectedEvent.race.id)}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Users className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>Runner Roster</span>
                    </button>
                  )}

                  {canEditRace && onOpenSetup && (
                    <button
                      type="button"
                      onClick={() => handleLaunchSetup(selectedEvent.race.id)}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Settings2 className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>Race Setup</span>
                    </button>
                  )}

                  {canViewHub && onOpenLiveHub && (
                    <button
                      type="button"
                      onClick={() => handleLaunchLiveHub(selectedEvent.race.id)}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Tv className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>Live Hub</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <LayoutGrid className="w-8 h-8 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Event Inspector Ready
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                Select any race from the directory table to preview its uncropped poster, category breakdown, and module launchers.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Full-Resolution Uncropped Poster Modal */}
      {posterLightboxRace && posterLightboxRace.posterImage && (
        <DialogSurface
          titleId="poster_lightbox_title"
          onRequestClose={() => setPosterLightboxRace(null)}
          className="fixed inset-0 m-auto h-fit rounded-2xl w-[calc(100%-2rem)] max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-2xl"
        >
          <div className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="poster_lightbox_title"
                  className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
                >
                  {posterLightboxRace.name}
                </h2>
                <p className="text-xs font-mono text-[var(--text-secondary)]">
                  {posterLightboxRace.date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPosterLightboxRace(null)}
                aria-label="Close full poster view"
                className="min-h-11 min-w-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[75vh] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 flex items-center justify-center overflow-hidden">
              <img
                src={posterLightboxRace.posterImage}
                alt={`${posterLightboxRace.name} full poster`}
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
