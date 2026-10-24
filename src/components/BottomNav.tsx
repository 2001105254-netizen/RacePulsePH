import React from 'react';

export interface BottomNavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

// Floating mobile-style tab bar, shared across the Admin, Organizer, and Runner
// dashboards so navigation stays reachable one-thumb on-site instead of at the
// top of a scrolled page.
export default function BottomNav({ items }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] px-2 sm:px-4 pointer-events-none">
      <div className="glass-panel flex w-full max-w-xl items-center justify-between gap-0.5 px-1.5 py-1.5 sm:gap-1 sm:px-2 sm:py-2 shadow-2xl pointer-events-auto">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={item.onClick}
            aria-label={item.label}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 sm:px-4 rounded-[14px] sm:rounded-[16px] transition ${
              item.active
                ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {item.icon}
            <span className="max-w-full truncate text-[8px] sm:text-[9px] font-black uppercase tracking-wide">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
