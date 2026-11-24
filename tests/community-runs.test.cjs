'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const tsModules = new Map();

function loadTs(filename) {
  if (tsModules.has(filename)) return tsModules.get(filename).exports;
  const mod = { exports: {} };
  tsModules.set(filename, mod);
  const raw = fs
    .readFileSync(filename, 'utf8')
    .replaceAll('typeof import.meta', "'undefined'")
    .replaceAll('import.meta.env', '({})');
  const transpiled = ts.transpileModule(raw, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (id) => {
    if (!id.startsWith('.')) return require(id);
    const resolved = path.resolve(path.dirname(filename), id);
    if (fs.existsSync(resolved + '.ts')) return loadTs(resolved + '.ts');
    if (fs.existsSync(resolved + '.tsx')) return loadTs(resolved + '.tsx');
    if (fs.existsSync(resolved)) return loadTs(resolved);
    return require(resolved);
  };
  new Function('require', 'module', 'exports', transpiled)(localRequire, mod, mod.exports);
  return mod.exports;
}

const calorieTs = loadTs(path.join(ROOT, 'src/lib/runs/calorieEngine.ts'));
const recorderTs = loadTs(path.join(ROOT, 'src/lib/runs/runRecorderEngine.ts'));

const runMath = require('../functions/run-math');
const { createCommunityService } = require('../functions/community-service');
const { createCommunityApp } = require('../functions/community-api');
const functionsIndex = require('../functions/index');

function createMockDb(initialDocs = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let txLock = Promise.resolve();
  let forceNextTxError = null;
  let forceNextGetError = null;

  const makeSnap = (docPath, data) => ({
    exists: data !== undefined && data !== null,
    id: docPath.split('/').pop(),
    ref: { path: docPath },
    data: () => (data !== undefined && data !== null ? structuredClone(data) : undefined),
  });

  const db = {
    doc(docPath) {
      return {
        path: docPath,
        async get() {
          if (forceNextGetError) {
            const err = forceNextGetError;
            forceNextGetError = null;
            throw err;
          }
          return makeSnap(docPath, docs.get(docPath));
        },
      };
    },
    runTransaction(fn) {
      const exec = async () => {
        if (forceNextTxError) {
          const err = forceNextTxError;
          forceNextTxError = null;
          throw err;
        }
        const stagedCreate = new Set();
        const stagedDelete = new Set();
        const staged = new Map();
        const tx = {
          async get(ref) {
            if (stagedDelete.has(ref.path)) return makeSnap(ref.path, undefined);
            if (staged.has(ref.path)) return makeSnap(ref.path, staged.get(ref.path));
            return makeSnap(ref.path, docs.get(ref.path));
          },
          create(ref, data) {
            const existsCurrently =
              !stagedDelete.has(ref.path) && (docs.has(ref.path) || stagedCreate.has(ref.path));
            if (existsCurrently) {
              const err = new Error(`6 ALREADY_EXISTS: ${ref.path}`);
              err.code = 6;
              throw err;
            }
            stagedDelete.delete(ref.path);
            stagedCreate.add(ref.path);
            staged.set(ref.path, structuredClone(data));
          },
          set(ref, data, opts) {
            stagedDelete.delete(ref.path);
            if (opts && opts.merge && (staged.has(ref.path) || docs.has(ref.path))) {
              const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
              staged.set(ref.path, { ...base, ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            if (stagedDelete.has(ref.path)) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            if (!base) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            staged.set(ref.path, { ...base, ...structuredClone(patch) });
          },
          delete(ref) {
            staged.delete(ref.path);
            stagedDelete.add(ref.path);
          },
        };
        const result = await fn(tx);
        for (const k of stagedDelete) {
          docs.delete(k);
        }
        for (const [k, v] of staged.entries()) {
          docs.set(k, v);
        }
        return result;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };

  return {
    db,
    docs,
    failNextTransaction(err) {
      forceNextTxError = err;
    },
    failNextGet(err) {
      forceNextGetError = err;
    },
  };
}

function makeReq({ method = 'POST', path: reqPath = '/runs/complete', headers = {}, body = {}, ip = '203.0.113.55', omitRawBody = false } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const rawBody = omitRawBody ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method,
    path: reqPath,
    ip,
    body,
    ...(rawBody !== undefined ? { rawBody } : {}),
    get(name) {
      return lower[String(name).toLowerCase()];
    },
    is(type) {
      return (lower['content-type'] || 'application/json').includes(type);
    },
  };
}

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body;
  const res = {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    set(k, v) {
      headers[String(k).toLowerCase()] = v;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(val) {
      body = val;
      return res;
    },
    send(val) {
      body = val;
      return res;
    },
  };
  return res;
}

function buildNorthboundTrack({
  startLat = 14.55,
  lon = 121.05,
  stepMeters,
  count,
  stepSec = 10,
  startMs = 1_764_000_000_000,
  eleFn,
}) {
  const dLatPerMeter = 1 / 111_195;
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    const ele = eleFn ? eleFn(i) : 15;
    pts.push({
      lat: startLat + i * stepMeters * dLatPerMeter,
      lon,
      ...(ele !== undefined ? { ele } : {}),
      accuracyM: 5,
      timestampMs: startMs + i * stepSec * 1000,
      speedMps: i === 0 ? 0 : stepMeters / stepSec,
    });
  }
  return pts;
}

function buildRunPayload(overrides = {}) {
  const startMs = 1_764_000_000_000;
  const pts = buildNorthboundTrack({
    stepMeters: 50,
    count: 101, // 5000m
    stepSec: 15, // 3.33 m/s -> 1500s
    startMs,
    eleFn: (i) => 12 + (i % 10),
  });
  return {
    requestId: 'req-complete-run-123456',
    runId: 'run_bgc_5k_01',
    mode: 'free',
    privacy: 'public',
    title: 'BGC Morning 5K',
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(startMs + 1_500_000).toISOString(),
    movingTimeMs: 1_500_000,
    homePrivacyTrimEnabled: false,
    trimmedHeadM: 0,
    trimmedTailM: 0,
    trackPoints: pts,
    ...overrides,
  };
}

test('run-math matches calorieEngine.ts and runRecorderEngine.ts constants, round1 -0 normalization, and segmentBreak parity', () => {
  assert.equal(runMath.DEFAULT_REFERENCE_WEIGHT_KG, calorieTs.DEFAULT_REFERENCE_WEIGHT_KG);
  assert.equal(runMath.MIN_WEIGHT_KG, calorieTs.MIN_WEIGHT_KG);
  assert.equal(runMath.MAX_WEIGHT_KG, calorieTs.MAX_WEIGHT_KG);
  assert.equal(runMath.CALORIE_METHOD_VERSION, calorieTs.CALORIE_METHOD_VERSION);
  assert.equal(runMath.RUNNING_SPEED_THRESHOLD_MPS, calorieTs.RUNNING_SPEED_THRESHOLD_MPS);
  assert.equal(runMath.RESTING_KCAL_PER_KG_HR, calorieTs.RESTING_KCAL_PER_KG_HR);
  assert.equal(runMath.JOULES_PER_KCAL, calorieTs.JOULES_PER_KCAL);
  assert.equal(runMath.MAX_ACTIVE_STATIONARY_GAP_SEC, calorieTs.MAX_ACTIVE_STATIONARY_GAP_SEC);
  assert.equal(runMath.ELEVATION_HYSTERESIS_M, recorderTs.ELEVATION_HYSTERESIS_M);

  assert.equal(Object.is(runMath.round1(-0), -0), false);
  assert.equal(Object.is(runMath.round1(-0.01), -0), false);
  assert.equal(runMath.round1(-0.01), 0);

  const scenarios = [
    {
      name: 'running flat (65kg fallback)',
      points: buildNorthboundTrack({ stepMeters: 50, count: 41, stepSec: 15, eleFn: () => 18 }),
      weightKg: null,
    },
    {
      name: 'walking flat (72kg)',
      points: buildNorthboundTrack({ stepMeters: 13, count: 50, stepSec: 10, eleFn: () => 25 }),
      weightKg: 72,
    },
    {
      name: 'uphill +10% (60kg)',
      points: buildNorthboundTrack({ stepMeters: 30, count: 35, stepSec: 12, eleFn: (i) => 100 + i * 3 }),
      weightKg: 60,
    },
    {
      name: 'downhill -12% (80kg)',
      points: buildNorthboundTrack({ stepMeters: 35, count: 30, stepSec: 10, eleFn: (i) => 500 - i * 4.2 }),
      weightKg: 80,
    },
  ];

  for (const s of scenarios) {
    const tsCal = calorieTs.computeRunCalorieEstimate(s.points, s.weightKg);
    const tsSplits = recorderTs.computePerKmSplits(s.points, s.weightKg);
    const jsMetrics = runMath.computeTrackMetrics(s.points, s.weightKg);

    assert.ok(
      Math.abs(jsMetrics.calorieEstimate.totalKcal - tsCal.totalKcal) < 0.01,
      `${s.name}: totalKcal mismatch ${jsMetrics.calorieEstimate.totalKcal} vs ${tsCal.totalKcal}`,
    );
    assert.ok(
      Math.abs(jsMetrics.calorieEstimate.netKcal - tsCal.netKcal) < 0.01,
      `${s.name}: netKcal mismatch`,
    );
    assert.ok(
      Math.abs(jsMetrics.calorieEstimate.restingKcal - tsCal.restingKcal) < 0.01,
      `${s.name}: restingKcal mismatch`,
    );
    assert.equal(jsMetrics.calorieEstimate.usedReferenceWeight, tsCal.usedReferenceWeight);
    assert.equal(jsMetrics.calorieEstimate.weightKgUsed, tsCal.weightKgUsed);
    assert.deepEqual(jsMetrics.splits, tsSplits);
  }

  // Paused segmentBreak across a 10-min, 1500m, +80m car jump must skip gap metrics and re-anchor elevation
  const startMs = 1_764_000_000_000;
  const dLatPerM = 1 / 111_195;
  const pausedTrack = [
    { lat: 14.55, lon: 121.05, ele: 10, accuracyM: 5, timestampMs: startMs + 1000, speedMps: 3.3 },
    { lat: 14.55 + 100 * dLatPerM, lon: 121.05, ele: 10, accuracyM: 5, timestampMs: startMs + 31_000, speedMps: 3.33 },
    {
      lat: 14.55 + 1600 * dLatPerM,
      lon: 121.05,
      ele: 90,
      accuracyM: 5,
      timestampMs: startMs + 632_000,
      speedMps: 3.2,
      segmentBreak: true,
    },
    { lat: 14.55 + 1700 * dLatPerM, lon: 121.05, ele: 95, accuracyM: 5, timestampMs: startMs + 662_000, speedMps: 3.33 },
  ];

  const tsPausedCal = calorieTs.computeRunCalorieEstimate(pausedTrack, 65);
  const tsPausedSplits = recorderTs.computePerKmSplits(pausedTrack, 65);
  const jsPaused = runMath.computeTrackMetrics(pausedTrack, 65);

  assert.ok(jsPaused.trackDistanceM > 195 && jsPaused.trackDistanceM < 205);
  assert.equal(jsPaused.elevationGainM, 5);
  assert.equal(jsPaused.elevationLossM, 0);
  assert.ok(Math.abs(jsPaused.calorieEstimate.totalKcal - tsPausedCal.totalKcal) < 0.01);
  assert.deepEqual(jsPaused.splits, tsPausedSplits);

  // Island groups & preview polyline parity
  const multiIsland = [
    { lat: 14.55, lon: 121.05, accuracyM: 5, timestampMs: startMs + 1000 },
    { lat: 10.32, lon: 123.9, accuracyM: 5, timestampMs: startMs + 2000 },
    { lat: 7.07, lon: 125.61, accuracyM: 5, timestampMs: startMs + 3000 },
  ];
  const jsMulti = runMath.computeTrackMetrics(multiIsland, 65);
  assert.deepEqual(jsMulti.islandGroups, ['Luzon', 'Visayas', 'Mindanao']);
  assert.ok(jsMulti.previewPolyline.length <= 240);
});

test('validateAndVerifyRecordedRun validates trim credit, short trimmed runs, bounds, and anti-cheat flags', () => {
  const base = buildRunPayload();
  const clean = runMath.validateAndVerifyRecordedRun({
    input: base,
    actorUid: 'runner_1',
    profileWeightKg: 68,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(clean.verificationStatus, 'verified');
  assert.deepEqual(clean.verificationFlags, []);
  assert.ok(clean.distanceM > 4990 && clean.distanceM < 5010);
  assert.equal(clean.splits.length, 5);
  assert.equal(clean.calorieEstimate.weightKgUsed, 68);
  assert.equal(clean.calorieEstimate.usedReferenceWeight, false);

  // Trimmed run adds trimCreditM (<= 250 each endpoint)
  const trimmed = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({
      homePrivacyTrimEnabled: true,
      trimmedHeadM: 200,
      trimmedTailM: 200,
      trackStoragePath: 'run-tracks/runner_1/run_bgc_5k_01.json',
      courseRef: {
        raceId: 'race_1',
        distanceId: '5k',
        raceName: 'BGC 5K',
        distanceLabel: '5K',
        advertisedKm: 5,
      },
    }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(trimmed.verificationStatus, 'verified');
  assert.equal(trimmed.trimmedHeadM, 200);
  assert.equal(trimmed.trimmedTailM, 200);
  assert.ok(Math.abs(trimmed.distanceM - (clean.distanceM + 400)) < 0.2);

  // Untrimmed run forces trimmedHeadM/trimmedTailM to 0
  const forcedZeroTrim = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({
      homePrivacyTrimEnabled: false,
      trimmedHeadM: 180,
      trimmedTailM: 120,
    }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(forcedZeroTrim.trimmedHeadM, 0);
  assert.equal(forcedZeroTrim.trimmedTailM, 0);
  assert.ok(Math.abs(forcedZeroTrim.distanceM - clean.distanceM) < 0.2);

  // Rejects trimmedHeadM > 250
  assert.throws(
    () =>
      runMath.validateAndVerifyRecordedRun({
        input: buildRunPayload({ homePrivacyTrimEnabled: true, trimmedHeadM: 251 }),
        actorUid: 'runner_1',
        profileWeightKg: 65,
        nowIso: '2026-11-24T08:00:00.000Z',
      }),
    (err) => err.status === 400,
  );

  // Short trimmed run (trackPoints: [], homePrivacyTrimEnabled: true, clientDistanceM <= 500)
  const shortTrimmed = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({
      trackPoints: [],
      homePrivacyTrimEnabled: true,
      trimmedHeadM: 200,
      trimmedTailM: 200,
      clientDistanceM: 400,
      movingTimeMs: 120_000,
      finishedAt: new Date(1_764_000_000_000 + 120_000).toISOString(),
    }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(shortTrimmed.verificationStatus, 'verified');
  assert.equal(shortTrimmed.distanceM, 400);
  assert.equal(shortTrimmed.pointCount, 0);

  // Rejects empty trackPoints when untrimmed or clientDistanceM > 500
  assert.throws(
    () =>
      runMath.validateAndVerifyRecordedRun({
        input: buildRunPayload({ trackPoints: [], homePrivacyTrimEnabled: false, clientDistanceM: 400 }),
        actorUid: 'runner_1',
        profileWeightKg: 65,
        nowIso: '2026-11-24T08:00:00.000Z',
      }),
    (err) => err.status === 400,
  );
  assert.throws(
    () =>
      runMath.validateAndVerifyRecordedRun({
        input: buildRunPayload({ trackPoints: [], homePrivacyTrimEnabled: true, clientDistanceM: 501 }),
        actorUid: 'runner_1',
        profileWeightKg: 65,
        nowIso: '2026-11-24T08:00:00.000Z',
      }),
    (err) => err.status === 400,
  );

  // Rejects cross-user trackStoragePath
  assert.throws(
    () =>
      runMath.validateAndVerifyRecordedRun({
        input: buildRunPayload({ trackStoragePath: 'run-tracks/other_user/run_1.json' }),
        actorUid: 'runner_1',
        profileWeightKg: 65,
        nowIso: '2026-11-24T08:00:00.000Z',
      }),
    (err) => err.status === 400,
  );

  // Flags implausible_avg_speed (> 7.5 m/s) and implausible_burst_speed (> 11.5 m/s)
  const fastStart = 1_764_000_000_000;
  const speedCarPts = buildNorthboundTrack({
    stepMeters: 150,
    count: 21, // 3000m
    stepSec: 10, // 15 m/s
    startMs: fastStart,
  });
  const flaggedSpeed = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({
      trackPoints: speedCarPts,
      movingTimeMs: 200_000,
      finishedAt: new Date(fastStart + 200_000).toISOString(),
    }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(flaggedSpeed.verificationStatus, 'flagged');
  assert.ok(flaggedSpeed.verificationFlags.includes('implausible_avg_speed'));
  assert.ok(flaggedSpeed.verificationFlags.includes('implausible_burst_speed'));

  // Flags distance_mismatch
  const flaggedMismatch = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({ clientDistanceM: 10_000 }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(flaggedMismatch.verificationStatus, 'flagged');
  assert.ok(flaggedMismatch.verificationFlags.includes('distance_mismatch'));

  // Flags extreme_single_distance (> 300km)
  const ultraStart = 1_764_000_000_000;
  const ultraPts = buildNorthboundTrack({
    stepMeters: 500,
    count: 612, // 305.5 km
    stepSec: 100, // 5 m/s (plausible avg speed)
    startMs: ultraStart,
  });
  const flaggedUltra = runMath.validateAndVerifyRecordedRun({
    input: buildRunPayload({
      trackPoints: ultraPts,
      movingTimeMs: 61_100_000,
      finishedAt: new Date(ultraStart + 61_100_000).toISOString(),
    }),
    actorUid: 'runner_1',
    profileWeightKg: 65,
    nowIso: '2026-11-24T08:00:00.000Z',
  });
  assert.equal(flaggedUltra.verificationStatus, 'flagged');
  assert.ok(flaggedUltra.verificationFlags.includes('extreme_single_distance'));
});

test('communityService handles /runs/complete, onboarding first_run milestone, idempotency, RBAC, /runs/update, and /runs/delete', async () => {
  const deletedStoragePaths = [];
  const storage = {
    bucket: () => ({
      file: (objectPath) => ({
        async delete() {
          deletedStoragePaths.push(objectPath);
        },
      }),
    }),
  };

  const store = createMockDb({
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true, weightKg: 70, onboardingSteps: ['welcome'] },
    'userAccess/u_runner': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_other': { uid: 'u_other', role: 'runner', approved: true },
    'userAccess/u_other': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_denied': { uid: 'u_denied', role: 'runner', approved: true },
    'userAccess/u_denied': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: { 'personal.record': false } },
    'users/u_suspended': { uid: 'u_suspended', role: 'runner', approved: true },
    'userAccess/u_suspended': { status: 'suspended', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_unapproved_org': { uid: 'u_unapproved_org', role: 'organizer', approved: false },
    'users/u_ten_steps': {
      uid: 'u_ten_steps',
      role: 'runner',
      approved: true,
      onboardingSteps: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'],
    },
  });

  const service = createCommunityService(store.db, storage);
  const completePayload = buildRunPayload({
    trackStoragePath: 'run-tracks/u_runner/run_bgc_5k_01.json',
  });

  // Complete succeeds & appends 'first_run'
  const res1 = await service.execute('u_runner', '/runs/complete', completePayload);
  assert.equal(res1.run.uid, 'u_runner');
  assert.equal(res1.run.runId, 'run_bgc_5k_01');
  assert.equal(store.docs.get('recordedRuns/run_bgc_5k_01').uid, 'u_runner');
  assert.deepEqual(store.docs.get('users/u_runner').onboardingSteps, ['welcome', 'first_run']);

  // Idempotent replay returns identical response without duplicating onboardingSteps
  const resReplay = await service.execute('u_runner', '/runs/complete', completePayload);
  assert.deepEqual(resReplay, res1);
  assert.deepEqual(store.docs.get('users/u_runner').onboardingSteps, ['welcome', 'first_run']);

  // Reusing same requestId with different payload triggers 409 conflict
  await assert.rejects(
    service.execute('u_runner', '/runs/complete', { ...completePayload, title: 'Tampered Title' }),
    (err) => err.status === 409,
  );

  // Another user trying to overwrite same runId triggers 409 conflict
  await assert.rejects(
    service.execute('u_other', '/runs/complete', {
      ...completePayload,
      requestId: 'req-other-user-conflict-1234',
      trackStoragePath: undefined,
    }),
    (err) => err.status === 409,
  );

  // Same user with new requestId and conflicting content triggers 409
  await assert.rejects(
    service.execute('u_runner', '/runs/complete', {
      ...completePayload,
      requestId: 'req-new-conflict-123456',
      title: 'Different Run Same ID',
    }),
    (err) => err.status === 409,
  );

  // 10 existing onboarding steps stays capped at 10 without failing
  await service.execute('u_ten_steps', '/runs/complete', buildRunPayload({
    requestId: 'req-ten-steps-run-123456',
    runId: 'run_ten_steps_01',
  }));
  assert.equal(store.docs.get('users/u_ten_steps').onboardingSteps.length, 10);

  // Unapproved organizer still allowed personal.record
  const orgRes = await service.execute('u_unapproved_org', '/runs/complete', buildRunPayload({
    requestId: 'req-unapproved-org-123456',
    runId: 'run_org_01',
  }));
  assert.equal(orgRes.run.uid, 'u_unapproved_org');

  // Denied override and suspended user get 403
  await assert.rejects(
    service.execute('u_denied', '/runs/complete', buildRunPayload({ requestId: 'req-denied-12345678', runId: 'run_denied' })),
    (err) => err.status === 403,
  );
  await assert.rejects(
    service.execute('u_suspended', '/runs/complete', buildRunPayload({ requestId: 'req-susp-1234567890', runId: 'run_susp' })),
    (err) => err.status === 403,
  );

  // Update ownership check + allowed fields
  await assert.rejects(
    service.execute('u_other', '/runs/update', {
      requestId: 'req-upd-other-1234567',
      runId: 'run_bgc_5k_01',
      title: 'Hijacked',
    }),
    (err) => err.status === 403,
  );
  const updated = await service.execute('u_runner', '/runs/update', {
    requestId: 'req-upd-owner-1234567',
    runId: 'run_bgc_5k_01',
    title: 'BGC Tempo 5K',
    privacy: 'friends',
  });
  assert.equal(updated.run.title, 'BGC Tempo 5K');
  assert.equal(updated.run.privacy, 'friends');

  // Delete ownership check + best-effort storage delete
  await assert.rejects(
    service.execute('u_other', '/runs/delete', {
      requestId: 'req-del-other-1234567',
      runId: 'run_bgc_5k_01',
    }),
    (err) => err.status === 403,
  );
  const deleted = await service.execute('u_runner', '/runs/delete', {
    requestId: 'req-del-owner-1234567',
    runId: 'run_bgc_5k_01',
  });
  assert.deepEqual(deleted, { deleted: true, runId: 'run_bgc_5k_01' });
  assert.equal(store.docs.has('recordedRuns/run_bgc_5k_01'), false);
  assert.deepEqual(deletedStoragePaths, ['run-tracks/u_runner/run_bgc_5k_01.json']);
});

test('communityApi enforces method, 2.5MB JSON cap, auth checkRevoked, rate limits, safe 500s, and functions/index export', async () => {
  assert.equal(typeof functionsIndex.communityApi, 'function');

  const store = createMockDb({
    'users/u_runner': { uid: 'u_runner', role: 'runner', approved: true },
    'userAccess/u_runner': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  });

  const seenRevokedFlags = [];
  const admin = {
    auth: () => ({
      async verifyIdToken(token, checkRevoked) {
        seenRevokedFlags.push(checkRevoked);
        if (token === 'tok-runner') return { uid: 'u_runner' };
        throw new Error('invalid token');
      },
    }),
  };

  const handler = createCommunityApp({ admin, db: store.db, appCheckMode: 'off' });

  // Non-POST rejected 405
  const getRes = makeRes();
  await handler(makeReq({ method: 'GET', path: '/runs/complete' }), getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(getRes.headers['cache-control'], 'no-store');
  assert.equal(getRes.headers['x-content-type-options'], 'nosniff');

  // Missing bearer rejected 401
  const noAuthRes = makeRes();
  await handler(makeReq({ path: '/runs/complete', body: buildRunPayload() }), noAuthRes);
  assert.equal(noAuthRes.statusCode, 401);

  // Oversized > 2.5MB rejected even when rawBody is omitted (serialized fallback)
  const bigStr = 'x'.repeat(2.6 * 1024 * 1024);
  const bigRes = makeRes();
  await handler(
    makeReq({
      path: '/runs/complete',
      headers: { authorization: 'Bearer tok-runner' },
      body: { ...buildRunPayload(), extraPad: bigStr },
      omitRawBody: true,
    }),
    bigRes,
  );
  assert.equal(bigRes.statusCode, 413);

  // Unexpected DB error returns 500 without leaking raw message
  store.failNextGet(new Error('SECRET_COMMUNITY_FIRESTORE_ERR'));
  const errRes = makeRes();
  await handler(
    makeReq({
      path: '/runs/complete',
      headers: { authorization: 'Bearer tok-runner' },
      body: buildRunPayload(),
    }),
    errRes,
  );
  assert.equal(errRes.statusCode, 500);
  assert.ok(!JSON.stringify(errRes.body).includes('SECRET_COMMUNITY_FIRESTORE_ERR'));
  assert.ok(seenRevokedFlags.every((flag) => flag === true));

  // Oversized rawBody > 2.5MB also rejected 413
  const oversizedRawRes = makeRes();
  const basePayload = buildRunPayload();
  await handler(
    {
      method: 'POST',
      path: '/runs/complete',
      ip: '203.0.113.56',
      body: basePayload,
      rawBody: Buffer.alloc(2.5 * 1024 * 1024 + 10, 0x20),
      get: (h) => (String(h).toLowerCase() === 'authorization' ? 'Bearer tok-runner' : undefined),
      is: (t) => t === 'application/json',
    },
    oversizedRawRes,
  );
  assert.equal(oversizedRawRes.statusCode, 413);

  // AppCheck enforce rejects missing header with 401
  const appCheckHandler = createCommunityApp({ admin, db: store.db, appCheckMode: 'enforce' });
  const appCheckRes = makeRes();
  await appCheckHandler(
    makeReq({
      path: '/runs/complete',
      headers: { authorization: 'Bearer tok-runner' },
      body: buildRunPayload(),
      ip: '203.0.113.57',
    }),
    appCheckRes,
  );
  assert.equal(appCheckRes.statusCode, 401);

  // Per-user mutation rate limit (30/15m) triggers 429 + Retry-After on 31st request
  const rateStore = createMockDb({
    'users/u_rate': { uid: 'u_rate', role: 'runner', approved: true },
    'userAccess/u_rate': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
  });
  const rateAdmin = {
    auth: () => ({
      async verifyIdToken() {
        return { uid: 'u_rate' };
      },
    }),
  };
  const rateHandler = createCommunityApp({ admin: rateAdmin, db: rateStore.db, appCheckMode: 'off' });
  for (let i = 0; i < 30; i += 1) {
    const r = makeRes();
    await rateHandler(
      makeReq({
        path: '/runs/update',
        headers: { authorization: 'Bearer tok-rate' },
        body: { requestId: `req-rate-limit-pad-${String(i).padStart(4, '0')}`, runId: 'missing', title: 'X' },
        ip: '203.0.113.58',
      }),
      r,
    );
    assert.equal(r.statusCode, 404);
  }
  const throttledRes = makeRes();
  await rateHandler(
    makeReq({
      path: '/runs/update',
      headers: { authorization: 'Bearer tok-rate' },
      body: { requestId: 'req-rate-limit-pad-0031', runId: 'missing', title: 'X' },
      ip: '203.0.113.58',
    }),
    throttledRes,
  );
  assert.equal(throttledRes.statusCode, 429);
  assert.ok(Number(throttledRes.headers['retry-after']) > 0);
});

test('communityService handles admin personal.record override, storage delete failure resilience, and invalid run inputs', async () => {
  const store = createMockDb({
    'users/u_admin_default': { uid: 'u_admin_default', role: 'admin', approved: true },
    'users/u_admin_granted': { uid: 'u_admin_granted', role: 'admin', approved: true },
    'userAccess/u_admin_granted': { status: 'active', scope: 'all', raceIds: [], overrides: { 'personal.record': true } },
  });
  const failingStorage = {
    bucket: () => ({
      file: () => ({
        async delete() {
          throw new Error('Storage offline');
        },
      }),
    }),
  };
  const service = createCommunityService(store.db, failingStorage);

  // Admin without override denied 403
  await assert.rejects(
    service.execute('u_admin_default', '/runs/complete', buildRunPayload({ requestId: 'req-admin-deny-123456', runId: 'run_admin_1' })),
    (err) => err.status === 403,
  );

  // Admin with explicit personal.record override allowed
  const ok = await service.execute(
    'u_admin_granted',
    '/runs/complete',
    buildRunPayload({
      requestId: 'req-admin-grant-123456',
      runId: 'run_admin_2',
      trackStoragePath: 'run-tracks/u_admin_granted/run_admin_2.json',
    }),
  );
  assert.equal(ok.run.uid, 'u_admin_granted');

  // Best-effort storage failure does not fail /runs/delete
  const del = await service.execute('u_admin_granted', '/runs/delete', {
    requestId: 'req-admin-delete-12345',
    runId: 'run_admin_2',
  });
  assert.deepEqual(del, { deleted: true, runId: 'run_admin_2' });
  assert.equal(store.docs.has('recordedRuns/run_admin_2'), false);

  // Rejects invalid trackPoints length 1, non-decreasing timestamps, bad ele, and invalid elapsed/moving times
  const base = buildRunPayload();
  await assert.rejects(
    service.execute('u_admin_granted', '/runs/complete', {
      ...base,
      requestId: 'req-bad-len1-1234567890',
      trackPoints: [base.trackPoints[0]],
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_admin_granted', '/runs/complete', {
      ...base,
      requestId: 'req-bad-ts-order-12345',
      trackPoints: [base.trackPoints[1], base.trackPoints[0]],
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_admin_granted', '/runs/complete', {
      ...base,
      requestId: 'req-bad-ele-range-1234',
      trackPoints: [{ ...base.trackPoints[0], ele: 9500 }, base.trackPoints[1]],
    }),
    (err) => err.status === 400,
  );
  await assert.rejects(
    service.execute('u_admin_granted', '/runs/complete', {
      ...base,
      requestId: 'req-bad-moving-1234567',
      movingTimeMs: 5000,
    }),
    (err) => err.status === 400,
  );
});
