import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { useAccess, accessCommand } from '../lib/access';
import { db, signOutUser } from '../firebase';
import { RunnerProfile, UserProfile } from '../types';
import WorkspaceShell from './WorkspaceShell';
import type { WorkspaceSwitchProps } from './DesktopSidebar';
import AccountPrivacyModal from './AccountPrivacyModal';
import { AnimatedMetricValue, AnimatedTabView, ViewLoadingSkeleton, resolveTabDirection, type NavDirection } from './ui/MotionPrimitives';
import type { TimingLaunchRequest } from './TimingConsole';
import type { RaceSetupLaunchRequest } from './RaceSetupPanel';
import type { LiveBroadcastLaunchRequest } from './LiveBroadcastPanel';
import type { EngravingLaunchRequest } from './OperatorDashboard';
import {
  Award, CalendarDays, Timer, Tv, Flag, UserCog, Users, LogOut, CheckCircle, XCircle, ShieldCheck, Search, Trash2, Printer, Sparkles,
} from 'lucide-react';

const LiveBroadcastPanel = lazy(() => import('./LiveBroadcastPanel'));
const MyRaceEventsPanel = lazy(() => import('./MyRaceEventsPanel'));
const OperatorDashboard = lazy(() => import('./OperatorDashboard'));
const TimingConsole = lazy(() => import('./TimingConsole'));
const RaceSetupPanel = lazy(() => import('./RaceSetupPanel'));
const AccessPanel = lazy(() => import('./AccessPanel'));
const BibStudioPanel = lazy(() => import('./BibStudioPanel'));
const HighlightsStudioPanel = lazy(() => import('./HighlightsStudioPanel'));

type AdminTab = 'engraving' | 'timing' | 'race' | 'bibstudio' | 'highlights' | 'organizers' | 'runners' | 'access' | 'events' | 'hub';

const ADMIN_TAB_ORDER: readonly AdminTab[] = ['events', 'hub', 'highlights', 'engraving', 'timing', 'race', 'bibstudio', 'organizers', 'runners', 'access'];

interface AdminDashboardProps {
  profile: UserProfile;
  workspaceSwitch?: WorkspaceSwitchProps;
  pendingApprovalNotice?: boolean;
}

export default function AdminDashboard({ profile, workspaceSwitch, pendingApprovalNotice }: AdminDashboardProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const [tab, setTab] = useState<AdminTab>('events');
  const [tabDirection, setTabDirection] = useState<NavDirection>('forward');
  const [showAccountPrivacy, setShowAccountPrivacy] = useState(false);
  const launchSeqRef = useRef(0);
  const [timingLaunch, setTimingLaunch] = useState<TimingLaunchRequest | null>(null);
  const [setupLaunch, setSetupLaunch] = useState<RaceSetupLaunchRequest | null>(null);
  const [hubLaunch, setHubLaunch] = useState<LiveBroadcastLaunchRequest | null>(null);
  const [engravingLaunch, setEngravingLaunch] = useState<EngravingLaunchRequest | null>(null);

  const selectTab = (next: AdminTab, explicitDirection?: NavDirection) => {
    setTabDirection(explicitDirection ?? resolveTabDirection(ADMIN_TAB_ORDER, tabRefOrCurrent(activeRef.current), next));
    setTab(next);
  };
  const tabRefOrCurrent = (current: AdminTab) => current;

  const nextNonce = () => {
    launchSeqRef.current += 1;
    return launchSeqRef.current;
  };
  const openRaceTiming = (raceId: string, mode: 'record' | 'roster' = 'record') => {
    localStorage.setItem('racepulse_active_race', raceId);
    setTimingLaunch({ raceId, mode, nonce: nextNonce() });
    selectTab('timing');
  };
  const openRaceEngraving = (raceId: string) => {
    localStorage.setItem('racepulse_engraving_race', raceId);
    setEngravingLaunch({ raceId, nonce: nextNonce() });
    selectTab('engraving');
  };
  const openRaceSetup = (raceId?: string) => {
    setSetupLaunch(
      raceId
        ? { mode: 'edit', raceId, nonce: nextNonce() }
        : { mode: 'create', nonce: nextNonce() },
    );
    selectTab('race');
  };
  const openRaceHub = (raceId: string) => {
    setHubLaunch({ raceId, nonce: nextNonce() });
    selectTab('hub');
  };
  const allowed: Record<AdminTab, boolean> = { engraving: can('engraving.view'), timing: can('timing.view') || can('roster.view'), race: can('race.view') || can('race.create'), bibstudio: isSuperAdmin, highlights: can('highlights.view') || isSuperAdmin, organizers: can('users.view') || isSuperAdmin, runners: can('users.view') || isSuperAdmin, access: isSuperAdmin, events: can('race.view'), hub: can('hub.manage') || can('hub.publish') };
  const firstAllowedTab: AdminTab = ADMIN_TAB_ORDER.find(key => allowed[key]) || 'events';
  const active = allowed[tab] ? tab : firstAllowedTab;
  const homeTab: AdminTab = allowed.events ? 'events' : firstAllowedTab;
  const activeRef = useRef(active);
  const homeTabRef = useRef(homeTab);
  activeRef.current = active;
  homeTabRef.current = homeTab;

  useEffect(() => {
    const goHome = (event: Event) => {
      const isHardware = (event as CustomEvent<{ hardware?: boolean }>).detail?.hardware === true;
      if (isHardware) {
        if (event.defaultPrevented || activeRef.current === homeTabRef.current) return;
        event.preventDefault();
      }
      setTabDirection('back');
      setTab(homeTabRef.current);
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  const spaceTitle = isSuperAdmin
    ? 'Super Admin Console'
    : profile.role === 'admin'
      ? 'Admin Console'
      : profile.role === 'organizer'
        ? 'Organizer Console'
        : 'Operations';

  const navItems = [
    { key: 'events', icon: <CalendarDays className="w-4 h-4" />, label: 'My Events', shortLabel: 'Events', active: active === 'events', onClick: () => selectTab('events') },
    { key: 'hub', icon: <Tv className="w-4 h-4" />, label: 'Live Hub', shortLabel: 'Live Hub', active: active === 'hub', onClick: () => selectTab('hub') },
    { key: 'highlights', icon: <Sparkles className="w-4 h-4" />, label: 'Highlights', shortLabel: 'Highlights', active: active === 'highlights', onClick: () => selectTab('highlights') },
    { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', shortLabel: 'Engrave', active: active === 'engraving', onClick: () => selectTab('engraving') },
    { key: 'timing', icon: <Timer className="w-4 h-4" />, label: 'Timing', shortLabel: 'Timing', active: active === 'timing', onClick: () => selectTab('timing') },
    { key: 'race', icon: <Flag className="w-4 h-4" />, label: 'Race Setup', shortLabel: 'Setup', active: active === 'race', onClick: () => selectTab('race') },
    { key: 'bibstudio', icon: <Printer className="w-4 h-4" />, label: 'Bib Studio', shortLabel: 'Bibs', active: active === 'bibstudio', onClick: () => selectTab('bibstudio') },
    { key: 'organizers', icon: <UserCog className="w-4 h-4" />, label: 'Organizers', shortLabel: 'Orgs', active: active === 'organizers', onClick: () => selectTab('organizers') },
    { key: 'runners', icon: <Users className="w-4 h-4" />, label: 'Runners', shortLabel: 'Runners', active: active === 'runners', onClick: () => selectTab('runners') },
    { key: 'access', icon: <ShieldCheck className="w-4 h-4" />, label: 'Access', shortLabel: 'Access', active: active === 'access', onClick: () => selectTab('access') },
  ].filter(item => allowed[item.key as AdminTab]);

  const isLocked = active === 'engraving' || active === 'events' || active === 'hub' || active === 'timing';

  return (
    <WorkspaceShell
      spaceTitle={spaceTitle}
      navLabel="Operations navigation"
      items={navItems}
      profile={profile}
      workspaceSwitch={workspaceSwitch}
      pendingApprovalNotice={pendingApprovalNotice}
      maxWidthClass="max-w-[1800px]"
      desktopLocked={isLocked}
      onOpenProfile={() => setShowAccountPrivacy(true)}
    >
      {/* Mobile-only compact console header + account privacy + sign out; desktop uses the sidebar avatar tooltip and persistent top bar */}
      <div
        className={`lg:hidden glass-panel hero-glow flex justify-between ${
          active === 'timing'
            ? 'flex-row items-center px-3 py-2 gap-2'
            : 'flex-col sm:flex-row sm:items-center px-4 py-4 gap-3'
        }`}
      >
        <div className="min-w-0">
          <span className="text-xs tracking-wider font-semibold text-red-700 dark:text-red-400 uppercase block truncate">{spaceTitle}</span>
          <h1 className={`heading-float font-semibold tracking-tight font-display text-[var(--text-primary)] truncate ${active === 'timing' ? 'text-sm' : 'text-xl mt-1'}`}>{profile.displayName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAccountPrivacy(true)}
            className="min-h-11 shrink-0 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-400 font-semibold px-3 py-2 rounded-[20px] transition flex items-center gap-2 uppercase tracking-wider"
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Privacy
          </button>
          <button
            type="button"
            onClick={() => signOutUser()}
            className="min-h-11 shrink-0 text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)] hover:text-[var(--text-primary)] font-semibold px-4 py-2 rounded-[20px] transition flex items-center gap-2 uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign Out
          </button>
        </div>
      </div>

      <AnimatedTabView
        tabKey={active}
        direction={tabDirection}
        className={isLocked ? 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col' : ''}
      >
        <Suspense fallback={<ViewLoadingSkeleton label="Loading module" compact />}>
          {active === 'engraving' && <OperatorDashboard launchRequest={engravingLaunch} />}
          {active === 'timing' && <TimingConsole uid={profile.uid} canSeeAllRaces launchRequest={timingLaunch} />}
          {active === 'race' && <RaceSetupPanel uid={profile.uid} canSeeAllRaces canDeleteRaces={isSuperAdmin} launchRequest={setupLaunch} />}
          {active === 'bibstudio' && <BibStudioPanel />}
          {active === 'highlights' && <HighlightsStudioPanel profile={profile} />}
          {active === 'events' && (
            <MyRaceEventsPanel
              uid={profile.uid}
              onManageRace={(id) => openRaceTiming(id, 'record')}
              onOpenTiming={(id) => openRaceTiming(id, 'record')}
              onOpenRunners={(id) => openRaceTiming(id, 'roster')}
              onOpenEngraving={openRaceEngraving}
              onOpenSetup={(id) => openRaceSetup(id)}
              onOpenLiveHub={openRaceHub}
              onCreateEvent={() => openRaceSetup()}
            />
          )}
          {active === 'hub' && <LiveBroadcastPanel uid={profile.uid} launchRequest={hubLaunch} />}
          {active === 'organizers' && <OrganizersPanel canManageAccounts={isSuperAdmin} currentUserId={profile.uid} />}
          {active === 'runners' && <RunnersPanel canManageAccounts={isSuperAdmin} currentUserId={profile.uid} />}
          {active === 'access' && <AccessPanel />}
        </Suspense>
      </AnimatedTabView>

      {showAccountPrivacy && <AccountPrivacyModal profile={profile} onClose={() => setShowAccountPrivacy(false)} />}
    </WorkspaceShell>
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
      <h1 className="sr-only">Organizers</h1>
      <div className="glass-panel p-5">
        <h2 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <UserCog className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Pending Organizer Approvals
        </h2>
        {pending.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No pending requests.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.uid} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{u.displayName}</p>
                  <p className="text-xs text-[var(--text-secondary)] truncate">{u.email}</p>
                </div>
                {canManageAccounts && <button type="button" onClick={() => setApproved(u.uid, true)} className="min-h-11 text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white flex items-center gap-2 shrink-0">
                  <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Approve
                </button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">Active Organizers</h3>
        {approvedOrganizers.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No approved organizers yet.</p>
        ) : (
          <div className="space-y-2">
            {approvedOrganizers.map((u) => (
              <div key={u.uid} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{u.displayName}</p>
                  <p className="text-xs text-[var(--text-secondary)] truncate">{u.email}</p>
                </div>
                {canManageAccounts && <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setApproved(u.uid, false)} className="min-h-11 text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-xl glass-inset text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2 shrink-0">
                    <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Revoke
                  </button>
                  <button type="button" onClick={() => void deleteAccount(u)} aria-label={`Remove organizer account ${u.displayName}`} className="min-h-11 min-w-11 flex items-center justify-center p-2 text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition" title="Remove organizer account"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                </div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-300" aria-hidden="true" /> Admins
        </h3>
        <div className="space-y-2">
          {admins.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No admins yet.</p>}
          {admins.map((u) => (
            <div key={u.uid} className="glass-inset px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{u.displayName}</p>
              <p className="text-xs text-[var(--text-secondary)]">{u.email}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-300" aria-hidden="true" /> Super Admins
        </h3>
        <div className="space-y-2">
          {superAdmins.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No super admins yet.</p>}
          {superAdmins.map((u) => (
            <div key={u.uid} className="glass-inset px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{u.displayName}</p>
              <p className="text-xs text-[var(--text-secondary)]">{u.email}</p>
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
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [registrationsLoaded, setRegistrationsLoaded] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const list: UserProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as UserProfile));
      setUsers(list.filter(user => !user.accessRemoved));
      setUsersLoaded(true);
    }, (err) => {
      console.warn('Users listener failed:', err.message);
      setUsersLoaded(true);
    });
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
      setRegistrationsLoaded(true);
    }, (err) => {
      console.warn('Runner registrations listener failed:', err.message);
      setRegistrationsLoaded(true);
    });
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
      <h1 className="sr-only">Runners Directory</h1>
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel p-5 text-center">
          <p className="text-3xl font-semibold font-display text-[var(--text-primary)]">
            <AnimatedMetricValue
              value={allRunners.length}
              loading={!usersLoaded}
              skeletonWidthClass="w-16"
              skeletonHeightClass="h-8"
            />
          </p>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mt-1">Total Runner Accounts</p>
        </div>
        <div className="glass-panel p-5 text-center">
          <p className="text-3xl font-semibold font-display text-red-700 dark:text-red-400">
            <AnimatedMetricValue
              value={activeRunnerCount}
              loading={!usersLoaded || !registrationsLoaded}
              skeletonWidthClass="w-16"
              skeletonHeightClass="h-8"
            />
          </p>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mt-1">Registered for a Race</p>
        </div>
      </div>

      <div className="glass-panel p-5">
        <h2 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> All Runners
        </h2>
        {allRunners.length > 0 && (
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              placeholder="SEARCH BY NAME OR EMAIL"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-11 glass-inset pl-9 pr-4 py-2 text-xs font-semibold tracking-wide text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
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
                  <div className="w-9 h-9 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-700 dark:text-red-400 font-semibold text-xs shrink-0">
                    {u.photoURL ? (
                      <img src={u.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (u.nickname || u.displayName || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{u.nickname || u.displayName}</p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">{u.email}</p>
                  </div>
                  <span className={`text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full shrink-0 ${count > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25' : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border border-[var(--border-default)]'}`}>
                    {count > 0 ? `${count} race${count > 1 ? 's' : ''}` : 'No races yet'}
                  </span>
                  {canManageAccounts && <button type="button" onClick={() => void deleteAccount(u)} aria-label={`Remove runner account ${u.displayName}`} className="min-h-11 min-w-11 flex items-center justify-center p-2 text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition shrink-0" title="Remove runner account"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
