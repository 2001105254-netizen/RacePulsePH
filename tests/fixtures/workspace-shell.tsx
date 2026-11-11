import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import WorkspaceShell from '../../src/components/WorkspaceShell';
import type { WorkspaceNavItem } from '../../src/components/BottomNav';
import type { UserProfile } from '../../src/types';
import {
  ArrowLeft, Award, ClipboardList, Flag, Moon, Printer, Radio, ShieldCheck, Sun, Trophy, Users, Users2,
} from 'lucide-react';

const syntheticProfile: UserProfile = {
  uid: 'fixture-superadmin',
  email: 'admin@example.test',
  displayName: 'Patrick Race Director',
  nickname: 'Patrick',
  role: 'superadmin',
  approved: true,
  createdAt: '2026-10-01T00:00:00Z',
};

function WorkspaceFixture() {
  const [dark, setDark] = useState(() => !new URLSearchParams(location.search).get('theme')?.includes('light'));
  const [space, setSpace] = useState<'operations' | 'personal'>('operations');
  const [adminTab, setAdminTab] = useState('engraving');
  const [runnerTab, setRunnerTab] = useState('events');
  const [profileOpenCount, setProfileOpenCount] = useState(0);

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  if (document.documentElement.classList.contains('dark') !== dark) {
    document.documentElement.classList.toggle('dark', dark);
  }

  const opsItems: WorkspaceNavItem[] = [
    { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'My Events', active: adminTab === 'events', onClick: () => setAdminTab('events') },
    { key: 'hub', icon: <Radio className="w-4 h-4" />, label: 'Live Hub', active: adminTab === 'hub', onClick: () => setAdminTab('hub') },
    { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: adminTab === 'engraving', onClick: () => setAdminTab('engraving') },
    { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Timing', active: adminTab === 'timing', onClick: () => setAdminTab('timing') },
    { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: adminTab === 'race', onClick: () => setAdminTab('race') },
    { key: 'bibstudio', icon: <Printer className="w-4 h-4" />, label: 'Bib Studio', active: adminTab === 'bibstudio', onClick: () => setAdminTab('bibstudio') },
    { key: 'organizers', icon: <Users className="w-4 h-4" />, label: 'Organizers', active: adminTab === 'organizers', onClick: () => setAdminTab('organizers') },
    { key: 'runners', icon: <Users2 className="w-4 h-4" />, label: 'Runners', active: adminTab === 'runners', onClick: () => setAdminTab('runners') },
    { key: 'access', icon: <ShieldCheck className="w-4 h-4" />, label: 'Access', active: adminTab === 'access', onClick: () => setAdminTab('access') },
  ];

  const runnerItems: WorkspaceNavItem[] = [
    { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'Events', active: runnerTab === 'events', onClick: () => setRunnerTab('events') },
    { key: 'allraces', icon: <Trophy className="w-4 h-4" />, label: 'All Races', active: runnerTab === 'allraces', onClick: () => setRunnerTab('allraces') },
    { key: 'myraces', icon: <ClipboardList className="w-4 h-4" />, label: 'My Races', active: runnerTab === 'myraces', onClick: () => setRunnerTab('myraces') },
    { key: 'friends', icon: <Users2 className="w-4 h-4" />, label: 'Friends', active: runnerTab === 'friends', onClick: () => setRunnerTab('friends') },
    { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: runnerTab === 'engraving', onClick: () => setRunnerTab('engraving') },
  ];

  const activeItems = space === 'operations' ? opsItems : runnerItems;
  const activeTabLabel = activeItems.find((item) => item.active)?.label || '';

  return (
    <div id="app_root" className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)] flex flex-col">
      <div className="ambient-glow fixed inset-0 -z-10 overflow-hidden pointer-events-none" />
      <nav className="sticky top-0 z-40 brand-nav" aria-label="Primary navigation">
        <div className="w-full min-w-0 px-3 sm:px-6 h-[4.5rem] sm:h-16 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => (space === 'operations' ? setAdminTab('engraving') : setRunnerTab('events'))}
              aria-label="Go back"
              className="w-11 h-11 rounded-full border border-white/15 bg-white/10 flex items-center justify-center text-white/90 hover:text-red-400"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-[10px] border border-white/15 flex items-center justify-center p-1 shrink-0">
                <img src="/assets/racepulse-mark.png" alt="RacePulsePH" width={28} height={28} className="w-full h-full object-contain" />
              </div>
              <span className="hidden min-w-0 truncate font-display font-semibold text-sm tracking-tight uppercase min-[560px]:inline text-white">
                RacePulse<span className="text-red-500">PH</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="w-11 h-11 rounded-full border border-white/15 bg-white/10 text-white/90 hover:text-red-400 flex items-center justify-center"
          >
            {dark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <WorkspaceShell
        spaceTitle={space === 'operations' ? 'Super Admin Console' : 'Runner Portal'}
        navLabel={space === 'operations' ? 'Operations navigation' : 'Runner navigation'}
        items={activeItems}
        profile={syntheticProfile}
        workspaceSwitch={{ current: space, onSelect: setSpace }}
        maxWidthClass={space === 'operations' ? 'max-w-[1800px]' : 'max-w-7xl'}
        onOpenProfile={space === 'personal' ? () => setProfileOpenCount((c) => c + 1) : undefined}
      >
        <div className="glass-panel hero-glow px-4 sm:px-6 py-5 space-y-2">
          <h1 className="heading-float text-2xl font-semibold tracking-tight font-display text-[var(--text-primary)] uppercase">
            Welcome, {syntheticProfile.displayName}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Active space: <strong data-testid="active-space">{space}</strong> / Active tab:{' '}
            <strong data-testid="active-tab">{activeTabLabel}</strong>
            {profileOpenCount > 0 && <span data-testid="profile-count"> (profile opened {profileOpenCount}x)</span>}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 18 }).map((_, idx) => (
            <section key={idx} className="glass-panel p-5 space-y-2">
              <h2 className="text-base font-semibold font-display text-[var(--text-primary)]">
                {activeTabLabel} Panel {idx + 1}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Synthetic workspace panel verifying desktop sidebar stickiness, mobile bottom bar clearance, and scroll behavior.
              </p>
            </section>
          ))}
        </div>
      </WorkspaceShell>

      <footer className="border-t border-[var(--border-default)] bg-[var(--surface-card)] mt-auto text-xs text-[var(--text-secondary)]">
        <div className="w-full flex flex-col md:flex-row items-center justify-between px-4 sm:px-6 py-4 gap-3">
          <span>&copy; {new Date().getFullYear()} RacePulsePH &bull; Happy running ka Racepulse!</span>
          <span className="font-mono">events@racepulseph.com</span>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceFixture />
  </React.StrictMode>
);
