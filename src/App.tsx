import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { AnimatePresence, LazyMotion, MotionConfig, domMax, m } from 'motion/react';
import { auth, db, signOutUser } from './firebase';
import PublicRaceLanding from './components/PublicRaceLanding';
import { PublicLegalPage, PublicNotFoundView } from './components/PublicInfoPages';
import CookieConsentBanner from './components/CookieConsentBanner';
import UnsubscribePage from './components/UnsubscribePage';
import { LEGAL_CONFIG, LEGAL_DOCUMENTS, type LegalDocKey } from './lib/legalConfig';
import { exitAndroidApp, subscribeAndroidBackButton, syncAndroidSystemBars } from './lib/capacitorAndroid';
import { WorkspaceHeaderProvider, useWorkspaceHeader } from './lib/workspaceHeader';
import { UserProfile } from './types';
import { Sun, Moon, RefreshCw, Clock3, LogOut, LogIn, UserPlus, ArrowLeft, ShieldCheck, ChevronUp } from 'lucide-react';
import { EMIL_EASE, ViewLoadingSkeleton, type NavDirection } from './components/ui/MotionPrimitives';

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
      raceId,
      onRaceHandled,
    }: {
      profile: UserProfile;
      raceId: string | null;
      onRaceHandled: () => void;
    }) {
      return (
        <AccessProvider key={profile.uid} profile={profile}>
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
type GuestScreen = 'landing' | 'login' | 'signup' | LegalDocKey | 'unsubscribe' | 'not-found';
type SignedInUtilityView = LegalDocKey | 'unsubscribe' | null;

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

function utilityViewFromPath(path: string): SignedInUtilityView {
  if (path === '/privacy' || path === '/privacy-policy') return 'privacy';
  if (path === '/terms' || path === '/terms-of-service' || path === '/terms-of-use') return 'terms';
  if (path === '/refund-policy' || path === '/refund') return 'refund';
  if (path === '/cookie-policy' || path === '/cookies') return 'cookies';
  if (path === '/unsubscribe') return 'unsubscribe';
  return null;
}

function guestScreenFromLocation(): GuestScreen {
  if (registrationRaceIdFromUrl()) return 'signup';
  const path = normalizedPathname();
  if (path === '/' || path === '/index.html') return 'landing';
  if (path === '/login' || path === '/signin') return 'login';
  if (path === '/register' || path === '/signup') return 'signup';
  const utility = utilityViewFromPath(path);
  if (utility) return utility;
  return 'not-found';
}

function pathForGuestScreen(screen: GuestScreen): string {
  switch (screen) {
    case 'login':
      return '/login';
    case 'signup':
      return '/register';
    case 'privacy':
      return '/privacy-policy';
    case 'terms':
      return '/terms-of-service';
    case 'refund':
      return '/refund-policy';
    case 'cookies':
      return '/cookie-policy';
    case 'unsubscribe':
      return '/unsubscribe';
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
    syncAndroidSystemBars(theme);
  }, [theme]);

  return { theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

export default function App() {
  return (
    <WorkspaceHeaderProvider>
      <AppContent />
    </WorkspaceHeaderProvider>
  );
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const headerCtx = useWorkspaceHeader();
  const setLeftSlotEl = headerCtx?.setLeftSlotEl;
  const setRightSlotEl = headerCtx?.setRightSlotEl;
  const desktopLocked = Boolean(headerCtx?.desktopLocked);
  useEffect(() => {
    if (desktopLocked) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [desktopLocked]);
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined); // undefined = still checking session
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [profileError, setProfileError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [guestScreen, setGuestScreen] = useState<GuestScreen>(() => guestScreenFromLocation());
  const [signedInUtilityView, setSignedInUtilityView] = useState<SignedInUtilityView>(() =>
    utilityViewFromPath(normalizedPathname())
  );
  const [navDirection, setNavDirection] = useState<NavDirection>('forward');
  const wasSignedInRef = React.useRef<boolean | null>(null);
  const [currentPathname, setCurrentPathname] = useState<string>(() => window.location.pathname);
  const [activeRaceTitle, setActiveRaceTitle] = useState<string | null>(null);
  const [pendingRaceId, setPendingRaceId] = useState<string | null>(() => registrationRaceIdFromUrl());
  const [runnerSignupIntent, setRunnerSignupIntent] = useState(() => !!registrationRaceIdFromUrl());

  const navigateGuest = useCallback(
    (
      next: Exclude<GuestScreen, 'not-found'>,
      options?: { raceId?: string | null; lockRunner?: boolean; preserveScroll?: boolean; direction?: NavDirection }
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
      setNavDirection(options?.direction ?? 'forward');
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

  const closeSignedInUtility = useCallback(() => {
    setSignedInUtilityView(null);
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.search = '';
    window.history.pushState({}, '', url.pathname);
    setCurrentPathname('/');
    setNavDirection('back');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const openUtilityView = useCallback(
    (next: Exclude<SignedInUtilityView, null>) => {
      if (!authUser || !profile) {
        navigateGuest(next);
        return;
      }
      const targetPath = pathForGuestScreen(next);
      const url = new URL(window.location.href);
      url.pathname = targetPath;
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
        window.history.pushState({}, '', nextUrl);
      }
      setNavDirection('forward');
      setCurrentPathname(url.pathname);
      setSignedInUtilityView(next);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [authUser, navigateGuest, profile]
  );

  useEffect(() => {
    const onOpenLegalEvent = (event: Event) => {
      const detail = (event as CustomEvent<LegalDocKey | 'unsubscribe'>).detail;
      if (detail) openUtilityView(detail);
    };
    window.addEventListener('racepulse:open-legal', onOpenLegalEvent);
    return () => window.removeEventListener('racepulse:open-legal', onOpenLegalEvent);
  }, [openUtilityView]);

  useEffect(() => {
    const onPopState = () => {
      setNavDirection('back');
      setCurrentPathname(window.location.pathname);
      setSignedInUtilityView(utilityViewFromPath(normalizedPathname()));
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

  // Route Android hardware back presses through active overlays/modals first,
  // then inner console tabs or guest history before exiting cleanly.
  useEffect(() => {
    return subscribeAndroidBackButton((canGoBack) => {
      if (!authUser) {
        if (guestScreen !== 'landing') {
          setNavDirection('back');
          if (canGoBack && window.history.length > 1) {
            window.history.back();
          } else {
            navigateGuest('landing', { direction: 'back' });
          }
          return;
        }
        exitAndroidApp();
        return;
      }

      if (signedInUtilityView) {
        closeSignedInUtility();
        return;
      }

      const backEvent = new CustomEvent('racepulse:back', {
        cancelable: true,
        detail: { hardware: true },
      });
      window.dispatchEvent(backEvent);
      if (!backEvent.defaultPrevented) {
        exitAndroidApp();
      }
    });
  }, [authUser, closeSignedInUtility, guestScreen, navigateGuest, signedInUtilityView]);

  // Dashboard navigation lives in React state, so browser history is not a
  // safe back action. Each signed-in console listens for this event and goes
  // to its own home screen instead.
  const handleBack = () => {
    setNavDirection('back');
    if (!authUser) {
      navigateGuest('landing', { direction: 'back' });
      return;
    }
    if (signedInUtilityView) {
      closeSignedInUtility();
      return;
    }
    window.dispatchEvent(new Event('racepulse:back'));
  };

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(
      auth,
      (user) => {
        const wasSignedIn = wasSignedInRef.current;
        wasSignedInRef.current = Boolean(user);
        if (wasSignedIn === false && user) setNavDirection('forward');
        else if (wasSignedIn === true && !user) setNavDirection('back');
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

  const [cookiePreferencesNonce, setCookiePreferencesNonce] = useState(0);

  useEffect(() => {
    let title = 'RacePulsePH | Philippine Race Timing, Bib Lookup, and Finisher Results';
    let description =
      'Find verified Philippine road runs and trail races, look up runner bibs and checkpoint split times live, and download official finisher certificates.';

    const activeUtility = signedInUtilityView || (!authUser ? guestScreen : null);
    const legalDocMeta = activeUtility
      ? LEGAL_DOCUMENTS.find((entry) => entry.key === activeUtility)
      : undefined;

    if (legalDocMeta) {
      title = `${legalDocMeta.title} | RacePulsePH`;
      description = legalDocMeta.description;
    } else if (activeUtility === 'unsubscribe') {
      title = 'Email Preferences & Unsubscribe | RacePulsePH';
      description = 'Opt out of RacePulsePH promotional and announcement emails with one click without signing in.';
    } else if (authUser && profile) {
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
    } else if (guestScreen === 'not-found') {
      title = 'Page Not Found (404) | RacePulsePH';
      description = 'The requested RacePulsePH route does not exist. Return to the Philippine race directory or sign in.';
    }

    document.title = title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', description);
  }, [authUser, profile, guestScreen, activeRaceTitle, signedInUtilityView]);

  const stillLoading = authUser === undefined || (!!authUser && profile === undefined);

  const suspenseFallback = <ViewLoadingSkeleton label="Loading RacePulsePH view" />;

  let content: React.ReactNode;
  if (authError || (profileError && authUser)) {
    content = (
      <main id="main-content" tabIndex={-1} className="flex-grow flex flex-col items-center justify-center gap-4 px-4 py-20 text-center focus:outline-none">
        <p role="alert">{authError ? 'Could not check your session.' : 'Could not load your account.'} Please try again.</p>
        <button onClick={() => window.location.reload()} className="min-h-11 rounded-xl bg-red-700 hover:bg-red-600 px-5 py-3 font-semibold text-white">
          Try again
        </button>
        {authUser && (
          <button onClick={() => signOutUser()} className="min-h-11 px-4 text-sm text-[var(--text-secondary)]">
            Sign out
          </button>
        )}
      </main>
    );
  } else if (stillLoading) {
    content = (
      <main id="main-content" tabIndex={-1} className="flex-grow focus:outline-none">
        {suspenseFallback}
      </main>
    );
  } else if (authUser && !emailVerified && !profile) {
    content = (
      <main id="main-content" tabIndex={-1} className="flex-grow flex flex-col focus:outline-none">
        <Suspense fallback={suspenseFallback}>
          <EmailVerificationScreen key={authUser.uid} user={authUser} onVerified={() => setEmailVerified(true)} />
        </Suspense>
      </main>
    );
  } else if (!authUser || !profile) {
    if (authUser) {
      content = (
        <main id="main-content" tabIndex={-1} className="flex-grow flex flex-col focus:outline-none">
          <Suspense fallback={suspenseFallback}>
            <AuthGate
              authUser={authUser}
              onOpenLegal={(docView) => navigateGuest(docView)}
              signupRoleLocked={runnerSignupIntent}
            />
          </Suspense>
        </main>
      );
    } else if (guestScreen === 'landing') {
      content = (
        <PublicRaceLanding
          revealed
          onActiveRaceTitle={setActiveRaceTitle}
          onRegister={(raceId) => {
            navigateGuest('signup', { raceId: raceId || null, lockRunner: true });
          }}
        />
      );
    } else if (
      guestScreen === 'privacy' ||
      guestScreen === 'terms' ||
      guestScreen === 'refund' ||
      guestScreen === 'cookies'
    ) {
      content = (
        <main id="main-content" tabIndex={-1} className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow focus:outline-none">
          <PublicLegalPage
            doc={guestScreen}
            onBack={() => navigateGuest('landing')}
            onSwitchDoc={(nextDoc) => navigateGuest(nextDoc)}
            onOpenAuth={() => navigateGuest('login')}
            onOpenCookiePreferences={() => setCookiePreferencesNonce((n) => n + 1)}
            onOpenUnsubscribe={() => navigateGuest('unsubscribe')}
          />
        </main>
      );
    } else if (guestScreen === 'unsubscribe') {
      content = (
        <main id="main-content" tabIndex={-1} className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow focus:outline-none">
          <UnsubscribePage onBack={() => navigateGuest('landing')} />
        </main>
      );
    } else if (guestScreen === 'not-found') {
      content = (
        <main id="main-content" tabIndex={-1} className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow flex items-center justify-center focus:outline-none">
          <PublicNotFoundView
            pathname={currentPathname}
            onGoHome={() => navigateGuest('landing')}
            onGoLogin={() => navigateGuest('login')}
          />
        </main>
      );
    } else {
      content = (
        <main id="main-content" tabIndex={-1} className="flex-grow flex flex-col focus:outline-none">
          <Suspense fallback={suspenseFallback}>
            <AuthGate
              initialMode={guestScreen}
              onBackToRaces={() => navigateGuest('landing')}
              onModeChange={(nextMode) => navigateGuest(nextMode, { preserveScroll: true })}
              onOpenLegal={(docView) => navigateGuest(docView)}
              signupRoleLocked={runnerSignupIntent}
            />
          </Suspense>
        </main>
      );
    }
  } else if (signedInUtilityView) {
    content = (
      <main id="main-content" tabIndex={-1} className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow focus:outline-none">
        {signedInUtilityView === 'unsubscribe' ? (
          <UnsubscribePage onBack={closeSignedInUtility} />
        ) : (
          <PublicLegalPage
            doc={signedInUtilityView}
            onBack={closeSignedInUtility}
            onSwitchDoc={(nextDoc) => openUtilityView(nextDoc)}
            onOpenAuth={closeSignedInUtility}
            onOpenCookiePreferences={() => setCookiePreferencesNonce((n) => n + 1)}
            onOpenUnsubscribe={() => openUtilityView('unsubscribe')}
          />
        )}
      </main>
    );
  } else {
    content = (
      <Suspense fallback={<main id="main-content" tabIndex={-1} className="flex-grow focus:outline-none">{suspenseFallback}</main>}>
        <AuthorizedSession
          profile={profile}
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

  const showBackButton = (!authUser && guestScreen !== 'landing') || Boolean(signedInUtilityView);
  const isWorkspaceShell = Boolean(authUser && profile && !authError && !profileError && !signedInUtilityView);
  const viewKey = signedInUtilityView
    ? `utility-${signedInUtilityView}`
    : authUser
      ? profile
        ? 'workspace'
        : 'auth-setup'
      : guestScreen === 'login' || guestScreen === 'signup'
        ? 'auth-portal'
        : guestScreen;

  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">
        <div
          id="app_root"
          className={`min-h-screen min-h-dvh bg-[var(--surface-page)] text-[var(--text-primary)] flex flex-col ${
            desktopLocked && !signedInUtilityView ? 'lg:h-screen lg:h-dvh lg:overflow-hidden' : ''
          }`}
        >
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          {/* Global ambient glow - sits behind every page.
              Light mode: directional warm top-left beam via .ambient-glow.
              Dark mode: dramatic red light-ray beaming in from top-left. */}
          <div className="ambient-glow fixed inset-0 -z-10 overflow-hidden pointer-events-none" />

          {/* Global Navigation - persistent charcoal brand bar on every page */}
          <nav className="sticky top-0 z-40 brand-nav shrink-0" aria-label="Primary navigation">
            <div className={`${isWorkspaceShell ? 'w-full' : 'max-w-7xl mx-auto'} min-w-0 px-3 sm:px-4 xl:px-6 h-[4.5rem] sm:h-16 flex items-center justify-between gap-2 sm:gap-3`}>
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                {showBackButton && (
                  <button
                    type="button"
                    onClick={handleBack}
                    title="Back"
                    aria-label="Go back"
                    className="w-11 h-11 shrink-0 rounded-full border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.3)] flex items-center justify-center text-white/90 hover:text-red-400 hover:border-red-500/50 transition-all duration-150 motion-safe:active:scale-95"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (!authUser ? navigateGuest('landing') : handleBack())}
                  className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-w-11 min-h-11 justify-center rounded-xl py-1 px-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  aria-label="RacePulsePH home"
                >
                  <div className="w-9 h-9 rounded-[10px] border border-white/15 bg-transparent flex items-center justify-center p-1 transition-colors shrink-0">
                    <img
                      src="/assets/racepulse-mark-192.png"
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

                {/* Desktop workspace context slot (e.g. active race event switcher next to brand mark) */}
                {isWorkspaceShell && (
                  <div
                    ref={setLeftSlotEl}
                    id="workspace_header_left_slot"
                    className="hidden lg:flex items-center gap-2 min-w-0 flex-1 overflow-hidden"
                  />
                )}
              </div>

              <div className={`flex items-center gap-1.5 sm:gap-2 ${isWorkspaceShell ? 'min-w-0 shrink' : 'shrink-0'}`}>
                {isWorkspaceShell && (
                  <div
                    ref={setRightSlotEl}
                    id="workspace_header_right_slot"
                    className="hidden lg:flex items-center gap-1.5 min-w-0 overflow-x-auto racepulse-horizontal-scroll"
                  />
                )}
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

          <div className={`relative flex-grow flex flex-col overflow-x-clip ${desktopLocked && !signedInUtilityView ? 'lg:min-h-0 lg:overflow-hidden' : ''}`}>
            <m.div
              key={viewKey}
              initial={{ opacity: 0, x: navDirection === 'forward' ? 14 : -14 }}
              animate={{
                opacity: 1,
                x: 0,
                transitionEnd: { transform: 'none' },
              }}
              transition={{ duration: 0.16, ease: EMIL_EASE }}
              className={`w-full flex-grow flex flex-col [backface-visibility:hidden] ${desktopLocked && !signedInUtilityView ? 'lg:min-h-0 lg:overflow-hidden' : ''}`}
            >
              {content}
            </m.div>
          </div>

          {/* Global Footer: verifiable business identity, 4 required legal routes, consent controls, and email unsubscribe */}
          <footer className={`border-t border-[var(--border-default)] bg-[var(--surface-card)] mt-auto text-xs text-[var(--text-secondary)] ${isWorkspaceShell ? 'pb-24 lg:pb-0' : 'pb-[var(--rp-safe-bottom)]'} ${desktopLocked && !signedInUtilityView ? 'lg:hidden' : ''}`}>
            <div className={`${isWorkspaceShell ? 'w-full' : 'max-w-7xl mx-auto'} pl-[max(1rem,var(--rp-safe-left))] pr-[max(1rem,var(--rp-safe-right))] sm:pl-[max(1.5rem,var(--rp-safe-left))] sm:pr-[max(1.5rem,var(--rp-safe-right))] py-5 space-y-4`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1 text-center lg:text-left">
                  <p className="text-[var(--text-primary)] font-semibold">
                    &copy; {new Date().getFullYear()} {LEGAL_CONFIG.companyName}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {LEGAL_CONFIG.businessAddress} &bull; {LEGAL_CONFIG.jurisdiction} &bull; Happy running ka Racepulse!
                  </p>
                </div>

                <nav aria-label="Legal and compliance links" className="flex flex-wrap items-center justify-center lg:justify-end gap-x-4 gap-y-2">
                  <a
                    href="/privacy-policy"
                    onClick={(e) => {
                      e.preventDefault();
                      openUtilityView('privacy');
                    }}
                    className="min-h-11 px-1.5 inline-flex items-center font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Privacy Policy
                  </a>
                  <a
                    href="/terms-of-service"
                    onClick={(e) => {
                      e.preventDefault();
                      openUtilityView('terms');
                    }}
                    className="min-h-11 px-1.5 inline-flex items-center font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Terms of Service
                  </a>
                  <a
                    href="/refund-policy"
                    onClick={(e) => {
                      e.preventDefault();
                      openUtilityView('refund');
                    }}
                    className="min-h-11 px-1.5 inline-flex items-center font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Refund Policy
                  </a>
                  <a
                    href="/cookie-policy"
                    onClick={(e) => {
                      e.preventDefault();
                      openUtilityView('cookies');
                    }}
                    className="min-h-11 px-1.5 inline-flex items-center font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Cookie Policy
                  </a>
                  <button
                    type="button"
                    onClick={() => setCookiePreferencesNonce((n) => n + 1)}
                    className="min-h-11 px-1.5 font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Cookie Preferences
                  </button>
                  <a
                    href="/unsubscribe"
                    onClick={(e) => {
                      e.preventDefault();
                      openUtilityView('unsubscribe');
                    }}
                    className="min-h-11 px-1.5 inline-flex items-center font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    Unsubscribe
                  </a>
                  <a
                    href={`mailto:${LEGAL_CONFIG.supportEmail}`}
                    className="min-h-11 px-1.5 inline-flex items-center font-mono text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                  >
                    {LEGAL_CONFIG.supportEmail}
                  </a>
                  <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="h-11 px-4 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-700 dark:hover:text-red-400 transition-colors flex items-center gap-1.5"
                  >
                    <span>Back to top</span>
                    <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </div>
          </footer>

          <CookieConsentBanner
            preferencesRequestNonce={cookiePreferencesNonce}
            onOpenCookiePolicy={() => openUtilityView('cookies')}
          />
        </div>
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
          className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)] hover:text-[var(--text-primary)] font-bold px-4 py-2.5 rounded-[20px] transition-colors flex items-center justify-center gap-1.5 uppercase tracking-wider mx-auto"
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
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400 font-semibold">{error}</p>}
        <button
          type="button"
          onClick={claim}
          disabled={claiming}
          className="min-h-11 w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest text-white bg-gradient-to-r from-amber-700 to-amber-800 hover:from-amber-600 hover:to-amber-700 shadow-xl shadow-amber-900/30 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {claiming ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />} Claim Super
          Admin Access
        </button>
        <button type="button" onClick={() => signOutUser()} className="min-h-11 px-4 text-xs text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 font-bold">
          Sign out
        </button>
      </div>
    </div>
  );
}
