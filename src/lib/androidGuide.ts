export const ANDROID_GUIDE_STORAGE_PREFIX = 'racepulse_android_guide_v1:';

export type AndroidGuideStepId = 'explore' | 'register' | 'details' | 'payment' | 'passes';

export interface AndroidGuideStep {
  id: AndroidGuideStepId;
  stepNumber: number;
  title: string;
  body: string;
  mode: 'spotlight' | 'stage';
  targetSelector?: string;
  fallbackSelector?: string;
  actionLabel?: string;
}

export const ANDROID_GUIDE_STEPS: readonly AndroidGuideStep[] = [
  {
    id: 'explore',
    stepNumber: 1,
    title: 'Open Explore to find races',
    body: 'Tap Explore to browse open running events, dates, distances, and entry fees.',
    mode: 'spotlight',
    targetSelector: '[data-tour-target="nav-explore"]',
    actionLabel: 'Tap Explore or Next',
  },
  {
    id: 'register',
    stepNumber: 2,
    title: 'Pick a race and tap Register',
    body: 'Tap Event details to check the route and inclusions, or tap Register to open the sign-up form.',
    mode: 'spotlight',
    targetSelector: '[data-tour-target="race-register-btn"]',
    fallbackSelector: '[data-tour-target="explore-open-filter"]',
    actionLabel: 'Next: Form Details',
  },
  {
    id: 'details',
    stepNumber: 3,
    title: 'Fill in your runner details',
    body: 'Choose your distance and Solo or Team entry, then enter your name, age, emergency contact, shirt size, and accept the terms.',
    mode: 'stage',
    actionLabel: 'Next: How to Pay',
  },
  {
    id: 'payment',
    stepNumber: 4,
    title: 'Pay to confirm your bib',
    body: 'Paid races use either Online Checkout (GCash, Maya, QRPh, or card) for instant confirmation, or Manual Transfer where you enter your reference number. Free races confirm right away.',
    mode: 'stage',
    actionLabel: 'Next: Your Race Pass',
  },
  {
    id: 'passes',
    stepNumber: 5,
    title: 'View your Bib and QR Pass',
    body: 'Open You then My Passes anytime to check your Bib Number, payment status, QR race pass, and official results.',
    mode: 'spotlight',
    targetSelector: '[data-tour-target="nav-you"]',
    actionLabel: 'Start Exploring Races',
  },
] as const;

export function androidGuideStorageKey(uid: string): string {
  const trimmed = uid.trim();
  return trimmed ? `${ANDROID_GUIDE_STORAGE_PREFIX}${trimmed}` : '';
}

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasCompletedAndroidGuide(
  uid: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): boolean {
  const key = androidGuideStorageKey(uid);
  if (!key) return false;
  try {
    const target = resolveStorage(storage);
    const val = target?.getItem(key);
    return val === 'completed' || val === 'skipped';
  } catch {
    return false;
  }
}

export function markAndroidGuideCompleted(
  uid: string,
  status: 'completed' | 'skipped' = 'completed',
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): boolean {
  const key = androidGuideStorageKey(uid);
  if (!key) return false;
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.setItem(key, status);
    return true;
  } catch {
    return false;
  }
}

export function resetAndroidGuide(
  uid: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): boolean {
  const key = androidGuideStorageKey(uid);
  if (!key) return false;
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export interface AndroidGuideAutoLaunchInput {
  isAndroid: boolean;
  uid: string;
  hasCompleted: boolean;
  canRegister: boolean;
  hasExploreTab: boolean;
  profilesLoaded: boolean;
  blocked: boolean;
}

export function shouldAutoLaunchAndroidGuide(input: AndroidGuideAutoLaunchInput): boolean {
  if (!input.isAndroid) return false;
  if (!input.uid.trim()) return false;
  if (!input.profilesLoaded) return false;
  if (input.hasCompleted) return false;
  if (input.blocked) return false;
  if (!input.canRegister) return false;
  if (!input.hasExploreTab) return false;
  return true;
}

export function isAndroidGuideEnabled(options: {
  isAndroidNative: boolean;
  isDev: boolean;
  sessionFlag?: string | null;
  search?: string;
}): boolean {
  if (options.isAndroidNative) return true;
  if (!options.isDev) return false;

  let sessionFlag = options.sessionFlag;
  let search = options.search;
  if (typeof window !== 'undefined') {
    if (sessionFlag === undefined) {
      try {
        sessionFlag = window.sessionStorage.getItem('racepulse_e2e_android_tutorial');
      } catch {
        sessionFlag = null;
      }
    }
    if (search === undefined) {
      search = window.location.search;
    }
  }

  if (sessionFlag === '1') return true;
  if (search && new URLSearchParams(search).get('previewAndroidGuide') === '1') return true;
  return false;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SpotlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export interface SpotlightPlacement {
  cardPlacement: 'top' | 'bottom' | 'center';
  spotlightBox: SpotlightBox | null;
  cursorPoint: CursorPoint | null;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function computeSpotlightPlacement(
  targetRect: RectLike | null,
  viewport: ViewportSize,
): SpotlightPlacement {
  if (
    !targetRect ||
    !Number.isFinite(targetRect.left) ||
    !Number.isFinite(targetRect.top) ||
    !Number.isFinite(targetRect.width) ||
    !Number.isFinite(targetRect.height) ||
    targetRect.width <= 0 ||
    targetRect.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return {
      cardPlacement: 'center',
      spotlightBox: null,
      cursorPoint: null,
    };
  }

  const pad = 6;
  const rawLeft = clamp(targetRect.left - pad, 0, Math.max(0, viewport.width - 12));
  const rawTop = clamp(targetRect.top - pad, 0, Math.max(0, viewport.height - 12));
  const rawRight = clamp(targetRect.left + targetRect.width + pad, rawLeft + 12, viewport.width);
  const rawBottom = clamp(targetRect.top + targetRect.height + pad, rawTop + 12, viewport.height);

  const spotlightBox: SpotlightBox = {
    left: Math.round(rawLeft),
    top: Math.round(rawTop),
    width: Math.round(rawRight - rawLeft),
    height: Math.round(rawBottom - rawTop),
  };

  // Anchor pointer tip on the lower-right interior of the highlighted control so the
  // cursor arrow body does not cover the target label.
  const cursorX = clamp(
    targetRect.left + targetRect.width * 0.72,
    8,
    Math.max(8, viewport.width - 24),
  );
  const cursorY = clamp(
    targetRect.top + targetRect.height * 0.66,
    8,
    Math.max(8, viewport.height - 24),
  );

  const targetCenterY = targetRect.top + targetRect.height / 2;
  const cardPlacement = targetCenterY >= viewport.height * 0.5 ? 'top' : 'bottom';

  return {
    cardPlacement,
    spotlightBox,
    cursorPoint: {
      x: Math.round(cursorX),
      y: Math.round(cursorY),
    },
  };
}
