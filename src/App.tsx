import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, signOutUser } from './firebase';
import AuthGate from './components/AuthGate';
import AdminDashboard from './components/AdminDashboard';
import OrganizerDashboard from './components/OrganizerDashboard';
import RunnerDashboard from './components/RunnerDashboard';
import { UserProfile } from './types';
import { Activity, Sun, Moon, RefreshCw, Clock3, LogOut } from 'lucide-react';

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (!user) setProfile(null);
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
    content = <AuthGate />;
  } else if (profile.role === 'admin') {
    content = <AdminDashboard profile={profile} />;
  } else if (profile.role === 'organizer') {
    content = profile.approved ? <OrganizerDashboard profile={profile} /> : <PendingApprovalScreen displayName={profile.displayName} />;
  } else {
    content = <RunnerDashboard profile={profile} />;
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
            <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center shadow-lg shadow-red-900/30">
              <Activity className="w-4.5 h-4.5 text-white" strokeWidth={2.25} />
            </div>
            <span className="font-display font-black text-sm tracking-tight uppercase">
              RacePulse<span className="text-red-500">PH</span>
            </span>
          </div>

          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle color theme"
            className="w-10 h-10 rounded-full glass-inset flex items-center justify-center text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition duration-200 active:scale-90"
          >
            {theme === 'dark' ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
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
          Hi {displayName}, your Organizer account is registered but still needs to be approved by an Admin before you can record timing splits. Check back shortly.
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
