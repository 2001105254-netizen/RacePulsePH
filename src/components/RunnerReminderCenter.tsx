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
    <section className="glass-panel p-4 sm:p-5 space-y-3 animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BellRing className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Race updates</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{reminders.length ? `${reminders.length} reminder${reminders.length === 1 ? '' : 's'} for your races` : 'You’re all caught up'}</p>
          </div>
        </div>
        {notificationPermission === 'default' && (
          <button type="button" onClick={() => void requestAlerts()} className="shrink-0 min-h-11 inline-flex items-center text-xs font-semibold uppercase tracking-wide px-4 py-2 rounded-full bg-red-700/10 text-red-700 dark:text-red-400 border border-red-700/25 dark:border-red-400/25 hover:bg-red-700 hover:text-white transition">Enable alerts</button>
        )}
      </div>

      {reminders.length === 0 ? (
        <div className="glass-inset px-3 py-3 text-xs text-[var(--text-secondary)] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" /> No action needed right now.</div>
      ) : (
        <div className="space-y-2">
          {reminders.slice(0, 4).map((reminder) => {
            const Icon = reminder.kind === 'result' ? Trophy : reminder.kind === 'kit' ? PackageCheck : CalendarDays;
            const accent = reminder.kind === 'result' ? 'text-emerald-700 dark:text-emerald-400' : reminder.kind === 'kit' ? 'text-amber-800 dark:text-amber-300' : 'text-red-700 dark:text-red-400';
            return (
              <div key={reminder.id} className="glass-inset px-3 py-3 flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-1 shrink-0 ${accent}`} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--text-primary)]">{reminder.title}</span><span className="block text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{reminder.detail}</span></span>
                <button type="button" onClick={() => dismiss(reminder.id)} title="Dismiss reminder" aria-label={`Dismiss ${reminder.title}`} className="min-h-11 min-w-11 -mr-2 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition shrink-0"><X className="w-4 h-4" aria-hidden="true" /></button>
              </div>
            );
          })}
          {reminders.length > 4 && <p className="text-xs text-[var(--text-secondary)] text-center">+{reminders.length - 4} more reminders</p>}
        </div>
      )}
      {notificationPermission === 'granted' && <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2"><Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Browser alerts enabled for this device.</p>}
    </section>
  );
}
