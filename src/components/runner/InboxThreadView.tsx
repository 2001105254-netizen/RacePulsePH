import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  ArrowLeft,
  Award,
  Check,
  Flame,
  Flag,
  ImagePlus,
  Send,
  Share2,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import type { BadgeDefinition, UserBadgeAward } from '../../lib/badges/types';
import {
  E2E_CONVERSATIONS_KEY,
  E2E_INBOX_MESSAGES_KEY,
  E2E_NOTIFICATIONS_KEY,
  E2E_STREAKS_KEY,
  markDevInboxReadFixture,
  moderateDevInboxMessageFixture,
  readDevSessionJson,
  respondDevMessageRequestFixture,
  sendDevInboxMessageFixture,
} from '../../lib/clubs/e2eFixtures';
import type { ClubDefinition } from '../../lib/clubs/types';
import {
  markInboxRead,
  moderateInboxMessage,
  respondMessageRequest,
  sendInboxMessage,
  subscribeConversationMessages,
  uploadChatMediaImage,
  validateChatMediaUploadFile,
} from '../../lib/inbox/client';
import { collectUnsignedChatMediaPaths } from '../../lib/inbox/helpers';
import {
  formatChatStreakLabel,
  type ActivityNotificationRecord,
  type FriendStreakRecord,
  type InboxChatMedia,
  type InboxConversationRecord,
  type InboxMessageRecord,
  type InboxShareCard,
} from '../../lib/inbox/types';
import { createCommunityRequestId } from '../../lib/runs/communityRunsClient';
import type { RecordedRunSummary } from '../../lib/runs/types';
import { signMediaPaths } from '../../lib/social/client';
import type { Race, UserProfile } from '../../types';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import ReportContentDialog from './ReportContentDialog';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

export interface InboxThreadViewProps {
  conversation: InboxConversationRecord;
  title: string;
  subtitle?: string;
  peerUid?: string | null;
  streak?: FriendStreakRecord | null;
  profile: UserProfile;
  canModerateClub: boolean;
  isMobile: boolean;
  races: Race[];
  recordedRuns: RecordedRunSummary[];
  clubs: ClubDefinition[];
  badgeCatalog: BadgeDefinition[];
  userBadges: UserBadgeAward[];
  onBack?: () => void;
  onConversationUpdated?: (conv: InboxConversationRecord) => void;
  onConversationRemoved?: (conversationId: string) => void;
  onStreakUpdated?: (streak: FriendStreakRecord) => void;
  onOpenShareTarget?: (card: InboxShareCard) => void;
}

export default function InboxThreadView({
  conversation,
  title,
  subtitle,
  streak,
  profile,
  canModerateClub,
  isMobile,
  races,
  recordedRuns,
  clubs,
  badgeCatalog,
  userBadges,
  onBack,
  onConversationUpdated,
  onConversationRemoved,
  onStreakUpdated,
  onOpenShareTarget,
}: InboxThreadViewProps) {
  const { confirm, notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isE2e = import.meta.env.DEV && profile.uid.startsWith('e2e-');

  const [messages, setMessages] = useState<InboxMessageRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const [draftText, setDraftText] = useState('');
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState('');
  const [pendingShareCard, setPendingShareCard] = useState<InboxShareCard | null>(null);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);

  const [sending, setSending] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<InboxMessageRecord | null>(null);

  const previewUrlRef = useRef('');
  previewUrlRef.current = pendingPhotoPreview;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const clearPendingPhoto = useCallback(() => {
    setPendingPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setPendingPhotoFile(null);
  }, []);

  useEffect(() => {
    clearPendingPhoto();
    setPendingShareCard(null);
    setDraftText('');
  }, [conversation.conversationId, clearPendingPhoto]);

  useEffect(() => {
    if (isE2e) {
      const stored = readDevSessionJson<InboxMessageRecord>(E2E_INBOX_MESSAGES_KEY) ?? [];
      setMessages(stored.filter((m) => m.conversationId === conversation.conversationId));
      setLoaded(true);
      setLoadError('');
      return;
    }

    setLoaded(false);
    setLoadError('');
    const unsub = subscribeConversationMessages(conversation.conversationId, (res) => {
      setMessages(res.messages);
      setLoaded(res.loaded);
      setLoadError(res.error || '');
    });
    return unsub;
  }, [conversation.conversationId, isE2e]);

  useEffect(() => {
    if (isE2e) return;
    const paths = collectUnsignedChatMediaPaths(messages);
    if (paths.length === 0) return;
    let cancelled = false;
    void signMediaPaths(paths)
      .then((res) => {
        if (!cancelled) {
          setSignedUrls((prev) => ({ ...prev, ...res.signedUrls }));
        }
      })
      .catch((err) => {
        console.warn('[InboxThreadView] signMediaPaths failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [messages, isE2e]);

  // Auto-mark unread DM read when opening the conversation
  useEffect(() => {
    const unread = conversation.unreadByUid?.[profile.uid] ?? 0;
    if (conversation.type !== 'dm' || unread <= 0) return;
    if (isE2e) {
      const convs = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [];
      const notifs = readDevSessionJson<ActivityNotificationRecord>(E2E_NOTIFICATIONS_KEY) ?? [];
      const out = markDevInboxReadFixture(convs, notifs, {
        conversationId: conversation.conversationId,
        myUid: profile.uid,
      });
      const updated = out.conversations.find((c) => c.conversationId === conversation.conversationId);
      if (updated) onConversationUpdated?.(updated);
      return;
    }
    void markInboxRead({ conversationId: conversation.conversationId }).catch(() => undefined);
  }, [conversation.conversationId, conversation.type, conversation.unreadByUid, profile.uid, isE2e, onConversationUpdated]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages.length, conversation.conversationId]);

  const isPendingReq = conversation.status === 'request_pending';
  const isIncomingReq = isPendingReq && conversation.requestedToUid === profile.uid;
  const isOutgoingReq = isPendingReq && conversation.requestedByUid === profile.uid;
  const outgoingIntroAlreadySent = isOutgoingReq && Boolean(conversation.lastMessageAt);
  const composerDisabled = isIncomingReq || outgoingIntroAlreadySent || sending;
  const canAttachPhoto = conversation.status === 'active' && !composerDisabled;

  const badgeById = useMemo(
    () => new Map(badgeCatalog.map((b) => [b.badgeId, b])),
    [badgeCatalog],
  );

  const shareChoices = useMemo(() => {
    const list: Array<{ group: string; cards: InboxShareCard[] }> = [];
    if (races.length > 0) {
      list.push({
        group: 'Races',
        cards: races.slice(0, 6).map((r) => ({
          type: 'race',
          targetId: r.id,
          title: r.name,
          subtitle: r.date,
        })),
      });
    }
    if (recordedRuns.length > 0) {
      list.push({
        group: 'Recorded Runs',
        cards: recordedRuns.slice(0, 6).map((run) => ({
          type: 'run',
          targetId: run.runId,
          title: run.title,
          subtitle: `${(run.distanceM / 1000).toFixed(2)} km`,
        })),
      });
    }
    if (clubs.length > 0) {
      list.push({
        group: 'Run Clubs',
        cards: clubs.slice(0, 6).map((c) => ({
          type: 'club',
          targetId: c.clubId,
          title: c.name,
          subtitle: c.city,
        })),
      });
    }
    if (userBadges.length > 0) {
      list.push({
        group: 'Earned Badges',
        cards: userBadges.slice(0, 6).map((ub) => {
          const def = badgeById.get(ub.badgeId);
          return {
            type: 'badge',
            targetId: ub.badgeId,
            title: def?.name || ub.badgeName || ub.badgeId,
            subtitle: `${ub.tier} Crest`,
          };
        }),
      });
    }
    return list;
  }, [races, recordedRuns, clubs, userBadges, badgeById]);

  const handlePhotoPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const check = validateChatMediaUploadFile({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      notify({ tone: 'error', title: 'Invalid chat photo', message: check.error });
      return;
    }
    clearPendingPhoto();
    setPendingPhotoFile(file);
    setPendingPhotoPreview(URL.createObjectURL(file));
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (composerDisabled) return;
    const cleanText = draftText.trim();
    if (!cleanText && !pendingPhotoFile && !pendingShareCard) return;

    setSending(true);
    try {
      let mediaPayload: InboxChatMedia | undefined;
      if (pendingPhotoFile) {
        if (isE2e) {
          mediaPayload = {
            storagePath: `chat-media/${conversation.conversationId}/${profile.uid}/${pendingPhotoFile.name}`,
            mimeType: pendingPhotoFile.type || 'image/jpeg',
            sizeBytes: pendingPhotoFile.size,
          };
        } else {
          mediaPayload = await uploadChatMediaImage(
            conversation.conversationId,
            profile.uid,
            pendingPhotoFile,
          );
        }
      }

      const messageId = `msg_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      if (isE2e) {
        const allConvs =
          readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [conversation];
        const allMsgs = readDevSessionJson<InboxMessageRecord>(E2E_INBOX_MESSAGES_KEY) ?? messages;
        const allStreaks = readDevSessionJson<FriendStreakRecord>(E2E_STREAKS_KEY) ?? [];
        const out = sendDevInboxMessageFixture(allConvs, allMsgs, allStreaks, {
          conversationId: conversation.conversationId,
          messageId,
          senderUid: profile.uid,
          senderDisplayName: profile.nickname || profile.displayName || 'Runner',
          text: cleanText,
          shareCard: pendingShareCard || undefined,
          media: mediaPayload,
        });
        if (!mountedRef.current) return;
        setMessages(out.messages.filter((m) => m.conversationId === conversation.conversationId));
        const updatedConv = out.conversations.find((c) => c.conversationId === conversation.conversationId);
        if (updatedConv) onConversationUpdated?.(updatedConv);
        const updatedStreak = out.streaks.find((s) => s.id === conversation.conversationId);
        if (updatedStreak) onStreakUpdated?.(updatedStreak);
      } else {
        const res = await sendInboxMessage({
          conversationId: conversation.conversationId,
          messageId,
          ...(cleanText ? { text: cleanText } : {}),
          ...(pendingShareCard ? { shareCard: pendingShareCard } : {}),
          ...(mediaPayload ? { media: mediaPayload } : {}),
        });
        if (!mountedRef.current) return;
        onConversationUpdated?.(res.conversation);
        if (res.streak) onStreakUpdated?.(res.streak);
      }

      setDraftText('');
      clearPendingPhoto();
      setPendingShareCard(null);
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Message failed',
        message: err instanceof Error && err.message ? err.message : 'Unable to send message.',
      });
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const handleRespondRequest = async (decision: 'accept' | 'decline') => {
    if (reqBusy) return;
    setReqBusy(true);
    try {
      if (isE2e) {
        const convs = readDevSessionJson<InboxConversationRecord>(E2E_CONVERSATIONS_KEY) ?? [conversation];
        const next = respondDevMessageRequestFixture(convs, conversation.conversationId, decision);
        if (!mountedRef.current) return;
        if (decision === 'accept') {
          const updated = next.find((c) => c.conversationId === conversation.conversationId);
          if (updated) onConversationUpdated?.(updated);
        } else {
          onConversationRemoved?.(conversation.conversationId);
        }
      } else {
        const res = await respondMessageRequest(conversation.conversationId, decision);
        if (!mountedRef.current) return;
        if (decision === 'accept' && res.conversation) {
          onConversationUpdated?.(res.conversation);
        } else if (decision === 'decline') {
          onConversationRemoved?.(conversation.conversationId);
        }
      }
      notify({
        tone: decision === 'accept' ? 'success' : 'info',
        title: decision === 'accept' ? 'Message request accepted' : 'Message request declined',
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Request update failed',
        message: err instanceof Error ? err.message : 'Unable to update message request.',
      });
    } finally {
      if (mountedRef.current) setReqBusy(false);
    }
  };

  const handleDeleteMessage = async (msg: InboxMessageRecord) => {
    const ok = await confirm({
      title: 'Delete message?',
      message: 'This message will be hidden from the conversation thread.',
      confirmLabel: 'Delete Message',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isE2e) {
        const all = readDevSessionJson<InboxMessageRecord>(E2E_INBOX_MESSAGES_KEY) ?? messages;
        const next = moderateDevInboxMessageFixture(
          all,
          conversation.conversationId,
          msg.messageId,
        );
        if (!mountedRef.current) return;
        setMessages(next.filter((m) => m.conversationId === conversation.conversationId));
      } else {
        await moderateInboxMessage(conversation.conversationId, msg.messageId);
      }
      if (!mountedRef.current) return;
      notify({ tone: 'info', title: 'Message removed' });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Unable to delete message.',
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--surface-page)] overflow-hidden">
      {/* Sticky Thread Header */}
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to inbox"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-[var(--text-primary)] shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {conversation.type === 'dm' && conversation.status === 'active' && streak && (
          <span
            title="Daily PHT chat streak updates when both runners message on the same Manila calendar day."
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 tabular-nums ${
              streak.streakDays > 0
                ? 'border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200'
                : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
            }`}
          >
            <Flame className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{formatChatStreakLabel(streak.streakDays, streak.graceRemaining)}</span>
          </span>
        )}
      </header>

      {/* Message Request Decision or Outgoing Gate Banner */}
      {isIncomingReq && (
        <div className="shrink-0 border-b border-amber-600/35 bg-amber-500/10 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)]">Message Request</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Accept to reply and unlock photo sharing in this DM.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={reqBusy}
              onClick={() => void handleRespondRequest('decline')}
              className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={reqBusy}
              onClick={() => void handleRespondRequest('accept')}
              className="min-h-11 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Accept</span>
            </button>
          </div>
        </div>
      )}

      {isOutgoingReq && (
        <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {outgoingIntroAlreadySent
            ? 'Intro message sent. Additional messages and photos unlock once accepted.'
            : 'Send one intro message to this runner.'}
        </div>
      )}

      {/* Scrollable Messages Viewport */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll p-3 sm:p-4 space-y-3">
        {!loaded ? (
          <RunnerQueueSkeleton rows={4} label="Loading messages" />
        ) : loadError ? (
          <p role="alert" className="rounded-xl border border-red-600/35 bg-red-500/10 p-3 text-xs font-semibold text-red-700 dark:text-red-300">
            {loadError}
          </p>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <p className="text-sm font-semibold text-[var(--text-primary)]">No messages yet</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Send a message, photo, or shared race/run card below.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderUid === profile.uid;
            const isDeleted = Boolean(msg.deletedAt) || msg.hiddenByModeration === true;
            const mediaUrl = msg.media?.storagePath ? signedUrls[msg.media.storagePath] : '';
            const canDelete = !isDeleted && (isMine || canModerateClub);

            return (
              <div
                key={msg.messageId}
                className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] px-1">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {isMine ? 'You' : msg.senderDisplayName || msg.senderUid}
                  </span>
                  <span className="font-mono">{msg.createdAt.slice(11, 16)}</span>
                </div>

                {isDeleted ? (
                  <p className="px-3 py-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)]">
                    Message removed
                  </p>
                ) : (
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl border p-3 space-y-2 ${
                      isMine
                        ? 'border-red-600/35 bg-red-600/10 text-[var(--text-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]'
                    }`}
                  >
                    {msg.text && (
                      <p className="text-sm font-normal whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    )}

                    {msg.media?.storagePath && (
                      mediaUrl ? (
                        <img
                          src={mediaUrl}
                          alt="Chat photo attachment"
                          loading="lazy"
                          className="max-h-64 rounded-xl border border-[var(--border-default)] object-cover"
                        />
                      ) : (
                        <div className="h-28 px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center text-xs font-mono text-[var(--text-secondary)]">
                          Signed photo ({msg.media.mimeType})
                        </div>
                      )
                    )}

                    {msg.shareCard && (
                      <button
                        type="button"
                        onClick={() => onOpenShareTarget?.(msg.shareCard!)}
                        className="w-full min-h-11 px-3 py-2 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-left flex items-center gap-2.5 cursor-pointer"
                      >
                        <Trophy className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-[var(--text-primary)] truncate">
                            {msg.shareCard.title}
                          </span>
                          {msg.shareCard.subtitle && (
                            <span className="block text-xs font-mono text-[var(--text-secondary)] truncate">
                              {msg.shareCard.type.toUpperCase()} · {msg.shareCard.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {!isDeleted && (
                  <div className="flex items-center gap-1 px-1">
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteMessage(msg)}
                        aria-label="Delete message"
                        className="min-h-11 lg:min-h-9 min-w-[44px] px-2.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-300 inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    )}
                    {!isMine && (
                      <button
                        type="button"
                        onClick={() => setReportTarget(msg)}
                        aria-label="Report message"
                        className="min-h-11 lg:min-h-9 min-w-[44px] px-2.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-300 inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Flag className="w-3 h-3" aria-hidden="true" />
                        <span>Report</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Pending Attachments Bar */}
      {(pendingPhotoPreview || pendingShareCard) && (
        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-wrap items-center gap-2">
          {pendingPhotoPreview && (
            <div className="relative">
              <img
                src={pendingPhotoPreview}
                alt="Pending chat photo"
                className="h-14 w-14 rounded-lg object-cover border border-[var(--border-default)]"
              />
              <button
                type="button"
                onClick={clearPendingPhoto}
                aria-label="Remove attached photo"
                className="absolute -top-2 -right-2 min-h-11 min-w-11 rounded-full bg-zinc-900 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          {pendingShareCard && (
            <span className="min-h-11 pl-3 pr-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>{pendingShareCard.title}</span>
              <button
                type="button"
                onClick={() => setPendingShareCard(null)}
                aria-label="Remove share card"
                className="min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Sticky Thumb-Zone Composer Bar */}
      <form
        onSubmit={handleSend}
        className="shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center gap-2"
      >
        <label
          className={`min-h-11 min-w-11 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] flex items-center justify-center text-[var(--text-primary)] shrink-0 ${
            canAttachPhoto ? 'hover:bg-[var(--surface-hover)] cursor-pointer' : 'opacity-40 cursor-not-allowed'
          }`}
          title={canAttachPhoto ? 'Attach photo (< 8 MB)' : 'Photos available in active chats'}
        >
          <ImagePlus className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">Attach chat photo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            disabled={!canAttachPhoto}
            onChange={handlePhotoPick}
            className="sr-only"
          />
        </label>

        <button
          type="button"
          disabled={composerDisabled || shareChoices.length === 0}
          onClick={() => setSharePickerOpen(true)}
          aria-label="Attach race, run, club, or badge card"
          title="Share Race, Run, Club, or Badge"
          className="min-h-11 min-w-11 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40"
        >
          <Share2 className="w-4 h-4" aria-hidden="true" />
        </button>

        <input
          aria-label="Message text"
          maxLength={1000}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          disabled={composerDisabled}
          placeholder={
            isIncomingReq
              ? 'Accept request to reply...'
              : outgoingIntroAlreadySent
                ? 'Waiting for reply acceptance...'
                : 'Write a message...'
          }
          className="flex-1 min-w-0 min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
        />

        <button
          type="submit"
          disabled={composerDisabled || (!draftText.trim() && !pendingPhotoFile && !pendingShareCard)}
          aria-label="Send message"
          className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
        >
          <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{sending ? 'Sending...' : 'Send'}</span>
        </button>
      </form>

      {/* Share Card Picker Sheet */}
      {sharePickerOpen && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="30rem"
          titleId={`${baseId}-share-title`}
          onRequestClose={() => setSharePickerOpen(false)}
          bodyClassName="p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 id={`${baseId}-share-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
              Share to Chat
            </h3>
            <button
              type="button"
              onClick={() => setSharePickerOpen(false)}
              aria-label="Close share picker"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-4">
            {shareChoices.map((group) => (
              <div key={group.group} className="space-y-1.5">
                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  {group.group}
                </p>
                <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                  {group.cards.map((card) => (
                    <button
                      key={`${card.type}_${card.targetId}`}
                      type="button"
                      onClick={() => {
                        setPendingShareCard(card);
                        setSharePickerOpen(false);
                      }}
                      className="w-full min-h-11 px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-[var(--surface-hover)] cursor-pointer"
                    >
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {card.title}
                      </span>
                      {card.subtitle && (
                        <span className="text-xs font-mono text-[var(--text-secondary)] shrink-0">
                          {card.subtitle}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogSurface>
      )}

      <ReportContentDialog
        open={Boolean(reportTarget)}
        actorUid={profile.uid}
        targetType="message"
        targetId={reportTarget?.messageId || ''}
        targetParentId={conversation.conversationId}
        targetUid={reportTarget?.senderUid}
        targetLabel={reportTarget?.text || `Message from ${reportTarget?.senderDisplayName || 'runner'}`}
        onClose={() => setReportTarget(null)}
      />
    </div>
  );
}
