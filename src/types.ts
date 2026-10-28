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
  accessRemoved?: boolean;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  approved: boolean; // superadmin, admin & runner: true. organizer needs Super Admin approval.
  createdAt: string;
  // A unique, lowercase sign-in handle. Legacy accounts may not have one yet
  // and can continue using their email until they add it in Profile settings.
  username?: string;
  nickname?: string;
  photoURL?: string; // small base64 data URI, resized client-side before saving
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  shirtSize?: string;
  medicalNotes?: string;
}

// Deliberately separate from UserProfile: this is the small, consent-based
// profile card a runner may share only with accepted friends. It never carries
// email, emergency details, medical notes, payment, or account role data.
export interface FriendProfile {
  uid: string;
  username: string;
  displayName: string;
  nickname?: string;
  photoURL?: string;
  updatedAt: string;
}

export interface FriendActivityRace {
  raceId: string;
  raceName: string;
  date: string;
  distance: string;
}

export interface FriendActivity {
  uid: string;
  recentRaces: FriendActivityRace[];
  updatedAt: string;
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

// A team category shares one bib/chip and produces one official result. Old
// races without this setting remain Solo-only for full backward compatibility.
export type RaceEntryCategory = 'solo' | 'duo' | 'trio' | 'group';

export type RaceBibFont = 'display' | 'sans' | 'mono' | 'condensed' | 'custom';

export interface RaceBibCustomFont {
  // Stable generated family name used by the browser canvas and bib preview.
  family: string;
  // Firebase Storage download URL. The font asset is not stored in Firestore.
  url: string;
  name: string;
}

export interface RaceBibLayout {
  bibNumberX: number;
  bibNumberY: number;
  runnerNameX: number;
  runnerNameY: number;
  // Sizes use container-width units (cqw), so the same layout scales neatly
  // in the organizer preview, runner PWA, and downloaded bib image.
  bibNumberSize?: number;
  runnerNameSize?: number;
  bibNumberColor?: string;
  runnerNameColor?: string;
  // Outline widths use container-width units (cqw), matching the text sizes.
  // A value of 0 keeps the legacy no-outline appearance.
  bibNumberStrokeColor?: string;
  bibNumberStrokeWidth?: number;
  runnerNameStrokeColor?: string;
  runnerNameStrokeWidth?: number;
  bibNumberFont?: RaceBibFont;
  runnerNameFont?: RaceBibFont;
}

// A race can use a different blank bib artwork for each distance. Each
// distance template inherits the race-wide text placement unless its own
// layout is supplied later.
export interface RaceBibTemplate {
  image: string;
  layout?: RaceBibLayout;
}

export interface Race {
  finishReviewWindowMs?: number;
  id: string;
  name: string;
  date: string;
  checkpoints: Checkpoint[];
  ageCategories: AgeCategory[];
  distances: RaceDistance[];
  entryCategories?: RaceEntryCategory[];
  inclusions: string[];
  createdBy: string;
  // Approved organizer account IDs that can jointly operate this event. The
  // creator remains the primary owner and cannot be changed by collaborators.
  organizerIds?: string[];
  createdAt: string;
  // Legacy races without this field remain open until their race date.
  registrationOpen?: boolean;
  registrationCloseDate?: string; // YYYY-MM-DD; defaults to the race date
  // Paid registrations use a hosted PayMongo Checkout session. Keeping this
  // opt-in per race means existing/free events retain the current fast flow.
  onlinePaymentEnabled?: boolean;
  paymentFeeMode?: 'absorbed' | 'passed_on';
  // Temporary cash / GCash / bank-transfer flow. The organizer verifies a
  // pending registration manually before race day; no payment proof is stored
  // in the public race document.
  manualPaymentEnabled?: boolean;
  manualPaymentInstructions?: string;
  // Optional organizer-uploaded GCash / QRPh code displayed only when the
  // race uses the temporary manual-payment flow.
  manualPaymentQrImage?: string;
  gunStartTime?: string; // RFC3339, set when the race-in-charge fires the official start
  // RFC3339 start time per distance label (e.g. "10K", "5K"). Falls back to
  // gunStartTime for legacy races and races with one shared start.
  waveStartTimes?: Record<string, string>;
  // Set explicitly by the organizer after the last timing check. This is the
  // source of truth for moving an event to Done Races; it does not depend on
  // waiting for the calendar date to roll over.
  completedAt?: string; // RFC3339
  // Public live-race presentation. The video and route remain optional so an
  // organizer can enable a live leaderboard even without a stream provider.
  liveBroadcastEnabled?: boolean;
  livestreamUrl?: string;
  routeMapUrl?: string;
  posterImage?: string; // small base64 data URI, resized client-side before saving
  // Optional visual preview for a shirt, medal, kit, or another race inclusion.
  inclusionImage?: string;
  // Optional blank race-bib artwork. The runner's name and bib number are
  // overlaid on this template using the organizer-configured positions.
  raceBibTemplateImage?: string;
  raceBibLayout?: RaceBibLayout;
  raceBibCustomFont?: RaceBibCustomFont;
  // Keyed by the distance label stored on registrations (for example, "5K").
  // Falls back to the original single raceBibTemplateImage for old races.
  raceBibTemplatesByDistance?: Record<string, RaceBibTemplate>;
}

export interface PublicLeaderboardEntry {
  bibNumber: string;
  fullName: string;
  // A late/on-site entry can be created before the runner details are known.
  // Public and timing views deliberately identify it by bib only.
  isFreeSlot?: boolean;
  distance: string;
  // `rank` stays for backwards compatibility with already-published result
  // documents. It is the official overall rank for this race division.
  rank: number;
  overallRank?: number;
  categoryRank?: number;
  categoryLabel?: string;
  timingMethod?: 'chip' | 'gun' | 'transition';
  sequenceStartTime?: string;
  // Both elapsed views are published for transparent certificates. `finishTime`
  // remains the official result (chip time when a valid chip start exists;
  // otherwise the documented gun-time fallback).
  chipTime?: string;
  gunTime?: string;
  finishTime: string;
  finishReviewRequired?: boolean;
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
  // Set by the race-kit desk only after the runner has physically received
  // their kit (bib/shirt/timing chip as applicable).
  kitClaimedAt?: string;
  // Race-specific apparel choice. A runner can choose a different shirt size
  // for each event without changing their general account preference.
  shirtSize?: string;
  distance: string;
  entryCategory?: RaceEntryCategory;
  // An organizer links separate bibs for consecutive entries. This entry's
  // clock starts at the previous bib's validated finish, not its wave start.
  startsAfterBib?: string;
  teamName?: string;
  teamMembers?: string[];
  gender: Gender;
  age: number;
  // Group roster sheets may intentionally omit individual ages. Firestore
  // still stores a schema-safe numeric fallback, while this flag ensures it
  // is never presented as a real age or used for a division.
  ageNotProvided?: boolean;
  // A pre-created, anonymous race-day place. It uses a normal unique bib but
  // must never be placed in a gender/age category.
  isFreeSlot?: boolean;
  // Stored on the race registration (not the public leaderboard) so the race
  // organizer has the correct emergency contact for this specific event.
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  // Written only by the trusted payment webhook after PayMongo confirms a
  // successful charge. Browser code must never mark its own registration paid.
  paymentStatus?: 'pending' | 'paid';
  paymentId?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  // Required for a manual GCash/bank/cash-transfer reservation. The organizer
  // checks this against the actual payment dashboard before confirming paid.
  paymentReference?: string;
  paymentPaidAt?: string;
  createdAt: string;
}

export type ChipReadSource = 'manual' | 'rfid-bridge';

export interface ChipRead {
  bridgeEventId?: string;
  antenna?: number;
  readerSequence?: number;
  monotonicTicks?: string;
  monotonicFrequency?: string;
  clockSource?: string;

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
  finishReviewRequired?: boolean;
  finishTime?: string; // formatted HH:MM:SS.ffffff elapsed from 'start' checkpoint to 'finish'
  finishSeconds?: number;
  // Kept independently so a certificate can show both elapsed measurements.
  // Chip time exists only if the runner has a valid individual Start read.
  chipTime?: string;
  chipSeconds?: number;
  gunTime?: string;
  gunSeconds?: number;
  // `rank` remains the legacy/display alias for overallRank. Overall rank is
  // within the same distance and Solo/Duo/Trio division; category rank is
  // within the organizer-configured gender/age bracket of that division.
  rank?: number;
  overallRank?: number;
  categoryRank?: number;
  categoryLabel?: string;
  // A chip start is preferred. Gun is a deliberate per-distance fallback when
  // a crowded start mat misses an otherwise valid finisher.
  timingMethod?: 'chip' | 'gun' | 'transition';
  sequenceStartTime?: string;
}
