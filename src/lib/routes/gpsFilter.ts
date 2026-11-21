import { geodesicDistanceM } from './geometry';
import { PHILIPPINES_TILE_BBOX } from './philippinesMapTiles';

export type GpsSignalQuality = 'high' | 'good' | 'coarse' | 'stale';

export interface GpsRawFix {
  lat: number;
  lon: number;
  accuracyM: number;
  altitudeM?: number | null;
  headingDeg?: number | null;
  speedMps?: number | null;
  timestampMs: number;
}

export interface FilteredGpsPosition {
  lat: number;
  lon: number;
  rawLat: number;
  rawLon: number;
  accuracyM: number;
  altitudeM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  paceMinPerKm: number | null;
  quality: GpsSignalQuality;
  updatedAtMs: number;
  fixCount: number;
  rejectedCount: number;
  lastRejectReason: string | null;
  insidePhilippines: boolean;
}

export interface GpsFilterState {
  maxAccuracyM: number;
  initialCoarseLimitM: number;
  maxSpeedMps: number;
  varianceLatLonM2: number;
  current: FilteredGpsPosition | null;
  pendingJump: GpsRawFix | null;
  rejectedCount: number;
  lastRejectReason: string | null;
}

export function createGpsFilterState(options?: {
  maxAccuracyM?: number;
  initialCoarseLimitM?: number;
  maxSpeedMps?: number;
}): GpsFilterState {
  return {
    maxAccuracyM: options?.maxAccuracyM ?? 35,
    initialCoarseLimitM: options?.initialCoarseLimitM ?? 100,
    maxSpeedMps: options?.maxSpeedMps ?? 15,
    varianceLatLonM2: 0,
    current: null,
    pendingJump: null,
    rejectedCount: 0,
    lastRejectReason: null,
  };
}

export function classifyGpsAccuracy(accuracyM: number): Exclude<GpsSignalQuality, 'stale'> {
  if (accuracyM <= 15) return 'high';
  if (accuracyM <= 35) return 'good';
  return 'coarse';
}

export function isInsidePhilippinesBounds(lat: number, lon: number): boolean {
  return (
    lat >= PHILIPPINES_TILE_BBOX.south &&
    lat <= PHILIPPINES_TILE_BBOX.north &&
    lon >= PHILIPPINES_TILE_BBOX.west &&
    lon <= PHILIPPINES_TILE_BBOX.east
  );
}

export function computeBearingDeg(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Ingests a raw GNSS fix through accuracy gating, multipath teleport rejection,
 * stationary jitter clamping, and an accuracy-weighted 2D Kalman smoother.
 */
export function ingestGpsFix(state: GpsFilterState, fix: GpsRawFix): GpsFilterState {
  const validCoord =
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lon) <= 180;
  const validAcc = Number.isFinite(fix.accuracyM) && fix.accuracyM > 0;

  if (!validCoord || !validAcc) {
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: 'Ignored invalid GPS coordinate or missing accuracy reading.',
      current: state.current
        ? {
            ...state.current,
            rejectedCount: state.rejectedCount + 1,
            lastRejectReason: 'Ignored invalid GPS coordinate or missing accuracy reading.',
          }
        : null,
    };
  }

  const accuracyM = Math.max(1, Math.round(fix.accuracyM));
  const insidePH = isInsidePhilippinesBounds(fix.lat, fix.lon);
  const timestampMs = Number.isFinite(fix.timestampMs) && fix.timestampMs > 0 ? fix.timestampMs : Date.now();

  if (!state.current) {
    if (accuracyM > state.initialCoarseLimitM) {
      const reason = `GPS accuracy ±${accuracyM}m too low; waiting for stronger signal.`;
      return {
        ...state,
        rejectedCount: state.rejectedCount + 1,
        lastRejectReason: reason,
      };
    }
    const initialPos: FilteredGpsPosition = {
      lat: fix.lat,
      lon: fix.lon,
      rawLat: fix.lat,
      rawLon: fix.lon,
      accuracyM,
      altitudeM:
        fix.altitudeM !== undefined && fix.altitudeM !== null && Number.isFinite(fix.altitudeM)
          ? Number(fix.altitudeM.toFixed(1))
          : null,
      headingDeg:
        fix.headingDeg !== undefined && fix.headingDeg !== null && Number.isFinite(fix.headingDeg)
          ? Math.round(fix.headingDeg)
          : null,
      speedMps:
        fix.speedMps !== undefined && fix.speedMps !== null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0
          ? Number(fix.speedMps.toFixed(2))
          : null,
      paceMinPerKm:
        fix.speedMps !== undefined && fix.speedMps !== null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0.7
          ? Number((1000 / 60 / fix.speedMps).toFixed(2))
          : null,
      quality: classifyGpsAccuracy(accuracyM),
      updatedAtMs: timestampMs,
      fixCount: 1,
      rejectedCount: state.rejectedCount,
      lastRejectReason: state.lastRejectReason,
      insidePhilippines: insidePH,
    };
    return {
      ...state,
      varianceLatLonM2: Math.max(9, accuracyM * accuracyM),
      current: initialPos,
      pendingJump: null,
      lastRejectReason: null,
    };
  }

  const prev = state.current;
  const dtSec = Math.max(0.4, (timestampMs - prev.updatedAtMs) / 1000);
  const rawJumpM = geodesicDistanceM(
    { latitude: prev.lat, longitude: prev.lon },
    { latitude: fix.lat, longitude: fix.lon },
  );
  const impliedSpeedMps = rawJumpM / dtSec;

  const improvingFromCoarse =
    prev.quality === 'coarse' && accuracyM <= Math.max(state.maxAccuracyM, prev.accuracyM * 0.8);

  // Allow coarse mountain/trail canopy fixes (up to 65m) if movement is realistic
  const canAcceptCoarseCanopy =
    accuracyM <= 65 && impliedSpeedMps > 0.3 && impliedSpeedMps <= state.maxSpeedMps;

  if (accuracyM > state.maxAccuracyM && !improvingFromCoarse && !canAcceptCoarseCanopy) {
    const reason = `GPS accuracy ±${accuracyM}m exceeds ±${state.maxAccuracyM}m gate.`;
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: reason,
      current: {
        ...prev,
        rejectedCount: state.rejectedCount + 1,
        lastRejectReason: reason,
      },
    };
  }

  // Reject isolated multipath spikes unless a second consecutive fix confirms the new neighborhood.
  if (impliedSpeedMps > state.maxSpeedMps && rawJumpM > Math.max(40, accuracyM * 2)) {
    const pendingDist = state.pendingJump
      ? geodesicDistanceM(
          { latitude: state.pendingJump.lat, longitude: state.pendingJump.lon },
          { latitude: fix.lat, longitude: fix.lon },
        )
      : Infinity;
    if (pendingDist > 35) {
      const reason = `Filtered GPS spike (${Math.round(rawJumpM)}m jump).`;
      return {
        ...state,
        pendingJump: fix,
        rejectedCount: state.rejectedCount + 1,
        lastRejectReason: reason,
        current: {
          ...prev,
          rejectedCount: state.rejectedCount + 1,
          lastRejectReason: reason,
        },
      };
    }
  }

  // Stationary jitter clamp preserves steady heartbeat without drifting marker around.
  const jitterFloorM = Math.min(3, accuracyM * 0.25);
  if (rawJumpM < jitterFloorM && accuracyM >= prev.accuracyM * 0.7) {
    return {
      ...state,
      pendingJump: null,
      lastRejectReason: null,
      current: {
        ...prev,
        rawLat: fix.lat,
        rawLon: fix.lon,
        accuracyM: Math.min(prev.accuracyM, accuracyM),
        quality: classifyGpsAccuracy(Math.min(prev.accuracyM, accuracyM)),
        updatedAtMs: timestampMs,
        speedMps: 0,
        paceMinPerKm: null,
        lastRejectReason: null,
      },
    };
  }

  // 1D-decoupled 2D scalar Kalman blend with velocity-adaptive process noise
  const estimatedSpeed = Math.max(
    fix.speedMps && fix.speedMps > 0 ? fix.speedMps : 0,
    prev.speedMps && prev.speedMps > 0 ? prev.speedMps : 0,
    impliedSpeedMps,
  );
  const speedScale = Math.max(1, estimatedSpeed / 2.5);
  const processNoiseM2 = dtSec * 6.25 * (speedScale * speedScale);
  const predictedVarM2 = Math.max(9, state.varianceLatLonM2 + processNoiseM2);
  const measurementVarM2 = Math.max(9, accuracyM * accuracyM);
  const baseGain = predictedVarM2 / (predictedVarM2 + measurementVarM2);
  const minMovingGain = estimatedSpeed >= 1.2 ? Math.min(0.65, 0.18 + (estimatedSpeed / 15) * 0.32) : 0.05;
  const gain = improvingFromCoarse ? 0.9 : Math.max(minMovingGain, baseGain);

  const nextLat = prev.lat + gain * (fix.lat - prev.lat);
  const nextLon = prev.lon + gain * (fix.lon - prev.lon);
  const nextVarianceM2 = (1 - gain) * predictedVarM2;

  const movedSmoothedM = geodesicDistanceM(
    { latitude: prev.lat, longitude: prev.lon },
    { latitude: nextLat, longitude: nextLon },
  );
  const derivedHeading =
    fix.headingDeg !== undefined && fix.headingDeg !== null && Number.isFinite(fix.headingDeg)
      ? Math.round(((fix.headingDeg % 360) + 360) % 360)
      : movedSmoothedM >= 3
        ? Math.round(computeBearingDeg({ lat: prev.lat, lon: prev.lon }, { lat: nextLat, lon: nextLon }))
        : prev.headingDeg;

  const computedSpeed =
    fix.speedMps !== undefined && fix.speedMps !== null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0
      ? Number(fix.speedMps.toFixed(2))
      : movedSmoothedM >= 2
        ? Number((movedSmoothedM / dtSec).toFixed(2))
        : 0;

  const paceMinPerKm =
    computedSpeed >= 0.7 ? Number(Math.min(25, 1000 / 60 / computedSpeed).toFixed(2)) : null;

  return {
    ...state,
    varianceLatLonM2: nextVarianceM2,
    pendingJump: null,
    lastRejectReason: null,
    current: {
      lat: Number(nextLat.toFixed(6)),
      lon: Number(nextLon.toFixed(6)),
      rawLat: fix.lat,
      rawLon: fix.lon,
      accuracyM,
      altitudeM:
        fix.altitudeM !== undefined && fix.altitudeM !== null && Number.isFinite(fix.altitudeM)
          ? Number(fix.altitudeM.toFixed(1))
          : prev.altitudeM,
      headingDeg: derivedHeading,
      speedMps: computedSpeed,
      paceMinPerKm,
      quality: classifyGpsAccuracy(accuracyM),
      updatedAtMs: timestampMs,
      fixCount: prev.fixCount + 1,
      rejectedCount: state.rejectedCount,
      lastRejectReason: null,
      insidePhilippines: insidePH,
    },
  };
}

/**
 * Generates a geodesic polygon ring representing the live GPS accuracy radius in meters.
 */
export function buildGpsAccuracyCircleGeoJson(
  lat: number,
  lon: number,
  radiusM: number,
  steps = 48,
): GeoJSON.FeatureCollection {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM) || radiusM <= 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const clampedM = Math.max(2, Math.min(250, radiusM));
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLat = clampedM / 111_132;
  const dLon = clampedM / (111_320 * cosLat);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    ring.push([lon + Math.cos(theta) * dLon, lat + Math.sin(theta) * dLat]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { radiusM: clampedM },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };
}
