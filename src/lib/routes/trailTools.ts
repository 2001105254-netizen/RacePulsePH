import { geodesicDistanceM, processCanonicalGeometry, type ProcessedRoute } from './geometry';
import { projectCoordinateToRoute, reanchorMarkersForRoute } from './anchoring';
import { samplePhilippineDemElevationM } from './philippinesMapTiles';
import type {
  CanonicalRouteGeometry,
  CanonicalSegmentInput,
  RouteMarker,
  RouteSurfaceType,
  TerrainScenarioTag,
} from './types';

export interface GpsBreadcrumbFix {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracyM: number;
  timestamp: number;
  headingDeg?: number;
}

export interface GpsTrailState {
  status: 'idle' | 'tracking' | 'paused';
  maxAccuracyM: number;
  minDisplacementM: number;
  maxSpeedMps: number;
  acceptedPoints: Array<{
    lat: number;
    lon: number;
    ele?: number;
    rawEle?: number;
    accuracyM: number;
    timestamp: number;
    surfaceType?: RouteSurfaceType;
    terrainScenario?: TerrainScenarioTag;
  }>;
  rejectedCount: number;
  lastRejectReason?: string;
  lastFix?: GpsBreadcrumbFix;
  totalDistanceM: number;
  estimatedGainM: number;
}

export const SURFACE_LABELS: Record<RouteSurfaceType, string> = {
  paved: 'Road (Paved / Asphalt)',
  dirt: 'Off-Road (Dirt / Earth)',
  grass: 'Off-Road (Grass / Field)',
  gravel: 'Off-Road (Gravel / Fire Road)',
  singletrack: 'Off-Road (Dirt Singletrack)',
  technical: 'Off-Road (Rocky / Roots)',
  boardwalk: 'Boardwalk / Stairs',
};

export const TERRAIN_SCENARIO_LABELS: Record<TerrainScenarioTag, string> = {
  normal: 'Standard Grade',
  'steep-climb': 'Steep Climb (>10%)',
  'technical-descent': 'Technical Descent',
  'river-crossing': 'River / Creek Crossing',
  'exposed-ridge': 'Exposed Sun Ridge',
  'mud-hazard': 'Mud / Slippery Clay',
  stairs: 'Steps / Bottleneck',
};

export function createGpsTrailState(options?: {
  maxAccuracyM?: number;
  minDisplacementM?: number;
  maxSpeedMps?: number;
}): GpsTrailState {
  return {
    status: 'idle',
    maxAccuracyM: options?.maxAccuracyM ?? 25,
    minDisplacementM: options?.minDisplacementM ?? 4,
    maxSpeedMps: options?.maxSpeedMps ?? 18,
    acceptedPoints: [],
    rejectedCount: 0,
    totalDistanceM: 0,
    estimatedGainM: 0,
  };
}

function initialBearingDeg(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDeltaDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function processGpsBreadcrumbFix(
  state: GpsTrailState,
  fix: GpsBreadcrumbFix,
  surfaceType: RouteSurfaceType = 'singletrack',
  terrainScenario: TerrainScenarioTag = 'normal',
): GpsTrailState {
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: 'Invalid GNSS coordinates',
      lastFix: fix,
    };
  }

  if (!Number.isFinite(fix.accuracyM) || fix.accuracyM > state.maxAccuracyM) {
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: `Accuracy ${Math.round(fix.accuracyM)}m exceeds ${state.maxAccuracyM}m gate`,
      lastFix: fix,
    };
  }

  const points = state.acceptedPoints;
  if (points.length === 0) {
    const first = {
      lat: Number(fix.latitude.toFixed(6)),
      lon: Number(fix.longitude.toFixed(6)),
      ...(fix.altitude !== undefined && Number.isFinite(fix.altitude)
        ? { ele: Number(fix.altitude.toFixed(1)), rawEle: Number(fix.altitude.toFixed(1)) }
        : {}),
      accuracyM: Number(fix.accuracyM.toFixed(1)),
      timestamp: fix.timestamp,
      surfaceType,
      terrainScenario,
    };
    return {
      ...state,
      acceptedPoints: [first],
      lastRejectReason: undefined,
      lastFix: fix,
    };
  }

  const prev = points[points.length - 1];
  const distM = geodesicDistanceM(
    { latitude: prev.lat, longitude: prev.lon },
    { latitude: fix.latitude, longitude: fix.longitude },
  );

  // Reject stationary drift so pausing at an aid station does not inflate route distance.
  if (distM < Math.max(state.minDisplacementM, Math.min(8, fix.accuracyM * 0.45))) {
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: `Drift skipped (${distM.toFixed(1)}m < ${state.minDisplacementM}m threshold)`,
      lastFix: fix,
    };
  }

  const dtSec = Math.max(0.2, (fix.timestamp - prev.timestamp) / 1000);
  const speedMps = distM / dtSec;
  if (speedMps > state.maxSpeedMps) {
    return {
      ...state,
      rejectedCount: state.rejectedCount + 1,
      lastRejectReason: `Multipath spike rejected (${speedMps.toFixed(1)} m/s)`,
      lastFix: fix,
    };
  }

  // Inverse-variance smoothing blends high-error fixes gently while preserving switchback turns.
  let smoothedLat = fix.latitude;
  let smoothedLon = fix.longitude;
  if (points.length >= 2) {
    const prev2 = points[points.length - 2];
    const b1 = initialBearingDeg({ latitude: prev2.lat, longitude: prev2.lon }, { latitude: prev.lat, longitude: prev.lon });
    const b2 = initialBearingDeg({ latitude: prev.lat, longitude: prev.lon }, fix);
    const turnAngle = angleDeltaDeg(b1, b2);
    if (turnAngle < 35 && fix.accuracyM > 7) {
      const wNew = 1 / Math.max(16, fix.accuracyM * fix.accuracyM);
      const wPrev = 0.35 / Math.max(16, prev.accuracyM * prev.accuracyM);
      const wSum = wNew + wPrev;
      smoothedLat = (fix.latitude * wNew + prev.lat * wPrev) / wSum;
      smoothedLon = (fix.longitude * wNew + prev.lon * wPrev) / wSum;
    }
  }

  const addedDist = geodesicDistanceM(
    { latitude: prev.lat, longitude: prev.lon },
    { latitude: smoothedLat, longitude: smoothedLon },
  );

  let nextGain = state.estimatedGainM;
  if (fix.altitude !== undefined && Number.isFinite(fix.altitude) && prev.ele !== undefined) {
    const eleDiff = fix.altitude - prev.ele;
    if (eleDiff >= 2.5) nextGain += eleDiff;
  }

  const nextPt = {
    lat: Number(smoothedLat.toFixed(6)),
    lon: Number(smoothedLon.toFixed(6)),
    ...(fix.altitude !== undefined && Number.isFinite(fix.altitude)
      ? { ele: Number(fix.altitude.toFixed(1)), rawEle: Number(fix.altitude.toFixed(1)) }
      : {}),
    accuracyM: Number(fix.accuracyM.toFixed(1)),
    timestamp: fix.timestamp,
    surfaceType,
    terrainScenario,
  };

  return {
    ...state,
    acceptedPoints: [...points, nextPt],
    lastRejectReason: undefined,
    lastFix: fix,
    totalDistanceM: Number((state.totalDistanceM + addedDist).toFixed(1)),
    estimatedGainM: Number(nextGain.toFixed(1)),
  };
}

export function commitGpsTrackToGeometry(
  geometry: CanonicalRouteGeometry,
  state: GpsTrailState,
  replaceExisting = false,
): CanonicalRouteGeometry {
  if (state.acceptedPoints.length < 2) {
    throw new Error('Record at least 2 accepted GPS fixes before committing.');
  }
  const gpsSeg: CanonicalSegmentInput = {
    id: `gps_${Date.now().toString(36)}`,
    name: `GPS Field Survey (${(state.totalDistanceM / 1000).toFixed(2)} km)`,
    sourceKind: 'gps-tracked',
    surfaceType: state.acceptedPoints[0].surfaceType || 'singletrack',
    terrainScenario: state.acceptedPoints[0].terrainScenario || 'normal',
    points: state.acceptedPoints.map((pt) => ({
      lat: pt.lat,
      lon: pt.lon,
      ...(pt.ele !== undefined ? { ele: pt.ele, rawEle: pt.rawEle ?? pt.ele } : {}),
      ...(pt.surfaceType ? { surfaceType: pt.surfaceType } : {}),
      ...(pt.terrainScenario ? { terrainScenario: pt.terrainScenario } : {}),
      accuracyM: pt.accuracyM,
      timestamp: pt.timestamp,
    })),
  };

  const baseSegments = (replaceExisting || geometry.isCanvasCleared) ? [] : geometry.segments;
  const nextSegments = [...baseSegments, gpsSeg];
  const hasMultipleKinds = new Set(nextSegments.map((s) => s.sourceKind)).size > 1;
  return {
    version: 1,
    sourceKind: hasMultipleKinds ? 'mixed' : 'gps-tracked',
    segments: nextSegments,
  };
}

export function generateSimulatedGpsWalk(
  anchorLat: number,
  anchorLon: number,
  anchorEle: number,
  steps = 12,
): GpsBreadcrumbFix[] {
  const fixes: GpsBreadcrumbFix[] = [];
  const startTime = Date.now() - steps * 6000;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 1.4;
    const radiusLat = 0.0018 * Math.sin(angle);
    const radiusLon = 0.0022 * (1 - Math.cos(angle));
    // Inject one noisy accuracy spike on step 5 so live quality gate rejection is exercised.
    const isNoisyStep = i === 5;
    fixes.push({
      latitude: Number((anchorLat + radiusLat).toFixed(6)),
      longitude: Number((anchorLon + radiusLon).toFixed(6)),
      altitude: Number((anchorEle + Math.sin(i * 0.5) * 28 + i * 3.5).toFixed(1)),
      accuracyM: isNoisyStep ? 42 : 4.5 + (i % 3) * 1.8,
      timestamp: startTime + i * 6000,
    });
  }
  return fixes;
}

export function smoothPaintedStroke(
  rawPoints: Array<{ lat: number; lon: number; ele?: number }>,
  spacingM = 12,
): Array<{ lat: number; lon: number; ele?: number }> {
  if (rawPoints.length <= 2) return rawPoints;

  // 1. Resample freehand drag points to an even spacing so jitter clusters disappear.
  const resampled: Array<{ lat: number; lon: number; ele?: number }> = [rawPoints[0]];
  let accumM = 0;
  for (let i = 1; i < rawPoints.length; i += 1) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const segLen = geodesicDistanceM(
      { latitude: prev.lat, longitude: prev.lon },
      { latitude: curr.lat, longitude: curr.lon },
    );
    if (segLen < 1) continue;
    accumM += segLen;
    if (accumM >= spacingM || i === rawPoints.length - 1) {
      resampled.push(curr);
      accumM = 0;
    }
  }
  if (resampled.length <= 2) return resampled;

  // 2. One pass of endpoint-preserving Chaikin corner cutting for silky painted trails.
  const smoothed: Array<{ lat: number; lon: number; ele?: number }> = [resampled[0]];
  for (let i = 0; i < resampled.length - 1; i += 1) {
    const a = resampled[i];
    const b = resampled[i + 1];
    if (i > 0) {
      smoothed.push({
        lat: Number((a.lat * 0.75 + b.lat * 0.25).toFixed(6)),
        lon: Number((a.lon * 0.75 + b.lon * 0.25).toFixed(6)),
        ...(a.ele !== undefined && b.ele !== undefined ? { ele: Number((a.ele * 0.75 + b.ele * 0.25).toFixed(1)) } : {}),
      });
    }
    if (i < resampled.length - 2) {
      smoothed.push({
        lat: Number((a.lat * 0.25 + b.lat * 0.75).toFixed(6)),
        lon: Number((a.lon * 0.25 + b.lon * 0.75).toFixed(6)),
        ...(a.ele !== undefined && b.ele !== undefined ? { ele: Number((a.ele * 0.25 + b.ele * 0.75).toFixed(1)) } : {}),
      });
    }
  }
  smoothed.push(resampled[resampled.length - 1]);
  return smoothed;
}

export function appendPaintedStrokeToGeometry(
  geometry: CanonicalRouteGeometry,
  rawPoints: Array<{ lat: number; lon: number }>,
  options: {
    spacingM?: number;
    surfaceType?: RouteSurfaceType;
    terrainScenario?: TerrainScenarioTag;
    replaceStarter?: boolean;
  } = {},
): CanonicalRouteGeometry {
  let strokeInput = rawPoints;
  // If the user explicitly placed a starting point on a cleared canvas, snap a nearby stroke start to it.
  if (
    geometry.isCanvasCleared &&
    !geometry.isStartPointRemoved &&
    rawPoints.length >= 2 &&
    geometry.segments[0]?.points[0]
  ) {
    const startAnchor = geometry.segments[0].points[0];
    const snapDistM = geodesicDistanceM(
      { latitude: rawPoints[0].lat, longitude: rawPoints[0].lon },
      { latitude: startAnchor.lat, longitude: startAnchor.lon },
    );
    if (snapDistM <= 60) {
      strokeInput = [{ lat: startAnchor.lat, lon: startAnchor.lon }, ...rawPoints.slice(1)];
    }
  }

  const smoothed = smoothPaintedStroke(strokeInput, options.spacingM ?? 12);
  if (smoothed.length < 2) return geometry;

  const surfaceType = options.surfaceType || 'singletrack';
  const terrainScenario = options.terrainScenario || 'normal';
  const paintedSeg: CanonicalSegmentInput = {
    id: `painted_${Date.now().toString(36)}`,
    name: `Painted ${SURFACE_LABELS[surfaceType]} section`,
    sourceKind: 'drawn',
    surfaceType,
    terrainScenario,
    points: smoothed.map((p) => {
      const ele = p.ele ?? estimatePhilippineTopographicElevationM(p.lat, p.lon);
      return {
        lat: p.lat,
        lon: p.lon,
        ele,
        rawEle: ele,
        surfaceType,
        terrainScenario,
      };
    }),
  };

  const baseSegments = (options.replaceStarter || geometry.isCanvasCleared) ? [] : geometry.segments;
  const nextSegments = [...baseSegments, paintedSeg];
  const hasNonDrawn = nextSegments.some((s) => s.sourceKind !== 'drawn');
  return {
    version: 1,
    sourceKind: hasNonDrawn ? 'mixed' : 'drawn',
    segments: nextSegments,
  };
}

function makeClearedStartAnchorGeometry(
  lat: number,
  lon: number,
  options: { removed: boolean },
): CanonicalRouteGeometry {
  const fixedLat = Number(lat.toFixed(6));
  const fixedLon = Number(lon.toFixed(6));
  return {
    version: 1,
    sourceKind: 'drawn',
    isCanvasCleared: true,
    ...(options.removed ? { isStartPointRemoved: true } : {}),
    segments: [
      {
        id: 'cleared_anchor',
        name: options.removed ? 'Cleared canvas anchor' : 'Placed starting point',
        sourceKind: 'drawn',
        points: [
          { lat: fixedLat, lon: fixedLon },
          {
            lat: Number((fixedLat + 0.00001).toFixed(6)),
            lon: Number((fixedLon + 0.00001).toFixed(6)),
          },
        ],
      },
    ],
  };
}

export function clearRouteCanvas(geometry: CanonicalRouteGeometry): CanonicalRouteGeometry {
  const firstPt = geometry.segments[0]?.points[0] || { lat: 16.4119, lon: 120.5947 };
  return makeClearedStartAnchorGeometry(firstPt.lat, firstPt.lon, { removed: true });
}

export function removeStartPointFromGeometry(
  geometry: CanonicalRouteGeometry,
): CanonicalRouteGeometry {
  return {
    ...geometry,
    isStartPointRemoved: true,
  };
}

function isDefaultStarterGeometry(geometry: CanonicalRouteGeometry): boolean {
  if (geometry.isCanvasCleared || geometry.segments.length !== 1) return false;
  const seg = geometry.segments[0];
  if (!seg || seg.id !== 'drawn_1' || seg.points.length < 3) return false;
  const last = seg.points[seg.points.length - 1];
  return (
    Math.abs(seg.points[0].lat - 16.4119) < 1e-5 &&
    Math.abs(seg.points[0].lon - 120.5947) < 1e-5 &&
    Math.abs(last.lat - 16.4121) < 1e-5 &&
    Math.abs(last.lon - 120.6022) < 1e-5
  );
}

export type RelocateStartPointResult =
  | {
      mode: 'placed-cleared' | 'replaced-starter' | 'rotated-loop' | 'updated-start';
      geometry: CanonicalRouteGeometry;
    }
  | {
      mode: 'needs-reset-confirm';
      distanceFromCourseKm: number;
      fallbackAnchor: CanonicalRouteGeometry;
    };

/**
 * Relocates or places the course starting point at `(lat, lon)`.
 * Clears placeholder/empty anchors directly, rotates closed loops, adjusts nearby starts,
 * and asks before discarding a distant custom or GPX course.
 */
export function relocateStartPointInGeometry(
  geometry: CanonicalRouteGeometry,
  lat: number,
  lon: number,
  processedRoute?: ProcessedRoute,
): RelocateStartPointResult {
  const newLat = Number(lat.toFixed(6));
  const newLon = Number(lon.toFixed(6));

  if (geometry.isCanvasCleared) {
    return {
      mode: 'placed-cleared',
      geometry: makeClearedStartAnchorGeometry(newLat, newLon, { removed: false }),
    };
  }

  const route = processedRoute || processCanonicalGeometry(geometry);
  const firstPt = route.points[0];
  const distToStartM = geodesicDistanceM(
    { latitude: newLat, longitude: newLon },
    { latitude: firstPt.latitude, longitude: firstPt.longitude },
  );

  if (isDefaultStarterGeometry(geometry)) {
    if (distToStartM > 500) {
      return {
        mode: 'replaced-starter',
        geometry: makeClearedStartAnchorGeometry(newLat, newLon, { removed: false }),
      };
    }
    const seg = geometry.segments[0];
    const startEle = estimatePhilippineTopographicElevationM(newLat, newLon);
    return {
      mode: 'updated-start',
      geometry: {
        version: 1,
        sourceKind: geometry.sourceKind,
        segments: [
          {
            ...seg,
            points: [{ lat: newLat, lon: newLon, ele: startEle, rawEle: startEle }, ...seg.points.slice(1)],
          },
        ],
      },
    };
  }

  // Rotate a single-segment closed loop when placing the start point onto another spot on the loop.
  const lastPt = route.points[route.points.length - 1];
  const isClosedLoop =
    route.canonicalSegments.length === 1 &&
    geometry.segments.length === 1 &&
    route.distanceM > 300 &&
    geodesicDistanceM(firstPt, lastPt) <= 150;

  if (isClosedLoop) {
    const proj = projectCoordinateToRoute(route, newLat, newLon);
    if (proj.best.offsetMeters <= 60) {
      const canonSeg = route.canonicalSegments[0];
      const rawSeg = geometry.segments[0];
      let splitIdx = canonSeg.findIndex((pt, idx) => idx > 0 && pt.chainageM >= proj.best.chainageM);
      if (splitIdx <= 0) splitIdx = 1;
      const splitLat = Number(proj.best.latitude.toFixed(6));
      const splitLon = Number(proj.best.longitude.toFixed(6));
      const templatePt = rawSeg.points[Math.min(splitIdx, rawSeg.points.length - 1)];
      const splitPt = {
        lat: splitLat,
        lon: splitLon,
        ...(proj.best.elevation !== undefined
          ? { ele: proj.best.elevation, rawEle: proj.best.elevation }
          : {}),
        ...(templatePt?.surfaceType ? { surfaceType: templatePt.surfaceType } : {}),
        ...(templatePt?.terrainScenario ? { terrainScenario: templatePt.terrainScenario } : {}),
      };
      const endsJoin =
        geodesicDistanceM(
          { latitude: rawSeg.points[0].lat, longitude: rawSeg.points[0].lon },
          {
            latitude: rawSeg.points[rawSeg.points.length - 1].lat,
            longitude: rawSeg.points[rawSeg.points.length - 1].lon,
          },
        ) <= 5;
      const ring = endsJoin ? rawSeg.points.slice(0, -1) : rawSeg.points;
      const rotatedPoints = [
        splitPt,
        ...ring.slice(splitIdx),
        ...ring.slice(0, splitIdx),
        { ...splitPt },
      ];
      return {
        mode: 'rotated-loop',
        geometry: {
          version: 1,
          sourceKind: geometry.sourceKind,
          segments: [{ ...rawSeg, points: rotatedPoints }],
        },
      };
    }
  }

  if (distToStartM <= 2000) {
    const startEle = estimatePhilippineTopographicElevationM(newLat, newLon);
    const firstSeg = geometry.segments[0];
    if (firstSeg?.sourceKind === 'drawn') {
      const basePt = firstSeg.points[0];
      const updatedFirstSeg: CanonicalSegmentInput = {
        ...firstSeg,
        points: [
          {
            lat: newLat,
            lon: newLon,
            ele: startEle,
            rawEle: startEle,
            ...(basePt?.surfaceType ? { surfaceType: basePt.surfaceType } : {}),
            ...(basePt?.terrainScenario ? { terrainScenario: basePt.terrainScenario } : {}),
          },
          ...firstSeg.points.slice(1),
        ],
      };
      return {
        mode: 'updated-start',
        geometry: {
          version: 1,
          sourceKind: geometry.sourceKind,
          segments: [updatedFirstSeg, ...geometry.segments.slice(1)],
        },
      };
    }

    const endEle =
      firstPt.elevation ?? estimatePhilippineTopographicElevationM(firstPt.latitude, firstPt.longitude);
    const approachSeg: CanonicalSegmentInput = {
      id: 'start_approach',
      name: 'Start approach',
      sourceKind: 'drawn',
      points: [
        { lat: newLat, lon: newLon, ele: startEle, rawEle: startEle },
        { lat: firstPt.latitude, lon: firstPt.longitude, ele: endEle, rawEle: endEle },
      ],
    };
    const nextSegments =
      firstSeg?.id === 'start_approach'
        ? [approachSeg, ...geometry.segments.slice(1)]
        : [approachSeg, ...geometry.segments];
    return {
      mode: 'updated-start',
      geometry: {
        version: 1,
        sourceKind: nextSegments.some((s) => s.sourceKind !== 'drawn') ? 'mixed' : 'drawn',
        segments: nextSegments,
      },
    };
  }

  return {
    mode: 'needs-reset-confirm',
    distanceFromCourseKm: Number((distToStartM / 1000).toFixed(1)),
    fallbackAnchor: makeClearedStartAnchorGeometry(newLat, newLon, { removed: false }),
  };
}

export function erasePointsInRadius(
  geometry: CanonicalRouteGeometry,
  centerLat: number,
  centerLon: number,
  radiusM = 50,
): CanonicalRouteGeometry {
  if (geometry.isCanvasCleared) return geometry;

  const center = { latitude: centerLat, longitude: centerLon };
  const keptSegments: CanonicalSegmentInput[] = [];
  const stepM = Math.max(4, Math.min(12, radiusM * 0.28));

  for (const seg of geometry.segments) {
    // Subdivide sparse edges near the eraser so removing a vertex on a short route
    // cuts only the local brush circle instead of deleting the entire segment.
    const densePoints: CanonicalSegmentInput['points'] = [];
    for (let i = 0; i < seg.points.length; i += 1) {
      const a = seg.points[i];
      densePoints.push(a);
      if (i < seg.points.length - 1) {
        const b = seg.points[i + 1];
        const edgeLen = geodesicDistanceM(
          { latitude: a.lat, longitude: a.lon },
          { latitude: b.lat, longitude: b.lon },
        );
        const distA = geodesicDistanceM(center, { latitude: a.lat, longitude: a.lon });
        const distB = geodesicDistanceM(center, { latitude: b.lat, longitude: b.lon });
        if (edgeLen > stepM * 1.4 && (distA <= edgeLen + radiusM * 2 || distB <= edgeLen + radiusM * 2)) {
          const steps = Math.min(400, Math.ceil(edgeLen / stepM));
          for (let k = 1; k < steps; k += 1) {
            const t = k / steps;
            const eleA = a.ele ?? a.rawEle;
            const eleB = b.ele ?? b.rawEle;
            const interpEle =
              eleA !== undefined && eleB !== undefined
                ? Number((eleA + (eleB - eleA) * t).toFixed(1))
                : undefined;
            densePoints.push({
              lat: Number((a.lat + (b.lat - a.lat) * t).toFixed(6)),
              lon: Number((a.lon + (b.lon - a.lon) * t).toFixed(6)),
              ...(interpEle !== undefined ? { ele: interpEle, rawEle: interpEle } : {}),
              ...(a.surfaceType ? { surfaceType: a.surfaceType } : {}),
              ...(a.terrainScenario ? { terrainScenario: a.terrainScenario } : {}),
            });
          }
        }
      }
    }

    let chunk: CanonicalSegmentInput['points'] = [];
    for (const pt of densePoints) {
      const distM = geodesicDistanceM(center, { latitude: pt.lat, longitude: pt.lon });
      if (distM > radiusM) {
        chunk.push(pt);
      } else {
        if (chunk.length >= 2) {
          keptSegments.push({ ...seg, id: `${seg.id}_${keptSegments.length + 1}`, points: chunk });
        }
        chunk = [];
      }
    }
    if (chunk.length >= 2) {
      keptSegments.push({ ...seg, id: `${seg.id}_${keptSegments.length + 1}`, points: chunk });
    }
  }

  if (keptSegments.length === 0) {
    return makeClearedStartAnchorGeometry(centerLat, centerLon, { removed: true });
  }
  const hasGpx = keptSegments.some((s) => s.sourceKind === 'gpx');
  const hasDrawn = keptSegments.some((s) => s.sourceKind === 'drawn');
  const hasGps = keptSegments.some((s) => s.sourceKind === 'gps-tracked');
  const kindsCount = [hasGpx, hasDrawn, hasGps].filter(Boolean).length;

  return {
    version: 1,
    sourceKind: kindsCount > 1 ? 'mixed' : hasGpx ? 'gpx' : hasGps ? 'gps-tracked' : 'drawn',
    segments: keptSegments,
  };
}

export function smoothEntireGeometry(
  geometry: CanonicalRouteGeometry,
  spacingM = 12,
): CanonicalRouteGeometry {
  return {
    version: 1,
    sourceKind: geometry.sourceKind,
    segments: geometry.segments.map((seg) => {
      if (seg.points.length <= 3) return seg;
      const smoothed = smoothPaintedStroke(seg.points, spacingM);
      return {
        ...seg,
        points: smoothed.map((pt, idx) => {
          const fallback = seg.points[Math.min(seg.points.length - 1, idx)];
          return {
            lat: pt.lat,
            lon: pt.lon,
            ...(pt.ele !== undefined ? { ele: pt.ele, rawEle: pt.ele } : {}),
            ...(fallback?.surfaceType ? { surfaceType: fallback.surfaceType } : {}),
            ...(fallback?.terrainScenario ? { terrainScenario: fallback.terrainScenario } : {}),
          };
        }),
      };
    }),
  };
}

export function mirrorOutAndBackRoute(geometry: CanonicalRouteGeometry): CanonicalRouteGeometry {
  if (geometry.segments.length === 0) return geometry;
  const mirroredSegments: CanonicalSegmentInput[] = [...geometry.segments].reverse().map((seg, idx) => ({
    ...seg,
    id: `return_${seg.id || idx + 1}`,
    name: `${seg.name || `Segment ${idx + 1}`} (Return)`,
    points: [...seg.points].reverse(),
  }));
  return {
    version: 1,
    sourceKind: geometry.sourceKind,
    segments: [...geometry.segments, ...mirroredSegments],
  };
}

export function closeRouteLoopToStart(geometry: CanonicalRouteGeometry): CanonicalRouteGeometry {
  const firstPt = geometry.segments[0]?.points[0];
  const lastSeg = geometry.segments[geometry.segments.length - 1];
  const lastPt = lastSeg?.points[lastSeg.points.length - 1];
  if (!firstPt || !lastSeg || !lastPt) return geometry;
  const gapM = geodesicDistanceM(
    { latitude: lastPt.lat, longitude: lastPt.lon },
    { latitude: firstPt.lat, longitude: firstPt.lon },
  );
  if (gapM < 5) return geometry;

  const nextSegments = geometry.segments.map((seg, idx) =>
    idx === geometry.segments.length - 1
      ? { ...seg, points: [...seg.points, { ...firstPt }] }
      : seg,
  );
  return {
    ...geometry,
    segments: nextSegments,
  };
}

export function applyTerrainScenarioToRange(
  geometry: CanonicalRouteGeometry,
  fromKm: number,
  toKm: number,
  surfaceType: RouteSurfaceType,
  terrainScenario: TerrainScenarioTag,
): CanonicalRouteGeometry {
  const startM = Math.max(0, Math.min(fromKm, toKm)) * 1000;
  const endM = Math.max(fromKm, toKm) * 1000;
  let runningM = 0;

  const updatedSegments = geometry.segments.map((seg) => {
    const nextPoints = seg.points.map((pt, idx) => {
      if (idx > 0) {
        const prev = seg.points[idx - 1];
        runningM += geodesicDistanceM(
          { latitude: prev.lat, longitude: prev.lon },
          { latitude: pt.lat, longitude: pt.lon },
        );
      }
      if (runningM >= startM && runningM <= endM) {
        return {
          ...pt,
          surfaceType,
          terrainScenario,
        };
      }
      return pt;
    });
    return {
      ...seg,
      points: nextPoints,
    };
  });

  return {
    ...geometry,
    segments: updatedSegments,
  };
}

// Deterministic Copernicus GLO-30 Philippine topographic elevation model for drawn/painted segments.
export function estimatePhilippineTopographicElevationM(lat: number, lon: number): number {
  return Number(samplePhilippineDemElevationM(lat, lon, { assumeInsideLand: true }).toFixed(1));
}

export function densifyAndElevateDrawnSegments(
  segments: CanonicalSegmentInput[],
  maxStepM = 110,
): CanonicalSegmentInput[] {
  return segments.map((seg) => {
    if (!seg || seg.sourceKind !== 'drawn' || seg.points.length < 2) {
      return seg;
    }
    const densified: CanonicalSegmentInput['points'] = [];
    for (let i = 0; i < seg.points.length; i += 1) {
      const a = seg.points[i];
      const aEle = a.ele ?? a.rawEle ?? estimatePhilippineTopographicElevationM(a.lat, a.lon);
      densified.push({
        ...a,
        ele: aEle,
        rawEle: a.rawEle ?? aEle,
      });
      if (i < seg.points.length - 1) {
        const b = seg.points[i + 1];
        const edgeLen = geodesicDistanceM(
          { latitude: a.lat, longitude: a.lon },
          { latitude: b.lat, longitude: b.lon },
        );
        if (edgeLen > maxStepM) {
          const steps = Math.min(200, Math.ceil(edgeLen / maxStepM));
          for (let k = 1; k < steps; k += 1) {
            const t = k / steps;
            const lat = Number((a.lat + (b.lat - a.lat) * t).toFixed(6));
            const lon = Number((a.lon + (b.lon - a.lon) * t).toFixed(6));
            const ele = estimatePhilippineTopographicElevationM(lat, lon);
            densified.push({
              lat,
              lon,
              ele,
              rawEle: ele,
              ...(a.surfaceType ? { surfaceType: a.surfaceType } : {}),
              ...(a.terrainScenario ? { terrainScenario: a.terrainScenario } : {}),
            });
          }
        }
      }
    }
    return {
      ...seg,
      points: densified,
    };
  });
}

export async function sampleTerrainElevationForGeometry(
  geometry: CanonicalRouteGeometry,
): Promise<{ geometry: CanonicalRouteGeometry; source: 'dem' | 'mixed'; filledCount: number }> {
  let filledCount = 0;
  let hadExistingEle = false;

  const nextSegments = geometry.segments.map((seg) => ({
    ...seg,
    points: seg.points.map((pt) => {
      const current = pt.ele ?? pt.rawEle;
      if (current !== undefined && Number.isFinite(current) && seg.sourceKind !== 'drawn') {
        hadExistingEle = true;
        return pt;
      }
      filledCount += 1;
      const estimated = estimatePhilippineTopographicElevationM(pt.lat, pt.lon);
      return {
        ...pt,
        ele: estimated,
        rawEle: estimated,
      };
    }),
  }));

  return {
    geometry: {
      ...geometry,
      segments: nextSegments,
    },
    source: hadExistingEle ? 'mixed' : 'dem',
    filledCount,
  };
}

export function generateSplitKmMarkers(
  route: ProcessedRoute,
  intervalKm = 1,
  existingMarkers: RouteMarker[] = [],
): RouteMarker[] {
  const stepM = Math.max(1, intervalKm) * 1000;
  if (route.distanceM < stepM) return existingMarkers;

  const nextMarkers: RouteMarker[] = existingMarkers.filter(
    (m) => !m.id.startsWith('m_km_split_'),
  );

  for (let distM = stepM; distM < route.distanceM - 200; distM += stepM) {
    let bestPt = route.points[0];
    let bestDiff = Infinity;
    for (const pt of route.points) {
      const diff = Math.abs(pt.chainageM - distM);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPt = pt;
      }
    }
    const kmLabel = `${(distM / 1000).toFixed(0)} km`;
    nextMarkers.push({
      id: `m_km_split_${Math.round(distM)}`,
      kind: 'water',
      name: `${kmLabel} Water & Split`,
      description: `Auto-generated ${kmLabel} course distance marker.`,
      latitude: bestPt.latitude,
      longitude: bestPt.longitude,
      chainageM: bestPt.chainageM,
      segmentIndex: bestPt.segmentIndex,
      pointIndex: bestPt.pointIndex,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: ['Water'],
      photos: [],
      visibility: 'public',
    });
  }

  return reanchorMarkersForRoute(route, nextMarkers);
}
