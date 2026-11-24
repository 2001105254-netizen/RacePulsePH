import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shouldShowOnboardingHint } from '../../lib/runnerShell';

export interface RunnerOnboardingHintProps {
  id: string;
  storageKey: string;
  title: string;
  body: string;
  suppress?: boolean;
  onDismiss?: () => void;
}

type PopoverHostElement = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

export function supportsNativePopover(): boolean {
  return typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
}

export function readDismissedOnboardingHints(
  storageKey: string,
  storage?: Pick<Storage, 'getItem'> | null,
): Set<string> {
  const dismissed = new Set<string>();
  if (!storageKey.trim()) return dismissed;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (target?.getItem(storageKey) === 'dismissed') {
      dismissed.add(storageKey);
    }
  } catch {
    // Storage access can fail in restricted browser contexts; show hint for the active session.
  }
  return dismissed;
}

export function mergeDismissedOnboardingHints(
  prev: ReadonlySet<string>,
  storageKey: string,
  storage?: Pick<Storage, 'getItem'> | null,
): Set<string> {
  const fromStorage = readDismissedOnboardingHints(storageKey, storage);
  if (fromStorage.size === 0) {
    return prev instanceof Set ? prev : new Set(prev);
  }
  const next = new Set(prev);
  for (const key of fromStorage) {
    next.add(key);
  }
  return next;
}

export function persistDismissedOnboardingHint(
  storageKey: string,
  storage?: Pick<Storage, 'setItem'> | null,
): boolean {
  if (!storageKey.trim()) return false;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return false;
    target.setItem(storageKey, 'dismissed');
    return true;
  } catch {
    return false;
  }
}

function isPopoverCurrentlyOpen(el: PopoverHostElement): boolean {
  try {
    return el.matches(':popover-open');
  } catch {
    return false;
  }
}

function hideHintPopoverSafely(el: PopoverHostElement | null) {
  if (!el || typeof el.hidePopover !== 'function') return;
  try {
    if (isPopoverCurrentlyOpen(el)) {
      el.hidePopover();
    }
  } catch {
    // Ignore when popover is already closed or detached from DOM.
  }
}

export default function RunnerOnboardingHint({
  id,
  storageKey,
  title,
  body,
  suppress = false,
  onDismiss,
}: RunnerOnboardingHintProps) {
  const popoverRef = useRef<PopoverHostElement | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const [checkedStorageKey, setCheckedStorageKey] = useState<string | null>(null);

  const supportsPopover = useMemo(() => supportsNativePopover(), []);

  useEffect(() => {
    setDismissedKeys((prev) => mergeDismissedOnboardingHints(prev, storageKey));
    setCheckedStorageKey(storageKey);
  }, [storageKey]);

  const storageChecked = checkedStorageKey === storageKey;
  const visible =
    storageChecked && shouldShowOnboardingHint(storageKey, Boolean(suppress), dismissedKeys);

  // Set popover="manual" as a DOM attribute before paint without shadowing the IDL property.
  const setHintElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      popoverRef.current = node as PopoverHostElement | null;
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

    if (visible && !suppress) {
      if (!isPopoverCurrentlyOpen(el)) {
        try {
          el.showPopover?.();
        } catch {
          // Ignore if browser rejects top-layer promotion while disconnected.
        }
      }
    } else {
      hideHintPopoverSafely(el);
    }
  }, [supportsPopover, visible, suppress]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !supportsPopover) return;
    return () => {
      hideHintPopoverSafely(el);
    };
  }, [supportsPopover]);

  const handleDismiss = useCallback(() => {
    persistDismissedOnboardingHint(storageKey);
    setDismissedKeys((prev) => {
      if (prev.has(storageKey)) return prev;
      const next = new Set(prev);
      next.add(storageKey);
      return next;
    });
    if (supportsPopover) {
      hideHintPopoverSafely(popoverRef.current);
    }
    onDismiss?.();
  }, [onDismiss, storageKey, supportsPopover]);

  if (!supportsPopover && !visible) {
    return null;
  }

  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;

  return (
    <div
      ref={supportsPopover ? setHintElementRef : undefined}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={`rp-hint-popover fixed ${
        supportsPopover ? '' : 'z-50'
      } bottom-[calc(4.5rem+var(--rp-safe-bottom))] left-[max(0.75rem,var(--rp-safe-left))] right-[max(0.75rem,var(--rp-safe-right))] min-[600px]:left-auto min-[600px]:right-[max(1rem,var(--rp-safe-right))] min-[600px]:bottom-[max(1rem,var(--rp-safe-bottom))] min-[600px]:w-[min(22rem,calc(100vw-6rem))] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] p-4 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22)] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.65)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
            {title}
          </h2>
          <p id={bodyId} className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
            {body}
          </p>
        </div>
        <button
          type="button"
          popoverTarget={supportsPopover ? id : undefined}
          popoverTargetAction={supportsPopover ? 'hide' : undefined}
          onClick={handleDismiss}
          className="shrink-0 min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
