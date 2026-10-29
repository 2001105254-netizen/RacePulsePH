// Keep the seven fractional digits emitted by .NET. Epoch ticks must never
// pass through Number or Date, which would discard sub-millisecond precision.
export function timestampTicks(timestamp: string): bigint | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (!match) return undefined;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(seconds)) return undefined;
  return BigInt(seconds) * 10000n + BigInt((match[2] || '').padEnd(7, '0'));
}

export function elapsedSeconds(start: string | undefined, finish: string): number | undefined {
  const a = start ? timestampTicks(start) : undefined;
  const b = timestampTicks(finish);
  if (a === undefined || b === undefined || b < a) return undefined;
  const ticks = b - a;
  if (ticks > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(ticks) / 10000000;
}

export function formatElapsed(totalSeconds: number): string {
  // Seven digits after the final colon: two seconds plus five fractional
  // digits. Ranking retains all seven fractional source digits.
  const units = Math.floor(Math.round(totalSeconds * 10000000) / 100);
  const seconds = Math.floor(units / 100000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
    + String(units % 100000).padStart(5, '0');
}

/** Normalize both legacy HH:MM:SS.fffffff and current HH:MM:SSfffff values. */
export function formatRaceTime(value: string | undefined | null): string {
  if (!value) return '—';
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)(?:\.(\d{1,7})|(\d{5}))?$/.exec(value.trim());
  if (!match) return value;
  return `${match[1]}:${match[2]}:${match[3]}${(match[4] || match[5] || '').padEnd(5, '0').slice(0, 5)}`;
}

/** Local wall time; retain source fractional digits rather than Date's 3 digits. */
export function formatClockTime(value: string | number | Date | undefined): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const fraction = typeof value === 'string'
    ? /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]
    : undefined;
  const digits = (fraction ?? String(date.getMilliseconds()).padStart(3, '0')).padEnd(5, '0').slice(0, 5);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => String(part).padStart(2, '0')).join(':') + digits;
}

export function formatDateTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toLocaleDateString()} ${formatClockTime(value)}` : '—';
}
