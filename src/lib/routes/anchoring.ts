import { geodesicDistanceM, type ProcessedRoute } from './geometry';
import type {
  GpxCanonicalPoint,
  RouteAnchorCandidate,
  RouteChapter,
  RouteMarker,
  RouteSelectionState,
} from './types';

export const MARKER_REVIEW_THRESHOLD_M = 30;
export const MARKER_BLOCK_THRESHOLD_M = 100;
const PASS_CORRIDOR_M = 45;
const PASS_CHAINAGE_SEPARATION_M = 200;

export function locateAtChainage(
  route: ProcessedRoute,
  targetChainageM: number,
  preferredPass = 1,
): RouteSelectionState {
  const clamped = Math.max(0, Math.min(route.distanceM, targetChainageM));
  const segments = route.canonicalSegments;

  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s];
    if (seg.length === 0) continue;
    const segStart = seg[0].chainageM;
    const segEnd = seg[seg.length - 1].chainageM;

    if (clamped <= segEnd || s === segments.length - 1) {
      if (clamped <= segStart || seg.length === 1) {
        const pt = seg[0];
        return {
          chainageM: pt.chainageM,
          passNumber: preferredPass,
          segmentIndex: pt.segmentIndex,
          pointIndex: pt.pointIndex,
          latitude: pt.latitude,
          longitude: pt.longitude,
          elevation: pt.elevation,
          gradePct: pt.gradePct,
        };
      }
      for (let i = 1; i < seg.length; i += 1) {
        const prev = seg[i - 1];
        const curr = seg[i];
        if (clamped <= curr.chainageM || i === seg.length - 1) {
          const span = curr.chainageM - prev.chainageM;
          const t = span > 0 ? Math.max(0, Math.min(1, (clamped - prev.chainageM) / span)) : 0;
          const elevation =
            prev.elevation !== undefined && curr.elevation !== undefined
              ? Number((prev.elevation + (curr.elevation - prev.elevation) * t).toFixed(1))
              : t < 0.5
                ? prev.elevation
                : curr.elevation;
          const nearest = t < 0.5 ? prev : curr;
          return {
            chainageM: Number(clamped.toFixed(1)),
            passNumber: preferredPass,
            segmentIndex: nearest.segmentIndex,
            pointIndex: nearest.pointIndex,
            latitude: prev.latitude + (curr.latitude - prev.latitude) * t,
            longitude: prev.longitude + (curr.longitude - prev.longitude) * t,
            elevation,
            gradePct: nearest.gradePct,
          };
        }
      }
    }
  }

  const first = route.points[0];
  if (!first) {
    return {
      chainageM: 0,
      passNumber: preferredPass,
      segmentIndex: 0,
      pointIndex: 0,
      latitude: 12.6,
      longitude: 121.8,
    };
  }
  return {
    chainageM: 0,
    passNumber: preferredPass,
    segmentIndex: first.segmentIndex,
    pointIndex: first.pointIndex,
    latitude: first.latitude,
    longitude: first.longitude,
    elevation: first.elevation,
    gradePct: first.gradePct,
  };
}

function projectPointOnEdge(
  latitude: number,
  longitude: number,
  a: GpxCanonicalPoint,
  b: GpxCanonicalPoint,
): {
  latitude: number;
  longitude: number;
  elevation?: number;
  chainageM: number;
  offsetMeters: number;
  t: number;
} {
  const cosLat = Math.cos(((a.latitude + b.latitude) * Math.PI) / 360);
  const metersPerDegLat = 111_132;
  const metersPerDegLon = 111_320 * Math.max(0.1, cosLat);

  const ax = a.longitude * metersPerDegLon;
  const ay = a.latitude * metersPerDegLat;
  const bx = b.longitude * metersPerDegLon;
  const by = b.latitude * metersPerDegLat;
  const px = longitude * metersPerDegLon;
  const py = latitude * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;

  const projLat = a.latitude + (b.latitude - a.latitude) * t;
  const projLon = a.longitude + (b.longitude - a.longitude) * t;
  const offsetMeters = geodesicDistanceM(
    { latitude, longitude },
    { latitude: projLat, longitude: projLon },
  );
  const chainageM = a.chainageM + (b.chainageM - a.chainageM) * t;
  const elevation =
    a.elevation !== undefined && b.elevation !== undefined
      ? Number((a.elevation + (b.elevation - a.elevation) * t).toFixed(1))
      : t < 0.5
        ? a.elevation
        : b.elevation;

  return {
    latitude: projLat,
    longitude: projLon,
    elevation,
    chainageM: Number(chainageM.toFixed(1)),
    offsetMeters: Number(offsetMeters.toFixed(1)),
    t,
  };
}

export function projectCoordinateToRoute(
  route: ProcessedRoute,
  latitude: number,
  longitude: number,
  preferredPass?: number,
): {
  best: RouteAnchorCandidate;
  candidates: RouteAnchorCandidate[];
  hasAmbiguousPasses: boolean;
} {
  const rawMatches: Array<Omit<RouteAnchorCandidate, 'passNumber'>> = [];

  for (const seg of route.canonicalSegments) {
    if (seg.length < 2) continue;
    for (let i = 1; i < seg.length; i += 1) {
      const a = seg[i - 1];
      const b = seg[i];
      const proj = projectPointOnEdge(latitude, longitude, a, b);
      rawMatches.push({
        chainageM: proj.chainageM,
        segmentIndex: proj.t < 0.5 ? a.segmentIndex : b.segmentIndex,
        pointIndex: proj.t < 0.5 ? a.pointIndex : b.pointIndex,
        latitude: proj.latitude,
        longitude: proj.longitude,
        elevation: proj.elevation,
        offsetMeters: proj.offsetMeters,
      });
    }
  }

  rawMatches.sort((x, y) => x.offsetMeters - y.offsetMeters);
  if (rawMatches.length === 0 && !route.points[0]) {
    const emptyBest: RouteAnchorCandidate = {
      chainageM: 0,
      segmentIndex: 0,
      pointIndex: 0,
      passNumber: 1,
      latitude,
      longitude,
      offsetMeters: 0,
    };
    return {
      best: emptyBest,
      candidates: [emptyBest],
      hasAmbiguousPasses: false,
    };
  }
  const globalBest = rawMatches[0] || {
    chainageM: 0,
    segmentIndex: 0,
    pointIndex: 0,
    latitude: route.points[0].latitude,
    longitude: route.points[0].longitude,
    elevation: route.points[0].elevation,
    offsetMeters: geodesicDistanceM({ latitude, longitude }, route.points[0]),
  };

  // Find distinct candidate passes near the selected location
  const passThreshold = Math.max(PASS_CORRIDOR_M, globalBest.offsetMeters + 25);
  const clusters: Array<Omit<RouteAnchorCandidate, 'passNumber'>> = [];
  for (const match of rawMatches) {
    if (match.offsetMeters > passThreshold && clusters.length >= 1) break;
    const nearExisting = clusters.find(
      (c) => Math.abs(c.chainageM - match.chainageM) < PASS_CHAINAGE_SEPARATION_M,
    );
    if (!nearExisting) {
      clusters.push(match);
    }
  }

  clusters.sort((x, y) => x.chainageM - y.chainageM);
  const candidates: RouteAnchorCandidate[] = clusters.map((c, idx) => ({
    ...c,
    passNumber: idx + 1,
  }));

  const preferred =
    preferredPass !== undefined
      ? candidates.find((c) => c.passNumber === preferredPass)
      : undefined;

  const best =
    preferred ||
    candidates.reduce(
      (closest, curr) => (curr.offsetMeters < closest.offsetMeters ? curr : closest),
      candidates[0],
    );

  return {
    best,
    candidates,
    hasAmbiguousPasses: candidates.length > 1,
  };
}

export function evaluateMarkerOffset(
  offsetMeters: number,
  offCourseConfirmed: boolean,
): { needsReview: boolean; offCourseBlocked: boolean } {
  const needsReview = offsetMeters > MARKER_REVIEW_THRESHOLD_M;
  const offCourseBlocked = offsetMeters > MARKER_BLOCK_THRESHOLD_M && !offCourseConfirmed;
  return { needsReview, offCourseBlocked };
}

export function reanchorMarkersForRoute(
  route: ProcessedRoute,
  markers: RouteMarker[],
): RouteMarker[] {
  const totalDistanceM = route.distanceM || 0;
  const lastPoint = route.points[route.points.length - 1];

  return markers.map((marker) => {
    // Finish and Start gates share coordinates on out-and-back and closed-loop routes;
    // anchor Start to the earliest pass (0 km) and Finish to the latest pass (total distance).
    const useEndpointPassPreference = marker.kind === 'start' || marker.kind === 'finish';
    const projected = projectCoordinateToRoute(
      route,
      marker.latitude,
      marker.longitude,
      useEndpointPassPreference ? undefined : marker.passNumber || 1,
    );

    let chosen = projected.best;
    if (marker.kind === 'start' && projected.candidates.length > 0) {
      chosen = projected.candidates[0];
    } else if (marker.kind === 'finish') {
      if (projected.candidates.length > 1) {
        chosen = projected.candidates[projected.candidates.length - 1];
      }
      if (lastPoint && totalDistanceM > 300 && chosen.chainageM < totalDistanceM * 0.5) {
        const distToRouteEnd = geodesicDistanceM(
          { latitude: marker.latitude, longitude: marker.longitude },
          lastPoint,
        );
        if (distToRouteEnd <= 250) {
          chosen = {
            chainageM: Number(totalDistanceM.toFixed(1)),
            segmentIndex: lastPoint.segmentIndex,
            pointIndex: lastPoint.pointIndex,
            passNumber: Math.max(1, projected.candidates.length),
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
            elevation: lastPoint.elevation,
            offsetMeters: Number(distToRouteEnd.toFixed(1)),
          };
        }
      }
    }

    const { needsReview, offCourseBlocked } = evaluateMarkerOffset(
      chosen.offsetMeters,
      marker.offCourseConfirmed,
    );
    return {
      ...marker,
      chainageM: chosen.chainageM,
      segmentIndex: chosen.segmentIndex,
      pointIndex: chosen.pointIndex,
      passNumber: chosen.passNumber,
      offsetMeters: chosen.offsetMeters,
      needsReview,
      offCourseBlocked,
    };
  });
}

export function deriveDefaultChapters(
  route: ProcessedRoute,
  markers: RouteMarker[],
): RouteChapter[] {
  const chapters: RouteChapter[] = [];
  const startPt = route.points[0];
  if (!startPt) return chapters;
  chapters.push({
    id: 'ch_start',
    label: 'Start',
    chainageM: 0,
    passNumber: 1,
    latitude: startPt.latitude,
    longitude: startPt.longitude,
    markerId: markers.find((m) => m.kind === 'start')?.id,
  });

  // Highest elevation point if elevation exists
  let peakPt: GpxCanonicalPoint | null = null;
  for (const pt of route.points) {
    if (pt.elevation !== undefined && (!peakPt || pt.elevation > (peakPt.elevation ?? -Infinity))) {
      peakPt = pt;
    }
  }
  if (peakPt && peakPt.chainageM > 100 && peakPt.chainageM < route.distanceM - 100) {
    chapters.push({
      id: 'ch_peak',
      label: `High point (${Math.round(peakPt.elevation!)} m)`,
      chainageM: peakPt.chainageM,
      passNumber: 1,
      latitude: peakPt.latitude,
      longitude: peakPt.longitude,
    });
  }

  // Turnaround / midpoint or notable timing/landmark marker
  const turnaround =
    markers.find(
      (m) =>
        m.visibility === 'public' &&
        (m.name.toLowerCase().includes('turnaround') || m.kind === 'landmark'),
    ) || null;
  if (turnaround) {
    chapters.push({
      id: `ch_${turnaround.id}`,
      label: turnaround.name,
      chainageM: turnaround.chainageM,
      passNumber: turnaround.passNumber || 1,
      latitude: turnaround.latitude,
      longitude: turnaround.longitude,
      markerId: turnaround.id,
    });
  }

  const endPt = route.points[route.points.length - 1];
  chapters.push({
    id: 'ch_finish',
    label: 'Finish',
    chainageM: route.distanceM,
    passNumber: 1,
    latitude: endPt.latitude,
    longitude: endPt.longitude,
    markerId: markers.find((m) => m.kind === 'finish')?.id,
  });

  return chapters;
}
