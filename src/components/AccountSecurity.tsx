import React, { useEffect, useId, useRef, useState } from 'react';
import { reload, type User } from 'firebase/auth';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronDown, Eye, EyeOff, Inbox, LogOut, Mail, Menu, Monitor, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { signOutUser } from '../firebase';
import { AccountRequestError, completePasswordReset, confirmPasswordCode, confirmVerificationCode, getSignupDraft, requestPasswordCode, requestVerificationCode } from '../lib/accountSecurity';

const inputClass = 'w-full glass-inset px-4 py-3.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50';
const buttonClass = 'w-full py-3.5 px-5 rounded-[var(--radius-control)] bg-red-600 hover:bg-red-500 text-white font-display font-bold text-xs uppercase tracking-widest transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';

function useCountdown() {
  const [until, setUntil] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return { seconds, start: (value: number) => { setUntil(Date.now() + value * 1000); setSeconds(value); } };
}

function SecurityFrame({ title, detail, children }: { title: string; detail: React.ReactNode; children: React.ReactNode }) {
  return <section className="w-full max-w-md mx-auto space-y-7 animate-fadeIn" aria-label={title}>
    <div className="flex justify-center"><div className="w-36 bg-[#0a0a0a] rounded-[22px] p-3 ring-1 ring-white/10"><img src="/assets/racepulse-logo.png" alt="RacePulsePH" className="w-full h-auto" /></div></div>
    <div className="glass-panel p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-[0.2em]"><ShieldCheck size={15} /> Your account, protected</div>
      <div className="space-y-3"><h1 className="font-display font-bold text-2xl tracking-tight text-[var(--text-primary)]">{title}</h1><div className="text-sm leading-relaxed text-[var(--text-secondary)] break-words">{detail}</div></div>
      {children}
    </div>
    <p className="text-center text-[11px] text-[var(--text-muted)]">Happy running ka Racepulse!</p>
  </section>;
}

function CodeInput({ code, setCode, disabled }: { code: string; setCode: (code: string) => void; disabled: boolean }) {
  return <div className="space-y-2">
    <label htmlFor="account-code" className="block text-xs font-bold text-[var(--text-secondary)]">Six-digit code</label>
    <input id="account-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9]{6}" maxLength={6} value={code}
      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={disabled}
      placeholder="000000" className={`${inputClass} text-center !text-3xl font-mono font-bold tracking-[0.3em] tabular-nums placeholder:text-[var(--text-muted)]/40`} aria-describedby="account-code-help account-email-guidance" />
    <p id="account-code-help" className="text-xs leading-relaxed text-[var(--text-muted)]">Use the latest code. It expires in 10 minutes.</p>
  </div>;
}

function SpamGuidance() {
  const [showTutorial, setShowTutorial] = useState(false);
  const tutorialId = useId();
  return <aside id="account-email-guidance" className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3" aria-label="Where to find your code">
    <Inbox size={18} className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
    <div className="min-w-0 flex-1 space-y-1 text-xs leading-relaxed">
      <p className="font-bold text-[var(--text-primary)]">Nothing in your inbox? Check Spam or Junk.</p>
      <p className="text-[var(--text-secondary)]">Look for an email from <span className="font-semibold break-all text-[var(--text-primary)]">events@racepulseph.com</span>. If you find it in Spam, choose “Not spam” to move it to your inbox.</p>
      <button type="button" onClick={() => setShowTutorial(!showTutorial)} aria-expanded={showTutorial} aria-controls={tutorialId}
        className="!mt-3 min-h-11 w-full flex items-center gap-2 rounded-lg border border-red-500/25 px-3 py-2 text-left font-bold text-[var(--text-primary)] hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
        <BookOpen size={15} className="shrink-0 text-red-500" aria-hidden="true" />
        <span className="flex-1">{showTutorial ? 'Hide Gmail Spam tutorial' : 'Where is Spam in Gmail?'}</span>
        <ChevronDown size={15} className={`shrink-0 ${showTutorial ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div id={tutorialId} hidden={!showTutorial} className="!mt-4 space-y-4 border-t border-red-500/20 pt-4 text-[var(--text-secondary)]">
        <p>First, make sure Gmail is open to the email address you used for RacePulse.</p>
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-bold text-[var(--text-primary)]"><Smartphone size={15} aria-hidden="true" /> On your phone · Gmail app</h2>
          <ol className="list-decimal pl-5 space-y-1.5 marker:text-red-500 marker:font-bold">
            <li>Open Gmail and tap <strong className="text-[var(--text-primary)]">Menu</strong> <Menu size={13} className="inline align-text-bottom" aria-label="three horizontal lines" /> at the top left.</li>
            <li>Scroll down the menu and tap <strong className="text-[var(--text-primary)]">Spam</strong>.</li>
            <li>Open the RacePulsePH email from <span className="break-all">events@racepulseph.com</span> to find your code.</li>
          </ol>
        </div>
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-bold text-[var(--text-primary)]"><Monitor size={15} aria-hidden="true" /> On your computer · Gmail website</h2>
          <ol className="list-decimal pl-5 space-y-1.5 marker:text-red-500 marker:font-bold">
            <li>Open Gmail. If the left menu is collapsed, click <strong className="text-[var(--text-primary)]">Menu</strong> at the top left.</li>
            <li>In the left menu, click <strong className="text-[var(--text-primary)]">More</strong>, then <strong className="text-[var(--text-primary)]">Spam</strong>.</li>
            <li>Open the RacePulsePH email to find your code, then click <strong className="text-[var(--text-primary)]">Report not spam</strong>.</li>
          </ol>
        </div>
        <p>On the Gmail app, open the email’s three-dot menu and choose <strong className="text-[var(--text-primary)]">Report not spam</strong>. Return to RacePulse and enter the latest six-digit code.</p>
        <a href="https://support.google.com/mail/answer/1366858?hl=en" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-red-500 underline underline-offset-4 hover:text-red-400">Gmail’s official Spam guide <span className="sr-only">(opens in a new tab)</span></a>
      </div>
    </div>
  </aside>;
}

function Resend({ seconds, busy, onClick }: { seconds: number; busy: boolean; onClick: () => void }) {
  return <button type="button" disabled={busy || seconds > 0} onClick={onClick} className="w-full text-xs font-bold text-red-500 hover:text-red-400 disabled:text-[var(--text-muted)] py-2">{seconds > 0 ? `Send a new code in ${seconds}s` : 'Send a new code'}</button>;
}

function savedVerification(uid: string): { challengeId: string; expiresAt: number; resendAt: number } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`racepulse_verification:${uid}`) || 'null');
    return saved && typeof saved.challengeId === 'string' && saved.expiresAt > Date.now() ? saved : null;
  } catch { return null; }
}

export function EmailVerificationScreen({ user, onVerified }: { user: User; onVerified: () => void }) {
  const [saved] = useState(() => savedVerification(user.uid));
  const [challengeId, setChallengeId] = useState(saved?.challengeId || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<'send' | 'confirm'>('send');
  const started = useRef(false);
  const cooldown = useCountdown();

  async function finishVerification() {
    await reload(user);
    await user.getIdToken(true);
    if (!user.emailVerified) throw new Error('Verification is still updating. Please try again.');
    try { sessionStorage.removeItem(`racepulse_verification:${user.uid}`); } catch { /* Storage may be blocked. */ }
    onVerified();
  }

  async function sendCode() {
    setOperation('send');
    setBusy(true); setError(''); setNotice('');
    try {
      const delivery = await requestVerificationCode(getSignupDraft(user.email || '')?.displayName);
      if (delivery.alreadyVerified) return await finishVerification();
      setChallengeId(delivery.challengeId || ''); setCode('');
      cooldown.start(delivery.retryAfter);
      try {
        sessionStorage.setItem(`racepulse_verification:${user.uid}`, JSON.stringify({ challengeId: delivery.challengeId, expiresAt: Date.now() + delivery.expiresIn * 1000, resendAt: Date.now() + delivery.retryAfter * 1000 }));
      } catch { /* A resend remains available when storage is blocked. */ }
      setNotice('Your verification code is on its way.');
    } catch (error) {
      if (error instanceof AccountRequestError && error.retryAfter) cooldown.start(error.retryAfter);
      if (error instanceof AccountRequestError && error.status === 503) {
        setChallengeId(''); setCode('');
        try { sessionStorage.removeItem(`racepulse_verification:${user.uid}`); } catch { /* Storage may be blocked. */ }
      }
      setError(error instanceof Error ? error.message : 'Could not send your code.');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (saved) {
      cooldown.start(Math.max(0, Math.ceil((saved.resendAt - Date.now()) / 1000)));
      return;
    }
    void sendCode();
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeId) return void sendCode();
    setOperation('confirm');
    setBusy(true); setError(''); setNotice('');
    try {
      await confirmVerificationCode(challengeId, code);
      await finishVerification();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not verify your code.'); }
    finally { setBusy(false); }
  }

  return <div className="hero-glow flex-grow flex items-center justify-center px-4 py-12">
    <SecurityFrame title={challengeId ? 'Check your inbox' : 'Verify your email'} detail={challengeId
      ? <>Enter the code sent to <strong className="text-[var(--text-primary)]">{user.email}</strong> to finish creating your account.</>
      : <>Confirm that you own <strong className="text-[var(--text-primary)]">{user.email}</strong> to finish creating your account.</>}>
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide font-bold text-[var(--text-muted)]"><span className="flex items-center gap-1"><CheckCircle2 size={13} /> Account details</span><span className="h-px flex-1 bg-[var(--border-default)]" /><span className="text-red-500">02 Verify email</span></div>
      <SpamGuidance />
      <form onSubmit={confirm} className="space-y-4" aria-busy={busy}>
        {challengeId && <CodeInput code={code} setCode={setCode} disabled={busy} />}
        {error && <p role="alert" className="text-xs text-red-500 leading-relaxed">{error}</p>}
        {notice && <p role="status" className="text-xs text-[var(--text-secondary)]">{notice}</p>}
        <button className={buttonClass} disabled={busy || (challengeId ? code.length !== 6 : cooldown.seconds > 0)}>{busy ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{busy ? (operation === 'confirm' ? 'Verifying…' : 'Sending code…') : challengeId ? 'Verify & continue' : cooldown.seconds > 0 ? `Try again in ${cooldown.seconds}s` : 'Send verification code'}</button>
        {challengeId && <Resend seconds={cooldown.seconds} busy={busy} onClick={() => void sendCode()} />}
      </form>
      <button type="button" onClick={() => void signOutUser()} disabled={busy} className="w-full flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)] hover:text-red-500"><LogOut size={14} /> Use a different account</button>
    </SecurityFrame>
  </div>;
}

export function PasswordResetFlow({ initialEmail = '', onBack, onDone, backLabel = 'Back to sign in' }: { initialEmail?: string; onBack: () => void; onDone?: () => void; backLabel?: string }) {
  const [stage, setStage] = useState<'email' | 'code' | 'password' | 'done'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cooldown = useCountdown();

  async function sendCode() {
    setBusy(true); setError('');
    try {
      const delivery = await requestPasswordCode(email.trim());
      setChallengeId(delivery.challengeId || ''); setCode('');
      cooldown.start(delivery.retryAfter); setStage('code');
    } catch (error) {
      if (error instanceof AccountRequestError && error.retryAfter) cooldown.start(error.retryAfter);
      setError(error instanceof Error ? error.message : 'Could not send your code.');
    } finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (stage === 'email') return void sendCode();
    setBusy(true); setError('');
    try {
      if (stage === 'code') {
        const result = await confirmPasswordCode(email.trim(), challengeId, code);
        setResetToken(result.resetToken); setCode(''); setStage('password');
      } else if (stage === 'password') {
        if (password !== confirmation) throw new Error('Your passwords do not match.');
        await completePasswordReset(resetToken, password);
        setPassword(''); setConfirmation(''); setResetToken(''); setStage('done');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not reset your password.'); }
    finally { setBusy(false); }
  }

  const titles = { email: 'Forgot your password?', code: 'Check your inbox', password: 'Set a new password', done: "You're back on track" };
  const details = {
    email: 'Enter the email address you use for RacePulse. We’ll send a code to help you get back into your account.',
    code: <>If <strong className="text-[var(--text-primary)]">{email}</strong> has an active RacePulse account, a reset code is on its way.</>,
    password: 'Email confirmed. Choose a new password for your next starting line.',
    done: 'Your password has been updated. Sign in with your new password to continue.',
  };

  return <SecurityFrame title={titles[stage]} detail={details[stage]}>
    {(stage === 'email' || stage === 'code') && <SpamGuidance />}
    {stage === 'done' ? <><CheckCircle2 className="text-red-500" size={36} /><button type="button" onClick={onDone || onBack} className={buttonClass}>Return to sign in</button></> : <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      {stage === 'email' && <div className="space-y-2"><label htmlFor="reset-email" className="block text-xs font-bold text-[var(--text-secondary)]">Email address</label><input id="reset-email" type="email" autoComplete="email" autoFocus required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="you@email.com" disabled={busy} /></div>}
      {stage === 'code' && <CodeInput code={code} setCode={setCode} disabled={busy} />}
      {stage === 'password' && <>
        <div className="space-y-2"><label htmlFor="new-password" className="block text-xs font-bold text-[var(--text-secondary)]">New password</label><div className="relative"><input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" autoFocus required minLength={6} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-12`} disabled={busy} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><p className="text-[11px] text-[var(--text-muted)]">Use at least 6 characters. A longer, unique password is best.</p></div>
        <div className="space-y-2"><label htmlFor="confirm-password" className="block text-xs font-bold text-[var(--text-secondary)]">Confirm new password</label><input id="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={6} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} disabled={busy} /></div>
      </>}
      {error && <p role="alert" className="text-xs text-red-500 leading-relaxed">{error}</p>}
      <button className={buttonClass} disabled={busy || (stage === 'code' && code.length !== 6) || (stage === 'email' && cooldown.seconds > 0)}>{busy ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />}{stage === 'email' ? (cooldown.seconds ? `Try again in ${cooldown.seconds}s` : 'Send reset code') : stage === 'code' ? 'Verify code' : 'Save new password'}</button>
      {stage === 'code' && <><Resend seconds={cooldown.seconds} busy={busy} onClick={() => void sendCode()} /><button type="button" disabled={busy} onClick={() => { setStage('email'); setError(''); setChallengeId(''); }} className="w-full text-xs text-[var(--text-secondary)]">Change email address</button></>}
      {stage === 'password' && <button type="button" disabled={busy} onClick={() => { setStage('email'); setResetToken(''); setPassword(''); setConfirmation(''); setError(''); }} className="w-full text-xs text-[var(--text-secondary)]">Start again with a new code</button>}
    </form>}
    {stage !== 'done' && <button type="button" disabled={busy} onClick={onBack} className="w-full flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)] hover:text-red-500"><ArrowLeft size={14} /> {backLabel}</button>}
  </SecurityFrame>;
}
