import type {
  DailyRollupPoint,
  SystemTelemetrySnapshot,
  TelemetryPlatform,
  TelemetryTriggerStatus,
} from './types';

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
export const PRESENCE_LAST_PING_STORAGE_KEY = 'racepulse_presence_last_ping_v1';

export function formatBytes(rawBytes: number): string {
  const bytes = Number.isFinite(rawBytes) && rawBytes > 0 ? rawBytes : 0;
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 100 ? 1 : 2)} GB`;
}

export function formatCompactCount(rawValue: number): string {
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function triggerPercent(current: number, threshold: number): number {
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0;
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
  if (safeThreshold === 0) return 0;
  return Math.min(999, Math.round((safeCurrent / safeThreshold) * 1000) / 10);
}

export function triggerStatusLabel(status: TelemetryTriggerStatus): string {
  if (status === 'scale') return 'Scale';
  if (status === 'watch') return 'Watch';
  return 'OK';
}

export function detectClientPlatform(
  userAgent = '',
  isNativePlatform = false,
  nativePlatform = 'web',
): TelemetryPlatform {
  if (isNativePlatform) {
    const clean = nativePlatform.trim().toLowerCase();
    if (clean === 'android') return 'android';
    if (clean === 'ios') return 'ios';
  }
  const ua = userAgent.toLowerCase();
  if (ua.includes('capacitor') && ua.includes('android')) return 'android';
  if (ua.includes('capacitor') && (ua.includes('iphone') || ua.includes('ipad'))) return 'ios';
  return 'web';
}

export function shouldSendThrottledHeartbeat(
  lastPingMs: number | null | undefined,
  nowMs = Date.now(),
  intervalMs = PRESENCE_HEARTBEAT_INTERVAL_MS,
): boolean {
  if (typeof lastPingMs !== 'number' || !Number.isFinite(lastPingMs) || lastPingMs <= 0) {
    return true;
  }
  return nowMs - lastPingMs >= intervalMs;
}

export function buildDevE2eTelemetrySnapshot(): SystemTelemetrySnapshot {
  const dailySeries: DailyRollupPoint[] = [
    { dayKey: '2026-11-12', uniqueSessions: 142, heartbeats: 310, authenticatedWrites: 94 },
    { dayKey: '2026-11-13', uniqueSessions: 168, heartbeats: 344, authenticatedWrites: 112 },
    { dayKey: '2026-11-14', uniqueSessions: 195, heartbeats: 402, authenticatedWrites: 138 },
    { dayKey: '2026-11-15', uniqueSessions: 312, heartbeats: 688, authenticatedWrites: 240 },
    { dayKey: '2026-11-16', uniqueSessions: 158, heartbeats: 332, authenticatedWrites: 105 },
    { dayKey: '2026-11-17', uniqueSessions: 174, heartbeats: 378, authenticatedWrites: 119 },
    { dayKey: '2026-11-18', uniqueSessions: 186, heartbeats: 392, authenticatedWrites: 124 },
    { dayKey: '2026-11-19', uniqueSessions: 204, heartbeats: 418, authenticatedWrites: 142 },
    { dayKey: '2026-11-20', uniqueSessions: 219, heartbeats: 446, authenticatedWrites: 151 },
    { dayKey: '2026-11-21', uniqueSessions: 248, heartbeats: 512, authenticatedWrites: 184 },
    { dayKey: '2026-11-22', uniqueSessions: 368, heartbeats: 804, authenticatedWrites: 298 },
    { dayKey: '2026-11-23', uniqueSessions: 224, heartbeats: 468, authenticatedWrites: 162 },
    { dayKey: '2026-11-24', uniqueSessions: 246, heartbeats: 520, authenticatedWrites: 176 },
    { dayKey: '2026-11-25', uniqueSessions: 284, heartbeats: 590, authenticatedWrites: 198 },
  ];

  const collections = [
    {
      collection: 'recordedRuns',
      documents: 1842,
      avgDocBytes: 6400,
      rawBytes: 11_788_800,
      indexedBytes: 29_472_000,
      rawMb: 11.243,
      indexedMb: 28.107,
    },
    {
      collection: 'races',
      documents: 64,
      avgDocBytes: 9200,
      rawBytes: 588_800,
      indexedBytes: 1_472_000,
      rawMb: 0.562,
      indexedMb: 1.404,
    },
    {
      collection: 'messages',
      documents: 9420,
      avgDocBytes: 960,
      rawBytes: 9_043_200,
      indexedBytes: 22_608_000,
      rawMb: 8.624,
      indexedMb: 21.56,
    },
    {
      collection: 'socialPosts',
      documents: 1180,
      avgDocBytes: 2100,
      rawBytes: 2_478_000,
      indexedBytes: 6_195_000,
      rawMb: 2.363,
      indexedMb: 5.908,
    },
    {
      collection: 'users',
      documents: 1290,
      avgDocBytes: 1450,
      rawBytes: 1_870_500,
      indexedBytes: 4_676_250,
      rawMb: 1.784,
      indexedMb: 4.46,
    },
    {
      collection: 'runners',
      documents: 2410,
      avgDocBytes: 1650,
      rawBytes: 3_976_500,
      indexedBytes: 9_941_250,
      rawMb: 3.792,
      indexedMb: 9.481,
    },
  ];

  return {
    generatedAt: '2026-11-25T08:00:00.000Z',
    cache: {
      cached: false,
      ageSeconds: 0,
      ttlSeconds: 60,
      cooldownSeconds: 10,
    },
    onlineNow: {
      total: 47,
      windowMinutes: 20,
      byRole: { runner: 41, organizer: 4, admin: 1, superadmin: 1 },
      byPlatform: { web: 22, android: 21, ios: 4 },
      byWorkspace: { personal: 41, operations: 6 },
    },
    rollups: {
      todayKey: '2026-11-25',
      dauToday: 284,
      wau7d: 1793,
      mau30d: 3120,
      heartbeatsToday: 590,
      dailySeries,
    },
    storage: {
      totalBytes: 3_942_000_000,
      totalMb: 3759.38,
      totalGb: 3.671,
      objectCount: 2845,
      updatedAt: '2026-11-25T07:58:00.000Z',
      prefixes: {
        'social-media': { bytes: 2_610_000_000, objects: 1140 },
        'chat-media': { bytes: 420_000_000, objects: 512 },
        'run-tracks': { bytes: 640_000_000, objects: 890 },
        'badge-assets': { bytes: 48_000_000, objects: 64 },
        'club-assets': { bytes: 82_000_000, objects: 92 },
        'race-assets': { bytes: 128_000_000, objects: 134 },
        other: { bytes: 14_000_000, objects: 13 },
      },
    },
    firestore: {
      totalDocuments: 16_206,
      rawBytes: 29_745_800,
      indexedBytes: 74_364_500,
      rawMb: 28.37,
      indexedMb: 70.92,
      collections,
    },
    moderation: {
      openReports: 2,
      pendingClubRequests: 3,
    },
    monitoring: {
      source: 'unavailable',
      reason: 'E2E offline fixture mode (Cloud Monitoring disabled locally).',
      monthlyEgressGb: 42.5,
      requests24h: 18420,
      errorRatePct: 0.12,
      peakWriteRps: 6.4,
      functionP95Ms: 184,
    },
    triggers: [
      {
        id: 'storage_egress',
        label: 'Monthly Storage Egress',
        currentValue: 42.5,
        thresholdValue: 500,
        unit: 'GB/mo',
        percent: 8.5,
        status: 'ok',
        recommendation: 'Migrate video delivery/transcoding to Cloudflare Stream or R2 when >= 500 GB/mo.',
      },
      {
        id: 'functions_latency_rps',
        label: 'Peak Write RPS & Functions p95',
        currentValue: 184,
        thresholdValue: 800,
        unit: 'ms p95',
        secondaryText: '6.4 RPS / 184 ms p95',
        percent: 23,
        status: 'ok',
        recommendation: 'Raise minInstances or split hot realtime handlers when >= 300 RPS or >= 800 ms p95.',
      },
      {
        id: 'chat_volume',
        label: 'Chat & Community Message Volume',
        currentValue: 9420,
        thresholdValue: 5_000_000,
        unit: 'docs',
        percent: 0.2,
        status: 'ok',
        recommendation: 'Enable cold message archival TTL policy when messages exceed 5M documents.',
      },
      {
        id: 'active_dau',
        label: 'Daily Active Users (PHT)',
        currentValue: 284,
        thresholdValue: 25_000,
        unit: 'DAU',
        percent: 1.1,
        status: 'ok',
        recommendation: 'Enable Firebase BigQuery export alongside live telemetry when DAU exceeds 25,000.',
      },
    ],
  };
}
