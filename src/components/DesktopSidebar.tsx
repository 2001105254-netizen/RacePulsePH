import { useState } from 'react';
import { Flag, LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import type { WorkspaceNavItem } from './BottomNav';

export interface WorkspaceSwitchProps {
  current: 'operations' | 'personal';
  onSelect: (next: 'operations' | 'personal') => void;
}

interface DesktopSidebarProps {
  spaceTitle: string;
  navLabel: string;
  items: WorkspaceNavItem[];
  profile: UserProfile;
  workspaceSwitch?: WorkspaceSwitchProps;
  onOpenProfile?: () => void;
}

const SIDEBAR_STORAGE_KEY = 'racepulse_sidebar_collapsed';

function readInitialCollapsed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function roleDisplayLabel(role: UserProfile['role']): string {
  switch (role) {
    case 'superadmin':
      return 'Super Admin';
    case 'admin':
      return 'Admin';
    case 'organizer':
      return 'Organizer';
    default:
      return 'Runner';
  }
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]';

// Desktop-only persistent left navigation rail (>= 1024px) sitting beneath the sticky top bar.
export default function DesktopSidebar({
  spaceTitle,
  navLabel,
  items,
  profile,
  workspaceSwitch,
  onOpenProfile,
}: DesktopSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Storage can be restricted in private browsing contexts; keep in-memory state.
      }
      return next;
    });
  };

  const displayName = profile.nickname || profile.displayName || 'Account';
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || 'R';

  const identityMarkup = (
    <>
      <div className="w-9 h-9 rounded-full overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-red-700 dark:text-red-400 font-semibold text-sm shrink-0">
        {profile.photoURL ? (
          <img src={profile.photoURL} alt="" width={36} height={36} className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden="true">{avatarInitial}</span>
        )}
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate leading-tight">{displayName}</p>
          <p className="text-xs font-normal text-zinc-600 dark:text-zinc-300 truncate mt-0.5">
            {roleDisplayLabel(profile.role)}
          </p>
        </div>
      )}
    </>
  );

  return (
    <aside
      aria-label={`${spaceTitle} navigation`}
      className={`hidden lg:flex lg:flex-col lg:self-start desktop-workspace-sidebar shrink-0 border-r border-[var(--border-default)] bg-[var(--surface-card)] ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className="px-3 py-3 border-b border-[var(--border-subtle)] space-y-3 shrink-0">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-2'}`}>
          {!collapsed && (
            <span className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 truncate">
              {spaceTitle}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-11 h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-zinc-600 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] flex items-center justify-center transition-colors duration-150 shrink-0 ${focusRing}`}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {workspaceSwitch && (
          <div
            role="group"
            aria-label="Workspace mode"
            className="p-1 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-default)] flex flex-col gap-1"
          >
            <button
              type="button"
              onClick={() => workspaceSwitch.onSelect('operations')}
              aria-pressed={workspaceSwitch.current === 'operations'}
              aria-label="Operations workspace"
              title={collapsed ? 'Operations' : undefined}
              className={`min-h-11 rounded-lg flex items-center text-sm font-semibold transition-colors duration-150 ${focusRing} ${
                collapsed ? 'w-11 mx-auto justify-center' : 'w-full px-3 py-2 gap-2.5 text-left'
              } ${
                workspaceSwitch.current === 'operations'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">Operations</span>}
            </button>
            <button
              type="button"
              onClick={() => workspaceSwitch.onSelect('personal')}
              aria-pressed={workspaceSwitch.current === 'personal'}
              aria-label="My participation workspace"
              title={collapsed ? 'My participation' : undefined}
              className={`min-h-11 rounded-lg flex items-center text-sm font-semibold transition-colors duration-150 ${focusRing} ${
                collapsed ? 'w-11 mx-auto justify-center' : 'w-full px-3 py-2 gap-2.5 text-left'
              } ${
                workspaceSwitch.current === 'personal'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <Flag className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">My participation</span>}
            </button>
          </div>
        )}
      </div>

      <nav
        aria-label={navLabel}
        data-workspace-nav="desktop"
        className="racepulse-sidebar-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-2.5 space-y-1"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={`min-h-11 rounded-xl flex items-center text-sm font-semibold transition-colors duration-150 ${focusRing} ${
              collapsed ? 'w-11 mx-auto justify-center' : 'w-full px-3 py-2 gap-3 text-left'
            } ${
              item.active
                ? 'bg-red-700 text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            <span className="shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px]" aria-hidden="true">
              {item.icon}
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-[var(--border-subtle)] space-y-2 shrink-0">
        {onOpenProfile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={collapsed ? `My Profile (${displayName})` : `Open profile for ${displayName}`}
            title={collapsed ? `Profile: ${displayName}` : 'My Profile'}
            className={`min-h-11 rounded-xl hover:bg-[var(--surface-hover)] flex items-center transition-colors duration-150 ${focusRing} ${
              collapsed ? 'w-11 mx-auto justify-center' : 'w-full px-2 py-2 gap-3 text-left'
            }`}
          >
            {identityMarkup}
          </button>
        ) : (
          <div
            title={collapsed ? `${displayName} (${roleDisplayLabel(profile.role)})` : undefined}
            className={`min-h-11 flex items-center ${collapsed ? 'justify-center' : 'px-2 py-1 gap-3'}`}
          >
            {identityMarkup}
          </div>
        )}

        <button
          type="button"
          onClick={() => signOutUser()}
          aria-label="Sign out"
          title={collapsed ? 'Sign Out' : undefined}
          className={`min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400 hover:border-red-600/50 hover:bg-[var(--surface-hover)] flex items-center justify-center transition-colors duration-150 ${focusRing} ${
            collapsed ? 'w-11 mx-auto' : 'w-full px-3 py-2 gap-2'
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
