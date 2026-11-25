import { CommunityRunApiError } from '../runs/communityRunsClient';
import {
  readDevSessionJson,
  writeDevSessionJson,
} from '../badges/e2eFixtures';
import { validateClubAssetUploadFile } from './client';
import { draftToPreviewClub, validateAndBuildClubSavePayload, type ClubFormDraft } from './studioDraft';
import type {
  ClubAnnouncementRecord,
  ClubDefinition,
  ClubLeaderboardEntry,
  ClubMeetupRecord,
  ClubMemberRecord,
  ClubModuleMap,
  ClubRequestRecord,
  ClubSpotlightRecord,
  ClubStatus,
} from './types';
import type {
  ContentReportReason,
  ContentReportRecord,
  ContentReportTargetType,
  PublicRunnerProfile,
  RouteSnapPin,
  SocialCommentRecord,
  SocialLocationPin,
  SocialMediaItem,
  SocialMediaType,
  SocialPostRecord,
  SocialVisibility,
} from '../social/types';

export { readDevSessionJson, writeDevSessionJson };

export const E2E_CLUBS_KEY = 'racepulse_e2e_clubs';
export const E2E_CLUB_REQUESTS_KEY = 'racepulse_e2e_club_requests';
export const E2E_CLUB_MEMBERS_KEY = 'racepulse_e2e_club_members';
export const E2E_CLUB_MEETUPS_KEY = 'racepulse_e2e_club_meetups';
export const E2E_CLUB_ANNOUNCEMENTS_KEY = 'racepulse_e2e_club_announcements';
export const E2E_CLUB_SPOTLIGHTS_KEY = 'racepulse_e2e_club_spotlights';
export const E2E_CONTENT_REPORTS_KEY = 'racepulse_e2e_content_reports';
export const E2E_SOCIAL_POSTS_KEY = 'racepulse_e2e_social_posts';
export const E2E_SOCIAL_COMMENTS_KEY = 'racepulse_e2e_social_comments';
export const E2E_SOCIAL_KUDOS_KEY = 'racepulse_e2e_social_kudos';
export const E2E_CLOSE_FRIENDS_KEY = 'racepulse_e2e_close_friends';
export const E2E_USER_BLOCKS_KEY = 'racepulse_e2e_user_blocks';
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

export function buildDevStarterSocialPosts(
  nowIso = new Date().toISOString(),
): SocialPostRecord[] {
  return [
    {
      postId: 'e2e_post_pub_1',
      uid: 'e2e-friend-1',
      visibility: 'public',
      text: 'Burnham Park sunrise shakeout before Baguio 21K packet pickup.',
      mediaType: 'none',
      mediaItems: [],
      attachedBadgeId: null,
      attachedClubId: 'manila_sunrise_pacers',
      attachedRaceId: null,
      attachedRunId: null,
      location: { lat: 16.412, lon: 120.593, label: 'Burnham Lake Drive' },
      repostOfPostId: null,
      authorDisplayName: 'Maya Santos',
      authorUsername: 'maya_pacers',
      kudosCount: 4,
      commentsCount: 1,
      repostsCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
    {
      postId: 'e2e_post_fr_1',
      uid: 'e2e-friend-1',
      visibility: 'friends',
      text: 'Crew splits locked in at 5:05/km through Camp John Hay.',
      mediaType: 'none',
      mediaItems: [],
      attachedBadgeId: null,
      attachedClubId: null,
      attachedRaceId: null,
      attachedRunId: null,
      location: { lat: 16.398, lon: 120.614, label: 'Camp John Hay Gate' },
      repostOfPostId: null,
      authorDisplayName: 'Maya Santos',
      authorUsername: 'maya_pacers',
      kudosCount: 2,
      commentsCount: 0,
      repostsCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    },
  ];
}

export function buildDevStarterRouteSnaps(
  nowIso = new Date().toISOString(),
): RouteSnapPin[] {
  return [
    {
      snapId: 'e2e_post_pub_1',
      postId: 'e2e_post_pub_1',
      uid: 'e2e-friend-1',
      visibility: 'public',
      lat: 16.412,
      lon: 120.593,
      label: 'Burnham Lake Drive',
      publicationId: 'demo_baguio_21k_v1',
      raceId: 'demo-baguio-mountain-2026',
      captionPreview: 'Burnham Park sunrise shakeout before Baguio 21K packet pickup.',
      thumbnailPath: '',
      thumbnailUrl: '',
      createdAt: nowIso,
    },
    {
      snapId: 'e2e_post_fr_1',
      postId: 'e2e_post_fr_1',
      uid: 'e2e-friend-1',
      visibility: 'friends',
      lat: 16.398,
      lon: 120.614,
      label: 'Camp John Hay Gate',
      publicationId: 'demo_baguio_21k_v1',
      raceId: 'demo-baguio-mountain-2026',
      captionPreview: 'Crew splits locked in at 5:05/km through Camp John Hay.',
      thumbnailPath: '',
      thumbnailUrl: '',
      createdAt: nowIso,
    },
  ];
}

export function toggleDevClubMembershipFixture(
  existingClubs: readonly ClubDefinition[],
  existingMembers: readonly ClubMemberRecord[],
  input: {
    clubId: string;
    uid: string;
    displayName: string;
    username?: string;
    mode: 'join' | 'leave';
    nowIso?: string;
  },
): { clubs: ClubDefinition[]; members: ClubMemberRecord[]; status: 'joined' | 'pending' | 'left' } {
  const nowIso = input.nowIso || new Date().toISOString();
  const targetClub = existingClubs.find((c) => c.clubId === input.clubId);
  if (!targetClub) {
    throw new CommunityRunApiError('Club not found.', 404);
  }
  const docId = `${input.clubId}_${input.uid}`;
  let nextMembers = existingMembers.filter(
    (m) => !(m.clubId === input.clubId && m.uid === input.uid),
  );
  let outcome: 'joined' | 'pending' | 'left' = 'left';

  if (input.mode === 'join') {
    if (targetClub.joinPolicy === 'invite_only') {
      throw new CommunityRunApiError('This club is invite-only.', 403);
    }
    const status = targetClub.joinPolicy === 'approval' ? 'pending' : 'active';
    outcome = status === 'pending' ? 'pending' : 'joined';
    nextMembers = [
      ...nextMembers,
      {
        id: docId,
        clubId: input.clubId,
        uid: input.uid,
        role: targetClub.captainUids.includes(input.uid) ? 'captain' : 'member',
        status,
        displayName: input.displayName,
        ...(input.username ? { username: input.username } : {}),
        joinedAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }

  const clubMems = nextMembers.filter((m) => m.clubId === input.clubId);
  const nextClubs = existingClubs.map((c) =>
    c.clubId === input.clubId
      ? {
          ...c,
          memberCount: clubMems.filter((m) => m.status === 'active').length,
          requestCount: clubMems.filter((m) => m.status === 'pending').length,
          updatedAt: nowIso,
        }
      : c,
  );
  writeDevSessionJson(E2E_CLUB_MEMBERS_KEY, nextMembers);
  writeDevSessionJson(E2E_CLUBS_KEY, nextClubs);
  return { clubs: nextClubs, members: nextMembers, status: outcome };
}

export function submitDevClubRequestFixture(
  existingRequests: readonly ClubRequestRecord[],
  input: {
    requestId: string;
    requesterUid: string;
    clubName: string;
    city: string;
    scheduleSummary: string;
    notes?: string;
    contactHandle?: string;
    desiredModules: ClubModuleMap;
    nowIso?: string;
  },
): { requests: ClubRequestRecord[]; created: ClubRequestRecord } {
  const nowIso = input.nowIso || new Date().toISOString();
  const created: ClubRequestRecord = {
    requestId: input.requestId,
    requesterUid: input.requesterUid,
    clubName: input.clubName.trim(),
    city: input.city.trim(),
    scheduleSummary: input.scheduleSummary.trim(),
    notes: (input.notes || '').trim(),
    contactHandle: (input.contactHandle || '').trim(),
    desiredModules: { ...input.desiredModules },
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const requests = [created, ...existingRequests];
  writeDevSessionJson(E2E_CLUB_REQUESTS_KEY, requests);
  return { requests, created };
}

export function createDevSocialPostFixture(
  existingPosts: readonly SocialPostRecord[],
  input: {
    postId: string;
    uid: string;
    displayName: string;
    username?: string;
    visibility: SocialVisibility;
    text: string;
    mediaType?: SocialMediaType;
    mediaItems?: SocialMediaItem[];
    attachedBadgeId?: string | null;
    attachedClubId?: string | null;
    attachedRaceId?: string | null;
    attachedRunId?: string | null;
    location?: SocialLocationPin | null;
    repostOfPostId?: string | null;
    nowIso?: string;
  },
): SocialPostRecord[] {
  const nowIso = input.nowIso || new Date().toISOString();
  const post: SocialPostRecord = {
    postId: input.postId,
    uid: input.uid,
    visibility: input.visibility,
    text: input.text.trim(),
    mediaType: input.mediaType || 'none',
    mediaItems: input.mediaItems || [],
    attachedBadgeId: input.attachedBadgeId ?? null,
    attachedClubId: input.attachedClubId ?? null,
    attachedRaceId: input.attachedRaceId ?? null,
    attachedRunId: input.attachedRunId ?? null,
    location: input.location ?? null,
    repostOfPostId: input.repostOfPostId ?? null,
    authorDisplayName: input.displayName,
    ...(input.username ? { authorUsername: input.username } : {}),
    kudosCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
  const next = [
    post,
    ...existingPosts.map((p) =>
      input.repostOfPostId && p.postId === input.repostOfPostId
        ? { ...p, repostsCount: (p.repostsCount || 0) + 1 }
        : p,
    ),
  ];
  writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, next);
  return next;
}

export function toggleDevKudosFixture(
  existingPosts: readonly SocialPostRecord[],
  likedPostIds: ReadonlySet<string>,
  postId: string,
): { posts: SocialPostRecord[]; likedPostIds: Set<string>; liked: boolean } {
  const nextLiked = new Set(likedPostIds);
  const wasLiked = nextLiked.has(postId);
  if (wasLiked) nextLiked.delete(postId);
  else nextLiked.add(postId);

  const posts = existingPosts.map((p) =>
    p.postId === postId
      ? {
          ...p,
          kudosCount: Math.max(0, (p.kudosCount || 0) + (wasLiked ? -1 : 1)),
        }
      : p,
  );
  writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, posts);
  writeDevSessionJson(E2E_SOCIAL_KUDOS_KEY, Array.from(nextLiked));
  return { posts, likedPostIds: nextLiked, liked: !wasLiked };
}

export function createDevCommentFixture(
  existingComments: readonly SocialCommentRecord[],
  existingPosts: readonly SocialPostRecord[],
  input: {
    commentId: string;
    postId: string;
    uid: string;
    displayName: string;
    username?: string;
    text: string;
    nowIso?: string;
  },
): { comments: SocialCommentRecord[]; posts: SocialPostRecord[]; created: SocialCommentRecord } {
  const nowIso = input.nowIso || new Date().toISOString();
  const created: SocialCommentRecord = {
    commentId: input.commentId,
    postId: input.postId,
    uid: input.uid,
    text: input.text.trim(),
    replyToCommentId: null,
    authorDisplayName: input.displayName,
    ...(input.username ? { authorUsername: input.username } : {}),
    createdAt: nowIso,
    deletedAt: null,
  };
  const comments = [...existingComments, created];
  const posts = existingPosts.map((p) =>
    p.postId === input.postId ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } : p,
  );
  writeDevSessionJson(E2E_SOCIAL_COMMENTS_KEY, comments);
  writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, posts);
  return { comments, posts, created };
}

export function submitDevReportFixture(
  existingReports: readonly ContentReportRecord[],
  input: {
    reportId: string;
    reporterUid: string;
    targetType: ContentReportTargetType;
    targetId: string;
    targetParentId?: string;
    targetUid?: string;
    reason: ContentReportReason;
    details?: string;
    nowIso?: string;
  },
): { reports: ContentReportRecord[]; created: ContentReportRecord } {
  const nowIso = input.nowIso || new Date().toISOString();
  const created: ContentReportRecord = {
    reportId: input.reportId,
    reporterUid: input.reporterUid,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.targetParentId ? { targetParentId: input.targetParentId } : {}),
    ...(input.targetUid ? { targetUid: input.targetUid } : {}),
    reason: input.reason,
    details: (input.details || '').trim(),
    status: 'open',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const reports = [created, ...existingReports];
  writeDevSessionJson(E2E_CONTENT_REPORTS_KEY, reports);
  return { reports, created };
}

export function toggleDevCloseFriendFixture(
  existingSet: ReadonlySet<string>,
  targetUid: string,
  enabled?: boolean,
): Set<string> {
  const next = new Set(existingSet);
  const shouldEnable = enabled !== undefined ? enabled : !next.has(targetUid);
  if (shouldEnable) next.add(targetUid);
  else next.delete(targetUid);
  writeDevSessionJson(E2E_CLOSE_FRIENDS_KEY, Array.from(next));
  return next;
}

export function toggleDevUserBlockFixture(
  existingBlockedUids: readonly string[],
  targetUid: string,
  blocked: boolean,
): string[] {
  const next = blocked
    ? Array.from(new Set([...existingBlockedUids, targetUid]))
    : existingBlockedUids.filter((u) => u !== targetUid);
  writeDevSessionJson(E2E_USER_BLOCKS_KEY, next);
  return next;
}

export function buildDevPublicRunnerProfileFixture(
  targetUid: string,
): PublicRunnerProfile {
  return {
    uid: targetUid,
    displayName: targetUid === 'e2e-friend-1' ? 'Maya Santos' : 'Runner Member',
    username: targetUid === 'e2e-friend-1' ? 'maya_pacers' : 'runner_ph',
    primaryClubId: 'manila_sunrise_pacers',
    primaryClubName: 'Manila Sunrise Pacers',
    bio: 'Tempo mornings and weekend ridge loops across the Philippines.',
    location: 'Manila, Philippines',
    favoriteDistance: '21K',
    updatedAt: new Date().toISOString(),
  };
}

export type { ClubAnnouncementRecord, ClubLeaderboardEntry, ClubMeetupRecord, ClubSpotlightRecord };
