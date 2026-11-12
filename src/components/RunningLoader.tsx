import { useEffect, useRef, useState } from 'react';
import runnerSpriteUrl from '../assets/runner-sprite.webp';
import './RunningLoader.css';

export type StartupStage = 'session' | 'profile' | 'access' | 'races' | 'ready' | 'error';
type Phase = 'approach' | 'crossing' | 'leaving' | 'error';
// One full stride: CMU recording 09_01, frames 4 through 92 at 120 Hz.
const STRIDE = 88 / 120 * 1000;
const CROSSING = STRIDE;
const FADE = 180;
const labels: Record<StartupStage, string> = {
  session: 'Checking your session', profile: 'Loading your account',
  access: 'Opening your workspace', races: 'Loading race events',
  ready: 'Ready. Finishing the stride.', error: 'Unable to finish loading',
};

// The recorded poses are rasterized once by the optional authoring tool. One
// composited image replaces sixteen independently repainted SVG limb groups.
function CapturedRunner({ active, artwork, onArtwork }: { active: boolean; artwork: 'pending' | 'ready' | 'error'; onArtwork: (state: 'ready' | 'error') => void }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!active || !image.current || typeof Element.prototype.animate !== 'function') return;
    const animation = image.current.animate(Array.from({ length: 33 }, (_, i) => ({
      offset: i / 32, easing: 'steps(1, end)',
      transform: `translate(${-(i % 8) * 12.5}%, ${-Math.floor((i % 32) / 8) * 25}%)`,
    })), { duration: STRIDE, iterations: Infinity });
    const visibility = () => document.hidden ? animation.pause() : animation.play();
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { animation.cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, [active]);
  return <div className="rp-pose-viewport">
    <img ref={image} className="rp-runner-sprite" src={runnerSpriteUrl} alt="" draggable={false} fetchPriority="high" decoding="async"
      onLoad={() => { void image.current?.decode().then(() => onArtwork('ready'), () => onArtwork('error')); }}
      onError={() => onArtwork('error')} hidden={artwork !== 'ready'} />
    {artwork !== 'ready' && <svg className="rp-runner-fallback" viewBox="0 0 120 160">
      <g fill="none" stroke="#86868b" strokeWidth="5" strokeLinecap="round"><path d="M66 38L55 61L67 72M63 79L64 112L29 111L19 121" /></g>
      <g fill="none" stroke="#f5f5f7" strokeWidth="6" strokeLinecap="round"><path d="M69 28L67 45M65 40L57 63L73 64M62 79L75 111L63 143L77 147" /></g>
      <path d="M67 44L60 72" stroke="#ff3b30" strokeWidth="15" />
      <path d="M60 72L62 80" stroke="#52525b" strokeWidth="12" />
      <ellipse cx="69" cy="25" rx="6.5" ry="8" fill="#f5f5f7" />
    </svg>}
  </div>;
}

export default function RunningLoader({ stage, onComplete }: { stage: StartupStage; onComplete: () => void }) {
  const overlay = useRef<HTMLDivElement>(null);
  const traveler = useRef<HTMLDivElement>(null);
  const track = useRef<SVGGElement>(null);
  const [phase, setPhase] = useState<Phase>('approach');
  const [crossed, setCrossed] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [artwork, setArtwork] = useState<'pending' | 'ready' | 'error'>('pending');
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const current = useRef({ stage, onComplete, reduced, artwork });
  current.current = { stage, onComplete, reduced, artwork };

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let frame = 0, previous = performance.now(), visibleTime = 0, phaseTime = 0;
    let localPhase: Phase = 'approach', reportedDelay = false, reportedCrossing = false;
    const change = (next: Phase) => { localPhase = next; phaseTime = 0; setPhase(next); };
    // The clock is visible time: returning to a background tab cannot skip the
    // entire finish. State changes happen only at phase boundaries.
    const visibility = () => { previous = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    const tick = (now: number) => {
      const delta = document.hidden ? 0 : Math.max(0, Math.min(now - previous, 100));
      previous = now;
      visibleTime += delta;
      phaseTime += delta;
      const value = current.current;
      if (value.artwork === 'pending') phaseTime = 0;
      if (value.stage === 'error') {
        if (localPhase !== 'error') { change('error'); setCrossed(false); }
      } else if (value.reduced && value.stage === 'ready') {
        value.onComplete();
        return;
      } else {
        if (localPhase === 'error' || (value.stage !== 'ready' && localPhase !== 'approach')) {
          change('approach'); setCrossed(false); reportedCrossing = false;
        }
        if (localPhase === 'approach' && value.stage === 'ready' && phaseTime >= STRIDE) change('crossing');
        else if (localPhase === 'crossing') {
          if (phaseTime >= CROSSING * 0.66 && !reportedCrossing) { reportedCrossing = true; setCrossed(true); }
          if (phaseTime >= CROSSING) change('leaving');
        } else if (localPhase === 'leaving' && phaseTime >= FADE) { value.onComplete(); return; }
      }
      // Keep travel, ground, and exit on this same visible-time clock. CSS
      // transitions would finish offscreen even while the phase clock pauses.
      const distance = localPhase === 'leaving' ? 300 : localPhase === 'crossing' ? Math.min(1, phaseTime / CROSSING) * 300 : 0;
      if (traveler.current) traveler.current.style.transform = `translateX(${distance / 120 * 100}%)`;
      if (track.current && !value.reduced && localPhase !== 'error') track.current.style.transform = `translateX(${-80 * ((visibleTime % STRIDE) / STRIDE)}px)`;
      if (overlay.current) overlay.current.style.opacity = localPhase === 'leaving' ? String(1 - Math.min(1, phaseTime / FADE)) : '1';
      if (visibleTime >= 10000 && !reportedDelay) { reportedDelay = true; setDelayed(true); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  const recovery = stage === 'error' || (delayed && (stage !== 'ready' || artwork === 'pending'));
  return <div ref={overlay} className="rp-running-loader" data-phase={phase} data-crossed={crossed} data-reduced={reduced}>
    <div className="rp-loading-composition">
      <div className="rp-loading-brand">
        <img src="/assets/racepulse-mark-192.png" width="44" height="44" alt="" />
        <span>RacePulse<span className="rp-loading-ph">PH</span></span>
      </div>
      <div className="rp-loading-scene" aria-hidden="true">
        <svg viewBox="0 0 480 210" fill="none">
          <path className="rp-course-line" d="M24 176H456" />
          <g ref={track} className="rp-track-ticks"><path d="M40 183h16m64 0h16m64 0h16m64 0h16m64 0h16m64 0h16m64 0h16" /></g>
          <path className="rp-sensor-back" d="M333 174V60h17v114" />
          <path className="rp-sensor-beam" d="M342 70v104" />
          <path className="rp-timing-mat" d="M324 177h39l-9 7h-39z" />
          <path className="rp-sensor-front" d="M354 179V83h8v96" />
          <rect className="rp-sensor-light" x="354" y="86" width="8" height="5" />
          <g className="rp-sensor-read"><path d="M374 84l4 4 8-10" /></g>
        </svg>
        <div ref={traveler} className="rp-runner-travel">
          <CapturedRunner active={!reduced && phase !== 'error' && artwork === 'ready'} artwork={artwork} onArtwork={setArtwork} />
        </div>
        <div className="rp-sensor-caption">TIMING POINT</div>
      </div>
      <p className="rp-loading-status" role="status" aria-live="polite" aria-atomic="true">{crossed && stage === 'ready' ? 'Ready to go' : labels[stage]}</p>
      {recovery && <div className="rp-loading-recovery">
        <p>{stage === 'error' ? 'Please try again, or open the app to review the issue.' : 'This is taking longer than usual. You can wait, retry, or open the app while it continues.'}</p>
        <div><button type="button" onClick={() => window.location.reload()}>Try again</button><button type="button" onClick={onComplete}>Open app</button></div>
      </div>}
    </div>
  </div>;
}
