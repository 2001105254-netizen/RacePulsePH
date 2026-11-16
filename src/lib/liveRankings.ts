import { timestampTicks } from './preciseTime';
import { Race, RunnerResult } from '../types';
import { getCheckpointByType, getWaveStartTime, orderFemaleOverallResults } from './timing';
import { groupRankingFolders } from './rankingFolders';
import { entryCategoryLabels, runnerDivisionLabel, runnerEntryCategory } from './raceEntry';

export interface FinishScanEntry {
  result: RunnerResult;
  finishedTimestamp?: string;
  finishTicks?: bigint;
  finishedAt?: number;
  scanOrder: number;
}

export interface ApproachingCourseEntry {
  result: RunnerResult;
  kind: 'approaching' | 'transition' | 'started';
  checkpointLabel: string;
  splitTimestamp?: string;
  splitTicks?: bigint;
}

export interface BroadcastCourseTelemetry {
  registered: number;
  started: number;
  onCourse: number;
  approaching: number;
  finished: number;
}

export interface BroadcastDivisionView {
  id: string;
  label: string;
  ranking: 'overall' | 'female-overall' | 'age' | 'special';
  divisionLabel: string;
  results: RunnerResult[];
  waveKeys: string[];
}

export interface BroadcastShortcutItem {
  keys: string;
  label: string;
}

export function finishScanOrder(results: RunnerResult[], race: Pick<Race, 'checkpoints'>): FinishScanEntry[] {
  const finishId = getCheckpointByType(race.checkpoints, 'finish')?.id
    ?? [...race.checkpoints].sort((a, b) => a.order - b.order).at(-1)?.id;
  return results.filter((result) => result.rank !== undefined).map((result) => {
    const timestamps = result.splits.filter((split) => split.checkpointId === finishId)
      .map((split) => timestampTicks(split.timestamp)).filter((value): value is bigint => value !== undefined);
    const ticks = timestamps.reduce<bigint | undefined>((a, b) => a === undefined || b < a ? b : a, undefined);
    const finishedTimestamp = result.splits.find(split => split.checkpointId === finishId && timestampTicks(split.timestamp) === ticks)?.timestamp;
    return { result, finishedTimestamp, finishTicks: ticks, finishedAt: ticks === undefined ? undefined : Number(ticks / 10000n) };
  }).sort((a, b) => (a.finishTicks === b.finishTicks ? 0 : a.finishTicks === undefined ? 1 : b.finishTicks === undefined ? -1 : a.finishTicks < b.finishTicks ? -1 : 1)
    || a.result.bibNumber.localeCompare(b.result.bibNumber))
    .map((entry, index) => ({ ...entry, scanOrder: index + 1 }));
}

/** Computes real pace in min/km from official elapsed seconds and race distance km. */
export function computeRunnerPace(finishSeconds: number | undefined, distanceKm: number | undefined): string | null {
  if (finishSeconds === undefined || !Number.isFinite(finishSeconds) || finishSeconds <= 0) return null;
  if (distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const secPerKm = finishSeconds / distanceKm;
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return null;
  let mins = Math.floor(secPerKm / 60);
  let secs = Math.round(secPerKm % 60);
  if (secs >= 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, '0')}/km`;
}

/** Formats time gap behind the category/division champion (+MM:SS, +H:MM:SS, or sub-second). */
export function formatGapToLeader(leaderSeconds: number | undefined, runnerSeconds: number | undefined): string {
  if (leaderSeconds === undefined || runnerSeconds === undefined) return 'FINISHER';
  const diff = runnerSeconds - leaderSeconds;
  if (!Number.isFinite(diff) || diff <= 0) return 'LEADER';
  if (diff < 1) {
    const hundredths = Math.max(1, Math.round(diff * 100));
    return `+0.${String(hundredths).padStart(2, '0')}s`;
  }
  const whole = Math.round(diff);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hrs > 0) {
    return `+${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `+${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Formats whole elapsed seconds as a clean HH:MM:SS broadcast clock readout. */
export function formatBroadcastClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

/** Builds live approaching/on-course entries and verified telemetry counts for a distance/race slice. */
export function buildBroadcastCourseFeed(
  results: RunnerResult[],
  race: Pick<Race, 'checkpoints' | 'gunStartTime' | 'waveStartTimes'>,
  distanceFilter = 'all',
) {
  const orderedCheckpoints = [...race.checkpoints].sort((a, b) => a.order - b.order);
  const finishId = getCheckpointByType(orderedCheckpoints, 'finish')?.id ?? orderedCheckpoints.at(-1)?.id;
  const startId = getCheckpointByType(orderedCheckpoints, 'start')?.id ?? orderedCheckpoints[0]?.id;
  const checkpointById = new Map(orderedCheckpoints.map((cp, index) => [cp.id, { cp, index }]));

  const scopedResults = results.filter(
    (result) => distanceFilter === 'all' || result.runnerProfile?.distance === distanceFilter,
  );

  let started = 0;
  let onCourse = 0;
  let finished = 0;
  const approaching: ApproachingCourseEntry[] = [];
  const activeOnCourse: ApproachingCourseEntry[] = [];

  for (const result of scopedResults) {
    if (result.disqualified) continue;
    const isFinished = result.rank !== undefined && result.finishTime !== undefined;
    const waveStart = result.runnerProfile
      ? getWaveStartTime(race, result.runnerProfile.distance, runnerEntryCategory(result.runnerProfile))
      : race.gunStartTime;
    const hasStartSplit = !!startId && result.splits.some((split) => split.checkpointId === startId);
    const intermediateSplits = result.splits.filter((split) => {
      const info = checkpointById.get(split.checkpointId);
      if (!info) return false;
      const type = info.cp.type ?? (info.index === 0 ? 'start' : info.index === orderedCheckpoints.length - 1 ? 'finish' : 'intermediate');
      return type === 'intermediate' && split.checkpointId !== finishId;
    });

    const hasWaveStarted = Boolean(waveStart && Number.isFinite(Date.parse(waveStart)));
    const isRunning = isFinished
      || hasStartSplit
      || intermediateSplits.length > 0
      || Boolean(result.sequenceStartTime)
      || (hasWaveStarted && !result.runnerProfile?.startsAfterBib);

    if (isRunning) started += 1;
    if (isFinished) {
      finished += 1;
      continue;
    }
    if (!isRunning) continue;

    onCourse += 1;

    if (intermediateSplits.length > 0) {
      // Pick the furthest checkpoint along the course (highest order, then latest timestamp).
      const bestSplit = [...intermediateSplits].sort((a, b) => {
        const orderA = checkpointById.get(a.checkpointId)?.cp.order ?? 0;
        const orderB = checkpointById.get(b.checkpointId)?.cp.order ?? 0;
        if (orderA !== orderB) return orderB - orderA;
        const ticksA = timestampTicks(a.timestamp) ?? 0n;
        const ticksB = timestampTicks(b.timestamp) ?? 0n;
        return ticksB > ticksA ? 1 : ticksB < ticksA ? -1 : 0;
      })[0];
      const info = checkpointById.get(bestSplit.checkpointId);
      const entry: ApproachingCourseEntry = {
        result,
        kind: 'approaching',
        checkpointLabel: info?.cp.label || bestSplit.checkpointId,
        splitTimestamp: bestSplit.timestamp,
        splitTicks: timestampTicks(bestSplit.timestamp),
      };
      approaching.push(entry);
      activeOnCourse.push(entry);
    } else if (result.sequenceStartTime) {
      const entry: ApproachingCourseEntry = {
        result,
        kind: 'transition',
        checkpointLabel: result.runnerProfile?.startsAfterBib
          ? `Leg after Bib #${result.runnerProfile.startsAfterBib}`
          : 'Transition leg',
        splitTimestamp: result.sequenceStartTime,
        splitTicks: timestampTicks(result.sequenceStartTime),
      };
      approaching.push(entry);
      activeOnCourse.push(entry);
    } else if (hasStartSplit) {
      const startSplit = result.splits.find((split) => split.checkpointId === startId);
      activeOnCourse.push({
        result,
        kind: 'started',
        checkpointLabel: checkpointById.get(startId!)?.cp.label || 'Start',
        splitTimestamp: startSplit?.timestamp,
        splitTicks: startSplit ? timestampTicks(startSplit.timestamp) : undefined,
      });
    } else if (hasWaveStarted) {
      activeOnCourse.push({
        result,
        kind: 'started',
        checkpointLabel: 'On course',
        splitTimestamp: waveStart,
        splitTicks: waveStart ? timestampTicks(waveStart) : undefined,
      });
    }
  }

  const sortByLatestSplit = (a: ApproachingCourseEntry, b: ApproachingCourseEntry) => {
    const orderA = checkpointById.get(
      a.result.splits.find((s) => s.timestamp === a.splitTimestamp)?.checkpointId || '',
    )?.cp.order ?? -1;
    const orderB = checkpointById.get(
      b.result.splits.find((s) => s.timestamp === b.splitTimestamp)?.checkpointId || '',
    )?.cp.order ?? -1;
    if (orderA !== orderB) return orderB - orderA;
    const ticksA = a.splitTicks ?? 0n;
    const ticksB = b.splitTicks ?? 0n;
    if (ticksA !== ticksB) return ticksB > ticksA ? 1 : -1;
    return a.result.bibNumber.localeCompare(b.result.bibNumber, undefined, { numeric: true });
  };

  approaching.sort(sortByLatestSplit);
  activeOnCourse.sort(sortByLatestSplit);

  const telemetry: BroadcastCourseTelemetry = {
    registered: scopedResults.filter((r) => !r.disqualified).length,
    started,
    onCourse,
    approaching: approaching.length,
    finished,
  };

  return { approaching, activeOnCourse, telemetry };
}

/** Builds ordered category/division views for a specific distance so shortcut keys can cycle cleanly. */
export function buildDistanceDivisionViews(
  race: Pick<Race, 'femaleOverallRankOverrides'>,
  results: RunnerResult[],
  distanceLabel: string,
): BroadcastDivisionView[] {
  if (distanceLabel === 'all') return [];
  const distanceResults = results.filter((result) => result.runnerProfile?.distance === distanceLabel);
  const folders = groupRankingFolders(distanceResults);
  const folder = folders.find((item) => item.distance === distanceLabel);

  const views: BroadcastDivisionView[] = [];
  const seenIds = new Set<string>();

  if (folder) {
    for (const sub of folder.subcategories) {
      if (seenIds.has(sub.id)) continue;
      seenIds.add(sub.id);
      const firstRunner = sub.results[0]?.runnerProfile;
      const divLabel = firstRunner
        ? `${distanceLabel} ${entryCategoryLabels[runnerEntryCategory(firstRunner)]}`
        : distanceLabel;
      views.push({
        id: sub.id,
        label: sub.label.replace(/\s+rankings$/i, ' Overall'),
        ranking: sub.ranking === 'age' ? 'age' : sub.ranking === 'special' ? 'special' : 'overall',
        divisionLabel: divLabel,
        results: sub.results,
        waveKeys: [divLabel, distanceLabel],
      });

      // Add Solo Male Overall & Solo Female Overall views when Solo finishers include female/male cohorts.
      if (sub.id === 'solo' && sub.ranking === 'overall') {
        const maleSolo = sub.results.filter((r) => !r.runnerProfile?.isFreeSlot && r.runnerProfile?.gender === 'male');
        const femaleSolo = orderFemaleOverallResults(sub.results, `${distanceLabel} Solo`, race);
        if (maleSolo.length > 0 && femaleSolo.length > 0) {
          views.push({
            id: 'solo-male-overall',
            label: 'Solo Male Overall',
            ranking: 'overall',
            divisionLabel: `${distanceLabel} Solo`,
            results: maleSolo,
            waveKeys: [`${distanceLabel} Solo`, distanceLabel],
          });
          views.push({
            id: 'solo-female-overall',
            label: 'Solo Female Overall',
            ranking: 'female-overall',
            divisionLabel: `${distanceLabel} Solo`,
            results: femaleSolo,
            waveKeys: [`${distanceLabel} Solo`, distanceLabel],
          });
        }
      }
    }
  }

  // Ensure a view exists before the first finisher crosses so active wave telemetry still displays.
  if (views.length === 0) {
    const entryCats = [...new Set(distanceResults.map((r) => runnerEntryCategory(r.runnerProfile)))];
    if (entryCats.length === 0) entryCats.push('solo');
    for (const entryCat of entryCats) {
      const divLabel = `${distanceLabel} ${entryCategoryLabels[entryCat]}`;
      views.push({
        id: entryCat,
        label: `${entryCategoryLabels[entryCat]} Overall`,
        ranking: 'overall',
        divisionLabel: divLabel,
        results: [],
        waveKeys: [divLabel, distanceLabel],
      });
    }
  }

  return views;
}

/** Shared source of truth for keyboard shortcuts shown in both TimingConsole and LiveRankingsScreen. */
export function buildBroadcastShortcutGuide(distanceLabels: string[]): {
  distanceKeys: BroadcastShortcutItem[];
  navigationKeys: BroadcastShortcutItem[];
} {
  const distanceKeys: BroadcastShortcutItem[] = [
    { keys: '0 / A', label: 'All distances' },
    ...distanceLabels.slice(0, 9).map((label, index) => ({
      keys: String(index + 1),
      label,
    })),
  ];

  const navigationKeys: BroadcastShortcutItem[] = [
    { keys: 'Left / Right', label: 'Previous or next distance' },
    { keys: 'Up / Down / C', label: 'Cycle division or age category' },
    { keys: 'Space / P', label: 'Pause or resume Rank #5+ auto-paging' },
    { keys: 'F', label: 'Toggle browser fullscreen' },
    { keys: 'H / ?', label: 'Show or hide shortcut guide on screen' },
    { keys: 'Esc', label: 'Exit Live Rankings broadcast' },
  ];

  return { distanceKeys, navigationKeys };
}

export function getDistanceLabelsForRace(race: Pick<Race, 'distances'>, results: RunnerResult[]): string[] {
  const folderDistances = groupRankingFolders(results).map((folder) => folder.distance);
  return [...new Set([
    ...race.distances.map((item) => item.label),
    ...folderDistances,
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function primaryWaveLabelForResult(result: RunnerResult): string {
  return runnerDivisionLabel(result.runnerProfile);
}
