import { useEffect, useState } from 'react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import TimingConsole from './TimingConsole';
import RaceSetupPanel from './RaceSetupPanel';
import MyRaceEventsPanel from './MyRaceEventsPanel';
import LiveBroadcastPanel from './LiveBroadcastPanel';
import WorkspaceShell from './WorkspaceShell';
import DeleteAccountModal from './DeleteAccountModal';
import OrganizerSetupGuide from './OrganizerSetupGuide';
import { BookOpen, LogOut, Radio, Flag, LayoutGrid, Tv, Trash2 } from 'lucide-react';

interface OrganizerDashboardProps {
  profile: UserProfile;
}

type OrganizerTab = 'myevents' | 'timing' | 'race' | 'broadcast';

export default function OrganizerDashboard({ profile }: OrganizerDashboardProps) {
  const [tab, setTab] = useState<OrganizerTab>('myevents');
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  useEffect(() => {
    const goHome = () => setTab('myevents');
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  const handleManageRace = (raceId: string) => {
    localStorage.setItem('racepulse_active_race', raceId);
    setTab('timing');
  };

  const navItems = [
    { key: 'myevents', icon: <LayoutGrid className="w-4 h-4" />, label: 'My Race Events', active: tab === 'myevents', onClick: () => setTab('myevents') },
    { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Live Timing', active: tab === 'timing', onClick: () => setTab('timing') },
    { key: 'broadcast', icon: <Tv className="w-4 h-4" />, label: 'Live Hub', active: tab === 'broadcast', onClick: () => setTab('broadcast') },
    { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: tab === 'race', onClick: () => setTab('race') },
  ];

  return (
    <WorkspaceShell
      spaceTitle="Organizer Console"
      navLabel="Organizer navigation"
      items={navItems}
      profile={profile}
      maxWidthClass="max-w-7xl"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display bg-red-500/10 px-2.5 py-1 rounded-full uppercase border border-red-500/20">Organizer Console</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Set up races and record checkpoint splits.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button type="button" onClick={() => setShowSetupGuide(true)} className="min-h-11 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-500 font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5" aria-hidden="true" /> Setup guide</button>
          <button type="button" onClick={() => setShowDeleteAccount(true)} title="Delete my account" className="min-h-11 text-xs text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete account</button>
          <button type="button" onClick={() => signOutUser()} className="lg:hidden min-h-11 text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"><LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign Out</button>
        </div>
      </div>

      {tab === 'myevents' && <MyRaceEventsPanel uid={profile.uid} onManageRace={handleManageRace} />}
      {tab === 'timing' && <TimingConsole uid={profile.uid} canSeeAllRaces={false} />}
      {tab === 'race' && <RaceSetupPanel uid={profile.uid} canSeeAllRaces={false} canDeleteRaces={false} />}
      {tab === 'broadcast' && <LiveBroadcastPanel uid={profile.uid} />}

      {showDeleteAccount && <DeleteAccountModal profile={profile} onClose={() => setShowDeleteAccount(false)} />}
      {showSetupGuide && <OrganizerSetupGuide onClose={() => setShowSetupGuide(false)} onNavigate={(destination) => setTab(destination)} />}
    </WorkspaceShell>
  );
}
