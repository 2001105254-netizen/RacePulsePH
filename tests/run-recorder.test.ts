import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALORIE_METHOD_VERSION,
  DEFAULT_REFERENCE_WEIGHT_KG,
  JOULES_PER_KCAL,
  MAX_ACTIVE_STATIONARY_GAP_SEC,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  RESTING_KCAL_PER_KG_HR,
  RUNNING_SPEED_THRESHOLD_MPS,
  computeMinettiNetCostJPerKgM,
  computeRunCalorieEstimate,
  computeSegmentCaloriesKcal,
  resolveCalorieWeightKg,
} from '../src/lib/runs/calorieEngine';
import {
  ELEVATION_HYSTERESIS_M,
  buildPreviewPolyline,
  buildRunGpxXml,
  computeActiveElapsedTimeMs,
  computePerKmSplits,
  createActiveRunSession,
  detectPhilippineIslandGroups,
  enrichRunTrackElevation,
  ingestRunFix,
  pauseActiveRun,
  resumeActiveRun,
  trimRunTrackEndpoints,
} from '../src/lib/runs/runRecorderEngine';
import {
  clearActiveRunSnapshot,
  listPendingRunUploads,
  loadActiveRunSnapshot,
  removePendingRunUpload,
  saveActiveRunSnapshot,
  savePendingRunUpload,
  type StorageLike,
} from '../src/lib/runs/runCrashRecovery';
import type { PendingRunUpload, RecordedTrackPoint } from '../src/lib/runs/types';
import {
  RunTracking,
  RunTrackingWeb,
  type NativeRunFix,
  type NativeRunTrackingStatus,
  type RunTrackingPluginInterface,
} from '../src/lib/runs/nativeRunTracking';
import {
  CommunityRunApiError,
  buildCompleteRunRequestPayload,
  capServerTrackPoints,
  createCommunityRequestId,
  getCommunityApiBaseUrl,
} from '../src/lib/runs/communityRunsClient';
import { parseGpxRoute } from '../src/lib/gpxRoute';

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

/** Builds a straight northbound track from BGC, Taguig (~11.11m per 0.0001 deg lat). */
function buildNorthboundTrack(options: {
  startLat?: number;
  lon?: number;
  stepMeters: number;
  count: number;
  stepSec?: number;
  startMs?: number;
  eleFn?: (idx: number) => number | undefined;
}): RecordedTrackPoint[] {
  const startLat = options.startLat ?? 14.55;
  const lon = options.lon ?? 121.05;
  const stepSec = options.stepSec ?? 10;
  const startMs = options.startMs ?? 1_764_000_000_000;
  const dLatPerMeter = 1 / 111_195;
  const pts: RecordedTrackPoint[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const ele = options.eleFn ? options.eleFn(i) : 15;
    pts.push({
      lat: startLat + i * options.stepMeters * dLatPerMeter,
      lon,
      ...(ele !== undefined ? { ele } : {}),
      accuracyM: 6,
      timestampMs: startMs + i * stepSec * 1000,
      speedMps: i === 0 ? 0 : options.stepMeters / stepSec,
    });
  }
  return pts;
}

test('calorieEngine: resolveCalorieWeightKg validates bounds and falls back to 65kg', () => {
  assert.equal(DEFAULT_REFERENCE_WEIGHT_KG, 65);
  assert.equal(MIN_WEIGHT_KG, 25);
  assert.equal(MAX_WEIGHT_KG, 250);
  assert.equal(CALORIE_METHOD_VERSION, 'minetti2002-herrmann2024-v1');
  assert.equal(RUNNING_SPEED_THRESHOLD_MPS, 1.8);
  assert.equal(RESTING_KCAL_PER_KG_HR, 1.05);
  assert.equal(JOULES_PER_KCAL, 4184);
  assert.equal(MAX_ACTIVE_STATIONARY_GAP_SEC, 180);

  assert.deepEqual(resolveCalorieWeightKg(undefined), { weightKgUsed: 65, usedReferenceWeight: true });
  assert.deepEqual(resolveCalorieWeightKg(null), { weightKgUsed: 65, usedReferenceWeight: true });
  assert.deepEqual(resolveCalorieWeightKg(Number.NaN), { weightKgUsed: 65, usedReferenceWeight: true });
  assert.deepEqual(resolveCalorieWeightKg(24.9), { weightKgUsed: 65, usedReferenceWeight: true });
  assert.deepEqual(resolveCalorieWeightKg(250.1), { weightKgUsed: 65, usedReferenceWeight: true });
  assert.deepEqual(resolveCalorieWeightKg(25), { weightKgUsed: 25, usedReferenceWeight: false });
  assert.deepEqual(resolveCalorieWeightKg(250), { weightKgUsed: 250, usedReferenceWeight: false });
  assert.deepEqual(resolveCalorieWeightKg(72), { weightKgUsed: 72, usedReferenceWeight: false });
});

test('calorieEngine: computeMinettiNetCostJPerKgM matches running/walking polynomials and grade clamps', () => {
  const flatRun = computeMinettiNetCostJPerKgM(0, 3.0);
  assert.ok(Math.abs(flatRun - 3.6) < 1e-9);

  const flatWalk = computeMinettiNetCostJPerKgM(0, 1.4);
  assert.ok(Math.abs(flatWalk - 2.5) < 1e-9);

  const uphillRun = computeMinettiNetCostJPerKgM(0.2, 2.5);
  assert.ok(uphillRun > flatRun * 2);

  // Clamping beyond +0.45 yields identical cost to +0.45
  assert.equal(computeMinettiNetCostJPerKgM(0.9, 3.0), computeMinettiNetCostJPerKgM(0.45, 3.0));
  // Steep downhill clamps to [-0.45, floor]
  assert.equal(computeMinettiNetCostJPerKgM(-0.9, 3.0), computeMinettiNetCostJPerKgM(-0.45, 3.0));
  assert.ok(computeMinettiNetCostJPerKgM(-0.45, 3.0) >= 1.2);
  assert.ok(computeMinettiNetCostJPerKgM(-0.45, 1.0) >= 1.0);
  // Non-finite grade defaults to 0
  assert.ok(Math.abs(computeMinettiNetCostJPerKgM(Number.NaN, 3.0) - 3.6) < 1e-9);
});

test('calorieEngine: computeSegmentCaloriesKcal and computeRunCalorieEstimate compute exact net + resting totals', () => {
  const flat10k = computeSegmentCaloriesKcal({
    distanceM: 10_000,
    deltaElevationM: 0,
    durationSec: 3000,
    weightKg: 65,
  });
  const expectedNet = (3.6 * 65 * 10_000) / 4184;
  const expectedResting = 1.05 * 65 * (3000 / 3600);
  assert.ok(Math.abs(flat10k.netKcal - expectedNet) < 1e-6);
  assert.ok(Math.abs(flat10k.restingKcal - expectedResting) < 1e-6);
  assert.ok(Math.abs(flat10k.totalKcal - (expectedNet + expectedResting)) < 1e-6);

  const uphill = computeSegmentCaloriesKcal({
    distanceM: 1000,
    deltaElevationM: 120,
    durationSec: 400,
    weightKg: 65,
  });
  const flat1k = computeSegmentCaloriesKcal({
    distanceM: 1000,
    deltaElevationM: 0,
    durationSec: 400,
    weightKg: 65,
  });
  assert.ok(uphill.netKcal > flat1k.netKcal);

  // Stationary gap > 180s with < 10m produces zero ghost calories
  assert.deepEqual(
    computeSegmentCaloriesKcal({ distanceM: 4, deltaElevationM: 0, durationSec: 240, weightKg: 70 }),
    { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed: 70 },
  );
  // Zero/invalid duration produces 0s
  assert.deepEqual(
    computeSegmentCaloriesKcal({ distanceM: 500, deltaElevationM: 0, durationSec: 0, weightKg: 70 }),
    { netKcal: 0, restingKcal: 0, totalKcal: 0, weightKgUsed: 70 },
  );

  // Aggregate track estimate with fallback weight
  const pts = buildNorthboundTrack({ stepMeters: 100, count: 11, stepSec: 30 }); // 1000m in 300s (3.33 m/s)
  const estimate = computeRunCalorieEstimate(pts);
  assert.equal(estimate.weightKgUsed, 65);
  assert.equal(estimate.usedReferenceWeight, true);
  assert.equal(estimate.methodVersion, 'minetti2002-herrmann2024-v1');
  assert.equal(estimate.totalKcal, Math.round((estimate.netKcal + estimate.restingKcal) * 10) / 10);
  assert.ok(estimate.totalKcal > 55 && estimate.totalKcal < 70);
});

test('runRecorderEngine: ingestRunFix filters spikes/jitter, enforces pause, and applies 2.5m elevation hysteresis', () => {
  assert.equal(ELEVATION_HYSTERESIS_M, 2.5);
  const startMs = 1_764_000_000_000;
  let session = createActiveRunSession({
    sessionId: 'sess_1',
    uid: 'runner_1',
    mode: 'free',
    startedAtMs: startMs,
  });

  // Reject coarse initial fix (> 100m)
  session = ingestRunFix(session, {
    lat: 14.55,
    lon: 121.05,
    accuracyM: 150,
    timestampMs: startMs + 1000,
  });
  assert.equal(session.points.length, 0);

  // Accept initial accurate fix
  session = ingestRunFix(session, {
    lat: 14.55,
    lon: 121.05,
    accuracyM: 5,
    altitudeM: 20,
    speedMps: 3.0,
    timestampMs: startMs + 2000,
  });
  assert.equal(session.points.length, 1);
  assert.equal(session.lastElevationAnchorM, 20);

  // Stationary jitter (< 1m) clamps in gpsFilter without appending duplicate point
  session = ingestRunFix(session, {
    lat: 14.550002,
    lon: 121.050002,
    accuracyM: 5,
    altitudeM: 21.2, // < 2.5m hysteresis
    timestampMs: startMs + 3000,
  });
  assert.equal(session.points.length, 1);

  // Single multipath spike (> 15 m/s jump) rejected
  session = ingestRunFix(session, {
    lat: 14.56,
    lon: 121.05,
    accuracyM: 6,
    timestampMs: startMs + 4000,
  });
  assert.equal(session.points.length, 1);

  // Realistic running move (~15m north in 5s = 3 m/s) with small altitude wobble (+1.5m < 2.5m)
  const dLatPerMeter = 1 / 111_195;
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 15 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 21.5,
      speedMps: 3.0,
      timestampMs: startMs + 7000,
    },
    { weightKg: 70 },
  );
  assert.equal(session.points.length, 2);
  assert.ok(session.distanceM > 2.5);
  assert.equal(session.movingTimeMs, 5000);
  assert.equal(session.elevationGainM, 0); // 1.5m < 2.5m threshold
  assert.equal(session.lastElevationAnchorM, 20);
  assert.ok(session.totalKcal > 0);

  // Climb >= 2.5m triggers gain and updates anchor
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 35 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 24.5, // +4.5m from anchor 20
      speedMps: 3.2,
      timestampMs: startMs + 13000,
    },
    { weightKg: 70 },
  );
  assert.equal(session.points.length, 3);
  assert.equal(session.elevationGainM, 4.5);
  assert.equal(session.lastElevationAnchorM, 24.5);

  // Descend >= 2.5m triggers loss
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 55 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 21.0, // -3.5m from anchor 24.5
      speedMps: 3.2,
      timestampMs: startMs + 19000,
    },
    { weightKg: 70 },
  );
  assert.equal(session.elevationLossM, 3.5);
  assert.equal(session.lastElevationAnchorM, 21.0);

  // Pause blocks buffered/late fixes and pauses elapsed clock
  const pointsBeforePause = session.points.length;
  session = pauseActiveRun(session, startMs + 20_000);
  assert.equal(computeActiveElapsedTimeMs(session, startMs + 80_000), 20_000);
  session = ingestRunFix(session, {
    lat: 14.55 + 90 * dLatPerMeter,
    lon: 121.05,
    accuracyM: 5,
    timestampMs: startMs + 25_000,
  });
  assert.equal(session.points.length, pointsBeforePause);

  // Resume excludes paused interval from elapsed time
  session = resumeActiveRun(session, startMs + 50_000);
  assert.equal(session.accumulatedPausedMs, 30_000);
  assert.equal(computeActiveElapsedTimeMs(session, startMs + 65_000), 35_000);
});

test('runRecorderEngine: computePerKmSplits splits 2.35km run with trailing partial split', () => {
  const pts = buildNorthboundTrack({
    stepMeters: 50,
    count: 48, // 47 * 50 = 2350m
    stepSec: 15, // 3.33 m/s -> 300s/km
    eleFn: (i) => 10 + i * 0.5, // steady climb
  });
  const splits = computePerKmSplits(pts, 65);
  assert.equal(splits.length, 3);
  assert.equal(splits[0].kmIndex, 1);
  assert.ok(Math.abs(splits[0].distanceM - 1000) < 1);
  assert.ok(Math.abs(splits[0].paceSecPerKm - 300) <= 2);
  assert.ok(splits[0].elevationGainM > 0);
  assert.ok(splits[0].avgGradePct > 0);
  assert.ok(splits[0].caloriesKcal > 50);

  assert.equal(splits[1].kmIndex, 2);
  assert.ok(Math.abs(splits[1].distanceM - 1000) < 1);

  assert.equal(splits[2].kmIndex, 3);
  assert.ok(splits[2].distanceM >= 345 && splits[2].distanceM <= 355);

  // Tiny run < 50m produces no splits
  const tiny = buildNorthboundTrack({ stepMeters: 10, count: 4, stepSec: 3 });
  assert.deepEqual(computePerKmSplits(tiny), []);
});

test('runRecorderEngine: trimRunTrackEndpoints protects short runs and trims >= 200m head/tail', () => {
  const shortRun = buildNorthboundTrack({ stepMeters: 20, count: 21 }); // 400m <= 450m
  const shortTrim = trimRunTrackEndpoints(shortRun, 200);
  assert.deepEqual(shortTrim.trimmedPoints, []);
  assert.ok(shortTrim.trimmedHeadM >= 398 && shortTrim.trimmedHeadM <= 402);
  assert.equal(shortTrim.trimmedTailM, 0);

  const kmRun = buildNorthboundTrack({ stepMeters: 50, count: 21 }); // 1000m
  const kmTrim = trimRunTrackEndpoints(kmRun, 200);
  assert.ok(kmTrim.trimmedPoints.length > 0 && kmTrim.trimmedPoints.length < kmRun.length);
  assert.ok(kmTrim.trimmedHeadM >= 200);
  assert.ok(kmTrim.trimmedTailM >= 200);
  assert.notEqual(kmTrim.trimmedPoints[0].lat, kmRun[0].lat);
  assert.notEqual(
    kmTrim.trimmedPoints[kmTrim.trimmedPoints.length - 1].lat,
    kmRun[kmRun.length - 1].lat,
  );
});

test('runRecorderEngine: buildPreviewPolyline formats [lon, lat] and decimates <= 240 points', () => {
  const pts = buildNorthboundTrack({ stepMeters: 10, count: 500 });
  const poly = buildPreviewPolyline(pts, 240);
  assert.equal(poly.length, 240);
  assert.deepEqual(poly[0], [Number(pts[0].lon.toFixed(5)), Number(pts[0].lat.toFixed(5))]);
  assert.deepEqual(
    poly[poly.length - 1],
    [Number(pts[499].lon.toFixed(5)), Number(pts[499].lat.toFixed(5))],
  );
});

test('runRecorderEngine: enrichRunTrackElevation handles DEM, mixed, GPS, and PH fallback', async () => {
  const pts = buildNorthboundTrack({
    startLat: 16.412,
    lon: 120.625,
    stepMeters: 50,
    count: 4,
    eleFn: (i) => 1500 + i * 5,
  });

  const demFull = await enrichRunTrackElevation(pts, async () => [1600, 1605, 1610, 1615]);
  assert.equal(demFull.elevationSource, 'dem');
  assert.equal(demFull.elevationGainM, 15);
  assert.equal(demFull.elevationLossM, 0);

  const mixed = await enrichRunTrackElevation(pts, async () => [1600, null, 1610, null]);
  assert.equal(mixed.elevationSource, 'mixed');
  assert.equal(mixed.points[1].ele, 1505);

  const gpsOnly = await enrichRunTrackElevation(pts, async () => [null, null, null, null]);
  assert.equal(gpsOnly.elevationSource, 'gps');
  assert.equal(gpsOnly.elevationGainM, 15);

  // Missing ele inside PH falls back to synthetic Philippine DEM
  const noElePh = buildNorthboundTrack({
    startLat: 16.412,
    lon: 120.625,
    stepMeters: 50,
    count: 3,
    eleFn: () => undefined,
  });
  const phFallback = await enrichRunTrackElevation(noElePh, async () => [null, null, null]);
  assert.equal(phFallback.elevationSource, 'dem');
  assert.ok(phFallback.points.every((p) => typeof p.ele === 'number' && Number.isFinite(p.ele) && p.ele > 100));
});

test('runRecorderEngine: detectPhilippineIslandGroups cleanly partitions Luzon, Visayas, and Mindanao', () => {
  assert.deepEqual(
    detectPhilippineIslandGroups([
      { lat: 14.55, lon: 121.05 }, // Metro Manila
      { lat: 16.41, lon: 120.60 }, // Baguio / Cordillera
      { lat: 13.14, lon: 123.74 }, // Albay / Bicol
      { lat: 13.26, lon: 121.00 }, // Mindoro
      { lat: 9.74, lon: 118.74 },  // Puerto Princesa / Palawan
      { lat: 12.37, lon: 123.62 }, // Masbate
    ]),
    ['Luzon'],
  );

  assert.deepEqual(
    detectPhilippineIslandGroups([
      { lat: 11.96, lon: 121.92 }, // Boracay / Panay
      { lat: 10.67, lon: 122.95 }, // Bacolod / Negros
      { lat: 9.31, lon: 123.31 },  // Dumaguete / Negros
      { lat: 10.32, lon: 123.90 }, // Cebu
      { lat: 9.65, lon: 123.85 },  // Bohol
      { lat: 11.24, lon: 125.00 }, // Leyte
      { lat: 12.50, lon: 124.28 }, // Allen / Northern Samar
    ]),
    ['Visayas'],
  );

  assert.deepEqual(
    detectPhilippineIslandGroups([
      { lat: 8.20, lon: 124.99 },  // Bukidnon
      { lat: 7.07, lon: 125.61 },  // Davao
      { lat: 9.18, lon: 124.72 },  // Camiguin
      { lat: 9.85, lon: 126.05 },  // Siargao
      { lat: 6.05, lon: 121.00 },  // Jolo / Sulu
      { lat: 5.03, lon: 119.77 },  // Tawi-Tawi
    ]),
    ['Mindanao'],
  );

  assert.deepEqual(detectPhilippineIslandGroups([{ lat: 35.68, lon: 139.76 }]), []);
});

test('runRecorderEngine: buildRunGpxXml escapes XML entities and parses cleanly', () => {
  const pts = buildNorthboundTrack({ stepMeters: 50, count: 4, eleFn: (i) => 12 + i * 2 });
  const xml = buildRunGpxXml({
    title: 'UP Oval & "BGC" <5K> \'Morning\'',
    startedAt: '2026-11-24T06:00:00.000Z',
    points: pts,
    privacyTrimApplied: true,
  });

  assert.ok(xml.includes('creator="RacePulsePH"'));
  assert.ok(xml.includes('UP Oval &amp; &quot;BGC&quot; &lt;5K&gt; &apos;Morning&apos;'));
  assert.ok(!xml.includes('<5K>'));

  const parsed = parseGpxRoute(xml);
  assert.equal(parsed.points.length, 4);
  assert.equal(parsed.validationReport.trackNames[0], 'UP Oval & "BGC" <5K> \'Morning\'');
});

test('runCrashRecovery: saves, loads, and clears active sessions & pending uploads via StorageLike fallback', async () => {
  const storage = createMemoryStorage();
  const session = ingestRunFix(
    createActiveRunSession({ sessionId: 's_rec', uid: 'u1', mode: 'free', startedAtMs: 1_764_000_000_000 }),
    { lat: 14.55, lon: 121.05, accuracyM: 5, altitudeM: 12, timestampMs: 1_764_000_001_000 },
  );

  await saveActiveRunSnapshot(session, storage);
  const loaded = await loadActiveRunSnapshot('u1', storage);
  assert.ok(loaded);
  assert.equal(loaded.sessionId, 's_rec');
  assert.equal(loaded.points.length, 1);

  assert.equal(await loadActiveRunSnapshot('other_user', storage), null);
  await clearActiveRunSnapshot('u1', storage);
  assert.equal(await loadActiveRunSnapshot('u1', storage), null);

  // Corrupted snapshot returns null safely (with console.warn)
  storage.setItem('racepulse_active_run_v1::u1', '{bad json');
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    assert.equal(await loadActiveRunSnapshot('u1', storage), null);
    assert.equal(warned, true);
  } finally {
    console.warn = origWarn;
  }

  const pendingA: PendingRunUpload = {
    requestId: 'req_1',
    runId: 'run_1',
    uid: 'u1',
    payload: { title: 'Morning Run' },
    trimmedTrackPoints: session.points,
    createdAt: '2026-11-24T06:30:00.000Z',
    attempts: 1,
  };
  const pendingB: PendingRunUpload = {
    requestId: 'req_2',
    runId: 'run_2',
    uid: 'u1',
    payload: { title: 'Evening Run' },
    trimmedTrackPoints: session.points,
    createdAt: '2026-11-24T18:30:00.000Z',
    attempts: 2,
    lastError: 'Network timeout',
  };
  const otherUserPending: PendingRunUpload = {
    ...pendingA,
    requestId: 'req_9',
    uid: 'u2',
  };

  await savePendingRunUpload(pendingB, storage);
  await savePendingRunUpload(pendingA, storage);
  await savePendingRunUpload(otherUserPending, storage);

  const listU1 = await listPendingRunUploads('u1', storage);
  assert.equal(listU1.length, 2);
  assert.equal(listU1[0].requestId, 'req_1');
  assert.equal(listU1[1].requestId, 'req_2');

  await removePendingRunUpload('u1', 'req_1', storage);
  const afterRemove = await listPendingRunUploads('u1', storage);
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].requestId, 'req_2');
  assert.equal((await listPendingRunUploads('u2', storage)).length, 1);
});

test('runRecorderEngine: slow uphill steps (>= 10s, >= 1m) append points while skipping > 180s moving time gaps', () => {
  const startMs = 1_764_000_000_000;
  const dLatPerMeter = 1 / 111_195;
  let session = createActiveRunSession({
    sessionId: 'sess_slow',
    uid: 'runner_slow',
    mode: 'free',
    startedAtMs: startMs,
  });

  session = ingestRunFix(session, {
    lat: 16.41,
    lon: 120.6,
    accuracyM: 4,
    altitudeM: 1500,
    timestampMs: startMs + 1000,
  });
  assert.equal(session.points.length, 1);

  // Slow uphill step: ~2.1m displacement over 12s (appends via dtMs >= 10_000 && distM >= 1.0)
  session = ingestRunFix(session, {
    lat: 16.41 + 2.1 * dLatPerMeter,
    lon: 120.6,
    accuracyM: 4,
    altitudeM: 1503,
    speedMps: 0.2,
    timestampMs: startMs + 13_000,
  });
  assert.equal(session.points.length, 2);
  assert.equal(session.movingTimeMs, 0); // speed < 0.45 and dist < 2.5m
  assert.equal(session.elevationGainM, 3);

  // Huge 240s gap while moving > 10m should NOT count as active movingTimeMs
  session = ingestRunFix(session, {
    lat: 16.41 + 25 * dLatPerMeter,
    lon: 120.6,
    accuracyM: 4,
    altitudeM: 1506,
    speedMps: 0.1,
    timestampMs: startMs + 253_000,
  });
  assert.equal(session.points.length, 3);
  assert.equal(session.movingTimeMs, 0);
});

test('runCrashRecovery: uses IndexedDB activeRuns and pendingUploads stores when global indexedDB exists', async () => {
  const stores = new Map<string, { keyPath: string; rows: Map<string, Record<string, unknown>> }>();

  const makeRequest = <T>(exec: () => T) => {
    const req: Record<string, unknown> = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      try {
        req.result = exec();
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (typeof req.onerror === 'function') req.onerror({ target: req });
      }
    });
    return req;
  };

  const mockDb = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string, opts: { keyPath: string }) => {
      stores.set(name, { keyPath: opts.keyPath, rows: new Map() });
    },
    transaction: (storeName: string) => {
      const tx: Record<string, unknown> = {
        oncomplete: null,
        onerror: null,
        objectStore: () => {
          const store = stores.get(storeName)!;
          return {
            put: (val: Record<string, unknown>) => {
              const key = String(val[store.keyPath]);
              store.rows.set(key, structuredClone(val));
              queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') tx.oncomplete({});
              });
            },
            get: (key: string) => makeRequest(() => structuredClone(store.rows.get(key) ?? null)),
            getAll: () => makeRequest(() => Array.from(store.rows.values()).map((r) => structuredClone(r))),
            delete: (key: string) => {
              store.rows.delete(key);
              queueMicrotask(() => {
                if (typeof tx.oncomplete === 'function') tx.oncomplete({});
              });
            },
          };
        },
      };
      return tx;
    },
    close: () => undefined,
  };

  const mockIndexedDb = {
    open: (dbName: string) => {
      assert.equal(dbName, 'racepulse_run_recovery_v1');
      const req: Record<string, unknown> = {
        result: mockDb,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded({ target: req });
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    },
  };

  const g = globalThis as unknown as { indexedDB?: unknown };
  const hadIndexedDb = 'indexedDB' in g;
  const origIndexedDb = g.indexedDB;
  g.indexedDB = mockIndexedDb;

  try {
    const session = ingestRunFix(
      createActiveRunSession({ sessionId: 's_idb', uid: 'u_idb', mode: 'course', startedAtMs: 1_764_000_000_000 }),
      { lat: 10.32, lon: 123.9, accuracyM: 5, altitudeM: 35, timestampMs: 1_764_000_001_000 },
    );
    await saveActiveRunSnapshot(session);
    const loaded = await loadActiveRunSnapshot('u_idb');
    assert.ok(loaded);
    assert.equal(loaded.sessionId, 's_idb');
    assert.equal(stores.has('activeRuns'), true);
    assert.equal(stores.has('pendingUploads'), true);

    await savePendingRunUpload({
      requestId: 'req_idb_1',
      runId: 'run_idb_1',
      uid: 'u_idb',
      payload: { distanceM: 5000 },
      trimmedTrackPoints: session.points,
      createdAt: '2026-11-24T07:00:00.000Z',
      attempts: 1,
    });
    const pending = await listPendingRunUploads('u_idb');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].runId, 'run_idb_1');
    assert.equal('id' in (pending[0] as unknown as Record<string, unknown>), false);

    await removePendingRunUpload('u_idb', 'req_idb_1');
    assert.equal((await listPendingRunUploads('u_idb')).length, 0);

    await clearActiveRunSnapshot('u_idb');
    assert.equal(await loadActiveRunSnapshot('u_idb'), null);
  } finally {
    if (hadIndexedDb) {
      g.indexedDB = origIndexedDb;
    } else {
      delete g.indexedDB;
    }
  }
});

test('pause/resume prevents interval leakage across live session, splits, calories, and DEM enrichment', async () => {
  const startMs = 1_764_000_000_000;
  const dLatPerMeter = 1 / 111_195;
  let session = createActiveRunSession({
    sessionId: 'sess_pause_gap',
    uid: 'runner_gap',
    mode: 'free',
    startedAtMs: startMs,
  });

  // Segment 1: run 100m in 30s (t=1s..31s), flat 10m altitude
  session = ingestRunFix(
    session,
    { lat: 14.55, lon: 121.05, accuracyM: 5, altitudeM: 10, speedMps: 3.3, timestampMs: startMs + 1000 },
    { weightKg: 65 },
  );
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 100 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 10,
      speedMps: 3.33,
      timestampMs: startMs + 31_000,
    },
    { weightKg: 65 },
  );

  const prePauseDist = session.distanceM;
  const prePauseMoving = session.movingTimeMs;
  const prePauseTotalKcal = session.totalKcal;
  assert.ok(prePauseDist > 90 && prePauseDist < 110);
  assert.equal(prePauseMoving, 30_000);

  // Pause for 10 minutes while moving 1500m and climbing +80m in a vehicle
  session = pauseActiveRun(session, startMs + 31_000);
  session = resumeActiveRun(session, startMs + 631_000);
  assert.equal(session.pendingSegmentBreak, true);

  // First post-resume fix is 1500m north and +80m higher: must accept without spike rejection and bridge ZERO gap metrics
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 1600 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 90,
      speedMps: 3.2,
      timestampMs: startMs + 632_000,
    },
    { weightKg: 65 },
  );
  assert.equal(session.points.length, 3);
  assert.equal(session.points[2].segmentBreak, true);
  assert.equal(session.pendingSegmentBreak, false);
  assert.equal(session.lastElevationAnchorM, 90);
  assert.equal(session.distanceM, prePauseDist);
  assert.equal(session.movingTimeMs, prePauseMoving);
  assert.equal(session.elevationGainM, 0);
  assert.equal(session.totalKcal, prePauseTotalKcal);

  // Segment 2: run 100m further in 30s (t=632s..662s) climbing +5m
  session = ingestRunFix(
    session,
    {
      lat: 14.55 + 1700 * dLatPerMeter,
      lon: 121.05,
      accuracyM: 5,
      altitudeM: 95,
      speedMps: 3.33,
      timestampMs: startMs + 662_000,
    },
    { weightKg: 65 },
  );
  const elapsedAtEnd = computeActiveElapsedTimeMs(session, startMs + 662_000);
  assert.equal(elapsedAtEnd, 62_000);
  assert.equal(session.movingTimeMs, 60_000);
  assert.ok(session.movingTimeMs <= elapsedAtEnd);
  assert.ok(session.distanceM < 220);
  assert.equal(session.elevationGainM, 5);

  // Post-run calories & splits must skip the segmentBreak gap and match live totals
  const postCalories = computeRunCalorieEstimate(session.points, 65);
  assert.equal(postCalories.totalKcal, Math.round((Math.round(session.netKcal * 10) / 10 + Math.round(session.restingKcal * 10) / 10) * 10) / 10);
  assert.ok(postCalories.totalKcal < 30);

  const postSplits = computePerKmSplits(session.points, 65);
  assert.equal(postSplits.length, 1);
  assert.ok(postSplits[0].distanceM < 220);
  assert.equal(postSplits[0].elapsedSec, 60);
  assert.equal(postSplits[0].movingSec, 60);
  assert.equal(postSplits[0].elevationGainM, 5);

  // DEM enrichment must also avoid counting elevation across segmentBreak
  const enriched = await enrichRunTrackElevation(session.points, async () => [10, 10, 90, 95]);
  assert.equal(enriched.elevationGainM, 5);

  // Privacy trim must not count paused car/commute jump toward run length (prevents short-run leak)
  const trim = trimRunTrackEndpoints(session.points, 200);
  assert.deepEqual(trim.trimmedPoints, []);
});

test('runCrashRecovery: IndexedDB onblocked and tx.onabort reject cleanly and fall back to localStorage with warn', async () => {
  const withTimeout = async <T>(promise: Promise<T>, label: string, ms = 150): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const g = globalThis as unknown as { indexedDB?: unknown; localStorage?: StorageLike };
  const hadIdb = 'indexedDB' in g;
  const origIdb = g.indexedDB;
  const hadLs = 'localStorage' in g;
  const origLs = g.localStorage;
  const origWarn = console.warn;

  const fallbackLs = createMemoryStorage();
  const warnLogs: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnLogs.push(args);
  };
  g.localStorage = fallbackLs;

  try {
    // Case 1: open blocked
    g.indexedDB = {
      open: () => {
        const req: Record<string, unknown> = {
          onblocked: null,
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          if (typeof req.onblocked === 'function') req.onblocked({});
        });
        return req;
      },
    };

    const session = ingestRunFix(
      createActiveRunSession({ sessionId: 's_abort', uid: 'u_abort', mode: 'free', startedAtMs: 1_764_000_000_000 }),
      { lat: 14.55, lon: 121.05, accuracyM: 5, altitudeM: 12, timestampMs: 1_764_000_001_000 },
    );
    await withTimeout(saveActiveRunSnapshot(session), 'onblocked saveActiveRunSnapshot');
    assert.ok(warnLogs.length >= 1);
    assert.ok(fallbackLs.getItem('racepulse_active_run_v1::u_abort'));

    // Case 2: transaction aborted across all 6 operations
    warnLogs.length = 0;
    const mockDbAbort = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx: Record<string, unknown> = {
          onabort: null,
          onerror: null,
          oncomplete: null,
          error: new Error('Transaction aborted'),
          objectStore: () => ({
            get: () => {
              const r: Record<string, unknown> = { onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') tx.onabort({});
              });
              return r;
            },
            put: () => {
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') tx.onabort({});
              });
            },
            getAll: () => {
              const r: Record<string, unknown> = { onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') tx.onabort({});
              });
              return r;
            },
            delete: () => {
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') tx.onabort({});
              });
            },
          }),
        };
        return tx;
      },
      close: () => undefined,
    };
    g.indexedDB = {
      open: () => {
        const req: Record<string, unknown> = {
          result: mockDbAbort,
          onsuccess: null,
          onerror: null,
          onblocked: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          if (typeof req.onsuccess === 'function') req.onsuccess({});
        });
        return req;
      },
    };

    const recovered = await withTimeout(loadActiveRunSnapshot('u_abort'), 'onabort loadActiveRunSnapshot');
    assert.ok(recovered);
    assert.equal(recovered.sessionId, 's_abort');
    assert.ok(warnLogs.length >= 1);

    await withTimeout(
      savePendingRunUpload({
        requestId: 'req_abort',
        runId: 'run_abort',
        uid: 'u_abort',
        payload: {},
        trimmedTrackPoints: session.points,
        createdAt: '2026-11-24T08:00:00.000Z',
        attempts: 1,
      }),
      'onabort savePendingRunUpload',
    );
    const list = await withTimeout(listPendingRunUploads('u_abort'), 'onabort listPendingRunUploads');
    assert.equal(list.length, 1);
    assert.equal(list[0].requestId, 'req_abort');

    await withTimeout(removePendingRunUpload('u_abort', 'req_abort'), 'onabort removePendingRunUpload');
    assert.equal((await withTimeout(listPendingRunUploads('u_abort'), 'post-remove listPendingRunUploads')).length, 0);

    await withTimeout(clearActiveRunSnapshot('u_abort'), 'onabort clearActiveRunSnapshot');
    assert.equal(await withTimeout(loadActiveRunSnapshot('u_abort'), 'post-clear loadActiveRunSnapshot'), null);
  } finally {
    console.warn = origWarn;
    if (hadIdb) g.indexedDB = origIdb;
    else delete g.indexedDB;
    if (hadLs) g.localStorage = origLs;
    else delete g.localStorage;
  }
});

test('runRecorderEngine & runCrashRecovery: handle invalid timestamps, malformed pending records, and -0 normalization', async () => {
  // Out-of-range Date and NaN timestamps must not throw in GPX export or split math
  const weirdPts: RecordedTrackPoint[] = [
    { lat: 14.55, lon: 121.05, ele: 10, accuracyM: 5, timestampMs: 1e20, speedMps: 3 },
    { lat: 14.555, lon: 121.05, ele: 10, accuracyM: 5, timestampMs: Number.NaN, speedMps: 3 },
  ];
  const xml = buildRunGpxXml({ title: 'Edge Run', startedAt: '2026-11-24T06:00:00.000Z', points: weirdPts });
  assert.ok(xml.includes('<trkpt lat="14.550000" lon="121.050000">'));
  assert.equal(computePerKmSplits(weirdPts).length, 0);

  // Zero-negative rounding must normalize to +0 (not -0)
  const zeroEst = computeRunCalorieEstimate([]);
  assert.equal(Object.is(zeroEst.netKcal, -0), false);
  const flatPts = buildNorthboundTrack({ stepMeters: 500, count: 3, stepSec: 150, eleFn: () => 10 });
  const splits = computePerKmSplits(flatPts);
  assert.equal(Object.is(splits[0].avgGradePct, -0), false);

  // Malformed pending items in localStorage are filtered out
  const storage = createMemoryStorage();
  storage.setItem(
    'racepulse_pending_uploads_v1::u_filter',
    JSON.stringify([
      null,
      { uid: 'u_filter', requestId: 123, createdAt: '2026-01-01' },
      { uid: 'u_filter', requestId: 'ok_1', runId: 'r_1', payload: {}, trimmedTrackPoints: [], createdAt: '2026-11-24T08:00:00.000Z', attempts: 1 },
    ]),
  );
  const validOnly = await listPendingRunUploads('u_filter', storage);
  assert.equal(validOnly.length, 1);
  assert.equal(validOnly[0].requestId, 'ok_1');
});

test('RunTrackingWeb: exposes status, acquires/re-acquires screen wake lock, emits locationFix, and cleans up on stopTracking', async () => {
  const g = globalThis as Record<string, unknown>;
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  type WatchSuccess = (pos: {
    timestamp: number;
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number | null;
      speed: number | null;
      heading: number | null;
    };
  }) => void;

  let watchCallback = null as WatchSuccess | null;
  let watchOptionsSeen = null as { enableHighAccuracy?: boolean; maximumAge?: number } | null;
  const clearedWatchIds: number[] = [];
  let nextWatchId = 77;

  let wakeLockRequests = 0;
  const sentinels: Array<{ released: boolean; listeners: Map<string, Set<() => void>> }> = [];

  const docListeners = new Map<string, Set<() => void>>();
  const mockDoc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (event: string, fn: () => void) => {
      let set = docListeners.get(event);
      if (!set) {
        set = new Set();
        docListeners.set(event, set);
      }
      set.add(fn);
    },
    removeEventListener: (event: string, fn: () => void) => {
      docListeners.get(event)?.delete(fn);
    },
  };

  const mockNav = {
    geolocation: {
      getCurrentPosition: () => undefined,
      watchPosition: (
        onSuccess: WatchSuccess,
        _onError: (err: { code: number; message: string }) => void,
        opts: { enableHighAccuracy?: boolean; maximumAge?: number },
      ) => {
        watchCallback = onSuccess;
        watchOptionsSeen = opts;
        nextWatchId += 1;
        return nextWatchId;
      },
      clearWatch: (id: number) => {
        clearedWatchIds.push(id);
      },
    },
    wakeLock: {
      request: async (type: string) => {
        assert.equal(type, 'screen');
        wakeLockRequests += 1;
        const sentinelRecord = { released: false, listeners: new Map<string, Set<() => void>>() };
        sentinels.push(sentinelRecord);
        return {
          get released() {
            return sentinelRecord.released;
          },
          addEventListener: (event: string, fn: () => void) => {
            let set = sentinelRecord.listeners.get(event);
            if (!set) {
              set = new Set();
              sentinelRecord.listeners.set(event, set);
            }
            set.add(fn);
          },
          removeEventListener: (event: string, fn: () => void) => {
            sentinelRecord.listeners.get(event)?.delete(fn);
          },
          release: async () => {
            sentinelRecord.released = true;
            sentinelRecord.listeners.get('release')?.forEach((fn) => fn());
          },
        };
      },
    },
  };

  Object.defineProperty(globalThis, 'navigator', { value: mockNav, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: mockDoc, configurable: true, writable: true });

  try {
    // Registered plugin proxy matches RunTrackingPluginInterface contract
    const registered: RunTrackingPluginInterface = RunTracking;
    assert.equal(typeof registered.startTracking, 'function');
    assert.equal(typeof registered.stopTracking, 'function');
    assert.equal(typeof registered.updateNotification, 'function');
    assert.equal(typeof registered.getBufferedFixes, 'function');
    assert.equal(typeof registered.getStatus, 'function');

    const plugin = new RunTrackingWeb();
    const initialStatus: NativeRunTrackingStatus = await plugin.getStatus();
    assert.deepEqual(initialStatus, {
      active: false,
      bufferedCount: 0,
      mode: 'web-wake-lock',
    });

    const received: NativeRunFix[] = [];
    const listener = await plugin.addListener('locationFix', (fix) => {
      received.push(fix);
    });

    const startRes = await plugin.startTracking({ title: 'BGC Tempo', subtitle: '0.00 km' });
    assert.deepEqual(startRes, { active: true, mode: 'web-wake-lock' });
    assert.deepEqual(await plugin.getStatus(), {
      active: true,
      bufferedCount: 0,
      mode: 'web-wake-lock',
    });
    assert.equal(wakeLockRequests, 1);
    assert.equal(watchOptionsSeen?.enableHighAccuracy, true);
    assert.equal(watchOptionsSeen?.maximumAge, 0);

    // Trigger fix with null altitude and verify exact NativeRunFix payload
    assert.ok(watchCallback);
    (watchCallback as WatchSuccess)({
      timestamp: 1_764_000_010_000,
      coords: {
        latitude: 14.5501,
        longitude: 121.0502,
        accuracy: 4.5,
        altitude: null,
        speed: 3.2,
        heading: 90,
      },
    });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      latitude: 14.5501,
      longitude: 121.0502,
      accuracyM: 4.5,
      altitudeM: null,
      speedMps: 3.2,
      headingDeg: 90,
      timestamp: 1_764_000_010_000,
      provider: 'web-geolocation',
    });

    // OS releases wake lock while tab goes hidden -> must NOT re-acquire while hidden
    sentinels[0].released = true;
    sentinels[0].listeners.get('release')?.forEach((fn) => fn());
    mockDoc.visibilityState = 'hidden';
    docListeners.get('visibilitychange')?.forEach((fn) => fn());
    await Promise.resolve();
    assert.equal(wakeLockRequests, 1);

    // Tab returns visible -> must re-acquire screen wake lock cleanly
    mockDoc.visibilityState = 'visible';
    docListeners.get('visibilitychange')?.forEach((fn) => fn());
    await Promise.resolve();
    assert.equal(wakeLockRequests, 2);

    assert.equal(await plugin.updateNotification({ title: 'BGC Tempo', subtitle: '1.00 km' }), undefined);
    assert.deepEqual(await plugin.getBufferedFixes(), { fixes: [] });

    const stopRes = await plugin.stopTracking();
    assert.deepEqual(stopRes, { active: false });
    assert.deepEqual(await plugin.getStatus(), {
      active: false,
      bufferedCount: 0,
      mode: 'web-wake-lock',
    });
    assert.deepEqual(clearedWatchIds, [78]);
    assert.equal(sentinels[1].released, true);
    assert.equal(docListeners.get('visibilitychange')?.size ?? 0, 0);

    // Post-stop fixes and visibility events are ignored
    (watchCallback as WatchSuccess)({
      timestamp: 1_764_000_020_000,
      coords: {
        latitude: 14.551,
        longitude: 121.051,
        accuracy: 5,
        altitude: 12,
        speed: 3,
        heading: 0,
      },
    });
    assert.equal(received.length, 1);
    assert.equal(wakeLockRequests, 2);

    await listener.remove();
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete g.navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete g.document;
  }
});

test('RunTrackingWeb: rejects startTracking when geolocation is unavailable without activating tracking', async () => {
  const g = globalThis as Record<string, unknown>;
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  let wakeLockRequests = 0;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      wakeLock: {
        request: async () => {
          wakeLockRequests += 1;
          return { released: false, release: async () => undefined };
        },
      },
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined },
    configurable: true,
    writable: true,
  });

  try {
    const plugin = new RunTrackingWeb();
    await assert.rejects(() => plugin.startTracking(), /Geolocation is unavailable/i);
    assert.equal((await plugin.getStatus()).active, false);
    assert.equal(wakeLockRequests, 0);
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete g.navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete g.document;
  }
});

test('RunTrackingWeb: emits trackingError and stops + releases wake lock on permission denial', async () => {
  const g = globalThis as Record<string, unknown>;
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  type WatchErr = (err: { code: number; message: string }) => void;
  let errorCallback = null as WatchErr | null;
  const clearedWatchIds: number[] = [];
  let sentinelReleased = false;

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      geolocation: {
        getCurrentPosition: () => undefined,
        watchPosition: (_onSuccess: unknown, onError: WatchErr) => {
          errorCallback = onError;
          return 301;
        },
        clearWatch: (id: number) => {
          clearedWatchIds.push(id);
        },
      },
      wakeLock: {
        request: async () => ({
          get released() {
            return sentinelReleased;
          },
          release: async () => {
            sentinelReleased = true;
          },
        }),
      },
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined },
    configurable: true,
    writable: true,
  });

  try {
    const plugin = new RunTrackingWeb();
    const errors: Array<{ code: number; message: string }> = [];
    const listener = await plugin.addListener('trackingError', (err: { code: number; message: string }) => {
      errors.push(err);
    });

    await plugin.startTracking();
    assert.ok(errorCallback);

    // Non-fatal timeout keeps tracking active while emitting trackingError
    (errorCallback as WatchErr)({ code: 3, message: 'Temporary GPS timeout' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 3);
    assert.equal((await plugin.getStatus()).active, true);
    assert.equal(sentinelReleased, false);

    // Permission denied (code 1) emits trackingError and stops tracking + releases wake lock
    (errorCallback as WatchErr)({ code: 1, message: 'User denied Geolocation' });
    await Promise.resolve();
    assert.equal(errors.length, 2);
    assert.equal(errors[1].code, 1);
    assert.equal((await plugin.getStatus()).active, false);
    assert.deepEqual(clearedWatchIds, [301]);
    assert.equal(sentinelReleased, true);

    await listener.remove();
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete g.navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete g.document;
  }
});

test('RunTrackingWeb: start -> stop -> start race releases stale wakeLock sentinel and leaks zero watchers', async () => {
  const g = globalThis as Record<string, unknown>;
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  type WatchSuccess = (pos: {
    timestamp: number;
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number | null;
      speed: number | null;
      heading: number | null;
    };
  }) => void;

  const watchCallbacks: WatchSuccess[] = [];
  const clearedWatchIds: number[] = [];
  let nextWatchId = 500;
  const wakeResolvers: Array<(sentinel: { released: boolean; release: () => Promise<void> }) => void> = [];

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      geolocation: {
        getCurrentPosition: () => undefined,
        watchPosition: (onSuccess: WatchSuccess) => {
          watchCallbacks.push(onSuccess);
          nextWatchId += 1;
          return nextWatchId;
        },
        clearWatch: (id: number) => {
          clearedWatchIds.push(id);
        },
      },
      wakeLock: {
        request: () =>
          new Promise<{ released: boolean; release: () => Promise<void> }>((resolve) => {
            wakeResolvers.push(resolve);
          }),
      },
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined },
    configurable: true,
    writable: true,
  });

  try {
    const plugin = new RunTrackingWeb();
    const fixes: NativeRunFix[] = [];
    const listener = await plugin.addListener('locationFix', (fix) => fixes.push(fix));

    const start1 = plugin.startTracking();
    assert.equal(watchCallbacks.length, 1);

    await plugin.stopTracking();
    assert.deepEqual(clearedWatchIds, [501]);

    const start2 = plugin.startTracking();
    assert.equal(watchCallbacks.length, 2);

    const sentinel1 = { released: false, release: async () => { sentinel1.released = true; } };
    const sentinel2 = { released: false, release: async () => { sentinel2.released = true; } };

    // First request resolves AFTER stopTracking + second startTracking
    wakeResolvers[0](sentinel1);
    await Promise.resolve();
    wakeResolvers[1](sentinel2);

    assert.deepEqual(await start1, { active: false, mode: 'web-wake-lock' });
    assert.deepEqual(await start2, { active: true, mode: 'web-wake-lock' });
    assert.equal(watchCallbacks.length, 2);
    assert.deepEqual(clearedWatchIds, [501]);
    assert.equal(sentinel1.released, true);
    assert.equal(sentinel2.released, false);

    // Stale first watcher callback is ignored; second watcher delivers fixes
    watchCallbacks[0]({
      timestamp: 1_764_000_030_000,
      coords: { latitude: 14.55, longitude: 121.05, accuracy: 5, altitude: 10, speed: 3, heading: 0 },
    });
    assert.equal(fixes.length, 0);

    watchCallbacks[1]({
      timestamp: 1_764_000_031_000,
      coords: { latitude: 14.551, longitude: 121.051, accuracy: 4, altitude: 11, speed: 3.1, heading: 5 },
    });
    assert.equal(fixes.length, 1);

    await plugin.stopTracking();
    assert.deepEqual(clearedWatchIds, [501, 502]);
    assert.equal(sentinel2.released, true);
    await listener.remove();
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete g.navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete g.document;
  }
});

test('RunTrackingWeb: handles unsupported wakeLock and releases late sentinel if stopped mid-acquire', async () => {
  const g = globalThis as Record<string, unknown>;
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  let resolvePendingSentinel!: (sentinel: { released: boolean; release: () => Promise<void> }) => void;
  let lateReleased = false;
  let watchId = 10;

  const mockDoc = {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const mockNav: Record<string, unknown> = {
    geolocation: {
      getCurrentPosition: () => undefined,
      watchPosition: () => {
        watchId += 1;
        return watchId;
      },
      clearWatch: () => undefined,
    },
  };

  Object.defineProperty(globalThis, 'navigator', { value: mockNav, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: mockDoc, configurable: true, writable: true });

  try {
    // Missing wakeLock still tracks cleanly
    const pluginNoWake = new RunTrackingWeb();
    assert.deepEqual(await pluginNoWake.startTracking(), { active: true, mode: 'web-wake-lock' });
    assert.deepEqual(await pluginNoWake.stopTracking(), { active: false });

    // Pending wakeLock request resolves after stopTracking -> releases immediately
    mockNav.wakeLock = {
      request: () =>
        new Promise((resolve) => {
          resolvePendingSentinel = resolve;
        }),
    };
    const pluginRace = new RunTrackingWeb();
    const startPromise = pluginRace.startTracking();
    await pluginRace.stopTracking();
    resolvePendingSentinel({
      released: false,
      release: async () => {
        lateReleased = true;
      },
    });
    await startPromise;
    await Promise.resolve();
    assert.equal(lateReleased, true);
    assert.equal((await pluginRace.getStatus()).active, false);
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete g.navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete g.document;
  }
});

test('communityRunsClient: getCommunityApiBaseUrl resolves default and strips trailing slashes', () => {
  assert.equal(
    getCommunityApiBaseUrl(''),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
  );
  assert.equal(
    getCommunityApiBaseUrl('   '),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
  );
  assert.equal(
    getCommunityApiBaseUrl('  https://custom.racepulse.example/communityApi///  '),
    'https://custom.racepulse.example/communityApi',
  );
  assert.equal(
    getCommunityApiBaseUrl(),
    'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi',
  );
});

test('communityRunsClient: CommunityRunApiError classifies retryable vs non-retryable statuses accurately', () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    const err = new CommunityRunApiError(`HTTP ${status}`, status, { offline: false });
    assert.equal(err.name, 'CommunityRunApiError');
    assert.equal(err.status, status);
    assert.equal(err.retryable, false, `Expected HTTP ${status} to be non-retryable`);
  }

  for (const status of [0, 408, 429, 500, 502, 503, 504]) {
    const err = new CommunityRunApiError(`HTTP ${status}`, status, {
      retryAfter: status === 429 ? 45 : undefined,
      offline: false,
    });
    assert.equal(err.status, status);
    assert.equal(err.retryable, true, `Expected HTTP ${status} to be retryable`);
    if (status === 429) {
      assert.equal(err.retryAfter, 45);
    }
  }

  const offlineAuth = new CommunityRunApiError('Session check failed offline', 401, { offline: true });
  assert.equal(offlineAuth.retryable, true);
});

test('communityRunsClient: createCommunityRequestId generates unique valid IDs with and without randomUUID', () => {
  const validRe = /^[a-zA-Z0-9-]{16,64}$/;
  const ids = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const id = createCommunityRequestId();
    assert.match(id, validRe);
    ids.add(id);
  }
  assert.equal(ids.size, 12);

  const origCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      getRandomValues: (buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i += 1) {
          buf[i] = (i * 37 + 11) % 256;
        }
        return buf;
      },
    },
    configurable: true,
    writable: true,
  });
  try {
    const fallbackId = createCommunityRequestId();
    assert.match(fallbackId, validRe);
  } finally {
    if (origCryptoDesc) Object.defineProperty(globalThis, 'crypto', origCryptoDesc);
  }
});

test('communityRunsClient: capServerTrackPoints keeps start, finish, segmentBreak points, and <= 5000 bound', () => {
  const shortTrack = buildNorthboundTrack({ stepMeters: 10, count: 120 });
  const untouched = capServerTrackPoints(shortTrack, 5000);
  assert.equal(untouched.length, 120);
  assert.notEqual(untouched, shortTrack);

  const longTrack = buildNorthboundTrack({ stepMeters: 5, count: 6200, stepSec: 2 });
  longTrack[1234] = { ...longTrack[1234], segmentBreak: true };
  longTrack[4567] = { ...longTrack[4567], segmentBreak: true };

  const capped = capServerTrackPoints(longTrack);
  assert.equal(capped.length, 5000);
  assert.equal(capped[0].timestampMs, longTrack[0].timestampMs);
  assert.equal(capped[capped.length - 1].timestampMs, longTrack[longTrack.length - 1].timestampMs);
  assert.ok(capped.some((pt) => pt.timestampMs === longTrack[1234].timestampMs && pt.segmentBreak === true));
  assert.ok(capped.some((pt) => pt.timestampMs === longTrack[4567].timestampMs && pt.segmentBreak === true));

  for (let i = 1; i < capped.length; i += 1) {
    assert.ok(capped[i].timestampMs >= capped[i - 1].timestampMs);
  }

  // Tight custom limit preserves mandatory points and enforces <= limit
  const smallCap = capServerTrackPoints(longTrack, 12);
  assert.equal(smallCap.length, 12);
  assert.equal(smallCap[0].timestampMs, longTrack[0].timestampMs);
  assert.equal(smallCap[smallCap.length - 1].timestampMs, longTrack[longTrack.length - 1].timestampMs);
  assert.ok(smallCap.some((pt) => pt.timestampMs === longTrack[1234].timestampMs && pt.segmentBreak === true));
  assert.ok(smallCap.some((pt) => pt.timestampMs === longTrack[4567].timestampMs && pt.segmentBreak === true));
});

test('communityRunsClient: buildCompleteRunRequestPayload normalizes UTC timestamps, trim bounds, and track points', () => {
  const track = buildNorthboundTrack({ stepMeters: 20, count: 30, stepSec: 5 });
  track[0] = { ...track[0], speedMps: null };
  track[5] = { ...track[5], ele: 99999 }; // outside server [-450, 9000] bounds -> stripped

  const payload = buildCompleteRunRequestPayload({
    runId: 'run_baguio_2026',
    mode: 'course',
    privacy: 'friends',
    title: '  Baguio Ridge Tempo  ',
    startedAt: '2026-11-24T06:00:00+08:00',
    finishedAt: '2026-11-24T06:45:00+08:00',
    movingTimeMs: 2_650_000.4,
    clientDistanceM: 5800.14,
    trimmedHeadM: 312.4,
    trimmedTailM: -10,
    homePrivacyTrimEnabled: true,
    courseRef: {
      raceId: 'baguio-cordillera-2026',
      distanceId: '21k',
      publicationId: 'pub_21k_v1',
      raceName: 'Baguio Cordillera Ridge Run',
      distanceLabel: '21K',
      advertisedKm: 21,
      region: 'Cordillera',
    },
    trackPoints: track,
  });

  assert.match(payload.requestId, /^[a-zA-Z0-9-]{16,64}$/);
  assert.equal(payload.startedAt, '2026-11-23T22:00:00.000Z');
  assert.equal(payload.finishedAt, '2026-11-23T22:45:00.000Z');
  assert.equal(payload.title, 'Baguio Ridge Tempo');
  assert.equal(payload.movingTimeMs, 2_650_000);
  assert.equal(payload.clientDistanceM, 5800.1);
  assert.equal(payload.trimmedHeadM, 250);
  assert.equal(payload.trimmedTailM, 0);
  assert.equal('speedMps' in payload.trackPoints[0], false);
  assert.equal('ele' in payload.trackPoints[5], false);

  const untrimmedPayload = buildCompleteRunRequestPayload({
    requestId: 'req-fixed-id-123456',
    runId: 'run_untrimmed_1',
    mode: 'free',
    privacy: 'private',
    title: 'Morning Free Run',
    startedAt: '2026-11-24T00:00:00.000Z',
    finishedAt: '2026-11-24T00:20:00.000Z',
    movingTimeMs: 1_200_000,
    clientDistanceM: 3500,
    trimmedHeadM: 210,
    trimmedTailM: 205,
    homePrivacyTrimEnabled: false,
    trackPoints: track,
  });
  assert.equal(untrimmedPayload.requestId, 'req-fixed-id-123456');
  assert.equal(untrimmedPayload.trimmedHeadM, 0);
  assert.equal(untrimmedPayload.trimmedTailM, 0);

  assert.throws(
    () =>
      buildCompleteRunRequestPayload({
        runId: 'run_bad_time',
        mode: 'free',
        privacy: 'private',
        title: 'Invalid Time',
        startedAt: '2026-11-24T06:00:00.000Z',
        finishedAt: '2026-11-24T05:59:00.000Z',
        movingTimeMs: 60_000,
        clientDistanceM: 1000,
        trimmedHeadM: 0,
        trimmedTailM: 0,
        homePrivacyTrimEnabled: false,
        trackPoints: track,
      }),
    (err: unknown) => err instanceof CommunityRunApiError && err.status === 400 && err.retryable === false,
  );
});
