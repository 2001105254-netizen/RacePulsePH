import { geodesicDistanceM } from '../routes/geometry';
import {
  createGpsFilterState,
  ingestGpsFix,
  isInsidePhilippinesBounds,
  type GpsRawFix,
} from '../routes/gpsFilter';
import {
  samplePhilippineDemElevationM,
  sampleRealDemElevationBatch,
} from '../routes/philippinesMapTiles';
import {
  MAX_ACTIVE_STATIONARY_GAP_SEC,
  computeSegmentCaloriesKcal,
  round1,
} from './calorieEngine';
import type {
  ActiveRunSession,
  RecordedRunCourseRef,
  RecordedRunMode,
  RecordedTrackPoint,
  RunSplitKm,
} from './types';

export const ELEVATION_HYSTERESIS_M = 2.5;
export const DEFAULT_PRIVACY_TRIM_M = 200;

const MOVING_SPEED_THRESHOLD_MPS = 0.45;
const MIN_APPEND_DISTANCE_M = 2.5;
const SLOW_APPEND_INTERVAL_MS = 10_000;
const SLOW_APPEND_MIN_DISTANCE_M = 1.0;
const SPLIT_INTERVAL_M = 1000;
const MIN_TRAILING_SPLIT_M = 50;

function applyElevationHysteresis(
  anchorM: number | null,
  gainM: number,
  lossM: number,
  elevationM: number | null | undefined,
): { anchorM: number | null; gainM: number; lossM: number } {
  if (elevationM === undefined || elevationM === null || !Number.isFinite(elevationM)) {
    return { anchorM, gainM, lossM };
  }
  if (anchorM === null) {
    return { anchorM: elevationM, gainM, lossM };
  }
  const delta = elevationM - anchorM;
  if (delta >= ELEVATION_HYSTERESIS_M) {
    return {
      anchorM: elevationM,
      gainM: round1(gainM + delta),
      lossM,
    };
  }
  if (delta <= -ELEVATION_HYSTERESIS_M) {
    return {
      anchorM: elevationM,
      gainM,
      lossM: round1(lossM + Math.abs(delta)),
    };
  }
  return { anchorM, gainM, lossM };
}

export function createActiveRunSession(input: {
  sessionId: string;
  uid: string;
  mode: RecordedRunMode;
  courseRef?: RecordedRunCourseRef;
  homePrivacyTrimEnabled?: boolean;
  startedAtMs?: number;
}): ActiveRunSession {
  const startedAtMs = input.startedAtMs ?? Date.now();
  return {
    sessionId: input.sessionId,
    uid: input.uid,
    mode: input.mode,
    status: 'recording',
    ...(input.courseRef ? { courseRef: input.courseRef } : {}),
    startedAtMs,
    pausedAtMs: null,
    accumulatedPausedMs: 0,
    movingTimeMs: 0,
    distanceM: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    netKcal: 0,
    restingKcal: 0,
    totalKcal: 0,
    maxSpeedMps: 0,
    homePrivacyTrimEnabled: input.homePrivacyTrimEnabled ?? true,
    gpsFilter: createGpsFilterState(),
    points: [],
    lastAcceptedAtMs: startedAtMs,
    lastElevationAnchorM: null,
    pendingSegmentBreak: false,
    updatedAtMs: startedAtMs,
  };
}

export function ingestRunFix(
  session: ActiveRunSession,
  rawFix: GpsRawFix,
  options?: { weightKg?: number | null },
): ActiveRunSession {
  if (session.status === 'paused') {
    return session;
  }

  const nextFilter = ingestGpsFix(session.gpsFilter, rawFix);
  const nextCurrent = nextFilter.current;
  const didAdvanceFix =
    nextCurrent !== null &&
    (!session.gpsFilter.current || nextCurrent.fixCount > session.gpsFilter.current.fixCount);

  if (!didAdvanceFix || !nextCurrent) {
    return {
      ...session,
      gpsFilter: nextFilter,
    };
  }

  const lastPoint =
    session.points.length > 0 ? session.points[session.points.length - 1] : null;
  const isResumedBreak = Boolean(lastPoint && session.pendingSegmentBreak);
  const distM =
    lastPoint && !isResumedBreak
      ? geodesicDistanceM(
          { latitude: lastPoint.lat, longitude: lastPoint.lon },
          { latitude: nextCurrent.lat, longitude: nextCurrent.lon },
        )
      : 0;
  const dtMs =
    lastPoint && !isResumedBreak
      ? Math.max(0, nextCurrent.updatedAtMs - lastPoint.timestampMs)
      : 0;

  const shouldAppend =
    !lastPoint ||
    isResumedBreak ||
    distM >= MIN_APPEND_DISTANCE_M ||
    (dtMs >= SLOW_APPEND_INTERVAL_MS && distM >= SLOW_APPEND_MIN_DISTANCE_M);

  if (!shouldAppend) {
    return {
      ...session,
      gpsFilter: nextFilter,
      lastAcceptedAtMs: nextCurrent.updatedAtMs,
      updatedAtMs: nextCurrent.updatedAtMs,
    };
  }

  const nextPoint: RecordedTrackPoint = {
    lat: nextCurrent.lat,
    lon: nextCurrent.lon,
    ...(nextCurrent.altitudeM !== null ? { ele: nextCurrent.altitudeM } : {}),
    accuracyM: nextCurrent.accuracyM,
    timestampMs: nextCurrent.updatedAtMs,
    speedMps: nextCurrent.speedMps,
    ...(isResumedBreak ? { segmentBreak: true } : {}),
  };

  let nextDistanceM = session.distanceM;
  let nextMovingTimeMs = session.movingTimeMs;
  let nextNetKcal = session.netKcal;
  let nextRestingKcal = session.restingKcal;
  let nextTotalKcal = session.totalKcal;

  if (lastPoint && !isResumedBreak) {
    nextDistanceM += distM;
    const dtSec = dtMs / 1000;
    const speedMps = nextCurrent.speedMps ?? 0;
    if (
      dtSec <= MAX_ACTIVE_STATIONARY_GAP_SEC &&
      (speedMps >= MOVING_SPEED_THRESHOLD_MPS || distM >= MIN_APPEND_DISTANCE_M)
    ) {
      nextMovingTimeMs += dtMs;
    }

    const deltaEleForCal =
      typeof lastPoint.ele === 'number' &&
      Number.isFinite(lastPoint.ele) &&
      nextCurrent.altitudeM !== null
        ? nextCurrent.altitudeM - lastPoint.ele
        : 0;
    const segCal = computeSegmentCaloriesKcal({
      distanceM: distM,
      deltaElevationM: deltaEleForCal,
      durationSec: dtSec,
      weightKg: options?.weightKg,
    });
    nextNetKcal += segCal.netKcal;
    nextRestingKcal += segCal.restingKcal;
    nextTotalKcal = nextNetKcal + nextRestingKcal;
  }

  const eleState = isResumedBreak
    ? {
        anchorM: nextCurrent.altitudeM ?? null,
        gainM: session.elevationGainM,
        lossM: session.elevationLossM,
      }
    : applyElevationHysteresis(
        session.lastElevationAnchorM,
        session.elevationGainM,
        session.elevationLossM,
        nextCurrent.altitudeM,
      );
  const nextMaxSpeedMps =
    nextCurrent.speedMps !== null && Number.isFinite(nextCurrent.speedMps)
      ? Math.max(session.maxSpeedMps, nextCurrent.speedMps)
      : session.maxSpeedMps;

  return {
    ...session,
    gpsFilter: nextFilter,
    points: [...session.points, nextPoint],
    distanceM: nextDistanceM,
    movingTimeMs: nextMovingTimeMs,
    elevationGainM: eleState.gainM,
    elevationLossM: eleState.lossM,
    lastElevationAnchorM: eleState.anchorM,
    netKcal: nextNetKcal,
    restingKcal: nextRestingKcal,
    totalKcal: nextTotalKcal,
    maxSpeedMps: nextMaxSpeedMps,
    lastAcceptedAtMs: nextCurrent.updatedAtMs,
    pendingSegmentBreak: false,
    updatedAtMs: nextCurrent.updatedAtMs,
  };
}

export function pauseActiveRun(
  session: ActiveRunSession,
  nowMs = Date.now(),
): ActiveRunSession {
  if (session.status === 'paused') {
    return session;
  }
  return {
    ...session,
    status: 'paused',
    pausedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function resumeActiveRun(
  session: ActiveRunSession,
  nowMs = Date.now(),
): ActiveRunSession {
  if (session.status === 'recording') {
    return session;
  }
  const pausedDuration =
    session.pausedAtMs !== null ? Math.max(0, nowMs - session.pausedAtMs) : 0;
  return {
    ...session,
    status: 'recording',
    pausedAtMs: null,
    accumulatedPausedMs: session.accumulatedPausedMs + pausedDuration,
    pendingSegmentBreak: session.points.length > 0,
    gpsFilter: createGpsFilterState({
      maxAccuracyM: session.gpsFilter.maxAccuracyM,
      initialCoarseLimitM: session.gpsFilter.initialCoarseLimitM,
      maxSpeedMps: session.gpsFilter.maxSpeedMps,
    }),
    updatedAtMs: nowMs,
  };
}

export function computeActiveElapsedTimeMs(
  session: ActiveRunSession,
  nowMs = Date.now(),
): number {
  const effectiveNowMs =
    session.status === 'paused' && session.pausedAtMs !== null ? session.pausedAtMs : nowMs;
  return Math.max(0, effectiveNowMs - session.startedAtMs - session.accumulatedPausedMs);
}

interface OpenSplitBucket {
  distanceM: number;
  elapsedSec: number;
  movingSec: number;
  netEleDeltaM: number;
  elevationGainM: number;
  elevationLossM: number;
  eleAnchorM: number | null;
  caloriesKcal: number;
}

function createSplitBucket(eleAnchorM: number | null): OpenSplitBucket {
  return {
    distanceM: 0,
    elapsedSec: 0,
    movingSec: 0,
    netEleDeltaM: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    eleAnchorM,
    caloriesKcal: 0,
  };
}

function finalizeSplitBucket(kmIndex: number, bucket: OpenSplitBucket): RunSplitKm {
  const distanceM = round1(bucket.distanceM);
  const elapsedSec = round1(bucket.elapsedSec);
  const movingSec = round1(bucket.movingSec);
  const effectiveSec = bucket.movingSec > 0 ? bucket.movingSec : bucket.elapsedSec;
  const paceSecPerKm =
    bucket.distanceM > 0 ? round1((effectiveSec / bucket.distanceM) * 1000) : 0;
  const avgGradePct =
    bucket.distanceM > 0 ? round1((bucket.netEleDeltaM / bucket.distanceM) * 100) : 0;

  return {
    kmIndex,
    distanceM,
    elapsedSec,
    movingSec,
    paceSecPerKm,
    elevationGainM: round1(bucket.elevationGainM),
    elevationLossM: round1(bucket.elevationLossM),
    avgGradePct,
    caloriesKcal: round1(bucket.caloriesKcal),
  };
}

export function computePerKmSplits(
  points: RecordedTrackPoint[],
  weightKg?: number | null,
): RunSplitKm[] {
  if (points.length < 2) {
    return [];
  }

  const splits: RunSplitKm[] = [];
  const initialEle =
    typeof points[0].ele === 'number' && Number.isFinite(points[0].ele)
      ? points[0].ele
      : null;
  let bucket = createSplitBucket(initialEle);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (curr.segmentBreak) {
      bucket.eleAnchorM =
        typeof curr.ele === 'number' && Number.isFinite(curr.ele) ? curr.ele : null;
      continue;
    }
    if (
      !Number.isFinite(prev.lat) ||
      !Number.isFinite(prev.lon) ||
      !Number.isFinite(curr.lat) ||
      !Number.isFinite(curr.lon) ||
      !Number.isFinite(prev.timestampMs) ||
      !Number.isFinite(curr.timestampMs)
    ) {
      continue;
    }

    const segDistM = geodesicDistanceM(
      { latitude: prev.lat, longitude: prev.lon },
      { latitude: curr.lat, longitude: curr.lon },
    );
    const segElapsedSec = Math.max(0, (curr.timestampMs - prev.timestampMs) / 1000);
    const segSpeedMps =
      curr.speedMps !== undefined && curr.speedMps !== null && Number.isFinite(curr.speedMps)
        ? curr.speedMps
        : segElapsedSec > 0
          ? segDistM / segElapsedSec
          : 0;
    const isMoving =
      segElapsedSec <= MAX_ACTIVE_STATIONARY_GAP_SEC &&
      (segSpeedMps >= MOVING_SPEED_THRESHOLD_MPS || segDistM >= MIN_APPEND_DISTANCE_M);
    const segMovingSec = isMoving ? segElapsedSec : 0;

    const hasPrevEle = typeof prev.ele === 'number' && Number.isFinite(prev.ele);
    const hasCurrEle = typeof curr.ele === 'number' && Number.isFinite(curr.ele);
    const segDeltaEle = hasPrevEle && hasCurrEle ? curr.ele! - prev.ele! : 0;
    const segCal = computeSegmentCaloriesKcal({
      distanceM: segDistM,
      deltaElevationM: segDeltaEle,
      durationSec: segElapsedSec,
      weightKg,
    });

    if (segDistM <= 0) {
      bucket.elapsedSec += segElapsedSec;
      bucket.movingSec += segMovingSec;
      bucket.caloriesKcal += segCal.totalKcal;
      if (hasCurrEle) {
        const nextEle = applyElevationHysteresis(
          bucket.eleAnchorM,
          bucket.elevationGainM,
          bucket.elevationLossM,
          curr.ele,
        );
        bucket.eleAnchorM = nextEle.anchorM;
        bucket.elevationGainM = nextEle.gainM;
        bucket.elevationLossM = nextEle.lossM;
      }
      continue;
    }

    if (bucket.eleAnchorM === null && hasPrevEle) {
      bucket.eleAnchorM = prev.ele!;
    }

    let remainingDistM = segDistM;
    let consumedFrac = 0;

    while (remainingDistM > 0) {
      const neededForKm = SPLIT_INTERVAL_M - bucket.distanceM;
      if (remainingDistM >= neededForKm) {
        const sliceFrac = neededForKm / segDistM;
        consumedFrac += sliceFrac;
        bucket.distanceM += neededForKm;
        bucket.elapsedSec += segElapsedSec * sliceFrac;
        bucket.movingSec += segMovingSec * sliceFrac;
        bucket.netEleDeltaM += segDeltaEle * sliceFrac;
        bucket.caloriesKcal += segCal.totalKcal * sliceFrac;

        const boundaryEle =
          hasPrevEle && hasCurrEle
            ? prev.ele! + segDeltaEle * consumedFrac
            : hasCurrEle
              ? curr.ele!
              : null;
        if (boundaryEle !== null) {
          const nextEle = applyElevationHysteresis(
            bucket.eleAnchorM,
            bucket.elevationGainM,
            bucket.elevationLossM,
            boundaryEle,
          );
          bucket.eleAnchorM = nextEle.anchorM;
          bucket.elevationGainM = nextEle.gainM;
          bucket.elevationLossM = nextEle.lossM;
        }

        splits.push(finalizeSplitBucket(splits.length + 1, bucket));
        bucket = createSplitBucket(boundaryEle);
        remainingDistM -= neededForKm;
      } else {
        const sliceFrac = remainingDistM / segDistM;
        bucket.distanceM += remainingDistM;
        bucket.elapsedSec += segElapsedSec * sliceFrac;
        bucket.movingSec += segMovingSec * sliceFrac;
        bucket.netEleDeltaM += segDeltaEle * sliceFrac;
        bucket.caloriesKcal += segCal.totalKcal * sliceFrac;
        if (hasCurrEle) {
          const nextEle = applyElevationHysteresis(
            bucket.eleAnchorM,
            bucket.elevationGainM,
            bucket.elevationLossM,
            curr.ele,
          );
          bucket.eleAnchorM = nextEle.anchorM;
          bucket.elevationGainM = nextEle.gainM;
          bucket.elevationLossM = nextEle.lossM;
        }
        remainingDistM = 0;
      }
    }
  }

  if (bucket.distanceM >= MIN_TRAILING_SPLIT_M) {
    splits.push(finalizeSplitBucket(splits.length + 1, bucket));
  }

  return splits;
}

export function trimRunTrackEndpoints(
  points: RecordedTrackPoint[],
  trimMeters = DEFAULT_PRIVACY_TRIM_M,
): {
  trimmedPoints: RecordedTrackPoint[];
  trimmedHeadM: number;
  trimmedTailM: number;
} {
  if (points.length === 0) {
    return { trimmedPoints: [], trimmedHeadM: 0, trimmedTailM: 0 };
  }
  if (trimMeters <= 0) {
    return { trimmedPoints: [...points], trimmedHeadM: 0, trimmedTailM: 0 };
  }

  const cumDistM: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const delta = curr.segmentBreak
      ? 0
      : geodesicDistanceM(
          { latitude: prev.lat, longitude: prev.lon },
          { latitude: curr.lat, longitude: curr.lon },
        );
    cumDistM.push(cumDistM[i - 1] + delta);
  }

  const totalDistM = cumDistM[cumDistM.length - 1];
  if (totalDistM <= trimMeters * 2 + 50) {
    return {
      trimmedPoints: [],
      trimmedHeadM: Math.round(totalDistM),
      trimmedTailM: 0,
    };
  }

  let firstKeptIdx = -1;
  let lastKeptIdx = -1;
  for (let i = 0; i < points.length; i += 1) {
    const distFromStart = cumDistM[i];
    const distFromFinish = totalDistM - cumDistM[i];
    if (distFromStart >= trimMeters && distFromFinish >= trimMeters) {
      if (firstKeptIdx === -1) firstKeptIdx = i;
      lastKeptIdx = i;
    }
  }

  if (firstKeptIdx === -1 || lastKeptIdx === -1) {
    return {
      trimmedPoints: [],
      trimmedHeadM: Math.round(totalDistM),
      trimmedTailM: 0,
    };
  }

  return {
    trimmedPoints: points.slice(firstKeptIdx, lastKeptIdx + 1),
    trimmedHeadM: round1(cumDistM[firstKeptIdx]),
    trimmedTailM: round1(totalDistM - cumDistM[lastKeptIdx]),
  };
}

export function buildPreviewPolyline(
  points: RecordedTrackPoint[],
  maxPoints = 240,
): Array<[number, number]> {
  if (points.length === 0 || maxPoints <= 0) {
    return [];
  }
  const formatPair = (pt: RecordedTrackPoint): [number, number] => [
    Number(pt.lon.toFixed(5)),
    Number(pt.lat.toFixed(5)),
  ];
  if (maxPoints === 1) {
    return [formatPair(points[0])];
  }
  if (points.length <= maxPoints) {
    return points.map(formatPair);
  }

  const out: Array<[number, number]> = [];
  const lastIdx = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = i === maxPoints - 1 ? lastIdx : Math.round((i / (maxPoints - 1)) * lastIdx);
    out.push(formatPair(points[idx]));
  }
  return out;
}

export async function enrichRunTrackElevation(
  points: RecordedTrackPoint[],
  sampler?: (coords: Array<{ lat: number; lon: number }>) => Promise<Array<number | null>>,
): Promise<{
  points: RecordedTrackPoint[];
  elevationGainM: number;
  elevationLossM: number;
  elevationSource: 'dem' | 'gps' | 'mixed';
}> {
  if (points.length === 0) {
    return {
      points: [],
      elevationGainM: 0,
      elevationLossM: 0,
      elevationSource: 'gps',
    };
  }

  const activeSampler = sampler ?? sampleRealDemElevationBatch;
  let demResults: Array<number | null>;
  try {
    demResults = await activeSampler(points.map((pt) => ({ lat: pt.lat, lon: pt.lon })));
  } catch (err) {
    console.warn('[runRecorderEngine] DEM elevation batch failed; falling back to GPS/local DEM', err);
    demResults = new Array(points.length).fill(null);
  }

  let demCount = 0;
  let gpsCount = 0;
  let anchorM: number | null = null;
  let gainM = 0;
  let lossM = 0;

  const enrichedPoints = points.map((pt, idx) => {
    const realEle = demResults[idx];
    let resolvedEle: number | undefined;

    if (typeof realEle === 'number' && Number.isFinite(realEle)) {
      resolvedEle = round1(realEle);
      demCount += 1;
    } else if (typeof pt.ele === 'number' && Number.isFinite(pt.ele)) {
      // Preserve real barometric/GPS altitude offline instead of overwriting with synthetic fbm relief.
      resolvedEle = round1(pt.ele);
      gpsCount += 1;
    } else if (isInsidePhilippinesBounds(pt.lat, pt.lon)) {
      const phEle = samplePhilippineDemElevationM(pt.lat, pt.lon, { assumeInsideLand: true });
      if (Number.isFinite(phEle)) {
        resolvedEle = round1(phEle);
        demCount += 1;
      }
    }

    const eleState = applyElevationHysteresis(
      pt.segmentBreak ? null : anchorM,
      gainM,
      lossM,
      resolvedEle,
    );
    anchorM = eleState.anchorM;
    gainM = eleState.gainM;
    lossM = eleState.lossM;

    if (resolvedEle !== undefined) {
      return { ...pt, ele: resolvedEle };
    }
    return { ...pt };
  });

  const elevationSource: 'dem' | 'gps' | 'mixed' =
    demCount > 0 && gpsCount > 0 ? 'mixed' : demCount > 0 ? 'dem' : 'gps';

  return {
    points: enrichedPoints,
    elevationGainM: gainM,
    elevationLossM: lossM,
    elevationSource,
  };
}

function classifyPhilippineIslandGroup(
  lat: number,
  lon: number,
): 'Luzon' | 'Visayas' | 'Mindanao' | null {
  if (!isInsidePhilippinesBounds(lat, lon)) {
    return null;
  }

  // Luzon: Mainland, Cordillera, Bicol, Mindoro, Marinduque, Romblon, Masbate, and Palawan
  if (lat >= 12.75) return 'Luzon';
  if (lat >= 12.10 && lon <= 124.18) return 'Luzon';
  if (lat >= 11.72 && lat <= 12.66 && lon >= 123.10 && lon <= 124.10) return 'Luzon';
  if (lat >= 7.40 && lat <= 12.10 && lon <= 121.40) return 'Luzon';

  // Visayas: Panay, Guimaras, Negros, Cebu, Siquijor, Bohol, Leyte, Biliran, Samar
  if (lat >= 10.55) return 'Visayas';
  if (lat >= 9.50 && lon < 125.40) return 'Visayas';
  if (lat >= 9.00 && lon < 124.45) return 'Visayas';

  // Mindanao: Mainland, Camiguin, Dinagat, Siargao, Basilan, Sulu, and Tawi-Tawi
  return 'Mindanao';
}

export function detectPhilippineIslandGroups(
  points: Array<{ lat: number; lon: number }>,
): Array<'Luzon' | 'Visayas' | 'Mindanao'> {
  const found = new Set<'Luzon' | 'Visayas' | 'Mindanao'>();
  for (const pt of points) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    const group = classifyPhilippineIslandGroup(pt.lat, pt.lon);
    if (group) found.add(group);
  }
  return (['Luzon', 'Visayas', 'Mindanao'] as const).filter((group) => found.has(group));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatIsoTimestamp(timestampMs: number): string | null {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildRunGpxXml(input: {
  title: string;
  startedAt: string;
  points: RecordedTrackPoint[];
  privacyTrimApplied?: boolean;
}): string {
  const safeTitle = escapeXml(input.title.trim() || 'RacePulsePH Recorded Run');
  const safeStartedAt = escapeXml(input.startedAt);
  const trkptsXml = input.points
    .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lon))
    .map((pt) => {
      const eleTag =
        typeof pt.ele === 'number' && Number.isFinite(pt.ele)
          ? `<ele>${pt.ele.toFixed(1)}</ele>`
          : '';
      const isoTime = formatIsoTimestamp(pt.timestampMs);
      const timeTag = isoTime ? `<time>${isoTime}</time>` : '';
      const inner = `${eleTag}${timeTag}`;
      return inner
        ? `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}">${inner}</trkpt>`
        : `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}" />`;
    })
    .join('\n');

  const descLine = input.privacyTrimApplied
    ? '    <desc>200m home privacy trim applied on export</desc>'
    : null;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RacePulsePH" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${safeTitle}</name>`,
    ...(descLine ? [descLine] : []),
    ...(safeStartedAt ? [`    <time>${safeStartedAt}</time>`] : []),
    '  </metadata>',
    '  <trk>',
    `    <name>${safeTitle}</name>`,
    '    <trkseg>',
    ...(trkptsXml ? [trkptsXml] : []),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
