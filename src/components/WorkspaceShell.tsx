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
  desktopLocked?: boolean;
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
  desktopLocked = false,
  onOpenProfile,
  children,
}: WorkspaceShellProps) {
  return (
    <div
      data-desktop-locked={desktopLocked ? 'true' : undefined}
      className={`w-full flex-grow flex flex-col lg:flex-row min-w-0 ${
        desktopLocked ? 'lg:flex-1 lg:min-h-0 lg:overflow-hidden' : ''
      }`}
    >
      <DesktopSidebar
        spaceTitle={spaceTitle}
        navLabel={navLabel}
        items={items}
        profile={profile}
        workspaceSwitch={workspaceSwitch}
        onOpenProfile={onOpenProfile}
      />

      <main
        id="main-content"
        tabIndex={-1}
        aria-label={spaceTitle}
        className={`flex-1 min-w-0 pl-[var(--rp-safe-left)] pr-[var(--rp-safe-right)] lg:pl-0 focus:outline-none ${
          desktopLocked ? 'lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden' : ''
        }`}
      >
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
                  className={`relative min-h-11 px-3 py-2 rounded-xl text-sm font-semibold transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    workspaceSwitch.current === 'operations'
                      ? 'bg-red-700 text-white shadow-sm'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Operations
                </button>
                <button
                  type="button"
                  onClick={() => workspaceSwitch.onSelect('personal')}
                  aria-pressed={workspaceSwitch.current === 'personal'}
                  className={`relative min-h-11 px-3 py-2 rounded-xl text-sm font-semibold transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    workspaceSwitch.current === 'personal'
                      ? 'bg-red-700 text-white shadow-sm'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  My participation
                </button>
              </div>
          </div>
        )}

        <div
          className={
            desktopLocked
              ? 'w-full px-3 sm:px-4 pt-2 pb-[calc(6rem+var(--rp-safe-bottom))] space-y-2 lg:space-y-0 lg:max-w-none lg:px-0 lg:py-0 lg:pb-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col'
              : `w-full ${maxWidthClass} mx-auto px-4 sm:px-6 xl:px-8 py-4 sm:py-6 pb-[calc(7rem+var(--rp-safe-bottom))] lg:pb-12 space-y-6`
          }
        >
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
