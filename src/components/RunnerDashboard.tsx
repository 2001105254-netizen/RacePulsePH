import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, sendPasswordReset, signOutUser, updateAccountDisplayName } from '../firebase';
import { checkpointType, computeResults, getWaveStartTime } from '../lib/timing';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { resizeImageToDataUrl } from '../lib/image';
import { ChipRead, Gender, Race, RaceBibFont, RunnerProfile, UserProfile } from '../types';
import CustomerForm from './CustomerForm';
import { QRCodeSVG } from 'qrcode.react';
import { LogOut, User, Hash, MapPin, RefreshCw, Award, ClipboardList, Clock, ArrowLeft, ArrowRight, Flag, Calendar, CheckSquare, Coins, PackageCheck, Camera, Trophy, X, Pencil, CheckCircle2, Circle, Radio, Phone, HeartPulse, Mail, FileDown } from 'lucide-react';
import BottomNav from './BottomNav';
import RaceList from './RaceList';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import RunnerReminderCenter from './RunnerReminderCenter';

interface RunnerDashboardProps {
  profile: UserProfile;
  initialRaceId?: string | null;
  onInitialRaceHandled?: () => void;
}

type RunnerTab = 'events' | 'myraces' | 'engraving';

const raceBibFontFamilies: Record<RaceBibFont, string> = {
  display: '"Space Grotesk", sans-serif',
  sans: 'Inter, sans-serif',
  mono: '"JetBrains Mono", monospace',
  condensed: 'Impact, "Arial Narrow Bold", sans-serif',
};

function mostRecent(profiles: RunnerProfile[]): RunnerProfile | undefined {
  return [...profiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export default function RunnerDashboard({ profile, initialRaceId, onInitialRaceHandled }: RunnerDashboardProps) {
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined); // undefined = loading
  const [tab, setTab] = useState<RunnerTab>('events');
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    const goHome = () => {
      setShowProfile(false);
      setTab('events');
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  useEffect(() => {
    if (initialRaceId) onInitialRaceHandled?.();
  }, [initialRaceId, onInitialRaceHandled]);

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
        <>
          <RunnerReminderCenter runnerProfiles={runnerProfiles} />
          <RaceRegistrationForm
            uid={profile.uid}
            runnerProfiles={runnerProfiles}
            initialShirtSize={profile.shirtSize}
            initialRaceId={initialRaceId}
            onSaved={() => setTab('myraces')}
          />
        </>
      )}

      {runnerProfiles !== undefined && tab === 'myraces' && (
        <>
          <RunnerReminderCenter runnerProfiles={runnerProfiles} />
          <MyRacesView uid={profile.uid} runnerProfiles={runnerProfiles} onBrowseEvents={() => setTab('events')} />
        </>
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
            const today = new Date().toISOString().slice(0, 10);
            const raceStatus = !race
              ? 'Registration saved'
              : race.date < today
                ? 'Race completed'
                : race.date === today
                  ? 'Race day'
                  : 'Upcoming';
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
                  <span className={`inline-flex mt-2 text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full border ${
                    raceStatus === 'Race completed'
                      ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                      : raceStatus === 'Race day'
                        ? 'text-red-500 bg-red-500/10 border-red-500/20'
                        : 'text-[var(--text-secondary)] bg-[var(--surface-hover)] border-[var(--border-default)]'
                  }`}>{raceStatus}</span>
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
  initialShirtSize?: string;
  initialRaceId?: string | null;
  onSaved?: () => void;
  onCancel?: () => void;
}

// Bib numbers are assigned by the system, not typed in: "5-001" is the first
// runner registered under the 5K category, "5-002" the second, and so on.
// Uses a transaction against a per-distance counter doc (not a count() query)
// so two runners registering for the same distance at the same moment can't
// both land on the same sequence number and collide on one bib.
async function generateBibNumber(raceId: string, distanceLabel: string, km: number | null): Promise<string> {
  const counterId = `${raceId}_${distanceLabel}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const counterRef = doc(db, 'bibCounters', counterId);
  const sequence = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? (snap.data().count as number) : 0) + 1;
    tx.set(counterRef, { count: next });
    return next;
  });
  const prefix = km !== null ? String(km) : 'CUSTOM';
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function RegistrationProgress({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const steps = ['Choose race', 'Runner details', 'Confirmed'];
  return (
    <ol className="grid grid-cols-3 gap-1.5 max-w-xl mx-auto" aria-label="Registration progress">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const complete = step < currentStep;
        const active = step === currentStep;
        return (
          <li key={label} className={`rounded-xl border px-2 py-2 text-center transition ${complete || active ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-[var(--border-default)] bg-[var(--surface-inset)]/40 text-[var(--text-muted)]'}`}>
            <span className="flex items-center justify-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wide">
              {complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[8px] ${active ? 'border-red-500' : 'border-current'}`}>{step}</span>}
              <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{step === 1 ? 'Race' : step === 2 ? 'Details' : 'Done'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RegistrationConfirmation({ race, registration, updated, onViewMyRace, onRegisterAnother }: {
  race?: Race;
  registration: RunnerProfile;
  updated: boolean;
  onViewMyRace: () => void;
  onRegisterAnother: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={3} />
      <div className="glass-panel p-7 text-center space-y-5 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-red-600 via-emerald-500 to-red-600" />
        <div className="w-14 h-14 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-500">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">{updated ? 'Registration updated' : 'Registration confirmed'}</p>
          <h2 className="heading-float text-xl font-black font-display uppercase tracking-tight text-[var(--text-primary)] mt-2">You’re in!</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-2">Your race registration is saved under your account.</p>
        </div>
        <div className="glass-inset p-4 text-left grid grid-cols-2 gap-y-3 gap-x-4">
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Race</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5 truncate">{race?.name || 'Race event'}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Race date</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5">{race?.date || 'To be announced'}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Distance</span><span className="block text-sm font-bold text-red-500 mt-0.5">{registration.distance}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Bib number</span><span className="block text-lg font-mono font-black text-red-500 mt-0.5">#{registration.bibNumber}</span></span>
          {registration.shirtSize && <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Shirt size</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5">{registration.shirtSize}</span></span>}
        </div>
        <p className="text-[10.5px] text-[var(--text-secondary)]">Your QR race pass and live race status will be available under My Races.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={onViewMyRace} className="py-3 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition">View My Race Pass</button>
          <button type="button" onClick={onRegisterAnother} className="py-3 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest glass-inset text-[var(--text-secondary)] hover:text-red-500 transition">Register another race</button>
        </div>
      </div>
    </div>
  );
}

function RaceRegistrationForm({ uid, runnerProfiles, initialShirtSize, initialRaceId, onSaved, onCancel }: RaceRegistrationFormProps) {
  const latest = mostRecent(runnerProfiles);
  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState(initialRaceId || '');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState(latest?.fullName || '');
  const [distance, setDistance] = useState('Custom');
  const [customDistance, setCustomDistance] = useState('');
  const [gender, setGender] = useState<Gender>(latest?.gender || 'male');
  const [age, setAge] = useState(latest?.age ? String(latest.age) : '');
  const [shirtSize, setShirtSize] = useState(initialShirtSize || latest?.shirtSize || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ registration: RunnerProfile; wasUpdate: boolean } | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const openRaces = races.filter((race) => isRaceRegistrationOpen(race));
  const selectedRace = openRaces.find((r) => r.id === raceId);
  const raceDistances = selectedRace?.distances || [];
  const existingForRace = runnerProfiles.find((rp) => rp.raceId === raceId);

  // Already registered for this specific race? Load those details for editing.
  useEffect(() => {
    if (existingForRace) {
      setFullName(existingForRace.fullName);
      setGender(existingForRace.gender);
      setAge(String(existingForRace.age));
      setShirtSize(existingForRace.shirtSize || initialShirtSize || '');
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
        // A runner may correct their profile before race day, but that must
        // never erase operational records already set by the kit desk.
        ...(existingForRace?.chipId ? { chipId: existingForRace.chipId } : {}),
        ...(existingForRace?.kitClaimedAt ? { kitClaimedAt: existingForRace.kitClaimedAt } : {}),
        ...(shirtSize ? { shirtSize } : {}),
      };
      await setDoc(doc(db, 'runners', `${uid}_${raceId}`), record);
      setConfirmation({ registration: record, wasUpdate: !!existingForRace });
    } catch (err: any) {
      setError(err.message || 'Failed to save your race profile.');
    } finally {
      setSaving(false);
    }
  };

  if (confirmation) {
    const confirmedRace = races.find((race) => race.id === confirmation.registration.raceId);
    return <RegistrationConfirmation
      race={confirmedRace}
      registration={confirmation.registration}
      updated={confirmation.wasUpdate}
      onViewMyRace={() => onSaved?.()}
      onRegisterAnother={() => { setConfirmation(null); setRaceId(''); setShowForm(false); setError(''); }}
    />;
  }

  if (!raceId || !selectedRace) {
    return (
      <div className="space-y-4">
        <RegistrationProgress currentStep={1} />
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
          races={openRaces}
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
        <RegistrationProgress currentStep={1} />
        <button
          type="button"
          onClick={() => setRaceId('')}
          className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Race List
        </button>

        {selectedRace?.posterImage && (
          <img src={selectedRace.posterImage} alt="" className="w-full aspect-video object-cover rounded-[18px] -mt-1" />
        )}

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

        {selectedRace?.inclusionImage && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Shirt / Kit Design</h3>
            <div className="rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]">
              <img src={selectedRace.inclusionImage} alt={`${selectedRace.name} shirt or kit design`} className="w-full max-h-96 object-contain" />
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
          <ArrowRight className="w-4 h-4" /> {existingForRace ? 'Continue to Update Details' : 'Continue to Runner Details'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto glass-panel p-6 space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={2} />
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
            {existingForRace ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500" /> {existingForRace.distance}
              </div>
            ) : (
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <select value={distance} onChange={(e) => setDistance(e.target.value)}
                  className="w-full appearance-none glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                  {raceDistances.map((d) => <option key={d.id} value={d.label}>{d.label}</option>)}
                  <option value="Custom">Custom Distance...</option>
                </select>
              </div>
            )}
            {!existingForRace && raceDistances.length === 0 && (
              <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">This race has no preset distances yet - enter your own below.</p>
            )}
          </div>

          {!existingForRace && distance === 'Custom' && (
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
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shirt Size <span className="normal-case font-normal text-[var(--text-muted)]">(for this race)</span></label>
            <select value={shirtSize} onChange={(e) => setShirtSize(e.target.value)} className="w-full appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
              <option value="">Select shirt size</option>
              {['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">The kit desk will see this size when you claim your race kit.</p>
          </div>

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

interface RaceProgressStep {
  id: string;
  label: string;
  detail: string;
  completed: boolean;
  timestamp?: string;
}

function formatScanTime(timestamp?: string): string | undefined {
  return timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
}

function RunnerRacePass({ race, runnerProfile, result, orderedCheckpoints }: {
  race: Race;
  runnerProfile: RunnerProfile;
  result: ReturnType<typeof computeResults>[number] | undefined;
  orderedCheckpoints: Race['checkpoints'];
}) {
  const splitFor = (checkpointId?: string) => result?.splits.find((split) => split.checkpointId === checkpointId);
  const checkin = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'checkin');
  const start = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'start');
  const finish = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'finish');
  const checkinSplit = splitFor(checkin?.id);
  const startSplit = splitFor(start?.id);
  const finishSplit = splitFor(finish?.id);
  const hasOfficialResult = !!result?.finishTime && !!result.rank;
  const steps: RaceProgressStep[] = [
    { id: 'registered', label: 'Registered', detail: 'Your race slot is confirmed', completed: true, timestamp: runnerProfile.createdAt },
    { id: 'kit', label: 'Kit claimed', detail: runnerProfile.kitClaimedAt ? 'Race kit released to runner' : 'Claim from the race-kit desk', completed: !!runnerProfile.kitClaimedAt, timestamp: runnerProfile.kitClaimedAt },
    ...(checkin ? [{ id: 'checkin', label: 'Checked in', detail: checkin.label, completed: !!checkinSplit, timestamp: checkinSplit?.timestamp }] : []),
    ...(start ? [{ id: 'start', label: 'Started', detail: start.label, completed: !!startSplit, timestamp: startSplit?.timestamp }] : []),
    ...(finish ? [{ id: 'finish', label: 'Finished', detail: finish.label, completed: !!finishSplit, timestamp: finishSplit?.timestamp }] : []),
    { id: 'result', label: 'Official result', detail: hasOfficialResult ? `Rank #${result!.rank} • ${result!.finishTime}` : 'Available after your finish is recorded', completed: hasOfficialResult, timestamp: hasOfficialResult ? finishSplit?.timestamp : undefined },
  ];
  const currentStep = [...steps].reverse().find((step) => step.completed)?.label || 'Registered';

  return (
    <div className="lg:col-span-12 glass-panel overflow-hidden animate-fadeIn">
      <div className="relative p-5 sm:p-6 overflow-hidden">
        {race.posterImage && <img src={race.posterImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.12]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/60 via-[var(--surface-panel)]/90 to-[var(--surface-panel)]" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/25 rounded-full px-2.5 py-1"><Radio className="w-3 h-3" /> My Race Pass</span>
            <h2 className="heading-float text-xl sm:text-2xl font-black font-display uppercase tracking-tight text-[var(--text-primary)] mt-3 truncate">{race.name}</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-red-500 mr-1.5" />{race.date}</span><span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-500 mr-1.5" />{runnerProfile.distance}</span></p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="glass-inset px-4 py-3 text-center min-w-[104px]">
              <span className="block text-[9px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span>
              <span className="block text-xl font-mono font-black tracking-wider text-red-500 mt-0.5">#{runnerProfile.bibNumber}</span>
            </div>
            <div className="bg-white p-2 rounded-xl shadow-xl border border-zinc-200" title="Show this QR code at a race checkpoint">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={66} level="M" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 border-t border-[var(--border-default)]">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Race status</h3>
            <p className="text-xs text-[var(--text-primary)] font-bold mt-1">Current: <span className="text-red-500">{currentStep}</span></p>
          </div>
          {result?.finishTime && <span className="text-xs font-mono font-black text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-3 py-1.5">Official time {result.finishTime}</span>}
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          {steps.map((step, index) => (
            <li key={step.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${step.completed ? 'border-red-500/25 bg-red-500/5' : 'border-[var(--border-default)] bg-[var(--surface-inset)]/35'}`}>
              <span className={step.completed ? 'text-red-500' : 'text-[var(--text-muted)]'}>{step.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}</span>
              <span className="min-w-0"><span className="block text-xs font-black text-[var(--text-primary)]">{index + 1}. {step.label}</span><span className="block text-[10px] text-[var(--text-secondary)] truncate">{step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.detail}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DigitalRaceBib({ race, runnerProfile }: { race: Race; runnerProfile: RunnerProfile }) {
  const bibRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const layout = race.raceBibLayout || { bibNumberX: 50, bibNumberY: 48, runnerNameX: 50, runnerNameY: 70 };

  const handleDownload = async () => {
    if (!bibRef.current) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(bibRef.current, { backgroundColor: null, scale: 3, useCORS: true });
      const link = document.createElement('a');
      const safeRaceName = race.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'RacePulsePH';
      link.download = `${safeRaceName}_${runnerProfile.bibNumber}_Race-Bib.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.warn('Failed to download race bib:', err);
      setDownloadError('Could not prepare the bib image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (!race.raceBibTemplateImage) return null;

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><Hash className="w-4 h-4 text-red-500" /> Your Digital Race Bib</h3>
          <p className="text-[10.5px] text-[var(--text-secondary)] mt-1">Your name and official bib number are ready for this race.</p>
        </div>
      </div>
      <div ref={bibRef} className="relative w-full aspect-[3/2] overflow-hidden rounded-xl bg-[var(--surface-inset)] select-none" style={{ containerType: 'inline-size' }}>
        <img src={race.raceBibTemplateImage} alt={`${race.name} personalized race bib`} className="absolute inset-0 w-full h-full object-cover" />
        <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${layout.bibNumberX}%`, top: `${layout.bibNumberY}%`, fontSize: `${layout.bibNumberSize ?? 12}cqw`, color: layout.bibNumberColor ?? '#FFFFFF', fontFamily: raceBibFontFamilies[layout.bibNumberFont ?? 'mono'] }}>{runnerProfile.bibNumber}</span>
        <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap max-w-[90%] truncate" style={{ left: `${layout.runnerNameX}%`, top: `${layout.runnerNameY}%`, fontSize: `${layout.runnerNameSize ?? 5}cqw`, color: layout.runnerNameColor ?? '#FFFFFF', fontFamily: raceBibFontFamilies[layout.runnerNameFont ?? 'display'] }}>{runnerProfile.fullName}</span>
      </div>
      <button type="button" onClick={handleDownload} disabled={downloading} className="w-full py-2.5 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition disabled:opacity-60 flex items-center justify-center gap-2">
        {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {downloading ? 'Preparing Bib...' : 'Download Race Bib'}
      </button>
      {downloadError && <p className="text-[10.5px] text-red-500 text-center">{downloadError}</p>}
    </div>
  );
}

function RunnerSplitsView({ runnerProfile }: { runnerProfile: RunnerProfile }) {
  const [race, setRace] = useState<Race | null | undefined>(undefined);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'races', runnerProfile.raceId), (docSnap) => {
      setRace(docSnap.exists() ? (docSnap.data() as Race) : null);
    }, (err) => console.warn('Race listener failed:', err.message));
    return () => unsubscribe();
  }, [runnerProfile.raceId]);

  // Runner results come from the protected Firestore query only. The LAN timing
  // endpoint is intentionally reserved for race operators and must not send a
  // full on-site scan feed to every runner's browser.
  useEffect(() => {
    const unsubscribe = onSnapshot(query(
      collection(db, 'chipReads'),
      where('raceId', '==', runnerProfile.raceId),
      where('bibNumber', '==', runnerProfile.bibNumber)
    ), (snapshot) => {
      const list: ChipRead[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as ChipRead));
      setChipReads(list);
    }, (err) => {
      console.warn('Runner split listener failed:', err.message);
      setChipReads([]);
    });
    return () => unsubscribe();
  }, [runnerProfile.raceId, runnerProfile.bibNumber]);

  const result = useMemo(() => {
    if (!race) return null;
    return computeResults(race.checkpoints, chipReads, [runnerProfile]).find((r) => r.bibNumber === runnerProfile.bibNumber);
  }, [race, chipReads, runnerProfile]);

  const orderedCheckpoints = useMemo(() => race ? [...race.checkpoints].sort((a, b) => a.order - b.order) : [], [race]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {race && <RunnerRacePass race={race} runnerProfile={runnerProfile} result={result} orderedCheckpoints={orderedCheckpoints} />}
      <div className="lg:col-span-7 space-y-6">
        <div className="glass-panel p-5">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-red-500" /> Checkpoint Splits
          </h3>
          {!race && <p className="text-xs text-[var(--text-secondary)]">Loading race details...</p>}
          {race && orderedCheckpoints.length === 0 && <p className="text-xs text-[var(--text-secondary)]">This race has no checkpoints configured yet.</p>}
          <div className="space-y-2">
            {orderedCheckpoints.map((cp, index) => {
              const split = result?.splits.find((s) => s.checkpointId === cp.id);
              const phase = checkpointType(cp, index, orderedCheckpoints.length);
              const waveStartTime = getWaveStartTime(race, runnerProfile.distance);
              const cutoffDeadline = cp.cutoffMinutes && waveStartTime
                ? new Date(new Date(waveStartTime).getTime() + cp.cutoffMinutes * 60_000)
                : undefined;
              const afterCutoff = !!split && !!cutoffDeadline && new Date(split.timestamp).getTime() > cutoffDeadline.getTime();
              return (
                <div key={cp.id} className="flex items-center justify-between glass-inset px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-[var(--text-primary)]">{cp.label}</span>
                    <span className="block text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)] mt-0.5">
                      {phase === 'checkin' ? 'Check-In' : phase === 'start' ? 'Official Start' : phase === 'finish' ? 'Finish' : cutoffDeadline ? `Cutoff ${cutoffDeadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Split'}
                    </span>
                  </span>
                  <span className={`font-mono text-sm font-black shrink-0 text-right ${afterCutoff ? 'text-amber-500' : split ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                    {split ? new Date(split.timestamp).toLocaleTimeString() : 'Pending'}
                    {afterCutoff && <span className="block text-[9px] font-sans uppercase tracking-wide">After cutoff</span>}
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
              {race && (
                <button
                  type="button"
                  onClick={() => downloadFinisherCertificate(race, runnerProfile, result)}
                  className="mt-4 w-full sm:w-auto px-4 py-2.5 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition inline-flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4" /> Download E-Certificate
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-5 space-y-6">
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
        {race && <DigitalRaceBib race={race} runnerProfile={runnerProfile} />}
      </div>
    </div>
  );
}

// ========== PROFILE ==========

interface ProfileModalProps {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  onClose: () => void;
}

function ProfileModal({ profile, runnerProfiles, onClose }: ProfileModalProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [nickname, setNickname] = useState(profile.nickname || '');
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photoURL || null);
  const [emergencyContactName, setEmergencyContactName] = useState(profile.emergencyContactName || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(profile.emergencyContactPhone || '');
  const [shirtSize, setShirtSize] = useState(profile.shirtSize || '');
  const [medicalNotes, setMedicalNotes] = useState(profile.medicalNotes || '');
  const [saving, setSaving] = useState(false);
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
      const dataUrl = await resizeImageToDataUrl(file, 200, 200);
      setPhotoPreview(dataUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to process the image.');
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await updateAccountDisplayName(displayName);
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: displayName.trim(),
        nickname: nickname.trim(),
        emergencyContactName: emergencyContactName.trim(),
        emergencyContactPhone: emergencyContactPhone.trim(),
        shirtSize,
        medicalNotes: medicalNotes.trim(),
        ...(photoPreview ? { photoURL: photoPreview } : {}),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    setSendingPasswordReset(true);
    setError('');
    setNotice('');
    try {
      await sendPasswordReset(profile.email);
      setNotice(`Password reset link sent to ${profile.email}.`);
    } catch (err: any) {
      setError(err.message || 'Could not send the password reset link.');
    } finally {
      setSendingPasswordReset(false);
    }
  };

  const recentRace = mostRecentPast ? raceById.get(mostRecentPast.raceId) : undefined;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="glass-panel w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto p-6 space-y-5 relative">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
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
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Account Email</label>
            <div className="glass-inset px-4 py-3 text-sm text-[var(--text-secondary)] flex items-center gap-2"><Mail className="w-4 h-4 text-red-500" />{profile.email}</div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Race preferences</h3>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shirt Size</label>
            <select value={shirtSize} onChange={(e) => setShirtSize(e.target.value)} className="w-full appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
              <option value="">Not selected</option>
              {['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5"><HeartPulse className="w-3.5 h-3.5 text-red-500" /> Emergency &amp; medical</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Emergency Contact</label>
              <input type="text" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} maxLength={100} placeholder="Full name" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Contact Number</label>
              <div className="relative"><Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" /><input type="tel" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} maxLength={30} placeholder="09XX XXX XXXX" className="w-full glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" /></div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Medical Note <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <textarea value={medicalNotes} onChange={(e) => setMedicalNotes(e.target.value)} maxLength={600} rows={3} placeholder="Example: allergy, asthma, or other information for race-day emergencies." className="w-full resize-y glass-inset px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Keep this brief. It is visible only to you and authorized RacePulse staff.</p>
          </div>
        </div>

        <div className="glass-inset p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><p className="text-xs font-black text-[var(--text-primary)]">Password</p><p className="text-[10px] text-[var(--text-secondary)] mt-0.5">We’ll send a secure reset link to your email.</p></div>
          <button type="button" onClick={() => void handlePasswordReset()} disabled={sendingPasswordReset} className="text-[10px] font-black uppercase tracking-wide px-3 py-2.5 rounded-[14px] bg-red-500/10 text-red-500 border border-red-500/25 hover:bg-red-500 hover:text-white transition disabled:opacity-60">{sendingPasswordReset ? 'Sending...' : 'Reset password'}</button>
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
        {notice && <p className="text-xs text-emerald-500 font-semibold">✓ {notice}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 disabled:opacity-60"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />} Save Settings
        </button>
      </div>
    </div>
  );
}
