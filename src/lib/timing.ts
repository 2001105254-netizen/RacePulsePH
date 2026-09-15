import { Checkpoint, CheckpointType, ChipRead, Race, RunnerProfile, RunnerResult, RunnerSplit } from '../types';
import { runnerDivisionLabel } from './raceEntry';

// A staggered race stores one gun time for each distance. When no wave has
// been started yet, retain the old single gun time behavior for legacy races.
export function getWaveStartTime(race: Pick<Race, 'gunStartTime' | 'waveStartTimes'>, distance: string): string | undefined {
  const waveStartTimes = race.waveStartTimes;
  if (waveStartTimes && Object.keys(waveStartTimes).length > 0) {
    return waveStartTimes[distance];
  }
  return race.gunStartTime || undefined;
}

export function checkpointType(checkpoint: Checkpoint, index: number, total: number): CheckpointType {
  if (checkpoint.type) return checkpoint.type;
  return index === 0 ? 'start' : index === total - 1 ? 'finish' : 'intermediate';
}

export function getCheckpointByType(checkpoints: Checkpoint[], type: CheckpointType): Checkpoint | undefined {
  const ordered = [...checkpoints].sort((a, b) => a.order - b.order);
  return ordered.find((checkpoint, index) => checkpointType(checkpoint, index, ordered.length) === type);
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// Derives per-runner splits, finish time and rank from raw checkpoint scans.
// Works identically whether the ChipRead came from manual/QR entry today or a
// real RFID reader bridge later (source is irrelevant to the computation).
export function computeResults(
  checkpoints: Checkpoint[],
  chipReads: ChipRead[],
  runnerProfiles: RunnerProfile[]
): RunnerResult[] {
  const orderedCheckpoints = [...checkpoints].sort((a, b) => a.order - b.order);
  // Check-in is operational only. It must never become the timing start just
  // because it appears first in the configured checkpoint sequence.
  const startCheckpoint = getCheckpointByType(orderedCheckpoints, 'start') || orderedCheckpoints[0];
  const finishCheckpoint = getCheckpointByType(orderedCheckpoints, 'finish') || orderedCheckpoints[orderedCheckpoints.length - 1];

  const profileByBib = new Map(runnerProfiles.map((r) => [r.bibNumber, r]));

  // bib -> checkpointId -> earliest recorded timestamp (guards against duplicate scans)
  const readsByBib = new Map<string, Map<string, string>>();
  for (const read of chipReads) {
    let checkpointMap = readsByBib.get(read.bibNumber);
    if (!checkpointMap) {
      checkpointMap = new Map();
      readsByBib.set(read.bibNumber, checkpointMap);
    }
    const existing = checkpointMap.get(read.checkpointId);
    if (!existing || new Date(read.timestamp).getTime() < new Date(existing).getTime()) {
      checkpointMap.set(read.checkpointId, read.timestamp);
    }
  }

  const results: RunnerResult[] = [];
  for (const [bibNumber, checkpointMap] of readsByBib.entries()) {
    const splits: RunnerSplit[] = orderedCheckpoints
      .filter((cp) => checkpointMap.has(cp.id))
      .map((cp) => ({ checkpointId: cp.id, timestamp: checkpointMap.get(cp.id)! }));

    let finishTime: string | undefined;
    let finishSeconds: number | undefined;

    if (
      startCheckpoint &&
      finishCheckpoint &&
      startCheckpoint.id !== finishCheckpoint.id &&
      checkpointMap.has(startCheckpoint.id) &&
      checkpointMap.has(finishCheckpoint.id)
    ) {
      const startMs = new Date(checkpointMap.get(startCheckpoint.id)!).getTime();
      const finishMs = new Date(checkpointMap.get(finishCheckpoint.id)!).getTime();
      finishSeconds = Math.max(0, Math.round((finishMs - startMs) / 1000));
      finishTime = formatElapsed(finishSeconds);
    }

    results.push({ bibNumber, runnerProfile: profileByBib.get(bibNumber), splits, finishTime, finishSeconds });
  }

  // Rank within each distance + entry category. A 10K Duo team must never
  // compete in the same official rank list as a 10K Solo runner.
  const byDivision = new Map<string, RunnerResult[]>();
  for (const result of results) {
    const division = runnerDivisionLabel(result.runnerProfile);
    const list = byDivision.get(division) ?? [];
    list.push(result);
    byDivision.set(division, list);
  }
  for (const list of byDivision.values()) {
    list
      .filter((r) => r.finishSeconds !== undefined)
      .sort((a, b) => a.finishSeconds! - b.finishSeconds!)
      .forEach((r, idx) => {
        r.rank = idx + 1;
      });
  }

  return results.sort((a, b) => {
    if (a.finishSeconds !== undefined && b.finishSeconds !== undefined) return a.finishSeconds - b.finishSeconds;
    if (a.finishSeconds !== undefined) return -1;
    if (b.finishSeconds !== undefined) return 1;
    return b.splits.length - a.splits.length;
  });
}

export function getResultForBib(
  checkpoints: Checkpoint[],
  chipReads: ChipRead[],
  runnerProfiles: RunnerProfile[],
  bibNumber: string
): RunnerResult | undefined {
  return computeResults(checkpoints, chipReads, runnerProfiles).find((r) => r.bibNumber === bibNumber);
}
