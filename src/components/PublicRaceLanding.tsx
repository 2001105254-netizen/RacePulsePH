import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Flag, UserPlus } from 'lucide-react';
import { db } from '../firebase';
import { Race } from '../types';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import RaceList from './RaceList';
import PublicLiveRaceHub from './PublicLiveRaceHub';

interface PublicRaceLandingProps {
  onRegister: (raceId?: string) => void;
}

// The public first screen: races are intentionally readable without an account.
// Registration itself remains behind Firebase Auth and starts only after Sign Up.
export default function PublicRaceLanding({ onRegister }: PublicRaceLandingProps) {
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setRaces(list);
    }, (err) => {
      console.warn('Public race list failed to load:', err.message);
      setRaces([]);
    });
    return () => unsubscribe();
  }, []);

  const openRaces = races.filter((race) => isRaceRegistrationOpen(race));
  const liveRaces = races.filter((race) => race.liveBroadcastEnabled);

  return (
    <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-16 space-y-9 animate-fadeIn">
      <section className="hero-glow glass-panel overflow-hidden px-6 py-8 sm:px-10 sm:py-10 text-center">
        <img
          src="/assets/racepulse-mark.png"
          alt="RacePulsePH"
          className="w-16 h-16 sm:w-20 sm:h-20 object-contain mx-auto mb-5 drop-shadow-xl"
        />
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black tracking-widest text-red-500 font-display bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-full uppercase">
          <Flag className="w-3.5 h-3.5" /> Race registrations
        </span>
        <h1 className="heading-float mt-4 text-3xl sm:text-5xl font-black tracking-tight font-display uppercase text-[var(--text-primary)]">
          Find your next finish line
        </h1>
        <p className="max-w-xl mx-auto mt-3 text-sm sm:text-base leading-relaxed text-[var(--text-secondary)]">
          Browse upcoming RacePulsePH events, compare distances and fees, then create an account to secure your spot.
        </p>
        <button
          type="button"
          onClick={() => onRegister()}
          className="mt-6 mx-auto py-3 px-5 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30"
        >
          <UserPlus className="w-4 h-4" /> Sign up to register
        </button>
      </section>

      {liveRaces.length > 0 && <PublicLiveRaceHub races={liveRaces} />}

      <RaceList
        races={openRaces}
        onSelectRace={onRegister}
        title="Open race events"
        subtitle="Choose a race to begin registration. You’ll be asked to sign up or log in before submitting your details."
        actionLabel="Sign Up to Register"
        emptyTitle="No races are open for registration yet"
        emptyDescription="Check back soon for the next RacePulsePH event."
      />
    </main>
  );
}
