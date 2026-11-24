'use strict';

const { geodesicDistanceM } = require('./run-math');
const {
  CLUB_ID_RE,
  assertSafeText,
  assertValidEntityId,
  fail,
  parseStrictIso,
  verifyStorageHttpsUrlMatchesPath,
} = require('./club-engine');

const SOCIAL_VISIBILITIES = ['public', 'friends', 'close_friends'];
const SOCIAL_VISIBILITY_SET = new Set(SOCIAL_VISIBILITIES);

const SOCIAL_MEDIA_TYPES = ['none', 'images', 'video'];
const SOCIAL_MEDIA_TYPE_SET = new Set(SOCIAL_MEDIA_TYPES);

const MAX_POST_TEXT_CHARS = 1000;
const MAX_COMMENT_TEXT_CHARS = 500;
const MAX_POST_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_DURATION_SEC = 60;
const ROUTE_SNAP_LINK_RADIUS_M = 100;

const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'inappropriate_media',
  'impersonation',
  'other',
];
const REPORT_REASON_SET = new Set(REPORT_REASONS);

const REPORT_TARGET_TYPES = ['post', 'comment', 'message', 'user', 'club'];
const REPORT_TARGET_SET = new Set(REPORT_TARGET_TYPES);

const CHAT_MESSAGE_MAX_CHARS = 1000;
const SHARE_CARD_TYPES = ['race', 'run', 'club', 'badge'];
const SHARE_CARD_TYPE_SET = new Set(SHARE_CARD_TYPES);

const INBOX_STREAK_GRACE_INTERVAL_DAYS = 7;
const INBOX_STREAK_MAX_GRACE = 2;

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
]);
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm)$/i;

const ALLOWED_SOCIAL_MEDIA_PATH_RE =
  /^social-media\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|mp4|webm|PNG|JPG|JPEG|WEBP|AVIF|MP4|WEBM)$/;
const ALLOWED_CHAT_MEDIA_PATH_RE =
  /^chat-media\/(dm_[a-zA-Z0-9_-]{1,128}_[a-zA-Z0-9_-]{1,128}|club_[a-zA-Z0-9_-]{2,64})\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}\.(png|jpg|jpeg|webp|avif|PNG|JPG|JPEG|WEBP|AVIF)$/;

const UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function validateLocationInput(rawLoc) {
  if (rawLoc === undefined || rawLoc === null) return null;
  if (typeof rawLoc !== 'object' || Array.isArray(rawLoc)) {
    fail('Location pin must be an object.');
  }
  const lat = Number(rawLoc.lat);
  const lon = Number(rawLoc.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    fail('Location coordinates are out of valid geographic bounds.');
  }
  const label = assertSafeText(rawLoc.label ?? '', {
    label: 'Location label',
    min: 0,
    max: 120,
  });
  return { lat, lon, label };
}

function validatePostMediaItems(mediaType, rawItems, actorUid, postId, visibility) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (mediaType === 'none') {
    if (items.length > 0) {
      fail('mediaItems must be empty when mediaType is none.');
    }
    return [];
  }

  if (mediaType === 'images') {
    if (items.length < 1 || items.length > MAX_POST_IMAGES) {
      fail(`Posts support between 1 and ${MAX_POST_IMAGES} photos.`);
    }
    return items.map((item, idx) => validateSingleMediaItem(item, {
      expectedKind: 'image',
      actorUid,
      postId,
      visibility,
      index: idx,
    }));
  }

  if (mediaType === 'video') {
    if (items.length !== 1) {
      fail('Video posts must contain exactly 1 video attachment.');
    }
    return [
      validateSingleMediaItem(items[0], {
        expectedKind: 'video',
        actorUid,
        postId,
        visibility,
        index: 0,
      }),
    ];
  }

  fail('Unsupported social post mediaType.');
}

function validateSingleMediaItem(item, { expectedKind, actorUid, postId, visibility, index }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    fail(`Media item #${index + 1} must be an object.`);
  }
  const storagePath = typeof item.storagePath === 'string' ? item.storagePath.trim() : '';
  if (!ALLOWED_SOCIAL_MEDIA_PATH_RE.test(storagePath) || storagePath.includes('..')) {
    fail(`Media item #${index + 1} has an invalid social-media storagePath.`);
  }
  const segments = storagePath.split('/');
  if (segments.length !== 4 || segments[1] !== actorUid || segments[2] !== postId) {
    fail(`Media item #${index + 1} storagePath must belong to this user and post.`);
  }

  const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : '';
  const sizeBytes = Number(item.sizeBytes);
  const extRe = expectedKind === 'image' ? IMAGE_EXT_RE : VIDEO_EXT_RE;
  const maxBytes = expectedKind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const allowedMimes = expectedKind === 'image' ? ALLOWED_IMAGE_MIMES : ALLOWED_VIDEO_MIMES;

  if (!extRe.test(segments[3]) || !allowedMimes.has(mimeType)) {
    fail(`Media item #${index + 1} does not match allowed ${expectedKind} formats.`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
    fail(`Media item #${index + 1} exceeds the maximum ${expectedKind} byte limit.`);
  }

  let durationSec = null;
  if (expectedKind === 'video') {
    const dur = Number(item.durationSec);
    if (!Number.isFinite(dur) || dur <= 0 || dur > MAX_VIDEO_DURATION_SEC) {
      fail(`Video duration must be between 1 and ${MAX_VIDEO_DURATION_SEC} seconds.`);
    }
    durationSec = Math.round(dur * 10) / 10;
  }

  // Private Friends/Close Friends posts never persist permanent tokenized URLs.
  let safeUrl = '';
  if (visibility === 'public' && typeof item.url === 'string' && item.url.trim()) {
    safeUrl = verifyStorageHttpsUrlMatchesPath({
      rawUrl: item.url,
      storagePath,
      expectedPrefix: 'social-media',
      allowedExtRe: extRe,
      label: `Post ${expectedKind}`,
    });
  }

  const width =
    Number.isInteger(item.width) && item.width > 0 && item.width <= 10000 ? item.width : null;
  const height =
    Number.isInteger(item.height) && item.height > 0 && item.height <= 10000 ? item.height : null;

  return {
    storagePath,
    mimeType,
    sizeBytes,
    url: safeUrl,
    ...(durationSec !== null ? { durationSec } : {}),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
  };
}

function validateSocialPostInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Post payload must be an object.');
  }
  const uid = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const postId = assertValidEntityId(input.postId, 'postId');

  const visibility = typeof input.visibility === 'string' ? input.visibility.trim() : 'public';
  if (!SOCIAL_VISIBILITY_SET.has(visibility)) {
    fail('Post visibility must be public, friends, or close_friends.');
  }

  const text = assertSafeText(input.text ?? '', {
    label: 'Post caption',
    min: 0,
    max: MAX_POST_TEXT_CHARS,
  });

  const rawMediaType = typeof input.mediaType === 'string' ? input.mediaType.trim() : 'none';
  if (!SOCIAL_MEDIA_TYPE_SET.has(rawMediaType)) {
    fail('Invalid mediaType.');
  }
  const mediaItems = validatePostMediaItems(
    rawMediaType,
    input.mediaItems,
    uid,
    postId,
    visibility,
  );

  const repostOfPostId =
    input.repostOfPostId !== undefined && input.repostOfPostId !== null && input.repostOfPostId !== ''
      ? assertValidEntityId(input.repostOfPostId, 'repostOfPostId')
      : null;
  if (repostOfPostId && input.repostOriginVisibility && input.repostOriginVisibility !== 'public') {
    fail('Only public posts can be reposted.', 403);
  }

  if (!text && mediaItems.length === 0 && !repostOfPostId) {
    fail('Post must include caption text, media, or a repost.');
  }

  const attachedBadgeId = input.attachedBadgeId
    ? assertValidEntityId(input.attachedBadgeId, 'attachedBadgeId')
    : null;
  const attachedClubId = input.attachedClubId
    ? assertValidEntityId(input.attachedClubId, 'attachedClubId', CLUB_ID_RE)
    : null;
  const attachedRaceId = input.attachedRaceId
    ? assertValidEntityId(input.attachedRaceId, 'attachedRaceId')
    : null;
  const attachedRunId = input.attachedRunId
    ? assertValidEntityId(input.attachedRunId, 'attachedRunId')
    : null;

  const location = validateLocationInput(input.location);

  return {
    postId,
    uid,
    visibility,
    text,
    mediaType: rawMediaType,
    mediaItems,
    attachedBadgeId,
    attachedClubId,
    attachedRaceId,
    attachedRunId,
    location,
    repostOfPostId,
    kudosCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    createdAt: nowParsed.iso,
    updatedAt: nowParsed.iso,
    deletedAt: null,
  };
}

function validatePostRepostPermission(sourcePost) {
  if (!sourcePost || typeof sourcePost !== 'object' || sourcePost.deletedAt) {
    fail('Source post is unavailable for reposting.', 404);
  }
  if (sourcePost.visibility !== 'public') {
    fail('Private friends and close friends posts cannot be reposted.', 403);
  }
  return true;
}

function extractCoursePoints(course) {
  if (Array.isArray(course?.previewPolyline) && course.previewPolyline.length > 0) {
    return course.previewPolyline
      .map((pt) =>
        Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
          ? { lat: pt[1], lon: pt[0] }
          : null,
      )
      .filter(Boolean);
  }
  if (Array.isArray(course?.coordinates) && course.coordinates.length > 0) {
    return course.coordinates;
  }
  if (Array.isArray(course?.trackPoints) && course.trackPoints.length > 0) {
    return course.trackPoints;
  }
  return [];
}

function findNearestCourseCorridorMatch(
  location,
  publishedCourses = [],
  maxRadiusM = ROUTE_SNAP_LINK_RADIUS_M,
) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
    return null;
  }
  let best = null;
  for (const course of publishedCourses) {
    if (!course) continue;
    const pts = extractCoursePoints(course);
    let minForCourse = Infinity;
    for (const pt of pts) {
      const dist = geodesicDistanceM(location, pt);
      if (Number.isFinite(dist) && dist < minForCourse) {
        minForCourse = dist;
      }
    }
    if (minForCourse <= maxRadiusM && (!best || minForCourse < best.distanceM)) {
      best = {
        publicationId: String(course.publicationId || course.id || ''),
        raceId: String(course.raceId || ''),
        raceName: String(course.raceName || ''),
        distanceLabel: String(course.distanceLabel || ''),
        distanceM: Math.round(minForCourse * 10) / 10,
      };
    }
  }
  return best;
}

function validateCommentInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Comment payload must be an object.');
  }
  const uid = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const commentId = assertValidEntityId(input.commentId, 'commentId');
  const postId = assertValidEntityId(input.postId, 'postId');
  const text = assertSafeText(input.text, {
    label: 'Comment',
    min: 1,
    max: MAX_COMMENT_TEXT_CHARS,
  });
  const replyToCommentId =
    input.replyToCommentId !== undefined && input.replyToCommentId !== null && input.replyToCommentId !== ''
      ? assertValidEntityId(input.replyToCommentId, 'replyToCommentId')
      : null;

  return {
    commentId,
    postId,
    uid,
    text,
    replyToCommentId,
    createdAt: nowParsed.iso,
    deletedAt: null,
  };
}

function validateContentReportInput(input, actorUid, nowIso = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Report payload must be an object.');
  }
  const reporterUid = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const reportId = assertValidEntityId(input.reportId, 'reportId');
  const targetType = typeof input.targetType === 'string' ? input.targetType.trim() : '';
  if (!REPORT_TARGET_SET.has(targetType)) {
    fail('Unsupported report targetType.');
  }
  const targetId = assertSafeText(input.targetId, { label: 'targetId', min: 1, max: 128 });
  const targetParentId = assertSafeText(input.targetParentId ?? '', {
    label: 'targetParentId',
    min: 0,
    max: 160,
  });
  const targetUid = assertSafeText(input.targetUid ?? '', {
    label: 'targetUid',
    min: 0,
    max: 128,
  });
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!REPORT_REASON_SET.has(reason)) {
    fail('Unsupported report reason.');
  }
  const details = assertSafeText(input.details ?? '', {
    label: 'Report details',
    min: 0,
    max: 500,
  });

  return {
    reportId,
    reporterUid,
    targetType,
    targetId,
    ...(targetParentId ? { targetParentId } : {}),
    ...(targetUid ? { targetUid } : {}),
    reason,
    details,
    status: 'open',
    createdAt: nowParsed.iso,
    updatedAt: nowParsed.iso,
  };
}

function buildDmConversationId(uidA, uidB) {
  const a = assertValidEntityId(uidA, 'uidA', UID_RE);
  const b = assertValidEntityId(uidB, 'uidB', UID_RE);
  if (a === b) {
    fail('Direct messages require two distinct accounts.');
  }
  const [first, second] = [a, b].sort();
  return `dm_${first}_${second}`;
}

function buildClubConversationId(clubId) {
  const safeClubId = assertValidEntityId(clubId, 'clubId', CLUB_ID_RE);
  return `club_${safeClubId}`;
}

function validateShareCard(rawCard) {
  if (rawCard === undefined || rawCard === null) return null;
  if (typeof rawCard !== 'object' || Array.isArray(rawCard)) {
    fail('shareCard must be an object.');
  }
  const type = typeof rawCard.type === 'string' ? rawCard.type.trim() : '';
  if (!SHARE_CARD_TYPE_SET.has(type)) {
    fail('Unsupported shareCard type.');
  }
  const targetId = assertValidEntityId(rawCard.targetId, 'shareCard.targetId');
  const title = assertSafeText(rawCard.title, { label: 'shareCard.title', min: 1, max: 120 });
  const subtitle = assertSafeText(rawCard.subtitle ?? '', {
    label: 'shareCard.subtitle',
    min: 0,
    max: 140,
  });
  return {
    type,
    targetId,
    title,
    ...(subtitle ? { subtitle } : {}),
  };
}

function validateChatMedia(rawMedia, conversationId, actorUid) {
  if (rawMedia === undefined || rawMedia === null) return null;
  if (typeof rawMedia !== 'object' || Array.isArray(rawMedia)) {
    fail('Chat media attachment must be an object.');
  }
  const storagePath = typeof rawMedia.storagePath === 'string' ? rawMedia.storagePath.trim() : '';
  if (!ALLOWED_CHAT_MEDIA_PATH_RE.test(storagePath) || storagePath.includes('..')) {
    fail('Chat media storagePath must follow chat-media/{conversationId}/{uid}/{imageFile}.');
  }
  const expectedPrefix = `chat-media/${conversationId}/${actorUid}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    fail('Chat media storagePath must match active conversation and sender.');
  }
  const mimeType =
    typeof rawMedia.mimeType === 'string' ? rawMedia.mimeType.trim().toLowerCase() : '';
  const sizeBytes = Number(rawMedia.sizeBytes);
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    fail('Chat messages only support raster image uploads (PNG/JPEG/WebP/AVIF).');
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) {
    fail('Chat image upload must be <= 8 MB.');
  }
  return {
    storagePath,
    mimeType,
    sizeBytes,
  };
}

function validateChatMessageInput(
  input,
  conversationId,
  actorUid,
  nowIso = new Date().toISOString(),
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Message payload must be an object.');
  }
  const senderUid = assertSafeText(actorUid, { label: 'actorUid', min: 1, max: 128 });
  const safeConversationId = assertSafeText(conversationId, {
    label: 'conversationId',
    min: 5,
    max: 300,
  });
  const nowParsed = parseStrictIso(nowIso, 'nowIso');
  const messageId = assertValidEntityId(input.messageId, 'messageId');
  const text = assertSafeText(input.text ?? '', {
    label: 'Message text',
    min: 0,
    max: CHAT_MESSAGE_MAX_CHARS,
  });
  const shareCard = validateShareCard(input.shareCard);
  const media = validateChatMedia(input.media, safeConversationId, senderUid);

  if (!text && !shareCard && !media) {
    fail('Message cannot be empty.');
  }

  return {
    messageId,
    conversationId: safeConversationId,
    senderUid,
    text,
    ...(shareCard ? { shareCard } : {}),
    ...(media ? { media } : {}),
    createdAt: nowParsed.iso,
    deletedAt: null,
  };
}

function getPhtDateKey(isoString) {
  const parsed = parseStrictIso(isoString, 'timestamp');
  const d = new Date(parsed.ms + PHT_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function phtDateKeyToDayNumber(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) fail('Invalid PHT dateKey.');
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY);
}

function updateFriendChatStreak(
  currentState,
  senderUid,
  memberUids,
  nowIso = new Date().toISOString(),
) {
  const members = Array.isArray(memberUids)
    ? Array.from(new Set(memberUids.map((u) => String(u).trim()).filter(Boolean))).sort()
    : [];
  if (members.length !== 2 || !members.includes(senderUid)) {
    fail('Friend streak updates require two members and a valid participant sender.');
  }

  const todayKey = getPhtDateKey(nowIso);
  const todayDayNum = phtDateKeyToDayNumber(todayKey);

  const prev = currentState && typeof currentState === 'object' ? currentState : {};
  let streakDays =
    Number.isInteger(prev.streakDays) && prev.streakDays >= 0 ? prev.streakDays : 0;
  let graceRemaining =
    Number.isInteger(prev.graceRemaining) && prev.graceRemaining >= 0
      ? Math.min(INBOX_STREAK_MAX_GRACE, prev.graceRemaining)
      : 0;
  let consecutiveActiveDays =
    Number.isInteger(prev.consecutiveActiveDays) && prev.consecutiveActiveDays >= 0
      ? prev.consecutiveActiveDays
      : streakDays;
  let lastCompletedDateKey =
    typeof prev.lastCompletedDateKey === 'string' && prev.lastCompletedDateKey
      ? prev.lastCompletedDateKey
      : null;

  let missedCompletedDays = 0;
  if (lastCompletedDateKey) {
    const lastDayNum = phtDateKeyToDayNumber(lastCompletedDateKey);
    if (todayDayNum > lastDayNum) {
      missedCompletedDays = Math.max(0, todayDayNum - lastDayNum - 1);
      if (missedCompletedDays > graceRemaining) {
        streakDays = 0;
        graceRemaining = 0;
        consecutiveActiveDays = 0;
        lastCompletedDateKey = null;
        missedCompletedDays = 0;
      }
    }
  }

  let pendingDateKey = prev.pendingDateKey === todayKey ? todayKey : todayKey;
  const pendingSenderSet = new Set(
    prev.pendingDateKey === todayKey && Array.isArray(prev.pendingSenderUids)
      ? prev.pendingSenderUids.filter((u) => members.includes(u))
      : [],
  );
  pendingSenderSet.add(senderUid);
  const pendingSenderUids = Array.from(pendingSenderSet).sort();

  if (lastCompletedDateKey !== todayKey && pendingSenderUids.length === 2) {
    const remainingGrace = Math.max(0, graceRemaining - missedCompletedDays);
    const nextConsecutive = missedCompletedDays > 0 ? 1 : consecutiveActiveDays + 1;
    const earnedBonus =
      nextConsecutive > 0 && nextConsecutive % INBOX_STREAK_GRACE_INTERVAL_DAYS === 0 ? 1 : 0;
    streakDays += 1;
    consecutiveActiveDays = nextConsecutive;
    graceRemaining = Math.min(INBOX_STREAK_MAX_GRACE, remainingGrace + earnedBonus);
    lastCompletedDateKey = todayKey;
  }

  return {
    id: buildDmConversationId(members[0], members[1]),
    members,
    streakDays,
    graceRemaining,
    consecutiveActiveDays,
    lastCompletedDateKey,
    pendingDateKey,
    pendingSenderUids,
    updatedAt: parseStrictIso(nowIso, 'nowIso').iso,
  };
}

function encodeCursor(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Cursor payload must be an object.');
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (encoded.length > 512) {
    fail('Cursor exceeds maximum size.');
  }
  return encoded;
}

function decodeCursor(token) {
  if (token === undefined || token === null || token === '') return null;
  if (typeof token !== 'string' || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    fail('Malformed pagination cursor.');
  }
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('Invalid pagination cursor.');
    }
    return parsed;
  } catch {
    fail('Malformed pagination cursor.');
  }
}

module.exports = {
  ALLOWED_CHAT_MEDIA_PATH_RE,
  ALLOWED_SOCIAL_MEDIA_PATH_RE,
  CHAT_MESSAGE_MAX_CHARS,
  INBOX_STREAK_GRACE_INTERVAL_DAYS,
  INBOX_STREAK_MAX_GRACE,
  MAX_COMMENT_TEXT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_POST_IMAGES,
  MAX_POST_TEXT_CHARS,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SEC,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  ROUTE_SNAP_LINK_RADIUS_M,
  SHARE_CARD_TYPES,
  SOCIAL_MEDIA_TYPES,
  SOCIAL_VISIBILITIES,
  buildClubConversationId,
  buildDmConversationId,
  decodeCursor,
  encodeCursor,
  findNearestCourseCorridorMatch,
  getPhtDateKey,
  updateFriendChatStreak,
  validateChatMessageInput,
  validateCommentInput,
  validateContentReportInput,
  validatePostRepostPermission,
  validateSocialPostInput,
};
