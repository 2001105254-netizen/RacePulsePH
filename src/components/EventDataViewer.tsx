import React, { useId, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Flag,
  Layers,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Timer,
  Users,
  Users2,
  X,
} from 'lucide-react';
import {
  buildAnalyticsCsv,
  DataViewerCategory,
  EventViewerBundle,
  formatPacePerKm,
  formatShortDuration,
  PortfolioComparisonRow,
} from '../lib/eventAnalytics';
import { Race } from '../types';
import RaceTimeText from './ui/RaceTimeText';
import { Select } from './ui/Select';

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH');
const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function fmtCount(val: number): string {
  return COUNT_FORMATTER.format(Number.isFinite(val) ? val : 0);
}

function fmtPhp(val: number): string {
  return PHP_FORMATTER.format(Number.isFinite(val) ? val : 0);
}

export interface EventDataViewerProps {
  races: Race[];
  selectedRaceId: string;
  onSelectRace: (raceId: string) => void;
  onStepRace: (delta: -1 | 1) => void;
  bundle: EventViewerBundle | null;
  portfolio: PortfolioComparisonRow[];
  category: DataViewerCategory;
  onCategoryChange: (next: DataViewerCategory) => void;
  distanceFilter: string;
  onDistanceFilterChange: (next: string) => void;
  canViewRoster: boolean;
  canViewRevenue: boolean;
  canViewTiming: boolean;
  canExportRoster: boolean;
  canExportResults: boolean;
  canEditRace: boolean;
  onClose: () => void;
  onOpenTiming?: (raceId: string) => void;
  onOpenRunners?: (raceId: string) => void;
  onOpenSetup?: (raceId: string) => void;
}

type PortfolioSortKey = 'date' | 'name' | 'runners' | 'collected' | 'gross';

export default function EventDataViewer({
  races,
  selectedRaceId,
  onSelectRace,
  onStepRace,
  bundle,
  portfolio,
  category,
  onCategoryChange,
  distanceFilter,
  onDistanceFilterChange,
  canViewRoster,
  canViewRevenue,
  canViewTiming,
  canExportRoster,
  canExportResults,
  canEditRace,
  onClose,
  onOpenTiming,
  onOpenRunners,
  onOpenSetup,
}: EventDataViewerProps) {
  const trendGradId = useId();
  const [scope, setScope] = useState<'event' | 'portfolio'>('event');
  const [searchQuery, setSearchQuery] = useState('');
  const [portfolioSort, setPortfolioSort] = useState<PortfolioSortKey>('date');
  const [portfolioSortDir, setPortfolioSortDir] = useState<'asc' | 'desc'>('desc');

  const tabs: Array<{ key: DataViewerCategory; label: string; icon: React.ReactNode }> = [
    { key: 'performance', label: 'Performance', icon: <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> },
    ...(canViewRevenue
      ? [{ key: 'financial' as const, label: 'Financial', icon: <Coins className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> }]
      : []),
    { key: 'demographics', label: 'Demographics', icon: <Users2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> },
    { key: 'operations', label: 'Operations', icon: <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> },
  ];

  const activeCategory: DataViewerCategory =
    category === 'financial' && !canViewRevenue ? 'performance' : category;

  const canExportCategory = useMemo(() => {
    if (!canViewRoster) return false;
    if (scope === 'portfolio') return canExportRoster;
    if (activeCategory === 'performance') return canExportResults || canExportRoster;
    if (activeCategory === 'financial') return canViewRevenue && canExportRoster;
    return canExportRoster;
  }, [activeCategory, canExportResults, canExportRoster, canViewRevenue, canViewRoster, scope]);

  const handleExportCsv = () => {
    if (!canExportCategory) return;
    const { filename, csv } = buildAnalyticsCsv({
      scope,
      category: activeCategory,
      bundle,
      portfolio,
      canViewRevenue,
    });
    if (!csv) return;
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const needle = searchQuery.trim().toLowerCase();

  const sortedPortfolio = useMemo(() => {
    const filtered = portfolio.filter(
      (row) => !needle || row.raceName.toLowerCase().includes(needle) || row.raceDate.includes(needle),
    );
    const dir = portfolioSortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (portfolioSort === 'name') return a.raceName.localeCompare(b.raceName) * dir;
      if (portfolioSort === 'runners') return (a.runners - b.runners) * dir;
      if (portfolioSort === 'collected') return (a.collectedAmount - b.collectedAmount) * dir;
      if (portfolioSort === 'gross') return (a.estGrossAmount - b.estGrossAmount) * dir;
      return a.raceDate.localeCompare(b.raceDate) * dir;
    });
  }, [needle, portfolio, portfolioSort, portfolioSortDir]);

  const portfolioTotals = useMemo(() => {
    return portfolio.reduce(
      (acc, row) => ({
        events: acc.events + 1,
        runners: acc.runners + row.runners,
        headcount: acc.headcount + row.headcount,
        collected: acc.collected + row.collectedAmount,
        pending: acc.pending + row.pendingAmount,
        gross: acc.gross + row.estGrossAmount,
      }),
      { events: 0, runners: 0, headcount: 0, collected: 0, pending: 0, gross: 0 },
    );
  }, [portfolio]);

  const togglePortfolioSort = (key: PortfolioSortKey) => {
    if (portfolioSort === key) {
      setPortfolioSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setPortfolioSort(key);
    setPortfolioSortDir(key === 'name' ? 'asc' : 'desc');
  };

  const filteredTopFinishers = useMemo(() => {
    const list = bundle?.performance.topFinishers || [];
    if (!needle) return list;
    return list.filter(
      (item) =>
        item.fullName.toLowerCase().includes(needle) ||
        item.bibNumber.toLowerCase().includes(needle) ||
        item.division.toLowerCase().includes(needle),
    );
  }, [bundle, needle]);

  const filteredPendingPayments = useMemo(() => {
    const list = bundle?.financial.pendingPayments || [];
    if (!needle) return list;
    return list.filter(
      (item) =>
        item.fullName.toLowerCase().includes(needle) ||
        item.bibNumber.toLowerCase().includes(needle) ||
        item.reference.toLowerCase().includes(needle) ||
        item.distance.toLowerCase().includes(needle),
    );
  }, [bundle, needle]);

  const filteredAttentionItems = useMemo(() => {
    const list = bundle?.operations.attentionItems || [];
    if (!needle) return list;
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.detail.toLowerCase().includes(needle) ||
        item.bibNumber.toLowerCase().includes(needle) ||
        item.distance.toLowerCase().includes(needle),
    );
  }, [bundle, needle]);

  const collectionTrendChart = useMemo(() => {
    const values = bundle?.financial.dailyCollectionSeries || [0, 0];
    const safe = values.length > 1 ? values : [0, 0];
    const width = 360;
    const height = 84;
    const max = Math.max(...safe, 1);
    const stepX = width / (safe.length - 1);
    const coords = safe.map((val, idx) => ({
      x: +(idx * stepX).toFixed(1),
      y: +(height - (val / max) * (height - 14) - 6).toFixed(1),
    }));
    const line = `M ${coords.map((pt) => `${pt.x},${pt.y}`).join(' L ')}`;
    return {
      line,
      area: `${line} L ${width},${height} L 0,${height} Z`,
      last: coords[coords.length - 1] ?? { x: width, y: height - 6 },
    };
  }, [bundle]);

  const currentRace = races.find((r) => r.id === selectedRaceId);

  return (
    <section
      id="events_full_data_viewer"
      aria-label="Events Admin Data Viewer"
      className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden bg-[var(--surface-page)] rounded-2xl lg:rounded-none border border-[var(--border-default)] lg:border-0"
    >
      {/* Top Viewer Toolbar */}
      <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 lg:min-h-0 lg:h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Directory</span>
            </button>

            <div
              role="group"
              aria-label="Data viewer scope"
              className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-1 shrink-0"
            >
              <button
                type="button"
                onClick={() => setScope('event')}
                aria-pressed={scope === 'event'}
                className={`min-h-9 lg:min-h-0 lg:h-7 px-3 rounded-md text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  scope === 'event'
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Single Event
              </button>
              <button
                type="button"
                onClick={() => setScope('portfolio')}
                aria-pressed={scope === 'portfolio'}
                className={`min-h-9 lg:min-h-0 lg:h-7 px-3 rounded-md text-xs font-semibold transition-colors duration-150 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  scope === 'portfolio'
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Portfolio ({races.length})</span>
              </button>
            </div>

            {scope === 'event' && races.length > 0 && (
              <div className="flex items-center gap-1 min-w-0">
                <label htmlFor="viewer_race_select" className="sr-only">
                  Select race event
                </label>
                <Select
                  id="viewer_race_select"
                  value={selectedRaceId}
                  onChange={onSelectRace}
                  searchable={races.length >= 6}
                  searchPlaceholder="Filter race events..."
                  size="sm"
                  surface="inset"
                  className="w-auto max-w-[220px] sm:max-w-xs"
                  options={races.map((r) => ({
                    value: r.id,
                    label: `${r.name} (${r.date})`,
                  }))}
                />
                <button
                  type="button"
                  onClick={() => onStepRace(-1)}
                  disabled={races.length <= 1}
                  aria-label="Previous race event"
                  className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 lg:h-9 lg:w-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] disabled:opacity-40 flex items-center justify-center text-[var(--text-primary)]"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onStepRace(1)}
                  disabled={races.length <= 1}
                  aria-label="Next race event"
                  className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 lg:h-9 lg:w-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] disabled:opacity-40 flex items-center justify-center text-[var(--text-primary)]"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 min-w-0 lg:w-64">
              <Search
                className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="viewer_table_search" className="sr-only">
                Filter data viewer rows
              </label>
              <input
                id="viewer_table_search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter rows, bib, ref..."
                className="min-h-11 lg:min-h-0 lg:h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] pl-8 pr-8 text-xs font-normal text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {canExportCategory && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="shrink-0 min-h-11 lg:min-h-0 lg:h-9 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs & Distance Filter Strip */}
        {scope === 'event' && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <div
              role="tablist"
              aria-label="Analytics categories"
              className="w-full sm:w-auto grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-1"
            >
              {tabs.map((item) => {
                const active = activeCategory === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onCategoryChange(item.key)}
                    className={`min-h-11 lg:min-h-0 lg:h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                      active
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {bundle && bundle.availableDistances.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto max-w-full" role="group" aria-label="Filter by race distance">
                <button
                  type="button"
                  onClick={() => onDistanceFilterChange('all')}
                  aria-pressed={distanceFilter === 'all'}
                  className={`min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                    distanceFilter === 'all'
                      ? 'border-emerald-600 bg-emerald-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  All Distances
                </button>
                {bundle.availableDistances.map((label) => {
                  const active = distanceFilter === label;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onDistanceFilterChange(label)}
                      aria-pressed={active}
                      className={`min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border text-xs font-mono font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 ${
                        active
                          ? 'border-emerald-600 bg-emerald-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Data Viewer Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4">
        {scope === 'portfolio' ? (
          <div className="space-y-4">
            {/* Portfolio KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs font-normal text-[var(--text-secondary)]">Total Events</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtCount(portfolioTotals.events)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs font-normal text-[var(--text-secondary)]">Entries / Course Headcount</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {canViewRoster ? `${fmtCount(portfolioTotals.runners)} / ${fmtCount(portfolioTotals.headcount)}` : 'Restricted'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs font-normal text-[var(--text-secondary)]">Collected Revenue</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {canViewRoster && canViewRevenue ? fmtPhp(portfolioTotals.collected) : 'Restricted'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs font-normal text-[var(--text-secondary)]">Pending / Est. Gross</div>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                  {canViewRoster && canViewRevenue
                    ? `${fmtPhp(portfolioTotals.pending)} / ${fmtPhp(portfolioTotals.gross)}`
                    : 'Restricted'}
                </div>
              </div>
            </div>

            {sortedPortfolio.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center">
                <p className="text-sm font-semibold text-[var(--text-primary)]">No matching events in portfolio</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">Adjust your filter query or create an event in Race Setup.</p>
              </div>
            ) : (
              <>
                {/* Desktop & Tablet Comparison Table */}
                <div className="hidden md:block rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      <tr>
                        <th className="py-2.5 px-3">
                          <button type="button" onClick={() => togglePortfolioSort('name')} className="hover:text-[var(--text-primary)]">
                            Event
                          </button>
                        </th>
                        <th className="py-2.5 px-3">
                          <button type="button" onClick={() => togglePortfolioSort('date')} className="hover:text-[var(--text-primary)]">
                            Date
                          </button>
                        </th>
                        <th className="py-2.5 px-3 text-right">
                          <button type="button" onClick={() => togglePortfolioSort('runners')} className="hover:text-[var(--text-primary)]">
                            Entries (Heads)
                          </button>
                        </th>
                        <th className="py-2.5 px-3 text-right">Bib / Kit %</th>
                        <th className="py-2.5 px-3 text-right">M / F %</th>
                        {canViewRevenue && (
                          <>
                            <th className="py-2.5 px-3 text-right">
                              <button type="button" onClick={() => togglePortfolioSort('collected')} className="hover:text-[var(--text-primary)]">
                                Collected
                              </button>
                            </th>
                            <th className="py-2.5 px-3 text-right">Pending</th>
                            <th className="py-2.5 px-3 text-right">
                              <button type="button" onClick={() => togglePortfolioSort('gross')} className="hover:text-[var(--text-primary)]">
                                Est. Gross
                              </button>
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                      {sortedPortfolio.map((row) => (
                        <tr
                          key={row.raceId}
                          onClick={() => {
                            onSelectRace(row.raceId);
                            setScope('event');
                          }}
                          className="cursor-pointer hover:bg-[var(--surface-hover)]/70 transition-colors duration-150"
                        >
                          <td className="py-2.5 px-3 font-semibold text-[var(--text-primary)]">
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[240px]">{row.raceName}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${
                                  row.completed
                                    ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                                }`}
                              >
                                {row.completed ? 'Done' : 'Active'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-[var(--text-secondary)]">{row.raceDate}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--text-primary)]">
                            {canViewRoster ? `${fmtCount(row.runners)} (${fmtCount(row.headcount)})` : '--'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                            {canViewRoster ? `${row.bibPct}% / ${row.kitClaimPct}%` : '--'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                            {canViewRoster ? `${row.malePct}/${row.femalePct}%` : '--'}
                          </td>
                          {canViewRevenue && (
                            <>
                              <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                                {canViewRoster ? fmtPhp(row.collectedAmount) : '--'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-red-700 dark:text-red-400">
                                {canViewRoster ? fmtPhp(row.pendingAmount) : '--'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[var(--text-primary)]">
                                {canViewRoster ? fmtPhp(row.estGrossAmount) : '--'}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Portfolio Cards */}
                <div className="md:hidden space-y-2">
                  {sortedPortfolio.map((row) => (
                    <button
                      key={row.raceId}
                      type="button"
                      onClick={() => {
                        onSelectRace(row.raceId);
                        setScope('event');
                      }}
                      className="w-full text-left rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{row.raceName}</span>
                        <span className="font-mono text-xs text-[var(--text-secondary)] shrink-0">{row.raceDate}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                        <div>
                          <span className="text-[var(--text-secondary)]">Entries: </span>
                          <strong className="text-[var(--text-primary)]">{canViewRoster ? fmtCount(row.runners) : '--'}</strong>
                        </div>
                        <div>
                          <span className="text-[var(--text-secondary)]">Collected: </span>
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            {canViewRoster && canViewRevenue ? fmtPhp(row.collectedAmount) : '--'}
                          </strong>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : !bundle ? (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center">
            <Flag className="w-6 h-6 text-[var(--text-secondary)] mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Select an event to inspect</p>
          </div>
        ) : !canViewRoster ? (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Roster access restricted</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Enable roster view permissions for this account to inspect performance, financial, demographic, and operations metrics.
            </p>
          </div>
        ) : activeCategory === 'performance' ? (
          <div className="space-y-4" role="tabpanel" aria-label="Performance analytics">
            {/* Performance KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Finish Rate</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {bundle.telemetry.finishRatePct}%
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.telemetry.finishedCount)} finished / {fmtCount(bundle.telemetry.dnsCount)} DNS
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Median / P90 Finish</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.telemetry.medianFinishLabel}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  P90: {bundle.telemetry.p90FinishLabel}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Fastest / Peak Wave</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.telemetry.fastestFinishLabel}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Peak: {bundle.telemetry.peakBucketLabel} ({fmtCount(bundle.telemetry.peakBucketCount)})
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">RFID Hardware Share</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.performance.timingHealth.rfidSharePct}%
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.performance.timingHealth.rfidBridgeReads)} bridge / {fmtCount(bundle.performance.timingHealth.manualReads)} manual
                </div>
              </div>
            </div>

            {/* Per-Distance Performance Table */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Distance Performance Matrix
                </h3>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Gun {fmtCount(bundle.telemetry.gunTimedCount)} / Chip {fmtCount(bundle.telemetry.chipTimedCount)} / Relay {fmtCount(bundle.telemetry.transitionTimedCount)}
                </span>
              </div>

              {bundle.performance.byDistance.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-secondary)]">No distances configured for this event.</p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        <tr>
                          <th className="py-2 px-3">Distance</th>
                          <th className="py-2 px-2 text-right">Reg</th>
                          <th className="py-2 px-2 text-right">Start</th>
                          <th className="py-2 px-2 text-right">Finish</th>
                          <th className="py-2 px-2 text-right">Rate</th>
                          <th className="py-2 px-2 text-right">DNS/DNF/DQ</th>
                          <th className="py-2 px-2 text-right">Fastest</th>
                          <th className="py-2 px-2 text-right">Median (P50)</th>
                          <th className="py-2 px-2 text-right">P90</th>
                          <th className="py-2 px-3 text-right">Avg Pace</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] text-xs font-mono tabular-nums">
                        {bundle.performance.byDistance.map((row) => (
                          <tr key={row.id} className="hover:bg-[var(--surface-hover)]/50">
                            <td className="py-2.5 px-3 font-sans font-semibold text-sm text-[var(--text-primary)]">
                              <span className="inline-flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} aria-hidden="true" />
                                <span>{row.label}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">{fmtCount(row.registered)}</td>
                            <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">{fmtCount(row.started)}</td>
                            <td className="py-2.5 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-400">{fmtCount(row.finished)}</td>
                            <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">{row.finishRatePct}%</td>
                            <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">
                              {row.dns}/{row.dnf}/{row.dq}
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
                            <td className="py-2.5 px-3 text-right text-[var(--text-primary)]">
                              {formatPacePerKm(row.avgPaceSecPerKm, 1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden divide-y divide-[var(--border-subtle)]">
                    {bundle.performance.byDistance.map((row) => (
                      <div key={row.id} className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{row.label}</span>
                          <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            {row.finishRatePct}% ({fmtCount(row.finished)}/{fmtCount(row.registered)})
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                          <div>Best: <strong className="text-[var(--text-primary)]">{formatShortDuration(row.fastestSeconds)}</strong></div>
                          <div>Med: <strong className="text-[var(--text-primary)]">{formatShortDuration(row.medianSeconds)}</strong></div>
                          <div>P90: <strong className="text-[var(--text-primary)]">{formatShortDuration(row.p90Seconds)}</strong></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Gender Pace Split & Checkpoint Scan Throughput */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Gender Pace &amp; Timing Health
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {bundle.performance.byGender.map((g) => (
                    <div key={g.gender} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-1">
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{g.label}</div>
                      <div className="text-xs font-mono text-[var(--text-secondary)]">
                        {fmtCount(g.finished)} / {fmtCount(g.registered)} finished
                      </div>
                      <div className="text-xs font-mono text-[var(--text-primary)]">
                        Best {formatShortDuration(g.fastestSeconds)}
                      </div>
                      <div className="text-xs font-mono text-[var(--text-secondary)]">
                        Med {formatShortDuration(g.medianSeconds)} ({g.avgPaceLabel})
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs font-mono">
                  <div className="text-[var(--text-secondary)]">
                    Unmatched RFID bibs: <strong className="text-red-700 dark:text-red-400">{fmtCount(bundle.performance.timingHealth.unmatchedBibs.length)}</strong>
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    Close reviews: <strong className="text-[var(--text-primary)]">{fmtCount(bundle.performance.timingHealth.reviewFlaggedCount)}</strong>
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    Missing start scan: <strong className="text-[var(--text-primary)]">{fmtCount(bundle.performance.timingHealth.missingStartCount)}</strong>
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    Wave starts set: <strong className="text-[var(--text-primary)]">{bundle.performance.timingHealth.waveStartsConfigured}/{bundle.performance.timingHealth.waveStartsTotal}</strong>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Checkpoint Scan Throughput
                  </h3>
                  {canViewTiming && onOpenTiming && currentRace && (
                    <button
                      type="button"
                      onClick={() => onOpenTiming(currentRace.id)}
                      className="min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                    >
                      <Timer className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <span>Open Timing</span>
                    </button>
                  )}
                </div>
                {bundle.performance.checkpoints.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No checkpoints configured.</p>
                ) : (
                  <div className="space-y-2.5">
                    {bundle.performance.checkpoints.map((cp) => (
                      <div key={cp.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="font-semibold text-[var(--text-primary)] truncate">
                            {cp.label} <span className="font-normal text-[var(--text-secondary)]">({cp.type})</span>
                          </span>
                          <span className="font-mono tabular-nums text-[var(--text-secondary)] shrink-0">
                            <strong className="text-[var(--text-primary)]">{fmtCount(cp.uniqueBibs)}</strong> bibs ({cp.pctOfRegistered}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--surface-inset)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-600 transition-all duration-200"
                            style={{ width: `${Math.max(cp.uniqueBibs > 0 ? 4 : 0, Math.min(100, cp.pctOfRegistered))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top Division Finishers Preview */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Top Division Finishers
                </h3>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(filteredTopFinishers.length)} shown
                </span>
              </div>
              {filteredTopFinishers.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-secondary)]">No official finish scans recorded for the active filter.</p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {filteredTopFinishers.map((item) => (
                    <div key={`${item.division}-${item.bibNumber}`} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] font-mono font-semibold text-[var(--text-primary)]">
                          #{item.overallRank}
                        </span>
                        <span className="font-mono font-semibold text-[var(--text-secondary)]">#{item.bibNumber}</span>
                        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.fullName}</span>
                        <span className="text-xs text-[var(--text-secondary)]">{item.division}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                        <span className="text-[var(--text-secondary)]">{item.paceLabel}</span>
                        <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] uppercase text-[var(--text-secondary)]">
                          {item.timingMethod}
                        </span>
                        <RaceTimeText value={item.finishTime} className="text-sm font-semibold text-emerald-700 dark:text-emerald-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeCategory === 'financial' && canViewRevenue ? (
          <div className="space-y-4" role="tabpanel" aria-label="Financial analytics">
            {/* Financial KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Collected Revenue</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fmtPhp(bundle.financial.collectedAmount)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.financial.paidCount)} paid registrations
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Pending Receivables</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-red-700 dark:text-red-400">
                  {fmtPhp(bundle.financial.pendingAmount)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.financial.pendingCount)} awaiting confirmation
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">List-Price Gross</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtPhp(bundle.financial.listPriceGross)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.financial.unbilledCount)} unbilled / imported
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Collection Rate</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.financial.collectionRatePct}%
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Avg paid ticket: {fmtPhp(bundle.financial.avgRealizedTicket)}
                </div>
              </div>
            </div>

            {/* Channel Mix & 14-Point Collection Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Payment Channels &amp; Fee Policy
                  </h3>
                  <span className="px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)]">
                    Fees: {bundle.financial.feeMode === 'passed_on' ? 'Passed to Runner' : 'Absorbed'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
                    <div className="text-[var(--text-secondary)]">Online Checkout (Paid)</div>
                    <div className="mt-1 font-mono text-base font-semibold text-emerald-700 dark:text-emerald-400">
                      {fmtPhp(bundle.financial.onlinePaidAmount)}
                    </div>
                    <div className="mt-1 font-mono text-[var(--text-secondary)]">
                      {fmtCount(bundle.financial.onlinePaidCount)} paid ({bundle.financial.onlineEnabled ? 'Enabled' : 'Off'})
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
                    <div className="text-[var(--text-secondary)]">Manual Transfer (Paid)</div>
                    <div className="mt-1 font-mono text-base font-semibold text-[var(--text-primary)]">
                      {fmtPhp(bundle.financial.manualPaidAmount)}
                    </div>
                    <div className="mt-1 font-mono text-[var(--text-secondary)]">
                      {fmtCount(bundle.financial.manualPaidCount)} paid ({bundle.financial.manualEnabled ? 'Enabled' : 'Off'})
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
                  <span>Manual pending: {fmtCount(bundle.financial.manualPendingCount)} ({fmtPhp(bundle.financial.manualPendingAmount)})</span>
                  <span>Free slots: {fmtCount(bundle.financial.freeSlotCount)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Cumulative Collection Curve
                  </h3>
                  <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    +{fmtPhp(bundle.financial.recent7dCollectedAmount)} in 7d
                  </span>
                </div>
                <svg viewBox="0 0 360 84" className="h-24 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Cumulative collected revenue curve">
                  <defs>
                    <linearGradient id={trendGradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={collectionTrendChart.area} fill={`url(#${trendGradId})`} />
                  <path d={collectionTrendChart.line} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
                  <circle cx={collectionTrendChart.last.x} cy={collectionTrendChart.last.y} r="3" fill="#10b981" />
                </svg>
                <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                  <span>{bundle.financial.dailyCollectionLabels[0]}</span>
                  <span>{bundle.financial.dailyCollectionLabels[1]}</span>
                  <span>{bundle.financial.dailyCollectionLabels[2]}</span>
                </div>
              </div>
            </div>

            {/* Per-Distance Revenue Ledger */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Revenue &amp; Yield by Distance
                </h3>
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    <tr>
                      <th className="py-2 px-3">Distance</th>
                      <th className="py-2 px-2 text-right">Unit Fee</th>
                      <th className="py-2 px-2 text-right">Entries</th>
                      <th className="py-2 px-2 text-right">Paid</th>
                      <th className="py-2 px-2 text-right">Collected</th>
                      <th className="py-2 px-2 text-right">Pending</th>
                      <th className="py-2 px-2 text-right">Unbilled</th>
                      <th className="py-2 px-2 text-right">List Gross</th>
                      <th className="py-2 px-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-xs font-mono tabular-nums">
                    {bundle.financial.byDistance.map((row) => (
                      <tr key={row.id} className="hover:bg-[var(--surface-hover)]/50">
                        <td className="py-2.5 px-3 font-sans font-semibold text-sm text-[var(--text-primary)]">{row.label}</td>
                        <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">{fmtPhp(row.unitPrice)}</td>
                        <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">{fmtCount(row.registrants)}</td>
                        <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">{fmtCount(row.paidCount)}</td>
                        <td className="py-2.5 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-400">{fmtPhp(row.collectedAmount)}</td>
                        <td className="py-2.5 px-2 text-right text-red-700 dark:text-red-400">
                          {row.pendingCount > 0 ? `${fmtPhp(row.pendingAmount)} (${row.pendingCount})` : fmtPhp(0)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-[var(--text-secondary)]">{fmtCount(row.unbilledCount)}</td>
                        <td className="py-2.5 px-2 text-right text-[var(--text-primary)]">{fmtPhp(row.listPriceGross)}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">{row.shareOfCollectedPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-[var(--border-subtle)]">
                {bundle.financial.byDistance.map((row) => (
                  <div key={row.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{row.label} ({fmtPhp(row.unitPrice)})</span>
                      <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmtPhp(row.collectedAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                      <span>Paid: {fmtCount(row.paidCount)}/{fmtCount(row.registrants)}</span>
                      <span>Pending: {fmtPhp(row.pendingAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pending Manual Payments Queue Preview */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Pending Payment Verification ({fmtCount(filteredPendingPayments.length)})
                </h3>
                {onOpenRunners && currentRace && (
                  <button
                    type="button"
                    onClick={() => onOpenRunners(currentRace.id)}
                    className="min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>Open Roster &amp; Payments</span>
                  </button>
                )}
              </div>
              {filteredPendingPayments.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-secondary)]">No pending payments matching the current filter.</p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {filteredPendingPayments.slice(0, 30).map((item, idx) => (
                    <div key={`${item.bibNumber}-${item.reference}-${idx}`} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-[var(--text-secondary)] mr-2">#{item.bibNumber}</span>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{item.fullName}</span>
                        <span className="ml-2 text-[var(--text-secondary)]">{item.distance}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono tabular-nums">
                        <span className="text-[var(--text-secondary)]">Ref: {item.reference}</span>
                        <span className="font-semibold text-red-700 dark:text-red-400">{fmtPhp(item.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeCategory === 'demographics' ? (
          <div className="space-y-4" role="tabpanel" aria-label="Demographics analytics">
            {/* Demographics KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Entries / Headcount</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtCount(bundle.telemetry.totalRunners)} / {fmtCount(bundle.demographics.compliance.totalHeadcount)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Includes team member counts
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Median / Mean Age</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.telemetry.ageSummary.medianAge !== null ? `${bundle.telemetry.ageSummary.medianAge}y` : '--'}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Mean: {bundle.demographics.compliance.meanAge !== null ? `${bundle.demographics.compliance.meanAge}y` : '--'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Emergency Contacts</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {bundle.demographics.compliance.emergencyContactPct}%
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  {fmtCount(bundle.demographics.compliance.emergencyContactCount)} / {fmtCount(bundle.telemetry.totalRunners)} verified
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Marketing Opt-In / Under-13</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {bundle.demographics.compliance.marketingOptInPct}%
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Under 13 consent: {bundle.demographics.compliance.under13ConsentCount}/{bundle.demographics.compliance.under13Count}
                </div>
              </div>
            </div>

            {/* Gender by Distance + Entry Formats & Age Cuts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Gender Split by Distance &amp; Formats
                </h3>
                {bundle.demographics.genderByDistance.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No distance breakdown available.</p>
                ) : (
                  <div className="space-y-2.5">
                    {bundle.demographics.genderByDistance.map((row) => (
                      <div key={row.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                          <span className="font-sans font-semibold text-[var(--text-primary)]">{row.distanceLabel}</span>
                          <span className="text-[var(--text-secondary)]">
                            M {fmtCount(row.maleCount)} ({row.malePct}%) / F {fmtCount(row.femaleCount)} ({row.femalePct}%)
                          </span>
                        </div>
                        <div className="flex h-2 w-full rounded-full overflow-hidden bg-[var(--surface-inset)]">
                          <div style={{ width: `${row.malePct}%` }} className="h-full bg-blue-500" />
                          <div style={{ width: `${row.femalePct}%` }} className="h-full bg-pink-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Entry Formats &amp; Total Headcount
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {bundle.demographics.entryFormatHeadcount.map((fmt) => (
                      <div key={fmt.category} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs">
                        <div className="font-semibold text-[var(--text-primary)]">{fmt.label}</div>
                        <div className="font-mono text-[var(--text-secondary)] mt-0.5">
                          {fmtCount(fmt.entriesCount)} {fmt.entriesCount === 1 ? 'entry' : 'entries'} ({fmtCount(fmt.headcount)} {fmt.headcount === 1 ? 'runner' : 'runners'})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Age Brackets &amp; Divisions
                  </h3>
                  <span className="px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)]">
                    {bundle.telemetry.usingCustomAgeCuts ? 'Race Divisions' : 'Standard Cuts'}
                  </span>
                </div>
                {bundle.telemetry.ageCuts.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No age data recorded.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {bundle.telemetry.ageCuts.map((cut) => (
                      <div key={cut.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="font-semibold text-[var(--text-primary)] truncate">
                            {cut.label} {cut.gender !== 'all' ? `(${cut.gender === 'male' ? 'M' : 'F'})` : ''}
                          </span>
                          <span className="font-mono tabular-nums text-[var(--text-secondary)] shrink-0">
                            {cut.medianFinishSeconds !== undefined ? `Med ${formatShortDuration(cut.medianFinishSeconds)} · ` : ''}
                            <strong className="text-[var(--text-primary)]">{fmtCount(cut.count)}</strong> ({cut.pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--surface-inset)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.max(cut.count > 0 ? 4 : 0, Math.min(100, cut.pct))}%`, backgroundColor: cut.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Shirt Size Fulfillment Matrix */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Shirt Size Inventory &amp; Claim Status
                </h3>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {bundle.demographics.compliance.shirtSizePct}% with size recorded
                </span>
              </div>
              {bundle.demographics.shirtInventory.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-secondary)]">No shirt size selections recorded yet.</p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[var(--surface-inset)] border-b border-[var(--border-default)] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        <tr>
                          <th className="py-2 px-3">Size</th>
                          <th className="py-2 px-2 text-right">Ordered</th>
                          <th className="py-2 px-2 text-right">Claimed</th>
                          <th className="py-2 px-2 text-right">Remaining</th>
                          <th className="py-2 px-2 text-right">Claim Rate</th>
                          <th className="py-2 px-3">By Distance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] text-xs font-mono tabular-nums">
                        {bundle.demographics.shirtInventory.map((row) => (
                          <tr key={row.size} className="hover:bg-[var(--surface-hover)]/50">
                            <td className="py-2 px-3 font-semibold text-sm text-[var(--text-primary)]">{row.size}</td>
                            <td className="py-2 px-2 text-right text-[var(--text-primary)]">{fmtCount(row.orderedCount)}</td>
                            <td className="py-2 px-2 text-right text-emerald-700 dark:text-emerald-400">{fmtCount(row.claimedCount)}</td>
                            <td className="py-2 px-2 text-right text-red-700 dark:text-red-400">{fmtCount(row.unclaimedCount)}</td>
                            <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{row.claimRatePct}%</td>
                            <td className="py-2 px-3 text-[var(--text-secondary)]">
                              {Object.entries(row.byDistance)
                                .map(([dist, cnt]) => `${dist}: ${cnt}`)
                                .join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden divide-y divide-[var(--border-subtle)]">
                    {bundle.demographics.shirtInventory.map((row) => (
                      <div key={row.size} className="p-3 flex items-center justify-between text-xs font-mono">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{row.size}</span>
                        <span className="text-[var(--text-secondary)]">
                          Ordered <strong className="text-[var(--text-primary)]">{fmtCount(row.orderedCount)}</strong> / Claimed{' '}
                          <strong className="text-emerald-700 dark:text-emerald-400">{fmtCount(row.claimedCount)}</strong> / Left{' '}
                          <strong className="text-red-700 dark:text-red-400">{fmtCount(row.unclaimedCount)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4" role="tabpanel" aria-label="Operations and readiness audit">
            {/* Operations KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Bib Allocation</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtCount(bundle.telemetry.assignedBibTotal)} / {fmtCount(bundle.telemetry.totalRunners)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Missing bibs: {fmtCount(bundle.operations.missingBibCount)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">RFID Chip Mapping</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtCount(bundle.operations.assignedChipCount)} / {fmtCount(bundle.telemetry.totalRunners)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Missing chips: {fmtCount(bundle.operations.missingChipCount)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Kit Claims</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fmtCount(bundle.operations.claimedKitCount)} / {fmtCount(bundle.telemetry.totalRunners)}
                </div>
                <div className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  Unclaimed: {fmtCount(bundle.operations.unclaimedKitCount)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">Relay &amp; Legacy Audit</div>
                <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {fmtCount(bundle.operations.relayLinksCount)} links
                </div>
                <div className="mt-1 text-xs font-mono text-red-700 dark:text-red-400">
                  Broken: {fmtCount(bundle.operations.brokenRelayLinks.length)} / Unmapped: {fmtCount(bundle.operations.unmappedDistanceCount)}
                </div>
              </div>
            </div>

            {/* Readiness Progress & Quick Launchers */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Race-Day Readiness Indicators
                </h3>
                <div className="flex flex-wrap gap-2">
                  {canViewTiming && onOpenTiming && currentRace && (
                    <button
                      type="button"
                      onClick={() => onOpenTiming(currentRace.id)}
                      className="min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Timing Console</span>
                    </button>
                  )}
                  {canViewRoster && onOpenRunners && currentRace && (
                    <button
                      type="button"
                      onClick={() => onOpenRunners(currentRace.id)}
                      className="min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                    >
                      <Users className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <span>Roster</span>
                    </button>
                  )}
                  {canEditRace && onOpenSetup && currentRace && (
                    <button
                      type="button"
                      onClick={() => onOpenSetup(currentRace.id)}
                      className="min-h-9 lg:min-h-0 lg:h-7 px-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                    >
                      <Settings2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <span>Setup</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  {
                    label: 'Bibs Assigned',
                    pct: bundle.telemetry.totalRunners > 0 ? Math.round((bundle.telemetry.assignedBibTotal / bundle.telemetry.totalRunners) * 100) : 0,
                  },
                  {
                    label: 'Chips Assigned',
                    pct: bundle.telemetry.totalRunners > 0 ? Math.round((bundle.operations.assignedChipCount / bundle.telemetry.totalRunners) * 100) : 0,
                  },
                  {
                    label: 'Kits Claimed',
                    pct: bundle.telemetry.totalRunners > 0 ? Math.round((bundle.operations.claimedKitCount / bundle.telemetry.totalRunners) * 100) : 0,
                  },
                  {
                    label: 'Emergency Info',
                    pct: bundle.demographics.compliance.emergencyContactPct,
                  },
                  {
                    label: 'Shirt Sizes',
                    pct: bundle.demographics.compliance.shirtSizePct,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{metric.label}</span>
                      <span className="font-mono font-semibold text-[var(--text-primary)]">{metric.pct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all duration-200"
                        style={{ width: `${Math.min(100, metric.pct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actionable Issues Drill-Down Table */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Actionable Items ({fmtCount(filteredAttentionItems.length)})</span>
                </h3>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  Free slots: {fmtCount(bundle.operations.freeSlotCount)}
                </span>
              </div>
              {filteredAttentionItems.length === 0 ? (
                <p className="p-4 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                  No missing bibs, broken relay links, unmatched scans, or pending issues detected.
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {filteredAttentionItems.slice(0, 50).map((item) => (
                    <div key={item.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`px-2 py-0.5 rounded-full border font-semibold uppercase ${
                            item.severity === 'high'
                              ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {item.severity}
                        </span>
                        <span className="font-mono font-semibold text-[var(--text-secondary)]">#{item.bibNumber}</span>
                        <span className="font-semibold text-[var(--text-primary)]">{item.title}</span>
                      </div>
                      <div className="text-[var(--text-secondary)] truncate max-w-full sm:max-w-md">
                        {item.distance !== '--' ? `[${item.distance}] ` : ''}
                        {item.detail}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
