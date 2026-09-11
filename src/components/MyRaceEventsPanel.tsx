import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Race, RunnerProfile } from '../types';
import { Calendar, Users2, Coins, Radio, LayoutGrid } from 'lucide-react';

interface MyRaceEventsPanelProps {
  uid: string;
  onManageRace: (raceId: string) => void;
}

// Organizer's own-events overview - separate from Race Setup (the create/edit
// form) and Timing (the operational console for one race at a time). This is
// the "how are my events doing" glance: registrations, revenue, at a glance.
export default function MyRaceEventsPanel({ uid, onManageRace }: MyRaceEventsPanelProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [runners, setRunners] = useState<RunnerProfile[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'races'), where('createdBy', '==', uid)), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, [uid]);

  // Read registrations one owned race at a time. This is deliberate: the
  // Firestore rule only grants an organizer access to runners in races they
  // created, instead of exposing the entire runners collection.
  const raceIds = useMemo(() => races.map((race) => race.id).sort(), [races]);
  const raceIdsKey = raceIds.join('|');

  useEffect(() => {
    if (raceIds.length === 0) {
      setRunners([]);
      return;
    }

    let active = true;
    const runnersByRace = new Map<string, RunnerProfile[]>();
    const publish = () => {
      if (active) setRunners(Array.from(runnersByRace.values()).flat());
    };

    const unsubscribes = raceIds.map((raceId) => onSnapshot(
      query(collection(db, 'runners'), where('raceId', '==', raceId)),
      (snapshot) => {
        const list: RunnerProfile[] = [];
        snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
        runnersByRace.set(raceId, list);
        publish();
      },
      (err) => console.warn(`Runners listener failed for race ${raceId}:`, err.message)
    ));

    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [raceIdsKey]);

  const runnersByRace = useMemo(() => {
    const map = new Map<string, RunnerProfile[]>();
    for (const r of runners) {
      const list = map.get(r.raceId) ?? [];
      list.push(r);
      map.set(r.raceId, list);
    }
    return map;
  }, [runners]);

  const revenueForRace = (race: Race, raceRunners: RunnerProfile[]) => {
    const priceByLabel = new Map(race.distances.map((d) => [d.label, d.price]));
    return raceRunners.reduce((sum, r) => sum + (priceByLabel.get(r.distance) || 0), 0);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">My Race Events</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Every event you've created, at a glance.</p>
      </div>

      {races.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <LayoutGrid className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <p className="text-sm font-bold text-[var(--text-primary)] mt-3">You haven't created any races yet</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Head to Race Setup to create your first event.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {races.map((race) => {
            const raceRunners = runnersByRace.get(race.id) || [];
            const revenue = revenueForRace(race, raceRunners);
            const isPast = race.date < todayStr;
            return (
              <div key={race.id} className="glass-panel overflow-hidden">
                {race.posterImage && (
                  <img src={race.posterImage} alt="" className="w-full aspect-video object-cover" />
                )}
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-md font-bold font-display tracking-tight text-[var(--text-primary)] truncate">{race.name}</h3>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-red-500" /> {race.date}
                      </p>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full shrink-0 ${isPast ? 'bg-[var(--surface-inset)] text-[var(--text-muted)] border border-[var(--border-default)]' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/25'}`}>
                      {isPast ? 'Completed' : 'Upcoming'}
                    </span>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Users2 className="w-3.5 h-3.5 text-red-500" /> <span className="font-bold text-[var(--text-primary)]">{raceRunners.length}</span> registered
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Coins className="w-3.5 h-3.5 text-red-500" /> <span className="font-bold text-[var(--text-primary)]">₱{revenue.toFixed(0)}</span> est.
                    </div>
                  </div>

                  {(race.distances || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {race.distances.map((d) => (
                        <span key={d.id} className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">{d.label}</span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => onManageRace(race.id)}
                    className="w-full text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition"
                  >
                    <Radio className="w-3.5 h-3.5" /> Manage Timing
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
