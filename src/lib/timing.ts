import { elapsedSeconds, formatElapsed, timestampTicks } from './preciseTime';
import { AgeCategory, Checkpoint, CheckpointType, ChipRead, Race, RaceEntryCategory, RunnerProfile, RunnerResult, RunnerSplit } from '../types';
import { entryCategoryLabels, runnerDivisionLabel, runnerEntryCategory } from './raceEntry';

// A staggered race stores one gun time for each distance. When no wave has
// been started yet, retain the old single gun time behavior for legacy races.
export function getWaveStartTime(
  race: Pick<Race, 'gunStartTime' | 'waveStartTimes' | 'finishReviewWindowMs'>,
  distance: string,
  entryCategory?: RaceEntryCategory,
): string | undefined {
  const waveStartTimes = race.waveStartTimes;
  if (waveStartTimes && Object.keys(waveStartTimes).length > 0) {
    // Start Roll Call stores wave keys by the complete division (for example
    // "21K Solo"), while imported runners commonly retain the base distance
    // "21K" plus a separate entryCategory.  Resolve both forms so a valid
    // Finish scan can receive its correct division-specific gun-time fallback.
    const division = entryCategory ? `${distance} ${entryCategoryLabels[entryCategory]}` : distance;
    if (waveStartTimes[division]) return waveStartTimes[division];
    if (waveStartTimes[distance]) return waveStartTimes[distance];

    const normalise = (value: string) => value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const target = normalise(division);
    const matchingKey = Object.keys(waveStartTimes).find((key) => normalise(key) === target);
    if (matchingKey) return waveStartTimes[matchingKey];
    return undefined;
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

export function findRunnerAgeCategory(
  ageCategories: AgeCategory[],
  runner: Pick<RunnerProfile, 'gender' | 'age' | 'ageCategoryOverrideId'>,
): AgeCategory | undefined {
  const override = runner.ageCategoryOverrideId
    ? ageCategories.find((category) => category.id === runner.ageCategoryOverrideId && category.gender === runner.gender)
    : undefined;
  return override || ageCategories.find((category) => category.gender === runner.gender
    && runner.age >= category.minAge
    && runner.age <= category.maxAge);
}

function validTimestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function compareReadOrder(a: ChipRead, b: ChipRead): number {
  const crossedA = validTimestamp(a.timestamp);
  const crossedB = validTimestamp(b.timestamp);
  if (crossedA !== undefined && crossedB !== undefined && crossedA !== crossedB) return crossedA - crossedB;
  if (crossedA !== undefined && crossedB === undefined) return -1;
  if (crossedA === undefined && crossedB !== undefined) return 1;
  const recordedA = validTimestamp(a.createdAt);
  const recordedB = validTimestamp(b.createdAt);
  if (recordedA !== undefined && recordedB !== undefined && recordedA !== recordedB) return recordedA - recordedB;
  if (recordedA !== undefined && recordedB === undefined) return -1;
  if (recordedA === undefined && recordedB !== undefined) return 1;
  return a.id.localeCompare(b.id);
}

// Results display whole seconds. Keep the actual crossing sequence as the
// second tie-break so an earlier finisher is never displaced by bib number.
export function compareResultFinishOrder(a: RunnerResult, b: RunnerResult): number {
  const crossedA = validTimestamp(a.finishReadAt);
  const crossedB = validTimestamp(b.finishReadAt);
  if (crossedA !== undefined && crossedB !== undefined && crossedA !== crossedB) return crossedA - crossedB;
  if (crossedA !== undefined && crossedB === undefined) return -1;
  if (crossedA === undefined && crossedB !== undefined) return 1;
  const recordedA = validTimestamp(a.finishReadRecordedAt);
  const recordedB = validTimestamp(b.finishReadRecordedAt);
  if (recordedA !== undefined && recordedB !== undefined && recordedA !== recordedB) return recordedA - recordedB;
  if (recordedA !== undefined && recordedB === undefined) return -1;
  if (recordedA === undefined && recordedB !== undefined) return 1;
  return a.bibNumber.localeCompare(b.bibNumber);
}

export function orderFemaleOverallResults(
  results: RunnerResult[],
  division: string,
  race?: Pick<Race, 'femaleOverallRankOverrides'>,
): RunnerResult[] {
  const automatic = [...results]
    .filter((result) => result.finishSeconds !== undefined
      && !result.runnerProfile.isFreeSlot
      && runnerEntryCategory(result.runnerProfile) === 'solo'
      && result.runnerProfile.gender === 'female')
    .sort((a, b) => a.finishSeconds! - b.finishSeconds! || compareResultFinishOrder(a, b));
  const byBib = new Map(automatic.map((result) => [result.bibNumber.toUpperCase(), result]));
  const placed = new Set<string>();
  const manual = (race?.femaleOverallRankOverrides?.[division] || [])
    .map((bib) => byBib.get(bib.trim().toUpperCase()))
    .filter((result): result is RunnerResult => !!result)
    .filter((result) => {
      const key = result.bibNumber.toUpperCase();
      if (placed.has(key)) return false;
      placed.add(key);
      return true;
    });
  return [...manual, ...automatic.filter((result) => !placed.has(result.bibNumber.toUpperCase()))];
}

// Derives per-runner splits, finish time and rank from raw checkpoint scans.
// Works identically whether the ChipRead came from manual/QR entry today or a
// real RFID reader bridge later (source is irrelevant to the computation).
export function computeResults(
  checkpoints: Checkpoint[],
  chipReads: ChipRead[],
  runnerProfiles: RunnerProfile[],
  ageCategories: AgeCategory[] = [],
  raceTiming?: Pick<Race, 'gunStartTime' | 'waveStartTimes' | 'finishReviewWindowMs' | 'femaleOverallRankOverrides'>
): RunnerResult[] {
  const orderedCheckpoints = [...checkpoints].sort((a, b) => a.order - b.order);
  // Check-in is operational only. It must never become the timing start just
  // because it appears first in the configured checkpoint sequence.
  const startCheckpoint = getCheckpointByType(orderedCheckpoints, 'start') || orderedCheckpoints[0];
  const finishCheckpoint = getCheckpointByType(orderedCheckpoints, 'finish') || orderedCheckpoints[orderedCheckpoints.length - 1];

  // bib -> checkpointId -> earliest actual scan (guards against duplicates).
  const readsByBib = new Map<string, Map<string, ChipRead>>();
  for (const read of chipReads) {
    if (timestampTicks(read.timestamp) === undefined) continue;
    let checkpointMap = readsByBib.get(read.bibNumber);
    if (!checkpointMap) {
      checkpointMap = new Map();
      readsByBib.set(read.bibNumber, checkpointMap);
    }
    const existing = checkpointMap.get(read.checkpointId);
    if (!existing || compareReadOrder(read, existing) < 0) {
      checkpointMap.set(read.checkpointId, read);
    }
  }

  const profilesByBib = new Map(runnerProfiles.map((runner) => [runner.bibNumber, runner]));
  const computed = new Map<string, RunnerResult>();
  const computing = new Set<string>();
  // A timing read without a current roster record is useful audit data, but
  // it can never be an official result. Iterate the registered roster rather
  // than raw reads so deleted/test/typo bibs cannot become an “Unknown” rank.
  // If the organizer later imports the matching runner with the same bib,
  // their existing reads are automatically picked up on the next calculation.
  const computeEntry = (runnerProfile: RunnerProfile): RunnerResult | undefined => {
    const bibNumber = runnerProfile.bibNumber;
    if (computed.has(bibNumber)) return computed.get(bibNumber);
    if (computing.has(bibNumber)) return undefined;
    computing.add(bibNumber);
    const checkpointMap = readsByBib.get(bibNumber) || new Map<string, ChipRead>();
    const splits: RunnerSplit[] = orderedCheckpoints
      .filter((cp) => checkpointMap.has(cp.id))
      .map((cp) => ({ checkpointId: cp.id, timestamp: checkpointMap.get(cp.id)!.timestamp }));

    let finishTime: string | undefined;
    let finishSeconds: number | undefined;
    let chipTime: string | undefined;
    let chipSeconds: number | undefined;
    let gunTime: string | undefined;
    let gunSeconds: number | undefined;
    let sequenceStartTime: string | undefined;
    if (runnerProfile.startsAfterBib) {
      const previous = profilesByBib.get(runnerProfile.startsAfterBib);
      const previousResult = previous ? computeEntry(previous) : undefined;
      if (previousResult?.finishTime && finishCheckpoint) {
        sequenceStartTime = previousResult.splits.find((split) => split.checkpointId === finishCheckpoint.id)?.timestamp;
      }
    }

    if (startCheckpoint && finishCheckpoint && startCheckpoint.id !== finishCheckpoint.id && checkpointMap.has(finishCheckpoint.id)) {
      const chipStart = checkpointMap.get(startCheckpoint.id)?.timestamp;
      // The Roll Call gun time is official for normal divisions. A linked
      // sequence begins at its predecessor's finish, while chip time remains
      // available only for older races with no saved gun start.
      const gunStart = runnerProfile && raceTiming
        ? getWaveStartTime(raceTiming, runnerProfile.distance, runnerEntryCategory(runnerProfile))
        : undefined;
      const finishRead = checkpointMap.get(finishCheckpoint.id)!;
      const elapsedFrom = (start: string | undefined) => elapsedSeconds(start, finishRead.timestamp);

      chipSeconds = elapsedFrom(chipStart);
      gunSeconds = elapsedFrom(gunStart);
      chipTime = chipSeconds === undefined ? undefined : formatElapsed(chipSeconds);
      gunTime = gunSeconds === undefined ? undefined : formatElapsed(gunSeconds);
      // A linked entry waits for its predecessor's official finish. Never
      // substitute the division gun or a later chip scan for that handoff.
      finishSeconds = runnerProfile.startsAfterBib ? elapsedFrom(sequenceStartTime) : gunSeconds ?? chipSeconds;
      finishTime = finishSeconds === undefined ? undefined : formatElapsed(finishSeconds);
    }

    const result: RunnerResult = {
      bibNumber,
      runnerProfile,
      splits,
      finishTime,
      finishSeconds,
      ...(chipTime ? { chipTime, chipSeconds } : {}),
      ...(gunTime ? { gunTime, gunSeconds } : {}),
      ...(sequenceStartTime ? { sequenceStartTime } : {}),
      ...(finishTime ? { timingMethod: runnerProfile.startsAfterBib ? 'transition' as const : gunTime ? 'gun' as const : 'chip' as const } : {}),
      ...(checkpointMap.get(finishCheckpoint.id) ? {
        finishReadAt: checkpointMap.get(finishCheckpoint.id)!.timestamp,
        finishReadRecordedAt: checkpointMap.get(finishCheckpoint.id)!.createdAt,
      } : {}),
    };
    computing.delete(bibNumber);
    computed.set(bibNumber, result);
    return result;
  };
  const results = runnerProfiles.map(computeEntry).filter((result): result is RunnerResult => !!result);

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
    const ranked = list.filter(r => r.finishSeconds !== undefined)
      .sort((a, b) => a.finishSeconds! - b.finishSeconds! || compareResultFinishOrder(a, b));
    ranked.forEach((r, idx) => {
      const previous = ranked[idx - 1];
      r.overallRank = previous?.finishSeconds === r.finishSeconds ? previous.overallRank : idx + 1;
      r.rank = r.overallRank;
      const threshold = Math.max(0, raceTiming?.finishReviewWindowMs ?? 0) / 1000;
      if ([previous, ranked[idx + 1]].some(other => other && Math.abs(Math.round(other.finishSeconds! * 10000000) - Math.round(r.finishSeconds! * 10000000)) <= Math.round(threshold * 10000000))) r.finishReviewRequired = true;
    });
  }

  // Overall top-three and Female Overall top-three do not also receive an age
  // category award. The following eligible finisher advances to that place.
  const ageCategoryAwardExclusions = new Set<string>();
  for (const [division, list] of byDivision.entries()) {
    list
      .filter((result) => result.finishSeconds !== undefined && !result.runnerProfile.isFreeSlot && runnerEntryCategory(result.runnerProfile) === 'solo')
      .sort((a, b) => a.finishSeconds! - b.finishSeconds! || compareResultFinishOrder(a, b))
      .slice(0, 3)
      .forEach((result) => ageCategoryAwardExclusions.add(result.bibNumber));
    orderFemaleOverallResults(list, division, raceTiming).slice(0, 3)
      .forEach((result) => ageCategoryAwardExclusions.add(result.bibNumber));
  }

  // Age-category places are only calculated when the organizer configured
  // categories for this race. The category remains inside the same official
  // distance/entry division, so a 5K runner can never rank against a 10K one.
  const byAgeCategory = new Map<string, RunnerResult[]>();
  for (const result of results) {
    if (result.finishSeconds === undefined || !result.runnerProfile) continue;
    // Free slots are anonymous race-day places. They can receive a time and
    // a rank in their own division, but never an age-category place.
    if (result.runnerProfile.isFreeSlot) continue;
    // Duo and Trio are team divisions: the representative/captain's age must
    // not decide the team's ranking. They receive their own overall division
    // rank only (e.g. 10K Duo #1), while age categories stay Solo-only.
    if (runnerEntryCategory(result.runnerProfile) !== 'solo') continue;
    if (ageCategoryAwardExclusions.has(result.bibNumber)) continue;
    const category = findRunnerAgeCategory(ageCategories, result.runnerProfile);
    if (!category) continue;
    result.categoryLabel = category.label;
    const key = `${runnerDivisionLabel(result.runnerProfile)}|${category.id}`;
    const list = byAgeCategory.get(key) ?? [];
    list.push(result);
    byAgeCategory.set(key, list);
  }
  for (const list of byAgeCategory.values()) {
    list
      .sort((a, b) => a.finishSeconds! - b.finishSeconds! || compareResultFinishOrder(a, b))
      .forEach((result, index) => {
        const previous = list[index - 1];
        result.categoryRank = previous?.finishSeconds === result.finishSeconds ? previous.categoryRank : index + 1;
      });
  }

  return results.sort((a, b) => {
    if (a.finishSeconds !== undefined && b.finishSeconds !== undefined) return a.finishSeconds - b.finishSeconds || compareResultFinishOrder(a, b);
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
  raceTiming?: Pick<Race, 'gunStartTime' | 'waveStartTimes' | 'finishReviewWindowMs' | 'femaleOverallRankOverrides'>
): RunnerResult | undefined {
  return computeResults(checkpoints, chipReads, runnerProfiles, ageCategories, raceTiming).find((r) => r.bibNumber === bibNumber);
}
