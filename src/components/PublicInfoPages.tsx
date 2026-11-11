import React from 'react';
import { m } from 'motion/react';
import { ArrowLeft, Compass, FileText, Mail, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';

export type PublicDocView = 'privacy' | 'terms';

interface PublicLegalPageProps {
  doc: PublicDocView;
  onBack: () => void;
  onSwitchDoc: (next: PublicDocView) => void;
  onOpenAuth: () => void;
}

export const PublicLegalPage: React.FC<PublicLegalPageProps> = ({
  doc,
  onBack,
  onSwitchDoc,
  onOpenAuth,
}) => {
  const isPrivacy = doc === 'privacy';

  return (
    <m.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-3xl space-y-6 py-2 sm:py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="min-h-11 rounded-full gap-2 px-4 text-xs font-semibold border-[var(--border-default)]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to races
        </Button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchDoc(isPrivacy ? 'terms' : 'privacy')}
            className="min-h-11 px-4 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
          >
            {isPrivacy ? 'Read Terms of Use' : 'Read Privacy Policy'}
          </button>
        </div>
      </div>

      <section className="glass-panel rounded-3xl border border-[var(--border-default)] overflow-hidden">
        <div className="hero-banner-glow p-6 sm:p-8 border-b border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
            {isPrivacy ? <ShieldCheck className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            <span>RacePulsePH Official Documentation</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {isPrivacy ? 'Privacy Policy' : 'Terms of Use'}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] dark:text-white max-w-2xl leading-relaxed">
            {isPrivacy
              ? 'How RacePulsePH handles runner registration details, checkpoint split timing, and account access.'
              : 'Rules for public race timing lookup, athlete registrations, and organizer operations on RacePulsePH.'}
          </p>
        </div>

        <div className="track-ticks-rule w-full" aria-hidden="true" />

        <div className="p-6 sm:p-8 space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          {isPrivacy ? (
            <>
              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  1. Information you provide
                </h2>
                <p>
                  When you register an account or enter a race event on RacePulsePH, we collect your name, username,
                  email address, chosen athlete or organizer role, and any race registration details requested by the
                  event organizer (such as distance category, bib assignment, and emergency contact information).
                </p>
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  2. Public timing and finisher records
                </h2>
                <p>
                  Published race events display official finisher leaderboards, checkpoint split times, bib numbers, and
                  runner categories on the public results page so athletes and spectators can verify standings and download
                  finisher certificates. Contact <a href="mailto:events@racepulseph.com" className="font-semibold text-red-700 dark:text-red-400 underline underline-offset-4">events@racepulseph.com</a> to request corrections or removal of published entry data.
                </p>
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  3. Authentication and browser storage
                </h2>
                <p>
                  Account sessions and password security run on Firebase Authentication and Cloud Firestore. On your device,
                  RacePulsePH stores only essential session tokens and your light or dark theme preference under{' '}
                  <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface-inset)] text-[var(--text-primary)]">
                    racepulse_theme
                  </code>
                  . We do not run advertising trackers or third-party behavioral profiles.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  1. Accounts and role responsibility
                </h2>
                <p>
                  Keep your account credentials confidential and ensure athlete registration details match the person
                  running under that bib number. Organizer accounts require approval before publishing races or managing
                  event rosters.
                </p>
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  2. Timing data and official results
                </h2>
                <p>
                  Live checkpoint splits update from timing station logs and may undergo official review before final
                  finisher certificates are marked official. Event organizers retain responsibility for local course rules,
                  wave schedules, and cut-off enforcement.
                </p>
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  3. Platform integrity and support
                </h2>
                <p>
                  Do not attempt to submit forged scan logs, impersonate another athlete, or scrape restricted endpoints.
                  Report timing discrepancies or account issues directly to{' '}
                  <a href="mailto:events@racepulseph.com" className="font-semibold text-red-700 dark:text-red-400 underline underline-offset-4">
                    events@racepulseph.com
                  </a>
                  . Happy running ka Racepulse!
                </p>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4">
            <a
              href="mailto:events@racepulseph.com"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400 transition-colors min-h-11"
            >
              <Mail className="w-4 h-4 text-red-700 dark:text-red-400" />
              events@racepulseph.com
            </a>

            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={onOpenAuth} className="min-h-11 rounded-full text-xs">
                Sign in or create account
              </Button>
            </div>
          </div>
        </div>
      </section>
    </m.article>
  );
};

interface PublicNotFoundViewProps {
  pathname: string;
  onGoHome: () => void;
  onGoLogin: () => void;
}

export const PublicNotFoundView: React.FC<PublicNotFoundViewProps> = ({
  pathname,
  onGoHome,
  onGoLogin,
}) => {
  return (
    <m.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-2xl py-8 sm:py-16"
    >
      <div className="glass-panel rounded-3xl border border-[var(--border-default)] overflow-hidden">
        <div className="auth-stage-panel px-6 py-7 sm:px-8 sm:py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-red-600/20 border border-red-400/30 flex items-center justify-center">
              <Compass className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-zinc-400">Route check</p>
              <p className="font-display text-lg font-semibold text-white">Off the marked course</p>
            </div>
          </div>
          <span className="font-mono text-4xl sm:text-5xl font-bold tracking-tight text-red-400 tabular-nums">
            404
          </span>
        </div>

        <div className="track-ticks-rule w-full" aria-hidden="true" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              This page does not exist on RacePulsePH.
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The route{' '}
              <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface-inset)] text-[var(--text-primary)] break-all">
                {pathname}
              </code>{' '}
              does not match a race directory, timing board, or account screen. Head back to the start line to look up
              races and finisher bibs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onGoHome} className="min-h-11 rounded-full gap-2 px-5">
              Back to race directory
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onGoLogin}
              className="min-h-11 rounded-full px-5 border-[var(--border-default)]"
            >
              Sign in
            </Button>
            <a
              href="mailto:events@racepulseph.com"
              className="min-h-11 inline-flex items-center gap-2 px-3 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />
              events@racepulseph.com
            </a>
          </div>
        </div>
      </div>
    </m.section>
  );
};
