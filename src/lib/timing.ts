import { AgeCategory, Checkpoint, CheckpointType, ChipRead, Race, RunnerProfile, RunnerResult, RunnerSplit } from '../types';
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
  runnerProfiles: RunnerProfile[],
  ageCategories: AgeCategory[] = [],
  raceTiming?: Pick<Race, 'gunStartTime' | 'waveStartTimes'>
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

    const runnerProfile = profileByBib.get(bibNumber);
    if (startCheckpoint && finishCheckpoint && startCheckpoint.id !== finishCheckpoint.id && checkpointMap.has(finishCheckpoint.id)) {
      const chipStart = checkpointMap.get(startCheckpoint.id);
      // When a dense start line misses an individual tag, the official wave
      // gun time is the safe fallback. It is distance-specific, so a later 5K
      // wave cannot accidentally use an earlier 10K gun time.
      const fallbackGunStart = !chipStart && runnerProfile && raceTiming
        ? getWaveStartTime(raceTiming, runnerProfile.distance)
        : undefined;
      const startTimestamp = chipStart || fallbackGunStart;
      if (startTimestamp) {
        const startMs = new Date(startTimestamp).getTime();
        const finishMs = new Date(checkpointMap.get(finishCheckpoint.id)!).getTime();
        if (!Number.isNaN(startMs) && !Number.isNaN(finishMs) && finishMs >= startMs) {
          finishSeconds = Math.round((finishMs - startMs) / 1000);
          finishTime = formatElapsed(finishSeconds);
        }
      }
    }

    results.push({
      bibNumber,
      runnerProfile,
      splits,
      finishTime,
      finishSeconds,
      ...(finishTime ? { timingMethod: checkpointMap.has(startCheckpoint?.id || '') ? 'chip' as const : 'gun' as const } : {}),
    });
  }

  // Overall rank is within each distance + entry category. A 10K Duo team
  // must never compete in the same official list as a 10K Solo runner.
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
      .sort((a, b) => a.finishSeconds! - b.finishSeconds! || a.bibNumber.localeCompare(b.bibNumber))
      .forEach((r, idx) => {
        r.overallRank = idx + 1;
        r.rank = idx + 1;
      });
  }

  // Age-category places are only calculated when the organizer configured
  // categories for this race. The category remains inside the same official
  // distance/entry division, so a 5K runner can never rank against a 10K one.
  const byAgeCategory = new Map<string, RunnerResult[]>();
  for (const result of results) {
    if (result.finishSeconds === undefined || !result.runnerProfile) continue;
    const category = ageCategories.find((item) =>
      item.gender === result.runnerProfile!.gender
      && result.runnerProfile!.age >= item.minAge
      && result.runnerProfile!.age <= item.maxAge
    );
    if (!category) continue;
    result.categoryLabel = category.label;
    const key = `${runnerDivisionLabel(result.runnerProfile)}|${category.id}`;
    const list = byAgeCategory.get(key) ?? [];
    list.push(result);
    byAgeCategory.set(key, list);
  }
  for (const list of byAgeCategory.values()) {
    list
      .sort((a, b) => a.finishSeconds! - b.finishSeconds! || a.bibNumber.localeCompare(b.bibNumber))
      .forEach((result, index) => {
        result.categoryRank = index + 1;
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
  bibNumber: string,
  ageCategories: AgeCategory[] = [],
  raceTiming?: Pick<Race, 'gunStartTime' | 'waveStartTimes'>
): RunnerResult | undefined {
  return computeResults(checkpoints, chipReads, runnerProfiles, ageCategories, raceTiming).find((r) => r.bibNumber === bibNumber);
}
