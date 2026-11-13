import { useEffect, useRef, useState } from 'react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import TimingConsole, { TimingLaunchRequest } from './TimingConsole';
import RaceSetupPanel, { RaceSetupLaunchRequest } from './RaceSetupPanel';
import MyRaceEventsPanel from './MyRaceEventsPanel';
import LiveBroadcastPanel, { LiveBroadcastLaunchRequest } from './LiveBroadcastPanel';
import WorkspaceShell from './WorkspaceShell';
import AccountPrivacyModal from './AccountPrivacyModal';
import OrganizerSetupGuide from './OrganizerSetupGuide';
import { AnimatedTabView, resolveTabDirection, type NavDirection } from './ui/MotionPrimitives';
import { BookOpen, LogOut, Radio, Flag, LayoutGrid, Tv, ShieldCheck } from 'lucide-react';

interface OrganizerDashboardProps {
  profile: UserProfile;
}

type OrganizerTab = 'myevents' | 'timing' | 'race' | 'broadcast';

const ORGANIZER_TAB_ORDER: readonly OrganizerTab[] = ['myevents', 'timing', 'broadcast', 'race'];

export default function OrganizerDashboard({ profile }: OrganizerDashboardProps) {
  const [tab, setTab] = useState<OrganizerTab>('myevents');
  const [tabDirection, setTabDirection] = useState<NavDirection>('forward');
  const [showAccountPrivacy, setShowAccountPrivacy] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const launchSeqRef = useRef(0);
  const [timingLaunch, setTimingLaunch] = useState<TimingLaunchRequest | null>(null);
  const [setupLaunch, setSetupLaunch] = useState<RaceSetupLaunchRequest | null>(null);
  const [hubLaunch, setHubLaunch] = useState<LiveBroadcastLaunchRequest | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const selectTab = (nextTab: OrganizerTab, explicitDirection?: NavDirection) => {
    const currentTab = tabRef.current;
    if (nextTab === currentTab) return;
    setTabDirection(explicitDirection ?? resolveTabDirection(ORGANIZER_TAB_ORDER, currentTab, nextTab));
    setTab(nextTab);
  };

  useEffect(() => {
    const goHome = (event: Event) => {
      const isHardware = (event as CustomEvent<{ hardware?: boolean }>).detail?.hardware === true;
      if (isHardware) {
        if (event.defaultPrevented || tabRef.current === 'myevents') return;
        event.preventDefault();
      }
      selectTab('myevents', 'back');
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  const nextNonce = () => {
    launchSeqRef.current += 1;
    return launchSeqRef.current;
  };

  const handleOpenTiming = (raceId: string, mode: 'record' | 'roster' = 'record') => {
    localStorage.setItem('racepulse_active_race', raceId);
    setTimingLaunch({ raceId, mode, nonce: nextNonce() });
    selectTab('timing');
  };

  const handleOpenSetup = (raceId?: string) => {
    setSetupLaunch(
      raceId
        ? { mode: 'edit', raceId, nonce: nextNonce() }
        : { mode: 'create', nonce: nextNonce() },
    );
    selectTab('race');
  };

  const handleOpenLiveHub = (raceId: string) => {
    setHubLaunch({ raceId, nonce: nextNonce() });
    selectTab('broadcast');
  };

  const isLocked = tab === 'myevents' || tab === 'broadcast' || tab === 'timing';

  const navItems = [
    { key: 'myevents', icon: <LayoutGrid className="w-4 h-4" />, label: 'My Race Events', active: tab === 'myevents', onClick: () => selectTab('myevents') },
    { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Live Timing', active: tab === 'timing', onClick: () => selectTab('timing') },
    { key: 'broadcast', icon: <Tv className="w-4 h-4" />, label: 'Live Hub', active: tab === 'broadcast', onClick: () => selectTab('broadcast') },
    { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: tab === 'race', onClick: () => selectTab('race') },
  ];

  return (
    <WorkspaceShell
      spaceTitle="Organizer Console"
      navLabel="Organizer navigation"
      items={navItems}
      profile={profile}
      maxWidthClass="max-w-7xl"
      desktopLocked={isLocked}
      onOpenProfile={() => setShowAccountPrivacy(true)}
    >
      <div
        className={`${isLocked ? 'lg:hidden ' : ''}glass-panel hero-glow animate-fadeIn flex justify-between ${
          tab === 'timing'
            ? 'flex-row items-center px-3 py-2 gap-2'
            : 'flex-col md:flex-row md:items-center px-4 sm:px-6 py-5 gap-4'
        }`}
      >
        <div className="min-w-0">
          {tab === 'timing' && (
            <span className="text-xs tracking-wider font-semibold text-red-700 dark:text-red-400 font-display uppercase block truncate">Organizer Console</span>
          )}
          <h1 className={`heading-float font-semibold tracking-tight font-display text-[var(--text-primary)] truncate ${
            tab === 'timing' ? 'text-sm' : 'text-2xl uppercase'
          }`}>{tab === 'timing' ? profile.displayName : `Welcome, ${profile.displayName}`}</h1>
          {tab !== 'timing' && <p className="text-xs text-[var(--text-secondary)] mt-1">Set up races and record checkpoint splits.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {tab !== 'timing' && (
            <>
              <button type="button" onClick={() => setShowSetupGuide(true)} className="min-h-11 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-400 font-semibold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5" aria-hidden="true" /> Setup guide</button>
              <button type="button" onClick={() => setShowAccountPrivacy(true)} title="Account and Privacy Settings" className="min-h-11 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-400 font-semibold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Account &amp; Privacy</button>
            </>
          )}
          <button type="button" onClick={() => signOutUser()} className="lg:hidden min-h-11 text-xs text-[var(--text-secondary)] border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-card)] hover:text-[var(--text-primary)] font-semibold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign Out</button>
        </div>
      </div>

      <AnimatedTabView
        tabKey={tab}
        direction={tabDirection}
        className={isLocked ? 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col' : ''}
      >
        {tab === 'myevents' && (
          <MyRaceEventsPanel
            uid={profile.uid}
            onManageRace={(id) => handleOpenTiming(id, 'record')}
            onOpenTiming={(id) => handleOpenTiming(id, 'record')}
            onOpenRunners={(id) => handleOpenTiming(id, 'roster')}
            onOpenSetup={(id) => handleOpenSetup(id)}
            onOpenLiveHub={handleOpenLiveHub}
            onCreateEvent={() => handleOpenSetup()}
          />
        )}
        {tab === 'timing' && <TimingConsole uid={profile.uid} canSeeAllRaces={false} launchRequest={timingLaunch} />}
        {tab === 'race' && <RaceSetupPanel uid={profile.uid} canSeeAllRaces={false} canDeleteRaces={false} launchRequest={setupLaunch} />}
        {tab === 'broadcast' && <LiveBroadcastPanel uid={profile.uid} launchRequest={hubLaunch} />}
      </AnimatedTabView>

      {showAccountPrivacy && <AccountPrivacyModal profile={profile} onClose={() => setShowAccountPrivacy(false)} />}
      {showSetupGuide && <OrganizerSetupGuide onClose={() => setShowSetupGuide(false)} onNavigate={(destination) => selectTab(destination)} />}
    </WorkspaceShell>
  );
}
