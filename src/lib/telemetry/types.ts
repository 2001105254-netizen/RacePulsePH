export type TelemetryPlatform = 'web' | 'android' | 'ios';
export type TelemetryWorkspace = 'personal' | 'operations';
export type TelemetryTriggerStatus = 'ok' | 'watch' | 'scale';

export interface DailyRollupPoint {
  dayKey: string;
  uniqueSessions: number;
  heartbeats: number;
  authenticatedWrites: number;
}

export interface StoragePrefixStat {
  bytes: number;
  objects: number;
}

export interface CollectionSizeStat {
  collection: string;
  documents: number;
  avgDocBytes: number;
  rawBytes: number;
  indexedBytes: number;
  rawMb: number;
  indexedMb: number;
}

export interface AdrTriggerGauge {
  id: 'storage_egress' | 'functions_latency_rps' | 'chat_volume' | 'active_dau' | string;
  label: string;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  secondaryText?: string;
  percent: number;
  status: TelemetryTriggerStatus;
  recommendation: string;
}

export interface MonitoringHealth {
  source: 'cloud_monitoring' | 'unavailable' | string;
  reason: string | null;
  monthlyEgressGb: number;
  requests24h: number;
  errorRatePct: number;
  peakWriteRps: number;
  functionP95Ms: number;
}

export interface SystemTelemetrySnapshot {
  generatedAt: string;
  cache: {
    cached: boolean;
    ageSeconds: number;
    ttlSeconds: number;
    cooldownSeconds: number;
  };
  onlineNow: {
    total: number;
    windowMinutes: number;
    byRole: Record<string, number>;
    byPlatform: Record<TelemetryPlatform, number>;
    byWorkspace: Record<TelemetryWorkspace, number>;
  };
  rollups: {
    todayKey: string;
    dauToday: number;
    wau7d: number;
    mau30d: number;
    heartbeatsToday: number;
    dailySeries: DailyRollupPoint[];
  };
  storage: {
    totalBytes: number;
    totalMb: number;
    totalGb: number;
    objectCount: number;
    updatedAt: string | null;
    prefixes: Record<string, StoragePrefixStat>;
  };
  firestore: {
    totalDocuments: number;
    rawBytes: number;
    indexedBytes: number;
    rawMb: number;
    indexedMb: number;
    collections: CollectionSizeStat[];
  };
  moderation: {
    openReports: number;
    pendingClubRequests: number;
  };
  monitoring: MonitoringHealth;
  triggers: AdrTriggerGauge[];
}
