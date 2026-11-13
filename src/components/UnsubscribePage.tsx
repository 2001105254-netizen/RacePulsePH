import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { submitUnsubscribe } from '../lib/accountSecurity';
import { LEGAL_CONFIG } from '../lib/legalConfig';

interface UnsubscribePageProps {
  onBack: () => void;
}

/**
 * One-click email opt-out route accessible without signing in (/unsubscribe).
 */
export default function UnsubscribePage({ onBack }: UnsubscribePageProps) {
  const [params] = useState(() => {
    if (typeof window === 'undefined') return { token: '', email: '' };
    const search = new URLSearchParams(window.location.search);
    return {
      token: search.get('token')?.trim() || '',
      email: search.get('email')?.trim() || '',
    };
  });
  const [emailInput, setEmailInput] = useState(params.email);
  const [busy, setBusy] = useState(Boolean(params.token));
  const [status, setStatus] = useState<'idle' | 'done' | 'resubscribed' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!params.token) return;
    let active = true;
    setBusy(true);
    void submitUnsubscribe({ token: params.token, marketingOptIn: false })
      .then((res) => {
        if (!active) return;
        setStatus('done');
        if (res.email) setEmailInput(res.email);
        setMessage('You have been unsubscribed from RacePulsePH optional race announcements and updates.');
      })
      .catch((error: any) => {
        if (!active) return;
        setStatus('error');
        setMessage(error?.message || 'Unable to process this unsubscribe link automatically.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [params.token]);

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = emailInput.trim();
    if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      setStatus('error');
      setMessage('Enter the email address you want to unsubscribe.');
      return;
    }
    setBusy(true);
    setStatus('idle');
    setMessage('');
    try {
      await submitUnsubscribe({ email: cleaned, marketingOptIn: false });
      setStatus('done');
      setMessage(`${cleaned} is now opted out of optional RacePulsePH announcements and updates.`);
    } catch (error: any) {
      setStatus('error');
      setMessage(error?.message || 'Could not update email preferences right now.');
    } finally {
      setBusy(false);
    }
  };

  const handleResubscribe = async () => {
    setBusy(true);
    setMessage('');
    try {
      await submitUnsubscribe({
        ...(params.token ? { token: params.token } : {}),
        ...(emailInput.trim() ? { email: emailInput.trim() } : {}),
        marketingOptIn: true,
      });
      setStatus('resubscribed');
      setMessage('Email preference updated: optional event updates are enabled again.');
    } catch (error: any) {
      setStatus('error');
      setMessage(error?.message || 'Could not re-enable email updates.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="unsubscribe-heading"
      className="max-w-lg w-full min-w-0 mx-auto my-8 glass-panel p-4 sm:p-8 space-y-6"
    >
      <div className="space-y-2">
        <h1 id="unsubscribe-heading" className="font-display text-2xl font-semibold text-[var(--text-primary)]">
          Unsubscribe from optional emails
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Manage optional event announcements from {LEGAL_CONFIG.companyName} without signing in. Strictly necessary emails such as verification codes and paid registration receipts remain unaffected.
        </p>
      </div>

      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <RefreshCw className="w-4 h-4 motion-safe:animate-spin text-red-700 dark:text-red-400" aria-hidden="true" />
          <span>Updating communication preference...</span>
        </p>
      )}

      {status === 'done' && (
        <div
          role="status"
          className="rounded-xl border border-emerald-700 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-200 p-4 space-y-3"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-1" aria-hidden="true" />
            <p className="text-sm font-semibold">{message}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleResubscribe}
            className="min-h-11 px-4 rounded-xl border border-emerald-700 dark:border-emerald-400 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          >
            Undo and re-subscribe
          </button>
        </div>
      )}

      {status === 'resubscribed' && (
        <div
          role="status"
          className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 text-sm text-[var(--text-primary)]"
        >
          {message}
        </div>
      )}

      {status === 'error' && (
        <div
          role="alert"
          className="rounded-xl border border-red-700 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950/40 dark:text-red-200 p-4 text-sm font-semibold"
        >
          {message}
        </div>
      )}

      {status !== 'done' && (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label htmlFor="unsubscribe-email" className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">
              Email address
            </label>
            <input
              id="unsubscribe-email"
              type="email"
              required
              autoComplete="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="runner@example.com"
              className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-11 rounded-xl bg-red-700 hover:bg-red-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            Unsubscribe this email address
          </button>
        </form>
      )}

      <div className="border-t border-[var(--border-subtle)] pt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Return to RacePulsePH</span>
        </button>

        <a
          href={`mailto:${LEGAL_CONFIG.supportEmail}`}
          className="min-h-11 inline-flex items-center text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-4 break-all"
        >
          {LEGAL_CONFIG.supportEmail}
        </a>
      </div>
    </section>
  );
}

