import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db, signUpWithEmail, signInWithEmail } from '../firebase';
import { UserProfile } from '../types';
import { Activity, PersonStanding, Mail, Lock, User, ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-react';

type Mode = 'login' | 'signup';
type SignupRole = 'runner' | 'organizer' | 'admin';

export default function AuthGate() {
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
    (async () => {
      try {
        const metaSnap = await getDoc(doc(db, 'system', 'meta'));
        setAdminAvailable(!metaSnap.exists() || metaSnap.data()?.adminClaimed === false);
      } catch (e) {
        console.warn('Could not check founding admin availability:', e);
        setAdminAvailable(false);
      }
    })();
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
      const timestamp = new Date().toISOString();
      const profile: UserProfile = {
        uid: user.uid,
        email: user.email || email.trim(),
        displayName: displayName.trim(),
        role: signupRole,
        approved: signupRole !== 'organizer',
        createdAt: timestamp,
      };

      if (signupRole === 'admin') {
        // Claim the one-time founding-admin slot and mark it taken, atomically.
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', user.uid), profile);
        batch.set(doc(db, 'system', 'meta'), { adminClaimed: true });
        await batch.commit();
      } else {
        await setDoc(doc(db, 'users', user.uid), profile);
      }
      // onAuthStateChanged in App.tsx picks up the new session and routes by role.
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') || 'Failed to create account.');
    } finally {
      setSubmitting(false);
    }
  };

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
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
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

              <div>
                <label className="block text-xs font-bold font-display uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">I am signing up as</label>
                <div className={`grid ${adminAvailable ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                  <button type="button" onClick={() => setSignupRole('runner')}
                    className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${signupRole === 'runner' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                    Runner
                  </button>
                  <button type="button" onClick={() => setSignupRole('organizer')}
                    className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition ${signupRole === 'organizer' ? 'bg-red-500/10 border-red-500/40 text-red-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                    Organizer
                  </button>
                  {adminAvailable && (
                    <button type="button" onClick={() => setSignupRole('admin')}
                      className={`text-xs font-bold uppercase tracking-wide py-2.5 rounded-[16px] border transition flex items-center justify-center gap-1 ${signupRole === 'admin' ? 'bg-amber-500/10 border-amber-500/40 text-amber-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                      <ShieldCheck className="w-3.5 h-3.5" /> Admin
                    </button>
                  )}
                </div>
                {signupRole === 'organizer' && (
                  <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">An Admin needs to approve your Organizer account before you can log in and record times.</p>
                )}
                {signupRole === 'admin' && (
                  <p className="text-[10.5px] text-amber-500 mt-1.5 pl-1">This claims the one-time founding Admin role for this event. Only available while no Admin exists yet.</p>
                )}
              </div>

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
