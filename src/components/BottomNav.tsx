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
    <nav className="fixed bottom-0 inset-x-0 z-40 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] px-4 pointer-events-none">
      <div className="glass-panel flex items-center gap-1 px-2 py-2 shadow-2xl pointer-events-auto max-w-full overflow-x-auto">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={item.onClick}
            className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-[16px] transition min-w-[64px] shrink-0 ${
              item.active
                ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {item.icon}
            <span className="text-[9px] font-black uppercase tracking-wide whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
