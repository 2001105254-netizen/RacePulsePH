import { computeResults } from './timing';
import { runnerEntryCategory } from './raceEntry';
import { sanitizeCsvCell } from './security';
import { AgeCategory, ChipRead, Race, RunnerProfile, RunnerResult } from '../types';

export const DISTANCE_PALETTE = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#06b6d4', '#a855f7'] as const;

export type DataViewerCategory = 'performance' | 'financial' | 'demographics' | 'operations';

const STANDARD_AGE_CUTS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: 'u18', label: 'Under 18', min: 1, max: 17 },
  { id: '18-29', label: '18-29', min: 18, max: 29 },
  { id: '30-39', label: '30-39', min: 30, max: 39 },
  { id: '40-49', label: '40-49', min: 40, max: 49 },
  { id: '50-59', label: '50-59', min: 50, max: 59 },
  { id: '60plus', label: '60+', min: 60, max: 120 },
];

const SHIRT_SIZE_ORDER = ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL'];

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH');
const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

export function formatShortDuration(totalSeconds: number | undefined): string {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--:--';
  const whole = Math.floor(totalSeconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

export function formatPacePerKm(totalSeconds: number | undefined, km: number): string {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds <= 0 || !Number.isFinite(km) || km <= 0) {
    return '--:-- /km';
  }
  const secPerKm = totalSeconds / km;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  const adjMins = secs === 60 ? mins + 1 : mins;
  const adjSecs = secs === 60 ? 0 : secs;
  return `${String(adjMins).padStart(2, '0')}:${String(adjSecs).padStart(2, '0')} /km`;
}

function computePercentile(sortedValues: number[], pct: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

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

function build14PointSeries(
  entries: Array<{ timestamp?: string; value: number }>,
  anchorDayStr: string,
): { series: number[]; labels: string[]; recent7dSum: number } {
  const POINTS = 14;
  if (entries.length === 0) {
    return {
      series: new Array(POINTS).fill(0),
      labels: ['D-13', 'D-7', 'Latest'],
      recent7dSum: 0,
    };
  }

  let minMs = Infinity;
  let maxMs = -Infinity;
  const dated: Array<{ ms: number; value: number }> = [];
  let undatedSum = 0;

  for (const item of entries) {
    const ms = parseIsoDayMs(item.timestamp);
    if (ms !== null) {
      dated.push({ ms, value: item.value });
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    } else {
      undatedSum += item.value;
    }
  }

  const anchorMs = parseIsoDayMs(anchorDayStr) ?? Date.now();
  const recentCutoffMs = anchorMs - 7 * 86400000;
  let recent7dSum = 0;
  for (const item of dated) {
    if (item.ms >= recentCutoffMs) recent7dSum += item.value;
  }

  const windowEndMs = Number.isFinite(maxMs) ? maxMs : anchorMs;
  const windowStartMs = Number.isFinite(minMs) && maxMs > minMs
    ? Math.max(minMs, windowEndMs - (POINTS - 1) * 86400000)
    : windowEndMs - (POINTS - 1) * 86400000;

  const spanMs = Math.max(1, windowEndMs - windowStartMs);
  const buckets = new Array<number>(POINTS).fill(0);
  let priorSum = 0;

  for (const item of dated) {
    if (item.ms < windowStartMs) {
      priorSum += item.value;
    } else {
      const idx = Math.min(
        POINTS - 1,
        Math.max(0, Math.round(((item.ms - windowStartMs) / spanMs) * (POINTS - 1))),
      );
      buckets[idx] += item.value;
    }
  }

  if (undatedSum > 0) {
    buckets[POINTS - 1] += undatedSum;
  }

  const cumulative: number[] = [];
  let running = priorSum;
  for (let i = 0; i < POINTS; i += 1) {
    running += buckets[i];
    cumulative.push(running);
  }

  const startLabel = new Date(windowStartMs).toISOString().slice(5, 10);
  const midLabel = new Date(windowStartMs + spanMs / 2).toISOString().slice(5, 10);
  const endLabel = new Date(windowEndMs).toISOString().slice(5, 10);

  return {
    series: cumulative,
    labels: [startLabel, midLabel, endLabel],
    recent7dSum,
  };
}

function build14DayCumulativeRegSeries(
  runners: RunnerProfile[],
  anchorDayStr: string,
): { series: number[]; labels: string[]; recent7dCount: number } {
  const result = build14PointSeries(
    runners.map((runner) => ({ timestamp: runner.createdAt, value: 1 })),
    anchorDayStr,
  );
  return {
    series: result.series,
    labels: result.labels,
    recent7dCount: result.recent7dSum,
  };
}

function isRealAgeRunner(runner: RunnerProfile): boolean {
  return (
    !runner.ageNotProvided &&
    !runner.isFreeSlot &&
    Number.isFinite(runner.age) &&
    runner.age > 0 &&
    runner.age <= 120
  );
}

function runnerHeadcount(runner: RunnerProfile): number {
  const category = runnerEntryCategory(runner);
  if (category === 'solo') return 1;
  if (Array.isArray(runner.teamMembers) && runner.teamMembers.length > 0) {
    return runner.teamMembers.length;
  }
  if (category === 'duo') return 2;
  if (category === 'trio') return 3;
  return 4;
}

function isOnlinePaymentMethod(method: string | undefined): boolean {
  const normalized = (method || '').trim().toLowerCase();
  return Boolean(normalized) && normalized !== 'manual';
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

export interface DistancePerformanceRow {
  id: string;
  label: string;
  km: number;
  registered: number;
  started: number;
  finished: number;
  dns: number;
  dnf: number;
  dq: number;
  finishRatePct: number;
  fastestSeconds?: number;
  medianSeconds?: number;
  p90Seconds?: number;
  slowestSeconds?: number;
  avgPaceSecPerKm?: number;
  chipTimed: number;
  gunTimed: number;
  transitionTimed: number;
  color: string;
}

export interface GenderPerformanceRow {
  gender: 'male' | 'female';
  label: string;
  registered: number;
  finished: number;
  fastestSeconds?: number;
  medianSeconds?: number;
  avgPaceLabel: string;
}

export interface CheckpointThroughputRow {
  id: string;
  label: string;
  type: 'checkin' | 'start' | 'intermediate' | 'finish';
  scanCount: number;
  uniqueBibs: number;
  pctOfRegistered: number;
  cutoffMinutes?: number;
}

export interface TopFinisherPreview {
  bibNumber: string;
  fullName: string;
  distance: string;
  division: string;
  finishTime: string;
  finishSeconds: number;
  paceLabel: string;
  timingMethod: 'chip' | 'gun' | 'transition';
  overallRank: number;
}

export interface TimingHealthSummary {
  totalReads: number;
  rfidBridgeReads: number;
  manualReads: number;
  rfidSharePct: number;
  unmatchedBibs: string[];
  reviewFlaggedCount: number;
  missingStartCount: number;
  missingIntermediateCount: number;
  waveStartsConfigured: number;
  waveStartsTotal: number;
}

export interface DistanceFinancialRow {
  id: string;
  label: string;
  unitPrice: number;
  registrants: number;
  paidCount: number;
  collectedAmount: number;
  pendingCount: number;
  pendingAmount: number;
  unbilledCount: number;
  listPriceGross: number;
  shareOfCollectedPct: number;
  color: string;
}

export interface PendingPaymentRow {
  bibNumber: string;
  fullName: string;
  distance: string;
  amount: number;
  method: string;
  reference: string;
  createdAt: string;
}

export interface FinancialSummary {
  listPriceGross: number;
  collectedAmount: number;
  pendingAmount: number;
  unbilledEstimatedAmount: number;
  paidCount: number;
  pendingCount: number;
  unbilledCount: number;
  freeSlotCount: number;
  onlinePaidCount: number;
  onlinePaidAmount: number;
  manualPaidCount: number;
  manualPaidAmount: number;
  manualPendingCount: number;
  manualPendingAmount: number;
  collectionRatePct: number;
  avgRealizedTicket: number;
  recent7dCollectedAmount: number;
  dailyCollectionSeries: number[];
  dailyCollectionLabels: string[];
  onlineEnabled: boolean;
  manualEnabled: boolean;
  feeMode: 'absorbed' | 'passed_on';
  byDistance: DistanceFinancialRow[];
  pendingPayments: PendingPaymentRow[];
}

export interface GenderByDistanceRow {
  id: string;
  distanceLabel: string;
  maleCount: number;
  malePct: number;
  femaleCount: number;
  femalePct: number;
  total: number;
}

export interface ShirtInventoryRow {
  size: string;
  orderedCount: number;
  claimedCount: number;
  unclaimedCount: number;
  claimRatePct: number;
  byDistance: Record<string, number>;
}

export interface EntryFormatHeadcountRow {
  category: string;
  label: string;
  entriesCount: number;
  headcount: number;
  sharePct: number;
  color: string;
}

export interface ComplianceSummary {
  totalHeadcount: number;
  knownAgeCount: number;
  undisclosedAgeCount: number;
  meanAge: number | null;
  under13Count: number;
  under13ConsentCount: number;
  emergencyContactCount: number;
  emergencyContactPct: number;
  marketingOptInCount: number;
  marketingOptInPct: number;
  shirtSizeRecordedCount: number;
  shirtSizePct: number;
}

export interface OperationAttentionItem {
  id: string;
  kind: 'missing-bib' | 'missing-chip' | 'pending-payment' | 'unmatched-scan' | 'timing-review' | 'broken-relay';
  severity: 'high' | 'medium';
  bibNumber: string;
  title: string;
  detail: string;
  distance: string;
}

export interface OperationsAudit {
  missingBibCount: number;
  missingChipCount: number;
  assignedChipCount: number;
  unclaimedKitCount: number;
  claimedKitCount: number;
  freeSlotCount: number;
  relayLinksCount: number;
  brokenRelayLinks: Array<{ bibNumber: string; targetBib: string }>;
  unmappedDistanceCount: number;
  emergencyContactMissingCount: number;
  attentionItems: OperationAttentionItem[];
}

export interface PortfolioComparisonRow {
  raceId: string;
  raceName: string;
  raceDate: string;
  completed: boolean;
  registrationOpen: boolean;
  runners: number;
  headcount: number;
  bibPct: number;
  kitClaimPct: number;
  collectedAmount: number;
  pendingAmount: number;
  estGrossAmount: number;
  collectionRatePct: number;
  malePct: number;
  femalePct: number;
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
  p90FinishSeconds?: number;
  medianFinishLabel: string;
  p90FinishLabel: string;
  fastestFinishLabel: string;
  peakBucketLabel: string;
  peakBucketCount: number;
  cutoffMinutes?: number;
  dnsCount: number;
  dnfCount: number;
  disqualifiedCount: number;
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
  transitionTimedCount: number;
}

export interface EventViewerBundle {
  telemetry: EventTelemetryData;
  availableDistances: string[];
  activeDistanceFilter: string;
  performance: {
    byDistance: DistancePerformanceRow[];
    byGender: GenderPerformanceRow[];
    checkpoints: CheckpointThroughputRow[];
    topFinishers: TopFinisherPreview[];
    timingHealth: TimingHealthSummary;
  };
  financial: FinancialSummary;
  demographics: {
    genderByDistance: GenderByDistanceRow[];
    shirtInventory: ShirtInventoryRow[];
    entryFormatHeadcount: EntryFormatHeadcountRow[];
    compliance: ComplianceSummary;
  };
  operations: OperationsAudit;
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

/**
 * Aggregates full performance, financial, demographic, and operational telemetry
 * for a single race, optionally scoped to one distance filter.
 */
export function buildEventViewerBundle({
  race,
  raceRunners,
  allRaces,
  runnersByRace,
  chipReads,
  completed,
  todayStr,
  distanceFilter = 'all',
}: {
  race: Race;
  raceRunners: RunnerProfile[];
  allRaces: Race[];
  runnersByRace: Map<string, RunnerProfile[]>;
  chipReads: ChipRead[];
  completed: boolean;
  todayStr: string;
  distanceFilter?: string;
}): EventViewerBundle {
  const sortedDistances = [...(race.distances || [])].sort((a, b) => a.km - b.km);
  const availableDistances = sortedDistances.map((d) => d.label);
  const normalizedFilter = distanceFilter && distanceFilter !== 'all' ? distanceFilter.trim() : 'all';

  // Compute full-race results first so relay link chains and cross-distance reads resolve accurately
  const checkpoints = race.checkpoints || [];
  const allResults = (completed || chipReads.length > 0) && raceRunners.length > 0
    ? computeResults(checkpoints, chipReads, raceRunners, race.ageCategories || [], race)
    : [];

  const scopedRunners = normalizedFilter === 'all'
    ? raceRunners
    : raceRunners.filter((runner) => (runner.distance || '').trim() === normalizedFilter);
  const scopedBibs = new Set(scopedRunners.map((runner) => runner.bibNumber.trim()).filter(Boolean));
  const scopedResults = normalizedFilter === 'all'
    ? allResults
    : allResults.filter((res) => (res.runnerProfile?.distance || '').trim() === normalizedFilter);
  const scopedChipReads = normalizedFilter === 'all'
    ? chipReads
    : chipReads.filter((read) => scopedBibs.has(read.bibNumber.trim()));

  const scopedDistances = normalizedFilter === 'all'
    ? sortedDistances
    : sortedDistances.filter((dist) => dist.label.trim() === normalizedFilter);

  const statsByLabel = new Map<string, { runners: number; assignedBibs: number; taggedOrClaimed: number }>();
  let assignedBibTotal = 0;
  let taggedOrClaimedTotal = 0;

  for (const runner of scopedRunners) {
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

  const distances: DistanceBreakdown[] = scopedDistances.map((dist, idx) => {
    const entry = statsByLabel.get(dist.label.trim()) ?? {
      runners: 0,
      assignedBibs: 0,
      taggedOrClaimed: 0,
    };
    const estRevenue = entry.runners * (dist.price || 0);
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

  const totalRunners = scopedRunners.length;
  const totalRevenue = distances.reduce((sum, item) => sum + item.estRevenue, 0);
  const regSeries = build14DayCumulativeRegSeries(scopedRunners, todayStr);
  const rowMetrics = computeRowMicroMetrics(scopedRunners, scopedDistances, todayStr);

  // Reference event benchmark curve
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

  // Performance aggregation
  const orderedCheckpoints = [...checkpoints].sort((a, b) => a.order - b.order);
  const intermediateCheckpointIds = new Set(
    orderedCheckpoints
      .filter((cp, idx, list) => (cp.type ? cp.type === 'intermediate' : idx > 0 && idx < list.length - 1))
      .map((cp) => cp.id),
  );

  let startedCount = 0;
  let intermediateCount = 0;
  let finishedCount = 0;
  let disqualifiedCount = 0;
  const finishSecondsList: number[] = [];
  let reviewFlaggedCount = 0;
  let missingStartCount = 0;
  let missingIntermediateCount = 0;

  const resultByBib = new Map<string, RunnerResult>();
  let chipTimedCount = 0;
  let gunTimedCount = 0;
  let transitionTimedCount = 0;

  const distancePerfMap = new Map<
    string,
    {
      started: number;
      finished: number;
      dq: number;
      finishSecs: number[];
      chipTimed: number;
      gunTimed: number;
      transitionTimed: number;
      topFinishers: TopFinisherPreview[];
    }
  >();

  const kmByDistance = new Map<string, number>();
  const priceByDistance = new Map<string, number>();
  const colorByDistance = new Map<string, string>();
  sortedDistances.forEach((dist, idx) => {
    kmByDistance.set(dist.label.trim(), dist.km || 0);
    priceByDistance.set(dist.label.trim(), dist.price || 0);
    colorByDistance.set(dist.label.trim(), DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length]);
  });

  const genderPerfAccum = {
    male: { registered: 0, finishSecs: [] as number[], paceSum: 0, paceCount: 0 },
    female: { registered: 0, finishSecs: [] as number[], paceSum: 0, paceCount: 0 },
  };

  for (const runner of scopedRunners) {
    if (runner.gender === 'female') genderPerfAccum.female.registered += 1;
    else genderPerfAccum.male.registered += 1;
  }

  for (const res of scopedResults) {
    const distLabel = (res.runnerProfile?.distance || '').trim();
    const distEntry = distancePerfMap.get(distLabel) ?? {
      started: 0,
      finished: 0,
      dq: 0,
      finishSecs: [],
      chipTimed: 0,
      gunTimed: 0,
      transitionTimed: 0,
      topFinishers: [],
    };

    const hasStartedScan = res.splits.length > 0 || res.finishSeconds !== undefined;
    if (hasStartedScan) {
      startedCount += 1;
      distEntry.started += 1;
    }
    if (
      res.splits.some((split) => intermediateCheckpointIds.has(split.checkpointId)) ||
      (intermediateCheckpointIds.size === 0 && res.finishSeconds !== undefined)
    ) {
      intermediateCount += 1;
    }
    if (res.finishReviewRequired) reviewFlaggedCount += 1;
    if (res.missingStartScan) missingStartCount += 1;
    if (res.missingIntermediateLabels && res.missingIntermediateLabels.length > 0) missingIntermediateCount += 1;

    if (res.disqualified) {
      disqualifiedCount += 1;
      distEntry.dq += 1;
    } else if (res.finishSeconds !== undefined) {
      finishedCount += 1;
      distEntry.finished += 1;
      finishSecondsList.push(res.finishSeconds);
      distEntry.finishSecs.push(res.finishSeconds);
      resultByBib.set(res.bibNumber, res);

      if (res.timingMethod === 'transition') {
        transitionTimedCount += 1;
        distEntry.transitionTimed += 1;
      } else if (res.timingMethod === 'gun') {
        gunTimedCount += 1;
        distEntry.gunTimed += 1;
      } else {
        chipTimedCount += 1;
        distEntry.chipTimed += 1;
      }

      const km = kmByDistance.get(distLabel) || 0;
      const gBucket = res.runnerProfile?.gender === 'female' ? genderPerfAccum.female : genderPerfAccum.male;
      gBucket.finishSecs.push(res.finishSeconds);
      if (km > 0) {
        gBucket.paceSum += res.finishSeconds / km;
        gBucket.paceCount += 1;
      }

      if (res.runnerProfile && distEntry.topFinishers.length < 3) {
        const entryCat = runnerEntryCategory(res.runnerProfile);
        distEntry.topFinishers.push({
          bibNumber: res.bibNumber,
          fullName: res.runnerProfile.isFreeSlot ? `Free Slot #${res.bibNumber}` : res.runnerProfile.fullName,
          distance: distLabel,
          division: `${distLabel} ${entryCat.charAt(0).toUpperCase() + entryCat.slice(1)}`,
          finishTime: res.finishTime || formatShortDuration(res.finishSeconds),
          finishSeconds: res.finishSeconds,
          paceLabel: formatPacePerKm(res.finishSeconds, km),
          timingMethod: res.timingMethod || 'chip',
          overallRank: res.overallRank || distEntry.topFinishers.length + 1,
        });
      }
    }

    distancePerfMap.set(distLabel, distEntry);
  }

  finishSecondsList.sort((a, b) => a - b);
  const medianFinishSeconds = computePercentile(finishSecondsList, 50);
  const p90FinishSeconds = computePercentile(finishSecondsList, 90);
  const fastestFinishSeconds = finishSecondsList[0];

  const dnsCount = Math.max(0, totalRunners - startedCount);
  const unresolvedStarted = Math.max(0, startedCount - finishedCount - disqualifiedCount);
  const dnfTotal = completed ? unresolvedStarted + disqualifiedCount : disqualifiedCount;

  const checkpointFunnel: FunnelStage[] = [
    {
      id: 'registered',
      label: 'Registered',
      count: totalRunners,
      pct: totalRunners > 0 ? 100 : 0,
      detail: `${COUNT_FORMATTER.format(dnsCount)} DNS`,
      color: '#3b82f6',
    },
    {
      id: 'started',
      label: 'Started',
      count: startedCount,
      pct: totalRunners > 0 ? Math.round((startedCount / totalRunners) * 100) : 0,
      detail: scopedChipReads.length > 0 ? `${COUNT_FORMATTER.format(scopedChipReads.length)} scans` : '0 scans',
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
      detail: disqualifiedCount > 0 ? `${COUNT_FORMATTER.format(disqualifiedCount)} DQ` : '0 DQ',
      color: '#ef4444',
    },
  ];

  // 14-bucket finish wave histogram
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
      return { label: `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`, count: 0, startMin };
    });

    for (const sec of finishSecondsList) {
      const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor((sec / 60 - minMinutes) / stepMinutes)));
      finishBuckets[idx].count += 1;
    }

    for (const bucket of finishBuckets) {
      if (bucket.count > peakBucketCount) {
        peakBucketCount = bucket.count;
        peakBucketLabel = bucket.label;
      }
    }
  }

  // Per-distance performance matrix
  const byDistancePerf: DistancePerformanceRow[] = scopedDistances.map((dist, idx) => {
    const label = dist.label.trim();
    const reg = statsByLabel.get(label)?.runners || 0;
    const entry = distancePerfMap.get(label);
    const secs = entry ? [...entry.finishSecs].sort((a, b) => a - b) : [];
    const finished = entry?.finished || 0;
    const started = entry?.started || 0;
    const dq = entry?.dq || 0;
    const dns = Math.max(0, reg - started);
    const dnf = Math.max(0, started - finished - dq);
    const avgFinishSec = secs.length > 0 ? secs.reduce((s, v) => s + v, 0) / secs.length : undefined;

    return {
      id: dist.id,
      label: dist.label,
      km: dist.km,
      registered: reg,
      started,
      finished,
      dns,
      dnf,
      dq,
      finishRatePct: reg > 0 ? Math.round((finished / reg) * 100) : 0,
      fastestSeconds: secs[0],
      medianSeconds: computePercentile(secs, 50),
      p90Seconds: computePercentile(secs, 90),
      slowestSeconds: secs[secs.length - 1],
      avgPaceSecPerKm: avgFinishSec !== undefined && dist.km > 0 ? avgFinishSec / dist.km : undefined,
      chipTimed: entry?.chipTimed || 0,
      gunTimed: entry?.gunTimed || 0,
      transitionTimed: entry?.transitionTimed || 0,
      color: colorByDistance.get(label) || DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    };
  });

  const byGenderPerf: GenderPerformanceRow[] = (['male', 'female'] as const).map((g) => {
    const acc = genderPerfAccum[g];
    const secs = [...acc.finishSecs].sort((a, b) => a - b);
    const avgPaceSec = acc.paceCount > 0 ? acc.paceSum / acc.paceCount : undefined;
    return {
      gender: g,
      label: g === 'male' ? 'Male' : 'Female',
      registered: acc.registered,
      finished: secs.length,
      fastestSeconds: secs[0],
      medianSeconds: computePercentile(secs, 50),
      avgPaceLabel: avgPaceSec !== undefined ? formatPacePerKm(avgPaceSec, 1) : '--:-- /km',
    };
  });

  // Checkpoint throughput and RFID vs manual mix
  const controlMarkers = new Set(['__dequeue__', '__restore__', '__dq__', '__reinstate__']);
  const scansByCheckpoint = new Map<string, { count: number; bibs: Set<string> }>();
  const allRosterBibs = new Set(raceRunners.map((r) => r.bibNumber.trim().toUpperCase()).filter(Boolean));
  const unmatchedSet = new Set<string>();
  let rfidBridgeReads = 0;
  let manualReads = 0;

  for (const read of scopedChipReads) {
    if (controlMarkers.has(read.checkpointId)) continue;
    if (read.source === 'rfid-bridge') rfidBridgeReads += 1;
    else manualReads += 1;

    const bibNorm = (read.bibNumber || '').trim().toUpperCase();
    if (bibNorm && !allRosterBibs.has(bibNorm)) {
      unmatchedSet.add(read.bibNumber.trim());
    }

    const cpBucket = scansByCheckpoint.get(read.checkpointId) ?? { count: 0, bibs: new Set<string>() };
    cpBucket.count += 1;
    if (bibNorm) cpBucket.bibs.add(bibNorm);
    scansByCheckpoint.set(read.checkpointId, cpBucket);
  }

  const checkpointThroughput: CheckpointThroughputRow[] = orderedCheckpoints.map((cp, idx) => {
    const type = cp.type || (idx === 0 ? 'start' : idx === orderedCheckpoints.length - 1 ? 'finish' : 'intermediate');
    const bucket = scansByCheckpoint.get(cp.id);
    const uniqueBibs = bucket?.bibs.size || 0;
    return {
      id: cp.id,
      label: cp.label,
      type,
      scanCount: bucket?.count || 0,
      uniqueBibs,
      pctOfRegistered: totalRunners > 0 ? Math.round((uniqueBibs / totalRunners) * 100) : 0,
      cutoffMinutes: cp.cutoffMinutes,
    };
  });

  const topFinishers: TopFinisherPreview[] = [];
  for (const dist of scopedDistances) {
    const list = distancePerfMap.get(dist.label.trim())?.topFinishers || [];
    for (const item of list) topFinishers.push(item);
  }

  const validHardwareScans = rfidBridgeReads + manualReads;
  const waveStartsConfigured = race.waveStartTimes
    ? Object.values(race.waveStartTimes).filter(Boolean).length
    : race.gunStartTime
    ? 1
    : 0;
  const timingHealth: TimingHealthSummary = {
    totalReads: validHardwareScans,
    rfidBridgeReads,
    manualReads,
    rfidSharePct: validHardwareScans > 0 ? Math.round((rfidBridgeReads / validHardwareScans) * 100) : 0,
    unmatchedBibs: Array.from(unmatchedSet).sort(),
    reviewFlaggedCount,
    missingStartCount,
    missingIntermediateCount,
    waveStartsConfigured,
    waveStartsTotal: Math.max(sortedDistances.length, race.gunStartTime ? 1 : 0),
  };

  // Demographics, Age Cuts, Financial & Operations Single Pass over scopedRunners
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
  let unbilledCount = 0;
  let freeSlotCount = 0;
  let collectedAmount = 0;
  let pendingAmount = 0;
  let unbilledEstimatedAmount = 0;
  let onlinePaidCount = 0;
  let onlinePaidAmount = 0;
  let manualPaidCount = 0;
  let manualPaidAmount = 0;
  let manualPendingCount = 0;
  let manualPendingAmount = 0;

  const paymentTrendInputs: Array<{ timestamp?: string; value: number }> = [];
  const distFinanceMap = new Map<
    string,
    { registrants: number; paidCount: number; collectedAmount: number; pendingCount: number; pendingAmount: number; unbilledCount: number }
  >();
  const pendingPayments: PendingPaymentRow[] = [];

  let youthUnder18 = 0;
  let masters50Plus = 0;
  let undisclosedAgeCount = 0;
  let under13Count = 0;
  let under13ConsentCount = 0;
  let emergencyContactCount = 0;
  let marketingOptInCount = 0;
  let shirtSizeRecordedCount = 0;
  let totalHeadcount = 0;
  const validAges: number[] = [];

  const formatCounts = new Map<string, { entries: number; headcount: number }>();
  const shirtMap = new Map<string, { ordered: number; claimed: number; byDistance: Record<string, number> }>();
  const genderDistMap = new Map<string, { male: number; female: number }>();

  let missingBibCount = 0;
  let missingChipCount = 0;
  let assignedChipCount = 0;
  let claimedKitCount = 0;
  let unclaimedKitCount = 0;
  let relayLinksCount = 0;
  const brokenRelayLinks: Array<{ bibNumber: string; targetBib: string }> = [];
  let unmappedDistanceCount = 0;
  const configuredDistSet = new Set(sortedDistances.map((d) => d.label.trim()));
  const attentionItems: OperationAttentionItem[] = [];

  for (const runner of scopedRunners) {
    const distLabel = (runner.distance || '').trim();
    const listFee = priceByDistance.get(distLabel) || 0;
    const headcount = runnerHeadcount(runner);
    totalHeadcount += headcount;

    if (!configuredDistSet.has(distLabel)) {
      unmappedDistanceCount += 1;
    }

    if (runner.gender === 'female') femaleCount += 1;
    else maleCount += 1;

    const gDist = genderDistMap.get(distLabel) ?? { male: 0, female: 0 };
    if (runner.gender === 'female') gDist.female += 1;
    else gDist.male += 1;
    genderDistMap.set(distLabel, gDist);

    // Financial tracking
    const dfBucket = distFinanceMap.get(distLabel) ?? {
      registrants: 0,
      paidCount: 0,
      collectedAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      unbilledCount: 0,
    };
    dfBucket.registrants += 1;

    const recordedAmount = Math.max(0, Number(runner.paymentAmount ?? listFee) || 0);
    if (runner.isFreeSlot) freeSlotCount += 1;

    if (runner.paymentStatus === 'paid') {
      paidCount += 1;
      collectedAmount += recordedAmount;
      dfBucket.paidCount += 1;
      dfBucket.collectedAmount += recordedAmount;

      if (isOnlinePaymentMethod(runner.paymentMethod)) {
        onlinePaidCount += 1;
        onlinePaidAmount += recordedAmount;
      } else {
        manualPaidCount += 1;
        manualPaidAmount += recordedAmount;
      }
      paymentTrendInputs.push({
        timestamp: runner.paymentPaidAt || runner.createdAt,
        value: recordedAmount,
      });
    } else if (runner.paymentStatus === 'pending') {
      pendingPaymentCount += 1;
      pendingAmount += recordedAmount;
      dfBucket.pendingCount += 1;
      dfBucket.pendingAmount += recordedAmount;
      if (!isOnlinePaymentMethod(runner.paymentMethod)) {
        manualPendingCount += 1;
        manualPendingAmount += recordedAmount;
      }
      pendingPayments.push({
        bibNumber: runner.bibNumber || '--',
        fullName: runner.isFreeSlot ? `Free Slot #${runner.bibNumber}` : runner.fullName,
        distance: distLabel || 'Unassigned',
        amount: recordedAmount,
        method: runner.paymentMethod || 'manual',
        reference: runner.paymentReference || 'No reference',
        createdAt: runner.createdAt || '',
      });
      attentionItems.push({
        id: `pay-${runner.uid}-${runner.bibNumber}`,
        kind: 'pending-payment',
        severity: 'medium',
        bibNumber: runner.bibNumber || '--',
        title: `Pending payment (${runner.paymentMethod || 'manual'})`,
        detail: `${runner.fullName} - ₱${COUNT_FORMATTER.format(recordedAmount)}${runner.paymentReference ? ` (Ref: ${runner.paymentReference})` : ''}`,
        distance: distLabel,
      });
    } else {
      unbilledCount += 1;
      unbilledEstimatedAmount += listFee;
      dfBucket.unbilledCount += 1;
    }
    distFinanceMap.set(distLabel, dfBucket);

    // Entry format & apparel
    const entryCat = runnerEntryCategory(runner);
    const fmt = formatCounts.get(entryCat) ?? { entries: 0, headcount: 0 };
    fmt.entries += 1;
    fmt.headcount += headcount;
    formatCounts.set(entryCat, fmt);

    const rawShirt = (runner.shirtSize || '').trim().toUpperCase();
    if (rawShirt) {
      shirtSizeRecordedCount += 1;
      const sh = shirtMap.get(rawShirt) ?? { ordered: 0, claimed: 0, byDistance: {} };
      sh.ordered += 1;
      if (runner.kitClaimedAt) sh.claimed += 1;
      sh.byDistance[distLabel] = (sh.byDistance[distLabel] || 0) + 1;
      shirtMap.set(rawShirt, sh);
    }

    if ((runner.emergencyContactName || '').trim() && (runner.emergencyContactPhone || '').trim()) {
      emergencyContactCount += 1;
    }
    if (runner.marketingOptIn) marketingOptInCount += 1;

    // Operations readiness
    if (!(runner.bibNumber || '').trim()) {
      missingBibCount += 1;
      attentionItems.push({
        id: `bib-${runner.uid}-${runner.fullName}`,
        kind: 'missing-bib',
        severity: 'high',
        bibNumber: '--',
        title: 'Missing race bib assignment',
        detail: runner.fullName,
        distance: distLabel,
      });
    }
    if (!(runner.chipId || '').trim()) {
      missingChipCount += 1;
      if (attentionItems.filter((i) => i.kind === 'missing-chip').length < 25) {
        attentionItems.push({
          id: `chip-${runner.uid}-${runner.bibNumber}`,
          kind: 'missing-chip',
          severity: 'medium',
          bibNumber: runner.bibNumber || '--',
          title: 'No RFID chip assigned',
          detail: runner.isFreeSlot ? `Free Slot #${runner.bibNumber}` : runner.fullName,
          distance: distLabel,
        });
      }
    } else {
      assignedChipCount += 1;
    }

    if (runner.kitClaimedAt) claimedKitCount += 1;
    else unclaimedKitCount += 1;

    if (runner.startsAfterBib) {
      relayLinksCount += 1;
      if (!allRosterBibs.has(runner.startsAfterBib.trim().toUpperCase())) {
        brokenRelayLinks.push({ bibNumber: runner.bibNumber, targetBib: runner.startsAfterBib });
        attentionItems.push({
          id: `relay-${runner.uid}-${runner.bibNumber}`,
          kind: 'broken-relay',
          severity: 'high',
          bibNumber: runner.bibNumber,
          title: `Missing relay handoff #${runner.startsAfterBib}`,
          detail: `${runner.fullName} waits for bib #${runner.startsAfterBib}, which is not on the roster`,
          distance: distLabel,
        });
      }
    }

    // Age & Divisions
    const runnerRes = resultByBib.get(runner.bibNumber);
    const hasRealAge = isRealAgeRunner(runner);

    if (hasRealAge) {
      validAges.push(runner.age);
      if (runner.age < 13) {
        under13Count += 1;
        if (runner.parentalConsentConfirmed) under13ConsentCount += 1;
      }
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

  // Add unmatched RFID scans and flagged timing results into attentionItems
  for (const unmatchedBib of timingHealth.unmatchedBibs.slice(0, 20)) {
    attentionItems.push({
      id: `unmatched-${unmatchedBib}`,
      kind: 'unmatched-scan',
      severity: 'high',
      bibNumber: unmatchedBib,
      title: `Unmatched RFID scan #${unmatchedBib}`,
      detail: 'Checkpoint read exists with no matching runner record on the roster.',
      distance: '--',
    });
  }
  for (const res of scopedResults) {
    if (res.finishReviewRequired) {
      attentionItems.push({
        id: `review-${res.bibNumber}`,
        kind: 'timing-review',
        severity: 'medium',
        bibNumber: res.bibNumber,
        title: 'Close finish review window',
        detail: `${res.runnerProfile?.fullName || res.bibNumber} (${res.finishTime || '--'})`,
        distance: res.runnerProfile?.distance || '--',
      });
    }
  }

  validAges.sort((a, b) => a - b);
  const meanAge = validAges.length > 0
    ? Math.round((validAges.reduce((s, a) => s + a, 0) / validAges.length) * 10) / 10
    : null;
  const ageSummary = {
    medianAge: validAges.length > 0 ? validAges[Math.floor(validAges.length / 2)] : null,
    minAge: validAges.length > 0 ? validAges[0] : null,
    maxAge: validAges.length > 0 ? validAges[validAges.length - 1] : null,
    youthUnder18,
    masters50Plus,
    knownAgeCount: validAges.length,
    undisclosedCount: undisclosedAgeCount,
  };

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
        medianFinishSeconds: computePercentile(secs, 50),
        fastestFinishSeconds: secs[0],
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

  const entryFormatHeadcount: EntryFormatHeadcountRow[] = Array.from(formatCounts.entries())
    .sort((a, b) => b[1].entries - a[1].entries)
    .map(([category, stats], idx) => ({
      category,
      label: category.charAt(0).toUpperCase() + category.slice(1),
      entriesCount: stats.entries,
      headcount: stats.headcount,
      sharePct: totalRunners > 0 ? Math.round((stats.entries / totalRunners) * 100) : 0,
      color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    }));

  const entryFormats: DemographicStat[] = entryFormatHeadcount.map((row) => ({
    id: row.category,
    label: row.label,
    count: row.entriesCount,
    pct: row.sharePct,
    color: row.color,
  }));

  const sortedShirts = Array.from(shirtMap.entries()).sort((a, b) => {
    const ia = SHIRT_SIZE_ORDER.indexOf(a[0]);
    const ib = SHIRT_SIZE_ORDER.indexOf(b[0]);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return b[1].ordered - a[1].ordered;
  });

  const shirtInventory: ShirtInventoryRow[] = sortedShirts.map(([size, info]) => ({
    size,
    orderedCount: info.ordered,
    claimedCount: info.claimed,
    unclaimedCount: Math.max(0, info.ordered - info.claimed),
    claimRatePct: info.ordered > 0 ? Math.round((info.claimed / info.ordered) * 100) : 0,
    byDistance: info.byDistance,
  }));

  const shirtSizes: DemographicStat[] = sortedShirts.map(([size, info], idx) => ({
    id: `shirt-${size}`,
    label: size,
    count: info.ordered,
    pct: totalRunners > 0 ? Math.round((info.ordered / totalRunners) * 100) : 0,
    color: DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
  }));

  const genderByDistance: GenderByDistanceRow[] = scopedDistances.map((dist) => {
    const label = dist.label.trim();
    const g = genderDistMap.get(label) ?? { male: 0, female: 0 };
    const total = g.male + g.female;
    return {
      id: dist.id,
      distanceLabel: dist.label,
      maleCount: g.male,
      malePct: total > 0 ? Math.round((g.male / total) * 100) : 0,
      femaleCount: g.female,
      femalePct: total > 0 ? Math.round((g.female / total) * 100) : 0,
      total,
    };
  });

  const paymentTrend = build14PointSeries(paymentTrendInputs, todayStr);
  const billableTotal = collectedAmount + pendingAmount;
  const collectionRatePct = billableTotal > 0
    ? Math.round((collectedAmount / billableTotal) * 100)
    : paidCount > 0
    ? 100
    : 0;

  const byDistanceFinancial: DistanceFinancialRow[] = scopedDistances.map((dist, idx) => {
    const label = dist.label.trim();
    const df = distFinanceMap.get(label) ?? {
      registrants: 0,
      paidCount: 0,
      collectedAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      unbilledCount: 0,
    };
    return {
      id: dist.id,
      label: dist.label,
      unitPrice: dist.price || 0,
      registrants: df.registrants,
      paidCount: df.paidCount,
      collectedAmount: df.collectedAmount,
      pendingCount: df.pendingCount,
      pendingAmount: df.pendingAmount,
      unbilledCount: df.unbilledCount,
      listPriceGross: df.registrants * (dist.price || 0),
      shareOfCollectedPct: collectedAmount > 0 ? Math.round((df.collectedAmount / collectedAmount) * 100) : 0,
      color: colorByDistance.get(label) || DISTANCE_PALETTE[idx % DISTANCE_PALETTE.length],
    };
  });

  pendingPayments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const finishRatePct = totalRunners > 0 ? Math.round((finishedCount / totalRunners) * 100) : 0;
  const cutoffMinutes = checkpoints.find((cp) => typeof cp.cutoffMinutes === 'number')?.cutoffMinutes;
  const usingFinishScanSeries = (completed || scopedChipReads.length > 0) && finishBuckets.some((b) => b.count > 0);
  const velocityData = usingFinishScanSeries ? finishBuckets.map((b) => b.count) : regSeries.series;
  const velocityLabels = usingFinishScanSeries
    ? [
        finishBuckets[0]?.label || '00:00',
        finishBuckets[Math.floor(finishBuckets.length / 2)]?.label || '',
        finishBuckets[finishBuckets.length - 1]?.label || '',
      ]
    : regSeries.labels;

  const telemetry: EventTelemetryData = {
    raceId: race.id,
    raceName: race.name,
    raceDate: race.date,
    mode: completed || scopedChipReads.length > 0 ? 'completed' : 'upcoming',
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
    p90FinishSeconds,
    medianFinishLabel: formatShortDuration(medianFinishSeconds),
    p90FinishLabel: formatShortDuration(p90FinishSeconds),
    fastestFinishLabel: formatShortDuration(fastestFinishSeconds),
    peakBucketLabel,
    peakBucketCount,
    cutoffMinutes,
    dnsCount,
    dnfCount: unresolvedStarted,
    disqualifiedCount,
    activeReadCount: scopedChipReads.length,
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
    transitionTimedCount,
  };

  return {
    telemetry,
    availableDistances,
    activeDistanceFilter: normalizedFilter,
    performance: {
      byDistance: byDistancePerf,
      byGender: byGenderPerf,
      checkpoints: checkpointThroughput,
      topFinishers,
      timingHealth,
    },
    financial: {
      listPriceGross: totalRevenue,
      collectedAmount,
      pendingAmount,
      unbilledEstimatedAmount,
      paidCount,
      pendingCount: pendingPaymentCount,
      unbilledCount,
      freeSlotCount,
      onlinePaidCount,
      onlinePaidAmount,
      manualPaidCount,
      manualPaidAmount,
      manualPendingCount,
      manualPendingAmount,
      collectionRatePct,
      avgRealizedTicket: paidCount > 0 ? Math.round(collectedAmount / paidCount) : 0,
      recent7dCollectedAmount: paymentTrend.recent7dSum,
      dailyCollectionSeries: paymentTrend.series,
      dailyCollectionLabels: paymentTrend.labels,
      onlineEnabled: Boolean(race.onlinePaymentEnabled),
      manualEnabled: Boolean(race.manualPaymentEnabled),
      feeMode: race.paymentFeeMode || 'absorbed',
      byDistance: byDistanceFinancial,
      pendingPayments,
    },
    demographics: {
      genderByDistance,
      shirtInventory,
      entryFormatHeadcount,
      compliance: {
        totalHeadcount,
        knownAgeCount: validAges.length,
        undisclosedAgeCount,
        meanAge,
        under13Count,
        under13ConsentCount,
        emergencyContactCount,
        emergencyContactPct: totalRunners > 0 ? Math.round((emergencyContactCount / totalRunners) * 100) : 0,
        marketingOptInCount,
        marketingOptInPct: totalRunners > 0 ? Math.round((marketingOptInCount / totalRunners) * 100) : 0,
        shirtSizeRecordedCount,
        shirtSizePct: totalRunners > 0 ? Math.round((shirtSizeRecordedCount / totalRunners) * 100) : 0,
      },
    },
    operations: {
      missingBibCount,
      missingChipCount,
      assignedChipCount,
      unclaimedKitCount,
      claimedKitCount,
      freeSlotCount,
      relayLinksCount,
      brokenRelayLinks,
      unmappedDistanceCount,
      emergencyContactMissingCount: Math.max(0, totalRunners - emergencyContactCount),
      attentionItems,
    },
  };
}

/** Legacy compatibility wrapper preserving existing callers of buildEventTelemetryData. */
export function buildEventTelemetryData(params: {
  race: Race;
  raceRunners: RunnerProfile[];
  allRaces: Race[];
  runnersByRace: Map<string, RunnerProfile[]>;
  chipReads: ChipRead[];
  completed: boolean;
  todayStr: string;
}): EventTelemetryData {
  return buildEventViewerBundle(params).telemetry;
}

/** Builds a portfolio-wide comparison table across all authorized events. */
export function buildPortfolioComparison(
  races: Race[],
  runnersByRace: Map<string, RunnerProfile[]>,
  todayStr: string,
): PortfolioComparisonRow[] {
  return races.map((race) => {
    const raceRunners = runnersByRace.get(race.id) || [];
    const priceByDistance = new Map<string, number>();
    for (const dist of race.distances || []) {
      priceByDistance.set(dist.label.trim(), dist.price || 0);
    }

    let headcount = 0;
    let bibAssigned = 0;
    let kitClaimed = 0;
    let collectedAmount = 0;
    let pendingAmount = 0;
    let estGrossAmount = 0;
    let male = 0;
    let female = 0;

    for (const runner of raceRunners) {
      headcount += runnerHeadcount(runner);
      if ((runner.bibNumber || '').trim()) bibAssigned += 1;
      if (runner.kitClaimedAt) kitClaimed += 1;
      if (runner.gender === 'female') female += 1;
      else male += 1;

      const listPrice = priceByDistance.get((runner.distance || '').trim()) || 0;
      estGrossAmount += listPrice;
      const recordedAmount = Math.max(0, Number(runner.paymentAmount ?? listPrice) || 0);
      if (runner.paymentStatus === 'paid') collectedAmount += recordedAmount;
      else if (runner.paymentStatus === 'pending') pendingAmount += recordedAmount;
    }

    const total = raceRunners.length;
    const billable = collectedAmount + pendingAmount;
    const completed = Boolean(race.completedAt) || race.date < todayStr;
    const registrationOpen =
      !completed &&
      race.registrationOpen !== false &&
      (!race.registrationCloseDate || todayStr <= race.registrationCloseDate);

    return {
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      completed,
      registrationOpen,
      runners: total,
      headcount,
      bibPct: total > 0 ? Math.round((bibAssigned / total) * 100) : 0,
      kitClaimPct: total > 0 ? Math.round((kitClaimed / total) * 100) : 0,
      collectedAmount,
      pendingAmount,
      estGrossAmount,
      collectionRatePct: billable > 0 ? Math.round((collectedAmount / billable) * 100) : 0,
      malePct: total > 0 ? Math.round((male / total) * 100) : 0,
      femalePct: total > 0 ? Math.round((female / total) * 100) : 0,
    };
  });
}

function csvLine(cells: Array<string | number>): string {
  return cells.map((cell) => sanitizeCsvCell(cell)).join(',');
}

/** Generates formula-safe CSV exports tailored to the active category and permissions. */
export function buildAnalyticsCsv({
  scope,
  category,
  bundle,
  portfolio,
  canViewRevenue,
}: {
  scope: 'event' | 'portfolio';
  category: DataViewerCategory;
  bundle: EventViewerBundle | null;
  portfolio: PortfolioComparisonRow[];
  canViewRevenue: boolean;
}): { filename: string; csv: string } {
  if (scope === 'portfolio') {
    const header = [
      'Event',
      'Date',
      'Status',
      'Entries',
      'Headcount',
      'Bib Pct',
      'Kit Claim Pct',
      'Male Pct',
      'Female Pct',
      ...(canViewRevenue ? ['Collected PHP', 'Pending PHP', 'List Gross PHP', 'Collection Pct'] : []),
    ];
    const rows = portfolio.map((row) =>
      csvLine([
        row.raceName,
        row.raceDate,
        row.completed ? 'Completed' : 'Upcoming',
        row.runners,
        row.headcount,
        `${row.bibPct}%`,
        `${row.kitClaimPct}%`,
        `${row.malePct}%`,
        `${row.femalePct}%`,
        ...(canViewRevenue
          ? [row.collectedAmount, row.pendingAmount, row.estGrossAmount, `${row.collectionRatePct}%`]
          : []),
      ]),
    );
    return {
      filename: 'racepulse-portfolio-analytics.csv',
      csv: [csvLine(header), ...rows].join('\n'),
    };
  }

  if (!bundle) {
    return { filename: 'racepulse-event-analytics.csv', csv: '' };
  }

  const slug = bundle.telemetry.raceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || bundle.telemetry.raceId;

  if (category === 'financial' && canViewRevenue) {
    const header = ['Distance', 'Unit Fee PHP', 'Registrants', 'Paid Count', 'Collected PHP', 'Pending Count', 'Pending PHP', 'Unbilled Count', 'List Gross PHP', 'Collected Share Pct'];
    const rows = bundle.financial.byDistance.map((row) =>
      csvLine([
        row.label,
        row.unitPrice,
        row.registrants,
        row.paidCount,
        row.collectedAmount,
        row.pendingCount,
        row.pendingAmount,
        row.unbilledCount,
        row.listPriceGross,
        `${row.shareOfCollectedPct}%`,
      ]),
    );
    return { filename: `${slug}-financial-summary.csv`, csv: [csvLine(header), ...rows].join('\n') };
  }

  if (category === 'demographics') {
    const header = ['Shirt Size', 'Ordered', 'Claimed', 'Remaining', 'Claim Pct'];
    const rows = bundle.demographics.shirtInventory.map((row) =>
      csvLine([row.size, row.orderedCount, row.claimedCount, row.unclaimedCount, `${row.claimRatePct}%`]),
    );
    return { filename: `${slug}-demographics-apparel.csv`, csv: [csvLine(header), ...rows].join('\n') };
  }

  if (category === 'operations') {
    const header = ['Severity', 'Type', 'Bib', 'Distance', 'Issue', 'Detail'];
    const rows = bundle.operations.attentionItems.map((item) =>
      csvLine([item.severity, item.kind, item.bibNumber, item.distance, item.title, item.detail]),
    );
    return { filename: `${slug}-operations-audit.csv`, csv: [csvLine(header), ...rows].join('\n') };
  }

  const header = ['Distance', 'Km', 'Registered', 'Started', 'Finished', 'Finish Rate Pct', 'DNS', 'DNF', 'DQ', 'Fastest', 'Median', 'P90', 'Avg Pace'];
  const rows = bundle.performance.byDistance.map((row) =>
    csvLine([
      row.label,
      row.km,
      row.registered,
      row.started,
      row.finished,
      `${row.finishRatePct}%`,
      row.dns,
      row.dnf,
      row.dq,
      formatShortDuration(row.fastestSeconds),
      formatShortDuration(row.medianSeconds),
      formatShortDuration(row.p90Seconds),
      formatPacePerKm(row.avgPaceSecPerKm, 1),
    ]),
  );
  return { filename: `${slug}-performance-summary.csv`, csv: [csvLine(header), ...rows].join('\n') };
}
