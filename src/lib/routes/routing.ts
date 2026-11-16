export type RoutePageMatch =
  | { kind: 'routes-catalog' }
  | { kind: 'race-course'; raceId: string; distanceId: string; publicationId?: string }
  | { kind: 'legacy-course'; raceId: string }
  | { kind: 'route-studio'; presetId?: string };

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function matchRouteLocation(pathname: string, search: string): RoutePageMatch | null {
  const trimmedPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname || '/';
  const segments = trimmedPath.split('/').filter(Boolean);
  const params = new URLSearchParams(search);

  if (segments.length === 1 && segments[0].toLowerCase() === 'routes') {
    return { kind: 'routes-catalog' };
  }

  if (
    segments.length === 4 &&
    segments[0].toLowerCase() === 'races' &&
    segments[2].toLowerCase() === 'routes' &&
    SAFE_SEGMENT_RE.test(segments[1]) &&
    SAFE_SEGMENT_RE.test(segments[3])
  ) {
    const versionParam = params.get('v')?.trim();
    return {
      kind: 'race-course',
      raceId: decodeURIComponent(segments[1]),
      distanceId: decodeURIComponent(segments[3]),
      ...(versionParam && SAFE_SEGMENT_RE.test(versionParam) ? { publicationId: versionParam } : {}),
    };
  }

  if ((trimmedPath === '/' || trimmedPath.toLowerCase() === '/index.html') && params.get('view') === 'course') {
    const raceId = params.get('race')?.trim();
    if (raceId && SAFE_SEGMENT_RE.test(raceId)) {
      return { kind: 'legacy-course', raceId };
    }
    return { kind: 'routes-catalog' };
  }

  if (segments.length >= 1 && segments[0].toLowerCase() === 'route-studio') {
    const presetId = segments[1] && SAFE_SEGMENT_RE.test(segments[1]) ? decodeURIComponent(segments[1]) : undefined;
    return { kind: 'route-studio', presetId };
  }

  return null;
}

export function buildRaceCoursePath(
  raceId: string,
  distanceId: string,
  publicationId?: string,
): string {
  const base = `/races/${encodeURIComponent(raceId)}/routes/${encodeURIComponent(distanceId)}`;
  return publicationId ? `${base}?v=${encodeURIComponent(publicationId)}` : base;
}

export function buildRouteStudioPath(presetId?: string): string {
  return presetId ? `/route-studio/${encodeURIComponent(presetId)}` : '/route-studio';
}
