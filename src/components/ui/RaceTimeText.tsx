import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { formatRaceTime } from '../../lib/preciseTime';

interface RaceTimeTextProps {
  value: string | undefined | null;
  className?: string;
  showSubSeconds?: boolean;
  fallback?: string;
  odometer?: boolean;
  odometerKey?: string;
  durationMs?: number;
}

const PRECISE_TIME_PATTERN = /^(\d{2,}):([0-5]\d):([0-5]\d)(\d{5})$/;

function formatUnitsToParts(units: number, hourDigits: number): { hms: string; frac: string } {
  const safeUnits = Math.max(0, Math.round(units));
  const totalSeconds = Math.floor(safeUnits / 100000);
  const fracInt = safeUnits % 100000;
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const hms = `${String(hrs).padStart(hourDigits, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const frac = String(fracInt).padStart(5, '0');
  return { hms, frac };
}

export default function RaceTimeText({
  value,
  className = '',
  showSubSeconds = true,
  fallback,
  odometer = false,
  odometerKey = '',
  durationMs = 350,
}: RaceTimeTextProps) {
  const prefersReducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLSpanElement>(null);
  const [hasEntered, setHasEntered] = useState(false);

  const formatted = value ? formatRaceTime(value) : '';
  const match = formatted ? PRECISE_TIME_PATTERN.exec(formatted) : null;
  const hasMatch = Boolean(match);

  const targetUnits = match
    ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 100000 + Number(match[4])
    : 0;
  const hourDigits = match ? match[1].length : 2;
  const exactHms = match ? `${match[1]}:${match[2]}:${match[3]}` : '';
  const exactFrac = match ? match[4] : '';

  const [rolledParts, setRolledParts] = useState<{ hms: string; frac: string } | null>(null);
  const prevUnitsRef = useRef<number | null>(null);
  const prevKeyRef = useRef<string>(odometerKey);

  useEffect(() => {
    if (!odometer || prefersReducedMotion || hasEntered || !hasMatch) {
      if (!hasEntered) setHasEntered(true);
      return;
    }

    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setHasEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEntered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [odometer, prefersReducedMotion, hasEntered, hasMatch]);

  useEffect(() => {
    if (!odometer || prefersReducedMotion || !hasEntered || !hasMatch || targetUnits <= 0) {
      prevUnitsRef.current = targetUnits;
      prevKeyRef.current = odometerKey;
      setRolledParts(null);
      return;
    }

    const keyChanged = prevKeyRef.current !== odometerKey;
    const isInitialOrKeyReset = prevUnitsRef.current === null || keyChanged;
    const from = isInitialOrKeyReset ? Math.floor(targetUnits * 0.72) : prevUnitsRef.current!;

    prevUnitsRef.current = targetUnits;
    prevKeyRef.current = odometerKey;

    if (from === targetUnits) {
      setRolledParts(null);
      return;
    }

    const delta = targetUnits - from;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      if (progress >= 1) {
        setRolledParts(null);
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      setRolledParts(formatUnitsToParts(from + delta * eased, hourDigits));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [odometer, prefersReducedMotion, hasEntered, targetUnits, hourDigits, odometerKey, durationMs, hasMatch]);

  if (!value) {
    return <span className={className}>{fallback ?? formatRaceTime(value)}</span>;
  }

  if (!match) {
    return <span className={className}>{formatted}</span>;
  }

  const displayHms = rolledParts ? rolledParts.hms : exactHms;
  const displayFrac = rolledParts ? rolledParts.frac : exactFrac;

  return (
    <span
      ref={hostRef}
      className={`tabular-nums ${className}`}
      aria-label={`${exactHms}.${exactFrac}`}
    >
      <span>{displayHms}</span>
      {showSubSeconds && (
        <span className="rp-frac-time text-[0.68em] opacity-65 font-normal">
          {displayFrac}
        </span>
      )}
    </span>
  );
}
