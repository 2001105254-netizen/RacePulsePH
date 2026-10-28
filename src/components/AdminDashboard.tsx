import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { useAccess, accessCommand } from '../lib/access';
import LiveBroadcastPanel from './LiveBroadcastPanel';
import MyRaceEventsPanel from './MyRaceEventsPanel';
import { db, signOutUser } from '../firebase';
import { RunnerProfile, UserProfile } from '../types';
import OperatorDashboard from './OperatorDashboard';
import TimingConsole from './TimingConsole';
import RaceSetupPanel from './RaceSetupPanel';
import BottomNav from './BottomNav';
import AccessPanel from './AccessPanel';
import {
  Award, Radio, Flag, Users, Users2, LogOut, CheckCircle, XCircle, ShieldCheck, Search, Trash2,
} from 'lucide-react';

type AdminTab = 'engraving' | 'timing' | 'race' | 'organizers' | 'runners' | 'access' | 'events' | 'hub';

interface AdminDashboardProps {
  profile: UserProfile;
}

export default function AdminDashboard({ profile }: AdminDashboardProps) {
  const { can, authority: isSuperAdmin, state } = useAccess();
  const [tab, setTab] = useState<AdminTab>(can('engraving.view') ? 'engraving' : 'events');
  const allowed: Record<AdminTab, boolean> = { engraving: can('engraving.view'), timing: can('timing.view') || can('roster.view'), race: can('race.view') || can('race.create'), organizers: can('users.view') || isSuperAdmin, runners: can('users.view') || isSuperAdmin, access: isSuperAdmin, events: can('race.view'), hub: can('hub.manage') || can('hub.publish') };
  const active = allowed[tab] ? tab : (Object.keys(allowed).find(key => allowed[key]) as AdminTab);

  useEffect(() => {
    const goHome = () => setTab('engraving');
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  return (
    <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-8 py-6 pb-28 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-amber-500 font-display bg-amber-500/10 px-2.5 py-1 rounded-full uppercase border border-amber-500/20">{isSuperAdmin ? 'Super Admin Console' : profile.role === 'admin' ? 'Admin Console' : profile.role === 'organizer' ? 'Organizer Console' : 'Operations'}</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">{isSuperAdmin ? 'Secure control over accounts, organizer approvals, races, timing, and engraving.' : 'Operational control over engraving, timing, and race setup.'}</p>
        </div>
        <button
          onClick={() => signOutUser()}
          className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider self-start"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>
      </div>

      {active === 'engraving' && <OperatorDashboard />}
      {active === 'timing' && <TimingConsole uid={profile.uid} canSeeAllRaces />}
      {active === 'race' && <RaceSetupPanel uid={profile.uid} canSeeAllRaces canDeleteRaces={isSuperAdmin} />}
      {active === 'events' && <MyRaceEventsPanel uid={profile.uid} onManageRace={id => { localStorage.setItem('racepulse_active_race', id); setTab('timing'); }} />}
      {active === 'hub' && <LiveBroadcastPanel uid={profile.uid} />}
      {active === 'organizers' && <OrganizersPanel canManageAccounts={isSuperAdmin} currentUserId={profile.uid} />}
      {active === 'runners' && <RunnersPanel canManageAccounts={isSuperAdmin} currentUserId={profile.uid} />}
      {active === 'access' && <AccessPanel />}

      <BottomNav
        items={[
          { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'My Events', active: active === 'events', onClick: () => setTab('events') },
          { key: 'hub', icon: <Radio className="w-4 h-4" />, label: 'Live Hub', active: active === 'hub', onClick: () => setTab('hub') },
          { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: active === 'engraving', onClick: () => setTab('engraving') },
          { key: 'timing', icon: <Radio className="w-4 h-4" />, label: 'Timing', active: active === 'timing', onClick: () => setTab('timing') },
          { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', active: active === 'race', onClick: () => setTab('race') },
          { key: 'organizers', icon: <Users className="w-4 h-4" />, label: 'Organizers', active: active === 'organizers', onClick: () => setTab('organizers') },
          { key: 'runners', icon: <Users2 className="w-4 h-4" />, label: 'Runners', active: active === 'runners', onClick: () => setTab('runners') },
          { key: 'access', icon: <ShieldCheck className="w-4 h-4" />, label: 'Access', active: active === 'access', onClick: () => setTab('access') },
        ].filter(item => allowed[item.key])}
      />
    </div>
  );
}


// ========== ORGANIZER APPROVALS ==========

async function removeAppAccount(user: UserProfile): Promise<void> {
  const access = (await getDoc(doc(db, 'userAccess', user.uid))).data();
  await accessCommand('remove', { uid: user.uid, revision: access?.revision || 0, requestId: crypto.randomUUID() });
}

function OrganizersPanel({ canManageAccounts, currentUserId }: { canManageAccounts: boolean; currentUserId: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as UserProfile));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setUsers(list.filter(user => !user.accessRemoved));
    }, (err) => console.warn('Users listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const pending = users.filter((u) => u.role === 'organizer' && !u.approved);
  const approvedOrganizers = users.filter((u) => u.role === 'organizer' && u.approved);
  const admins = users.filter((u) => u.role === 'admin');
  const superAdmins = users.filter((u) => u.role === 'superadmin');

  const setApproved = async (uid: string, approved: boolean) => {
    try {
      const access = (await getDoc(doc(db, 'userAccess', uid))).data() || { scope: 'owned-assigned', raceIds: [], status: 'active', overrides: {}, revision: 0 };
      await accessCommand('save', { ...access, role: 'organizer', approved, uid, requestId: crypto.randomUUID() });
    } catch (err) {
      console.warn('Failed to update organizer approval:', err);
    }
  };

  const deleteAccount = async (user: UserProfile) => {
    if (user.uid === currentUserId || !window.confirm(`Remove ${user.displayName}'s organizer account? This blocks that login from recreating an app account.`)) return;
    try {
      await removeAppAccount(user);
    } catch (err) {
      console.warn('Failed to remove organizer account:', err);
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
                {canManageAccounts && <button onClick={() => setApproved(u.uid, true)} className="text-xs font-black uppercase tracking-wider px-3.5 py-2 rounded-[16px] bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shrink-0">
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>}
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
                {canManageAccounts && <div className="flex items-center gap-1">
                  <button onClick={() => setApproved(u.uid, false)} className="text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-[16px] glass-inset text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 shrink-0">
                    <XCircle className="w-3.5 h-3.5" /> Revoke
                  </button>
                  <button onClick={() => void deleteAccount(u)} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition" title="Remove organizer account"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>}
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
          {admins.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No admins yet.</p>}
          {admins.map((u) => (
            <div key={u.uid} className="glass-inset px-4 py-3">
              <p className="text-sm font-bold text-[var(--text-primary)]">{u.displayName}</p>
              <p className="text-[10px] text-[var(--text-secondary)]">{u.email}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-amber-500" /> Super Admins
        </h3>
        <div className="space-y-2">
          {superAdmins.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No super admins yet.</p>}
          {superAdmins.map((u) => (
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

// ========== RUNNERS DIRECTORY ==========

function RunnersPanel({ canManageAccounts, currentUserId }: { canManageAccounts: boolean; currentUserId: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as UserProfile));
      setUsers(list.filter(user => !user.accessRemoved));
    }, (err) => console.warn('Users listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  // Registration count per uid across every race - the real "who's actually
  // using the app" signal, not just who created an account.
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'runners'), (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as RunnerProfile;
        counts[data.uid] = (counts[data.uid] || 0) + 1;
      });
      setRegistrationCounts(counts);
    }, (err) => console.warn('Runner registrations listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const allRunners = useMemo(
    () => users.filter((u) => u.role === 'runner').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [users]
  );

  const filteredRunners = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allRunners;
    return allRunners.filter((u) =>
      u.displayName.toLowerCase().includes(term)
      || u.email.toLowerCase().includes(term)
      || (u.nickname || '').toLowerCase().includes(term)
    );
  }, [allRunners, search]);

  const activeRunnerCount = allRunners.filter((u) => registrationCounts[u.uid]).length;

  const deleteAccount = async (user: UserProfile) => {
    if (user.uid === currentUserId || !window.confirm(`Remove ${user.displayName}'s runner account? Their registrations will be removed and this login will be blocked from recreating an app account.`)) return;
    try {
      await removeAppAccount(user);
    } catch (err) {
      console.warn('Failed to remove runner account:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel p-5 text-center">
          <p className="text-3xl font-black font-display text-[var(--text-primary)]">{allRunners.length}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mt-1">Total Runner Accounts</p>
        </div>
        <div className="glass-panel p-5 text-center">
          <p className="text-3xl font-black font-display text-red-500">{activeRunnerCount}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mt-1">Registered for a Race</p>
        </div>
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <Users2 className="w-4 h-4 text-red-500" /> All Runners
        </h3>
        {allRunners.length > 0 && (
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="SEARCH BY NAME OR EMAIL"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full glass-inset pl-9 pr-4 py-2.5 text-xs font-bold tracking-wide text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>
        )}

        {allRunners.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No runner accounts yet.</p>
        ) : filteredRunners.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No runners match "{search}".</p>
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {filteredRunners.map((u) => {
              const count = registrationCounts[u.uid] || 0;
              return (
                <div key={u.uid} className="flex items-center gap-3 glass-inset px-4 py-3">
                  <div className="w-9 h-9 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-500 font-black text-xs shrink-0">
                    {u.photoURL ? (
                      <img src={u.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (u.nickname || u.displayName || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[var(--text-primary)] truncate">{u.nickname || u.displayName}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] truncate">{u.email}</p>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ${count > 0 ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/25' : 'bg-[var(--surface-inset)] text-[var(--text-muted)] border border-[var(--border-default)]'}`}>
                    {count > 0 ? `${count} race${count > 1 ? 's' : ''}` : 'No races yet'}
                  </span>
                  {canManageAccounts && <button onClick={() => void deleteAccount(u)} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition shrink-0" title="Remove runner account"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
