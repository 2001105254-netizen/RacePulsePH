import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  CheckCircle2,
  EyeOff,
  FileWarning,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import {
  E2E_CONTENT_REPORTS_KEY,
  E2E_SOCIAL_POSTS_KEY,
  readDevSessionJson,
  resolveDevContentReportFixture,
} from '../../lib/clubs/e2eFixtures';
import {
  resolveContentReport,
  signMediaPaths,
  subscribeContentReports,
} from '../../lib/social/client';
import { REPORT_REASON_META } from '../../lib/social/mediaValidation';
import type {
  ContentReportRecord,
  ContentReportStatus,
  ContentReportTargetType,
  SocialPostRecord,
} from '../../lib/social/types';
import type { UserProfile } from '../../types';
import { useFeedback } from '../ui/FeedbackProvider';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, type SelectOption } from '../ui/Select';

interface ModerationQueuePanelProps {
  profile: UserProfile;
}

interface InspectedTargetPreview {
  title: string;
  body: string;
  meta: string;
  imageUrls: string[];
  deleted: boolean;
  hidden: boolean;
}

export default function ModerationQueuePanel({ profile }: ModerationQueuePanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { confirm, notify } = useFeedback();

  const canModerate = isSuperAdmin || can('moderation.manage');
  const isE2eFixtureMode = import.meta.env.DEV && profile.uid.startsWith('e2e-');
  const baseId = useId();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [reports, setReports] = useState<ContentReportRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<ContentReportStatus>('open');
  const [typeFilter, setTypeFilter] = useState<'all' | ContentReportTargetType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const [inspectedTarget, setInspectedTarget] = useState<InspectedTargetPreview | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolvingAction, setResolvingAction] = useState<string | null>(null);
  const statusTabRefs = useRef<Record<ContentReportStatus, HTMLButtonElement | null>>({
    open: null,
    action_taken: null,
    dismissed: null,
  });

  const handleStatusTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const order: readonly ContentReportStatus[] = ['open', 'action_taken', 'dismissed'];
    const currentIndex = order.indexOf(statusFilter);
    if (currentIndex === -1) return;
    let nextKey: ContentReportStatus | null = null;
    if (event.key === 'ArrowRight') {
      nextKey = order[(currentIndex + 1) % order.length];
    } else if (event.key === 'ArrowLeft') {
      nextKey = order[(currentIndex - 1 + order.length) % order.length];
    } else if (event.key === 'Home') {
      nextKey = order[0];
    } else if (event.key === 'End') {
      nextKey = order[order.length - 1];
    }
    if (!nextKey) return;
    event.preventDefault();
    setStatusFilter(nextKey);
    statusTabRefs.current[nextKey]?.focus();
  };

  useEffect(() => {
    if (!canModerate) return;
    if (isE2eFixtureMode) {
      setReports(readDevSessionJson<ContentReportRecord>(E2E_CONTENT_REPORTS_KEY) ?? []);
      setLoaded(true);
      setLoadError(null);
      return;
    }
    return subscribeContentReports((snap) => {
      setReports(snap.reports);
      setLoaded(snap.loaded);
      setLoadError(snap.error);
    });
  }, [canModerate, isE2eFixtureMode]);

  const visibleReports = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return reports.filter((r) => {
      if (r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && r.targetType !== typeFilter) return false;
      if (!term) return true;
      return `${r.reportId} ${r.targetId} ${r.targetUid || ''} ${r.reporterUid} ${r.reason} ${r.details}`
        .toLowerCase()
        .includes(term);
    });
  }, [reports, searchQuery, statusFilter, typeFilter]);

  const activeReport =
    (selectedReportId && visibleReports.find((r) => r.reportId === selectedReportId)) ||
    visibleReports[0] ||
    null;

  useEffect(() => {
    setInspectedTarget(null);
    setResolutionNote('');
  }, [activeReport?.reportId]);

  const typeOptions: SelectOption[] = [
    { value: 'all', label: 'All targets' },
    { value: 'post', label: 'Social Posts' },
    { value: 'comment', label: 'Post Comments' },
    { value: 'message', label: 'Inbox / Club Messages' },
    { value: 'user', label: 'Runner Accounts' },
    { value: 'club', label: 'Running Clubs' },
  ];

  const handleInspectTarget = async (report: ContentReportRecord) => {
    setInspecting(true);
    setInspectedTarget(null);
    try {
      if (isE2eFixtureMode) {
        const posts = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? [];
        const matched = posts.find((p) => p.postId === report.targetId);
        if (report.targetType === 'post' && matched) {
          setInspectedTarget({
            title: matched.authorDisplayName || matched.uid,
            body: matched.text || '[Media post without text]',
            meta: `Visibility: ${matched.visibility} | Created: ${matched.createdAt}`,
            imageUrls: matched.mediaItems.map((m) => m.url).filter(Boolean),
            deleted: Boolean(matched.deletedAt),
            hidden: Boolean(matched.hiddenByModeration),
          });
        } else {
          setInspectedTarget({
            title: `${report.targetType.toUpperCase()} ${report.targetId}`,
            body: report.details || 'Fixture target preview loaded.',
            meta: report.targetUid ? `Target UID: ${report.targetUid}` : 'Target metadata available',
            imageUrls: [],
            deleted: false,
            hidden: false,
          });
        }
        return;
      }

      if (report.targetType === 'post') {
        const snap = await getDoc(doc(db, 'socialPosts', report.targetId));
        if (!snap.exists()) {
          setInspectedTarget({
            title: 'Post removed or missing',
            body: 'The target post no longer exists.',
            meta: report.targetId,
            imageUrls: [],
            deleted: true,
            hidden: false,
          });
          return;
        }
        const post = snap.data() as SocialPostRecord;
        const paths = (post.mediaItems || []).map((m) => m.storagePath).filter(Boolean);
        let urls: string[] = [];
        if (paths.length > 0) {
          const signed = await signMediaPaths(paths);
          urls = paths.map((p) => signed.signedUrls[p]).filter(Boolean);
        }
        if (!mountedRef.current) return;
        setInspectedTarget({
          title: `Post by ${post.authorDisplayName || post.uid}`,
          body: post.text || '[Media-only post]',
          meta: `Visibility: ${post.visibility} | UID: ${post.uid}`,
          imageUrls: urls,
          deleted: Boolean(post.deletedAt),
          hidden: Boolean(post.hiddenByModeration),
        });
      } else if (report.targetType === 'comment') {
        const snap = await getDoc(doc(db, 'socialComments', report.targetId));
        if (!snap.exists()) {
          setInspectedTarget({
            title: 'Comment missing',
            body: 'Comment document was not found.',
            meta: report.targetId,
            imageUrls: [],
            deleted: true,
            hidden: false,
          });
          return;
        }
        const data = snap.data() as {
          text?: string;
          uid?: string;
          postId?: string;
          deletedAt?: string | null;
          hiddenByModeration?: boolean;
        };
        setInspectedTarget({
          title: `Comment on post ${data.postId || ''}`,
          body: data.text || '',
          meta: `Author UID: ${data.uid || 'unknown'}`,
          imageUrls: [],
          deleted: Boolean(data.deletedAt),
          hidden: Boolean(data.hiddenByModeration),
        });
      } else if (report.targetType === 'message' && report.targetParentId) {
        const snap = await getDoc(
          doc(db, 'conversations', report.targetParentId, 'messages', report.targetId),
        );
        if (!snap.exists()) {
          setInspectedTarget({
            title: 'Message removed',
            body: 'Message document not found.',
            meta: report.targetId,
            imageUrls: [],
            deleted: true,
            hidden: false,
          });
          return;
        }
        const data = snap.data() as {
          text?: string;
          senderUid?: string;
          media?: { storagePath?: string };
          deletedAt?: string | null;
          hiddenByModeration?: boolean;
        };
        let urls: string[] = [];
        if (data.media?.storagePath) {
          const signed = await signMediaPaths([data.media.storagePath]);
          if (signed.signedUrls[data.media.storagePath]) {
            urls = [signed.signedUrls[data.media.storagePath]];
          }
        }
        if (!mountedRef.current) return;
        setInspectedTarget({
          title: `Message in ${report.targetParentId}`,
          body: data.text || '[Image or share card message]',
          meta: `Sender UID: ${data.senderUid || 'unknown'}`,
          imageUrls: urls,
          deleted: Boolean(data.deletedAt),
          hidden: Boolean(data.hiddenByModeration),
        });
      } else {
        setInspectedTarget({
          title: `${report.targetType.toUpperCase()} (${report.targetId})`,
          body: report.details || 'Review user or club directly in Admin Console.',
          meta: report.targetUid ? `Target UID: ${report.targetUid}` : report.targetId,
          imageUrls: [],
          deleted: false,
          hidden: false,
        });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Inspection failed',
        message: err instanceof Error ? err.message : 'Unable to load reported content.',
      });
    } finally {
      if (mountedRef.current) setInspecting(false);
    }
  };

  const handleResolve = async (
    report: ContentReportRecord,
    action: 'dismiss' | 'hide_content' | 'delete_content',
  ) => {
    if (!canModerate || resolvingAction) return;
    if (action === 'delete_content') {
      const ok = await confirm({
        title: 'Delete reported content?',
        message: 'The reported item and any linked route snap will be permanently removed from feeds.',
        confirmLabel: 'Delete Content',
        destructive: true,
      });
      if (!ok) return;
    }

    setResolvingAction(action);
    try {
      if (isE2eFixtureMode) {
        const posts = readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? [];
        const out = resolveDevContentReportFixture(reports, posts, {
          reportId: report.reportId,
          action,
          actorUid: profile.uid,
          resolutionNote: resolutionNote.trim(),
        });
        setReports(out.reports);
      } else {
        await resolveContentReport({
          reportId: report.reportId,
          action,
          resolutionNote: resolutionNote.trim() || undefined,
        });
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: 'Report resolved',
        message:
          action === 'dismiss'
            ? 'Marked dismissed.'
            : action === 'hide_content'
              ? 'Content hidden from public feeds.'
              : 'Content removed from feeds.',
      });
      setResolutionNote('');
      setInspectedTarget(null);
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Moderation failed',
        message: err instanceof Error ? err.message : 'Unable to resolve report.',
      });
    } finally {
      if (mountedRef.current) setResolvingAction(null);
    }
  };

  if (!canModerate) {
    return (
      <div className="w-full max-w-[1600px] mx-auto">
        <div className="glass-panel p-6 sm:p-8 flex items-start gap-4">
          <ShieldAlert className="w-6 h-6 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold font-display text-[var(--text-primary)]">
              Moderation access required
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              UGC safety review requires the moderation.manage permission granted to Admins or Super Admins.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      <header className="glass-panel p-4 sm:p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold font-display text-[var(--text-primary)] tracking-tight">
            UGC Moderation
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Review runner safety reports across posts, comments, chat messages, clubs, and accounts.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-3 border-t border-[var(--border-subtle)]">
          <div
            role="tablist"
            aria-label="Moderation queue status"
            onKeyDown={handleStatusTabKeyDown}
            className="flex flex-wrap gap-2"
          >
            {(
              [
                ['open', 'Open'],
                ['action_taken', 'Action Taken'],
                ['dismissed', 'Dismissed'],
              ] as const
            ).map(([key, label]) => {
              const selected = statusFilter === key;
              const count = reports.filter((r) => r.status === key).length;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    statusTabRefs.current[key] = el;
                  }}
                  id={`${baseId}-status-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${baseId}-status-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setStatusFilter(key)}
                  className={`min-h-11 px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                    selected
                      ? 'bg-red-700 text-white'
                      : 'border border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                      selected ? 'bg-white/20 text-white' : 'bg-[var(--surface-card)] text-[var(--text-primary)]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <search className="flex flex-col sm:flex-row gap-2.5 lg:w-[28rem]">
            <div className="sm:w-44">
              <Select
                id={`${baseId}-type-filter`}
                ariaLabel="Filter reports by target type"
                value={typeFilter}
                options={typeOptions}
                onChange={(v) => setTypeFilter(v as 'all' | ContentReportTargetType)}
              />
            </div>
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <Input
                aria-label="Search reports"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search target ID or reason"
                className="pl-10"
              />
            </div>
          </search>
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300"
        >
          {loadError}
        </div>
      )}

      <div
        role="tabpanel"
        id={`${baseId}-status-panel`}
        aria-labelledby={`${baseId}-status-tab-${statusFilter}`}
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
      >
        <aside className="lg:col-span-5 glass-panel p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">
            Queue ({visibleReports.length})
          </h3>

          {!loaded ? (
            <p role="status" className="text-sm text-[var(--text-secondary)] py-4">
              Loading moderation queue...
            </p>
          ) : visibleReports.length === 0 ? (
            <div className="glass-inset p-6 text-center space-y-1.5">
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No reports in this view
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Submitted user reports appear here immediately for review.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[38rem] overflow-y-auto pr-1">
              {visibleReports.map((rep) => {
                const selected = activeReport?.reportId === rep.reportId;
                return (
                  <button
                    key={rep.reportId}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setSelectedReportId(rep.reportId)}
                    className={`w-full min-h-11 p-3.5 rounded-xl border text-left space-y-1.5 ${
                      selected
                        ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                        : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                        {rep.targetType} | {REPORT_REASON_META[rep.reason] || rep.reason}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-secondary)] shrink-0">
                        {rep.createdAt.slice(0, 10)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      Target: {rep.targetId}
                    </p>
                    {rep.details && (
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                        {rep.details}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="lg:col-span-7 glass-panel p-4 sm:p-6">
          {!activeReport ? (
            <div className="glass-inset p-8 text-center space-y-2">
              <FileWarning className="w-7 h-7 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Select a report to inspect details
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                    {REPORT_REASON_META[activeReport.reason] || activeReport.reason}
                  </span>
                  <h3 className="text-lg font-semibold font-display text-[var(--text-primary)]">
                    {activeReport.targetType.toUpperCase()} Report ({activeReport.reportId})
                  </h3>
                </div>
                <span className="px-3 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] capitalize">
                  {activeReport.status.replace('_', ' ')}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs glass-inset p-4">
                <div>
                  <dt className="text-[var(--text-secondary)]">Target ID</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] break-all">
                    {activeReport.targetId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-secondary)]">Reporter UID</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] break-all">
                    {activeReport.reporterUid}
                  </dd>
                </div>
                {activeReport.targetUid && (
                  <div>
                    <dt className="text-[var(--text-secondary)]">Reported User UID</dt>
                    <dd className="font-mono font-semibold text-[var(--text-primary)] break-all">
                      {activeReport.targetUid}
                    </dd>
                  </div>
                )}
                {activeReport.targetParentId && (
                  <div>
                    <dt className="text-[var(--text-secondary)]">Parent Thread ID</dt>
                    <dd className="font-mono font-semibold text-[var(--text-primary)] break-all">
                      {activeReport.targetParentId}
                    </dd>
                  </div>
                )}
              </dl>

              {activeReport.details && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-[var(--text-primary)]">Reporter Notes</h4>
                  <p className="text-sm text-[var(--text-secondary)] p-3.5 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-subtle)]">
                    {activeReport.details}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={inspecting}
                  onClick={() => void handleInspectTarget(activeReport)}
                >
                  <span>{inspecting ? 'Loading target snapshot...' : 'Inspect Reported Content'}</span>
                </Button>

                {inspectedTarget && (
                  <div className="p-4 rounded-2xl border border-[var(--border-control)] bg-[var(--surface-inset)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {inspectedTarget.title}
                      </p>
                      <div className="flex gap-1.5">
                        {inspectedTarget.hidden && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-600/35 dark:bg-amber-950/70 dark:text-amber-200">
                            Hidden
                          </span>
                        )}
                        {inspectedTarget.deleted && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-red-50 text-red-800 border border-red-600/35 dark:bg-red-950/70 dark:text-red-200">
                            Deleted
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                      {inspectedTarget.body}
                    </p>
                    <p className="text-xs font-mono text-[var(--text-secondary)]">
                      {inspectedTarget.meta}
                    </p>
                    {inspectedTarget.imageUrls.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {inspectedTarget.imageUrls.map((url, idx) => (
                          <img
                            key={url}
                            src={url}
                            alt={`Reported attachment ${idx + 1}`}
                            className="w-full h-36 object-cover rounded-xl border border-[var(--border-default)]"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {activeReport.status === 'open' ? (
                <div className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-resolution-note`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Resolution Audit Note (optional)
                    </label>
                    <textarea
                      id={`${baseId}-resolution-note`}
                      rows={2}
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Record policy reason for action or dismissal"
                      className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={resolvingAction !== null}
                      onClick={() => void handleResolve(activeReport, 'dismiss')}
                    >
                      <span>{resolvingAction === 'dismiss' ? 'Dismissing...' : 'Dismiss Report'}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={resolvingAction !== null}
                      onClick={() => void handleResolve(activeReport, 'hide_content')}
                    >
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                      <span>{resolvingAction === 'hide_content' ? 'Hiding...' : 'Hide Content'}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={resolvingAction !== null}
                      onClick={() => void handleResolve(activeReport, 'delete_content')}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      <span>{resolvingAction === 'delete_content' ? 'Deleting...' : 'Delete Content'}</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1">
                  <p>
                    Reviewed by <span className="font-mono font-semibold text-[var(--text-primary)]">{activeReport.reviewedBy || 'admin'}</span>{' '}
                    on {activeReport.reviewedAt || activeReport.updatedAt}
                  </p>
                  {activeReport.resolutionNote && <p>Note: {activeReport.resolutionNote}</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
