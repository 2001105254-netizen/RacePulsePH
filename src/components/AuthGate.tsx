import React, { useState, useEffect, useRef } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { AnimatePresence, m } from 'motion/react';
import { directionalTabVariants, type NavDirection } from './ui/MotionPrimitives';
import { RedTribalPatternBackdrop } from './ui/KineticTelemetry';
import { db, auth, signUpWithEmail, signInWithEmail, signInWithGoogle, signOutUser } from '../firebase';
import { clearSignupDraft, getSignupDraft, resolveUsernameForLogin, saveSignupDraft } from '../lib/accountSecurity';
import { isClientNavigationClick } from '../lib/appRouting';
import { createActionCooldownStore } from '../lib/resilientFetch';
import { PasswordResetFlow } from './AccountSecurity';
import { isSuperAdminEmail } from '../lib/superAdmin';
import type { LegalDocKey } from '../lib/legalConfig';
import { UserProfile } from '../types';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';

type Mode = 'login' | 'signup';
type SignupRole = 'runner' | 'organizer' | 'superadmin';
type FieldKey = 'loginEmail' | 'loginPassword' | 'signupName' | 'signupUsername' | 'signupEmail' | 'signupPassword';

interface PendingSignupFormDraft {
  displayName: string;
  username: string;
  email: string;
  signupRole: SignupRole;
  ageStatus: '' | '13_plus' | 'under_13';
  acceptedTerms: boolean;
  marketingOptIn: boolean;
}

interface PendingCompleteProfileDraft {
  uid: string;
  displayName: string;
  username: string;
  role: SignupRole;
  ageStatus: '' | '13_plus' | 'under_13';
  acceptedTerms: boolean;
  marketingOptIn: boolean;
}

// Keep non-sensitive signup form inputs only in memory across SPA policy navigation (never store passwords).
let pendingFormDraft: PendingSignupFormDraft | null = null;
let pendingCompleteProfileDraft: PendingCompleteProfileDraft | null = null;

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authCooldown = createActionCooldownStore('racepulse_auth_cd');

const accentText = 'text-red-700 dark:text-red-400';
const labelClass = 'block text-xs font-semibold text-[var(--text-secondary)] mb-2';
const hintClass = 'mt-2 text-xs text-[var(--text-secondary)]';
const errorHintClass = 'mt-2 text-xs font-semibold text-red-700 dark:text-red-400';
const inputBaseClass =
  'w-full glass-inset h-11 text-sm sm:text-base font-normal text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400 transition-colors';
const iconClass = 'w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none';
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';
const buttonBase = `w-full h-11 px-5 rounded-[var(--radius-control)] text-sm sm:text-base font-semibold flex items-center justify-center gap-2 transition-[background-color,border-color,color,transform,box-shadow] duration-150 motion-safe:active:scale-[0.99] ${focusRing}`;
const primaryButton = (busy: boolean) =>
  `${buttonBase} ${
    busy
      ? 'bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-secondary)] cursor-not-allowed'
      : 'bg-red-700 hover:bg-red-800 text-white shadow-sm'
  }`;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function usernameError(value: string): string | null {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return '3 to 24 characters: letters, numbers, dot, underscore, or hyphen.';
  }
  return null;
}

async function resolveLoginEmail(identifier: string): Promise<string> {
  const value = identifier.trim();
  if (value.includes('@')) return value;

  const invalid = usernameError(value);
  if (invalid) throw new Error(invalid);
  const { email } = await resolveUsernameForLogin(normalizeUsername(value));
  return email;
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

// Centered minimalist auth stage on clean surface canvas framed by red tribal weave.
function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex-grow flex items-center justify-center overflow-hidden py-6 sm:py-10 px-4">
      <RedTribalPatternBackdrop variant="auth" />
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full flex justify-center"
      >
        {children}
      </m.div>
    </div>
  );
}

async function createUserProfileForRole(
  user: User,
  role: SignupRole,
  displayNameOverride: string | undefined,
  usernameInput: string,
  consentMeta: { over13Confirmed: boolean; termsAcceptedAt: string; marketingOptIn: boolean }
): Promise<void> {
  const currentUser = auth.currentUser || user;
  try {
    await currentUser.reload();
    await currentUser.getIdToken(true);
  } catch (err) {
    console.warn('Could not refresh auth token before profile creation:', err);
  }

  if (!currentUser.emailVerified) {
    throw new Error('Verify your email with the six-digit code before completing your account.');
  }
  const username = normalizeUsername(usernameInput);
  const invalidUsername = usernameError(username);
  if (invalidUsername) throw new Error(invalidUsername);
  const normalizedEmail = (currentUser.email || user.email || '').trim().toLowerCase();
  const assignedRole: SignupRole = isSuperAdminEmail(normalizedEmail) ? 'superadmin' : role;
  const profile: UserProfile = {
    uid: currentUser.uid,
    email: normalizedEmail,
    displayName: displayNameOverride?.trim() || currentUser.displayName || user.displayName || 'Runner',
    username,
    role: assignedRole,
    approved: assignedRole !== 'organizer',
    createdAt: new Date().toISOString(),
    over13Confirmed: consentMeta.over13Confirmed,
    termsAcceptedAt: consentMeta.termsAcceptedAt,
    marketingOptIn: consentMeta.marketingOptIn,
  };

  await runTransaction(db, async (transaction) => {
    const usernameRef = doc(db, 'usernameIndex', username);
    let existingUsername;
    try {
      existingUsername = await transaction.get(usernameRef);
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        throw new Error('That username is already taken. Please choose another one.');
      }
      throw err;
    }
    if (existingUsername.exists()) throw new Error('That username is already taken. Please choose another one.');

    transaction.set(doc(db, 'users', currentUser.uid), profile);
    transaction.set(doc(db, 'friendDirectory', username), {
      uid: currentUser.uid,
      username,
      displayName: profile.displayName,
      ...(currentUser.photoURL || user.photoURL ? { photoURL: currentUser.photoURL || user.photoURL } : {}),
      updatedAt: profile.createdAt,
    });
    transaction.set(doc(db, 'friendProfiles', currentUser.uid), {
      uid: currentUser.uid,
      username,
      displayName: profile.displayName,
      ...(currentUser.photoURL || user.photoURL ? { photoURL: currentUser.photoURL || user.photoURL } : {}),
      updatedAt: profile.createdAt,
    });
    transaction.set(usernameRef, {
      username,
      uid: currentUser.uid,
      email: normalizedEmail,
      createdAt: profile.createdAt,
    });
    if (assignedRole === 'superadmin') {
      transaction.set(doc(db, 'system', 'meta'), { superAdminClaimed: true }, { merge: true });
    }
  });
}

interface AuthGateProps {
  authUser?: User | null;
  initialMode?: Mode;
  onBackToRaces?: () => void;
  onModeChange?: (mode: Mode) => void;
  onOpenLegal?: (doc: LegalDocKey) => void;
  signupRoleLocked?: boolean;
}

export default function AuthGate({
  authUser,
  initialMode = 'login',
  onModeChange,
  onOpenLegal,
  signupRoleLocked = false,
}: AuthGateProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const initialDraft = initialMode === 'signup' ? pendingFormDraft : null;
  const [email, setEmail] = useState(() => initialDraft?.email ?? '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(() => initialDraft?.displayName ?? '');
  const [username, setUsername] = useState(() => initialDraft?.username ?? '');
  const [signupRole, setSignupRole] = useState<SignupRole>(() => initialDraft?.signupRole ?? 'runner');
  const [ageStatus, setAgeStatus] = useState<'' | '13_plus' | 'under_13'>(() => initialDraft?.ageStatus ?? '');
  const [acceptedTerms, setAcceptedTerms] = useState(() => initialDraft?.acceptedTerms ?? false);
  const [marketingOptIn, setMarketingOptIn] = useState(() => initialDraft?.marketingOptIn ?? false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [error, setError] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(() => authCooldown.getRemainingSeconds('auth'));
  const submitLockRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (mode !== 'signup') return;
    pendingFormDraft = {
      displayName,
      username,
      email,
      signupRole,
      ageStatus,
      acceptedTerms,
      marketingOptIn,
    };
  }, [mode, displayName, username, email, signupRole, ageStatus, acceptedTerms, marketingOptIn]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds(authCooldown.getRemainingSeconds('auth'));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setNotice('');
    setTouched({});
    mountedAtRef.current = Date.now();
  }, [initialMode]);

  const markTouched = (field: FieldKey) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'login') {
      pendingFormDraft = null;
    }
    setMode(next);
    setError('');
    setNotice('');
    setTouched({});
    onModeChange?.(next);
  };

  const handleOpenLegalDoc = (docKey: LegalDocKey) => {
    if (mode === 'signup') {
      pendingFormDraft = {
        displayName,
        username,
        email,
        signupRole,
        ageStatus,
        acceptedTerms,
        marketingOptIn,
      };
    }
    onOpenLegal?.(docKey);
  };

  const triggerFormError = (msg: string) => {
    setError(msg);
    setErrorNonce((n) => n + 1);
  };

  const loginEmailErr =
    touched.loginEmail && !email.trim()
      ? 'Enter your email address or username.'
      : touched.loginEmail && !email.includes('@') && usernameError(email)
        ? usernameError(email)
        : null;
  const loginPasswordErr = touched.loginPassword && !password ? 'Enter your password.' : null;

  const signupNameErr = touched.signupName && !displayName.trim() ? 'Enter your full name.' : null;
  const signupUsernameErr = touched.signupUsername ? usernameError(username) : null;
  const signupEmailErr =
    touched.signupEmail && !EMAIL_PATTERN.test(email.trim())
      ? 'Enter a valid email address.'
      : null;
  const signupPasswordErr =
    touched.signupPassword && password.length < 8 ? 'Password must be at least 8 characters.' : null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    if (honeypot.trim() !== '') {
      triggerFormError('Could not sign in right now. Please refresh and try again.');
      return;
    }
    const waitLeft = authCooldown.getRemainingSeconds('auth');
    if (waitLeft > 0) {
      setCooldownSeconds(waitLeft);
      triggerFormError(`Too many sign-in attempts. Please wait ${waitLeft}s before trying again.`);
      return;
    }
    setTouched((prev) => ({ ...prev, loginEmail: true, loginPassword: true }));
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      triggerFormError('Enter your email or username and password.');
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const accountEmail = await resolveLoginEmail(email);
      await signInWithEmail(accountEmail, password);
      authCooldown.clear('auth');
      setCooldownSeconds(0);
    } catch (err: any) {
      const code = typeof err?.code === 'string' ? err.code : '';
      if (code === 'auth/too-many-requests') {
        authCooldown.start('auth', 60);
        setCooldownSeconds(60);
      } else {
        const penalty = authCooldown.recordFailure('auth', { threshold: 5, baseWaitSec: 15, maxWaitSec: 180 });
        if (penalty > 0) setCooldownSeconds(penalty);
      }
      triggerFormError(err.message?.replace('Firebase: ', '') || 'Failed to sign in.');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    setError('');
    setNotice('');
    setPassword('');
    setResettingPassword(true);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    if (honeypot.trim() !== '' || Date.now() - mountedAtRef.current < 400) {
      triggerFormError('Could not process account creation right now. Please try again.');
      return;
    }
    const waitLeft = authCooldown.getRemainingSeconds('auth');
    if (waitLeft > 0) {
      setCooldownSeconds(waitLeft);
      triggerFormError(`Too many attempts. Please wait ${waitLeft}s before trying again.`);
      return;
    }
    setTouched({
      signupName: true,
      signupUsername: true,
      signupEmail: true,
      signupPassword: true,
    });
    setError('');
    setNotice('');
    if (!displayName.trim()) {
      triggerFormError('Please enter your full name.');
      return;
    }
    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      triggerFormError(invalidUsername);
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      triggerFormError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      triggerFormError('Password must be at least 8 characters.');
      return;
    }
    if (ageStatus === 'under_13') {
      triggerFormError(
        'Athletes under 13 cannot create an independent account (COPPA / GDPR-K). A parent or legal guardian aged 18+ must register and provide verifiable consent during race entry.'
      );
      return;
    }
    if (ageStatus !== '13_plus') {
      triggerFormError('Please confirm your age eligibility before creating an account.');
      return;
    }
    if (!acceptedTerms) {
      triggerFormError('Please accept the Terms of Service, Privacy Policy, Refund Policy, and Cookie Policy to continue.');
      return;
    }

    const termsAcceptedAt = new Date().toISOString();
    const normalizedEmail = email.trim().toLowerCase();
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      saveSignupDraft(normalizedEmail, {
        displayName: displayName.trim(),
        username: normalizeUsername(username),
        role: signupRoleLocked ? 'runner' : signupRole,
        over13Confirmed: true,
        termsAcceptedAt,
        marketingOptIn,
      });
      await signUpWithEmail(normalizedEmail, password, displayName);
      pendingFormDraft = null;
      authCooldown.clear('auth');
      setCooldownSeconds(0);
      setPassword('');
    } catch (err: any) {
      const code = typeof err?.code === 'string' ? err.code : '';
      if (code === 'auth/too-many-requests') {
        authCooldown.start('auth', 60);
        setCooldownSeconds(60);
      } else {
        const penalty = authCooldown.recordFailure('auth', { threshold: 5, baseWaitSec: 15, maxWaitSec: 180 });
        if (penalty > 0) setCooldownSeconds(penalty);
      }
      triggerFormError(err.message?.replace('Firebase: ', '') || 'Failed to create account.');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      triggerFormError(err.message?.replace('Firebase: ', '') || 'Failed to sign in with Google.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authUser) {
    return (
      <CompleteProfileForm
        user={authUser}
        signupRoleLocked={signupRoleLocked}
        onOpenLegal={onOpenLegal}
      />
    );
  }

  if (resettingPassword) {
    return (
      <AuthStage>
        <PasswordResetFlow
          initialEmail={email.includes('@') ? email : ''}
          onBack={() => {
            setResettingPassword(false);
            switchMode('login');
            setPassword('');
          }}
        />
      </AuthStage>
    );
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((current) => !current)}
      className={`absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${focusRing}`}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      aria-pressed={showPassword}
    >
      {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
    </button>
  );

  const errorMessage = error && (
    <p
      key={errorNonce}
      className={`animate-error-nudge text-xs font-semibold flex items-start gap-2 rounded-xl border border-red-600/30 bg-red-50 dark:bg-red-950/35 px-3 py-2 ${accentText}`}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" /> <span>{error}</span>
    </p>
  );

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-5">
        {/* Compact charcoal brand emblem + clear heading */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-36 rounded-2xl border border-zinc-800 dark:border-zinc-700/80 bg-[#141416] px-4 py-3 flex items-center justify-center shadow-sm">
            <img
              src="/assets/racepulse-logo.png"
              alt="RacePulsePH"
              width={144}
              height={42}
              className="w-full h-auto object-contain select-none"
            />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </h1>
        </div>

        {/* Focused auth card with only essential controls */}
        <div className="glass-panel p-6 sm:p-7 text-left space-y-5">
          <div
            className="grid grid-cols-2 glass-inset p-1 gap-1"
            role="group"
            aria-label="Sign in or create an account"
          >
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => switchMode('login')}
              className={`min-h-11 px-3 text-sm font-semibold rounded-[12px] transition-colors ${focusRing} ${
                mode === 'login'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className={`min-h-11 px-3 text-sm font-semibold rounded-[12px] transition-colors ${focusRing} ${
                mode === 'signup'
                  ? 'bg-red-700 text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Create account
            </button>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className={`${buttonBase} bg-white hover:bg-zinc-100 text-zinc-900 border border-[var(--border-default)] dark:border-zinc-500 disabled:opacity-60`}
          >
            <GoogleIcon className="w-4 h-4" /> Continue with Google
          </button>

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="flex-1 h-px bg-[var(--border-default)]" />
            <span className="text-xs text-[var(--text-secondary)]">or</span>
            <span className="flex-1 h-px bg-[var(--border-default)]" />
          </div>

          {/* Keep the form transition clipped with room for the focus rings. */}
          <div className="relative -mx-1 overflow-x-clip px-1">
            <AnimatePresence mode="popLayout" initial={false} custom={(mode === 'signup' ? 'forward' : 'back') satisfies NavDirection}>
              {mode === 'login' ? (
                <m.form
                  key="login-form"
                  custom={'back' satisfies NavDirection}
                  variants={directionalTabVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  onSubmit={handleLogin}
                  noValidate
                  className="space-y-4 [backface-visibility:hidden]"
                >
                <div>
                  <label htmlFor="loginEmail" className={labelClass}>
                    Email or username
                  </label>
                  <div className="relative">
                    <UserIcon className={iconClass} aria-hidden="true" />
                    <input
                      id="loginEmail"
                      type="text"
                      autoComplete="username"
                      required
                      aria-invalid={!!loginEmailErr}
                      aria-describedby={loginEmailErr ? 'login-email-err' : undefined}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => markTouched('loginEmail')}
                      placeholder="you@email.com or username"
                      className={`${inputBaseClass} pl-10 pr-4 ${
                        loginEmailErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                  </div>
                  {loginEmailErr && (
                    <p id="login-email-err" className={errorHintClass}>
                      {loginEmailErr}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <label htmlFor="loginPassword" className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={submitting}
                      className={`min-h-11 inline-flex items-center text-xs font-semibold rounded-md px-3 -my-2 ${accentText} hover:underline disabled:opacity-50 ${focusRing}`}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className={iconClass} aria-hidden="true" />
                    <input
                      id="loginPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      aria-invalid={!!loginPasswordErr}
                      aria-describedby={loginPasswordErr ? 'login-password-err' : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => markTouched('loginPassword')}
                      className={`${inputBaseClass} pl-10 pr-11 ${
                        loginPasswordErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                    {passwordToggle}
                  </div>
                  {loginPasswordErr && (
                    <p id="login-password-err" className={errorHintClass}>
                      {loginPasswordErr}
                    </p>
                  )}
                </div>

                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
                >
                  <label htmlFor="auth-website-hp">Leave blank</label>
                  <input
                    id="auth-website-hp"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {errorMessage}
                {notice && (
                  <p className="text-xs font-semibold flex items-start gap-2 text-emerald-700 dark:text-emerald-300" role="status">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{notice}</span>
                  </p>
                )}

                <button type="submit" disabled={submitting || cooldownSeconds > 0} className={primaryButton(submitting || cooldownSeconds > 0)}>
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Signing in...
                    </>
                  ) : cooldownSeconds > 0 ? (
                    `Wait ${cooldownSeconds}s`
                  ) : (
                    'Sign in'
                  )}
                </button>
              </m.form>
            ) : (
              <m.form
                key="signup-form"
                custom={'forward' satisfies NavDirection}
                variants={directionalTabVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onSubmit={handleSignup}
                noValidate
                className="space-y-4 [backface-visibility:hidden]"
              >
                <div>
                  <label htmlFor="signupName" className={labelClass}>
                    Full name
                  </label>
                  <div className="relative">
                    <UserIcon className={iconClass} aria-hidden="true" />
                    <input
                      id="signupName"
                      type="text"
                      autoComplete="name"
                      required
                      aria-invalid={!!signupNameErr}
                      aria-describedby={signupNameErr ? 'signup-name-err' : undefined}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      onBlur={() => markTouched('signupName')}
                      placeholder="Juan Dela Cruz"
                      className={`${inputBaseClass} pl-10 pr-4 ${
                        signupNameErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                  </div>
                  {signupNameErr && (
                    <p id="signup-name-err" className={errorHintClass}>
                      {signupNameErr}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="signupUsername" className={labelClass}>
                    Username
                  </label>
                  <div className="relative">
                    <UserIcon className={iconClass} aria-hidden="true" />
                    <input
                      id="signupUsername"
                      type="text"
                      required
                      aria-invalid={!!signupUsernameErr}
                      aria-describedby={
                        signupUsernameErr ? 'signup-username-err signup-username-help' : 'signup-username-help'
                      }
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase())}
                      onBlur={() => markTouched('signupUsername')}
                      autoCapitalize="none"
                      autoCorrect="off"
                      maxLength={24}
                      placeholder="juan.runner"
                      className={`${inputBaseClass} pl-10 pr-4 ${
                        signupUsernameErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                  </div>
                  {signupUsernameErr ? (
                    <p id="signup-username-err" className={errorHintClass}>
                      {signupUsernameErr}
                    </p>
                  ) : (
                    <p id="signup-username-help" className={hintClass}>
                      3 to 24 characters: letters, numbers, . _ -
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="signupEmail" className={labelClass}>
                    Email
                  </label>
                  <div className="relative">
                    <Mail className={iconClass} aria-hidden="true" />
                    <input
                      id="signupEmail"
                      type="email"
                      autoComplete="email"
                      required
                      aria-invalid={!!signupEmailErr}
                      aria-describedby={signupEmailErr ? 'signup-email-err signup-email-help' : 'signup-email-help'}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => markTouched('signupEmail')}
                      placeholder="runner@example.com"
                      className={`${inputBaseClass} pl-10 pr-4 ${
                        signupEmailErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                  </div>
                  {signupEmailErr ? (
                    <p id="signup-email-err" className={errorHintClass}>
                      {signupEmailErr}
                    </p>
                  ) : (
                    <p id="signup-email-help" className={hintClass}>
                      We’ll email a 6-digit verification code.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="signupPassword" className={labelClass}>
                    Password
                  </label>
                  <div className="relative">
                    <Lock className={iconClass} aria-hidden="true" />
                    <input
                      id="signupPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      aria-invalid={!!signupPasswordErr}
                      aria-describedby={
                        signupPasswordErr ? 'signup-password-err signup-password-help' : 'signup-password-help'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => markTouched('signupPassword')}
                      className={`${inputBaseClass} pl-10 pr-11 ${
                        signupPasswordErr ? 'border-red-600 dark:border-red-400' : ''
                      }`}
                    />
                    {passwordToggle}
                  </div>
                  {signupPasswordErr ? (
                    <p id="signup-password-err" className={errorHintClass}>
                      {signupPasswordErr}
                    </p>
                  ) : (
                    <p id="signup-password-help" className={hintClass}>
                      At least 8 characters.
                    </p>
                  )}
                </div>

                {signupRoleLocked ? (
                  <p className="text-xs text-[var(--text-secondary)] glass-inset px-4 py-3">
                    Runner account for race registration.
                  </p>
                ) : (
                  <RoleSelector role={signupRole} onChange={setSignupRole} />
                )}

                <SignupConsentFields
                  idPrefix="signup"
                  ageStatus={ageStatus}
                  onAgeStatusChange={setAgeStatus}
                  acceptedTerms={acceptedTerms}
                  onAcceptedTermsChange={setAcceptedTerms}
                  marketingOptIn={marketingOptIn}
                  onMarketingOptInChange={setMarketingOptIn}
                  onOpenLegal={onOpenLegal ? handleOpenLegalDoc : undefined}
                />

                {errorMessage}

                <button
                  type="submit"
                  disabled={submitting || cooldownSeconds > 0 || ageStatus === 'under_13'}
                  className={primaryButton(submitting || cooldownSeconds > 0 || ageStatus === 'under_13')}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Sending code...
                    </>
                  ) : cooldownSeconds > 0 ? (
                    `Wait ${cooldownSeconds}s`
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> Continue to verify email
                    </>
                  )}
                </button>
                </m.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AuthStage>
  );
}

interface SignupConsentFieldsProps {
  idPrefix: string;
  ageStatus: '' | '13_plus' | 'under_13';
  onAgeStatusChange: (status: '13_plus' | 'under_13') => void;
  acceptedTerms: boolean;
  onAcceptedTermsChange: (accepted: boolean) => void;
  marketingOptIn: boolean;
  onMarketingOptInChange: (optIn: boolean) => void;
  onOpenLegal?: (doc: LegalDocKey) => void;
}

function SignupConsentFields({
  idPrefix,
  ageStatus,
  onAgeStatusChange,
  acceptedTerms,
  onAcceptedTermsChange,
  marketingOptIn,
  onMarketingOptInChange,
  onOpenLegal,
}: SignupConsentFieldsProps) {
  return (
    <div className="space-y-3 pt-1">
      <div role="group" aria-labelledby={`${idPrefix}-age-label`} className="space-y-2">
        <span id={`${idPrefix}-age-label`} className={labelClass}>
          Age verification (COPPA &amp; GDPR-K)
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={ageStatus === '13_plus'}
            onClick={() => onAgeStatusChange('13_plus')}
            className={`min-h-11 px-3 rounded-[var(--radius-control)] border text-xs font-semibold transition-colors duration-150 ${focusRing} ${
              ageStatus === '13_plus'
                ? `border-red-700 dark:border-red-400 bg-red-50 dark:bg-red-950/35 ${accentText}`
                : 'glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            I am 13 or older
          </button>
          <button
            type="button"
            aria-pressed={ageStatus === 'under_13'}
            onClick={() => onAgeStatusChange('under_13')}
            className={`min-h-11 px-3 rounded-[var(--radius-control)] border text-xs font-semibold transition-colors duration-150 ${focusRing} ${
              ageStatus === 'under_13'
                ? `border-red-700 dark:border-red-400 bg-red-50 dark:bg-red-950/35 ${accentText}`
                : 'glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            I am under 13
          </button>
        </div>
        {ageStatus === 'under_13' && (
          <p
            role="alert"
            className="text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-[var(--radius-control)] p-3 leading-relaxed"
          >
            Children under 13 cannot open a self-service RacePulsePH account. Have a parent or legal guardian aged 18+ create an account and submit a minor registration with verifiable guardian consent.
          </p>
        )}
      </div>

      <div className="space-y-3 glass-inset p-4 rounded-[var(--radius-control)]">
        <div className="flex items-start gap-2">
          <input
            id={`${idPrefix}-terms`}
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => onAcceptedTermsChange(e.target.checked)}
            className="rp-checkbox shrink-0"
          />
          <div className="pt-2 text-xs text-[var(--text-primary)] leading-relaxed flex-1 min-w-0">
            <label htmlFor={`${idPrefix}-terms`} className="cursor-pointer block">
              I agree to the Terms of Service, Privacy Policy, Refund Policy, and Cookie Policy.
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-2" role="group" aria-label="Legal and cookie policy documents">
              {(
                [
                  { docKey: 'terms', href: '/terms-of-service', label: 'Terms of Service' },
                  { docKey: 'privacy', href: '/privacy-policy', label: 'Privacy Policy' },
                  { docKey: 'refund', href: '/refund-policy', label: 'Refund Policy' },
                  { docKey: 'cookies', href: '/cookie-policy', label: 'Cookie Policy' },
                ] as const
              ).map((item) => (
                <a
                  key={item.docKey}
                  href={item.href}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onOpenLegal && isClientNavigationClick(e)) {
                      e.preventDefault();
                      onOpenLegal(item.docKey);
                    }
                  }}
                  className={`inline-flex items-center whitespace-nowrap min-h-8 px-2 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-2 hover:border-red-600/50 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors ${focusRing}`}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <label htmlFor={`${idPrefix}-marketing`} className="flex items-start gap-2 cursor-pointer min-h-11">
          <input
            id={`${idPrefix}-marketing`}
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => onMarketingOptInChange(e.target.checked)}
            className="rp-checkbox shrink-0"
          />
          <span className="pt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
            Send me optional race announcements and post-event result alerts (you can unsubscribe anytime).
          </span>
        </label>
      </div>
    </div>
  );
}

function RoleSelector({ role, onChange }: { role: SignupRole; onChange: (r: SignupRole) => void }) {
  const option = (value: 'runner' | 'organizer', label: string) => (
    <button
      type="button"
      aria-pressed={role === value}
      onClick={() => onChange(value)}
      className={`h-11 rounded-[var(--radius-control)] border text-sm font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150 motion-safe:active:scale-[0.98] ${focusRing} ${
        role === value
          ? `border-red-700 dark:border-red-400 bg-red-50 dark:bg-red-950/35 ${accentText} shadow-sm`
          : 'glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-labelledby="role-label">
      <span id="role-label" className={labelClass}>
        Role
      </span>
      <div className="grid grid-cols-2 gap-2">
        {option('runner', 'Runner')}
        {option('organizer', 'Organizer')}
      </div>
      <AnimatePresence initial={false}>
        {role === 'organizer' && (
          <m.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={hintClass}
          >
            Organizer accounts require Super Admin approval before recording times.
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompleteProfileForm({
  user,
  signupRoleLocked = false,
  onOpenLegal,
}: {
  user: User;
  signupRoleLocked?: boolean;
  onOpenLegal?: (doc: LegalDocKey) => void;
}) {
  const userEmail = (user.email || '').trim().toLowerCase();
  const [draft] = useState(() => getSignupDraft(userEmail));
  const restored = pendingCompleteProfileDraft?.uid === user.uid ? pendingCompleteProfileDraft : null;
  const [role, setRole] = useState<SignupRole>(signupRoleLocked ? 'runner' : restored?.role || draft?.role || 'runner');
  const [displayName, setDisplayName] = useState(restored?.displayName ?? draft?.displayName ?? user.displayName ?? '');
  const [username, setUsername] = useState(restored?.username ?? draft?.username ?? '');
  const [ageStatus, setAgeStatus] = useState<'' | '13_plus' | 'under_13'>(
    restored?.ageStatus ?? (draft?.over13Confirmed ? '13_plus' : '')
  );
  const [acceptedTerms, setAcceptedTerms] = useState(restored?.acceptedTerms ?? Boolean(draft?.termsAcceptedAt));
  const [marketingOptIn, setMarketingOptIn] = useState(restored?.marketingOptIn ?? Boolean(draft?.marketingOptIn));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    pendingCompleteProfileDraft = {
      uid: user.uid,
      displayName,
      username,
      role,
      ageStatus,
      acceptedTerms,
      marketingOptIn,
    };
  }, [user.uid, displayName, username, role, ageStatus, acceptedTerms, marketingOptIn]);

  const handleOpenLegalDoc = (docKey: LegalDocKey) => {
    pendingCompleteProfileDraft = {
      uid: user.uid,
      displayName,
      username,
      role,
      ageStatus,
      acceptedTerms,
      marketingOptIn,
    };
    onOpenLegal?.(docKey);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      setError(invalidUsername);
      return;
    }
    if (ageStatus === 'under_13') {
      setError(
        'Athletes under 13 cannot complete an independent account (COPPA / GDPR-K). Sign out and ask a parent or legal guardian to register.'
      );
      return;
    }
    if (ageStatus !== '13_plus') {
      setError('Please confirm that you are 13 or older.');
      return;
    }
    if (!acceptedTerms) {
      setError('Please accept the Terms of Service, Privacy Policy, Refund Policy, and Cookie Policy.');
      return;
    }
    setSubmitting(true);
    try {
      await createUserProfileForRole(
        user,
        signupRoleLocked ? 'runner' : role,
        displayName,
        username,
        {
          over13Confirmed: true,
          termsAcceptedAt: draft?.termsAcceptedAt || new Date().toISOString(),
          marketingOptIn,
        }
      );
      clearSignupDraft(userEmail);
      pendingCompleteProfileDraft = null;
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to finish setting up your account.');
    } finally {
      setSubmitting(false);
    }
  };

  const attemptedDraft = React.useRef(false);
  useEffect(() => {
    if (!draft || !draft.over13Confirmed || !draft.termsAcceptedAt || attemptedDraft.current) return;
    attemptedDraft.current = true;
    void handleSubmit({ preventDefault() {} } as React.FormEvent);
  }, []);

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-20 h-20 rounded-[22px] border border-zinc-800 bg-[#141416] p-3 flex items-center justify-center shadow-sm">
            <img
              src="/assets/racepulse-mark-192.png"
              alt="RacePulsePH"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
              Finish profile
            </h1>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto break-all">{user.email}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel p-6 text-left space-y-4">
          <div>
            <label htmlFor="completeName" className={labelClass}>
              Full name
            </label>
            <div className="relative">
              <UserIcon className={iconClass} aria-hidden="true" />
              <input
                id="completeName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`${inputBaseClass} pl-10 pr-4`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="completeUsername" className={labelClass}>
              Username
            </label>
            <div className="relative">
              <UserIcon className={iconClass} aria-hidden="true" />
              <input
                id="completeUsername"
                type="text"
                required
                aria-describedby="complete-username-help"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={24}
                placeholder="juan.runner"
                className={`${inputBaseClass} pl-10 pr-4`}
              />
            </div>
            <p id="complete-username-help" className={hintClass}>
              Used to sign in cleanly.
            </p>
          </div>

          {signupRoleLocked ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-4 py-3">
              Runner account for race registration.
            </p>
          ) : (
            <RoleSelector role={role} onChange={setRole} />
          )}

          <SignupConsentFields
            idPrefix="complete"
            ageStatus={ageStatus}
            onAgeStatusChange={setAgeStatus}
            acceptedTerms={acceptedTerms}
            onAcceptedTermsChange={setAcceptedTerms}
            marketingOptIn={marketingOptIn}
            onMarketingOptInChange={setMarketingOptIn}
            onOpenLegal={onOpenLegal ? handleOpenLegalDoc : undefined}
          />

          {error && (
            <p className={`text-xs font-semibold flex items-start gap-2 ${accentText}`} role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || ageStatus === 'under_13'}
            className={primaryButton(submitting || ageStatus === 'under_13')}
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Saving...
              </>
            ) : (
              'Complete sign up'
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              pendingCompleteProfileDraft = null;
              void signOutUser();
            }}
            className={`w-full h-11 rounded-[var(--radius-control)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors ${focusRing}`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>
    </AuthStage>
  );
}
