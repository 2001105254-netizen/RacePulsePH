import React, { useEffect, useMemo, useRef, useState } from 'react';
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
}

export default function PodiumPulseReel({
  searchFocused = false,
  onViewLeaderboard,
  overrideHighlights,
  overrideConfig,
  instanceId,
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
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [selectedHighlight, setSelectedHighlight] = useState<RunnerHighlight | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const setARef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const offsetRef = useRef(0);
  const velocityRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const stateRef = useRef({
    manualPaused: false,
    spotlightId: null as string | null,
    searchFocused: false,
    modalOpen: false,
    reducedMotion: false,
    viewportWidth: 1280,
  });
  stateRef.current = {
    manualPaused,
    spotlightId,
    searchFocused,
    modalOpen: Boolean(selectedHighlight),
    reducedMotion,
    viewportWidth,
  };

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

  // Repeat items enough times inside Set A so Set A always exceeds the viewport width.
  const unitWidth = (config.layoutMode === 'pill' ? 376 : 276) + config.cardGapPx;
  const repeatCount = useMemo(() => {
    if (highlights.length === 0) return 1;
    const oneSetWidth = highlights.length * unitWidth;
    return Math.max(1, Math.ceil((Math.max(viewportWidth, 1280) + 320) / oneSetWidth));
  }, [highlights.length, unitWidth, viewportWidth]);

  const repeatedItems = useMemo(() => {
    if (highlights.length === 0) return [];
    const list: Array<{ item: RunnerHighlight; key: string; index: number }> = [];
    for (let r = 0; r < repeatCount; r += 1) {
      for (let i = 0; i < highlights.length; i += 1) {
        list.push({
          item: highlights[i],
          key: `r${r}_${highlights[i].id}_${i}`,
          index: r * highlights.length + i,
        });
      }
    }
    return list;
  }, [highlights, repeatCount]);

  // Reset offset safely when card count or layout mode changes
  useEffect(() => {
    offsetRef.current = 0;
    if (trackRef.current) {
      trackRef.current.style.transform = 'translate3d(0px, 0, 0)';
    }
  }, [highlights.length, config.layoutMode, repeatCount]);

  // State B: RequestAnimationFrame velocity-interpolated marquee loop
  useEffect(() => {
    if (repeatedItems.length === 0) return;

    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const { manualPaused: paused, spotlightId: spot, searchFocused: focused, modalOpen, reducedMotion: rm, viewportWidth: vw } =
        stateRef.current;
      const cfg = configRef.current;
      const setWidth = setARef.current?.offsetWidth || repeatedItems.length * ((cfg.layoutMode === 'pill' ? 376 : 276) + cfg.cardGapPx);

      let multiplier = 1;
      if (paused || rm || modalOpen) {
        multiplier = 0;
      } else if (spot) {
        if (cfg.hoverBehavior === 'stop') multiplier = 0;
        else if (cfg.hoverBehavior === 'slow') multiplier = 0.2;
        else multiplier = 1;
      } else if (focused) {
        // State A Search Focus Ambient Low-Power Mode (25% speed)
        multiplier = 0.25;
      }

      const dirSign = cfg.direction === 'right' ? 1 : -1;
      const targetVelocity = cfg.speedPxPerSec * multiplier * dirSign;

      // Flywheel inertia interpolation
      const lerpAlpha = Math.min(1, dt * 6.5);
      velocityRef.current += (targetVelocity - velocityRef.current) * lerpAlpha;
      if (Math.abs(velocityRef.current) < 0.08 && targetVelocity === 0) {
        velocityRef.current = 0;
      }

      if (setWidth > 0) {
        let nextOffset = offsetRef.current + velocityRef.current * dt;
        // Wrap seamlessly around [-setWidth, 0]
        nextOffset = ((nextOffset % setWidth) - setWidth) % setWidth;
        offsetRef.current = nextOffset;

        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(${nextOffset.toFixed(2)}px, 0, 0)`;
        }

        // Dynamic position-driven Prismatic Holo-Foil hue shift (no layout reads!)
        const slotSpan = (cfg.layoutMode === 'pill' ? 376 : 276) + cfg.cardGapPx;
        const viewSpan = Math.max(vw, 640);
        cardRefs.current.forEach((btn, key) => {
          const idxStr = key.split('::')[1];
          const idx = Number(idxStr);
          if (Number.isNaN(idx)) return;
          const xInTrack = idx * slotSpan + nextOffset + slotSpan * 0.5;
          const ratio = Math.max(0, Math.min(1, xInTrack / viewSpan));
          // Left (~cyan/violet 200deg) -> Center (~gold/magenta 315deg) -> Right (~cyan 185deg)
          const hue = 190 + ratio * 155;
          btn.style.setProperty('--holo-hue', `${Math.round(hue)}deg`);
        });
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [repeatedItems.length]);

  const registerCardRef = (refKey: string) => (el: HTMLButtonElement | null) => {
    if (el) {
      cardRefs.current.set(refKey, el);
    } else {
      cardRefs.current.delete(refKey);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={`pp-reel-stage space-y-3 ${spotlightId ? 'has-spotlight' : ''} ${searchFocused ? 'is-search-dimmed' : ''}`}
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

        {highlights.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            {searchFocused && (
              <span className="hidden sm:inline font-mono text-xs text-[var(--text-secondary)]">
                Ambient mode
              </span>
            )}
            <button
              type="button"
              onClick={() => setManualPaused((prev) => !prev)}
              aria-pressed={manualPaused}
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
            <div ref={setARef} className="pp-reel-group">
              {repeatedItems.map(({ item, key, index }) => (
                <PodiumPulseCard
                  key={`a_${key}`}
                  highlight={item}
                  layoutMode={config.layoutMode}
                  isSpotlight={spotlightId === item.id}
                  staggerIndex={Math.min(index, 7)}
                  animateEntrance
                  onSpotlightEnter={(id) => setSpotlightId(id)}
                  onSpotlightLeave={() => setSpotlightId(null)}
                  onSelect={(hl) => setSelectedHighlight(hl)}
                  registerShellRef={registerCardRef(`a_${key}::${index}`)}
                />
              ))}
            </div>

            {/* Duplicate Set B for zero-seam infinite wrap */}
            <div className="pp-reel-group" aria-hidden="true">
              {repeatedItems.map(({ item, key, index }) => (
                <PodiumPulseCard
                  key={`b_${key}`}
                  highlight={item}
                  layoutMode={config.layoutMode}
                  isSpotlight={spotlightId === item.id}
                  onSpotlightEnter={(id) => setSpotlightId(id)}
                  onSpotlightLeave={() => setSpotlightId(null)}
                  onSelect={(hl) => setSelectedHighlight(hl)}
                  registerShellRef={registerCardRef(`b_${key}::${repeatedItems.length + index}`)}
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
