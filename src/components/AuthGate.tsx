import React, { useState, useEffect, useId } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { directionalTabVariants, type NavDirection } from './ui/MotionPrimitives';
import { db, signUpWithEmail, signInWithEmail, signInWithGoogle, signOutUser } from '../firebase';
import { clearSignupDraft, getSignupDraft, saveSignupDraft } from '../lib/accountSecurity';
import { PasswordResetFlow } from './AccountSecurity';
import { isSuperAdminEmail } from '../lib/superAdmin';
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

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const accentText = 'text-red-700 dark:text-red-400';
const labelClass = 'block text-xs font-semibold text-[var(--text-secondary)] mb-1.5';
const hintClass = 'mt-1.5 text-xs text-[var(--text-secondary)]';
const errorHintClass = 'mt-1.5 text-xs font-semibold text-red-700 dark:text-red-400';
const inputBaseClass =
  'w-full glass-inset h-11 text-sm sm:text-base font-normal text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400 transition-colors';
const iconClass = 'w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none';
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';
const buttonBase = `w-full h-11 px-5 rounded-[var(--radius-control)] text-sm sm:text-base font-semibold flex items-center justify-center gap-2 transition-all duration-150 motion-safe:active:scale-[0.99] ${focusRing}`;
const primaryButton = (busy: boolean) =>
  `${buttonBase} ${
    busy
      ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed'
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
  const usernameDoc = await getDoc(doc(db, 'usernameIndex', normalizeUsername(value)));
  const accountEmail = usernameDoc.exists() ? String(usernameDoc.data().email || '').trim() : '';
  if (!accountEmail) throw new Error('No account found for that username. Try your email address instead.');
  return accountEmail;
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

// Centered stage with subtle GPU-composited backdrop glow.
function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex-grow flex items-center justify-center overflow-hidden py-6 sm:py-10 px-4">
      <div className="auth-backdrop" aria-hidden="true">
        <span className="auth-glow" />
        <span className="auth-beam" />
        <span className="auth-pulse" />
        <span className="auth-pulse auth-pulse-late" />
      </div>
      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full flex justify-center"
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
  usernameInput: string
): Promise<void> {
  if (!user.emailVerified) {
    throw new Error('Verify your email with the six-digit code before completing your account.');
  }
  const username = normalizeUsername(usernameInput);
  const invalidUsername = usernameError(username);
  if (invalidUsername) throw new Error(invalidUsername);
  const assignedRole: SignupRole = isSuperAdminEmail(user.email) ? 'superadmin' : role;
  const profile: UserProfile = {
    uid: user.uid,
    email: user.email || '',
    displayName: displayNameOverride?.trim() || user.displayName || 'Runner',
    username,
    role: assignedRole,
    approved: assignedRole !== 'organizer',
    createdAt: new Date().toISOString(),
  };

  await runTransaction(db, async (transaction) => {
    const usernameRef = doc(db, 'usernameIndex', username);
    const existingUsername = await transaction.get(usernameRef);
    if (existingUsername.exists()) throw new Error('That username is already taken. Please choose another one.');

    transaction.set(doc(db, 'users', user.uid), profile);
    transaction.set(doc(db, 'friendDirectory', username), {
      uid: user.uid,
      username,
      displayName: profile.displayName,
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
      updatedAt: profile.createdAt,
    });
    transaction.set(doc(db, 'friendProfiles', user.uid), {
      uid: user.uid,
      username,
      displayName: profile.displayName,
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
      updatedAt: profile.createdAt,
    });
    transaction.set(usernameRef, {
      username,
      uid: user.uid,
      email: user.email || '',
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
  onOpenLegal?: (doc: 'privacy' | 'terms') => void;
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [signupRole, setSignupRole] = useState<SignupRole>('runner');
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [error, setError] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const authModeGroupId = useId();

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setNotice('');
    setTouched({});
  }, [initialMode]);

  const markTouched = (field: FieldKey) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError('');
    setNotice('');
    setTouched({});
    onModeChange?.(next);
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
    touched.signupPassword && password.length < 6 ? 'Password must be at least 6 characters.' : null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched((prev) => ({ ...prev, loginEmail: true, loginPassword: true }));
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      triggerFormError('Enter your email or username and password.');
      return;
    }
    setSubmitting(true);
    try {
      const accountEmail = await resolveLoginEmail(email);
      await signInWithEmail(accountEmail, password);
    } catch (err: any) {
      triggerFormError(err.message?.replace('Firebase: ', '') || 'Failed to sign in.');
    } finally {
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
    if (password.length < 6) {
      triggerFormError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      saveSignupDraft(email, {
        displayName: displayName.trim(),
        username: normalizeUsername(username),
        role: signupRoleLocked ? 'runner' : signupRole,
      });
      await signUpWithEmail(email, password, displayName);
      setPassword('');
    } catch (err: any) {
      triggerFormError(err.message?.replace('Firebase: ', '') || 'Failed to create account.');
    } finally {
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
    return <CompleteProfileForm user={authUser} signupRoleLocked={signupRoleLocked} />;
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
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> <span>{error}</span>
    </p>
  );

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-5">
        {/* Compact charcoal brand emblem + clear heading */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-36 rounded-2xl border border-zinc-800 dark:border-zinc-700/80 bg-[#141416] px-3.5 py-2.5 flex items-center justify-center shadow-sm">
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
          <LayoutGroup id={authModeGroupId}>
            <div
              className="grid grid-cols-2 glass-inset p-1 gap-1"
              role="group"
              aria-label="Sign in or create an account"
            >
              <button
                type="button"
                aria-pressed={mode === 'login'}
                onClick={() => switchMode('login')}
                className={`relative isolate text-sm font-semibold h-10 rounded-[12px] transition-colors ${focusRing} ${
                  mode === 'login'
                    ? 'text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {mode === 'login' && (
                  <m.span
                    layoutId={`auth-mode-pill-${authModeGroupId}`}
                    aria-hidden="true"
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[12px] bg-red-700 shadow-sm"
                  />
                )}
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={mode === 'signup'}
                onClick={() => switchMode('signup')}
                className={`relative isolate text-sm font-semibold h-10 rounded-[12px] transition-colors ${focusRing} ${
                  mode === 'signup'
                    ? 'text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {mode === 'signup' && (
                  <m.span
                    layoutId={`auth-mode-pill-${authModeGroupId}`}
                    aria-hidden="true"
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[12px] bg-red-700 shadow-sm"
                  />
                )}
                Create account
              </button>
            </div>
          </LayoutGroup>

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

          <div className="relative overflow-x-clip">
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
                  <div className="flex items-center justify-between gap-4 mb-1.5">
                    <label htmlFor="loginPassword" className="block text-xs font-semibold text-[var(--text-secondary)]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={submitting}
                      className={`text-xs font-semibold rounded-md px-2 py-2 -my-2 ${accentText} hover:underline disabled:opacity-50 ${focusRing}`}
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

                {errorMessage}
                {notice && (
                  <p className="text-xs font-semibold flex items-start gap-2 text-emerald-700 dark:text-emerald-300" role="status">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{notice}</span>
                  </p>
                )}

                <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Signing in...
                    </>
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
                      minLength={6}
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
                      At least 6 characters.
                    </p>
                  )}
                </div>

                {signupRoleLocked ? (
                  <p className="text-xs text-[var(--text-secondary)] glass-inset px-3.5 py-2.5">
                    Runner account for race registration.
                  </p>
                ) : (
                  <RoleSelector role={signupRole} onChange={setSignupRole} />
                )}

                {errorMessage}

                <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Sending code...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> Continue to verify email
                    </>
                  )}
                </button>

                {onOpenLegal && (
                  <p className="text-xs text-[var(--text-secondary)] text-center">
                    <button
                      type="button"
                      onClick={() => onOpenLegal('terms')}
                      className="font-semibold text-[var(--text-primary)] underline underline-offset-4 hover:text-red-700 dark:hover:text-red-400"
                    >
                      Terms of Use
                    </button>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => onOpenLegal('privacy')}
                      className="font-semibold text-[var(--text-primary)] underline underline-offset-4 hover:text-red-700 dark:hover:text-red-400"
                    >
                      Privacy Policy
                    </button>
                  </p>
                )}
                </m.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AuthStage>
  );
}

function RoleSelector({ role, onChange }: { role: SignupRole; onChange: (r: SignupRole) => void }) {
  const option = (value: 'runner' | 'organizer', label: string) => (
    <button
      type="button"
      aria-pressed={role === value}
      onClick={() => onChange(value)}
      className={`h-11 rounded-[var(--radius-control)] border text-sm font-semibold transition-all duration-150 motion-safe:active:scale-[0.98] ${focusRing} ${
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

function CompleteProfileForm({ user, signupRoleLocked = false }: { user: User; signupRoleLocked?: boolean }) {
  const [draft] = useState(() => getSignupDraft(user.email || ''));
  const [role, setRole] = useState<SignupRole>(signupRoleLocked ? 'runner' : draft?.role || 'runner');
  const [displayName, setDisplayName] = useState(draft?.displayName || user.displayName || '');
  const [username, setUsername] = useState(draft?.username || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    setSubmitting(true);
    try {
      await createUserProfileForRole(user, signupRoleLocked ? 'runner' : role, displayName, username);
      clearSignupDraft(user.email || '');
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to finish setting up your account.');
    } finally {
      setSubmitting(false);
    }
  };

  const attemptedDraft = React.useRef(false);
  useEffect(() => {
    if (!draft || attemptedDraft.current) return;
    attemptedDraft.current = true;
    void handleSubmit({ preventDefault() {} } as React.FormEvent);
  }, []);

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-20 h-20 rounded-[22px] border border-zinc-800 bg-[#141416] p-2.5 flex items-center justify-center shadow-sm">
            <img
              src="/assets/racepulse-mark.png"
              alt="RacePulsePH"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-1.5">
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
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-3.5 py-2.5">
              Runner account for race registration.
            </p>
          ) : (
            <RoleSelector role={role} onChange={setRole} />
          )}

          {error && (
            <p className={`text-xs font-semibold flex items-start gap-2 ${accentText}`} role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
            </p>
          )}

          <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
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
            onClick={() => signOutUser()}
            className={`w-full h-11 rounded-[var(--radius-control)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors ${focusRing}`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>
    </AuthStage>
  );
}
