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
}

export interface EngravingStats {
  total: number;
  queued: number;
  inprogress: number;
  ready: number;
  completed: number;
  byDistance: Record<string, number>;
}
