import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, User } from 'lucide-react';
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
  const [identityPinned, setIdentityPinned] = useState(false);
  const [identityHovered, setIdentityHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; bottom: number } | null>(null);
  const identityWrapRef = useRef<HTMLDivElement>(null);

  const showIdentityTooltip = identityPinned || identityHovered;

  useLayoutEffect(() => {
    if (!showIdentityTooltip) {
      setTooltipPos(null);
      return;
    }

    const updatePosition = () => {
      const el = identityWrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTooltipPos(null);
        return;
      }
      setTooltipPos({
        left: Math.round(rect.right + 10),
        bottom: Math.round(Math.max(12, window.innerHeight - rect.bottom)),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showIdentityTooltip, collapsed]);

  useEffect(() => {
    if (!identityPinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (identityWrapRef.current && !identityWrapRef.current.contains(event.target as Node)) {
        setIdentityPinned(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIdentityPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [identityPinned]);

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

  const displayName = profile.displayName || profile.nickname || 'Account';
  const shortName = profile.nickname || profile.displayName || 'Account';
  const roleLabel = roleDisplayLabel(profile.role);
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
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate leading-tight">{shortName}</p>
          <p className="text-xs font-normal text-zinc-700 dark:text-zinc-300 truncate mt-0.5">
            {roleLabel}
          </p>
        </div>
      )}
    </>
  );

  return (
    <aside
      aria-label={`${spaceTitle} navigation`}
      className={`hidden lg:flex lg:flex-col lg:self-start desktop-workspace-sidebar lg:z-30 shrink-0 border-r border-[var(--border-default)] bg-[var(--surface-card)] ${
        collapsed ? 'w-20' : 'w-60'
      }`}
    >
      <div className="px-2.5 py-2.5 border-b border-[var(--border-subtle)] space-y-2.5 shrink-0">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-2'}`}>
          {!collapsed && (
            <span className="px-2 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 truncate">
              {spaceTitle}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-11 h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-zinc-700 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] flex items-center justify-center transition-colors duration-150 shrink-0 ${focusRing}`}
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
              className={`min-h-11 rounded-lg flex items-center transition-colors duration-150 ${focusRing} ${
                collapsed ? 'w-full py-1.5 px-1 flex-col justify-center gap-0.5 text-[10px] font-semibold' : 'w-full px-3 py-2 gap-2.5 text-left text-sm font-semibold'
              } ${
                workspaceSwitch.current === 'operations'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-zinc-700 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-full">{collapsed ? 'Ops' : 'Operations'}</span>
            </button>
            <button
              type="button"
              onClick={() => workspaceSwitch.onSelect('personal')}
              aria-pressed={workspaceSwitch.current === 'personal'}
              aria-label="My participation workspace"
              title={collapsed ? 'My participation' : undefined}
              className={`min-h-11 rounded-lg flex items-center transition-colors duration-150 ${focusRing} ${
                collapsed ? 'w-full py-1.5 px-1 flex-col justify-center gap-0.5 text-[10px] font-semibold' : 'w-full px-3 py-2 gap-2.5 text-left text-sm font-semibold'
              } ${
                workspaceSwitch.current === 'personal'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-zinc-700 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <User className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-full">{collapsed ? 'Runner' : 'My participation'}</span>
            </button>
          </div>
        )}
      </div>

      <nav
        aria-label={navLabel}
        data-workspace-nav="desktop"
        className="racepulse-sidebar-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-2.5 py-2 space-y-1"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            aria-current={item.active ? 'page' : undefined}
            title={item.label}
            className={`min-h-11 rounded-xl flex items-center transition-colors duration-150 ${focusRing} ${
              collapsed
                ? 'w-full py-1.5 px-1 flex-col justify-center gap-1 text-[10px] leading-tight font-semibold'
                : 'w-full px-3 py-2 gap-3 text-left text-sm font-semibold'
            } ${
              item.active
                ? 'bg-red-700 text-white shadow-sm'
                : 'text-zinc-700 dark:text-zinc-300 hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            <span className="shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px]" aria-hidden="true">
              {item.icon}
            </span>
            <span className={collapsed ? 'truncate max-w-full text-center' : 'truncate'}>
              {collapsed ? (item.shortLabel || item.label) : item.label}
            </span>
          </button>
        ))}
      </nav>

      <div className="px-2.5 py-2.5 border-t border-[var(--border-subtle)] space-y-2 shrink-0">
        <div
          ref={identityWrapRef}
          className="relative"
          onMouseEnter={() => setIdentityHovered(true)}
          onMouseLeave={() => setIdentityHovered(false)}
          onFocus={() => setIdentityHovered(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIdentityHovered(false);
            }
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (onOpenProfile) {
                setIdentityHovered(false);
                onOpenProfile();
              } else {
                setIdentityPinned((prev) => !prev);
              }
            }}
            aria-expanded={!onOpenProfile ? identityPinned : undefined}
            aria-describedby={showIdentityTooltip && tooltipPos ? 'sidebar-identity-tooltip' : undefined}
            aria-label={`${displayName} (${roleLabel})`}
            title={`${displayName} (${roleLabel})`}
            className={`min-h-11 rounded-xl hover:bg-[var(--surface-hover)] flex items-center transition-colors duration-150 ${focusRing} ${
              collapsed ? 'w-11 mx-auto justify-center' : 'w-full px-2 py-2 gap-3 text-left'
            }`}
          >
            {identityMarkup}
          </button>

          {showIdentityTooltip &&
            tooltipPos &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                id="sidebar-identity-tooltip"
                role="tooltip"
                style={{ left: `${tooltipPos.left}px`, bottom: `${tooltipPos.bottom}px` }}
                className="fixed z-[45] max-w-[min(20rem,calc(100vw-6rem))] min-w-[15rem] rounded-xl border border-white/15 bg-[#141416] text-white p-3 shadow-2xl pointer-events-none"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-400">{roleLabel}</p>
                <p className="text-sm font-semibold text-white break-words mt-0.5">{displayName}</p>
                {profile.email && (
                  <p className="text-xs text-zinc-300 break-all mt-0.5">{profile.email}</p>
                )}
              </div>,
              document.body,
            )}
        </div>

        <button
          type="button"
          onClick={() => signOutUser()}
          aria-label="Sign out"
          title="Sign Out"
          className={`min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] font-semibold uppercase tracking-wider text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400 hover:border-red-600/50 hover:bg-[var(--surface-hover)] flex items-center justify-center transition-colors duration-150 ${focusRing} ${
            collapsed ? 'w-full py-1.5 px-1 flex-col gap-0.5 text-[10px]' : 'w-full px-3 py-2 gap-2 text-xs'
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{collapsed ? 'Exit' : 'Sign Out'}</span>
        </button>
      </div>
    </aside>
  );
}
