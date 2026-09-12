import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { auth, db, signOutUser } from './firebase';
import AuthGate from './components/AuthGate';
import AdminDashboard from './components/AdminDashboard';
import OrganizerDashboard from './components/OrganizerDashboard';
import RunnerDashboard from './components/RunnerDashboard';
import PublicRaceLanding from './components/PublicRaceLanding';
import { UserProfile } from './types';
import { isSuperAdminEmail } from './lib/superAdmin';
import { Sun, Moon, RefreshCw, Clock3, LogOut, LogIn, UserPlus, ArrowLeft, ShieldCheck } from 'lucide-react';

type Theme = 'light' | 'dark';

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('racepulse_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('racepulse_theme', theme);
  }, [theme]);

  return { theme, toggleTheme: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) };
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined); // undefined = still checking session
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [guestScreen, setGuestScreen] = useState<'landing' | 'login' | 'signup'>('landing');
  const [pendingRaceId, setPendingRaceId] = useState<string | null>(null);
  const [runnerSignupIntent, setRunnerSignupIntent] = useState(false);
  const [openingPhase, setOpeningPhase] = useState<'showing' | 'leaving' | 'done'>('showing');

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setOpeningPhase('leaving'), 900);
    const doneTimer = window.setTimeout(() => setOpeningPhase('done'), 1250);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  // Dashboard navigation lives in React state, so browser history is not a
  // safe back action. Each signed-in console listens for this event and goes
  // to its own home screen instead.
  const handleBack = () => {
    if (!authUser) {
      setGuestScreen('landing');
      setPendingRaceId(null);
      setRunnerSignupIntent(false);
      return;
    }
    window.dispatchEvent(new Event('racepulse:back'));
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (!user) {
        setProfile(null);
        setGuestScreen('landing');
        setPendingRaceId(null);
        setRunnerSignupIntent(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const unsubscribe = onSnapshot(doc(db, 'users', authUser.uid), (docSnap) => {
      setProfile(docSnap.exists() ? (docSnap.data() as UserProfile) : null);
    }, (err) => {
      console.warn('User profile listener failed:', err.message);
      setProfile(null);
    });
    return () => unsubscribe();
  }, [authUser]);

  const stillLoading = authUser === undefined || (!!authUser && profile === undefined);

  let content: React.ReactNode;
  if (stillLoading) {
    content = (
      <div className="flex-grow flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    );
  } else if (!authUser || !profile) {
    content = authUser ? (
      <AuthGate authUser={authUser} signupRoleLocked={runnerSignupIntent} />
    ) : guestScreen === 'landing' ? (
      <PublicRaceLanding onRegister={(raceId) => {
        setPendingRaceId(raceId || null);
        setRunnerSignupIntent(true);
        setGuestScreen('signup');
      }} />
    ) : (
      <AuthGate
        key={guestScreen}
        initialMode={guestScreen}
        onBackToRaces={() => setGuestScreen('landing')}
        signupRoleLocked={runnerSignupIntent}
      />
    );
  } else if (isSuperAdminEmail(profile.email) && profile.role !== 'superadmin') {
    content = <SuperAdminClaimScreen profile={profile} />;
  } else if (profile.role === 'admin' || profile.role === 'superadmin') {
    content = <AdminDashboard profile={profile} />;
  } else if (profile.role === 'organizer') {
    content = profile.approved ? <OrganizerDashboard profile={profile} /> : <PendingApprovalScreen displayName={profile.displayName} />;
  } else {
    content = <RunnerDashboard profile={profile} initialRaceId={pendingRaceId} onInitialRaceHandled={() => setPendingRaceId(null)} />;
  }

  return (
    <div id="app_root" className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)] flex flex-col">

      {/* Global ambient glow - sits behind every page so glass panels have depth to catch.
          Light mode: soft scattered blobs. Dark mode: a single dramatic red light-ray
          beaming in from the top-left corner (see .dark .ambient-glow in index.css). */}
      <div className="ambient-glow fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-24 w-[28rem] h-[28rem] bg-red-600/10 rounded-full blur-[120px] dark:hidden" />
        <div className="absolute top-1/3 -right-32 w-[32rem] h-[32rem] bg-red-900/8 rounded-full blur-[140px] dark:hidden" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-black/5 rounded-full blur-[110px] dark:hidden" />
      </div>

      {/* Global Navigation - persistent frosted glass bar on every page */}
      <nav className="sticky top-0 z-40 glass-nav">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBack}
              title="Back"
              aria-label="Go back"
              className="w-9 h-9 rounded-full glass-inset flex items-center justify-center text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition active:scale-90"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-9 h-9 rounded-[10px] overflow-hidden bg-[#0a0a0a] flex items-center justify-center shadow-lg shadow-red-900/30 ring-1 ring-white/10">
              <img
                src="/assets/racepulse-mark.png"
                alt="RacePulsePH"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-display font-black text-sm tracking-tight uppercase">
              RacePulse<span className="text-red-500">PH</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {!authUser && guestScreen === 'landing' && (
              <>
                <button
                  onClick={() => { setPendingRaceId(null); setRunnerSignupIntent(false); setGuestScreen('login'); }}
                  className="h-9 px-3 rounded-[18px] text-[10px] sm:text-xs font-black uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" /> Log in
                </button>
                <button
                  onClick={() => { setPendingRaceId(null); setRunnerSignupIntent(false); setGuestScreen('signup'); }}
                  className="h-9 px-3 sm:px-4 rounded-[18px] bg-red-600 hover:bg-red-500 text-white text-[10px] sm:text-xs font-black uppercase tracking-wide shadow-lg shadow-red-900/30 transition flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Sign up
                </button>
              </>
            )}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle color theme"
              className="w-10 h-10 rounded-full glass-inset flex items-center justify-center text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition duration-200 active:scale-90"
            >
              {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>
      </nav>

      <div className="flex-grow flex flex-col">
        {content}
      </div>

      {/* Footer Branding credits */}
      <footer className="glass-nav border-t-0 mt-auto text-center text-[10px] text-[var(--text-muted)] font-mono tracking-wide">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between px-6 py-4 gap-2">
          <span>&copy; 2026 RACEPULSEPH BY LOUD & CLEAR. ALL RIGHTS RESERVED.</span>
          <span>STATION CO-PROCESSING SYNC // FAULT COOPERATION PROTOCOL</span>
        </div>
      </footer>

      {openingPhase !== 'done' && <OpeningSplash leaving={openingPhase === 'leaving'} />}

    </div>
  );
}

function OpeningSplash({ leaving }: { leaving: boolean }) {
  return (
    <div
      className={`app-opening-splash fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden bg-[#070707] px-6 transition-[opacity,transform] duration-[350ms] ease-out ${leaving ? 'pointer-events-none scale-[1.02] opacity-0' : 'opacity-100'}`}
      aria-label="Opening RacePulsePH"
      role="status"
    >
      <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-red-600/30 blur-[110px]" />
      <div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-red-900/35 blur-[120px]" />
      <div className="relative flex flex-col items-center text-center">
        <div className="app-opening-ring absolute top-0 h-28 w-28 rounded-[30px] border border-red-500/60" />
        <div className="app-opening-logo relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-[30px] bg-[#0a0a0a] shadow-[0_0_45px_rgba(239,68,68,0.4)] ring-1 ring-white/15">
          <img src="/assets/racepulse-mark.png" alt="" className="h-full w-full object-contain" />
        </div>
        <p className="app-opening-title mt-6 font-display text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
          RacePulse<span className="text-red-500">PH</span>
        </p>
        <p className="app-opening-tagline mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
          Ready. Set. Run.
        </p>
      </div>
    </div>
  );
}

function PendingApprovalScreen({ displayName }: { displayName: string }) {
  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="max-w-md w-full glass-panel p-8 text-center space-y-4">
        <Clock3 className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">Awaiting Admin Approval</h2>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Hi {displayName}, your Organizer account is registered but still needs to be approved by the Super Admin before you can record timing splits. Check back shortly.
        </p>
        <button
          onClick={() => signOutUser()}
          className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-4 py-2.5 rounded-[20px] transition flex items-center justify-center gap-1.5 uppercase tracking-wider mx-auto"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out
        </button>
      </div>
    </div>
  );
}

function SuperAdminClaimScreen({ profile }: { profile: UserProfile }) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  const claim = async () => {
    setClaiming(true);
    setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', profile.uid), { role: 'superadmin', approved: true });
      batch.set(doc(db, 'system', 'meta'), { superAdminClaimed: true }, { merge: true });
      await batch.commit();
    } catch (err: any) {
      setError(err.message || 'Could not claim the Super Admin role.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="max-w-md w-full glass-panel p-8 text-center space-y-4">
        <ShieldCheck className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">Claim Super Admin</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">This account is configured as the one-time RacePulsePH Super Admin.</p>
        {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}
        <button onClick={claim} disabled={claiming} className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-xl shadow-amber-900/30 disabled:opacity-60 flex items-center justify-center gap-2">
          {claiming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Claim Super Admin Access
        </button>
        <button onClick={() => signOutUser()} className="text-xs text-[var(--text-secondary)] hover:text-red-500 font-bold">Sign out</button>
      </div>
    </div>
  );
}
