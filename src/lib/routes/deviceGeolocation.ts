import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

export interface DeviceRawFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM?: number;
  speedMps?: number;
  headingDeg?: number;
  timestamp: number;
  provider: 'native-gnss' | 'web-geolocation';
}

export interface DeviceLocationError {
  code: number;
  message: string;
}

export interface WatchDeviceLocationOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maximumAgeMs?: number;
  onFix: (fix: DeviceRawFix) => void;
  onError?: (err: DeviceLocationError) => void;
  onStatusNotice?: (notice: string) => void;
}

/**
 * Checks whether device or browser geolocation is available in the current environment.
 */
export function isGeolocationAvailable(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Requests fine GNSS location permission across Capacitor Android and modern Web browsers.
 */
export async function requestDeviceLocationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (Capacitor.isNativePlatform()) {
    try {
      const check = await Geolocation.checkPermissions();
      if (check.location === 'granted') return 'granted';
      const req = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
      return req.location === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }

  if (typeof navigator !== 'undefined' && 'permissions' in navigator && navigator.permissions?.query) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state;
    } catch {
      return 'prompt';
    }
  }

  return 'prompt';
}

/**
 * Starts continuous high-accuracy GNSS tracking using native Capacitor FusedLocationProviderClient
 * on Android or high-accuracy watchPosition on modern browsers.
 *
 * Returns an idempotent cleanup function that terminates the watch stream.
 */
export function watchDeviceLocation(options: WatchDeviceLocationOptions): () => void {
  let isCancelled = false;
  let nativeWatchId: string | null = null;
  let webWatchId: number | null = null;
  let hasReceivedFix = false;

  const handleFix = (fix: DeviceRawFix) => {
    if (isCancelled) return;
    hasReceivedFix = true;
    options.onFix(fix);
  };

  const handleError = (err: DeviceLocationError) => {
    if (isCancelled) return;
    options.onError?.(err);
  };

  if (Capacitor.isNativePlatform()) {
    // 1. Android Native FusedLocationProviderClient via Capacitor
    void (async () => {
      try {
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') {
          const req = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
          if (req.location !== 'granted') {
            handleError({
              code: 1,
              message: 'Location permission denied. Enable Precise Location in Android Settings for RacePulsePH.',
            });
            return;
          }
        }

        if (isCancelled) return;

        // Obtain fast initial cached fix if available
        try {
          const initialPos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: false,
            maximumAge: 60000,
            timeout: 4000,
          });
          if (!isCancelled && initialPos?.coords) {
            handleFix({
              latitude: initialPos.coords.latitude,
              longitude: initialPos.coords.longitude,
              accuracyM: initialPos.coords.accuracy || 999,
              altitudeM: initialPos.coords.altitude ?? undefined,
              speedMps: initialPos.coords.speed ?? undefined,
              headingDeg: initialPos.coords.heading ?? undefined,
              timestamp: initialPos.timestamp || Date.now(),
              provider: 'native-gnss',
            });
          }
        } catch {
          // Cached fix is optional; continuous watch will deliver live satellites
        }

        if (isCancelled) return;

        // Continuous high-precision hardware GNSS stream (1000ms updates)
        nativeWatchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: options.enableHighAccuracy ?? true,
            timeout: options.timeoutMs ?? 15000,
            maximumAge: options.maximumAgeMs ?? 0,
            interval: 1000,
            minimumUpdateInterval: 1000,
            enableLocationFallback: true,
          },
          (pos: Position | null, err) => {
            if (isCancelled) return;
            if (err) {
              handleError({
                code: (err as { code?: number }).code ?? 2,
                message: err.message || 'GNSS satellite lock dropped.',
              });
              return;
            }
            if (pos?.coords) {
              handleFix({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracyM: pos.coords.accuracy || 999,
                altitudeM: pos.coords.altitude ?? undefined,
                speedMps: pos.coords.speed ?? undefined,
                headingDeg: pos.coords.heading ?? undefined,
                timestamp: pos.timestamp || Date.now(),
                provider: 'native-gnss',
              });
            }
          },
        );
      } catch (err: unknown) {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Failed to initialize native GNSS';
          handleError({ code: 2, message });
        }
      }
    })();

    return () => {
      isCancelled = true;
      if (nativeWatchId) {
        void Geolocation.clearWatch({ id: nativeWatchId }).catch(() => {});
        nativeWatchId = null;
      }
    };
  }

  // 2. Web Browser Geolocation fallback
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    handleError({
      code: 2,
      message: 'Device location is not supported in this browser.',
    });
    return () => {};
  }

  // Quick coarse cached lock to center map immediately while hardware GNSS powers up
  navigator.geolocation.getCurrentPosition(
    (coarsePos) => {
      if (isCancelled || hasReceivedFix) return;
      handleFix({
        latitude: coarsePos.coords.latitude,
        longitude: coarsePos.coords.longitude,
        accuracyM: coarsePos.coords.accuracy || 999,
        altitudeM: coarsePos.coords.altitude ?? undefined,
        speedMps: coarsePos.coords.speed ?? undefined,
        headingDeg: coarsePos.coords.heading ?? undefined,
        timestamp: coarsePos.timestamp || Date.now(),
        provider: 'web-geolocation',
      });
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 120000, timeout: 3500 },
  );

  // Primary continuous high-accuracy watch
  webWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (isCancelled) return;
      handleFix({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyM: pos.coords.accuracy || 999,
        altitudeM: pos.coords.altitude ?? undefined,
        speedMps: pos.coords.speed ?? undefined,
        headingDeg: pos.coords.heading ?? undefined,
        timestamp: pos.timestamp || Date.now(),
        provider: 'web-geolocation',
      });
    },
    (err) => {
      if (isCancelled) return;
      if (err.code === 1) {
        handleError({
          code: 1,
          message: 'Location permission was denied. Allow location in your browser address bar.',
        });
        return;
      }
      if (hasReceivedFix) {
        // Minor momentary timeout while moving under canopy
        options.onStatusNotice?.('Waiting for next GNSS fix (signal momentarily weak)...');
        return;
      }
      handleError({
        code: err.code,
        message: err.message || 'Waiting for clear GPS satellite lock. Keep moving or step outdoors.',
      });
    },
    {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeout: options.timeoutMs ?? 15000,
      maximumAge: options.maximumAgeMs ?? 0,
    },
  );

  return () => {
    isCancelled = true;
    if (webWatchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(webWatchId);
      webWatchId = null;
    }
  };
}
