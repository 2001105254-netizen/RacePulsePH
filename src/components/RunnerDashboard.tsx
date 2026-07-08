import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, signOutUser } from '../firebase';
import { useDualSync } from '../lib/dualSync';
import { computeResults } from '../lib/timing';
import { ChipRead, Gender, Race, RunnerProfile, UserProfile } from '../types';
import CustomerForm from './CustomerForm';
import { QRCodeSVG } from 'qrcode.react';
import { LogOut, User, Hash, MapPin, RefreshCw, Award, ClipboardList, Clock, ArrowLeft, ArrowRight, Flag, Calendar, CheckSquare, Coins, PackageCheck, Camera, Trophy, X, Pencil } from 'lucide-react';
import BottomNav from './BottomNav';
import RaceList from './RaceList';

interface RunnerDashboardProps {
  profile: UserProfile;
}

type RunnerTab = 'events' | 'myraces' | 'engraving';

function mostRecent(profiles: RunnerProfile[]): RunnerProfile | undefined {
  return [...profiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export default function RunnerDashboard({ profile }: RunnerDashboardProps) {
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined); // undefined = loading
  const [tab, setTab] = useState<RunnerTab>('events');
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'runners'), where('uid', '==', profile.uid)), (snapshot) => {
      const list: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
      setRunnerProfiles(list);
    }, (err) => {
      console.warn('Runner profiles listener failed:', err.message);
      setRunnerProfiles([]);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const latestProfile = runnerProfiles ? mostRecent(runnerProfiles) : undefined;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 pb-28 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display bg-red-500/10 px-2.5 py-1 rounded-full uppercase border border-red-500/20">Runner Portal</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Register for races, track your splits, and personalize your finisher medal.</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={() => setShowProfile(true)}
            title="My Profile"
            className="w-10 h-10 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-500 font-black text-sm hover:border-red-500/40 transition shrink-0"
          >
            {profile.photoURL ? (
              <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
            ) : (
              (profile.nickname || profile.displayName || '?').charAt(0).toUpperCase()
            )}
          </button>
          <button
            onClick={() => signOutUser()}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </div>

      {showProfile && (
        <ProfileModal profile={profile} runnerProfiles={runnerProfiles || []} onClose={() => setShowProfile(false)} />
      )}

      {runnerProfiles === undefined && (
        <div className="glass-panel p-8 text-center">
          <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin mx-auto" />
        </div>
      )}

      {runnerProfiles !== undefined && tab === 'events' && (
        <RaceRegistrationForm
          uid={profile.uid}
          runnerProfiles={runnerProfiles}
          onSaved={() => setTab('myraces')}
        />
      )}

      {runnerProfiles !== undefined && tab === 'myraces' && (
        <MyRacesView uid={profile.uid} runnerProfiles={runnerProfiles} onBrowseEvents={() => setTab('events')} />
      )}

      {runnerProfiles !== undefined && tab === 'engraving' && (
        <CustomerForm
          onBackToRoleSelection={() => setTab('myraces')}
          backLabel="← Back to My Races"
          ownerUid={profile.uid}
          initialRunnerName={latestProfile?.fullName || ''}
          initialBibNumber={latestProfile?.bibNumber || ''}
        />
      )}

      {runnerProfiles !== undefined && (
        <BottomNav
          items={[
            { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'Events', active: tab === 'events', onClick: () => setTab('events') },
            { key: 'myraces', icon: <ClipboardList className="w-4 h-4" />, label: 'My Races', active: tab === 'myraces', onClick: () => setTab('myraces') },
            { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: tab === 'engraving', onClick: () => setTab('engraving') },
          ]}
        />
      )}
    </div>
  );
}

// ========== MY RACES ==========

interface MyRacesViewProps {
  uid: string;
  runnerProfiles: RunnerProfile[];
  onBrowseEvents: () => void;
}

function MyRacesView({ runnerProfiles, onBrowseEvents }: MyRacesViewProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [viewingProfile, setViewingProfile] = useState<RunnerProfile | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  if (viewingProfile) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setViewingProfile(null)}
          className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to My Races
        </button>
        <RunnerSplitsView runnerProfile={viewingProfile} />
      </div>
    );
  }

  const raceById = new Map(races.map((r) => [r.id, r]));
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = runnerProfiles.filter((rp) => (raceById.get(rp.raceId)?.date || '9999') >= todayStr);
  const past = runnerProfiles.filter((rp) => (raceById.get(rp.raceId)?.date || '9999') < todayStr);

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBrowseEvents}
        className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30"
      >
        <Flag className="w-4 h-4" /> Browse All Events
      </button>

      {runnerProfiles.length === 0 ? (
        <div className="glass-panel p-8 text-center space-y-2">
          <Flag className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <p className="text-sm font-bold text-[var(--text-primary)]">You're not registered for any races yet</p>
          <p className="text-xs text-[var(--text-secondary)]">Tap "Browse All Events" above, or the Events tab below, to see what's on offer.</p>
        </div>
      ) : (
        <>
          <RaceProfileSection title="Upcoming Races" profiles={upcoming} raceById={raceById} onSelect={setViewingProfile} emptyText="No upcoming races." />
          <RaceProfileSection title="Past Races" profiles={past} raceById={raceById} onSelect={setViewingProfile} emptyText="No past races yet." />
        </>
      )}
    </div>
  );
}

function RaceProfileSection({
  title,
  profiles,
  raceById,
  onSelect,
  emptyText,
}: {
  title: string;
  profiles: RunnerProfile[];
  raceById: Map<string, Race>;
  onSelect: (p: RunnerProfile) => void;
  emptyText: string;
}) {
  return (
    <div className="glass-panel p-5">
      <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">{title}</h3>
      {profiles.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const race = raceById.get(p.raceId);
            return (
              <button
                key={p.raceId}
                onClick={() => onSelect(p)}
                className="w-full flex items-center justify-between glass-inset px-4 py-3 text-left hover:border-red-500/40 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{race?.name || 'Unknown Race'}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3 h-3 text-red-500" /> {race?.date || '—'} &bull; {p.distance} &bull; #{p.bibNumber}
                  </p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========== REGISTRATION ==========

interface RaceRegistrationFormProps {
  uid: string;
  runnerProfiles: RunnerProfile[];
  onSaved?: () => void;
  onCancel?: () => void;
}

// Bib numbers are assigned by the system, not typed in: "5-001" is the first
// runner registered under the 5K category, "5-002" the second, and so on.
async function generateBibNumber(raceId: string, distanceLabel: string, km: number | null): Promise<string> {
  const snapshot = await getDocs(
    query(collection(db, 'runners'), where('raceId', '==', raceId), where('distance', '==', distanceLabel))
  );
  const sequence = snapshot.size + 1;
  const prefix = km !== null ? String(km) : 'CUSTOM';
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function RaceRegistrationForm({ uid, runnerProfiles, onSaved, onCancel }: RaceRegistrationFormProps) {
  const latest = mostRecent(runnerProfiles);
  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState(latest?.fullName || '');
  const [distance, setDistance] = useState('Custom');
  const [customDistance, setCustomDistance] = useState('');
  const [gender, setGender] = useState<Gender>(latest?.gender || 'male');
  const [age, setAge] = useState(latest?.age ? String(latest.age) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const selectedRace = races.find((r) => r.id === raceId);
  const raceDistances = selectedRace?.distances || [];
  const existingForRace = runnerProfiles.find((rp) => rp.raceId === raceId);

  // Already registered for this specific race? Load those details for editing.
  useEffect(() => {
    if (existingForRace) {
      setFullName(existingForRace.fullName);
      setGender(existingForRace.gender);
      setAge(String(existingForRace.age));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // Default to the race's first configured distance whenever the available list changes
  useEffect(() => {
    if (existingForRace) {
      setDistance(existingForRace.distance);
    } else if (raceDistances.length > 0 && !raceDistances.some((d) => d.label === distance)) {
      setDistance(raceDistances[0].label);
    } else if (raceDistances.length === 0 && distance !== 'Custom') {
      setDistance('Custom');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, raceDistances.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) return setError('Please enter your full name.');
    if (!raceId) return setError('Please select which race you are registering for.');
    const parsedAge = parseInt(age, 10);
    if (!age || isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) return setError('Please enter a valid age.');

    setSaving(true);
    try {
      const finalDistance = distance === 'Custom' ? (customDistance || 'Custom Run') : distance;
      const selectedDistanceKm = raceDistances.find((d) => d.label === distance)?.km ?? null;
      const bibNumber = existingForRace ? existingForRace.bibNumber : await generateBibNumber(raceId, finalDistance, selectedDistanceKm);
      const record: RunnerProfile = {
        uid,
        raceId,
        fullName: fullName.trim().toUpperCase(),
        bibNumber,
        distance: finalDistance,
        gender,
        age: parsedAge,
        createdAt: existingForRace?.createdAt || new Date().toISOString(),
      };
      await setDoc(doc(db, 'runners', `${uid}_${raceId}`), record);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save your race profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!raceId) {
    return (
      <div className="space-y-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to My Races
          </button>
        )}
        <RaceList
          races={races}
          onSelectRace={(id) => { setRaceId(id); setShowForm(false); }}
          title="Register for a Race"
          subtitle="Browse what's on offer - pick one to register, or reopen a race you're already in to update your details."
          actionLabel="View Race Details"
          emptyTitle="No races are open for registration yet"
          emptyDescription="Check back once an Admin or Organizer sets one up."
        />
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="max-w-2xl mx-auto glass-panel p-6 space-y-5 animate-fadeIn">
        <button
          type="button"
          onClick={() => setRaceId('')}
          className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Race List
        </button>

        <div>
          <h2 className="heading-float text-xl font-black font-display uppercase tracking-tight text-[var(--text-primary)]">{selectedRace?.name}</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-red-500" /> {selectedRace?.date}
          </p>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-red-500" /> Distances &amp; Pricing</h3>
          {(selectedRace?.distances || []).length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Not set yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedRace!.distances.map((d) => (
                <span key={d.id} className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">
                  {d.label}{d.price > 0 && ` — ₱${d.price.toFixed(0)}`}
                </span>
              ))}
            </div>
          )}
        </div>

        {(selectedRace?.inclusions || []).length > 0 && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Inclusions</h3>
            <div className="flex flex-wrap gap-2">
              {selectedRace!.inclusions.map((incl, idx) => (
                <span key={idx} className="text-xs font-semibold px-3 py-1.5 rounded-full glass-inset text-[var(--text-primary)]">{incl}</span>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5 text-red-500" /> Checkpoints</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {[...(selectedRace?.checkpoints || [])].sort((a, b) => a.order - b.order).map((c) => c.label).join(' → ') || 'Not set yet.'}
          </p>
        </div>

        {existingForRace && (
          <p className="text-[10.5px] text-amber-500 glass-inset px-3 py-2">You're already registered for this race under bib #{existingForRace.bibNumber}. Continuing will let you update your details.</p>
        )}

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30"
        >
          <ClipboardList className="w-4 h-4" /> {existingForRace ? 'Update My Registration' : 'Register for This Race'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto glass-panel p-6 space-y-5 animate-fadeIn">
      <button
        type="button"
        onClick={() => setShowForm(false)}
        className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Race Details
      </button>

      <div>
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">
          {existingForRace ? 'Update Registration for' : 'Register for'} {selectedRace?.name}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">This links your account to your bib so organizers can record your checkpoint times.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value.toUpperCase())}
                className="w-full glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: JUAN DELA CRUZ" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Distance</label>
            <div className="relative">
              <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <select value={distance} onChange={(e) => setDistance(e.target.value)}
                className="w-full appearance-none glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                {raceDistances.map((d) => <option key={d.id} value={d.label}>{d.label}</option>)}
                <option value="Custom">Custom Distance...</option>
              </select>
            </div>
            {raceDistances.length === 0 && (
              <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">This race has no preset distances yet - enter your own below.</p>
            )}
          </div>

          {distance === 'Custom' && (
            <input type="text" required value={customDistance} onChange={(e) => setCustomDistance(e.target.value.toUpperCase())}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: 15K TRAIL RUN" />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}
                className="w-full appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Age</label>
              <input type="number" required min={1} max={120} value={age} onChange={(e) => setAge(e.target.value)}
                className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: 27" />
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)] -mt-2 pl-1">Used to place you in the correct age category on race reports.</p>

          <p className="text-[10.5px] text-[var(--text-secondary)] glass-inset px-3 py-2 flex items-center gap-1.5">
            <Hash className="w-3 h-3 text-red-500 shrink-0" />
            {existingForRace
              ? `Your bib number stays #${existingForRace.bibNumber}.`
              : 'Your bib number is assigned automatically based on your distance (e.g. first 5K registrant gets "5-001").'}
          </p>

          {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}

          <button type="submit" disabled={saving}
            className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 disabled:opacity-60">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} {existingForRace ? 'Update Registration' : 'Save Race Profile'}
          </button>
      </form>
    </div>
  );
}

// ========== SPLITS / RESULTS FOR ONE REGISTRATION ==========

function RunnerSplitsView({ runnerProfile }: { runnerProfile: RunnerProfile }) {
  const [race, setRace] = useState<Race | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'races', runnerProfile.raceId), (docSnap) => {
      setRace(docSnap.exists() ? (docSnap.data() as Race) : null);
    }, (err) => console.warn('Race listener failed:', err.message));
    return () => unsubscribe();
  }, [runnerProfile.raceId]);

  const { items: chipReads } = useDualSync<ChipRead>({
    firestoreQuery: query(
      collection(db, 'chipReads'),
      where('raceId', '==', runnerProfile.raceId),
      where('bibNumber', '==', runnerProfile.bibNumber)
    ),
    lanEndpoint: '/api/chip-reads',
    lanResponseKey: 'chipReads',
    getId: (r) => r.id,
    getUpdatedAt: (r) => r.createdAt,
  });

  const result = useMemo(() => {
    if (!race) return null;
    return computeResults(race.checkpoints, chipReads, [runnerProfile]).find((r) => r.bibNumber === runnerProfile.bibNumber);
  }, [race, chipReads, runnerProfile]);

  const orderedCheckpoints = useMemo(() => race ? [...race.checkpoints].sort((a, b) => a.order - b.order) : [], [race]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div className="lg:col-span-7 space-y-6">
        <div className="glass-panel p-5">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-red-500" /> Checkpoint Splits
          </h3>
          {!race && <p className="text-xs text-[var(--text-secondary)]">Loading race details...</p>}
          {race && orderedCheckpoints.length === 0 && <p className="text-xs text-[var(--text-secondary)]">This race has no checkpoints configured yet.</p>}
          <div className="space-y-2">
            {orderedCheckpoints.map((cp) => {
              const split = result?.splits.find((s) => s.checkpointId === cp.id);
              return (
                <div key={cp.id} className="flex items-center justify-between glass-inset px-4 py-3">
                  <span className="text-sm font-bold text-[var(--text-primary)]">{cp.label}</span>
                  <span className={`font-mono text-sm font-black ${split ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                    {split ? new Date(split.timestamp).toLocaleTimeString() : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>

          {result?.finishTime && (
            <div className="mt-4 bg-emerald-950/20 border border-emerald-800/40 p-4 rounded-2xl text-center">
              <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-500">Finish Time</p>
              <p className="text-2xl font-mono font-black text-emerald-400 mt-1">{result.finishTime}</p>
              {result.rank && <p className="text-xs text-emerald-500 mt-1">Rank #{result.rank} in {runnerProfile.distance}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-5">
        <div className="glass-panel p-5 text-center space-y-4">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Your Checkpoint Bib QR</h3>
          <p className="text-[11px] text-[var(--text-secondary)]">Show this to organizers at each checkpoint to scan-and-record your time.</p>
          <div className="bg-white p-4 rounded-2xl inline-block shadow-xl border border-zinc-200">
            <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={180} level="M" />
          </div>
          <div className="glass-inset p-3">
            <span className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block tracking-wider mb-1">Bib Number</span>
            <span className="text-xl font-mono font-black text-red-500 tracking-widest">#{runnerProfile.bibNumber}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== PROFILE ==========

// Center-crops and downsizes an image client-side before it's embedded directly
// on the user's Firestore doc - keeps it small with zero extra Firebase setup.
function resizeImageToDataUrl(file: File, size = 200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load the selected image.'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Image processing is not supported in this browser.'));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface ProfileModalProps {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  onClose: () => void;
}

function ProfileModal({ profile, runnerProfiles, onClose }: ProfileModalProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [nickname, setNickname] = useState(profile.nickname || '');
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photoURL || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  const mostRecentPast = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return [...runnerProfiles]
      .filter((rp) => (raceById.get(rp.raceId)?.date || '9999') < todayStr)
      .sort((a, b) => (raceById.get(b.raceId)?.date || '').localeCompare(raceById.get(a.raceId)?.date || ''))[0];
  }, [runnerProfiles, raceById]);

  const [recentResult, setRecentResult] = useState<ReturnType<typeof computeResults>[number] | null | undefined>(undefined);

  useEffect(() => {
    const race = mostRecentPast ? raceById.get(mostRecentPast.raceId) : undefined;
    if (!mostRecentPast || !race) {
      setRecentResult(null);
      return;
    }
    (async () => {
      try {
        const snapshot = await getDocs(
          query(collection(db, 'chipReads'), where('raceId', '==', race.id), where('bibNumber', '==', mostRecentPast.bibNumber))
        );
        const chipReads: ChipRead[] = [];
        snapshot.forEach((docSnap) => chipReads.push(docSnap.data() as ChipRead));
        const result = computeResults(race.checkpoints, chipReads, [mostRecentPast]).find((r) => r.bibNumber === mostRecentPast.bibNumber);
        setRecentResult(result || null);
      } catch (err) {
        console.warn('Failed to load recent race result:', err);
        setRecentResult(null);
      }
    })();
  }, [mostRecentPast?.raceId, mostRecentPast?.bibNumber]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPhotoPreview(dataUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to process the image.');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        nickname: nickname.trim(),
        ...(photoPreview ? { photoURL: photoPreview } : {}),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const recentRace = mostRecentPast ? raceById.get(mostRecentPast.raceId) : undefined;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="glass-panel w-full max-w-md p-6 space-y-5 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] glass-inset p-2 rounded-full transition"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-24 h-24 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-500 font-black text-3xl group"
            title="Change profile picture"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              (nickname || profile.displayName || '?').charAt(0).toUpperCase()
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <Camera className="w-6 h-6 text-white" />
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[10.5px] font-bold text-red-500 hover:text-red-400 flex items-center gap-1 uppercase tracking-wide">
            <Pencil className="w-3 h-3" /> Change Photo
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Nickname</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={profile.displayName}
            maxLength={30}
            className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-red-500" /> Most Recent Race
          </h3>
          {!mostRecentPast || !recentRace ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2.5">No completed races yet.</p>
          ) : recentResult === undefined ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2.5 flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Loading...</p>
          ) : (
            <div className="glass-inset px-4 py-3 space-y-1.5">
              <p className="text-sm font-bold text-[var(--text-primary)]">{recentRace.name}</p>
              <p className="text-[10px] text-[var(--text-secondary)]">{recentRace.date} &bull; {mostRecentPast.distance} &bull; #{mostRecentPast.bibNumber}</p>
              <div className="flex items-center gap-4 pt-1">
                <div>
                  <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Rank</span>
                  <span className="text-lg font-mono font-black text-red-500">{recentResult?.rank ? `#${recentResult.rank}` : '—'}</span>
                </div>
                <div>
                  <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Finish Time</span>
                  <span className="text-lg font-mono font-black text-red-500">{recentResult?.finishTime || '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 disabled:opacity-60"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />} Save Profile
        </button>
      </div>
    </div>
  );
}
