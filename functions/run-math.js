'use strict';

const DEFAULT_REFERENCE_WEIGHT_KG = 65;
const MIN_WEIGHT_KG = 25;
const MAX_WEIGHT_KG = 250;
const CALORIE_METHOD_VERSION = 'minetti2002-herrmann2024-v1';
const RUNNING_SPEED_THRESHOLD_MPS = 1.8;
const RESTING_KCAL_PER_KG_HR = 1.05;
const JOULES_PER_KCAL = 4184;
const MAX_ACTIVE_STATIONARY_GAP_SEC = 180;
const ELEVATION_HYSTERESIS_M = 2.5;
const MAX_SERVER_TRACK_POINTS = 5000;
const MAX_TRIM_CREDIT_M = 250;

const MIN_GRADE = -0.45;
const MAX_GRADE = 0.45;
const MOVING_SPEED_THRESHOLD_MPS = 0.45;
const MIN_APPEND_DISTANCE_M = 2.5;
const SPLIT_INTERVAL_M = 1000;
const MIN_TRAILING_SPLIT_M = 50;
const MAX_ELAPSED_TIME_MS = 48 * 3600 * 1000;
const MIN_MOVING_TIME_MS = 10_000;
const MAX_MOVING_TIME_MS = 172_800_000;
const MIN_ELEVATION_M = -450;
const MAX_ELEVATION_M = 9000;

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const VALID_MODES = new Set(['free', 'course']);
const VALID_PRIVACY = new Set(['private', 'friends', 'public']);

const PHILIPPINES_TILE_BBOX = {
  west: 115.6,
  south: 4.1,
  east: 127.8,
  north: 21.6,
};

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round1(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  const rounded = Math.round(val * 10) / 10 + 0;
  return rounded === 0 ? 0 : rounded;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function geodesicDistanceM(a, b) {
  const aLat = a?.latitude ?? a?.lat;
  const aLon = a?.longitude ?? a?.lon;
  const bLat = b?.latitude ?? b?.lat;
  const bLon = b?.longitude ?? b?.lon;
  const earthRadiusM = 6_371_000;
  const latDelta = toRadians(bLat - aLat);
  const lonDelta = toRadians(bLon - aLon);
  const startLat = toRadians(aLat);
  const endLat = toRadians(bLat);
  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
  const clamped = Math.max(0, Math.min(1, h));
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function resolveCalorieWeightKg(weightKg) {
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

function computeMinettiNetCostJPerKgM(grade, speedMps) {
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

function computeSegmentCaloriesKcal(input) {
  const { weightKgUsed } = resolveCalorieWeightKg(input?.weightKg);
  if (
    !Number.isFinite(input?.durationSec) ||
    input.durationSec <= 0 ||
    !Number.isFinite(input?.distanceM) ||
    input.distanceM < 0
  ) {
    return { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed };
  }
  if (input.durationSec > MAX_ACTIVE_STATIONARY_GAP_SEC && input.distanceM < 10) {
    return { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed };
  }

  const restingKcal = RESTING_KCAL_PER_KG_HR * weightKgUsed * (input.durationSec / 3600);
  if (input.distanceM === 0) {
    return { netKcal: 0, restingKcal, totalKcal: restingKcal, weightKgUsed };
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

function applyElevationHysteresis(anchorM, gainM, lossM, elevationM) {
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

function createSplitBucket(eleAnchorM) {
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

function finalizeSplitBucket(kmIndex, bucket) {
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

function computePerKmSplits(points, weightKg) {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }

  const splits = [];
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
    const segDeltaEle = hasPrevEle && hasCurrEle ? curr.ele - prev.ele : 0;
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
      bucket.eleAnchorM = prev.ele;
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
            ? prev.ele + segDeltaEle * consumedFrac
            : hasCurrEle
              ? curr.ele
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

function buildPreviewPolyline(points, maxPoints = 240) {
  if (!Array.isArray(points) || points.length === 0 || maxPoints <= 0) {
    return [];
  }
  const formatPair = (pt) => {
    const lon = Number(pt.lon.toFixed(5)) + 0;
    const lat = Number(pt.lat.toFixed(5)) + 0;
    return [lon === 0 ? 0 : lon, lat === 0 ? 0 : lat];
  };
  if (maxPoints === 1) {
    return [formatPair(points[0])];
  }
  if (points.length <= maxPoints) {
    return points.map(formatPair);
  }
  const out = [];
  const lastIdx = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = i === maxPoints - 1 ? lastIdx : Math.round((i / (maxPoints - 1)) * lastIdx);
    out.push(formatPair(points[idx]));
  }
  return out;
}

function isInsidePhilippinesBounds(lat, lon) {
  return (
    lat >= PHILIPPINES_TILE_BBOX.south &&
    lat <= PHILIPPINES_TILE_BBOX.north &&
    lon >= PHILIPPINES_TILE_BBOX.west &&
    lon <= PHILIPPINES_TILE_BBOX.east
  );
}

function classifyPhilippineIslandGroup(lat, lon) {
  if (!isInsidePhilippinesBounds(lat, lon)) {
    return null;
  }
  if (lat >= 12.75) return 'Luzon';
  if (lat >= 12.10 && lon <= 124.18) return 'Luzon';
  if (lat >= 11.72 && lat <= 12.66 && lon >= 123.10 && lon <= 124.10) return 'Luzon';
  if (lat >= 7.40 && lat <= 12.10 && lon <= 121.40) return 'Luzon';

  if (lat >= 10.55) return 'Visayas';
  if (lat >= 9.50 && lon < 125.40) return 'Visayas';
  if (lat >= 9.00 && lon < 124.45) return 'Visayas';

  return 'Mindanao';
}

function detectPhilippineIslandGroups(points) {
  const found = new Set();
  for (const pt of points || []) {
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lon)) continue;
    const group = classifyPhilippineIslandGroup(pt.lat, pt.lon);
    if (group) found.add(group);
  }
  return ['Luzon', 'Visayas', 'Mindanao'].filter((group) => found.has(group));
}

function computeTrackMetrics(trackPoints, weightKg) {
  const points = Array.isArray(trackPoints) ? trackPoints : [];
  const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(weightKg);

  let trackDistanceM = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let eleAnchorM =
    points.length > 0 && typeof points[0]?.ele === 'number' && Number.isFinite(points[0].ele)
      ? points[0].ele
      : null;
  let rawNetKcal = 0;
  let rawRestingKcal = 0;
  let segmentCount = 0;
  let burstSegmentCount = 0;
  let maxSpeedMps =
    points.length > 0 &&
    typeof points[0]?.speedMps === 'number' &&
    Number.isFinite(points[0].speedMps) &&
    points[0].speedMps >= 0
      ? points[0].speedMps
      : 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (curr.segmentBreak === true) {
      eleAnchorM =
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
    trackDistanceM += segDistM;

    const eleState = applyElevationHysteresis(
      eleAnchorM,
      elevationGainM,
      elevationLossM,
      curr.ele,
    );
    eleAnchorM = eleState.anchorM;
    elevationGainM = eleState.gainM;
    elevationLossM = eleState.lossM;

    const durationSec = (curr.timestampMs - prev.timestampMs) / 1000;
    const deltaElevationM =
      typeof prev.ele === 'number' &&
      Number.isFinite(prev.ele) &&
      typeof curr.ele === 'number' &&
      Number.isFinite(curr.ele)
        ? curr.ele - prev.ele
        : 0;
    const segCal = computeSegmentCaloriesKcal({
      distanceM: segDistM,
      deltaElevationM,
      durationSec,
      weightKg: weightKgUsed,
    });
    rawNetKcal += segCal.netKcal;
    rawRestingKcal += segCal.restingKcal;

    segmentCount += 1;
    const segSpeedMps = durationSec > 0 ? segDistM / durationSec : segDistM > 0 ? Infinity : 0;
    if (segDistM >= 10 && segSpeedMps > 11.5) {
      burstSegmentCount += 1;
    }
    const candidateMaxSpeed =
      typeof curr.speedMps === 'number' && Number.isFinite(curr.speedMps) && curr.speedMps >= 0
        ? curr.speedMps
        : Number.isFinite(segSpeedMps)
          ? segSpeedMps
          : 0;
    if (candidateMaxSpeed > maxSpeedMps) {
      maxSpeedMps = candidateMaxSpeed;
    }
  }

  const netKcal = round1(rawNetKcal);
  const restingKcal = round1(rawRestingKcal);
  const totalKcal = round1(netKcal + restingKcal);

  return {
    trackDistanceM,
    elevationGainM: round1(elevationGainM),
    elevationLossM: round1(elevationLossM),
    calorieEstimate: {
      totalKcal,
      netKcal,
      restingKcal,
      weightKgUsed,
      usedReferenceWeight,
      methodVersion: CALORIE_METHOD_VERSION,
    },
    splits: computePerKmSplits(points, weightKgUsed),
    previewPolyline: buildPreviewPolyline(points, 240),
    islandGroups: detectPhilippineIslandGroups(points),
    segmentCount,
    burstSegmentCount,
    maxSpeedMps: Number(maxSpeedMps.toFixed(2)) + 0,
  };
}

function validateCourseRef(courseRef) {
  if (courseRef === undefined || courseRef === null) return undefined;
  if (typeof courseRef !== 'object' || Array.isArray(courseRef)) {
    fail('Invalid courseRef.', 400);
  }
  const raceId = typeof courseRef.raceId === 'string' ? courseRef.raceId.trim() : '';
  const distanceId = typeof courseRef.distanceId === 'string' ? courseRef.distanceId.trim() : '';
  const raceName = typeof courseRef.raceName === 'string' ? courseRef.raceName.trim() : '';
  const distanceLabel = typeof courseRef.distanceLabel === 'string' ? courseRef.distanceLabel.trim() : '';
  const advertisedKm = courseRef.advertisedKm;

  if (!VALID_ID_RE.test(raceId) || !VALID_ID_RE.test(distanceId)) {
    fail('Invalid courseRef raceId or distanceId.', 400);
  }
  if (!raceName || raceName.length > 150 || !distanceLabel || distanceLabel.length > 50) {
    fail('Invalid courseRef raceName or distanceLabel.', 400);
  }
  if (typeof advertisedKm !== 'number' || !Number.isFinite(advertisedKm) || advertisedKm <= 0 || advertisedKm > 500) {
    fail('Invalid courseRef advertisedKm.', 400);
  }

  const out = {
    raceId,
    distanceId,
    raceName,
    distanceLabel,
    advertisedKm,
  };
  if (courseRef.publicationId !== undefined && courseRef.publicationId !== null && courseRef.publicationId !== '') {
    const pubId = typeof courseRef.publicationId === 'string' ? courseRef.publicationId.trim() : '';
    if (!VALID_ID_RE.test(pubId)) fail('Invalid courseRef publicationId.', 400);
    out.publicationId = pubId;
  }
  if (courseRef.region !== undefined && courseRef.region !== null && courseRef.region !== '') {
    const region = typeof courseRef.region === 'string' ? courseRef.region.trim() : '';
    if (region.length > 80) fail('Invalid courseRef region.', 400);
    out.region = region;
  }
  return out;
}

function validateTrackPoints(rawPoints) {
  if (!Array.isArray(rawPoints)) {
    fail('trackPoints must be an array.', 400);
  }
  if (rawPoints.length > MAX_SERVER_TRACK_POINTS) {
    fail(`trackPoints exceeds maximum ${MAX_SERVER_TRACK_POINTS} points.`, 400);
  }
  if (rawPoints.length === 1) {
    fail('trackPoints must contain at least 2 points or be empty for short trimmed runs.', 400);
  }

  let prevTs = -Infinity;
  return rawPoints.map((pt) => {
    if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
      fail('Invalid track point.', 400);
    }
    const { lat, lon, timestampMs, ele, accuracyM, speedMps, segmentBreak } = pt;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      fail('Invalid track point latitude.', 400);
    }
    if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      fail('Invalid track point longitude.', 400);
    }
    if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0 || timestampMs < prevTs) {
      fail('Track point timestamps must be finite and non-decreasing.', 400);
    }
    prevTs = timestampMs;

    if (ele !== undefined && ele !== null) {
      if (typeof ele !== 'number' || !Number.isFinite(ele) || ele < MIN_ELEVATION_M || ele > MAX_ELEVATION_M) {
        fail('Invalid track point elevation.', 400);
      }
    }
    if (accuracyM !== undefined && accuracyM !== null) {
      if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0) {
        fail('Invalid track point accuracy.', 400);
      }
    }
    if (speedMps !== undefined && speedMps !== null) {
      if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < 0) {
        fail('Invalid track point speed.', 400);
      }
    }
    if (segmentBreak !== undefined && typeof segmentBreak !== 'boolean') {
      fail('Invalid track point segmentBreak.', 400);
    }

    return {
      lat,
      lon,
      timestampMs,
      ...(typeof ele === 'number' ? { ele } : {}),
      ...(typeof accuracyM === 'number' ? { accuracyM } : {}),
      ...(typeof speedMps === 'number' ? { speedMps } : {}),
      ...(segmentBreak === true ? { segmentBreak: true } : {}),
    };
  });
}

function validateAndVerifyRecordedRun({ input, actorUid, profileWeightKg, nowIso }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Invalid run payload.', 400);
  }
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  if (!VALID_ID_RE.test(runId)) {
    fail('Invalid runId.', 400);
  }
  if (!VALID_MODES.has(input.mode)) {
    fail('Invalid run mode.', 400);
  }
  if (!VALID_PRIVACY.has(input.privacy)) {
    fail('Invalid run privacy.', 400);
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) {
    fail('Run title must be between 1 and 120 characters.', 400);
  }
  if (typeof input.homePrivacyTrimEnabled !== 'boolean') {
    fail('homePrivacyTrimEnabled must be a boolean.', 400);
  }

  const startedAt = typeof input.startedAt === 'string' ? input.startedAt.trim() : '';
  const finishedAt = typeof input.finishedAt === 'string' ? input.finishedAt.trim() : '';
  const startedMs = ISO_TIMESTAMP_RE.test(startedAt) ? Date.parse(startedAt) : Number.NaN;
  const finishedMs = ISO_TIMESTAMP_RE.test(finishedAt) ? Date.parse(finishedAt) : Number.NaN;
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs <= startedMs) {
    fail('Valid startedAt and finishedAt timestamps are required.', 400);
  }
  const elapsedTimeMs = finishedMs - startedMs;
  if (elapsedTimeMs > MAX_ELAPSED_TIME_MS) {
    fail('Run elapsed duration exceeds 48 hours.', 400);
  }

  const movingTimeMs = input.movingTimeMs;
  if (
    typeof movingTimeMs !== 'number' ||
    !Number.isFinite(movingTimeMs) ||
    movingTimeMs < MIN_MOVING_TIME_MS ||
    movingTimeMs > MAX_MOVING_TIME_MS ||
    movingTimeMs > elapsedTimeMs + 5000
  ) {
    fail('Valid movingTimeMs is required.', 400);
  }

  const rawHeadM = input.trimmedHeadM ?? 0;
  const rawTailM = input.trimmedTailM ?? 0;
  if (
    typeof rawHeadM !== 'number' ||
    !Number.isFinite(rawHeadM) ||
    rawHeadM < 0 ||
    rawHeadM > MAX_TRIM_CREDIT_M ||
    typeof rawTailM !== 'number' ||
    !Number.isFinite(rawTailM) ||
    rawTailM < 0 ||
    rawTailM > MAX_TRIM_CREDIT_M
  ) {
    fail(`Trimmed distances must be between 0 and ${MAX_TRIM_CREDIT_M} meters.`, 400);
  }
  const trimmedHeadM = input.homePrivacyTrimEnabled ? round1(rawHeadM) : 0;
  const trimmedTailM = input.homePrivacyTrimEnabled ? round1(rawTailM) : 0;
  const trimCreditM = input.homePrivacyTrimEnabled ? trimmedHeadM + trimmedTailM : 0;

  let clientDistanceM = Number.NaN;
  if (input.clientDistanceM !== undefined && input.clientDistanceM !== null) {
    if (
      typeof input.clientDistanceM !== 'number' ||
      !Number.isFinite(input.clientDistanceM) ||
      input.clientDistanceM < 0
    ) {
      fail('Invalid clientDistanceM.', 400);
    }
    clientDistanceM = input.clientDistanceM;
  }

  const trackPoints = validateTrackPoints(input.trackPoints);
  if (
    trackPoints.length === 0 &&
    !(input.homePrivacyTrimEnabled && Number.isFinite(clientDistanceM) && clientDistanceM <= 500)
  ) {
    fail('Empty trackPoints are only allowed for trimmed runs <= 500 meters.', 400);
  }

  const courseRef = validateCourseRef(input.courseRef);

  let trackStoragePath;
  if (input.trackStoragePath !== undefined && input.trackStoragePath !== null && input.trackStoragePath !== '') {
    if (typeof input.trackStoragePath !== 'string') {
      fail('Invalid trackStoragePath.', 400);
    }
    const pathRe = new RegExp(`^run-tracks/${escapeRegExp(actorUid)}/[a-zA-Z0-9_-]{1,64}\\.json$`);
    if (!pathRe.test(input.trackStoragePath)) {
      fail('Invalid trackStoragePath.', 400);
    }
    trackStoragePath = input.trackStoragePath;
  }

  const trackMetrics = computeTrackMetrics(trackPoints, profileWeightKg);
  const authoritativeDistanceM =
    trackPoints.length >= 2
      ? round1(trackMetrics.trackDistanceM + trimCreditM)
      : round1(clientDistanceM);

  let calorieEstimate = trackMetrics.calorieEstimate;
  if (trackPoints.length === 0) {
    const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(profileWeightKg);
    const seg = computeSegmentCaloriesKcal({
      distanceM: authoritativeDistanceM,
      deltaElevationM: 0,
      durationSec: movingTimeMs / 1000,
      weightKg: weightKgUsed,
    });
    const netKcal = round1(seg.netKcal);
    const restingKcal = round1(seg.restingKcal);
    calorieEstimate = {
      totalKcal: round1(netKcal + restingKcal),
      netKcal,
      restingKcal,
      weightKgUsed,
      usedReferenceWeight,
      methodVersion: CALORIE_METHOD_VERSION,
    };
  }

  const movingSec = movingTimeMs / 1000;
  const avgSpeedMps =
    movingSec > 0 ? Number((authoritativeDistanceM / movingSec).toFixed(2)) + 0 : 0;
  const avgPaceSecPerKm =
    authoritativeDistanceM > 0 && movingSec > 0
      ? round1((movingSec / authoritativeDistanceM) * 1000)
      : null;

  const verificationFlags = [];
  if (
    authoritativeDistanceM >= 1000 &&
    movingSec > 0 &&
    authoritativeDistanceM / movingSec > 7.5
  ) {
    verificationFlags.push('implausible_avg_speed');
  }
  if (
    trackMetrics.segmentCount > 0 &&
    trackMetrics.burstSegmentCount / trackMetrics.segmentCount > 0.15
  ) {
    verificationFlags.push('implausible_burst_speed');
  }
  if (
    trackPoints.length >= 2 &&
    Number.isFinite(clientDistanceM) &&
    Math.abs(clientDistanceM - authoritativeDistanceM) > 250 &&
    Math.abs(clientDistanceM - authoritativeDistanceM) / Math.max(1, authoritativeDistanceM) > 0.2
  ) {
    verificationFlags.push('distance_mismatch');
  }
  if (authoritativeDistanceM > 300000) {
    verificationFlags.push('extreme_single_distance');
  }

  const verificationStatus = verificationFlags.length > 0 ? 'flagged' : 'verified';

  return {
    runId,
    uid: actorUid,
    mode: input.mode,
    privacy: input.privacy,
    title,
    startedAt,
    finishedAt,
    elapsedTimeMs,
    movingTimeMs,
    distanceM: authoritativeDistanceM,
    elevationGainM: trackMetrics.elevationGainM,
    elevationLossM: trackMetrics.elevationLossM,
    caloriesKcal: calorieEstimate.totalKcal,
    calorieEstimate,
    avgPaceSecPerKm,
    avgSpeedMps: avgSpeedMps === 0 ? 0 : avgSpeedMps,
    maxSpeedMps: trackMetrics.maxSpeedMps,
    splits: trackMetrics.splits,
    previewPolyline: trackMetrics.previewPolyline,
    islandGroups: trackMetrics.islandGroups,
    ...(courseRef ? { courseRef } : {}),
    homePrivacyTrimEnabled: input.homePrivacyTrimEnabled,
    trimmedHeadM,
    trimmedTailM,
    ...(trackStoragePath ? { trackStoragePath } : {}),
    pointCount: trackPoints.length,
    verificationStatus,
    verificationFlags,
    createdAt: nowIso,
  };
}

module.exports = {
  CALORIE_METHOD_VERSION,
  DEFAULT_REFERENCE_WEIGHT_KG,
  ELEVATION_HYSTERESIS_M,
  JOULES_PER_KCAL,
  MAX_ACTIVE_STATIONARY_GAP_SEC,
  MAX_SERVER_TRACK_POINTS,
  MAX_TRIM_CREDIT_M,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  RESTING_KCAL_PER_KG_HR,
  RUNNING_SPEED_THRESHOLD_MPS,
  buildPreviewPolyline,
  computeMinettiNetCostJPerKgM,
  computePerKmSplits,
  computeSegmentCaloriesKcal,
  computeTrackMetrics,
  detectPhilippineIslandGroups,
  geodesicDistanceM,
  resolveCalorieWeightKg,
  round1,
  validateAndVerifyRecordedRun,
};
