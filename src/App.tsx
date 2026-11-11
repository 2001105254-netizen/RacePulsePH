import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { AnimatePresence, LazyMotion, MotionConfig, domMax, m } from 'motion/react';
import { auth, db, signOutUser } from './firebase';
import PublicRaceLanding from './components/PublicRaceLanding';
import { PublicLegalPage, PublicNotFoundView } from './components/PublicInfoPages';
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
  import('./components/AccountSecurity').then((mod) => ({ default: mod.EmailVerificationScreen }))
);

type Theme = 'light' | 'dark';
type LoadState = 'loading' | 'ready' | 'error';
type GuestScreen = 'landing' | 'login' | 'signup' | 'privacy' | 'terms' | 'not-found';

function normalizedPathname(): string {
  const raw = window.location.pathname.toLowerCase();
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw || '/';
}

// Event registration QR codes use ?register={raceId}. Keep this intentionally
// small and local: race IDs are public identifiers, and the actual race is
// still loaded/validated from Firestore before a runner can submit.
function registrationRaceIdFromUrl(): string | null {
  const raceId = new URLSearchParams(window.location.search).get('register')?.trim();
  return raceId || null;
}

function guestScreenFromLocation(): GuestScreen {
  if (registrationRaceIdFromUrl()) return 'signup';
  const path = normalizedPathname();
  if (path === '/' || path === '/index.html') return 'landing';
  if (path === '/login' || path === '/signin') return 'login';
  if (path === '/register' || path === '/signup') return 'signup';
  if (path === '/privacy' || path === '/privacy-policy') return 'privacy';
  if (path === '/terms' || path === '/terms-of-use') return 'terms';
  return 'not-found';
}

function pathForGuestScreen(screen: GuestScreen): string {
  switch (screen) {
    case 'login':
      return '/login';
    case 'signup':
      return '/register';
    case 'privacy':
      return '/privacy';
    case 'terms':
      return '/terms';
    default:
      return '/';
  }
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
  const [guestScreen, setGuestScreen] = useState<GuestScreen>(() => guestScreenFromLocation());
  const [currentPathname, setCurrentPathname] = useState<string>(() => window.location.pathname);
  const [activeRaceTitle, setActiveRaceTitle] = useState<string | null>(null);
  const [pendingRaceId, setPendingRaceId] = useState<string | null>(() => registrationRaceIdFromUrl());
  const [runnerSignupIntent, setRunnerSignupIntent] = useState(() => !!registrationRaceIdFromUrl());
  const [openingDone, setOpeningDone] = useState(false);
  const [accessLoad, setAccessLoad] = useState<{ uid: string; state: LoadState }>({ uid: '', state: 'loading' });
  const [racesLoad, setRacesLoad] = useState<LoadState>('loading');
  const finishOpening = useCallback(() => setOpeningDone(true), []);
  const accessUid = profile?.uid || '';
  const reportAccessLoad = useCallback((state: LoadState) => setAccessLoad({ uid: accessUid, state }), [accessUid]);
  const reportRacesLoad = useCallback((state: LoadState) => setRacesLoad(state), []);

  const navigateGuest = useCallback(
    (
      next: Exclude<GuestScreen, 'not-found'>,
      options?: { raceId?: string | null; lockRunner?: boolean; preserveScroll?: boolean }
    ) => {
      const targetPath = pathForGuestScreen(next);
      const url = new URL(window.location.href);
      url.pathname = targetPath;
      if (next !== 'landing') url.searchParams.delete('race');
      if (next !== 'signup' || !options?.raceId) url.searchParams.delete('register');
      if (options?.raceId && next === 'signup') url.searchParams.set('register', options.raceId);
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
        window.history.pushState({}, '', nextUrl);
      }
      setCurrentPathname(url.pathname);
      setPendingRaceId(options?.raceId ?? null);
      setRunnerSignupIntent(Boolean(options?.lockRunner));
      if (next !== 'landing') setActiveRaceTitle(null);
      setGuestScreen(next);
      if (!options?.preserveScroll) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    []
  );

  useEffect(() => {
    const onPopState = () => {
      setCurrentPathname(window.location.pathname);
      if (!authUser) {
        const regId = registrationRaceIdFromUrl();
        setPendingRaceId(regId);
        setRunnerSignupIntent(!!regId);
        setGuestScreen(guestScreenFromLocation());
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [authUser]);

  // Dashboard navigation lives in React state, so browser history is not a
  // safe back action. Each signed-in console listens for this event and goes
  // to its own home screen instead.
  const handleBack = () => {
    if (!authUser) {
      navigateGuest('landing');
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
        if (user) {
          setProfile((current) => (current?.uid === user.uid ? current : undefined));
          const p = normalizedPathname();
          if (p === '/login' || p === '/signin' || p === '/register' || p === '/signup') {
            const url = new URL(window.location.href);
            url.pathname = '/';
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
            setCurrentPathname('/');
          }
        }
        if (!user) {
          const registrationRaceId = registrationRaceIdFromUrl();
          setProfile(null);
          setGuestScreen(guestScreenFromLocation());
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

  useEffect(() => {
    let title = 'RacePulsePH | Philippine Race Timing, Bib Lookup, and Finisher Results';
    let description =
      'Find verified Philippine road runs and trail races, look up runner bibs and checkpoint split times live, and download official finisher certificates.';

    if (authUser && profile) {
      title = 'Workspace | RacePulsePH';
    } else if (guestScreen === 'landing' && activeRaceTitle) {
      title = `${activeRaceTitle} | Live Timing and Results | RacePulsePH`;
      description = `Check live checkpoint splits, official finisher rankings, and downloadable certificates for ${activeRaceTitle} on RacePulsePH.`;
    } else if (guestScreen === 'login') {
      title = 'Sign In | RacePulsePH';
      description =
        'Sign in to your RacePulsePH runner or organizer account to manage entries, view QR bibs, and access live timing tools.';
    } else if (guestScreen === 'signup') {
      title = 'Create Account | RacePulsePH';
      description =
        'Create a RacePulsePH account to register for upcoming Philippine runs, claim wave bibs, and download verified finisher certificates.';
    } else if (guestScreen === 'privacy') {
      title = 'Privacy Policy | RacePulsePH';
      description =
        'How RacePulsePH handles runner registrations, published race timing records, and account verification.';
    } else if (guestScreen === 'terms') {
      title = 'Terms of Use | RacePulsePH';
      description =
        'Terms governing athlete registrations, official checkpoint split results, and organizer operations on RacePulsePH.';
    } else if (guestScreen === 'not-found') {
      title = 'Page Not Found (404) | RacePulsePH';
      description = 'The requested RacePulsePH route does not exist. Return to the Philippine race directory or sign in.';
    }

    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', description);
  }, [authUser, profile, guestScreen, activeRaceTitle]);

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
    if (authUser) {
      content = (
        <Suspense fallback={suspenseFallback}>
          <AuthGate authUser={authUser} signupRoleLocked={runnerSignupIntent} />
        </Suspense>
      );
    } else if (guestScreen === 'landing') {
      content = (
        <PublicRaceLanding
          revealed={openingDone}
          onActiveRaceTitle={setActiveRaceTitle}
          onLoadState={reportRacesLoad}
          onRegister={(raceId) => {
            navigateGuest('signup', { raceId: raceId || null, lockRunner: true });
          }}
        />
      );
    } else if (guestScreen === 'privacy' || guestScreen === 'terms') {
      content = (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow">
          <PublicLegalPage
            doc={guestScreen}
            onBack={() => navigateGuest('landing')}
            onSwitchDoc={(nextDoc) => navigateGuest(nextDoc)}
            onOpenAuth={() => navigateGuest('login')}
          />
        </div>
      );
    } else if (guestScreen === 'not-found') {
      content = (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow flex items-center justify-center">
          <PublicNotFoundView
            pathname={currentPathname}
            onGoHome={() => navigateGuest('landing')}
            onGoLogin={() => navigateGuest('login')}
          />
        </div>
      );
    } else {
      content = (
        <Suspense fallback={suspenseFallback}>
          <AuthGate
            initialMode={guestScreen}
            onBackToRaces={() => navigateGuest('landing')}
            onModeChange={(nextMode) => navigateGuest(nextMode, { preserveScroll: true })}
            onOpenLegal={(docView) => navigateGuest(docView)}
            signupRoleLocked={runnerSignupIntent}
          />
        </Suspense>
      );
    }
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
  const isWorkspaceShell = Boolean(authUser && profile && !authError && !profileError);
  const viewKey = authUser ? (profile ? 'workspace' : 'auth-setup') : guestScreen === 'login' || guestScreen === 'signup' ? 'auth-portal' : guestScreen;

  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">
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
            <div className={`${isWorkspaceShell ? 'w-full' : 'max-w-7xl mx-auto'} min-w-0 px-3 sm:px-6 h-[4.5rem] sm:h-16 flex items-center justify-between gap-2`}>
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
                <button
                  type="button"
                  onClick={() => (!authUser ? navigateGuest('landing') : handleBack())}
                  className="flex items-center gap-2 sm:gap-2.5 min-w-0 rounded-xl py-1 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  aria-label="RacePulsePH home"
                >
                  <div className="w-9 h-9 rounded-[10px] border border-white/15 bg-transparent flex items-center justify-center p-1 transition-colors shrink-0">
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
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {!authUser && guestScreen === 'landing' && (
                  <>
                    <button
                      type="button"
                      onMouseEnter={() => {
                        void import('./components/AuthGate');
                      }}
                      onFocus={() => {
                        void import('./components/AuthGate');
                      }}
                      onClick={() => navigateGuest('login')}
                      aria-label="Log in to your account"
                      className="h-11 px-4 rounded-full border border-white/15 bg-white/10 text-xs font-semibold uppercase tracking-wider text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] hover:border-red-500/50 hover:text-red-400 transition-all duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.97]"
                    >
                      <LogIn className="w-3.5 h-3.5" aria-hidden="true" /> <span>Log in</span>
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => {
                        void import('./components/AuthGate');
                      }}
                      onFocus={() => {
                        void import('./components/AuthGate');
                      }}
                      onClick={() => navigateGuest('signup')}
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
                  className="w-11 h-11 rounded-full border border-white/15 bg-white/10 text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] hover:text-red-400 hover:border-red-500/50 transition-all duration-150 flex items-center justify-center motion-safe:active:scale-95 overflow-hidden"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {theme === 'dark' ? (
                      <m.span
                        key="sun"
                        initial={{ opacity: 0, rotate: -35, scale: 0.8 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: 35, scale: 0.8 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="flex items-center justify-center"
                      >
                        <Sun className="w-4.5 h-4.5" aria-hidden="true" />
                      </m.span>
                    ) : (
                      <m.span
                        key="moon"
                        initial={{ opacity: 0, rotate: 35, scale: 0.8 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: -35, scale: 0.8 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="flex items-center justify-center"
                      >
                        <Moon className="w-4.5 h-4.5" aria-hidden="true" />
                      </m.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>
            </div>
          </nav>

          <AnimatePresence mode="wait">
            <m.div
              key={viewKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex-grow flex flex-col"
            >
              {content}
            </m.div>
          </AnimatePresence>

          {/* Unified Semantic Footer with Philippine athletic greeting and legal/support navigation */}
          <footer className="border-t border-[var(--border-default)] bg-[var(--surface-card)] mt-auto text-xs text-[var(--text-secondary)]">
            <div className={`${isWorkspaceShell ? 'w-full' : 'max-w-7xl mx-auto'} flex flex-col md:flex-row items-center justify-between px-4 sm:px-6 py-4 gap-3`}>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-2">
                <span className="font-mono text-[var(--text-primary)] font-semibold">
                  &copy; {new Date().getFullYear()} RacePulsePH
                </span>
                <span aria-hidden="true">&bull;</span>
                <span>Happy running ka Racepulse!</span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                {!authUser && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigateGuest('privacy')}
                      className="min-h-11 px-1.5 font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                    >
                      Privacy Policy
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateGuest('terms')}
                      className="min-h-11 px-1.5 font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                    >
                      Terms of Use
                    </button>
                  </>
                )}
                <a
                  href="mailto:events@racepulseph.com"
                  className="min-h-11 px-1.5 inline-flex items-center font-mono text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                >
                  events@racepulseph.com
                </a>
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="h-11 px-4 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1.5"
                >
                  <span>Back to top</span>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </footer>
        </div>
        {!openingDone && <RunningLoader stage={startupStage} onComplete={finishOpening} />}
      </MotionConfig>
    </LazyMotion>
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
