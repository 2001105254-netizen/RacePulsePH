import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Award,
  Flag,
  Heart,
  MapPin,
  MessageCircle,
  Repeat2,
  Send,
  ShieldBan,
  Trash2,
  X,
} from 'lucide-react';
import type { BadgeDefinition } from '../../lib/badges/types';
import {
  E2E_SOCIAL_COMMENTS_KEY,
  E2E_SOCIAL_KUDOS_KEY,
  E2E_SOCIAL_POSTS_KEY,
  E2E_USER_BLOCKS_KEY,
  buildDevStarterSocialPosts,
  createDevCommentFixture,
  createDevSocialPostFixture,
  readDevSessionJson,
  toggleDevKudosFixture,
  toggleDevUserBlockFixture,
  writeDevSessionJson,
} from '../../lib/clubs/e2eFixtures';
import { createCommunityRequestId } from '../../lib/runs/communityRunsClient';
import {
  createPostComment,
  deleteSocialPost,
  fetchPostComments,
  fetchSocialFeed,
  repostSocialPost,
  signMediaPaths,
  subscribeMySocialKudos,
  togglePostKudos,
  toggleUserBlock,
} from '../../lib/social/client';
import {
  applyBlockedUserToPosts,
  canRepostSocialPost,
  collectUnsignedMediaPaths,
} from '../../lib/social/feedHelpers';
import { MAX_COMMENT_TEXT_CHARS, SOCIAL_VISIBILITY_META } from '../../lib/social/mediaValidation';
import type { SocialCommentRecord, SocialPostRecord } from '../../lib/social/types';
import type { Race, UserProfile } from '../../types';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import ReportContentDialog from './ReportContentDialog';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

export interface RunnerSocialFeedPanelProps {
  mode: 'discover' | 'following';
  profile: UserProfile;
  canSocial: boolean;
  races: Race[];
  badgeCatalog: BadgeDefinition[];
  incomingNewPost?: SocialPostRecord | null;
  blockedAuthorUids?: ReadonlySet<string>;
  onOpenAuthorProfile: (uid: string) => void;
  onOpenExploreRace?: (raceId: string) => void;
  onBlockedUser?: (blockedUid: string) => void;
}

export default function RunnerSocialFeedPanel({
  mode,
  profile,
  canSocial,
  races,
  badgeCatalog,
  incomingNewPost,
  blockedAuthorUids,
  onOpenAuthorProfile,
  onOpenExploreRace,
  onBlockedUser,
}: RunnerSocialFeedPanelProps) {
  const { confirm, notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);
  const isE2e = import.meta.env.DEV && profile.uid.startsWith('e2e-');

  const [posts, setPosts] = useState<SocialPostRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState('');

  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(() => new Set());
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(() => new Set());
  const [commentsByPost, setCommentsByPost] = useState<Record<string, SocialCommentRecord[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentBusyPostId, setCommentBusyPostId] = useState<string | null>(null);

  const [repostSource, setRepostSource] = useState<SocialPostRecord | null>(null);
  const [repostNote, setRepostNote] = useState('');
  const [reposting, setReposting] = useState(false);

  const [reportTarget, setReportTarget] = useState<{
    targetType: 'post' | 'comment';
    targetId: string;
    targetUid?: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  const badgeById = useMemo(
    () => new Map(badgeCatalog.map((b) => [b.badgeId, b])),
    [badgeCatalog],
  );

  const resolvePrivateMedia = useCallback(async (items: readonly SocialPostRecord[]) => {
    if (isE2e) return;
    const unsignedPaths = collectUnsignedMediaPaths(items, []);
    if (unsignedPaths.length === 0) return;
    try {
      const res = await signMediaPaths(unsignedPaths);
      if (!mountedRef.current) return;
      setSignedUrls((prev) => ({ ...prev, ...res.signedUrls }));
    } catch (err) {
      console.warn('[RunnerSocialFeedPanel] signMediaPaths failed:', err);
    }
  }, [isE2e]);

  useEffect(() => {
    if (isE2e) {
      const storedPosts = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY);
      const initial = storedPosts ?? buildDevStarterSocialPosts();
      if (!storedPosts) writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, initial);
      const blocked = new Set(readDevSessionJson<string>(E2E_USER_BLOCKS_KEY) ?? []);
      const filtered = initial.filter((p) => {
        if (p.deletedAt || p.hiddenByModeration) return false;
        if (blocked.has(p.uid)) return false;
        return mode === 'discover' ? p.visibility === 'public' : true;
      });
      setPosts(filtered);
      setNextCursor(null);
      setLoading(false);
      setFeedError('');
      setLikedPostIds(new Set(readDevSessionJson<string>(E2E_SOCIAL_KUDOS_KEY) ?? []));
      return;
    }

    if (!canSocial) {
      setPosts([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFeedError('');

    void fetchSocialFeed({ mode, limit: 15 })
      .then((res) => {
        if (cancelled) return;
        setPosts(res.posts || []);
        setNextCursor(res.nextCursor ?? null);
        void resolvePrivateMedia(res.posts || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setFeedError(err instanceof Error && err.message ? err.message : 'Unable to load community feed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubKudos = subscribeMySocialKudos(profile.uid, (ids) => {
      setLikedPostIds(ids);
    });

    return () => {
      cancelled = true;
      unsubKudos();
    };
  }, [mode, profile.uid, canSocial, isE2e, resolvePrivateMedia]);

  useEffect(() => {
    if (!incomingNewPost) return;
    if (mode === 'discover' && incomingNewPost.visibility !== 'public') return;
    setPosts((prev) => {
      const next = [incomingNewPost, ...prev.filter((p) => p.postId !== incomingNewPost.postId)];
      void resolvePrivateMedia([incomingNewPost]);
      return next;
    });
  }, [incomingNewPost, mode, resolvePrivateMedia]);

  useEffect(() => {
    if (!blockedAuthorUids || blockedAuthorUids.size === 0) return;
    setPosts((prev) => {
      let next = prev;
      for (const uid of blockedAuthorUids) {
        next = applyBlockedUserToPosts(next, uid);
      }
      return next;
    });
  }, [blockedAuthorUids]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || isE2e) return;
    setLoadingMore(true);
    try {
      const res = await fetchSocialFeed({ mode, limit: 15, cursor: nextCursor });
      if (!mountedRef.current) return;
      const incoming = res.posts || [];
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.postId));
        return [...prev, ...incoming.filter((p) => !seen.has(p.postId))];
      });
      setNextCursor(res.nextCursor ?? null);
      void resolvePrivateMedia(incoming);
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Failed to load more posts',
        message: err instanceof Error ? err.message : 'Try again shortly.',
      });
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  const handleToggleKudos = async (post: SocialPostRecord) => {
    if (!canSocial) return;
    const wasLiked = likedPostIds.has(post.postId);
    const optimisticDelta = wasLiked ? -1 : 1;

    setLikedPostIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(post.postId);
      else next.add(post.postId);
      return next;
    });
    setPosts((prev) =>
      prev.map((p) =>
        p.postId === post.postId
          ? { ...p, kudosCount: Math.max(0, (p.kudosCount || 0) + optimisticDelta) }
          : p,
      ),
    );

    try {
      if (isE2e) {
        const stored = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? posts;
        const out = toggleDevKudosFixture(stored, likedPostIds, post.postId);
        setLikedPostIds(out.likedPostIds);
        return;
      }
      const res = await togglePostKudos(post.postId);
      if (!mountedRef.current) return;
      setPosts((prev) =>
        prev.map((p) => (p.postId === post.postId ? { ...p, kudosCount: res.kudosCount } : p)),
      );
      setLikedPostIds((prev) => {
        const next = new Set(prev);
        if (res.liked) next.add(post.postId);
        else next.delete(post.postId);
        return next;
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setLikedPostIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(post.postId);
        else next.delete(post.postId);
        return next;
      });
      setPosts((prev) =>
        prev.map((p) => (p.postId === post.postId ? { ...p, kudosCount: post.kudosCount } : p)),
      );
      notify({
        tone: 'error',
        title: 'Kudos failed',
        message: err instanceof Error ? err.message : 'Unable to update reaction.',
      });
    }
  };

  const handleToggleComments = async (postId: string) => {
    const isExpanded = expandedPostIds.has(postId);
    setExpandedPostIds((prev) => {
      const next = new Set(prev);
      if (isExpanded) next.delete(postId);
      else next.add(postId);
      return next;
    });
    if (isExpanded) return;

    if (isE2e) {
      const stored = readDevSessionJson<SocialCommentRecord>(E2E_SOCIAL_COMMENTS_KEY) ?? [];
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: stored.filter((c) => c.postId === postId && !c.deletedAt && !c.hiddenByModeration),
      }));
      return;
    }

    setCommentsLoading((prev) => ({ ...prev, [postId]: true }));
    try {
      const res = await fetchPostComments(postId, 50);
      if (!mountedRef.current) return;
      setCommentsByPost((prev) => ({ ...prev, [postId]: res.comments || [] }));
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Comments unavailable',
        message: err instanceof Error ? err.message : 'Unable to load comments.',
      });
    } finally {
      if (mountedRef.current) setCommentsLoading((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleSubmitComment = async (event: FormEvent, post: SocialPostRecord) => {
    event.preventDefault();
    const raw = (commentDrafts[post.postId] || '').trim();
    if (!raw || commentBusyPostId) return;
    setCommentBusyPostId(post.postId);
    try {
      const commentId = `cmt_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      if (isE2e) {
        const allCmts = readDevSessionJson<SocialCommentRecord>(E2E_SOCIAL_COMMENTS_KEY) ?? [];
        const allPosts = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? posts;
        const out = createDevCommentFixture(allCmts, allPosts, {
          commentId,
          postId: post.postId,
          uid: profile.uid,
          displayName: profile.nickname || profile.displayName || 'Runner',
          username: profile.username,
          text: raw,
        });
        setCommentsByPost((prev) => ({
          ...prev,
          [post.postId]: out.comments.filter((c) => c.postId === post.postId),
        }));
        setPosts((prev) =>
          prev.map((p) => (p.postId === post.postId ? { ...p, commentsCount: p.commentsCount + 1 } : p)),
        );
      } else {
        const res = await createPostComment({ commentId, postId: post.postId, text: raw });
        if (!mountedRef.current) return;
        setCommentsByPost((prev) => ({
          ...prev,
          [post.postId]: [...(prev[post.postId] || []), res.comment],
        }));
        setPosts((prev) =>
          prev.map((p) => (p.postId === post.postId ? { ...p, commentsCount: res.commentsCount } : p)),
        );
      }
      setCommentDrafts((prev) => ({ ...prev, [post.postId]: '' }));
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Comment failed',
        message: err instanceof Error ? err.message : 'Unable to post comment.',
      });
    } finally {
      if (mountedRef.current) setCommentBusyPostId(null);
    }
  };

  const handleSubmitRepost = async (event: FormEvent) => {
    event.preventDefault();
    if (!repostSource || !canRepostSocialPost(repostSource) || reposting) return;
    setReposting(true);
    try {
      const newPostId = `rep_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      let created: SocialPostRecord;
      if (isE2e) {
        const existing = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? posts;
        const updated = createDevSocialPostFixture(existing, {
          postId: newPostId,
          uid: profile.uid,
          displayName: profile.nickname || profile.displayName || 'Runner',
          username: profile.username,
          visibility: 'public',
          text: repostNote.trim(),
          repostOfPostId: repostSource.postId,
        });
        created = updated[0];
      } else {
        const res = await repostSocialPost({
          postId: newPostId,
          sourcePostId: repostSource.postId,
          text: repostNote.trim() || undefined,
          visibility: 'public',
        });
        created = res.post;
      }
      if (!mountedRef.current) return;
      setPosts((prev) => [
        created,
        ...prev.map((p) =>
          p.postId === repostSource.postId ? { ...p, repostsCount: (p.repostsCount || 0) + 1 } : p,
        ),
      ]);
      setRepostSource(null);
      setRepostNote('');
      notify({ tone: 'success', title: 'Reposted to Discover feed' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Repost failed',
        message: err instanceof Error ? err.message : 'Unable to repost update.',
      });
    } finally {
      if (mountedRef.current) setReposting(false);
    }
  };

  const handleDeletePost = async (post: SocialPostRecord) => {
    const ok = await confirm({
      title: 'Delete your post?',
      message: 'This post and any linked Route Snap will be permanently removed.',
      confirmLabel: 'Delete Post',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isE2e) {
        const existing = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? posts;
        const next = existing.filter((p) => p.postId !== post.postId);
        writeDevSessionJson(E2E_SOCIAL_POSTS_KEY, next);
      } else {
        await deleteSocialPost(post.postId);
      }
      if (!mountedRef.current) return;
      setPosts((prev) => prev.filter((p) => p.postId !== post.postId));
      notify({ tone: 'info', title: 'Post deleted' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Unable to delete post.',
      });
    }
  };

  const handleBlockAuthor = async (authorUid: string, authorName: string) => {
    if (authorUid === profile.uid) return;
    const ok = await confirm({
      title: `Block ${authorName}?`,
      message: 'Their posts, route snaps, comments, and messages will be hidden immediately.',
      confirmLabel: 'Block Runner',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isE2e) {
        const current = readDevSessionJson<string>(E2E_USER_BLOCKS_KEY) ?? [];
        toggleDevUserBlockFixture(current, authorUid, true);
      } else {
        await toggleUserBlock(authorUid, true);
      }
      if (!mountedRef.current) return;
      setPosts((prev) => applyBlockedUserToPosts(prev, authorUid));
      onBlockedUser?.(authorUid);
      notify({ tone: 'info', title: `Blocked ${authorName}` });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Block failed',
        message: err instanceof Error ? err.message : 'Unable to block runner.',
      });
    }
  };

  if (loading) {
    return <RunnerQueueSkeleton rows={3} label="Loading community runner feed" />;
  }

  if (feedError) {
    return (
      <div role="alert" className="rounded-2xl border border-red-600/35 bg-red-500/10 p-4 text-xs font-semibold text-red-700 dark:text-red-300">
        {feedError}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 text-center space-y-1.5">
        <p className="font-display font-semibold text-sm text-[var(--text-primary)]">
          {mode === 'discover' ? 'No community posts in Discover yet' : 'No friend circle posts yet'}
        </p>
        <p className="text-xs font-normal text-[var(--text-secondary)]">
          {mode === 'discover'
            ? 'Share your morning run, race recap, or route snap with New Post above.'
            : 'Posts from you, your accepted friends, and your close friends circle appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const authorName = post.authorDisplayName || 'Runner';
        const isSelf = post.uid === profile.uid;
        const liked = likedPostIds.has(post.postId);
        const allowRepost = canRepostSocialPost(post);
        const expanded = expandedPostIds.has(post.postId);
        const postComments = commentsByPost[post.postId] || [];
        const linkedRace = post.attachedRaceId ? raceById.get(post.attachedRaceId) : undefined;
        const linkedBadge = post.attachedBadgeId ? badgeById.get(post.attachedBadgeId) : undefined;

        return (
          <article
            key={post.postId}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 180px' }}
            className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3"
          >
            {/* Post Author Header */}
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpenAuthorProfile(post.uid)}
                className="min-h-11 flex items-center gap-2.5 text-left min-w-0 rounded-xl pr-2 hover:bg-[var(--surface-hover)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <span className="w-10 h-10 rounded-full overflow-hidden bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-600/25 flex items-center justify-center text-sm font-semibold shrink-0">
                  {post.authorPhotoURL ? (
                    <img src={post.authorPhotoURL} alt="" width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    authorName.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-display font-semibold text-sm text-[var(--text-primary)] truncate">
                    {authorName}
                  </span>
                  <span className="block font-mono text-xs font-normal text-[var(--text-secondary)] truncate">
                    {post.authorUsername ? `@${post.authorUsername} · ` : ''}
                    {post.createdAt.slice(0, 10)}
                  </span>
                </span>
              </button>

              <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                {post.visibility !== 'public' && (
                  <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)]">
                    {SOCIAL_VISIBILITY_META[post.visibility].label}
                  </span>
                )}
                {post.repostOfPostId && (
                  <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-secondary)] inline-flex items-center gap-1">
                    <Repeat2 className="w-3 h-3" aria-hidden="true" />
                    <span>Repost</span>
                  </span>
                )}
              </div>
            </div>

            {post.text && (
              <p className="text-sm font-normal text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                {post.text}
              </p>
            )}

            {(post.location || post.linkedCourse || linkedRace || linkedBadge) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {post.location && (
                  <span className="px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-primary)] inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span>{post.location.label}</span>
                  </span>
                )}
                {post.linkedCourse && (
                  <span className="px-2.5 py-1 rounded-lg border border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-200 font-semibold">
                    Course Snap: {post.linkedCourse.raceName} ({post.linkedCourse.distanceLabel})
                  </span>
                )}
                {linkedBadge && (
                  <span className="px-2.5 py-1 rounded-lg border border-amber-600/35 bg-amber-500/10 text-amber-900 dark:text-amber-200 font-semibold inline-flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{linkedBadge.name}</span>
                  </span>
                )}
                {linkedRace && (
                  <button
                    type="button"
                    disabled={!onOpenExploreRace}
                    onClick={() => onOpenExploreRace?.(linkedRace.id)}
                    className="min-h-9 px-2.5 rounded-lg border border-[var(--border-button)] bg-[var(--surface-inset)] text-[var(--text-primary)] font-semibold cursor-pointer"
                  >
                    Race: {linkedRace.name}
                  </button>
                )}
              </div>
            )}

            {/* Media Gallery */}
            {post.mediaItems.length > 0 && (
              <div
                className={`grid gap-2 ${
                  post.mediaType === 'video' || post.mediaItems.length === 1
                    ? 'grid-cols-1'
                    : 'grid-cols-2'
                }`}
              >
                {post.mediaItems.map((item, idx) => {
                  const resolvedUrl = item.url || signedUrls[item.storagePath] || '';
                  if (!resolvedUrl) {
                    return (
                      <div
                        key={`${post.postId}_${idx}`}
                        className="h-40 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center justify-center text-xs font-mono text-[var(--text-secondary)]"
                      >
                        Signed media unavailable
                      </div>
                    );
                  }
                  if (post.mediaType === 'video' || item.mimeType.startsWith('video/')) {
                    return (
                      <video
                        key={`${post.postId}_${idx}`}
                        src={resolvedUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-80 rounded-xl border border-[var(--border-default)] bg-black"
                      />
                    );
                  }
                  return (
                    <img
                      key={`${post.postId}_${idx}`}
                      src={resolvedUrl}
                      alt={`Post photo ${idx + 1} by ${authorName}`}
                      loading="lazy"
                      className="w-full max-h-72 object-cover rounded-xl border border-[var(--border-default)]"
                    />
                  );
                })}
              </div>
            )}

            {/* Interactive Social Action Bar */}
            <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={liked}
                  onClick={() => void handleToggleKudos(post)}
                  className={`min-h-11 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                    liked
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-mono tabular-nums">{post.kudosCount || 0}</span>
                </button>

                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => void handleToggleComments(post.postId)}
                  className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-mono tabular-nums">{post.commentsCount || 0}</span>
                </button>

                {allowRepost && (
                  <button
                    type="button"
                    onClick={() => {
                      setRepostSource(post);
                      setRepostNote('');
                    }}
                    className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Repeat2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="font-mono tabular-nums">{post.repostsCount || 0}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {isSelf ? (
                  <button
                    type="button"
                    onClick={() => void handleDeletePost(post)}
                    aria-label="Delete post"
                    className="min-h-11 min-w-11 px-3 rounded-xl border border-red-600/30 bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setReportTarget({
                          targetType: 'post',
                          targetId: post.postId,
                          targetUid: post.uid,
                          label: `Post by ${authorName}`,
                        })
                      }
                      aria-label={`Report post by ${authorName}`}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBlockAuthor(post.uid, authorName)}
                      aria-label={`Block ${authorName}`}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-red-500/10 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-300 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ShieldBan className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Block</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Comments Drawer */}
            {expanded && (
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2.5">
                {commentsLoading[post.postId] ? (
                  <p role="status" className="text-xs text-[var(--text-secondary)]">
                    Loading comments...
                  </p>
                ) : postComments.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    No comments yet. Be the first to reply.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {postComments.map((cmt) => (
                      <li key={cmt.commentId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0 space-y-0.5">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {cmt.authorDisplayName || 'Runner'}
                          </span>
                          <p className="text-[var(--text-secondary)] whitespace-pre-wrap">{cmt.text}</p>
                        </div>
                        {cmt.uid !== profile.uid && (
                          <button
                            type="button"
                            onClick={() =>
                              setReportTarget({
                                targetType: 'comment',
                                targetId: cmt.commentId,
                                targetUid: cmt.uid,
                                label: `Comment by ${cmt.authorDisplayName || cmt.uid}`,
                              })
                            }
                            aria-label="Report comment"
                            className="min-h-9 px-2 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-300 shrink-0 cursor-pointer"
                          >
                            Report
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canSocial && (
                  <form onSubmit={(e) => void handleSubmitComment(e, post)} className="flex items-center gap-2">
                    <input
                      aria-label="Write a comment"
                      maxLength={MAX_COMMENT_TEXT_CHARS}
                      value={commentDrafts[post.postId] || ''}
                      onChange={(e) =>
                        setCommentDrafts((prev) => ({ ...prev, [post.postId]: e.target.value }))
                      }
                      placeholder="Add a comment..."
                      className="flex-1 min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3 text-xs text-[var(--text-primary)]"
                    />
                    <button
                      type="submit"
                      disabled={commentBusyPostId === post.postId || !(commentDrafts[post.postId] || '').trim()}
                      className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Reply</span>
                    </button>
                  </form>
                )}
              </div>
            )}
          </article>
        );
      })}

      {nextCursor && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
          >
            {loadingMore ? 'Loading more...' : 'Load More Posts'}
          </button>
        </div>
      )}

      {/* Repost Sheet */}
      {repostSource && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick={!reposting}
          maxWidthCss="30rem"
          titleId={`${baseId}-repost-title`}
          onRequestClose={() => {
            if (!reposting) setRepostSource(null);
          }}
          bodyClassName="p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${baseId}-repost-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
              Repost Public Update
            </h2>
            <button
              type="button"
              onClick={() => setRepostSource(null)}
              aria-label="Close repost modal"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-xs text-[var(--text-secondary)] line-clamp-3">
            {repostSource.text || '[Media post]'}
          </p>
          <form onSubmit={handleSubmitRepost} className="space-y-3">
            <textarea
              aria-label="Optional repost quote"
              rows={2}
              maxLength={300}
              value={repostNote}
              onChange={(e) => setRepostNote(e.target.value)}
              placeholder="Add an optional quote or leave blank for a direct repost"
              className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] p-3 text-sm text-[var(--text-primary)]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRepostSource(null)}
                className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reposting}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {reposting ? 'Posting...' : 'Confirm Repost'}
              </button>
            </div>
          </form>
        </DialogSurface>
      )}

      <ReportContentDialog
        open={Boolean(reportTarget)}
        actorUid={profile.uid}
        targetType={reportTarget?.targetType || 'post'}
        targetId={reportTarget?.targetId || ''}
        targetUid={reportTarget?.targetUid}
        targetLabel={reportTarget?.label || ''}
        onClose={() => setReportTarget(null)}
      />
    </div>
  );
}
