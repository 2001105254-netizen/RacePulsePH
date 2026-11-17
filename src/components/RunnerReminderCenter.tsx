import { formatRaceTime } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { subscribeSharedRaces } from '../lib/racesStore';
import { Bell, BellRing, CalendarDays, CheckCircle2, PackageCheck, Trophy, X } from 'lucide-react';
import { db } from '../firebase';
import { PublicLiveResults, Race, RunnerProfile } from '../types';

const DISMISSED_KEY = 'racepulse_dismissed_runner_reminders_v1';
const ALERTED_KEY = 'racepulse_sent_runner_alerts_v1';
const EMPTY_RUNNER_PROFILES: RunnerProfile[] = [];

export interface RunnerReminder {
  id: string;
  raceId: string;
  title: string;
  detail: string;
  kind: 'kit' | 'race' | 'result';
}

function philippineDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
}

function loadDismissed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function loadAlerted(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(ALERTED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function useRunnerReminders(runnerProfiles: RunnerProfile[] | undefined) {
  const [races, setRaces] = useState<Race[]>([]);
  const [liveResults, setLiveResults] = useState<Record<string, PublicLiveResults>>({});
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  useEffect(() => {
    return subscribeSharedRaces((records, loaded, error) => {
      if (error) {
        console.warn('Runner reminders race listener failed:', error);
        return;
      }
      if (loaded) setRaces(records);
    });
  }, []);

  const profiles = runnerProfiles ?? EMPTY_RUNNER_PROFILES;
  const profileKey = useMemo(
    () => profiles.map((p) => `${p.raceId}:${p.bibNumber}`).sort().join('|'),
    [profiles],
  );

  useEffect(() => {
    if (profiles.length === 0) {
      setLiveResults((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }
    const unsubscribes = profiles.map((profile) =>
      onSnapshot(
        doc(db, 'liveResults', profile.raceId),
        (resultDoc) => {
          setLiveResults((current) => {
            const next = { ...current };
            if (resultDoc.exists()) next[profile.raceId] = resultDoc.data() as PublicLiveResults;
            else delete next[profile.raceId];
            return next;
          });
        },
        () => undefined,
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  const reminders = useMemo<RunnerReminder[]>(() => {
    if (profiles.length === 0) return [];
    const today = philippineDate();
    const raceById = new Map(races.map((race) => [race.id, race]));
    const all: RunnerReminder[] = [];

    for (const profile of profiles) {
      const race = raceById.get(profile.raceId);
      if (!race) continue;
      const resultsArePublic = !!race.completedAt || Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
      const officialEntry = resultsArePublic
        ? liveResults[profile.raceId]?.officialResults?.find((entry) => entry.bibNumber === profile.bibNumber)
        : undefined;
      if (officialEntry) {
        all.push({
          id: `result_${profile.raceId}_${profile.bibNumber}`,
          raceId: profile.raceId,
          title: 'Official result ready',
          detail: `${race.name} · ${officialEntry.distance} · Rank #${officialEntry.rank} · ${formatRaceTime(officialEntry.finishTime)}`,
          kind: 'result',
        });
      }

      if (race.date >= today && !profile.kitClaimedAt) {
        all.push({
          id: `kit_${profile.raceId}_${profile.bibNumber}`,
          raceId: profile.raceId,
          title: 'Race kit to claim',
          detail: `${race.name} · Bib #${profile.bibNumber}. Visit the organizer kit desk before race day.`,
          kind: 'kit',
        });
      }

      const daysAway = daysBetween(today, race.date);
      if (daysAway === 0) {
        all.push({
          id: `raceday_${profile.raceId}`,
          raceId: profile.raceId,
          title: 'Race day today',
          detail: `${race.name} · ${profile.distance}. Open My Passes for your QR pass and live status.`,
          kind: 'race',
        });
      } else if ([1, 3, 7].includes(daysAway)) {
        all.push({
          id: `upcoming_${profile.raceId}_${daysAway}`,
          raceId: profile.raceId,
          title: `${race.name} is ${daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`}`,
          detail: `${profile.distance} · Bib #${profile.bibNumber}. Check your race pass and kit status.`,
          kind: 'race',
        });
      }
    }

    const priority = { result: 0, race: 1, kit: 2 };
    return all
      .filter((reminder) => !dismissed.includes(reminder.id))
      .sort((a, b) => priority[a.kind] - priority[b.kind]);
  }, [dismissed, liveResults, profiles, races]);

  const dismiss = (id: string) => {
    setDismissed((current) => {
      const next = [...new Set([...current, id])];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const requestAlerts = async () => {
    if (notificationPermission === 'unsupported') return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  useEffect(() => {
    if (notificationPermission !== 'granted' || typeof window === 'undefined') return;
    const alerted = new Set(loadAlerted());
    const newlyAlerted = reminders.filter((reminder) => !alerted.has(reminder.id));
    if (newlyAlerted.length === 0) return;
    for (const reminder of newlyAlerted) {
      try {
        new Notification(`RacePulsePH · ${reminder.title}`, {
          body: reminder.detail,
          icon: '/assets/racepulse-mark-192.png',
          tag: reminder.id,
        });
        alerted.add(reminder.id);
      } catch {
        // Keep the reminder in-app if the host browser blocks a notification.
      }
    }
    localStorage.setItem(ALERTED_KEY, JSON.stringify([...alerted]));
  }, [notificationPermission, reminders]);

  return { reminders, dismiss, notificationPermission, requestAlerts };
}

interface RunnerRemindersPanelProps {
  reminders: RunnerReminder[];
  dismiss: (id: string) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  requestAlerts: () => Promise<void>;
  onOpenPass?: (raceId: string) => void;
  onClose?: () => void;
  titleId?: string;
}

export function RunnerRemindersPanel({
  reminders,
  dismiss,
  notificationPermission,
  requestAlerts,
  onOpenPass,
  onClose,
  titleId,
}: RunnerRemindersPanelProps) {
  return (
    <section
      aria-label="Race day and kit updates"
      className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 sm:px-4 py-3 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BellRing className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <h2 id={titleId} className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
            Race Day &amp; Kit Alerts
          </h2>
          <span className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
            {reminders.length}
          </span>
          <span className="text-xs text-[var(--text-secondary)] truncate hidden sm:inline tabular-nums">
            {reminders.length
              ? `${reminders.length} active reminder${reminders.length === 1 ? '' : 's'} across your registered races`
              : 'All pre-race checkpoints and kits are up to date'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {notificationPermission === 'granted' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-600/25 text-emerald-700 dark:text-emerald-400">
              <Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Browser Alerts On
            </span>
          )}
          {notificationPermission === 'default' && (
            <button
              type="button"
              onClick={() => void requestAlerts()}
              className="min-h-11 lg:min-h-8 px-3 py-1.5 rounded-lg bg-red-700/10 text-red-700 dark:text-red-400 border border-red-700/25 dark:border-red-400/25 hover:bg-red-700 hover:text-white text-xs font-semibold uppercase tracking-wide transition inline-flex items-center"
            >
              Enable Alerts
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide race day alerts"
              className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-8 flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {reminders.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-secondary)] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          No action needed right now.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] divide-y divide-[var(--border-subtle)] overflow-hidden">
          {reminders.slice(0, 4).map((reminder) => {
            const Icon = reminder.kind === 'result' ? Trophy : reminder.kind === 'kit' ? PackageCheck : CalendarDays;
            const iconColor =
              reminder.kind === 'result'
                ? 'text-emerald-700 dark:text-emerald-400'
                : reminder.kind === 'kit'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-red-700 dark:text-red-400';
            const leftBorder =
              reminder.kind === 'result'
                ? 'border-l-emerald-600'
                : reminder.kind === 'kit'
                ? 'border-l-amber-500'
                : 'border-l-red-600';
            return (
              <div
                key={reminder.id}
                className={`border-l-4 ${leftBorder} px-3 py-2 flex items-center gap-2.5`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--text-primary)] truncate">{reminder.title}</span>
                  <span className="block text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">{reminder.detail}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {onOpenPass && (
                    <button
                      type="button"
                      onClick={() => onOpenPass(reminder.raceId)}
                      className="min-h-11 lg:min-h-8 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600/50 text-xs font-semibold text-[var(--text-primary)] transition"
                    >
                      Open
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismiss(reminder.id)}
                    title="Dismiss reminder"
                    aria-label={`Dismiss ${reminder.title}`}
                    className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-red-700 dark:hover:text-red-400 transition shrink-0"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
          {reminders.length > 4 && (
            <p className="px-3 py-2 text-xs text-[var(--text-secondary)] font-semibold tabular-nums">
              + {reminders.length - 4} more reminders
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function RunnerReminderCenter({ runnerProfiles }: { runnerProfiles: RunnerProfile[] }) {
  const { reminders, dismiss, notificationPermission, requestAlerts } = useRunnerReminders(runnerProfiles);
  if (runnerProfiles.length === 0) return null;
  return (
    <RunnerRemindersPanel
      reminders={reminders}
      dismiss={dismiss}
      notificationPermission={notificationPermission}
      requestAlerts={requestAlerts}
    />
  );
}
