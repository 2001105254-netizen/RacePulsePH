import type { LegalDocKey } from './legalConfig';
import { matchRouteLocation } from './routes/routing';

export type Theme = 'light' | 'dark';
export type GuestScreen = 'landing' | 'login' | 'signup' | LegalDocKey | 'unsubscribe' | 'not-found';
export type SignedInUtilityView = LegalDocKey | 'unsubscribe' | null;

export function normalizedPathname(pathname = typeof window !== 'undefined' ? window.location.pathname : '/'): string {
  const raw = pathname.toLowerCase();
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw || '/';
}

/**
 * Event registration QR codes use ?register={raceId}. Keep this intentionally
 * small and local: race IDs are public identifiers, and the actual race is
 * still loaded/validated from Firestore before a runner can submit.
 */
export function registrationRaceIdFromUrl(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const raceId = new URLSearchParams(search).get('register')?.trim();
  return raceId || null;
}

export function utilityViewFromPath(path: string): SignedInUtilityView {
  if (path === '/privacy' || path === '/privacy-policy') return 'privacy';
  if (path === '/terms' || path === '/terms-of-service' || path === '/terms-of-use') return 'terms';
  if (path === '/refund-policy' || path === '/refund') return 'refund';
  if (path === '/cookie-policy' || path === '/cookies') return 'cookies';
  if (path === '/unsubscribe') return 'unsubscribe';
  return null;
}

export type SignedInViewPriority = 'utility' | 'verify-email' | 'complete-profile' | 'workspace' | 'guest';

export interface ClientNavigationClickEvent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function isPublicUtilityScreen(screen: GuestScreen): screen is Exclude<SignedInUtilityView, null> {
  return (
    screen === 'privacy' ||
    screen === 'terms' ||
    screen === 'refund' ||
    screen === 'cookies' ||
    screen === 'unsubscribe'
  );
}

export function isImmediateGuestRoute(screen: GuestScreen): boolean {
  return screen === 'login' || screen === 'signup' || isPublicUtilityScreen(screen);
}

export function resolveSignedInViewPriority(params: {
  hasAuthUser: boolean;
  emailVerified: boolean;
  hasProfile: boolean;
  signedInUtilityView: SignedInUtilityView;
}): SignedInViewPriority {
  if (!params.hasAuthUser) return 'guest';
  if (params.signedInUtilityView !== null) return 'utility';
  if (!params.emailVerified) return 'verify-email';
  if (!params.hasProfile) return 'complete-profile';
  return 'workspace';
}

export function isClientNavigationClick(event: ClientNavigationClickEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function guestScreenFromLocation(
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/',
  search = typeof window !== 'undefined' ? window.location.search : '',
): GuestScreen {
  const path = normalizedPathname(pathname);
  const utility = utilityViewFromPath(path);
  if (utility) return utility;
  if (registrationRaceIdFromUrl(search)) return 'signup';
  if (matchRouteLocation(pathname, search)) return 'landing';
  if (path === '/' || path === '/index.html') return 'landing';
  if (path === '/login' || path === '/signin') return 'login';
  if (path === '/register' || path === '/signup') return 'signup';
  return 'not-found';
}

export function pathForGuestScreen(screen: GuestScreen): string {
  switch (screen) {
    case 'login':
      return '/login';
    case 'signup':
      return '/register';
    case 'privacy':
      return '/privacy-policy';
    case 'terms':
      return '/terms-of-service';
    case 'refund':
      return '/refund-policy';
    case 'cookies':
      return '/cookie-policy';
    case 'unsubscribe':
      return '/unsubscribe';
    default:
      return '/';
  }
}
