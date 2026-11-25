import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { accessCommand } from '../access';
import type { UserProfile } from '../../types';
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_LAST_PING_STORAGE_KEY,
  buildDevE2eTelemetrySnapshot,
  detectClientPlatform,
  shouldSendThrottledHeartbeat,
} from './formatters';
import type {
  SystemTelemetrySnapshot,
  TelemetryPlatform,
  TelemetryWorkspace,
} from './types';

function readLastPingMs(): number | null {
  try {
    const raw = window.localStorage.getItem(PRESENCE_LAST_PING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastPingMs(ms: number): void {
  try {
    window.localStorage.setItem(PRESENCE_LAST_PING_STORAGE_KEY, String(ms));
  } catch {
    // Ignore storage failures in strict private browsing environments.
  }
}

export function resolveRuntimePlatform(): TelemetryPlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return detectClientPlatform(ua, Capacitor.isNativePlatform(), Capacitor.getPlatform());
}

export async function fetchSystemTelemetry(
  uid?: string,
  forceRefresh = false,
): Promise<SystemTelemetrySnapshot> {
  if (import.meta.env.DEV && uid?.startsWith('e2e-')) {
    return buildDevE2eTelemetrySnapshot();
  }
  const result = await accessCommand('telemetry', { forceRefresh });
  return result as SystemTelemetrySnapshot;
}

export async function sendPresenceHeartbeat(input: {
  platform: TelemetryPlatform;
  workspace: TelemetryWorkspace;
}): Promise<void> {
  try {
    await accessCommand('presence/heartbeat', input);
  } catch {
    // Heartbeats are best-effort telemetry and must never surface blocking UI errors.
  }
}

export function usePresenceHeartbeat(
  profile: UserProfile,
  workspace: TelemetryWorkspace,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !profile?.uid) return;
    if (import.meta.env.DEV && profile.uid.startsWith('e2e-')) return;

    let cancelled = false;
    const platform = resolveRuntimePlatform();

    const maybePing = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const nowMs = Date.now();
      const lastMs = readLastPingMs();
      if (!shouldSendThrottledHeartbeat(lastMs, nowMs, PRESENCE_HEARTBEAT_INTERVAL_MS)) return;
      writeLastPingMs(nowMs);
      void sendPresenceHeartbeat({ platform, workspace });
    };

    const initialTimer = window.setTimeout(maybePing, 2000);
    const intervalId = window.setInterval(maybePing, PRESENCE_HEARTBEAT_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') maybePing();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, profile?.uid, workspace]);
}
