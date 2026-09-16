import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, doc, setDoc, updateDoc, onSnapshot, writeBatch, deleteField, runTransaction } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { useDualSync } from '../lib/dualSync';
import { checkpointType, computeResults, getCheckpointByType, getWaveStartTime } from '../lib/timing';
import { useOfflineScanQueue } from '../lib/offlineScanQueue';
import { Race, ChipRead, PublicLeaderboardEntry, PublicLiveResults, RaceEntryCategory, RunnerProfile, RunnerResult } from '../types';
import { groupRunnersByDistance, generateRunnerRosterPdf } from '../lib/runnerReport';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories, runnerDivisionLabel } from '../lib/raceEntry';
import { Radio, ScanLine, Trophy, Clock, Wifi, WifiOff, QrCode, RefreshCw, ArrowLeft, Cpu, Users2, FileDown, FileUp, Maximize2, X, ListChecks, CheckCircle2, Circle, PlayCircle, RotateCcw, Timer } from 'lucide-react';
import QrScannerModal from './QrScannerModal';
import RaceList from './RaceList';

// Ticks every second so any component reading it re-renders live - backs the
// gun clock and the wall-clock readout without each caller managing its own timer.
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatClockElapsed(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// RFID readers commonly send an EPC as keyboard text. Normalising both the
// scanner value and saved IDs keeps matching reliable when a reader switches
// between lowercase and uppercase hexadecimal output.
function normalizeScanValue(value: string): string {
  return value.trim().toUpperCase();
}

type ScanFeedback = { type: 'success' | 'error' | 'warning'; text: string };

interface RfidBridgeEvent {
  id: string;
  epc: string;
  antenna: number;
  timestamp: string;
  receivedAt: string;
}

// The race-day desk needs a hands-free confirmation. This uses browser-native
// haptics when available and a very short generated tone, so it works without
// bundling or downloading an audio asset.
function announceSuccessfulScan(): void {
  if (typeof window === 'undefined') return;
  try {
    if ('vibrate' in navigator) navigator.vibrate?.([35, 30, 65]);
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(880, audio.currentTime);
    tone.frequency.setValueAtTime(1175, audio.currentTime + 0.07);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.16);
    tone.connect(gain);
    gain.connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.17);
    tone.addEventListener('ended', () => { void audio.close(); }, { once: true });
  } catch {
    // Sound/haptics are a convenience; recording must still work on browsers
    // that block audio before an explicit user gesture.
  }
}

interface LiveClockProps {
  gunStartTime?: string;
  size?: 'compact' | 'large' | 'header';
}

// Gun-time clock: counts up from the moment the race-in-charge fires the
// official start (race.gunStartTime), independent of any individual chip read.
function LiveClock({ gunStartTime, size = 'compact' }: LiveClockProps) {
  const now = useNow(1000);
  const wallClock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (size === 'large') {
    return (
      <div className="text-center">
        <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.25em] text-[var(--text-muted)]">{gunStartTime ? 'Gun Time' : 'Current Time'}</p>
        <p className="font-mono font-black text-4xl sm:text-6xl text-[var(--text-primary)] tabular-nums">
          {gunStartTime ? formatClockElapsed(now - new Date(gunStartTime).getTime()) : wallClock}
        </p>
      </div>
    );
  }

  if (size === 'header') {
    return (
      <div className="text-right shrink-0">
        <p className="text-[9px] sm:text-[11px] font-black uppercase tracking-widest text-white/40">{gunStartTime ? 'Gun Time' : 'Current Time'}</p>
        <p className="font-mono font-black text-lg sm:text-2xl text-white tabular-nums">
          {gunStartTime ? formatClockElapsed(now - new Date(gunStartTime).getTime()) : wallClock}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Timer className="w-3.5 h-3.5 text-red-500" />
      {gunStartTime ? (
        <span className="font-mono font-black text-sm text-[var(--text-primary)] tabular-nums">{formatClockElapsed(now - new Date(gunStartTime).getTime())}</span>
      ) : (
        <span className="font-mono font-bold text-sm text-[var(--text-secondary)] tabular-nums">{wallClock}</span>
      )}
    </div>
  );
}

interface TimingConsoleProps {
  uid: string;
  // Admin can time any organizer's race; an Organizer only sees/times races they created.
  canSeeAllRaces: boolean;
}

// Live checkpoint recording + results, shared by the Organizer and Admin dashboards.
// The operator's browser validates and saves reads.  A local Windows bridge can
// feed it live EPC sightings from a VF-787P reader through /api/rfid-events.
export default function TimingConsole({ uid, canSeeAllRaces }: TimingConsoleProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [activeRaceId, setActiveRaceId] = useState<string>(() => localStorage.getItem('racepulse_active_race') || '');

  useEffect(() => {
    const goBackToRaceList = () => {
      localStorage.removeItem('racepulse_active_race');
      setActiveRaceId('');
    };
    window.addEventListener('racepulse:back', goBackToRaceList);
    return () => window.removeEventListener('racepulse:back', goBackToRaceList);
  }, []);

  useEffect(() => {
    const q = canSeeAllRaces
      ? query(collection(db, 'races'))
      : query(collection(db, 'races'), where('createdBy', '==', uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (error) => console.warn('Races listener failed:', error.message));
    return () => unsubscribe();
  }, [canSeeAllRaces, uid]);

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
        onClick={() => {
          localStorage.removeItem('racepulse_active_race');
          setActiveRaceId('');
        }}
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
  const [mode, setMode] = useState<'record' | 'assign' | 'roster' | 'rankings' | 'rollcall'>('record');
  const orderedCheckpoints = useMemo(() => [...race.checkpoints].sort((a, b) => a.order - b.order), [race.checkpoints]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(orderedCheckpoints[0]?.id || '');
  const [bibInput, setBibInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  // Live reader input is deliberately opt-in. A reader may continue to see
  // nearby chips before the gun, so selecting a station alone must never arm
  // automatic timing.
  const [scannerArmed, setScannerArmed] = useState(false);
  // Used by the one-tap gun-start flow. The normal station-change safety
  // effect pauses RFID first, then this flag arms only the Start station once
  // the console is visibly on the correct screen.
  const [armStartOnEnter, setArmStartOnEnter] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const lastRecordedScanRef = useRef<{ key: string; at: number } | null>(null);
  const submitReadRef = useRef<(scanRaw: string, overrideTimestamp?: string) => Promise<boolean>>(async () => false);
  const processedBridgeEventsRef = useRef(new Set<string>());
  const [bridgeEndpointReady, setBridgeEndpointReady] = useState(false);
  const selectedCheckpoint = orderedCheckpoints.find((checkpoint) => checkpoint.id === selectedCheckpointId);
  const selectedCheckpointIndex = selectedCheckpoint ? orderedCheckpoints.findIndex((checkpoint) => checkpoint.id === selectedCheckpoint.id) : -1;
  const selectedCheckpointType = selectedCheckpoint && selectedCheckpointIndex >= 0
    ? checkpointType(selectedCheckpoint, selectedCheckpointIndex, orderedCheckpoints.length)
    : 'intermediate';
  const checkInCheckpoint = getCheckpointByType(orderedCheckpoints, 'checkin');
  const startCheckpoint = getCheckpointByType(orderedCheckpoints, 'start') || orderedCheckpoints[0];
  const finishCheckpoint = getCheckpointByType(orderedCheckpoints, 'finish') || orderedCheckpoints[orderedCheckpoints.length - 1];

  const { items: chipReads, lanConnected } = useDualSync<ChipRead>({
    firestoreQuery: query(collection(db, 'chipReads'), where('raceId', '==', race.id)),
    lanEndpoint: '/api/chip-reads',
    lanResponseKey: 'chipReads',
    getId: (r) => r.id,
    getUpdatedAt: (r) => r.createdAt,
  });
  const { pendingCount: pendingScanCount, enqueue: enqueueScan } = useOfflineScanQueue(race.id);

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[]>([]);
  const [runnerProfilesError, setRunnerProfilesError] = useState('');
  useEffect(() => {
    const q = query(collection(db, 'runners'), where('raceId', '==', race.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
      setRunnerProfiles(list);
      setRunnerProfilesError('');
    }, (error) => {
      console.warn('Runner profiles listener failed:', error.message);
      setRunnerProfilesError(error.message);
    });
    return () => unsubscribe();
  }, [race.id]);

  const results = useMemo(
    () => computeResults(race.checkpoints, chipReads, runnerProfiles, race.ageCategories || []),
    [race.ageCategories, race.checkpoints, chipReads, runnerProfiles]
  );

  const checkpointLabel = (id: string) => orderedCheckpoints.find((c) => c.id === id)?.label || id;
  const checkInCount = checkInCheckpoint ? new Set(chipReads.filter((read) => read.checkpointId === checkInCheckpoint.id).map((read) => read.bibNumber)).size : 0;
  const finishedCount = results.filter((result) => !!result.finishTime).length;
  const publicLeaders = useMemo<PublicLeaderboardEntry[]>(() => {
    const divisions = [...new Set(results.filter((result) => result.finishTime && result.rank).map((result) => runnerDivisionLabel(result.runnerProfile)))];
    return divisions.flatMap((division) => results
      .filter((result) => runnerDivisionLabel(result.runnerProfile) === division && result.finishTime && result.rank)
      .slice(0, 5)
      .map((result) => ({
        bibNumber: result.bibNumber,
        fullName: result.runnerProfile?.fullName || `Bib ${result.bibNumber}`,
        distance: division,
        rank: result.rank!,
        overallRank: result.overallRank ?? result.rank,
        ...(result.categoryRank ? { categoryRank: result.categoryRank } : {}),
        ...(result.categoryLabel ? { categoryLabel: result.categoryLabel } : {}),
        finishTime: result.finishTime!,
      })));
  }, [results]);
  const publicOfficialResults = useMemo<PublicLeaderboardEntry[]>(() => results
    .filter((result) => result.finishTime && result.rank)
    .map((result) => ({
      bibNumber: result.bibNumber,
      fullName: result.runnerProfile?.fullName || `Bib ${result.bibNumber}`,
        distance: runnerDivisionLabel(result.runnerProfile),
        rank: result.rank!,
        overallRank: result.overallRank ?? result.rank,
        ...(result.categoryRank ? { categoryRank: result.categoryRank } : {}),
        ...(result.categoryLabel ? { categoryLabel: result.categoryLabel } : {}),
        finishTime: result.finishTime!,
    }))
    .sort((a, b) => a.distance.localeCompare(b.distance) || a.rank - b.rank), [results]);

  // The operator normally stays on this screen during the race. Publish only
  // this compact, public-safe scoreboard after each scan; raw chip reads stay
  // inside their protected collection and are never queried by spectators.
  useEffect(() => {
    if (!race.liveBroadcastEnabled) return;
    const timeout = window.setTimeout(() => {
      const hasWaveStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
      const summary: PublicLiveResults = {
        raceId: race.id,
        raceName: race.name,
        updatedAt: new Date().toISOString(),
        status: finishedCount > 0 && finishedCount === runnerProfiles.length ? 'completed' : hasWaveStarted ? 'live' : 'upcoming',
        totalRegistered: runnerProfiles.length,
        totalStarted: new Set(chipReads.filter((read) => read.checkpointId === startCheckpoint?.id).map((read) => read.bibNumber)).size,
        totalFinished: finishedCount,
        leaders: publicLeaders,
        officialResults: publicOfficialResults,
      };
      setDoc(doc(db, 'liveResults', race.id), summary).catch((error) => {
        console.warn('Public live leaderboard publish skipped:', error.message);
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [chipReads, finishedCount, publicLeaders, publicOfficialResults, race, runnerProfiles.length, startCheckpoint?.id]);

  const actionLabel = selectedCheckpointType === 'checkin'
    ? 'Check In Runner'
    : selectedCheckpointType === 'start'
      ? 'Record Start'
      : selectedCheckpointType === 'finish'
        ? 'Record Finish'
        : 'Record Split';
  const stationName = selectedCheckpointType === 'checkin'
    ? 'Check-in'
    : selectedCheckpointType === 'start'
      ? 'Start'
      : selectedCheckpointType === 'finish'
        ? 'Finish'
        : checkpointLabel(selectedCheckpointId);
  const requiresArmingConfirmation = selectedCheckpointType === 'start' || selectedCheckpointType === 'finish';

  const armAutomaticScanner = () => {
    if (requiresArmingConfirmation && !window.confirm(`Arm RFID ${stationName}? Any assigned tag read from this moment will be recorded as ${stationName}.`)) {
      return;
    }
    setScannerArmed(true);
    setFeedback({ type: 'success', text: `RFID ${stationName} scanner armed. Assigned chips will now record automatically.` });
  };

  const pauseAutomaticScanner = () => {
    setScannerArmed(false);
    setFeedback({ type: 'warning', text: `RFID ${stationName} scanner paused. Manual bib entry and camera scanning remain available.` });
  };

  // Moving to another station always pauses automatic RFID input. This makes
  // an operator explicitly arm the next station at the intended race moment.
  useEffect(() => {
    setScannerArmed(false);
  }, [mode, selectedCheckpointId]);

  useEffect(() => {
    if (!armStartOnEnter || mode !== 'record' || selectedCheckpointType !== 'start') return;
    setScannerArmed(true);
    setArmStartOnEnter(false);
    setFeedback({ type: 'success', text: 'Official gun time saved. Start RFID scanner is armed and ready for runner chips.' });
  }, [armStartOnEnter, mode, selectedCheckpointType]);

  // Keep a keyboard-wedge RFID reader ready after every scan. This also makes
  // the manual fallback quick: operators can simply type a known bib and Enter.
  useEffect(() => {
    if (mode === 'record') scanInputRef.current?.focus();
  }, [mode, selectedCheckpointId]);

  const openStartScanner = (distance: string) => {
    if (!startCheckpoint) {
      setFeedback({ type: 'error', text: 'This race has no Start checkpoint configured yet.' });
      return;
    }
    setBibInput('');
    setArmStartOnEnter(true);
    setSelectedCheckpointId(startCheckpoint.id);
    setMode('record');
    setFeedback({ type: 'success', text: `${distance} gun started. Opening and arming the Start RFID station…` });
  };

  const submitRead = async (scanRaw: string, overrideTimestamp?: string) => {
    if (!selectedCheckpointId || !selectedCheckpoint) {
      setFeedback({ type: 'error', text: 'Select a checkpoint first.' });
      return false;
    }
    const scannedValue = normalizeScanValue(scanRaw);
    if (!scannedValue) {
      setFeedback({ type: 'error', text: 'Scan an RFID chip or enter a bib number.' });
      return false;
    }

    // A scan can be either the tag EPC/chip ID (normal race-day path) or a
    // registered bib number (safe manual fallback). Unknown IDs are rejected
    // rather than creating a result for the wrong runner.
    const matchedRunner = runnerProfiles.find((runner) =>
      normalizeScanValue(runner.chipId || '') === scannedValue
      || normalizeScanValue(runner.bibNumber) === scannedValue
    );
    if (!matchedRunner) {
      setFeedback({ type: 'error', text: `No assigned runner matches "${scannedValue}". Assign the chip first, or check the bib.` });
      setBibInput('');
      scanInputRef.current?.focus();
      return false;
    }

    const scannedChip = !!matchedRunner.chipId && normalizeScanValue(matchedRunner.chipId) === scannedValue;
    const bibNumber = matchedRunner.bibNumber;
    // Each distance may leave at a different time. A legacy/shared gun time
    // remains the fallback so older races still work exactly as before.
    const waveStartTime = getWaveStartTime(race, matchedRunner.distance);
    const cutoffDeadline = selectedCheckpoint.cutoffMinutes && waveStartTime
      ? new Date(new Date(waveStartTime).getTime() + selectedCheckpoint.cutoffMinutes * 60_000)
      : undefined;
    const scanKey = `${bibNumber}_${selectedCheckpointId}`;
    const nowMs = Date.now();
    const lastScan = lastRecordedScanRef.current;
    // UHF readers can report the same tag several times while it remains in
    // range. Ignore immediate repeats, but allow legitimate later lap reads.
    if (lastScan?.key === scanKey && nowMs - lastScan.at < 4000) {
      setFeedback({ type: 'warning', text: `Duplicate scan: bib #${bibNumber} was just recorded at ${checkpointLabel(selectedCheckpointId)}. No new read was saved.` });
      setBibInput('');
      scanInputRef.current?.focus();
      return false;
    }

    // Check-in, Start and Finish are one-time stations. Unlike intermediate
    // lap splits, a later duplicate here would only create operator confusion,
    // so stop it and show exactly when the first valid read was recorded.
    const priorRead = chipReads.find((read) => read.bibNumber === bibNumber && read.checkpointId === selectedCheckpointId);
    if (priorRead && ['checkin', 'start', 'finish'].includes(selectedCheckpointType)) {
      setFeedback({ type: 'warning', text: `Duplicate scan: bib #${bibNumber} already has a ${checkpointLabel(selectedCheckpointId)} record at ${new Date(priorRead.timestamp).toLocaleTimeString()}. No new read was saved.` });
      setBibInput('');
      scanInputRef.current?.focus();
      return false;
    }

    setRecording(true);
    setFeedback(null);
    try {
      const nowIso = new Date().toISOString();
      const recordedTimestamp = overrideTimestamp || nowIso;
      const lateForCutoff = !!cutoffDeadline && new Date(recordedTimestamp).getTime() > cutoffDeadline.getTime();
      const readId = `${race.id}_${bibNumber}_${selectedCheckpointId}_${Date.now()}`;
      const record: ChipRead = {
        id: readId,
        raceId: race.id,
        bibNumber,
        ...(scannedChip ? { chipId: matchedRunner.chipId } : {}),
        checkpointId: selectedCheckpointId,
        timestamp: recordedTimestamp,
        source: scannedChip ? 'rfid-bridge' : 'manual',
        recordedBy: uid,
        createdAt: nowIso,
      };

      // Persist locally first, then sync in the background. This keeps the
      // station fast even when mobile data drops or the cloud is unreachable.
      enqueueScan(record);

      lastRecordedScanRef.current = { key: scanKey, at: nowMs };
      const queuedOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      setFeedback({ type: 'success', text: `${queuedOffline ? 'Saved to device queue' : 'Recorded'} ${matchedRunner.fullName} • bib ${bibNumber} @ ${checkpointLabel(selectedCheckpointId)}${lateForCutoff ? ' • AFTER CUTOFF' : ''}` });
      announceSuccessfulScan();
      setBibInput('');
      scanInputRef.current?.focus();
      return true;
    } finally {
      setRecording(false);
    }
  };

  // The reader bridge sends raw EPC sightings to the local RacePulse server.
  // Start from "now" each time the operator opens or changes a station, so a
  // tag seen while another station was selected is never recorded incorrectly.
  useEffect(() => {
    submitReadRef.current = submitRead;
  }, [submitRead]);

  useEffect(() => {
    if (mode !== 'record' || !selectedCheckpointId || !scannerArmed) {
      setBridgeEndpointReady(false);
      return;
    }

    let active = true;
    let polling = false;
    let after = new Date().toISOString();
    setBridgeEndpointReady(false);

    const pollBridge = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/rfid-events?after=${encodeURIComponent(after)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as { events?: RfidBridgeEvent[] };
        if (!active) return;
        setBridgeEndpointReady(true);

        for (const event of payload.events || []) {
          const cursor = event.receivedAt || event.timestamp;
          if (cursor && Date.parse(cursor) >= Date.parse(after)) after = cursor;
          if (processedBridgeEventsRef.current.has(event.id)) continue;
          processedBridgeEventsRef.current.add(event.id);
          await submitReadRef.current(event.epc, event.timestamp);
        }
      } catch {
        if (active) setBridgeEndpointReady(false);
      } finally {
        polling = false;
      }
    };

    void pollBridge();
    const interval = window.setInterval(() => { void pollBridge(); }, 450);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [mode, selectedCheckpointId, scannerArmed]);

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
      <div className="flex flex-wrap items-center justify-between gap-3 glass-panel px-4 py-3">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display uppercase">{race.name}</span>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{orderedCheckpoints.length} checkpoints &bull; {results.length} runners with recorded splits</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveClock gunStartTime={race.gunStartTime} />
          <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border ${lanConnected ? 'bg-green-500/10 border-green-500/25 text-green-500' : 'bg-rose-500/10 border-rose-500/25 text-rose-500'}`}>
            {lanConnected ? <><Wifi className="w-3 h-3" /> LAN Sync Linked</> : <><WifiOff className="w-3 h-3" /> Standalone Mode</>}
          </span>
          {mode === 'record' && bridgeEndpointReady && (
            <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border bg-cyan-500/10 border-cyan-500/25 text-cyan-400">
              <Radio className="w-3 h-3" /> RFID Bridge Ready
            </span>
          )}
          {pendingScanCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border bg-amber-500/10 border-amber-500/30 text-amber-500">
              <RefreshCw className="w-3 h-3 animate-spin" /> {pendingScanCount} scan{pendingScanCount === 1 ? '' : 's'} queued
            </span>
          )}
        </div>
      </div>

      {runnerProfilesError && (
        <p className="text-xs font-semibold text-red-500 glass-inset px-4 py-2.5">
          ⚠️ Couldn't load registered runners: {runnerProfilesError}
        </p>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 glass-inset p-1.5 w-max max-w-full">
        <button
          onClick={() => setMode('record')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'record' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Radio className="w-3.5 h-3.5" /> Record Splits
        </button>
        <button
          onClick={() => setMode('assign')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'assign' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Cpu className="w-3.5 h-3.5" /> Assign Chips
        </button>
        <button
          onClick={() => setMode('roster')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'roster' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Users2 className="w-3.5 h-3.5" /> Roster
        </button>
        <button
          onClick={() => setMode('rankings')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'rankings' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Trophy className="w-3.5 h-3.5" /> Rankings
        </button>
        <button
          onClick={() => setMode('rollcall')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'rollcall' ? 'bg-red-600 text-white shadow-lg shadow-red-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <ListChecks className="w-3.5 h-3.5" /> Start Roll Call
        </button>
      </div>

      {mode === 'assign' && <ChipAssignmentPanel race={race} runnerProfiles={runnerProfiles} chipReads={chipReads} />}
      {mode === 'roster' && <RunnerRosterPanel race={race} runnerProfiles={runnerProfiles} />}
      {mode === 'rankings' && <RaceRankingsPanel race={race} results={results} />}
      {mode === 'rollcall' && (
        <StartRollCallPanel
          race={race}
          runnerProfiles={runnerProfiles}
          chipReads={chipReads}
          startCheckpointId={startCheckpoint?.id}
          onOpenStartScanner={openStartScanner}
        />
      )}

      {mode === 'record' && (
      <>
      {/* Recording console */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-500" /> {selectedCheckpointType === 'checkin' ? 'Runner Check-In' : 'Live RFID Checkpoint'}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {selectedCheckpointType === 'checkin'
                ? 'Check in every runner before the gun. Check-in records attendance only and does not start their race time.'
                : 'Scan an assigned RFID chip. Typing a registered bib remains available as backup.'}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-black tracking-widest uppercase px-2.5 py-1.5 rounded-full border ${scannerArmed ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500' : 'bg-amber-500/10 border-amber-500/30 text-amber-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${scannerArmed ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} /> {scannerArmed ? 'RFID Scanner Armed' : 'RFID Scanner Paused'}
          </span>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Day Station</label>
          <div className="flex flex-wrap gap-2">
            {orderedCheckpoints.map((cp, index) => {
              const phase = checkpointType(cp, index, orderedCheckpoints.length);
              const phaseLabel = phase === 'checkin' ? 'Check-In' : phase === 'start' ? 'Start' : phase === 'finish' ? 'Finish' : cp.cutoffMinutes ? `Cutoff ${cp.cutoffMinutes}m` : 'Split';
              return (
              <button
                key={cp.id}
                onClick={() => { setSelectedCheckpointId(cp.id); setScannerArmed(false); setFeedback(null); }}
                className={`text-xs font-bold uppercase tracking-wide px-3.5 py-2 rounded-[16px] border transition ${selectedCheckpointId === cp.id ? 'bg-red-600 border-red-600 text-white shadow-lg shadow-red-900/30' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                <span>{cp.label}</span><span className="opacity-70 text-[9px] ml-1">{phaseLabel}</span>
              </button>
              );
            })}
          </div>
        </div>

        {(selectedCheckpointType === 'checkin' || selectedCheckpoint?.cutoffMinutes) && (
          <div className={`glass-inset px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${selectedCheckpoint?.cutoffMinutes ? 'border-amber-500/30' : ''}`}>
            {selectedCheckpointType === 'checkin' && <span className="font-bold text-[var(--text-primary)]">{checkInCount} / {runnerProfiles.length} runners checked in</span>}
            {selectedCheckpoint?.cutoffMinutes && <span className="font-bold text-amber-500">Cutoff: {selectedCheckpoint.cutoffMinutes} min after each runner's distance wave start</span>}
          </div>
        )}

        <div className={`rounded-[16px] border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${scannerArmed ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <div className="flex items-start gap-2.5">
            {scannerArmed ? <Radio className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> : <Circle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
            <div>
              <p className={`text-xs font-black uppercase tracking-wide ${scannerArmed ? 'text-emerald-500' : 'text-amber-500'}`}>
                {scannerArmed ? `RFID ${stationName} is armed` : `RFID ${stationName} is paused`}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {scannerArmed
                  ? 'Live tag reads from the bridge will record at this station. Pause it before changing station or moving the carpet.'
                  : 'Nearby chips are ignored until you arm this station. Manual bib entry and camera scan still work.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={scannerArmed ? pauseAutomaticScanner : armAutomaticScanner}
            className={`min-h-11 shrink-0 px-5 py-3 rounded-[14px] text-xs font-black uppercase tracking-widest transition active:scale-[0.98] ${scannerArmed ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/25'}`}
          >
            {scannerArmed ? 'Pause RFID Scanner' : `Arm ${stationName}`}
          </button>
        </div>

        {pendingScanCount > 0 && (
          <div className="px-4 py-3 rounded-[14px] border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 flex items-start gap-2">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
            <span><strong>{pendingScanCount} scan{pendingScanCount === 1 ? '' : 's'} safely stored on this device.</strong> Keep scanning—RacePulsePH will automatically sync them when the internet reconnects.</span>
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <input
            ref={scanInputRef}
            type="text"
            placeholder="SCAN RFID CHIP OR TYPE BIB"
            value={bibInput}
            onChange={(e) => setBibInput(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="RFID chip or runner bib scan input"
            className="min-h-[68px] glass-inset px-5 py-4 text-base sm:text-lg font-black font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
          <button
            type="submit"
            disabled={recording}
            className="min-h-[68px] text-sm font-black uppercase tracking-widest px-7 py-4 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-xl shadow-red-900/40 flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-60"
          >
            {recording ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Clock className="w-5 h-5" />} {actionLabel}
          </button>
          <button
            type="button"
            onClick={() => { setFeedback(null); setShowScanModal(true); }}
            className="min-h-[68px] text-sm font-black uppercase tracking-widest px-7 py-4 rounded-[var(--radius-control)] bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-950/30 flex items-center justify-center gap-2 transition active:scale-[0.98]"
          >
            <QrCode className="w-5 h-5" /> Camera Scan
          </button>
        </form>

        {feedback && (
          <p role="status" className={`text-xs sm:text-sm font-bold px-4 py-3 rounded-[14px] border ${feedback.type === 'success' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' : feedback.type === 'warning' ? 'text-amber-500 bg-amber-500/10 border-amber-500/30' : 'text-red-500 bg-red-500/10 border-red-500/25'}`}>
            {feedback.type === 'success' ? '✓ Scan saved' : feedback.type === 'warning' ? '⚠ Duplicate warning' : '⚠ Scan issue'} <span className="font-medium">— {feedback.text}</span>
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
                <span className="font-mono font-bold text-[var(--text-primary)] flex items-center gap-1.5"><span>#{r.bibNumber}</span>{r.source === 'rfid-bridge' && <Cpu className="w-3 h-3 text-emerald-500" aria-label="RFID scan" />}</span>
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
      </>
      )}
    </div>
  );
}

// ========== CHIP ASSIGNMENT ==========

type ImportedRunner = Pick<RunnerProfile, 'fullName' | 'bibNumber' | 'distance' | 'gender' | 'age' | 'shirtSize' | 'entryCategory' | 'teamMembers'> & {
  source: string;
  sourceRows: number[];
};

interface RosterImportPreview {
  fileName: string;
  detectedSheets: string[];
  runners: ImportedRunner[];
  skipped: string[];
  combinedTeams: number;
}

function spreadsheetText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '').trim();
}

function spreadsheetHeader(value: unknown): string {
  return spreadsheetText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function headerIndex(headers: unknown[], candidates: string[]): number {
  const normalized = headers.map(spreadsheetHeader);
  return normalized.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

function normalizeImportBib(value: unknown): string {
  return spreadsheetText(value).replace(/^#\s*/, '').replace(/\s+/g, '').toUpperCase();
}

function importGender(value: unknown): RunnerProfile['gender'] | null {
  const normalized = spreadsheetText(value).toLowerCase();
  if (normalized.startsWith('m')) return 'male';
  if (normalized.startsWith('f')) return 'female';
  return null;
}

function importEntryCategory(value: unknown): RaceEntryCategory {
  const category = spreadsheetText(value).toLowerCase();
  if (category.includes('trio')) return 'trio';
  if (category.includes('duo') || category.includes('pair')) return 'duo';
  return 'solo';
}

function ageFromSpreadsheetValue(value: unknown): number | null {
  const text = spreadsheetText(value);
  const directAge = Number.parseInt(text, 10);
  // Do not let an invalid numeric age such as 0 turn into a JavaScript date.
  if (/^\d{1,3}$/.test(text)) return directAge >= 1 && directAge <= 120 ? directAge : null;

  const birthDate = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (today < birthdayThisYear) age -= 1;
  return age >= 1 && age <= 120 ? age : null;
}

function matchImportDistance(value: unknown, race: Race): string | null {
  const source = spreadsheetText(value).toUpperCase().replace(/\s+/g, '');
  if (!source) return null;
  const exact = race.distances.find((distance) => distance.label.toUpperCase().replace(/\s+/g, '') === source);
  if (exact) return exact.label;

  const numeric = Number.parseFloat(source.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const matchingKm = race.distances.find((distance) => Math.abs(distance.km - numeric) < 0.15);
  return matchingKm?.label || null;
}

function parseRosterWorkbook(workbook: XLSX.WorkBook, fileName: string, race: Race): RosterImportPreview {
  const rowsByBib = new Map<string, ImportedRunner>();
  const detectedSheets: string[] = [];
  const skipped: string[] = [];
  let combinedTeams = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const headers = rows[0] || [];
    const nameColumn = headerIndex(headers, ['fullname', 'runnername', 'participantname', 'name']);
    const bibColumn = headerIndex(headers, ['racebibnumber', 'bibnumber', 'racebib', 'bib']);
    const distanceColumn = headerIndex(headers, ['distance', 'racedistance', 'categorydistance']);
    const categoryColumn = headerIndex(headers, ['entrycategory', 'teamcategory', 'category']);
    const genderColumn = headerIndex(headers, ['sex', 'gender']);
    const ageColumn = headerIndex(headers, ['age']);
    const dateOfBirthColumn = headerIndex(headers, ['dateofbirth', 'birthdate', 'dob']);
    const shirtSizeColumn = headerIndex(headers, ['shirtsize', 'shirttsize', 'apparelsize', 'size']);

    // We intentionally use only the already-prepared "bib assignment" tabs.
    // A raw Google Form export can contain several participant columns but no
    // physical bibs yet, so importing it directly would create unsafe records.
    if (nameColumn < 0 || bibColumn < 0 || distanceColumn < 0) continue;
    detectedSheets.push(sheetName);

    rows.slice(1).forEach((row, index) => {
      const sourceRow = index + 2;
      const fullName = spreadsheetText(row[nameColumn]);
      const bibNumber = normalizeImportBib(row[bibColumn]);
      const distance = matchImportDistance(row[distanceColumn], race);
      const entryCategory = importEntryCategory(categoryColumn >= 0 ? row[categoryColumn] : '');
      const gender = importGender(genderColumn >= 0 ? row[genderColumn] : '');
      const age = ageFromSpreadsheetValue(ageColumn >= 0 ? row[ageColumn] : '')
        ?? ageFromSpreadsheetValue(dateOfBirthColumn >= 0 ? row[dateOfBirthColumn] : '');
      const shirtSize = shirtSizeColumn >= 0 ? spreadsheetText(row[shirtSizeColumn]).toUpperCase() : '';

      if (!fullName && !bibNumber) return;
      if (!fullName || !bibNumber || !distance || !gender || age === null) {
        const missing = [
          !fullName && 'name',
          !bibNumber && 'bib',
          !distance && 'a matching race distance',
          !gender && 'sex/gender',
          age === null && 'valid age or date of birth',
        ].filter(Boolean).join(', ');
        skipped.push(`${sheetName} row ${sourceRow}: missing ${missing}`);
        return;
      }

      const key = `${distance}|${bibNumber}`;
      const existing = rowsByBib.get(key);
      if (existing) {
        // Duo/team sheets have two people under one physical bib. RacePulse
        // needs exactly one timing record per chip/bib, so retain one entry
        // with both names rather than introducing an ambiguous duplicate.
        const names = existing.fullName.split(' & ');
        if (!names.includes(fullName)) existing.fullName = `${existing.fullName} & ${fullName}`;
        existing.teamMembers = [...(existing.teamMembers || names), fullName].filter((name, memberIndex, list) => list.indexOf(name) === memberIndex);
        existing.sourceRows.push(sourceRow);
        combinedTeams += 1;
        return;
      }

      rowsByBib.set(key, {
        fullName,
        bibNumber,
        distance,
        entryCategory,
        gender,
        age,
        ...(entryCategory !== 'solo' ? { teamMembers: [fullName] } : {}),
        ...(shirtSize ? { shirtSize } : {}),
        source: sheetName,
        sourceRows: [sourceRow],
      });
    });
  }

  return {
    fileName,
    detectedSheets,
    runners: [...rowsByBib.values()].sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true })),
    skipped,
    combinedTeams,
  };
}

function importedRunnerUid(): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `import_${randomPart}`;
}

interface ManualRunnerPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

// A small desk-registration form for late entries, corrections from paper
// forms, and runners who were not included in the uploaded roster. These are
// timing-only registrations: they deliberately do not create Firebase Auth
// accounts or send login emails.
function ManualRunnerPanel({ race, runnerProfiles }: ManualRunnerPanelProps) {
  const categories = raceEntryCategories(race);
  const [fullName, setFullName] = useState('');
  const [bibNumber, setBibNumber] = useState('');
  const [distance, setDistance] = useState(race.distances[0]?.label || '');
  const [entryCategory, setEntryCategory] = useState<RaceEntryCategory>(categories[0] || 'solo');
  const [gender, setGender] = useState<RunnerProfile['gender']>('male');
  const [age, setAge] = useState('');
  const [shirtSize, setShirtSize] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>(['', '', '']);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!categories.includes(entryCategory)) setEntryCategory(categories[0] || 'solo');
  }, [categories, entryCategory]);

  const memberCount = entryMemberCount[entryCategory];

  const updateMember = (index: number, value: string) => {
    setTeamMembers((current) => current.map((member, memberIndex) => memberIndex === index ? value : member));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedBib = normalizeImportBib(bibNumber);
    const normalizedName = fullName.trim().toUpperCase();
    const parsedAge = Number.parseInt(age, 10);

    if (!normalizedBib || !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(normalizedBib)) {
      setFeedback({ type: 'error', text: 'Use a bib with 1–20 letters, numbers, hyphens, or underscores.' });
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
      setFeedback({ type: 'error', text: 'Enter the team name for a Duo or Trio.' });
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
        // For a shared bib, the team name is the display name used in the
        // roster and official timing result; individual names stay in
        // teamMembers for the organizer's reference.
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
      setFeedback({ type: 'success', text: `${entryCategory === 'solo' ? normalizedName : normalizedTeamName} added to ${distance} ${entryCategoryLabels[entryCategory]} with bib #${normalizedBib}.` });
      setFullName('');
      setBibNumber('');
      setAge('');
      setShirtSize('');
      setTeamName('');
      setTeamMembers(['', '', '']);
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not add the runner.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel p-5 space-y-4">
      <div>
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
          <Users2 className="w-4 h-4 text-red-500" /> Add Runner Manually
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">For late registrations or paper-form entries. This adds a race roster entry only—no login account is created.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">{entryCategory === 'solo' ? 'Runner name' : 'Team representative / member 1'}</label>
          <input required value={fullName} onChange={(event) => setFullName(event.target.value.toUpperCase())} placeholder="FULL NAME" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race bib number</label>
          <input required value={bibNumber} onChange={(event) => setBibNumber(event.target.value.toUpperCase())} placeholder="EX: 10-001" className="w-full glass-inset px-4 py-3 text-sm font-bold font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Distance</label>
          <select value={distance} onChange={(event) => setDistance(event.target.value)} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
            {race.distances.map((raceDistance) => <option key={raceDistance.id} value={raceDistance.label}>{raceDistance.label}</option>)}
          </select>
        </div>
        {categories.length > 1 && (
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Entry category</label>
            <select value={entryCategory} onChange={(event) => setEntryCategory(event.target.value as RaceEntryCategory)} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
              {categories.map((category) => <option key={category} value={category}>{entryCategoryLabels[category]}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Gender</label>
          <select value={gender} onChange={(event) => setGender(event.target.value as RunnerProfile['gender'])} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Age</label>
          <input required type="number" min="1" max="120" value={age} onChange={(event) => setAge(event.target.value)} placeholder="AGE" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shirt size <span className="normal-case font-medium">(optional)</span></label>
          <input value={shirtSize} onChange={(event) => setShirtSize(event.target.value.toUpperCase())} placeholder="EX: M, 2XL" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
        </div>

        {entryCategory !== 'solo' && (
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-[14px] border border-violet-500/20 bg-violet-500/5 p-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-wider text-violet-300 mb-1.5">Team name</label>
              <input required value={teamName} onChange={(event) => setTeamName(event.target.value.toUpperCase())} placeholder="EX: TEAM RACEPULSE" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
            </div>
            {Array.from({ length: memberCount - 1 }).map((_, index) => (
              <div key={index}>
                <label className="block text-[10px] font-black uppercase tracking-wider text-violet-300 mb-1.5">Member {index + 2}</label>
                <input required value={teamMembers[index + 1] || ''} onChange={(event) => updateMember(index + 1, event.target.value.toUpperCase())} placeholder={`MEMBER ${index + 2} NAME`} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
              </div>
            ))}
          </div>
        )}

        <button type="submit" disabled={saving} className="sm:col-span-2 w-full text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 flex items-center justify-center gap-2 transition disabled:opacity-60">
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />} {saving ? 'Adding runner…' : 'Add runner to roster'}
        </button>
      </form>
      {feedback && <p className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>{feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}</p>}
    </div>
  );
}

interface RosterImportPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

function RosterImportPanel({ race, runnerProfiles }: RosterImportPanelProps) {
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

    const supported = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!supported) {
      setFeedback({ type: 'error', text: 'Choose an Excel (.xlsx/.xls) or CSV file.' });
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const parsed = parseRosterWorkbook(workbook, file.name, race);
      if (parsed.detectedSheets.length === 0) {
        setFeedback({ type: 'error', text: 'No importable roster tab found. The file needs Full name, Race bib number, Distance, Sex/Gender, and Age or Date of birth columns.' });
        return;
      }
      if (parsed.runners.length === 0) {
        setFeedback({ type: 'error', text: `No complete runners found. Check the ${parsed.skipped.length} rows flagged by the importer.` });
      }
      setPreview(parsed);
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not read this file.' });
    }
  };

  const handleImport = async () => {
    if (!preview || preview.runners.length === 0) return;
    const existingByBib = new Map(runnerProfiles.map((runner) => [normalizeImportBib(runner.bibNumber), runner]));
    const existingCount = preview.runners.filter((runner) => existingByBib.has(normalizeImportBib(runner.bibNumber))).length;
    const newCount = preview.runners.length - existingCount;
    if (!window.confirm(`Import ${preview.runners.length} roster entries into ${race.name}?\n\n${newCount} new runner${newCount === 1 ? '' : 's'} will be created and ${existingCount} matching bib${existingCount === 1 ? '' : 's'} will be updated. This does not create login accounts.`)) return;

    setImporting(true);
    setFeedback(null);
    try {
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;

      // Firestore accepts at most 500 writes per batch. Keeping this at 400
      // leaves a safe margin for larger race-day imports.
      for (let start = 0; start < preview.runners.length; start += 400) {
        const batch = writeBatch(db);
        for (const imported of preview.runners.slice(start, start + 400)) {
          const existing = existingByBib.get(normalizeImportBib(imported.bibNumber));
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
            createdAt: existing?.createdAt || now,
            ...(imported.shirtSize ? { shirtSize: imported.shirtSize } : {}),
            ...(imported.teamMembers && imported.teamMembers.length >= (imported.entryCategory === 'trio' ? 3 : 2) ? { teamMembers: imported.teamMembers } : {}),
          };
          batch.set(doc(db, 'runners', `${uid}_${race.id}`), record, { merge: true });
          if (existing) updated += 1;
          else created += 1;
        }
        await batch.commit();
      }
      setFeedback({ type: 'success', text: `Import complete — ${created} created, ${updated} updated. Open the roster below to assign timing chips.` });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not import the runner roster.' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <FileUp className="w-4 h-4 text-red-500" /> Import Runner Roster
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Upload a prepared bib-assignment Excel or CSV file. We import only roster fields, never payment links or proof-of-payment files.</p>
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="shrink-0 px-4 py-2.5 rounded-[var(--radius-control)] bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest transition flex items-center justify-center gap-2">
          <FileUp className="w-4 h-4" /> Choose File
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
      </div>

      <div className="rounded-[14px] border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[10.5px] text-[var(--text-secondary)] leading-relaxed">
        Required columns: <strong className="text-[var(--text-primary)]">Full name, Race bib number, Distance, Sex/Gender</strong>, and <strong className="text-[var(--text-primary)]">Age or Date of birth</strong>. The distance must already exist in this race. For a duo/team sharing one bib, the names are combined into one timing entry.
      </div>

      {preview && (
        <div className="glass-inset p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[18rem]">{preview.fileName}</p>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Tabs: {preview.detectedSheets.join(', ')}</p>
            </div>
            <span className="text-[10px] font-mono font-black text-emerald-500">{preview.runners.length} READY</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-[var(--surface-hover)] px-2 py-2"><p className="text-lg font-display font-black text-[var(--text-primary)]">{preview.runners.length}</p><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Runners</p></div>
            <div className="rounded-xl bg-[var(--surface-hover)] px-2 py-2"><p className="text-lg font-display font-black text-[var(--text-primary)]">{preview.combinedTeams}</p><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Team rows combined</p></div>
            <div className="rounded-xl bg-[var(--surface-hover)] px-2 py-2"><p className="text-lg font-display font-black text-[var(--text-primary)]">{preview.skipped.length}</p><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Rows skipped</p></div>
            <div className="rounded-xl bg-[var(--surface-hover)] px-2 py-2"><p className="text-lg font-display font-black text-[var(--text-primary)]">{runnerProfiles.length}</p><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Already in roster</p></div>
          </div>
          {preview.skipped.length > 0 && <p className="text-[10px] text-amber-500">Review required: {preview.skipped.slice(0, 3).join(' • ')}{preview.skipped.length > 3 ? ` • +${preview.skipped.length - 3} more` : ''}</p>}
          <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
            {preview.runners.slice(0, 10).map((runner) => <div key={`${runner.distance}-${runner.bibNumber}`} className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]"><span className="font-mono font-bold text-[var(--text-primary)] w-16">#{runner.bibNumber}</span><span className="truncate flex-1">{runner.fullName}</span><span>{runner.distance}</span></div>)}
            {preview.runners.length > 10 && <p className="text-[10px] text-[var(--text-muted)]">+ {preview.runners.length - 10} more runners</p>}
          </div>
          <button type="button" onClick={handleImport} disabled={importing || preview.runners.length === 0} className="w-full text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 flex items-center justify-center gap-2 transition disabled:opacity-60">
            {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users2 className="w-4 h-4" />} {importing ? 'Importing roster…' : `Import ${preview.runners.length} runners`}
          </button>
        </div>
      )}

      {feedback && <p className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>{feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}</p>}
    </div>
  );
}

interface ChipAssignmentPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
  chipReads: ChipRead[];
}

function ChipAssignmentPanel({ race, runnerProfiles, chipReads }: ChipAssignmentPanelProps) {
  const [bibInput, setBibInput] = useState('');
  const [chipInput, setChipInput] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<'unassigned' | 'assigned' | 'all'>('unassigned');
  const [editingBib, setEditingBib] = useState(false);
  const [nextBib, setNextBib] = useState('');
  const [showBibScanner, setShowBibScanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const bibInputRef = useRef<HTMLInputElement>(null);
  const chipInputRef = useRef<HTMLInputElement>(null);

  const foundRunner = useMemo(
    () => runnerProfiles.find((r) => normalizeScanValue(r.bibNumber) === normalizeScanValue(bibInput)),
    [runnerProfiles, bibInput]
  );

  useEffect(() => {
    if (foundRunner) chipInputRef.current?.focus();
  }, [foundRunner]);

  const selectRunner = (r: RunnerProfile) => {
    setFeedback(null);
    setChipInput('');
    setBibInput(r.bibNumber);
    setNextBib(r.bibNumber);
    setEditingBib(false);
  };

  const assignedCount = runnerProfiles.filter((r) => r.chipId).length;
  const kitClaimedCount = runnerProfiles.filter((r) => r.kitClaimedAt).length;
  const selectedHasReads = !!foundRunner && chipReads.some((read) => read.bibNumber === foundRunner.bibNumber);

  const filteredRoster = useMemo(() => {
    const term = rosterSearch.trim().toUpperCase();
    const sorted = [...runnerProfiles].sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true }));
    return sorted.filter((r) => {
      const matchesSearch = !term || r.bibNumber.toUpperCase().includes(term) || r.fullName.toUpperCase().includes(term);
      const matchesFilter = rosterFilter === 'all' || (rosterFilter === 'assigned' ? !!r.chipId : !r.chipId);
      return matchesSearch && matchesFilter;
    });
  }, [runnerProfiles, rosterSearch, rosterFilter]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foundRunner) {
      setFeedback({ type: 'error', text: 'No runner found with that bib number.' });
      return;
    }
    const chipId = normalizeScanValue(chipInput);
    if (!chipId) {
      setFeedback({ type: 'error', text: 'Scan or type a chip ID.' });
      return;
    }

    if (normalizeScanValue(foundRunner.chipId || '') === chipId) {
      setFeedback({ type: 'success', text: `Chip "${chipId}" is already assigned to bib #${foundRunner.bibNumber}.` });
      return;
    }

    const conflict = runnerProfiles.find((r) => normalizeScanValue(r.chipId || '') === chipId && r.bibNumber !== foundRunner.bibNumber);
    if (conflict && !window.confirm(`Chip "${chipId}" is already assigned to bib #${conflict.bibNumber} (${conflict.fullName}). Reassign it to bib #${foundRunner.bibNumber} instead?`)) {
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      // Reassignment must be atomic: clearing the old runner and assigning the
      // new runner in one batch prevents one timing chip from mapping to two bibs.
      const batch = writeBatch(db);
      if (conflict) {
        batch.update(doc(db, 'runners', `${conflict.uid}_${race.id}`), { chipId: deleteField() });
      }
      batch.update(doc(db, 'runners', `${foundRunner.uid}_${race.id}`), { chipId });
      await batch.commit();
      setFeedback({ type: 'success', text: conflict
        ? `Chip "${chipId}" moved from bib #${conflict.bibNumber} to #${foundRunner.bibNumber}.`
        : `Chip "${chipId}" assigned to bib #${foundRunner.bibNumber} (${foundRunner.fullName}).` });
      setChipInput('');
      chipInputRef.current?.focus();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to assign chip.' });
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async () => {
    if (!foundRunner?.chipId) return;
    if (!window.confirm(`Remove chip "${foundRunner.chipId}" from bib #${foundRunner.bibNumber}?`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'runners', `${foundRunner.uid}_${race.id}`), { chipId: deleteField() });
      setChipInput('');
      setFeedback({ type: 'success', text: `Chip removed from bib #${foundRunner.bibNumber}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to remove chip.' });
    } finally {
      setSaving(false);
    }
  };

  const handleKitClaim = async () => {
    if (!foundRunner) return;
    const alreadyClaimed = !!foundRunner.kitClaimedAt;
    if (alreadyClaimed && !window.confirm(`Mark the kit for ${foundRunner.fullName} (bib #${foundRunner.bibNumber}) as not claimed?`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'runners', `${foundRunner.uid}_${race.id}`), {
        kitClaimedAt: alreadyClaimed ? deleteField() : new Date().toISOString(),
      });
      setFeedback({ type: 'success', text: alreadyClaimed
        ? `Kit claim removed for bib #${foundRunner.bibNumber}.`
        : `Kit claimed by ${foundRunner.fullName} • bib #${foundRunner.bibNumber}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to update kit claim.' });
    } finally {
      setSaving(false);
    }
  };

  const handleBibUpdate = async () => {
    if (!foundRunner) return;
    const newBib = normalizeScanValue(nextBib);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(newBib)) {
      setFeedback({ type: 'error', text: 'Use 1–20 letters, numbers, hyphens, or underscores for the bib.' });
      return;
    }
    if (newBib === foundRunner.bibNumber) {
      setEditingBib(false);
      return;
    }
    if (selectedHasReads) {
      setFeedback({ type: 'error', text: 'Bib numbers are locked once this runner has timing reads. Correct the read first instead.' });
      return;
    }
    const conflict = runnerProfiles.find((runner) => normalizeScanValue(runner.bibNumber) === newBib && runner.uid !== foundRunner.uid);
    if (conflict) {
      setFeedback({ type: 'error', text: `Bib #${newBib} is already assigned to ${conflict.fullName}.` });
      return;
    }
    if (!window.confirm(`Change ${foundRunner.fullName}'s bib from #${foundRunner.bibNumber} to #${newBib}?`)) return;

    setSaving(true);
    try {
      // If an operator corrects a bib to a future generated number (for example
      // 5-999), advance that distance's counter in the same transaction. This
      // keeps the next online registration from receiving the same physical bib.
      const distanceKm = race.distances.find((distance) => distance.label === foundRunner.distance)?.km;
      const generatedPrefix = distanceKm === undefined ? null : String(distanceKm);
      const generatedMatch = generatedPrefix
        ? new RegExp(`^${generatedPrefix.replace('.', '\\.')}-([0-9]+)$`).exec(newBib)
        : null;

      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'runners', `${foundRunner.uid}_${race.id}`), { bibNumber: newBib });

        if (generatedMatch) {
          const counterId = `${race.id}_${foundRunner.distance}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
          const counterRef = doc(db, 'bibCounters', counterId);
          const counterSnap = await transaction.get(counterRef);
          const currentCount = counterSnap.exists() ? Number(counterSnap.data().count || 0) : 0;
          const correctedSequence = Number(generatedMatch[1]);
          if (correctedSequence > currentCount) {
            transaction.set(counterRef, { count: correctedSequence }, { merge: true });
          }
        }
      });
      setBibInput(newBib);
      setNextBib(newBib);
      setEditingBib(false);
      setFeedback({ type: 'success', text: `Race bib updated to #${newBib}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to update race bib.' });
    } finally {
      setSaving(false);
    }
  };

  const handleBibScan = async (value: string): Promise<boolean> => {
    const parts = value.trim().split('|');
    if (parts[0] === 'RPCHIPv1') {
      if (parts[1] !== race.id) {
        setFeedback({ type: 'error', text: 'This bib QR belongs to a different race.' });
        return false;
      }
      setBibInput((parts[2] || '').toUpperCase());
    } else {
      setBibInput(value.trim().toUpperCase());
    }
    setFeedback(null);
    setShowBibScanner(false);
    return true;
  };

  return (
    <div className="space-y-6">
      <ManualRunnerPanel race={race} runnerProfiles={runnerProfiles} />
      <RosterImportPanel race={race} runnerProfiles={runnerProfiles} />

      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
              <Cpu className="w-4 h-4 text-red-500" /> Race Kit Assignment
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Select the race bib, scan its timing chip, then verify the runner before handing out the kit.</p>
          </div>
          <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] shrink-0">{kitClaimedCount} kits claimed &bull; {assignedCount} chips assigned</span>
        </div>

        <div className="h-2 rounded-full bg-[var(--surface-inset)] overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-red-600 to-emerald-500 transition-all" style={{ width: `${runnerProfiles.length ? (assignedCount / runnerProfiles.length) * 100 : 0}%` }} />
        </div>

        <form onSubmit={handleAssign} className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Bib Number</label>
            <div className="flex gap-2">
              <input
                ref={bibInputRef}
                type="text"
                placeholder="TYPE OR SCAN BIB"
                value={bibInput}
                onChange={(e) => { setBibInput(e.target.value.toUpperCase()); setFeedback(null); }}
                className="min-w-0 flex-1 glass-inset px-4 py-3 text-sm font-bold font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
              <button type="button" onClick={() => setShowBibScanner(true)} className="w-12 rounded-[var(--radius-control)] bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition" title="Scan race bib QR">
                <QrCode className="w-4 h-4" />
              </button>
            </div>
          </div>

          {bibInput.trim() && (
            foundRunner ? (
              <div className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{foundRunner.fullName}</p>
                  <p className="text-[10px] text-[var(--text-secondary)]">{foundRunner.distance} &bull; #{foundRunner.bibNumber} &bull; Shirt {foundRunner.shirtSize || 'not selected'}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full ${foundRunner.chipId ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/25' : 'bg-amber-500/10 text-amber-500 border border-amber-500/25'}`}>
                    {foundRunner.chipId ? `Chip: ${foundRunner.chipId}` : 'No Chip Yet'}
                  </span>
                  <span className={`text-[9px] font-black uppercase tracking-wide ${foundRunner.kitClaimedAt ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>
                    {foundRunner.kitClaimedAt ? 'Kit claimed' : 'Kit not claimed'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-red-500">No runner found with that bib number.</p>
            )
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Chip ID</label>
            <input
              ref={chipInputRef}
              type="text"
              placeholder="SCAN OR TYPE CHIP ID"
              value={chipInput}
              onChange={(e) => setChipInput(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              disabled={!foundRunner}
              className="w-full glass-inset px-4 py-3 text-sm font-bold font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={saving || !foundRunner}
            className="w-full text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />} Assign Chip
          </button>
        </form>

        {foundRunner && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {editingBib ? (
              <div className="sm:col-span-2 glass-inset p-3 space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Correct race bib</label>
                <div className="flex gap-2">
                  <input value={nextBib} onChange={(e) => setNextBib(e.target.value.toUpperCase())} className="min-w-0 flex-1 glass-inset px-3 py-2 text-xs font-bold font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
                  <button type="button" onClick={handleBibUpdate} disabled={saving} className="px-3 rounded-[14px] bg-red-600 text-white text-[10px] font-black uppercase tracking-wide disabled:opacity-60">Save</button>
                  <button type="button" onClick={() => { setEditingBib(false); setNextBib(foundRunner.bibNumber); }} className="px-3 rounded-[14px] glass-inset text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">Cancel</button>
                </div>
                {selectedHasReads && <p className="text-[10px] text-amber-500">Bib is locked because timing reads already exist.</p>}
              </div>
            ) : (
              <button type="button" onClick={() => setEditingBib(true)} disabled={selectedHasReads} className="glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50 transition">
                {selectedHasReads ? 'Bib locked after timing' : 'Correct race bib'}
              </button>
            )}
            {foundRunner.chipId && !editingBib && (
              <button type="button" onClick={handleUnassign} disabled={saving} className="glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50 transition">
                Remove assigned chip
              </button>
            )}
            {!editingBib && (
              <button type="button" onClick={handleKitClaim} disabled={saving} className={`glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide disabled:opacity-50 transition ${foundRunner.kitClaimedAt ? 'text-emerald-500 hover:text-red-500' : 'text-[var(--text-secondary)] hover:text-emerald-500'}`}>
                {foundRunner.kitClaimedAt ? 'Undo kit claimed' : 'Mark kit claimed'}
              </button>
            )}
          </div>
        )}

        {feedback && (
          <p className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
            {feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}
          </p>
        )}
      </div>

      <div className="glass-panel p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Chip Assignment Roster</h3>
          <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)]">{kitClaimedCount} / {runnerProfiles.length} kits claimed</span>
        </div>
        <p className="text-[10.5px] text-[var(--text-secondary)] mb-3">Unassigned runners show first. Tap one to hand out or correct a race kit.</p>
        <div className="flex gap-1.5 mb-3">
          {(['unassigned', 'assigned', 'all'] as const).map((filter) => (
            <button key={filter} type="button" onClick={() => setRosterFilter(filter)} className={`text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full transition ${rosterFilter === filter ? 'bg-red-600 text-white' : 'glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {filter}
            </button>
          ))}
        </div>
        {runnerProfiles.length > 0 && (
          <input
            type="text"
            placeholder="SEARCH BY NAME OR BIB"
            value={rosterSearch}
            onChange={(e) => setRosterSearch(e.target.value)}
            className="w-full glass-inset px-4 py-2.5 mb-3 text-xs font-bold font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
        )}
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {runnerProfiles.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No runners registered yet.</p>}
          {runnerProfiles.length > 0 && filteredRoster.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">No runners match "{rosterSearch}".</p>
          )}
          {filteredRoster.map((r) => (
            <button
              key={r.uid}
              type="button"
              onClick={() => selectRunner(r)}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs gap-2 rounded-[14px] border transition text-left ${
                r.bibNumber.toUpperCase() === bibInput.trim().toUpperCase()
                  ? 'bg-red-500/10 border-red-500/40'
                  : 'glass-inset border-transparent hover:border-red-500/30'
              }`}
            >
              <span className="font-mono font-bold text-[var(--text-primary)] w-16 shrink-0">#{r.bibNumber}</span>
              <span className="flex-1 truncate text-[var(--text-secondary)]">{r.fullName}</span>
              <span className={`font-mono text-[10px] font-bold shrink-0 ${r.kitClaimedAt ? 'text-emerald-500' : r.chipId ? 'text-amber-500' : 'text-[var(--text-muted)]'}`}>
                {r.kitClaimedAt ? 'KIT CLAIMED' : r.chipId || 'UNASSIGNED'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {showBibScanner && (
        <QrScannerModal
          onClose={() => setShowBibScanner(false)}
          onScanSuccess={handleBibScan}
          successMessage=""
          errorMessage={feedback?.type === 'error' ? feedback.text : ''}
          title="Select Runner by Bib"
          subtitle="SCAN THE RUNNER'S RACE BIB QR"
          instructions="Scan a RacePulsePH bib QR code to select its runner for kit assignment."
        />
      )}
    </div>
  );
}

// ========== START ROLL CALL ==========

interface StartRollCallPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
  chipReads: ChipRead[];
  startCheckpointId?: string;
  onOpenStartScanner: (distance: string) => void;
}

// Roster checklist for the gun start: every registered runner ticks green the
// instant their chip crosses the start mat, so the race-in-charge can spot at
// a glance who the reader missed and needs a manual re-scan.
function StartRollCallPanel({ race, runnerProfiles, chipReads, startCheckpointId, onOpenStartScanner }: StartRollCallPanelProps) {
  const [settingDistance, setSettingDistance] = useState<string | null>(null);

  const startedBibs = useMemo(() => {
    if (!startCheckpointId) return new Set<string>();
    return new Set(chipReads.filter((r) => r.checkpointId === startCheckpointId).map((r) => r.bibNumber));
  }, [chipReads, startCheckpointId]);

  const distanceGroups = useMemo(() => groupRunnersByDistance(runnerProfiles), [runnerProfiles]);
  const startedCount = runnerProfiles.filter((r) => startedBibs.has(r.bibNumber)).length;

  const handleStartWave = async (distance: string) => {
    if (!window.confirm(`Fire the gun for ${distance} now? This starts the official ${distance} race clock, opens Record Splits, and arms Start RFID.`)) return;
    setSettingDistance(distance);
    try {
      const raceRef = doc(db, 'races', race.id);
      const startedAt = new Date().toISOString();
      await runTransaction(db, async (tx) => {
        const currentSnapshot = await tx.get(raceRef);
        const currentRace = currentSnapshot.data() as Race | undefined;
        const waveStartTimes = { ...(currentRace?.waveStartTimes || {}), [distance]: startedAt };
        // Keep gunStartTime as a first-wave fallback for old screens/races.
        tx.update(raceRef, {
          waveStartTimes,
          gunStartTime: currentRace?.gunStartTime || startedAt,
        });
      });
      onOpenStartScanner(distance);
    } catch (err: any) {
      alert(err.message || `Failed to start the ${distance} clock.`);
    } finally {
      setSettingDistance(null);
    }
  };

  const handleResetWave = async (distance: string) => {
    if (!window.confirm(`Reset the ${distance} gun time? Only do this before runners leave the start line.`)) return;
    setSettingDistance(distance);
    try {
      const raceRef = doc(db, 'races', race.id);
      await runTransaction(db, async (tx) => {
        const currentSnapshot = await tx.get(raceRef);
        const currentRace = currentSnapshot.data() as Race | undefined;
        const waveStartTimes = { ...(currentRace?.waveStartTimes || {}) };
        delete waveStartTimes[distance];
        tx.update(raceRef, {
          waveStartTimes,
          // A blank map means no active wave clock. Otherwise the map is the
          // source of truth and gunStartTime is only retained for old clients.
          ...(Object.keys(waveStartTimes).length === 0 ? { gunStartTime: '' } : {}),
        });
      });
    } catch (err: any) {
      alert(err.message || `Failed to reset the ${distance} clock.`);
    } finally {
      setSettingDistance(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
          <PlayCircle className="w-4 h-4 text-red-500" /> Distance Wave Starts
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Fire each distance when it leaves the line. Cutoffs use that distance's own gun time.</p>
        {distanceGroups.length === 0 && <p className="text-xs text-[var(--text-secondary)] mt-4">Wave controls appear once runners are registered.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {distanceGroups.map((group) => {
            const waveStartTime = getWaveStartTime(race, group.distance);
            const settingThisWave = settingDistance === group.distance;
            return (
              <div key={group.distance} className="glass-inset px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black font-display text-[var(--text-primary)]">{group.distance}</span>
                  {waveStartTime ? <LiveClock gunStartTime={waveStartTime} /> : <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Not started</span>}
                </div>
                {waveStartTime ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-emerald-500">Gun: {new Date(waveStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onOpenStartScanner(group.distance)} disabled={!!settingDistance} className="text-[10px] font-black uppercase tracking-wide text-emerald-500 hover:text-emerald-400 disabled:opacity-50 transition">Arm Start RFID</button>
                      <button
                        onClick={() => handleResetWave(group.distance)}
                        disabled={!!settingDistance}
                        className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50 flex items-center gap-1 transition"
                      >
                        {settingThisWave ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Reset
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleStartWave(group.distance)}
                    disabled={!!settingDistance}
                    className="w-full text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60"
                  >
                    {settingThisWave ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} Start {group.distance} & Arm RFID
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-panel p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-red-500" /> Who's In The Race
          </h3>
          <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)]">{startedCount} / {runnerProfiles.length} started</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mb-4">Ticks green the instant a runner's chip is read at the start checkpoint - use it to catch anyone the sensor missed.</p>

        {!startCheckpointId ? (
          <p className="text-xs text-red-500">This race has no checkpoints configured yet - add a "Start" checkpoint in Race Setup first.</p>
        ) : distanceGroups.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No runners registered yet.</p>
        ) : (
          <div className="space-y-5">
            {distanceGroups.map((group) => {
              const groupStarted = group.runners.filter((r) => startedBibs.has(r.bibNumber)).length;
              return (
                <div key={group.distance}>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-2">{group.distance} &bull; {groupStarted}/{group.runners.length} started</h4>
                  <div className="space-y-1.5">
                    {group.runners.map((r) => {
                      const started = startedBibs.has(r.bibNumber);
                      return (
                        <div key={r.uid} className={`flex items-center justify-between px-3 py-2 text-xs gap-2 rounded-[14px] ${started ? 'bg-emerald-500/10 border border-emerald-500/25' : 'glass-inset'}`}>
                          {started ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-[var(--text-muted)] shrink-0" />}
                          <span className="font-mono font-bold text-[var(--text-primary)] w-16 shrink-0">#{r.bibNumber}</span>
                          <span className="flex-1 truncate text-[var(--text-secondary)]">{r.fullName}</span>
                          <span className={`text-[10px] font-black uppercase tracking-wide shrink-0 ${started ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>
                            {started ? 'Started' : 'Pending'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ========== RUNNER ROSTER ==========

interface RunnerRosterPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

function RunnerRosterPanel({ race, runnerProfiles }: RunnerRosterPanelProps) {
  const distanceGroups = useMemo(() => groupRunnersByDistance(runnerProfiles), [runnerProfiles]);

  const handleDownload = () => {
    if (!generateRunnerRosterPdf(race, runnerProfiles)) {
      alert('No registered runners for this race yet.');
    }
  };

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <Users2 className="w-4 h-4 text-red-500" /> Registered Runners by Distance
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{runnerProfiles.length} total registered</p>
        </div>
        <button
          onClick={handleDownload}
          className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 transition shrink-0"
        >
          <FileDown className="w-4 h-4" /> Download PDF
        </button>
      </div>

      {distanceGroups.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">No runners registered yet.</p>
      ) : (
        <div className="space-y-5">
          {distanceGroups.map((group) => (
            <div key={group.distance}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-2">{group.distance} &bull; {group.runners.length} runners</h4>
              <div className="space-y-1.5">
                {group.runners.map((r) => (
                  <div key={r.uid} className="flex items-center justify-between glass-inset px-3 py-2 text-xs gap-2">
                    <span className="font-mono font-bold text-[var(--text-primary)] w-16 shrink-0">#{r.bibNumber}</span>
                    <span className="flex-1 truncate text-[var(--text-primary)] font-semibold">{r.fullName}</span>
                    <span className="text-[var(--text-secondary)] shrink-0">{r.gender === 'male' ? 'M' : 'F'} &bull; {r.age}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== LIVE RANKINGS / BIG-SCREEN DISPLAY ==========

interface DistanceRanking {
  distance: string;
  results: RunnerResult[];
}

function groupResultsByDistance(results: RunnerResult[]): DistanceRanking[] {
  const groups = new Map<string, RunnerResult[]>();
  for (const r of results) {
    if (r.rank === undefined) continue; // only finished runners are ranked
    const distance = runnerDivisionLabel(r.runnerProfile);
    const list = groups.get(distance) ?? [];
    list.push(r);
    groups.set(distance, list);
  }
  return Array.from(groups.entries())
    .map(([distance, list]) => ({ distance, results: list.sort((a, b) => a.rank! - b.rank!) }))
    .sort((a, b) => a.distance.localeCompare(b.distance));
}

interface RaceRankingsPanelProps {
  race: Race;
  results: RunnerResult[];
}

function RaceRankingsPanel({ race, results }: RaceRankingsPanelProps) {
  const [presenting, setPresenting] = useState(false);
  const distanceGroups = useMemo(() => groupResultsByDistance(results), [results]);
  const totalFinishers = distanceGroups.reduce((sum, g) => sum + g.results.length, 0);

  if (presenting) {
    return <RaceRankingsPresentation race={race} distanceGroups={distanceGroups} onClose={() => setPresenting(false)} />;
  }

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <Trophy className="w-4 h-4 text-red-500" /> Live Rankings by Distance
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{totalFinishers} finisher{totalFinishers === 1 ? '' : 's'} ranked so far</p>
        </div>
        <button
          onClick={() => setPresenting(true)}
          className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition shrink-0"
        >
          <Maximize2 className="w-4 h-4" /> Present on Screen
        </button>
      </div>

      {distanceGroups.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">No finish times recorded yet. Rankings appear once runners cross both the start and finish checkpoints.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {distanceGroups.map((group) => (
            <div key={group.distance} className="glass-inset p-4">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-3">{group.distance} &bull; {group.results.length} finished</h4>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {group.results.map((r) => (
                  <div key={r.bibNumber} className="flex items-center justify-between px-3 py-2 rounded-[14px] bg-[var(--surface-inset)]/40 text-xs gap-2">
                    <span className={`font-mono font-black w-9 shrink-0 ${r.rank === 1 ? 'text-amber-500' : r.rank === 2 ? 'text-slate-400' : r.rank === 3 ? 'text-orange-600' : 'text-red-500'}`}>#{r.rank}</span>
                    <span className="flex-1 truncate">
                      <span className="font-bold text-[var(--text-primary)]">{r.runnerProfile?.fullName || `Bib ${r.bibNumber}`}</span>
                      <span className="text-[var(--text-muted)]"> &bull; #{r.bibNumber}</span>
                    </span>
                    <span className="font-mono font-bold text-[var(--text-primary)] shrink-0">{r.finishTime}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RaceRankingsPresentationProps {
  race: Race;
  distanceGroups: DistanceRanking[];
  onClose: () => void;
}

// Full-viewport, big-screen-friendly leaderboard meant to be projected at the
// venue. Cycles through distances automatically when there's more than one so
// the race-in-charge doesn't have to babysit a laptop between announcements.
function RaceRankingsPresentation({ race, distanceGroups, onClose }: RaceRankingsPresentationProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (distanceGroups.length <= 1) return;
    const interval = setInterval(() => setActiveIndex((i) => (i + 1) % distanceGroups.length), 10000);
    return () => clearInterval(interval);
  }, [distanceGroups.length]);

  const active = distanceGroups[activeIndex] || distanceGroups[0];

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-[#0a0a0c] text-white flex flex-col p-8 sm:p-12 overflow-hidden">
      <div className="absolute -top-32 -left-24 w-[32rem] h-[32rem] bg-red-600/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-red-900/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative flex items-center justify-between shrink-0">
        <div>
          <span className="text-xs sm:text-sm tracking-[0.3em] font-black text-red-500 uppercase">{race.name}</span>
          <h1 className="text-3xl sm:text-5xl font-black font-display uppercase tracking-tight mt-1 flex items-center gap-3">
            <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" /> Live Rankings
          </h1>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          <LiveClock gunStartTime={race.gunStartTime} size="header" />
          <button onClick={onClose} className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {!active ? (
        <div className="relative flex-1 flex items-center justify-center">
          <p className="text-lg text-white/50 uppercase tracking-widest font-bold">Waiting for finishers...</p>
        </div>
      ) : (
        <div className="relative flex-1 flex flex-col mt-6 sm:mt-10 min-h-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-2xl sm:text-4xl font-black font-display uppercase tracking-wide text-red-500">{active.distance}</h2>
            {distanceGroups.length > 1 && (
              <div className="flex gap-2">
                {distanceGroups.map((g, idx) => (
                  <button
                    key={g.distance}
                    onClick={() => setActiveIndex(idx)}
                    className={`w-2.5 h-2.5 rounded-full transition ${idx === activeIndex ? 'bg-red-500' : 'bg-white/20'}`}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {active.results.map((r) => (
              <div key={r.bibNumber} className={`flex items-center gap-4 sm:gap-6 px-5 sm:px-7 py-3.5 sm:py-4 rounded-[20px] ${r.rank! <= 3 ? 'bg-white/10 border border-white/10' : 'bg-white/5'}`}>
                <span className={`font-mono font-black text-2xl sm:text-4xl w-14 sm:w-20 shrink-0 ${r.rank === 1 ? 'text-amber-400' : r.rank === 2 ? 'text-slate-300' : r.rank === 3 ? 'text-orange-500' : 'text-white/70'}`}>
                  {r.rank}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-lg sm:text-2xl font-bold truncate">{r.runnerProfile?.fullName || `Bib ${r.bibNumber}`}</span>
                  <span className="block text-xs sm:text-sm text-white/40 font-mono uppercase tracking-wide">Bib #{r.bibNumber}</span>
                </span>
                <span className="font-mono font-black text-xl sm:text-3xl shrink-0 text-white">{r.finishTime}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="relative shrink-0 text-center text-[10px] sm:text-xs text-white/30 font-mono uppercase tracking-widest mt-6">
        Updates live &bull; Press Esc to exit
      </p>
    </div>
  );
}
