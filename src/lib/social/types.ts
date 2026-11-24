export type SocialVisibility = 'public' | 'friends' | 'close_friends';
export type SocialMediaType = 'none' | 'images' | 'video';

export interface SocialMediaItem {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface SocialLocationPin {
  lat: number;
  lon: number;
  label: string;
}

export interface LinkedCourseSnapRef {
  publicationId: string;
  raceId: string;
  raceName: string;
  distanceLabel: string;
  distanceM: number;
}

export interface SocialPostRecord {
  postId: string;
  uid: string;
  visibility: SocialVisibility;
  text: string;
  mediaType: SocialMediaType;
  mediaItems: SocialMediaItem[];
  attachedBadgeId: string | null;
  attachedClubId: string | null;
  attachedRaceId: string | null;
  attachedRunId: string | null;
  location: SocialLocationPin | null;
  linkedCourse?: LinkedCourseSnapRef | null;
  repostOfPostId: string | null;
  authorDisplayName?: string;
  authorUsername?: string;
  authorPhotoURL?: string;
  kudosCount: number;
  commentsCount: number;
  repostsCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SocialCommentRecord {
  commentId: string;
  postId: string;
  uid: string;
  text: string;
  replyToCommentId: string | null;
  authorDisplayName?: string;
  authorUsername?: string;
  createdAt: string;
  deletedAt: string | null;
}

export type ContentReportTargetType = 'post' | 'comment' | 'message' | 'user' | 'club';

export type ContentReportReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'inappropriate_media'
  | 'impersonation'
  | 'other';

export type ContentReportStatus = 'open' | 'dismissed' | 'action_taken';

export interface ContentReportRecord {
  reportId: string;
  reporterUid: string;
  targetType: ContentReportTargetType;
  targetId: string;
  targetParentId?: string;
  targetUid?: string;
  reason: ContentReportReason;
  details: string;
  status: ContentReportStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RouteSnapPin {
  snapId: string;
  postId: string;
  uid: string;
  visibility: SocialVisibility;
  lat: number;
  lon: number;
  label: string;
  publicationId: string | null;
  raceId: string | null;
  captionPreview: string;
  thumbnailPath: string;
  thumbnailUrl: string;
  createdAt: string;
}
