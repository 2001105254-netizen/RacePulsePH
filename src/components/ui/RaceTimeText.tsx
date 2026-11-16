import React from 'react';
import { formatRaceTime } from '../../lib/preciseTime';

interface RaceTimeTextProps {
  value: string | undefined | null;
  className?: string;
  showSubSeconds?: boolean;
  fallback?: string;
}

const PRECISE_TIME_PATTERN = /^(\d{2,}:[0-5]\d:[0-5]\d)(\d{5})$/;

export default function RaceTimeText({
  value,
  className = '',
  showSubSeconds = true,
  fallback,
}: RaceTimeTextProps) {
  if (!value) {
    return <span className={className}>{fallback ?? formatRaceTime(value)}</span>;
  }

  const formatted = formatRaceTime(value);
  const match = PRECISE_TIME_PATTERN.exec(formatted);
  if (!match) {
    return <span className={className}>{formatted}</span>;
  }

  const [, hms, frac] = match;
  return (
    <span className={className} aria-label={`${hms}.${frac}`}>
      <span>{hms}</span>
      {showSubSeconds && (
        <span className="rp-frac-time text-[0.68em] opacity-65 font-normal">
          {frac}
        </span>
      )}
    </span>
  );
}
