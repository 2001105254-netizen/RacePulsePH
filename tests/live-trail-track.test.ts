import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StyleSpecification } from 'maplibre-gl';
import { expression as styleSpecExpression } from '@maplibre/maplibre-gl-style-spec';
import {
  enhanceBasemapStyleForOceanAndHybrid,
  guardNumericComparisonFilter,
} from '../src/lib/routes/mapProviders.ts';
import {
  buildLiveTrailGeoJson,
  buildLiveTrailSegments,
  shouldRefineInitialAnchorPoint,
} from '../src/lib/runs/liveTrailTrack.ts';
import { createActiveRunSession, ingestRunFix } from '../src/lib/runs/runRecorderEngine.ts';
import type { RecordedTrackPoint } from '../src/lib/runs/types.ts';

test('enhanceBasemapStyleForOceanAndHybrid hides 3D fill-extrusion building layers by default for flat 2D', () => {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: {} },
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        paint: { 'fill-extrusion-height': 15 },
      },
    ],
  };

  const enhanced = enhanceBasemapStyleForOceanAndHybrid(style, 'light');
  const extrusion = enhanced.layers.find((layer) => layer.id === 'building-3d') as
    | { layout?: Record<string, unknown> }
    | undefined;
  assert.equal(extrusion?.layout?.visibility, 'none');
});

test('buildLiveTrailSegments splits on segmentBreak and connects cleanly to live GPS position', () => {
  const points: RecordedTrackPoint[] = [
    { lat: 14.5500, lon: 121.0500, accuracyM: 5, timestampMs: 1000, speedMps: 0 },
    { lat: 14.5503, lon: 121.0500, accuracyM: 5, timestampMs: 11_000, speedMps: 3 },
    { lat: 14.5515, lon: 121.0510, accuracyM: 5, timestampMs: 60_000, speedMps: 0, segmentBreak: true },
    { lat: 14.5518, lon: 121.0510, accuracyM: 5, timestampMs: 70_000, speedMps: 3 },
  ];

  const segments = buildLiveTrailSegments(points, { lat: 14.55195, lon: 121.0510 });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[1].length, 3);
  assert.deepEqual(segments[1][2], [121.0510, 14.55195]);

  const geo = buildLiveTrailGeoJson(segments);
  assert.equal(geo.features.length, 2);
  assert.equal(geo.features[0].geometry.type, 'LineString');
  assert.deepEqual(geo.features[0].geometry.coordinates[0], [121.05, 14.55]);
});

test('buildLiveTrailSegments produces a live segment from first point to moving live position before 2nd point commits', () => {
  const points: RecordedTrackPoint[] = [
    { lat: 14.5500, lon: 121.0500, accuracyM: 5, timestampMs: 1000, speedMps: 0 },
  ];
  const segments = buildLiveTrailSegments(points, { lat: 14.55002, lon: 121.0500 });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, 2);
});

test('shouldRefineInitialAnchorPoint identifies opening coarse lock refined by sharp satellite fix', () => {
  const coarseAnchor: RecordedTrackPoint = {
    lat: 14.5500,
    lon: 121.0500,
    accuracyM: 80,
    timestampMs: 1_764_000_000_000,
    speedMps: 0,
  };

  assert.equal(
    shouldRefineInitialAnchorPoint(coarseAnchor, {
      accuracyM: 6,
      updatedAtMs: 1_764_000_003_000,
    }),
    true,
  );

  // Already sharp opening lock should never be replaced
  assert.equal(
    shouldRefineInitialAnchorPoint(
      { ...coarseAnchor, accuracyM: 8 },
      { accuracyM: 4, updatedAtMs: 1_764_000_003_000 },
    ),
    false,
  );

  // Too late (> 10s) should not retroactively move start point
  assert.equal(
    shouldRefineInitialAnchorPoint(coarseAnchor, {
      accuracyM: 6,
      updatedAtMs: 1_764_000_020_000,
    }),
    false,
  );
});

test('ingestRunFix refines an opening coarse anchor without inflating distance with a false jump', () => {
  const startMs = 1_764_000_000_000;
  let session = createActiveRunSession({
    sessionId: 'run-anchor-test',
    uid: 'runner-1',
    mode: 'free',
    startedAtMs: startMs,
  });

  // First fix: coarse cell/Wi-Fi lock 70m off
  session = ingestRunFix(session, {
    lat: 14.5500,
    lon: 121.0500,
    accuracyM: 80,
    timestampMs: startMs + 1000,
  });
  assert.equal(session.points.length, 1);
  assert.equal(session.distanceM, 0);

  // Second fix 2s later: sharp 6m GNSS lock at true runner position (~66m away)
  session = ingestRunFix(session, {
    lat: 14.5506,
    lon: 121.0500,
    accuracyM: 6,
    timestampMs: startMs + 3000,
  });

  assert.equal(session.points.length, 1, 'Sharp initial fix should replace opening coarse anchor');
  assert.equal(session.distanceM, 0, 'Coarse-to-sharp anchor refinement must not count fake jump distance');
  assert.ok(session.points[0].accuracyM <= 10);
});

test('enhanceBasemapStyleForOceanAndHybrid strips missing wood/circle images, hides US shields, and guards numeric filters', () => {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'landcover_wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-pattern': 'wood-pattern' },
      },
      {
        id: 'place_town',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: {
          'icon-image': ['step', ['zoom'], 'circle-11', 9, ''],
          'text-field': '{name}',
        },
      },
      {
        id: 'place_city',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: {
          'icon-image': 'circle-11',
          'text-field': '{name}',
        },
      },
      {
        id: 'highway-shield-non-us',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        filter: [
          'all',
          ['<=', ['get', 'ref_length'], 6],
          ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ],
        layout: { 'text-field': '{ref}' },
      },
      {
        id: 'highway-shield-us-interstate',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        filter: ['all', ['<=', ['get', 'ref_length'], 6]],
        layout: { 'text-field': '{ref}' },
      },
      {
        id: 'road_shield_us',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        filter: ['all', ['<=', ['get', 'ref_length'], 6]],
        layout: { 'text-field': '{ref}' },
      },
    ],
  };

  const enhanced = enhanceBasemapStyleForOceanAndHybrid(style, 'dark');

  const wood = enhanced.layers.find((l) => l.id === 'landcover_wood') as { paint?: Record<string, unknown> };
  assert.equal(wood.paint?.['fill-pattern'], undefined);
  assert.equal(typeof wood.paint?.['fill-color'], 'string');

  const town = enhanced.layers.find((l) => l.id === 'place_town') as { layout?: Record<string, unknown> };
  assert.equal(town.layout?.['icon-image'], undefined);

  const city = enhanced.layers.find((l) => l.id === 'place_city') as { layout?: Record<string, unknown> };
  assert.equal(city.layout?.['icon-image'], undefined);

  const usInterstate = enhanced.layers.find((l) => l.id === 'highway-shield-us-interstate') as {
    layout?: Record<string, unknown>;
  };
  const usRoad = enhanced.layers.find((l) => l.id === 'road_shield_us') as {
    layout?: Record<string, unknown>;
  };
  assert.equal(usInterstate.layout?.visibility, 'none');
  assert.equal(usRoad.layout?.visibility, 'none');

  const nonUs = enhanced.layers.find((l) => l.id === 'highway-shield-non-us') as { filter?: unknown };
  const compiled = styleSpecExpression.createExpression(
    nonUs.filter as never,
    'layers[highway-shield-non-us].filter',
    {
      type: 'boolean',
      'property-type': 'data-driven',
      overridable: false,
      transition: false,
    } as never,
  );
  assert.equal(compiled.result, 'success');
  if (compiled.result === 'success') {
    const lineFeature = { type: 'LineString', properties: {} };
    assert.equal(compiled.value.evaluate({ zoom: 10 }, lineFeature as never), false);
    assert.equal(
      compiled.value.evaluate({ zoom: 10 }, { ...lineFeature, properties: { ref_length: null } } as never),
      false,
    );
    assert.equal(
      compiled.value.evaluate({ zoom: 10 }, { ...lineFeature, properties: { ref_length: 4 } } as never),
      true,
    );
  }

  // Standalone guardNumericComparisonFilter should not double-wrap already guarded comparisons
  const guardedOnce = guardNumericComparisonFilter(['all', ['<=', ['get', 'rank'], 3]]);
  const guardedTwice = guardNumericComparisonFilter(guardedOnce);
  assert.deepEqual(guardedTwice, guardedOnce);
});
