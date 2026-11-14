import React, { memo, useEffect, useRef } from 'react';
import {
  clampNumber,
  deriveRaceCode,
  formatReadableDate,
  parsePacePulseMs,
  sanitizeHexColor,
} from '../lib/highlights';
import { HighlightCardLayoutMode, RunnerHighlight } from '../types';

interface PodiumPulseCardProps {
  highlight: RunnerHighlight;
  layoutMode: HighlightCardLayoutMode;
  slotKey?: string;
  isSpotlight?: boolean;
  isCloneSlot?: boolean;
  holoHue?: number;
  staggerIndex?: number;
  animateEntrance?: boolean;
  onSpotlightEnter?: (id: string) => void;
  onSpotlightLeave?: () => void;
  onSelect?: (highlight: RunnerHighlight) => void;
}

const PodiumPulseCard = memo(function PodiumPulseCard({
  highlight,
  layoutMode,
  slotKey,
  isSpotlight = false,
  isCloneSlot = false,
  holoHue = 210,
  staggerIndex = 0,
  animateEntrance = false,
  onSpotlightEnter,
  onSpotlightLeave,
  onSelect,
}: PodiumPulseCardProps) {
  const shellRef = useRef<HTMLButtonElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const tiltRafRef = useRef<number>(0);
  const pendingCoordsRef = useRef<{ x: number; y: number } | null>(null);

  const accent = sanitizeHexColor(highlight.accentColor, '#ff3b30');
  const secondaryAccent = sanitizeHexColor(highlight.secondaryAccentColor, accent);
  const glowAlpha = Math.max(0, Math.min(1, (highlight.glowIntensity ?? 72) / 100));
  const borderWidthPx = Math.round(clampNumber(highlight.borderWidthPx ?? 3, 2, 6));
  const scrimAlpha = (clampNumber(highlight.scrimStrength ?? 78, 30, 95) / 100).toFixed(2);
  const pacePulseMs = parsePacePulseMs(highlight.mode === 'duo' ? (highlight.combinedAvgPace || highlight.pace) : highlight.pace);
  const raceCode = highlight.raceCode || deriveRaceCode(highlight.raceName, highlight.raceDate);
  const isDuo = highlight.mode === 'duo';
  const cardEffect = highlight.cardEffect || 'sheen-sweep';
  const headerStyle = highlight.headerStyle || 'crown-bezel';

  const displayName = isDuo && highlight.partnerName
    ? `${highlight.runnerName} & ${highlight.partnerName}`
    : highlight.runnerName;

  const displayBib = isDuo && highlight.partnerBibNumber
    ? `#${highlight.bibNumber} / #${highlight.partnerBibNumber}`
    : `#${highlight.bibNumber}`;

  useEffect(() => {
    return () => {
      if (tiltRafRef.current) {
        cancelAnimationFrame(tiltRafRef.current);
        tiltRafRef.current = 0;
      }
    };
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = shellRef.current;
    if (!el || event.pointerType === 'touch') return;
    pendingCoordsRef.current = { x: event.clientX, y: event.clientY };
    if (tiltRafRef.current) return;

    tiltRafRef.current = requestAnimationFrame(() => {
      tiltRafRef.current = 0;
      const target = shellRef.current;
      const coords = pendingCoordsRef.current;
      if (!target || !coords) return;
      const rect = rectRef.current || (rectRef.current = target.getBoundingClientRect());
      if (!rect.width || !rect.height) return;
      const nx = (coords.x - rect.left) / rect.width - 0.5;
      const ny = (coords.y - rect.top) / rect.height - 0.5;
      const tiltY = (nx * 16).toFixed(2); // max +/-8deg
      const tiltX = (-ny * 16).toFixed(2); // max +/-8deg
      const photoX = (-nx * 12).toFixed(2); // counter-parallax max +/-6px
      const photoY = (-ny * 12).toFixed(2);
      target.style.setProperty('--tilt-x', `${tiltX}deg`);
      target.style.setProperty('--tilt-y', `${tiltY}deg`);
      target.style.setProperty('--photo-px', `${photoX}px`);
      target.style.setProperty('--photo-py', `${photoY}px`);
    });
  };

  const resetPointerTilt = () => {
    rectRef.current = null;
    pendingCoordsRef.current = null;
    if (tiltRafRef.current) {
      cancelAnimationFrame(tiltRafRef.current);
      tiltRafRef.current = 0;
    }
    const el = shellRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--photo-px', '0px');
    el.style.setProperty('--photo-py', '0px');
  };

  const spotlightKey = slotKey || highlight.id;
  const accessibleLabel = `${displayName}, ${highlight.placement}, ${highlight.distance} in ${highlight.chipTime} at ${highlight.raceName}. View finisher dossier.`;

  return (
    <div
      className={`pp-card-slot ${layoutMode === 'pill' ? 'mode-pill' : 'mode-card'} ${animateEntrance ? 'pp-stagger-card' : ''}`}
      style={{ '--stagger-idx': staggerIndex } as React.CSSProperties}
    >
      <button
        ref={shellRef}
        type="button"
        aria-label={accessibleLabel}
        onClick={() => onSelect?.(highlight)}
        onMouseEnter={() => {
          rectRef.current = shellRef.current?.getBoundingClientRect() ?? null;
          onSpotlightEnter?.(spotlightKey);
        }}
        onMouseLeave={() => {
          resetPointerTilt();
          onSpotlightLeave?.();
        }}
        onFocus={() => onSpotlightEnter?.(spotlightKey)}
        onBlur={() => {
          resetPointerTilt();
          onSpotlightLeave?.();
        }}
        onPointerMove={handlePointerMove}
        className={`pp-card-shell pp-preset-${highlight.borderPreset} pp-geometry-${highlight.cornerGeometry} pp-finish-${highlight.surfaceFinish} pp-effect-${cardEffect} pp-header-${headerStyle} ${isCloneSlot ? 'is-clone-slot' : ''} ${isSpotlight ? 'is-spotlight' : ''}`}
        style={{
          '--card-accent': accent,
          '--card-accent-2': secondaryAccent,
          '--glow-alpha': glowAlpha.toFixed(2),
          '--border-w': `${borderWidthPx}px`,
          '--scrim-alpha': scrimAlpha,
          '--pace-pulse-ms': `${pacePulseMs}ms`,
          '--holo-hue': `${Math.round(holoHue)}deg`,
        } as React.CSSProperties}
      >
        <div className="pp-card-frame">
          {highlight.borderPreset === 'cyber-hud' && (
            <>
              <span className="pp-hud-bracket tl" aria-hidden="true" />
              <span className="pp-hud-bracket tr" aria-hidden="true" />
              <span className="pp-hud-bracket bl" aria-hidden="true" />
              <span className="pp-hud-bracket br" aria-hidden="true" />
              <div className="pp-hud-ticker" aria-hidden="true">
                <div className="pp-hud-ticker-track">
                  {`${raceCode} // ${highlight.distance} // ${highlight.chipTime} // ${raceCode} // ${highlight.distance} // ${highlight.chipTime} // `}
                </div>
              </div>
            </>
          )}

          {highlight.borderPreset === 'neon-circuit' && (
            <>
              <span className="pp-circuit-node tl" aria-hidden="true" />
              <span className="pp-circuit-node tr" aria-hidden="true" />
              <span className="pp-circuit-node bl" aria-hidden="true" />
              <span className="pp-circuit-node br" aria-hidden="true" />
            </>
          )}

          <div className={`pp-card-inner ${layoutMode === 'card' ? 'flex flex-col' : ''}`}>
            {/* Crown Bezel Header: Dedicated unobstructed top rail above the runner photo */}
            {layoutMode === 'card' && headerStyle === 'crown-bezel' && (
              <header className="pp-crown-bezel" data-testid="pp-crown-bezel">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold text-white border bg-black/75 truncate max-w-[132px]"
                  style={{ borderColor: accent }}
                >
                  {highlight.placement}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-zinc-100 shrink-0">
                  <span>{isDuo ? 'DUO' : 'SOLO'}</span>
                  <span style={{ color: secondaryAccent }}>{highlight.distance}</span>
                </span>
              </header>
            )}

            <div className={`pp-photo-stage ${layoutMode === 'card' ? 'relative flex-1 min-h-0 overflow-hidden' : 'relative w-full h-full'}`}>
              {/* Photo / Dual Split-Sync Layer */}
              <div className="pp-photo-layer">
                {isDuo ? (
                  <>
                    <div className="pp-duo-left">
                      {highlight.photoUrl ? (
                        <img
                          src={highlight.photoUrl}
                          alt={highlight.runnerName}
                          className="pp-photo-img"
                          decoding="async"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full bg-zinc-800" />
                      )}
                    </div>
                    <div className="pp-duo-right">
                      {highlight.partnerPhotoUrl || highlight.photoUrl ? (
                        <img
                          src={highlight.partnerPhotoUrl || highlight.photoUrl}
                          alt={highlight.partnerName || `${highlight.runnerName} partner`}
                          className="pp-photo-img"
                          decoding="async"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full bg-zinc-900" />
                      )}
                    </div>
                    <div className="pp-duo-slash" aria-hidden="true" />
                  </>
                ) : highlight.photoUrl ? (
                  <img
                    src={highlight.photoUrl}
                    alt={highlight.runnerName}
                    className="pp-photo-img"
                    decoding="async"
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full bg-zinc-900" />
                )}
              </div>

              {/* Contrast Guard, Surface Textures & Compositor Card FX */}
              <div className="pp-contrast-scrim" aria-hidden="true" />
              {highlight.surfaceFinish === 'topo' && <div className="pp-surface-topo" aria-hidden="true" />}
              {highlight.surfaceFinish === 'carbon-weave' && <div className="pp-surface-carbon" aria-hidden="true" />}
              {highlight.surfaceFinish === 'halftone' && <div className="pp-surface-halftone" aria-hidden="true" />}

              {(cardEffect === 'sheen-sweep' || cardEffect === 'prism-glint') && (
                <div className={`pp-holo-sheen ${cardEffect === 'prism-glint' ? 'is-prism' : ''}`} aria-hidden="true" />
              )}
              {cardEffect === 'ember-rise' && (
                <div className="pp-fx-sparks" aria-hidden="true">
                  <span className="pp-fx-spark s1" />
                  <span className="pp-fx-spark s2" />
                  <span className="pp-fx-spark s3" />
                  <span className="pp-fx-spark s4" />
                </div>
              )}
              {cardEffect === 'radar-scan' && <div className="pp-fx-radar" aria-hidden="true" />}
              {cardEffect === 'pulse-aura' && <div className="pp-fx-aura" aria-hidden="true" />}

              {isDuo && layoutMode === 'card' && (
                <span className="pp-sync-badge" aria-hidden="true">
                  SYNC
                </span>
              )}

              {layoutMode === 'card' ? (
                <div className="relative z-10 h-full w-full p-3.5 flex flex-col justify-between">
                  {/* Top Area: only used by Floating Notch mode (Crown Bezel & Bottom Dock keep photo 100% clear) */}
                  {headerStyle === 'floating-notch' ? (
                    <div className="pp-floating-notch-row">
                      <span
                        className="pp-notch-pill px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold text-white border bg-black/80 truncate max-w-[136px]"
                        style={{ borderColor: accent }}
                      >
                        {highlight.placement}
                      </span>
                      <span className="pp-notch-pill px-2 py-0.5 rounded-md text-xs font-mono font-semibold text-white bg-black/80 border border-white/25 shrink-0">
                        {isDuo ? 'DUO' : 'SOLO'} {highlight.distance}
                      </span>
                    </div>
                  ) : (
                    <div aria-hidden="true" />
                  )}

                  {/* Bottom Telemetry Overlay */}
                  <div className="min-w-0">
                    {headerStyle === 'bottom-dock' && (
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold text-white border bg-black/80 truncate max-w-[132px]"
                          style={{ borderColor: accent }}
                        >
                          {highlight.placement}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold text-zinc-100 bg-black/80 border border-white/20 shrink-0">
                          {isDuo ? 'DUO' : 'SOLO'} {highlight.distance}
                        </span>
                      </div>
                    )}

                    {highlight.badgeStamp && (
                      <span
                        className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider text-zinc-950 uppercase truncate max-w-full mb-1"
                        style={{ backgroundColor: accent === '#000000' ? '#f5b731' : '#fde68a' }}
                      >
                        {highlight.badgeStamp}
                      </span>
                    )}

                    <p className="text-xs font-mono text-zinc-200 truncate">
                      {highlight.raceName}
                    </p>
                    <p className="font-display text-lg font-semibold text-white leading-tight truncate mt-0.5">
                      {displayName}
                    </p>

                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs font-mono">
                      <span className="font-semibold text-white truncate">
                        {highlight.chipTime}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-zinc-100 shrink-0">
                        <span className="pp-pulse-dot" aria-hidden="true" />
                        <span>{isDuo && highlight.combinedAvgPace ? highlight.combinedAvgPace : highlight.pace}</span>
                      </span>
                    </div>

                    {/* State C: Secondary Telemetry Drawer */}
                    <div className="pp-secondary-drawer">
                      <div>
                        <div className="pt-2 border-t border-white/20 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono text-zinc-200">
                          {isDuo ? (
                            <>
                              <span className="truncate">
                                S1: <strong className="text-white font-semibold">{highlight.soloSplitTime || highlight.chipTime}</strong>
                              </span>
                              <span className="truncate text-right">
                                S2: <strong className="text-white font-semibold">{highlight.partnerSplitTime || highlight.gunTime || highlight.chipTime}</strong>
                              </span>
                              <span className="truncate">
                                Bibs: <strong className="text-white font-semibold">{displayBib}</strong>
                              </span>
                              <span className="truncate text-right">
                                {highlight.runClub || formatReadableDate(highlight.raceDate)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="truncate">
                                Start: <strong className="text-white font-semibold">{highlight.gunTime || '00:00:00'}</strong>
                              </span>
                              <span className="truncate text-right">
                                Finish: <strong className="text-white font-semibold">{highlight.splitPace || highlight.chipTime}</strong>
                              </span>
                              <span className="truncate">
                                Bib: <strong className="text-white font-semibold">{displayBib}</strong>
                              </span>
                              <span className="truncate text-right">
                                {highlight.runClub || formatReadableDate(highlight.raceDate)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Compact 360x140 Broadcast Pill Mode */
                <div className="relative z-10 h-full w-full p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 pl-[36%] flex flex-col justify-between h-full">
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold text-white bg-black/80 border truncate"
                        style={{ borderColor: accent }}
                      >
                        {highlight.placement}
                      </span>
                      <span className="text-[11px] font-mono font-semibold text-zinc-200 shrink-0">
                        {isDuo ? 'DUO' : 'SOLO'} {highlight.distance}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <p className="font-display text-base font-semibold text-white truncate leading-tight">
                        {displayName}
                      </p>
                      <p className="text-xs font-mono text-zinc-300 truncate">
                        {highlight.raceName}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs font-mono">
                      <span className="font-semibold text-white truncate">
                        {highlight.chipTime}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-zinc-200 shrink-0">
                        <span className="pp-pulse-dot" aria-hidden="true" />
                        <span>{displayBib}</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
});

export default PodiumPulseCard;
