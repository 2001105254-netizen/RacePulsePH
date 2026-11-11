import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { auth, db, signOutUser } from './firebase';
import PublicRaceLanding from './components/PublicRaceLanding';
import RunningLoader, { type StartupStage } from './components/RunningLoader';
import { UserProfile } from './types';
import { Sun, Moon, RefreshCw, Clock3, LogOut, LogIn, UserPlus, ArrowLeft, ShieldCheck, ChevronUp } from 'lucide-react';

// Lazy-load signed-in workspaces and authentication screens so public landing
// visitors do not download admin/operator consoles, QR scanners, or spreadsheet libraries.
const AuthGate = lazy(() => import('./components/AuthGate'));
const AuthorizedSession = lazy(async () => {
  const [{ AccessProvider }, { default: AuthorizedWorkspace }] = await Promise.all([
    import('./lib/access'),
    import('./components/AuthorizedWorkspace'),
  ]);
  return {
    default: function LazyAuthorizedSession({
      profile,
      onLoadState,
      raceId,
      onRaceHandled,
    }: {
      profile: UserProfile;
      onLoadState: (state: LoadState) => void;
      raceId: string | null;
      onRaceHandled: () => void;
    }) {
      return (
        <AccessProvider key={profile.uid} profile={profile} onLoadState={onLoadState}>
          <AuthorizedWorkspace profile={profile} raceId={raceId} onRaceHandled={onRaceHandled} />
        </AccessProvider>
      );
    },
  };
});
const EmailVerificationScreen = lazy(() =>
  import('./components/AccountSecurity').then((m) => ({ default: m.EmailVerificationScreen }))
);

type Theme = 'light' | 'dark';
type LoadState = 'loading' | 'ready' | 'error';

// Event registration QR codes use ?register={raceId}. Keep this intentionally
// small and local: race IDs are public identifiers, and the actual race is
// still loaded/validated from Firestore before a runner can submit.
function registrationRaceIdFromUrl(): string | null {
  const raceId = new URLSearchParams(window.location.search).get('register')?.trim();
  return raceId || null;
}

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

  return { theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined); // undefined = still checking session
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [profileError, setProfileError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [guestScreen, setGuestScreen] = useState<'landing' | 'login' | 'signup'>(() =>
    registrationRaceIdFromUrl() ? 'signup' : 'landing'
  );
  const [pendingRaceId, setPendingRaceId] = useState<string | null>(() => registrationRaceIdFromUrl());
  const [runnerSignupIntent, setRunnerSignupIntent] = useState(() => !!registrationRaceIdFromUrl());
  const [openingDone, setOpeningDone] = useState(false);
  const [accessLoad, setAccessLoad] = useState<{ uid: string; state: LoadState }>({ uid: '', state: 'loading' });
  const [racesLoad, setRacesLoad] = useState<LoadState>('loading');
  const finishOpening = useCallback(() => setOpeningDone(true), []);
  const accessUid = profile?.uid || '';
  const reportAccessLoad = useCallback((state: LoadState) => setAccessLoad({ uid: accessUid, state }), [accessUid]);
  const reportRacesLoad = useCallback((state: LoadState) => setRacesLoad(state), []);

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
    const unsubscribe = onIdTokenChanged(
      auth,
      (user) => {
        setAuthError(false);
        setProfileError(false);
        setAuthUser(user);
        setEmailVerified(!!user?.emailVerified);
        if (user) setProfile((current) => (current?.uid === user.uid ? current : undefined));
        if (!user) {
          const registrationRaceId = registrationRaceIdFromUrl();
          setProfile(null);
          setGuestScreen(registrationRaceId ? 'signup' : 'landing');
          setPendingRaceId(registrationRaceId);
          setRunnerSignupIntent(!!registrationRaceId);
        }
      },
      (err) => {
        console.warn('Session failed to load:', err.message);
        setAuthError(true);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser) {
      setProfile(null);
      return;
    }
    setAccessLoad({ uid: authUser.uid, state: 'loading' });
    setProfile(undefined);
    setProfileError(false);
    const unsubscribe = onSnapshot(
      doc(db, 'users', authUser.uid),
      (docSnap) => {
        setProfile(docSnap.exists() ? (docSnap.data() as UserProfile) : null);
      },
      (err) => {
        console.warn('User profile listener failed:', err.message);
        setProfileError(true);
      }
    );
    return () => unsubscribe();
  }, [authUser, emailVerified]);

  const stillLoading = authUser === undefined || (!!authUser && profile === undefined);
  // Completion is driven by the initial usable screen, not elapsed animation
  // time. Live race updates continue normally after the opening has finished.
  const currentAccessLoad = accessLoad.uid === authUser?.uid ? accessLoad.state : 'loading';
  let startupStage: StartupStage;
  if (authError || (authUser && profileError)) startupStage = 'error';
  else if (authUser === undefined) startupStage = 'session';
  else if (authUser && profile === undefined) startupStage = 'profile';
  else if (authUser && profile) startupStage = currentAccessLoad === 'loading' ? 'access' : currentAccessLoad;
  else if (!authUser && guestScreen === 'landing') startupStage = racesLoad === 'loading' ? 'races' : racesLoad;
  else startupStage = 'ready';

  const suspenseFallback = (
    <div className="flex-grow flex items-center justify-center py-20" role="status" aria-label="Loading view">
      <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
    </div>
  );

  let content: React.ReactNode;
  if (authError || (profileError && authUser)) {
    content = (
      <div className="flex-grow flex flex-col items-center justify-center gap-4 px-4 py-20 text-center">
        <p role="alert">{authError ? 'Could not check your session.' : 'Could not load your account.'} Please try again.</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-red-600 px-5 py-3 font-bold text-white">
          Try again
        </button>
        {authUser && (
          <button onClick={() => signOutUser()} className="text-sm text-[var(--text-secondary)]">
            Sign out
          </button>
        )}
      </div>
    );
  } else if (stillLoading) {
    content = suspenseFallback;
  } else if (authUser && !emailVerified && !profile) {
    content = (
      <Suspense fallback={suspenseFallback}>
        <EmailVerificationScreen key={authUser.uid} user={authUser} onVerified={() => setEmailVerified(true)} />
      </Suspense>
    );
  } else if (!authUser || !profile) {
    content = authUser ? (
      <Suspense fallback={suspenseFallback}>
        <AuthGate authUser={authUser} signupRoleLocked={runnerSignupIntent} />
      </Suspense>
    ) : guestScreen === 'landing' ? (
      <PublicRaceLanding
        onLoadState={reportRacesLoad}
        onRegister={(raceId) => {
          setPendingRaceId(raceId || null);
          setRunnerSignupIntent(true);
          setGuestScreen('signup');
        }}
      />
    ) : (
      <Suspense fallback={suspenseFallback}>
        <AuthGate
          key={guestScreen}
          initialMode={guestScreen}
          onBackToRaces={() => setGuestScreen('landing')}
          signupRoleLocked={runnerSignupIntent}
        />
      </Suspense>
    );
  } else {
    content = (
      <Suspense fallback={suspenseFallback}>
        <AuthorizedSession
          profile={profile}
          onLoadState={reportAccessLoad}
          raceId={pendingRaceId}
          onRaceHandled={() => {
            setPendingRaceId(null);
            const url = new URL(window.location.href);
            url.searchParams.delete('register');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
          }}
        />
      </Suspense>
    );
  }

  const showBackButton = Boolean(authUser) || guestScreen !== 'landing';

  return (
    <>
      <div
        id="app_root"
        inert={!openingDone}
        aria-hidden={!openingDone || undefined}
        className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)] flex flex-col"
      >
        {/* Global ambient glow - sits behind every page.
            Light mode: directional warm top-left beam via .ambient-glow.
            Dark mode: dramatic red light-ray beaming in from top-left. */}
        <div className="ambient-glow fixed inset-0 -z-10 overflow-hidden pointer-events-none" />

        {/* Global Navigation - persistent charcoal brand bar on every page */}
        <nav className="sticky top-0 z-40 brand-nav" aria-label="Primary navigation">
          <div className="max-w-7xl mx-auto min-w-0 px-3 sm:px-6 h-[4.5rem] sm:h-16 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              {showBackButton && (
                <button
                  type="button"
                  onClick={handleBack}
                  title="Back"
                  aria-label="Go back"
                  className="w-11 h-11 rounded-full border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] flex items-center justify-center text-white/90 hover:text-red-400 hover:border-red-500/50 transition-all duration-150 motion-safe:active:scale-95"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              <div className="w-9 h-9 rounded-[10px] border border-white/15 bg-transparent flex items-center justify-center p-1 transition-colors">
                <img
                  src="/assets/racepulse-mark.png"
                  alt="RacePulsePH"
                  width={28}
                  height={28}
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="hidden min-w-0 truncate font-display font-semibold text-sm tracking-tight uppercase min-[560px]:inline text-white">
                RacePulse<span className="text-red-500">PH</span>
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {!authUser && guestScreen === 'landing' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRaceId(null);
                      setRunnerSignupIntent(false);
                      setGuestScreen('login');
                    }}
                    aria-label="Log in to your account"
                    className="h-11 px-4 rounded-full border border-white/15 bg-white/10 text-xs font-semibold uppercase tracking-wider text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] hover:border-red-500/50 hover:text-red-400 transition-all duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.97]"
                  >
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" /> <span>Log in</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRaceId(null);
                      setRunnerSignupIntent(false);
                      setGuestScreen('signup');
                    }}
                    aria-label="Create a RacePulsePH account"
                    className="h-11 px-4 rounded-full bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider border border-red-500/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)] transition-all duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.97]"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" /> <span>Register</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label="Toggle color theme"
                className="w-11 h-11 rounded-full border border-white/15 bg-white/10 text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] hover:text-red-400 hover:border-red-500/50 transition-all duration-150 flex items-center justify-center motion-safe:active:scale-95"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4.5 h-4.5" aria-hidden="true" />
                ) : (
                  <Moon className="w-4.5 h-4.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </nav>

        <div className="flex-grow flex flex-col">{content}</div>

        {/* Unified Semantic Footer with Philippine athletic greeting */}
        <footer className="border-t border-[var(--border-default)] bg-[var(--surface-card)] mt-auto text-xs text-[var(--text-secondary)]">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between px-4 sm:px-6 py-4 gap-3">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 sm:gap-3">
              <span className="font-mono text-[var(--text-primary)] font-semibold">
                &copy; {new Date().getFullYear()} RacePulsePH
              </span>
              <span aria-hidden="true">&bull;</span>
              <span>Happy running ka Racepulse!</span>
            </div>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="h-11 px-4 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1.5"
            >
              <span>Back to top</span>
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
      {!openingDone && <RunningLoader stage={startupStage} onComplete={finishOpening} />}
    </>
  );
}

function PendingApprovalScreen({ displayName }: { displayName: string }) {
  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="max-w-md w-full glass-panel p-8 text-center space-y-4">
        <Clock3 className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">
          Awaiting Admin Approval
        </h2>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Hi {displayName}, your Organizer account is registered but still needs to be approved by the Super Admin before
          you can record timing splits. Check back shortly.
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
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">
          Claim Super Admin
        </h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          This account is configured as the one-time RacePulsePH Super Admin.
        </p>
        {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}
        <button
          onClick={claim}
          disabled={claiming}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-xl shadow-amber-900/30 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {claiming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Claim Super
          Admin Access
        </button>
        <button onClick={() => signOutUser()} className="text-xs text-[var(--text-secondary)] hover:text-red-500 font-bold">
          Sign out
        </button>
      </div>
    </div>
  );
}
