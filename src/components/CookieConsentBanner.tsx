import { useEffect, useId, useRef, useState } from 'react';
import { Cookie, ShieldCheck, X } from 'lucide-react';
import DialogSurface from './ui/DialogSurface';
import {
  readConsentState,
  saveConsentPreferences,
  subscribeConsent,
  type CookieConsentState,
} from '../lib/consent';

interface CookieConsentBannerProps {
  /** Controlled trigger incremented when Footer or Cookie Policy opens preferences. */
  preferencesRequestNonce?: number;
  onOpenCookiePolicy: () => void;
}

/**
 * Persistent, non-blocking cookie and storage consent banner with granular
 * opt-in toggles gating Analytics and Marketing categories until explicit consent.
 */
export default function CookieConsentBanner({
  preferencesRequestNonce = 0,
  onOpenCookiePolicy,
}: CookieConsentBannerProps) {
  const [consent, setConsent] = useState<CookieConsentState | null>(() => readConsentState());
  const [showPreferences, setShowPreferences] = useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = useState<boolean>(() => consent?.analytics ?? false);
  const [marketingOptIn, setMarketingOptIn] = useState<boolean>(() => consent?.marketing ?? false);
  const dialogId = useId();
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => {
      const current = readConsentState();
      setConsent(current);
      if (current) {
        setAnalyticsOptIn(current.analytics);
        setMarketingOptIn(current.marketing);
      }
    };
    return subscribeConsent(sync);
  }, []);

  useEffect(() => {
    if (preferencesRequestNonce > 0) {
      const current = readConsentState();
      setAnalyticsOptIn(current?.analytics ?? false);
      setMarketingOptIn(current?.marketing ?? false);
      setShowPreferences(true);
    }
  }, [preferencesRequestNonce]);

  const handleAcceptAll = () => {
    const saved = saveConsentPreferences({ analytics: true, marketing: true });
    setConsent(saved);
    setAnalyticsOptIn(true);
    setMarketingOptIn(true);
    setShowPreferences(false);
  };

  const handleRejectNonEssential = () => {
    const saved = saveConsentPreferences({ analytics: false, marketing: false });
    setConsent(saved);
    setAnalyticsOptIn(false);
    setMarketingOptIn(false);
    setShowPreferences(false);
  };

  const handleSavePreferences = () => {
    const saved = saveConsentPreferences({ analytics: analyticsOptIn, marketing: marketingOptIn });
    setConsent(saved);
    setShowPreferences(false);
  };

  return (
    <>
      {!consent && !showPreferences && (
        <section
          role="region"
          aria-label="Cookie and storage preferences"
          className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-4xl rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-6 shadow-xl"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <Cookie className="w-4 h-4 shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Cookie and local storage preferences
                </h2>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                RacePulsePH uses strictly necessary browser storage for sign-in sessions, theme settings, and race-day offline timing queues. Optional analytics and marketing scripts remain blocked unless you opt in.{' '}
                <a
                  href="/cookie-policy"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenCookiePolicy();
                  }}
                  className="font-semibold text-red-700 dark:text-red-400 underline underline-offset-4 hover:opacity-80"
                >
                  Read Cookie Policy
                </a>
                .
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPreferences(true)}
                className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
              >
                Manage Preferences
              </button>
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold transition-colors"
              >
                Accept All
              </button>
            </div>
          </div>
        </section>
      )}

      {showPreferences && (
        <DialogSurface
          titleId={`${dialogId}-title`}
          descriptionId={`${dialogId}-desc`}
          onRequestClose={() => setShowPreferences(false)}
          initialFocusRef={initialFocusRef}
          className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-[var(--text-primary)] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Privacy Controls</span>
              </div>
              <h2 id={`${dialogId}-title`} className="font-display text-lg font-semibold text-[var(--text-primary)]">
                Manage Cookie Preferences
              </h2>
            </div>
            <button
              ref={initialFocusRef}
              type="button"
              onClick={() => setShowPreferences(false)}
              aria-label="Close cookie preferences"
              className="min-h-11 min-w-11 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p id={`${dialogId}-desc`} className="mt-4 text-xs text-[var(--text-secondary)] leading-relaxed">
            Choose which storage categories RacePulsePH may activate in this browser. Non-essential categories default to off until you opt in.
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Strictly Necessary</p>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Required for authentication sessions, consent records, light/dark display mode, and offline checkpoint sync queues.
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-700 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-300 px-3 py-1 text-xs font-semibold">
                Always Active
              </span>
            </div>

            <label
              htmlFor={`${dialogId}-analytics`}
              className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex items-start justify-between gap-4 cursor-pointer"
            >
              <span className="space-y-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">Analytics</span>
                <span className="block text-xs text-[var(--text-secondary)] leading-relaxed">
                  Optional aggregate traffic and crash diagnostics. Currently no third-party analytics trackers are active.
                </span>
              </span>
              <input
                id={`${dialogId}-analytics`}
                type="checkbox"
                checked={analyticsOptIn}
                onChange={(event) => setAnalyticsOptIn(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-red-700 rounded cursor-pointer"
              />
            </label>

            <label
              htmlFor={`${dialogId}-marketing`}
              className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex items-start justify-between gap-4 cursor-pointer"
            >
              <span className="space-y-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">Marketing Trackers</span>
                <span className="block text-xs text-[var(--text-secondary)] leading-relaxed">
                  Optional campaign attribution or social pixels. Currently no marketing scripts or third-party ad pixels run on this site.
                </span>
              </span>
              <input
                id={`${dialogId}-marketing`}
                type="checkbox"
                checked={marketingOptIn}
                onChange={(event) => setMarketingOptIn(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-red-700 rounded cursor-pointer"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
            <a
              href="/cookie-policy"
              onClick={(event) => {
                event.preventDefault();
                setShowPreferences(false);
                onOpenCookiePolicy();
              }}
              className="min-h-11 inline-flex items-center text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-4"
            >
              View full Cookie Policy
            </a>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleRejectNonEssential}
                className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
              >
                Reject Non-Essential
              </button>
              <button
                type="button"
                onClick={handleSavePreferences}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </DialogSurface>
      )}
    </>
  );
}

