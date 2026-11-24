import { geodesicDistanceM } from '../routes/geometry';
import type { RecordedTrackPoint, RunCalorieEstimate } from './types';

// Constants must mirror functions/run-math.js verbatim so client previews match server verification.
export const DEFAULT_REFERENCE_WEIGHT_KG = 65;
export const MIN_WEIGHT_KG = 25;
export const MAX_WEIGHT_KG = 250;
export const CALORIE_METHOD_VERSION = 'minetti2002-herrmann2024-v1' as const;
export const RUNNING_SPEED_THRESHOLD_MPS = 1.8;
export const RESTING_KCAL_PER_KG_HR = 1.05;
export const JOULES_PER_KCAL = 4184;
export const MAX_ACTIVE_STATIONARY_GAP_SEC = 180;

const MIN_GRADE = -0.45;
const MAX_GRADE = 0.45;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function resolveCalorieWeightKg(weightKg?: number | null): {
  weightKgUsed: number;
  usedReferenceWeight: boolean;
} {
  if (
    typeof weightKg === 'number' &&
    Number.isFinite(weightKg) &&
    weightKg >= MIN_WEIGHT_KG &&
    weightKg <= MAX_WEIGHT_KG
  ) {
    return { weightKgUsed: weightKg, usedReferenceWeight: false };
  }
  return { weightKgUsed: DEFAULT_REFERENCE_WEIGHT_KG, usedReferenceWeight: true };
}

/**
 * Computes Minetti et al. (2002) net metabolic energy cost (J / kg / m) across
 * grade [-0.45, +0.45] for running (v >= 1.8 m/s) or walking (v < 1.8 m/s).
 */
export function computeMinettiNetCostJPerKgM(grade: number, speedMps: number): number {
  const clampedGrade = Number.isFinite(grade)
    ? Math.max(MIN_GRADE, Math.min(MAX_GRADE, grade))
    : 0;
  const i = clampedGrade;
  const i2 = i * i;
  const i3 = i2 * i;
  const i4 = i3 * i;
  const i5 = i4 * i;
  const safeSpeed = Number.isFinite(speedMps) ? speedMps : 0;

  if (safeSpeed >= RUNNING_SPEED_THRESHOLD_MPS) {
    return Math.max(
      1.2,
      155.4 * i5 - 30.4 * i4 - 43.3 * i3 + 46.3 * i2 + 19.5 * i + 3.6,
    );
  }
  return Math.max(
    1.0,
    280.5 * i5 - 58.7 * i4 - 76.8 * i3 + 51.9 * i2 + 19.6 * i + 2.5,
  );
}

/**
 * Estimates segment net exercise calories (Minetti) plus resting 1-MET baseline (Herrmann 2024).
 * Returns unrounded values so 1 Hz accumulation does not drift; final totals are rounded to 0.1 kcal.
 */
export function computeSegmentCaloriesKcal(input: {
  distanceM: number;
  deltaElevationM: number;
  durationSec: number;
  weightKg?: number | null;
}): {
  netKcal: number;
  restingKcal: number;
  totalKcal: number;
  weightKgUsed: number;
} {
  const { weightKgUsed } = resolveCalorieWeightKg(input.weightKg);

  if (
    !Number.isFinite(input.durationSec) ||
    input.durationSec <= 0 ||
    !Number.isFinite(input.distanceM) ||
    input.distanceM < 0
  ) {
    return { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed };
  }

  // Prevent long stationary stops (e.g. forgotten pause) from accruing ghost calories.
  if (input.durationSec > MAX_ACTIVE_STATIONARY_GAP_SEC && input.distanceM < 10) {
    return { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed };
  }

  const restingKcal = RESTING_KCAL_PER_KG_HR * weightKgUsed * (input.durationSec / 3600);
  if (input.distanceM === 0) {
    return {
      netKcal: 0,
      restingKcal,
      totalKcal: restingKcal,
      weightKgUsed,
    };
  }

  const deltaEle = Number.isFinite(input.deltaElevationM) ? input.deltaElevationM : 0;
  const speedMps = input.distanceM / input.durationSec;
  const grade = deltaEle / input.distanceM;
  const netCostJPerKgM = computeMinettiNetCostJPerKgM(grade, speedMps);
  const netKcal = (netCostJPerKgM * weightKgUsed * input.distanceM) / JOULES_PER_KCAL;

  return {
    netKcal,
    restingKcal,
    totalKcal: netKcal + restingKcal,
    weightKgUsed,
  };
}

export function computeRunCalorieEstimate(
  points: RecordedTrackPoint[],
  weightKg?: number | null,
): RunCalorieEstimate {
  const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(weightKg);
  let rawNetKcal = 0;
  let rawRestingKcal = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (
      !Number.isFinite(prev.lat) ||
      !Number.isFinite(prev.lon) ||
      !Number.isFinite(curr.lat) ||
      !Number.isFinite(curr.lon)
    ) {
      continue;
    }
    const distanceM = geodesicDistanceM(
      { latitude: prev.lat, longitude: prev.lon },
      { latitude: curr.lat, longitude: curr.lon },
    );
    const durationSec = (curr.timestampMs - prev.timestampMs) / 1000;
    const deltaElevationM =
      typeof prev.ele === 'number' &&
      Number.isFinite(prev.ele) &&
      typeof curr.ele === 'number' &&
      Number.isFinite(curr.ele)
        ? curr.ele - prev.ele
        : 0;

    const seg = computeSegmentCaloriesKcal({
      distanceM,
      deltaElevationM,
      durationSec,
      weightKg: weightKgUsed,
    });
    rawNetKcal += seg.netKcal;
    rawRestingKcal += seg.restingKcal;
  }

  const netKcal = round1(rawNetKcal);
  const restingKcal = round1(rawRestingKcal);
  const totalKcal = round1(netKcal + restingKcal);

  return {
    totalKcal,
    netKcal,
    restingKcal,
    weightKgUsed,
    usedReferenceWeight,
    methodVersion: CALORIE_METHOD_VERSION,
  };
}
