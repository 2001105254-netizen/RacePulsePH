import React from 'react';
import { ArrowLeft, Building2, Cookie, CreditCard, FileText, Mail, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  BROWSER_STORAGE_MANIFEST,
  LEGAL_CONFIG,
  LEGAL_DOCUMENTS,
  THIRD_PARTY_SDK_MANIFEST,
  type LegalDocKey,
} from '../lib/legalConfig';

interface PublicLegalPageProps {
  doc: LegalDocKey;
  onBack: () => void;
  onSwitchDoc: (next: LegalDocKey) => void;
  onOpenAuth: () => void;
  onOpenCookiePreferences: () => void;
  onOpenUnsubscribe: () => void;
}

const sectionCardClass = 'rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 sm:p-6 space-y-3';
const headingClass = 'font-display text-base sm:text-lg font-semibold text-[var(--text-primary)]';
const bodyClass = 'text-sm text-[var(--text-secondary)] leading-relaxed';
const accentLinkClass = 'font-semibold text-red-700 dark:text-red-400 underline underline-offset-4 hover:opacity-85';

export function PublicLegalPage({
  doc,
  onBack,
  onSwitchDoc,
  onOpenAuth,
  onOpenCookiePreferences,
  onOpenUnsubscribe,
}: PublicLegalPageProps) {
  const activeMeta = LEGAL_DOCUMENTS.find((entry) => entry.key === doc) || LEGAL_DOCUMENTS[0];

  const renderBody = () => {
    if (doc === 'privacy') {
      return (
        <div className="space-y-6">
          <p className={bodyClass}>
            {LEGAL_CONFIG.companyName} operates RacePulsePH as a race registration, live RFID checkpoint timing, medal engraving queue, and finisher certificate platform. This Privacy Policy explains what personal data we collect, why we collect it, which third-party processors receive it, and how you can access, opt out of, or delete your data.
          </p>

          <section className={sectionCardClass} aria-labelledby="priv-data">
            <h2 id="priv-data" className={headingClass}>1. Personal data we collect and why</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Account credentials and profile:</strong> Email address, display name, lowercase sign-in username, role, account approval status, and optional profile photo saved in Firebase Authentication and Cloud Firestore so you can sign in and access your runner or race staff dashboard.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Race registration and safety fields:</strong> Participant full name, distance, gender, age (used solely for age-group division ranking and minor-consent screening), shirt size (only when apparel sizing applies), optional emergency contact details, and optional medical notes disclosed directly for race-day medic readiness.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Timing and public finisher results:</strong> Bib number, checkpoint scan timestamps, official elapsed split times, division placements, and finisher certificates. Under RacePulsePH rules, raw intermediate checkpoint scans stay restricted to event staff and the registered runner, while finished race standings are published for official results lookup.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Optional friend connections and engraving queue:</strong> Username search entries, mutually accepted race friendships, and medal engraving requests (name, bib, distance, finish time, optional inscription).
              </li>
            </ul>
          </section>

          <section className={sectionCardClass} aria-labelledby="priv-retention">
            <h2 id="priv-retention" className={headingClass}>2. Data retention and minimization</h2>
            <p className={bodyClass}>
              Forms collect only fields required to register entries, assign bib divisions, dispatch timing results, and safeguard on-course athletes. Verification codes expire in 10 minutes. Session storage drafts clear when your tab closes. Payment transaction audit trails are retained as anonymized financial references when an account is deleted so event accounting and official public finisher standings remain accurate without retaining personal contact details.
            </p>
          </section>

          <section className={sectionCardClass} aria-labelledby="priv-kids">
            <h2 id="priv-kids" className={headingClass}>3. Children&apos;s privacy (COPPA and GDPR-K)</h2>
            <p className={bodyClass}>
              Self-service RacePulsePH accounts require users to confirm they are at least 13 years old (or the applicable digital consent age in {LEGAL_CONFIG.jurisdiction}). During race event registration, if a minor participant under age 13 is entered (such as a kids&apos; fun run), registration requires explicit verifiable parent or legal guardian name, relationship, and unchecked consent confirmation prior to submission. Parents or guardians may inspect or request immediate removal of minor records via{' '}
              <a href={`mailto:${LEGAL_CONFIG.supportEmail}`} className={accentLinkClass}>
                {LEGAL_CONFIG.supportEmail}
              </a>
              .
            </p>
          </section>

          <section className={sectionCardClass} aria-labelledby="priv-sdks">
            <h2 id="priv-sdks" className={headingClass}>4. Third-party SDKs, service providers, and consent gating</h2>
            <p className={bodyClass}>
              RacePulsePH runs zero advertising pixels or hidden telemetry SDKs. Every integrated third-party SDK and backend processor audited from our codebase is listed below:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-default)] text-[var(--text-primary)]">
                    <th className="py-2 pr-3 font-semibold">Provider / SDK</th>
                    <th className="py-2 pr-3 font-semibold">Category</th>
                    <th className="py-2 pr-3 font-semibold">Data Shared &amp; Purpose</th>
                    <th className="py-2 font-semibold">Opt-In Gate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-secondary)]">
                  {THIRD_PARTY_SDK_MANIFEST.map((sdk) => (
                    <tr key={sdk.name}>
                      <td className="py-2.5 pr-3 font-semibold text-[var(--text-primary)] align-top">{sdk.name}</td>
                      <td className="py-2.5 pr-3 align-top whitespace-nowrap">{sdk.category}</td>
                      <td className="py-2.5 pr-3 align-top">
                        {sdk.dataCollected} {sdk.purpose}
                      </td>
                      <td className="py-2.5 align-top whitespace-nowrap">
                        {sdk.consentRequired ? 'Blocked until opt-in' : 'Core service'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={sectionCardClass} aria-labelledby="priv-rights">
            <h2 id="priv-rights" className={headingClass}>5. Your privacy, deletion, and opt-out rights</h2>
            <p className={bodyClass}>
              Under applicable privacy law in {LEGAL_CONFIG.jurisdiction} (including the Data Privacy Act of 2012, RA 10173, and GDPR principles), you have the right to access, correct, opt out of optional updates, or permanently delete your account and personal records:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Self-serve account deletion:</strong> Sign in and open your Profile or Account &amp; Data Rights settings to run{' '}
                <span className="font-semibold text-[var(--text-primary)]">Delete My Account &amp; Data</span>, which purges your profile, runner entries, friend links, username index, and authentication record, and anonymizes payment ledger references.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">One-click email opt-out:</strong> Unsubscribe anytime without logging in using the{' '}
                <a
                  href="/unsubscribe"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenUnsubscribe();
                  }}
                  className={accentLinkClass}
                >
                  Unsubscribe page
                </a>
                .
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Cookie &amp; script preferences:</strong>{' '}
                <button type="button" onClick={onOpenCookiePreferences} className={accentLinkClass}>
                  Manage Cookie Preferences
                </button>
                .
              </li>
            </ul>
          </section>
        </div>
      );
    }

    if (doc === 'terms') {
      return (
        <div className="space-y-6">
          <p className={bodyClass}>
            These Terms of Service govern your use of {LEGAL_CONFIG.companyName} (&quot;RacePulsePH&quot;) as a runner, spectator, race organizer, timing operator, or administrator. By creating an account or registering for an event, you affirmatively accept these terms.
          </p>

          <section className={sectionCardClass} aria-labelledby="terms-use">
            <h2 id="terms-use" className={headingClass}>1. Acceptable use and account integrity</h2>
            <p className={bodyClass}>
              You agree to provide accurate registration details, verify your email address, and never impersonate another athlete, swap timing chips, forge manual payment proofs, attempt unauthorized admin access, or disrupt race-day network services. Organizers are responsible for accurate event rules, course safety, distance pricing, and manual payment verification.
            </p>
          </section>

          <section className={sectionCardClass} aria-labelledby="terms-timing">
            <h2 id="terms-timing" className={headingClass}>2. Race timing and results governance</h2>
            <p className={bodyClass}>
              Official rankings, chip elapsed times, gun times, and checkpoint splits depend on properly worn bib/RFID hardware, organizer checkpoint review, and physical mat reads. Organizers review and publish final standings prior to marking a race completed. RacePulsePH does not warrant zero radio interference or uninterrupted field cellular connectivity, and maintains local queue safeguards for operator reconciliation.
            </p>
          </section>

          <section className={sectionCardClass} aria-labelledby="terms-liability">
            <h2 id="terms-liability" className={headingClass}>3. Health, event participation, and limitation of liability</h2>
            <p className={bodyClass}>
              Athletic road and trail events involve physical exertion and weather risks managed by the independent event organizer, not RacePulsePH. Nothing on this site constitutes medical advice or health certification. To the maximum extent permitted by law in {LEGAL_CONFIG.jurisdiction}, {LEGAL_CONFIG.companyName} is not liable for indirect or incidental damages arising from event cancellations or third-party payment downtime, and platform liability for online transactions is limited to verified platform fees received by RacePulsePH.
            </p>
          </section>

          <section className={sectionCardClass} aria-labelledby="terms-law">
            <h2 id="terms-law" className={headingClass}>4. Governing law and termination</h2>
            <p className={bodyClass}>
              These terms are governed by the laws of {LEGAL_CONFIG.jurisdiction}. You may stop using the service and delete your account at any time via account settings. We may suspend accounts that violate safety, payment integrity, or abuse rules.
            </p>
          </section>
        </div>
      );
    }

    if (doc === 'refund') {
      return (
        <div className="space-y-6">
          <p className={bodyClass}>
            {LEGAL_CONFIG.companyName} provides transparent pricing and cancellation protections for Philippine running events processed on RacePulsePH. All registration charges are one-time event payments; RacePulsePH does not charge hidden platform add-ons or recurring auto-renewal subscriptions.
          </p>

          <section className={sectionCardClass} aria-labelledby="refund-eligibility">
            <h2 id="refund-eligibility" className={headingClass}>1. Exact cancellation and refund timeframes</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)] leading-relaxed">
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Organizer cancellation without rescheduling (100% refundable):</strong> If an organizer cancels an event outright without an accepted rescheduled date, paid online registrants are eligible for a 100% refund of the paid entry fee within 10 business days of cancellation notice.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Voluntary runner cancellation (14+ calendar days before race day):</strong> Registrants may request cancellation or category adjustment at least 14 calendar days prior to event date, subject to published organizer kit-production cutoffs. Approved refunds are returned to the original PayMongo payment method or manual transfer channel within 5 to 10 business days.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Within 14 days of race day / customized bibs and shirts picked up:</strong> Once race kits are claimed or within 14 calendar days of gun start (when shirts and timing bibs are finalized), registrations are generally non-refundable unless the event is canceled or postponed by the organizer or required by law.
              </li>
              <li>
                <strong className="font-semibold text-[var(--text-primary)]">Duplicate charges and technical billing errors:</strong> Verified duplicate charges or failed-registration debits are refunded 100% in full (including gateway fees) upon review within 3 to 5 business days.
              </li>
            </ul>
          </section>

          <section className={sectionCardClass} aria-labelledby="refund-fees">
            <h2 id="refund-fees" className={headingClass}>2. Payment gateway fees and manual transfers</h2>
            <p className={bodyClass}>
              Before submitting any paid entry, the checkout summary discloses the exact distance fee in PHP, tax inclusion notice, and whether third-party PayMongo payment processing fees are absorbed by the organizer or passed on at PayMongo checkout. Non-refundable third-party processor fees only apply to voluntary runner-initiated cancellations after processing, never to duplicate charges or organizer-fault cancellations.
            </p>
            <p className={bodyClass}>
              For manual GCash, Maya, or QRPh transfers verified directly by the event organizer, contact the event organizer listed on the race card or reach {LEGAL_CONFIG.companyName} support at{' '}
              <a href={`mailto:${LEGAL_CONFIG.supportEmail}`} className={accentLinkClass}>
                {LEGAL_CONFIG.supportEmail}
              </a>{' '}
              with your registration reference and receipt.
            </p>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <p className={bodyClass}>
          RacePulsePH does not use advertising cookies or cross-site behavioral tracking. The application stores strictly necessary data in browser storage (localStorage, sessionStorage, and IndexedDB) to operate sessions, accessibility preferences, and offline timing sync queues, alongside explicit opt-in gates for optional Analytics and Marketing categories.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenCookiePreferences}
            className="min-h-11 px-5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            <span>Open Cookie Preferences</span>
          </button>
        </div>

        <section className={sectionCardClass} aria-labelledby="cookie-manifest">
          <h2 id="cookie-manifest" className={headingClass}>Categorized browser storage and cookie manifest</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-primary)]">
                  <th className="py-2 pr-3 font-semibold">Category</th>
                  <th className="py-2 pr-3 font-semibold">Key / Store</th>
                  <th className="py-2 pr-3 font-semibold">Retention</th>
                  <th className="py-2 font-semibold">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-secondary)]">
                {BROWSER_STORAGE_MANIFEST.map((entry) => (
                  <tr key={entry.key}>
                    <td className="py-2.5 pr-3 font-semibold text-[var(--text-primary)] align-top whitespace-nowrap">
                      {entry.category}
                    </td>
                    <td className="py-2.5 pr-3 font-mono align-top">{entry.key} ({entry.store})</td>
                    <td className="py-2.5 pr-3 align-top">{entry.retention}</td>
                    <td className="py-2.5 align-top">{entry.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  const DocIcon =
    doc === 'privacy'
      ? ShieldCheck
      : doc === 'terms'
        ? FileText
        : doc === 'refund'
          ? CreditCard
          : Cookie;

  return (
    <article className="max-w-4xl mx-auto glass-panel p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back</span>
        </button>

        <nav aria-label="Legal policy navigation" className="flex flex-wrap items-center gap-2">
          {LEGAL_DOCUMENTS.map((item) => {
            const active = item.key === doc;
            return (
              <a
                key={item.key}
                href={item.path}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onSwitchDoc(item.key);
                }}
                className={`min-h-11 px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center transition-colors ${
                  active
                    ? 'border-red-700 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>

      <header className="space-y-2 border-b border-[var(--border-subtle)] pb-5">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs font-semibold">
          <DocIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Effective {LEGAL_CONFIG.effectiveDate}</span>
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          {activeMeta.label}
        </h1>
      </header>

      {renderBody()}

      <aside className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 sm:p-5 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <Building2 className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <span>Verified Business &amp; Compliance Contact</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Entity: <strong className="font-semibold text-[var(--text-primary)]">{LEGAL_CONFIG.companyName}</strong> | Address: {LEGAL_CONFIG.businessAddress} | Jurisdiction: {LEGAL_CONFIG.jurisdiction} | Support:{' '}
          <a href={`mailto:${LEGAL_CONFIG.supportEmail}`} className={accentLinkClass}>
            {LEGAL_CONFIG.supportEmail}
          </a>
        </p>
      </aside>

      <footer className="border-t border-[var(--border-subtle)] pt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onOpenAuth}
          className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          <span>Sign in to manage or delete account data</span>
        </button>

        <a
          href={`mailto:${LEGAL_CONFIG.supportEmail}`}
          className="min-h-11 inline-flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-4"
        >
          <Mail className="w-4 h-4" aria-hidden="true" />
          <span>{LEGAL_CONFIG.supportEmail}</span>
        </a>
      </footer>
    </article>
  );
}

interface PublicNotFoundViewProps {
  pathname: string;
  onGoHome: () => void;
  onGoLogin: () => void;
}

export function PublicNotFoundView({ pathname, onGoHome, onGoLogin }: PublicNotFoundViewProps) {
  return (
    <section
      aria-labelledby="not-found-title"
      className="max-w-lg w-full glass-panel p-6 sm:p-8 text-center space-y-5"
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400 font-mono">404 Not Found</p>
        <h1 id="not-found-title" className="font-display text-2xl sm:text-3xl font-semibold text-[var(--text-primary)]">
          Page not found
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          No RacePulsePH page exists at <code className="font-mono text-xs text-[var(--text-primary)]">{pathname}</code>.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onGoHome}
          className="min-h-11 px-5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold transition-colors"
        >
          Go to Race Directory
        </button>
        <button
          type="button"
          onClick={onGoLogin}
          className="min-h-11 px-5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
        >
          Sign in
        </button>
      </div>
    </section>
  );
}
