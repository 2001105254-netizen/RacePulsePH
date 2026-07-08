import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db, signUpWithEmail, signInWithEmail, signInWithGoogle, signOutUser } from '../firebase';
import { UserProfile } from '../types';
import type { User } from 'firebase/auth';
import { Activity, PersonStanding, Mail, Lock, User as UserIcon, ShieldCheck, RefreshCw, AlertTriangle, LogOut } from 'lucide-react';

type Mode = 'login' | 'signup';
type SignupRole = 'runner' | 'organizer' | 'admin';

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
async function createUserProfileForRole(user: User, role: SignupRole, displayNameOverride?: string): Promise<void> {
  const profile: UserProfile = {
    uid: user.uid,
    email: user.email || '',
    displayName: displayNameOverride?.trim() || user.displayName || 'Runner',
    role,
    approved: role !== 'organizer',
    createdAt: new Date().toISOString(),
  };

  if (role === 'admin') {
    // Claim the one-time founding-admin slot and mark it taken, atomically.
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', user.uid), profile);
    batch.set(doc(db, 'system', 'meta'), { adminClaimed: true });
    await batch.commit();
  } else {
    await setDoc(doc(db, 'users', user.uid), profile);
  }
}

async function checkAdminAvailable(): Promise<boolean> {
  try {
    const metaSnap = await getDoc(doc(db, 'system', 'meta'));
    return !metaSnap.exists() || metaSnap.data()?.adminClaimed === false;
  } catch (e) {
    console.warn('Could not check founding admin availability:', e);
    return false;
  }
}

interface AuthGateProps {
  // Set when Firebase Auth already has a signed-in user (e.g. just completed
  // a Google popup) but no Firestore profile exists for them yet.
  authUser?: User | null;
}

export default function AuthGate({ authUser }: AuthGateProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupRole, setSignupRole] = useState<SignupRole>('runner');
  const [adminAvailable, setAdminAvailable] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Check once whether the founding-admin slot is still open
  useEffect(() => {
    checkAdminAvailable().then(setAdminAvailable);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await signUpWithEmail(email, password, displayName);
      await createUserProfileForRole(user, signupRole, displayName);
      // onAuthStateChanged in App.tsx picks up the new session and routes by role.
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
    return <CompleteProfileForm user={authUser} adminAvailable={adminAvailable} />;
  }

  return (
    <div className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
      <div className="w-full max-w-md space-y-8 text-center">

        {/* Logo area */}
        <div className="flex flex-col items-center space-y-5">
          <div className="w-20 h-20 bg-gradient-to-tr from-red-700 to-red-500 rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-red-950/25 rotate-3 hover:rotate-0 duration-300 transform relative overflow-hidden">
            <Activity className="w-14 h-14 stroke-[1.5] text-red-950/40 absolute animate-pulse" />
            <PersonStanding className="w-10 h-10 stroke-[2] -rotate-12 skew-x-6 relative text-white translate-x-1" />
          </div>
          <div>
            <h1 className="heading-float text-4xl sm:text-5xl font-black tracking-tight font-display text-[var(--text-primary)] uppercase">
              RacePulse<span className="text-red-500 font-light font-bold">PH</span>
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-3 max-w-md mx-auto leading-relaxed">
              Sign in to continue as Runner, Organizer, or Admin.
            </p>
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
                <label htmlFor="loginEmail" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="loginEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>
              <div>
                <label htmlFor="loginPassword" className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input id="loginPassword" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-500 font-semibold flex items-center gap-1.5" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                </p>
              )}

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
                  <input id="signupPassword" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full glass-inset pl-10 pr-4 py-3.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition" />
                </div>
              </div>

              <RoleSelector role={signupRole} onChange={setSignupRole} adminAvailable={adminAvailable} />

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

function RoleSelector({ role, onChange, adminAvailable }: { role: SignupRole; onChange: (r: SignupRole) => void; adminAvailable: boolean }) {
  return (
    <div>
      <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">I am signing up as</label>
      <div className={`grid ${adminAvailable ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
        <button type="button" onClick={() => onChange('runner')}
          className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${role === 'runner' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
          Runner
        </button>
        <button type="button" onClick={() => onChange('organizer')}
          className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${role === 'organizer' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
          Organizer
        </button>
        {adminAvailable && (
          <button type="button" onClick={() => onChange('admin')}
            className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition flex items-center justify-center gap-1 ${role === 'admin' ? 'bg-amber-500/10 border-amber-500/40 text-amber-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            <ShieldCheck className="w-3.5 h-3.5" /> Admin
          </button>
        )}
      </div>
      {role === 'organizer' && (
        <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">An Admin needs to approve your Organizer account before you can log in and record times.</p>
      )}
      {role === 'admin' && (
        <p className="text-[10.5px] text-amber-500 mt-1.5 pl-1">This claims the one-time founding Admin role for this event. Only available while no Admin exists yet.</p>
      )}
    </div>
  );
}

// Shown right after a first-time Google sign-in: the Firebase Auth session
// already exists, but there's no Firestore profile/role for it yet.
function CompleteProfileForm({ user, adminAvailable }: { user: User; adminAvailable: boolean }) {
  const [role, setRole] = useState<SignupRole>('runner');
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    setSubmitting(true);
    try {
      await createUserProfileForRole(user, role, displayName);
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
          <div className="w-20 h-20 bg-gradient-to-tr from-red-700 to-red-500 rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-red-950/25 rotate-3 hover:rotate-0 duration-300 transform relative overflow-hidden">
            <Activity className="w-14 h-14 stroke-[1.5] text-red-950/40 absolute animate-pulse" />
            <PersonStanding className="w-10 h-10 stroke-[2] -rotate-12 skew-x-6 relative text-white translate-x-1" />
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

          <RoleSelector role={role} onChange={setRole} adminAvailable={adminAvailable} />

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
