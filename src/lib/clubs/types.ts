export type ClubJoinPolicy = 'open' | 'approval' | 'invite_only';

export type ClubModuleKey =
  | 'chat'
  | 'leaderboard'
  | 'events'
  | 'badges'
  | 'routeLibrary'
  | 'announcements'
  | 'memberSpotlight'
  | 'customTheme';

export type ClubModuleMap = Record<ClubModuleKey, boolean>;

export type ClubBillingTier = 'free' | 'community' | 'pro';
export type ClubSubscriptionStatus = 'active' | 'trial' | 'past_due' | 'canceled';
export type ClubBillingProvider = 'admin_manual' | 'paymongo';
export type ClubStatus = 'active' | 'archived';
export type ClubMemberStatus = 'active' | 'pending' | 'removed';
export type ClubMemberRole = 'member' | 'captain';
export type ClubRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ClubDefinition {
  clubId: string;
  name: string;
  description: string;
  city: string;
  scheduleSummary: string;
  joinPolicy: ClubJoinPolicy;
  modules: ClubModuleMap;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  logoStoragePath?: string;
  coverUrl: string;
  coverStoragePath?: string;
  captainUids: string[];
  linkedBadgeIds: string[];
  featuredRouteIds: string[];
  linkedRaceIds: string[];
  memberLimit: number | null;
  billingTier: ClubBillingTier;
  subscriptionStatus: ClubSubscriptionStatus;
  billingProvider: ClubBillingProvider;
  paymongoCustomerId?: string;
  paymongoSubscriptionId?: string;
  status: ClubStatus;
  memberCount: number;
  requestCount: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ClubMemberRecord {
  id: string;
  clubId: string;
  uid: string;
  role: ClubMemberRole;
  status: ClubMemberStatus;
  displayName?: string;
  username?: string;
  joinedAt: string;
  updatedAt: string;
}

export interface ClubMeetupRecord {
  meetupId: string;
  clubId: string;
  title: string;
  description: string;
  startAtIso: string;
  locationName: string;
  lat: number | null;
  lon: number | null;
  routeId: string | null;
  distanceLabel: string;
  status: 'scheduled' | 'canceled';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface ClubAnnouncementRecord {
  announcementId: string;
  clubId: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface ClubSpotlightRecord {
  clubId: string;
  targetUid: string;
  headline: string;
  note: string;
  featuredAt: string;
  featuredBy: string;
}

export interface ClubRequestRecord {
  requestId: string;
  requesterUid: string;
  clubName: string;
  city: string;
  scheduleSummary: string;
  notes: string;
  contactHandle: string;
  desiredModules: ClubModuleMap;
  status: ClubRequestStatus;
  reviewedClubId?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClubLeaderboardEntry {
  uid: string;
  displayName: string;
  username?: string;
  role: ClubMemberRole;
  totalDistanceM: number;
  totalMovingTimeMs: number;
  totalElevationGainM: number;
  verifiedRunsCount: number;
}
