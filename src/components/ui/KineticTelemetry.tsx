import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { LayoutGroup, m, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import type { Race } from '../../types';
import { KINETIC_SPRING } from './MotionPrimitives';

/**
 * Tracks page visibility so ambient decorative loops pause cleanly when the
 * user switches tabs or minimizes the WebView.
 */
export function useDocumentVisible(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document !== 'undefined' ? !document.hidden : true,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return isVisible;
}

const TRAIL_NAME_PATTERN =
  /\b(trail|ultra|mountain|ridge|peak|summit|quest|lilingayon|asturias|skyrun|vertical)\b/i;

/**
 * Identifies trail, mountain, and ultra-distance events so topographic contour
 * overlays appear strictly on relevant elevation races without cluttering road cards.
 */
export function isTrailRace(race: Pick<Race, 'name' | 'distances' | 'routeGpxFileName'>): boolean {
  if (TRAIL_NAME_PATTERN.test(race.name)) return true;
  if (race.routeGpxFileName && TRAIL_NAME_PATTERN.test(race.routeGpxFileName)) return true;
  return (race.distances || []).some((d) => {
    if (typeof d.km === 'number' && d.km >= 42) return true;
    const label = d.label || '';
    if (/trail/i.test(label)) return true;
    const km = parseFloat(label);
    return Number.isFinite(km) && km >= 42;
  });
}

/**
 * Subtle topographic elevation contours at 3-5% opacity. Shifts via CSS
 * scroll-driven view() animation and lightweight pointer-tracked custom vars.
 */
export function TopographicContoursSvg({
  variant = 'hero',
  className = '',
}: {
  variant?: 'hero' | 'trail';
  className?: string;
}) {
  if (variant === 'trail') {
    return (
      <svg
        viewBox="0 0 600 260"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden="true"
        data-topo-variant="trail"
        data-variant="trail"
        className={cn(
          'rp-topo-layer pointer-events-none select-none absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)] text-[#111113] dark:text-[#F5F5F7] opacity-[0.045]',
          className,
        )}
      >
        <g stroke="currentColor" strokeWidth="1" strokeLinecap="round">
          <path
            vectorEffect="non-scaling-stroke"
            d="M -20 220 C 70 198, 120 142, 210 146 C 300 150, 345 104, 430 98 C 510 92, 560 56, 625 48"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M 10 242 C 110 215, 165 166, 250 172 C 335 178, 392 132, 476 126 C 542 121, 580 94, 630 84"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M 85 262 C 168 232, 224 196, 304 202 C 384 208, 435 164, 514 156 C 568 150, 598 134, 628 122"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M 278 74 C 318 48, 388 38, 444 58 C 482 72, 486 112, 440 128 C 392 144, 326 138, 286 114 C 262 100, 258 88, 278 74 Z"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M 326 78 C 354 64, 398 60, 422 76 C 440 88, 432 108, 404 114 C 370 120, 336 112, 322 98 C 314 90, 314 84, 326 78 Z"
          />
        </g>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 1200 280"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
      data-topo-variant="hero"
      data-variant="hero"
      className={cn(
        'rp-topo-layer pointer-events-none select-none absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)] text-[#111113] dark:text-[#F5F5F7]',
        className,
      )}
    >
      <g stroke="currentColor" strokeOpacity="0.045" strokeWidth="1" strokeLinecap="round">
        <path
          vectorEffect="non-scaling-stroke"
          d="M -40 230 C 120 198, 240 120, 390 132 C 530 144, 610 74, 750 68 C 900 62, 1015 110, 1240 44"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M 20 262 C 175 224, 285 154, 430 166 C 565 178, 650 108, 788 102 C 928 96, 1045 142, 1240 82"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M 140 286 C 275 248, 370 190, 495 198 C 618 206, 705 142, 835 138 C 965 134, 1070 176, 1240 124"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M 670 46 C 728 18, 822 14, 886 38 C 942 58, 948 106, 892 128 C 826 152, 728 144, 676 112 C 638 88, 636 62, 670 46 Z"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M 728 56 C 770 38, 832 36, 868 54 C 896 68, 892 94, 856 106 C 810 120, 752 114, 724 92 C 708 80, 708 64, 728 56 Z"
        />
      </g>
      <path
        vectorEffect="non-scaling-stroke"
        d="M -30 202 C 138 172, 250 96, 396 108 C 534 120, 620 48, 760 44 C 912 40, 1028 84, 1240 18"
        stroke="#ff3b30"
        strokeOpacity="0.055"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Razor-thin 1px hairline divider carrying an intermittent GPU-composited crimson
 * ECG pulse sweep tied to the RacePulse identity.
 */
export function PulseDivider({
  surface = 'section',
  delaySec = 0,
  className = '',
}: {
  surface?: 'nav' | 'section';
  delaySec?: number;
  className?: string;
}) {
  const isVisible = useDocumentVisible();
  const gradientId = useId();
  const gradKey = `rp-ecg-grad-${gradientId.replace(/:/g, '')}`;

  return (
    <div
      aria-hidden="true"
      data-pulse-surface={surface}
      className={cn(
        'rp-pulse-divider pointer-events-none select-none relative h-px w-full',
        surface === 'nav' ? 'bg-white/12' : 'bg-[var(--border-default)]',
        className,
      )}
    >
      <div className="rp-pulse-track pointer-events-none absolute inset-x-0 top-1/2 h-[14px] -translate-y-1/2 overflow-hidden">
        <div
          className="rp-pulse-traveler w-full h-full"
          data-paused={isVisible ? undefined : 'true'}
          style={delaySec > 0 ? { animationDelay: `${delaySec}s` } : undefined}
        >
          <svg
            width="180"
            height="14"
            viewBox="0 0 180 14"
            fill="none"
            className="block h-[14px] w-[180px]"
          >
            <defs>
              <linearGradient id={gradKey} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ff3b30" stopOpacity="0" />
                <stop offset="32%" stopColor="#ff3b30" stopOpacity="0.55" />
                <stop offset="50%" stopColor="#ff6259" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#ff3b30" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#ff3b30" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M 0 7 L 74 7 L 82 7 L 86 9.5 L 91 1.5 L 96 12.5 L 101 5 L 105 7 L 180 7"
              stroke={`url(#${gradKey})`}
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <span className="rp-pulse-static-tick" />
      </div>
    </div>
  );
}

/**
 * Tiny breathing green RFID timing-chip status dot for active registration pills
 * and verified monospace finish-time badges.
 */
export function TimingChipDot({ className = '' }: { className?: string }) {
  const isVisible = useDocumentVisible();

  return (
    <span
      aria-hidden="true"
      data-timing-chip-dot="true"
      className={cn(
        'relative inline-flex h-2 w-2 shrink-0 items-center justify-center',
        className,
      )}
    >
      <span
        data-paused={isVisible ? undefined : 'true'}
        className="rp-chip-dot-ring pointer-events-none absolute inset-0 rounded-full bg-emerald-500/60 dark:bg-emerald-400/60"
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
    </span>
  );
}

/**
 * Viewport-aware digital gantry counter that ticks up over ~350ms when scrolled
 * into view or when filters update, locking strictly on the exact value.
 */
export function OdometerNumber({
  value,
  durationMs = 350,
  format,
  className = '',
}: {
  value: number;
  durationMs?: number;
  format?: (val: number) => string;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLSpanElement>(null);
  const [hasEntered, setHasEntered] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const prevTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion || hasEntered) {
      if (!hasEntered) setHasEntered(true);
      return;
    }

    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setHasEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEntered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [prefersReducedMotion, hasEntered]);

  useEffect(() => {
    if (prefersReducedMotion || !hasEntered) {
      prevTargetRef.current = value;
      setDisplayValue(value);
      return;
    }

    const isInitialRoll = prevTargetRef.current === null || prevTargetRef.current === value;
    const from = isInitialRoll
      ? value <= 12
        ? 0
        : Math.round(value * 0.35)
      : prevTargetRef.current!;

    prevTargetRef.current = value;

    if (from === value) {
      setDisplayValue(value);
      return;
    }

    const delta = value - from;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      setDisplayValue(progress >= 1 ? value : Math.round(next));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, hasEntered, prefersReducedMotion, durationMs]);

  const formatted = format
    ? format(displayValue)
    : displayValue.toLocaleString('en-PH');

  return (
    <span ref={hostRef} className={cn('tabular-nums', className)}>
      {formatted}
    </span>
  );
}

export interface GlidingFilterItem {
  value: string;
  label: string;
}

/**
 * Filter bar powered by a shared LayoutGroup spring pill (stiffness: 380,
 * damping: 32) so the crimson indicator glides smoothly between options.
 */
export function GlidingFilterBar({
  groupId,
  ariaLabel,
  items,
  activeValue,
  onChange,
  variant = 'chips',
  className = '',
}: {
  groupId: string;
  ariaLabel: string;
  items: GlidingFilterItem[];
  activeValue: string;
  onChange: (value: string) => void;
  variant?: 'chips' | 'segmented';
  className?: string;
}) {
  const pillId = `${groupId}-pill`;

  if (variant === 'segmented') {
    return (
      <LayoutGroup id={groupId}>
        <div
          role="group"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex items-center p-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] self-start lg:self-auto shrink-0',
            className,
          )}
        >
          {items.map((item) => {
            const active = activeValue === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(item.value)}
                className={cn(
                  'relative min-h-11 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400',
                  active
                    ? 'text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {active && (
                  <m.span
                    layoutId={pillId}
                    transition={KINETIC_SPRING}
                    aria-hidden="true"
                    className="rp-filter-pill pointer-events-none absolute inset-0 rounded-lg bg-red-700"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    );
  }

  return (
    <LayoutGroup id={groupId}>
      <div
        className={cn('landing-stats-chip-group', className)}
        role="group"
        aria-label={ariaLabel}
      >
        {items.map((item) => {
          const active = activeValue === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.value)}
              className={cn('landing-distance', active && 'is-active')}
            >
              {active && (
                <m.span
                  layoutId={pillId}
                  transition={KINETIC_SPRING}
                  aria-hidden="true"
                  className="rp-filter-pill pointer-events-none absolute inset-0 rounded-[11px] bg-red-700"
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/**
 * Tactile race card frame with zero-rerender pointer tracking (--rp-mx / --rp-my
 * for radial crimson border glow, --rp-topo-x / --rp-topo-y for trail contours)
 * and overflow-clipped 1.03x poster hover zoom.
 */
export function KineticRaceCard({
  isTrail = false,
  isSelected = false,
  className = '',
  children,
}: {
  isTrail?: boolean;
  isSelected?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || e.pointerType !== 'mouse') return;
    const node = cardRef.current;
    if (!node) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      node.style.setProperty('--rp-mx', `${x.toFixed(1)}px`);
      node.style.setProperty('--rp-my', `${y.toFixed(1)}px`);
      if (isTrail) {
        const nx = (x / rect.width - 0.5) * 2;
        const ny = (y / rect.height - 0.5) * 2;
        node.style.setProperty('--rp-topo-x', `${(nx * -5).toFixed(2)}px`);
        node.style.setProperty('--rp-topo-y', `${(ny * -5).toFixed(2)}px`);
      }
    });
  };

  const handlePointerLeave = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const node = cardRef.current;
    if (!node) return;
    node.style.removeProperty('--rp-mx');
    node.style.removeProperty('--rp-my');
    if (isTrail) {
      node.style.setProperty('--rp-topo-x', '0px');
      node.style.setProperty('--rp-topo-y', '0px');
    }
  };

  return (
    <div
      ref={cardRef}
      data-trail-race={isTrail ? 'true' : undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn(
        'rp-race-card group/race relative w-full min-w-0 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] overflow-hidden flex flex-col justify-between transition-colors duration-150',
        isSelected && 'ring-2 ring-red-700 dark:ring-red-400 border-red-700 dark:border-red-400',
        className,
      )}
    >
      <span aria-hidden="true" className="rp-race-card-glow" />
      {children}
    </div>
  );
}

/**
 * Laminated Tyvek finisher bib card with subtle fiber grain, pointer-tracked
 * diagonal specular sheen, and restrained 3-4 deg 3D perspective lift.
 */
export function KineticBibCard({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion || e.pointerType !== 'mouse') return;
    const node = cardRef.current;
    if (!node) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height) * 2 - 1));
      const rx = (-ny * 3.5).toFixed(2);
      const ry = (nx * 3.5).toFixed(2);
      const sheenX = ((nx + 1) * 50).toFixed(1);
      node.style.setProperty('--rp-rx', `${rx}deg`);
      node.style.setProperty('--rp-ry', `${ry}deg`);
      node.style.setProperty('--rp-lift', '-3px');
      node.style.setProperty('--rp-sheen-x', `${sheenX}%`);
    });
  };

  const handlePointerLeave = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const node = cardRef.current;
    if (!node) return;
    node.style.setProperty('--rp-rx', '0deg');
    node.style.setProperty('--rp-ry', '0deg');
    node.style.setProperty('--rp-lift', '0px');
    node.style.setProperty('--rp-sheen-x', '50%');
  };

  return (
    <article
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn(
        'rp-bib-card relative w-full min-w-0 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] flex flex-col justify-between overflow-hidden',
        className,
      )}
    >
      <span aria-hidden="true" className="rp-tyvek-grain" />
      <span aria-hidden="true" className="rp-tyvek-sheen" />
      {children}
    </article>
  );
}

/**
 * Seamless 96x96 geometric red tribal pattern inspired by Bukidnon / Philippine
 * highland woven textiles, edge-weighted with a radial vignette so foreground
 * content and auth controls maintain full contrast.
 */
export function RedTribalPatternBackdrop({
  variant = 'landing',
  className = '',
}: {
  variant?: 'landing' | 'auth';
  className?: string;
}) {
  const patternId = useId();
  const patKey = `rp-tribal-pat-${patternId.replace(/:/g, '')}`;

  return (
    <div
      aria-hidden="true"
      data-tribal-backdrop={variant}
      className={cn('rp-tribal-backdrop', className)}
    >
      {variant === 'auth' && <div className="rp-tribal-auth-vignette" />}
      <svg
        className="rp-tribal-pattern-svg h-full w-full"
        width="100%"
        height="100%"
        fill="none"
      >
        <defs>
          <pattern id={patKey} width="96" height="96" patternUnits="userSpaceOnUse">
            {/* Parallel weaver boundary threads (connect seamlessly across horizontal tile seams) */}
            <path
              d="M 0 3 L 96 3 M 0 19 L 96 19 M 0 77 L 96 77 M 0 93 L 96 93"
              stroke="currentColor"
              strokeWidth="0.75"
              strokeOpacity="0.65"
            />

            {/* Interlocking top and bottom highland chevron bands */}
            <path
              d="M 0 16 L 12 4 L 24 16 L 36 4 L 48 16 L 60 4 L 72 16 L 84 4 L 96 16"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
            <path
              d="M 0 92 L 12 80 L 24 92 L 36 80 L 48 92 L 60 80 L 72 92 L 84 80 L 96 92"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />

            {/* Central stepped ancestral diamond (mata / highland lozenge) */}
            <path
              d="M 48 20 L 76 48 L 48 76 L 20 48 Z"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="miter"
            />
            <path
              d="M 48 29 L 67 48 L 48 67 L 29 48 Z"
              stroke="currentColor"
              strokeWidth="1.05"
              strokeLinejoin="miter"
            />
            <path
              d="M 48 41 L 55 48 L 48 55 L 41 48 Z"
              fill="currentColor"
              fillOpacity="0.6"
            />

            {/* Seamless horizontal link bars & split edge half-diamonds */}
            <path
              d="M 0 48 L 14 48 M 82 48 L 96 48"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <path
              d="M 0 43 L 5 48 L 0 53 M 96 43 L 91 48 L 96 53"
              fill="currentColor"
              fillOpacity="0.55"
            />

            {/* Quadrant notched chevron hooks */}
            <path
              d="M 0 28 L 12 28 L 18 34 M 96 28 L 84 28 L 78 34 M 0 68 L 12 68 L 18 62 M 96 68 L 84 68 L 78 62"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="square"
            />

            {/* 4 woven micro-diamond nodes */}
            <path
              d="M 24 21 L 27 24 L 24 27 L 21 24 Z M 72 21 L 75 24 L 72 27 L 69 24 Z M 24 69 L 27 72 L 24 75 L 21 72 Z M 72 69 L 75 72 L 72 75 L 69 72 Z"
              fill="currentColor"
              fillOpacity="0.7"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patKey})`} />
      </svg>
    </div>
  );
}
