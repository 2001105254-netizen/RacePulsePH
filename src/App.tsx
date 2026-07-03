import React, { useState } from 'react';
import CustomerForm from './components/CustomerForm';
import OperatorDashboard from './components/OperatorDashboard';
import { Laptop, Zap, Users, ShieldAlert, Sparkles, PersonStanding, Activity } from 'lucide-react';

type UserRole = 'selector' | 'customer' | 'operator';

export default function App() {
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
    <div id="app_root" className="min-h-screen bg-[#0e0f11] text-zinc-100 flex flex-col justify-between">
      
      {/* Elegant Obsidian Red Glow Top Bar */}
      <div className="h-1 w-full bg-gradient-to-r from-red-700 via-red-500 to-red-800"></div>

      {currentRole === 'selector' && (
        <div id="role_selection_container" className="flex-grow flex items-center justify-center py-10 px-4 animate-fadeIn">
          <div className="w-full max-w-3xl space-y-10 text-center">
            
            {/* Logo area */}
            <div className="flex flex-col items-center space-y-4">
              <div className="w-20 h-20 bg-gradient-to-tr from-red-700 to-red-500 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-red-950/20 rotate-3 hover:rotate-0 duration-300 transform border-b-4 border-red-900 relative overflow-hidden">
                <Activity className="w-14 h-14 stroke-[1.5] text-red-950/40 absolute animate-pulse" />
                <PersonStanding className="w-10 h-10 stroke-[2] -rotate-12 skew-x-6 relative text-white translate-x-1" />
              </div>
              <div>
                <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display uppercase bg-red-500/10 py-1.5 px-4 rounded-full border border-red-500/20">
                  Loud & Clear Presents
                </span>
                <h1 className="text-4xl font-black tracking-tight font-display text-white mt-3 uppercase">
                  RacePulse<span className="text-red-500 font-light font-bold">PH</span>
                </h1>
                <p className="text-sm text-zinc-400 mt-2 max-w-md mx-auto leading-relaxed">
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
                  className="bg-[#121316] rounded-2xl border border-zinc-800 hover:border-red-500/50 p-6 md:p-8 text-left space-y-4 hover:shadow-2xl hover:shadow-red-950/5 transition duration-300 transform hover:-translate-y-1 text-zinc-200"
                >
                  <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center text-red-500 shadow-sm">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold font-display tracking-tight text-white flex items-center gap-1.5">
                      I am a Runner
                      <Sparkles className="w-4 h-4 text-red-400 animate-pulse" />
                    </h2>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
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
                  className="bg-[#121316] rounded-2xl border border-zinc-800 hover:border-red-500/50 p-6 md:p-8 text-left space-y-4 hover:shadow-2xl hover:shadow-red-950/5 transition duration-300 transform hover:-translate-y-1 text-zinc-200"
                >
                  <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center text-red-500 shadow-sm">
                    <Laptop className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold font-display tracking-tight text-white">
                      I am the Engraver
                    </h2>
                    <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
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
              <div className="max-w-md mx-auto bg-[#121316] rounded-2xl border border-zinc-800 p-6 shadow-2xl space-y-4 text-left">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-2">
                    <ShieldAlert className="w-6 h-6 animate-pulse" />
                  </div>
                  <h2 className="text-md font-bold font-display text-white">Security Check Required</h2>
                  <p className="text-xs text-zinc-400 mt-1">Please enter the operator terminal authorization code to double check queue management.</p>
                </div>

                <form onSubmit={handleVerifyPasscode} className="space-y-3">
                  <input
                    type="password"
                    placeholder="ENTER OPERATOR PASSCODE"
                    maxLength={10}
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    className="w-full bg-[#070809] border border-zinc-900 rounded-xl px-4 py-3 text-center font-bold text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                    autoFocus
                  />
                  
                  {showPasscodeError && (
                    <p className="text-xs text-red-500 font-semibold text-center animate-pulse">
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
                      className="flex-1 text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:bg-zinc-900 font-bold py-3 px-4 rounded-xl transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 text-xs text-white bg-red-600 hover:bg-red-500 font-bold py-3 px-4 rounded-xl shadow-lg transition"
                    >
                      Authenticate
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Quick Helper info */}
            <p className="text-[11px] text-zinc-500 max-w-sm mx-auto pl-1">
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

      {/* Footer Branding credits */}
      <footer className="py-4 border-t border-zinc-900 bg-[#070707] text-center text-[10px] text-zinc-650 font-mono tracking-wide">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between px-6 gap-2">
          <span>&copy; 2026 RACEPULSEPH BY LOUD & CLEAR. ALL RIGHTS RESERVED.</span>
          <span>STATION CO-PROCESSING SYNC // FAULT COOPERATION PROTOCOL</span>
        </div>
      </footer>

    </div>
  );
}
