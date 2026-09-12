import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { resizeImageToDataUrl } from '../lib/image';
import { AgeCategory, CheckpointType, Gender, Race, RaceDistance, RunnerProfile } from '../types';
import { generateRunnerRosterPdf } from '../lib/runnerReport';
import { Flag, Trash2, Plus, Save, Pencil, RefreshCw, Users2, FileDown, ImagePlus, X } from 'lucide-react';

interface CheckpointDraft {
  id: string;
  label: string;
  type: CheckpointType;
  cutoffMinutes: string;
}

function emptyCheckpointDrafts(): CheckpointDraft[] {
  return [
    { id: 'checkin', label: 'Check-In', type: 'checkin', cutoffMinutes: '' },
    { id: 'start', label: 'Start', type: 'start', cutoffMinutes: '' },
    { id: 'finish', label: 'Finish', type: 'finish', cutoffMinutes: '' },
  ];
}

interface AgeCategoryDraft {
  id: string;
  gender: Gender;
  minAge: number;
  maxAge: number;
}

function draftToAgeCategory(d: AgeCategoryDraft): AgeCategory {
  const genderLabel = d.gender === 'male' ? 'Male' : 'Female';
  return { id: d.id, gender: d.gender, minAge: d.minAge, maxAge: d.maxAge, label: `${genderLabel} ${d.minAge}-${d.maxAge}` };
}

interface DistanceDraft {
  id: string;
  km: number;
  price: number;
}

function draftToDistance(d: DistanceDraft): RaceDistance {
  return { id: d.id, km: d.km, price: d.price, label: `${d.km}K` };
}

interface InclusionDraft {
  id: string;
  text: string;
}

function formatPriceRange(distances: RaceDistance[] | undefined): string {
  if (!distances || distances.length === 0) return 'No pricing set';
  const prices = distances.map((d) => d.price || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₱${min.toFixed(0)}` : `₱${min.toFixed(0)}-₱${max.toFixed(0)}`;
}

interface RaceSetupPanelProps {
  uid: string;
  // Admin sees/edits every organizer's races; an Organizer only sees/edits their own.
  canSeeAllRaces: boolean;
  canDeleteRaces: boolean;
}

// Shared by both the Admin "Race Setup" tab and the Organizer dashboard - organizers
// need to be able to stand up a race day-of without waiting on an Admin.
export default function RaceSetupPanel({ uid, canSeeAllRaces, canDeleteRaces }: RaceSetupPanelProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [registrationCloseDate, setRegistrationCloseDate] = useState('');
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>(emptyCheckpointDrafts());
  const [ageCategories, setAgeCategories] = useState<AgeCategoryDraft[]>([]);
  const [distances, setDistances] = useState<DistanceDraft[]>([]);
  const [inclusions, setInclusions] = useState<InclusionDraft[]>([]);
  const [posterImage, setPosterImage] = useState('');
  const [posterUploading, setPosterUploading] = useState(false);
  const [inclusionImage, setInclusionImage] = useState('');
  const [inclusionUploading, setInclusionUploading] = useState(false);
  const [raceBibTemplateImage, setRaceBibTemplateImage] = useState('');
  const [raceBibUploading, setRaceBibUploading] = useState(false);
  const [bibNumberX, setBibNumberX] = useState(50);
  const [bibNumberY, setBibNumberY] = useState(48);
  const [runnerNameX, setRunnerNameX] = useState(50);
  const [runnerNameY, setRunnerNameY] = useState(70);
  const [bibNumberSize, setBibNumberSize] = useState(12);
  const [runnerNameSize, setRunnerNameSize] = useState(5);
  const [bibNumberColor, setBibNumberColor] = useState('#FFFFFF');
  const [runnerNameColor, setRunnerNameColor] = useState('#FFFFFF');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reportBusyRaceId, setReportBusyRaceId] = useState<string | null>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const inclusionInputRef = useRef<HTMLInputElement>(null);
  const raceBibInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const racesQuery = canSeeAllRaces
      ? query(collection(db, 'races'))
      : query(collection(db, 'races'), where('createdBy', '==', uid));
    const unsubscribe = onSnapshot(racesQuery, (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, [canSeeAllRaces, uid]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDate(new Date().toISOString().slice(0, 10));
    setRegistrationOpen(true);
    setRegistrationCloseDate('');
    setCheckpoints(emptyCheckpointDrafts());
    setAgeCategories([]);
    setDistances([]);
    setInclusions([]);
    setPosterImage('');
    setInclusionImage('');
    setRaceBibTemplateImage('');
    setBibNumberX(50);
    setBibNumberY(48);
    setRunnerNameX(50);
    setRunnerNameY(70);
    setBibNumberSize(12);
    setRunnerNameSize(5);
    setBibNumberColor('#FFFFFF');
    setRunnerNameColor('#FFFFFF');
    setError('');
  };

  useEffect(() => {
    window.addEventListener('racepulse:back', resetForm);
    return () => window.removeEventListener('racepulse:back', resetForm);
  }, []);

  const loadForEdit = (race: Race) => {
    setEditingId(race.id);
    setName(race.name);
    setDate(race.date);
    setRegistrationOpen(race.registrationOpen !== false);
    setRegistrationCloseDate(race.registrationCloseDate || '');
    const ordered = [...race.checkpoints].sort((a, b) => a.order - b.order);
    setCheckpoints(ordered.map((c, index) => ({
      id: c.id,
      label: c.label,
      type: c.type || (index === 0 ? 'start' : index === ordered.length - 1 ? 'finish' : 'intermediate'),
      cutoffMinutes: c.cutoffMinutes ? String(c.cutoffMinutes) : '',
    })));
    setAgeCategories((race.ageCategories || []).map((c) => ({ id: c.id, gender: c.gender, minAge: c.minAge, maxAge: c.maxAge })));
    setDistances((race.distances || []).sort((a, b) => a.km - b.km).map((d) => ({ id: d.id, km: d.km, price: d.price || 0 })));
    setInclusions((race.inclusions || []).map((text, idx) => ({ id: `incl_${idx}_${Date.now()}`, text })));
    setPosterImage(race.posterImage || '');
    setInclusionImage(race.inclusionImage || '');
    setRaceBibTemplateImage(race.raceBibTemplateImage || '');
    setBibNumberX(race.raceBibLayout?.bibNumberX ?? 50);
    setBibNumberY(race.raceBibLayout?.bibNumberY ?? 48);
    setRunnerNameX(race.raceBibLayout?.runnerNameX ?? 50);
    setRunnerNameY(race.raceBibLayout?.runnerNameY ?? 70);
    setBibNumberSize(race.raceBibLayout?.bibNumberSize ?? 12);
    setRunnerNameSize(race.raceBibLayout?.runnerNameSize ?? 5);
    setBibNumberColor(race.raceBibLayout?.bibNumberColor ?? '#FFFFFF');
    setRunnerNameColor(race.raceBibLayout?.runnerNameColor ?? '#FFFFFF');
    setError('');
  };

  const handlePosterSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPosterUploading(true);
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file, 800, 450, 0.78);
      setPosterImage(dataUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to process the poster image.');
    } finally {
      setPosterUploading(false);
    }
  };

  const handleInclusionImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setInclusionUploading(true);
    setError('');
    try {
      setInclusionImage(await resizeImageToDataUrl(file, 640, 640, 0.8));
    } catch (err: any) {
      setError(err.message || 'Failed to process the inclusion image.');
    } finally {
      setInclusionUploading(false);
    }
  };

  const handleRaceBibTemplateSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRaceBibUploading(true);
    setError('');
    try {
      setRaceBibTemplateImage(await resizeImageToDataUrl(file, 1000, 667, 0.82));
    } catch (err: any) {
      setError(err.message || 'Failed to process the race bib template.');
    } finally {
      setRaceBibUploading(false);
    }
  };

  const addCheckpoint = () => setCheckpoints((prev) => [...prev.slice(0, -1), { id: `cp_${Date.now()}`, label: '', type: 'intermediate', cutoffMinutes: '' }, prev[prev.length - 1]]);
  const removeCheckpoint = (idx: number) => setCheckpoints((prev) => prev.filter((_, i) => i !== idx));
  const updateCheckpoint = (idx: number, patch: Partial<CheckpointDraft>) =>
    setCheckpoints((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const addAgeCategory = () =>
    setAgeCategories((prev) => [...prev, { id: `age_${Date.now()}`, gender: 'male', minAge: 18, maxAge: 29 }]);
  const removeAgeCategory = (idx: number) => setAgeCategories((prev) => prev.filter((_, i) => i !== idx));
  const updateAgeCategory = (idx: number, patch: Partial<AgeCategoryDraft>) =>
    setAgeCategories((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const addDistance = () => setDistances((prev) => [...prev, { id: `dist_${Date.now()}`, km: 5, price: 0 }]);
  const removeDistance = (idx: number) => setDistances((prev) => prev.filter((_, i) => i !== idx));
  const updateDistanceKm = (idx: number, km: number) =>
    setDistances((prev) => prev.map((d, i) => (i === idx ? { ...d, km } : d)));
  const updateDistancePrice = (idx: number, price: number) =>
    setDistances((prev) => prev.map((d, i) => (i === idx ? { ...d, price } : d)));

  const addInclusion = () => setInclusions((prev) => [...prev, { id: `incl_${Date.now()}`, text: '' }]);
  const removeInclusion = (idx: number) => setInclusions((prev) => prev.filter((_, i) => i !== idx));
  const updateInclusionText = (idx: number, text: string) =>
    setInclusions((prev) => prev.map((i, idx2) => (idx2 === idx ? { ...i, text } : i)));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Race name is required.');
    if (checkpoints.length < 2) return setError('At least a Start and Finish checkpoint are required.');
    if (checkpoints.some((c) => !c.label.trim())) return setError('Every checkpoint needs a label.');
    if (checkpoints.filter((c) => c.type === 'start').length !== 1) return setError('Exactly one Start checkpoint is required.');
    if (checkpoints.filter((c) => c.type === 'finish').length !== 1) return setError('Exactly one Finish checkpoint is required.');
    if (checkpoints.filter((c) => c.type === 'checkin').length > 1) return setError('Only one Check-In checkpoint is allowed.');
    if (checkpoints.some((c) => c.type === 'intermediate' && c.cutoffMinutes && (!Number.isFinite(Number(c.cutoffMinutes)) || Number(c.cutoffMinutes) <= 0))) return setError('Intermediate cutoff minutes must be greater than zero.');
    const startIndex = checkpoints.findIndex((c) => c.type === 'start');
    const finishIndex = checkpoints.findIndex((c) => c.type === 'finish');
    const checkInIndex = checkpoints.findIndex((c) => c.type === 'checkin');
    if (finishIndex < startIndex) return setError('Finish must come after Start.');
    if (checkInIndex !== -1 && checkInIndex > startIndex) return setError('Check-In must come before Start.');
    if (checkpoints.some((checkpoint, index) => checkpoint.type === 'intermediate' && (index < startIndex || index > finishIndex))) return setError('Intermediate checkpoints must be between Start and Finish.');
    if (ageCategories.some((c) => c.minAge > c.maxAge)) return setError('An age category\'s minimum age cannot be greater than its maximum.');
    if (distances.some((d) => !d.km || d.km <= 0)) return setError('Every distance needs a kilometer value greater than 0.');
    if (distances.some((d) => d.price < 0)) return setError('A distance\'s price cannot be negative.');
    if (registrationCloseDate && registrationCloseDate > date) return setError('Registration closing date cannot be after the race date.');

    setSaving(true);
    try {
      const raceId = editingId || `race_${Date.now()}`;
      const existing = editingId ? races.find((r) => r.id === editingId) : undefined;
      const record: Race = {
        id: raceId,
        name: name.trim(),
        date,
        registrationOpen,
        ...(registrationCloseDate ? { registrationCloseDate } : {}),
        checkpoints: checkpoints.map((c, idx) => ({
          id: c.id,
          label: c.label.trim(),
          order: idx,
          type: c.type,
          ...(c.type === 'intermediate' && c.cutoffMinutes ? { cutoffMinutes: Number(c.cutoffMinutes) } : {}),
        })),
        ageCategories: ageCategories.map(draftToAgeCategory),
        distances: [...distances].sort((a, b) => a.km - b.km).map(draftToDistance),
        inclusions: inclusions.map((i) => i.text.trim()).filter(Boolean),
        createdBy: existing?.createdBy || uid,
        createdAt: existing?.createdAt || new Date().toISOString(),
        ...(existing?.gunStartTime ? { gunStartTime: existing.gunStartTime } : {}),
        ...(existing?.waveStartTimes ? { waveStartTimes: existing.waveStartTimes } : {}),
        ...(existing?.liveBroadcastEnabled ? { liveBroadcastEnabled: true } : {}),
        ...(existing?.livestreamUrl ? { livestreamUrl: existing.livestreamUrl } : {}),
        ...(existing?.routeMapUrl ? { routeMapUrl: existing.routeMapUrl } : {}),
        ...(posterImage ? { posterImage } : {}),
        ...(inclusionImage ? { inclusionImage } : {}),
        ...(raceBibTemplateImage ? {
          raceBibTemplateImage,
          raceBibLayout: { bibNumberX, bibNumberY, runnerNameX, runnerNameY, bibNumberSize, runnerNameSize, bibNumberColor, runnerNameColor },
        } : {}),
      };
      await setDoc(doc(db, 'races', raceId), record);
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save race.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (raceId: string) => {
    if (!window.confirm('Delete this race? Already-recorded chip reads are kept but will be orphaned.')) return;
    try {
      await deleteDoc(doc(db, 'races', raceId));
      if (editingId === raceId) resetForm();
    } catch (err) {
      console.warn('Failed to delete race:', err);
    }
  };

  const handleGenerateRunnerReport = async (race: Race) => {
    setReportBusyRaceId(race.id);
    try {
      const snapshot = await getDocs(query(collection(db, 'runners'), where('raceId', '==', race.id)));
      const runners: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => runners.push(docSnap.data() as RunnerProfile));

      if (!generateRunnerRosterPdf(race, runners)) {
        alert('No registered runners for this race yet.');
      }
    } catch (err) {
      console.warn('Failed to generate runner report:', err);
      alert('Failed to generate the runner report. Please try again.');
    } finally {
      setReportBusyRaceId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="glass-panel p-5 space-y-4">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
          <Flag className="w-4 h-4 text-red-500" /> {editingId ? 'Edit Race' : 'Create Race'}
        </h3>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Name</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: ANNUAL MARATHON CHAMPIONSHIP" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
          </div>

          <div className="glass-inset p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Registration status</span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">Only open races appear on the public registration page.</span>
              </span>
              <input
                type="checkbox"
                checked={registrationOpen}
                onChange={(e) => setRegistrationOpen(e.target.checked)}
                className="w-4 h-4 accent-red-600 shrink-0"
              />
            </label>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Registration closes on <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
              <input
                type="date"
                value={registrationCloseDate}
                onChange={(e) => setRegistrationCloseDate(e.target.value)}
                disabled={!registrationOpen}
                className="w-full glass-inset px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Event Poster</label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Shown on the race card runners see when browsing events - a good poster gets more registrations.</p>
            <input ref={posterInputRef} type="file" accept="image/*" onChange={handlePosterSelected} className="hidden" />
            {posterImage ? (
              <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)]">
                <img src={posterImage} alt="Race poster preview" className="w-full aspect-[16/9] object-cover" />
                <button
                  type="button"
                  onClick={() => setPosterImage('')}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
                  title="Remove poster"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => posterInputRef.current?.click()}
                  className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"
                >
                  <ImagePlus className="w-3 h-3" /> Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => posterInputRef.current?.click()}
                disabled={posterUploading}
                className="w-full aspect-[16/9] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60"
              >
                {posterUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{posterUploading ? 'Processing...' : 'Upload Poster Image'}</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Personalized Race Bib Template <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Upload your blank bib layout. RacePulse automatically adds each runner’s name and bib number after registration.</p>
            <input ref={raceBibInputRef} type="file" accept="image/*" onChange={handleRaceBibTemplateSelected} className="hidden" />
            {raceBibTemplateImage ? (
              <div className="space-y-3">
                <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]" style={{ containerType: 'inline-size' }}>
                  <img src={raceBibTemplateImage} alt="Race bib template preview" className="w-full aspect-[3/2] object-cover" />
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black font-mono tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${bibNumberX}%`, top: `${bibNumberY}%`, fontSize: `${bibNumberSize}cqw`, color: bibNumberColor }}>10-001</span>
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${runnerNameX}%`, top: `${runnerNameY}%`, fontSize: `${runnerNameSize}cqw`, color: runnerNameColor }}>RUNNER NAME</span>
                  <button type="button" onClick={() => setRaceBibTemplateImage('')} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition" title="Remove race bib template"><X className="w-4 h-4" /></button>
                  <button type="button" onClick={() => raceBibInputRef.current?.click()} className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"><ImagePlus className="w-3 h-3" /> Change</button>
                </div>
                <div className="glass-inset p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Bib number position</p>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)]">X <input type="range" min="5" max="95" value={bibNumberX} onChange={(e) => setBibNumberX(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberX}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Y <input type="range" min="5" max="95" value={bibNumberY} onChange={(e) => setBibNumberY(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberY}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Size <input type="range" min="5" max="24" value={bibNumberSize} onChange={(e) => setBibNumberSize(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberSize}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Color <input type="color" value={bibNumberColor} onChange={(e) => setBibNumberColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{bibNumberColor}</span></label>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Runner name position</p>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)]">X <input type="range" min="5" max="95" value={runnerNameX} onChange={(e) => setRunnerNameX(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameX}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Y <input type="range" min="5" max="95" value={runnerNameY} onChange={(e) => setRunnerNameY(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameY}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Size <input type="range" min="3" max="14" value={runnerNameSize} onChange={(e) => setRunnerNameSize(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameSize}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Color <input type="color" value={runnerNameColor} onChange={(e) => setRunnerNameColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{runnerNameColor}</span></label>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => raceBibInputRef.current?.click()} disabled={raceBibUploading} className="w-full aspect-[3/2] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60">
                {raceBibUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{raceBibUploading ? 'Processing...' : 'Upload Blank Race Bib Layout'}</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Checkpoints (in order)</label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Check-In is optional and is never used for finish time. Add cutoffs to intermediate stations as minutes after the official gun start.</p>
            <div className="space-y-2">
              {checkpoints.map((cp, idx) => (
                <div key={cp.id} className="glass-inset p-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] w-5 shrink-0">{idx + 1}.</span>
                  <select
                    value={cp.type}
                    onChange={(e) => updateCheckpoint(idx, { type: e.target.value as CheckpointType, cutoffMinutes: e.target.value === 'intermediate' ? cp.cutoffMinutes : '' })}
                    className="glass-inset px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    aria-label="Checkpoint type"
                  >
                    <option value="checkin">Check-In</option>
                    <option value="start">Start</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="finish">Finish</option>
                  </select>
                  <input
                    type="text"
                    required
                    value={cp.label}
                    onChange={(e) => updateCheckpoint(idx, { label: e.target.value })}
                    placeholder={cp.type === 'checkin' ? 'Check-In' : cp.type === 'start' ? 'Start' : cp.type === 'finish' ? 'Finish' : `Checkpoint ${idx}`}
                    className="min-w-[8rem] flex-1 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  {cp.type === 'intermediate' && (
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-secondary)] shrink-0">
                      Cutoff
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={cp.cutoffMinutes}
                        onChange={(e) => updateCheckpoint(idx, { cutoffMinutes: e.target.value })}
                        placeholder="min"
                        className="w-16 glass-inset px-2 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      />
                      min
                    </label>
                  )}
                  {(cp.type === 'checkin' || cp.type === 'intermediate') && (
                    <button type="button" onClick={() => removeCheckpoint(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5" title="Remove checkpoint">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addCheckpoint} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Intermediate Checkpoint
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Distances (KM) &amp; Price</label>
            <div className="space-y-2">
              {distances.map((d, idx) => (
                <div key={d.id} className="flex items-center gap-2">
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.1"
                    value={d.km}
                    onChange={(e) => updateDistanceKm(idx, parseFloat(e.target.value) || 0)}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    title="Kilometers"
                  />
                  <span className="text-xs text-[var(--text-secondary)] w-10 shrink-0">{draftToDistance(d).label}</span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-red-500 pointer-events-none">₱</span>
                    <input
                      type="number"
                      required
                      min={0}
                      step="0.01"
                      value={d.price === 0 ? '' : d.price}
                      onChange={(e) => updateDistancePrice(idx, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full glass-inset pl-6 pr-2 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      title="Registration price"
                    />
                  </div>
                  <button type="button" onClick={() => removeDistance(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {distances.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No distances yet - add the kilometer options runners can register for (e.g. 5, 10, 21, 42), each with its own price.</p>
              )}
            </div>
            <button type="button" onClick={addDistance} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Distance
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Inclusions</label>
            <div className="space-y-2">
              {inclusions.map((incl, idx) => (
                <div key={incl.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={incl.text}
                    onChange={(e) => updateInclusionText(idx, e.target.value)}
                    placeholder="EX: Finisher Medal"
                    className="flex-1 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <button type="button" onClick={() => removeInclusion(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {inclusions.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No inclusions yet - e.g. Finisher Medal, Race Singlet, Race Kit.</p>
              )}
            </div>
            <button type="button" onClick={addInclusion} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Inclusion
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Inclusion Design Preview <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Upload the shirt, medal, or race-kit design so runners can view it before registering.</p>
            <input ref={inclusionInputRef} type="file" accept="image/*" onChange={handleInclusionImageSelected} className="hidden" />
            {inclusionImage ? (
              <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]">
                <img src={inclusionImage} alt="Race inclusion preview" className="w-full aspect-square object-contain" />
                <button
                  type="button"
                  onClick={() => setInclusionImage('')}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
                  title="Remove inclusion image"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => inclusionInputRef.current?.click()}
                  className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"
                >
                  <ImagePlus className="w-3 h-3" /> Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inclusionInputRef.current?.click()}
                disabled={inclusionUploading}
                className="w-full aspect-[16/9] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60"
              >
                {inclusionUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{inclusionUploading ? 'Processing...' : 'Upload Shirt / Kit Design'}</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Age Categories (Male / Female)</label>
            <div className="space-y-2">
              {ageCategories.map((cat, idx) => (
                <div key={cat.id} className="flex items-center gap-2">
                  <select
                    value={cat.gender}
                    onChange={(e) => updateAgeCategory(idx, { gender: e.target.value as Gender })}
                    className="glass-inset px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                  <input
                    type="number"
                    required
                    min={1}
                    max={120}
                    value={cat.minAge}
                    onChange={(e) => updateAgeCategory(idx, { minAge: parseInt(e.target.value, 10) || 1 })}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <span className="text-xs text-[var(--text-muted)]">to</span>
                  <input
                    type="number"
                    required
                    min={1}
                    max={120}
                    value={cat.maxAge}
                    onChange={(e) => updateAgeCategory(idx, { maxAge: parseInt(e.target.value, 10) || 1 })}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">{draftToAgeCategory(cat).label}</span>
                  <button type="button" onClick={() => removeAgeCategory(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {ageCategories.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No age categories yet - runners will be reported as "Unclassified" until you add some.</p>
              )}
            </div>
            <button type="button" onClick={addAgeCategory} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Age Category
            </button>
          </div>

          {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {editingId ? 'Save Changes' : 'Create Race'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="text-xs font-bold uppercase tracking-wider px-4 py-3 glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius-control)] transition">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">{canSeeAllRaces ? 'All Races' : 'Your Races'}</h3>
        <div className="space-y-2">
          {races.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No races yet - create one on the left.</p>}
          {races.map((race) => (
            <div key={race.id} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">{race.name}</p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {race.date} &bull; {(race.distances || []).length} distances &bull; {race.checkpoints.length} checkpoints &bull; {(race.ageCategories || []).length} age categories
                </p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {formatPriceRange(race.distances)} &bull; {(race.inclusions || []).length} inclusions
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => handleGenerateRunnerReport(race)}
                  disabled={reportBusyRaceId === race.id}
                  className="p-2 text-[var(--text-secondary)] hover:text-emerald-500 transition disabled:opacity-50"
                  title="Download runner roster PDF (by distance & age category)"
                >
                  {reportBusyRaceId === race.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => loadForEdit(race)} className="p-2 text-[var(--text-secondary)] hover:text-amber-500 transition" title="Edit race"><Pencil className="w-3.5 h-3.5" /></button>
                {canDeleteRaces && <button onClick={() => handleDelete(race.id)} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition" title="Delete race"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-start gap-2 text-[10.5px] text-[var(--text-muted)]">
          <Users2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The roster PDF groups registered runners by distance, then by the age category their age/gender falls into.
        </div>
      </div>
    </div>
  );
}
