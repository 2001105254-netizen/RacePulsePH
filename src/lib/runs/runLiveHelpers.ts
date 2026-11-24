import type { GpsRawFix } from '../routes/gpsFilter';
import {
  computeRunCalorieEstimate,
  computeSegmentCaloriesKcal,
  resolveCalorieWeightKg,
  round1,
} from './calorieEngine';
import { createCommunityRequestId } from './communityRunsClient';
import type { NativeRunFix } from './nativeRunTracking';
import {
  DEFAULT_PRIVACY_TRIM_M,
  computeActiveElapsedTimeMs,
  computePerKmSplits,
  computeTrackElevationTotals,
  detectPhilippineIslandGroups,
  trimRunTrackEndpoints,
} from './runRecorderEngine';
import type {
  ActiveRunSession,
  RecordedRunCourseRef,
  RecordedRunMode,
  RecordedRunPrivacy,
  RecordedTrackPoint,
  RunCalorieEstimate,
  RunSplitKm,
} from './types';

export const MIN_SERVER_MOVING_TIME_MS = 10_000;

export const PRIVACY_OPTIONS: ReadonlyArray<{
  value: RecordedRunPrivacy;
  label: string;
  hint: string;
}> = [
  { value: 'private', label: 'Private', hint: 'Only visible to you' },
  { value: 'friends', label: 'Friends', hint: 'Accepted RacePulsePH friends' },
  { value: 'public', label: 'Public', hint: 'Visible on public runner feed' },
];

export interface SummaryComputation {
  runId: string;
  requestId: string;
  mode: RecordedRunMode;
  courseRef?: RecordedRunCourseRef;
  startedAt: string;
  finishedAt: string;
  elapsedTimeMs: number;
  movingTimeMs: number;
  clientDistanceM: number;
  homePrivacyTrimEnabled: boolean;
  trimmedHeadM: number;
  trimmedTailM: number;
  enrichedPoints: RecordedTrackPoint[];
  trimmedPoints: RecordedTrackPoint[];
  elevationGainM: number;
  elevationLossM: number;
  elevationSource: 'dem' | 'gps' | 'mixed';
  splits: RunSplitKm[];
  calorieEstimate: RunCalorieEstimate;
  islandGroups: Array<'Luzon' | 'Visayas' | 'Mindanao'>;
}

export function buildCourseKey(raceId: string, distanceId: string): string {
  return `${raceId}::${distanceId}`;
}

export function formatDuration(ms: number): string {
  const safeSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function formatPace(secPerKm: number | null | undefined): string {
  if (
    secPerKm === null ||
    secPerKm === undefined ||
    !Number.isFinite(secPerKm) ||
    secPerKm <= 0 ||
    secPerKm > 3600
  ) {
    return '--:-- /km';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

export function formatShortDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function buildDefaultRunTitle(
  mode: RecordedRunMode,
  courseRef?: RecordedRunCourseRef,
  now = new Date(),
): string {
  if (mode === 'course' && courseRef) {
    return `${courseRef.raceName} (${courseRef.distanceLabel})`.slice(0, 120);
  }
  let hour = now.getHours();
  try {
    const manilaHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hour12: false,
      }).format(now),
    );
    if (Number.isFinite(manilaHour)) {
      hour = manilaHour % 24;
    }
  } catch {
    // Fallback to device clock hour when Intl timeZone is unavailable.
  }
  if (hour >= 5 && hour < 12) return 'Morning Free Run';
  if (hour >= 12 && hour < 17) return 'Afternoon Free Run';
  if (hour >= 17 && hour < 21) return 'Evening Free Run';
  return 'Night Free Run';
}

export function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'racepulse-run';
}

export function buildNotificationTitle(
  mode: RecordedRunMode,
  courseRef?: RecordedRunCourseRef,
): string {
  if (mode === 'course' && courseRef) {
    return `${courseRef.raceName} (${courseRef.distanceLabel})`;
  }
  return 'RacePulsePH Live Run';
}

export function formatNotificationSubtitle(
  session: ActiveRunSession,
  nowMs = Date.now(),
): string {
  const elapsedMs = computeActiveElapsedTimeMs(session, nowMs);
  const km = (session.distanceM / 1000).toFixed(2);
  const time = formatDuration(elapsedMs);
  return `${km} km · ${time} · ${Math.round(session.totalKcal)} kcal`;
}

export function toGpsRawFix(fix: NativeRunFix, fallbackMs = Date.now()): GpsRawFix {
  const timestampMs =
    typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp) && fix.timestamp > 0
      ? fix.timestamp
      : fallbackMs;
  return {
    lat: fix.latitude,
    lon: fix.longitude,
    accuracyM: fix.accuracyM,
    altitudeM: fix.altitudeM,
    headingDeg: fix.headingDeg,
    speedMps: fix.speedMps,
    timestampMs,
  };
}

export function deriveSummaryCalorieEstimate(
  points: RecordedTrackPoint[],
  distanceM: number,
  movingTimeMs: number,
  weightKg?: number | null,
): RunCalorieEstimate {
  if (points.length >= 2) {
    return computeRunCalorieEstimate(points, weightKg);
  }
  const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(weightKg);
  const seg = computeSegmentCaloriesKcal({
    distanceM,
    deltaElevationM: 0,
    durationSec: movingTimeMs / 1000,
    weightKg: weightKgUsed,
  });
  const netKcal = round1(seg.netKcal);
  const restingKcal = round1(seg.restingKcal);
  return {
    totalKcal: round1(netKcal + restingKcal),
    netKcal,
    restingKcal,
    weightKgUsed,
    usedReferenceWeight,
    methodVersion: 'minetti2002-herrmann2024-v1',
  };
}

export interface MergeAndFilterRunFixesParams {
  incomingFixes: NativeRunFix[];
  minAcceptedTimestampMs: number;
  existingTimestamps: ReadonlySet<number>;
  lastProcessedTimestampMs: number;
}

/**
 * Sorts incoming fixes chronologically, filters out stale fixes below `minAcceptedTimestampMs`,
 * skips timestamps at or before `lastProcessedTimestampMs`, and deduplicates against existing points.
 */
export function mergeAndFilterRunFixes(params: MergeAndFilterRunFixesParams): NativeRunFix[] {
  const {
    incomingFixes,
    minAcceptedTimestampMs,
    existingTimestamps,
    lastProcessedTimestampMs,
  } = params;

  if (!Array.isArray(incomingFixes) || incomingFixes.length === 0) {
    return [];
  }

  const sorted = [...incomingFixes]
    .filter(
      (fix) =>
        Boolean(fix) &&
        typeof fix.timestamp === 'number' &&
        Number.isFinite(fix.timestamp) &&
        fix.timestamp > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const seenInBatch = new Set<number>();
  const accepted: NativeRunFix[] = [];

  for (const fix of sorted) {
    const ts = fix.timestamp;
    if (ts < minAcceptedTimestampMs) continue;
    if (ts <= lastProcessedTimestampMs) continue;
    if (existingTimestamps.has(ts) || seenInBatch.has(ts)) continue;
    seenInBatch.add(ts);
    accepted.push(fix);
  }

  return accepted;
}

export interface BuildSummaryComputationParams {
  runId: string;
  requestId?: string;
  mode: RecordedRunMode;
  courseRef?: RecordedRunCourseRef;
  startedAtMs: number;
  finishedAtMs: number;
  elapsedTimeMs: number;
  movingTimeMs: number;
  clientDistanceM: number;
  homePrivacyTrimEnabled: boolean;
  points: RecordedTrackPoint[];
  elevationSource: 'dem' | 'gps' | 'mixed';
  fallbackElevationGainM?: number;
  fallbackElevationLossM?: number;
  weightKg?: number | null;
}

export function buildSummaryComputation(
  params: BuildSummaryComputationParams,
): SummaryComputation {
  const safeFinishedMs = Math.max(params.startedAtMs + 1000, params.finishedAtMs);
  const clientDistanceM = round1(params.clientDistanceM);

  const trimResult = params.homePrivacyTrimEnabled
    ? trimRunTrackEndpoints(params.points, DEFAULT_PRIVACY_TRIM_M)
    : { trimmedPoints: [...params.points], trimmedHeadM: 0, trimmedTailM: 0 };
  const trimmedPoints =
    trimResult.trimmedPoints.length >= 2 ? trimResult.trimmedPoints : [];
  const activeTrack = trimmedPoints.length >= 2 ? trimmedPoints : params.points;

  const elevTotals =
    trimmedPoints.length >= 2
      ? computeTrackElevationTotals(trimmedPoints)
      : params.fallbackElevationGainM !== undefined && params.fallbackElevationLossM !== undefined
        ? {
            gainM: round1(params.fallbackElevationGainM),
            lossM: round1(params.fallbackElevationLossM),
          }
        : computeTrackElevationTotals(params.points);

  return {
    runId: params.runId,
    requestId: params.requestId ?? createCommunityRequestId(),
    mode: params.mode,
    ...(params.courseRef ? { courseRef: params.courseRef } : {}),
    startedAt: new Date(params.startedAtMs).toISOString(),
    finishedAt: new Date(safeFinishedMs).toISOString(),
    elapsedTimeMs: Math.max(0, Math.round(params.elapsedTimeMs)),
    movingTimeMs: Math.max(0, Math.round(params.movingTimeMs)),
    clientDistanceM,
    homePrivacyTrimEnabled: params.homePrivacyTrimEnabled,
    trimmedHeadM: trimResult.trimmedHeadM,
    trimmedTailM: trimResult.trimmedTailM,
    enrichedPoints: params.points,
    trimmedPoints,
    elevationGainM: elevTotals.gainM,
    elevationLossM: elevTotals.lossM,
    elevationSource: params.elevationSource,
    splits: computePerKmSplits(activeTrack, params.weightKg),
    calorieEstimate: deriveSummaryCalorieEstimate(
      trimmedPoints,
      clientDistanceM,
      params.movingTimeMs,
      params.weightKg,
    ),
    islandGroups: detectPhilippineIslandGroups(params.points),
  };
}
