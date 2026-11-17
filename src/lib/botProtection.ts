import type { FirebaseApp } from 'firebase/app';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';

let appCheckInstance: AppCheck | null = null;
let appCheckInitialized = false;

export function initFirebaseAppCheck(app: FirebaseApp): AppCheck | null {
  if (appCheckInitialized || typeof window === 'undefined') {
    return appCheckInstance;
  }
  appCheckInitialized = true;

  const siteKey = String(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY || '').trim();
  if (!siteKey) {
    return null;
  }

  try {
    if (import.meta.env.DEV) {
      const debugToken = String(import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN || '').trim();
      if (debugToken) {
        (self as unknown as Record<string, unknown>).FIREBASE_APP_CHECK_DEBUG_TOKEN =
          debugToken === 'true' ? true : debugToken;
      }
    }

    const providerKind = String(import.meta.env.VITE_FIREBASE_APP_CHECK_PROVIDER || 'enterprise')
      .trim()
      .toLowerCase();
    const provider =
      providerKind === 'v3'
        ? new ReCaptchaV3Provider(siteKey)
        : new ReCaptchaEnterpriseProvider(siteKey);

    appCheckInstance = initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('Firebase App Check initialization skipped:', err);
    appCheckInstance = null;
  }
  return appCheckInstance;
}

export function isAppCheckConfigured(): boolean {
  return Boolean(appCheckInstance);
}

/**
 * Retrieves the `X-Firebase-AppCheck` header with a short timeout so blocked
 * third-party attestation scripts never hang interactive user flows.
 */
export async function getAppCheckHeaders(): Promise<Record<string, string>> {
  if (!appCheckInstance) return {};
  try {
    const result = await Promise.race([
      getToken(appCheckInstance, false),
      new Promise<null>((resolve) => globalThis.setTimeout(() => resolve(null), 2000)),
    ]);
    if (result && typeof result.token === 'string' && result.token) {
      return { 'X-Firebase-AppCheck': result.token };
    }
  } catch {
    // Observation mode or blocked attestation falls back cleanly.
  }
  return {};
}

export function isTurnstileConfigured(): boolean {
  return Boolean(String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim());
}

export function getTurnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
}

export interface HumanFormSignals {
  _hp: string;
  _ft: number;
  turnstileToken?: string;
}

export function buildHumanFormSignals(
  honeypotValue: string,
  mountedAtMs: number,
  turnstileToken?: string,
): HumanFormSignals {
  return {
    _hp: honeypotValue,
    _ft: Math.max(0, Date.now() - mountedAtMs),
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}
