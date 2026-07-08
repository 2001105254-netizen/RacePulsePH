import { useState } from 'react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import TimingConsole from './TimingConsole';
import RaceSetupPanel from './RaceSetupPanel';
import BottomNav from './BottomNav';
import { LogOut, Radio, Flag } from 'lucide-react';

interface OrganizerDashboardProps {
  profile: UserProfile;
}

type OrganizerTab = 'timing' | 'race';

export default function OrganizerDashboard({ profile }: OrganizerDashboardProps) {
  const [tab, setTab] = useState<OrganizerTab>('timing');

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 pb-28 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display bg-red-500/10 px-2.5 py-1 rounded-full uppercase border border-red-500/20">Organizer Console</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Set up races and record checkpoint splits.</p>
        </div>
        <button
          onClick={() => signOutUser()}
          className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider self-start"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>
      </div>

      {tab === 'timing' && <TimingConsole uid={profile.uid} canSeeAllRaces={false} />}
      {tab === 'race' && <RaceSetupPanel uid={profile.uid} canSeeAllRaces={false} />}

      <BottomNav
        items={[
          { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Live Timing', active: tab === 'timing', onClick: () => setTab('timing') },
          { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: tab === 'race', onClick: () => setTab('race') },
        ]}
      />
    </div>
  );
}
