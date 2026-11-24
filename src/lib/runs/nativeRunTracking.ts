import { WebPlugin, registerPlugin, type Plugin, type PluginListenerHandle } from '@capacitor/core';
import {
  isGeolocationAvailable,
  watchDeviceLocation,
  type DeviceLocationError,
  type DeviceRawFix,
} from '../routes/deviceGeolocation';

export type { DeviceLocationError } from '../routes/deviceGeolocation';

export type NativeRunFixProvider = 'native-foreground-gnss' | 'web-geolocation';
export type NativeRunTrackingMode = 'native-foreground-service' | 'web-wake-lock';

export interface NativeRunFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  timestamp: number;
  provider: NativeRunFixProvider;
}

export interface NativeRunTrackingStartOptions {
  title?: string;
  subtitle?: string;
}

export interface NativeRunTrackingNotificationOptions {
  title: string;
  subtitle: string;
}

export interface NativeRunTrackingStatus {
  active: boolean;
  bufferedCount: number;
  mode: NativeRunTrackingMode;
}

export interface RunTrackingPluginInterface extends Plugin {
  startTracking(
    options?: NativeRunTrackingStartOptions,
  ): Promise<{ active: boolean; mode: NativeRunTrackingMode }>;
  updateNotification(options: NativeRunTrackingNotificationOptions): Promise<void>;
  stopTracking(): Promise<{ active: boolean }>;
  getBufferedFixes(): Promise<{ fixes: NativeRunFix[] }>;
  getStatus(): Promise<NativeRunTrackingStatus>;
  addListener(
    eventName: 'locationFix',
    listenerFunc: (fix: NativeRunFix) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'trackingError',
    listenerFunc: (error: DeviceLocationError) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request?: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

function toFiniteOrNull(value: number | null | undefined): number | null {
  return value !== undefined && value !== null && Number.isFinite(value) ? value : null;
}

function toNativeRunFix(raw: DeviceRawFix): NativeRunFix {
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    accuracyM: Number.isFinite(raw.accuracyM) ? raw.accuracyM : 999,
    altitudeM: toFiniteOrNull(raw.altitudeM),
    speedMps: toFiniteOrNull(raw.speedMps),
    headingDeg: toFiniteOrNull(raw.headingDeg),
    timestamp: raw.timestamp,
    provider: raw.provider === 'native-gnss' ? 'native-foreground-gnss' : 'web-geolocation',
  };
}

async function releaseSentinelSafely(sentinel: WakeLockSentinelLike | null): Promise<void> {
  if (!sentinel) return;
  try {
    await sentinel.release();
  } catch {
    // Ignore errors when sentinel was already released by visibility loss or browser teardown.
  }
}

export class RunTrackingWeb extends WebPlugin implements RunTrackingPluginInterface {
  private active = false;
  private sessionEpoch = 0;
  private stopWatch: (() => void) | null = null;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private wakeLockRequestEpoch: number | null = null;
  private visibilityHandler: (() => void) | null = null;

  private async acquireWakeLock(epoch: number): Promise<void> {
    if (!this.active || epoch !== this.sessionEpoch) return;
    if (this.wakeLockRequestEpoch === epoch) return;
    if (this.wakeLockSentinel && !this.wakeLockSentinel.released) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithWakeLock) : null;
    const wakeLockApi = nav?.wakeLock;
    const requestWakeLock = wakeLockApi?.request;
    if (typeof requestWakeLock !== 'function') return;

    this.wakeLockRequestEpoch = epoch;
    try {
      const sentinel = await requestWakeLock.call(wakeLockApi, 'screen');
      if (!this.active || epoch !== this.sessionEpoch) {
        await releaseSentinelSafely(sentinel);
        return;
      }
      this.wakeLockSentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.wakeLockSentinel === sentinel) {
          this.wakeLockSentinel = null;
        }
      });
    } catch {
      // Screen Wake Lock is optional on web and may be blocked in background or battery-saver modes.
    } finally {
      if (this.wakeLockRequestEpoch === epoch) {
        this.wakeLockRequestEpoch = null;
      }
    }
  }

  private attachVisibilityListener(): void {
    if (this.visibilityHandler || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    this.visibilityHandler = () => {
      if (this.active && document.visibilityState !== 'hidden') {
        void this.acquireWakeLock(this.sessionEpoch);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private detachVisibilityListener(): void {
    if (this.visibilityHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }

  async startTracking(
    _options?: NativeRunTrackingStartOptions,
  ): Promise<{ active: boolean; mode: NativeRunTrackingMode }> {
    if (!isGeolocationAvailable()) {
      throw new Error('Geolocation is unavailable in this browser.');
    }

    if (this.active && this.stopWatch) {
      const currentEpoch = this.sessionEpoch;
      await this.acquireWakeLock(currentEpoch);
      if (!this.active || currentEpoch !== this.sessionEpoch) {
        return { active: false, mode: 'web-wake-lock' };
      }
      return { active: true, mode: 'web-wake-lock' };
    }

    this.sessionEpoch += 1;
    const epoch = this.sessionEpoch;
    this.active = true;
    this.attachVisibilityListener();

    if (this.stopWatch) {
      this.stopWatch();
      this.stopWatch = null;
    }

    // Bind watchDeviceLocation synchronously so stopTracking() can always cancel it deterministically.
    const cleanup = watchDeviceLocation({
      enableHighAccuracy: true,
      maximumAgeMs: 0,
      onFix: (raw) => {
        if (!this.active || epoch !== this.sessionEpoch) return;
        this.notifyListeners('locationFix', toNativeRunFix(raw));
      },
      onError: (err) => {
        if (!this.active || epoch !== this.sessionEpoch) return;
        this.notifyListeners('trackingError', err);
        if (err.code === 1) {
          void this.stopTracking();
        }
      },
    });

    if (!this.active || epoch !== this.sessionEpoch) {
      cleanup();
      return { active: false, mode: 'web-wake-lock' };
    }
    this.stopWatch = cleanup;

    await this.acquireWakeLock(epoch);

    if (!this.active || epoch !== this.sessionEpoch) {
      return { active: false, mode: 'web-wake-lock' };
    }
    return { active: true, mode: 'web-wake-lock' };
  }

  async updateNotification(_options: NativeRunTrackingNotificationOptions): Promise<void> {
    // Web sessions have no persistent OS foreground notification to update.
  }

  async stopTracking(): Promise<{ active: boolean }> {
    this.sessionEpoch += 1;
    this.active = false;
    this.wakeLockRequestEpoch = null;
    if (this.stopWatch) {
      this.stopWatch();
      this.stopWatch = null;
    }
    this.detachVisibilityListener();
    const sentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;
    await releaseSentinelSafely(sentinel);
    return { active: false };
  }

  async getBufferedFixes(): Promise<{ fixes: NativeRunFix[] }> {
    return { fixes: [] };
  }

  async getStatus(): Promise<NativeRunTrackingStatus> {
    return {
      active: this.active,
      bufferedCount: 0,
      mode: 'web-wake-lock',
    };
  }
}

export const RunTracking = registerPlugin<RunTrackingPluginInterface>('RunTracking', {
  web: () => Promise.resolve(new RunTrackingWeb()),
});
