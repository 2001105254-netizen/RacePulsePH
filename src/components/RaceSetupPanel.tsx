import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { AgeCategory, Gender, Race, RaceDistance, RunnerProfile } from '../types';
import { groupRunnersForReport } from '../lib/runnerReport';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Flag, Trash2, Plus, Save, Pencil, RefreshCw, Users2, FileDown } from 'lucide-react';

interface CheckpointDraft {
  id: string;
  label: string;
}

function emptyCheckpointDrafts(): CheckpointDraft[] {
  return [
    { id: 'start', label: 'Start' },
    { id: 'finish', label: 'Finish' },
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

// Shared by both the Admin "Race Setup" tab and the Organizer dashboard - organizers
// need to be able to stand up a race day-of without waiting on an Admin.
export default function RaceSetupPanel() {
  const [races, setRaces] = useState<Race[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>(emptyCheckpointDrafts());
  const [ageCategories, setAgeCategories] = useState<AgeCategoryDraft[]>([]);
  const [distances, setDistances] = useState<DistanceDraft[]>([]);
  const [inclusions, setInclusions] = useState<InclusionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reportBusyRaceId, setReportBusyRaceId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDate(new Date().toISOString().slice(0, 10));
    setCheckpoints(emptyCheckpointDrafts());
    setAgeCategories([]);
    setDistances([]);
    setInclusions([]);
    setError('');
  };

  const loadForEdit = (race: Race) => {
    setEditingId(race.id);
    setName(race.name);
    setDate(race.date);
    setCheckpoints([...race.checkpoints].sort((a, b) => a.order - b.order).map((c) => ({ id: c.id, label: c.label })));
    setAgeCategories((race.ageCategories || []).map((c) => ({ id: c.id, gender: c.gender, minAge: c.minAge, maxAge: c.maxAge })));
    setDistances((race.distances || []).sort((a, b) => a.km - b.km).map((d) => ({ id: d.id, km: d.km, price: d.price || 0 })));
    setInclusions((race.inclusions || []).map((text, idx) => ({ id: `incl_${idx}_${Date.now()}`, text })));
    setError('');
  };

  const addCheckpoint = () => setCheckpoints((prev) => [...prev.slice(0, -1), { id: `cp_${Date.now()}`, label: '' }, prev[prev.length - 1]]);
  const removeCheckpoint = (idx: number) => setCheckpoints((prev) => prev.filter((_, i) => i !== idx));
  const updateCheckpointLabel = (idx: number, label: string) =>
    setCheckpoints((prev) => prev.map((c, i) => (i === idx ? { ...c, label } : c)));

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
    if (ageCategories.some((c) => c.minAge > c.maxAge)) return setError('An age category\'s minimum age cannot be greater than its maximum.');
    if (distances.some((d) => !d.km || d.km <= 0)) return setError('Every distance needs a kilometer value greater than 0.');
    if (distances.some((d) => d.price < 0)) return setError('A distance\'s price cannot be negative.');

    setSaving(true);
    try {
      const raceId = editingId || `race_${Date.now()}`;
      const existing = editingId ? races.find((r) => r.id === editingId) : undefined;
      const record: Race = {
        id: raceId,
        name: name.trim(),
        date,
        checkpoints: checkpoints.map((c, idx) => ({ id: c.id, label: c.label.trim(), order: idx })),
        ageCategories: ageCategories.map(draftToAgeCategory),
        distances: [...distances].sort((a, b) => a.km - b.km).map(draftToDistance),
        inclusions: inclusions.map((i) => i.text.trim()).filter(Boolean),
        createdBy: existing?.createdBy || '',
        createdAt: existing?.createdAt || new Date().toISOString(),
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

      if (runners.length === 0) {
        alert('No registered runners for this race yet.');
        return;
      }

      const groups = groupRunnersForReport(runners, race.ageCategories || []);
      const pdf = new jsPDF();

      pdf.setFillColor(20, 20, 20);
      pdf.rect(0, 0, 210, 26, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(15);
      pdf.setFont('helvetica', 'bold');
      pdf.text(race.name.toUpperCase(), 14, 12);
      pdf.setFontSize(8.5);
      pdf.setTextColor(245, 158, 11);
      pdf.text(`RUNNER ROSTER BY DISTANCE & AGE CATEGORY  |  ${runners.length} TOTAL RUNNERS  |  GENERATED ${new Date().toLocaleString()}`, 14, 19);

      let cursorY = 34;
      let currentDistance = '';

      groups.forEach((group) => {
        if (cursorY > 265) {
          pdf.addPage();
          cursorY = 20;
        }
        if (group.distance !== currentDistance) {
          currentDistance = group.distance;
          pdf.setFontSize(12);
          pdf.setTextColor(220, 38, 38);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`DISTANCE: ${group.distance.toUpperCase()}`, 14, cursorY);
          cursorY += 6;
        }
        pdf.setFontSize(9.5);
        pdf.setTextColor(80, 80, 80);
        pdf.setFont('helvetica', 'bolditalic');
        pdf.text(group.categoryLabel.toUpperCase(), 14, cursorY);
        cursorY += 2;

        autoTable(pdf, {
          startY: cursorY,
          head: [['#', 'Bib', 'Runner Name', 'Gender', 'Age']],
          body: group.runners.map((r, idx) => [idx + 1, r.bibNumber, r.fullName, r.gender.toUpperCase(), r.age]),
          styles: { fontSize: 8, cellPadding: 2.5, textColor: [40, 40, 40] },
          headStyles: { fillColor: [30, 30, 35], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 248, 250] },
          margin: { left: 14, right: 14 },
        });
        cursorY = (pdf as any).lastAutoTable.finalY + 8;
      });

      const sanitizedName = race.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Race';
      pdf.save(`${sanitizedName}_Runner_Roster.pdf`);
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

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Checkpoints (in order)</label>
            <div className="space-y-2">
              {checkpoints.map((cp, idx) => (
                <div key={cp.id} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] w-5 shrink-0">{idx + 1}.</span>
                  <input
                    type="text"
                    required
                    value={cp.label}
                    onChange={(e) => updateCheckpointLabel(idx, e.target.value)}
                    placeholder={idx === 0 ? 'Start' : idx === checkpoints.length - 1 ? 'Finish' : `Checkpoint ${idx}`}
                    className="flex-1 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  {checkpoints.length > 2 && (
                    <button type="button" onClick={() => removeCheckpoint(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addCheckpoint} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Checkpoint
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
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">Configured Races</h3>
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
                <button onClick={() => handleDelete(race.id)} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition" title="Delete race"><Trash2 className="w-3.5 h-3.5" /></button>
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
