import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { RefreshCw, Users2 } from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories } from '../../lib/raceEntry';
import { importedRunnerUid, normalizeImportBib } from '../../lib/rosterImport';
import type { Race, RaceEntryCategory, RunnerProfile } from '../../types';
import { Select } from '../ui/Select';

interface ManualRunnerPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

/**
 * Compact desk-registration form for late entries, paper-form corrections,
 * and walk-in athletes omitted from an uploaded spreadsheet roster.
 */
export default function ManualRunnerPanel({ race, runnerProfiles }: ManualRunnerPanelProps) {
  const { can } = useAccess();
  const categories = raceEntryCategories(race);
  const [fullName, setFullName] = useState('');
  const [bibNumber, setBibNumber] = useState('');
  const [distance, setDistance] = useState(race.distances[0]?.label || '');
  const [entryCategory, setEntryCategory] = useState<RaceEntryCategory>(categories[0] || 'solo');
  const [gender, setGender] = useState<RunnerProfile['gender']>('male');
  const [age, setAge] = useState('');
  const [shirtSize, setShirtSize] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>(['', '', '', '']);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!categories.includes(entryCategory)) setEntryCategory(categories[0] || 'solo');
  }, [categories, entryCategory]);

  const memberCount = entryMemberCount[entryCategory];

  const updateMember = (index: number, value: string) => {
    setTeamMembers((current) => current.map((member, memberIndex) => (memberIndex === index ? value : member)));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedBib = normalizeImportBib(bibNumber);
    const normalizedName = fullName.trim().toUpperCase();
    const parsedAge = Number.parseInt(age, 10);

    if (!normalizedBib || !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(normalizedBib)) {
      setFeedback({ type: 'error', text: 'Use a bib with 1-20 letters, numbers, hyphens, or underscores.' });
      return;
    }
    if (!distance) {
      setFeedback({ type: 'error', text: 'Choose a race distance.' });
      return;
    }
    if (!normalizedName || normalizedName.length > 100) {
      setFeedback({ type: 'error', text: 'Enter the runner name (up to 100 characters).' });
      return;
    }
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      setFeedback({ type: 'error', text: 'Enter a valid age from 1 to 120.' });
      return;
    }
    if (runnerProfiles.some((runner) => normalizeImportBib(runner.bibNumber) === normalizedBib)) {
      setFeedback({ type: 'error', text: `Bib #${normalizedBib} is already in this race roster.` });
      return;
    }

    const normalizedTeamName = teamName.trim().toUpperCase();
    const normalizedMembers = [normalizedName, ...teamMembers.slice(1, memberCount).map((member) => member.trim().toUpperCase())];
    if (entryCategory !== 'solo' && !normalizedTeamName) {
      setFeedback({ type: 'error', text: `Enter the team name for this ${entryCategoryLabels[entryCategory]} entry.` });
      return;
    }
    if (entryCategory !== 'solo' && normalizedMembers.some((member) => !member || member.length > 100)) {
      setFeedback({ type: 'error', text: `Enter all ${memberCount} team member names.` });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const uid = importedRunnerUid();
      const record: RunnerProfile = {
        uid,
        raceId: race.id,
        fullName: entryCategory === 'solo' ? normalizedName : normalizedTeamName,
        bibNumber: normalizedBib,
        distance,
        entryCategory,
        gender,
        age: parsedAge,
        createdAt: new Date().toISOString(),
        ...(shirtSize.trim() ? { shirtSize: shirtSize.trim().toUpperCase() } : {}),
        ...(entryCategory !== 'solo' ? { teamName: normalizedTeamName, teamMembers: normalizedMembers } : {}),
      };
      await setDoc(doc(db, 'runners', `${uid}_${race.id}`), record);
      setFeedback({
        type: 'success',
        text: `${entryCategory === 'solo' ? normalizedName : normalizedTeamName} added to ${distance} ${entryCategoryLabels[entryCategory]} with bib #${normalizedBib}.`,
      });
      setFullName('');
      setBibNumber('');
      setAge('');
      setShirtSize('');
      setTeamName('');
      setTeamMembers(['', '', '', '']);
    } catch (error: unknown) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Could not add the runner.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
          <Users2 className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Add Runner Manually
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">For late registrations or paper-form entries. Adds a roster record only.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <fieldset className="contents" disabled={!can('roster.add')}>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              {entryCategory === 'solo' ? 'Runner name' : 'Team representative / member 1'}
            </label>
            <input required value={fullName} onChange={(event) => setFullName(event.target.value.toUpperCase())} placeholder="FULL NAME" className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Race bib number</label>
            <input required value={bibNumber} onChange={(event) => setBibNumber(event.target.value.toUpperCase())} placeholder="EX: 10-001" className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold font-mono text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
          </div>
          <div>
            <label htmlFor="manual-runner-distance" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Distance</label>
            <Select
              id="manual-runner-distance"
              value={distance}
              onChange={setDistance}
              surface="inset"
              size="md"
              triggerClassName="text-xs"
              options={race.distances.map((raceDistance) => ({
                value: raceDistance.label,
                label: raceDistance.label,
              }))}
            />
          </div>
          {categories.length > 1 && (
            <div>
              <label htmlFor="manual-runner-category" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Entry category</label>
              <Select
                id="manual-runner-category"
                value={entryCategory}
                onChange={(value) => setEntryCategory(value as RaceEntryCategory)}
                surface="inset"
                size="md"
                triggerClassName="text-xs"
                options={categories.map((category) => ({
                  value: category,
                  label: entryCategoryLabels[category],
                }))}
              />
            </div>
          )}
          <div>
            <label htmlFor="manual-runner-gender" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Gender</label>
            <Select
              id="manual-runner-gender"
              value={gender}
              onChange={(value) => setGender(value as RunnerProfile['gender'])}
              surface="inset"
              size="md"
              triggerClassName="text-xs"
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ]}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Age</label>
            <input required type="number" min="1" max="120" value={age} onChange={(event) => setAge(event.target.value)} placeholder="AGE" className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Shirt size (optional)</label>
            <input value={shirtSize} onChange={(event) => setShirtSize(event.target.value.toUpperCase())} placeholder="EX: M, 2XL" className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
          </div>

          {entryCategory !== 'solo' && (
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-red-600/25 bg-red-600/5 p-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400 mb-1">Team name</label>
                <input required value={teamName} onChange={(event) => setTeamName(event.target.value.toUpperCase())} placeholder="EX: TEAM RACEPULSE" className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
              </div>
              {Array.from({ length: memberCount - 1 }).map((_, index) => (
                <div key={index}>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Member {index + 2}</label>
                  <input required value={teamMembers[index + 1] || ''} onChange={(event) => updateMember(index + 1, event.target.value.toUpperCase())} placeholder={`MEMBER ${index + 2} NAME`} className="w-full min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600/50" />
                </div>
              ))}
            </div>
          )}

          <button type="submit" disabled={saving} className="sm:col-span-2 w-full min-h-11 text-xs font-semibold uppercase tracking-wider px-4 rounded-xl text-white bg-red-700 hover:bg-red-600 flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />} {saving ? 'Adding runner...' : 'Add runner to roster'}
          </button>
        </fieldset>
      </form>
      {feedback && (
        <p role="status" className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
