import { type ReactNode, useEffect, useRef, useState } from 'react';
import { m, useReducedMotion, type Variants } from 'motion/react';

export type NavDirection = 'forward' | 'back';

export const EMIL_EASE = [0.32, 0.72, 0, 1] as const;
export const QUINT_EASE = [0.22, 1, 0.36, 1] as const;

export const PUSH_POP_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 34,
  mass: 0.8,
};

export const TAB_PILL_SPRING = {
  type: 'spring' as const,
  stiffness: 440,
  damping: 34,
  mass: 0.75,
};

/**
 * Computes navigation direction from ordered tab indices so sibling tab switches
 * slide left or right consistently on mobile and desktop.
 */
export function resolveTabDirection<T extends string>(
  orderedKeys: readonly T[],
  previousKey: T,
  nextKey: T,
): NavDirection {
  const prevIdx = orderedKeys.indexOf(previousKey);
  const nextIdx = orderedKeys.indexOf(nextKey);
  if (prevIdx === -1 || nextIdx === -1 || prevIdx === nextIdx) return 'forward';
  return nextIdx > prevIdx ? 'forward' : 'back';
}

/**
 * Caps list stagger delays to the first 6 to 8 viewport items (280ms max)
 * so fast scroll flings never reveal blank rows further down the list.
 */
export function cappedStaggerDelay(index: number): number {
  return Math.min(Math.max(index, 0) * 0.04, 0.28);
}

/**
 * Directional push/pop page transitions using compositor-only properties.
 * transitionEnd clears transform at rest so fixed descendants anchor to viewport.
 */
export const directionalPageVariants: Variants = {
  initial: (direction: NavDirection) => ({
    x: direction === 'forward' ? 32 : -20,
    opacity: 0,
    scale: direction === 'forward' ? 0.99 : 0.98,
  }),
  animate: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      ...PUSH_POP_SPRING,
      opacity: { duration: 0.18, ease: EMIL_EASE },
    },
    transitionEnd: {
      transform: 'none',
    },
  },
  exit: (direction: NavDirection) => ({
    x: direction === 'forward' ? -20 : 32,
    opacity: 0,
    scale: 0.98,
    transition: {
      duration: 0.18,
      ease: EMIL_EASE,
    },
  }),
};

/**
 * Compact horizontal directional slide for inner workspace tabs and auth toggles.
 * Keeps total duration strictly under 300ms for immediate high-frequency switches.
 */
export const directionalTabVariants: Variants = {
  initial: (direction: NavDirection) => ({
    x: direction === 'forward' ? 18 : -18,
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
    transition: {
      duration: 0.18,
      ease: EMIL_EASE,
    },
    transitionEnd: {
      transform: 'none',
    },
  },
  exit: (direction: NavDirection) => ({
    x: direction === 'forward' ? -14 : 14,
    opacity: 0,
    transition: {
      duration: 0.14,
      ease: EMIL_EASE,
    },
  }),
};

export function AnimatedTabView({
  tabKey,
  direction = 'forward',
  className = '',
  children,
}: {
  tabKey: string;
  direction?: NavDirection;
  className?: string;
  children: ReactNode;
}) {
  // Single-instance keyed enter unmounts the previous tab immediately so portaled
  // top-header controls and desktop viewport locks never overlap across switches.
  return (
    <div className={`relative overflow-x-clip ${className}`}>
      <m.div
        key={tabKey}
        initial={{
          opacity: 0,
          x: direction === 'forward' ? 12 : -12,
        }}
        animate={{
          opacity: 1,
          x: 0,
          transitionEnd: {
            transform: 'none',
          },
        }}
        transition={{
          duration: 0.16,
          ease: EMIL_EASE,
        }}
        className={`w-full [backface-visibility:hidden] ${className}`}
      >
        {children}
      </m.div>
    </div>
  );
}

/** GPU-composited translateX shimmer mask disabled under reduced motion. */
export function ShimmerSweep() {
  return (
    <div
      aria-hidden="true"
      className="rp-shimmer-sweep pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-black/5 dark:via-white/10 to-transparent"
    />
  );
}

/** Inline geometry-preserving shimmer pill shown while async numbers or text resolve. */
export function ValueSkeleton({
  widthClass = 'w-14',
  heightClass = 'h-4',
  className = '',
  label = 'Loading value',
}: {
  widthClass?: string;
  heightClass?: string;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`relative inline-block align-middle overflow-hidden rounded-md bg-[var(--surface-inset)] border border-[var(--border-subtle)] ${widthClass} ${heightClass} ${className}`}
    >
      <ShimmerSweep />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Animates numeric metric transitions smoothly via requestAnimationFrame (compositor-clean,
 * no layout jitter when styled with tabular-nums) and swaps to ValueSkeleton while loading.
 */
export function AnimatedMetricValue({
  value,
  format,
  loading = false,
  skeletonWidthClass = 'w-14',
  skeletonHeightClass = 'h-4',
  className = '',
  durationMs = 220,
}: {
  value: number;
  format?: (val: number) => string;
  loading?: boolean;
  skeletonWidthClass?: string;
  skeletonHeightClass?: string;
  className?: string;
  durationMs?: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const currentRef = useRef(value);

  useEffect(() => {
    if (loading) {
      currentRef.current = 0;
      setDisplayValue(0);
      return;
    }
    if (prefersReducedMotion || currentRef.current === value) {
      currentRef.current = value;
      setDisplayValue(value);
      return;
    }

    const from = currentRef.current;
    const delta = value - from;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      currentRef.current = next;
      setDisplayValue(progress >= 1 ? value : Math.round(next));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        currentRef.current = value;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, loading, prefersReducedMotion, durationMs]);

  if (loading) {
    return (
      <ValueSkeleton
        widthClass={skeletonWidthClass}
        heightClass={skeletonHeightClass}
        className={className}
      />
    );
  }

  const formatted = format ? format(displayValue) : String(Math.round(displayValue));
  return <span className={`tabular-nums ${className}`}>{formatted}</span>;
}

export function CardSkeletonLoader({
  label = 'Loading content',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={`relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--surface-card)] p-5 sm:p-6 ${className}`}
    >
      <ShimmerSweep />
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 rounded-xl bg-[var(--surface-inset)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded-md bg-[var(--surface-inset)]" />
          <div className="h-3 w-1/3 rounded-md bg-[var(--surface-inset)]" />
        </div>
      </div>
      <div className="mt-4 h-24 w-full rounded-xl bg-[var(--surface-inset)]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function RaceCardSkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading published races"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {Array.from({ length: count }, (_, idx) => (
        <li key={idx} className="flex">
          <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] flex flex-col justify-between">
            <ShimmerSweep />
            <div>
              <div className="h-36 sm:h-40 w-full bg-[var(--surface-inset)] border-b border-[var(--border-default)]" />
              <div className="p-4 sm:p-5 space-y-3">
                <div className="space-y-2">
                  <div className="h-5 w-3/4 rounded-md bg-[var(--surface-inset)]" />
                  <div className="h-3.5 w-1/2 rounded-md bg-[var(--surface-inset)]" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-20 rounded-lg bg-[var(--surface-inset)]" />
                  <div className="h-7 w-24 rounded-lg bg-[var(--surface-inset)]" />
                </div>
              </div>
            </div>
            <div className="px-4 sm:px-5 pb-4 sm:pb-5">
              <div className="h-11 w-full rounded-full bg-[var(--surface-inset)]" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ResultsSkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading official race results" className="space-y-2">
      {Array.from({ length: rows }, (_, idx) => (
        <div
          key={idx}
          className="relative overflow-hidden glass-inset px-3 py-3 sm:px-4 flex items-center gap-3"
        >
          <ShimmerSweep />
          <div className="w-8 h-5 rounded bg-[var(--surface-card)] shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-4 w-44 max-w-full rounded bg-[var(--surface-card)]" />
            <div className="h-3 w-60 max-w-full rounded bg-[var(--surface-card)]" />
          </div>
          <div className="hidden sm:block w-16 h-4 rounded bg-[var(--surface-card)] shrink-0" />
          <div className="w-9 h-9 rounded-full bg-[var(--surface-card)] shrink-0" />
        </div>
      ))}
      <span className="sr-only">Loading official race results</span>
    </div>
  );
}

export function ViewLoadingSkeleton({
  label = 'Loading view',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={compact ? 'w-full space-y-4 py-2' : 'w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5 flex-grow'}
    >
      <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--surface-card)] p-5 sm:p-6 space-y-3">
        <ShimmerSweep />
        <div className="h-3 w-28 rounded bg-[var(--surface-inset)]" />
        <div className="h-6 w-56 max-w-full rounded bg-[var(--surface-inset)]" />
        <div className="h-3.5 w-80 max-w-full rounded bg-[var(--surface-inset)]" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((idx) => (
          <div
            key={idx}
            className="relative overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--surface-card)] p-5 space-y-3"
          >
            <ShimmerSweep />
            <div className="h-4 w-1/2 rounded bg-[var(--surface-inset)]" />
            <div className="h-16 w-full rounded-xl bg-[var(--surface-inset)]" />
            <div className="h-10 w-36 rounded-full bg-[var(--surface-inset)]" />
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

