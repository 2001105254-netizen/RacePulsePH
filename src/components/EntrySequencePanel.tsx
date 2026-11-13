import { useState } from 'react';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ChipRead, Race, RunnerProfile } from '../types';
import { runnerDivisionLabel } from '../lib/raceEntry';
import { entrySequenceError } from '../lib/entrySequence';
import { useAccess } from '../lib/access';

export default function EntrySequencePanel({ race, runners, chipReads }: {
  race: Race; runners: RunnerProfile[]; chipReads: ChipRead[];
}) {
  const { can } = useAccess();
  const [nextBib, setNextBib] = useState('');
  const [previousBib, setPreviousBib] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string } | null>(null);
  const label = (runner: RunnerProfile) => `#${runner.bibNumber} · ${runnerDivisionLabel(runner)} · ${runner.isFreeSlot ? 'Free Slot' : runner.fullName}`;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!can('roster.edit')) return;
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
  const [expanded, setExpanded] = useState(false);
  const control = 'w-full min-h-11 glass-inset px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50';
  const linked = runners.filter((runner) => runner.startsAfterBib);
  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
            Consecutive entries
          </h4>
          <p className="text-xs text-[var(--text-secondary)] mt-1 tabular-nums">
            {linked.length} {linked.length === 1 ? 'link configured' : 'links configured'}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="lg:hidden min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          {expanded ? 'Hide' : 'Configure'}
        </button>
      </div>
      <div className={`${expanded ? 'block' : 'hidden'} lg:block space-y-3`}>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Use separate bibs/chips for each entry. Link the next bib to the previous bib so its clock starts when the previous entry finishes (e.g. 5K Solo -&gt; 5K Duo).
        </p>
        <form onSubmit={save} className="grid grid-cols-1 gap-3">
          <fieldset className="contents" disabled={!can('roster.edit')}>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Next entry bib</span>
              <select
                required
                value={nextBib}
                onChange={(event) => {
                  const bib = event.target.value;
                  setNextBib(bib);
                  setPreviousBib(runners.find((runner) => runner.bibNumber === bib)?.startsAfterBib || '');
                  setFeedback(null);
                }}
                className={control}
              >
                <option value="">Choose next entry</option>
                {runners.map((runner) => (
                  <option key={runner.bibNumber} value={runner.bibNumber}>{label(runner)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Starts after this bib finishes</span>
              <select
                value={previousBib}
                onChange={(event) => setPreviousBib(event.target.value)}
                className={control}
              >
                <option value="">Normal start (no previous entry)</option>
                {runners
                  .filter((runner) => runner.bibNumber !== nextBib)
                  .map((runner) => (
                    <option key={runner.bibNumber} value={runner.bibNumber}>{label(runner)}</option>
                  ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={saving || !nextBib || !!race.completedAt}
              className="w-full min-h-11 rounded-xl bg-red-700 hover:bg-red-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save entry sequence'}
            </button>
          </fieldset>
        </form>
        {feedback && (
          <p role="status" className={`text-xs font-semibold ${feedback.error ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {feedback.text}
          </p>
        )}
        {linked.length > 0 && (
          <ul className="space-y-2 pt-2 border-t border-[var(--border-default)] text-xs text-[var(--text-secondary)]">
            {linked.map((runner) => (
              <li key={runner.bibNumber} className="font-mono">#{runner.startsAfterBib} -&gt; {label(runner)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
