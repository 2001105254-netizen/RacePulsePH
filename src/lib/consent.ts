export type ConsentCategory = 'essential' | 'analytics' | 'marketing';

export interface CookieConsentState {
  version: number;
  essential: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
}

const CONSENT_STORAGE_KEY = 'racepulse_cookie_consent_v1';
const CONSENT_VERSION = 1;
const injectedScripts = new Set<string>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore subscriber errors during consent updates.
    }
  });
}

function syncDocumentAttributes(state: CookieConsentState | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.consentRecorded = state ? 'true' : 'false';
  root.dataset.consentAnalytics = state?.analytics ? 'true' : 'false';
  root.dataset.consentMarketing = state?.marketing ? 'true' : 'false';
}

/** Read the persisted consent decision; returns null until the user explicitly chooses. */
export function readConsentState(): CookieConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentState>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== CONSENT_VERSION ||
      typeof parsed.analytics !== 'boolean' ||
      typeof parsed.marketing !== 'boolean' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null;
    }
    const state: CookieConsentState = {
      version: CONSENT_VERSION,
      essential: true,
      analytics: parsed.analytics,
      marketing: parsed.marketing,
      updatedAt: parsed.updatedAt,
    };
    syncDocumentAttributes(state);
    return state;
  } catch {
    return null;
  }
}

/** Persist granular consent preferences and unlock only explicitly opted-in script categories. */
export function saveConsentPreferences(input: { analytics: boolean; marketing: boolean }): CookieConsentState {
  const next: CookieConsentState = {
    version: CONSENT_VERSION,
    essential: true,
    analytics: Boolean(input.analytics),
    marketing: Boolean(input.marketing),
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep in-memory state via document attributes even when storage is restricted.
  }
  syncDocumentAttributes(next);
  notifyListeners();
  return next;
}

/** Returns true only for essential storage or categories with explicit recorded opt-in. */
export function isConsentGranted(category: ConsentCategory): boolean {
  if (category === 'essential') return true;
  const state = readConsentState();
  if (!state) return false;
  return category === 'analytics' ? state.analytics : state.marketing;
}

/**
 * Subscribe to consent state updates (including cross-tab storage changes).
 */
export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY) listener();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Gate any non-essential third-party script behind explicit user opt-in.
 */
export function loadConsentedScript(options: {
  id: string;
  src: string;
  category: Exclude<ConsentCategory, 'essential'>;
  async?: boolean;
}): boolean {
  if (typeof document === 'undefined') return false;
  if (!isConsentGranted(options.category)) return false;
  if (injectedScripts.has(options.id) || document.getElementById(options.id)) return true;
  const script = document.createElement('script');
  script.id = options.id;
  script.src = options.src;
  script.async = options.async ?? true;
  document.head.appendChild(script);
  injectedScripts.add(options.id);
  return true;
}

