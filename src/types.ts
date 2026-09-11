export type EngravingStatus = 'queued' | 'inprogress' | 'ready' | 'completed';

export interface EngravingOrder {
  id: string; // The unique short alphanumeric code (e.g. M4A9)
  runnerName: string;
  bibNumber: string;
  distance: string; // e.g. "5K", "10K", "Half Marathon", "Full Marathon", "Custom"
  finishingTime: string; // format "HH:MM:SS"
  status: EngravingStatus;
  createdAt: string; // RFC3339
  updatedAt: string; // RFC3339
  rank?: string; // e.g. "23rd Overall", "Age Group 1st"
  customInscription?: string; // e.g. "Chicago Marathon 2026"
  ownerUid?: string; // the runner account that submitted this, if signed in
}

export interface EngravingStats {
  total: number;
  queued: number;
  inprogress: number;
  ready: number;
  completed: number;
  byDistance: Record<string, number>;
}

export type UserRole = 'superadmin' | 'admin' | 'organizer' | 'runner';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  approved: boolean; // superadmin, admin & runner: true. organizer needs Super Admin approval.
  createdAt: string;
  nickname?: string;
  photoURL?: string; // small base64 data URI, resized client-side before saving
}

export type CheckpointType = 'checkin' | 'start' | 'intermediate' | 'finish';

export interface Checkpoint {
  id: string; // e.g. 'start', '5k', '10k', 'finish'
  label: string;
  order: number;
  // Legacy checkpoints without a type use their first/last position as Start/Finish.
  type?: CheckpointType;
  // Optional hard cutoff, measured from the runner's distance wave start. Only
  // applies to intermediate checkpoints; late scans remain recorded for auditability.
  cutoffMinutes?: number;
}

export type Gender = 'male' | 'female';

export interface AgeCategory {
  id: string;
  label: string; // e.g. "Male 18-29", "Female 30-39"
  gender: Gender;
  minAge: number;
  maxAge: number;
}

export interface RaceDistance {
  id: string;
  km: number;
  label: string; // auto-derived, e.g. "5K", "21K"
  price: number; // registration fee in pesos, set independently per distance
}

export interface Race {
  id: string;
  name: string;
  date: string;
  checkpoints: Checkpoint[];
  ageCategories: AgeCategory[];
  distances: RaceDistance[];
  inclusions: string[];
  createdBy: string;
  createdAt: string;
  // Legacy races without this field remain open until their race date.
  registrationOpen?: boolean;
  registrationCloseDate?: string; // YYYY-MM-DD; defaults to the race date
  gunStartTime?: string; // RFC3339, set when the race-in-charge fires the official start
  // RFC3339 start time per distance label (e.g. "10K", "5K"). Falls back to
  // gunStartTime for legacy races and races with one shared start.
  waveStartTimes?: Record<string, string>;
  // Public live-race presentation. The video and route remain optional so an
  // organizer can enable a live leaderboard even without a stream provider.
  liveBroadcastEnabled?: boolean;
  livestreamUrl?: string;
  routeMapUrl?: string;
  posterImage?: string; // small base64 data URI, resized client-side before saving
}

export interface PublicLeaderboardEntry {
  bibNumber: string;
  fullName: string;
  distance: string;
  rank: number;
  finishTime: string;
}

// Deliberately contains only publishable result data. Raw chip reads remain
// private to operators and each individual runner under Firestore rules.
export interface PublicLiveResults {
  raceId: string;
  raceName: string;
  updatedAt: string;
  status: 'upcoming' | 'live' | 'completed';
  totalRegistered: number;
  totalStarted: number;
  totalFinished: number;
  leaders: PublicLeaderboardEntry[];
  // Every completed finisher, ordered by distance and official rank. This is
  // the public result feed; checkpoint scans remain private.
  officialResults: PublicLeaderboardEntry[];
}

export interface RunnerProfile {
  uid: string;
  raceId: string;
  fullName: string;
  bibNumber: string;
  chipId?: string; // RFID tag UID, once real hardware is assigned
  distance: string;
  gender: Gender;
  age: number;
  createdAt: string;
}

export type ChipReadSource = 'manual' | 'rfid-bridge';

export interface ChipRead {
  id: string;
  raceId: string;
  bibNumber: string;
  chipId?: string;
  checkpointId: string;
  timestamp: string; // RFC3339, when the runner crossed
  source: ChipReadSource;
  recordedBy: string; // uid, or 'system' for a hardware bridge
  createdAt: string;
}

export interface RunnerSplit {
  checkpointId: string;
  timestamp: string;
}

export interface RunnerResult {
  bibNumber: string;
  runnerProfile?: RunnerProfile;
  splits: RunnerSplit[];
  finishTime?: string; // formatted HH:MM:SS elapsed from 'start' checkpoint to 'finish'
  finishSeconds?: number;
  rank?: number;
}
