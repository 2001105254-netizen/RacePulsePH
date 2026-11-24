import React, { useId, useState } from 'react';
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Flag,
  PackageCheck,
  Trophy,
  UserCheck,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { countInboxUnreadTotal } from '../../lib/runnerShell';
import type { RunnerReminder } from '../RunnerReminderCenter';

export interface InboxFriendRequestItem {
  fromUid: string;
  toUid: string;
  fromUsername: string;
  fromDisplayName: string;
  createdAt: string;
}

export interface InboxRaceInviteItem {
  fromUid: string;
  toUid: string;
  raceId: string;
  raceName: string;
  raceDate: string;
  fromDisplayName: string;
  createdAt: string;
}

export interface RunnerInboxPreviewPanelProps {
  incomingRequests: InboxFriendRequestItem[];
  raceInvites: InboxRaceInviteItem[];
  reminders: RunnerReminder[];
  canFriends: boolean;
  onAcceptRequest: (req: InboxFriendRequestItem) => Promise<void>;
  onDeclineRequest: (req: InboxFriendRequestItem) => Promise<void>;
  onOpenInvite: (invite: InboxRaceInviteItem) => Promise<void>;
  onOpenPass: (raceId: string) => void;
  onDismissReminder: (id: string) => void;
  onOpenFriends: () => void;
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export default function RunnerInboxPreviewPanel({
  incomingRequests,
  raceInvites,
  reminders,
  canFriends,
  onAcceptRequest,
  onDeclineRequest,
  onOpenInvite,
  onOpenPass,
  onDismissReminder,
  onOpenFriends,
}: RunnerInboxPreviewPanelProps) {
  const baseId = useId();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const totalUnread = countInboxUnreadTotal({
    pendingRequestsCount: incomingRequests.length,
    pendingInvitesCount: raceInvites.length,
    remindersCount: reminders.length,
  });

  const runAsyncAction = async (key: string, fn: () => Promise<void>, fallbackMessage: string) => {
    if (busyKey) return;
    setBusyKey(key);
    setActionError('');
    try {
      await fn();
    } catch (err: unknown) {
      setActionError(err instanceof Error && err.message ? err.message : fallbackMessage);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 pb-2">
      {/* Compact Inbox Summary Bar */}
      <section
        aria-label="Inbox summary"
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
              Activity Updates
            </h2>
            <span className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
              {totalUnread} {totalUnread === 1 ? 'item' : 'items'}
            </span>
          </div>
          <p className="text-xs font-normal text-[var(--text-secondary)]">
            Friend requests, race invitations, and race-day or kit reminders sync here in real time.
          </p>
        </div>

        {canFriends && (
          <button
            type="button"
            onClick={onOpenFriends}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            <UserPlus className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Find Friends</span>
          </button>
        )}
      </section>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-800 dark:text-red-300"
        >
          {actionError}
        </div>
      )}

      {totalUnread === 0 ? (
        <section
          aria-label="Empty inbox"
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-3"
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-700 dark:text-emerald-400 mx-auto" aria-hidden="true" />
          <h2 className="font-display font-semibold text-base text-[var(--text-primary)]">
            You are all caught up
          </h2>
          <p className="text-xs font-normal text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
            New friend requests, event invitations from friends, and race-day or kit reminders will appear here automatically.
          </p>
          {canFriends && (
            <button
              type="button"
              onClick={onOpenFriends}
              className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Users2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Find Friends</span>
            </button>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          {/* Group 1: Friend Requests */}
          {(canFriends || incomingRequests.length > 0) && (
            <section
              aria-labelledby={`${baseId}-requests-heading`}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Users2 className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <h2
                    id={`${baseId}-requests-heading`}
                    className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate"
                  >
                    Friend Requests
                  </h2>
                </div>
                <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                  {incomingRequests.length}
                </span>
              </div>

              {incomingRequests.length === 0 ? (
                <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <p className="text-xs font-normal text-[var(--text-secondary)]">
                    No pending friend requests right now.
                  </p>
                  {canFriends && (
                    <button
                      type="button"
                      onClick={onOpenFriends}
                      className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>Find Friends</span>
                    </button>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {incomingRequests.map((req) => {
                    const reqId = `${req.fromUid}_${req.toUid}`;
                    const isBusy = busyKey === `accept_${reqId}` || busyKey === `decline_${reqId}`;
                    return (
                      <li
                        key={reqId}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {req.fromDisplayName}
                          </p>
                          <p className="text-xs font-mono font-normal text-[var(--text-secondary)] truncate tabular-nums">
                            @{req.fromUsername}
                            {req.createdAt ? ` · ${formatShortDate(req.createdAt)}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() =>
                              void runAsyncAction(
                                `decline_${reqId}`,
                                () => onDeclineRequest(req),
                                'Could not decline friend request.',
                              )
                            }
                            className="min-h-11 flex-1 sm:flex-initial px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] disabled:opacity-60 cursor-pointer transition-colors"
                          >
                            {busyKey === `decline_${reqId}` ? 'Declining...' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() =>
                              void runAsyncAction(
                                `accept_${reqId}`,
                                () => onAcceptRequest(req),
                                'Could not accept friend request.',
                              )
                            }
                            className="min-h-11 flex-1 sm:flex-initial px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer transition-colors"
                          >
                            <UserCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>{busyKey === `accept_${reqId}` ? 'Accepting...' : 'Accept'}</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* Group 2: Race Invites */}
          <section
            aria-labelledby={`${baseId}-invites-heading`}
            className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <h2
                  id={`${baseId}-invites-heading`}
                  className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate"
                >
                  Race Invites
                </h2>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                {raceInvites.length}
              </span>
            </div>

            {raceInvites.length === 0 ? (
              <p className="px-4 py-3 text-xs font-normal text-[var(--text-secondary)]">
                No pending race invitations right now.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {raceInvites.map((invite) => {
                  const inviteId = `${invite.fromUid}_${invite.toUid}_${invite.raceId}`;
                  return (
                    <li
                      key={inviteId}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {invite.raceName}
                        </p>
                        <p className="text-xs font-normal text-[var(--text-secondary)] tabular-nums truncate">
                          Invited by {invite.fromDisplayName} · {invite.raceDate}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          void runAsyncAction(
                            `invite_${inviteId}`,
                            () => onOpenInvite(invite),
                            'Could not open race invitation.',
                          )
                        }
                        className="min-h-11 px-3.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer transition-colors"
                      >
                        <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{busyKey === `invite_${inviteId}` ? 'Opening...' : 'Open Event'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Group 3: Race & Kit Activity */}
          <section
            aria-labelledby={`${baseId}-activity-heading`}
            className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BellRing className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <h2
                  id={`${baseId}-activity-heading`}
                  className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate"
                >
                  Race &amp; Kit Activity
                </h2>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                {reminders.length}
              </span>
            </div>

            {reminders.length === 0 ? (
              <p className="px-4 py-3 text-xs font-normal text-[var(--text-secondary)]">
                All pre-race passes and kit check-ins are up to date.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {reminders.map((reminder) => {
                  const Icon =
                    reminder.kind === 'result'
                      ? Trophy
                      : reminder.kind === 'kit'
                        ? PackageCheck
                        : CalendarDays;
                  const iconColor =
                    reminder.kind === 'result'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : reminder.kind === 'kit'
                        ? 'text-amber-800 dark:text-amber-300'
                        : 'text-red-700 dark:text-red-400';

                  return (
                    <li
                      key={reminder.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">
                            {reminder.title}
                          </p>
                          <p className="text-xs font-normal text-[var(--text-secondary)] leading-snug">
                            {reminder.detail}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenPass(reminder.raceId)}
                          className="min-h-11 flex-1 sm:flex-initial px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap cursor-pointer transition-colors"
                        >
                          Open Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismissReminder(reminder.id)}
                          aria-label={`Dismiss ${reminder.title}`}
                          className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          <X className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Dismiss</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
