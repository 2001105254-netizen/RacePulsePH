import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Award, CheckCircle2, Play, Search, Square, Users } from 'lucide-react';
import {
  evaluateRetroactiveBadges,
  grantBadgeToRunner,
  type EvaluateRetroactiveResult,
} from '../../lib/badges/client';
import {
  E2E_BADGES_KEY,
  E2E_GRANTS_KEY,
  E2E_USERS_KEY,
  evaluateDevRetroactiveFixture,
  grantDevBadgeFixture,
  readDevSessionJson,
  writeDevSessionJson,
  type DevBadgeGrantRecord,
} from '../../lib/badges/e2eFixtures';
import {
  BADGE_TIER_META,
  formatBadgeRuleSummary,
} from '../../lib/badges/presets';
import type { BadgeDefinition } from '../../lib/badges/types';
import type { UserProfile } from '../../types';
import BadgeArtwork from '../badges/BadgeArtwork';
import { useFeedback } from '../ui/FeedbackProvider';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, type SelectOption } from '../ui/Select';

const TARGET_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const FORBIDDEN_UIDS = new Set(['__proto__', 'constructor', 'prototype']);

function isValidDirectTargetUid(raw: string): boolean {
  const trimmed = raw.trim();
  return TARGET_UID_RE.test(trimmed) && !FORBIDDEN_UIDS.has(trimmed);
}

export interface ManualGrantTabProps {
  badges: BadgeDefinition[];
  users: UserProfile[];
  usersLoaded: boolean;
  usersError: string | null;
  canViewUsers: boolean;
  isE2eFixtureMode?: boolean;
  actorUid?: string;
}

export function ManualGrantTab({
  badges,
  users,
  usersLoaded,
  usersError,
  canViewUsers,
  isE2eFixtureMode = false,
  actorUid = 'e2e-admin',
}: ManualGrantTabProps) {
  const baseId = useId();
  const { confirm, notify } = useFeedback();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showDirectUidInput = !canViewUsers && !isE2eFixtureMode;

  const activeBadges = useMemo(
    () => badges.filter((badge) => badge.status === 'active'),
    [badges],
  );
  const [selectedBadgeId, setSelectedBadgeId] = useState<string>('');
  const [runnerSearch, setRunnerSearch] = useState('');
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [directTargetUid, setDirectTargetUid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAwardSummary, setLastAwardSummary] = useState<string | null>(null);

  const resolvedBadgeId =
    selectedBadgeId && activeBadges.some((b) => b.badgeId === selectedBadgeId)
      ? selectedBadgeId
      : activeBadges[0]?.badgeId || '';

  const selectedBadge = useMemo(
    () => activeBadges.find((b) => b.badgeId === resolvedBadgeId) || null,
    [activeBadges, resolvedBadgeId],
  );

  const badgeOptions: SelectOption[] = useMemo(
    () =>
      activeBadges.map((badge) => {
        const tierLabel =
          badge.customTierLabel?.trim() || BADGE_TIER_META[badge.tier]?.label || badge.tier;
        return {
          value: badge.badgeId,
          label: badge.name,
          sublabel: `${badge.badgeId} (${badge.xpReward} XP)`,
          badge: tierLabel,
          accentDot: badge.primaryColor,
        };
      }),
    [activeBadges],
  );

  const activeUsers = useMemo(() => {
    const eligible = users.filter((u) => !u.accessRemoved);
    return [...eligible].sort((a, b) => {
      if (a.role === 'runner' && b.role !== 'runner') return -1;
      if (a.role !== 'runner' && b.role === 'runner') return 1;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
  }, [users]);

  const filteredUsers = useMemo(() => {
    const term = runnerSearch.trim().toLowerCase();
    if (!term) return activeUsers.slice(0, 40);
    return activeUsers
      .filter((u) => {
        const haystack = `${u.displayName} ${u.nickname || ''} ${u.username || ''} ${u.email} ${u.uid}`.toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 40);
  }, [activeUsers, runnerSearch]);

  const selectedRunner = useMemo(
    () => activeUsers.find((u) => u.uid === selectedUid) || null,
    [activeUsers, selectedUid],
  );

  const trimmedDirectUid = directTargetUid.trim();
  const directUidReady = showDirectUidInput ? isValidDirectTargetUid(trimmedDirectUid) : false;
  const resolvedTargetUid = showDirectUidInput
    ? (directUidReady ? trimmedDirectUid : '')
    : (selectedRunner?.uid ?? '');
  const targetDisplayLabel = showDirectUidInput
    ? trimmedDirectUid
    : (selectedRunner?.displayName ?? '');

  const handleGrant = async () => {
    if (!selectedBadge || !resolvedTargetUid || busy) return;
    setError(null);

    if (showDirectUidInput && !isValidDirectTargetUid(resolvedTargetUid)) {
      setError('Target Runner UID must be 1 to 128 characters (letters, numbers, underscore, or hyphen).');
      return;
    }

    const trimmedNote = note.trim();
    if (trimmedNote.length > 200) {
      setError('Grant note must be 200 characters or fewer.');
      return;
    }

    const confirmed = await confirm({
      title: `Grant "${selectedBadge.name}"?`,
      message: `Award ${selectedBadge.name} (+${selectedBadge.xpReward} XP) to ${targetDisplayLabel}. This action is recorded in their Trophy Case and XP ledger.`,
      confirmLabel: 'Grant badge',
      cancelLabel: 'Cancel',
    });
    if (!confirmed || !mountedRef.current) return;

    setBusy(true);
    try {
      const result =
        import.meta.env.DEV && isE2eFixtureMode
          ? (() => {
              const existingGrants =
                readDevSessionJson<DevBadgeGrantRecord>(E2E_GRANTS_KEY) ?? [];
              const fixtureRes = grantDevBadgeFixture(
                selectedBadge,
                resolvedTargetUid,
                existingGrants,
                trimmedNote || undefined,
                actorUid,
              );
              writeDevSessionJson(E2E_GRANTS_KEY, fixtureRes.grants);
              return fixtureRes;
            })()
          : await grantBadgeToRunner({
              badgeId: selectedBadge.badgeId,
              targetUid: resolvedTargetUid,
              ...(trimmedNote ? { note: trimmedNote } : {}),
            });
      if (!mountedRef.current) return;
      setNote('');
      if (showDirectUidInput) setDirectTargetUid('');
      setLastAwardSummary(
        `Granted ${selectedBadge.name} (+${result.xpAwarded} XP) to ${targetDisplayLabel}. Level ${result.progression.level} (${result.progression.totalXp} XP total).`,
      );
      notify({
        tone: 'success',
        title: 'Badge granted',
        message: `${targetDisplayLabel} earned ${selectedBadge.name} (+${result.xpAwarded} XP).`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to grant badge right now.';
      setError(message);
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <section
        aria-labelledby={`${baseId}-grant-badge-heading`}
        className="lg:col-span-5 glass-panel p-4 sm:p-6 space-y-4"
      >
        <div>
          <h3
            id={`${baseId}-grant-badge-heading`}
            className="text-base font-semibold font-display text-[var(--text-primary)]"
          >
            1. Select Active Badge
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Only active badges can be issued manually. Archived badges are excluded.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`${baseId}-badge-select`}
            className="block text-xs font-semibold text-[var(--text-primary)]"
          >
            Badge to award
          </label>
          <Select
            id={`${baseId}-badge-select`}
            value={resolvedBadgeId}
            options={badgeOptions}
            onChange={setSelectedBadgeId}
            searchable
            searchPlaceholder="Search active badges..."
            placeholder="Select an active badge"
            surface="inset"
          />
        </div>

        {selectedBadge ? (
          <div className="glass-inset p-4 flex items-center gap-4">
            <BadgeArtwork badge={selectedBadge} size="lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {selectedBadge.name}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold border border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)]">
                  +{selectedBadge.xpReward} XP
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {selectedBadge.description}
              </p>
              <p className="text-xs font-mono text-[var(--text-secondary)]">
                Rule: {formatBadgeRuleSummary(selectedBadge.rule)}
              </p>
            </div>
          </div>
        ) : (
          <div className="glass-inset p-4 text-xs text-[var(--text-secondary)]">
            No active badges exist yet. Seed the starter pack or create a badge first.
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor={`${baseId}-note`}
            className="block text-xs font-semibold text-[var(--text-primary)]"
          >
            Optional steward note (max 200 characters)
          </label>
          <Input
            id={`${baseId}-note`}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for manual honor (optional)"
          />
          <p className="text-xs text-[var(--text-secondary)]">
            {note.trim().length}/200 characters
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-600/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {lastAwardSummary && (
          <div
            role="status"
            className="rounded-xl border border-emerald-600/35 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-start gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{lastAwardSummary}</span>
          </div>
        )}

        <Button
          type="button"
          disabled={!selectedBadge || !resolvedTargetUid || busy}
          onClick={() => void handleGrant()}
          className="w-full min-h-11 bg-red-700 hover:bg-red-600 text-white"
        >
          <Award className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{busy ? 'Granting badge...' : 'Grant Badge & Award XP'}</span>
        </Button>
      </section>

      <section
        aria-labelledby={`${baseId}-grant-runner-heading`}
        className="lg:col-span-7 glass-panel p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id={`${baseId}-grant-runner-heading`}
              className="text-base font-semibold font-display text-[var(--text-primary)]"
            >
              {showDirectUidInput ? '2. Target Runner UID' : '2. Pick Runner Account'}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {showDirectUidInput
                ? 'Runner directory browsing requires users.view. Enter the athlete UID directly to issue a manual grant.'
                : usersLoaded
                  ? `${activeUsers.length} active account${activeUsers.length === 1 ? '' : 's'} available.`
                  : 'Loading athlete accounts...'}
            </p>
          </div>
          {resolvedTargetUid && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-red-600/40 bg-red-500/10 text-xs font-semibold text-red-700 dark:text-red-300">
              Selected: {targetDisplayLabel}
            </span>
          )}
        </div>

        {showDirectUidInput ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor={`${baseId}-target-uid`}
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Target Runner UID (letters, numbers, underscore, or hyphen)
              </label>
              <Input
                id={`${baseId}-target-uid`}
                value={directTargetUid}
                maxLength={128}
                onChange={(e) => {
                  setDirectTargetUid(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. athlete_uid_2026"
                className="font-mono"
              />
              {trimmedDirectUid.length > 0 && !directUidReady && (
                <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                  UID must be 1 to 128 characters using only letters, numbers, underscores, or hyphens.
                </p>
              )}
            </div>
            <div className="glass-inset p-4 text-xs text-[var(--text-secondary)]">
              Grant actions are verified server-side against active athlete profiles before issuing XP or updating Trophy Cases.
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <label htmlFor={`${baseId}-runner-search`} className="sr-only">
                Search runners by name, username, email, or UID
              </label>
              <Search
                className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <Input
                id={`${baseId}-runner-search`}
                type="search"
                value={runnerSearch}
                onChange={(e) => setRunnerSearch(e.target.value)}
                placeholder="Search by name, @username, email, or UID"
                className="pl-10"
              />
            </div>

            {usersError && (
              <div
                role="alert"
                className="rounded-xl border border-red-600/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                {usersError}
              </div>
            )}

            {filteredUsers.length === 0 ? (
              <div className="glass-inset p-6 text-center space-y-2">
                <Users className="w-6 h-6 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {usersLoaded ? 'No matching active accounts found' : 'Loading runner directory...'}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {runnerSearch
                    ? 'Try clearing or broadening your search term.'
                    : 'Active runner accounts will appear here once signed up.'}
                </p>
              </div>
            ) : (
              <div
                role="listbox"
                aria-label="Runner accounts"
                className="space-y-2 max-h-[28rem] overflow-y-auto pr-1"
              >
                {filteredUsers.map((user) => {
                  const isSelected = user.uid === selectedUid;
                  return (
                    <button
                      key={user.uid}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedUid(user.uid);
                        setError(null);
                      }}
                      className={`w-full min-h-11 px-3.5 py-2.5 rounded-xl border text-left flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 transition-colors ${
                        isSelected
                          ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {user.displayName}
                          {user.username ? ` (@${user.username})` : ''}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] truncate">
                          {user.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-mono text-[var(--text-secondary)]">
                          {user.role}
                        </span>
                        <span className="text-xs font-mono text-[var(--text-secondary)] hidden sm:inline">
                          {user.uid.slice(0, 10)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export interface RetroactiveSyncTabProps {
  isE2eFixtureMode?: boolean;
}

export function RetroactiveSyncTab({
  isE2eFixtureMode = false,
}: RetroactiveSyncTabProps) {
  const baseId = useId();
  const { notify } = useFeedback();
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const [batchCount, setBatchCount] = useState(0);
  const [processedUsers, setProcessedUsers] = useState(0);
  const [newlyAwardedCount, setNewlyAwardedCount] = useState(0);
  const [lastCursor, setLastCursor] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setBatchCount(0);
    setProcessedUsers(0);
    setNewlyAwardedCount(0);
    setLastCursor(null);
    setError(null);
    setStatusMessage('Evaluating active runner accounts in batches of 25...');

    let afterUid: string | null = null;
    let totalProcessed = 0;
    let totalAwarded = 0;
    let batches = 0;

    try {
      while (!cancelRef.current) {
        let res: EvaluateRetroactiveResult;
        if (import.meta.env.DEV && isE2eFixtureMode) {
          await Promise.resolve();
          const fixtureBadges =
            readDevSessionJson<BadgeDefinition>(E2E_BADGES_KEY) ?? [];
          const fixtureUsers =
            readDevSessionJson<UserProfile>(E2E_USERS_KEY) ?? [];
          res = evaluateDevRetroactiveFixture(fixtureBadges, fixtureUsers);
        } else {
          res = await evaluateRetroactiveBadges({
            afterUid,
            limit: 25,
          });
        }
        if (!mountedRef.current) return;
        batches += 1;
        totalProcessed += res.processedUsers;
        totalAwarded += res.newlyAwardedCount;

        setBatchCount(batches);
        setProcessedUsers(totalProcessed);
        setNewlyAwardedCount(totalAwarded);
        setLastCursor(res.nextAfterUid);

        if (!res.hasMore || !res.nextAfterUid) {
          setStatusMessage(
            `Retroactive sync complete: evaluated ${totalProcessed} accounts across ${batches} batch${batches === 1 ? '' : 'es'} and awarded ${totalAwarded} badge${totalAwarded === 1 ? '' : 's'}.`,
          );
          notify({
            tone: 'success',
            title: 'Retroactive sync complete',
            message: `Processed ${totalProcessed} accounts and awarded ${totalAwarded} badges.`,
          });
          return;
        }
        afterUid = res.nextAfterUid;
      }

      if (mountedRef.current) {
        setStatusMessage(
          `Sync stopped after ${batches} batch${batches === 1 ? '' : 'es'} (${totalProcessed} accounts processed, ${totalAwarded} badges awarded).`,
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Retroactive evaluation failed.';
      setError(message);
      setStatusMessage(null);
    } finally {
      if (mountedRef.current) {
        setRunning(false);
      }
    }
  };

  const handleStop = () => {
    cancelRef.current = true;
    setStatusMessage('Stopping after the current batch finishes...');
  };

  return (
    <section
      aria-labelledby={`${baseId}-retro-sync-heading`}
      className="glass-panel p-4 sm:p-6 max-w-3xl space-y-5"
    >
      <div>
        <h3
          id={`${baseId}-retro-sync-heading`}
          className="text-base font-semibold font-display text-[var(--text-primary)]"
        >
          Retroactive Achievement Evaluator
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Scans active athlete accounts in cursor-paginated batches of 25 and awards any
          active non-manual badges they already qualify for without duplicating awards.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={running}
          onClick={() => void handleStart()}
          className="min-h-11 bg-red-700 hover:bg-red-600 text-white"
        >
          <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{running ? 'Running Sync...' : 'Run Retroactive Sync'}</span>
        </Button>

        {running && (
          <Button
            type="button"
            variant="outline"
            onClick={handleStop}
            className="min-h-11"
          >
            <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Stop</span>
          </Button>
        )}
      </div>

      {running && (
        <div className="space-y-2">
          <label htmlFor={`${baseId}-retro-sync-progress`} className="sr-only">
            Retroactive badge sync progress
          </label>
          <progress id={`${baseId}-retro-sync-progress`} className="w-full h-2 accent-red-700" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-inset p-4">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Batches Completed</p>
          <p className="text-2xl font-semibold font-mono text-[var(--text-primary)] mt-1">
            {batchCount}
          </p>
        </div>
        <div className="glass-inset p-4">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Accounts Processed</p>
          <p className="text-2xl font-semibold font-mono text-[var(--text-primary)] mt-1">
            {processedUsers}
          </p>
        </div>
        <div className="glass-inset p-4">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Badges Awarded</p>
          <p className="text-2xl font-semibold font-mono text-red-700 dark:text-red-400 mt-1">
            {newlyAwardedCount}
          </p>
        </div>
      </div>

      {lastCursor && (
        <p className="text-xs font-mono text-[var(--text-secondary)]">
          Last page cursor: {lastCursor}
        </p>
      )}

      {statusMessage && (
        <div
          role="status"
          className="rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-4 py-3 text-xs font-normal text-[var(--text-primary)]"
        >
          {statusMessage}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-600/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}
    </section>
  );
}
