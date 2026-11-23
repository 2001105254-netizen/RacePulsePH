import React from 'react';
import { SlidersHorizontal, User } from 'lucide-react';
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
  splitLocked?: boolean;
  mobileBreakpoint?: 'lg' | 'md600';
  bottomNavVariant?: 'floating' | 'docked';
  hideBottomNav?: boolean;
  compactGutters?: boolean;
  onOpenProfile?: () => void;
  children: React.ReactNode;
}

// Separates desktop (>= 1024px) sidebar navigation, medium foldable/landscape (>= 600px)
// vertical NavigationRail when requested, and mobile bottom navigation.
export default function WorkspaceShell({
  spaceTitle,
  navLabel,
  items,
  profile,
  workspaceSwitch,
  pendingApprovalNotice = false,
  maxWidthClass = 'max-w-7xl',
  desktopLocked = false,
  splitLocked = false,
  mobileBreakpoint = 'lg',
  bottomNavVariant = 'floating',
  hideBottomNav = false,
  compactGutters = false,
  onOpenProfile,
  children,
}: WorkspaceShellProps) {
  const showMediumRail = mobileBreakpoint === 'md600';
  const avatarInitial = (profile.nickname || profile.displayName || 'R').trim().charAt(0).toUpperCase() || 'R';

  const outerLockClass = splitLocked
    ? 'flex-1 min-h-0 overflow-hidden'
    : desktopLocked
      ? 'lg:flex-1 lg:min-h-0 lg:overflow-hidden'
      : '';

  const mainLockClass = splitLocked
    ? 'min-h-0 flex flex-col overflow-hidden'
    : desktopLocked
      ? 'lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden'
      : '';

  const innerContentClass = (() => {
    if (splitLocked) {
      return `w-full flex-1 min-h-0 flex flex-col ${
        hideBottomNav
          ? 'pb-[var(--rp-safe-bottom)]'
          : 'pb-[calc(3.5rem+var(--rp-safe-bottom))] min-[600px]:pb-0'
      }`;
    }
    if (desktopLocked) {
      return `w-full ${compactGutters ? 'px-3 sm:px-4 pt-2 space-y-2' : 'px-3 sm:px-4 pt-2 space-y-2'} ${
        hideBottomNav ? 'pb-[var(--rp-safe-bottom)]' : 'pb-[calc(5.5rem+var(--rp-safe-bottom))]'
      } lg:space-y-0 lg:max-w-none lg:px-0 lg:py-0 lg:pb-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col`;
    }
    if (compactGutters) {
      return `w-full ${maxWidthClass} mx-auto px-3 sm:px-4 py-2 ${
        hideBottomNav
          ? 'pb-[calc(1rem+var(--rp-safe-bottom))]'
          : 'pb-[calc(4.5rem+var(--rp-safe-bottom))] min-[600px]:pb-4'
      } space-y-3`;
    }
    return `w-full ${maxWidthClass} mx-auto px-4 sm:px-6 xl:px-8 py-4 sm:py-6 pb-[calc(7rem+var(--rp-safe-bottom))] lg:pb-12 space-y-6`;
  })();

  return (
    <div
      data-desktop-locked={desktopLocked ? 'true' : undefined}
      data-split-locked={splitLocked ? 'true' : undefined}
      className={`w-full flex-grow flex flex-col ${
        showMediumRail ? 'min-[600px]:flex-row' : 'lg:flex-row'
      } min-w-0 ${outerLockClass}`}
    >
      <DesktopSidebar
        spaceTitle={spaceTitle}
        navLabel={navLabel}
        items={items}
        profile={profile}
        workspaceSwitch={workspaceSwitch}
        onOpenProfile={onOpenProfile}
      />

      {showMediumRail && (
        <aside
          aria-label={`${spaceTitle} navigation rail`}
          data-workspace-nav="rail"
          className="hidden min-[600px]:flex lg:hidden flex-col w-16 shrink-0 border-r border-[var(--border-default)] bg-[var(--surface-card)] py-2 pl-[var(--rp-safe-left)] items-center justify-between gap-2 z-30 min-h-0"
        >
          {workspaceSwitch && (
            <div
              role="group"
              aria-label="Workspace mode"
              className="flex flex-col gap-1 px-1 w-full shrink-0 border-b border-[var(--border-subtle)] pb-2"
            >
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('operations')}
                aria-pressed={workspaceSwitch.current === 'operations'}
                aria-label="Operations workspace"
                className={`min-h-[44px] w-full rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
                  workspaceSwitch.current === 'operations'
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ops</span>
              </button>
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('personal')}
                aria-pressed={workspaceSwitch.current === 'personal'}
                aria-label="My participation workspace"
                className={`min-h-[44px] w-full rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${
                  workspaceSwitch.current === 'personal'
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <User className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Run</span>
              </button>
            </div>
          )}

          <nav
            aria-label={navLabel}
            className="flex-1 min-h-0 w-full overflow-y-auto overscroll-y-contain flex flex-col items-center gap-1 px-1"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
                title={item.label}
                className={`w-full min-h-[48px] px-1 py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 shrink-0 ${
                  item.active
                    ? 'bg-red-700 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span aria-hidden="true" className="flex items-center justify-center">
                  {item.icon}
                </span>
                <span className="w-full truncate text-center text-xs leading-tight font-semibold">
                  {item.shortLabel || item.label}
                </span>
              </button>
            ))}
          </nav>

          {onOpenProfile && (
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label={`Open profile settings for ${profile.displayName}`}
              title="Profile & Settings"
              className="w-11 h-11 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] overflow-hidden flex items-center justify-center text-xs font-semibold text-red-700 dark:text-red-400 shrink-0 hover:border-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              {profile.photoURL ? (
                <img src={profile.photoURL} alt="" width={44} height={44} className="w-full h-full object-cover" />
              ) : (
                <span aria-hidden="true">{avatarInitial}</span>
              )}
            </button>
          )}
        </aside>
      )}

      <main
        id="main-content"
        tabIndex={-1}
        aria-label={spaceTitle}
        className={`flex-1 min-w-0 pl-[var(--rp-safe-left)] pr-[var(--rp-safe-right)] ${
          showMediumRail ? 'min-[600px]:pl-0' : 'lg:pl-0'
        } focus:outline-none ${mainLockClass}`}
      >
        {workspaceSwitch && (
          <div
            className={`${showMediumRail ? 'min-[600px]:hidden' : 'lg:hidden'} ${
              compactGutters ? 'px-3 pt-2' : 'px-4 pt-4'
            }`}
          >
            <div
              role="group"
              aria-label="Workspace mode"
              className={`${
                compactGutters
                  ? 'w-full p-0.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-default)] grid grid-cols-2 gap-1'
                  : 'max-w-md mx-auto p-1 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] grid grid-cols-2 gap-1 shadow-sm'
              }`}
            >
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('operations')}
                aria-pressed={workspaceSwitch.current === 'operations'}
                className={`relative ${
                  compactGutters ? 'min-h-11 px-2 py-1 rounded-lg text-xs' : 'min-h-11 px-3 py-2 rounded-xl text-sm'
                } font-semibold transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  workspaceSwitch.current === 'operations'
                    ? 'bg-red-700 text-white'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                Operations
              </button>
              <button
                type="button"
                onClick={() => workspaceSwitch.onSelect('personal')}
                aria-pressed={workspaceSwitch.current === 'personal'}
                className={`relative ${
                  compactGutters ? 'min-h-11 px-2 py-1 rounded-lg text-xs' : 'min-h-11 px-3 py-2 rounded-xl text-sm'
                } font-semibold transition-colors duration-150 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  workspaceSwitch.current === 'personal'
                    ? 'bg-red-700 text-white'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                My participation
              </button>
            </div>
          </div>
        )}

        <div className={innerContentClass}>
          {pendingApprovalNotice && (
            <div role="status" className="border-b border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-primary)]">
              Organizer operations are awaiting approval. Your personal features remain available.
            </div>
          )}
          {children}
        </div>
      </main>

      <BottomNav
        items={items}
        navLabel={navLabel}
        variant={bottomNavVariant}
        splitBreakpoint={mobileBreakpoint}
        hidden={hideBottomNav}
      />
    </div>
  );
}
