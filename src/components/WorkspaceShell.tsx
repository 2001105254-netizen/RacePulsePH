import React from 'react';
import { UserProfile } from '../types';
import BottomNav, { WorkspaceNavItem } from './BottomNav';
import DesktopSidebar, { WorkspaceSwitchProps } from './DesktopSidebar';

interface WorkspaceShellProps {
  spaceTitle: string;
  navLabel: string;
  items: WorkspaceNavItem[];
  profile: UserProfile;
  workspaceSwitch?: WorkspaceSwitchProps;
  pendingApprovalNotice?: boolean;
  maxWidthClass?: string;
  onOpenProfile?: () => void;
  children: React.ReactNode;
}

// Separates desktop (>= 1024px) sidebar navigation from mobile (< 1024px) bottom
// navigation across all signed-in dashboards.
export default function WorkspaceShell({
  spaceTitle,
  navLabel,
  items,
  profile,
  workspaceSwitch,
  pendingApprovalNotice = false,
  maxWidthClass = 'max-w-7xl',
  onOpenProfile,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="w-full flex-grow flex flex-col lg:flex-row min-w-0">
      <DesktopSidebar
        spaceTitle={spaceTitle}
        navLabel={navLabel}
        items={items}
        profile={profile}
        workspaceSwitch={workspaceSwitch}
        onOpenProfile={onOpenProfile}
      />

      <main aria-label={spaceTitle} className="flex-1 min-w-0">
        {workspaceSwitch && (
          <div className="lg:hidden px-4 pt-4">
            <div
              role="group"
              aria-label="Workspace mode"
              className="max-w-md mx-auto p-1 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] grid grid-cols-2 gap-1 shadow-sm"
            >
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('operations')}
                aria-pressed={workspaceSwitch.current === 'operations'}
                className={`min-h-11 px-3 py-2 rounded-xl text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  workspaceSwitch.current === 'operations'
                    ? 'bg-red-700 text-white'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                Operations
              </button>
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('personal')}
                aria-pressed={workspaceSwitch.current === 'personal'}
                className={`min-h-11 px-3 py-2 rounded-xl text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  workspaceSwitch.current === 'personal'
                    ? 'bg-red-700 text-white'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                My participation
              </button>
            </div>
          </div>
        )}

        <div className={`w-full ${maxWidthClass} mx-auto px-4 sm:px-6 xl:px-8 py-4 sm:py-6 pb-28 lg:pb-12 space-y-6`}>
          {pendingApprovalNotice && (
            <div role="status" className="glass-inset px-4 py-3 text-sm text-[var(--text-primary)]">
              Organizer operations are awaiting approval. Your personal features remain available.
            </div>
          )}
          {children}
        </div>
      </main>

      <BottomNav items={items} navLabel={navLabel} />
    </div>
  );
}
