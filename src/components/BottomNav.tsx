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
  variant?: 'floating' | 'docked';
  splitBreakpoint?: 'lg' | 'md600';
  hidden?: boolean;
}

// Mobile bottom tab bar (< 1024px for standard workspaces, < 600px when md600 split rail is active).
// Supports compact docked 56px + safe-area mode with automatic IME hiding for Runner UI.
export default function BottomNav({
  items,
  navLabel = 'Workspace navigation',
  variant = 'floating',
  splitBreakpoint = 'lg',
  hidden = false,
}: BottomNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const suppressClickRef = useRef(false);

  const activeKey = items.find((item) => item.active)?.key;
  const hideBreakpointClass = splitBreakpoint === 'md600' ? 'min-[600px]:hidden' : 'lg:hidden';

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

  if (hidden) return null;

  if (variant === 'docked') {
    return (
      <nav
        aria-label={navLabel}
        data-workspace-nav="mobile"
        data-nav-variant="docked"
        className={`${hideBreakpointClass} fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border-default)] bg-[var(--surface-card)] pb-[var(--rp-safe-bottom)] pl-[var(--rp-safe-left)] pr-[var(--rp-safe-right)]`}
      >
        <div className="h-[56px] w-full flex items-stretch justify-around px-1 gap-0.5">
          {items.map((item) => {
            const compactText = item.shortLabel || item.label;
            return (
              <button
                key={item.key}
                ref={(node) => {
                  itemRefs.current[item.key] = node;
                }}
                type="button"
                onClick={item.onClick}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
                className={`relative flex-1 min-w-0 min-h-[44px] my-1 px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  item.active
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span aria-hidden="true" className="flex items-center justify-center shrink-0">
                  {item.icon}
                </span>
                <span className="w-full truncate text-center text-[11px] leading-tight font-semibold">
                  {compactText}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label={navLabel}
      data-workspace-nav="mobile"
      className={`${hideBreakpointClass} fixed bottom-0 inset-x-0 z-40 flex justify-center pb-[max(0.75rem,var(--rp-safe-bottom))] pl-[max(0.5rem,var(--rp-safe-left))] pr-[max(0.5rem,var(--rp-safe-right))] sm:pl-[max(1rem,var(--rp-safe-left))] sm:pr-[max(1rem,var(--rp-safe-right))] pointer-events-none`}
    >
      <div className="glass-panel w-full max-w-6xl overflow-hidden pointer-events-auto">
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
                  className={`relative flex min-w-fit min-h-11 shrink-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 sm:px-4 rounded-xl cursor-pointer transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    item.active
                      ? 'bg-red-700 text-white'
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
