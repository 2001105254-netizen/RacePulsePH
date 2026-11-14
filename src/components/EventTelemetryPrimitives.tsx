import React, { useId, useMemo, useState } from 'react';
import { Award, Radio, TrendingUp, Users2 } from 'lucide-react';
import { computeResults } from '../lib/timing';
import { AgeCategory, ChipRead, Race, RunnerProfile, RunnerResult } from '../types';

export const DISTANCE_PALETTE = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#06b6d4', '#a855f7'] as const;

const STANDARD_AGE_CUTS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: 'u18', label: 'Under 18', min: 1, max: 17 },
  { id: '18-29', label: '18-29', min: 18, max: 29 },
  { id: '30-39', label: '30-39', min: 30, max: 39 },
  { id: '40-49', label: '40-49', min: 40, max: 49 },
  { id: '50-59', label: '50-59', min: 50, max: 59 },
  { id: '60plus', label: '60+', min: 60, max: 120 },
];

const SHIRT_SIZE_ORDER = ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL'];

function matchConfiguredAgeCut(
  configured: AgeCategory[],
  runner: RunnerProfile,
): AgeCategory | undefined {
  if (runner.ageNotProvided || runner.isFreeSlot) return undefined;
  if (runner.ageCategoryOverrideId) {
    const override = configured.find(
      (cat) => cat.id === runner.ageCategoryOverrideId && cat.gender === runner.gender,
    );
    if (override) return override;
  }
  return configured.find(
    (cat) =>
      cat.gender === runner.gender &&
      runner.age >= cat.minAge &&
      runner.age <= cat.maxAge,
  );
}

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH');
const COMPACT_PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatPhp(value: number): string {
  return COMPACT_PHP_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatCompactPhp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '₱0';
  if (value >= 1000000) return `₱${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `₱${Math.round(value / 1000)}k`;
  return `₱${Math.round(value)}`;
}

export function formatShortDuration(totalSeconds: number | undefined): string {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--:--';
  const whole = Math.floor(totalSeconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

function parseIsoDayMs(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dayStr = trimmed.slice(0, 10);
  const parsed = Date.parse(`${dayStr}T00:00:00+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetween(laterDayStr: string, earlierDayStr: string): number {
  const a = parseIsoDayMs(laterDayStr);
  const b = parseIsoDayMs(earlierDayStr);
  if (a === null || b === null) return 0;
  return Math.round((a - b) / 86400000);
}

function build14DayCumulativeRegSeries(
  runners: RunnerProfile[],
  anchorDayStr: string,
): { series: number[]; labels: string[]; recent7dCount: number } {
  const POINTS = 14;
  if (runners.length === 0) {
    return {
      series: new Array(POINTS).fill(0),
      labels: ['D-13', 'D-7', 'Latest'],
      recent7dCount: 0,
    };
  }

  let minMs = Infinity;
  let maxMs = -Infinity;
  const dayTimestamps: number[] = [];

  for (const runner of runners) {
    const ms = parseIsoDayMs(runner.createdAt);
    if (ms !== null) {
      dayTimestamps.push(ms);
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }
  }

  const anchorMs = parseIsoDayMs(anchorDayStr) ?? Date.now();
  const recentCutoffMs = anchorMs - 7 * 86400000;
  let recent7dCount = 0;
  for (const ms of dayTimestamps) {
    if (ms >= recentCutoffMs) recent7dCount += 1;
  }

  // Anchor the 14-point window cleanly on the active registration span when timestamps exist
  const windowEndMs = Number.isFinite(maxMs) ? maxMs : anchorMs;
  const windowStartMs = Number.isFinite(minMs) && maxMs > minMs
    ? Math.max(minMs, windowEndMs - (POINTS - 1) * 86400000)
    : windowEndMs - (POINTS - 1) * 86400000;

  const spanMs = Math.max(1, windowEndMs - windowStartMs);
  const dailyCounts = new Array<number>(POINTS).fill(0);
  let priorCount = 0;

  for (const ms of dayTimestamps) {
    if (ms < windowStartMs) {
      priorCount += 1;
    } else {
      const idx = Math.min(
        POINTS - 1,
        Math.max(0, Math.round(((ms - windowStartMs) / spanMs) * (POINTS - 1))),
      );
      dailyCounts[idx] += 1;
    }
  }

  // Unknown-date entries land at the final slot so total always reconciles accurately
  const undated = runners.length - dayTimestamps.length;
  if (undated > 0) {
    dailyCounts[POINTS - 1] += undated;
  }

  const cumulative: number[] = [];
  let running = priorCount;
  for (let i = 0; i < POINTS; i += 1) {
    running += dailyCounts[i];
    cumulative.push(running);
  }

  const startLabel = new Date(windowStartMs).toISOString().slice(5, 10);
  const midLabel = new Date(windowStartMs + spanMs / 2).toISOString().slice(5, 10);
  const endLabel = new Date(windowEndMs).toISOString().slice(5, 10);

  return {
    series: cumulative,
    labels: [startLabel, midLabel, endLabel],
    recent7dCount,
  };
}

export interface DistanceBreakdown {
  id: string;
  label: string;
  km: number;
  price: number;
  runners: number;
  assignedBibs: number;
  taggedOrClaimed: number;
  capacity: number;
  estRevenue: number;
  color: string;
}

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  pct: number;
  detail: string;
  color: string;
}

export interface FinishWaveBucket {
  label: string;
  count: number;
  startMin: number;
}

export interface AgeCutStat {
  id: string;
  label: string;
  gender: 'all' | 'male' | 'female';
  count: number;
  pct: number;
  medianFinishSeconds?: number;
  fastestFinishSeconds?: number;
  color: string;
}

export interface DemographicStat {
  id: string;
  label: string;
  count: number;
  pct: number;
  color: string;
}

export interface RowMicroMetrics {
  assignedBibCount: number;
  recent7dRevenue: number;
  avgRevenuePerRunner: number;
  miniSparkline: number[];
}

export interface EventTelemetryData {
  raceId: string;
  raceName: string;
  raceDate: string;
  mode: 'upcoming' | 'completed';
  distances: DistanceBreakdown[];
  totalRunners: number;
  totalRevenue: number;
  assignedBibTotal: number;
  taggedOrClaimedTotal: number;
  recent7dRunners: number;
  recent7dRevenue: number;
  avgFeePerRunner: number;
  velocityData: number[];
  velocityLabels: string[];
  usingFinishScanSeries: boolean;
  benchmarkCurve: {
    current: number[];
    benchmark: number[];
    benchmarkName: string;
    daysToRace: number;
  };
  checkpointFunnel: FunnelStage[];
  finishBuckets: FinishWaveBucket[];
  medianFinishSeconds?: number;
  medianFinishLabel: string;
  fastestFinishLabel: string;
  peakBucketLabel: string;
  peakBucketCount: number;
  cutoffMinutes?: number;
  dnsCount: number;
  activeReadCount: number;
  ageCuts: AgeCutStat[];
  usingCustomAgeCuts: boolean;
  genderBreakdown: DemographicStat[];
  entryFormats: DemographicStat[];
  shirtSizes: DemographicStat[];
  ageSummary: {
    medianAge: number | null;
    minAge: number | null;
    maxAge: number | null;
    youthUnder18: number;
    masters50Plus: number;
    knownAgeCount: number;
    undisclosedCount: number;
  };
  paidCount: number;
  pendingPaymentCount: number;
  finishedCount: number;
  finishRatePct: number;
  chipTimedCount: number;
  gunTimedCount: number;
}

/** Pre-computes per-row micro visuals for the desktop Events table in a single O(N) pass. */
export function computeRowMicroMetrics(
  raceRunners: RunnerProfile[],
  sortedDistances: Race['distances'],
  todayStr: string,
): RowMicroMetrics {
  const priceByDistance = new Map<string, number>();
  for (const dist of sortedDistances) {
    priceByDistance.set(dist.label.trim(), dist.price || 0);
  }

  const anchorMs = parseIsoDayMs(todayStr) ?? Date.now();
  const weekCutoffMs = anchorMs - 7 * 86400000;
  const sparkline = new Array<number>(7).fill(0);

  let assignedBibCount = 0;
  let totalEstRevenue = 0;
  let recent7dRevenue = 0;

  for (const runner of raceRunners) {
    if ((runner.bibNumber || '').trim()) {
      assignedBibCount += 1;
    }
    const fee = priceByDistance.get((runner.distance || '').trim()) || 0;
    totalEstRevenue += fee;

    const createdMs = parseIsoDayMs(runner.createdAt);
    if (createdMs !== null && createdMs >= weekCutoffMs) {
      recent7dRevenue += fee;
      const bucketIdx = Math.min(6, Math.max(0, Math.floor(((createdMs - weekCutoffMs) / (7 * 86400000)) * 7)));
      sparkline[bucketIdx] += 1;
    }
  }

  const avgRevenuePerRunner = raceRunners.length > 0 ? Math.round(totalEstRevenue / raceRunners.length) : 0;

  return {
    assignedBibCount,
    recent7dRevenue,
    avgRevenuePerRunner,
    miniSparkline: sparkline,
  };
}

/** Aggregates raw runner rosters and checkpoint reads into <= 14 chart points. */
export function buildEventTelemetryData({
  race,
  raceRunners,
  allRaces,
  runnersByRace,
  chipReads,
  completed,
  todayStr,
}: {
  race: Race;
  raceRunners: RunnerProfile[];
  allRaces: Race[];
  runnersByRace: Map<string, RunnerProfile[]>;
  chipReads: ChipRead[];
  completed: boolean;
  todayStr: string;
}): EventTelemetryData {
  const sortedDistances = [...(race.distances || [])].sort((a, b) => a.km - b.km);
  const statsByLabel = new Map<
    string,
    { runners: number; assignedBibs: number; taggedOrClaimed: number }
  >();

  let assignedBibTotal = 0;
  let taggedOrClaimedTotal = 0;

  for (const runner of raceRunners) {
    const key = (runner.distance || '').trim();
    const bucket = statsByLabel.get(key) ?? { runners: 0, assignedBibs: 0, taggedOrClaimed: 0 };
    bucket.runners += 1;
    if ((runner.bibNumber || '').trim()) {
      bucket.assignedBibs += 1;
      assignedBibTotal += 1;
    }
    if ((runner.chipId || '').trim() || runner.kitClaimedAt) {
      bucket.taggedOrClaimed += 1;
      taggedOrClaimedTotal += 1;
    }
    statsByLabel.set(key, bucket);
  }

  const distances: DistanceBreakdown[] = sortedDistances.map((dist, idx) => {
    const entry = statsByLabel.get(dist.label.trim()) ?? {
      runners: 0,
      assignedBibs: 0,
      taggedOrClaimed: 0,
    };
    const estRevenue = entry.runners * (dist.price || 0);
    // Target capacity derives cleanly from current registration volume when explicit cap is unset
    const suggestedCap =
      entry.runners > 0
        ? Math.max(entry.runners, Math.ceil((entry.runners * 1.15) / 10) * 10)
        : 50;
    return {
      id: dist.id,
      label: dist.label,
      km: dist.km,
      price: dist.price || 0,
      runners: entry.runners,
      assignedBibs: entry.assignedBibs,
      taggedOrClaimed: entry.taggedOrClaimed,
      capacity: suggestedCap,
      estRevenue,
      color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    };
  });

  const totalRunners = raceRunners.length;
  const totalRevenue = distances.reduce((sum, item) => sum + item.estRevenue, 0);
  const regSeries = build14DayCumulativeRegSeries(raceRunners, todayStr);

  // Average revenue per runner + 7-day surge revenue
  const rowMetrics = computeRowMicroMetrics(raceRunners, sortedDistances, todayStr);

  // Pick a reference race for upcoming momentum comparison
  const referenceCandidates = allRaces
    .filter((candidate) => candidate.id !== race.id && (runnersByRace.get(candidate.id)?.length || 0) > 0)
    .sort((a, b) => (runnersByRace.get(b.id)?.length || 0) - (runnersByRace.get(a.id)?.length || 0));

  const referenceRace = referenceCandidates[0];
  const referenceRunners = referenceRace ? runnersByRace.get(referenceRace.id) || [] : [];
  const referenceSeries = referenceRace
    ? build14DayCumulativeRegSeries(referenceRunners, referenceRace.date || todayStr).series
    : regSeries.series;

  const normalizeCurve = (series: number[]): number[] => {
    const peak = Math.max(...series, 0);
    if (peak <= 0) return series.map(() => 0);
    return series.map((val) => Math.round((val / peak) * 100));
  };

  // Pre-aggregate RFID reads / official results for race-day & completed telemetry
  const checkpoints = race.checkpoints || [];
  const results = (completed || chipReads.length > 0) && raceRunners.length > 0
    ? computeResults(checkpoints, chipReads, raceRunners, race.ageCategories || [], race)
    : [];

  const intermediateCheckpointIds = new Set(
    [...checkpoints]
      .sort((a, b) => a.order - b.order)
      .filter((cp, idx, list) =>
        cp.type ? cp.type === 'intermediate' : idx > 0 && idx < list.length - 1,
      )
      .map((cp) => cp.id),
  );

  let startedCount = 0;
  let intermediateCount = 0;
  let finishedCount = 0;
  let disqualifiedCount = 0;
  const finishSecondsList: number[] = [];

  for (const res of results) {
    const hasStartedScan = res.splits.length > 0 || res.finishSeconds !== undefined;
    if (hasStartedScan) startedCount += 1;
    if (
      res.splits.some((split) => intermediateCheckpointIds.has(split.checkpointId)) ||
      (intermediateCheckpointIds.size === 0 && res.finishSeconds !== undefined)
    ) {
      intermediateCount += 1;
    }
    if (res.disqualified) {
      disqualifiedCount += 1;
    } else if (res.finishSeconds !== undefined) {
      finishedCount += 1;
      finishSecondsList.push(res.finishSeconds);
    }
  }

  finishSecondsList.sort((a, b) => a - b);
  const medianFinishSeconds =
    finishSecondsList.length > 0
      ? finishSecondsList[Math.floor(finishSecondsList.length / 2)]
      : undefined;

  const dnsCount = Math.max(0, totalRunners - startedCount);
  const unresolvedStarted = Math.max(0, startedCount - finishedCount - disqualifiedCount);
  const dnfTotal = completed ? unresolvedStarted + disqualifiedCount : disqualifiedCount;

  const checkpointFunnel: FunnelStage[] = [
    {
      id: 'registered',
      label: 'Registered',
      count: totalRunners,
      pct: totalRunners > 0 ? 100 : 0,
      detail: `${formatCount(dnsCount)} DNS`,
      color: '#3b82f6',
    },
    {
      id: 'started',
      label: 'Started',
      count: startedCount,
      pct: totalRunners > 0 ? Math.round((startedCount / totalRunners) * 100) : 0,
      detail: chipReads.length > 0 ? `${formatCount(chipReads.length)} scans` : '0 scans',
      color: '#10b981',
    },
    {
      id: 'split',
      label: intermediateCheckpointIds.size > 0 ? 'Split Mat' : 'Mid Check',
      count: intermediateCount,
      pct: totalRunners > 0 ? Math.round((intermediateCount / totalRunners) * 100) : 0,
      detail: `${intermediateCheckpointIds.size} ${intermediateCheckpointIds.size === 1 ? 'mat' : 'mats'}`,
      color: '#f59e0b',
    },
    {
      id: 'finished',
      label: 'Finished',
      count: finishedCount,
      pct: totalRunners > 0 ? Math.round((finishedCount / totalRunners) * 100) : 0,
      detail: medianFinishSeconds !== undefined ? `Med ${formatShortDuration(medianFinishSeconds)}` : 'Awaiting',
      color: '#10b981',
    },
    {
      id: 'dnf',
      label: completed ? 'DNF / Cut-off' : 'DQ / Hold',
      count: dnfTotal,
      pct: totalRunners > 0 ? Math.round((dnfTotal / totalRunners) * 100) : 0,
      detail: disqualifiedCount > 0 ? `${formatCount(disqualifiedCount)} DQ` : '0 DQ',
      color: '#ef4444',
    },
  ];

  // Bucket finish times into 14 uniform intervals (15-min base, auto-scaled for ultras)
  const BUCKET_COUNT = 14;
  let finishBuckets: FinishWaveBucket[] = [];
  let peakBucketLabel = 'No finish scans';
  let peakBucketCount = 0;

  if (finishSecondsList.length > 0) {
    const minMinutes = Math.floor(finishSecondsList[0] / 60 / 15) * 15;
    const maxMinutes = Math.ceil(finishSecondsList[finishSecondsList.length - 1] / 60 / 15) * 15;
    const rawSpan = Math.max(15, maxMinutes - minMinutes);
    const stepMinutes = Math.max(15, Math.ceil(rawSpan / BUCKET_COUNT / 15) * 15);

    finishBuckets = Array.from({ length: BUCKET_COUNT }, (_, idx) => {
      const startMin = minMinutes + idx * stepMinutes;
      const hrs = Math.floor(startMin / 60);
      const mins = startMin % 60;
      const label = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      return { label, count: 0, startMin };
    });

    for (const sec of finishSecondsList) {
      const min = sec / 60;
      const idx = Math.min(
        BUCKET_COUNT - 1,
        Math.max(0, Math.floor((min - minMinutes) / stepMinutes)),
      );
      finishBuckets[idx].count += 1;
    }

    for (const bucket of finishBuckets) {
      if (bucket.count > peakBucketCount) {
        peakBucketCount = bucket.count;
        peakBucketLabel = bucket.label;
      }
    }
  }

  // Index valid finish results by bib so age cuts can attach median & fastest times in O(N)
  const resultByBib = new Map<string, RunnerResult>();
  let chipTimedCount = 0;
  let gunTimedCount = 0;
  for (const res of results) {
    if (!res.disqualified && res.finishSeconds !== undefined) {
      resultByBib.set(res.bibNumber, res);
      if (res.timingMethod === 'gun') gunTimedCount += 1;
      else chipTimedCount += 1;
    }
  }

  // Age cuts (prefer organizer-configured ageCategories; fall back to standard cuts when unconfigured)
  const configuredAgeCats = race.ageCategories || [];
  const usingCustomAgeCuts = configuredAgeCats.length > 0;
  const ageCutCounts = new Map<
    string,
    { id: string; label: string; gender: 'all' | 'male' | 'female'; count: number; finishSecs: number[] }
  >();

  let maleCount = 0;
  let femaleCount = 0;
  let paidCount = 0;
  let pendingPaymentCount = 0;
  let youthUnder18 = 0;
  let masters50Plus = 0;
  let undisclosedAgeCount = 0;
  const validAges: number[] = [];
  const formatCounts = new Map<string, number>();
  const shirtCounts = new Map<string, number>();

  for (const runner of raceRunners) {
    if (runner.gender === 'female') femaleCount += 1;
    else maleCount += 1;

    if (runner.paymentStatus === 'paid') paidCount += 1;
    else if (runner.paymentStatus === 'pending') pendingPaymentCount += 1;

    const entryCat = (runner.entryCategory || 'solo').toLowerCase();
    const catLabel = entryCat.charAt(0).toUpperCase() + entryCat.slice(1);
    formatCounts.set(catLabel, (formatCounts.get(catLabel) || 0) + 1);

    const rawShirt = (runner.shirtSize || '').trim().toUpperCase();
    if (rawShirt) {
      shirtCounts.set(rawShirt, (shirtCounts.get(rawShirt) || 0) + 1);
    }

    const runnerRes = resultByBib.get(runner.bibNumber);
    const hasRealAge =
      !runner.ageNotProvided &&
      !runner.isFreeSlot &&
      Number.isFinite(runner.age) &&
      runner.age > 0 &&
      runner.age <= 120;

    if (hasRealAge) {
      validAges.push(runner.age);
      if (runner.age < 18) youthUnder18 += 1;
      if (runner.age >= 50) masters50Plus += 1;
    } else {
      undisclosedAgeCount += 1;
    }

    let bucketKey = 'unassigned';
    let bucketLabel = 'Open / Unspecified';
    let bucketGender: 'all' | 'male' | 'female' = 'all';

    if (usingCustomAgeCuts) {
      const matched = matchConfiguredAgeCut(configuredAgeCats, runner);
      if (matched) {
        bucketKey = matched.id;
        bucketLabel = matched.label;
        bucketGender = matched.gender;
      } else if (!hasRealAge) {
        bucketKey = 'unspecified';
        bucketLabel = 'Age Unspecified';
      } else {
        bucketKey = 'outside-cuts';
        bucketLabel = 'Outside Cuts';
      }
    } else if (hasRealAge) {
      const std = STANDARD_AGE_CUTS.find((cut) => runner.age >= cut.min && runner.age <= cut.max);
      if (std) {
        bucketKey = std.id;
        bucketLabel = std.label;
      }
    } else {
      bucketKey = 'unspecified';
      bucketLabel = 'Age Unspecified';
    }

    const existingCut = ageCutCounts.get(bucketKey) ?? {
      id: bucketKey,
      label: bucketLabel,
      gender: bucketGender,
      count: 0,
      finishSecs: [],
    };
    existingCut.count += 1;
    if (runnerRes?.finishSeconds !== undefined) {
      existingCut.finishSecs.push(runnerRes.finishSeconds);
    }
    ageCutCounts.set(bucketKey, existingCut);
  }

  validAges.sort((a, b) => a - b);
  const ageSummary = {
    medianAge: validAges.length > 0 ? validAges[Math.floor(validAges.length / 2)] : null,
    minAge: validAges.length > 0 ? validAges[0] : null,
    maxAge: validAges.length > 0 ? validAges[validAges.length - 1] : null,
    youthUnder18,
    masters50Plus,
    knownAgeCount: validAges.length,
    undisclosedCount: undisclosedAgeCount,
  };

  // Preserve organizer or age-bracket canonical ordering rather than unsorted map insertion
  const orderedAgeKeys = usingCustomAgeCuts
    ? [...configuredAgeCats.map((c) => c.id), 'outside-cuts', 'unspecified']
    : [...STANDARD_AGE_CUTS.map((c) => c.id), 'unspecified'];

  const ageCuts: AgeCutStat[] = orderedAgeKeys
    .map((key, idx) => {
      const entry = ageCutCounts.get(key);
      if (!entry || entry.count === 0) return null;
      const secs = [...entry.finishSecs].sort((a, b) => a - b);
      return {
        id: entry.id,
        label: entry.label,
        gender: entry.gender,
        count: entry.count,
        pct: totalRunners > 0 ? Math.round((entry.count / totalRunners) * 100) : 0,
        medianFinishSeconds: secs.length > 0 ? secs[Math.floor(secs.length / 2)] : undefined,
        fastestFinishSeconds: secs.length > 0 ? secs[0] : undefined,
        color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
      } as AgeCutStat;
    })
    .filter((item): item is AgeCutStat => item !== null);

  const genderBreakdown: DemographicStat[] =
    totalRunners > 0
      ? [
          {
            id: 'male',
            label: 'Male',
            count: maleCount,
            pct: Math.round((maleCount / totalRunners) * 100),
            color: '#3b82f6',
          },
          {
            id: 'female',
            label: 'Female',
            count: femaleCount,
            pct: Math.round((femaleCount / totalRunners) * 100),
            color: '#ec4899',
          },
        ]
      : [];

  const entryFormats: DemographicStat[] = Array.from(formatCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count], idx) => ({
      id: label.toLowerCase(),
      label,
      count,
      pct: totalRunners > 0 ? Math.round((count / totalRunners) * 100) : 0,
      color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    }));

  const shirtSizes: DemographicStat[] = Array.from(shirtCounts.entries())
    .sort((a, b) => {
      const ia = SHIRT_SIZE_ORDER.indexOf(a[0]);
      const ib = SHIRT_SIZE_ORDER.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b[1] - a[1];
    })
    .map(([label, count], idx) => ({
      id: `shirt-${label}`,
      label,
      count,
      pct: totalRunners > 0 ? Math.round((count / totalRunners) * 100) : 0,
      color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    }));

  const fastestFinishSeconds = finishSecondsList.length > 0 ? finishSecondsList[0] : undefined;
  const finishRatePct = totalRunners > 0 ? Math.round((finishedCount / totalRunners) * 100) : 0;

  const cutoffMinutes = checkpoints.find((cp) => typeof cp.cutoffMinutes === 'number')?.cutoffMinutes;
  const usingFinishScanSeries = (completed || chipReads.length > 0) && finishBuckets.some((b) => b.count > 0);
  const velocityData = usingFinishScanSeries
    ? finishBuckets.map((b) => b.count)
    : regSeries.series;
  const velocityLabels = usingFinishScanSeries
    ? [
        finishBuckets[0]?.label || '00:00',
        finishBuckets[Math.floor(finishBuckets.length / 2)]?.label || '',
        finishBuckets[finishBuckets.length - 1]?.label || '',
      ]
    : regSeries.labels;

  return {
    raceId: race.id,
    raceName: race.name,
    raceDate: race.date,
    mode: completed || chipReads.length > 0 ? 'completed' : 'upcoming',
    distances,
    totalRunners,
    totalRevenue,
    assignedBibTotal,
    taggedOrClaimedTotal,
    recent7dRunners: regSeries.recent7dCount,
    recent7dRevenue: rowMetrics.recent7dRevenue,
    avgFeePerRunner: rowMetrics.avgRevenuePerRunner,
    velocityData,
    velocityLabels,
    usingFinishScanSeries,
    benchmarkCurve: {
      current: normalizeCurve(regSeries.series),
      benchmark: normalizeCurve(referenceSeries),
      benchmarkName: referenceRace ? referenceRace.name : race.name,
      daysToRace: daysBetween(race.date, todayStr),
    },
    checkpointFunnel,
    finishBuckets,
    medianFinishSeconds,
    medianFinishLabel: formatShortDuration(medianFinishSeconds),
    fastestFinishLabel: formatShortDuration(fastestFinishSeconds),
    peakBucketLabel,
    peakBucketCount,
    cutoffMinutes,
    dnsCount,
    activeReadCount: chipReads.length,
    ageCuts,
    usingCustomAgeCuts,
    genderBreakdown,
    entryFormats,
    shirtSizes,
    ageSummary,
    paidCount,
    pendingPaymentCount,
    finishedCount,
    finishRatePct,
    chipTimedCount,
    gunTimedCount,
  };
}

export interface EventTelemetryCardProps {
  mode: 'upcoming' | 'completed';
  distances: DistanceBreakdown[];
  velocityData: number[];
  velocityLabels?: string[];
  usingFinishScanSeries?: boolean;
  medianFinishLabel?: string;
  peakBucketLabel?: string;
  peakBucketCount?: number;
  recent7dRunners?: number;
  canViewRoster: boolean;
  canViewRevenue: boolean;
  ageSummary?: EventTelemetryData['ageSummary'];
  genderBreakdown?: DemographicStat[];
  paidCount?: number;
  reportedTotalRunners?: number;
  topAgeCutLabel?: string;
}

/**
 * Right-hand inspector "Event Pulse" card combining segmented category share bar
 * and zero-dependency SVG velocity/finish-wave area sparkline.
 */
export const EventTelemetryCard: React.FC<EventTelemetryCardProps> = ({
  mode,
  distances,
  velocityData,
  velocityLabels = ['', '', ''],
  usingFinishScanSeries = false,
  medianFinishLabel = '--:--:--',
  peakBucketLabel = '',
  peakBucketCount = 0,
  recent7dRunners = 0,
  canViewRoster,
  canViewRevenue,
  ageSummary,
  genderBreakdown = [],
  paidCount = 0,
  reportedTotalRunners,
  topAgeCutLabel = '',
}) => {
  const gradientId = useId();
  const totalRunners = useMemo(
    () => reportedTotalRunners ?? distances.reduce((acc, item) => acc + item.runners, 0),
    [distances, reportedTotalRunners],
  );

  const { linePath, areaPath, lastPoint } = useMemo(() => {
    const width = 320;
    const height = 64;
    const safeSeries = velocityData.length > 1 ? velocityData : [0, 0];
    const max = Math.max(...safeSeries, 1);
    const stepX = width / (safeSeries.length - 1);

    const coords = safeSeries.map((val, index) => {
      const x = +(index * stepX).toFixed(1);
      const y = +(height - (val / max) * (height - 14) - 5).toFixed(1);
      return { x, y };
    });

    const line = `M ${coords.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    const area = `${line} L ${width},${height} L 0,${height} Z`;
    return {
      linePath: line,
      areaPath: area,
      lastPoint: coords[coords.length - 1] ?? { x: width, y: height - 5 },
    };
  }, [velocityData]);

  const sparkSummaryText = usingFinishScanSeries
    ? `Peak ${peakBucketLabel} (${formatCount(peakBucketCount)})`
    : recent7dRunners > 0
    ? `+${formatCount(recent7dRunners)} in 7d`
    : `${formatCount(totalRunners)} entries`;

  return (
    <div
      id="inspector_event_pulse_card"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 text-[var(--text-primary)] space-y-3"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {mode === 'upcoming' ? 'Event Pulse · Distance & Reg Velocity' : 'Event Pulse · Finisher Wave & Split'}
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {canViewRoster ? `${formatCount(totalRunners)} Total` : 'Restricted'}
        </span>
      </div>

      {/* Zero-DOM-Bloat Segmented Distribution Bar */}
      <div
        role="img"
        aria-label={`Distance distribution across ${distances.length} categories`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-card)] p-[1px]"
      >
        {canViewRoster && totalRunners > 0 ? (
          distances.map((dist) => {
            const pct = (dist.runners / totalRunners) * 100;
            return (
              <div
                key={dist.id}
                style={{ width: `${pct}%`, backgroundColor: dist.color }}
                className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-200"
                title={`${dist.label}: ${formatCount(dist.runners)} runners (${pct.toFixed(1)}%)`}
              />
            );
          })
        ) : (
          <div className="h-full w-full rounded-full bg-[var(--border-default)]/40" />
        )}
      </div>

      {/* Micro-Legend Grid */}
      {distances.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">No distance categories configured yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pb-3 border-b border-[var(--border-subtle)]">
          {distances.map((dist) => {
            const sharePct =
              canViewRoster && totalRunners > 0 ? Math.round((dist.runners / totalRunners) * 100) : 0;
            return (
              <div
                key={dist.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-1.5 min-w-0"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: dist.color }}
                      aria-hidden="true"
                    />
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                      {dist.label}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--text-secondary)] shrink-0">
                    {canViewRoster ? `${sharePct}%` : '--'}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-1 font-mono tabular-nums">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {canViewRoster ? formatCount(dist.runners) : '--'}
                  </span>
                  {canViewRoster && canViewRevenue && (
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                      {formatCompactPhp(dist.estRevenue)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* High-FPS Pure SVG Area Sparkline */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
          <span className="truncate">
            {usingFinishScanSeries
              ? 'Finish Chute Density (interval buckets)'
              : mode === 'completed'
              ? 'Cumulative Registration Curve (0 finish scans)'
              : 'Cumulative Registration Velocity'}
          </span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
            {canViewRoster ? sparkSummaryText : 'Restricted'}
          </span>
        </div>

        <svg
          viewBox="0 0 320 64"
          className="h-16 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label={usingFinishScanSeries ? 'Finish wave density sparkline' : 'Registration velocity sparkline'}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Dashed Early / Regular / Peak vertical markers */}
          <line x1="106" y1="4" x2="106" y2="62" stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 3" />
          <line x1="214" y1="4" x2="214" y2="62" stroke="#ef4444" strokeOpacity="0.45" strokeDasharray="3 3" />
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="#10b981"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {canViewRoster && (
            <circle cx={lastPoint.x} cy={lastPoint.y} r="2.75" fill="#10b981" />
          )}
        </svg>

        <div className="mt-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">
          <span>{velocityLabels[0] || 'Start'}</span>
          <span>
            {usingFinishScanSeries ? `Median ${medianFinishLabel}` : velocityLabels[1] || 'Mid'}
          </span>
          <span>{velocityLabels[2] || 'Latest'}</span>
        </div>
      </div>

      {/* Compact Runner Demographics & Age Cuts Strip */}
      {canViewRoster && ageSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--border-default)]">
          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Median Age</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {ageSummary.medianAge !== null ? `${ageSummary.medianAge} yrs` : '--'}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Gender M/F</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {(() => {
                const male = genderBreakdown.find((g) => g.id === 'male')?.pct ?? 0;
                const female = genderBreakdown.find((g) => g.id === 'female')?.pct ?? 0;
                return genderBreakdown.length > 0 ? `${male}/${female}%` : '--';
              })()}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] truncate">Peak Age Cut</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 truncate">
              {topAgeCutLabel || '--'}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-card)] px-2 py-1.5 border border-[var(--border-default)]/70">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
              {canViewRevenue ? 'Paid Share' : 'Age Span'}
            </div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              {canViewRevenue
                ? totalRunners > 0
                  ? `${Math.round((paidCount / totalRunners) * 100)}%`
                  : '0%'
                : ageSummary.minAge !== null && ageSummary.maxAge !== null
                ? `${ageSummary.minAge}-${ageSummary.maxAge}y`
                : '--'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export interface TableRunnerMicroBarProps {
  runnerCount: number;
  maxRunnerCount: number;
  assignedBibCount: number;
  completed: boolean;
}

/** 40x4px capacity + bib allocation micro-bar positioned under the Runners count. */
export const TableRunnerMicroBar: React.FC<TableRunnerMicroBarProps> = ({
  runnerCount,
  maxRunnerCount,
  assignedBibCount,
  completed,
}) => {
  const denom = Math.max(maxRunnerCount, runnerCount, 1);
  const fillPct = runnerCount > 0 ? Math.max(8, Math.min(100, Math.round((runnerCount / denom) * 100))) : 0;
  const bibPct = runnerCount > 0 ? Math.round((assignedBibCount / runnerCount) * 100) : 0;

  return (
    <div className="mt-1 flex flex-col items-end gap-0.5">
      <div
        className="w-10 h-1 rounded-full bg-[var(--surface-inset)] overflow-hidden border border-[var(--border-subtle)]"
        title={`${formatCount(assignedBibCount)}/${formatCount(runnerCount)} bibs assigned`}
      >
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{
            width: `${fillPct}%`,
            backgroundColor: completed ? '#a1a1aa' : fillPct >= 90 ? '#ef4444' : '#10b981',
          }}
        />
      </div>
      <span className="font-mono text-[10px] leading-none tabular-nums text-[var(--text-secondary)]">
        {runnerCount > 0 ? `${bibPct}% bib` : '0 bib'}
      </span>
    </div>
  );
};

export interface TableRevenueMicroPillProps {
  estRevenue: number;
  runnerCount: number;
  recent7dRevenue: number;
  avgRevenuePerRunner: number;
  sparkline: number[];
}

/** Compact inline velocity/yield indicator positioned under Est. Gross currency figures. */
export const TableRevenueMicroPill: React.FC<TableRevenueMicroPillProps> = ({
  estRevenue,
  runnerCount,
  recent7dRevenue,
  avgRevenuePerRunner,
  sparkline,
}) => {
  const has7dSurge = recent7dRevenue > 0;
  const maxBar = Math.max(...sparkline, 1);
  const label = has7dSurge
    ? `+${formatCompactPhp(recent7dRevenue)} 7d`
    : runnerCount > 0 && estRevenue > 0
    ? `${formatPhp(avgRevenuePerRunner)} avg`
    : 'No charges';

  return (
    <div className="mt-1 flex items-center justify-end gap-1.5">
      {has7dSurge && (
        <svg viewBox="0 0 28 10" className="w-7 h-2.5 shrink-0" aria-hidden="true">
          {sparkline.map((count, idx) => {
            const h = count > 0 ? Math.max(2, Math.round((count / maxBar) * 10)) : 1.5;
            return (
              <rect
                key={idx}
                x={idx * 4}
                y={10 - h}
                width="2.5"
                height={h}
                rx="0.5"
                fill={count > 0 ? '#10b981' : '#52525b'}
              />
            );
          })}
        </svg>
      )}
      <span
        className={`font-mono text-[10px] leading-none tabular-nums ${
          has7dSurge
            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
            : 'text-[var(--text-secondary)]'
        }`}
      >
        {label}
      </span>
    </div>
  );
};

export interface BottomTelemetryDockProps {
  telemetry: EventTelemetryData;
  canViewRoster: boolean;
  canViewRevenue: boolean;
  onOpenEngraving?: (raceId: string) => void;
}

/**
 * 2-Column Bottom-Center Telemetry Dock sitting beneath the Event Directory table
 * that switches automatically between Upcoming Readiness and Completed/Live RFID modes.
 */
export const BottomTelemetryDock: React.FC<BottomTelemetryDockProps> = ({
  telemetry,
  canViewRoster,
  canViewRevenue,
  onOpenEngraving,
}) => {
  const gradCurrentId = useId();
  const [dockTab, setDockTab] = useState<'telemetry' | 'demographics'>('telemetry');
  const isCompletedOrLive = telemetry.mode === 'completed';

  const comparisonPaths = useMemo(() => {
    const width = 360;
    const height = 84;
    const toPath = (values: number[]) => {
      const safe = values.length > 1 ? values : [0, 0];
      const max = Math.max(...safe, 100);
      const stepX = width / (safe.length - 1);
      const pts = safe.map((v, idx) => {
        const x = +(idx * stepX).toFixed(1);
        const y = +(height - (v / max) * (height - 14) - 6).toFixed(1);
        return `${x},${y}`;
      });
      const line = `M ${pts.join(' L ')}`;
      return {
        line,
        area: `${line} L ${width},${height} L 0,${height} Z`,
      };
    };

    return {
      current: toPath(telemetry.benchmarkCurve.current),
      benchmark: toPath(telemetry.benchmarkCurve.benchmark),
    };
  }, [telemetry.benchmarkCurve]);

  const maxBucket = Math.max(...telemetry.finishBuckets.map((b) => b.count), 1);

  return (
    <section
      id="events_bottom_telemetry_dock"
      aria-label="Selected event telemetry analytics dock"
      className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto border-t border-[var(--border-default)] bg-[var(--surface-card)]/95 p-3 sm:p-4 space-y-3"
    >
      {/* Dock Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <Radio className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate">
            Telemetry Dock · {telemetry.raceName}
          </h2>
          <span
            className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${
              isCompletedOrLive
                ? 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {isCompletedOrLive ? 'Checkpoint & Finisher Mode' : 'Upcoming Readiness Mode'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Telemetry dock view"
            className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dockTab === 'telemetry'}
              onClick={() => setDockTab('telemetry')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                dockTab === 'telemetry'
                  ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Telemetry
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dockTab === 'demographics'}
              onClick={() => setDockTab('demographics')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                dockTab === 'demographics'
                  ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Users2 className="w-3 h-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Age Cuts &amp; Stats</span>
            </button>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-[var(--text-secondary)]">
            <span>
              Bibs: <strong className="text-[var(--text-primary)]">{canViewRoster ? `${formatCount(telemetry.assignedBibTotal)}/${formatCount(telemetry.totalRunners)}` : '--'}</strong>
            </span>
            {canViewRoster && canViewRevenue && (
              <span>
                Avg Ticket: <strong className="text-emerald-700 dark:text-emerald-400">{formatPhp(telemetry.avgFeePerRunner)}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Adaptive 2-Column Panels */}
      {dockTab === 'demographics' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" role="tabpanel" aria-label="Age cuts and runner demographics">
          {/* Panel 1: Age Cuts & Divisions */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Age Cuts &amp; Divisions
              </span>
              <span className="px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] font-mono text-[10px] font-semibold text-[var(--text-secondary)] shrink-0">
                {telemetry.usingCustomAgeCuts ? 'Race Divisions' : 'Standard Brackets'}
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for age-cut statistics.</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Median</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {telemetry.ageSummary.medianAge !== null ? `${telemetry.ageSummary.medianAge}y` : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Range</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {telemetry.ageSummary.minAge !== null && telemetry.ageSummary.maxAge !== null
                        ? `${telemetry.ageSummary.minAge}-${telemetry.ageSummary.maxAge}`
                        : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Under 18</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCount(telemetry.ageSummary.youthUnder18)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Masters 50+</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatCount(telemetry.ageSummary.masters50Plus)}
                    </div>
                  </div>
                </div>

                {telemetry.ageCuts.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No age data recorded for registered runners yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {telemetry.ageCuts.map((cut) => (
                      <div key={cut.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: cut.color }}
                              aria-hidden="true"
                            />
                            <span className="font-semibold text-[var(--text-primary)] truncate">{cut.label}</span>
                            {cut.gender !== 'all' && (
                              <span className="px-1 py-0.5 rounded bg-[var(--surface-card)] border border-[var(--border-default)] text-[10px] font-mono uppercase text-[var(--text-secondary)] shrink-0">
                                {cut.gender === 'male' ? 'M' : 'F'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 font-mono tabular-nums shrink-0 text-[11px]">
                            {cut.medianFinishSeconds !== undefined && (
                              <span className="text-[var(--text-secondary)]">
                                Med {formatShortDuration(cut.medianFinishSeconds)}
                              </span>
                            )}
                            {cut.fastestFinishSeconds !== undefined && (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                Best {formatShortDuration(cut.fastestFinishSeconds)}
                              </span>
                            )}
                            <span className="font-semibold text-[var(--text-primary)]">
                              {formatCount(cut.count)} ({cut.pct}%)
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.max(cut.count > 0 ? 4 : 0, Math.min(100, cut.pct))}%`,
                              backgroundColor: cut.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {telemetry.ageSummary.undisclosedCount > 0 && (
                  <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                    Age unspecified / free slots: {formatCount(telemetry.ageSummary.undisclosedCount)}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Panel 2: Runner Demographics, Apparel & Operations */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Runner Demographics &amp; Apparel
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)] shrink-0">
                {canViewRoster ? `${formatCount(telemetry.totalRunners)} entries` : 'Restricted'}
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for demographic breakdown.</p>
            ) : (
              <>
                {/* Gender Distribution Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">Gender Split</span>
                    <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {telemetry.genderBreakdown.map((g) => (
                        <span key={g.id} className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} aria-hidden="true" />
                          <span>{g.label}: <strong className="text-[var(--text-primary)]">{formatCount(g.count)}</strong> ({g.pct}%)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-card)]">
                    {telemetry.genderBreakdown.map((g) => (
                      <div
                        key={g.id}
                        style={{ width: `${g.pct}%`, backgroundColor: g.color }}
                        className="h-full"
                        title={`${g.label}: ${formatCount(g.count)} (${g.pct}%)`}
                      />
                    ))}
                  </div>
                </div>

                {/* Entry Formats & Operations Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Paid / Pending</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatCount(telemetry.paidCount)} / {formatCount(telemetry.pendingPaymentCount)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Kits Claimed</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatCount(telemetry.taggedOrClaimedTotal)}/{formatCount(telemetry.totalRunners)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Finish Rate</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {telemetry.finishedCount > 0 ? `${telemetry.finishRatePct}% (${formatCount(telemetry.finishedCount)})` : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Chip / Gun</div>
                    <div className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                      {telemetry.chipTimedCount + telemetry.gunTimedCount > 0
                        ? `${formatCount(telemetry.chipTimedCount)} / ${formatCount(telemetry.gunTimedCount)}`
                        : '--'}
                    </div>
                  </div>
                </div>

                {/* Entry Format & Apparel Demand */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[var(--border-default)]">
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Entry Formats
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {telemetry.entryFormats.length === 0 ? (
                        <span className="text-xs text-[var(--text-secondary)]">--</span>
                      ) : (
                        telemetry.entryFormats.map((fmt) => (
                          <span
                            key={fmt.id}
                            className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-primary)]"
                          >
                            <span>{fmt.label}</span>
                            <strong className="text-emerald-700 dark:text-emerald-400">{formatCount(fmt.count)}</strong>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Shirt Size Demand
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {telemetry.shirtSizes.length === 0 ? (
                        <span className="text-xs text-[var(--text-secondary)]">--</span>
                      ) : (
                        telemetry.shirtSizes.map((sz) => (
                          <span
                            key={sz.id}
                            className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--text-primary)]"
                          >
                            <span>{sz.label}</span>
                            <strong>{formatCount(sz.count)}</strong>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : isCompletedOrLive ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Completed Panel 1: Checkpoint Funnel & Runner Status */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Checkpoint Funnel
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                {formatCount(telemetry.activeReadCount)} scans
              </span>
            </div>

            {!canViewRoster ? (
              <p className="text-xs text-[var(--text-secondary)]">Roster view permission required for funnel telemetry.</p>
            ) : (
              <div className="space-y-2">
                {telemetry.checkpointFunnel.map((stage) => (
                  <div key={stage.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[var(--text-primary)] truncate">{stage.label}</span>
                      <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                        <span className="text-[11px] text-[var(--text-secondary)]">{stage.detail}</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {formatCount(stage.count)} ({stage.pct}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${Math.max(stage.count > 0 ? 4 : 0, Math.min(100, stage.pct))}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Panel 2: Finish Time & Pace Wave Density */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                  {telemetry.finishBuckets.length > 0 ? 'Finish Wave' : 'Registration Curve Summary'}
                </span>
                {onOpenEngraving && telemetry.finishBuckets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenEngraving(telemetry.raceId)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600 text-[10px] font-semibold text-[var(--text-primary)] transition-colors shrink-0"
                  >
                    <Award className="w-3 h-3 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>Engrave Rush</span>
                  </button>
                )}
              </div>
              <span className="font-mono text-[11px] tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                {telemetry.finishBuckets.length > 0
                  ? `Median ${telemetry.medianFinishLabel}`
                  : `${formatCount(telemetry.totalRunners)} registered`}
              </span>
            </div>

            {telemetry.finishBuckets.length > 0 ? (
              <div className="space-y-1.5">
                <svg
                  viewBox="0 0 360 84"
                  className="h-24 lg:h-28 w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Finish wave histogram showing peak arrival rush and median line"
                >
                  {/* Histogram Bars */}
                  {telemetry.finishBuckets.map((bucket, idx) => {
                    const barW = 360 / telemetry.finishBuckets.length - 3;
                    const x = idx * (360 / telemetry.finishBuckets.length) + 1.5;
                    const h = bucket.count > 0 ? Math.max(4, (bucket.count / maxBucket) * 66) : 2;
                    const isPeak = bucket.label === telemetry.peakBucketLabel && bucket.count > 0;
                    return (
                      <rect
                        key={bucket.label}
                        x={x}
                        y={78 - h}
                        width={barW}
                        height={h}
                        rx="2"
                        fill={isPeak ? '#ef4444' : bucket.count > 0 ? '#10b981' : '#52525b'}
                        fillOpacity={bucket.count > 0 ? 0.85 : 0.25}
                      />
                    );
                  })}
                  {/* Vertical Crimson Median & Cut-off Indicator */}
                  <line x1="180" y1="4" x2="180" y2="80" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>

                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">
                  <span>First: {telemetry.finishBuckets[0]?.label}</span>
                  <span className="text-red-700 dark:text-red-400 font-semibold">
                    Peak Chute: {telemetry.peakBucketLabel} ({formatCount(telemetry.peakBucketCount)})
                  </span>
                  <span>
                    {telemetry.cutoffMinutes ? `Cut-off: ${telemetry.cutoffMinutes}m` : `Last: ${telemetry.finishBuckets[telemetry.finishBuckets.length - 1]?.label}`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <svg
                  viewBox="0 0 360 84"
                  className="h-20 w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Historical registration curve (no individual finish chip scans synced yet)"
                >
                  <defs>
                    <linearGradient id={gradCurrentId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={comparisonPaths.current.area} fill={`url(#${gradCurrentId})`} />
                  <path d={comparisonPaths.current.line} fill="none" stroke="#10b981" strokeWidth="1.75" />
                </svg>
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">
                  <span>0 RFID finish scans synced</span>
                  <span>Showing registration progression ({formatCount(telemetry.totalRunners)})</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Upcoming Panel 1: Bib Allocation & Kit Readiness Bullet Bars */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] inline-flex items-center gap-1.5 min-w-0 truncate">
                <Users2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span className="truncate">Bib Allocation &amp; Tag Readiness</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                {canViewRoster ? `${formatCount(telemetry.taggedOrClaimedTotal)} tagged` : 'Restricted'}
              </span>
            </div>

            {telemetry.distances.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">Configure distances in Race Setup to inspect allocations.</p>
            ) : (
              <div className="space-y-2">
                {telemetry.distances.slice(0, 4).map((dist) => {
                  const regPct = dist.capacity > 0 ? Math.min(100, Math.round((dist.runners / dist.capacity) * 100)) : 0;
                  const bibPct = dist.runners > 0 ? Math.round((dist.assignedBibs / dist.runners) * 100) : 0;
                  return (
                    <div key={dist.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dist.color }} aria-hidden="true" />
                          <span className="font-mono font-semibold text-[var(--text-primary)]">{dist.label}</span>
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)] shrink-0">
                          <strong className="text-[var(--text-primary)]">{canViewRoster ? formatCount(dist.runners) : '--'}</strong> reg · {canViewRoster ? `${bibPct}% bibs` : '--'}
                        </span>
                      </div>
                      {/* Bullet Gauge Bar */}
                      <div className="relative h-2 w-full rounded-full bg-[var(--surface-card)] overflow-hidden">
                        <div
                          className="h-full rounded-full opacity-35 transition-all duration-200"
                          style={{ width: `${canViewRoster ? regPct : 0}%`, backgroundColor: dist.color }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
                          style={{
                            width: `${canViewRoster ? Math.round((regPct * bibPct) / 100) : 0}%`,
                            backgroundColor: dist.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Panel 2: Cumulative Curve vs Reference Event */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] inline-flex items-center gap-1.5 truncate">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span className="truncate">Momentum vs. Benchmark</span>
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                {telemetry.benchmarkCurve.daysToRace >= 0
                  ? `T-${telemetry.benchmarkCurve.daysToRace}d`
                  : `T+${Math.abs(telemetry.benchmarkCurve.daysToRace)}d`}
              </span>
            </div>

            <svg
              viewBox="0 0 360 84"
              className="h-24 lg:h-28 w-full overflow-visible"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Cumulative registration pacing curve compared against ${telemetry.benchmarkCurve.benchmarkName}`}
            >
              <defs>
                <linearGradient id={gradCurrentId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {/* Benchmark dashed curve */}
              <path
                d={comparisonPaths.benchmark.line}
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                strokeOpacity="0.85"
              />
              {/* Active race curve */}
              <path d={comparisonPaths.current.area} fill={`url(#${gradCurrentId})`} />
              <path
                d={comparisonPaths.current.line}
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" aria-hidden="true" />
                Selected ({formatCount(telemetry.totalRunners)})
              </span>
              <span className="inline-flex items-center gap-1.5 truncate">
                <span className="w-2.5 h-0.5 border-t border-dashed border-red-500 inline-block" aria-hidden="true" />
                <span className="truncate">Ref: {telemetry.benchmarkCurve.benchmarkName}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
