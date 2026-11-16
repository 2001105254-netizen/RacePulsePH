import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  exportSanitizedGpx,
  geodesicDistanceM,
  parseGpxRoute,
  reverseCanonicalGeometry,
} from '../src/lib/gpxRoute';
import { processCanonicalGeometry } from '../src/lib/routes/geometry';
import { locateAtChainage, projectCoordinateToRoute, reanchorMarkersForRoute } from '../src/lib/routes/anchoring';
import {
  bindAndPublishRaceRouteCommand,
  createPresetDraftCommand,
  createPresetVersionCommand,
  DEMO_BAGUIO_RACE,
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
  validatePublicationReadiness,
  withdrawPublicationCommand,
} from '../src/lib/routes/routeStore';
import {
  COPERNICUS_TERRAIN_RELEASE,
  decodeTerrariumRgb,
  encodeTerrariumRgb,
  getRolloutBudgetBenchmarks,
  getTileTelemetrySnapshot,
  isPointInPhilippineIslands,
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
