import React, { useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw, Search, WifiOff, X } from 'lucide-react';
import { ShimmerSweep, ValueSkeleton } from '../ui/MotionPrimitives';

export function RunnerOfflineBanner({
  online,
  syncing = false,
}: {
  online: boolean;
  syncing?: boolean;
}) {
  if (online && !syncing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="runner-sync-banner"
      className={`h-7 px-3 shrink-0 border-b flex items-center justify-between gap-2 text-xs font-semibold ${
        !online
          ? 'bg-amber-500/15 border-amber-600/35 text-amber-950 dark:text-amber-200'
          : 'bg-[var(--surface-inset)] border-[var(--border-subtle)] text-[var(--text-primary)]'
      }`}
    >
      <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
        {!online ? (
          <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        )}
        <span className="truncate">
          {!online ? 'Offline: cached race passes and splits ready' : 'Syncing live race updates...'}
        </span>
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider shrink-0 tabular-nums">
        {!online ? 'Cached' : 'Sync'}
      </span>
    </div>
  );
}

export interface RunnerTelemetryItem {
  key: string;
  label: string;
  value: number | string;
  loading?: boolean;
  accent?: 'red' | 'emerald' | 'amber' | 'default';
  wide?: boolean;
  active?: boolean;
  onClick?: () => void;
}

export function RunnerTelemetryStrip({
  items,
  ariaLabel = 'Runner telemetry summary',
  className = '',
}: {
  items: RunnerTelemetryItem[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={`shrink-0 w-full border-b border-[var(--border-default)] bg-[var(--surface-card)] grid divide-x divide-[var(--border-subtle)] ${className}`}
      style={{
        gridTemplateColumns: items.map((item) => (item.wide ? 'minmax(0, 1.65fr)' : 'minmax(0, 1fr)')).join(' '),
      }}
    >
      {items.map((item) => {
        const valueColor =
          item.accent === 'red'
            ? 'text-red-700 dark:text-red-400'
            : item.accent === 'emerald'
              ? 'text-emerald-700 dark:text-emerald-400'
              : item.accent === 'amber'
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-[var(--text-primary)]';

        const content = (
          <>
            <span className={`font-mono text-sm font-semibold tabular-nums leading-tight truncate max-w-full ${valueColor}`}>
              {item.loading ? (
                <ValueSkeleton widthClass="w-6" heightClass="h-4" label={`Loading ${item.label}`} />
              ) : (
                item.value
              )}
            </span>
            <span className="text-xs font-normal text-[var(--text-secondary)] truncate max-w-full leading-tight">
              {item.label}
            </span>
          </>
        );

        if (item.onClick) {
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              aria-pressed={item.active}
              className={`min-h-[48px] min-w-0 px-1.5 py-1 flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                item.active
                  ? 'bg-red-600/10 border-b-2 border-b-red-600'
                  : 'hover:bg-[var(--surface-hover)]/65'
              }`}
            >
              {content}
            </button>
          );
        }

        return (
          <div
            key={item.key}
            className="min-h-[48px] min-w-0 px-1.5 py-1 flex flex-col items-center justify-center gap-0.5"
          >
            {content}
          </div>
        );
      })}
    </section>
  );
}

export interface RunnerFilterOption<T extends string> {
  key: T;
  label: string;
  count?: number;
}

export function RunnerFilterRail<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  searchLabel = 'Search list',
  searchInputId,
  searchInputRef,
  rightSlot,
}: {
  ariaLabel: string;
  options: RunnerFilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  searchInputId?: string;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  rightSlot?: React.ReactNode;
}) {
  const [searchExpanded, setSearchExpanded] = useState(Boolean(searchValue));
  const showSearchInput = Boolean(onSearchChange && (searchExpanded || Boolean(searchValue)));

  const toggleSearch = () => {
    if (!onSearchChange) return;
    if (showSearchInput) {
      onSearchChange('');
      setSearchExpanded(false);
    } else {
      setSearchExpanded(true);
      window.requestAnimationFrame(() => searchInputRef?.current?.focus());
    }
  };

  return (
    <div className="sticky top-0 z-20 shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)]">
      <div className="min-h-[44px] px-3 py-0.5 flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label={ariaLabel}
          className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto racepulse-horizontal-scroll touch-pan-x"
        >
          {options.map((opt) => {
            const active = opt.key === value;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChange(opt.key)}
                aria-pressed={active}
                className={`min-h-[44px] min-w-[44px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  active
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span>{opt.label}</span>
                {opt.count !== undefined && (
                  <span className={`font-mono tabular-nums ${active ? 'text-white/95' : 'text-[var(--text-muted)]'}`}>
                    {opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {rightSlot}
          {onSearchChange && (
            <button
              type="button"
              onClick={toggleSearch}
              aria-expanded={showSearchInput}
              aria-label={showSearchInput ? 'Close search' : 'Search items'}
              className={`min-w-[44px] min-h-[44px] px-2 rounded-lg inline-flex items-center justify-center gap-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                showSearchInput
                  ? 'bg-red-600/15 text-red-700 dark:text-red-400'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {showSearchInput ? (
                <X className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Search className="w-4 h-4" aria-hidden="true" />
              )}
              <span className="sr-only sm:not-sr-only sm:inline">Search</span>
            </button>
          )}
        </div>
      </div>

      {showSearchInput && onSearchChange && (
        <div className="px-3 pb-2 pt-1 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)]/60">
          <div className="relative">
            <Search
              className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor={searchInputId} className="sr-only">
              {searchLabel}
            </label>
            <input
              ref={searchInputRef}
              id={searchInputId}
              type="search"
              value={searchValue || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full min-h-[44px] rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] pl-9 pr-11 text-sm font-normal text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search query"
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type QueueStatusTone = 'open' | 'joined' | 'raceday' | 'upcoming' | 'done' | 'amber';

const STATUS_TONE_CLASSES: Record<QueueStatusTone, string> = {
  open: 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700',
  joined: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
  raceday: 'bg-red-700 text-white border-red-700',
  upcoming: 'bg-emerald-500/10 text-emerald-800 border-emerald-600/30 dark:text-emerald-300',
  done: 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]',
  amber: 'bg-amber-500/10 text-amber-900 border-amber-500/35 dark:text-amber-300',
};

export function RunnerQueueRow({
  selected = false,
  idTag,
  title,
  meta,
  metric,
  metricAccent = 'default',
  statusLabel,
  statusTone,
  onClick,
}: {
  selected?: boolean;
  idTag?: string;
  title: string;
  meta: string;
  metric: string;
  metricAccent?: 'red' | 'emerald' | 'default';
  statusLabel: string;
  statusTone: QueueStatusTone;
  onClick: () => void;
}) {
  const metricColor =
    metricAccent === 'red'
      ? 'text-red-700 dark:text-red-400'
      : metricAccent === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-[var(--text-primary)]';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full min-h-[64px] px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
        selected
          ? 'bg-red-500/[0.08] border-l-[3px] border-l-red-600'
          : 'hover:bg-[var(--surface-hover)]/65 border-l-[3px] border-l-transparent'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 min-w-0">
          {idTag && (
            <span className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400 shrink-0">
              {idTag}
            </span>
          )}
          <span className="font-display text-sm font-semibold text-[var(--text-primary)] truncate">
            {title}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] truncate tabular-nums mt-0.5">
          {meta}
        </p>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1 text-right">
        <span className={`font-mono text-xs sm:text-sm font-semibold tabular-nums whitespace-nowrap ${metricColor}`}>
          {metric}
        </span>
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold leading-tight whitespace-nowrap ${STATUS_TONE_CLASSES[statusTone]}`}>
          {statusLabel}
        </span>
      </div>
    </button>
  );
}

export function RunnerQueueSkeleton({
  rows = 5,
  label = 'Loading runner items',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="divide-y divide-[var(--border-subtle)] bg-[var(--surface-card)]"
    >
      {Array.from({ length: rows }, (_, idx) => (
        <div
          key={idx}
          className="relative overflow-hidden min-h-[64px] px-3 py-2.5 flex items-center justify-between gap-3"
        >
          <ShimmerSweep />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-44 max-w-[75%] rounded bg-[var(--surface-inset)]" />
            <div className="h-3 w-56 max-w-[90%] rounded bg-[var(--surface-inset)]" />
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <div className="h-3.5 w-16 rounded bg-[var(--surface-inset)]" />
            <div className="h-4 w-14 rounded bg-[var(--surface-inset)]" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function RunnerFloatingStatusPill({
  title,
  idBadge,
  statusLabel,
  statusTone = 'upcoming',
  onBack,
  backLabel = 'Back to queue',
  rightSlot,
}: {
  title: string;
  idBadge?: string;
  statusLabel: string;
  statusTone?: QueueStatusTone;
  onBack: () => void;
  backLabel?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      style={{ top: 'max(12px, var(--rp-safe-top))' }}
      className="fixed inset-x-3 z-30 flex justify-center pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-xl min-h-[44px] rounded-full border border-[var(--border-default)] bg-[var(--surface-card)]/95 pl-1 pr-2 py-1 shadow-md flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="min-w-[44px] min-h-[44px] -my-1 rounded-full flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--surface-hover)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          {idBadge && (
            <span className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400 shrink-0">
              {idBadge}
            </span>
          )}
          <span className="text-xs sm:text-sm font-display font-semibold text-[var(--text-primary)] truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {rightSlot}
          <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold tabular-nums whitespace-nowrap ${STATUS_TONE_CLASSES[statusTone]}`}>
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

export type SheetDetent = 'peek' | 'half' | 'expanded';

export function RunnerBottomSheetDetent({
  detent,
  onDetentChange,
  peekSummary,
  primaryAction,
  ariaLabel,
  children,
}: {
  detent: SheetDetent;
  onDetentChange: (next: SheetDetent) => void;
  peekSummary: React.ReactNode;
  primaryAction: React.ReactNode;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; startDetent: SheetDetent } | null>(null);

  const cycleNextDetent = () => {
    if (detent === 'peek') onDetentChange('half');
    else if (detent === 'half') onDetentChange('expanded');
    else onDetentChange('peek');
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const targetEl = event.target as HTMLElement | null;
    if (targetEl?.closest('button, a, input, select, textarea, [role="button"]')) {
      return;
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { y: event.clientY, startDetent: detent };
    setDragging(true);
    setDragOffsetPx(0);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dy = event.clientY - dragStartRef.current.y;
    setDragOffsetPx(dy);
  };

  const handlePointerEnd = () => {
    if (!dragStartRef.current) return;
    const { startDetent } = dragStartRef.current;
    const dy = dragOffsetPx;
    dragStartRef.current = null;
    setDragging(false);
    setDragOffsetPx(0);

    if (dy < -48) {
      if (startDetent === 'peek') onDetentChange(dy < -200 ? 'expanded' : 'half');
      else if (startDetent === 'half') onDetentChange('expanded');
    } else if (dy > 48) {
      if (startDetent === 'expanded') onDetentChange(dy > 220 ? 'peek' : 'half');
      else if (startDetent === 'half') onDetentChange('peek');
    }
  };

  const baseTranslate =
    detent === 'expanded'
      ? '0px'
      : detent === 'half'
        ? '40dvh'
        : 'calc(90dvh - 134px - var(--rp-safe-bottom))';

  return (
    <section
      aria-label={ariaLabel}
      data-sheet-detent={detent}
      style={{
        transform: `translate3d(0, calc(${baseTranslate} + ${dragOffsetPx}px), 0)`,
      }}
      className={`fixed inset-x-0 bottom-0 z-30 h-[90dvh] rounded-t-[20px] border-t border-[var(--border-default)] bg-[var(--surface-card)] shadow-[0_-12px_36px_rgba(0,0,0,0.18)] flex flex-col will-change-transform ${
        dragging ? '' : 'transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'
      }`}
    >
      {/* Drag Handle & Detent Switcher */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="shrink-0 touch-none px-3 pt-2 pb-2 border-b border-[var(--border-subtle)] select-none"
      >
        <div className="w-10 h-1 rounded-full bg-[var(--border-strong)]/40 mx-auto mb-1" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{peekSummary}</div>

          <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Sheet height">
            {(['peek', 'half', 'expanded'] as const).map((level) => {
              const active = detent === level;
              const label = level === 'peek' ? 'Peek' : level === 'half' ? 'Half' : 'Full';
              return (
                <button
                  key={level}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetentChange(level);
                  }}
                  aria-pressed={active}
                  className={`min-h-[44px] min-w-[44px] px-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                    active
                      ? 'bg-red-700 text-white'
                      : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleNextDetent();
              }}
              aria-label={detent === 'expanded' ? 'Collapse sheet to peek' : 'Expand sheet'}
              className="min-w-[44px] min-h-[44px] -mr-1 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              {detent === 'expanded' ? (
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="mt-2">{primaryAction}</div>
      </div>

      {/* Scrollable Sheet Manifest (Half & Expanded) */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 space-y-3 pb-[max(16px,var(--rp-safe-bottom))] ${
          detent === 'peek' ? 'invisible pointer-events-none' : ''
        }`}
        aria-hidden={detent === 'peek'}
      >
        {children}
      </div>
    </section>
  );
}

export function RunnerThumbActionBar({
  hidden = false,
  children,
}: {
  hidden?: boolean;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  return (
    <div
      style={{ bottom: 'calc(56px + var(--rp-safe-bottom))' }}
      className="min-[600px]:hidden fixed inset-x-0 z-30 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 flex items-center gap-2"
    >
      {children}
    </div>
  );
}
