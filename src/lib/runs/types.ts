import type { GpsFilterState } from '../routes/gpsFilter';

export type RecordedRunMode = 'free' | 'course';
export type RecordedRunPrivacy = 'private' | 'friends' | 'public';
export type RecordedRunVerificationStatus = 'verified' | 'flagged';

export interface RecordedTrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  accuracyM: number;
  timestampMs: number;
  speedMps?: number | null;
  segmentBreak?: boolean;
}

export interface RunSplitKm {
  kmIndex: number;
  distanceM: number;
  elapsedSec: number;
  movingSec: number;
  paceSecPerKm: number;
  elevationGainM: number;
  elevationLossM: number;
  avgGradePct: number;
  caloriesKcal: number;
}

export interface RunCalorieEstimate {
  totalKcal: number;
  netKcal: number;
  restingKcal: number;
  weightKgUsed: number;
  usedReferenceWeight: boolean;
  methodVersion: 'minetti2002-herrmann2024-v1';
}

export interface RecordedRunCourseRef {
  raceId: string;
  distanceId: string;
  publicationId?: string;
  raceName: string;
  distanceLabel: string;
  advertisedKm: number;
  region?: string;
}

export interface RecordedRunSummary {
  runId: string;
  uid: string;
  mode: RecordedRunMode;
  privacy: RecordedRunPrivacy;
  title: string;
  startedAt: string;
  finishedAt: string;
  elapsedTimeMs: number;
  movingTimeMs: number;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  caloriesKcal: number;
  calorieEstimate: RunCalorieEstimate;
  avgPaceSecPerKm: number | null;
  avgSpeedMps: number;
  maxSpeedMps: number;
  splits: RunSplitKm[];
  previewPolyline: Array<[number, number]>;
  islandGroups: Array<'Luzon' | 'Visayas' | 'Mindanao'>;
  courseRef?: RecordedRunCourseRef;
  homePrivacyTrimEnabled: boolean;
  trimmedHeadM: number;
  trimmedTailM: number;
  trackStoragePath?: string;
  pointCount: number;
  verificationStatus: RecordedRunVerificationStatus;
  verificationFlags: string[];
  createdAt: string;
}

export interface ActiveRunSession {
  sessionId: string;
  uid: string;
  mode: RecordedRunMode;
  status: 'recording' | 'paused';
  courseRef?: RecordedRunCourseRef;
  startedAtMs: number;
  pausedAtMs: number | null;
  accumulatedPausedMs: number;
  movingTimeMs: number;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  netKcal: number;
  restingKcal: number;
  totalKcal: number;
  maxSpeedMps: number;
  homePrivacyTrimEnabled: boolean;
  gpsFilter: GpsFilterState;
  points: RecordedTrackPoint[];
  lastAcceptedAtMs: number;
  lastElevationAnchorM: number | null;
  pendingSegmentBreak?: boolean;
  updatedAtMs: number;
}

export interface PendingRunUpload {
  requestId: string;
  runId: string;
  uid: string;
  payload: Record<string, unknown>;
  trimmedTrackPoints: RecordedTrackPoint[];
  createdAt: string;
  attempts: number;
  lastError?: string;
}
