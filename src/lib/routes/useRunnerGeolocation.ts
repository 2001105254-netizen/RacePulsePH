import { useCallback, useEffect, useRef, useState } from 'react';
import { locateAtChainage, projectCoordinateToRoute } from './anchoring';
import { geodesicDistanceM, type ProcessedRoute } from './geometry';
import type { RouteMarker } from './types';

export type RunnerGeolocationStatus =
  | 'idle'
  | 'locating'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error';

export interface RunnerLivePosition {
  lat: number;
  lon: number;
  accuracyM: number;
  headingDeg?: number | null;
  speedMps?: number | null;
  updatedAtMs: number;
}

export interface RunnerLocationProjection {
  chainageM: number;
  passNumber: number;
  offRouteMeters: number;
  onCourse: boolean;
  nearestElevationM?: number;
  nearestGradePct?: number;
  nearestMarker: RouteMarker | null;
  nearestMarkerDistanceM: number | null;
  nextMarker: RouteMarker | null;
  nextMarkerDistanceAlongM: number | null;
  distanceRemainingM: number;
  progressPct: number;
}

const ON_COURSE_TOLERANCE_M = 50;

/**
 * Computes a runner's live projection relative to a published route, nearest landmark,
 * and next upcoming trailmark ahead along the course.
 */
export function computeRunnerLocationRelativeToRoute(
  route: ProcessedRoute,
  latitude: number,
  longitude: number,
  markers: RouteMarker[] = [],
  preferredPass?: number,
): RunnerLocationProjection | null {
  if (!route || !Array.isArray(route.points) || route.points.length === 0) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const projection = projectCoordinateToRoute(route, latitude, longitude, preferredPass);
  const { best } = projection;
  const cursor = locateAtChainage(route, best.chainageM, best.passNumber);

  let nearestMarker: RouteMarker | null = null;
  let nearestMarkerDistanceM: number | null = null;

  for (const marker of markers) {
    const distM = geodesicDistanceM(
      { latitude, longitude },
      { latitude: marker.latitude, longitude: marker.longitude },
    );
    if (nearestMarkerDistanceM === null || distM < nearestMarkerDistanceM) {
      nearestMarker = marker;
      nearestMarkerDistanceM = Math.round(distM);
    }
  }

  const samePassAhead = markers
    .filter((m) => m.passNumber === best.passNumber && m.chainageM >= best.chainageM - 5)
    .sort((a, b) => a.chainageM - b.chainageM);
  const anyAhead = markers
    .filter((m) => m.chainageM >= best.chainageM - 5)
    .sort((a, b) => a.chainageM - b.chainageM);
  const nextMarker = samePassAhead[0] || anyAhead[0] || null;
  const nextMarkerDistanceAlongM = nextMarker
    ? Math.max(0, Math.round(nextMarker.chainageM - best.chainageM))
    : null;

  const distanceRemainingM = Math.max(0, Math.round(route.distanceM - best.chainageM));
  const progressPct =
    route.distanceM > 0
      ? Number(Math.min(100, Math.max(0, (best.chainageM / route.distanceM) * 100)).toFixed(1))
      : 0;

  return {
    chainageM: best.chainageM,
    passNumber: best.passNumber,
    offRouteMeters: best.offsetMeters,
    onCourse: best.offsetMeters <= ON_COURSE_TOLERANCE_M,
    nearestElevationM: best.elevation ?? cursor.elevation,
    nearestGradePct: cursor.gradePct,
    nearestMarker,
    nearestMarkerDistanceM,
    nextMarker,
    nextMarkerDistanceAlongM,
    distanceRemainingM,
    progressPct,
  };
}

/**
 * Matches an advertised distance key (such as "21K", "21km", or normalized id)
 * against available published courses for an event.
 */
export function selectPublishedCourseForDistance<
  T extends { distanceId: string; distanceLabel: string; advertisedKm: number },
>(courses: T[], preferredDistance?: string | null): T | null {
  if (!courses || courses.length === 0) return null;
  const raw = (preferredDistance || '').trim();
  if (!raw) return courses[0];

  const exactId = courses.find((c) => c.distanceId === raw);
  if (exactId) return exactId;

  const lowered = raw.toLowerCase();
  const labelOrId = courses.find(
    (c) => c.distanceId.toLowerCase() === lowered || c.distanceLabel.toLowerCase() === lowered,
  );
  if (labelOrId) return labelOrId;

  const kmMatch = lowered.match(/(\d+(?:\.\d+)?)/);
  if (kmMatch) {
    const targetKm = Number(kmMatch[1]);
    if (Number.isFinite(targetKm) && targetKm > 0) {
      const numeric = courses.find((c) => Math.abs(c.advertisedKm - targetKm) < 0.6);
      if (numeric) return numeric;
    }
  }

  return courses[0];
}

/**
 * Manages live browser/Capacitor runner geolocation with high-accuracy GPS first
 * and automatic fused-location fallback on desktop/hybrid devices.
 */
export function useRunnerGeolocation() {
  const [status, setStatus] = useState<RunnerGeolocationStatus>('idle');
  const [position, setPosition] = useState<RunnerLivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const fallbackAttemptedRef = useRef(false);

  const clearActiveWatch = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const stopTracking = useCallback(() => {
    clearActiveWatch();
    fallbackAttemptedRef.current = false;
    setStatus('idle');
    setPosition(null);
    setError(null);
  }, [clearActiveWatch]);

  const startWatch = useCallback(
    (enableHighAccuracy: boolean) => {
      if (
        typeof window === 'undefined' ||
        typeof navigator === 'undefined' ||
        !('geolocation' in navigator)
      ) {
        setStatus('unavailable');
        setError('Device location is not supported in this browser.');
        return;
      }

      const hostname = window.location?.hostname || '';
      const isSecure =
        window.isSecureContext ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        window.location?.protocol === 'file:';

      if (!isSecure) {
        setStatus('unavailable');
        setError('Live GPS requires a secure HTTPS connection.');
        return;
      }

      clearActiveWatch();
      setError(null);
      setStatus('locating');

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setPosition({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyM: Math.round(pos.coords.accuracy || 15),
            headingDeg: pos.coords.heading,
            speedMps: pos.coords.speed,
            updatedAtMs: pos.timestamp || Date.now(),
          });
          setStatus('active');
          setError(null);
        },
        (err) => {
          if (err.code === 1) {
            clearActiveWatch();
            setStatus('denied');
            setPosition(null);
            setError('Location access was denied. Enable location permission to see your spot on the map.');
            return;
          }
          if (enableHighAccuracy && !fallbackAttemptedRef.current) {
            fallbackAttemptedRef.current = true;
            startWatch(false);
            return;
          }
          if (err.code === 2) {
            setStatus('unavailable');
            setError('Device location is currently unavailable.');
          } else {
            setStatus('error');
            setError('Location lookup timed out. Check GPS signal and retry.');
          }
        },
        {
          enableHighAccuracy,
          timeout: enableHighAccuracy ? 12000 : 15000,
          maximumAge: enableHighAccuracy ? 5000 : 20000,
        },
      );
    },
    [clearActiveWatch],
  );

  const startTracking = useCallback(() => {
    fallbackAttemptedRef.current = false;
    startWatch(true);
  }, [startWatch]);

  useEffect(() => clearActiveWatch, [clearActiveWatch]);

  return {
    status,
    position,
    error,
    startTracking,
    stopTracking,
  };
}
