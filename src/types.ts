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

export type UserRole = 'admin' | 'organizer' | 'runner';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  approved: boolean; // admin & runner: always true. organizer: false until an admin approves.
  createdAt: string;
  nickname?: string;
  photoURL?: string; // small base64 data URI, resized client-side before saving
}

export interface Checkpoint {
  id: string; // e.g. 'start', '5k', '10k', 'finish'
  label: string;
  order: number;
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
