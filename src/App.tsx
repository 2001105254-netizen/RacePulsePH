import React, { useState, useEffect } from 'react';
import CustomerForm from './components/CustomerForm';
import OperatorDashboard from './components/OperatorDashboard';
import { Laptop, Users, ShieldAlert, Sparkles, PersonStanding, Activity, Sun, Moon } from 'lucide-react';

type UserRole = 'selector' | 'customer' | 'operator';
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
  const [currentRole, setCurrentRole] = useState<UserRole>('selector');
  const [passcode, setPasscode] = useState('');
  const [showPasscodeError, setShowPasscodeError] = useState(false);
  const [showPasscodeField, setShowPasscodeField] = useState(false);

  const [operatorPasscode, setOperatorPasscode] = useState(() => {
    return localStorage.getItem('racepulse_passcode') || '1234';
  });

  const handleUpdatePasscode = (newPasscode: string) => {
    setOperatorPasscode(newPasscode);
    localStorage.setItem('racepulse_passcode', newPasscode);
  };

  const handleSelectRole = (role: UserRole) => {
    if (role === 'operator') {
      setShowPasscodeField(true);
      setShowPasscodeError(false);
    } else {
      setCurrentRole(role);
    }
  };

  const handleVerifyPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === operatorPasscode) {
      setCurrentRole('operator');
      setShowPasscodeField(false);
      setPasscode('');
    } else {
      setShowPasscodeError(true);
      setPasscode('');
    }
  };

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
        {currentRole === 'selector' && (
          <div id="role_selection_container" className="hero-glow flex-grow flex items-center justify-center py-14 px-4 animate-fadeIn">
            <div className="w-full max-w-3xl space-y-10 text-center">

              {/* Logo area */}
              <div className="flex flex-col items-center space-y-5">
                <div className="w-20 h-20 bg-gradient-to-tr from-red-700 to-red-500 rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-red-950/25 rotate-3 hover:rotate-0 duration-300 transform relative overflow-hidden">
                  <Activity className="w-14 h-14 stroke-[1.5] text-red-950/40 absolute animate-pulse" />
                  <PersonStanding className="w-10 h-10 stroke-[2] -rotate-12 skew-x-6 relative text-white translate-x-1" />
                </div>
                <div>
                  <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display uppercase glass-inset py-1.5 px-4 rounded-full inline-block">
                    Loud & Clear Presents
                  </span>
                  <h1 className="heading-float text-5xl sm:text-6xl font-black tracking-tight font-display text-[var(--text-primary)] mt-4 uppercase">
                    RacePulse<span className="text-red-500 font-light font-bold">PH</span>
                  </h1>
                  <p className="text-sm text-[var(--text-secondary)] mt-3 max-w-md mx-auto leading-relaxed">
                    Bespoke medal engraving companion. Perfect synchronization for runners to personalize inscriptions and operators to engrave instantly.
                  </p>
                </div>
              </div>

              {/* Selection Grid */}
              {!showPasscodeField ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 max-w-2xl mx-auto">

                  {/* 1. Customer Card */}
                  <button
                    onClick={() => handleSelectRole('customer')}
                    className="glass-panel hover:border-red-500/40 p-6 md:p-8 text-left space-y-4 hover:shadow-2xl hover:shadow-red-950/10 transition duration-300 transform hover:-translate-y-1 text-[var(--text-primary)]"
                  >
                    <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 shadow-sm">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold font-display tracking-tight text-[var(--text-primary)] flex items-center gap-1.5">
                        I am a Runner
                        <Sparkles className="w-4 h-4 text-red-400 animate-pulse" />
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
                        Register your bespoke medal details: Full Name, Bib, finish time, and placement ranks. Check current engraving queues and submit your inscription.
                      </p>
                    </div>
                    <div className="text-xs font-bold text-red-500 flex items-center gap-1 font-display pt-2 uppercase tracking-wide">
                      Open Self-Service Form &rarr;
                    </div>
                  </button>

                  {/* 2. Admin Card */}
                  <button
                    onClick={() => handleSelectRole('operator')}
                    className="glass-panel hover:border-red-500/40 p-6 md:p-8 text-left space-y-4 hover:shadow-2xl hover:shadow-red-950/10 transition duration-300 transform hover:-translate-y-1 text-[var(--text-primary)]"
                  >
                    <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 shadow-sm">
                      <Laptop className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold font-display tracking-tight text-[var(--text-primary)]">
                        I am the Engraver
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">
                        Access the operator dashboard. Double-check inputs with zero errors using optimized click-to-copy fields, monitor queue analytics, and process completions.
                      </p>
                    </div>
                    <div className="text-xs font-bold text-red-500 flex items-center gap-1 font-display pt-2 uppercase tracking-wide">
                      Open Operator Dashboard &rarr;
                    </div>
                  </button>

                </div>
              ) : (
                /* Passcode prompt overlay */
                <div className="max-w-md mx-auto glass-panel p-6 space-y-4 text-left animate-fadeIn">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-2">
                      <ShieldAlert className="w-6 h-6 animate-pulse" />
                    </div>
                    <h2 className="text-md font-bold font-display text-[var(--text-primary)]">Security Check Required</h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Please enter the operator terminal authorization code to double check queue management.</p>
                  </div>

                  <form onSubmit={handleVerifyPasscode} className="space-y-3">
                    <label htmlFor="operatorPasscode" className="sr-only">Operator passcode</label>
                    <input
                      id="operatorPasscode"
                      type="password"
                      placeholder="ENTER OPERATOR PASSCODE"
                      maxLength={10}
                      required
                      aria-required="true"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      className="w-full glass-inset px-4 py-3.5 text-center font-bold text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/60 transition"
                      autoFocus
                    />

                    {showPasscodeError && (
                      <p className="text-xs text-red-500 font-semibold text-center animate-pulse" role="alert">
                        Incorrect Passcode! Please try again.
                      </p>
                    )}

                    <div className="flex gap-2 pt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPasscodeField(false);
                          setPasscode('');
                        }}
                        className="flex-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] glass-inset hover:bg-[var(--surface-hover)] font-bold py-3 px-4 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-1 text-xs text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 font-bold py-3 px-4 rounded-[var(--radius-control)] shadow-lg shadow-red-900/30 transition"
                      >
                        Authenticate
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Quick Helper info */}
              <p className="text-[11px] text-[var(--text-secondary)] max-w-sm mx-auto pl-1">
                💡 <strong>Kiosk Tip:</strong> Open Runner Mode on venue high-mount tablets, and Operator Mode on your mobile phone or secondary laptop to synchronize real-time updates.
              </p>

            </div>
          </div>
        )}

        {/* Role Views Router */}
        {currentRole === 'customer' && (
          <CustomerForm onBackToRoleSelection={() => setCurrentRole('selector')} />
        )}

        {currentRole === 'operator' && (
          <OperatorDashboard
            onBackToRoleSelection={() => setCurrentRole('selector')}
            currentPasscode={operatorPasscode}
            onUpdatePasscode={handleUpdatePasscode}
          />
        )}
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
