import { useEffect, useId, useRef, useState } from 'react';
import { Flag, MapPin, MessageSquare, ShieldBan, Trophy, Users2, X } from 'lucide-react';
import {
  E2E_SOCIAL_POSTS_KEY,
  E2E_USER_BLOCKS_KEY,
  buildDevPublicRunnerProfileFixture,
  buildDevStarterSocialPosts,
  readDevSessionJson,
  toggleDevUserBlockFixture,
} from '../../lib/clubs/e2eFixtures';
import {
  fetchSocialFeed,
  loadPublicRunnerProfile,
  toggleUserBlock,
} from '../../lib/social/client';
import type { PublicRunnerProfile, SocialPostRecord } from '../../lib/social/types';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import ReportContentDialog from './ReportContentDialog';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

export interface PublicRunnerProfileDialogProps {
  targetUid: string | null;
  viewerUid: string;
  onClose: () => void;
  onStartDm?: (targetUid: string) => void;
  onBlockedUser?: (blockedUid: string) => void;
}

export default function PublicRunnerProfileDialog({
  targetUid,
  viewerUid,
  onClose,
  onStartDm,
  onBlockedUser,
}: PublicRunnerProfileDialogProps) {
  const { confirm, notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);

  const [profile, setProfile] = useState<PublicRunnerProfile | null>(null);
  const [recentPosts, setRecentPosts] = useState<SocialPostRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!targetUid) return;
    const isE2e = import.meta.env.DEV && viewerUid.startsWith('e2e-');
    let cancelled = false;

    if (isE2e) {
      setProfile(buildDevPublicRunnerProfileFixture(targetUid));
      const storedPosts = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? buildDevStarterSocialPosts();
      setRecentPosts(
        storedPosts
          .filter((p) => p.uid === targetUid && p.visibility === 'public' && !p.deletedAt && !p.hiddenByModeration)
          .slice(0, 6),
      );
      setLoading(false);
      setLoadError('');
      return;
    }

    setLoading(true);
    setLoadError('');
    setProfile(null);
    setRecentPosts([]);

    void Promise.all([
      loadPublicRunnerProfile(targetUid),
      fetchSocialFeed({ mode: 'discover', authorUid: targetUid, limit: 6 }).catch(() => ({
        posts: [],
        nextCursor: null,
      })),
    ])
      .then(([prof, feed]) => {
        if (cancelled) return;
        setProfile(
          prof ?? {
            uid: targetUid,
            displayName: 'Runner',
            primaryClubId: null,
            primaryClubName: '',
            updatedAt: '',
          },
        );
        setRecentPosts(feed.posts || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error && err.message ? err.message : 'Unable to load runner profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetUid, viewerUid]);

  if (!targetUid) return null;

  const isSelf = targetUid === viewerUid;
  const isE2e = import.meta.env.DEV && viewerUid.startsWith('e2e-');
  const displayName = profile?.displayName || 'Runner';

  const handleBlockRunner = async () => {
    if (isSelf || blocking) return;
    const ok = await confirm({
      title: `Block ${displayName}?`,
      message:
        'Blocking removes their posts, snaps, and direct messages from your views in both directions.',
      confirmLabel: 'Block Runner',
      destructive: true,
    });
    if (!ok) return;
    setBlocking(true);
    try {
      if (isE2e) {
        const current = readDevSessionJson<string>(E2E_USER_BLOCKS_KEY) ?? [];
        toggleDevUserBlockFixture(current, targetUid, true);
      } else {
        await toggleUserBlock(targetUid, true);
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'info',
        title: `Blocked ${displayName}`,
        message: 'You can manage blocked accounts under You -> Friends.',
      });
      onBlockedUser?.(targetUid);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Block failed',
        message: err instanceof Error ? err.message : 'Unable to block runner.',
      });
    } finally {
      if (mountedRef.current) setBlocking(false);
    }
  };

  return (
    <>
      <DialogSurface
        variant="sheet"
        dismissOnBackdropClick={!blocking}
        maxWidthCss="34rem"
        titleId={`${baseId}-title`}
        onRequestClose={onClose}
        bodyClassName="p-4 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-12 h-12 rounded-full overflow-hidden bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-600/30 flex items-center justify-center text-base font-semibold shrink-0">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </span>
            <div className="min-w-0 space-y-0.5">
              <h2 id={`${baseId}-title`} className="font-display font-semibold text-lg text-[var(--text-primary)] truncate">
                {displayName}
              </h2>
              {profile?.username && (
                <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                  @{profile.username}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close runner profile"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <RunnerQueueSkeleton rows={3} label="Loading runner public profile" />
        ) : loadError ? (
          <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
            {loadError}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {profile?.primaryClubName && (
                <span className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Users2 className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>{profile.primaryClubName}</span>
                </span>
              )}
              {profile?.location && (
                <span className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>{profile.location}</span>
                </span>
              )}
              {profile?.favoriteDistance && (
                <span className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] font-mono text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>{profile.favoriteDistance}</span>
                </span>
              )}
            </div>

            {profile?.bio && (
              <p className="text-sm font-normal text-[var(--text-secondary)] leading-relaxed">
                {profile.bio}
              </p>
            )}

            {!isSelf && (
              <div className="flex flex-wrap items-center gap-2">
                {onStartDm && (
                  <button
                    type="button"
                    onClick={() => {
                      onStartDm(targetUid);
                      onClose();
                    }}
                    className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Message</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Report</span>
                </button>
                <button
                  type="button"
                  disabled={blocking}
                  onClick={() => void handleBlockRunner()}
                  className="min-h-11 px-3.5 rounded-xl border border-red-600/35 bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <ShieldBan className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{blocking ? 'Blocking...' : 'Block'}</span>
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                Recent Public Updates ({recentPosts.length})
              </h3>
              {recentPosts.length === 0 ? (
                <p className="text-xs font-normal text-[var(--text-secondary)]">
                  No public updates shared yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {recentPosts.map((post) => (
                    <article key={post.postId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-1">
                      <p className="text-xs font-normal text-[var(--text-primary)] whitespace-pre-wrap">
                        {post.text || '[Media update]'}
                      </p>
                      <p className="text-xs font-mono text-[var(--text-secondary)]">
                        {post.createdAt.slice(0, 10)} · {post.kudosCount} kudos
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogSurface>

      <ReportContentDialog
        open={reportOpen}
        actorUid={viewerUid}
        targetType="user"
        targetId={targetUid}
        targetUid={targetUid}
        targetLabel={displayName}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}
