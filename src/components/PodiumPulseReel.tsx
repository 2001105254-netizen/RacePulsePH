import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/highlights.css';
import { Award, Pause, Play, RefreshCw } from 'lucide-react';
import {
  applyPlaylistRules,
  DEFAULT_MARQUEE_CONFIG,
  subscribeHighlightsConfig,
  subscribeRunnerHighlights,
} from '../lib/highlights';
import { HighlightsMarqueeConfig, RunnerHighlight } from '../types';
import PodiumPulseCard from './PodiumPulseCard';
import FinisherDossierModal from './FinisherDossierModal';

interface PodiumPulseReelProps {
  searchFocused?: boolean;
  onViewLeaderboard?: (raceId?: string) => void;
  overrideHighlights?: RunnerHighlight[];
  overrideConfig?: HighlightsMarqueeConfig;
  instanceId?: string;
  staticCompanion?: React.ReactNode;
}

type ReelSlot =
  { kind: 'highlight'; item: RunnerHighlight; slotKey: string; index: number };

export default function PodiumPulseReel({
  searchFocused = false,
  onViewLeaderboard,
  overrideHighlights,
  overrideConfig,
  instanceId,
  staticCompanion,
}: PodiumPulseReelProps) {
  const [subscribedHighlights, setSubscribedHighlights] = useState<RunnerHighlight[]>([]);
  const [subscribedLoaded, setSubscribedLoaded] = useState(false);
  const [subscribedLoadError, setSubscribedLoadError] = useState<string | null>(null);
  const [subscribedConfig, setSubscribedConfig] = useState<HighlightsMarqueeConfig>(DEFAULT_MARQUEE_CONFIG);
  const [retryToken, setRetryToken] = useState(0);

  const hasOverrideHighlights = overrideHighlights !== undefined;
  const hasOverrideConfig = overrideConfig !== undefined;
  const rawHighlights = overrideHighlights ?? subscribedHighlights;
  const loaded = hasOverrideHighlights ? true : subscribedLoaded;
  const loadError = hasOverrideHighlights ? null : subscribedLoadError;
  const config = overrideConfig ?? subscribedConfig;
  const headingId = instanceId ? `podium-highlights-heading-${instanceId}` : 'podium-highlights-heading';

  const [manualPaused, setManualPaused] = useState(false);
  const [spotlightKey, setSpotlightKey] = useState<string | null>(null);
  const [selectedHighlight, setSelectedHighlight] = useState<RunnerHighlight | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  const sectionRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const offsetRef = useRef(0);
  const velocityRef = useRef(0);
  const rafIdRef = useRef(0);
  const lastTimeRef = useRef(0);
  const isInViewportRef = useRef(true);
  const isPageVisibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const isContentSkippedRef = useRef(false);

  const configRef = useRef(config);
  configRef.current = config;

  const stateRef = useRef({
    manualPaused: false,
    spotlightKey: null as string | null,
    searchFocused: false,
    modalOpen: false,
    reducedMotion: false,
    setWidth: 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 0) setViewportWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    const unsubHighlights = hasOverrideHighlights
      ? () => {}
      : (() => {
          setSubscribedLoadError(null);
          return subscribeRunnerHighlights((items, isLoaded, err) => {
            if (err) {
              setSubscribedLoadError(err);
              setSubscribedLoaded(true);
              return;
            }
            setSubscribedHighlights(items);
            if (isLoaded) setSubscribedLoaded(true);
          });
        })();

    const unsubConfig = hasOverrideConfig
      ? () => {}
      : subscribeHighlightsConfig((cfg) => {
          setSubscribedConfig(cfg);
        });

    return () => {
      unsubHighlights();
      unsubConfig();
    };
  }, [retryToken, hasOverrideHighlights, hasOverrideConfig]);

  const highlights = useMemo(
    () => applyPlaylistRules(rawHighlights, config),
    [rawHighlights, config],
  );

  const unitWidth = (config.layoutMode === 'pill' ? 376 : 276) + config.cardGapPx;
  const minSlots = Math.max(5, Math.ceil((Math.max(viewportWidth, 1280) + unitWidth) / unitWidth));
  const needsMarquee = highlights.length >= minSlots;

  const setASlots = useMemo<ReelSlot[]>(() => {
    if (!needsMarquee) return [];
    return highlights.map((item, idx) => ({
      kind: 'highlight',
      item,
      slotKey: `hl_${item.id}_${idx}`,
      index: idx,
    }));
  }, [highlights, needsMarquee]);

  const setWidth = setASlots.length * unitWidth;
  stateRef.current = {
    manualPaused,
    spotlightKey,
    searchFocused,
    modalOpen: Boolean(selectedHighlight),
    reducedMotion,
    setWidth,
  };

  // Reset offset safely when published card count, slot count, or layout mode changes
  useEffect(() => {
    offsetRef.current = 0;
    if (trackRef.current) {
      trackRef.current.style.transform = 'translate3d(0px, 0, 0)';
    }
  }, [highlights.length, config.layoutMode, setASlots.length]);

  const startTickerRef = useRef<() => void>(() => {});

  // Sub-1ms rAF marquee loop: pauses automatically when off-screen, hidden tab, reduced motion, or stopped on hover.
  useEffect(() => {
    if (setASlots.length === 0) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      velocityRef.current = 0;
      return;
    }

    const computeTargetVelocity = () => {
      const s = stateRef.current;
      const cfg = configRef.current;
      if (
        !isInViewportRef.current ||
        !isPageVisibleRef.current ||
        isContentSkippedRef.current ||
        s.reducedMotion ||
        s.manualPaused ||
        s.modalOpen
      ) {
        return 0;
      }
      let multiplier = 1;
      if (s.spotlightKey) {
        if (cfg.hoverBehavior === 'stop') return 0;
        multiplier = cfg.hoverBehavior === 'slow' ? 0.2 : 1;
      } else if (s.searchFocused) {
        // State A Search Focus Ambient Mode (25% speed)
        multiplier = 0.25;
      }
      const dirSign = cfg.direction === 'right' ? 1 : -1;
      return cfg.speedPxPerSec * multiplier * dirSign;
    };

    const step = (now: number) => {
      rafIdRef.current = 0;
      if (
        !isInViewportRef.current ||
        !isPageVisibleRef.current ||
        isContentSkippedRef.current ||
        stateRef.current.reducedMotion
      ) {
        velocityRef.current = 0;
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;

      const targetVelocity = computeTargetVelocity();
      const lerpAlpha = Math.min(1, dt * 6.5);
      velocityRef.current += (targetVelocity - velocityRef.current) * lerpAlpha;
      if (targetVelocity === 0 && Math.abs(velocityRef.current) < 0.08) {
        velocityRef.current = 0;
      }

      const activeSetWidth = stateRef.current.setWidth;
      if (activeSetWidth > 0 && velocityRef.current !== 0) {
        const nextOffset = (((offsetRef.current + velocityRef.current * dt) % activeSetWidth) - activeSetWidth) % activeSetWidth;
        offsetRef.current = nextOffset;
        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(${nextOffset.toFixed(2)}px, 0, 0)`;
        }
      }

      if (targetVelocity !== 0 || velocityRef.current !== 0) {
        rafIdRef.current = requestAnimationFrame(step);
      }
    };

    const ensureLoopRunning = () => {
      if (rafIdRef.current) return;
      const targetVelocity = computeTargetVelocity();
      if (targetVelocity !== 0 || velocityRef.current !== 0) {
        lastTimeRef.current = performance.now();
        rafIdRef.current = requestAnimationFrame(step);
      }
    };

    startTickerRef.current = ensureLoopRunning;
    ensureLoopRunning();

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, [setASlots.length]);

  // Wake marquee when interaction or speed controls change while preserving continuity.
  useEffect(() => {
    startTickerRef.current();
  }, [
    manualPaused,
    spotlightKey,
    searchFocused,
    selectedHighlight,
    reducedMotion,
    config.speedPxPerSec,
    config.hoverBehavior,
    config.direction,
    config.layoutMode,
    config.cardGapPx,
  ]);

  // Pause background rAF completely when off-screen, tab-hidden, or skipped by content-visibility.
  useEffect(() => {
    const vpEl = viewportRef.current;
    const secEl = sectionRef.current;

    const io =
      vpEl && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([entry]) => {
              isInViewportRef.current = Boolean(entry?.isIntersecting);
              if (isInViewportRef.current) startTickerRef.current();
            },
            { rootMargin: '120px' },
          )
        : null;
    if (vpEl && io) io.observe(vpEl);

    const onVisibility = () => {
      isPageVisibleRef.current = document.visibilityState === 'visible';
      if (isPageVisibleRef.current) startTickerRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onContentVisibility = (e: Event) => {
      const skipped = Boolean((e as Event & { skipped?: boolean }).skipped);
      isContentSkippedRef.current = skipped;
      if (!skipped) startTickerRef.current();
    };
    secEl?.addEventListener('contentvisibilityautostatechange', onContentVisibility);

    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      secEl?.removeEventListener('contentvisibilityautostatechange', onContentVisibility);
    };
  }, [loaded, setASlots.length]);

  const handleSpotlightEnter = useCallback((key: string) => {
    setSpotlightKey(key);
  }, []);

  const handleSpotlightLeave = useCallback(() => {
    setSpotlightKey(null);
  }, []);

  const handleSelectHighlight = useCallback((hl: RunnerHighlight) => {
    setSelectedHighlight(hl);
  }, []);

  return (
    <section
      ref={sectionRef}
      id={instanceId ? `podium-highlights-${instanceId}` : 'podium-highlights'}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`pp-reel-stage scroll-mt-[84px] space-y-3 ${spotlightKey ? 'has-spotlight' : ''} ${searchFocused ? 'is-search-dimmed' : ''}`}
      data-testid="podium-pulse-reel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Award className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <h2 id={headingId} className="type-section text-[var(--text-primary)] truncate">
            Podium highlights
          </h2>
          {loaded && highlights.length > 0 && (
            <span className="font-mono text-xs text-[var(--text-secondary)] shrink-0">
              {highlights.length} featured
            </span>
          )}
        </div>

        {needsMarquee && (
          <div className="flex items-center gap-2 shrink-0">
            {searchFocused && (
              <span className="hidden sm:inline font-mono text-xs text-[var(--text-secondary)]">
                Ambient mode
              </span>
            )}
            <button
              type="button"
              onClick={() => setManualPaused((prev) => !prev)}
              aria-label={manualPaused ? 'Play runner highlights marquee' : 'Pause runner highlights marquee'}
              className="min-h-11 px-3.5 py-2 rounded-full border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-mono font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition"
            >
              {manualPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Pause</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {!loaded ? (
        <div
          className={`rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex items-center gap-4 overflow-hidden ${
            config.layoutMode === 'pill' ? 'h-[156px]' : 'h-[356px]'
          }`}
          aria-busy="true"
          aria-label="Loading runner highlights"
        >
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              className={`shrink-0 rounded-2xl bg-[var(--surface-inset)] animate-pulse ${
                config.layoutMode === 'pill' ? 'w-[360px] h-[124px]' : 'w-[260px] h-[324px]'
              }`}
            />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Unable to load podium highlights right now.
          </p>
          <button
            type="button"
            onClick={() => {
              setSubscribedLoaded(false);
              setRetryToken((n) => n + 1);
            }}
            className="min-h-11 px-4 py-2 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      ) : highlights.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-sm text-[var(--text-secondary)]">
            No runner highlights published yet. Featured finishers and podium performances posted by race administrators will stream here.
          </p>
        </div>
      ) : !needsMarquee ? (
        <div
          className={
            staticCompanion
              ? 'landing-podium-shelf py-2'
              : 'flex flex-wrap items-stretch justify-start gap-4 sm:gap-5 py-2'
          }
          data-testid="podium-static-shelf"
        >
          <div className={staticCompanion ? 'landing-podium-cards' : 'contents'}>
            {highlights.map((item, idx) => {
              const slotKey = `st_${item.id}_${idx}`;
              return (
                <PodiumPulseCard
                  key={slotKey}
                  slotKey={slotKey}
                  highlight={item}
                  layoutMode={config.layoutMode}
                  isSpotlight={spotlightKey === slotKey}
                  holoHue={195 + ((idx * 47) % 140)}
                  staggerIndex={Math.min(idx, 7)}
                  animateEntrance
                  onSpotlightEnter={handleSpotlightEnter}
                  onSpotlightLeave={handleSpotlightLeave}
                  onSelect={handleSelectHighlight}
                />
              );
            })}
          </div>
          {staticCompanion}
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="pp-reel-viewport pp-track-reveal"
          style={
            {
              '--edge-fade': `${config.edgeFadePx}px`,
              '--card-gap': `${config.cardGapPx}px`,
            } as React.CSSProperties
          }
        >
          <div ref={trackRef} className="pp-reel-track">
            {/* Primary Set A */}
            <div className="pp-reel-group" data-testid="podium-reel-set-a">
              {setASlots.map((slot) => (
                <PodiumPulseCard
                  key={`a_${slot.slotKey}`}
                  slotKey={`a_${slot.slotKey}`}
                  highlight={slot.item}
                  layoutMode={config.layoutMode}
                  isSpotlight={spotlightKey === `a_${slot.slotKey}`}
                  holoHue={195 + ((slot.index * 47) % 140)}
                  staggerIndex={Math.min(slot.index, 7)}
                  animateEntrance
                  onSpotlightEnter={handleSpotlightEnter}
                  onSpotlightLeave={handleSpotlightLeave}
                  onSelect={handleSelectHighlight}
                />
              ))}
            </div>

            {/* Duplicate Set B for zero-seam infinite wrap (off-screen behind Set A) */}
            <div className="pp-reel-group" aria-hidden="true" data-testid="podium-reel-set-b">
              {setASlots.map((slot) => (
                <PodiumPulseCard
                  key={`b_${slot.slotKey}`}
                  slotKey={`b_${slot.slotKey}`}
                  highlight={slot.item}
                  layoutMode={config.layoutMode}
                  isCloneSlot
                  isSpotlight={spotlightKey === `b_${slot.slotKey}`}
                  holoHue={195 + ((slot.index * 47) % 140)}
                  onSpotlightEnter={handleSpotlightEnter}
                  onSpotlightLeave={handleSpotlightLeave}
                  onSelect={handleSelectHighlight}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedHighlight && (
        <FinisherDossierModal
          highlight={selectedHighlight}
          onClose={() => setSelectedHighlight(null)}
          onViewLeaderboard={(raceId) => onViewLeaderboard?.(raceId)}
        />
      )}
    </section>
  );
}
