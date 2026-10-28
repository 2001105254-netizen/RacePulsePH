import { timestampTicks } from './preciseTime';
import { Race, RunnerResult } from '../types';
import { getCheckpointByType } from './timing';

export function finishScanOrder(results: RunnerResult[], race: Pick<Race, 'checkpoints'>) {
  const finishId = getCheckpointByType(race.checkpoints, 'finish')?.id
    ?? [...race.checkpoints].sort((a, b) => a.order - b.order).at(-1)?.id;
  return results.filter((result) => result.rank !== undefined).map((result) => {
    const timestamps = result.splits.filter((split) => split.checkpointId === finishId)
      .map((split) => timestampTicks(split.timestamp)).filter((value): value is bigint => value !== undefined);
    const ticks = timestamps.reduce<bigint | undefined>((a, b) => a === undefined || b < a ? b : a, undefined);
    return { result, finishTicks: ticks, finishedAt: ticks === undefined ? undefined : Number(ticks / 10000n) };
  }).sort((a, b) => (a.finishTicks === b.finishTicks ? 0 : a.finishTicks === undefined ? 1 : b.finishTicks === undefined ? -1 : a.finishTicks < b.finishTicks ? -1 : 1)
    || a.result.bibNumber.localeCompare(b.result.bibNumber))
    .map((entry, index) => ({ ...entry, scanOrder: index + 1 }));
}
