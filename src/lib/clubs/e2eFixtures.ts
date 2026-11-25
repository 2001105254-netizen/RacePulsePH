import { CommunityRunApiError } from '../runs/communityRunsClient';
import {
  readDevSessionJson,
  writeDevSessionJson,
} from '../badges/e2eFixtures';
import { validateClubAssetUploadFile } from './client';
import { draftToPreviewClub, validateAndBuildClubSavePayload, type ClubFormDraft } from './studioDraft';
import type {
  ClubDefinition,
  ClubMemberRecord,
  ClubRequestRecord,
  ClubStatus,
} from './types';
import type { ContentReportRecord, SocialPostRecord } from '../social/types';

export { readDevSessionJson, writeDevSessionJson };

export const E2E_CLUBS_KEY = 'racepulse_e2e_clubs';
export const E2E_CLUB_REQUESTS_KEY = 'racepulse_e2e_club_requests';
export const E2E_CLUB_MEMBERS_KEY = 'racepulse_e2e_club_members';
export const E2E_CONTENT_REPORTS_KEY = 'racepulse_e2e_content_reports';
export const E2E_SOCIAL_POSTS_KEY = 'racepulse_e2e_social_posts';
export const E2E_ROUTE_SNAPS_KEY = 'racepulse_e2e_route_snaps';
export const E2E_CONVERSATIONS_KEY = 'racepulse_e2e_conversations';
export const E2E_STREAKS_KEY = 'racepulse_e2e_friend_streaks';
export const E2E_NOTIFICATIONS_KEY = 'racepulse_e2e_notifications';

export function buildDevStarterClubs(nowIso = new Date().toISOString()): ClubDefinition[] {
  return [
    {
      clubId: 'manila_sunrise_pacers',
      name: 'Manila Sunrise Pacers',
      description: 'Roxas Boulevard tempo and long-run crew for road and marathon builds.',
      city: 'Manila',
      scheduleSummary: 'Tue & Sat 05:15 AM PHT',
      joinPolicy: 'open',
      modules: {
        chat: true,
        leaderboard: true,
        events: true,
        badges: true,
        routeLibrary: true,
        announcements: true,
        memberSpotlight: true,
        customTheme: true,
      },
      primaryColor: '#DC2626',
      accentColor: '#F59E0B',
      logoUrl: '',
      logoStoragePath: '',
      coverUrl: '',
      coverStoragePath: '',
      captainUids: ['e2e-runner'],
      linkedBadgeIds: ['welcome_ka_racepulse'],
      featuredRouteIds: [],
      linkedRaceIds: [],
      memberLimit: 300,
      billingTier: 'community',
      subscriptionStatus: 'active',
      billingProvider: 'admin_manual',
      status: 'active',
      memberCount: 2,
      requestCount: 0,
      createdAt: nowIso,
      createdBy: 'e2e-admin',
      updatedAt: nowIso,
      updatedBy: 'e2e-admin',
    },
  ];
}

export function saveDevClubFixture(
  existingClubs: readonly ClubDefinition[],
  draft: ClubFormDraft,
  actorUid = 'e2e-admin',
  nowIso = new Date().toISOString(),
): { clubs: ClubDefinition[]; saved: ClubDefinition } {
  const checked = validateAndBuildClubSavePayload(draft);
  if (!checked.ok) {
    throw new CommunityRunApiError(checked.errors[0] || 'Invalid club draft.', 400);
  }
  const preview = draftToPreviewClub(draft, actorUid);
  const prev = existingClubs.find((c) => c.clubId === checked.payload.clubId) || null;
  const saved: ClubDefinition = {
    ...preview,
    ...checked.payload,
    memberCount: Math.max(prev?.memberCount ?? 0, checked.payload.captainUids.length),
    requestCount: prev?.requestCount ?? 0,
    createdAt: prev?.createdAt ?? nowIso,
    createdBy: prev?.createdBy ?? actorUid,
    updatedAt: nowIso,
    updatedBy: actorUid,
  };
  const nextClubs = [...existingClubs.filter((c) => c.clubId !== saved.clubId), saved].sort(
    (a, b) => b.memberCount - a.memberCount || a.clubId.localeCompare(b.clubId),
  );
  writeDevSessionJson(E2E_CLUBS_KEY, nextClubs);
  return { clubs: nextClubs, saved };
}

export function archiveDevClubFixture(
  existingClubs: readonly ClubDefinition[],
  clubId: string,
  status: ClubStatus,
  nowIso = new Date().toISOString(),
): ClubDefinition[] {
  const next = existingClubs.map((c) =>
    c.clubId === clubId ? { ...c, status, updatedAt: nowIso } : c,
  );
  writeDevSessionJson(E2E_CLUBS_KEY, next);
  return next;
}

export function deleteDevClubFixture(
  existingClubs: readonly ClubDefinition[],
  clubId: string,
): ClubDefinition[] {
  const next = existingClubs.filter((c) => c.clubId !== clubId);
  writeDevSessionJson(E2E_CLUBS_KEY, next);
  return next;
}

export async function uploadDevClubAssetFixture(
  uid: string,
  clubId: string,
  kind: 'logo' | 'cover',
  file: File,
): Promise<{ url: string; storagePath: string }> {
  const validation = validateClubAssetUploadFile(file);
  if (!validation.ok) {
    throw new CommunityRunApiError(validation.error, 400);
  }
  const safeUid = uid.trim() || 'e2e-admin';
  const safeClub = clubId.trim() || 'new_club';
  const storagePath = `club-assets/${safeUid}/${safeClub}/${kind}_${validation.safeFilename}`;
  const encodedPath = encodeURIComponent(storagePath);
  return {
    storagePath,
    url: `https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/${encodedPath}?alt=media`,
  };
}

export function resolveDevClubRequestFixture(
  existingRequests: readonly ClubRequestRecord[],
  existingClubs: readonly ClubDefinition[],
  input: {
    clubRequestId: string;
    decision: 'approved' | 'rejected';
    reviewNote?: string;
    actorUid?: string;
    clubPayload?: ClubFormDraft;
    nowIso?: string;
  },
): { requests: ClubRequestRecord[]; clubs: ClubDefinition[] } {
  const nowIso = input.nowIso || new Date().toISOString();
  const actorUid = input.actorUid || 'e2e-admin';
  let nextClubs = [...existingClubs];
  let createdClubId: string | undefined;

  if (input.decision === 'approved' && input.clubPayload) {
    const saved = saveDevClubFixture(existingClubs, input.clubPayload, actorUid, nowIso);
    nextClubs = saved.clubs;
    createdClubId = saved.saved.clubId;
  }

  const nextRequests = existingRequests.map((req) =>
    req.requestId === input.clubRequestId
      ? {
          ...req,
          status: input.decision,
          ...(createdClubId ? { reviewedClubId: createdClubId } : {}),
          ...(input.reviewNote ? { reviewNote: input.reviewNote } : {}),
          updatedAt: nowIso,
        }
      : req,
  );
  writeDevSessionJson(E2E_CLUB_REQUESTS_KEY, nextRequests);
  return { requests: nextRequests, clubs: nextClubs };
}

export function manageDevClubMemberFixture(
  existingMembers: readonly ClubMemberRecord[],
  existingClubs: readonly ClubDefinition[],
  input: {
    clubId: string;
    targetUid: string;
    action: 'approve' | 'reject' | 'remove' | 'invite' | 'promote_captain' | 'demote_captain';
    displayName?: string;
    nowIso?: string;
  },
): { members: ClubMemberRecord[]; clubs: ClubDefinition[] } {
  const nowIso = input.nowIso || new Date().toISOString();
  const docId = `${input.clubId}_${input.targetUid}`;
  const current = existingMembers.find((m) => m.id === docId || (m.clubId === input.clubId && m.uid === input.targetUid));
  let nextMembers = existingMembers.filter((m) => !(m.clubId === input.clubId && m.uid === input.targetUid));

  if (input.action === 'approve' || input.action === 'invite') {
    nextMembers = [
      ...nextMembers,
      {
        id: docId,
        clubId: input.clubId,
        uid: input.targetUid,
        role: current?.role === 'captain' ? 'captain' : 'member',
        status: 'active',
        displayName: current?.displayName || input.displayName || input.targetUid,
        joinedAt: current?.joinedAt || nowIso,
        updatedAt: nowIso,
      },
    ];
  } else if (input.action === 'promote_captain' && current) {
    nextMembers = [...nextMembers, { ...current, role: 'captain', status: 'active', updatedAt: nowIso }];
  } else if (input.action === 'demote_captain' && current) {
    nextMembers = [...nextMembers, { ...current, role: 'member', updatedAt: nowIso }];
  }

  const nextClubs = existingClubs.map((club) => {
    if (club.clubId !== input.clubId) return club;
    const clubMems = nextMembers.filter((m) => m.clubId === input.clubId);
    return {
      ...club,
      memberCount: clubMems.filter((m) => m.status === 'active').length,
      requestCount: clubMems.filter((m) => m.status === 'pending').length,
      captainUids: clubMems.filter((m) => m.status === 'active' && m.role === 'captain').map((m) => m.uid),
      updatedAt: nowIso,
    };
  });

  writeDevSessionJson(E2E_CLUB_MEMBERS_KEY, nextMembers);
  writeDevSessionJson(E2E_CLUBS_KEY, nextClubs);
  return { members: nextMembers, clubs: nextClubs };
}

export function resolveDevContentReportFixture(
  existingReports: readonly ContentReportRecord[],
  existingPosts: readonly SocialPostRecord[],
  input: {
    reportId: string;
    action: 'dismiss' | 'hide_content' | 'delete_content';
    actorUid?: string;
    resolutionNote?: string;
    nowIso?: string;
  },
): { reports: ContentReportRecord[]; posts: SocialPostRecord[] } {
  const nowIso = input.nowIso || new Date().toISOString();
  const actorUid = input.actorUid || 'e2e-admin';
  const targetReport = existingReports.find((r) => r.reportId === input.reportId);

  const nextPosts =
    targetReport && targetReport.targetType === 'post' && input.action !== 'dismiss'
      ? existingPosts.map((p) => {
          if (p.postId !== targetReport.targetId) return p;
          if (input.action === 'delete_content') {
            return { ...p, deletedAt: nowIso, hiddenByModeration: true, updatedAt: nowIso };
          }
          return { ...p, hiddenByModeration: true, updatedAt: nowIso };
        })
      : [...existingPosts];

  const nextReports = existingReports.map((rep) =>
    rep.reportId === input.reportId
      ? {
          ...rep,
          status: (input.action === 'dismiss' ? 'dismissed' : 'action_taken') as ContentReportRecord['status'],
          reviewedBy: actorUid,
          reviewedAt: nowIso,
          ...(input.resolutionNote ? { resolutionNote: input.resolutionNote } : {}),
          updatedAt: nowIso,
        }
      : rep,
  );

  writeDevSessionJson(E2E_CONTENT_REPORTS_KEY, nextReports);
  writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, nextPosts);
  return { reports: nextReports, posts: nextPosts };
}
