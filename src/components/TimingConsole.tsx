import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useDualSync } from '../lib/dualSync';
import { computeResults } from '../lib/timing';
import { Race, ChipRead, RunnerProfile } from '../types';
import { Radio, ScanLine, Trophy, Clock, Wifi, WifiOff, QrCode, RefreshCw, ArrowLeft } from 'lucide-react';
import QrScannerModal from './QrScannerModal';
import RaceList from './RaceList';

interface TimingConsoleProps {
  uid: string;
}

// Live checkpoint recording + results, shared by the Organizer and Admin dashboards.
// Every read written here has source: 'manual' - a future RFID reader bridge will POST
// into the exact same /api/chip-reads + chipReads collection with source: 'rfid-bridge',
// so nothing in this component needs to change when real hardware arrives.
export default function TimingConsole({ uid }: TimingConsoleProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [activeRaceId, setActiveRaceId] = useState<string>(() => localStorage.getItem('racepulse_active_race') || '');

  useEffect(() => {
    const q = query(collection(db, 'races'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (error) => console.warn('Races listener failed:', error.message));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeRaceId) {
      localStorage.setItem('racepulse_active_race', activeRaceId);
    }
  }, [activeRaceId]);

  const activeRace = races.find((r) => r.id === activeRaceId);

  if (!activeRace) {
    return (
      <RaceList
        races={races}
        onSelectRace={setActiveRaceId}
        selectedRaceId={activeRaceId}
        title="Race Events"
        subtitle="Choose which race you're recording checkpoint times for."
        actionLabel="Time This Race"
        emptyTitle="No races configured yet"
        emptyDescription="Set one up in the Race Setup tab first."
      />
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => setActiveRaceId('')}
        className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Choose a different race
      </button>
      <TimingConsoleForRace key={activeRace.id} race={activeRace} uid={uid} />
    </div>
  );
}

interface TimingConsoleForRaceProps {
  race: Race;
  uid: string;
}

function TimingConsoleForRace({ race, uid }: TimingConsoleForRaceProps) {
  const orderedCheckpoints = useMemo(() => [...race.checkpoints].sort((a, b) => a.order - b.order), [race.checkpoints]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(orderedCheckpoints[0]?.id || '');
  const [bibInput, setBibInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  const { items: chipReads, lanConnected } = useDualSync<ChipRead>({
    firestoreQuery: query(collection(db, 'chipReads'), where('raceId', '==', race.id)),
    lanEndpoint: '/api/chip-reads',
    lanResponseKey: 'chipReads',
    getId: (r) => r.id,
    getUpdatedAt: (r) => r.createdAt,
  });

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'runners'), where('raceId', '==', race.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
      setRunnerProfiles(list);
    }, (error) => console.warn('Runner profiles listener failed:', error.message));
    return () => unsubscribe();
  }, [race.id]);

  const results = useMemo(
    () => computeResults(race.checkpoints, chipReads, runnerProfiles),
    [race.checkpoints, chipReads, runnerProfiles]
  );

  const checkpointLabel = (id: string) => orderedCheckpoints.find((c) => c.id === id)?.label || id;

  const submitRead = async (bibRaw: string, overrideTimestamp?: string) => {
    if (!selectedCheckpointId) {
      setFeedback({ type: 'error', text: 'Select a checkpoint first.' });
      return false;
    }
    const bibNumber = bibRaw.trim().toUpperCase();
    if (!bibNumber) {
      setFeedback({ type: 'error', text: 'Enter or scan a bib number.' });
      return false;
    }

    setRecording(true);
    setFeedback(null);
    try {
      const nowIso = new Date().toISOString();
      const readId = `${race.id}_${bibNumber}_${selectedCheckpointId}_${Date.now()}`;
      const record: ChipRead = {
        id: readId,
        raceId: race.id,
        bibNumber,
        checkpointId: selectedCheckpointId,
        timestamp: overrideTimestamp || nowIso,
        source: 'manual',
        recordedBy: uid,
        createdAt: nowIso,
      };

      // Non-blocking dual write, matching the app's existing cloud + LAN sync pattern
      setDoc(doc(db, 'chipReads', readId), record).catch((e) => {
        console.warn('Cloud Firestore chip read write deferred or offline:', e);
      });
      fetch('/api/chip-reads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch((e) => console.warn('LAN chip read sync skipped:', e));

      setFeedback({ type: 'success', text: `Recorded bib ${bibNumber} @ ${checkpointLabel(selectedCheckpointId)}` });
      setBibInput('');
      return true;
    } finally {
      setRecording(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitRead(bibInput);
  };

  const handleQrScan = async (text: string): Promise<boolean> => {
    let bib = text.trim();
    if (bib.startsWith('RPCHIPv1|')) {
      bib = bib.split('|')[2] || bib.split('|')[1] || '';
    } else if (bib.startsWith('RXPv2|')) {
      bib = bib.split('|')[3] || ''; // fall back to the engraving ticket's bib field
    }
    if (!bib) return false;
    return submitRead(bib);
  };

  const recentReads = useMemo(
    () => [...chipReads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15),
    [chipReads]
  );

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex items-center justify-between glass-panel px-4 py-3">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display uppercase">{race.name}</span>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{orderedCheckpoints.length} checkpoints &bull; {results.length} runners with recorded splits</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border ${lanConnected ? 'bg-green-500/10 border-green-500/25 text-green-500' : 'bg-rose-500/10 border-rose-500/25 text-rose-500'}`}>
          {lanConnected ? <><Wifi className="w-3 h-3" /> LAN Sync Linked</> : <><WifiOff className="w-3 h-3" /> Standalone Mode</>}
        </span>
      </div>

      {/* Recording console */}
      <div className="glass-panel p-5 space-y-4">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
          <Radio className="w-4 h-4 text-red-500" /> Record a Checkpoint Split
        </h3>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Checkpoint</label>
          <div className="flex flex-wrap gap-2">
            {orderedCheckpoints.map((cp) => (
              <button
                key={cp.id}
                onClick={() => setSelectedCheckpointId(cp.id)}
                className={`text-xs font-bold uppercase tracking-wide px-3.5 py-2 rounded-[16px] border transition ${selectedCheckpointId === cp.id ? 'bg-red-600 border-red-600 text-white shadow-lg shadow-red-900/30' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                {cp.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="TYPE BIB NUMBER"
            value={bibInput}
            onChange={(e) => setBibInput(e.target.value.toUpperCase())}
            className="flex-1 glass-inset px-4 py-3 text-sm font-bold font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
          <button
            type="submit"
            disabled={recording}
            className="text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {recording ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Record Now
          </button>
          <button
            type="button"
            onClick={() => { setFeedback(null); setShowScanModal(true); }}
            className="text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center gap-2 transition"
          >
            <QrCode className="w-4 h-4" /> Scan
          </button>
        </form>

        {feedback && (
          <p className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
            {feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}
          </p>
        )}
      </div>

      {/* Recent reads + Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-5">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
            <ScanLine className="w-4 h-4 text-red-500" /> Recent Reads
          </h3>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {recentReads.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)]">No reads recorded yet.</p>
            )}
            {recentReads.map((r) => (
              <div key={r.id} className="flex items-center justify-between glass-inset px-3 py-2 text-xs">
                <span className="font-mono font-bold text-[var(--text-primary)]">#{r.bibNumber}</span>
                <span className="text-[var(--text-secondary)]">{checkpointLabel(r.checkpointId)}</span>
                <span className="font-mono text-[var(--text-muted)]">{new Date(r.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-5">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-red-500" /> Live Results
          </h3>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {results.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)]">No results yet.</p>
            )}
            {results.map((r) => (
              <div key={r.bibNumber} className="flex items-center justify-between glass-inset px-3 py-2 text-xs gap-2">
                <span className="font-mono font-bold text-red-500 w-8 shrink-0">{r.rank ? `#${r.rank}` : '-'}</span>
                <span className="flex-1 truncate">
                  <span className="font-bold text-[var(--text-primary)]">{r.runnerProfile?.fullName || `Bib ${r.bibNumber}`}</span>
                  <span className="text-[var(--text-muted)]"> &bull; #{r.bibNumber}</span>
                </span>
                <span className="font-mono font-bold text-[var(--text-primary)] shrink-0">{r.finishTime || `${r.splits.length}/${orderedCheckpoints.length}`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showScanModal && (
        <QrScannerModal
          onClose={() => setShowScanModal(false)}
          onScanSuccess={handleQrScan}
          successMessage={feedback?.type === 'success' ? feedback.text : ''}
          errorMessage={feedback?.type === 'error' ? feedback.text : ''}
          title="Checkpoint Bib Scanner"
          subtitle={`RECORDING AT ${checkpointLabel(selectedCheckpointId).toUpperCase()}`}
          instructions="Scan the runner's race bib QR code to instantly log their time at this checkpoint."
        />
      )}
    </div>
  );
}
