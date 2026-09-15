import React, { useState, useEffect } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db, signUpWithEmail, signInWithEmail, signInWithGoogle, signOutUser, sendPasswordReset } from '../firebase';
import { isSuperAdminEmail } from '../lib/superAdmin';
import { UserProfile } from '../types';
import type { User } from 'firebase/auth';
import { deleteUser } from 'firebase/auth';
import { Mail, Lock, User as UserIcon, RefreshCw, AlertTriangle, LogOut, Eye, EyeOff } from 'lucide-react';

type Mode = 'login' | 'signup';
type SignupRole = 'runner' | 'organizer' | 'superadmin';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function usernameError(value: string): string | null {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) return 'Username must be 3–24 characters: letters, numbers, dot, underscore, or hyphen.';
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

// Creates the Firestore profile doc for a brand-new user (email/password or
// Google), applying the same role/approval rules and one-time admin claim
// regardless of which auth method they used.
async function createUserProfileForRole(user: User, role: SignupRole, displayNameOverride: string | undefined, usernameInput: string): Promise<void> {
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

  const handleForgotPassword = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email or username first, then tap Forgot password.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(await resolveLoginEmail(email));
      setNotice('If this email has a RacePulsePH account, a password reset link has been sent.');
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Could not send the password reset email.');
    } finally {
      setSubmitting(false);
    }
  };

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
    let newUser: User | null = null;
    try {
      newUser = await signUpWithEmail(email, password, displayName);
      await createUserProfileForRole(newUser, signupRole, displayName, username);
      // onAuthStateChanged in App.tsx picks up the new session and routes by role.
    } catch (err: any) {
      // A duplicate username can only be detected after Firebase Auth creates
      // the email account. Remove that just-created account so the email can
      // immediately be retried with a different username.
      if (newUser) {
        try { await deleteUser(newUser); } catch { /* preserve the original error */ }
      }
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

  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="w-full max-w-md space-y-8 text-center">

        {/* Logo area */}
        <div className="flex flex-col items-center space-y-5">
          <div className="w-full max-w-[15.5rem] rounded-[26px] bg-[#0a0a0a] p-3 shadow-2xl shadow-red-950/30 ring-1 ring-white/10">
            <img
              src="/assets/racepulse-logo.png"
              alt="RacePulsePH"
              className="w-full h-auto"
            />
          </div>
          <div>
            <p className="text-sm text-[var(--text-secondary)] mt-3 max-w-md mx-auto leading-relaxed">
              Sign in to continue as Runner or Organizer.
            </p>
            {onBackToRaces && (
              <button
                type="button"
                onClick={onBackToRaces}
                className="mt-3 text-[11px] font-bold uppercase tracking-wide text-red-500 hover:text-red-400 transition"
              >
                ← Browse race events
              </button>
            )}
          </div>
        </div>

        <div className="glass-panel p-6 text-left space-y-5 animate-fadeIn">

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-lg flex items-center justify-center gap-2.5 transition duration-200 bg-white hover:bg-zinc-100 text-zinc-800 border border-zinc-300 disabled:opacity-60"
          >
            <GoogleIcon className="w-4 h-4" /> Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-[var(--border-subtle)]" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">or</span>
            <span className="flex-1 h-px bg-[var(--border-subtle)]" />
          </div>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 glass-inset p-1">
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`text-xs font-black uppercase tracking-wider py-2.5 rounded-[16px] transition ${mode === 'login' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              className={`text-xs font-black uppercase tracking-wider py-2.5 rounded-[16px] transition ${mode === 'signup' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              Create Account
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="loginEmail" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Email or Username</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="loginEmail" type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com or your.username"
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label htmlFor="loginPassword" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)]">Password</label>
                  <button type="button" onClick={handleForgotPassword} disabled={submitting} className="text-[11px] font-bold text-red-500 hover:text-red-400 disabled:opacity-50">Forgot password?</button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="loginPassword" type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full glass-inset pl-10 pr-11 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-red-500 transition" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-500 font-semibold flex items-center gap-1.5" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                </p>
              )}
              {notice && <p className="text-xs text-emerald-500 font-semibold">✅ {notice}</p>}

              <button type="submit" disabled={submitting}
                className={`w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 ${submitting ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed' : 'text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30'}`}>
                {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Signing In...</> : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label htmlFor="signupName" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="signupName" type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>
              <div>
                <label htmlFor="signupUsername" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Username</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="signupUsername" type="text" required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="e.g. juan.runner"
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">3–24 characters: letters, numbers, dots, underscores, or hyphens.</p>
              </div>
              <div>
                <label htmlFor="signupEmail" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="signupEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>
              <div>
                <label htmlFor="signupPassword" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="signupPassword" type={showPassword ? 'text' : 'password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full glass-inset pl-10 pr-11 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-red-500 transition" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {signupRoleLocked ? (
                <p className="text-[10.5px] text-[var(--text-secondary)] glass-inset px-3 py-2">You’re creating a Runner account so you can register for a race.</p>
              ) : (
                <RoleSelector role={signupRole} onChange={setSignupRole} />
              )}

              {error && (
                <p className="text-xs text-red-500 font-semibold flex items-center gap-1.5" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                </p>
              )}

              <button type="submit" disabled={submitting}
                className={`w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 ${submitting ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed' : 'text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30'}`}>
                {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Creating Account...</> : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleSelector({ role, onChange }: { role: SignupRole; onChange: (r: SignupRole) => void }) {
  return (
    <div>
      <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">I am signing up as</label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onChange('runner')}
          className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${role === 'runner' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
          Runner
        </button>
        <button type="button" onClick={() => onChange('organizer')}
          className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${role === 'organizer' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
          Organizer
        </button>
      </div>
      {role === 'organizer' && (
        <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">A Super Admin needs to approve your Organizer account before you can record times.</p>
      )}
    </div>
  );
}

// Shown right after a first-time Google sign-in: the Firebase Auth session
// already exists, but there's no Firestore profile/role for it yet.
function CompleteProfileForm({ user, signupRoleLocked = false }: { user: User; signupRoleLocked?: boolean }) {
  const [role, setRole] = useState<SignupRole>('runner');
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [username, setUsername] = useState('');
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
      await createUserProfileForRole(user, role, displayName, username);
      // onAuthStateChanged's profile listener in App.tsx picks this up and routes by role.
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to finish setting up your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex flex-col items-center space-y-5">
          <div className="w-20 h-20 rounded-[22px] overflow-hidden bg-[#0a0a0a] shadow-xl shadow-red-950/25 ring-1 ring-white/10">
            <img
              src="/assets/racepulse-mark.png"
              alt="RacePulsePH"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="heading-float text-3xl sm:text-4xl font-black tracking-tight font-display text-[var(--text-primary)] uppercase">One Last Step</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-3 max-w-md mx-auto leading-relaxed">
              Signed in as <strong className="text-[var(--text-primary)]">{user.email}</strong>. Finish setting up your account.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="glass-panel p-6 text-left space-y-4 animate-fadeIn">
          <div>
            <label htmlFor="completeName" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
            <div className="relative">
              <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input id="completeName" type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
            </div>
          </div>
          <div>
            <label htmlFor="completeUsername" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Username</label>
            <div className="relative">
              <UserIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input id="completeUsername" type="text" required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="e.g. juan.runner"
                className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">This will be your sign-in username.</p>
          </div>

          {signupRoleLocked ? (
            <p className="text-[10.5px] text-[var(--text-secondary)] glass-inset px-3 py-2">Your Runner account will be used for race registration and timing results.</p>
          ) : (
            <RoleSelector role={role} onChange={setRole} />
          )}

          {error && (
            <p className="text-xs text-red-500 font-semibold flex items-center gap-1.5" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}

          <button type="submit" disabled={submitting}
            className={`w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 ${submitting ? 'bg-[var(--surface-hover)] text-[var(--text-secondary)] cursor-not-allowed' : 'text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30'}`}>
            {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Finishing Setup...</> : 'Complete Sign Up'}
          </button>

          <button
            type="button"
            onClick={() => signOutUser()}
            className="w-full text-xs text-[var(--text-secondary)] hover:text-red-500 font-bold flex items-center justify-center gap-1.5 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Not you? Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
