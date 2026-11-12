export interface GpxRoutePoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

export interface GpxRoute {
  points: GpxRoutePoint[];
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  bounds: { north: number; south: number; east: number; west: number };
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function distanceBetween(a: GpxRoutePoint, b: GpxRoutePoint): number {
  const earthRadiusM = 6_371_000;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const startLatitude = toRadians(a.latitude);
  const endLatitude = toRadians(b.latitude);
  const h = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parsePoint(point: Element): GpxRoutePoint | null {
  const latitude = Number(point.getAttribute('lat'));
  const longitude = Number(point.getAttribute('lon'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const elevationText = point.querySelector('ele')?.textContent?.trim();
  const elevation = elevationText ? Number(elevationText) : undefined;
  return { latitude, longitude, ...(Number.isFinite(elevation) ? { elevation } : {}) };
}

export function parseGpxRoute(source: string): GpxRoute {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('This GPX file could not be read. Export it again as a GPX track.');
  const elements = Array.from(document.querySelectorAll('trkpt, rtept'));
  const points = elements.map(parsePoint).filter((point): point is GpxRoutePoint => point !== null);
  if (points.length < 2) throw new Error('The GPX file needs at least two route points.');

  let distanceM = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distanceM += distanceBetween(previous, current);
    if (previous.elevation !== undefined && current.elevation !== undefined) {
      const elevationDelta = current.elevation - previous.elevation;
      if (elevationDelta > 0) elevationGainM += elevationDelta;
      else elevationLossM += Math.abs(elevationDelta);
    }
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    points,
    distanceKm: distanceM / 1000,
    elevationGainM,
    elevationLossM,
    bounds: {
      north: Math.max(...latitudes),
      south: Math.min(...latitudes),
      east: Math.max(...longitudes),
      west: Math.min(...longitudes),
    },
  };
}

export async function loadGpxRoute(url: string, signal?: AbortSignal): Promise<GpxRoute> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('The route file could not be downloaded.');
  return parseGpxRoute(await response.text());
}

export function routeCenter(route: GpxRoute): { latitude: number; longitude: number } {
  return {
    latitude: (route.bounds.north + route.bounds.south) / 2,
    longitude: (route.bounds.east + route.bounds.west) / 2,
  };
}
