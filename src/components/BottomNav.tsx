import React, { useEffect, useRef } from 'react';

export interface WorkspaceNavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  shortLabel?: string;
  active: boolean;
  onClick: () => void;
}

export type BottomNavItem = WorkspaceNavItem;

interface BottomNavProps {
  items: WorkspaceNavItem[];
  navLabel?: string;
}

// Mobile-only floating tab bar (< 1024px), keeping primary destinations
// horizontally scrollable with no visible scrollbar across touch, wheel, and drag inputs.
export default function BottomNav({ items, navLabel = 'Workspace navigation' }: BottomNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const suppressClickRef = useRef(false);

  const activeKey = items.find((item) => item.active)?.key;

  // Map vertical wheel scrolling over the nav bar into horizontal scroll when tabs overflow.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && event.deltaY !== 0) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the active destination scrolled into view when navigating programmatically or via keyboard.
  useEffect(() => {
    if (!activeKey) return;
    const activeEl = itemRefs.current[activeKey];
    if (!activeEl) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeEl.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [activeKey]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;

    const startX = event.clientX;
    const startScrollLeft = el.scrollLeft;
    let moved = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
      }
      if (moved) {
        el.scrollLeft = startScrollLeft - dx;
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    const onPointerUp = () => {
      cleanup();
      if (moved) {
        suppressClickRef.current = true;
        window.requestAnimationFrame(() => {
          suppressClickRef.current = false;
        });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  return (
    <nav
      aria-label={navLabel}
      data-workspace-nav="mobile"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex justify-center pb-[max(0.75rem,var(--rp-safe-bottom))] pl-[max(0.5rem,var(--rp-safe-left))] pr-[max(0.5rem,var(--rp-safe-right))] sm:pl-[max(1rem,var(--rp-safe-left))] sm:pr-[max(1rem,var(--rp-safe-right))] pointer-events-none"
    >
      <div className="glass-panel w-full max-w-6xl overflow-hidden shadow-2xl pointer-events-auto">
        <div
          ref={scrollRef}
          onPointerDown={handlePointerDown}
          onClickCapture={handleClickCapture}
          className="racepulse-horizontal-scroll touch-pan-x w-full select-none"
        >
          <div className="flex min-w-full w-max items-center gap-1 p-2">
              {items.map((item) => (
                <button
                  key={item.key}
                  ref={(node) => {
                    itemRefs.current[item.key] = node;
                  }}
                  type="button"
                  onClick={item.onClick}
                  aria-label={item.label}
                  aria-current={item.active ? 'page' : undefined}
                  className={`relative flex min-w-fit min-h-11 shrink-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 sm:px-4 rounded-[14px] sm:rounded-[16px] transition-colors duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    item.active
                      ? 'bg-red-700 text-white shadow-lg shadow-red-900/30'
                      : 'text-zinc-700 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span aria-hidden="true" className="flex items-center justify-center">
                    {item.icon}
                  </span>
                  <span className="whitespace-nowrap text-xs font-semibold tracking-wide">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
        </div>
      </div>
    </nav>
  );
}
