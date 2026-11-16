import { formatRaceTime } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { subscribeSharedRaces } from '../lib/racesStore';
import { Bell, BellRing, CalendarDays, CheckCircle2, PackageCheck, Trophy, X } from 'lucide-react';
import { db } from '../firebase';
import { PublicLiveResults, Race, RunnerProfile } from '../types';

const DISMISSED_KEY = 'racepulse_dismissed_runner_reminders_v1';
const ALERTED_KEY = 'racepulse_sent_runner_alerts_v1';

interface Reminder {
  id: string;
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

export default function RunnerReminderCenter({ runnerProfiles }: { runnerProfiles: RunnerProfile[] }) {
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

  useEffect(() => {
    const unsubscribes = runnerProfiles.map((profile) => onSnapshot(doc(db, 'liveResults', profile.raceId), (resultDoc) => {
      setLiveResults((current) => {
        const next = { ...current };
        if (resultDoc.exists()) next[profile.raceId] = resultDoc.data() as PublicLiveResults;
        else delete next[profile.raceId];
        return next;
      });
    }, () => undefined));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [runnerProfiles]);

  const reminders = useMemo<Reminder[]>(() => {
    const today = philippineDate();
    const raceById = new Map(races.map((race) => [race.id, race]));
    const all: Reminder[] = [];

    for (const profile of runnerProfiles) {
      const race = raceById.get(profile.raceId);
      if (!race) continue;
      const resultsArePublic = !!race.completedAt || Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
      const officialEntry = resultsArePublic ? liveResults[profile.raceId]?.officialResults?.find((entry) => entry.bibNumber === profile.bibNumber) : undefined;
      if (officialEntry) {
        all.push({
          id: `result_${profile.raceId}_${profile.bibNumber}`,
          title: 'Official result ready',
          detail: `${race.name} • ${officialEntry.distance} • Rank #${officialEntry.rank} • ${formatRaceTime(officialEntry.finishTime)}`,
          kind: 'result',
        });
      }

      if (race.date >= today && !profile.kitClaimedAt) {
        all.push({
          id: `kit_${profile.raceId}_${profile.bibNumber}`,
          title: 'Race kit to claim',
          detail: `${race.name} • Bib #${profile.bibNumber}. Visit the organizer’s kit desk before race day.`,
          kind: 'kit',
        });
      }

      const daysAway = daysBetween(today, race.date);
      if (daysAway === 0) {
        all.push({
          id: `raceday_${profile.raceId}`,
          title: 'It’s race day!',
          detail: `${race.name} • ${profile.distance}. Open My Races for your QR pass and live status.`,
          kind: 'race',
        });
      } else if ([1, 3, 7].includes(daysAway)) {
        all.push({
          id: `upcoming_${profile.raceId}_${daysAway}`,
          title: `${race.name} is ${daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`}`,
          detail: `${profile.distance} • Bib #${profile.bibNumber}. Check your race pass and kit status.`,
          kind: 'race',
        });
      }
    }

    const priority = { result: 0, race: 1, kit: 2 };
    return all
      .filter((reminder) => !dismissed.includes(reminder.id))
      .sort((a, b) => priority[a.kind] - priority[b.kind]);
  }, [dismissed, liveResults, races, runnerProfiles]);

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

  // Browser alerts supplement the in-app list. They intentionally fire once
  // per reminder while the app is open; background push delivery when the app
  // is closed needs a separate Firebase Messaging server setup.
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

  if (runnerProfiles.length === 0) return null;

  return (
    <section
      aria-label="Race day and kit updates"
      className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] px-4 py-3 space-y-2.5 animate-fadeIn"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <BellRing className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
            Race Day &amp; Kit Alerts
          </h2>
          <span className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
            {reminders.length}
          </span>
          <span className="text-xs text-[var(--text-secondary)] truncate hidden sm:inline">
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
              className="min-h-9 inline-flex items-center text-xs font-semibold uppercase tracking-wide px-3.5 py-1.5 rounded-lg bg-red-700/10 text-red-700 dark:text-red-400 border border-red-700/25 dark:border-red-400/25 hover:bg-red-700 hover:text-white transition"
            >
              Enable Browser Alerts
            </button>
          )}
        </div>
      </div>

      {reminders.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          No action needed right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
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
                className={`rounded-xl border border-[var(--border-default)] border-l-4 ${leftBorder} bg-[var(--surface-elevated)] px-3.5 py-2.5 flex items-center gap-3`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--text-primary)]">{reminder.title}</span>
                  <span className="block text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">{reminder.detail}</span>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(reminder.id)}
                  title="Dismiss reminder"
                  aria-label={`Dismiss ${reminder.title}`}
                  className="min-h-9 min-w-9 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-red-700 dark:hover:text-red-400 transition shrink-0"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {reminders.length > 4 && (
            <p className="xl:col-span-2 text-xs text-[var(--text-secondary)] text-right font-mono">
              +{reminders.length - 4} more reminders
            </p>
          )}
        </div>
      )}
    </section>
  );
}
