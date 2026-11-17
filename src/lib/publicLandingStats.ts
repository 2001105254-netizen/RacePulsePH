import {
  buildEventViewerBundle,
  formatPacePerKm,
  formatShortDuration,
} from './eventAnalytics';
import { parseRaceDurationSeconds } from './preciseTime';
import { entryCategoryLabels, entryMemberCount } from './raceEntry';
import { isRaceRegistrationOpen, philippineDate } from './raceRegistration';
import type { RaceRouteCatalogEntry } from './routes/types';
import type {
  CheckpointType,
  ChipRead,
  PublicLeaderboardEntry,
  PublicLiveResults,
  PublicRaceStats,
  Race,
  RaceEntryCategory,
  RunnerProfile,
} from '../types';

export type PublicStatsCategory = 'performance' | 'demographics' | 'operations' | 'events';
export type PublicStatsEntryFilter = 'all' | RaceEntryCategory;

export interface ParsedDivisionLabel {
  baseDistance: string;
  entryCategory: RaceEntryCategory;
  isFreeSlot: boolean;
}

export interface PublicCourseFunnelStage {
  id: 'registered' | 'started' | 'split' | 'finished' | 'dnf';
  label: string;
  count: number;
  pct: number;
  detail: string;
  tone: 'neutral' | 'emerald' | 'amber' | 'red';
}

export interface PublicDistancePerformanceRow {
  label: string;
  km: number;
  raceCount: number;
  registered: number;
  started: number;
  finished: number;
  finishRatePct: number | null;
  dns: number;
  dnf: number;
  dq: number;
  fastestSeconds?: number;
  medianSeconds?: number;
  p90Seconds?: number;
  slowestSeconds?: number;
  avgPaceSecPerKm?: number;
  chipTimed: number;
  gunTimed: number;
  transitionTimed: number;
}

export interface PublicGenderSummaryRow {
  id: 'male' | 'female';
  label: string;
  registered: number;
  finished: number;
  sharePct: number;
  fastestSeconds?: number;
  medianSeconds?: number;
  avgPaceSecPerKm?: number;
  source: 'roster' | 'finishers';
}

export interface PublicAgeCutRow {
  id: string;
  label: string;
  gender: 'all' | 'male' | 'female';
  count: number;
  pct: number;
  fastestSeconds?: number;
  medianSeconds?: number;
  source: 'roster' | 'finishers';
}

export interface PublicEntryFormatRow {
  category: RaceEntryCategory | 'free-slot';
  label: string;
  entriesCount: number;
  headcount: number;
  sharePct: number;
  source: 'roster' | 'finishers';
}

export interface PublicCheckpointSummaryRow {
  id: string;
  label: string;
  type: CheckpointType;
  scanCount: number;
  uniqueBibs: number;
  pctOfRegistered: number | null;
  cutoffMinutes?: number;
  hasScanCounts: boolean;
}

export interface PublicReadinessMeter {
  id: string;
  label: string;
  pct: number;
  detail: string;
  available: boolean;
}

export interface PublicTopFinisherPreview {
  key: string;
  raceId: string;
  raceName: string;
  bibNumber: string;
  displayName: string;
  distance: string;
  baseDistance: string;
  categoryLabel?: string;
  finishTime: string;
  finishSeconds: number;
  paceLabel: string;
  timingMethod: 'chip' | 'gun' | 'transition';
  overallRank: number;
}

export interface PublicSpecialAwardEntry {
  key: string;
  raceId: string;
  raceName: string;
  bibNumber: string;
  displayName: string;
  distance: string;
  awards: string[];
  finishTime: string;
}

export interface PublicPortfolioEventRow {
  raceId: string;
  raceName: string;
  raceDate: string;
  status: 'live' | 'upcoming' | 'completed';
  distances: string[];
  checkpointCount: number;
  registered: number;
  headcount: number;
  started: number;
  finished: number;
  finishRatePct: number | null;
  fastestSeconds?: number;
  medianSeconds?: number;
  chipPct: number;
  malePct: number | null;
  femalePct: number | null;
  bibPct: number | null;
  kitClaimPct: number | null;
  hasCourseRoute: boolean;
  hasRosterStats: boolean;
}

export interface PublicRouteTerrainItem {
  id: string;
  raceId: string;
  raceName: string;
  distanceLabel: string;
  distanceKm: number;
  elevationGainM: number;
  checkpointCount: number;
}

export interface PublicLandingAnalyticsBundle {
  scope: 'portfolio' | 'event';
  selectedRace: Race | null;
  availableDistances: string[];
  availableRaces: Array<{ id: string; name: string; date: string; status: 'live' | 'upcoming' | 'completed' }>;
  overview: {
    totalEvents: number;
    upcomingEvents: number;
    liveEvents: number;
    completedEvents: number;
    totalRegistered: number;
    totalHeadcount: number;
    headcountEstimated: boolean;
    totalStarted: number;
    totalFinished: number;
    finishRatePct: number | null;
    dnsCount: number;
    dnfCount: number;
    dqCount: number;
    fastestSeconds?: number;
    medianSeconds?: number;
    p90Seconds?: number;
    slowestSeconds?: number;
    avgPaceSecPerKm?: number;
    chipCount: number;
    gunCount: number;
    transitionCount: number;
    chipPct: number;
    rfidReads: number;
    manualReads: number;
    rfidSharePct: number | null;
    recent7dRunners: number | null;
    hasRosterStats: boolean;
    hasTimingStats: boolean;
  };
  performance: {
    funnel: PublicCourseFunnelStage[];
    finishBuckets: Array<{ label: string; count: number; startMin: number }>;
    peakBucketLabel: string;
    peakBucketCount: number;
    velocitySeries: number[];
    velocityLabels: string[];
    hasVelocitySeries: boolean;
    byDistance: PublicDistancePerformanceRow[];
    byGender: PublicGenderSummaryRow[];
    genderSource: 'roster' | 'finishers' | 'none';
    checkpoints: PublicCheckpointSummaryRow[];
    topFinishers: PublicTopFinisherPreview[];
    specialAwards: PublicSpecialAwardEntry[];
    timingHealth: {
      totalReads: number;
      rfidReads: number;
      manualReads: number;
      rfidSharePct: number | null;
      unmatchedScans: number;
      reviewFlagged: number;
      missingStart: number;
      missingIntermediate: number;
      dqCount: number;
      waveStartsConfigured: number;
      waveStartsTotal: number;
    };
  };
  demographics: {
    genderSplit: PublicGenderSummaryRow[];
    genderSource: 'roster' | 'finishers' | 'none';
    genderByDistance: Array<{
      distanceLabel: string;
      maleCount: number;
      malePct: number;
      femaleCount: number;
      femalePct: number;
      total: number;
    }>;
    ageSummary: {
      medianAge: number | null;
      meanAge: number | null;
      minAge: number | null;
      maxAge: number | null;
      youthUnder18: number | null;
      masters50Plus: number | null;
      knownAgeCount: number;
      undisclosedCount: number;
      hasRosterAgeSummary: boolean;
    };
    ageCuts: PublicAgeCutRow[];
    ageCutsSource: 'roster' | 'finishers' | 'none';
    configuredDivisions: Array<{
      label: string;
      gender: 'male' | 'female';
      minAge: number;
      maxAge: number;
      raceCount: number;
    }>;
    entryFormats: PublicEntryFormatRow[];
    shirtInventory: Array<{
      size: string;
      orderedCount: number;
      claimedCount: number;
      unclaimedCount: number;
      claimRatePct: number;
    }>;
    compliance: {
      emergencyContactPct: number | null;
      shirtSizePct: number | null;
      under13Count: number | null;
      under13ConsentCount: number | null;
      marketingOptInPct: number | null;
      hasRosterCompliance: boolean;
    };
  };
  operations: {
    readinessMeters: PublicReadinessMeter[];
    hasRosterReadiness: boolean;
    bibsAssigned: number | null;
    bibsMissing: number | null;
    bibsPct: number | null;
    chipsAssigned: number | null;
    chipsMissing: number | null;
    chipsPct: number | null;
    kitsClaimed: number | null;
    kitsUnclaimed: number | null;
    kitsPct: number | null;
    freeSlotCount: number;
    relayLinksCount: number | null;
    brokenRelayLinksCount: number | null;
    unmappedDistanceCount: number | null;
    waveStartsConfigured: number;
    waveStartsTotal: number;
    checkpointsConfigured: number;
    checkpointsWithCutoff: number;
    reviewFlaggedCount: number;
    missingStartCount: number;
    missingIntermediateCount: number;
    dqCount: number;
    publishedRoutesCount: number;
    totalRouteKm: number;
    maxElevationGainM: number;
    routeItems: PublicRouteTerrainItem[];
  };
  portfolio: PublicPortfolioEventRow[];
}

const ENTRY_CATEGORY_TOKEN_RE = /\b(SOLO|DUO|TRIO|GROUP)\b/i;

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        clean[key] = stripUndefinedDeep(val);
      }
    }
    return clean as T;
  }
  return value;
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

function parseKmFromDistanceLabel(label: string): number {
  const match = /(\d+(?:\.\d+)?)\s*(?:K|KM)\b/i.exec(label);
  if (match) {
    const val = Number(match[1]);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }
  const lead = /^(\d+(?:\.\d+)?)/.exec(label.trim());
  if (lead) {
    const val = Number(lead[1]);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }
  return 0;
}

/** Normalizes division strings like "12K Duo Free Slots" into base distance + entry category. */
export function parseDistanceAndEntryCategory(rawLabel: string | undefined): ParsedDivisionLabel {
  const trimmed = (rawLabel || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') {
    return { baseDistance: '', entryCategory: 'solo', isFreeSlot: false };
  }
  const isFreeSlot = /\bFREE\s+SLOTS?\b/i.test(trimmed);
  let cleaned = trimmed.replace(/\bFREE\s+SLOTS?\b/gi, '').trim();
  const catMatch = ENTRY_CATEGORY_TOKEN_RE.exec(cleaned);
  let entryCategory: RaceEntryCategory = 'solo';
  if (catMatch) {
    entryCategory = catMatch[1].toLowerCase() as RaceEntryCategory;
    cleaned = cleaned.replace(ENTRY_CATEGORY_TOKEN_RE, '').trim();
  }
  const baseDistance = (cleaned || trimmed).replace(/\s+/g, ' ').trim().toUpperCase();
  return { baseDistance, entryCategory, isFreeSlot };
}

/** Infers gender from division bracket labels when only public categoryLabel strings exist. */
export function inferGenderFromDivisionLabel(label?: string): 'male' | 'female' | null {
  const norm = (label || '').trim().toLowerCase();
  if (!norm) return null;
  if (/^(female|women|woman|girls?|ladies|f\b|\d+.*\bf\b)/.test(norm) || /\bfemale\b|\bwomen\b|\bgirls?\b/.test(norm)) {
    return 'female';
  }
  if (/^(male|men|man|boys?|gents|m\b|\d+.*\bm\b)/.test(norm) || /\bmale\b|\bmen\b|\bboys?\b/.test(norm)) {
    return 'male';
  }
  return null;
}

function build14BucketFinishHistogram(finishSecondsList: number[]): {
  buckets: Array<{ label: string; count: number; startMin: number }>;
  peakBucketLabel: string;
  peakBucketCount: number;
} {
  if (finishSecondsList.length === 0) {
    return { buckets: [], peakBucketLabel: 'No finish scans', peakBucketCount: 0 };
  }
  const sorted = [...finishSecondsList].sort((a, b) => a - b);
  const BUCKET_COUNT = 14;
  const minMinutes = Math.floor(sorted[0] / 60 / 15) * 15;
  const maxMinutes = Math.ceil(sorted[sorted.length - 1] / 60 / 15) * 15;
  const rawSpan = Math.max(15, maxMinutes - minMinutes);
  const stepMinutes = Math.max(15, Math.ceil(rawSpan / BUCKET_COUNT / 15) * 15);

  const buckets = Array.from({ length: BUCKET_COUNT }, (_, idx) => {
    const startMin = minMinutes + idx * stepMinutes;
    const hrs = Math.floor(startMin / 60);
    const mins = startMin % 60;
    return {
      label: `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
      count: 0,
      startMin,
    };
  });

  for (const sec of sorted) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor((sec / 60 - minMinutes) / stepMinutes)));
    buckets[idx].count += 1;
  }

  let peakBucketLabel = buckets[0]?.label || '00:00';
  let peakBucketCount = 0;
  for (const bucket of buckets) {
    if (bucket.count > peakBucketCount) {
      peakBucketCount = bucket.count;
      peakBucketLabel = bucket.label;
    }
  }

  return { buckets, peakBucketLabel, peakBucketCount };
}

/**
 * Builds a strictly non-financial, zero-PII aggregate stats snapshot for public
 * `liveResults` documents from organizer roster and timing scan feeds.
 */
export function buildPublicRaceStats({
  race,
  raceRunners,
  chipReads,
  completed,
  canPublishTiming,
  todayStr = philippineDate(),
}: {
  race: Race;
  raceRunners: RunnerProfile[];
  chipReads: ChipRead[];
  completed: boolean;
  canPublishTiming: boolean;
  todayStr?: string;
}): PublicRaceStats {
  const effectiveReads = canPublishTiming ? chipReads : [];
  const effectiveCompleted = canPublishTiming && completed;

  const bundle = buildEventViewerBundle({
    race,
    raceRunners,
    allRaces: [race],
    runnersByRace: new Map([[race.id, raceRunners]]),
    chipReads: effectiveReads,
    completed: effectiveCompleted,
    todayStr,
  });

  const allFinishSecs: number[] = [];
  for (const row of bundle.performance.byDistance) {
    if (row.fastestSeconds !== undefined) allFinishSecs.push(row.fastestSeconds);
    if (row.slowestSeconds !== undefined) allFinishSecs.push(row.slowestSeconds);
  }
  const slowestSeconds = allFinishSecs.length > 0 ? Math.max(...allFinishSecs) : undefined;
  const fastestSeconds = allFinishSecs.length > 0 ? Math.min(...allFinishSecs) : undefined;

  const totalRunners = bundle.telemetry.totalRunners;
  const byDistPerfMap = new Map(bundle.performance.byDistance.map((r) => [r.label.trim().toUpperCase(), r]));
  const byDistBreakMap = new Map(bundle.telemetry.distances.map((r) => [r.label.trim().toUpperCase(), r]));

  const mergedDistances: PublicRaceStats['byDistance'] = [];
  const seenLabels = new Set<string>();
  for (const dist of race.distances || []) {
    const key = dist.label.trim().toUpperCase();
    if (!key || seenLabels.has(key)) continue;
    seenLabels.add(key);
    const perf = byDistPerfMap.get(key);
    const brk = byDistBreakMap.get(key);
    mergedDistances.push({
      label: dist.label,
      km: dist.km || parseKmFromDistanceLabel(dist.label),
      registered: perf?.registered ?? brk?.runners ?? 0,
      started: perf?.started ?? 0,
      finished: perf?.finished ?? 0,
      dns: perf?.dns ?? 0,
      dnf: perf?.dnf ?? 0,
      dq: perf?.dq ?? 0,
      finishRatePct: perf?.finishRatePct ?? 0,
      fastestSeconds: perf?.fastestSeconds,
      medianSeconds: perf?.medianSeconds,
      p90Seconds: perf?.p90Seconds,
      slowestSeconds: perf?.slowestSeconds,
      avgPaceSecPerKm: perf?.avgPaceSecPerKm,
      chipTimed: perf?.chipTimed ?? 0,
      gunTimed: perf?.gunTimed ?? 0,
      transitionTimed: perf?.transitionTimed ?? 0,
      bibsAssigned: brk?.assignedBibs ?? 0,
      taggedOrClaimed: brk?.taggedOrClaimed ?? 0,
    });
  }

  const genderPaceMap = new Map(bundle.performance.byGender.map((g) => [g.gender, g]));
  const genderSplit: PublicRaceStats['genderSplit'] = bundle.telemetry.genderBreakdown.map((g) => {
    const id = g.id === 'female' ? 'female' : 'male';
    const perf = genderPaceMap.get(id);
    const totalPaceCount = perf?.finished || 0;
    let avgPaceSecPerKm: number | undefined;
    if (perf?.avgPaceLabel && perf.avgPaceLabel.includes(':')) {
      const m = /^(\d+):(\d+)\s*\/km$/.exec(perf.avgPaceLabel);
      if (m) avgPaceSecPerKm = Number(m[1]) * 60 + Number(m[2]);
    }
    return {
      id,
      label: g.label,
      registered: g.count,
      finished: totalPaceCount,
      pct: g.pct,
      fastestSeconds: perf?.fastestSeconds,
      medianSeconds: perf?.medianSeconds,
      avgPaceSecPerKm,
    };
  });

  // Compute registration velocity from runner createdAt dates (pure anonymous counts)
  const regSeriesOnly = buildEventViewerBundle({
    race,
    raceRunners,
    allRaces: [race],
    runnersByRace: new Map([[race.id, raceRunners]]),
    chipReads: [],
    completed: false,
    todayStr,
  });

  const regPct = (count: number) => (totalRunners > 0 ? Math.round((count / totalRunners) * 100) : 0);

  const rawStats: PublicRaceStats = {
    headcount: bundle.demographics.compliance.totalHeadcount,
    dnsCount: canPublishTiming ? bundle.telemetry.dnsCount : 0,
    dnfCount: canPublishTiming ? bundle.telemetry.dnfCount : 0,
    dqCount: canPublishTiming ? bundle.telemetry.disqualifiedCount : 0,
    fastestSeconds,
    medianSeconds: bundle.telemetry.medianFinishSeconds,
    p90Seconds: bundle.telemetry.p90FinishSeconds,
    slowestSeconds,
    peakBucketLabel: bundle.telemetry.peakBucketLabel,
    peakBucketCount: bundle.telemetry.peakBucketCount,
    finishBuckets: bundle.telemetry.finishBuckets,
    registrationVelocity: {
      recent7dCount: bundle.telemetry.recent7dRunners,
      series: regSeriesOnly.telemetry.velocityData,
      labels: regSeriesOnly.telemetry.velocityLabels,
    },
    timingMix: {
      chip: bundle.telemetry.chipTimedCount,
      gun: bundle.telemetry.gunTimedCount,
      transition: bundle.telemetry.transitionTimedCount,
      rfidReads: bundle.performance.timingHealth.rfidBridgeReads,
      manualReads: bundle.performance.timingHealth.manualReads,
      rfidSharePct: bundle.performance.timingHealth.rfidSharePct,
      unmatchedScans: bundle.performance.timingHealth.unmatchedBibs.length,
      reviewFlagged: bundle.performance.timingHealth.reviewFlaggedCount,
      missingStart: bundle.performance.timingHealth.missingStartCount,
      missingIntermediate: bundle.performance.timingHealth.missingIntermediateCount,
    },
    genderSplit,
    genderByDistance: bundle.demographics.genderByDistance.map((row) => ({
      distanceLabel: row.distanceLabel,
      maleCount: row.maleCount,
      femaleCount: row.femaleCount,
      total: row.total,
    })),
    ageSummary: {
      medianAge: bundle.telemetry.ageSummary.medianAge,
      meanAge: bundle.demographics.compliance.meanAge,
      minAge: bundle.telemetry.ageSummary.minAge,
      maxAge: bundle.telemetry.ageSummary.maxAge,
      youthUnder18: bundle.telemetry.ageSummary.youthUnder18,
      masters50Plus: bundle.telemetry.ageSummary.masters50Plus,
      knownAgeCount: bundle.telemetry.ageSummary.knownAgeCount,
      undisclosedCount: bundle.telemetry.ageSummary.undisclosedCount,
    },
    usingCustomAgeCuts: bundle.telemetry.usingCustomAgeCuts,
    ageCuts: bundle.telemetry.ageCuts.map((cut) => ({
      id: cut.id,
      label: cut.label,
      gender: cut.gender,
      count: cut.count,
      pct: cut.pct,
      fastestSeconds: cut.fastestFinishSeconds,
      medianSeconds: cut.medianFinishSeconds,
    })),
    entryFormats: bundle.demographics.entryFormatHeadcount.map((fmt) => ({
      category: fmt.category,
      label: fmt.label,
      entriesCount: fmt.entriesCount,
      headcount: fmt.headcount,
      sharePct: fmt.sharePct,
    })),
    shirtInventory: bundle.demographics.shirtInventory.map((sz) => ({
      size: sz.size,
      orderedCount: sz.orderedCount,
      claimedCount: sz.claimedCount,
      unclaimedCount: sz.unclaimedCount,
      claimRatePct: sz.claimRatePct,
    })),
    checkpoints: bundle.performance.checkpoints.map((cp) => ({
      id: cp.id,
      label: cp.label,
      type: cp.type,
      scanCount: cp.scanCount,
      uniqueBibs: cp.uniqueBibs,
      pctOfRegistered: cp.pctOfRegistered,
      cutoffMinutes: cp.cutoffMinutes,
    })),
    readiness: {
      bibsAssigned: bundle.telemetry.assignedBibTotal,
      bibsAssignedPct: regPct(bundle.telemetry.assignedBibTotal),
      chipsAssigned: bundle.operations.assignedChipCount,
      chipsAssignedPct: regPct(bundle.operations.assignedChipCount),
      kitsClaimed: bundle.operations.claimedKitCount,
      kitsClaimedPct: regPct(bundle.operations.claimedKitCount),
      emergencyContactPct: bundle.demographics.compliance.emergencyContactPct,
      shirtSizePct: bundle.demographics.compliance.shirtSizePct,
      under13Count: bundle.demographics.compliance.under13Count,
      under13ConsentCount: bundle.demographics.compliance.under13ConsentCount,
      marketingOptInPct: bundle.demographics.compliance.marketingOptInPct,
      freeSlotCount: bundle.operations.freeSlotCount,
      relayLinksCount: bundle.operations.relayLinksCount,
      brokenRelayLinksCount: bundle.operations.brokenRelayLinks.length,
      unmappedDistanceCount: bundle.operations.unmappedDistanceCount,
      waveStartsConfigured: bundle.performance.timingHealth.waveStartsConfigured,
      waveStartsTotal: bundle.performance.timingHealth.waveStartsTotal,
    },
    byDistance: mergedDistances,
  };

  return stripUndefinedDeep(rawStats);
}

/**
 * Computes the complete non-financial public analytics bundle for the landing page.
 * Merges `liveResults.publicStats` when published and falls back seamlessly to
 * client-side aggregation over `races`, `liveResults.officialResults`, and `raceRouteCatalog`.
 */
export function computePublicLandingBundle({
  races,
  resultsByRaceId,
  routes = [],
  selectedRaceId = 'all',
  distanceFilter = 'all',
  entryCategoryFilter = 'all',
  todayStr = philippineDate(),
}: {
  races: Race[];
  resultsByRaceId: Record<string, PublicLiveResults>;
  routes?: RaceRouteCatalogEntry[];
  selectedRaceId?: string;
  distanceFilter?: string;
  entryCategoryFilter?: PublicStatsEntryFilter;
  todayStr?: string;
}): PublicLandingAnalyticsBundle {
  const normalizedSelectedRaceId =
    selectedRaceId && selectedRaceId !== 'all' && races.some((r) => r.id === selectedRaceId)
      ? selectedRaceId
      : 'all';
  const scope: 'portfolio' | 'event' = normalizedSelectedRaceId === 'all' ? 'portfolio' : 'event';
  const selectedRace = scope === 'event' ? races.find((r) => r.id === normalizedSelectedRaceId) || null : null;

  const raceStatusOf = (race: Race): 'live' | 'upcoming' | 'completed' => {
    if (race.completedAt) return 'completed';
    if (race.liveBroadcastEnabled) return 'live';
    if (race.date < todayStr) return 'completed';
    return 'upcoming';
  };

  const publishedRouteRaceIds = new Set(
    routes.filter((r) => r.status === 'published' && r.raceId).map((r) => r.raceId!),
  );

  // Pre-build available base distances across all races & results
  const baseDistanceSet = new Set<string>();
  const kmByDistanceLabel = new Map<string, number>();

  for (const race of races) {
    for (const dist of race.distances || []) {
      const parsed = parseDistanceAndEntryCategory(dist.label);
      if (parsed.baseDistance) {
        baseDistanceSet.add(parsed.baseDistance);
        if (dist.km > 0) kmByDistanceLabel.set(parsed.baseDistance, dist.km);
      }
    }
    const summary = resultsByRaceId[race.id];
    for (const entry of summary?.officialResults || []) {
      const parsed = parseDistanceAndEntryCategory(entry.distance);
      if (parsed.baseDistance) baseDistanceSet.add(parsed.baseDistance);
    }
  }

  const availableDistances = Array.from(baseDistanceSet).sort((a, b) => {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const normalizedDistFilter =
    distanceFilter && distanceFilter !== 'all' ? parseDistanceAndEntryCategory(distanceFilter).baseDistance : 'all';

  const scopedRaces = selectedRace ? [selectedRace] : races;

  // Build portfolio comparison rows across ALL races (always non-financial!)
  const portfolio: PublicPortfolioEventRow[] = races.map((race) => {
    const summary = resultsByRaceId[race.id];
    const pub = summary?.publicStats;
    const raceHasStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
    const resultsArePublic = !!race.completedAt || raceHasStarted;
    const entries = resultsArePublic
      ? (summary?.officialResults || []).filter((e) => e.distance !== 'Unknown')
      : [];

    const registered = summary?.totalRegistered ?? 0;
    const finished = resultsArePublic ? (entries.length || summary?.totalFinished || 0) : 0;
    const started = resultsArePublic ? Math.max(summary?.totalStarted ?? 0, finished) : 0;
    const finishRateDenom = Math.max(registered, started, finished);
    const finishRatePct =
      finishRateDenom > 0 && finished > 0 ? Math.min(100, Math.round((finished / finishRateDenom) * 100)) : null;

    const secs = entries
      .map((e) => parseRaceDurationSeconds(e.finishTime))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const chipCount = entries.filter((e) => e.timingMethod === 'chip' || !e.timingMethod).length;
    const chipPct = pub
      ? pub.timingMix.chip + pub.timingMix.gun + pub.timingMix.transition > 0
        ? Math.round((pub.timingMix.chip / (pub.timingMix.chip + pub.timingMix.gun + pub.timingMix.transition)) * 100)
        : 0
      : entries.length > 0
      ? Math.round((chipCount / entries.length) * 100)
      : 0;

    let malePct: number | null = null;
    let femalePct: number | null = null;
    if (pub && pub.genderSplit.length > 0) {
      malePct = pub.genderSplit.find((g) => g.id === 'male')?.pct ?? 0;
      femalePct = pub.genderSplit.find((g) => g.id === 'female')?.pct ?? 0;
    } else if (entries.length > 0) {
      let m = 0;
      let f = 0;
      for (const e of entries) {
        const g = inferGenderFromDivisionLabel(e.categoryLabel);
        if (g === 'female') f += 1;
        else if (g === 'male') m += 1;
      }
      if (m + f > 0) {
        malePct = Math.round((m / (m + f)) * 100);
        femalePct = 100 - malePct;
      }
    }

    let headcount = pub?.headcount ?? registered;
    if (!pub && entries.length > 0 && entries.length >= registered) {
      headcount = entries.reduce((sum, e) => {
        const parsed = parseDistanceAndEntryCategory(e.distance);
        return sum + entryMemberCount[parsed.entryCategory];
      }, 0);
    }

    return {
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      status: raceStatusOf(race),
      distances: (race.distances || []).map((d) => d.label),
      checkpointCount: (race.checkpoints || []).length,
      registered,
      headcount,
      started,
      finished,
      finishRatePct,
      fastestSeconds: pub?.fastestSeconds ?? secs[0],
      medianSeconds: pub?.medianSeconds ?? computePercentile(secs, 50),
      chipPct,
      malePct,
      femalePct,
      bibPct: pub ? pub.readiness.bibsAssignedPct : null,
      kitClaimPct: pub ? pub.readiness.kitsClaimedPct : null,
      hasCourseRoute: Boolean(race.routeGpxUrl || race.routeMapUrl || publishedRouteRaceIds.has(race.id)),
      hasRosterStats: Boolean(pub),
    };
  });

  // Aggregate scoped metrics
  let upcomingEvents = 0;
  let liveEvents = 0;
  let completedEvents = 0;
  let totalRegistered = 0;
  let totalHeadcount = 0;
  let headcountEstimated = false;
  let totalStarted = 0;
  let startedFieldRegistered = 0;
  let startedFieldStarted = 0;
  let finishedFieldDenominator = 0;
  let dqCount = 0;
  let recent7dRunnersSum = 0;
  let hasAnyRecent7d = false;
  let hasRosterStats = false;

  let rfidReadsTotal = 0;
  let manualReadsTotal = 0;
  let hasRfidTotals = false;
  let unmatchedScansTotal = 0;
  let reviewFlaggedFromPub = 0;
  let missingStartFromPub = 0;
  let missingIntermediateFromPub = 0;

  let waveStartsConfigured = 0;
  let waveStartsTotal = 0;
  let checkpointsConfigured = 0;
  let checkpointsWithCutoff = 0;

  // Distance map keyed by clean base distance (e.g. "5K", "12K")
  const distAccum = new Map<
    string,
    {
      label: string;
      km: number;
      raceIds: Set<string>;
      registered: number;
      started: number;
      finished: number;
      dns: number;
      dnf: number;
      dq: number;
      finishSecs: number[];
      paceSum: number;
      paceCount: number;
      chipTimed: number;
      gunTimed: number;
      transitionTimed: number;
      hasRosterBreakdown: boolean;
    }
  >();

  const ensureDistBucket = (baseDist: string, kmHint = 0) => {
    const existing = distAccum.get(baseDist);
    if (existing) {
      if (existing.km <= 0 && kmHint > 0) existing.km = kmHint;
      return existing;
    }
    const km = kmHint > 0 ? kmHint : kmByDistanceLabel.get(baseDist) || parseKmFromDistanceLabel(baseDist);
    const created = {
      label: baseDist,
      km,
      raceIds: new Set<string>(),
      registered: 0,
      started: 0,
      finished: 0,
      dns: 0,
      dnf: 0,
      dq: 0,
      finishSecs: [] as number[],
      paceSum: 0,
      paceCount: 0,
      chipTimed: 0,
      gunTimed: 0,
      transitionTimed: 0,
      hasRosterBreakdown: false,
    };
    distAccum.set(baseDist, created);
    return created;
  };

  // Finisher & roster accumulators
  const scopedFinishers: Array<{ race: Race; entry: PublicLeaderboardEntry; parsed: ParsedDivisionLabel; secs: number | null }> = [];
  const allFinishSeconds: number[] = [];
  let totalPaceSecPerKmSum = 0;
  let totalPaceSecPerKmCount = 0;
  let chipCount = 0;
  let gunCount = 0;
  let transitionCount = 0;
  let reviewFlaggedFromEntries = 0;
  let missingStartFromEntries = 0;
  let missingIntermediateFromEntries = 0;
  let freeSlotsFromEntries = 0;

  // Age cuts & special awards
  const ageCutMap = new Map<
    string,
    {
      id: string;
      label: string;
      gender: 'all' | 'male' | 'female';
      count: number;
      finishSecs: number[];
      rosterFastest?: number;
      rosterMedians: number[];
      fromRoster: boolean;
    }
  >();
  const configuredDivisionMap = new Map<
    string,
    { label: string; gender: 'male' | 'female'; minAge: number; maxAge: number; raceCount: number }
  >();
  const specialAwards: PublicSpecialAwardEntry[] = [];
  const topFinishers: PublicTopFinisherPreview[] = [];

  // Entry formats accumulators
  const formatFromPubMap = new Map<string, { label: string; entriesCount: number; headcount: number }>();
  const formatFromEntriesMap = new Map<RaceEntryCategory, { entriesCount: number; headcount: number }>();

  // Roster-level gender, age summary, shirts, readiness accumulators (only when publicStats exists)
  let pubGenderMale = { reg: 0, fin: 0, best: undefined as number | undefined, medians: [] as number[], paceSum: 0, paceCnt: 0 };
  let pubGenderFemale = { reg: 0, fin: 0, best: undefined as number | undefined, medians: [] as number[], paceSum: 0, paceCnt: 0 };
  let hasPubGender = false;
  const pubGenderDistMap = new Map<string, { maleCount: number; femaleCount: number; total: number }>();

  const pubAgeMedians: number[] = [];
  const pubAgeMeans: number[] = [];
  let pubAgeMin: number | null = null;
  let pubAgeMax: number | null = null;
  let pubYouthUnder18 = 0;
  let pubMasters50Plus = 0;
  let pubKnownAgeCount = 0;
  let pubUndisclosedAgeCount = 0;
  let hasPubAgeSummary = false;

  const shirtMap = new Map<string, { ordered: number; claimed: number }>();
  let pubBibsAssigned = 0;
  let pubChipsAssigned = 0;
  let pubKitsClaimed = 0;
  let pubEmergencyCount = 0;
  let pubShirtRecordedCount = 0;
  let pubMarketingCount = 0;
  let pubUnder13Count = 0;
  let pubUnder13ConsentCount = 0;
  let pubFreeSlotCount = 0;
  let pubRelayLinksCount = 0;
  let pubBrokenRelayLinksCount = 0;
  let pubUnmappedDistanceCount = 0;
  let pubRosterDenom = 0;
  let hasPubReadiness = false;

  let velocityAgg: number[] = [];
  let velocityLabels: string[] = [];
  const pubCheckpoints: PublicCheckpointSummaryRow[] = [];

  // Finisher-inferred gender & gender-by-distance
  const finGenderAccum = {
    male: { count: 0, secs: [] as number[], paceSum: 0, paceCnt: 0 },
    female: { count: 0, secs: [] as number[], paceSum: 0, paceCnt: 0 },
  };
  const finGenderDistMap = new Map<string, { male: number; female: number }>();

  const isFilteredByDistanceOrEntry = normalizedDistFilter !== 'all' || entryCategoryFilter !== 'all';

  for (const race of scopedRaces) {
    const status = raceStatusOf(race);
    if (status === 'live') liveEvents += 1;
    else if (status === 'completed') completedEvents += 1;
    else upcomingEvents += 1;

    const raceDistances = race.distances || [];
    const raceKmMap = new Map<string, number>();
    for (const d of raceDistances) {
      const parsed = parseDistanceAndEntryCategory(d.label);
      if (!parsed.baseDistance) continue;
      if (d.km > 0) raceKmMap.set(parsed.baseDistance, d.km);
      if (normalizedDistFilter === 'all' || parsed.baseDistance === normalizedDistFilter) {
        const bucket = ensureDistBucket(parsed.baseDistance, d.km);
        bucket.raceIds.add(race.id);
      }
    }

    // Wave starts & checkpoints configured
    const raceWaveCount = race.waveStartTimes
      ? Object.values(race.waveStartTimes).filter(Boolean).length
      : race.gunStartTime
      ? 1
      : 0;
    waveStartsConfigured += raceWaveCount;
    waveStartsTotal += Math.max(raceDistances.length, race.gunStartTime ? 1 : 0);

    const raceCheckpoints = race.checkpoints || [];
    checkpointsConfigured += raceCheckpoints.length;
    checkpointsWithCutoff += raceCheckpoints.filter((cp) => typeof cp.cutoffMinutes === 'number' && cp.cutoffMinutes > 0).length;

    // Configured age categories
    const seenCatInRace = new Set<string>();
    for (const cat of race.ageCategories || []) {
      const key = `${cat.label.trim().toLowerCase()}_${cat.minAge}_${cat.maxAge}_${cat.gender}`;
      if (seenCatInRace.has(key)) continue;
      seenCatInRace.add(key);
      const prev = configuredDivisionMap.get(key) || {
        label: cat.label,
        gender: cat.gender,
        minAge: cat.minAge,
        maxAge: cat.maxAge,
        raceCount: 0,
      };
      prev.raceCount += 1;
      configuredDivisionMap.set(key, prev);
    }

    const summary = resultsByRaceId[race.id];
    const pub = summary?.publicStats;
    const raceHasStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
    const resultsArePublic = !!race.completedAt || raceHasStarted;
    const rawEntries = resultsArePublic
      ? (summary?.officialResults || []).filter((e) => e.distance !== 'Unknown')
      : [];

    const matchingEntries = rawEntries.filter((entry) => {
      const parsed = parseDistanceAndEntryCategory(entry.distance);
      if (normalizedDistFilter !== 'all' && parsed.baseDistance !== normalizedDistFilter) return false;
      if (entryCategoryFilter !== 'all' && parsed.entryCategory !== entryCategoryFilter) return false;
      return true;
    });

    if (pub && !isFilteredByDistanceOrEntry) {
      hasRosterStats = true;
      totalRegistered += summary?.totalRegistered ?? 0;
      totalHeadcount += pub.headcount;
      const raceFinishedVal = resultsArePublic ? Math.max(summary?.totalFinished ?? 0, rawEntries.length) : 0;
      const raceStartedVal = resultsArePublic ? Math.max(summary?.totalStarted ?? 0, raceFinishedVal) : 0;
      totalStarted += raceStartedVal;
      if (resultsArePublic) {
        startedFieldRegistered += summary?.totalRegistered ?? 0;
        startedFieldStarted += raceStartedVal;
      }
      dqCount += resultsArePublic ? pub.dqCount : 0;

      if (pub.registrationVelocity) {
        hasAnyRecent7d = true;
        recent7dRunnersSum += pub.registrationVelocity.recent7dCount;
        if (pub.registrationVelocity.series.length > 0) {
          if (velocityAgg.length === 0) {
            velocityAgg = [...pub.registrationVelocity.series];
            velocityLabels = [...pub.registrationVelocity.labels];
          } else {
            velocityAgg = velocityAgg.map((val, idx) => val + (pub.registrationVelocity.series[idx] || 0));
          }
        }
      }

      hasRfidTotals = true;
      rfidReadsTotal += pub.timingMix.rfidReads;
      manualReadsTotal += pub.timingMix.manualReads;
      unmatchedScansTotal += pub.timingMix.unmatchedScans;
      reviewFlaggedFromPub += pub.timingMix.reviewFlagged;
      missingStartFromPub += pub.timingMix.missingStart;
      missingIntermediateFromPub += pub.timingMix.missingIntermediate;

      if (pub.genderSplit.length > 0) {
        hasPubGender = true;
        for (const g of pub.genderSplit) {
          const acc = g.id === 'female' ? pubGenderFemale : pubGenderMale;
          acc.reg += g.registered;
          acc.fin += g.finished;
          if (g.fastestSeconds !== undefined) {
            acc.best = acc.best === undefined ? g.fastestSeconds : Math.min(acc.best, g.fastestSeconds);
          }
          if (g.medianSeconds !== undefined) acc.medians.push(g.medianSeconds);
          if (g.avgPaceSecPerKm !== undefined && g.finished > 0) {
            acc.paceSum += g.avgPaceSecPerKm * g.finished;
            acc.paceCnt += g.finished;
          }
        }
      }

      for (const gd of pub.genderByDistance) {
        const parsed = parseDistanceAndEntryCategory(gd.distanceLabel);
        const key = parsed.baseDistance || gd.distanceLabel;
        const prev = pubGenderDistMap.get(key) || { maleCount: 0, femaleCount: 0, total: 0 };
        prev.maleCount += gd.maleCount;
        prev.femaleCount += gd.femaleCount;
        prev.total += gd.total;
        pubGenderDistMap.set(key, prev);
      }

      if (pub.ageSummary.knownAgeCount > 0) {
        hasPubAgeSummary = true;
        if (pub.ageSummary.medianAge !== null) pubAgeMedians.push(pub.ageSummary.medianAge);
        if (pub.ageSummary.meanAge !== null) pubAgeMeans.push(pub.ageSummary.meanAge);
        if (pub.ageSummary.minAge !== null) {
          pubAgeMin = pubAgeMin === null ? pub.ageSummary.minAge : Math.min(pubAgeMin, pub.ageSummary.minAge);
        }
        if (pub.ageSummary.maxAge !== null) {
          pubAgeMax = pubAgeMax === null ? pub.ageSummary.maxAge : Math.max(pubAgeMax, pub.ageSummary.maxAge);
        }
        pubYouthUnder18 += pub.ageSummary.youthUnder18;
        pubMasters50Plus += pub.ageSummary.masters50Plus;
        pubKnownAgeCount += pub.ageSummary.knownAgeCount;
        pubUndisclosedAgeCount += pub.ageSummary.undisclosedCount;
      }

      for (const fmt of pub.entryFormats) {
        const prev = formatFromPubMap.get(fmt.category) || {
          label: fmt.label,
          entriesCount: 0,
          headcount: 0,
        };
        prev.entriesCount += fmt.entriesCount;
        prev.headcount += fmt.headcount;
        formatFromPubMap.set(fmt.category, prev);
      }

      for (const sz of pub.shirtInventory) {
        const prev = shirtMap.get(sz.size) || { ordered: 0, claimed: 0 };
        prev.ordered += sz.orderedCount;
        prev.claimed += sz.claimedCount;
        shirtMap.set(sz.size, prev);
      }

      const regCount = summary?.totalRegistered ?? 0;
      if (regCount > 0) {
        hasPubReadiness = true;
        pubRosterDenom += regCount;
        pubBibsAssigned += pub.readiness.bibsAssigned;
        pubChipsAssigned += pub.readiness.chipsAssigned;
        pubKitsClaimed += pub.readiness.kitsClaimed;
        pubEmergencyCount += Math.round((pub.readiness.emergencyContactPct / 100) * regCount);
        pubShirtRecordedCount += Math.round((pub.readiness.shirtSizePct / 100) * regCount);
        pubMarketingCount += Math.round((pub.readiness.marketingOptInPct / 100) * regCount);
        pubUnder13Count += pub.readiness.under13Count;
        pubUnder13ConsentCount += pub.readiness.under13ConsentCount;
        pubFreeSlotCount += pub.readiness.freeSlotCount;
        pubRelayLinksCount += pub.readiness.relayLinksCount;
        pubBrokenRelayLinksCount += pub.readiness.brokenRelayLinksCount;
        pubUnmappedDistanceCount += pub.readiness.unmappedDistanceCount;
      }

      if (scope === 'event' && pub.checkpoints.length > 0) {
        for (const cp of pub.checkpoints) {
          pubCheckpoints.push({
            id: cp.id,
            label: cp.label,
            type: cp.type,
            scanCount: cp.scanCount,
            uniqueBibs: cp.uniqueBibs,
            pctOfRegistered: cp.pctOfRegistered,
            cutoffMinutes: cp.cutoffMinutes,
            hasScanCounts: true,
          });
        }
      }
    } else if (summary) {
      if (!isFilteredByDistanceOrEntry) {
        totalRegistered += summary.totalRegistered || 0;
        const rawFinishedInRace = resultsArePublic ? Math.max(summary.totalFinished || 0, rawEntries.length) : 0;
        const raceStartedVal = resultsArePublic ? Math.max(summary.totalStarted || 0, rawFinishedInRace) : 0;
        totalStarted += raceStartedVal;
        if (resultsArePublic) {
          startedFieldRegistered += summary.totalRegistered || 0;
          startedFieldStarted += raceStartedVal;
        }
        if (pub) {
          hasRosterStats = true;
          totalHeadcount += pub.headcount;
        } else {
          totalHeadcount += summary.totalRegistered || 0;
          if ((summary.officialResults?.length || 0) > 0) headcountEstimated = true;
        }
      }
      if (resultsArePublic) {
        dqCount += Object.keys(race.disqualifiedBibs || {}).length;
      }
    }

    // Distance breakdown from publicStats if available
    if (pub && entryCategoryFilter === 'all') {
      for (const bd of pub.byDistance) {
        const parsed = parseDistanceAndEntryCategory(bd.label);
        if (!parsed.baseDistance) continue;
        if (normalizedDistFilter !== 'all' && parsed.baseDistance !== normalizedDistFilter) continue;
        const bucket = ensureDistBucket(parsed.baseDistance, bd.km);
        bucket.raceIds.add(race.id);
        bucket.registered += bd.registered;
        bucket.started += bd.started;
        bucket.dns += bd.dns;
        bucket.dnf += bd.dnf;
        bucket.dq += bd.dq;
        bucket.hasRosterBreakdown = true;
        if (isFilteredByDistanceOrEntry) {
          totalRegistered += bd.registered;
          totalStarted += bd.started;
          totalHeadcount += bd.registered;
        }
      }
    }

    if (matchingEntries.length > 0 && !isFilteredByDistanceOrEntry && summary) {
      finishedFieldDenominator += Math.max(
        summary.totalRegistered || 0,
        summary.totalStarted || 0,
        rawEntries.length,
      );
    }

    // Process every matching official finisher entry
    for (const entry of matchingEntries) {
      const parsed = parseDistanceAndEntryCategory(entry.distance);
      const secs = parseRaceDurationSeconds(entry.finishTime);
      scopedFinishers.push({ race, entry, parsed, secs });

      if (entry.timingMethod === 'transition') transitionCount += 1;
      else if (entry.timingMethod === 'gun') gunCount += 1;
      else chipCount += 1;

      if (entry.finishReviewRequired) reviewFlaggedFromEntries += 1;
      if (entry.missingStartScan) missingStartFromEntries += 1;
      if (entry.missingIntermediateLabels && entry.missingIntermediateLabels.length > 0) {
        missingIntermediateFromEntries += 1;
      }
      if (parsed.isFreeSlot || entry.isFreeSlot) freeSlotsFromEntries += 1;

      if (secs !== null) {
        allFinishSeconds.push(secs);
      }

      const fmtPrev = formatFromEntriesMap.get(parsed.entryCategory) || { entriesCount: 0, headcount: 0 };
      fmtPrev.entriesCount += 1;
      fmtPrev.headcount += entryMemberCount[parsed.entryCategory];
      formatFromEntriesMap.set(parsed.entryCategory, fmtPrev);

      if (parsed.baseDistance) {
        const km = raceKmMap.get(parsed.baseDistance) || parseKmFromDistanceLabel(parsed.baseDistance);
        const bucket = ensureDistBucket(parsed.baseDistance, km);
        bucket.raceIds.add(race.id);
        bucket.finished += 1;
        if (secs !== null) {
          bucket.finishSecs.push(secs);
          if (km > 0) {
            const paceSecPerKm = secs / km;
            bucket.paceSum += paceSecPerKm;
            bucket.paceCount += 1;
            totalPaceSecPerKmSum += paceSecPerKm;
            totalPaceSecPerKmCount += 1;
          }
        }
        if (entry.timingMethod === 'transition') bucket.transitionTimed += 1;
        else if (entry.timingMethod === 'gun') bucket.gunTimed += 1;
        else bucket.chipTimed += 1;
      }

      const cutLabel = entry.categoryLabel?.trim();
      const inferredGender = inferGenderFromDivisionLabel(cutLabel);
      if (inferredGender) {
        const fg = inferredGender === 'female' ? finGenderAccum.female : finGenderAccum.male;
        fg.count += 1;
        if (secs !== null) {
          fg.secs.push(secs);
          const km = (parsed.baseDistance && raceKmMap.get(parsed.baseDistance)) || parseKmFromDistanceLabel(parsed.baseDistance);
          if (km > 0) {
            fg.paceSum += secs / km;
            fg.paceCnt += 1;
          }
        }
        if (parsed.baseDistance) {
          const gd = finGenderDistMap.get(parsed.baseDistance) || { male: 0, female: 0 };
          if (inferredGender === 'female') gd.female += 1;
          else gd.male += 1;
          finGenderDistMap.set(parsed.baseDistance, gd);
        }
      }

      if (entry.specialAgeAwards && entry.specialAgeAwards.length > 0 && specialAwards.length < 12) {
        specialAwards.push({
          key: `${race.id}_${entry.bibNumber}_${entry.distance}`,
          raceId: race.id,
          raceName: race.name,
          bibNumber: entry.bibNumber,
          displayName: entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName,
          distance: entry.distance,
          awards: entry.specialAgeAwards,
          finishTime: entry.finishTime,
        });
      }
    }

    if (pub && pub.ageCuts.length > 0 && !isFilteredByDistanceOrEntry) {
      for (const cut of pub.ageCuts) {
        const key = cut.label.trim().toLowerCase();
        const prev = ageCutMap.get(key) || {
          id: cut.id,
          label: cut.label,
          gender: cut.gender,
          count: 0,
          finishSecs: [],
          rosterFastest: undefined as number | undefined,
          rosterMedians: [],
          fromRoster: true,
        };
        prev.count += cut.count;
        if (cut.fastestSeconds !== undefined) {
          prev.rosterFastest =
            prev.rosterFastest === undefined ? cut.fastestSeconds : Math.min(prev.rosterFastest, cut.fastestSeconds);
        }
        if (cut.medianSeconds !== undefined) prev.rosterMedians.push(cut.medianSeconds);
        ageCutMap.set(key, prev);
      }
    } else {
      for (const entry of matchingEntries) {
        const cutLabel = entry.categoryLabel?.trim();
        if (!cutLabel) continue;
        const secs = parseRaceDurationSeconds(entry.finishTime);
        const inferredGender = inferGenderFromDivisionLabel(cutLabel);
        const key = cutLabel.toLowerCase();
        const prevCut = ageCutMap.get(key) || {
          id: key,
          label: cutLabel,
          gender: inferredGender || 'all',
          count: 0,
          finishSecs: [],
          rosterFastest: undefined as number | undefined,
          rosterMedians: [],
          fromRoster: false,
        };
        prevCut.count += 1;
        if (secs !== null) prevCut.finishSecs.push(secs);
        ageCutMap.set(key, prevCut);
      }
    }
  }

  // Adjust estimated headcount if only finisher entries gave us Duo/Group sizes
  if (!hasRosterStats && formatFromEntriesMap.size > 0 && !isFilteredByDistanceOrEntry) {
    let extraTeamHeads = 0;
    for (const [cat, stats] of formatFromEntriesMap.entries()) {
      extraTeamHeads += Math.max(0, stats.headcount - stats.entriesCount);
    }
    if (extraTeamHeads > 0) {
      totalHeadcount = Math.max(totalHeadcount, totalRegistered + extraTeamHeads);
      headcountEstimated = true;
    }
  }

  const totalFinished = scopedFinishers.length;
  allFinishSeconds.sort((a, b) => a - b);
  const fastestSeconds = allFinishSeconds[0];
  const medianSeconds = computePercentile(allFinishSeconds, 50);
  const p90Seconds = computePercentile(allFinishSeconds, 90);
  const slowestSeconds = allFinishSeconds.length > 0 ? allFinishSeconds[allFinishSeconds.length - 1] : undefined;
  const avgPaceSecPerKm = totalPaceSecPerKmCount > 0 ? totalPaceSecPerKmSum / totalPaceSecPerKmCount : undefined;

  const { buckets: finishBuckets, peakBucketLabel, peakBucketCount } = build14BucketFinishHistogram(allFinishSeconds);

  const finishRateDenom = finishedFieldDenominator > 0 ? finishedFieldDenominator : totalRegistered;
  const finishRatePct =
    finishRateDenom > 0 && totalFinished > 0
      ? Math.min(100, Math.round((totalFinished / finishRateDenom) * 100))
      : null;

  const dnsCount =
    startedFieldRegistered > 0 && startedFieldStarted > 0
      ? Math.max(0, startedFieldRegistered - startedFieldStarted)
      : 0;
  const dnfCount =
    startedFieldStarted > 0 && totalFinished > 0
      ? Math.max(0, startedFieldStarted - totalFinished - dqCount)
      : 0;

  const timingTotal = chipCount + gunCount + transitionCount;
  const chipPct = timingTotal > 0 ? Math.round((chipCount / timingTotal) * 100) : 0;
  const rfidSharePct =
    hasRfidTotals && rfidReadsTotal + manualReadsTotal > 0
      ? Math.round((rfidReadsTotal / (rfidReadsTotal + manualReadsTotal)) * 100)
      : null;

  // Course funnel
  const funnelDenom = Math.max(totalRegistered, totalStarted, totalFinished, 1);
  const funnel: PublicCourseFunnelStage[] = [
    {
      id: 'registered',
      label: 'Registered',
      count: totalRegistered,
      pct: totalRegistered > 0 ? 100 : 0,
      detail: `${dnsCount.toLocaleString('en-PH')} DNS`,
      tone: 'neutral',
    },
    {
      id: 'started',
      label: 'Started',
      count: totalStarted,
      pct: totalRegistered > 0 ? Math.min(100, Math.round((totalStarted / funnelDenom) * 100)) : 0,
      detail: hasRfidTotals ? `${(rfidReadsTotal + manualReadsTotal).toLocaleString('en-PH')} scans` : 'Start mat / gun',
      tone: 'emerald',
    },
    {
      id: 'finished',
      label: 'Finished',
      count: totalFinished,
      pct: finishRatePct ?? (totalRegistered > 0 ? Math.round((totalFinished / funnelDenom) * 100) : 0),
      detail: medianSeconds !== undefined ? `Med ${formatShortDuration(medianSeconds)}` : 'Awaiting finishes',
      tone: 'emerald',
    },
    {
      id: 'dnf',
      label: 'Unfinished / DQ',
      count: dnfCount + dqCount,
      pct: totalRegistered > 0 ? Math.min(100, Math.round(((dnfCount + dqCount) / funnelDenom) * 100)) : 0,
      detail: `${dqCount} DQ · ${dnfCount} DNF`,
      tone: 'red',
    },
  ];

  // Distance Performance Matrix
  const byDistance: PublicDistancePerformanceRow[] = Array.from(distAccum.values())
    .map((bucket) => {
      const sorted = [...bucket.finishSecs].sort((a, b) => a - b);
      const regOrFin = bucket.registered > 0 ? bucket.registered : 0;
      const rateDenom = bucket.registered > 0 ? bucket.registered : bucket.started > 0 ? bucket.started : 0;
      const finishRate =
        rateDenom > 0 && bucket.finished > 0 ? Math.min(100, Math.round((bucket.finished / rateDenom) * 100)) : null;
      return {
        label: bucket.label,
        km: bucket.km,
        raceCount: bucket.raceIds.size,
        registered: regOrFin,
        started: bucket.started,
        finished: bucket.finished,
        finishRatePct: finishRate,
        dns: bucket.dns,
        dnf: bucket.dnf,
        dq: bucket.dq,
        fastestSeconds: sorted[0],
        medianSeconds: computePercentile(sorted, 50),
        p90Seconds: computePercentile(sorted, 90),
        slowestSeconds: sorted.length > 0 ? sorted[sorted.length - 1] : undefined,
        avgPaceSecPerKm: bucket.paceCount > 0 ? bucket.paceSum / bucket.paceCount : undefined,
        chipTimed: bucket.chipTimed,
        gunTimed: bucket.gunTimed,
        transitionTimed: bucket.transitionTimed,
      };
    })
    .sort((a, b) => {
      const na = parseFloat(a.label);
      const nb = parseFloat(b.label);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });

  // Top finishers diversified across distances (up to 6)
  const topCandidates = [...scopedFinishers]
    .filter((item) => (item.entry.overallRank ?? item.entry.rank) <= 3 && item.secs !== null)
    .sort((a, b) => {
      const ra = a.entry.overallRank ?? a.entry.rank;
      const rb = b.entry.overallRank ?? b.entry.rank;
      if (ra !== rb) return ra - rb;
      return (a.secs ?? 9e9) - (b.secs ?? 9e9);
    });
  for (const item of topCandidates) {
    if (topFinishers.length >= 6) break;
    const km =
      (item.race.distances || []).find(
        (d) => parseDistanceAndEntryCategory(d.label).baseDistance === item.parsed.baseDistance,
      )?.km || parseKmFromDistanceLabel(item.parsed.baseDistance);
    topFinishers.push({
      key: `${item.race.id}_${item.entry.bibNumber}_${item.entry.distance}`,
      raceId: item.race.id,
      raceName: item.race.name,
      bibNumber: item.entry.bibNumber,
      displayName: item.entry.isFreeSlot ? `Bib ${item.entry.bibNumber}` : item.entry.fullName,
      distance: item.entry.distance,
      baseDistance: item.parsed.baseDistance || item.entry.distance,
      categoryLabel: item.entry.categoryLabel,
      finishTime: item.entry.finishTime,
      finishSeconds: item.secs!,
      paceLabel: formatPacePerKm(item.secs!, km),
      timingMethod: item.entry.timingMethod || 'chip',
      overallRank: item.entry.overallRank ?? item.entry.rank,
    });
  }

  // Gender summary (prefer roster publicStats when unfiltered, else finisher division labels)
  let byGender: PublicGenderSummaryRow[] = [];
  let genderSource: 'roster' | 'finishers' | 'none' = 'none';

  if (hasPubGender && !isFilteredByDistanceOrEntry) {
    genderSource = 'roster';
    const totalRegG = pubGenderMale.reg + pubGenderFemale.reg;
    const mPct = totalRegG > 0 ? Math.round((pubGenderMale.reg / totalRegG) * 100) : 0;
    byGender = [
      {
        id: 'male',
        label: 'Male',
        registered: pubGenderMale.reg,
        finished: pubGenderMale.fin,
        sharePct: mPct,
        fastestSeconds: pubGenderMale.best,
        medianSeconds: pubGenderMale.medians.length > 0 ? computePercentile([...pubGenderMale.medians].sort((a, b) => a - b), 50) : undefined,
        avgPaceSecPerKm: pubGenderMale.paceCnt > 0 ? pubGenderMale.paceSum / pubGenderMale.paceCnt : undefined,
        source: 'roster',
      },
      {
        id: 'female',
        label: 'Female',
        registered: pubGenderFemale.reg,
        finished: pubGenderFemale.fin,
        sharePct: totalRegG > 0 ? 100 - mPct : 0,
        fastestSeconds: pubGenderFemale.best,
        medianSeconds: pubGenderFemale.medians.length > 0 ? computePercentile([...pubGenderFemale.medians].sort((a, b) => a - b), 50) : undefined,
        avgPaceSecPerKm: pubGenderFemale.paceCnt > 0 ? pubGenderFemale.paceSum / pubGenderFemale.paceCnt : undefined,
        source: 'roster',
      },
    ];
  } else if (finGenderAccum.male.count + finGenderAccum.female.count > 0) {
    genderSource = 'finishers';
    const totalFinG = finGenderAccum.male.count + finGenderAccum.female.count;
    const mPct = Math.round((finGenderAccum.male.count / totalFinG) * 100);
    const maleSorted = [...finGenderAccum.male.secs].sort((a, b) => a - b);
    const femaleSorted = [...finGenderAccum.female.secs].sort((a, b) => a - b);
    byGender = [
      {
        id: 'male',
        label: 'Male',
        registered: 0,
        finished: finGenderAccum.male.count,
        sharePct: mPct,
        fastestSeconds: maleSorted[0],
        medianSeconds: computePercentile(maleSorted, 50),
        avgPaceSecPerKm: finGenderAccum.male.paceCnt > 0 ? finGenderAccum.male.paceSum / finGenderAccum.male.paceCnt : undefined,
        source: 'finishers',
      },
      {
        id: 'female',
        label: 'Female',
        registered: 0,
        finished: finGenderAccum.female.count,
        sharePct: 100 - mPct,
        fastestSeconds: femaleSorted[0],
        medianSeconds: computePercentile(femaleSorted, 50),
        avgPaceSecPerKm: finGenderAccum.female.paceCnt > 0 ? finGenderAccum.female.paceSum / finGenderAccum.female.paceCnt : undefined,
        source: 'finishers',
      },
    ];
  }

  // Gender by distance
  const genderByDistanceSource = hasPubGender && !isFilteredByDistanceOrEntry && pubGenderDistMap.size > 0
    ? Array.from(pubGenderDistMap.entries()).map(([label, counts]) => {
        const total = counts.maleCount + counts.femaleCount;
        const malePct = total > 0 ? Math.round((counts.maleCount / total) * 100) : 0;
        return {
          distanceLabel: label,
          maleCount: counts.maleCount,
          malePct,
          femaleCount: counts.femaleCount,
          femalePct: total > 0 ? 100 - malePct : 0,
          total,
        };
      })
    : Array.from(finGenderDistMap.entries()).map(([label, counts]) => {
        const total = counts.male + counts.female;
        const malePct = total > 0 ? Math.round((counts.male / total) * 100) : 0;
        return {
          distanceLabel: label,
          maleCount: counts.male,
          malePct,
          femaleCount: counts.female,
          femalePct: total > 0 ? 100 - malePct : 0,
          total,
        };
      });
  genderByDistanceSource.sort((a, b) => {
    const na = parseFloat(a.distanceLabel);
    const nb = parseFloat(b.distanceLabel);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.distanceLabel.localeCompare(b.distanceLabel, undefined, { numeric: true });
  });

  // Age cuts
  const ageCutTotal = Array.from(ageCutMap.values()).reduce((sum, item) => sum + item.count, 0);
  const ageCuts: PublicAgeCutRow[] = Array.from(ageCutMap.values())
    .map((group) => {
      const sorted = [...group.finishSecs].sort((a, b) => a - b);
      const rosterMedSorted = [...group.rosterMedians].sort((a, b) => a - b);
      return {
        id: group.id,
        label: group.label,
        gender: group.gender,
        count: group.count,
        pct: ageCutTotal > 0 ? Math.round((group.count / ageCutTotal) * 100) : 0,
        fastestSeconds: group.fromRoster ? group.rosterFastest : sorted[0],
        medianSeconds: group.fromRoster ? computePercentile(rosterMedSorted, 50) : computePercentile(sorted, 50),
        source: (group.fromRoster ? 'roster' : 'finishers') as 'roster' | 'finishers',
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const ageCutsSource: 'roster' | 'finishers' | 'none' =
    ageCuts.length === 0 ? 'none' : ageCuts.every((c) => c.source === 'roster') ? 'roster' : 'finishers';

  const configuredDivisions = Array.from(configuredDivisionMap.values()).sort(
    (a, b) => a.minAge - b.minAge || a.label.localeCompare(b.label),
  );

  // Entry formats
  const entryFormats: PublicEntryFormatRow[] = [];
  if (formatFromPubMap.size > 0 && !isFilteredByDistanceOrEntry) {
    const totalFmtEntries = Array.from(formatFromPubMap.values()).reduce((s, r) => s + r.entriesCount, 0);
    for (const [cat, stats] of Array.from(formatFromPubMap.entries()).sort((a, b) => b[1].entriesCount - a[1].entriesCount)) {
      entryFormats.push({
        category: (cat as RaceEntryCategory) || 'solo',
        label: stats.label,
        entriesCount: stats.entriesCount,
        headcount: stats.headcount,
        sharePct: totalFmtEntries > 0 ? Math.round((stats.entriesCount / totalFmtEntries) * 100) : 0,
        source: 'roster',
      });
    }
  } else if (formatFromEntriesMap.size > 0) {
    const totalFmtEntries = Array.from(formatFromEntriesMap.values()).reduce((s, r) => s + r.entriesCount, 0);
    for (const [cat, stats] of Array.from(formatFromEntriesMap.entries()).sort((a, b) => b[1].entriesCount - a[1].entriesCount)) {
      entryFormats.push({
        category: cat,
        label: entryCategoryLabels[cat],
        entriesCount: stats.entriesCount,
        headcount: stats.headcount,
        sharePct: totalFmtEntries > 0 ? Math.round((stats.entriesCount / totalFmtEntries) * 100) : 0,
        source: 'finishers',
      });
    }
  }

  // Shirt inventory
  const shirtInventory = Array.from(shirtMap.entries()).map(([size, counts]) => {
    const unclaimedCount = Math.max(0, counts.ordered - counts.claimed);
    return {
      size,
      orderedCount: counts.ordered,
      claimedCount: counts.claimed,
      unclaimedCount,
      claimRatePct: counts.ordered > 0 ? Math.round((counts.claimed / counts.ordered) * 100) : 0,
    };
  });

  // Checkpoints (single-event scan counts when available, else configured race checkpoints)
  const checkpoints: PublicCheckpointSummaryRow[] =
    pubCheckpoints.length > 0
      ? pubCheckpoints
      : selectedRace
      ? [...(selectedRace.checkpoints || [])]
          .sort((a, b) => a.order - b.order)
          .map((cp, idx, list) => ({
            id: cp.id,
            label: cp.label,
            type: cp.type || (idx === 0 ? 'start' : idx === list.length - 1 ? 'finish' : 'intermediate'),
            scanCount: 0,
            uniqueBibs: 0,
            pctOfRegistered: null,
            cutoffMinutes: cp.cutoffMinutes,
            hasScanCounts: false,
          }))
      : [];

  // Route terrain metrics
  const scopedRaceIds = new Set(scopedRaces.map((r) => r.id));
  const raceNameById = new Map(races.map((r) => [r.id, r.name]));
  const scopedRoutes = routes.filter((rt) => rt.status === 'published' && rt.raceId && scopedRaceIds.has(rt.raceId));
  const routeItems: PublicRouteTerrainItem[] = scopedRoutes.map((rt) => ({
    id: rt.id,
    raceId: rt.raceId || '',
    raceName: rt.raceName || raceNameById.get(rt.raceId || '') || 'Race course',
    distanceLabel: rt.distanceLabel || '',
    distanceKm: rt.measuredDistanceM > 0 ? Math.round((rt.measuredDistanceM / 1000) * 10) / 10 : rt.advertisedKm || 0,
    elevationGainM: Math.round(rt.elevationGainM || 0),
    checkpointCount: rt.checkpointCount || 0,
  }));
  const totalRouteKm = Math.round(routeItems.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
  const maxElevationGainM = routeItems.reduce((m, r) => Math.max(m, r.elevationGainM), 0);

  // Readiness meters
  const publishedEventsCount = scopedRaces.filter((r) => Boolean(r.completedAt) || (resultsByRaceId[r.id]?.officialResults?.length || 0) > 0).length;
  const wavePct = waveStartsTotal > 0 ? Math.round((waveStartsConfigured / waveStartsTotal) * 100) : 0;
  const cpReadyEvents = scopedRaces.filter((r) => (r.checkpoints || []).length >= 2).length;
  const cpReadyPct = scopedRaces.length > 0 ? Math.round((cpReadyEvents / scopedRaces.length) * 100) : 0;
  const resultsPublishedPct = scopedRaces.length > 0 ? Math.round((publishedEventsCount / scopedRaces.length) * 100) : 0;

  const pctOfRoster = (val: number) => (pubRosterDenom > 0 ? Math.round((val / pubRosterDenom) * 100) : 0);

  const readinessMeters: PublicReadinessMeter[] = [
    {
      id: 'wave-starts',
      label: 'Wave Starts Armed',
      pct: wavePct,
      detail: `${waveStartsConfigured}/${waveStartsTotal} waves`,
      available: true,
    },
    {
      id: 'checkpoints',
      label: 'Timing Checkpoints',
      pct: cpReadyPct,
      detail: `${checkpointsConfigured} checkpoints (${checkpointsWithCutoff} w/ cutoff)`,
      available: true,
    },
    {
      id: 'results-published',
      label: 'Results Published',
      pct: resultsPublishedPct,
      detail: `${publishedEventsCount}/${scopedRaces.length} events`,
      available: true,
    },
    ...(hasPubReadiness
      ? [
          {
            id: 'bibs',
            label: 'Bibs Assigned',
            pct: pctOfRoster(pubBibsAssigned),
            detail: `${pubBibsAssigned.toLocaleString('en-PH')}/${pubRosterDenom.toLocaleString('en-PH')}`,
            available: true,
          },
          {
            id: 'chips',
            label: 'RFID Chips Mapped',
            pct: pctOfRoster(pubChipsAssigned),
            detail: `${pubChipsAssigned.toLocaleString('en-PH')}/${pubRosterDenom.toLocaleString('en-PH')}`,
            available: true,
          },
          {
            id: 'kits',
            label: 'Race Kits Claimed',
            pct: pctOfRoster(pubKitsClaimed),
            detail: `${pubKitsClaimed.toLocaleString('en-PH')}/${pubRosterDenom.toLocaleString('en-PH')}`,
            available: true,
          },
          {
            id: 'emergency',
            label: 'Emergency Info',
            pct: pctOfRoster(pubEmergencyCount),
            detail: `${pctOfRoster(pubEmergencyCount)}% verified`,
            available: true,
          },
          {
            id: 'shirts',
            label: 'Shirt Sizes Logged',
            pct: pctOfRoster(pubShirtRecordedCount),
            detail: `${pctOfRoster(pubShirtRecordedCount)}% logged`,
            available: true,
          },
        ]
      : []),
  ];

  const reviewFlaggedCount = hasRfidTotals ? Math.max(reviewFlaggedFromPub, reviewFlaggedFromEntries) : reviewFlaggedFromEntries;
  const missingStartCount = hasRfidTotals ? Math.max(missingStartFromPub, missingStartFromEntries) : missingStartFromEntries;
  const missingIntermediateCount = hasRfidTotals
    ? Math.max(missingIntermediateFromPub, missingIntermediateFromEntries)
    : missingIntermediateFromEntries;

  return {
    scope,
    selectedRace,
    availableDistances,
    availableRaces: races.map((r) => ({ id: r.id, name: r.name, date: r.date, status: raceStatusOf(r) })),
    overview: {
      totalEvents: scopedRaces.length,
      upcomingEvents,
      liveEvents,
      completedEvents,
      totalRegistered,
      totalHeadcount,
      headcountEstimated,
      totalStarted,
      totalFinished,
      finishRatePct,
      dnsCount,
      dnfCount,
      dqCount,
      fastestSeconds,
      medianSeconds,
      p90Seconds,
      slowestSeconds,
      avgPaceSecPerKm,
      chipCount,
      gunCount,
      transitionCount,
      chipPct,
      rfidReads: rfidReadsTotal,
      manualReads: manualReadsTotal,
      rfidSharePct,
      recent7dRunners: hasAnyRecent7d ? recent7dRunnersSum : null,
      hasRosterStats,
      hasTimingStats: totalFinished > 0 || (hasRfidTotals && rfidReadsTotal + manualReadsTotal > 0),
    },
    performance: {
      funnel,
      finishBuckets,
      peakBucketLabel,
      peakBucketCount,
      velocitySeries: velocityAgg,
      velocityLabels,
      hasVelocitySeries: velocityAgg.some((v) => v > 0),
      byDistance,
      byGender,
      genderSource,
      checkpoints,
      topFinishers,
      specialAwards,
      timingHealth: {
        totalReads: rfidReadsTotal + manualReadsTotal,
        rfidReads: rfidReadsTotal,
        manualReads: manualReadsTotal,
        rfidSharePct,
        unmatchedScans: unmatchedScansTotal,
        reviewFlagged: reviewFlaggedCount,
        missingStart: missingStartCount,
        missingIntermediate: missingIntermediateCount,
        dqCount,
        waveStartsConfigured,
        waveStartsTotal,
      },
    },
    demographics: {
      genderSplit: byGender,
      genderSource,
      genderByDistance: genderByDistanceSource,
      ageSummary: {
        medianAge: pubAgeMedians.length > 0 ? Math.round(pubAgeMedians.reduce((s, v) => s + v, 0) / pubAgeMedians.length) : null,
        meanAge: pubAgeMeans.length > 0 ? Math.round((pubAgeMeans.reduce((s, v) => s + v, 0) / pubAgeMeans.length) * 10) / 10 : null,
        minAge: pubAgeMin,
        maxAge: pubAgeMax,
        youthUnder18: hasPubAgeSummary ? pubYouthUnder18 : null,
        masters50Plus: hasPubAgeSummary ? pubMasters50Plus : null,
        knownAgeCount: pubKnownAgeCount,
        undisclosedCount: pubUndisclosedAgeCount,
        hasRosterAgeSummary: hasPubAgeSummary,
      },
      ageCuts,
      ageCutsSource,
      configuredDivisions,
      entryFormats,
      shirtInventory,
      compliance: {
        emergencyContactPct: hasPubReadiness ? pctOfRoster(pubEmergencyCount) : null,
        shirtSizePct: hasPubReadiness ? pctOfRoster(pubShirtRecordedCount) : null,
        under13Count: hasPubReadiness ? pubUnder13Count : null,
        under13ConsentCount: hasPubReadiness ? pubUnder13ConsentCount : null,
        marketingOptInPct: hasPubReadiness ? pctOfRoster(pubMarketingCount) : null,
        hasRosterCompliance: hasPubReadiness,
      },
    },
    operations: {
      readinessMeters,
      hasRosterReadiness: hasPubReadiness,
      bibsAssigned: hasPubReadiness ? pubBibsAssigned : null,
      bibsMissing: hasPubReadiness ? Math.max(0, pubRosterDenom - pubBibsAssigned) : null,
      bibsPct: hasPubReadiness ? pctOfRoster(pubBibsAssigned) : null,
      chipsAssigned: hasPubReadiness ? pubChipsAssigned : null,
      chipsMissing: hasPubReadiness ? Math.max(0, pubRosterDenom - pubChipsAssigned) : null,
      chipsPct: hasPubReadiness ? pctOfRoster(pubChipsAssigned) : null,
      kitsClaimed: hasPubReadiness ? pubKitsClaimed : null,
      kitsUnclaimed: hasPubReadiness ? Math.max(0, pubRosterDenom - pubKitsClaimed) : null,
      kitsPct: hasPubReadiness ? pctOfRoster(pubKitsClaimed) : null,
      freeSlotCount: hasPubReadiness ? pubFreeSlotCount : freeSlotsFromEntries,
      relayLinksCount: hasPubReadiness ? pubRelayLinksCount : null,
      brokenRelayLinksCount: hasPubReadiness ? pubBrokenRelayLinksCount : null,
      unmappedDistanceCount: hasPubReadiness ? pubUnmappedDistanceCount : null,
      waveStartsConfigured,
      waveStartsTotal,
      checkpointsConfigured,
      checkpointsWithCutoff,
      reviewFlaggedCount,
      missingStartCount,
      missingIntermediateCount,
      dqCount,
      publishedRoutesCount: routeItems.length,
      totalRouteKm,
      maxElevationGainM,
      routeItems,
    },
    portfolio,
  };
}

/** Formats duration seconds cleanly or returns fallback. */
export { formatShortDuration, formatPacePerKm, isRaceRegistrationOpen };
