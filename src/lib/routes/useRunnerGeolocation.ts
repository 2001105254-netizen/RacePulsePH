import { useCallback, useEffect, useRef, useState } from 'react';
import { locateAtChainage, projectCoordinateToRoute } from './anchoring';
import { geodesicDistanceM, type ProcessedRoute } from './geometry';
import {
  angularDiffDeg,
  computeBearingDeg,
  createGpsFilterState,
  ingestGpsFix,
  type GpsFilterState,
  type GpsSignalQuality,
} from './gpsFilter';
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
  paceMinPerKm?: number | null;
  quality?: GpsSignalQuality;
  isStale?: boolean;
  insidePhilippines?: boolean;
  rejectedCount?: number;
  lastRejectReason?: string | null;
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

const DEFAULT_ON_COURSE_TOLERANCE_M = 50;
const STALE_FIX_THRESHOLD_MS = 15_000;

/**
 * Computes a runner's live projection relative to a published route, nearest landmark,
 * next upcoming trailmark ahead, and out-and-back / loop pass disambiguation.
 */
export function computeRunnerLocationRelativeToRoute(
  route: ProcessedRoute,
  latitude: number,
  longitude: number,
  markers: RouteMarker[] = [],
  preferredPass?: number,
  options?: {
    accuracyM?: number;
    previousChainageM?: number;
    headingDeg?: number | null;
  },
): RunnerLocationProjection | null {
  if (!route || !Array.isArray(route.points) || route.points.length === 0) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const projection = projectCoordinateToRoute(route, latitude, longitude, preferredPass);
  let best = projection.best;

  // Disambiguate shared outbound/inbound corridors using previous chainage + heading alignment
  if (
    preferredPass === undefined &&
    projection.candidates.length > 1 &&
    (options?.previousChainageM !== undefined ||
      (options?.headingDeg !== undefined && options.headingDeg !== null))
  ) {
    let bestScore = Infinity;
    for (const cand of projection.candidates) {
      let penalty = cand.offsetMeters;
      if (options?.previousChainageM !== undefined) {
        const deltaM = cand.chainageM - options.previousChainageM;
        if (deltaM >= -30 && deltaM <= 600) {
          penalty -= 25;
        } else if (deltaM < -120) {
          penalty += 80;
        } else if (deltaM > 1500) {
          penalty += 60;
        }
      }
      if (
        options?.headingDeg !== undefined &&
        options.headingDeg !== null &&
        Number.isFinite(options.headingDeg)
      ) {
        const ahead = locateAtChainage(route, Math.min(route.distanceM, cand.chainageM + 25), cand.passNumber);
        const behind = locateAtChainage(route, Math.max(0, cand.chainageM - 25), cand.passNumber);
        if (ahead.chainageM > behind.chainageM) {
          const tangent = computeBearingDeg(
            { lat: behind.latitude, lon: behind.longitude },
            { lat: ahead.latitude, lon: ahead.longitude },
          );
          const angle = angularDiffDeg(options.headingDeg, tangent);
          if (angle <= 45) penalty -= 30;
          else if (angle >= 135) penalty += 45;
        }
      }
      if (penalty < bestScore) {
        bestScore = penalty;
        best = cand;
      }
    }
  }

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

  const onCourseToleranceM =
    options?.accuracyM !== undefined && Number.isFinite(options.accuracyM)
      ? Math.max(35, Math.min(65, 25 + options.accuracyM * 0.5))
      : DEFAULT_ON_COURSE_TOLERANCE_M;

  return {
    chainageM: best.chainageM,
    passNumber: best.passNumber,
    offRouteMeters: best.offsetMeters,
    onCourse: best.offsetMeters <= onCourseToleranceM,
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
 * Manages live browser/Capacitor runner geolocation with accuracy gating,
 * Kalman/EMA jitter suppression, continuous high-accuracy GNSS lock, and stale-fix tracking.
 */
export function useRunnerGeolocation() {
  const [status, setStatus] = useState<RunnerGeolocationStatus>('idle');
  const [position, setPosition] = useState<RunnerLivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const watchIdRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const staleIntervalRef = useRef<number | null>(null);
  const filterRef = useRef<GpsFilterState>(createGpsFilterState({ maxAccuracyM: 35, initialCoarseLimitM: 100 }));
  const lastRawFixMsRef = useRef<number>(0);

  const clearTimersAndWatch = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (staleIntervalRef.current !== null) {
      window.clearInterval(staleIntervalRef.current);
      staleIntervalRef.current = null;
    }
  }, []);

  const stopTracking = useCallback(() => {
    clearTimersAndWatch();
    filterRef.current = createGpsFilterState({ maxAccuracyM: 35, initialCoarseLimitM: 100 });
    lastRawFixMsRef.current = 0;
    setStatus('idle');
    setPosition(null);
    setError(null);
  }, [clearTimersAndWatch]);

  const applyRawFix = useCallback((pos: GeolocationPosition) => {
    const nowMs = Date.now();
    lastRawFixMsRef.current = nowMs;
    const rawAcc =
      typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy > 0
        ? pos.coords.accuracy
        : 999;
    const nextFilter = ingestGpsFix(filterRef.current, {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracyM: rawAcc,
      altitudeM: pos.coords.altitude,
      headingDeg: pos.coords.heading,
      speedMps: pos.coords.speed,
      timestampMs: pos.timestamp || nowMs,
    });
    filterRef.current = nextFilter;

    if (nextFilter.current) {
      const c = nextFilter.current;
      setPosition({
        lat: c.lat,
        lon: c.lon,
        accuracyM: c.accuracyM,
        headingDeg: c.headingDeg,
        speedMps: c.speedMps,
        paceMinPerKm: c.paceMinPerKm,
        quality: c.quality,
        isStale: false,
        insidePhilippines: c.insidePhilippines,
        rejectedCount: nextFilter.rejectedCount,
        lastRejectReason: nextFilter.lastRejectReason,
        updatedAtMs: nowMs,
      });
      setStatus('active');
      setError(null);
    } else if (nextFilter.lastRejectReason) {
      setStatus('locating');
      setError(nextFilter.lastRejectReason);
    }
  }, []);

  const startWatch = useCallback(() => {
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

    clearTimersAndWatch();
    setError(null);
    setStatus('locating');

    // Start primary high-accuracy GNSS watch immediately with zero stale cache age.
    watchIdRef.current = navigator.geolocation.watchPosition(
      applyRawFix,
      (err) => {
        if (err.code === 1) {
          clearTimersAndWatch();
          setStatus('denied');
          setPosition(null);
          setError('Location access was denied. Enable location permission to see your spot on the map.');
          return;
        }
        // If no lock yet, obtain a one-shot fused position while keeping the high-accuracy watch running
        // or re-arming it after 15s so the device automatically upgrades once outdoors.
        if (!filterRef.current.current) {
          navigator.geolocation.getCurrentPosition(
            applyRawFix,
            () => {
              if (!filterRef.current.current) {
                setStatus(err.code === 2 ? 'unavailable' : 'error');
                setError(
                  err.code === 2
                    ? 'Device location is currently unavailable. Check GPS settings and retry.'
                    : 'Waiting for clear GPS satellite lock. Keep moving or step outdoors.',
                );
              }
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 10000 },
          );
          if (retryTimerRef.current === null) {
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              if (watchIdRef.current !== null && !filterRef.current.current) {
                startWatch();
              }
            }, 15000);
          }
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );

    staleIntervalRef.current = window.setInterval(() => {
      if (filterRef.current.current && lastRawFixMsRef.current > 0) {
        const stale = Date.now() - lastRawFixMsRef.current > STALE_FIX_THRESHOLD_MS;
        setPosition((prev) =>
          prev && Boolean(prev.isStale) !== stale
            ? { ...prev, isStale: stale, quality: stale ? 'stale' : filterRef.current.current?.quality }
            : prev,
        );
      }
    }, 5000);
  }, [applyRawFix, clearTimersAndWatch]);

  const startTracking = useCallback(() => {
    filterRef.current = createGpsFilterState({ maxAccuracyM: 35, initialCoarseLimitM: 100 });
    lastRawFixMsRef.current = 0;
    startWatch();
  }, [startWatch]);

  useEffect(() => clearTimersAndWatch, [clearTimersAndWatch]);

  return {
    status,
    position,
    error,
    autoFollow,
    setAutoFollow,
    startTracking,
    stopTracking,
  };
}
