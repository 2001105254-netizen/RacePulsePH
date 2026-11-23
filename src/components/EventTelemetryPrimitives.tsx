import React, { useId, useMemo, useState } from 'react';
import { Award, Maximize2, Radio, TrendingUp, Users2 } from 'lucide-react';
import {
  buildEventTelemetryData,
  computeRowMicroMetrics,
  DISTANCE_PALETTE,
  formatPacePerKm,
  formatShortDuration,
  type AgeCutStat,
  type DataViewerCategory,
  type DemographicStat,
  type DistanceBreakdown,
  type EventTelemetryData,
  type EventViewerBundle,
  type FinishWaveBucket,
  type FunnelStage,
  type RowMicroMetrics,
} from '../lib/eventAnalytics';

export {
  buildEventTelemetryData,
  computeRowMicroMetrics,
  DISTANCE_PALETTE,
  formatShortDuration,
  type AgeCutStat,
  type DataViewerCategory,
  type DemographicStat,
  type DistanceBreakdown,
  type EventTelemetryData,
  type EventViewerBundle,
  type FinishWaveBucket,
  type FunnelStage,
  type RowMicroMetrics,
};

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH');
const COMPACT_PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatPhp(value: number): string {
  return COMPACT_PHP_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatCompactPhp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '₱0';
  if (value >= 1000000) return `₱${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `₱${Math.round(value / 1000)}k`;
  return `₱${Math.round(value)}`;
}

export interface EventTelemetryCardProps {
  mode: 'upcoming' | 'completed';
  distances: DistanceBreakdown[];
  velocityData: number[];
  velocityLabels?: string[];
  usingFinishScanSeries?: boolean;
  medianFinishLabel?: string;
  peakBucketLabel?: string;
  peakBucketCount?: number;
  recent7dRunners?: number;
  canViewRoster: boolean;
  canViewRevenue: boolean;
  ageSummary?: EventTelemetryData['ageSummary'];
  genderBreakdown?: DemographicStat[];
  paidCount?: number;
  reportedTotalRunners?: number;
  topAgeCutLabel?: string;
}

/**
 * Right-hand inspector "Event Pulse" card combining segmented category share bar
 * and zero-dependency SVG velocity/finish-wave area sparkline.
 */
export const EventTelemetryCard: React.FC<EventTelemetryCardProps> = ({
  mode,
  distances,
  velocityData,
  velocityLabels = ['', '', ''],
  usingFinishScanSeries = false,
  medianFinishLabel = '--:--:--',
  peakBucketLabel = '',
  peakBucketCount = 0,
  recent7dRunners = 0,
  canViewRoster,
  canViewRevenue,
  ageSummary,
  genderBreakdown = [],
  paidCount = 0,
  reportedTotalRunners,
  topAgeCutLabel = '',
}) => {
  const gradientId = useId();
  const totalRunners = useMemo(
    () => reportedTotalRunners ?? distances.reduce((acc, item) => acc + item.runners, 0),
    [distances, reportedTotalRunners],
  );

  const { linePath, areaPath, lastPoint } = useMemo(() => {
    const width = 320;
    const height = 64;
    const safeSeries = velocityData.length > 1 ? velocityData : [0, 0];
    const max = Math.max(...safeSeries, 1);
    const stepX = width / (safeSeries.length - 1);

    const coords = safeSeries.map((val, index) => {
      const x = +(index * stepX).toFixed(1);
      const y = +(height - (val / max) * (height - 14) - 5).toFixed(1);
      return { x, y };
    });

    const line = `M ${coords.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    const area = `${line} L ${width},${height} L 0,${height} Z`;
    return {
      linePath: line,
      areaPath: area,
      lastPoint: coords[coords.length - 1] ?? { x: width, y: height - 5 },
    };
  }, [velocityData]);

  const sparkSummaryText = usingFinishScanSeries
    ? `Peak ${peakBucketLabel} (${formatCount(peakBucketCount)})`
    : recent7dRunners > 0
    ? `+${formatCount(recent7dRunners)} in 7d`
    : `${formatCount(totalRunners)} entries`;

  return (
    <div
      id="inspector_event_pulse_card"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 text-[var(--text-primary)] space-y-3"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {mode === 'upcoming' ? 'Event Pulse · Distance & Reg Velocity' : 'Event Pulse · Finisher Wave & Split'}
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {canViewRoster ? `${formatCount(totalRunners)} Total` : 'Restricted'}
        </span>
      </div>

      {/* Zero-DOM-Bloat Segmented Distribution Bar */}
      <div
        role="img"
        aria-label={`Distance distribution across ${distances.length} categories`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-card)] p-[1px]"
      >
        {canViewRoster && totalRunners > 0 ? (
          distances.map((dist) => {
            const pct = (dist.runners / totalRunners) * 100;
            return (
              <div
                key={dist.id}
                style={{ width: `${pct}%`, backgroundColor: dist.color }}
                className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-200"
                title={`${dist.label}: ${formatCount(dist.runners)} runners (${pct.toFixed(1)}%)`}
              />
            );
          })
        ) : (
          <div className="h-full w-full rounded-full bg-[var(--border-default)]/40" />
        )}
      </div>

      {/* Micro-Legend Grid */}
      {distances.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">No distance categories configured yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pb-3 border-b border-[var(--border-subtle)]">
          {distances.map((dist) => {
            const sharePct =
              canViewRoster && totalRunners > 0 ? Math.round((dist.runners / totalRunners) * 100) : 0;
            return (
              <div
                key={dist.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-1.5 min-w-0"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: dist.color }}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {dist.label}
                    </span>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
                    {canViewRoster ? `${sharePct}%` : '--'}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-1 font-mono tabular-nums">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {canViewRoster ? formatCount(dist.runners) : '--'}
                  </span>
                  {canViewRoster && canViewRevenue && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 truncate">
                      {formatCompactPhp(dist.estRevenue)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* High-FPS Pure SVG Area Sparkline */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <span className="truncate">
            {usingFinishScanSeries
              ? 'Finish Chute Density (interval buckets)'
              : mode === 'completed'
              ? 'Cumulative Registration Curve (0 finish scans)'
              : 'Cumulative Registration Velocity'}
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
            {canViewRoster ? sparkSummaryText : 'Restricted'}
          </span>
        </div>

        <svg
          viewBox="0 0 320 64"
          className="h-16 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label={usingFinishScanSeries ? 'Finish wave density sparkline' : 'Registration velocity sparkline'}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Dashed Early / Regular / Peak vertical markers */}
          <line x1="106" y1="4" x2="106" y2="62" stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 3" />
          <line x1="214" y1="4" x2="214" y2="62" stroke="#ef4444" strokeOpacity="0.45" strokeDasharray="3 3" />
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="#10b981"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {canViewRoster && (
            <circle cx={lastPoint.x} cy={lastPoint.y} r="2.75" fill="#10b981" />
          )}
        </svg>

        <div className="mt-1 flex items-center justify-between text-xs font-mono tabular-nums text-[var(--text-secondary)]">
          <span>{velocityLabels[0] || 'Start'}</span>
          <span>
            {usingFinishScanSeries ? `Median ${medianFinishLabel}` : velocityLabels[1] || 'Mid'}
          </span>
          <span>{velocityLabels[2] || 'Latest'}</span>
        </div>
      </div>

      {/* Compact Runner Demographics & Age Cuts Strip */}
      {canViewRoster && ageSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--border-default)]">
          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Median Age</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {ageSummary.medianAge !== null ? `${ageSummary.medianAge} yrs` : '--'}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Gender M/F</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {(() => {
                const male = genderBreakdown.find((g) => g.id === 'male')?.pct ?? 0;
                const female = genderBreakdown.find((g) => g.id === 'female')?.pct ?? 0;
                return genderBreakdown.length > 0 ? `${male}/${female}%` : '--';
              })()}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70 min-w-0">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] truncate">Peak Age Cut</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 truncate">
              {topAgeCutLabel || '--'}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
              {canViewRevenue ? 'Paid Share' : 'Age Span'}
            </div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {canViewRevenue
                ? totalRunners > 0
                  ? `${Math.round((paidCount / totalRunners) * 100)}%`
                  : '0%'
                : ageSummary.minAge !== null && ageSummary.maxAge !== null
                ? `${ageSummary.minAge}-${ageSummary.maxAge}y`
                : '--'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export interface TableRunnerMicroBarProps {
  runnerCount: number;
  maxRunnerCount: number;
  assignedBibCount: number;
  completed: boolean;
}

/** 40x4px capacity + bib allocation micro-bar positioned under the Runners count. */
export const TableRunnerMicroBar: React.FC<TableRunnerMicroBarProps> = ({
  runnerCount,
  maxRunnerCount,
  assignedBibCount,
  completed,
}) => {
  const denom = Math.max(maxRunnerCount, runnerCount, 1);
  const fillPct = runnerCount > 0 ? Math.max(8, Math.min(100, Math.round((runnerCount / denom) * 100))) : 0;
  const bibPct = runnerCount > 0 ? Math.round((assignedBibCount / runnerCount) * 100) : 0;

  return (
    <div className="mt-1 flex flex-col items-end gap-0.5">
      <div
        className="w-10 h-1 rounded-full bg-[var(--surface-inset)] overflow-hidden border border-[var(--border-subtle)]"
        title={`${formatCount(assignedBibCount)}/${formatCount(runnerCount)} bibs assigned`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-200"
          style={{
            width: `${fillPct}%`,
            backgroundColor: completed ? '#a1a1aa' : fillPct >= 90 ? '#ef4444' : '#10b981',
          }}
        />
      </div>
      <span className="font-mono text-xs leading-none tabular-nums text-[var(--text-secondary)]">
        {runnerCount > 0 ? `${bibPct}% bib` : '0 bib'}
      </span>
    </div>
  );
};

export interface TableRevenueMicroPillProps {
  estRevenue: number;
  runnerCount: number;
  recent7dRevenue: number;
  avgRevenuePerRunner: number;
  sparkline: number[];
}

/** Compact inline velocity/yield indicator positioned under Est. Gross currency figures. */
export const TableRevenueMicroPill: React.FC<TableRevenueMicroPillProps> = ({
  estRevenue,
  runnerCount,
  recent7dRevenue,
  avgRevenuePerRunner,
  sparkline,
}) => {
  const has7dSurge = recent7dRevenue > 0;
  const maxBar = Math.max(...sparkline, 1);
  const label = has7dSurge
    ? `+${formatCompactPhp(recent7dRevenue)} 7d`
    : runnerCount > 0 && estRevenue > 0
    ? `${formatPhp(avgRevenuePerRunner)} avg`
    : 'No charges';

  return (
    <div className="mt-1 flex items-center justify-end gap-1.5">
      {has7dSurge && (
        <svg viewBox="0 0 28 10" className="w-7 h-2.5 shrink-0" aria-hidden="true">
          {sparkline.map((count, idx) => {
            const h = count > 0 ? Math.max(2, Math.round((count / maxBar) * 10)) : 1.5;
            return (
              <rect
                key={idx}
                x={idx * 4}
                y={10 - h}
                width="2.5"
                height={h}
                rx="0.5"
                fill={count > 0 ? '#10b981' : '#52525b'}
              />
            );
          })}
        </svg>
      )}
      <span
        className={`font-mono text-xs leading-none tabular-nums ${
          has7dSurge
            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
            : 'text-[var(--text-secondary)]'
        }`}
      >
        {label}
      </span>
    </div>
  );
};

export interface BottomTelemetryDockProps {
  bundle: EventViewerBundle;
  canViewRoster: boolean;
  canViewRevenue: boolean;
  onOpenEngraving?: (raceId: string) => void;
  onOpenDataViewer?: (category: DataViewerCategory) => void;
}

/**
 * Compact 4-category bottom analytics dock beneath the Event Directory table
 * with a one-click Expand Viewer trigger into the full-workspace Data Viewer.
 */
export const BottomTelemetryDock: React.FC<BottomTelemetryDockProps> = ({
  bundle,
  canViewRoster,
  canViewRevenue,
  onOpenEngraving,
  onOpenDataViewer,
}) => {
  const gradCurrentId = useId();
  const [dockTab, setDockTab] = useState<DataViewerCategory>('performance');
  const { telemetry, performance, financial, demographics, operations } = bundle;
  const isCompletedOrLive = telemetry.mode === 'completed';

  const activeTab: DataViewerCategory =
    dockTab === 'financial' && !canViewRevenue ? 'performance' : dockTab;

  const comparisonPaths = useMemo(() => {
    const width = 360;
    const height = 84;
    const toPath = (values: number[]) => {
      const safe = values.length > 1 ? values : [0, 0];
      const max = Math.max(...safe, 100);
      const stepX = width / (safe.length - 1);
      const pts = safe.map((v, idx) => {
        const x = +(idx * stepX).toFixed(1);
        const y = +(height - (v / max) * (height - 14) - 6).toFixed(1);
        return `${x},${y}`;
      });
      const line = `M ${pts.join(' L ')}`;
      return {
        line,
        area: `${line} L ${width},${height} L 0,${height} Z`,
      };
    };

    return {
      current: toPath(telemetry.benchmarkCurve.current),
      benchmark: toPath(telemetry.benchmarkCurve.benchmark),
    };
  }, [telemetry.benchmarkCurve]);

  const maxBucket = Math.max(...telemetry.finishBuckets.map((b) => b.count), 1);

  const dockTabs: Array<{ key: DataViewerCategory; label: string }> = [
    { key: 'performance', label: 'Performance' },
    ...(canViewRevenue ? [{ key: 'financial' as const, label: 'Financial' }] : []),
    { key: 'demographics', label: 'Demographics' },
    { key: 'operations', label: 'Operations' },
  ];

  return (
    <section
      id="events_bottom_telemetry_dock"
      aria-label="Selected event telemetry analytics dock"
      className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto border-t border-[var(--border-default)] bg-[var(--surface-card)]/95 p-3 sm:p-4 space-y-3"
    >
      {/* Dock Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <Radio className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate">
            Telemetry Dock · {telemetry.raceName}
          </h2>
          <span
            className={`px-2 py-0.5 rounded-full border text-xs font-semibold shrink-0 ${
              isCompletedOrLive
                ? 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {isCompletedOrLive ? 'Checkpoint & Finisher' : 'Upcoming Readiness'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div
            role="tablist"
            aria-label="Telemetry dock category"
            className="w-full sm:w-auto grid grid-cols-2 sm:inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5"
          >
            {dockTabs.map((item) => {
              const selected = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setDockTab(item.key)}
                  className={`min-h-10 lg:min-h-0 lg:h-7 px-2.5 rounded-md text-xs font-semibold whitespace-nowrap inline-flex items-center justify-center transition-colors duration-150 ${
                    selected
                      ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {onOpenDataViewer && (
            <button
              type="button"
              onClick={() => onOpenDataViewer(activeTab)}
              className="min-h-9 lg:min-h-0 lg:h-8 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Maximize2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span>Data Viewer</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Tab Panels */}
      {activeTab === 'financial' && canViewRevenue ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Financial summary">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Revenue &amp; Collection Reconciliation
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                {canViewRoster ? `${financial.collectionRatePct}% collected` : 'Restricted'}
              </span>
            </div>
            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for financial metrics.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                    <div className="text-xs text-[var(--text-secondary)]">Collected</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatPhp(financial.collectedAmount)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                    <div className="text-xs text-[var(--text-secondary)]">Pending</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatPhp(financial.pendingAmount)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                    <div className="text-xs text-[var(--text-secondary)]">List Gross</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatPhp(financial.listPriceGross)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--text-secondary)]">
                  <span>Online: <strong className="text-[var(--text-primary)]">{formatPhp(financial.onlinePaidAmount)}</strong> ({formatCount(financial.onlinePaidCount)})</span>
                  <span>Manual: <strong className="text-[var(--text-primary)]">{formatPhp(financial.manualPaidAmount)}</strong> ({formatCount(financial.manualPaidCount)})</span>
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Yield by Distance
              </span>
              <span className="font-mono text-xs text-[var(--text-secondary)] shrink-0">
                Avg Ticket {canViewRoster ? formatPhp(financial.avgRealizedTicket) : '--'}
              </span>
            </div>
            {!canViewRoster || financial.byDistance.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No distance fee schedule configured yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {financial.byDistance.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <span className="font-sans font-semibold text-[var(--text-primary)] truncate">
                      {row.label} ({formatCount(row.paidCount)}/{formatCount(row.registrants)} paid)
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold shrink-0">
                      {formatPhp(row.collectedAmount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'demographics' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Demographics and apparel summary">
          {/* Panel 1: Age Cuts & Divisions */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Age Cuts &amp; Divisions
              </span>
              <span className="px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] font-mono text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                {telemetry.usingCustomAgeCuts ? 'Race Divisions' : 'Standard Brackets'}
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for age-cut statistics.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-xs text-[var(--text-secondary)]">Median</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {telemetry.ageSummary.medianAge !== null ? `${telemetry.ageSummary.medianAge}y` : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-xs text-[var(--text-secondary)]">Range</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {telemetry.ageSummary.minAge !== null && telemetry.ageSummary.maxAge !== null
                        ? `${telemetry.ageSummary.minAge}-${telemetry.ageSummary.maxAge}`
                        : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-xs text-[var(--text-secondary)]">Under 18</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCount(telemetry.ageSummary.youthUnder18)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-xs text-[var(--text-secondary)]">50+</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatCount(telemetry.ageSummary.masters50Plus)}
                    </div>
                  </div>
                </div>

                {telemetry.ageCuts.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No age data recorded for registered runners yet.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {telemetry.ageCuts.map((cut) => (
                      <div key={cut.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: cut.color }}
                              aria-hidden="true"
                            />
                            <span className="font-semibold text-[var(--text-primary)] truncate">{cut.label}</span>
                            {cut.gender !== 'all' && (
                              <span className="px-1 py-0.5 rounded bg-[var(--surface-card)] border border-[var(--border-default)] text-xs font-mono uppercase text-[var(--text-secondary)] shrink-0">
                                {cut.gender === 'male' ? 'M' : 'F'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 font-mono tabular-nums shrink-0 text-xs">
                            {cut.medianFinishSeconds !== undefined && (
                              <span className="text-[var(--text-secondary)]">
                                Med {formatShortDuration(cut.medianFinishSeconds)}
                              </span>
                            )}
                            <span className="font-semibold text-[var(--text-primary)]">
                              {formatCount(cut.count)} ({cut.pct}%)
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width] duration-200"
                            style={{
                              width: `${Math.max(cut.count > 0 ? 4 : 0, Math.min(100, cut.pct))}%`,
                              backgroundColor: cut.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Panel 2: Gender, Headcount & Shirt Demand */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Demographics &amp; Apparel
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
                {canViewRoster ? `${formatCount(demographics.compliance.totalHeadcount)} runners on course` : 'Restricted'}
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for demographic breakdown.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">Gender Split</span>
                    <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                      {telemetry.genderBreakdown.map((g) => (
                        <span key={g.id} className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} aria-hidden="true" />
                          <span>{g.label}: <strong className="text-[var(--text-primary)]">{formatCount(g.count)}</strong> ({g.pct}%)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-card)]">
                    {telemetry.genderBreakdown.map((g) => (
                      <div
                        key={g.id}
                        style={{ width: `${g.pct}%`, backgroundColor: g.color }}
                        className="h-full"
                        title={`${g.label}: ${formatCount(g.count)} (${g.pct}%)`}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[var(--border-default)]">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[var(--text-secondary)]">Entry Formats</div>
                    <div className="flex flex-wrap gap-1.5">
                      {demographics.entryFormatHeadcount.length === 0 ? (
                        <span className="text-xs text-[var(--text-secondary)]">--</span>
                      ) : (
                        demographics.entryFormatHeadcount.map((fmt) => (
                          <span
                            key={fmt.category}
                            className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 font-mono text-xs tabular-nums text-[var(--text-primary)]"
                          >
                            <span>{fmt.label}</span>
                            <strong className="text-emerald-700 dark:text-emerald-400">{formatCount(fmt.entriesCount)}</strong>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[var(--text-secondary)]">Shirt Sizes (Claimed/Total)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {demographics.shirtInventory.length === 0 ? (
                        <span className="text-xs text-[var(--text-secondary)]">--</span>
                      ) : (
                        demographics.shirtInventory.map((sz) => (
                          <span
                            key={sz.size}
                            className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 font-mono text-xs tabular-nums text-[var(--text-primary)]"
                          >
                            <span>{sz.size}</span>
                            <strong>{formatCount(sz.claimedCount)}/{formatCount(sz.orderedCount)}</strong>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : activeTab === 'operations' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Operations readiness">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Roster, Kit &amp; Safety Completeness
              </span>
              <span className="font-mono text-xs text-[var(--text-secondary)] shrink-0">
                {canViewRoster ? `${formatCount(operations.attentionItems.length)} flags` : 'Restricted'}
              </span>
            </div>
            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for operational audit.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                  <div className="text-xs text-[var(--text-secondary)]">Missing Bib</div>
                  <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">{formatCount(operations.missingBibCount)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                  <div className="text-xs text-[var(--text-secondary)]">Missing Chip</div>
                  <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">{formatCount(operations.missingChipCount)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                  <div className="text-xs text-[var(--text-secondary)]">Unclaimed Kit</div>
                  <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">{formatCount(operations.unclaimedKitCount)}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2">
                  <div className="text-xs text-[var(--text-secondary)]">Emergency Info</div>
                  <div className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    {demographics.compliance.emergencyContactPct}%
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Timing &amp; Relay Integrity
              </span>
              <span className="font-mono text-xs text-red-700 dark:text-red-400 shrink-0">
                {canViewRoster && operations.brokenRelayLinks.length > 0 ? `${operations.brokenRelayLinks.length} broken links` : 'Checked'}
              </span>
            </div>
            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-[var(--text-secondary)]">
                <div>Unmatched RFID scans: <strong className="text-red-700 dark:text-red-400">{formatCount(performance.timingHealth.unmatchedBibs.length)}</strong></div>
                <div>Close finish reviews: <strong className="text-[var(--text-primary)]">{formatCount(performance.timingHealth.reviewFlaggedCount)}</strong></div>
                <div>Relay links: <strong className="text-[var(--text-primary)]">{formatCount(operations.relayLinksCount)}</strong></div>
                <div>Free slots: <strong className="text-[var(--text-primary)]">{formatCount(operations.freeSlotCount)}</strong></div>
              </div>
            )}
          </div>
        </div>
      ) : isCompletedOrLive ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Performance and checkpoint telemetry">
          {/* Completed Panel 1: Checkpoint Funnel & Runner Status */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Checkpoint Funnel &amp; Pace
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                {formatCount(telemetry.activeReadCount)} scans
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for funnel telemetry.</p>
            ) : (
              <div className="space-y-2">
                {telemetry.checkpointFunnel.map((stage) => (
                  <div key={stage.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--text-primary)] truncate">{stage.label}</span>
                      <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                        <span className="text-xs text-[var(--text-secondary)]">{stage.detail}</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {formatCount(stage.count)} ({stage.pct}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-200"
                        style={{
                          width: `${Math.max(stage.count > 0 ? 4 : 0, Math.min(100, stage.pct))}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Panel 2: Finish Time & Pace Wave Density */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                  {telemetry.finishBuckets.length > 0 ? 'Finish Wave' : 'Registration Curve Summary'}
                </span>
                {onOpenEngraving && telemetry.finishBuckets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenEngraving(telemetry.raceId)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] transition-colors shrink-0"
                  >
                    <Award className="w-3 h-3 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>Engrave Rush</span>
                  </button>
                )}
              </div>
              <span className="font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                {telemetry.finishBuckets.length > 0
                  ? `Med ${telemetry.medianFinishLabel} / P90 ${telemetry.p90FinishLabel}`
                  : `${formatCount(telemetry.totalRunners)} registered`}
              </span>
            </div>

            {telemetry.finishBuckets.length > 0 ? (
              <div className="space-y-1.5">
                <svg
                  viewBox="0 0 360 84"
                  className="h-24 lg:h-28 w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Finish wave histogram showing peak arrival rush and median line"
                >
                  {telemetry.finishBuckets.map((bucket, idx) => {
                    const barW = 360 / telemetry.finishBuckets.length - 3;
                    const x = idx * (360 / telemetry.finishBuckets.length) + 1.5;
                    const h = bucket.count > 0 ? Math.max(4, (bucket.count / maxBucket) * 66) : 2;
                    const isPeak = bucket.label === telemetry.peakBucketLabel && bucket.count > 0;
                    return (
                      <rect
                        key={bucket.label}
                        x={x}
                        y={78 - h}
                        width={barW}
                        height={h}
                        rx="2"
                        fill={isPeak ? '#ef4444' : bucket.count > 0 ? '#10b981' : '#52525b'}
                        fillOpacity={bucket.count > 0 ? 0.85 : 0.25}
                      />
                    );
                  })}
                  <line x1="180" y1="4" x2="180" y2="80" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>

                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                  <span>First: {telemetry.finishBuckets[0]?.label}</span>
                  <span className="text-red-700 dark:text-red-400 font-semibold">
                    Peak Chute: {telemetry.peakBucketLabel} ({formatCount(telemetry.peakBucketCount)})
                  </span>
                  <span>
                    {performance.byDistance[0]?.avgPaceSecPerKm
                      ? formatPacePerKm(performance.byDistance[0].avgPaceSecPerKm, 1)
                      : `Last: ${telemetry.finishBuckets[telemetry.finishBuckets.length - 1]?.label}`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <svg
                  viewBox="0 0 360 84"
                  className="h-20 w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Historical registration curve (no individual finish chip scans synced yet)"
                >
                  <defs>
                    <linearGradient id={gradCurrentId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={comparisonPaths.current.area} fill={`url(#${gradCurrentId})`} />
                  <path d={comparisonPaths.current.line} fill="none" stroke="#10b981" strokeWidth="1.75" />
                </svg>
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                  <span>0 RFID finish scans synced</span>
                  <span>Showing registration progression ({formatCount(telemetry.totalRunners)})</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Upcoming readiness telemetry">
          {/* Upcoming Panel 1: Bib Allocation & Kit Readiness Bullet Bars */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] inline-flex items-center gap-1.5 min-w-0 truncate">
                <Users2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span className="truncate">Bib Allocation &amp; Tag Readiness</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                {canViewRoster ? `${formatCount(telemetry.taggedOrClaimedTotal)} tagged` : 'Restricted'}
              </span>
            </div>

            {telemetry.distances.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">Configure distances in Race Setup to inspect allocations.</p>
            ) : (
              <div className="space-y-2">
                {telemetry.distances.slice(0, 4).map((dist) => {
                  const regPct = dist.capacity > 0 ? Math.min(100, Math.round((dist.runners / dist.capacity) * 100)) : 0;
                  const bibPct = dist.runners > 0 ? Math.round((dist.assignedBibs / dist.runners) * 100) : 0;
                  return (
                    <div key={dist.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dist.color }} aria-hidden="true" />
                          <span className="font-mono font-semibold text-[var(--text-primary)]">{dist.label}</span>
                        </div>
                        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
                          <strong className="text-[var(--text-primary)]">{canViewRoster ? formatCount(dist.runners) : '--'}</strong> reg · {canViewRoster ? `${bibPct}% bibs` : '--'}
                        </span>
                      </div>
                      <div className="relative h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                        <div
                          className="h-full rounded-full opacity-35 transition-[width] duration-200"
                          style={{ width: `${canViewRoster ? regPct : 0}%`, backgroundColor: dist.color }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
                          style={{
                            width: `${canViewRoster ? Math.round((regPct * bibPct) / 100) : 0}%`,
                            backgroundColor: dist.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Panel 2: Cumulative Curve vs Reference Event */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] inline-flex items-center gap-1.5 truncate">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span className="truncate">Momentum vs. Benchmark</span>
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                {telemetry.benchmarkCurve.daysToRace >= 0
                  ? `T-${telemetry.benchmarkCurve.daysToRace}d`
                  : `T+${Math.abs(telemetry.benchmarkCurve.daysToRace)}d`}
              </span>
            </div>

            <svg
              viewBox="0 0 360 84"
              className="h-24 lg:h-28 w-full overflow-visible"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Cumulative registration pacing curve compared against ${telemetry.benchmarkCurve.benchmarkName}`}
            >
              <defs>
                <linearGradient id={gradCurrentId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path
                d={comparisonPaths.benchmark.line}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeOpacity="0.85"
              />
              <path d={comparisonPaths.current.area} fill={`url(#${gradCurrentId})`} />
              <path
                d={comparisonPaths.current.line}
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" aria-hidden="true" />
                Selected ({formatCount(telemetry.totalRunners)})
              </span>
              <span className="inline-flex items-center gap-1.5 truncate">
                <span className="w-2.5 h-0.5 border-t border-dashed border-red-500 inline-block" aria-hidden="true" />
                <span className="truncate">Ref: {telemetry.benchmarkCurve.benchmarkName}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
