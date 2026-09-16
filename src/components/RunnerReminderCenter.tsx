import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
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
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const records: Race[] = [];
      snapshot.forEach((raceDoc) => records.push(raceDoc.data() as Race));
      setRaces(records);
    }, (error) => console.warn('Runner reminders race listener failed:', error.message));
    return () => unsubscribe();
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
          detail: `${race.name} • ${officialEntry.distance} • Rank #${officialEntry.rank} • ${officialEntry.finishTime}`,
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BellRing className="w-4 h-4 text-red-500 shrink-0" />
          <div><h2 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Race updates</h2><p className="text-[10px] text-[var(--text-muted)] mt-0.5">{reminders.length ? `${reminders.length} reminder${reminders.length === 1 ? '' : 's'} for your races` : 'You’re all caught up'}</p></div>
        </div>
        {notificationPermission === 'default' && (
          <button type="button" onClick={() => void requestAlerts()} className="shrink-0 text-[9px] font-black uppercase tracking-wide px-3 py-2 rounded-full bg-red-500/10 text-red-500 border border-red-500/25 hover:bg-red-500 hover:text-white transition">Enable alerts</button>
        )}
      </div>

      {reminders.length === 0 ? (
        <div className="glass-inset px-3 py-3 text-xs text-[var(--text-secondary)] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> No action needed right now.</div>
      ) : (
        <div className="space-y-2">
          {reminders.slice(0, 4).map((reminder) => {
            const Icon = reminder.kind === 'result' ? Trophy : reminder.kind === 'kit' ? PackageCheck : CalendarDays;
            const accent = reminder.kind === 'result' ? 'text-emerald-500' : reminder.kind === 'kit' ? 'text-amber-500' : 'text-red-500';
            return (
              <div key={reminder.id} className="glass-inset px-3 py-3 flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${accent}`} />
                <span className="min-w-0 flex-1"><span className="block text-xs font-black text-[var(--text-primary)]">{reminder.title}</span><span className="block text-[10.5px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{reminder.detail}</span></span>
                <button type="button" onClick={() => dismiss(reminder.id)} title="Dismiss reminder" className="p-1 text-[var(--text-muted)] hover:text-red-500 transition"><X className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
          {reminders.length > 4 && <p className="text-[10px] text-[var(--text-muted)] text-center">+{reminders.length - 4} more reminders</p>}
        </div>
      )}
      {notificationPermission === 'granted' && <p className="text-[10px] text-emerald-500 flex items-center gap-1.5"><Bell className="w-3 h-3" /> Browser alerts enabled for this device.</p>}
    </section>
  );
}
