import React, { useState, useEffect } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db, signUpWithEmail, signInWithEmail, signInWithGoogle, signOutUser } from '../firebase';
import { clearSignupDraft, getSignupDraft, saveSignupDraft } from '../lib/accountSecurity';
import { PasswordResetFlow } from './AccountSecurity';
import { isSuperAdminEmail } from '../lib/superAdmin';
import { UserProfile } from '../types';
import type { User } from 'firebase/auth';
import { Mail, Lock, User as UserIcon, RefreshCw, AlertTriangle, LogOut, Eye, EyeOff, ShieldCheck, CheckCircle2, ArrowLeft } from 'lucide-react';

type Mode = 'login' | 'signup';
type SignupRole = 'runner' | 'organizer' | 'superadmin';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

// Shared control styles. One definition keeps every field on the same type
// scale (base for input text, xs for labels and hints) and the same 4/8 spacing.
const accentText = 'text-red-700 dark:text-red-400';
const labelClass = 'block text-xs font-semibold text-[var(--text-secondary)] mb-2';
const hintClass = 'mt-2 text-xs text-[var(--text-secondary)]';
const inputClass = 'w-full glass-inset py-3 text-base font-normal text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400 transition-colors';
const iconClass = 'w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none';
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]';
const buttonBase = `w-full h-12 px-6 rounded-[var(--radius-control)] text-base font-semibold flex items-center justify-center gap-2 transition-colors duration-150 ${focusRing}`;
const primaryButton = (busy: boolean) =>
  `${buttonBase} ${busy ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed' : 'bg-red-700 hover:bg-red-800 text-white'}`;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function usernameError(value: string): string | null {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) return 'Username must be 3 to 24 characters: letters, numbers, dot, underscore, or hyphen.';
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
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// Moving backdrop for the sign-in screens. Purpose: "RacePulse" is a heartbeat
// plus a timing beam, so the page shows exactly that: a slow red beam sweeping
// the screen like a finish-line scanner, and rings that expand from behind the
// logo like a pulse. Layers animate transform and opacity only (see .auth-*
// in index.css) and freeze under prefers-reduced-motion.
function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex-grow flex items-center justify-center overflow-hidden py-16 px-4">
      <div className="auth-backdrop" aria-hidden="true">
        <span className="auth-glow" />
        <span className="auth-beam" />
        <span className="auth-pulse" />
        <span className="auth-pulse auth-pulse-late" />
      </div>
      <div className="relative w-full flex justify-center animate-fadeIn">{children}</div>
    </div>
  );
}

// Creates the Firestore profile doc for a brand-new user (email/password or
// Google), applying the same role/approval rules and one-time admin claim
// regardless of which auth method they used.
async function createUserProfileForRole(user: User, role: SignupRole, displayNameOverride: string | undefined, usernameInput: string): Promise<void> {
  if (!user.emailVerified) throw new Error('Verify your email with the six-digit code before completing your account.');
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

  // The index has one immutable document per normalized username. The
  // transaction makes the "username available" check and profile creation one
  // operation, so two people cannot successfully claim the same username.
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
      // The Firestore rule verifies this exact signed-in email and permits this
      // one-time claim only while the Super Admin slot is unclaimed.
      transaction.set(doc(db, 'system', 'meta'), { superAdminClaimed: true }, { merge: true });
    }
  });
}

interface AuthGateProps {
  // Set when Firebase Auth already has a signed-in user (e.g. just completed
  // a Google popup) but no Firestore profile exists for them yet.
  authUser?: User | null;
  initialMode?: Mode;
  onBackToRaces?: () => void;
  signupRoleLocked?: boolean;
}

export default function AuthGate({ authUser, initialMode = 'login', onBackToRaces, signupRoleLocked = false }: AuthGateProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [signupRole, setSignupRole] = useState<SignupRole>('runner');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const accountEmail = await resolveLoginEmail(email);
      await signInWithEmail(accountEmail, password);
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = () => { setError(''); setNotice(''); setPassword(''); setResettingPassword(true); };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    const invalidUsername = usernameError(username);
    if (invalidUsername) {
      setError(invalidUsername);
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      // Save only profile details before the Auth listener opens verification.
      // The profile is created only after the backend verifies email ownership.
      saveSignupDraft(email, { displayName: displayName.trim(), username: normalizeUsername(username), role: signupRoleLocked ? 'runner' : signupRole });
      await signUpWithEmail(email, password, displayName);
      setPassword('');
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to create account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      await signInWithGoogle();
      // If this is a brand-new Google user, App.tsx will find no Firestore
      // profile and re-render AuthGate with authUser set - see the branch below.
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to sign in with Google.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authUser) {
    return <CompleteProfileForm user={authUser} signupRoleLocked={signupRoleLocked} />;
  }

  if (resettingPassword) {
    return <AuthStage><PasswordResetFlow initialEmail={email.includes('@') ? email : ''} onBack={() => { setResettingPassword(false); setMode('login'); setPassword(''); }} /></AuthStage>;
  }

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((current) => !current)}
      className={`absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${focusRing}`}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      aria-pressed={showPassword}
    >
      {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
    </button>
  );

  const errorMessage = error && (
    <p className={`text-xs font-semibold flex items-start gap-2 ${accentText}`} role="alert">
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
    </p>
  );

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-8">

        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-full max-w-[16rem] rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-transparent p-4 flex items-center justify-center transition-colors">
            <img
              src="/assets/racepulse-logo.png"
              alt="RacePulsePH"
              className="w-full h-auto"
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
              {mode === 'signup' ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="text-base text-[var(--text-primary)] max-w-sm mx-auto">
              {mode === 'signup' ? 'Create your account, then verify your email to join RacePulse.' : 'Sign in to continue as Runner or Organizer.'}
            </p>
          </div>
          {onBackToRaces && (
            <button
              type="button"
              onClick={onBackToRaces}
              className={`inline-flex items-center gap-2 text-xs font-semibold rounded-md px-2 py-2 text-[var(--text-primary)] underline underline-offset-4 ${focusRing}`}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Browse race events
            </button>
          )}
        </div>

        <div className="glass-panel p-6 text-left space-y-6">

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className={`${buttonBase} bg-zinc-50 hover:bg-zinc-100 text-zinc-800 border border-zinc-300 disabled:opacity-60`}
          >
            <GoogleIcon className="w-4 h-4" /> Continue with Google
          </button>

          <div className="flex items-center gap-4" aria-hidden="true">
            <span className="flex-1 h-px bg-[var(--border-default)]" />
            <span className="text-xs text-[var(--text-secondary)]">or use email</span>
            <span className="flex-1 h-px bg-[var(--border-default)]" />
          </div>

          <div className="grid grid-cols-2 glass-inset p-1 gap-1" role="group" aria-label="Sign in or create an account">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => { setMode('login'); setError(''); }}
              className={`text-base font-semibold h-10 rounded-[12px] transition-colors ${focusRing} ${mode === 'login' ? 'bg-red-700 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'signup'}
              onClick={() => { setMode('signup'); setError(''); }}
              className={`text-base font-semibold h-10 rounded-[12px] transition-colors ${focusRing} ${mode === 'signup' ? 'bg-red-700 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              Create account
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="loginEmail" className={labelClass}>Email or username</label>
                <div className="relative">
                  <UserIcon className={iconClass} aria-hidden="true" />
                  <input id="loginEmail" type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com or your.username"
                    className={`${inputClass} pl-12 pr-4`} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <label htmlFor="loginPassword" className="block text-xs font-semibold text-[var(--text-secondary)]">Password</label>
                  <button type="button" onClick={handleForgotPassword} disabled={submitting} className={`text-xs font-semibold rounded-md px-2 py-2 -my-2 ${accentText} hover:underline disabled:opacity-50 ${focusRing}`}>Forgot password?</button>
                </div>
                <div className="relative">
                  <Lock className={iconClass} aria-hidden="true" />
                  <input id="loginPassword" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pl-12 pr-12`} />
                  {passwordToggle}
                </div>
              </div>

              {errorMessage}
              {notice && (
                <p className="text-xs font-semibold flex items-start gap-2 text-emerald-700 dark:text-emerald-300" role="status">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{notice}</span>
                </p>
              )}

              <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
                {submitting ? <><RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Signing in…</> : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <ol aria-label="Account creation steps" className="flex items-center gap-4 text-xs font-semibold text-[var(--text-secondary)]">
                <li aria-current="step" className={accentText}>1. Account details</li>
                <li aria-hidden="true" className="h-px flex-1 bg-[var(--border-default)]" />
                <li>2. Verify email</li>
              </ol>
              <div>
                <label htmlFor="signupName" className={labelClass}>Full name</label>
                <div className="relative">
                  <UserIcon className={iconClass} aria-hidden="true" />
                  <input id="signupName" type="text" autoComplete="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    className={`${inputClass} pl-12 pr-4`} />
                </div>
              </div>
              <div>
                <label htmlFor="signupUsername" className={labelClass}>Username</label>
                <div className="relative">
                  <UserIcon className={iconClass} aria-hidden="true" />
                  <input id="signupUsername" type="text" required aria-describedby="signup-username-help" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="e.g. juan.runner"
                    className={`${inputClass} pl-12 pr-4`} />
                </div>
                <p id="signup-username-help" className={hintClass}>3 to 24 characters: letters, numbers, dots, underscores, or hyphens.</p>
              </div>
              <div>
                <label htmlFor="signupEmail" className={labelClass}>Email</label>
                <div className="relative">
                  <Mail className={iconClass} aria-hidden="true" />
                  <input id="signupEmail" type="email" autoComplete="email" required aria-describedby="signup-email-help" value={email} onChange={(e) => setEmail(e.target.value)}
                    className={`${inputClass} pl-12 pr-4`} />
                </div>
                <p id="signup-email-help" className={hintClass}>We’ll send a six-digit code to this address. Enter it on the next screen to verify your email.</p>
              </div>
              <div>
                <label htmlFor="signupPassword" className={labelClass}>Password</label>
                <div className="relative">
                  <Lock className={iconClass} aria-hidden="true" />
                  <input id="signupPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={6} aria-describedby="signup-password-help" value={password} onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pl-12 pr-12`} />
                  {passwordToggle}
                </div>
                <p id="signup-password-help" className={hintClass}>At least 6 characters.</p>
              </div>

              {signupRoleLocked ? (
                <p className="text-xs text-[var(--text-secondary)] glass-inset px-4 py-3">You’re creating a Runner account so you can register for a race.</p>
              ) : (
                <RoleSelector role={signupRole} onChange={setSignupRole} />
              )}

              {errorMessage}

              <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
                {submitting ? <><RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Preparing verification…</> : <><ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> Continue to email verification</>}
              </button>
            </form>
          )}
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
      className={`h-12 rounded-[var(--radius-control)] border text-base font-semibold transition-colors ${focusRing} ${role === value ? `border-red-700 dark:border-red-400 bg-[var(--surface-card)] ${accentText}` : 'glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-labelledby="role-label">
      <span id="role-label" className={labelClass}>I am signing up as</span>
      <div className="grid grid-cols-2 gap-2">
        {option('runner', 'Runner')}
        {option('organizer', 'Organizer')}
      </div>
      {role === 'organizer' && (
        <p className={hintClass}>A Super Admin needs to approve your Organizer account before you can record times.</p>
      )}
    </div>
  );
}

// Shown after verified signup or first-time Google sign-in when the Firebase
// session exists but the account still needs its profile/role.
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
      // onAuthStateChanged's profile listener in App.tsx picks this up and routes by role.
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to finish setting up your account.');
    } finally {
      setSubmitting(false);
    }
  };

  // Resume the submitted signup automatically after email verification.
  // A username collision leaves the populated form available for correction.
  const attemptedDraft = React.useRef(false);
  useEffect(() => {
    if (!draft || attemptedDraft.current) return;
    attemptedDraft.current = true;
    void handleSubmit({ preventDefault() {} } as React.FormEvent);
  }, []);

  return (
    <AuthStage>
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-20 h-20 rounded-[22px] border border-[var(--border-default)] bg-transparent p-2 flex items-center justify-center transition-colors">
            <img
              src="/assets/racepulse-mark.png"
              alt="RacePulsePH"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">One last step</h1>
            <p className="text-base text-[var(--text-primary)] max-w-sm mx-auto">
              Signed in as <strong className="font-semibold text-[var(--text-primary)] break-all">{user.email}</strong>. Finish setting up your account.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel p-6 text-left space-y-4">
          <div>
            <label htmlFor="completeName" className={labelClass}>Full name</label>
            <div className="relative">
              <UserIcon className={iconClass} aria-hidden="true" />
              <input id="completeName" type="text" autoComplete="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className={`${inputClass} pl-12 pr-4`} />
            </div>
          </div>
          <div>
            <label htmlFor="completeUsername" className={labelClass}>Username</label>
            <div className="relative">
              <UserIcon className={iconClass} aria-hidden="true" />
              <input id="completeUsername" type="text" required aria-describedby="complete-username-help" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="e.g. juan.runner"
                className={`${inputClass} pl-12 pr-4`} />
            </div>
            <p id="complete-username-help" className={hintClass}>This will be your sign-in username.</p>
          </div>

          {signupRoleLocked ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-4 py-3">Your Runner account will be used for race registration and timing results.</p>
          ) : (
            <RoleSelector role={role} onChange={setRole} />
          )}

          {error && (
            <p className={`text-xs font-semibold flex items-start gap-2 ${accentText}`} role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
            </p>
          )}

          <button type="submit" disabled={submitting} className={primaryButton(submitting)}>
            {submitting ? <><RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Finishing setup…</> : 'Complete sign up'}
          </button>

          <button
            type="button"
            onClick={() => signOutUser()}
            className={`w-full h-12 rounded-[var(--radius-control)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors ${focusRing}`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Not you? Sign out
          </button>
        </form>
      </div>
    </AuthStage>
  );
}
