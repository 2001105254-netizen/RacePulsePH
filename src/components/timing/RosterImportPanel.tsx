import React, { useRef, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { FileUp, RefreshCw, Users2 } from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { entryMemberCount } from '../../lib/raceEntry';
import { importBibMatchKey, importedRunnerUid, parseRosterSheets, type RosterImportPreview } from '../../lib/rosterImport';
import { MAX_XLSX_BYTES, assertSafeImportFile } from '../../lib/security';
import { readSpreadsheetSheets } from '../../lib/spreadsheet';
import type { Race, RunnerProfile } from '../../types';
import { useFeedback } from '../ui/FeedbackProvider';

interface RosterImportPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

/**
 * Spreadsheet importer for pre-assigned race bibs (.xlsx, .csv, .tsv) using
 * literal CSV parsing and read-excel-file for OOXML workbooks.
 */
export default function RosterImportPanel({ race, runnerProfiles }: RosterImportPanelProps) {
  const { can } = useAccess();
  const { confirm } = useFeedback();
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFeedback(null);
    setPreview(null);

    try {
      assertSafeImportFile(file, MAX_XLSX_BYTES, /\.(xlsx|csv|tsv)$/i, 'Choose an Excel (.xlsx), CSV, or TSV file.');
    } catch (error: unknown) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Choose an Excel (.xlsx), CSV, or TSV file.' });
      return;
    }

    try {
      const sheets = await readSpreadsheetSheets(file, file.name);
      const parsed = parseRosterSheets(sheets, file.name, race);
      if (parsed.detectedSheets.length === 0) {
        setFeedback({ type: 'error', text: 'No importable roster tab found. The file needs Full name, Race bib number, Distance, Entry category, and Age or Date of birth. Sex/Gender is required only for Solo.' });
        return;
      }
      if (parsed.runners.length === 0) {
        setFeedback({ type: 'error', text: `No complete runners found. Check the ${parsed.skipped.length} rows flagged by the importer.` });
      }
      setPreview(parsed);
    } catch (error: unknown) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Could not read this file.' });
    }
  };

  const handleImport = async () => {
    if (!preview || preview.runners.length === 0) return;
    const existingByBib = new Map(runnerProfiles.map((runner) => [importBibMatchKey(runner.bibNumber), runner]));
    const existingCount = preview.runners.filter((runner) => existingByBib.has(importBibMatchKey(runner.bibNumber))).length;
    const newCount = preview.runners.length - existingCount;
    const approved = await confirm({
      title: `Import ${preview.runners.length} roster entries into ${race.name}?`,
      message: `${newCount} new runner${newCount === 1 ? '' : 's'} will be created and ${existingCount} matching bib${existingCount === 1 ? '' : 's'} will be updated. This does not create login accounts.`,
      confirmLabel: 'Import roster',
      cancelLabel: 'Cancel',
    });
    if (!approved) return;

    setImporting(true);
    setFeedback(null);
    try {
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;

      // Keep Firestore write batches within 400 docs to leave margin under the 500-op cap.
      for (let start = 0; start < preview.runners.length; start += 400) {
        const batch = writeBatch(db);
        for (const imported of preview.runners.slice(start, start + 400)) {
          const existing = existingByBib.get(importBibMatchKey(imported.bibNumber));
          const uid = existing?.uid || importedRunnerUid();
          const record: RunnerProfile = {
            uid,
            raceId: race.id,
            fullName: imported.fullName.trim().toUpperCase(),
            bibNumber: imported.bibNumber,
            distance: imported.distance,
            ...(imported.entryCategory ? { entryCategory: imported.entryCategory } : {}),
            gender: imported.gender,
            age: imported.age,
            ageNotProvided: Boolean(imported.ageNotProvided),
            createdAt: existing?.createdAt || now,
            ...(imported.shirtSize ? { shirtSize: imported.shirtSize } : {}),
            ...(imported.teamMembers && imported.teamMembers.length >= entryMemberCount[imported.entryCategory || 'solo']
              ? { teamMembers: imported.teamMembers }
              : {}),
          };
          batch.set(doc(db, 'runners', `${uid}_${race.id}`), record, { merge: true });
          if (existing) updated += 1;
          else created += 1;
        }
        await batch.commit();
      }
      setFeedback({ type: 'success', text: `Import complete: ${created} created, ${updated} updated. Select runners in Assign Chips to pair tags.` });
    } catch (error: unknown) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Could not import the runner roster.' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
            <FileUp className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Import Runner Roster
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Upload an Excel (.xlsx), CSV, or TSV bib assignment file.</p>
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="min-h-11 shrink-0 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-2">
          <FileUp className="w-4 h-4" aria-hidden="true" /> Choose File
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.tsv" className="hidden" onChange={handleFile} />
      </div>

      <div className="rounded-xl border border-amber-700/25 bg-amber-500/5 px-3 py-2 text-xs text-[var(--text-secondary)] leading-relaxed">
        Required: <strong className="text-[var(--text-primary)]">Full name, Race bib number, Distance, Entry category</strong>, and <strong className="text-[var(--text-primary)]">Age/DOB</strong> (Group optional; Sex required for Solo only).
      </div>

      {preview && (
        <div className="glass-inset p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[16rem]">{preview.fileName}</p>
              <p className="text-xs text-[var(--text-secondary)]">Tabs: {preview.detectedSheets.join(', ')}</p>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">{preview.runners.length} READY</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center tabular-nums">
            <div className="rounded-lg bg-[var(--surface-hover)] px-2 py-2"><p className="text-sm font-semibold text-[var(--text-primary)]">{preview.runners.length}</p><p className="text-xs text-[var(--text-secondary)]">Runners</p></div>
            <div className="rounded-lg bg-[var(--surface-hover)] px-2 py-2"><p className="text-sm font-semibold text-[var(--text-primary)]">{preview.skipped.length}</p><p className="text-xs text-[var(--text-secondary)]">Skipped</p></div>
          </div>
          {preview.skipped.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">Skipped: {preview.skipped.slice(0, 2).join(' • ')}{preview.skipped.length > 2 ? ` • +${preview.skipped.length - 2} more` : ''}</p>}
          <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
            {preview.runners.slice(0, 8).map((runner) => <div key={`${runner.distance}-${runner.bibNumber}`} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><span className="font-mono font-semibold text-[var(--text-primary)] w-16">#{runner.bibNumber}</span><span className="truncate flex-1">{runner.fullName}</span><span>{runner.distance}</span></div>)}
            {preview.runners.length > 8 && <p className="text-xs text-[var(--text-secondary)]">+ {preview.runners.length - 8} more</p>}
          </div>
          <button hidden={!can('roster.import')} type="button" onClick={handleImport} disabled={importing || preview.runners.length === 0} className="w-full min-h-11 text-xs font-semibold uppercase tracking-wider px-4 rounded-xl text-white bg-emerald-700 hover:bg-emerald-600 flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
            {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />} {importing ? 'Importing roster...' : `Import ${preview.runners.length} runners`}
          </button>
        </div>
      )}

      {feedback && (
        <p role="status" className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
