import { RunnerProfile } from '../types';

export function entrySequenceError(runners: RunnerProfile[], nextBib: string, previousBib: string): string | undefined {
  const byBib = new Map(runners.map((runner) => [runner.bibNumber, runner]));
  const next = byBib.get(nextBib);
  if (!next) return 'Choose the next entry from this race roster.';
  if (!previousBib) return undefined;
  const previous = byBib.get(previousBib);
  if (!previous) return 'Choose the previous entry from this race roster.';
  if (previousBib === nextBib) return 'An entry cannot follow itself.';
  if (next.chipId && previous.chipId && next.chipId.trim().toUpperCase() === previous.chipId.trim().toUpperCase()) {
    return 'Consecutive entries must use separate chips.';
  }
  if (runners.some((runner) => runner.bibNumber !== nextBib && runner.startsAfterBib === previousBib)) {
    return 'The previous bib is already linked to another next entry.';
  }
  const visited = new Set([nextBib]);
  let current: RunnerProfile | undefined = previous;
  while (current) {
    if (visited.has(current.bibNumber)) return 'This link would create a loop. Choose a different previous entry.';
    visited.add(current.bibNumber);
    current = current.startsAfterBib ? byBib.get(current.startsAfterBib) : undefined;
  }
  return undefined;
}
