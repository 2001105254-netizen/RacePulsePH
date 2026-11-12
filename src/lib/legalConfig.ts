export type LegalDocKey = 'privacy' | 'terms' | 'refund' | 'cookies';

export interface LegalDocumentMeta {
  key: LegalDocKey;
  path: string;
  label: string;
  title: string;
  description: string;
}

export interface ThirdPartySdkEntry {
  name: string;
  category: 'Strictly Necessary' | 'Functional Typography' | 'Payment Processing' | 'Transactional Email' | 'Unused Dependency';
  consentRequired: boolean;
  dataCollected: string;
  purpose: string;
  sourceFiles: string;
}

export interface BrowserStorageKeyEntry {
  key: string;
  store: 'localStorage' | 'sessionStorage' | 'IndexedDB';
  category: 'Strictly Necessary' | 'Analytics' | 'Marketing';
  retention: string;
  purpose: string;
}

const envValue = (key: string, fallback: string): string => {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
};

/** Public company and compliance metadata read from environment variables with explicit placeholders. */
export const LEGAL_CONFIG = {
  companyName: envValue('VITE_COMPANY_NAME', 'RacePulsePH'),
  businessAddress: envValue('VITE_BUSINESS_ADDRESS', 'Malaybalay City, Bukidnon, Philippines'),
  supportEmail: envValue('VITE_SUPPORT_EMAIL', 'events@racepulseph.com'),
  jurisdiction: envValue('VITE_JURISDICTION', 'Republic of the Philippines'),
  appUrl: envValue('VITE_APP_URL', 'https://racepulseph.com'),
  effectiveDate: 'November 12, 2026',
} as const;

export const LEGAL_DOCUMENTS: LegalDocumentMeta[] = [
  {
    key: 'privacy',
    path: '/privacy-policy',
    label: 'Privacy Policy',
    title: 'Privacy Policy | RacePulsePH',
    description: 'How RacePulsePH collects, uses, retains, and protects runner, organizer, and race-day data.',
  },
  {
    key: 'terms',
    path: '/terms-of-service',
    label: 'Terms of Service',
    title: 'Terms of Service | RacePulsePH',
    description: 'Acceptable use, timing disclaimers, liability limits, and governing law for RacePulsePH.',
  },
  {
    key: 'refund',
    path: '/refund-policy',
    label: 'Refund Policy',
    title: 'Refund & Cancellation Policy | RacePulsePH',
    description: 'Refund timeframes, organizer cancellations, gateway processing fees, and duplicate charge support.',
  },
  {
    key: 'cookies',
    path: '/cookie-policy',
    label: 'Cookie Policy',
    title: 'Cookie & Local Storage Policy | RacePulsePH',
    description: 'Strictly Necessary, Analytics, and Marketing storage disclosures and consent preferences.',
  },
];

/** Verified manifest derived from package.json, index.html, functions/package.json, and runtime code. */
export const THIRD_PARTY_SDK_MANIFEST: ThirdPartySdkEntry[] = [
  {
    name: 'Firebase Authentication, Cloud Firestore & Cloud Storage (firebase 12.15.0)',
    category: 'Strictly Necessary',
    consentRequired: false,
    dataCollected: 'Account UID, email address, display name, username, hashed auth/session tokens, race registrations, checkpoint chip reads, and uploaded bib/QR/shirt assets.',
    purpose: 'Core account sign-in, authorization rules, race registration, and live/official timing persistence. Firebase Analytics is not loaded.',
    sourceFiles: 'package.json, src/firebase.ts',
  },
  {
    name: 'Google Sign-In (@capgo/capacitor-social-login & Firebase OAuth)',
    category: 'Strictly Necessary',
    consentRequired: false,
    dataCollected: 'Google ID token, verified email address, display name, and public profile photo URL (only when the user chooses Google sign-in).',
    purpose: 'Passwordless federated sign-in on web and Android Capacitor.',
    sourceFiles: 'src/firebase.ts, src/components/AuthGate.tsx',
  },
  {
    name: 'Capacitor Android Runtime (@capacitor/core, @capacitor/app)',
    category: 'Strictly Necessary',
    consentRequired: false,
    dataCollected: 'Hardware back-button navigation events and local webview lifecycle state on Android builds. No advertising IDs collected.',
    purpose: 'Native Android navigation shell compatibility.',
    sourceFiles: 'package.json, src/lib/capacitorAndroid.ts',
  },
  {
    name: 'PayMongo Checkout Sessions (api.paymongo.com/v2/checkout_sessions)',
    category: 'Payment Processing',
    consentRequired: false,
    dataCollected: 'Runner billing name, account email, emergency phone number, race distance description, and transaction amount in PHP (server-side Cloud Function only).',
    purpose: 'Processes online Card, GCash, Maya, and QRPh race entry payments when online checkout is selected.',
    sourceFiles: 'functions/index.js, src/lib/payments.ts',
  },
  {
    name: 'Nodemailer Gmail SMTP (smtp.gmail.com)',
    category: 'Transactional Email',
    consentRequired: false,
    dataCollected: 'Recipient email address, first name, and one-time email verification or password reset codes sent from events@racepulseph.com.',
    purpose: 'Account security verification, password reset delivery, and one-click unsubscribe headers.',
    sourceFiles: 'functions/auth-api.js, functions/account-email.js',
  },
  {
    name: 'Google Fonts CDN (fonts.googleapis.com / fonts.gstatic.com)',
    category: 'Functional Typography',
    consentRequired: false,
    dataCollected: 'Standard HTTP request metadata (IP address and browser user agent) transmitted when downloading Inter, Space Grotesk, and JetBrains Mono stylesheets.',
    purpose: 'Renders legibility-focused race timer and UI web fonts.',
    sourceFiles: 'index.html',
  },
  {
    name: 'Generative AI Package (@google/genai 2.4.0)',
    category: 'Unused Dependency',
    consentRequired: false,
    dataCollected: 'None. Audited across src/, functions/, and server.ts: zero imports, zero client keys, and zero outbound requests.',
    purpose: 'Residual scaffold dependency documented transparently for supply-chain auditing; inactive at runtime.',
    sourceFiles: 'package.json',
  },
];

export const BROWSER_STORAGE_MANIFEST: BrowserStorageKeyEntry[] = [
  {
    key: 'firebaseLocalStorageDb / firebase:*',
    store: 'IndexedDB',
    category: 'Strictly Necessary',
    retention: 'Until sign-out or account deletion',
    purpose: 'Maintains authenticated Firebase session persistence and offline Firestore cache for race-day resilience.',
  },
  {
    key: 'racepulse_cookie_consent_v1',
    store: 'localStorage',
    category: 'Strictly Necessary',
    retention: '12 months (or until updated/cleared)',
    purpose: 'Stores your granular Strictly Necessary, Analytics, and Marketing consent selections.',
  },
  {
    key: 'racepulse_theme',
    store: 'localStorage',
    category: 'Strictly Necessary',
    retention: 'Persistent until changed',
    purpose: 'Stores your selected light or dark display mode.',
  },
  {
    key: 'racepulse_verification:<uid> & racepulse_signup:<email>',
    store: 'sessionStorage',
    category: 'Strictly Necessary',
    retention: 'Browser tab session only',
    purpose: 'Preserves 6-digit email verification resend cooldown timers and in-progress signup profile names.',
  },
  {
    key: 'racepulse_pending_chip_reads_v2:* & racepulse_*',
    store: 'localStorage',
    category: 'Strictly Necessary',
    retention: 'Until synced or cleared',
    purpose: 'Stores offline timing checkpoint queues, selected operator/organizer race context, sidebar layout, and runner reminder acknowledgements.',
  },
  {
    key: 'Optional Analytics Scripts (None active)',
    store: 'localStorage',
    category: 'Analytics',
    retention: 'Not stored unless opted in',
    purpose: 'No analytics or crash telemetry scripts are loaded unless explicitly enabled under Analytics preferences.',
  },
  {
    key: 'Optional Marketing Trackers (None active)',
    store: 'localStorage',
    category: 'Marketing',
    retention: 'Not stored unless opted in',
    purpose: 'No ad pixels or behavioral retargeting scripts run on RacePulsePH. Email announcements require explicit unchecked opt-in and can be stopped via /unsubscribe.',
  },
];

