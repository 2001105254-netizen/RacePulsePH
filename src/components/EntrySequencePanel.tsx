import { useState } from 'react';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ChipRead, Race, RunnerProfile } from '../types';
import { runnerDivisionLabel } from '../lib/raceEntry';
import { entrySequenceError } from '../lib/entrySequence';

export default function EntrySequencePanel({ race, runners, chipReads }: {
  race: Race; runners: RunnerProfile[]; chipReads: ChipRead[];
}) {
  const [nextBib, setNextBib] = useState('');
  const [previousBib, setPreviousBib] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string } | null>(null);
  const label = (runner: RunnerProfile) => `#${runner.bibNumber} · ${runnerDivisionLabel(runner)} · ${runner.isFreeSlot ? 'Free Slot' : runner.fullName}`;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = entrySequenceError(runners, nextBib, previousBib);
    const next = runners.find((runner) => runner.bibNumber === nextBib);
    const hasTimingReads = chipReads.some((read) => read.bibNumber === nextBib
      && race.checkpoints.find((checkpoint) => checkpoint.id === read.checkpointId)?.type !== 'checkin');
    if (error || !next || race.completedAt || hasTimingReads) {
      setFeedback({ error: true, text: error || 'Entry links are locked after this bib has timing reads or the race has closed.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'runners', `${next.uid}_${race.id}`), { startsAfterBib: previousBib || deleteField() });
      setFeedback({ text: previousBib ? `Bib #${nextBib} will start at bib #${previousBib}'s official finish.` : `Bib #${nextBib} uses its normal start again.` });
    } catch (error: unknown) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'Could not save the entry link.' });
    } finally { setSaving(false); }
  };
  const control = 'w-full glass-inset px-3 py-3 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50';
  const linked = runners.filter((runner) => runner.startsAfterBib);
  return (
    <details className="glass-inset p-4">
      <summary className="cursor-pointer text-xs font-bold text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Consecutive entries · {linked.length} linked</summary>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Use separate bibs/chips for each entry. Link the next bib to the previous bib: its clock starts exactly when the previous entry finishes. Example: 5K Solo → 5K Duo.</p>
      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 mt-4">
        <label className="space-y-1 text-xs text-[var(--text-secondary)]"><span>Next entry bib</span><select required value={nextBib} onChange={(event) => { const bib = event.target.value; setNextBib(bib); setPreviousBib(runners.find((runner) => runner.bibNumber === bib)?.startsAfterBib || ''); setFeedback(null); }} className={control}><option value="">Choose next entry</option>{runners.map((runner) => <option key={runner.bibNumber} value={runner.bibNumber}>{label(runner)}</option>)}</select></label>
        <label className="space-y-1 text-xs text-[var(--text-secondary)]"><span>Starts after this bib finishes</span><select value={previousBib} onChange={(event) => setPreviousBib(event.target.value)} className={control}><option value="">Normal start · no previous entry</option>{runners.filter((runner) => runner.bibNumber !== nextBib).map((runner) => <option key={runner.bibNumber} value={runner.bibNumber}>{label(runner)}</option>)}</select></label>
        <button type="submit" disabled={saving || !nextBib || !!race.completedAt} className="sm:col-span-2 justify-self-start rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save entry sequence'}</button>
      </form>
      {feedback && <p role="status" className={`mt-3 text-xs ${feedback.error ? 'text-red-500' : 'text-emerald-500'}`}>{feedback.text}</p>}
      {linked.length > 0 && <ul className="space-y-2 mt-4 text-xs text-[var(--text-secondary)]">{linked.map((runner) => <li key={runner.bibNumber}>#{runner.startsAfterBib} → {label(runner)}</li>)}</ul>}
    </details>
  );
}
