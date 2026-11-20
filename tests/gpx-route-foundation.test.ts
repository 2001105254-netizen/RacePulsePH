import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  computeRunnerLocationRelativeToRoute,
  selectPublishedCourseForDistance,
} from '../src/lib/routes/useRunnerGeolocation';
import {
  MAX_GPX_BYTES,
  exportSanitizedGpx,
  geodesicDistanceM,
  parseGpxRoute,
  reverseCanonicalGeometry,
} from '../src/lib/gpxRoute';
import { createEmptyRouteGeometry, processCanonicalGeometry } from '../src/lib/routes/geometry';
import { locateAtChainage, projectCoordinateToRoute, reanchorMarkersForRoute, deriveDefaultChapters } from '../src/lib/routes/anchoring';
import {
  bindAndPublishRaceRouteCommand,
  createPresetDraftCommand,
  createPresetVersionCommand,
  DEMO_BAGUIO_RACE,
  describePresetConfigStatus,
  duplicatePresetCommand,
  getPublishedCoursesForRace,
  getRouteStoreSnapshot,
  isDemoSeedEnabled,
  migrateLegacyRaceGpxCommand,
  PILOT_BUKIDNON_RACE,
  PILOT_CEBU_RACE,
  rollbackPublicationCommand,
  runQuarterlyNationalMosaicRefreshCommand,
  runWeeklyClearImageryCheckCommand,
  savePresetDraftCommand,
  seedPilotCoursesFromGpxText,
  sortRoutePresetsForDistance,
  stripDemoArtifacts,
  validatePublicationReadiness,
  withdrawPublicationCommand,
  type RouteWorkspaceStore,
} from '../src/lib/routes/routeStore';
import {
  buildGpsAccuracyCircleGeoJson,
  createGpsFilterState,
  ingestGpsFix,
} from '../src/lib/routes/gpsFilter';
import {
  buildPhilippinesWorldMaskGeoJson,
  COPERNICUS_TERRAIN_RELEASE,
  decodeTerrariumRgb,
  encodeTerrariumRgb,
  getRolloutBudgetBenchmarks,
  getTileTelemetrySnapshot,
  isPointInPhilippineIslands,
  isTileInPhilippines,
  PHILIPPINES_NATIONAL_BOUNDS,
  prepareCourseMapLayerManifest,
  resetTileTelemetry,
  synthesizePhilippineTileRgba,
} from '../src/lib/routes/philippinesMapTiles';
import {
  appendPaintedStrokeToGeometry,
  clearRouteCanvas,
  commitGpsTrackToGeometry,
  createGpsTrailState,
  erasePointsInRadius,
  generateSimulatedGpsWalk,
  mirrorOutAndBackRoute,
  processGpsBreadcrumbFix,
  relocateStartPointInGeometry,
  removeStartPointFromGeometry,
  sampleTerrainElevationForGeometry,
  smoothPaintedStroke,
  SURFACE_LABELS,
} from '../src/lib/routes/trailTools';
import { buildCourseAnalytics } from '../src/lib/routes/courseAnalytics';
import { matchRouteLocation } from '../src/lib/routes/routing';

test('parses real Baguio 21K multi-segment GPX with partial elevation and overlap passes', () => {
  const gpx = fs.readFileSync('public/fixtures/baguio-cordillera-21k.gpx', 'utf8');
  const route = parseGpxRoute(gpx);
  assert.equal(route.canonicalSegments.length, 2);
  assert.ok(route.distanceKm > 20 && route.distanceKm < 23);
  assert.equal(route.elevationProvenance.status, 'partial');
  assert.ok(route.elevationProvenance.coveragePct > 80 && route.elevationProvenance.coveragePct < 100);
  assert.equal(route.validationReport.hasOverlapPasses, true);
  assert.ok(route.displaySegments[0].length <= route.canonicalSegments[0].length);
  assert.ok(route.waypoints.length >= 4);
});

test('rejects missing lat/lon attributes instead of converting null to 0 while allowing valid 0,0', () => {
  const missingAttr = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="16.4"><ele>100</ele></trkpt><trkpt lat="16.41" lon="120.6"><ele>110</ele></trkpt><trkpt lat="16.42" lon="120.61"><ele>120</ele></trkpt></trkseg></trk></gpx>`;
  const parsedWithMissing = parseGpxRoute(missingAttr);
  assert.equal(parsedWithMissing.points.length, 2);
  assert.ok(parsedWithMissing.points.every((p) => p.longitude !== 0));

  const validZero = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0.001" lon="0.001"/></trkseg></trk></gpx>`;
  const zeroRoute = parseGpxRoute(validZero);
  assert.equal(zeroRoute.points[0].latitude, 0);
  assert.equal(zeroRoute.points[0].longitude, 0);
  assert.equal(zeroRoute.elevationProvenance.status, 'unavailable');
});

test('rejects DTD/entity declarations and rejects oversize point counts without silent truncation', () => {
  const dtd = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY xxe "bad">]><gpx version="1.1"><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`;
  assert.throws(() => parseGpxRoute(dtd), /declarations are unsupported/);

  const hugeSeg = Array.from({ length: 100_005 }, () => `<trkpt lat="16.4" lon="120.6"/>`).join('');
  const hugeGpx = `<gpx version="1.1"><trk><trkseg>${hugeSeg}</trkseg></trk></gpx>`;
  assert.throws(() => parseGpxRoute(hugeGpx), /exceeding the 100,000 point limit/);
});

test('supports namespaced GPX and rtept routes without bridging separate segments', () => {
  const namespaced = `<?xml version="1.0"?><g:gpx xmlns:g="http://www.topografix.com/GPX/1/1" version="1.1"><g:rte><g:name>Route A</g:name><g:rtept lat="16.40" lon="120.59"><g:ele>1400</g:ele></g:rtept><g:rtept lat="16.41" lon="120.60"><g:ele>1440</g:ele></g:rtept></g:rte></g:gpx>`;
  const route = parseGpxRoute(namespaced);
  assert.equal(route.points.length, 2);
  assert.equal(route.validationReport.trackNames[0], 'Route A');
  assert.ok(Math.abs(route.distanceM - geodesicDistanceM(route.points[0], route.points[1])) < 1);
});

test('smoothing suppresses isolated spikes and hysteresis preserves gradual climbs', () => {
  // Flat 20-point climb with one wild 400m spike in the middle
  const pts = Array.from({ length: 20 }, (_, i) => {
    const ele = i === 10 ? 1850 : 1400 + i * 2;
    return `<trkpt lat="${(16.40 + i * 0.0004).toFixed(6)}" lon="120.600000"><ele>${ele}</ele></trkpt>`;
  }).join('');
  const gpx = `<gpx version="1.1"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
  const route = parseGpxRoute(gpx);
  assert.ok(route.elevationGainM < 80, `Expected spike suppression, got gain ${route.elevationGainM}`);
  assert.ok(route.elevationGainM > 20, `Expected gradual climb gain preserved, got ${route.elevationGainM}`);
});

test('sanitized GPX export strips timestamps, extensions, and draft-only markers', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="16.41" lon="120.59"><ele>1450</ele><time>2026-11-16T05:00:00Z</time><extensions><hr>172</hr></extensions></trkpt><trkpt lat="16.42" lon="120.60"><ele>1480</ele><time>2026-11-16T05:05:00Z</time></trkpt></trkseg></trk></gpx>`;
  const parsed = parseGpxRoute(gpx);
  const exported = exportSanitizedGpx(parsed.canonicalGeometry, {
    title: 'Clean Course',
    markers: [
      {
        id: 'm_pub',
        kind: 'aid',
        name: 'Public Aid',
        description: 'Water',
        latitude: 16.415,
        longitude: 120.595,
        chainageM: 500,
        segmentIndex: 0,
        pointIndex: 0,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        services: ['Water'],
        photos: [],
        visibility: 'public',
      },
      {
        id: 'm_draft',
        kind: 'hazard',
        name: 'Private Organizer Note',
        description: 'Secret',
        latitude: 16.418,
        longitude: 120.598,
        chainageM: 700,
        segmentIndex: 0,
        pointIndex: 1,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        services: [],
        photos: [],
        visibility: 'draft',
      },
    ],
  });
  assert.ok(!exported.includes('<time>'));
  assert.ok(!exported.includes('<extensions>'));
  assert.ok(!exported.includes('Private Organizer Note'));
  assert.ok(exported.includes('Public Aid'));
});

test('out-and-back projection resolves pass 1 vs pass 2 and flags off-course thresholds', () => {
  const gpx = fs.readFileSync('public/fixtures/baguio-cordillera-21k.gpx', 'utf8');
  const route = parseGpxRoute(gpx);
  // Point along South Drive shared by outbound and inbound passes
  const proj = projectCoordinateToRoute(route, 16.4141, 120.6145);
  assert.equal(proj.hasAmbiguousPasses, true);
  assert.ok(proj.candidates.length >= 2);
  assert.ok(proj.candidates[0].chainageM < proj.candidates[1].chainageM);

  const farMarkers = reanchorMarkersForRoute(route, [
    {
      id: 'm_far',
      kind: 'medical',
      name: 'Hospital Gate',
      description: '',
      latitude: 16.425,
      longitude: 120.585,
      chainageM: 0,
      segmentIndex: 0,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: [],
      photos: [],
      visibility: 'public',
    },
  ]);
  assert.equal(farMarkers[0].needsReview, true);
  assert.equal(farMarkers[0].offCourseBlocked, true);
});

test('route studio presets, immutable versions, conflict detection, publish, withdraw, rollback, freeze, and legacy migration', async () => {
  const gpx21 = fs.readFileSync('public/fixtures/baguio-cordillera-21k.gpx', 'utf8');
  const route = parseGpxRoute(gpx21);
  const { preset, draft } = createPresetDraftCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    title: 'Test Baguio 21K',
    region: 'Cordillera',
    activity: 'trail',
    geometry: route.canonicalGeometry,
    markers: [
      {
        id: 'ms',
        kind: 'start',
        name: 'Start',
        description: '',
        latitude: route.points[0].latitude,
        longitude: route.points[0].longitude,
        chainageM: 0,
        segmentIndex: 0,
        pointIndex: 0,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        timingCheckpointId: 'cp_start',
        services: [],
        photos: [],
        visibility: 'public',
      },
      {
        id: 'mf',
        kind: 'finish',
        name: 'Finish',
        description: '',
        latitude: route.points[route.points.length - 1].latitude,
        longitude: route.points[route.points.length - 1].longitude,
        chainageM: route.distanceM,
        segmentIndex: 1,
        pointIndex: route.canonicalSegments[1].length - 1,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        timingCheckpointId: 'cp_finish',
        services: [],
        photos: [],
        visibility: 'public',
      },
    ],
  });

  // Save draft revision 1 -> 2
  const saved = savePresetDraftCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    presetId: preset.id,
    draftId: draft.id,
    expectedRevision: 1,
    title: 'Test Baguio 21K Revised',
    region: 'Cordillera',
    geometry: route.canonicalGeometry,
    markers: draft.markers,
  });
  assert.equal(saved.revision, 2);

  // Stale revision conflict rejected
  assert.throws(
    () =>
      savePresetDraftCommand({
        actorUid: 'org_1',
        actorName: 'Organizer',
        presetId: preset.id,
        draftId: draft.id,
        expectedRevision: 1,
        title: 'Stale',
        region: 'Cordillera',
        geometry: route.canonicalGeometry,
        markers: draft.markers,
      }),
    /Revision conflict/,
  );

  // Freeze v1 and publish
  const v1 = createPresetVersionCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    presetId: preset.id,
    draftId: draft.id,
    expectedRevision: 2,
  });
  const pub1 = bindAndPublishRaceRouteCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    race: DEMO_BAGUIO_RACE,
    distanceId: '21k',
    presetId: preset.id,
    versionId: v1.id,
  });

  // Reversing draft and saving does NOT mutate pub1
  const reversed = reverseCanonicalGeometry(route.canonicalGeometry);
  savePresetDraftCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    presetId: preset.id,
    draftId: draft.id,
    expectedRevision: 2,
    title: 'Draft reversed',
    region: 'Cordillera',
    geometry: reversed,
    markers: draft.markers,
  });
  const v2 = createPresetVersionCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    presetId: preset.id,
    draftId: draft.id,
    expectedRevision: 3,
  });
  assert.equal(getRouteStoreSnapshot().publications[pub1.publication.id].versionNumber, 1);

  // Race-day freeze blocks normal publish without override
  const startedRace = { ...DEMO_BAGUIO_RACE, gunStartTime: '2026-12-13T05:00:00+08:00' };
  assert.throws(
    () =>
      bindAndPublishRaceRouteCommand({
        actorUid: 'org_1',
        actorName: 'Organizer',
        race: startedRace,
        distanceId: '21k',
        presetId: preset.id,
        versionId: v2.id,
      }),
    /Race-day freeze is active/,
  );

  // Override with written reason succeeds
  const pub2 = bindAndPublishRaceRouteCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    race: startedRace,
    distanceId: '21k',
    presetId: preset.id,
    versionId: v2.id,
    overrideFreeze: true,
    reason: 'Diverted after landslide notice',
  });
  assert.equal(pub2.publication.versionNumber, 2);

  // Withdraw and rollback
  withdrawPublicationCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    raceId: DEMO_BAGUIO_RACE.id,
    distanceId: '21k',
    publicationId: pub2.publication.id,
    reason: 'Course review',
  });
  assert.equal(getRouteStoreSnapshot().publications[pub2.publication.id].status, 'withdrawn');
  const restored = rollbackPublicationCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    raceId: DEMO_BAGUIO_RACE.id,
    distanceId: '21k',
    targetPublicationId: pub1.publication.id,
  });
  assert.equal(restored.status, 'published');
  assert.equal(restored.versionNumber, 1);

  // Duplicate preset creates independent copy
  const dup = duplicatePresetCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    sourcePresetId: preset.id,
  });
  assert.notEqual(dup.preset.id, preset.id);

  // Legacy migration checks multi-distance safeguard
  const multiRace = { ...DEMO_BAGUIO_RACE, routeGpxUrl: 'https://example.com/old.gpx' };
  const multiCheck = await migrateLegacyRaceGpxCommand({
    actorUid: 'org_1',
    actorName: 'Organizer',
    race: multiRace,
  });
  assert.equal(multiCheck.status, 'needs_distance_choice');

  // Case-sensitive routing matcher
  const matched = matchRouteLocation('/races/Race_AbC/routes/21K', '?v=Pub_V2');
  assert.deepEqual(matched, {
    kind: 'race-course',
    raceId: 'Race_AbC',
    distanceId: '21K',
    publicationId: 'Pub_V2',
  });
  assert.ok(locateAtChainage(route, 5000).chainageM === 5000);
  assert.equal(
    validatePublicationReadiness({ title: '', geometry: route.canonicalGeometry, markers: [] }).ready,
    false,
  );
});

test('GPS trail tracking rejects noisy accuracy and velocity spikes while smoothing valid fixes', () => {
  let state = createGpsTrailState({ maxAccuracyM: 25, minDisplacementM: 4, maxSpeedMps: 18 });
  const t0 = 1_760_000_000_000;
  // First valid fix
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.4119,
    longitude: 120.5947,
    altitude: 1450,
    accuracyM: 5,
    timestamp: t0,
  });
  assert.equal(state.acceptedPoints.length, 1);

  // Stationary drift (< 4 m) should be rejected
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.411905,
    longitude: 120.594705,
    accuracyM: 6,
    timestamp: t0 + 5000,
  });
  assert.equal(state.acceptedPoints.length, 1);
  assert.equal(state.rejectedCount, 1);

  // Poor accuracy fix (> 25 m) should be rejected
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.4125,
    longitude: 120.5955,
    accuracyM: 48,
    timestamp: t0 + 10000,
  });
  assert.equal(state.rejectedCount, 2);

  // Velocity spike (> 18 m/s across 1 sec) should be rejected
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.43,
    longitude: 120.61,
    accuracyM: 5,
    timestamp: t0 + 11000,
  });
  assert.equal(state.rejectedCount, 3);

  // Simulated walk filters noisy step #5 cleanly and commits as gps-tracked
  const walk = generateSimulatedGpsWalk(16.4119, 120.5947, 1450, 12);
  let sim = createGpsTrailState({ maxAccuracyM: 25 });
  for (const fix of walk) {
    sim = processGpsBreadcrumbFix(sim, fix, 'singletrack', 'exposed-ridge');
  }
  assert.equal(sim.acceptedPoints.length, 11);
  assert.equal(sim.rejectedCount, 1);

  const committed = commitGpsTrackToGeometry(
    { version: 1, sourceKind: 'drawn', segments: [] },
    sim,
    true,
  );
  assert.equal(committed.sourceKind, 'gps-tracked');
  assert.equal(committed.segments[0].surfaceType, 'singletrack');
});

test('paintbrush Chaikin smoothing, eraser split, DEM elevation fill, and out-and-back mirror', async () => {
  const stroke = smoothPaintedStroke([
    { lat: 16.4119, lon: 120.5947 },
    { lat: 16.4125, lon: 120.5958 },
    { lat: 16.4132, lon: 120.5972 },
    { lat: 16.414, lon: 120.5985 },
  ], 10);
  assert.ok(stroke.length >= 4);

  const painted = appendPaintedStrokeToGeometry(
    { version: 1, sourceKind: 'drawn', segments: [] },
    stroke,
    { spacingM: 10, surfaceType: 'technical', terrainScenario: 'mud-hazard', replaceStarter: true },
  );
  assert.equal(painted.segments.length, 1);

  const demFilled = await sampleTerrainElevationForGeometry(painted);
  assert.ok(demFilled.filledCount > 0);
  assert.ok(demFilled.geometry.segments[0].points.every((p) => typeof p.ele === 'number'));

  const mirrored = mirrorOutAndBackRoute(demFilled.geometry);
  assert.equal(mirrored.segments.length, 2);

  // Erase middle vertex within 45 m of point 2 splits cleanly or trims
  const targetPt = painted.segments[0].points[2];
  const erased = erasePointsInRadius(painted, targetPt.lat, targetPt.lon, 45);
  assert.ok(erased.segments.length >= 1);
});

test('Strava analytics and RacePulsePH intelligence compute climbs, cutoff buffer, hydration, and bottlenecks', () => {
  assert.equal(isDemoSeedEnabled(), false);

  const gpx = fs.readFileSync('public/fixtures/baguio-cordillera-21k.gpx', 'utf8');
  const route = parseGpxRoute(gpx);
  const startPt = route.points[0];
  const midPt = route.points[Math.floor(route.points.length / 2)];
  const endPt = route.points[route.points.length - 1];

  const bundle = buildCourseAnalytics(
    route,
    [
      {
        id: 'm1',
        kind: 'start',
        name: 'Start',
        description: '',
        latitude: startPt.latitude,
        longitude: startPt.longitude,
        chainageM: 0,
        segmentIndex: 0,
        pointIndex: 0,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        services: ['Water'],
        photos: [],
        visibility: 'public',
      },
      {
        id: 'm2',
        kind: 'timing',
        name: 'Turnaround',
        description: '',
        latitude: midPt.latitude,
        longitude: midPt.longitude,
        chainageM: midPt.chainageM,
        segmentIndex: midPt.segmentIndex,
        pointIndex: midPt.pointIndex,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        cutoffMinutes: 70,
        services: ['Water', 'Timing mat'],
        photos: [],
        visibility: 'public',
      },
      {
        id: 'm3',
        kind: 'finish',
        name: 'Finish',
        description: '',
        latitude: endPt.latitude,
        longitude: endPt.longitude,
        chainageM: endPt.chainageM,
        segmentIndex: endPt.segmentIndex,
        pointIndex: endPt.pointIndex,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        cutoffMinutes: 240,
        services: ['Water'],
        photos: [],
        visibility: 'public',
      },
    ],
    { targetFlatPaceMinPerKm: 8.5, race: DEMO_BAGUIO_RACE },
  );

  assert.ok(bundle.surfaceBreakdown.length > 0);
  assert.ok(bundle.gradientBreakdown.length > 0);
  assert.ok(bundle.gapSplits.length >= 2);
  assert.ok(bundle.hydrationPlan.length >= 1);
  assert.ok(bundle.gear.lugDepthMm.length > 0);
  assert.ok(bundle.estimatedFinishMinutes > 120);
});

test('forgiving eraser subdivides 3-point starter route without error and clears canvas cleanly', () => {
  const starter = {
    version: 1 as const,
    sourceKind: 'drawn' as const,
    segments: [
      {
        id: 'drawn_1',
        name: 'Starter',
        sourceKind: 'drawn' as const,
        points: [
          { lat: 16.4119, lon: 120.5947 },
          { lat: 16.4136, lon: 120.5988 },
          { lat: 16.4121, lon: 120.6022 },
        ],
      },
    ],
  };

  // Erasing middle vertex must subdivide long edges and preserve surviving segments
  const erasedMid = erasePointsInRadius(starter, 16.4136, 120.5988, 50);
  assert.equal(erasedMid.segments.length, 2);
  assert.ok(!erasedMid.isCanvasCleared);

  // Explicit clearRouteCanvas returns clean 0.00 km cleared state and removes the start dot
  const cleared = clearRouteCanvas(starter);
  assert.equal(cleared.isCanvasCleared, true);
  assert.equal(cleared.isStartPointRemoved, true);
  const processedCleared = processCanonicalGeometry(cleared);
  assert.equal(processedCleared.distanceM, 0);
  assert.equal(processedCleared.displaySegments.length, 0);
  assert.equal(processedCleared.canonicalGeometry.isStartPointRemoved, true);

  // Placing a start point on a cleared canvas restores the dot at the new coordinate
  const placedOnCleared = relocateStartPointInGeometry(cleared, 10.3157, 123.8854, processedCleared);
  assert.equal(placedOnCleared.mode, 'placed-cleared');
  assert.equal(placedOnCleared.geometry.isCanvasCleared, true);
  assert.ok(!placedOnCleared.geometry.isStartPointRemoved);
  assert.equal(placedOnCleared.geometry.segments[0].points[0].lat, 10.3157);
  assert.equal(placedOnCleared.geometry.segments[0].points[0].lon, 123.8854);

  // Removing the start dot marks isStartPointRemoved without deleting custom route segments
  const removedOnRoute = removeStartPointFromGeometry(starter);
  assert.equal(removedOnRoute.isStartPointRemoved, true);
  assert.equal(removedOnRoute.segments.length, 1);

  // Moving the unmodified starter dot far away replaces the starter placeholder cleanly
  const movedStarterFar = relocateStartPointInGeometry(starter, 10.3157, 123.8854);
  assert.equal(movedStarterFar.mode, 'replaced-starter');
  assert.equal(movedStarterFar.geometry.isCanvasCleared, true);
  assert.ok(!movedStarterFar.geometry.isStartPointRemoved);

  // Moving a custom route start locally updates the start coordinate; moving > 2 km requests confirm
  const customDrawn = {
    version: 1 as const,
    sourceKind: 'drawn' as const,
    segments: [
      {
        id: 'painted_custom',
        name: 'Custom trail',
        sourceKind: 'drawn' as const,
        points: [
          { lat: 16.4119, lon: 120.5947 },
          { lat: 16.4136, lon: 120.5988 },
          { lat: 16.4150, lon: 120.6010 },
        ],
      },
    ],
  };
  const nudgedStart = relocateStartPointInGeometry(customDrawn, 16.4125, 120.5955);
  assert.equal(nudgedStart.mode, 'updated-start');
  assert.equal(nudgedStart.geometry.segments[0].points[0].lat, 16.4125);
  const distantConfirm = relocateStartPointInGeometry(customDrawn, 10.3157, 123.8854);
  assert.equal(distantConfirm.mode, 'needs-reset-confirm');

  // Painting after clearing clears isCanvasCleared and creates valid distance
  const repainted = appendPaintedStrokeToGeometry(cleared, [
    { lat: 16.4119, lon: 120.5947 },
    { lat: 16.4129, lon: 120.5967 },
    { lat: 16.4139, lon: 120.5987 },
  ]);
  assert.ok(!repainted.isCanvasCleared);
  assert.ok(!repainted.isStartPointRemoved);
  const processedRepainted = processCanonicalGeometry(repainted);
  assert.ok(processedRepainted.distanceM > 200);
});

test('Phase 1-4: Philippine archipelago clipping, GLO-30 Terrarium, Cebu & Bukidnon pilots, zero-request telemetry, and auto-prepared province rollout', () => {
  // Phase 1: Clipping to Luzon, Visayas (Cebu), and Mindanao (Bukidnon) vs open Pacific Ocean
  assert.equal(isPointInPhilippineIslands(16.41, 120.60), true); // Baguio / Luzon
  assert.equal(isPointInPhilippineIslands(10.41, 123.84), true); // Cebu / Visayas
  assert.equal(isPointInPhilippineIslands(8.18, 124.98), true);  // Bukidnon / Mindanao
  assert.equal(isPointInPhilippineIslands(14.0, 129.0), false);  // Philippine Sea outside bounds
  assert.equal(isPointInPhilippineIslands(7.5, 118.0), false);   // Sulu Sea open ocean

  // Terrarium RGB round-trip accuracy for GLO-30 elevations
  for (const testEle of [0, 420.5, 1003.25, 1890.75, 2954]) {
    const [r, g, b] = encodeTerrariumRgb(testEle);
    const decoded = decodeTerrariumRgb(r, g, b);
    assert.ok(Math.abs(decoded - testEle) < 0.01, `Terrarium round-trip drift for ${testEle}`);
  }

  // Synthesize clipped Sentinel-2 imagery and GLO-30 elevation tiles across Luzon/Visayas/Mindanao
  const s2Tile = synthesizePhilippineTileRgba('sentinel2', 8, 216, 120);
  const demTile = synthesizePhilippineTileRgba('glo30', 8, 216, 120);
  assert.equal(s2Tile.rgba.length, 128 * 128 * 4);
  assert.equal(demTile.rgba.length, 128 * 128 * 4);
  assert.ok(s2Tile.landPixels > 0);

  // Phase 2: Parse & seed real Cebu (21K) and Bukidnon (32K) GPX fixtures
  const cebuGpx = fs.readFileSync('public/fixtures/cebu-highlands-21k.gpx', 'utf8');
  const bukGpx = fs.readFileSync('public/fixtures/bukidnon-kitanglad-32k.gpx', 'utf8');
  const cebuRoute = parseGpxRoute(cebuGpx);
  const bukRoute = parseGpxRoute(bukGpx);
  assert.equal(cebuRoute.canonicalSegments.length, 2);
  assert.equal(bukRoute.canonicalSegments.length, 2);
  assert.ok(cebuRoute.distanceKm > 20 && cebuRoute.distanceKm < 23);
  assert.ok(bukRoute.distanceKm > 30 && bukRoute.distanceKm < 34);

  seedPilotCoursesFromGpxText(cebuGpx, bukGpx);
  const storeAfterSeed = getRouteStoreSnapshot();
  const cebuPub = storeAfterSeed.publications['pub_cebu_highlands_21k_v1'];
  const bukPub = storeAfterSeed.publications['pub_bukidnon_kitanglad_32k_v1'];
  assert.ok(cebuPub?.mapLayerProvenance);
  assert.ok(bukPub?.mapLayerProvenance);
  assert.equal(cebuPub.mapLayerProvenance.islandGroup, 'Visayas');
  assert.equal(cebuPub.mapLayerProvenance.province, 'Cebu');
  assert.equal(cebuPub.mapLayerProvenance.imageryDate, '2026-11-08');
  assert.equal(cebuPub.mapLayerProvenance.terrainRelease, COPERNICUS_TERRAIN_RELEASE);
  assert.equal(cebuPub.mapLayerProvenance.cloudMaskCheck.clearCoverageAfterFillPct, 100);
  assert.equal(cebuPub.mapLayerProvenance.validation.passed, true);

  assert.equal(bukPub.mapLayerProvenance.islandGroup, 'Mindanao');
  assert.equal(bukPub.mapLayerProvenance.province, 'Bukidnon');
  assert.equal(bukPub.mapLayerProvenance.imageryDate, '2026-11-05');
  assert.equal(bukPub.mapLayerProvenance.cloudMaskCheck.patchedFromMosaicQuarter, '2026-Q3');
  assert.equal(bukPub.mapLayerProvenance.cloudMaskCheck.clearCoverageAfterFillPct, 100);
  assert.equal(bukPub.mapLayerProvenance.validation.passed, true);

  // Phase 3: Zero imagery & DEM requests on initial race summary / 2D load + rollout benchmarks
  resetTileTelemetry();
  const telemetry = getTileTelemetrySnapshot();
  assert.equal(telemetry.imageryRequestsCount, 0);
  assert.equal(telemetry.demRequestsCount, 0);
  assert.equal(telemetry.imageryBytesTransferred, 0);
  const benchmarks = getRolloutBudgetBenchmarks(telemetry);
  assert.equal(benchmarks.length, 3);
  assert.ok(benchmarks.some((b) => b.id === `${PILOT_CEBU_RACE.id}_21k`));
  assert.ok(benchmarks.some((b) => b.id === `${PILOT_BUKIDNON_RACE.id}_32k`));

  // Phase 4: Brand-new race added in Albay / Mt. Mayon (Luzon) gets identical map pipeline without code changes
  const mayonGpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="13.210" lon="123.690"><ele>180</ele></trkpt><trkpt lat="13.245" lon="123.688"><ele>740</ele></trkpt><trkpt lat="13.210" lon="123.690"><ele>180</ele></trkpt></trkseg></trk></gpx>`;
  const mayonRoute = parseGpxRoute(mayonGpx);
  const { preset, draft } = createPresetDraftCommand({
    actorUid: 'org_albay',
    actorName: 'Albay Organizer',
    title: 'Mayon Skyline 15K',
    region: 'Albay / Bicol',
    activity: 'trail',
    geometry: mayonRoute.canonicalGeometry,
    markers: [
      {
        id: 'ms_albay',
        kind: 'start',
        name: 'Start',
        description: '',
        latitude: 13.21,
        longitude: 123.69,
        chainageM: 0,
        segmentIndex: 0,
        pointIndex: 0,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        services: [],
        photos: [],
        visibility: 'public',
      },
      {
        id: 'mf_albay',
        kind: 'finish',
        name: 'Finish',
        description: '',
        latitude: 13.21,
        longitude: 123.69,
        chainageM: mayonRoute.distanceM,
        segmentIndex: 0,
        pointIndex: 2,
        passNumber: 1,
        offsetMeters: 0,
        needsReview: false,
        offCourseBlocked: false,
        offCourseConfirmed: false,
        services: [],
        photos: [],
        visibility: 'public',
      },
    ],
  });
  assert.equal(draft.mapLayerProvenance?.islandGroup, 'Luzon');
  assert.equal(draft.mapLayerProvenance?.province, 'Albay · Bicol');
  const ver = createPresetVersionCommand({
    actorUid: 'org_albay',
    actorName: 'Albay Organizer',
    presetId: preset.id,
    draftId: draft.id,
    expectedRevision: draft.revision,
  });
  const albayRace = {
    ...PILOT_CEBU_RACE,
    id: 'mayon-skyline-2026',
    name: 'Mayon Skyline Run',
    checkpoints: [],
    distances: [{ id: '15k', km: 15, label: '15K', price: 1100 }],
  };
  const pubAlbay = bindAndPublishRaceRouteCommand({
    actorUid: 'org_albay',
    actorName: 'Albay Organizer',
    race: albayRace,
    distanceId: '15k',
    presetId: preset.id,
    versionId: ver.id,
  });
  assert.equal(pubAlbay.publication.mapLayerProvenance?.validation.passed, true);
  assert.equal(pubAlbay.catalogEntry.mapLayerProvenance?.province, 'Albay · Bicol');

  // Weekly clear imagery check and quarterly national mosaic refresh validate before updating
  const weekly = runWeeklyClearImageryCheckCommand({
    actorUid: 'cron_geo',
    actorName: 'Geo Pipeline',
    newSceneDate: '2026-11-16',
  });
  assert.ok(weekly.updatedCount >= 3);
  assert.equal(weekly.skippedCount, 0);

  const quarterly = runQuarterlyNationalMosaicRefreshCommand({
    actorUid: 'cron_geo',
    actorName: 'Geo Pipeline',
    quarterlyMosaicPeriod: '2026-Q4',
  });
  assert.ok(quarterly.updatedCount >= 3);
  assert.equal(
    getRouteStoreSnapshot().publications[pubAlbay.publication.id].mapLayerProvenance?.cloudMaskCheck.patchedFromMosaicQuarter,
    '2026-Q4',
  );

  // Verify direct manifest preparation rejects out-of-Philippines bounds
  const outsideManifest = prepareCourseMapLayerManifest({
    version: 1,
    sourceKind: 'drawn',
    segments: [{ id: 's1', sourceKind: 'drawn', points: [{ lat: 35.67, lon: 139.65 }, { lat: 35.68, lon: 139.66 }] }],
  });
  assert.equal(outsideManifest.validation.passed, false);
  assert.equal(outsideManifest.validation.withinPhilippineBounds, false);
});

test('supports road, off-road dirt, grass, rocky surface analytics and per-race published course lookup', () => {
  assert.match(SURFACE_LABELS.paved, /Road/i);
  assert.match(SURFACE_LABELS.dirt, /Dirt/i);
  assert.match(SURFACE_LABELS.grass, /Grass/i);
  assert.match(SURFACE_LABELS.technical, /Rocky/i);

  const mixedGeom = {
    version: 1 as const,
    sourceKind: 'drawn' as const,
    segments: [
      {
        id: 'seg_mixed_ground',
        name: 'Mixed Event Course',
        sourceKind: 'drawn' as const,
        points: [
          { lat: 16.410, lon: 120.595, ele: 1450, surfaceType: 'paved' as const },
          { lat: 16.414, lon: 120.599, ele: 1475, surfaceType: 'paved' as const },
          { lat: 16.418, lon: 120.603, ele: 1510, surfaceType: 'dirt' as const },
          { lat: 16.422, lon: 120.607, ele: 1545, surfaceType: 'grass' as const },
          { lat: 16.426, lon: 120.611, ele: 1580, surfaceType: 'technical' as const },
        ],
      },
    ],
  };

  const processed = processCanonicalGeometry(mixedGeom);
  const analytics = buildCourseAnalytics(processed, []);
  const surfaces = analytics.surfaceBreakdown.map((item) => item.surface);
  assert.ok(surfaces.includes('paved'));
  assert.ok(surfaces.includes('dirt'));
  assert.ok(surfaces.includes('grass'));
  assert.ok(surfaces.includes('technical'));
  assert.ok(analytics.gear.shoeCategory.length > 0);

  const cebuPublished = getPublishedCoursesForRace(PILOT_CEBU_RACE.id);
  assert.equal(cebuPublished.length, 1);
  assert.equal(cebuPublished[0].distanceId, '21k');
});

test('15. Runner geolocation projection computes on-route status, off-course offset and next trailmark', () => {
  const courseGeom = {
    version: 1 as const,
    sourceKind: 'gpx' as const,
    segments: [
      {
        id: 'seg_geo',
        name: 'Geo Test Trail',
        sourceKind: 'gpx' as const,
        points: [
          { lat: 10.320, lon: 123.900, ele: 120 },
          { lat: 10.325, lon: 123.900, ele: 180 },
          { lat: 10.330, lon: 123.900, ele: 240 },
          { lat: 10.335, lon: 123.900, ele: 310 },
        ],
      },
    ],
  };
  const route = processCanonicalGeometry(courseGeom);
  const startAidLoc = locateAtChainage(route, 400, 1);
  const peakLoc = locateAtChainage(route, 1300, 1);

  const markers = [
    {
      id: 'm_aid_1',
      kind: 'water' as const,
      name: 'First Water Stop',
      description: 'Hydration',
      latitude: startAidLoc.latitude,
      longitude: startAidLoc.longitude,
      chainageM: startAidLoc.chainageM,
      segmentIndex: startAidLoc.segmentIndex,
      pointIndex: startAidLoc.pointIndex,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: ['Water'],
      photos: [],
      visibility: 'public' as const,
    },
    {
      id: 'm_peak_2',
      kind: 'landmark' as const,
      name: 'Ridge Overlook',
      description: 'Summit landmark',
      latitude: peakLoc.latitude,
      longitude: peakLoc.longitude,
      chainageM: peakLoc.chainageM,
      segmentIndex: peakLoc.segmentIndex,
      pointIndex: peakLoc.pointIndex,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: [],
      photos: [],
      visibility: 'public' as const,
    },
  ];

  const onRouteSpot = locateAtChainage(route, 650, 1);
  const nearProj = computeRunnerLocationRelativeToRoute(
    route,
    onRouteSpot.latitude + 0.0001,
    onRouteSpot.longitude,
    markers,
    1,
  );
  assert.ok(nearProj);
  assert.equal(nearProj.onCourse, true);
  assert.ok(nearProj.offRouteMeters <= 30);
  assert.equal(nearProj.nearestMarker?.id, 'm_aid_1');
  assert.equal(nearProj.nextMarker?.id, 'm_peak_2');
  assert.ok((nearProj.nextMarkerDistanceAlongM ?? 0) > 500);
  assert.ok(nearProj.distanceRemainingM < route.distanceM);

  const farProj = computeRunnerLocationRelativeToRoute(
    route,
    onRouteSpot.latitude,
    onRouteSpot.longitude + 0.006,
    markers,
    1,
  );
  assert.ok(farProj);
  assert.equal(farProj.onCourse, false);
  assert.ok(farProj.offRouteMeters > 400);

  assert.equal(
    computeRunnerLocationRelativeToRoute(route, Number.NaN, 123.9, markers),
    null,
  );

  const sampleCourses = [
    { distanceId: '10k', distanceLabel: '10K', advertisedKm: 10 },
    { distanceId: '21k', distanceLabel: '21K', advertisedKm: 21 },
  ];
  assert.equal(selectPublishedCourseForDistance(sampleCourses, '21 km')?.distanceId, '21k');
  assert.equal(selectPublishedCourseForDistance(sampleCourses, '10k')?.distanceId, '10k');
  assert.equal(selectPublishedCourseForDistance(sampleCourses, '42k')?.distanceId, '10k');
  assert.equal(selectPublishedCourseForDistance([], '21k'), null);
});

test('16. Philippines tile bounds gate and world mask GeoJSON block foreign landmasses', () => {
  // Manila, Cebu, and Davao tiles pass at z12
  assert.equal(isTileInPhilippines(12, 3421, 1879), true); // Metro Manila region
  assert.equal(isTileInPhilippines(12, 3457, 1933), true); // Cebu highlands
  assert.equal(isTileInPhilippines(12, 3472, 1957), true); // Bukidnon / Davao

  // Out-of-country locations must be blocked (Tokyo, Taipei, Singapore/Borneo)
  assert.equal(isTileInPhilippines(12, 3636, 1612), false); // Tokyo
  assert.equal(isTileInPhilippines(12, 3428, 1756), false); // Taipei
  assert.equal(isTileInPhilippines(12, 3230, 2033), false); // Singapore

  const mask = buildPhilippinesWorldMaskGeoJson();
  assert.equal(mask.features.length, 1);
  assert.equal(mask.features[0].geometry.type, 'Polygon');
  assert.equal(mask.features[0].geometry.coordinates.length, 2);
});

test('17. Pilot Cebu 21K & Bukidnon 32K Finish markers anchor to end of course instead of 0.00 km', () => {
  const cebuGpx = fs.readFileSync('public/fixtures/cebu-highlands-21k.gpx', 'utf8');
  const bukGpx = fs.readFileSync('public/fixtures/bukidnon-kitanglad-32k.gpx', 'utf8');
  seedPilotCoursesFromGpxText(cebuGpx, bukGpx);

  const store = getRouteStoreSnapshot();
  const cebuPub = store.publications['pub_cebu_highlands_21k_v1'];
  const bukPub = store.publications['pub_bukidnon_kitanglad_32k_v1'];
  assert.ok(cebuPub);
  assert.ok(bukPub);

  const cebuStart = cebuPub.markers.find((m) => m.kind === 'start');
  const cebuFinish = cebuPub.markers.find((m) => m.kind === 'finish');
  assert.ok(cebuStart && cebuFinish);
  assert.equal(cebuStart.chainageM, 0);
  assert.ok(cebuFinish.chainageM > 20_000, `Expected Cebu Finish > 20km, got ${cebuFinish.chainageM}`);

  const bukFinish = bukPub.markers.find((m) => m.kind === 'finish');
  assert.ok(bukFinish);
  assert.ok(bukFinish.chainageM > 30_000, `Expected Bukidnon Finish > 30km, got ${bukFinish.chainageM}`);
});

test('18. GPS filter rejects noise spikes/teleports, smooths accurate track, and disambiguates out-and-back passes', () => {
  let state = createGpsFilterState({ maxAccuracyM: 35, initialCoarseLimitM: 100 });
  const t0 = 1_760_000_000_000;

  // Initial coarse 180m reading must be rejected
  state = ingestGpsFix(state, { lat: 10.32, lon: 123.9, accuracyM: 180, timestampMs: t0 });
  assert.equal(state.current, null);
  assert.equal(state.rejectedCount, 1);

  // Accurate 8m reading locks cleanly
  state = ingestGpsFix(state, { lat: 10.32, lon: 123.9, accuracyM: 8, timestampMs: t0 + 1000 });
  assert.ok(state.current);
  assert.equal(state.current.quality, 'high');

  // Sudden 180m noise spike jumps far away and must be rejected without corrupting smoothed fix
  state = ingestGpsFix(state, { lat: 10.39, lon: 123.98, accuracyM: 180, timestampMs: t0 + 2000 });
  assert.equal(state.rejectedCount, 2);
  assert.ok(Math.abs((state.current?.lat ?? 0) - 10.32) < 0.001);

  // Single-fix teleport (>15 m/s) is held back as pendingJump
  state = ingestGpsFix(state, { lat: 10.36, lon: 123.94, accuracyM: 8, timestampMs: t0 + 3000 });
  assert.ok(state.pendingJump !== null);
  assert.ok(Math.abs((state.current?.lat ?? 0) - 10.32) < 0.001);

  // Normal ~10m step after 3s is smoothed and computes bearing
  state = ingestGpsFix(state, { lat: 10.3201, lon: 123.9, accuracyM: 8, timestampMs: t0 + 6000 });
  assert.ok(state.current);
  assert.ok(state.current.headingDeg !== null);

  const circle = buildGpsAccuracyCircleGeoJson(state.current.lat, state.current.lon, 18);
  assert.equal(circle.features.length, 1);
  assert.equal(circle.features[0].geometry.type, 'Polygon');

  // Out-and-back pass disambiguation chooses pass 2 when previousChainageM is near return leg
  const oabGeom = {
    version: 1 as const,
    sourceKind: 'drawn' as const,
    segments: [
      {
        id: 'seg_oab',
        sourceKind: 'drawn' as const,
        points: [
          { lat: 10.32, lon: 123.9, ele: 100 },
          { lat: 10.33, lon: 123.9, ele: 200 },
          { lat: 10.32, lon: 123.9, ele: 100 },
        ],
      },
    ],
  };
  const oabRoute = processCanonicalGeometry(oabGeom);
  const midSpot = locateAtChainage(oabRoute, 600, 1);
  const pass2Proj = computeRunnerLocationRelativeToRoute(
    oabRoute,
    midSpot.latitude,
    midSpot.longitude,
    [],
    2,
    { accuracyM: 12, previousChainageM: oabRoute.distanceM - 620 },
  );
  assert.ok(pass2Proj);
  assert.equal(pass2Proj.passNumber, 2);
  assert.ok(pass2Proj.chainageM > oabRoute.distanceM / 2);
});

test('19. Empty default route geometry processes safely, validates unready for publish, and stripDemoArtifacts purges unmodified Baguio starter presets', () => {
  const empty = createEmptyRouteGeometry();
  assert.equal(empty.isCanvasCleared, true);
  assert.equal(empty.isStartPointRemoved, true);
  assert.equal(empty.segments.length, 0);

  const processed = processCanonicalGeometry(empty);
  assert.equal(processed.distanceM, 0);
  assert.equal(processed.distanceKm, 0);
  assert.equal(processed.points.length, 0);
  assert.equal(processed.canonicalSegments.length, 0);
  assert.equal(processed.displaySegments.length, 0);
  assert.deepEqual(processed.bounds, PHILIPPINES_NATIONAL_BOUNDS);
  assert.equal(processed.elevationProvenance.status, 'unavailable');
  assert.equal(processed.validationReport.pointCount, 0);
  assert.equal(processed.validationReport.valid, false);

  const loc = locateAtChainage(processed, 0, 1);
  assert.equal(loc.chainageM, 0);
  assert.ok(Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude));

  const proj = projectCoordinateToRoute(processed, 14.5995, 120.9842);
  assert.equal(proj.hasAmbiguousPasses, false);
  assert.equal(proj.best.offsetMeters, 0);

  assert.deepEqual(reanchorMarkersForRoute(processed, []), []);
  assert.deepEqual(deriveDefaultChapters(processed, []), []);

  const analytics = buildCourseAnalytics(processed, []);
  assert.equal(analytics.climbs.length, 0);
  assert.equal(analytics.gapSplits.length, 0);

  const manifest = prepareCourseMapLayerManifest(empty, { courseId: 'empty_test' });
  assert.equal(manifest.validation.passed, false);
  assert.equal(manifest.validation.courseDetailTileCount, 0);

  const readiness = validatePublicationReadiness({
    title: 'Draft Without Path',
    geometry: empty,
    markers: [],
  });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some((i) => i.code === 'empty-geometry' && i.severity === 'error'));

  const dirtyStore = {
    presets: {
      preset_baguio_21k: {
        id: 'preset_baguio_21k',
        title: 'Demo Baguio',
        region: 'Cordillera',
        activity: 'trail' as const,
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '21k',
        ownerUid: 'demo',
        editorIds: [],
        archived: false,
        latestDraftId: 'draft_main',
        latestVersionNumber: 1,
        revision: 1,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        updatedBy: 'demo',
      },
      preset_legacy_starter: {
        id: 'preset_legacy_starter',
        title: 'My Race (21K)',
        region: 'Philippines',
        activity: 'trail' as const,
        raceId: 'real-race-1',
        distanceId: '21k',
        ownerUid: 'org-1',
        editorIds: [],
        archived: false,
        latestDraftId: 'draft_main',
        latestVersionNumber: 0,
        revision: 1,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        updatedBy: 'org-1',
      },
      preset_real_custom: {
        id: 'preset_real_custom',
        title: 'Custom Real Course',
        region: 'Cebu',
        activity: 'trail' as const,
        raceId: 'real-race-1',
        distanceId: '21k',
        ownerUid: 'org-1',
        editorIds: [],
        archived: false,
        latestDraftId: 'draft_main',
        latestVersionNumber: 0,
        revision: 2,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
        updatedBy: 'org-1',
      },
    },
    drafts: {
      'preset_legacy_starter::draft_main': {
        id: 'draft_main',
        presetId: 'preset_legacy_starter',
        raceId: 'real-race-1',
        distanceId: '21k',
        title: 'My Race (21K)',
        region: 'Philippines',
        revision: 1,
        processingState: 'ready' as const,
        selectedTrackIndices: [0],
        canonicalGeometry: {
          version: 1 as const,
          sourceKind: 'drawn' as const,
          segments: [
            {
              id: 'drawn_1',
              name: 'Drawn course section',
              sourceKind: 'drawn' as const,
              points: [
                { lat: 16.4119, lon: 120.5947 },
                { lat: 16.4136, lon: 120.5988 },
                { lat: 16.4121, lon: 120.6022 },
              ],
            },
          ],
        },
        elevationProvenance: processed.elevationProvenance,
        validationReport: processed.validationReport,
        markers: [],
        distanceM: 800,
        elevationGainM: 0,
        elevationLossM: 0,
        editSummary: 'Created course preset',
        updatedAt: '2026-11-01T00:00:00Z',
        updatedBy: 'org-1',
      },
      'preset_real_custom::draft_main': {
        id: 'draft_main',
        presetId: 'preset_real_custom',
        raceId: 'real-race-1',
        distanceId: '21k',
        title: 'Custom Real Course',
        region: 'Cebu',
        revision: 2,
        processingState: 'ready' as const,
        selectedTrackIndices: [0],
        canonicalGeometry: {
          version: 1 as const,
          sourceKind: 'drawn' as const,
          segments: [
            {
              id: 'painted_1',
              sourceKind: 'drawn' as const,
              points: [
                { lat: 10.3157, lon: 123.8854, ele: 50 },
                { lat: 10.3201, lon: 123.8902, ele: 120 },
              ],
            },
          ],
        },
        elevationProvenance: processed.elevationProvenance,
        validationReport: processed.validationReport,
        markers: [],
        distanceM: 710,
        elevationGainM: 70,
        elevationLossM: 0,
        editSummary: 'Custom trail',
        updatedAt: '2026-11-01T00:00:00Z',
        updatedBy: 'org-1',
      },
    },
    versions: {},
    bindings: {},
    publications: {
      pub_cebu_highlands_21k_v1: {} as never,
    },
    catalog: {
      'cebu-highlands-trail-2026_21k': {} as never,
    },
    audit: [{ id: 'audit_seed_baguio_v1', action: 'publish' as const, actorUid: 'demo', actorName: 'Demo', at: '2026-11-01T00:00:00Z' }],
    migratedLegacyKeys: {},
  };

  const cleaned = stripDemoArtifacts(dirtyStore);
  assert.equal(cleaned.presets['preset_baguio_21k'], undefined);
  assert.equal(cleaned.presets['preset_legacy_starter'], undefined);
  assert.equal(cleaned.drafts['preset_legacy_starter::draft_main'], undefined);
  assert.equal(cleaned.publications['pub_cebu_highlands_21k_v1'], undefined);
  assert.equal(cleaned.catalog['cebu-highlands-trail-2026_21k'], undefined);
  assert.ok(cleaned.presets['preset_real_custom']);
  assert.ok(cleaned.drafts['preset_real_custom::draft_main']);
});

test('20. Preset configuration status identifies Active, Active on other distance, Withdrawn, Draft, and Archived and sorts Active first', () => {
  const empty = createEmptyRouteGeometry();
  const emptyProcessed = processCanonicalGeometry(empty);
  const sampleGeom = {
    version: 1 as const,
    sourceKind: 'drawn' as const,
    segments: [
      {
        id: 'seg_1',
        sourceKind: 'drawn' as const,
        points: [
          { lat: 10.3157, lon: 123.8854, ele: 40 },
          { lat: 10.3205, lon: 123.8902, ele: 85 },
        ],
      },
    ],
  };

  const presetActive10k = {
    id: 'preset_active_10k',
    title: 'Persevere Main 10K',
    region: 'Cebu',
    activity: 'road' as const,
    raceId: 'persevere-2026',
    distanceId: '10k',
    ownerUid: 'org-1',
    editorIds: [],
    archived: false,
    latestDraftId: 'draft_main',
    latestVersionId: 'ver_10k_v2',
    latestVersionNumber: 2,
    revision: 3,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    updatedBy: 'org-1',
  };
  const presetOther21k = {
    id: 'preset_other_21k',
    title: 'Persevere Half Marathon',
    region: 'Cebu',
    activity: 'road' as const,
    raceId: 'persevere-2026',
    distanceId: '21k',
    ownerUid: 'org-1',
    editorIds: [],
    archived: false,
    latestDraftId: 'draft_main',
    latestVersionId: 'ver_21k_v1',
    latestVersionNumber: 1,
    revision: 2,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
    updatedBy: 'org-1',
  };
  const presetDraft10k = {
    id: 'preset_draft_10k',
    title: 'Persevere Alt 10K',
    region: 'Cebu',
    activity: 'road' as const,
    raceId: 'persevere-2026',
    distanceId: '10k',
    ownerUid: 'org-1',
    editorIds: [],
    archived: false,
    latestDraftId: 'draft_main',
    latestVersionNumber: 0,
    revision: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    updatedBy: 'org-1',
  };
  const presetArchivedNewest = {
    id: 'preset_archived',
    title: 'Persevere Old Route',
    region: 'Cebu',
    activity: 'road' as const,
    raceId: 'persevere-2026',
    distanceId: '10k',
    ownerUid: 'org-1',
    editorIds: [],
    archived: true,
    latestDraftId: 'draft_main',
    latestVersionNumber: 1,
    revision: 2,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    updatedBy: 'org-1',
  };
  const presetWithdrawn5k = {
    id: 'preset_withdrawn_5k',
    title: 'Persevere Pulled 5K',
    region: 'Cebu',
    activity: 'road' as const,
    raceId: 'persevere-2026',
    distanceId: '5k',
    ownerUid: 'org-1',
    editorIds: [],
    archived: false,
    latestDraftId: 'draft_main',
    latestVersionId: 'ver_5k_v1',
    latestVersionNumber: 1,
    revision: 2,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    updatedBy: 'org-1',
  };

  const store: RouteWorkspaceStore = {
    presets: {
      [presetArchivedNewest.id]: presetArchivedNewest,
      [presetDraft10k.id]: presetDraft10k,
      [presetOther21k.id]: presetOther21k,
      [presetActive10k.id]: presetActive10k,
      [presetWithdrawn5k.id]: presetWithdrawn5k,
    },
    drafts: {
      [`${presetDraft10k.id}::draft_main`]: {
        id: 'draft_main',
        presetId: presetDraft10k.id,
        raceId: 'persevere-2026',
        distanceId: '10k',
        title: presetDraft10k.title,
        region: 'Cebu',
        revision: 1,
        processingState: 'ready',
        selectedTrackIndices: [0],
        canonicalGeometry: sampleGeom,
        elevationProvenance: emptyProcessed.elevationProvenance,
        validationReport: emptyProcessed.validationReport,
        markers: [],
        distanceM: 880,
        elevationGainM: 45,
        elevationLossM: 0,
        editSummary: 'Draft alignment',
        updatedAt: '2026-09-04T00:00:00Z',
        updatedBy: 'org-1',
      },
    },
    versions: {},
    bindings: {
      'persevere-2026_10k': {
        id: 'persevere-2026_10k',
        raceId: 'persevere-2026',
        distanceId: '10k',
        distanceLabel: '10K',
        advertisedKm: 10,
        presetId: presetActive10k.id,
        versionId: 'ver_10k_v1',
        versionNumber: 1,
        currentPublicationId: 'pub_10k_v1',
        bindingRevision: 1,
        checkpointLinks: {},
        updatedAt: '2026-09-02T00:00:00Z',
        updatedBy: 'org-1',
      },
      'persevere-2026_21k': {
        id: 'persevere-2026_21k',
        raceId: 'persevere-2026',
        distanceId: '21k',
        distanceLabel: '21K',
        advertisedKm: 21,
        presetId: presetOther21k.id,
        versionId: 'ver_21k_v1',
        versionNumber: 1,
        currentPublicationId: 'pub_21k_v1',
        bindingRevision: 1,
        checkpointLinks: {},
        updatedAt: '2026-09-03T00:00:00Z',
        updatedBy: 'org-1',
      },
      'persevere-2026_5k': {
        id: 'persevere-2026_5k',
        raceId: 'persevere-2026',
        distanceId: '5k',
        distanceLabel: '5K',
        advertisedKm: 5,
        presetId: presetWithdrawn5k.id,
        versionId: 'ver_5k_v1',
        versionNumber: 1,
        currentPublicationId: 'pub_5k_v1',
        bindingRevision: 2,
        checkpointLinks: {},
        updatedAt: '2026-09-05T00:00:00Z',
        updatedBy: 'org-1',
      },
    },
    publications: {
      pub_10k_v1: {
        id: 'pub_10k_v1',
        raceId: 'persevere-2026',
        raceName: 'PERSEVERE RUN 2026',
        raceDate: '2026-09-19',
        distanceId: '10k',
        distanceLabel: '10K',
        advertisedKm: 10,
        measuredDistanceM: 10040,
        elevationGainM: 120,
        elevationLossM: 118,
        presetId: presetActive10k.id,
        versionId: 'ver_10k_v1',
        versionNumber: 1,
        geometryHash: 'hash_10k',
        canonicalGeometry: sampleGeom,
        elevationProvenance: emptyProcessed.elevationProvenance,
        markers: [],
        chapters: [],
        status: 'published',
        publishedAt: '2026-09-02T00:00:00Z',
        publishedBy: 'org-1',
        reviewedAt: '2026-09-02T00:00:00Z',
      },
      pub_21k_v1: {
        id: 'pub_21k_v1',
        raceId: 'persevere-2026',
        raceName: 'PERSEVERE RUN 2026',
        raceDate: '2026-09-19',
        distanceId: '21k',
        distanceLabel: '21K',
        advertisedKm: 21,
        measuredDistanceM: 21100,
        elevationGainM: 250,
        elevationLossM: 248,
        presetId: presetOther21k.id,
        versionId: 'ver_21k_v1',
        versionNumber: 1,
        geometryHash: 'hash_21k',
        canonicalGeometry: sampleGeom,
        elevationProvenance: emptyProcessed.elevationProvenance,
        markers: [],
        chapters: [],
        status: 'published',
        publishedAt: '2026-09-03T00:00:00Z',
        publishedBy: 'org-1',
        reviewedAt: '2026-09-03T00:00:00Z',
      },
      pub_5k_v1: {
        id: 'pub_5k_v1',
        raceId: 'persevere-2026',
        raceName: 'PERSEVERE RUN 2026',
        raceDate: '2026-09-19',
        distanceId: '5k',
        distanceLabel: '5K',
        advertisedKm: 5,
        measuredDistanceM: 5000,
        elevationGainM: 40,
        elevationLossM: 40,
        presetId: presetWithdrawn5k.id,
        versionId: 'ver_5k_v1',
        versionNumber: 1,
        geometryHash: 'hash_5k',
        canonicalGeometry: sampleGeom,
        elevationProvenance: emptyProcessed.elevationProvenance,
        markers: [],
        chapters: [],
        status: 'withdrawn',
        publishedAt: '2026-09-04T00:00:00Z',
        publishedBy: 'org-1',
        reviewedAt: '2026-09-04T00:00:00Z',
        withdrawalReason: 'Road closure',
      },
    },
    catalog: {},
    audit: [],
    migratedLegacyKeys: {},
  };

  const activeStatus = describePresetConfigStatus(presetActive10k, store, 'persevere-2026', '10k');
  assert.equal(activeStatus.kind, 'active');
  assert.equal(activeStatus.sortRank, 0);
  assert.equal(activeStatus.badge, 'Active · v1');
  assert.equal(activeStatus.badgeTone, 'success');
  assert.equal(activeStatus.accentDot, '#10b981');
  assert.ok(activeStatus.sublabel.includes('Live on 10K'));
  assert.ok(activeStatus.sublabel.includes('v2 staged'));

  const otherStatus = describePresetConfigStatus(presetOther21k, store, 'persevere-2026', '10k');
  assert.equal(otherStatus.kind, 'active_other_distance');
  assert.equal(otherStatus.badge, 'Active (21K)');
  assert.equal(otherStatus.badgeTone, 'info');
  assert.ok(otherStatus.sublabel.includes('Live on 21K v1'));

  const draftStatus = describePresetConfigStatus(presetDraft10k, store, 'persevere-2026', '10k');
  assert.equal(draftStatus.kind, 'draft');
  assert.equal(draftStatus.badge, 'Draft');
  assert.equal(draftStatus.badgeTone, 'neutral');
  assert.ok(draftStatus.sublabel.includes('Not active'));
  assert.ok(draftStatus.sublabel.includes('0.88 km draft'));

  const archivedStatus = describePresetConfigStatus(presetArchivedNewest, store, 'persevere-2026', '10k');
  assert.equal(archivedStatus.kind, 'archived');
  assert.equal(archivedStatus.badge, 'Archived');
  assert.equal(archivedStatus.badgeTone, 'neutral');

  const withdrawnStatus = describePresetConfigStatus(presetWithdrawn5k, store, 'persevere-2026', '5k');
  assert.equal(withdrawnStatus.kind, 'withdrawn');
  assert.equal(withdrawnStatus.badge, 'Withdrawn');
  assert.equal(withdrawnStatus.badgeTone, 'warning');

  const sortedFor10k = sortRoutePresetsForDistance(
    [presetArchivedNewest, presetDraft10k, presetOther21k, presetActive10k],
    store,
    'persevere-2026',
    '10k',
  );
  assert.deepEqual(
    sortedFor10k.map((p) => p.id),
    [presetActive10k.id, presetOther21k.id, presetDraft10k.id, presetArchivedNewest.id],
  );
});

test('21. Route Studio GPS pinpointing tracks coarse quick-lock fixes, preserves live coordinates for camera centering, and gates trail recording', () => {
  let state = createGpsTrailState({ maxAccuracyM: 25 });
  const t0 = 1_760_000_000_000;

  // 1. Initial coarse quick-lock (e.g. WiFi / cellular triangulation ±65m before GNSS locks)
  // Must update lastFix for instant pinpointing and camera fly-to, while keeping acceptedPoints clean
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.4119,
    longitude: 120.5947,
    accuracyM: 65,
    timestamp: t0,
  });

  assert.ok(state.lastFix);
  assert.equal(state.lastFix.latitude, 16.4119);
  assert.equal(state.lastFix.longitude, 120.5947);
  assert.equal(state.lastFix.accuracyM, 65);
  assert.equal(state.acceptedPoints.length, 0); // Preserves strict trail accuracy
  assert.equal(state.rejectedCount, 1);

  // Deriving latestGpsFix in RouteStudioPanel uses lastFix to pinpoint on the map immediately
  const liveFix1 = state.lastFix ?? (state.acceptedPoints.length > 0 ? {
    latitude: state.acceptedPoints[state.acceptedPoints.length - 1].lat,
    longitude: state.acceptedPoints[state.acceptedPoints.length - 1].lon,
    accuracyM: state.acceptedPoints[state.acceptedPoints.length - 1].accuracyM,
  } : null);
  assert.ok(liveFix1);
  assert.equal(liveFix1.latitude, 16.4119);
  assert.equal(liveFix1.longitude, 120.5947);

  // 2. High-accuracy GNSS fix locks in (±6m)
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.4121,
    longitude: 120.5950,
    accuracyM: 6,
    altitude: 1455,
    timestamp: t0 + 2000,
  });

  assert.equal(state.acceptedPoints.length, 1);
  assert.equal(state.acceptedPoints[0].lat, 16.4121);
  assert.equal(state.acceptedPoints[0].lon, 120.5950);
  assert.equal(state.lastFix.accuracyM, 6);

  // 3. Second accurate fix builds the trail breadcrumb polyline
  state = processGpsBreadcrumbFix(state, {
    latitude: 16.4123,
    longitude: 120.5953,
    accuracyM: 5,
    altitude: 1458,
    timestamp: t0 + 6000,
  });

  assert.equal(state.acceptedPoints.length, 2);
  const liveFix2 = state.lastFix ?? null;
  assert.ok(liveFix2);
  assert.equal(liveFix2.latitude, 16.4123);
  assert.equal(liveFix2.longitude, 120.5953);
});

test('22. Route Studio GPS manual pinpoint and simulate walk on empty canvas generates valid fixes and centers map', () => {
  // 1. Manual pinpoint creates a valid fix and centers map
  let state = createGpsTrailState({ maxAccuracyM: 25 });
  const centerLat = 16.4121;
  const centerLon = 120.5950;

  const manualFix = {
    latitude: centerLat,
    longitude: centerLon,
    accuracyM: 10,
    timestamp: Date.now(),
  };

  state = processGpsBreadcrumbFix(state, manualFix, 'dirt', 'normal');
  assert.ok(state.lastFix);
  assert.equal(state.lastFix.latitude, centerLat);
  assert.equal(state.lastFix.longitude, centerLon);
  assert.equal(state.acceptedPoints.length, 1);
  assert.equal(state.acceptedPoints[0].lat, centerLat);
  assert.equal(state.acceptedPoints[0].lon, centerLon);

  // 2. Simulate walk from center creates a clean survey trail
  let simState = createGpsTrailState({ maxAccuracyM: 25 });
  const fixes = generateSimulatedGpsWalk(centerLat, centerLon, 1450, 12);
  assert.equal(fixes.length, 12);
  for (const fix of fixes) {
    simState = processGpsBreadcrumbFix(simState, fix, 'dirt', 'normal');
  }
  assert.equal(simState.acceptedPoints.length, 11); // 1 noisy step (step 5) rejected
  assert.equal(simState.rejectedCount, 1);
  assert.ok(simState.totalDistanceM > 50);
});

test('23. MAX_GPX_BYTES is 50 MB and parseGpxCourse rejects files exceeding the 50 MB limit', () => {
  assert.equal(MAX_GPX_BYTES, 50 * 1024 * 1024);
  const oversizedGpx = ' '.repeat(50 * 1024 * 1024 + 1);
  assert.throws(() => parseGpxRoute(oversizedGpx), /The GPX route file exceeds the 50 MB limit\./);
});
