import React, { useRef } from 'react';
import {
  deriveRaceCode,
  formatReadableDate,
  parsePacePulseMs,
  sanitizeHexColor,
} from '../lib/highlights';
import { HighlightCardLayoutMode, RunnerHighlight } from '../types';

interface PodiumPulseCardProps {
  highlight: RunnerHighlight;
  layoutMode: HighlightCardLayoutMode;
  isSpotlight?: boolean;
  holoHue?: number;
  staggerIndex?: number;
  animateEntrance?: boolean;
  onSpotlightEnter?: (id: string) => void;
  onSpotlightLeave?: () => void;
  onSelect?: (highlight: RunnerHighlight) => void;
  registerShellRef?: (el: HTMLButtonElement | null) => void;
}

export default function PodiumPulseCard({
  highlight,
  layoutMode,
  isSpotlight = false,
  holoHue = 210,
  staggerIndex = 0,
  animateEntrance = false,
  onSpotlightEnter,
  onSpotlightLeave,
  onSelect,
  registerShellRef,
}: PodiumPulseCardProps) {
  const shellRef = useRef<HTMLButtonElement | null>(null);
  const accent = sanitizeHexColor(highlight.accentColor, '#ff3b30');
  const glowAlpha = Math.max(0, Math.min(1, (highlight.glowIntensity ?? 72) / 100));
  const pacePulseMs = parsePacePulseMs(highlight.mode === 'duo' ? (highlight.combinedAvgPace || highlight.pace) : highlight.pace);
  const raceCode = highlight.raceCode || deriveRaceCode(highlight.raceName, highlight.raceDate);
  const isDuo = highlight.mode === 'duo';

  const displayName = isDuo && highlight.partnerName
    ? `${highlight.runnerName} & ${highlight.partnerName}`
    : highlight.runnerName;

  const displayBib = isDuo && highlight.partnerBibNumber
    ? `#${highlight.bibNumber} / #${highlight.partnerBibNumber}`
    : `#${highlight.bibNumber}`;

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = shellRef.current;
    if (!el || event.pointerType === 'touch') return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    const tiltY = (nx * 16).toFixed(2); // max +/-8deg
    const tiltX = (-ny * 16).toFixed(2); // max +/-8deg
    const photoX = (-nx * 12).toFixed(2); // counter-parallax max +/-6px
    const photoY = (-ny * 12).toFixed(2);
    el.style.setProperty('--tilt-x', `${tiltX}deg`);
    el.style.setProperty('--tilt-y', `${tiltY}deg`);
    el.style.setProperty('--photo-px', `${photoX}px`);
    el.style.setProperty('--photo-py', `${photoY}px`);
  };

  const resetPointerTilt = () => {
    const el = shellRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--photo-px', '0px');
    el.style.setProperty('--photo-py', '0px');
  };

  const setRefs = (el: HTMLButtonElement | null) => {
    shellRef.current = el;
    registerShellRef?.(el);
  };

  const accessibleLabel = `${displayName}, ${highlight.placement}, ${highlight.distance} in ${highlight.chipTime} at ${highlight.raceName}. View finisher dossier.`;

  return (
    <div
      className={`pp-card-slot ${layoutMode === 'pill' ? 'mode-pill' : 'mode-card'} ${animateEntrance ? 'pp-stagger-card' : ''}`}
      style={{ '--stagger-idx': staggerIndex } as React.CSSProperties}
    >
      <button
        ref={setRefs}
        type="button"
        aria-label={accessibleLabel}
        onClick={() => onSelect?.(highlight)}
        onMouseEnter={() => onSpotlightEnter?.(highlight.id)}
        onMouseLeave={() => {
          resetPointerTilt();
          onSpotlightLeave?.();
        }}
        onFocus={() => onSpotlightEnter?.(highlight.id)}
        onBlur={() => {
          resetPointerTilt();
          onSpotlightLeave?.();
        }}
        onPointerMove={handlePointerMove}
        className={`pp-card-shell pp-preset-${highlight.borderPreset} pp-geometry-${highlight.cornerGeometry} pp-finish-${highlight.surfaceFinish} ${isSpotlight ? 'is-spotlight' : ''}`}
        style={{
          '--card-accent': accent,
          '--glow-alpha': glowAlpha.toFixed(2),
          '--pace-pulse-ms': `${pacePulseMs}ms`,
          '--holo-hue': `${Math.round(holoHue)}deg`,
        } as React.CSSProperties}
      >
        <div className="pp-card-frame">
          {highlight.borderPreset === 'liquid-gold' && (
            <div className="pp-embers" aria-hidden="true">
              <span className="pp-ember" />
              <span className="pp-ember" />
              <span className="pp-ember" />
              <span className="pp-ember" />
              <span className="pp-ember" />
            </div>
          )}

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

          <div className="pp-card-inner">
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
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-zinc-900" />
              )}
            </div>

            {/* Contrast Guard & Finish Layers */}
            <div className="pp-contrast-scrim" aria-hidden="true" />
            {highlight.surfaceFinish === 'topo' && <div className="pp-surface-topo" aria-hidden="true" />}
            <div className="pp-holo-sheen" aria-hidden="true" />

            {isDuo && layoutMode === 'card' && (
              <span className="pp-sync-badge" aria-hidden="true">
                SYNC
              </span>
            )}

            {layoutMode === 'card' ? (
              <div className="relative z-10 h-full w-full p-3.5 flex flex-col justify-between">
                {/* Top Placement & Optional Stamp Row */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-semibold text-white border border-white/25 bg-black/75 truncate max-w-[140px]"
                      style={{ borderColor: accent }}
                    >
                      {highlight.placement}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono font-semibold text-white bg-black/75 border border-white/20 shrink-0">
                      <span>{isDuo ? 'DUO' : 'SOLO'}</span>
                      <span className="text-zinc-300">{highlight.distance}</span>
                    </span>
                  </div>

                  {highlight.badgeStamp && (
                    <span
                      className="inline-block px-2 py-0.5 rounded text-[11px] font-mono font-semibold tracking-wider text-zinc-950 uppercase truncate max-w-full"
                      style={{ backgroundColor: accent === '#000000' ? '#f5b731' : '#fde68a' }}
                    >
                      {highlight.badgeStamp}
                    </span>
                  )}
                </div>

                {/* Bottom Telemetry Overlay */}
                <div className="min-w-0">
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
      </button>
    </div>
  );
}
