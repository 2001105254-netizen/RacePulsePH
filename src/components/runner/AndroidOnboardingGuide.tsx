import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Landmark,
  ShieldCheck,
  Ticket,
  X,
} from 'lucide-react';
import {
  ANDROID_GUIDE_STEPS,
  computeSpotlightPlacement,
  type AndroidGuideStepId,
  type CursorPoint,
  type RectLike,
  type ViewportSize,
} from '../../lib/androidGuide';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';
import { EMIL_EASE } from '../ui/MotionPrimitives';

export interface AndroidOnboardingGuideProps {
  open: boolean;
  onComplete: (action: 'finish' | 'skip') => void;
  onStepChange: (stepId: AndroidGuideStepId) => void;
}

interface DetailsPreviewItem {
  id: string;
  title: string;
  summary: string;
  badge: string;
}

const DETAILS_PREVIEW_ITEMS: readonly DetailsPreviewItem[] = [
  {
    id: 'distance',
    title: 'Distance & Entry',
    summary: 'Pick 5K, 10K, 21K, or 42K and Solo, Duo, Trio, or Group.',
    badge: '10K Solo',
  },
  {
    id: 'runner',
    title: 'Runner & Emergency',
    summary: 'Enter your full name, age, emergency contact, and shirt size.',
    badge: 'Required',
  },
  {
    id: 'terms',
    title: 'Terms & Consent',
    summary: 'Check the event policy consent box to unlock registration.',
    badge: 'Accept',
  },
];

interface PaymentPreviewItem {
  id: string;
  title: string;
  badge: string;
  actionCue: string;
  detail: string;
  icon: 'online' | 'manual' | 'free';
}

const PAYMENT_PREVIEW_ITEMS: readonly PaymentPreviewItem[] = [
  {
    id: 'online',
    title: 'Online Checkout',
    badge: 'Instant',
    actionCue: 'Checkout -> Paid',
    detail: 'Pay via PayMongo (GCash, Maya, QRPh, or card). Your bib confirms automatically when checkout finishes.',
    icon: 'online',
  },
  {
    id: 'manual',
    title: 'Manual Transfer',
    badge: 'Verify Ref',
    actionCue: 'Paste Ref -> Reserve',
    detail: 'Scan the organizer QR or transfer via GCash/bank, paste your reference number, then tap Reserve Slot.',
    icon: 'manual',
  },
  {
    id: 'free',
    title: 'Free Race Event',
    badge: 'No Fee',
    actionCue: 'Save -> Confirmed',
    detail: 'Free events skip payment and assign your official bib number right away.',
    icon: 'free',
  },
];

function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function findFirstVisibleTarget(selector?: string, fallbackSelector?: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const candidates = [selector, fallbackSelector].filter((s): s is string => Boolean(s));
  for (const querySelector of candidates) {
    const nodes = document.querySelectorAll<HTMLElement>(querySelector);
    for (const node of nodes) {
      if (isElementVisible(node)) {
        return node;
      }
    }
  }
  return null;
}

function readViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 390, height: 844 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function GuidingCursor({
  point,
  tapKey,
  reducedMotion,
}: {
  point: CursorPoint;
  tapKey: string;
  reducedMotion: boolean;
}) {
  return (
    <m.div
      data-testid="android-guide-cursor"
      aria-hidden="true"
      className="fixed top-0 left-0 z-[74] pointer-events-none"
      initial={false}
      animate={{
        x: point.x,
        y: point.y,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : {
              type: 'spring',
              stiffness: 340,
              damping: 28,
              mass: 0.75,
            }
      }
    >
      <div className="relative">
        {!reducedMotion && (
          <m.span
            key={`ripple-a-${tapKey}`}
            className="absolute -left-3.5 -top-3.5 w-7 h-7 rounded-full border-2 border-red-500"
            initial={{ scale: 0.35, opacity: 0 }}
            animate={{
              scale: [0.35, 1.85],
              opacity: [0.85, 0],
            }}
            transition={{
              duration: 0.52,
              delay: 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        )}
        {!reducedMotion && (
          <m.span
            key={`ripple-b-${tapKey}`}
            className="absolute -left-3.5 -top-3.5 w-7 h-7 rounded-full border-2 border-red-500"
            initial={{ scale: 0.35, opacity: 0 }}
            animate={{
              scale: [0.35, 1.85],
              opacity: [0.85, 0],
            }}
            transition={{
              duration: 0.52,
              delay: 0.64,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        )}

        <m.div
          key={`pointer-${tapKey}`}
          initial={reducedMotion ? { scale: 1 } : { scale: 1 }}
          animate={
            reducedMotion
              ? { scale: 1 }
              : { scale: [1, 0.84, 1, 0.84, 1] }
          }
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  duration: 1.05,
                  times: [0, 0.2, 0.45, 0.7, 1],
                  ease: EMIL_EASE,
                }
          }
          style={{ transformOrigin: '2px 2px' }}
          className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M4 3L23 12.5L14.5 15.2L11.2 24L4 3Z"
              fill="#FFFFFF"
              stroke="#141416"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </m.div>
      </div>
    </m.div>
  );
}

export default function AndroidOnboardingGuide({
  open,
  onComplete,
  onStepChange,
}: AndroidOnboardingGuideProps) {
  const titleId = useId();
  const bodyId = useId();
  const prefersReducedMotion = Boolean(useReducedMotion());

  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<RectLike | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>(() => readViewportSize());

  // Mini-stage state for Step 3 (details) and Step 4 (payment)
  const [activeDetailsIdx, setActiveDetailsIdx] = useState(0);
  const [activePaymentIdx, setActivePaymentIdx] = useState(0);
  const [stagePaused, setStagePaused] = useState(false);
  const [stageCursorPoint, setStageCursorPoint] = useState<CursorPoint | null>(null);

  const stageRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const targetElementRef = useRef<HTMLElement | null>(null);

  const currentStep = ANDROID_GUIDE_STEPS[stepIndex] ?? ANDROID_GUIDE_STEPS[0];
  const isLastStep = stepIndex === ANDROID_GUIDE_STEPS.length - 1;

  // Reset step state and focus primary action whenever opened fresh
  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setActiveDetailsIdx(0);
    setActivePaymentIdx(0);
    setStagePaused(false);
    setStageCursorPoint(null);
    const rafId = window.requestAnimationFrame(() => {
      primaryBtnRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [open]);

  // Notify parent when active step changes so underlying UI navigates into position
  useEffect(() => {
    if (!open) return;
    onStepChange(currentStep.id);
  }, [open, currentStep.id, onStepChange]);

  const handleBack = useCallback(() => {
    setStepIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const handleNext = useCallback(() => {
    if (stepIndex >= ANDROID_GUIDE_STEPS.length - 1) {
      onComplete('finish');
      return;
    }
    setStepIndex((idx) => Math.min(ANDROID_GUIDE_STEPS.length - 1, idx + 1));
  }, [stepIndex, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete('skip');
  }, [onComplete]);

  useAndroidBackHandler(open, () => {
    if (stepIndex > 0) {
      handleBack();
    } else {
      handleSkip();
    }
    return true;
  });

  // Keyboard support inside dialog
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleSkip();
      } else if (event.key === 'ArrowRight' && document.activeElement?.tagName !== 'BUTTON') {
        event.preventDefault();
        handleNext();
      } else if (event.key === 'ArrowLeft' && document.activeElement?.tagName !== 'BUTTON' && stepIndex > 0) {
        event.preventDefault();
        handleBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, stepIndex, handleBack, handleNext, handleSkip]);

  // Reset mini-stage auto-walk whenever entering step 3 or step 4
  useEffect(() => {
    if (!open) return;
    if (currentStep.id === 'details') {
      setActiveDetailsIdx(0);
      setStagePaused(false);
    } else if (currentStep.id === 'payment') {
      setActivePaymentIdx(0);
      setStagePaused(false);
    }
  }, [open, currentStep.id]);

  // Choreographed one-pass cursor walk across the 3 rows in Step 3 / Step 4
  useEffect(() => {
    if (!open || prefersReducedMotion || stagePaused) return;
    if (currentStep.id !== 'details' && currentStep.id !== 'payment') return;

    const currentIdx = currentStep.id === 'details' ? activeDetailsIdx : activePaymentIdx;
    if (currentIdx >= 2) return;

    const timer = window.setTimeout(() => {
      if (currentStep.id === 'details') {
        setActiveDetailsIdx((prev) => Math.min(2, prev + 1));
      } else {
        setActivePaymentIdx((prev) => Math.min(2, prev + 1));
      }
    }, 1350);

    return () => window.clearTimeout(timer);
  }, [open, currentStep.id, activeDetailsIdx, activePaymentIdx, prefersReducedMotion, stagePaused]);

  // Measure live DOM spotlight target for spotlight steps
  useLayoutEffect(() => {
    if (!open || currentStep.mode !== 'spotlight') {
      targetElementRef.current = null;
      setTargetRect(null);
      return;
    }

    let rafId = 0;
    let settleTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let scrolledTarget: HTMLElement | null = null;

    const measure = (allowScrollIntoView: boolean) => {
      const vp = readViewportSize();
      setViewport(vp);

      const el = findFirstVisibleTarget(currentStep.targetSelector, currentStep.fallbackSelector);
      targetElementRef.current = el;

      if (!el) {
        setTargetRect(null);
        return;
      }

      const rect = el.getBoundingClientRect();
      if (allowScrollIntoView && scrolledTarget !== el) {
        const outOfView =
          rect.top < 8 ||
          rect.bottom > vp.height - 8 ||
          rect.left < 0 ||
          rect.right > vp.width;
        if (outOfView) {
          scrolledTarget = el;
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
          });
        }
      }

      const freshRect = el.getBoundingClientRect();
      setTargetRect({
        left: freshRect.left,
        top: freshRect.top,
        width: freshRect.width,
        height: freshRect.height,
      });

      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver.observe(el);
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => measure(false));
    }

    measure(true);
    rafId = window.requestAnimationFrame(() => measure(true));
    // Re-measure after AnimatedTabView (160ms) finishes settling
    settleTimer = window.setTimeout(() => measure(true), 210);

    const onViewportChange = () => measure(false);
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('orientationchange', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, currentStep.id, currentStep.mode, currentStep.targetSelector, currentStep.fallbackSelector, prefersReducedMotion]);

  // Allow tapping the real spotlighted button to advance naturally on Explore, Register, and You
  useEffect(() => {
    if (!open || currentStep.mode !== 'spotlight') return;
    const el = targetElementRef.current;
    if (!el) return;

    const onTargetClick = () => {
      if (currentStep.id === 'explore' || currentStep.id === 'register') {
        window.setTimeout(() => {
          setStepIndex((idx) => (idx < ANDROID_GUIDE_STEPS.length - 1 ? idx + 1 : idx));
        }, 120);
      } else if (currentStep.id === 'passes') {
        onComplete('finish');
      }
    };

    el.addEventListener('click', onTargetClick, { once: true });
    return () => el.removeEventListener('click', onTargetClick);
  }, [open, currentStep.id, currentStep.mode, targetRect, onComplete]);

  // Measure the active interactive mini-stage row inside Step 3 / Step 4 so the guiding cursor points right at it
  useLayoutEffect(() => {
    if (!open || currentStep.mode !== 'stage') {
      setStageCursorPoint(null);
      return;
    }
    const activeIdx = currentStep.id === 'details' ? activeDetailsIdx : activePaymentIdx;
    const updateStageCursor = () => {
      const rowEl = stageRowRefs.current[activeIdx];
      if (!rowEl) {
        setStageCursorPoint(null);
        return;
      }
      const rect = rowEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setStageCursorPoint(null);
        return;
      }
      setStageCursorPoint({
        x: Math.round(rect.left + rect.width * 0.78),
        y: Math.round(rect.top + Math.min(26, rect.height * 0.5)),
      });
    };

    updateStageCursor();
    const rafId = window.requestAnimationFrame(updateStageCursor);
    const settleTimer = window.setTimeout(updateStageCursor, 210);
    window.addEventListener('resize', updateStageCursor, { passive: true });
    window.addEventListener('scroll', updateStageCursor, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updateStageCursor);
      window.removeEventListener('scroll', updateStageCursor, true);
    };
  }, [open, currentStep.id, currentStep.mode, activeDetailsIdx, activePaymentIdx]);

  const placement = useMemo(
    () =>
      currentStep.mode === 'spotlight'
        ? computeSpotlightPlacement(targetRect, viewport)
        : { cardPlacement: 'center' as const, spotlightBox: null, cursorPoint: null },
    [currentStep.mode, targetRect, viewport],
  );

  const activeCursorPoint = currentStep.mode === 'spotlight' ? placement.cursorPoint : stageCursorPoint;
  const activeTapKey =
    currentStep.id === 'details'
      ? `details-${activeDetailsIdx}`
      : currentStep.id === 'payment'
        ? `payment-${activePaymentIdx}`
        : `${currentStep.id}-${Boolean(placement.cursorPoint)}`;

  const cardDockClass = useMemo(() => {
    if (placement.cardPlacement === 'top') {
      return 'top-[max(0.75rem,var(--rp-safe-top))] left-1/2 -translate-x-1/2';
    }
    if (placement.cardPlacement === 'bottom') {
      return 'bottom-[max(0.75rem,var(--rp-safe-bottom))] left-1/2 -translate-x-1/2';
    }
    return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
  }, [placement.cardPlacement]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const box = placement.spotlightBox;

  return createPortal(
    <div
      data-testid="android-onboarding-guide"
      className="fixed inset-0 z-[70] pointer-events-none"
    >
      {/* 4-panel dark backdrop cutout around the real target so it stays crisp and tappable */}
      {box ? (
        <>
          <div
            aria-hidden="true"
            onClick={handleSkip}
            className="fixed left-0 right-0 top-0 bg-black/72 pointer-events-auto"
            style={{ height: `${box.top}px` }}
          />
          <div
            aria-hidden="true"
            onClick={handleSkip}
            className="fixed left-0 bg-black/72 pointer-events-auto"
            style={{
              top: `${box.top}px`,
              width: `${box.left}px`,
              height: `${box.height}px`,
            }}
          />
          <div
            aria-hidden="true"
            onClick={handleSkip}
            className="fixed right-0 bg-black/72 pointer-events-auto"
            style={{
              top: `${box.top}px`,
              left: `${box.left + box.width}px`,
              height: `${box.height}px`,
            }}
          />
          <div
            aria-hidden="true"
            onClick={handleSkip}
            className="fixed left-0 right-0 bottom-0 bg-black/72 pointer-events-auto"
            style={{ top: `${box.top + box.height}px` }}
          />
          <m.div
            data-testid="android-guide-spotlight"
            aria-hidden="true"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: EMIL_EASE }}
            className="fixed rounded-2xl border-2 border-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.22)] pointer-events-none"
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          onClick={handleSkip}
          className="fixed inset-0 bg-black/72 pointer-events-auto"
        />
      )}

      {/* Main Guide Card */}
      <m.section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: EMIL_EASE }}
        className={`fixed ${cardDockClass} z-[72] pointer-events-auto w-[min(24rem,calc(100vw-1.5rem-var(--rp-safe-left)-var(--rp-safe-right)))] max-h-[calc(100dvh-1.5rem-var(--rp-safe-top)-var(--rp-safe-bottom))] overflow-y-auto overscroll-y-contain rounded-2xl border border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] p-4 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.45)] space-y-3`}
      >
        {/* Top progress + skip */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ol className="flex items-center gap-1" aria-label="Guide steps">
              {ANDROID_GUIDE_STEPS.map((s, idx) => {
                const done = idx < stepIndex;
                const current = idx === stepIndex;
                return (
                  <li
                    key={s.id}
                    aria-current={current ? 'step' : undefined}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      current
                        ? 'w-5 bg-red-600 dark:bg-red-500'
                        : done
                          ? 'w-2.5 bg-emerald-600 dark:bg-emerald-400'
                          : 'w-2 bg-[var(--border-default)]'
                    }`}
                  />
                );
              })}
            </ol>
            <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
              {currentStep.stepNumber}/{ANDROID_GUIDE_STEPS.length}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip race guide"
            className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Skip</span>
          </button>
        </div>

        {/* Title & straightforward copy */}
        <div className="space-y-1">
          <h2
            id={titleId}
            className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)] leading-snug"
          >
            {currentStep.title}
          </h2>
          <p
            id={bodyId}
            className="text-xs sm:text-sm font-normal text-[var(--text-secondary)] leading-relaxed"
          >
            {currentStep.body}
          </p>
        </div>

        {/* Interactive Mini-Stage for Step 3: Registration Form Details */}
        {currentStep.id === 'details' && (
          <div
            role="group"
            aria-label="Registration form steps preview"
            className="space-y-2 pt-1"
          >
            {DETAILS_PREVIEW_ITEMS.map((item, idx) => {
              const active = activeDetailsIdx === idx;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    stageRowRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => {
                    setStagePaused(true);
                    setActiveDetailsIdx(idx);
                  }}
                  aria-pressed={active}
                  className={`w-full min-h-11 rounded-xl border px-3 py-2 text-left flex items-center justify-between gap-2.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    active
                      ? 'border-red-600 bg-red-600/10 text-[var(--text-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {idx === 2 ? (
                      <ShieldCheck
                        className={`w-4 h-4 shrink-0 mt-0.5 ${active ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <ClipboardList
                        className={`w-4 h-4 shrink-0 mt-0.5 ${active ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'}`}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--text-primary)] truncate">
                        {idx + 1}. {item.title}
                      </span>
                      <span className="block text-xs text-[var(--text-secondary)] leading-snug">
                        {item.summary}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-md font-mono text-xs font-semibold border ${
                      active
                        ? 'border-red-600/40 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {item.badge}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Interactive Mini-Stage for Step 4: Payment Methods */}
        {currentStep.id === 'payment' && (
          <div
            role="group"
            aria-label="Race payment options preview"
            className="space-y-2 pt-1"
          >
            {PAYMENT_PREVIEW_ITEMS.map((item, idx) => {
              const active = activePaymentIdx === idx;
              const Icon =
                item.icon === 'online'
                  ? CreditCard
                  : item.icon === 'manual'
                    ? Landmark
                    : CheckCircle2;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    stageRowRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => {
                    setStagePaused(true);
                    setActivePaymentIdx(idx);
                  }}
                  aria-pressed={active}
                  className={`w-full min-h-11 rounded-xl border px-3 py-2 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    active
                      ? 'border-red-600 bg-red-600/10'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-[var(--border-control)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {item.title}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-md font-mono text-xs font-semibold ${
                        active
                          ? 'bg-red-700 text-white'
                          : 'bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {item.actionCue}
                    </span>
                  </div>
                  <AnimatePresence initial={false}>
                    {active && (
                      <m.p
                        initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.16, ease: EMIL_EASE }}
                        className="mt-1.5 text-xs text-[var(--text-secondary)] leading-relaxed overflow-hidden"
                      >
                        {item.detail}
                      </m.p>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 5 compact pass reminder */}
        {currentStep.id === 'passes' && (
          <div className="rounded-xl border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2.5 text-xs text-[var(--text-primary)]">
            <Ticket className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Look for My Passes inside You to open your Bib # and QR check-in pass.</span>
          </div>
        )}

        {/* Navigation footer */}
        <div className="flex items-center gap-2 pt-1">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back</span>
            </button>
          )}
          <button
            ref={primaryBtnRef}
            type="button"
            onClick={handleNext}
            className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            <span>{currentStep.actionLabel || (isLastStep ? 'Finish' : 'Next')}</span>
            {isLastStep ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
          </button>
        </div>
      </m.section>

      {/* Guiding animated cursor with arrival double-tap ripple */}
      {activeCursorPoint && (
        <GuidingCursor
          point={activeCursorPoint}
          tapKey={activeTapKey}
          reducedMotion={prefersReducedMotion}
        />
      )}
    </div>,
    document.body,
  );
}
