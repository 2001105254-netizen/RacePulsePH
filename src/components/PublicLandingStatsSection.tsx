import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flag,
  Layers,
  MapPinned,
  RotateCcw,
  ShieldCheck,
  Timer,
  Trophy,
  Users,
} from 'lucide-react';
import {
  formatPacePerKm,
  formatShortDuration,
  type PublicLandingAnalyticsBundle,
  type PublicStatsCategory,
  type PublicStatsEntryFilter,
} from '../lib/publicLandingStats';
import RaceTimeText from './ui/RaceTimeText';
import { Select } from './ui/Select';
import { Button } from './ui/button';
import { CardSkeletonLoader } from './ui/MotionPrimitives';

export interface PublicLandingStatsSectionProps {
  bundle: PublicLandingAnalyticsBundle;
  loadState: 'loading' | 'ready' | 'error';
  resultsLoadState: 'loading' | 'ready' | 'error';
  selectedRaceId: string;
  onSelectRaceId: (raceId: string) => void;
  distanceFilter: string;
  onDistanceFilterChange: (dist: string) => void;
  entryFilter: PublicStatsEntryFilter;
  onEntryFilterChange: (entry: PublicStatsEntryFilter) => void;
  onBrowseRaces: () => void;
  onOpenRaceResults: (raceId: string) => void;
}

const COUNT_FMT = new Intl.NumberFormat('en-PH');
function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return COUNT_FMT.format(n);
}

const STATS_TABS: Array<{ key: PublicStatsCategory; label: string; icon: React.ReactNode }> = [
  { key: 'performance', label: 'Performance', icon: <Activity className="w-4 h-4 shrink-0" aria-hidden="true" /> },
  { key: 'demographics', label: 'Demographics', icon: <Users className="w-4 h-4 shrink-0" aria-hidden="true" /> },
  { key: 'operations', label: 'Operations', icon: <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> },
  { key: 'events', label: 'Events', icon: <Layers className="w-4 h-4 shrink-0" aria-hidden="true" /> },
];

const ENTRY_FORMATS: Array<{ key: PublicStatsEntryFilter; label: string }> = [
  { key: 'all', label: 'All formats' },
  { key: 'solo', label: 'Solo' },
  { key: 'duo', label: 'Duo' },
  { key: 'trio', label: 'Trio' },
  { key: 'group', label: 'Group' },
];

export default function PublicLandingStatsSection({
  bundle,
  loadState,
  resultsLoadState,
  selectedRaceId,
  onSelectRaceId,
  distanceFilter,
  onDistanceFilterChange,
  entryFilter,
  onEntryFilterChange,
  onBrowseRaces,
  onOpenRaceResults,
}: PublicLandingStatsSectionProps) {
  const [activeTab, setActiveTab] = useState<PublicStatsCategory>('performance');
  const [showAllAgeCuts, setShowAllAgeCuts] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const velocityGradId = useId();
  const distanceMatrixCaptionId = useId();
  const portfolioTableCaptionId = useId();

  const { overview, performance, demographics, operations, portfolio } = bundle;
  const hasFilters = selectedRaceId !== 'all' || distanceFilter !== 'all' || entryFilter !== 'all';

  const resetFilters = () => {
    onSelectRaceId('all');
    onDistanceFilterChange('all');
    onEntryFilterChange('all');
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % STATS_TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + STATS_TABS.length) % STATS_TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = STATS_TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = STATS_TABS[nextIndex];
    setActiveTab(nextTab.key);
    const btn = tabRefs.current[nextTab.key];
    btn?.focus();
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const maxFinishBucket = useMemo(
    () => Math.max(...performance.finishBuckets.map((b) => b.count), 1),
    [performance.finishBuckets],
  );

  const velocityChart = useMemo(() => {
    const safe = performance.velocitySeries.length > 1 ? performance.velocitySeries : [0, 0];
    const width = 360;
    const height = 88;
    const max = Math.max(...safe, 1);
    const stepX = width / (safe.length - 1);
    const pts = safe.map((val, idx) => ({
      x: +(idx * stepX).toFixed(1),
      y: +(height - (val / max) * (height - 16) - 6).toFixed(1),
    }));
    const line = `M ${pts.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    return {
      line,
      area: `${line} L ${width},${height} L 0,${height} Z`,
      last: pts[pts.length - 1] ?? { x: width, y: height - 6 },
    };
  }, [performance.velocitySeries]);

  const visibleAgeCuts = showAllAgeCuts ? demographics.ageCuts : demographics.ageCuts.slice(0, 8);
  const timingMethodTotal = overview.chipCount + overview.gunCount + overview.transitionCount;
  const isInitialLoading = loadState === 'loading' || (resultsLoadState === 'loading' && overview.totalRegistered === 0 && overview.totalFinished === 0);

  return (
    <section
      id="runner-statistics"
      tabIndex={-1}
      className="landing-stats-section space-y-4 pt-6 border-t border-[var(--border-default)] scroll-mt-[84px]"
      aria-labelledby="stats-section-heading"
    >
      {/* Header & Scope Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h2 id="stats-section-heading" className="type-section text-[var(--text-primary)] inline-flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Runner &amp; race statistics</span>
          </h2>
          <p className="type-lead text-[var(--text-secondary)]">
            Performance benchmarks, age divisions, demographics, race-day readiness, and event totals across RacePulsePH.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {bundle.availableRaces.length > 0 && (
            <div className="w-full sm:w-64">
              <label htmlFor="landing-stats-race-select" className="sr-only">
                Filter statistics by race event
              </label>
              <Select
                id="landing-stats-race-select"
                value={selectedRaceId}
                onChange={onSelectRaceId}
                searchable={bundle.availableRaces.length >= 6}
                searchPlaceholder="Filter events..."
                surface="inset"
                size="md"
                options={[
                  { value: 'all', label: `All events (${bundle.availableRaces.length})` },
                  ...bundle.availableRaces.map((r) => ({
                    value: r.id,
                    label: `${r.name} (${r.date})`,
                  })),
                ]}
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="default"
            className="min-h-11 px-4 shrink-0"
            onClick={onBrowseRaces}
          >
            Browse race results
          </Button>
        </div>
      </div>

      {/* Distance & Entry Format Filter Strip */}
      {loadState === 'ready' && bundle.availableDistances.length > 0 && (
        <div className="landing-stats-filter-bar">
          <div className="landing-stats-chip-group" role="group" aria-label="Filter statistics by base distance">
            <span className="text-xs font-semibold text-[var(--text-secondary)] mr-1">Distance:</span>
            <button
              type="button"
              aria-pressed={distanceFilter === 'all'}
              onClick={() => onDistanceFilterChange('all')}
              className={`landing-distance ${distanceFilter === 'all' ? 'is-active' : ''}`}
            >
              All
            </button>
            {bundle.availableDistances.map((dist) => (
              <button
                key={dist}
                type="button"
                aria-pressed={distanceFilter === dist}
                onClick={() => onDistanceFilterChange(distanceFilter === dist ? 'all' : dist)}
                className={`landing-distance ${distanceFilter === dist ? 'is-active' : ''}`}
              >
                {dist}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="landing-stats-chip-group" role="group" aria-label="Filter statistics by entry format">
              {ENTRY_FORMATS.map((fmt) => (
                <button
                  key={fmt.key}
                  type="button"
                  aria-pressed={entryFilter === fmt.key}
                  onClick={() => onEntryFilterChange(fmt.key)}
                  className={`min-h-11 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                    entryFilter === fmt.key
                      ? 'border-red-700 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 hover:border-red-600/50"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading / Error / Empty / Active States (R-27) */}
      {loadState === 'error' ? (
        <div className="rounded-2xl border border-red-700/35 bg-[var(--surface-card)] p-6 text-center space-y-3" role="alert">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Unable to load race statistics right now.
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            Reload the page to reconnect to published RacePulsePH event records.
          </p>
          <Button type="button" variant="outline" className="min-h-11 px-5" onClick={() => window.location.reload()}>
            Reload statistics
          </Button>
        </div>
      ) : isInitialLoading ? (
        <CardSkeletonLoader label="Loading runner and race statistics" />
      ) : bundle.overview.totalEvents === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-2">
          <Flag className="w-7 h-7 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
          <p className="text-base font-semibold text-[var(--text-primary)]">No published race statistics yet</p>
          <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
            Statistics appear automatically once organizers publish events, distance schedules, and official finisher results.
          </p>
        </div>
      ) : (
        <>
          {/* Overview KPI Strip (5 Non-Financial Telemetry Cells) */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <div className="landing-stat-kpi">
              <div className="landing-stat-kpi-label">Events Tracked</div>
              <div className="landing-stat-kpi-value">{fmtCount(overview.totalEvents)}</div>
              <div className="landing-stat-kpi-sub">
                {overview.liveEvents > 0
                  ? `${overview.liveEvents} live · ${overview.upcomingEvents} upcoming · ${overview.completedEvents} done`
                  : `${overview.upcomingEvents} upcoming · ${overview.completedEvents} completed`}
              </div>
            </div>

            <div className="landing-stat-kpi">
              <div className="landing-stat-kpi-label">Registered &amp; Headcount</div>
              <div className="landing-stat-kpi-value">
                {overview.totalRegistered > 0 ? fmtCount(overview.totalRegistered) : '--'}
              </div>
              <div className="landing-stat-kpi-sub">
                {overview.totalHeadcount > overview.totalRegistered
                  ? `${fmtCount(overview.totalHeadcount)} runners on course`
                  : overview.recent7dRunners !== null
                  ? `+${fmtCount(overview.recent7dRunners)} in last 7d`
                  : `${fmtCount(overview.totalStarted)} started`}
              </div>
            </div>

            <div className="landing-stat-kpi">
              <div className="landing-stat-kpi-label">Official Finishers</div>
              <div className="landing-stat-kpi-value text-emerald-700 dark:text-emerald-400">
                {fmtCount(overview.totalFinished)}
              </div>
              <div className="landing-stat-kpi-sub">
                {overview.finishRatePct !== null
                  ? `${overview.finishRatePct}% finish rate · ${fmtCount(overview.dnsCount)} DNS`
                  : 'Awaiting starts'}
              </div>
            </div>

            <div className="landing-stat-kpi min-w-0">
              <div className="landing-stat-kpi-label">Fastest &amp; Median</div>
              <div className="landing-stat-kpi-value text-red-700 dark:text-red-400 whitespace-nowrap">
                <RaceTimeText
                  value={overview.fastestSeconds !== undefined ? formatShortDuration(overview.fastestSeconds) : ''}
                  fallback="--:--:--"
                />
              </div>
              <div className="landing-stat-kpi-sub">
                {overview.medianSeconds !== undefined
                  ? `Med ${formatShortDuration(overview.medianSeconds)} · P90 ${formatShortDuration(overview.p90Seconds)}`
                  : 'No finishes recorded'}
              </div>
            </div>

            <div className="landing-stat-kpi col-span-2 md:col-span-1">
              <div className="landing-stat-kpi-label">Timing &amp; Pace Mix</div>
              <div className="landing-stat-kpi-value">
                {timingMethodTotal > 0 ? `${overview.chipPct}% chip` : '--'}
              </div>
              <div className="landing-stat-kpi-sub">
                {timingMethodTotal > 0
                  ? `${fmtCount(overview.chipCount)} chip · ${fmtCount(overview.gunCount)} gun${
                      overview.avgPaceSecPerKm ? ` · ${formatPacePerKm(overview.avgPaceSecPerKm, 1)}` : ''
                    }`
                  : 'Awaiting timing splits'}
              </div>
            </div>
          </div>

          {/* Tabbed Non-Financial Analytics Container (modern-web-guidance: tabs) */}
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
            <div className="border-b border-[var(--border-default)] bg-[var(--surface-inset)] px-3 sm:px-4 flex flex-wrap items-center justify-between gap-2">
              <div
                role="tablist"
                aria-label="Statistics categories"
                className="landing-stats-tablist"
              >
                {STATS_TABS.map((item, idx) => {
                  const selected = activeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      ref={(el) => {
                        tabRefs.current[item.key] = el;
                      }}
                      id={`stats-tab-${item.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTab(item.key)}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                      className="landing-stats-tab"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="hidden sm:flex items-center gap-3 py-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                <span>
                  {bundle.scope === 'event' && bundle.selectedRace
                    ? bundle.selectedRace.name
                    : 'All published events'}
                </span>
                {distanceFilter !== 'all' && <span className="text-red-700 dark:text-red-400 font-semibold">{distanceFilter}</span>}
                {entryFilter !== 'all' && <span className="capitalize font-semibold">{entryFilter}</span>}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {/* TAB 1: PERFORMANCE */}
              <div
                role="tabpanel"
                id="stats-panel-performance"
                aria-labelledby="stats-tab-performance"
                hidden={activeTab !== 'performance'}
                tabIndex={activeTab === 'performance' ? 0 : undefined}
              >
                {activeTab === 'performance' && (
                  <div className="space-y-5">
                    {/* Course Progression Funnel + Finish Wave / Velocity Chart */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      <div className="lg:col-span-5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Course progression funnel</h3>
                          <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                            {overview.finishRatePct !== null ? `${overview.finishRatePct}% finished` : 'Pre-race'}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {performance.funnel.map((stage) => {
                            const barClass =
                              stage.tone === 'red'
                                ? 'bg-red-600 dark:bg-red-500'
                                : stage.tone === 'emerald'
                                ? 'bg-emerald-700 dark:bg-emerald-500'
                                : 'bg-zinc-600 dark:bg-zinc-400';
                            return (
                              <div key={stage.id} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-semibold text-[var(--text-primary)]">{stage.label}</span>
                                  <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                                    <span className="text-[var(--text-primary)] font-semibold">{fmtCount(stage.count)}</span>{' '}
                                    ({stage.pct}%) · {stage.detail}
                                  </span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${barClass}`}
                                    style={{ width: `${Math.max(stage.count > 0 ? 4 : 0, Math.min(100, stage.pct))}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                          <div>
                            <div className="text-[var(--text-secondary)]">Chip</div>
                            <div className="font-semibold text-[var(--text-primary)]">{fmtCount(overview.chipCount)}</div>
                          </div>
                          <div>
                            <div className="text-[var(--text-secondary)]">Gun</div>
                            <div className="font-semibold text-[var(--text-primary)]">{fmtCount(overview.gunCount)}</div>
                          </div>
                          <div>
                            <div className="text-[var(--text-secondary)]">Relay</div>
                            <div className="font-semibold text-[var(--text-primary)]">{fmtCount(overview.transitionCount)}</div>
                          </div>
                        </div>
                      </div>

                      <figure className="lg:col-span-7 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex flex-col justify-between gap-3 m-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                            {performance.finishBuckets.length > 0
                              ? 'Finish chute arrival wave'
                              : performance.hasVelocitySeries
                              ? 'Registration momentum (14-day window)'
                              : 'Finish wave & pace curve'}
                          </h3>
                          <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {performance.finishBuckets.length > 0
                              ? `Peak ${performance.peakBucketLabel} (${fmtCount(performance.peakBucketCount)})`
                              : overview.recent7dRunners !== null
                              ? `+${fmtCount(overview.recent7dRunners)} in 7d`
                              : 'Awaiting start wave'}
                          </span>
                        </div>

                        {performance.finishBuckets.length > 0 ? (
                          <>
                            <svg
                              viewBox="0 0 360 92"
                              className="h-28 w-full overflow-visible"
                              preserveAspectRatio="none"
                              role="img"
                              aria-label={`Finish chute histogram peaking at ${performance.peakBucketLabel} with ${performance.peakBucketCount} finishers`}
                            >
                              {performance.finishBuckets.map((bucket, idx) => {
                                const slotWidth = 360 / performance.finishBuckets.length;
                                const barW = Math.max(4, slotWidth - 4);
                                const x = idx * slotWidth + 2;
                                const h = bucket.count > 0 ? Math.max(6, (bucket.count / maxFinishBucket) * 76) : 3;
                                const isPeak = bucket.label === performance.peakBucketLabel && bucket.count > 0;
                                return (
                                  <rect
                                    key={bucket.label}
                                    x={x}
                                    y={84 - h}
                                    width={barW}
                                    height={h}
                                    rx="3"
                                    fill={isPeak ? '#cc251c' : bucket.count > 0 ? '#047857' : '#71717a'}
                                    fillOpacity={bucket.count > 0 ? 0.9 : 0.25}
                                  />
                                );
                              })}
                            </svg>
                            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                              <span>First wave {performance.finishBuckets[0]?.label}</span>
                              <span>
                                Med {formatShortDuration(overview.medianSeconds)} · P90 {formatShortDuration(overview.p90Seconds)}
                              </span>
                              <span>
                                Last {performance.finishBuckets[performance.finishBuckets.length - 1]?.label}
                              </span>
                            </figcaption>
                          </>
                        ) : performance.hasVelocitySeries ? (
                          <>
                            <svg
                              viewBox="0 0 360 88"
                              className="h-24 w-full overflow-visible"
                              preserveAspectRatio="none"
                              role="img"
                              aria-label="Cumulative registration curve across the last 14 days"
                            >
                              <defs>
                                <linearGradient id={velocityGradId} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#047857" stopOpacity="0.32" />
                                  <stop offset="100%" stopColor="#047857" stopOpacity="0.02" />
                                </linearGradient>
                              </defs>
                              <path d={velocityChart.area} fill={`url(#${velocityGradId})`} />
                              <path d={velocityChart.line} fill="none" stroke="#047857" strokeWidth="2" strokeLinecap="round" />
                              <circle cx={velocityChart.last.x} cy={velocityChart.last.y} r="3" fill="#047857" />
                            </svg>
                            <figcaption className="flex items-center justify-between text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                              <span>{performance.velocityLabels[0] || 'Start'}</span>
                              <span>{performance.velocityLabels[1] || 'Mid'}</span>
                              <span>{performance.velocityLabels[2] || 'Latest'}</span>
                            </figcaption>
                          </>
                        ) : (
                          <figcaption className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-card)] p-4 text-xs text-[var(--text-secondary)]">
                            Finish arrival waves appear once the race starts and official finish scans are published.
                          </figcaption>
                        )}
                      </figure>
                    </div>

                    {/* Distance Performance Matrix (Responsive Table on sm+, Stacked Cards on phone) */}
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] overflow-hidden">
                      <div className="px-4 py-3 border-b border-[var(--border-default)] flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-card)]">
                        <div className="flex items-center gap-2">
                          <Flag className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                          <h3 id={distanceMatrixCaptionId} className="text-sm font-semibold text-[var(--text-primary)]">
                            Distance performance matrix
                          </h3>
                        </div>
                        <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                          {performance.byDistance.length} {performance.byDistance.length === 1 ? 'distance' : 'distances'} · click row to filter
                        </span>
                      </div>

                      {performance.byDistance.length === 0 ? (
                        <p className="p-4 text-xs text-[var(--text-secondary)]">No distance records match the active filter.</p>
                      ) : (
                        <>
                          <div
                            tabIndex={0}
                            role="region"
                            aria-labelledby={distanceMatrixCaptionId}
                            className="hidden sm:block overflow-x-auto"
                          >
                            <table className="w-full text-left border-collapse">
                              <caption className="sr-only">
                                Non-financial runner participation and finish time benchmarks grouped by base race distance
                              </caption>
                              <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold text-[var(--text-secondary)]">
                                <tr>
                                  <th scope="col" className="py-2.5 px-3">Distance</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Events</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Finishers</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Rate</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Fastest</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Median (P50)</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">P90</th>
                                  <th scope="col" className="py-2.5 px-2 text-right">Avg pace</th>
                                  <th scope="col" className="py-2.5 px-3 text-right">Timing</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-subtle)] text-xs font-mono tabular-nums bg-[var(--surface-card)]">
                                {performance.byDistance.map((row) => {
                                  const isFocused = distanceFilter === row.label;
                                  return (
                                    <tr
                                      key={row.label}
                                      className={`transition-colors ${
                                        isFocused ? 'bg-red-500/10' : 'hover:bg-[var(--surface-inset)]'
                                      }`}
                                    >
                                      <th scope="row" className="py-2.5 px-3 font-sans text-sm font-semibold text-[var(--text-primary)]">
                                        <button
                                          type="button"
                                          onClick={() => onDistanceFilterChange(isFocused ? 'all' : row.label)}
                                          aria-pressed={isFocused}
                                          className="inline-flex items-center gap-2 text-left min-h-11 px-1 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                                        >
                                          <span className="font-mono">{row.label}</span>
                                          {row.km > 0 && (
                                            <span className="text-xs font-normal text-[var(--text-secondary)]">({row.km} km)</span>
                                          )}
                                        </button>
                                      </th>
                                      <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">{fmtCount(row.raceCount)}</td>
                                      <td className="py-2.5 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                                        {row.finished > 0 ? fmtCount(row.finished) : row.registered > 0 ? `${fmtCount(row.registered)} reg` : 'Upcoming'}
                                      </td>
                                      <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">
                                        {row.finishRatePct !== null ? `${row.finishRatePct}%` : '--'}
                                      </td>
                                      <td className="py-2.5 px-2 text-right text-emerald-700 dark:text-emerald-400">
                                        {formatShortDuration(row.fastestSeconds)}
                                      </td>
                                      <td className="py-2.5 px-2 text-right font-semibold text-[var(--text-primary)]">
                                        {formatShortDuration(row.medianSeconds)}
                                      </td>
                                      <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">
                                        {formatShortDuration(row.p90Seconds)}
                                      </td>
                                      <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">
                                        {formatPacePerKm(row.avgPaceSecPerKm, 1)}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">
                                        {row.finished > 0 ? `${row.chipTimed}c / ${row.gunTimed}g` : '--'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Mobile Stacked Cards */}
                          <div className="sm:hidden divide-y divide-[var(--border-subtle)] bg-[var(--surface-card)]">
                            {performance.byDistance.map((row) => {
                              const isFocused = distanceFilter === row.label;
                              return (
                                <div key={row.label} className="p-3 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => onDistanceFilterChange(isFocused ? 'all' : row.label)}
                                      aria-pressed={isFocused}
                                      className={`min-h-11 px-3 rounded-lg border font-mono text-xs font-semibold inline-flex items-center gap-2 ${
                                        isFocused
                                          ? 'border-red-700 bg-red-700 text-white'
                                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                                      }`}
                                    >
                                      <span>{row.label}</span>
                                      <span className="font-normal opacity-80">{row.raceCount} {row.raceCount === 1 ? 'race' : 'races'}</span>
                                    </button>
                                    <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                      {row.finished > 0
                                        ? `${fmtCount(row.finished)} finishers`
                                        : row.registered > 0
                                        ? `${fmtCount(row.registered)} reg`
                                        : 'Upcoming'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                                    <div>
                                      Best <span className="block text-[var(--text-primary)] font-semibold">{formatShortDuration(row.fastestSeconds)}</span>
                                    </div>
                                    <div>
                                      Med <span className="block text-[var(--text-primary)] font-semibold">{formatShortDuration(row.medianSeconds)}</span>
                                    </div>
                                    <div>
                                      Pace <span className="block text-[var(--text-primary)] font-semibold">{formatPacePerKm(row.avgPaceSecPerKm, 1)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Gender Pace & Timing Health + Checkpoints & Podium Finishers */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Gender pace &amp; timing health</h3>
                          <span className="font-mono text-xs text-[var(--text-secondary)]">
                            {performance.genderSource === 'roster'
                              ? 'Roster & finishers'
                              : performance.genderSource === 'finishers'
                              ? 'Published division finishers'
                              : 'Awaiting divisions'}
                          </span>
                        </div>

                        {performance.byGender.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {performance.byGender.map((g) => (
                              <div
                                key={g.id}
                                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-[var(--text-primary)]">{g.label}</span>
                                  <span className="font-mono text-xs font-semibold text-red-700 dark:text-red-400">
                                    {g.sharePct}%
                                  </span>
                                </div>
                                <div className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                                  {g.registered > 0
                                    ? `${fmtCount(g.finished)} / ${fmtCount(g.registered)} finished`
                                    : `${fmtCount(g.finished)} finishers`}
                                </div>
                                <div className="text-xs font-mono text-[var(--text-primary)] tabular-nums">
                                  Best {formatShortDuration(g.fastestSeconds)}
                                </div>
                                <div className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                                  Med {formatShortDuration(g.medianSeconds)} · {formatPacePerKm(g.avgPaceSecPerKm, 1)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Gender pace comparisons populate once division results or roster stats publish.
                          </p>
                        )}

                        <div className="pt-3 border-t border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                          <div>
                            <span className="text-[var(--text-secondary)] block">Wave starts</span>
                            <strong className="text-[var(--text-primary)]">
                              {performance.timingHealth.waveStartsConfigured}/{performance.timingHealth.waveStartsTotal}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--text-secondary)] block">RFID share</span>
                            <strong className="text-[var(--text-primary)]">
                              {performance.timingHealth.rfidSharePct !== null
                                ? `${performance.timingHealth.rfidSharePct}% (${fmtCount(performance.timingHealth.rfidReads)})`
                                : 'Roster sync'}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--text-secondary)] block">Close reviews</span>
                            <strong className="text-[var(--text-primary)]">
                              {fmtCount(performance.timingHealth.reviewFlagged)}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--text-secondary)] block">Missing start</span>
                            <strong className="text-[var(--text-primary)]">
                              {fmtCount(performance.timingHealth.missingStart)}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--text-secondary)] block">Missing splits</span>
                            <strong className="text-[var(--text-primary)]">
                              {fmtCount(performance.timingHealth.missingIntermediate)}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--text-secondary)] block">Disqualified</span>
                            <strong className="text-red-700 dark:text-red-400">
                              {fmtCount(performance.timingHealth.dqCount)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                            <Trophy className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                            <span>
                              {performance.checkpoints.length > 0
                                ? 'Checkpoints & division leaders'
                                : 'Top division leaders & awards'}
                            </span>
                          </h3>
                          <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                            {fmtCount(performance.topFinishers.length)} podiums
                          </span>
                        </div>

                        {performance.checkpoints.length > 0 && (
                          <div className="space-y-2 pb-2 border-b border-[var(--border-subtle)]">
                            {performance.checkpoints.map((cp) => (
                              <div key={cp.id} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-semibold text-[var(--text-primary)] truncate">
                                    {cp.label}{' '}
                                    <span className="font-normal text-[var(--text-secondary)]">
                                      ({cp.type}{cp.cutoffMinutes ? `, ${cp.cutoffMinutes}m cutoff` : ''})
                                    </span>
                                  </span>
                                  <span className="font-mono tabular-nums text-[var(--text-secondary)] shrink-0">
                                    {cp.hasScanCounts
                                      ? `${fmtCount(cp.uniqueBibs)} bibs (${cp.pctOfRegistered ?? 0}%)`
                                      : 'Configured'}
                                  </span>
                                </div>
                                {cp.hasScanCounts && cp.pctOfRegistered !== null && (
                                  <div className="h-1.5 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500"
                                      style={{ width: `${Math.max(cp.uniqueBibs > 0 ? 4 : 0, Math.min(100, cp.pctOfRegistered))}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {performance.topFinishers.length > 0 ? (
                          <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]">
                            {performance.topFinishers.slice(0, 4).map((fin) => (
                              <li key={fin.key} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <div className="font-semibold text-[var(--text-primary)] truncate">
                                    #{fin.overallRank} {fin.displayName}
                                  </div>
                                  <div className="font-mono text-[var(--text-secondary)] truncate">
                                    {fin.distance} · Bib {fin.bibNumber} · {fin.paceLabel}
                                  </div>
                                </div>
                                <div className="text-right font-mono tabular-nums shrink-0">
                                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    <RaceTimeText value={fin.finishTime} />
                                  </div>
                                  <div className="text-[var(--text-secondary)] uppercase">{fin.timingMethod}</div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Division leaders will list here once official results publish.
                          </p>
                        )}

                        {performance.specialAwards.length > 0 && (
                          <div className="pt-1 space-y-1.5">
                            <div className="text-xs font-semibold text-[var(--text-secondary)]">
                              Special age recognition ({performance.specialAwards.length})
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {performance.specialAwards.slice(0, 4).map((awd) => (
                                <div
                                  key={awd.key}
                                  className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[var(--text-primary)] truncate">{awd.displayName}</div>
                                    <div className="text-emerald-700 dark:text-emerald-400 truncate">
                                      {awd.awards.join(' / ')}
                                    </div>
                                  </div>
                                  <span className="font-mono text-[var(--text-secondary)] shrink-0">{awd.distance}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* TAB 2: DEMOGRAPHICS */}
              <div
                role="tabpanel"
                id="stats-panel-demographics"
                aria-labelledby="stats-tab-demographics"
                hidden={activeTab !== 'demographics'}
                tabIndex={activeTab === 'demographics' ? 0 : undefined}
              >
                {activeTab === 'demographics' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Gender Split & By Distance */}
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Gender distribution</h3>
                          <span className="font-mono text-xs text-[var(--text-secondary)]">
                            {demographics.genderSource === 'roster'
                              ? 'Full registered field'
                              : demographics.genderSource === 'finishers'
                              ? 'Published division finishers'
                              : 'Pending data'}
                          </span>
                        </div>

                        {demographics.genderSplit.length > 0 ? (
                          <>
                            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                              {demographics.genderSplit.map((g) => (
                                <span key={g.id} className="text-[var(--text-primary)]">
                                  <strong>{g.label}</strong>{' '}
                                  {fmtCount(g.registered > 0 ? g.registered : g.finished)} ({g.sharePct}%)
                                </span>
                              ))}
                            </div>
                            <div
                              className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--surface-card)]"
                              role="img"
                              aria-label={demographics.genderSplit.map((g) => `${g.label} ${g.sharePct}%`).join(', ')}
                            >
                              {demographics.genderSplit.map((g) => (
                                <div
                                  key={g.id}
                                  style={{ width: `${g.sharePct}%` }}
                                  className={g.id === 'male' ? 'bg-zinc-700 dark:bg-zinc-300' : 'bg-red-700 dark:bg-red-400'}
                                />
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">No gender cohort records available for this filter.</p>
                        )}

                        {demographics.genderByDistance.length > 0 && (
                          <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                            <div className="text-xs font-semibold text-[var(--text-secondary)]">Split by base distance</div>
                            {demographics.genderByDistance.map((row) => (
                              <div key={row.distanceLabel} className="space-y-1">
                                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                                  <span className="font-semibold text-[var(--text-primary)]">{row.distanceLabel}</span>
                                  <span className="text-[var(--text-secondary)]">
                                    M {fmtCount(row.maleCount)} ({row.malePct}%) · F {fmtCount(row.femaleCount)} ({row.femalePct}%)
                                  </span>
                                </div>
                                <div className="flex h-2 w-full rounded-full overflow-hidden bg-[var(--surface-card)]">
                                  <div style={{ width: `${row.malePct}%` }} className="bg-zinc-700 dark:bg-zinc-300" />
                                  <div style={{ width: `${row.femalePct}%` }} className="bg-red-700 dark:bg-red-400" />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Entry Formats & Age Summary */}
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-4">
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Entry formats &amp; headcount</h3>
                            <span className="font-mono text-xs text-[var(--text-secondary)]">
                              {fmtCount(overview.totalHeadcount)} runners
                            </span>
                          </div>

                          {demographics.entryFormats.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                              {demographics.entryFormats.map((fmt) => (
                                <div
                                  key={fmt.category}
                                  className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5"
                                >
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-[var(--text-primary)]">{fmt.label}</span>
                                    <span className="font-mono text-[var(--text-secondary)]">{fmt.sharePct}%</span>
                                  </div>
                                  <div className="mt-1 font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                                    <strong className="text-[var(--text-primary)]">{fmtCount(fmt.entriesCount)}</strong>{' '}
                                    {fmt.entriesCount === 1 ? 'entry' : 'entries'} ({fmtCount(fmt.headcount)} heads)
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--text-secondary)]">
                              Entry format counts appear once registrations or official finishers are published.
                            </p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Age summary</h3>
                            <span className="font-mono text-xs text-[var(--text-secondary)]">
                              {demographics.ageSummary.hasRosterAgeSummary
                                ? `${fmtCount(demographics.ageSummary.knownAgeCount)} verified ages`
                                : 'Age brackets active'}
                            </span>
                          </div>

                          {demographics.ageSummary.hasRosterAgeSummary ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                                <div className="text-xs text-[var(--text-secondary)]">Median</div>
                                <div className="font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                                  {demographics.ageSummary.medianAge !== null ? `${demographics.ageSummary.medianAge}y` : '--'}
                                </div>
                              </div>
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                                <div className="text-xs text-[var(--text-secondary)]">Span</div>
                                <div className="font-mono text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                                  {demographics.ageSummary.minAge !== null && demographics.ageSummary.maxAge !== null
                                    ? `${demographics.ageSummary.minAge}-${demographics.ageSummary.maxAge}`
                                    : '--'}
                                </div>
                              </div>
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                                <div className="text-xs text-[var(--text-secondary)]">Under 18</div>
                                <div className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  {fmtCount(demographics.ageSummary.youthUnder18)}
                                </div>
                              </div>
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                                <div className="text-xs text-[var(--text-secondary)]">50+ Masters</div>
                                <div className="font-mono text-sm font-semibold text-red-700 dark:text-red-400 tabular-nums">
                                  {fmtCount(demographics.ageSummary.masters50Plus)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--text-secondary)]">
                              Numeric median, min/max, Under-18, and 50+ counts populate automatically as organizers sync race rosters.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Age Cuts & Category Divisions */}
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Age cuts &amp; category divisions
                        </h3>
                        <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                          {demographics.ageCuts.length > 0
                            ? `${demographics.ageCuts.length} active divisions`
                            : `${demographics.configuredDivisions.length} configured`}
                        </span>
                      </div>

                      {demographics.ageCuts.length > 0 ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {visibleAgeCuts.map((cut) => (
                              <div
                                key={cut.id}
                                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-semibold text-[var(--text-primary)] truncate">{cut.label}</span>
                                  <div className="flex items-center gap-2 font-mono tabular-nums shrink-0 text-[var(--text-secondary)]">
                                    {cut.fastestSeconds !== undefined && (
                                      <span className="text-emerald-700 dark:text-emerald-400">
                                        Best {formatShortDuration(cut.fastestSeconds)}
                                      </span>
                                    )}
                                    <span className="font-semibold text-[var(--text-primary)]">
                                      {fmtCount(cut.count)} ({cut.pct}%)
                                    </span>
                                  </div>
                                </div>
                                <div className="h-2 w-full rounded-full bg-[var(--surface-inset)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500"
                                    style={{ width: `${Math.max(4, Math.min(100, cut.pct))}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>

                          {demographics.ageCuts.length > 8 && (
                            <div className="pt-1">
                              <button
                                type="button"
                                aria-expanded={showAllAgeCuts}
                                onClick={() => setShowAllAgeCuts((prev) => !prev)}
                                className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600/50 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"
                              >
                                {showAllAgeCuts ? (
                                  <>
                                    <ChevronUp className="w-4 h-4" aria-hidden="true" />
                                    <span>Show fewer divisions</span>
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                                    <span>Show all {demographics.ageCuts.length} divisions</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </>
                      ) : demographics.configuredDivisions.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {demographics.configuredDivisions.map((div) => (
                            <span
                              key={`${div.label}_${div.minAge}_${div.maxAge}_${div.gender}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
                            >
                              <span className="font-semibold">{div.label}</span>
                              <span className="text-[var(--text-secondary)]">
                                {div.minAge}-{div.maxAge}y ({div.gender === 'male' ? 'M' : 'F'})
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-secondary)]">
                          Age-cut splits populate once events publish category results or age brackets.
                        </p>
                      )}
                    </div>

                    {/* Shirt Size Inventory & Safety Compliance (Non-Financial) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Apparel &amp; shirt sizes</h3>
                        {demographics.shirtInventory.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {demographics.shirtInventory.map((sz) => (
                              <div
                                key={sz.size}
                                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs font-mono tabular-nums"
                              >
                                <div className="font-semibold text-[var(--text-primary)]">{sz.size}</div>
                                <div className="text-[var(--text-secondary)]">
                                  {fmtCount(sz.claimedCount)}/{fmtCount(sz.orderedCount)} claimed ({sz.claimRatePct}%)
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Shirt size totals appear once organizers publish roster apparel aggregates.
                          </p>
                        )}
                      </div>

                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Safety &amp; profile readiness</h3>
                        {demographics.compliance.hasRosterCompliance ? (
                          <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                              <div className="text-[var(--text-secondary)]">Emergency contact</div>
                              <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                                {demographics.compliance.emergencyContactPct}%
                              </div>
                            </div>
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                              <div className="text-[var(--text-secondary)]">Shirt size logged</div>
                              <div className="font-semibold text-[var(--text-primary)]">
                                {demographics.compliance.shirtSizePct}%
                              </div>
                            </div>
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                              <div className="text-[var(--text-secondary)]">Under-13 consent</div>
                              <div className="font-semibold text-[var(--text-primary)]">
                                {fmtCount(demographics.compliance.under13ConsentCount)}/{fmtCount(demographics.compliance.under13Count)}
                              </div>
                            </div>
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                              <div className="text-[var(--text-secondary)]">Updates opt-in</div>
                              <div className="font-semibold text-[var(--text-primary)]">
                                {demographics.compliance.marketingOptInPct}%
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Aggregate safety readiness percentages appear here once an event publishes roster compliance totals.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* TAB 3: OPERATIONS & READINESS */}
              <div
                role="tabpanel"
                id="stats-panel-operations"
                aria-labelledby="stats-tab-operations"
                hidden={activeTab !== 'operations'}
                tabIndex={activeTab === 'operations' ? 0 : undefined}
              >
                {activeTab === 'operations' && (
                  <div className="space-y-5">
                    {/* Readiness Progress Bars */}
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Race-day readiness indicators</h3>
                        <span className="font-mono text-xs text-[var(--text-secondary)]">
                          {operations.hasRosterReadiness ? 'Live roster & timing metrics' : 'Event & timing configuration'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {operations.readinessMeters.map((meter) => (
                          <div
                            key={meter.id}
                            className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-semibold text-[var(--text-primary)]">{meter.label}</span>
                              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {meter.pct}%
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-[var(--surface-inset)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500"
                                style={{ width: `${Math.min(100, meter.pct)}%` }}
                              />
                            </div>
                            <div className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                              {meter.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Timing & Allocation Audit */}
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                          <Timer className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                          <span>Allocation &amp; timing integrity</span>
                        </h3>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Checkpoints</div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmtCount(operations.checkpointsConfigured)}
                            </div>
                            <div className="text-[var(--text-secondary)]">{operations.checkpointsWithCutoff} w/ cutoff</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Wave starts</div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              {operations.waveStartsConfigured}/{operations.waveStartsTotal}
                            </div>
                            <div className="text-[var(--text-secondary)]">Armed</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Free slots</div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmtCount(operations.freeSlotCount)}
                            </div>
                            <div className="text-[var(--text-secondary)]">On-site bibs</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Close reviews</div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmtCount(operations.reviewFlaggedCount)}
                            </div>
                            <div className="text-[var(--text-secondary)]">Finish ties</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Missing start</div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmtCount(operations.missingStartCount)}
                            </div>
                            <div className="text-[var(--text-secondary)]">Gun fallback</div>
                          </div>
                          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                            <div className="text-[var(--text-secondary)]">Disqualified</div>
                            <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                              {fmtCount(operations.dqCount)}
                            </div>
                            <div className="text-[var(--text-secondary)]">Official DQ</div>
                          </div>
                        </div>

                        {operations.hasRosterReadiness && (
                          <div className="pt-2 border-t border-[var(--border-subtle)] grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                            <div>
                              <span className="text-[var(--text-secondary)] block">Missing bibs</span>
                              <strong className="text-[var(--text-primary)]">{fmtCount(operations.bibsMissing)}</strong>
                            </div>
                            <div>
                              <span className="text-[var(--text-secondary)] block">Missing chips</span>
                              <strong className="text-[var(--text-primary)]">{fmtCount(operations.chipsMissing)}</strong>
                            </div>
                            <div>
                              <span className="text-[var(--text-secondary)] block">Relay links</span>
                              <strong className="text-[var(--text-primary)]">
                                {fmtCount(operations.relayLinksCount)} ({operations.brokenRelayLinksCount ?? 0} broken)
                              </strong>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Course & Elevation Terrain Metrics */}
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                            <MapPinned className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                            <span>Published course &amp; terrain</span>
                          </h3>
                          <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                            {operations.publishedRoutesCount} {operations.publishedRoutesCount === 1 ? 'course' : 'courses'}
                          </span>
                        </div>

                        {operations.routeItems.length > 0 ? (
                          <>
                            <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                                <div className="text-[var(--text-secondary)]">Courses</div>
                                <div className="text-sm font-semibold text-[var(--text-primary)]">
                                  {fmtCount(operations.publishedRoutesCount)}
                                </div>
                              </div>
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                                <div className="text-[var(--text-secondary)]">Total km</div>
                                <div className="text-sm font-semibold text-[var(--text-primary)]">
                                  {operations.totalRouteKm} km
                                </div>
                              </div>
                              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                                <div className="text-[var(--text-secondary)]">Peak gain</div>
                                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                  +{fmtCount(operations.maxElevationGainM)} m
                                </div>
                              </div>
                            </div>
                            <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]">
                              {operations.routeItems.slice(0, 5).map((rt) => (
                                <li key={rt.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                                  <span className="font-semibold text-[var(--text-primary)] truncate">
                                    {rt.raceName} {rt.distanceLabel ? `(${rt.distanceLabel})` : ''}
                                  </span>
                                  <span className="font-mono text-[var(--text-secondary)] tabular-nums shrink-0">
                                    {rt.distanceKm.toFixed(1)} km · +{rt.elevationGainM} m
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-xs text-[var(--text-secondary)]">
                            Course distance and elevation totals appear here when Route Studio GPX courses are published to events.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* TAB 4: EVENTS PORTFOLIO COMPARISON (STRICTLY NON-FINANCIAL) */}
              <div
                role="tabpanel"
                id="stats-panel-events"
                aria-labelledby="stats-tab-events"
                hidden={activeTab !== 'events'}
                tabIndex={activeTab === 'events' ? 0 : undefined}
              >
                {activeTab === 'events' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={portfolioTableCaptionId} className="text-sm font-semibold text-[var(--text-primary)]">
                        Event comparison
                      </h3>
                      <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
                        {portfolio.length} published {portfolio.length === 1 ? 'event' : 'events'}
                      </span>
                    </div>

                    <div
                      tabIndex={0}
                      role="region"
                      aria-labelledby={portfolioTableCaptionId}
                      className="hidden md:block overflow-x-auto rounded-xl border border-[var(--border-default)]"
                    >
                      <table className="w-full text-left border-collapse">
                        <caption className="sr-only">
                          Non-financial comparison of published RacePulsePH events covering turnout, finish rates, timing, and gender distribution
                        </caption>
                        <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold text-[var(--text-secondary)]">
                          <tr>
                            <th scope="col" className="py-2.5 px-3">Event</th>
                            <th scope="col" className="py-2.5 px-2">Date</th>
                            <th scope="col" className="py-2.5 px-2">Status</th>
                            <th scope="col" className="py-2.5 px-2 text-right">Reg (Heads)</th>
                            <th scope="col" className="py-2.5 px-2 text-right">Finishers</th>
                            <th scope="col" className="py-2.5 px-2 text-right">Fastest</th>
                            <th scope="col" className="py-2.5 px-2 text-right">Median</th>
                            <th scope="col" className="py-2.5 px-2 text-right">M / F %</th>
                            <th scope="col" className="py-2.5 px-3 text-right">Inspect</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)] text-xs font-mono tabular-nums bg-[var(--surface-card)]">
                          {portfolio.map((row) => (
                            <tr key={row.raceId} className="hover:bg-[var(--surface-inset)] transition-colors">
                              <th scope="row" className="py-2.5 px-3 font-sans text-sm font-semibold text-[var(--text-primary)]">
                                <div className="truncate max-w-[240px]">{row.raceName}</div>
                                <div className="font-mono text-xs font-normal text-[var(--text-secondary)]">
                                  {row.distances.join(' · ') || 'Distances TBA'}
                                </div>
                              </th>
                              <td className="py-2.5 px-2 text-[var(--text-secondary)] whitespace-nowrap">{row.raceDate}</td>
                              <td className="py-2.5 px-2">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full border font-sans text-xs font-semibold ${
                                    row.status === 'live'
                                      ? 'border-red-700/35 bg-red-500/10 text-red-700 dark:text-red-400'
                                      : row.status === 'completed'
                                      ? 'border-emerald-700/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {row.status === 'live' ? 'Live' : row.status === 'completed' ? 'Completed' : 'Upcoming'}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">
                                {row.registered > 0 ? `${fmtCount(row.registered)} (${fmtCount(row.headcount)})` : '--'}
                              </td>
                              <td className="py-2.5 px-2 text-right text-emerald-700 dark:text-emerald-400 font-semibold">
                                {row.finished > 0
                                  ? `${fmtCount(row.finished)}${row.finishRatePct !== null ? ` (${row.finishRatePct}%)` : ''}`
                                  : '--'}
                              </td>
                              <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">
                                {formatShortDuration(row.fastestSeconds)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">
                                {formatShortDuration(row.medianSeconds)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">
                                {row.malePct !== null && row.femalePct !== null ? `${row.malePct}/${row.femalePct}%` : '--'}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onSelectRaceId(row.raceId);
                                      setActiveTab('performance');
                                    }}
                                    className="min-h-11 px-3.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50 font-sans text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                                  >
                                    Stats
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onOpenRaceResults(row.raceId)}
                                    className="min-h-11 px-3.5 rounded-lg bg-red-700 hover:bg-red-600 font-sans text-xs font-semibold text-white cursor-pointer"
                                  >
                                    Results
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Portfolio Cards */}
                    <div className="md:hidden space-y-2.5">
                      {portfolio.map((row) => (
                        <div
                          key={row.raceId}
                          className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{row.raceName}</div>
                              <div className="font-mono text-xs text-[var(--text-secondary)]">
                                {row.raceDate} · {row.distances.join(' · ') || 'Distances TBA'}
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full border text-xs font-semibold shrink-0 ${
                                row.status === 'completed'
                                  ? 'border-emerald-700/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]'
                              }`}
                            >
                              {row.status === 'live' ? 'Live' : row.status === 'completed' ? 'Completed' : 'Upcoming'}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                            <div>
                              Reg <strong className="block text-[var(--text-primary)]">{row.registered > 0 ? fmtCount(row.registered) : '--'}</strong>
                            </div>
                            <div>
                              Finishers{' '}
                              <strong className="block text-emerald-700 dark:text-emerald-400">
                                {row.finished > 0 ? fmtCount(row.finished) : '--'}
                              </strong>
                            </div>
                            <div>
                              Fastest <strong className="block text-[var(--text-primary)]">{formatShortDuration(row.fastestSeconds)}</strong>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectRaceId(row.raceId);
                                setActiveTab('performance');
                              }}
                              className="min-h-11 flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]"
                            >
                              Inspect stats
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenRaceResults(row.raceId)}
                              className="min-h-11 flex-1 rounded-xl bg-red-700 text-xs font-semibold text-white"
                            >
                              Open results
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
