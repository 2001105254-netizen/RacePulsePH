import React from 'react';

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
// reachable one-thumb while desktop viewports render DesktopSidebar instead.
export default function BottomNav({ items, navLabel = 'Workspace navigation' }: BottomNavProps) {
  return (
    <nav
      aria-label={navLabel}
      data-workspace-nav="mobile"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] px-2 sm:px-4 pointer-events-none"
    >
      <div className="glass-panel racepulse-horizontal-scroll flex w-full max-w-6xl items-center justify-between gap-1 px-1.5 py-1.5 sm:px-2 sm:py-2 shadow-2xl pointer-events-auto">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            className={`flex min-w-fit min-h-11 shrink-0 flex-1 flex-col items-center justify-center gap-1 px-3 py-1.5 sm:px-4 rounded-[14px] sm:rounded-[16px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
              item.active
                ? 'bg-red-700 text-white shadow-lg shadow-red-900/30'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            <span aria-hidden="true" className="flex items-center justify-center">
              {item.icon}
            </span>
            <span className="whitespace-nowrap text-xs font-semibold tracking-wide">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
