import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db, signOutUser } from '../firebase';
import { UserProfile } from '../types';
import OperatorDashboard from './OperatorDashboard';
import TimingConsole from './TimingConsole';
import RaceSetupPanel from './RaceSetupPanel';
import BottomNav from './BottomNav';
import {
  Award, Radio, Flag, Users, LogOut, CheckCircle, XCircle, ShieldCheck,
} from 'lucide-react';

type AdminTab = 'engraving' | 'timing' | 'race' | 'organizers';

interface AdminDashboardProps {
  profile: UserProfile;
}

export default function AdminDashboard({ profile }: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('engraving');

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 pb-28 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-amber-500 font-display bg-amber-500/10 px-2.5 py-1 rounded-full uppercase border border-amber-500/20">Admin Console</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Full control over engraving, timing, race setup, and organizer accounts.</p>
        </div>
        <button
          onClick={() => signOutUser()}
          className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider self-start"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>
      </div>

      {tab === 'engraving' && <OperatorDashboard />}
      {tab === 'timing' && <TimingConsole uid={profile.uid} />}
      {tab === 'race' && <RaceSetupPanel />}
      {tab === 'organizers' && <OrganizersPanel />}

      <BottomNav
        items={[
          { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: tab === 'engraving', onClick: () => setTab('engraving') },
          { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Timing', active: tab === 'timing', onClick: () => setTab('timing') },
          { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: tab === 'race', onClick: () => setTab('race') },
          { key: 'organizers', icon: <Users className="w-4 h-4" />, label: 'Organizers', active: tab === 'organizers', onClick: () => setTab('organizers') },
        ]}
      />
    </div>
  );
}


// ========== ORGANIZER APPROVALS ==========

function OrganizersPanel() {
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as UserProfile));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setUsers(list);
    }, (err) => console.warn('Users listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const pending = users.filter((u) => u.role === 'organizer' && !u.approved);
  const approvedOrganizers = users.filter((u) => u.role === 'organizer' && u.approved);
  const admins = users.filter((u) => u.role === 'admin');

  const setApproved = async (uid: string, approved: boolean) => {
    try {
      await updateDoc(doc(db, 'users', uid), { approved });
    } catch (err) {
      console.warn('Failed to update organizer approval:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-red-500" /> Pending Organizer Approvals
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No pending requests.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.uid} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{u.displayName}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] truncate">{u.email}</p>
                </div>
                <button onClick={() => setApproved(u.uid, true)} className="text-xs font-black uppercase tracking-wider px-3.5 py-2 rounded-[16px] bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shrink-0">
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">Active Organizers</h3>
        {approvedOrganizers.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No approved organizers yet.</p>
        ) : (
          <div className="space-y-2">
            {approvedOrganizers.map((u) => (
              <div key={u.uid} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{u.displayName}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] truncate">{u.email}</p>
                </div>
                <button onClick={() => setApproved(u.uid, false)} className="text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-[16px] glass-inset text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 shrink-0">
                  <XCircle className="w-3.5 h-3.5" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-amber-500" /> Admins
        </h3>
        <div className="space-y-2">
          {admins.map((u) => (
            <div key={u.uid} className="glass-inset px-4 py-3">
              <p className="text-sm font-bold text-[var(--text-primary)]">{u.displayName}</p>
              <p className="text-[10px] text-[var(--text-secondary)]">{u.email}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
