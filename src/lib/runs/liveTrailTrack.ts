import { geodesicDistanceM } from '../routes/geometry';
import type { RecordedTrackPoint } from './types';

export type LiveTrailSegment = Array<[number, number]>;

const COARSE_INITIAL_ANCHOR_M = 35;
const SHARP_REFINEMENT_MAX_M = 25;
const ANCHOR_REFINEMENT_WINDOW_MS = 10_000;
const LIVE_CONNECTOR_MIN_M = 0.5;

function isFiniteCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/**
 * Splits recorded run points on pause/resume `segmentBreak` boundaries and seamlessly
 * connects the active segment to the live GPS position so the runner sees a continuous
 * real-time trail without phantom lines across pauses.
 */
export function buildLiveTrailSegments(
  points: ReadonlyArray<RecordedTrackPoint>,
  livePosition?: { lat: number; lon: number } | null,
): LiveTrailSegment[] {
  const segments: LiveTrailSegment[] = [];
  let current: LiveTrailSegment = [];

  for (const pt of points) {
    if (!isFiniteCoord(pt.lat, pt.lon)) continue;
    if (pt.segmentBreak && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push([pt.lon, pt.lat]);
  }

  if (livePosition && isFiniteCoord(livePosition.lat, livePosition.lon)) {
    if (current.length > 0) {
      const [lastLon, lastLat] = current[current.length - 1];
      const deltaM = geodesicDistanceM(
        { latitude: lastLat, longitude: lastLon },
        { latitude: livePosition.lat, longitude: livePosition.lon },
      );
      if (deltaM >= LIVE_CONNECTOR_MIN_M) {
        current.push([livePosition.lon, livePosition.lat]);
      }
    } else {
      current.push([livePosition.lon, livePosition.lat]);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

export function buildLiveTrailGeoJson(
  segments: ReadonlyArray<LiveTrailSegment>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: segments
      .filter((seg) => seg.length >= 2)
      .map((seg, index) => ({
        type: 'Feature' as const,
        properties: { segmentIndex: index },
        geometry: {
          type: 'LineString' as const,
          coordinates: seg,
        },
      })),
  };
}

/**
 * Returns true when an opening coarse cell/Wi-Fi anchor (> 35m) should be replaced
 * in-place by a much sharper GNSS satellite lock (<= 25m and <= 50% of prior radius)
 * arriving within the first 10 seconds, avoiding a false jump line and inflated start distance.
 */
export function shouldRefineInitialAnchorPoint(
  lastPoint: Pick<RecordedTrackPoint, 'accuracyM' | 'timestampMs'>,
  nextFix: { accuracyM: number; updatedAtMs: number },
): boolean {
  if (!Number.isFinite(lastPoint.accuracyM) || !Number.isFinite(nextFix.accuracyM)) {
    return false;
  }
  if (lastPoint.accuracyM <= COARSE_INITIAL_ANCHOR_M) {
    return false;
  }
  if (nextFix.accuracyM > SHARP_REFINEMENT_MAX_M) {
    return false;
  }
  if (nextFix.accuracyM > lastPoint.accuracyM * 0.5) {
    return false;
  }
  const dtMs = nextFix.updatedAtMs - lastPoint.timestampMs;
  return dtMs >= 0 && dtMs <= ANCHOR_REFINEMENT_WINDOW_MS;
}
