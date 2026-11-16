import {
  MAX_GPX_BYTES,
  parseGpxCourse,
  processCanonicalGeometry,
  exportSanitizedGpx,
  reverseCanonicalGeometry,
  geodesicDistanceM,
  type ProcessedRoute,
} from './routes/geometry';
import type {
  CanonicalRouteGeometry,
  ElevationProfileSample,
  ElevationProvenance,
  GpxCanonicalPoint,
  ParsedGpxWaypoint,
  RouteValidationReport,
} from './routes/types';

export type GpxRoutePoint = GpxCanonicalPoint;

export interface GpxRoute extends ProcessedRoute {
  points: GpxCanonicalPoint[];
  segments: GpxCanonicalPoint[][];
  distancesM: number[];
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  bounds: { north: number; south: number; east: number; west: number };
}

export type {
  CanonicalRouteGeometry,
  ElevationProfileSample,
  ElevationProvenance,
  GpxCanonicalPoint,
  ParsedGpxWaypoint,
  RouteValidationReport,
};

export {
  exportSanitizedGpx,
  geodesicDistanceM,
  processCanonicalGeometry,
  reverseCanonicalGeometry,
};

export function parseGpxRoute(
  source: string,
  options?: { selectedTrackIndices?: number[] },
): GpxRoute {
  return parseGpxCourse(source, options);
}

function isAllowedGpxUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export async function fetchGpxText(url: string, signal?: AbortSignal): Promise<string> {
  if (!isAllowedGpxUrl(url)) {
    throw new Error('GPX routes must load over HTTPS.');
  }
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    throw new Error('The route file could not be downloaded.');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_GPX_BYTES) {
    throw new Error('The GPX route file exceeds the 8 MB limit.');
  }
  if (!response.body) {
    throw new Error('The route download returned no content.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let source = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_GPX_BYTES) {
        await reader.cancel();
        throw new Error('The GPX route file exceeds the 8 MB limit.');
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return source;
}

export async function loadGpxRoute(
  url: string,
  signal?: AbortSignal,
  options?: { selectedTrackIndices?: number[] },
): Promise<GpxRoute> {
  const source = await fetchGpxText(url, signal);
  return parseGpxRoute(source, options);
}

export function routeCenter(route: {
  bounds: { north: number; south: number; east: number; west: number };
}): { latitude: number; longitude: number } {
  return {
    latitude: (route.bounds.north + route.bounds.south) / 2,
    longitude: (route.bounds.east + route.bounds.west) / 2,
  };
}
