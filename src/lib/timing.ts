import { Checkpoint, ChipRead, RunnerProfile, RunnerResult, RunnerSplit } from '../types';

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
  const startCheckpoint = orderedCheckpoints[0];
  const finishCheckpoint = orderedCheckpoints[orderedCheckpoints.length - 1];

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

  // Rank within each distance category - only runners with a recorded finish get a rank
  const byDistance = new Map<string, RunnerResult[]>();
  for (const result of results) {
    const distance = result.runnerProfile?.distance || 'Unknown';
    const list = byDistance.get(distance) ?? [];
    list.push(result);
    byDistance.set(distance, list);
  }
  for (const list of byDistance.values()) {
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
