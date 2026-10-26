import { Race, RunnerResult } from '../types';
import { getCheckpointByType } from './timing';

export function finishScanOrder(results: RunnerResult[], race: Pick<Race, 'checkpoints'>) {
  const finishId = getCheckpointByType(race.checkpoints, 'finish')?.id
    ?? [...race.checkpoints].sort((a, b) => a.order - b.order).at(-1)?.id;
  return results.filter((result) => result.rank !== undefined).map((result) => {
    const timestamps = result.splits.filter((split) => split.checkpointId === finishId)
      .map((split) => Date.parse(split.timestamp)).filter(Number.isFinite);
    return { result, finishedAt: timestamps.length ? Math.min(...timestamps) : undefined };
  }).sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity)
    || a.result.bibNumber.localeCompare(b.result.bibNumber))
    .map((entry, index) => ({ ...entry, scanOrder: index + 1 }));
}
