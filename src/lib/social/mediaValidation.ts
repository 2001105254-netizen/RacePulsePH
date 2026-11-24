import type { ContentReportReason, SocialVisibility } from './types';

export const SOCIAL_VISIBILITIES: readonly SocialVisibility[] = [
  'public',
  'friends',
  'close_friends',
] as const;

export const REPORT_REASONS: readonly ContentReportReason[] = [
  'spam',
  'harassment',
  'hate_speech',
  'inappropriate_media',
  'impersonation',
  'other',
] as const;

export const MAX_POST_IMAGES = 4;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SEC = 60;
export const MAX_POST_TEXT_CHARS = 1000;
export const MAX_COMMENT_TEXT_CHARS = 500;
export const ROUTE_SNAP_LINK_RADIUS_M = 100;

const ALLOWED_IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|avif)$/i;
const ALLOWED_IMAGE_MIME_SET = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
]);

const ALLOWED_VIDEO_EXT_RE = /\.(mp4|webm)$/i;
const ALLOWED_VIDEO_MIME_SET = new Set(['video/mp4', 'video/webm']);

export const SOCIAL_VISIBILITY_META: Readonly<
  Record<SocialVisibility, { label: string; description: string }>
> = {
  public: {
    label: 'Public',
    description: 'Visible in Discover, public route snaps, and repostable by community runners.',
  },
  friends: {
    label: 'Friends Only',
    description: 'Visible to accepted friends with private signed media and no public reposts.',
  },
  close_friends: {
    label: 'Close Friends',
    description: 'Visible only to your curated Close Friends circle.',
  },
};

export const REPORT_REASON_META: Readonly<Record<ContentReportReason, string>> = {
  spam: 'Spam or commercial promotion',
  harassment: 'Harassment or abusive conduct',
  hate_speech: 'Hate speech or discrimination',
  inappropriate_media: 'Unsafe or graphic photo or video',
  impersonation: 'Account or organizer impersonation',
  other: 'Other safety concern',
};

export type MediaValidationResult =
  | { ok: true; ext: string; mimeType: string }
  | { ok: false; error: string };

export function validateSocialImageFile(file: {
  name: string;
  type: string;
  size: number;
}): MediaValidationResult {
  const mime = (file.type || '').trim().toLowerCase();
  const extMatch = ALLOWED_IMAGE_EXT_RE.exec(file.name.trim());
  if (!extMatch || !ALLOWED_IMAGE_MIME_SET.has(mime)) {
    return { ok: false, error: 'Upload PNG, JPEG, WebP, or AVIF images only (SVG is not allowed).' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'Each image must be larger than 0 bytes and under 8 MB.' };
  }
  return { ok: true, ext: extMatch[1].toLowerCase(), mimeType: mime };
}

export function validateSocialVideoMetadata(video: {
  name: string;
  type: string;
  size: number;
  durationSec: number;
}): MediaValidationResult {
  const mime = (video.type || '').trim().toLowerCase();
  const extMatch = ALLOWED_VIDEO_EXT_RE.exec(video.name.trim());
  if (!extMatch || !ALLOWED_VIDEO_MIME_SET.has(mime)) {
    return { ok: false, error: 'Short videos must use MP4 or WebM format.' };
  }
  if (!Number.isFinite(video.size) || video.size <= 0 || video.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: 'Video must be under 30 MB.' };
  }
  if (
    !Number.isFinite(video.durationSec) ||
    video.durationSec <= 0 ||
    video.durationSec > MAX_VIDEO_DURATION_SEC
  ) {
    return { ok: false, error: `Video duration must be 1 to ${MAX_VIDEO_DURATION_SEC} seconds.` };
  }
  return { ok: true, ext: extMatch[1].toLowerCase(), mimeType: mime };
}
