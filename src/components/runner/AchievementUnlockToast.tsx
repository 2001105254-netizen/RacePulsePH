import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Award, ChevronRight, X } from 'lucide-react';
import {
  BADGE_TIER_META,
  formatAchievementToastAnnouncement,
} from '../../lib/badges/presets';
import type { BadgeDefinition, UserBadgeAward } from '../../lib/badges/types';
import BadgeArtwork from '../badges/BadgeArtwork';
import { supportsNativePopover } from './RunnerOnboardingHint';

export interface AchievementUnlockToastProps {
  award: UserBadgeAward | null;
  badge: BadgeDefinition | null;
  suppress?: boolean;
  onOpenBadges?: () => void;
  onDismiss: (award: UserBadgeAward) => void;
}

type PopoverToastElement = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

const AUTO_DISMISS_MS = 6500;
const EXIT_FALLBACK_TIMEOUT_MS = 320;

let cachedDisplayTransitionSupport: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) {
    return cachedDisplayTransitionSupport;
  }
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !document.body ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete')
  ) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  window.getComputedStyle(probe).display;
  probe.style.display = 'none';
  cachedDisplayTransitionSupport = window.getComputedStyle(probe).display === 'block';
  probe.remove();
  return cachedDisplayTransitionSupport;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('overlay', 'auto')) &&
    canTransitionDisplay()
  );
}

function isToastPopoverOpen(el: PopoverToastElement): boolean {
  try {
    return el.matches(':popover-open') || el.classList.contains(':popover-open');
  } catch {
    return false;
  }
}

async function closeToastPopoverWithExit(el: PopoverToastElement | null): Promise<void> {
  if (!el || typeof el.hidePopover !== 'function' || !isToastPopoverOpen(el)) {
    return;
  }
  try {
    if (!supportsTopLayerExit()) {
      el.setAttribute('data-closing', '');
      const animations = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }) : [];
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map((anim) => anim.finished)),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, EXIT_FALLBACK_TIMEOUT_MS);
          }),
        ]);
      }
      if (!el.hasAttribute('data-closing')) return;
      el.removeAttribute('data-closing');
    }
    el.hidePopover();
  } catch {
    // Ignore errors when the popover element was already detached during navigation.
  }
}

export default function AchievementUnlockToast({
  award,
  badge,
  suppress = false,
  onOpenBadges,
  onDismiss,
}: AchievementUnlockToastProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const popoverRef = useRef<PopoverToastElement | null>(null);
  const priorExternalFocusRef = useRef<HTMLElement | null>(null);
  const lastAnnouncedIdRef = useRef<string | null>(null);

  const [pausedByInteraction, setPausedByInteraction] = useState(false);
  const isHoveredRef = useRef(false);
  const isFocusedWithinRef = useRef(false);

  const supportsPopover = useMemo(() => supportsNativePopover(), []);
  const visible = Boolean(award && badge && !suppress);

  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const syncInteractionPause = useCallback(() => {
    setPausedByInteraction(isHoveredRef.current || isFocusedWithinRef.current);
  }, []);

  const setToastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      popoverRef.current = node as PopoverToastElement | null;
      if (node && supportsPopover && node.getAttribute('popover') !== 'manual') {
        node.setAttribute('popover', 'manual');
      }
    },
    [supportsPopover],
  );

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !supportsPopover) return;
    if (el.getAttribute('popover') !== 'manual') {
      el.setAttribute('popover', 'manual');
    }

    if (visible) {
      el.removeAttribute('data-closing');
      if (!isToastPopoverOpen(el)) {
        try {
          el.showPopover?.();
        } catch {
          // Ignore when the popover element is disconnected during an immediate tab switch.
        }
      }
    } else {
      void closeToastPopoverWithExit(el);
    }
  }, [supportsPopover, visible]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !supportsPopover) return;
    return () => {
      if (isToastPopoverOpen(el)) {
        try {
          el.removeAttribute('data-closing');
          el.hidePopover?.();
        } catch {
          // Ignore teardown errors when unmounting.
        }
      }
    };
  }, [supportsPopover]);

  useEffect(() => {
    if (!visible || !award || !badge) {
      if (!award) {
        lastAnnouncedIdRef.current = null;
      }
      return;
    }
    const announceKey = `${award.id}:${award.xpAwarded}:${badge.name}`;
    if (lastAnnouncedIdRef.current === announceKey) return;
    lastAnnouncedIdRef.current = announceKey;

    const text = formatAchievementToastAnnouncement(
      badge.name,
      award.xpAwarded,
      Boolean(onOpenBadges),
    );
    let announcedViaAriaNotify = false;

    if (typeof document !== 'undefined') {
      const ariaNotifyFn = (document as Document & { ariaNotify?: (msg: string) => void }).ariaNotify;
      if (typeof ariaNotifyFn === 'function') {
        try {
          ariaNotifyFn.call(document, text);
          announcedViaAriaNotify = true;
        } catch {
          announcedViaAriaNotify = false;
        }
      }
    }
    setLiveAnnouncement(announcedViaAriaNotify ? '' : text);
  }, [visible, award, badge, onOpenBadges]);

  const handleManualDismiss = useCallback(
    (triggerRestoreFocus: boolean) => {
      if (!award) return;
      const el = popoverRef.current;
      const focusWasInside =
        triggerRestoreFocus &&
        typeof document !== 'undefined' &&
        Boolean(el && document.activeElement && el.contains(document.activeElement));

      isHoveredRef.current = false;
      isFocusedWithinRef.current = false;
      setPausedByInteraction(false);
      onDismiss(award);

      if (focusWasInside && priorExternalFocusRef.current?.isConnected) {
        priorExternalFocusRef.current.focus();
      }
      priorExternalFocusRef.current = null;
    },
    [award, onDismiss],
  );

  useEffect(() => {
    if (!visible || !award || pausedByInteraction) return;
    const timer = window.setTimeout(() => {
      isHoveredRef.current = false;
      isFocusedWithinRef.current = false;
      onDismiss(award);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [visible, award, pausedByInteraction, onDismiss]);

  const activeBadge = badge;
  const activeAward = award;
  const tierLabel = activeBadge
    ? activeBadge.customTierLabel?.trim() ||
      BADGE_TIER_META[activeBadge.tier]?.label ||
      activeBadge.tier
    : '';

  const shouldRenderCard = Boolean(activeBadge && activeAward && (supportsPopover || visible));

  return (
    <div role="region" aria-label="Achievement notifications">
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {shouldRenderCard && activeBadge && activeAward && (
        <div
          ref={supportsPopover ? setToastElementRef : popoverRef}
          id={`${baseId}-toast`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descId}
          onMouseEnter={() => {
            isHoveredRef.current = true;
            syncInteractionPause();
          }}
          onMouseLeave={() => {
            isHoveredRef.current = false;
            syncInteractionPause();
          }}
          onFocus={(event) => {
            const el = popoverRef.current;
            const related = event.relatedTarget as HTMLElement | null;
            if (el && related && !el.contains(related)) {
              priorExternalFocusRef.current = related;
            }
            isFocusedWithinRef.current = true;
            syncInteractionPause();
          }}
          onBlur={(event) => {
            const el = popoverRef.current;
            const nextFocus = event.relatedTarget as Node | null;
            if (!el || !nextFocus || !el.contains(nextFocus)) {
              isFocusedWithinRef.current = false;
              syncInteractionPause();
            }
          }}
          className={`rp-achievement-toast fixed ${
            supportsPopover ? '' : 'z-50'
          } bottom-[calc(4.5rem+var(--rp-safe-bottom))] left-[max(0.75rem,var(--rp-safe-left))] right-[max(0.75rem,var(--rp-safe-right))] w-[calc(100vw-max(1.5rem,var(--rp-safe-left)+var(--rp-safe-right)))] max-w-none min-[600px]:left-auto min-[600px]:right-[max(1rem,var(--rp-safe-right))] min-[600px]:bottom-[max(1rem,var(--rp-safe-bottom))] min-[600px]:w-[min(24rem,calc(100vw-6rem))] max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl border border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] p-3.5 shadow-[0_14px_36px_-8px_rgba(0,0,0,0.28)] dark:shadow-[0_18px_44px_-8px_rgba(0,0,0,0.72)]`}
        >
          <div className="flex items-start gap-3">
            <BadgeArtwork badge={activeBadge} size="sm" />

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
                <Award className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Badge Unlocked</span>
                {tierLabel && (
                  <span className="px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)]">
                    {tierLabel}
                  </span>
                )}
              </div>

              <p
                id={titleId}
                className="font-display font-semibold text-sm text-[var(--text-primary)] leading-snug truncate"
              >
                {activeBadge.name}
              </p>

              <p id={descId} className="text-xs font-normal text-[var(--text-secondary)]">
                Earned <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{activeAward.xpAwarded} XP</span>
              </p>

              {onOpenBadges && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      handleManualDismiss(false);
                      onOpenBadges();
                    }}
                    className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    <span>View Badges</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleManualDismiss(true)}
              aria-label="Close achievement notification"
              className="shrink-0 min-h-11 min-w-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
