import { formatClockTime, formatDateTime, formatRaceTime, formatElapsed } from '../lib/preciseTime';
import { useAccess, useScopedRaces, authenticatedFetch } from '../lib/access';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, deleteField, runTransaction } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { useDualSync } from '../lib/dualSync';
import { checkpointType, computeResults, getCheckpointByType, getWaveStartTime } from '../lib/timing';
import { groupRankingFolders } from '../lib/rankingFolders';
import { useOfflineScanQueue } from '../lib/offlineScanQueue';
import { Race, ChipRead, PublicLeaderboardEntry, PublicLiveResults, RaceEntryCategory, RunnerProfile, RunnerResult } from '../types';
import { groupRunnersByDistance, generateRunnerRosterPdf } from '../lib/runnerReport';
import { generateRankingsReportPdf } from '../lib/rankingsReport';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories, runnerDivisionLabel, runnerEntryCategory, runnerWaveLabel } from '../lib/raceEntry';
import { Radio, ScanLine, Trophy, Clock, Wifi, WifiOff, QrCode, RefreshCw, ArrowLeft, Cpu, Users2, FileDown, FileUp, Maximize2, X, ListChecks, CheckCircle2, Circle, PlayCircle, RotateCcw, Timer, Keyboard, Smartphone, Search, UserCheck, Undo2, Folder, FolderOpen, ChevronRight, AlertTriangle, Ban } from 'lucide-react';
import QrScannerModal from './QrScannerModal';
import RaceList from './RaceList';
import LiveRankingsScreen from './LiveRankingsScreen';
import EntrySequencePanel from './EntrySequencePanel';
import DialogSurface from './ui/DialogSurface';
import { useFeedback } from './ui/FeedbackProvider';

interface DequeuedFinisherRecord {
  bibNumber: string;
  runnerName: string;
  division: string;
  finishTime?: string;
  reads: ChipRead[];
  dequeuedAt: string;
}

function safeControlReadId(prefix: string, raceId: string, bibNumber: string): string {
  return `${prefix}_${raceId}_${bibNumber}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function nextControlTimestamp(reads: ChipRead[]): string {
  const maxExisting = reads.reduce((max, read) => {
    const parsed = Date.parse(read.timestamp);
    return Number.isNaN(parsed) ? max : Math.max(max, parsed);
  }, 0);
  return new Date(Math.max(Date.now(), maxExisting + 1)).toISOString();
}

function finisherAnomalyLabels(result: RunnerResult): string[] {
  const labels: string[] = [];
  if (result.missingStartScan) labels.push('No start scan (gun fallback)');
  if (result.missingIntermediateLabels?.length) {
    labels.push(`Missed: ${result.missingIntermediateLabels.join(', ')}`);
  }
  if (result.finishReviewRequired) labels.push('Provisional (close finish)');
  return labels;
}

const DQ_PRESET_REASONS = [
  'Incomplete duo or team at finish',
  'Missed checkpoint or course cut',
  'Accidental or false finish scan',
  'Started in wrong wave',
  'Bib swap or unofficial runner',
];

// Ticks ten times per second so any component reading it re-renders live - backs the
// gun clock and the wall-clock readout without each caller managing its own timer.
function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatClockElapsed(totalMs: number): string {
  return formatElapsed(Math.max(0, totalMs) / 1000);
}

// datetime-local inputs use the operator's local clock while Firestore stores
// timestamps in UTC.  Keep that conversion in one place so a corrected gun
// time produces the same result on the timing laptop and public leaderboard.
function toLocalDateTimeInputValue(isoTimestamp: string | undefined, fallbackRaceDate?: string): string {
  const candidate = isoTimestamp
    ? new Date(isoTimestamp)
    : new Date(`${fallbackRaceDate || new Date().toISOString().slice(0, 10)}T06:00:00`);
  if (Number.isNaN(candidate.getTime())) return '';
  const local = new Date(candidate.getTime() - candidate.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 23);
}

// RFID readers commonly send an EPC as keyboard text. Normalising both the
// scanner value and saved IDs keeps matching reliable when a reader switches
// between lowercase and uppercase hexadecimal output.
function normalizeScanValue(value: string): string {
  return value.trim().toUpperCase();
}

function runnerTimingName(runner: Pick<RunnerProfile, 'fullName' | 'bibNumber' | 'isFreeSlot'> | undefined, fallbackBib?: string): string {
  if (!runner) return `Bib ${fallbackBib || ''}`.trim();
  return runner.isFreeSlot ? `Bib ${runner.bibNumber}` : runner.fullName;
}

type ScanFeedback = { type: 'success' | 'error' | 'warning'; text: string };

interface RfidBridgeEvent {
  bridgeEventId?: string;
  readerSequence?: number;
  monotonicTicks?: string;
  monotonicFrequency?: string;
  clockSource?: string;

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
  const { can, authority } = useAccess();
  const now = useNow(100);
  const wallClock = formatClockTime(now);

  if (size === 'large') {
    return (
      <div className="text-center">
        <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.25em] text-[var(--text-muted)]">{gunStartTime ? 'Gun Time' : 'Current Time'}</p>
        <p className="font-mono font-black text-[clamp(1.25rem,6vw,3.75rem)] text-[var(--text-primary)] tabular-nums">
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

export interface TimingLaunchRequest {
  raceId: string;
  mode?: 'record' | 'roster';
  nonce: number;
}

interface TimingConsoleProps {
  uid: string;
  // Admin can time any organizer's race; an Organizer only sees/times races they created.
  canSeeAllRaces: boolean;
  launchRequest?: TimingLaunchRequest | null;
}

// Live checkpoint recording + results, shared by the Organizer and Admin dashboards.
// The operator's browser validates and saves reads.  A local Windows bridge can
// feed it live EPC sightings from a VF-787P reader through /api/rfid-events.
export default function TimingConsole({ uid, canSeeAllRaces, launchRequest }: TimingConsoleProps) {
  const { can, authority, version } = useAccess();
  const races = useScopedRaces();
  const [activeRaceId, setActiveRaceId] = useState<string>(() => launchRequest?.raceId || localStorage.getItem('racepulse_active_race') || '');
  const [pendingMode, setPendingMode] = useState<'record' | 'roster' | undefined>(() => launchRequest?.mode);
  const [pendingModeNonce, setPendingModeNonce] = useState<number>(() => launchRequest?.nonce ?? 0);

  useEffect(() => {
    if (!launchRequest?.raceId) return;
    localStorage.setItem('racepulse_active_race', launchRequest.raceId);
    setActiveRaceId(launchRequest.raceId);
    if (launchRequest.mode) {
      setPendingMode(launchRequest.mode);
      setPendingModeNonce(launchRequest.nonce);
    }
  }, [launchRequest?.nonce, launchRequest?.raceId, launchRequest?.mode]);

  useEffect(() => {
    const goBackToRaceList = () => {
      localStorage.removeItem('racepulse_active_race');
      setActiveRaceId('');
    };
    window.addEventListener('racepulse:back', goBackToRaceList);
    return () => window.removeEventListener('racepulse:back', goBackToRaceList);
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
        onClick={() => {
          localStorage.removeItem('racepulse_active_race');
          setActiveRaceId('');
        }}
        className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Choose a different race
      </button>
      <TimingConsoleForRace key={activeRace.id} race={activeRace} uid={uid} initialMode={pendingMode} initialModeNonce={pendingModeNonce} />
    </div>
  );
}

interface TimingConsoleForRaceProps {
  race: Race;
  uid: string;
  initialMode?: 'record' | 'roster';
  initialModeNonce?: number;
}

function TimingConsoleForRace({ race, uid, initialMode, initialModeNonce = 0 }: TimingConsoleForRaceProps) {
  const { can, authority } = useAccess();
  const { confirm, notify } = useFeedback();
  const defaultMode = can('timing.view') ? 'record' : (can('roster.view') ? 'roster' : 'assign');
  const [mode, setMode] = useState<'record' | 'mobile-checkin' | 'assign' | 'roster' | 'rankings' | 'rollcall'>(() => initialMode || defaultMode);

  useEffect(() => {
    if (initialMode && initialModeNonce > 0) {
      setMode(initialMode);
    }
  }, [initialMode, initialModeNonce]);
  const orderedCheckpoints = useMemo(() => [...race.checkpoints].sort((a, b) => a.order - b.order), [race.checkpoints]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(orderedCheckpoints[0]?.id || '');
  const [bibInput, setBibInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanSource, setScanSource] = useState<'keyboard' | 'vf787p'>('keyboard');
  const [runnerSearch, setRunnerSearch] = useState('');
  const [mobileCheckInBib, setMobileCheckInBib] = useState<string | null>(null);
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
  const submitReadRef = useRef<(scanRaw: string, overrideTimestamp?: string, source?: 'keyboard' | 'vf787p' | 'camera', bridgeEvent?: RfidBridgeEvent) => Promise<boolean>>(async () => false);
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
    enabled: can('timing.view'),
    firestoreQuery: query(collection(db, 'chipReads'), where('raceId', '==', race.id)),
    lanEndpoint: '/api/chip-reads',
    lanResponseKey: 'chipReads',
    getId: (r) => r.id,
    getUpdatedAt: (r) => r.createdAt,
  });
  const { pendingCount: pendingScanCount, enqueue: enqueueScan, discard: discardQueuedScan, queueError } = useOfflineScanQueue(race.id);

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[]>([]);
  const [runnerProfilesError, setRunnerProfilesError] = useState('');
  useEffect(() => {
    if (!race.completedAt) return;
    setScannerArmed(false);
    setArmStartOnEnter(false);
  }, [race.completedAt]);
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
    () => computeResults(race.checkpoints, chipReads, runnerProfiles, race.ageCategories || [], race),
    [race, chipReads, runnerProfiles]
  );

  const checkpointLabel = (id: string) => orderedCheckpoints.find((c) => c.id === id)?.label || id;
  const checkInCount = checkInCheckpoint ? new Set(chipReads.filter((read) => read.checkpointId === checkInCheckpoint.id).map((read) => read.bibNumber)).size : 0;
  const finishedCount = results.filter((result) => !!result.finishTime && !result.disqualified).length;
  const isRaceCompleted = !!race.completedAt;
  const hasWaveStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
  // Pre-race chip tests must never leak into the public leaderboard. Timing
  // becomes publishable only after an official wave start, or after the
  // organizer explicitly finishes the race.
  const canPublishResults = isRaceCompleted || hasWaveStarted;
  const publicLeaders = useMemo<PublicLeaderboardEntry[]>(() => {
    const divisions = [...new Set(results.filter((result) => result.finishTime && result.rank).map((result) => runnerDivisionLabel(result.runnerProfile)))];
    return divisions.flatMap((division) => results
      .filter((result) => runnerDivisionLabel(result.runnerProfile) === division && result.finishTime && result.rank)
      .slice(0, 5)
      .map((result) => ({
        bibNumber: result.bibNumber,
        fullName: runnerTimingName(result.runnerProfile, result.bibNumber),
        ...(result.runnerProfile?.isFreeSlot ? { isFreeSlot: true } : {}),
        distance: division,
        rank: result.rank!,
        overallRank: result.overallRank ?? result.rank,
        ...(result.categoryRank ? { categoryRank: result.categoryRank } : {}),
        ...(result.categoryLabel ? { categoryLabel: result.categoryLabel } : {}),
        ...(result.specialAgeAwards?.length ? { specialAgeAwards: result.specialAgeAwards } : {}),
        ...(result.timingMethod ? { timingMethod: result.timingMethod } : {}),
        ...(result.sequenceStartTime ? { sequenceStartTime: result.sequenceStartTime } : {}),
        ...(result.chipTime ? { chipTime: result.chipTime } : {}),
        ...(result.gunTime ? { gunTime: result.gunTime } : {}),
        finishTime: result.finishTime!,
          finishReviewRequired: !!result.finishReviewRequired,
      })));
  }, [results]);
  const publicOfficialResults = useMemo<PublicLeaderboardEntry[]>(() => results
    .filter((result) => result.finishTime && result.rank)
    .map((result) => ({
      bibNumber: result.bibNumber,
      fullName: runnerTimingName(result.runnerProfile, result.bibNumber),
      ...(result.runnerProfile?.isFreeSlot ? { isFreeSlot: true } : {}),
        distance: runnerDivisionLabel(result.runnerProfile),
        rank: result.rank!,
        overallRank: result.overallRank ?? result.rank,
        ...(result.categoryRank ? { categoryRank: result.categoryRank } : {}),
        ...(result.categoryLabel ? { categoryLabel: result.categoryLabel } : {}),
        ...(result.specialAgeAwards?.length ? { specialAgeAwards: result.specialAgeAwards } : {}),
        ...(result.timingMethod ? { timingMethod: result.timingMethod } : {}),
        ...(result.sequenceStartTime ? { sequenceStartTime: result.sequenceStartTime } : {}),
        ...(result.chipTime ? { chipTime: result.chipTime } : {}),
        ...(result.gunTime ? { gunTime: result.gunTime } : {}),
        finishTime: result.finishTime!,
          finishReviewRequired: !!result.finishReviewRequired,
    }))
    .sort((a, b) => a.distance.localeCompare(b.distance) || a.rank - b.rank), [results]);

  // The operator normally stays on this screen during the race. Publish this
  // compact, public-safe official result record after each scan, even when a
  // livestream is disabled. Runner status and certificates rely on it; raw
  // chip reads remain private to operators and the individual runner.
  useEffect(() => {
    // A completed race is a locked, published record. In particular, an old
    // timing-console tab may still hold an offline/stale snapshot; it must
    // never overwrite the reviewed final leaderboard after the race closes.
    // `finishRace` is the one deliberate publish at completion time.
    if (isRaceCompleted || !can('results.publish')) return;

    const timeout = window.setTimeout(() => {
      const summary: PublicLiveResults = {
        raceId: race.id,
        raceName: race.name,
        updatedAt: new Date().toISOString(),
        status: isRaceCompleted ? 'completed' : hasWaveStarted ? 'live' : 'upcoming',
        totalRegistered: runnerProfiles.length,
        totalStarted: new Set(chipReads.filter((read) => read.checkpointId === startCheckpoint?.id).map((read) => read.bibNumber)).size,
        totalFinished: finishedCount,
        leaders: canPublishResults ? publicLeaders : [],
        officialResults: canPublishResults ? publicOfficialResults : [],
      };
      setDoc(doc(db, 'liveResults', race.id), summary).catch((error) => {
        console.warn('Public live leaderboard publish skipped:', error.message);
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [canPublishResults, chipReads, finishedCount, hasWaveStarted, isRaceCompleted, publicLeaders, publicOfficialResults, race, runnerProfiles.length, startCheckpoint?.id]);

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
    if (scanSource !== 'vf787p') {
      scanInputRef.current?.focus();
      setFeedback({ type: 'success', text: 'Keyboard scanner is ready. Scan the bib or chip, then its Enter key will record the runner.' });
      return;
    }
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
  }, [mode, selectedCheckpointId, scanSource]);

  useEffect(() => {
    if (!armStartOnEnter || mode !== 'record' || selectedCheckpointType !== 'start' || scanSource !== 'vf787p') return;
    setScannerArmed(true);
    setArmStartOnEnter(false);
    setFeedback({ type: 'success', text: 'Official gun time saved. Start RFID scanner is armed and ready for runner chips.' });
  }, [armStartOnEnter, mode, scanSource, selectedCheckpointType]);

  // Keep a keyboard-wedge RFID reader ready after every scan. This also makes
  // the manual fallback quick: operators can simply type a known bib and Enter.
  useEffect(() => {
    if (mode === 'record' && scanSource === 'keyboard') scanInputRef.current?.focus();
  }, [mode, scanSource, selectedCheckpointId]);

  const openStartScanner = (distance: string) => {
    if (isRaceCompleted) {
      setFeedback({ type: 'warning', text: 'This race is already finished. Reopen timing first if you need to make a correction.' });
      return;
    }
    if (!startCheckpoint) {
      setFeedback({ type: 'error', text: 'This race has no Start checkpoint configured yet.' });
      return;
    }
    setBibInput('');
    setScanSource('vf787p');
    setArmStartOnEnter(true);
    setSelectedCheckpointId(startCheckpoint.id);
    setMode('record');
    setFeedback({ type: 'success', text: `${distance} gun started. Opening and arming the Start RFID station…` });
  };

  const submitRead = async (scanRaw: string, overrideTimestamp?: string, source: 'keyboard' | 'vf787p' | 'camera' = 'keyboard', bridgeEvent?: RfidBridgeEvent) => {
    if (!can('timing.scan') || (source === 'keyboard' && !can('timing.manual'))) { setFeedback({ type: 'error', text: 'Recording is disabled for your account.' }); return false; }
    if (isRaceCompleted) {
      setFeedback({ type: 'warning', text: 'Race timing is closed. Reopen timing first before recording another scan.' });
      return false;
    }
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
      if (scanSource === 'keyboard') scanInputRef.current?.focus();
      return false;
    }

    const scannedChip = !!matchedRunner.chipId && normalizeScanValue(matchedRunner.chipId) === scannedValue;
    const bibNumber = matchedRunner.bibNumber;
    // Check-in is attendance only. A runner who reaches the start without
    // visiting the desk must still be timed normally; showing this explicitly
    // reassures the operator instead of making them stop the start-line flow.
    const runnerCheckedIn = !!checkInCheckpoint && chipReads.some((read) =>
      read.bibNumber === bibNumber && read.checkpointId === checkInCheckpoint.id
    );
    // Each distance may leave at a different time. A legacy/shared gun time
    // remains the fallback so older races still work exactly as before.
    const entryResult = results.find((result) => result.bibNumber === matchedRunner.bibNumber);
    if (matchedRunner.startsAfterBib && selectedCheckpointType !== 'checkin' && !entryResult?.sequenceStartTime) {
      setFeedback({ type: 'warning', text: `Bib #${matchedRunner.bibNumber} must wait for bib #${matchedRunner.startsAfterBib} to finish its previous entry.` });
      return false;
    }
    const waveStartTime = matchedRunner.startsAfterBib ? entryResult?.sequenceStartTime
      : getWaveStartTime(race, matchedRunner.distance, runnerEntryCategory(matchedRunner));
    if (matchedRunner.startsAfterBib && selectedCheckpointType !== 'checkin' && overrideTimestamp
      && waveStartTime && Date.parse(overrideTimestamp) < Date.parse(waveStartTime)) {
      setFeedback({ type: 'warning', text: 'This scan cannot precede the previous entry’s finish.' });
      return false;
    }
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
      if (scanSource === 'keyboard') scanInputRef.current?.focus();
      return false;
    }

    // Check-in, Start and Finish are one-time stations. Unlike intermediate
    // lap splits, a later duplicate here would only create operator confusion,
    // so stop it and show exactly when the first valid read was recorded.
    const latestDequeueRead = chipReads
      .filter((read) => read.bibNumber === bibNumber && read.checkpointId === '__dequeue__')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    const latestRestoreRead = chipReads
      .filter((read) => read.bibNumber === bibNumber && read.checkpointId === '__restore__')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    const activeDequeueAt = latestDequeueRead
      && (!latestRestoreRead || new Date(latestDequeueRead.timestamp).getTime() > new Date(latestRestoreRead.timestamp).getTime())
      ? new Date(latestDequeueRead.timestamp).getTime()
      : 0;
    const priorRead = chipReads.find((read) =>
      read.bibNumber === bibNumber
      && read.checkpointId === selectedCheckpointId
      && !(selectedCheckpointType === 'finish' && activeDequeueAt > 0 && new Date(read.timestamp).getTime() <= activeDequeueAt)
    );
    if (priorRead && ['checkin', 'start', 'finish'].includes(selectedCheckpointType)) {
      setFeedback({ type: 'warning', text: `Duplicate scan: bib #${bibNumber} already has a ${checkpointLabel(selectedCheckpointId)} record at ${formatClockTime(priorRead.timestamp)}. No new read was saved.` });
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
      const readId = `${race.id}_${bibNumber}_${selectedCheckpointId}_${bridgeEvent?.id || Date.now()}`;
      const record: ChipRead = {
        id: readId,
        raceId: race.id,
        bibNumber,
        ...(scannedChip ? { chipId: matchedRunner.chipId } : {}),
        checkpointId: selectedCheckpointId,
        timestamp: recordedTimestamp,
        ...(bridgeEvent ? { bridgeEventId: bridgeEvent.id, antenna: bridgeEvent.antenna, clockSource: bridgeEvent.clockSource || 'bridge-receipt',
          ...(bridgeEvent.readerSequence !== undefined ? { readerSequence: bridgeEvent.readerSequence } : {}),
          ...(bridgeEvent.monotonicTicks ? { monotonicTicks: bridgeEvent.monotonicTicks } : {}),
          ...(bridgeEvent.monotonicFrequency ? { monotonicFrequency: bridgeEvent.monotonicFrequency } : {}) } : {}),
        source: source === 'vf787p' ? 'rfid-bridge' : 'manual',
        recordedBy: uid,
        createdAt: nowIso,
      };

      // Persist locally first, then sync in the background. This keeps the
      // station fast even when mobile data drops or the cloud is unreachable.
      enqueueScan(record);

      lastRecordedScanRef.current = { key: scanKey, at: nowMs };
      const queuedOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const skippedCheckInNote = selectedCheckpointType === 'start' && !runnerCheckedIn
        ? ' • no check-in (allowed)'
        : '';
      const gunFallbackNote = selectedCheckpointType === 'finish' && matchedRunner.startsAfterBib
        ? ` • timed from bib #${matchedRunner.startsAfterBib}'s finish`
        : selectedCheckpointType === 'finish'
        && !chipReads.some((read) => read.bibNumber === bibNumber && read.checkpointId === startCheckpoint?.id)
        && waveStartTime
        ? ' • official gun-time fallback'
        : '';
      setFeedback({ type: 'success', text: `${queuedOffline ? 'Saved to device queue' : 'Recorded'} ${runnerTimingName(matchedRunner)}${matchedRunner.isFreeSlot ? '' : ` • bib ${bibNumber}`} @ ${checkpointLabel(selectedCheckpointId)}${skippedCheckInNote}${gunFallbackNote}${lateForCutoff ? ' • AFTER CUTOFF' : ''}` });
      announceSuccessfulScan();
      setBibInput('');
      if (scanSource === 'keyboard') scanInputRef.current?.focus();
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
    if (mode !== 'record' || !selectedCheckpointId || scanSource !== 'vf787p' || !scannerArmed) {
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
        const response = await authenticatedFetch(`/api/rfid-events?raceId=${encodeURIComponent(race.id)}&after=${encodeURIComponent(after)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as { events?: RfidBridgeEvent[] };
        if (!active) return;
        setBridgeEndpointReady(true);

        for (const event of payload.events || []) {
          const cursor = event.receivedAt || event.timestamp;
          if (processedBridgeEventsRef.current.has(event.id)) continue;
          await submitReadRef.current(event.epc, event.timestamp, 'vf787p', event);
          // Only acknowledge after validation and durable local enqueue. A
          // thrown storage failure leaves this event available for retry.
          processedBridgeEventsRef.current.add(event.id);
          if (cursor && Date.parse(cursor) >= Date.parse(after)) after = cursor;
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
  }, [mode, scanSource, selectedCheckpointId, scannerArmed]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitRead(bibInput, undefined, 'keyboard');
  };

  const [recentlyDequeued, setRecentlyDequeued] = useState<DequeuedFinisherRecord[]>([]);
  const [busyFinisherBib, setBusyFinisherBib] = useState<string | null>(null);

  const deleteChipReadEverywhere = async (readId: string) => {
    discardQueuedScan(readId);
    await deleteDoc(doc(db, 'chipReads', readId));
    void authenticatedFetch(`/api/chip-reads/${encodeURIComponent(readId)}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const undoTimingRead = async (read: ChipRead) => {
    if (!authority && !can('timing.correct')) return;
    const stationLabel = checkpointLabel(read.checkpointId);
    const runner = runnerProfiles.find((profile) => profile.bibNumber === read.bibNumber);
    const runnerLabel = runner ? runnerTimingName(runner) : `Bib ${read.bibNumber}`;
    const approved = await confirm({
      title: `Remove ${stationLabel} scan for Bib #${read.bibNumber}?`,
      message: `Removes the ${stationLabel} read for ${runnerLabel} recorded at ${formatClockTime(read.timestamp)}. Other checkpoint splits for this runner stay intact.`,
      confirmLabel: 'Remove scan',
      cancelLabel: 'Keep scan',
      destructive: true,
    });
    if (!approved) return;

    try {
      await deleteChipReadEverywhere(read.id);
      setFeedback({ type: 'success', text: `Removed ${stationLabel} read for ${runnerLabel} • bib ${read.bibNumber}.` });
      notify({
        tone: 'info',
        title: `Removed ${stationLabel} scan`,
        message: `${runnerLabel} (Bib #${read.bibNumber}) removed from ${stationLabel}.`,
      });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not remove this timing read.' });
    }
  };

  const canManageFinishers = authority || can('timing.correct') || (can('timing.scan') && !isRaceCompleted);

  const dequeueFinisher = async (result: RunnerResult) => {
    if (!canManageFinishers || !finishCheckpoint) return;
    const bibNumber = result.bibNumber;
    const runnerName = runnerTimingName(result.runnerProfile, bibNumber);
    const division = runnerDivisionLabel(result.runnerProfile);
    const finishReads = chipReads.filter(
      (read) => read.bibNumber === bibNumber && read.checkpointId === finishCheckpoint.id,
    );
    const controlReads = chipReads.filter(
      (read) => read.bibNumber === bibNumber && ['__dq__', '__reinstate__', '__dequeue__', '__restore__'].includes(read.checkpointId),
    );

    setBusyFinisherBib(bibNumber);
    try {
      if (finishReads.length > 0) {
        setRecentlyDequeued((current) => [
          {
            bibNumber,
            runnerName,
            division,
            finishTime: result.finishTime,
            reads: finishReads,
            dequeuedAt: new Date().toISOString(),
          },
          ...current.filter((item) => item.bibNumber !== bibNumber),
        ].slice(0, 12));
      }

      if (authority || can('timing.correct')) {
        for (const read of [...finishReads, ...controlReads]) {
          await deleteChipReadEverywhere(read.id);
        }
      } else if (can('timing.scan') && !isRaceCompleted) {
        const markerIso = nextControlTimestamp([...finishReads, ...controlReads]);
        const dequeueMarker: ChipRead = {
          id: safeControlReadId('deq', race.id, `${bibNumber}_${Date.now()}`),
          raceId: race.id,
          bibNumber,
          checkpointId: '__dequeue__',
          timestamp: markerIso,
          source: 'manual',
          recordedBy: uid,
          createdAt: markerIso,
        };
        enqueueScan(dequeueMarker);
      }

      if (race.disqualifiedBibs?.[bibNumber] !== undefined || race.disqualifiedBibs?.[bibNumber.toUpperCase()] !== undefined) {
        const nextDq = { ...(race.disqualifiedBibs || {}) };
        delete nextDq[bibNumber];
        delete nextDq[bibNumber.toUpperCase()];
        void updateDoc(doc(db, 'races', race.id), { disqualifiedBibs: nextDq }).catch(() => undefined);
      }

      notify({
        tone: 'info',
        title: `Dequeued Bib #${bibNumber}`,
        message: `${runnerName} (${division}) removed from finishers and returned to active course status.`,
      });
    } catch (error: any) {
      notify({
        tone: 'error',
        title: 'Could not dequeue finisher',
        message: error.message || 'Check your connection and timing permissions.',
      });
    } finally {
      setBusyFinisherBib(null);
    }
  };

  const restoreDequeuedFinisher = async (entry: DequeuedFinisherRecord) => {
    if (!canManageFinishers) return;
    setBusyFinisherBib(entry.bibNumber);
    try {
      const dequeueMarkers = chipReads.filter(
        (read) => read.bibNumber === entry.bibNumber && read.checkpointId === '__dequeue__',
      );
      if (authority || can('timing.correct')) {
        for (const marker of dequeueMarkers) {
          await deleteChipReadEverywhere(marker.id);
        }
      } else if (dequeueMarkers.length > 0 && !isRaceCompleted && can('timing.scan')) {
        const restoreIso = nextControlTimestamp(dequeueMarkers);
        enqueueScan({
          id: safeControlReadId('rst', race.id, `${entry.bibNumber}_${Date.now()}`),
          raceId: race.id,
          bibNumber: entry.bibNumber,
          checkpointId: '__restore__',
          timestamp: restoreIso,
          source: 'manual',
          recordedBy: uid,
          createdAt: restoreIso,
        });
      }

      const existingIds = new Set(chipReads.map((read) => read.id));
      for (const read of entry.reads) {
        if (existingIds.has(read.id)) continue;
        const restoredRead: ChipRead = {
          ...read,
          recordedBy: uid,
        };
        if (!isRaceCompleted && can('timing.scan')) {
          enqueueScan(restoredRead);
        } else {
          await setDoc(doc(db, 'chipReads', restoredRead.id), restoredRead);
          void authenticatedFetch('/api/chip-reads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(restoredRead),
          }).catch(() => undefined);
        }
      }
      setRecentlyDequeued((current) => current.filter((item) => item.bibNumber !== entry.bibNumber));
      notify({
        tone: 'success',
        title: `Restored Bib #${entry.bibNumber}`,
        message: `${entry.runnerName} returned to ${entry.division} rankings.`,
      });
    } catch (error: any) {
      notify({
        tone: 'error',
        title: 'Could not restore finish scan',
        message: error.message || 'Reopen race timing first if the event is locked.',
      });
    } finally {
      setBusyFinisherBib(null);
    }
  };

  const disqualifyFinisher = async (result: RunnerResult, reason: string) => {
    if (!canManageFinishers) return;
    const bibNumber = result.bibNumber;
    const runnerName = runnerTimingName(result.runnerProfile, bibNumber);
    const division = runnerDivisionLabel(result.runnerProfile);
    const cleanReason = (reason.trim() || 'Invalidated by race official').slice(0, 120);

    setBusyFinisherBib(bibNumber);
    try {
      const existingControls = chipReads.filter(
        (read) => read.bibNumber === bibNumber && ['__dq__', '__reinstate__', '__dequeue__', '__restore__'].includes(read.checkpointId),
      );
      const markerIso = nextControlTimestamp(existingControls);
      const dqRecord: ChipRead = {
        id: safeControlReadId('dq', race.id, `${bibNumber}_${Date.now()}`),
        raceId: race.id,
        bibNumber,
        chipId: cleanReason,
        checkpointId: '__dq__',
        timestamp: markerIso,
        source: 'manual',
        recordedBy: uid,
        createdAt: markerIso,
      };

      const reinstateReads = existingControls.filter((read) => read.checkpointId === '__reinstate__');
      if (authority || can('timing.correct')) {
        for (const read of reinstateReads) {
          await deleteChipReadEverywhere(read.id);
        }
      }

      let persisted = false;
      if (!isRaceCompleted && can('timing.scan')) {
        enqueueScan(dqRecord);
        persisted = true;
      }

      const nextDq = { ...(race.disqualifiedBibs || {}), [bibNumber]: cleanReason };
      if (persisted) {
        void updateDoc(doc(db, 'races', race.id), { disqualifiedBibs: nextDq }).catch(() => undefined);
      } else {
        await updateDoc(doc(db, 'races', race.id), { disqualifiedBibs: nextDq });
      }

      notify({
        tone: 'info',
        title: `Bib #${bibNumber} marked DQ`,
        message: `${runnerName} (${division}) excluded from official rankings: ${cleanReason}.`,
      });
    } catch (error: any) {
      notify({
        tone: 'error',
        title: 'Could not disqualify finisher',
        message: error.message || 'Reopen timing or verify your timing permissions.',
      });
    } finally {
      setBusyFinisherBib(null);
    }
  };

  const reinstateFinisher = async (result: RunnerResult) => {
    if (!canManageFinishers) return;
    const bibNumber = result.bibNumber;
    const runnerName = runnerTimingName(result.runnerProfile, bibNumber);
    const division = runnerDivisionLabel(result.runnerProfile);

    setBusyFinisherBib(bibNumber);
    try {
      const dqReads = chipReads.filter(
        (read) => read.bibNumber === bibNumber && read.checkpointId === '__dq__',
      );
      let persisted = false;
      if (authority || can('timing.correct')) {
        for (const read of dqReads) {
          await deleteChipReadEverywhere(read.id);
        }
        persisted = dqReads.length > 0;
      } else if (!isRaceCompleted && can('timing.scan')) {
        const markerIso = nextControlTimestamp(dqReads);
        enqueueScan({
          id: safeControlReadId('rein', race.id, `${bibNumber}_${Date.now()}`),
          raceId: race.id,
          bibNumber,
          checkpointId: '__reinstate__',
          timestamp: markerIso,
          source: 'manual',
          recordedBy: uid,
          createdAt: markerIso,
        });
        persisted = true;
      }

      if (race.disqualifiedBibs?.[bibNumber] !== undefined || race.disqualifiedBibs?.[bibNumber.toUpperCase()] !== undefined) {
        const nextDq = { ...(race.disqualifiedBibs || {}) };
        delete nextDq[bibNumber];
        delete nextDq[bibNumber.toUpperCase()];
        if (persisted) {
          void updateDoc(doc(db, 'races', race.id), { disqualifiedBibs: nextDq }).catch(() => undefined);
        } else {
          await updateDoc(doc(db, 'races', race.id), { disqualifiedBibs: nextDq });
        }
      }

      notify({
        tone: 'success',
        title: `Reinstated Bib #${bibNumber}`,
        message: `${runnerName} restored to official ${division} rankings.`,
      });
    } catch (error: any) {
      notify({
        tone: 'error',
        title: 'Could not reinstate finisher',
        message: error.message || 'Check your connection and timing permissions.',
      });
    } finally {
      setBusyFinisherBib(null);
    }
  };

  const handleQrScan = async (text: string): Promise<boolean> => {
    let bib = text.trim();
    if (bib.startsWith('RPCHIPv1|')) {
      const parts = bib.split('|');
      if (parts[1] !== race.id) {
        setFeedback({ type: 'error', text: 'This bib QR belongs to a different race.' });
        return false;
      }
      bib = parts[2] || '';
    } else if (bib.startsWith('RXPv2|')) {
      bib = bib.split('|')[3] || ''; // fall back to the engraving ticket's bib field
    }
    if (!bib) return false;
    return submitRead(bib, undefined, 'camera');
  };

  const searchResults = useMemo(() => {
    const term = normalizeScanValue(runnerSearch);
    if (!term) return [];
    return runnerProfiles
      .filter((runner) => runner.isFreeSlot
        ? normalizeScanValue(runner.bibNumber).includes(term) || normalizeScanValue(runner.chipId || '').includes(term)
        : normalizeScanValue(runner.fullName).includes(term)
          || normalizeScanValue(runner.bibNumber).includes(term)
          || normalizeScanValue(runner.chipId || '').includes(term))
      .sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true }))
      .slice(0, 8);
  }, [runnerProfiles, runnerSearch]);

  // Manual timing staff often only know part of a bib number. Show a small,
  // tap-friendly match list before they record the split so they can verify
  // the runner's name and distance instead of timing the wrong bib by typo.
  const bibSuggestions = useMemo(() => {
    const term = normalizeScanValue(bibInput);
    if (!term || scanSource !== 'keyboard') return [];
    return runnerProfiles
      .filter((runner) => runner.isFreeSlot
        ? normalizeScanValue(runner.bibNumber).includes(term)
        : normalizeScanValue(runner.bibNumber).includes(term)
          || normalizeScanValue(runner.fullName).includes(term))
      .sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true }))
      .slice(0, 6);
  }, [bibInput, runnerProfiles, scanSource]);

  const checkInSearchRunner = async (runner: RunnerProfile) => {
    const saved = await submitRead(runner.bibNumber, undefined, 'keyboard');
    if (saved) setRunnerSearch('');
  };

  // Designed for staff carrying a phone or tablet. This deliberately writes
  // only at the Check-In checkpoint, so it can never create a Start, Finish,
  // or split time while the staff are walking around the venue.
  const checkInFromMobile = async (runner: RunnerProfile) => {
    if (isRaceCompleted) {
      setFeedback({ type: 'warning', text: 'Race timing is closed. Reopen timing first before checking in another runner.' });
      return;
    }
    if (!checkInCheckpoint) {
      setFeedback({ type: 'error', text: 'This race has no Check-In checkpoint yet. Add one in Race Setup before using Mobile Check-In.' });
      return;
    }
    const previousRead = chipReads.find((read) => read.bibNumber === runner.bibNumber && read.checkpointId === checkInCheckpoint.id);
    if (previousRead) {
      setFeedback({ type: 'warning', text: `${runnerTimingName(runner)}${runner.isFreeSlot ? '' : ` • bib ${runner.bibNumber}`} is already checked in at ${formatClockTime(previousRead.timestamp)}.` });
      return;
    }

    setMobileCheckInBib(runner.bibNumber);
    setFeedback(null);
    try {
      const nowIso = new Date().toISOString();
      const record: ChipRead = {
        id: `${race.id}_${runner.bibNumber}_${checkInCheckpoint.id}_${Date.now()}`,
        raceId: race.id,
        bibNumber: runner.bibNumber,
        ...(runner.chipId ? { chipId: runner.chipId } : {}),
        checkpointId: checkInCheckpoint.id,
        timestamp: nowIso,
        source: 'manual',
        recordedBy: uid,
        createdAt: nowIso,
      };
      enqueueScan(record);
      const queuedOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      setFeedback({ type: 'success', text: `${queuedOffline ? 'Saved to this device' : 'Checked in'} ${runnerTimingName(runner)}${runner.isFreeSlot ? '' : ` • bib ${runner.bibNumber}`}.` });
      announceSuccessfulScan();
    } finally {
      setMobileCheckInBib(null);
    }
  };

  const recentReads = useMemo(
    () => [...chipReads]
      .filter((r) => !['__dequeue__', '__restore__', '__dq__', '__reinstate__'].includes(r.checkpointId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 15),
    [chipReads]
  );

  const [updatingRaceStatus, setUpdatingRaceStatus] = useState(false);

  const finishRace = async () => {
    if (!can('timing.finish') || !can('results.publish')) return;
    if (isRaceCompleted || updatingRaceStatus) return;
    const missingFinishers = Math.max(0, runnerProfiles.length - finishedCount);
    const warning = missingFinishers > 0
      ? ` ${missingFinishers} registered runner${missingFinishers === 1 ? '' : 's'} do not have a Finish scan yet.`
      : '';
    if (!window.confirm(`Finish ${race.name}? RFID timing will pause, registration will close, and the current official results will be published.${warning}\n\nYou can reopen timing later only if you need to correct a result.`)) return;

    setUpdatingRaceStatus(true);
    setScannerArmed(false);
    setArmStartOnEnter(false);
    try {
      const completedAt = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'races', race.id), { completedAt, registrationOpen: false });
      batch.set(doc(db, 'liveResults', race.id), {
        raceId: race.id,
        raceName: race.name,
        updatedAt: completedAt,
        status: 'completed',
        totalRegistered: runnerProfiles.length,
        totalStarted: new Set(chipReads.filter((read) => read.checkpointId === startCheckpoint?.id).map((read) => read.bibNumber)).size,
        totalFinished: finishedCount,
        leaders: publicLeaders,
        officialResults: publicOfficialResults,
      } satisfies PublicLiveResults);
      await batch.commit();
      setFeedback({ type: 'success', text: `Race finished. ${finishedCount} official finisher${finishedCount === 1 ? '' : 's'} are now published in Done Races.` });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not finish the race. Please try again.' });
    } finally {
      setUpdatingRaceStatus(false);
    }
  };

  const republishResults = async () => {
    if (!isRaceCompleted || updatingRaceStatus) return;
    setUpdatingRaceStatus(true);
    try {
      const updatedAt = new Date().toISOString();
      await setDoc(doc(db, 'liveResults', race.id), {
        raceId: race.id,
        raceName: race.name,
        updatedAt,
        status: 'completed',
        totalRegistered: runnerProfiles.length,
        totalStarted: new Set(chipReads.filter((read) => read.checkpointId === startCheckpoint?.id).map((read) => read.bibNumber)).size,
        totalFinished: finishedCount,
        leaders: publicLeaders,
        officialResults: publicOfficialResults,
      } satisfies PublicLiveResults);
      setFeedback({ type: 'success', text: `Published ${finishedCount} official finisher${finishedCount === 1 ? '' : 's'} to the public results page.` });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not republish results. Please try again.' });
    } finally {
      setUpdatingRaceStatus(false);
    }
  };

  const reopenTiming = async () => {
    if (!can('timing.reopen')) return;
    if (!isRaceCompleted || updatingRaceStatus) return;
    if (!window.confirm(`Reopen timing for ${race.name}? This keeps all recorded results, but allows new scans and corrections. Registration stays closed.`)) return;
    setUpdatingRaceStatus(true);
    try {
      await updateDoc(doc(db, 'races', race.id), { completedAt: deleteField() });
      setFeedback({ type: 'success', text: 'Race timing reopened. Results will update as you record corrections; registration remains closed.' });
    } catch (error: any) {
      setFeedback({ type: 'error', text: error.message || 'Could not reopen race timing. Please try again.' });
    } finally {
      setUpdatingRaceStatus(false);
    }
  };

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
          {isRaceCompleted ? (
            <>
              <button hidden={!can('results.publish')} type="button" onClick={() => void republishResults()} disabled={updatingRaceStatus} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-cyan-500 hover:bg-cyan-500/20 disabled:opacity-50 transition">
                {updatingRaceStatus ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trophy className="w-3 h-3" />} Republish results
              </button>
              <button hidden={!can('timing.reopen')} type="button" onClick={() => void reopenTiming()} disabled={updatingRaceStatus} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50 transition">
                {updatingRaceStatus ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Race complete · Reopen timing
              </button>
            </>
          ) : (
            <button hidden={!can('timing.finish')} type="button" onClick={() => void finishRace()} disabled={updatingRaceStatus} className="inline-flex items-center gap-1.5 rounded-full border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500 hover:text-white disabled:opacity-50 transition">
              {updatingRaceStatus ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Finish race & publish results
            </button>
          )}
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
      <div className="racepulse-horizontal-scroll flex gap-2 glass-inset p-1.5 w-max">
        <button
          onClick={() => setMode('mobile-checkin')}
          className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 rounded-[16px] transition ${mode === 'mobile-checkin' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Smartphone className="w-3.5 h-3.5" /> Mobile Check-In
        </button>
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
      {mode === 'mobile-checkin' && (
        <MobileCheckInPanel
          raceId={race.id}
          raceName={race.name}
          runners={runnerProfiles}
          chipReads={chipReads}
          checkInCheckpoint={checkInCheckpoint}
          checkedInCount={checkInCount}
          raceCompleted={isRaceCompleted}
          checkingBib={mobileCheckInBib}
          feedback={feedback}
          onCheckIn={checkInFromMobile}
        />
      )}
      {mode === 'roster' && <div className="space-y-4"><EntrySequencePanel race={race} runners={runnerProfiles} chipReads={chipReads} /><RunnerRosterPanel race={race} runnerProfiles={runnerProfiles} /></div>}
      {mode === 'rankings' && (
        <RaceRankingsPanel
          race={race}
          results={results}
          recentlyDequeued={recentlyDequeued}
          busyFinisherBib={busyFinisherBib}
          onDequeueFinisher={dequeueFinisher}
          onDisqualifyFinisher={disqualifyFinisher}
          onReinstateFinisher={reinstateFinisher}
          onRestoreDequeued={restoreDequeuedFinisher}
          onDismissDequeued={(bibNumber) => setRecentlyDequeued((current) => current.filter((item) => item.bibNumber !== bibNumber))}
        />
      )}
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
      {queueError && <p role="alert" className="text-amber-500">{queueError}</p>}
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
          <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-black tracking-widest uppercase px-2.5 py-1.5 rounded-full border ${scanSource === 'keyboard' || scannerArmed ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500' : 'bg-amber-500/10 border-amber-500/30 text-amber-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${scanSource === 'keyboard' || scannerArmed ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} /> {scanSource === 'keyboard' ? 'Keyboard Scanner Ready' : scannerArmed ? 'VF-787P Armed' : 'VF-787P Paused'}
          </span>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Day Station</label>
          <div className="flex flex-wrap gap-2">
            {orderedCheckpoints.map((cp, index) => {
              const phase = checkpointType(cp, index, orderedCheckpoints.length);
              const phaseLabel = phase === 'checkin' ? 'Check-In' : phase === 'start' ? 'Start' : phase === 'finish' ? 'Finish' : cp.cutoffMinutes ? `Cutoff ${cp.cutoffMinutes}m` : 'Split';
              return (
              <button hidden={!can('timing.scan')}
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

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Scanner input</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button hidden={!can('timing.scan')}
              type="button"
              onClick={() => {
                setScanSource('keyboard');
                setScannerArmed(false);
                setFeedback({ type: 'success', text: 'Keyboard scanner selected. Scan the bib or chip into the field, then Enter to record.' });
              }}
              className={`text-left rounded-[14px] border px-3.5 py-3 transition ${scanSource === 'keyboard' ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-500' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:border-emerald-500/25'}`}
            >
              <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><Keyboard className="w-4 h-4" /> Keyboard scanner</span>
              <span className="block text-[10.5px] mt-1 opacity-80">USB/Bluetooth scanner types then sends Enter.</span>
            </button>
            <button hidden={!can('timing.scan')}
              type="button"
              onClick={() => {
                setScanSource('vf787p');
                setScannerArmed(false);
                setFeedback({ type: 'warning', text: 'VF-787P selected. Choose the station, then arm the reader when you are ready to accept live tag reads.' });
              }}
              className={`text-left rounded-[14px] border px-3.5 py-3 transition ${scanSource === 'vf787p' ? 'border-cyan-500/45 bg-cyan-500/10 text-cyan-400' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:border-cyan-500/25'}`}
            >
              <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><Radio className="w-4 h-4" /> VF-787P bridge</span>
              <span className="block text-[10.5px] mt-1 opacity-80">Automatic reads from the Windows Timing Station.</span>
            </button>
          </div>
        </div>

        {(selectedCheckpointType === 'checkin' || selectedCheckpoint?.cutoffMinutes) && (
          <div className={`glass-inset px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${selectedCheckpoint?.cutoffMinutes ? 'border-amber-500/30' : ''}`}>
            {selectedCheckpointType === 'checkin' && <span className="font-bold text-[var(--text-primary)]">{checkInCount} / {runnerProfiles.length} runners checked in</span>}
            {selectedCheckpoint?.cutoffMinutes && <span className="font-bold text-amber-500">Cutoff: {selectedCheckpoint.cutoffMinutes} min after each runner's distance wave start</span>}
          </div>
        )}

        {selectedCheckpointType === 'checkin' && (
          <div className="glass-inset p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">Find runner for check-in</label>
              <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Tap a result to check in</span>
            </div>
            <input
              type="search"
              value={runnerSearch}
              onChange={(event) => setRunnerSearch(event.target.value)}
              placeholder="SEARCH NAME, BIB, OR CHIP ID"
              className="w-full glass-inset px-3.5 py-2.5 text-xs font-bold font-mono tracking-wide text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
            {runnerSearch.trim() && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)] px-1 py-2">No runner matches “{runnerSearch}”.</p>
                ) : searchResults.map((runner) => {
                  const alreadyCheckedIn = chipReads.some((read) => read.bibNumber === runner.bibNumber && read.checkpointId === checkInCheckpoint?.id);
                  return (
                    <button
                      key={`${runner.uid}_${runner.bibNumber}`}
                      type="button"
                      disabled={alreadyCheckedIn || recording}
                      onClick={() => { void checkInSearchRunner(runner); }}
                      className={`w-full text-left flex items-center gap-3 rounded-xl border px-3 py-2.5 transition disabled:cursor-not-allowed ${alreadyCheckedIn ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-500' : 'border-transparent glass-panel hover:border-red-500/35 hover:bg-red-500/5'}`}
                    >
                      <span className="font-mono font-black text-xs shrink-0">#{runner.bibNumber}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-[var(--text-primary)]">{runnerTimingName(runner)}</span><span className="block text-[10px] text-[var(--text-secondary)] mt-0.5">{runner.distance}{runner.isFreeSlot ? ' • Free Slot' : ''}{runner.chipId ? ` • chip ${runner.chipId}` : ''}</span></span>
                      <span className="text-[9px] font-black uppercase tracking-wide shrink-0">{alreadyCheckedIn ? 'Checked in' : 'Check in'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className={`rounded-[16px] border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${scanSource === 'keyboard' || scannerArmed ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <div className="flex items-start gap-2.5">
            {scanSource === 'keyboard' ? <Keyboard className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> : scannerArmed ? <Radio className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> : <Circle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
            <div>
              <p className={`text-xs font-black uppercase tracking-wide ${scanSource === 'keyboard' || scannerArmed ? 'text-emerald-500' : 'text-amber-500'}`}>
                {scanSource === 'keyboard' ? 'Keyboard scanner is ready' : scannerArmed ? `VF-787P ${stationName} is armed` : `VF-787P ${stationName} is paused`}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {scanSource === 'keyboard'
                  ? 'Use a USB/Bluetooth keyboard scanner or type a registered bib/chip, then press Enter. VF-787P bridge reads are ignored in this mode.'
                  : scannerArmed
                  ? 'Live tag reads from the bridge will record at this station. Pause it before changing station or moving the carpet.'
                  : 'Nearby chips are ignored until you arm this station. Manual bib entry and camera scan still work.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={scanSource === 'keyboard' ? () => scanInputRef.current?.focus() : scannerArmed ? pauseAutomaticScanner : armAutomaticScanner}
            disabled={isRaceCompleted}
            className={`min-h-11 shrink-0 px-5 py-3 rounded-[14px] text-xs font-black uppercase tracking-widest transition active:scale-[0.98] ${scannerArmed ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/25'}`}
          >
            {isRaceCompleted ? 'Race timing closed' : scanSource === 'keyboard' ? 'Focus keyboard input' : scannerArmed ? 'Pause VF-787P' : `Arm ${stationName}`}
          </button>
        </div>

        {pendingScanCount > 0 && (
          <div className="px-4 py-3 rounded-[14px] border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 flex items-start gap-2">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
            <span><strong>{pendingScanCount} scan{pendingScanCount === 1 ? '' : 's'} safely stored on this device.</strong> Keep scanning. RacePulsePH will automatically sync them when the internet reconnects.</span>
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <div className="relative min-w-0">
            <input
              ref={scanInputRef}
              type="text"
              placeholder={scanSource === 'keyboard' ? 'SCAN WITH KEYBOARD OR TYPE BIB' : 'VF-787P MODE: USE CAMERA OR SWITCH TO KEYBOARD'}
              value={bibInput}
              onChange={(e) => setBibInput(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label="RFID chip or runner bib scan input"
              disabled={scanSource !== 'keyboard' || recording}
              className="min-h-[68px] w-full glass-inset px-5 py-4 text-base sm:text-lg font-black font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
            />
            {bibSuggestions.length > 0 && !recording && (
              <div className="absolute z-30 left-0 right-0 top-[calc(100%+0.45rem)] overflow-hidden rounded-[16px] border border-emerald-500/45 bg-[var(--surface-card)] shadow-2xl shadow-black/25">
                <p className="border-b border-[var(--border-default)] bg-[var(--surface-inset)] px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Matching runners: tap to select</p>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {bibSuggestions.map((runner) => (
                    <button
                      key={`${runner.uid}_${runner.bibNumber}`}
                      type="button"
                      onClick={() => {
                        setBibInput(runner.bibNumber);
                        scanInputRef.current?.focus();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl bg-[var(--surface-card)] px-3 py-2.5 text-left transition hover:bg-emerald-500/10 active:bg-emerald-500/20"
                    >
                      <span className="w-[5.75rem] shrink-0 font-mono text-sm font-black text-[var(--text-primary)]">#{runner.bibNumber}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-black text-[var(--text-primary)]">{runnerTimingName(runner)}</span>
                        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">{runner.distance} • {entryCategoryLabels[runnerEntryCategory(runner)]}{runner.isFreeSlot ? ' • Free Slot' : ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={scanSource !== 'keyboard' || recording}
            className="min-h-[68px] text-sm font-black uppercase tracking-widest px-7 py-4 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-xl shadow-red-900/40 flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-60"
          >
            {recording ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Clock className="w-5 h-5" />} {actionLabel}
          </button>
          <button hidden={!can('timing.scan')}
            type="button"
            onClick={() => { setFeedback(null); setShowScanModal(true); }}
            className="min-h-[68px] text-sm font-black uppercase tracking-widest px-7 py-4 rounded-[var(--radius-control)] bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-950/30 flex items-center justify-center gap-2 transition active:scale-[0.98]"
          >
            <QrCode className="w-5 h-5" /> Camera Scan
          </button>
        </form>

        {feedback && (
          <p role="status" className={`text-xs sm:text-sm font-bold px-4 py-3 rounded-[14px] border ${feedback.type === 'success' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' : feedback.type === 'warning' ? 'text-amber-500 bg-amber-500/10 border-amber-500/30' : 'text-red-500 bg-red-500/10 border-red-500/25'}`}>
            {feedback.type === 'success' ? '✓ Scan saved' : feedback.type === 'warning' ? '⚠ Duplicate warning' : '⚠ Scan issue'} <span className="font-medium">: {feedback.text}</span>
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
              <div key={r.id} className="flex items-center justify-between gap-2 glass-inset px-3 py-2 text-xs">
                <span className="font-mono font-bold text-[var(--text-primary)] flex items-center gap-1.5"><span>#{r.bibNumber}</span>{r.source === 'rfid-bridge' && <Cpu className="w-3 h-3 text-emerald-500" aria-label="RFID scan" />}</span>
                <span className="text-[var(--text-secondary)]">{checkpointLabel(r.checkpointId)}</span>
                <span className="font-mono text-[var(--text-muted)]">{formatClockTime(r.timestamp)}</span>
                {(authority || can('timing.correct')) && (
                  <button
                    type="button"
                    onClick={() => { void undoTimingRead(r); }}
                    className="shrink-0 min-h-[32px] rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 transition hover:bg-amber-500 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    title={`Undo ${checkpointLabel(r.checkpointId)} timing read for Bib #${r.bibNumber}`}
                  >
                    <span className="flex items-center gap-1"><Undo2 className="h-3 w-3" /> Undo</span>
                  </button>
                )}
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
            {results.map((r) => {
              const missingCheckpoints = orderedCheckpoints
                .filter((checkpoint) => !r.splits.some((split) => split.checkpointId === checkpoint.id))
                .map((checkpoint) => checkpointLabel(checkpoint.id));
              const anomalies = !r.disqualified ? finisherAnomalyLabels(r) : [];
              const busy = busyFinisherBib === r.bibNumber;
              return (
                <div key={r.bibNumber} className="flex items-center justify-between glass-inset px-3 py-2 text-xs gap-2">
                  <span className={`font-mono font-bold w-9 shrink-0 ${r.disqualified ? 'text-rose-700 dark:text-rose-400' : 'text-red-500'}`}>
                    {r.disqualified ? 'DQ' : r.rank ? `#${r.rank}` : '-'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">
                      <span className={`font-bold ${r.disqualified ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                        {r.runnerProfile?.fullName || `Bib ${r.bibNumber}`}
                      </span>
                      <span className="text-[var(--text-muted)]"> &bull; #{r.bibNumber}</span>
                    </span>
                    {r.disqualified && r.dqReason && (
                      <span className="block truncate text-[10px] font-semibold text-rose-700 dark:text-rose-400">DQ: {r.dqReason}</span>
                    )}
                    {anomalies.length > 0 && (
                      <span className="block truncate text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        Flag: {anomalies[0]}
                      </span>
                    )}
                  </span>
                  <span className={`font-mono font-bold text-right shrink-0 ${r.disqualified ? 'line-through text-[var(--text-muted)]' : r.finishTime ? 'text-[var(--text-primary)]' : 'text-amber-500'}`}>
                    {r.finishTime ? formatRaceTime(r.finishTime) : (missingCheckpoints.length ? `Missing: ${missingCheckpoints.join(', ')}` : 'Needs review')}
                  </span>
                  {canManageFinishers && r.disqualified && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { void reinstateFinisher(r); }}
                      className="shrink-0 min-h-[32px] rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                    >
                      Reinstate
                    </button>
                  )}
                  {canManageFinishers && !r.disqualified && r.finishTime && finishCheckpoint && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const approved = await confirm({
                          title: `Dequeue finish scan for Bib #${r.bibNumber}?`,
                          message: `Removes ${runnerTimingName(r.runnerProfile, r.bibNumber)} from finishers and lets them re-scan at the finish line. Use Rankings -> Dequeue / DQ if you want to mark a rule DQ instead.`,
                          confirmLabel: 'Dequeue finish',
                          cancelLabel: 'Cancel',
                          destructive: true,
                        });
                        if (approved) await dequeueFinisher(r);
                      }}
                      className="shrink-0 min-h-[32px] rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 transition hover:bg-amber-500 hover:text-black disabled:opacity-50"
                      title={`Dequeue finish scan for Bib #${r.bibNumber}`}
                    >
                      Dequeue
                    </button>
                  )}
                </div>
              );
            })}
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

// ========== MOBILE CHECK-IN ==========

interface MobileCheckInPanelProps {
  raceId: string;
  raceName: string;
  runners: RunnerProfile[];
  chipReads: ChipRead[];
  checkInCheckpoint?: Race['checkpoints'][number];
  checkedInCount: number;
  raceCompleted: boolean;
  checkingBib: string | null;
  feedback: ScanFeedback | null;
  onCheckIn: (runner: RunnerProfile) => Promise<void>;
}

function MobileCheckInPanel({
  raceId,
  raceName,
  runners,
  chipReads,
  checkInCheckpoint,
  checkedInCount,
  raceCompleted,
  checkingBib,
  feedback,
  onCheckIn,
}: MobileCheckInPanelProps) {
  const { can, authority } = useAccess();
  const [search, setSearch] = useState('');
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrScanError, setQrScanError] = useState('');
  const [pendingQrRunner, setPendingQrRunner] = useState<RunnerProfile | null>(null);
  const normalizedSearch = normalizeScanValue(search);
  const checkedInBibs = useMemo(() => new Set(
    checkInCheckpoint
      ? chipReads.filter((read) => read.checkpointId === checkInCheckpoint.id).map((read) => read.bibNumber)
      : []
  ), [checkInCheckpoint, chipReads]);
  const runnerByBib = useMemo(() => new Map(runners.map((runner) => [normalizeScanValue(runner.bibNumber), runner])), [runners]);
  const results = useMemo(() => {
    if (!normalizedSearch) return [];
    return runners
      .filter((runner) => {
        if (runner.isFreeSlot) return normalizeScanValue(runner.bibNumber).includes(normalizedSearch);
        const memberNames = (runner.teamMembers || []).join(' ');
        return normalizeScanValue(runner.bibNumber).includes(normalizedSearch)
          || normalizeScanValue(`${runner.fullName} ${memberNames}`).includes(normalizedSearch);
      })
      .sort((a, b) => {
        const aExact = normalizeScanValue(a.bibNumber) === normalizedSearch ? -1 : 0;
        const bExact = normalizeScanValue(b.bibNumber) === normalizedSearch ? -1 : 0;
        return aExact - bExact || a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true });
      })
      .slice(0, 15);
  }, [normalizedSearch, runners]);
  const recentCheckIns = useMemo(() => chipReads
    .filter((read) => read.checkpointId === checkInCheckpoint?.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6), [checkInCheckpoint?.id, chipReads]);

  const handleCheckInQr = async (text: string): Promise<boolean> => {
    const parts = text.trim().split('|');
    if (parts[0] !== 'RPCHIPv1') {
      setQrScanError('This is not a RacePulsePH race bib QR code.');
      return false;
    }
    if (parts[1] !== raceId) {
      setQrScanError('This race bib belongs to a different event.');
      return false;
    }
    const bibNumber = normalizeScanValue(parts[2] || '');
    const runner = runnerByBib.get(bibNumber);
    if (!runner) {
      setQrScanError(`Bib ${bibNumber || 'unknown'} is not in this race roster.`);
      return false;
    }
    setQrScanError('');
    setSearch(runner.bibNumber);
    setShowQrScanner(false);
    setPendingQrRunner(runner);
    return true;
  };

  const confirmQrCheckIn = async () => {
    if (!pendingQrRunner) return;
    await onCheckIn(pendingQrRunner);
    setPendingQrRunner(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <section className="glass-panel overflow-hidden">
        <div className="p-5 sm:p-7 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100 flex items-center gap-2"><Smartphone className="w-4 h-4" /> Staff mobile mode</p>
              <h2 className="font-display font-black text-2xl sm:text-3xl uppercase tracking-tight mt-2">Mobile Check-In</h2>
              <p className="text-sm text-emerald-50/90 mt-2">Scan the QR on the race bib, or search by bib number or name. Free Slots are searched by bib only.</p>
            </div>
            <div className="shrink-0 text-right rounded-2xl bg-black/15 px-4 py-3 border border-white/15">
              <p className="font-mono font-black text-2xl leading-none">{checkedInCount}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-100 mt-1">of {runners.length} checked in</p>
            </div>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-100/80 mt-5 truncate">{raceName} {checkInCheckpoint ? `• ${checkInCheckpoint.label}` : ''}</p>
        </div>

        {!checkInCheckpoint ? (
          <div className="p-5 text-sm font-semibold text-amber-500 bg-amber-500/10">
            Add a Check-In checkpoint in Race Setup first. This mobile tool only records attendance and never creates a timing split.
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            <button hidden={!can('timing.scan')} type="button" onClick={() => { setQrScanError(''); setShowQrScanner(true); }} disabled={raceCompleted} className="w-full min-h-14 rounded-[18px] bg-violet-600 hover:bg-violet-500 disabled:opacity-55 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition active:scale-[0.98] flex items-center justify-center gap-2"><QrCode className="w-5 h-5" /> Scan race bib QR</button>
            <label className="sr-only" htmlFor="mobile-checkin-search">Search runner</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
              <input
                id="mobile-checkin-search"
                type="search"
                inputMode="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search bib number or runner name"
                autoComplete="off"
                className="w-full min-h-16 rounded-[18px] glass-inset pl-12 pr-4 py-4 text-base sm:text-lg font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
              />
            </div>

            {search.trim() && (
              <div className="space-y-2">
                {results.length === 0 ? (
                  <p className="text-center text-sm text-[var(--text-secondary)] py-6">No runner matches “{search}”. Check the spelling or bib number.</p>
                ) : results.map((runner) => {
                  const alreadyCheckedIn = checkedInBibs.has(runner.bibNumber);
                  const isBusy = checkingBib === runner.bibNumber;
                  return (
                    <div key={`${runner.uid}_${runner.bibNumber}`} className={`rounded-[18px] border p-3.5 sm:p-4 flex items-center gap-3 ${alreadyCheckedIn ? 'border-emerald-500/25 bg-emerald-500/5' : 'glass-inset border-transparent'}`}>
                      <span className="shrink-0 rounded-xl bg-black/10 px-2.5 py-2 font-mono font-black text-sm text-[var(--text-primary)]">#{runner.bibNumber}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm sm:text-base text-[var(--text-primary)] leading-tight">{runnerTimingName(runner)}</p>
                        <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">{runner.distance}{runner.isFreeSlot ? ' • Free Slot' : runner.entryCategory ? ` • ${entryCategoryLabels[runner.entryCategory] || runner.entryCategory}` : ''}</p>
                      </div>
                      {alreadyCheckedIn ? (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-500"><CheckCircle2 className="w-4 h-4" /> Done</span>
                      ) : (
                        <button
                          type="button"
                          disabled={raceCompleted || !!checkingBib}
                          onClick={() => { void onCheckIn(runner); }}
                          className="shrink-0 min-h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-55 px-3 sm:px-4 text-[11px] font-black uppercase tracking-wide text-white transition active:scale-[0.98]"
                        >
                          {isBusy ? 'Saving…' : <span className="inline-flex items-center gap-1.5"><UserCheck className="w-4 h-4" /> Check in</span>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {feedback && (
        <p role="status" className={`text-sm font-bold px-4 py-3.5 rounded-[16px] border ${feedback.type === 'success' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' : feedback.type === 'warning' ? 'text-amber-500 bg-amber-500/10 border-amber-500/30' : 'text-red-500 bg-red-500/10 border-red-500/25'}`}>
          {feedback.type === 'success' ? '✓ Check-in saved' : feedback.type === 'warning' ? '⚠ Check-in notice' : '⚠ Check-in issue'} <span className="font-medium">: {feedback.text}</span>
        </p>
      )}

      <section className="glass-panel p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Recent mobile/live check-ins</h3>
          <span className="text-[10px] font-bold text-[var(--text-muted)]">Live sync</span>
        </div>
        <div className="space-y-1.5">
          {recentCheckIns.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)] py-2">No runners checked in yet.</p>
          ) : recentCheckIns.map((read) => (
            <div key={read.id} className="flex items-center gap-3 glass-inset px-3 py-2.5 rounded-xl">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">{runnerTimingName(runnerByBib.get(normalizeScanValue(read.bibNumber)), read.bibNumber)}</span>
              <span className="font-mono text-xs font-bold text-[var(--text-secondary)]">#{read.bibNumber}</span>
              <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatClockTime(read.timestamp)}</span>
            </div>
          ))}
        </div>
      </section>

      {showQrScanner && (
        <QrScannerModal
          onClose={() => setShowQrScanner(false)}
          onScanSuccess={handleCheckInQr}
          successMessage=""
          errorMessage={qrScanError}
          title="Mobile Race Bib Scanner"
          subtitle="SCAN TO CHECK IN"
          instructions="Point the phone camera at the QR code printed on the runner's race bib. Review the runner details, then confirm their check-in."
        />
      )}

      {pendingQrRunner && (() => {
        const alreadyCheckedIn = checkedInBibs.has(pendingQrRunner.bibNumber);
        const isSaving = checkingBib === pendingQrRunner.bibNumber;
        const entry = runnerEntryCategory(pendingQrRunner);
        const emergencyContact = [pendingQrRunner.emergencyContactName, pendingQrRunner.emergencyContactPhone].filter(Boolean).join(' · ');
        return (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/75 p-3 sm:p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="checkin-confirm-title">
            <div className="w-full max-w-lg overflow-hidden rounded-[26px] border border-emerald-500/30 bg-[var(--surface-card)] shadow-2xl">
              <div className="border-b border-emerald-500/20 bg-gradient-to-br from-emerald-600 to-emerald-800 p-5 text-white">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-100">Race bib verified</p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 id="checkin-confirm-title" className="font-display text-2xl font-black uppercase tracking-tight">Confirm Runner</h3>
                    <p className="mt-1 text-sm text-emerald-50/90">Review the details before recording attendance.</p>
                  </div>
                  <span className="rounded-xl border border-white/20 bg-black/15 px-3 py-2 font-mono text-base font-black">#{pendingQrRunner.bibNumber}</span>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
                  <p className="text-xl font-black leading-tight text-[var(--text-primary)]">{runnerTimingName(pendingQrRunner)}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{pendingQrRunner.distance} · {entryCategoryLabels[entry]}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Race bib</dt><dd className="mt-0.5 font-mono font-black text-[var(--text-primary)]">#{pendingQrRunner.bibNumber}</dd></div>
                  <div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Category</dt><dd className="mt-0.5 font-bold text-[var(--text-primary)]">{entryCategoryLabels[entry]}</dd></div>
                  {!pendingQrRunner.isFreeSlot && <><div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Gender</dt><dd className="mt-0.5 font-bold capitalize text-[var(--text-primary)]">{pendingQrRunner.gender}</dd></div><div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Age</dt><dd className="mt-0.5 font-bold text-[var(--text-primary)]">{pendingQrRunner.ageNotProvided ? 'Not provided' : pendingQrRunner.age}</dd></div></>}
                  {pendingQrRunner.shirtSize && <div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Shirt size</dt><dd className="mt-0.5 font-bold text-[var(--text-primary)]">{pendingQrRunner.shirtSize}</dd></div>}
                  {pendingQrRunner.chipId && <div><dt className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">RFID chip</dt><dd className="mt-0.5 truncate font-mono text-xs font-bold text-[var(--text-primary)]">{pendingQrRunner.chipId}</dd></div>}
                </dl>
                {(pendingQrRunner.teamName || (pendingQrRunner.teamMembers?.length || 0) > 1) && <div className="rounded-xl border border-[var(--border-default)] px-3 py-2.5"><p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Team / members</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{pendingQrRunner.teamName || pendingQrRunner.teamMembers?.join(' · ')}</p></div>}
                {emergencyContact && <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5"><p className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Emergency contact</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{emergencyContact}</p></div>}
                {alreadyCheckedIn && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs font-semibold text-amber-600 dark:text-amber-400">This runner is already checked in. No new attendance record will be added.</p>}
              </div>

              <div className="flex gap-3 border-t border-[var(--border-default)] p-4">
                <button type="button" onClick={() => setPendingQrRunner(null)} disabled={isSaving} className="min-h-12 flex-1 rounded-xl border border-[var(--border-default)] px-4 text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-55">{alreadyCheckedIn ? 'Close' : 'Cancel'}</button>
                {!alreadyCheckedIn && <button type="button" onClick={() => { void confirmQrCheckIn(); }} disabled={raceCompleted || isSaving} className="min-h-12 flex-[1.4] rounded-xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-500 disabled:opacity-55">{isSaving ? 'Checking in…' : 'Confirm Check-In'}</button>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ========== CHIP ASSIGNMENT ==========

type ImportedRunner = Pick<RunnerProfile, 'fullName' | 'bibNumber' | 'distance' | 'gender' | 'age' | 'ageNotProvided' | 'shirtSize' | 'entryCategory' | 'teamMembers'> & {
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

// Older CSV imports were interpreted as spreadsheet dates by SheetJS. For
// example a valid physical bib `12-20-01` arrived as `12/20/01`. This helper
// is intentionally used only when locating an existing imported row, so a
// re-import repairs those old records without treating slash-form bibs as the
// new stored format.
function importBibMatchKey(value: unknown): string {
  const bib = normalizeImportBib(value);
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(bib) ? bib.replaceAll('/', '-') : bib;
}

function importGender(value: unknown): RunnerProfile['gender'] | null {
  const normalized = spreadsheetText(value).toLowerCase();
  if (normalized.startsWith('m')) return 'male';
  if (normalized.startsWith('f')) return 'female';
  return null;
}

function importEntryCategory(value: unknown): RaceEntryCategory {
  const category = spreadsheetText(value).toLowerCase();
  if (category.includes('group') || category.includes('team')) return 'group';
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
      // Sex is only used to rank an individual in a Solo division. A Duo,
      // Trio, or Group can be mixed, so permit a blank column for team rows.
      // RunnerProfile still requires a value for legacy Firestore records;
      // that internal fallback is never used to split team results by gender.
      const genderIsRequired = entryCategory === 'solo';
      // A Group is ranked as one team and never enters an individual age
      // division, so its roster can omit Age/DOB. We retain an explicit flag
      // instead of showing Firestore's required numeric fallback as a real age.
      const ageIsRequired = entryCategory !== 'group';
      const ageNotProvided = age === null;

      if (!fullName && !bibNumber) return;
      if (!fullName || !bibNumber || !distance || (genderIsRequired && !gender) || (ageIsRequired && age === null)) {
        const missing = [
          !fullName && 'name',
          !bibNumber && 'bib',
          !distance && 'a matching race distance',
          genderIsRequired && !gender && 'sex/gender (Solo only)',
          ageIsRequired && age === null && 'valid age or date of birth (Group optional)',
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
        gender: gender || 'male',
        // `age` is required by the existing runner schema. This internal
        // placeholder is ignored for all Group results and is hidden by the
        // `ageNotProvided` marker below.
        age: age ?? 18,
        ageNotProvided,
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
  const { can, authority } = useAccess();
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
      setTeamMembers(['', '', '', '']);
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
        <p className="text-xs text-[var(--text-secondary)] mt-1">For late registrations or paper-form entries. This adds a race roster entry only (no login account is created).</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3"><fieldset className="contents" disabled={!can('roster.add')} >
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
      </fieldset></form>
      {feedback && <p className={`text-xs font-semibold ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>{feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}</p>}
    </div>
  );
}

interface RosterImportPanelProps {
  race: Race;
  runnerProfiles: RunnerProfile[];
}

function RosterImportPanel({ race, runnerProfiles }: RosterImportPanelProps) {
  const { can, authority } = useAccess();
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
      // CSV has no column typing. Without `raw: true`, SheetJS sees a bib
      // such as 12-20-01 as a calendar date and formats it as 12/20/01.
      // Keep CSV values as literal text; Excel files still retain their
      // normal cell formatting and date support for date-of-birth columns.
      const isCsv = /\.csv$/i.test(file.name);
      const workbook = XLSX.read(data, { type: 'array', cellDates: !isCsv, raw: isCsv });
      const parsed = parseRosterWorkbook(workbook, file.name, race);
      if (parsed.detectedSheets.length === 0) {
        setFeedback({ type: 'error', text: 'No importable roster tab found. The file needs Full name, Race bib number, Distance, Entry category, and Age or Date of birth. Sex/Gender is required only for Solo.' });
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
    const existingByBib = new Map(runnerProfiles.map((runner) => [importBibMatchKey(runner.bibNumber), runner]));
    const existingCount = preview.runners.filter((runner) => existingByBib.has(importBibMatchKey(runner.bibNumber))).length;
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
            // Always write an explicit boolean so re-importing a Group with
            // a real age clears any older "not provided" marker.
            ageNotProvided: Boolean(imported.ageNotProvided),
            createdAt: existing?.createdAt || now,
            ...(imported.shirtSize ? { shirtSize: imported.shirtSize } : {}),
            ...(imported.teamMembers && imported.teamMembers.length >= entryMemberCount[imported.entryCategory || 'solo'] ? { teamMembers: imported.teamMembers } : {}),
          };
          batch.set(doc(db, 'runners', `${uid}_${race.id}`), record, { merge: true });
          if (existing) updated += 1;
          else created += 1;
        }
        await batch.commit();
      }
      setFeedback({ type: 'success', text: `Import complete: ${created} created, ${updated} updated. Open the roster below to assign timing chips.` });
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
        Required columns: <strong className="text-[var(--text-primary)]">Full name, Race bib number, Distance, Entry category</strong>, and <strong className="text-[var(--text-primary)]">Age or Date of birth</strong> (optional for Group). <strong className="text-[var(--text-primary)]">Sex/Gender is required for Solo only</strong>; it may be blank for Duo, Trio, and Group. The distance must already exist in this race. Members sharing one bib are combined into one timing entry.
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
          <button hidden={!can('roster.import')} type="button" onClick={handleImport} disabled={importing || preview.runners.length === 0} className="w-full text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 flex items-center justify-center gap-2 transition disabled:opacity-60">
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
  const { can, authority } = useAccess();
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

  const handleDeleteRunner = async () => {
    if (!foundRunner) return;
    if (foundRunner.startsAfterBib || runnerProfiles.some((runner) => runner.startsAfterBib === foundRunner.bibNumber)) {
      setFeedback({ type: 'error', text: 'Unlink consecutive entries in the roster before removing this entry.' });
      return;
    }
    if (selectedHasReads) {
      setFeedback({ type: 'error', text: 'This runner cannot be deleted because timing reads already exist. Preserve the record or ask a Super Admin to correct the race data.' });
      return;
    }
    if (!window.confirm(`Permanently remove ${foundRunner.fullName} (bib #${foundRunner.bibNumber}) from this race roster? This cannot be undone.`)) return;

    setSaving(true);
    setFeedback(null);
    try {
      await deleteDoc(doc(db, 'runners', `${foundRunner.uid}_${race.id}`));
      setBibInput('');
      setChipInput('');
      setNextBib('');
      setEditingBib(false);
      setFeedback({ type: 'success', text: `${foundRunner.fullName} (bib #${foundRunner.bibNumber}) was removed from the race roster.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to remove the runner.' });
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

  const handleConfirmManualPayment = async () => {
    if (!foundRunner || foundRunner.paymentStatus !== 'pending' || foundRunner.paymentMethod !== 'manual') return;
    const amount = Number(foundRunner.paymentAmount || 0);
    const reference = foundRunner.paymentReference || 'No reference supplied';
    if (!window.confirm(`Mark manual payment received for ${foundRunner.fullName} (bib #${foundRunner.bibNumber})?\n\nAmount: ₱${amount.toFixed(2)}\nReference: ${reference}\n\nOnly continue after you have verified this transaction in your Cash, GCash, or bank dashboard.`)) return;

    setSaving(true);
    setFeedback(null);
    try {
      const paidAt = new Date().toISOString();
      await updateDoc(doc(db, 'runners', `${foundRunner.uid}_${race.id}`), {
        paymentStatus: 'paid',
        paymentMethod: 'manual',
        paymentId: `manual_${race.id}_${foundRunner.uid}`.slice(0, 120),
        paymentPaidAt: paidAt,
      });
      setFeedback({ type: 'success', text: `Manual payment confirmed for ${foundRunner.fullName} • ₱${amount.toFixed(2)}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Could not confirm manual payment.' });
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
    if (foundRunner.startsAfterBib || runnerProfiles.some((runner) => runner.startsAfterBib === foundRunner.bibNumber)) {
      setFeedback({ type: 'error', text: 'Unlink consecutive entries in the roster before changing this bib number.' });
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
      {can('roster.add') && <ManualRunnerPanel race={race} runnerProfiles={runnerProfiles} />}
      {can('roster.import') && <RosterImportPanel race={race} runnerProfiles={runnerProfiles} />}

      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
              <Cpu className="w-4 h-4 text-red-500" /> Race Kit Assignment
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Select the race bib first, then use the keyboard/USB scanner to capture one chip. Verify the code before assigning it.</p>
          </div>
          <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] shrink-0">{kitClaimedCount} kits claimed &bull; {assignedCount} chips assigned</span>
        </div>

        <div className="h-2 rounded-full bg-[var(--surface-inset)] overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-red-600 to-emerald-500 transition-all" style={{ width: `${runnerProfiles.length ? (assignedCount / runnerProfiles.length) * 100 : 0}%` }} />
        </div>

        <form onSubmit={handleAssign} className="space-y-3"><fieldset className="contents" disabled={!can('roster.chips')} >
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
              <button hidden={!can('roster.chips')} type="button" onClick={() => setShowBibScanner(true)} className="w-12 rounded-[var(--radius-control)] bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition" title="Scan race bib QR">
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
                  {foundRunner.paymentStatus === 'pending' && foundRunner.paymentMethod === 'manual' && (
                    <p className="mt-1 text-[10px] font-bold text-amber-500">Manual payment pending • ₱{Number(foundRunner.paymentAmount || 0).toFixed(2)}{foundRunner.paymentReference ? ` • Ref: ${foundRunner.paymentReference}` : ''}</p>
                  )}
                  {foundRunner.paymentStatus === 'paid' && (
                    <p className="mt-1 text-[10px] font-bold text-emerald-500">Payment confirmed{foundRunner.paymentMethod ? ` • ${foundRunner.paymentMethod}` : ''}</p>
                  )}
                  {foundRunner.emergencyContactName && foundRunner.emergencyContactPhone && (
                    <p className="mt-1 text-[10px] text-amber-500">Emergency: {foundRunner.emergencyContactName} &bull; {foundRunner.emergencyContactPhone}</p>
                  )}
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
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Chip ID</label>
              <span className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1 text-emerald-500"><Keyboard className="w-3 h-3" /> Keyboard scanner only</span>
            </div>
            <input
              ref={chipInputRef}
              type="text"
              placeholder="SCAN CHIP WITH KEYBOARD READER"
              value={chipInput}
              onChange={(e) => setChipInput(e.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (chipInput.trim()) setFeedback({ type: 'success', text: 'Chip captured. Verify the runner and chip ID, then click Assign Chip.' });
              }}
              autoComplete="off"
              autoCapitalize="characters"
              disabled={!foundRunner}
              className="w-full glass-inset px-4 py-3 text-sm font-bold font-mono tracking-wider text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1.5">VF-787P bridge reads are disabled here to prevent a nearby chip from being assigned to the wrong runner.</p>
          </div>

          <button
            type="submit"
            disabled={saving || !foundRunner}
            className="w-full text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />} Assign Chip
          </button>
        </fieldset></form>

        {foundRunner && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {editingBib ? (
              <div className="sm:col-span-2 glass-inset p-3 space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Correct race bib</label>
                <div className="flex gap-2">
                  <input value={nextBib} onChange={(e) => setNextBib(e.target.value.toUpperCase())} className="min-w-0 flex-1 glass-inset px-3 py-2 text-xs font-bold font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
                  <button hidden={!can('roster.bibs')} type="button" onClick={handleBibUpdate} disabled={saving} className="px-3 rounded-[14px] bg-red-600 text-white text-[10px] font-black uppercase tracking-wide disabled:opacity-60">Save</button>
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
              <button hidden={!can('roster.chips')} type="button" onClick={handleUnassign} disabled={saving} className="glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50 transition">
                Remove assigned chip
              </button>
            )}
            {!editingBib && (
              <button hidden={!can('roster.kits')} type="button" onClick={handleKitClaim} disabled={saving} className={`glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide disabled:opacity-50 transition ${foundRunner.kitClaimedAt ? 'text-emerald-500 hover:text-red-500' : 'text-[var(--text-secondary)] hover:text-emerald-500'}`}>
                {foundRunner.kitClaimedAt ? 'Undo kit claimed' : 'Mark kit claimed'}
              </button>
            )}
            {!editingBib && foundRunner.paymentStatus === 'pending' && foundRunner.paymentMethod === 'manual' && (
              <button hidden={!can('payment.confirm')} type="button" onClick={handleConfirmManualPayment} disabled={saving} className="glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-amber-500 hover:text-emerald-500 disabled:opacity-50 transition">
                Confirm manual payment
              </button>
            )}
            {!editingBib && (
              <button hidden={!can('roster.remove')} type="button" onClick={handleDeleteRunner} disabled={saving || selectedHasReads} className="sm:col-span-2 glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition">
                {selectedHasReads ? 'Runner locked after timing reads' : 'Delete runner from race'}
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
  const { can, authority } = useAccess();
  const [settingDistance, setSettingDistance] = useState<string | null>(null);
  const [editingGunTimeDistance, setEditingGunTimeDistance] = useState<string | null>(null);
  const [gunTimeInput, setGunTimeInput] = useState('');

  const startedBibs = useMemo(() => {
    if (!startCheckpointId) return new Set<string>();
    return new Set(chipReads.filter((r) => r.checkpointId === startCheckpointId).map((r) => r.bibNumber));
  }, [chipReads, startCheckpointId]);

  // Free Slots must leave with their matching entry-category wave.  Grouping
  // by the timing wave (rather than display division) prevents a separate
  // Free Slots gun-start button and makes all runners share one official time.
  const distanceGroups = useMemo(() => {
    const groups = new Map<string, RunnerProfile[]>();
    runnerProfiles.forEach((runner) => {
      const wave = runnerWaveLabel(runner);
      const runners = groups.get(wave) || [];
      runners.push(runner);
      groups.set(wave, runners);
    });
    return Array.from(groups.entries())
      .map(([distance, runners]) => ({
        distance,
        runners: runners.sort((a, b) => a.bibNumber.localeCompare(b.bibNumber)),
      }))
      .sort((a, b) => a.distance.localeCompare(b.distance));
  }, [runnerProfiles]);
  const startedCount = runnerProfiles.filter((r) => startedBibs.has(r.bibNumber)).length;

  const handleStartWave = async (distance: string) => {
    if (race.completedAt) {
      alert('This race is already finished. Reopen timing from Record Splits before starting another wave.');
      return;
    }
    setSettingDistance(distance);
    // Open the scan station immediately.  The Firestore update continues in
    // the background so a slow network cannot make the starter miss runners
    // crossing the mat at the gun.
    onOpenStartScanner(distance);
    try {
      const raceRef = doc(db, 'races', race.id);
      const startedAt = new Date().toISOString();
      await runTransaction(db, async (tx) => {
        const currentSnapshot = await tx.get(raceRef);
        const currentRace = currentSnapshot.data() as Race | undefined;
        const waveStartTimes = { ...(currentRace?.waveStartTimes || {}), [distance]: startedAt };
        // Clean up a stale Free Slots clock from an older release. Free Slots
        // now inherit this exact normal division clock.
        delete waveStartTimes[`${distance} Free Slots`];
        // Keep gunStartTime as a first-wave fallback for old screens/races.
        tx.update(raceRef, {
          waveStartTimes,
          gunStartTime: currentRace?.gunStartTime || startedAt,
        });
      });
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
        delete waveStartTimes[`${distance} Free Slots`];
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

  const openGunTimeEditor = (distance: string) => {
    setGunTimeInput(toLocalDateTimeInputValue(getWaveStartTime(race, distance), race.date));
    setEditingGunTimeDistance(distance);
  };

  const handleSaveGunTime = async (distance: string) => {
    const parsedTime = new Date(gunTimeInput);
    if (!gunTimeInput || Number.isNaN(parsedTime.getTime())) {
      alert('Enter the verified gun start date and time first.');
      return;
    }
    if (!window.confirm(`Save ${formatDateTime(parsedTime)} as the official ${distance} gun time? Finishers without an individual Start read will be recalculated using this time.`)) return;

    setSettingDistance(distance);
    try {
      const raceRef = doc(db, 'races', race.id);
      const startedAt = parsedTime.toISOString();
      await runTransaction(db, async (tx) => {
        const currentSnapshot = await tx.get(raceRef);
        const currentRace = currentSnapshot.data() as Race | undefined;
        const waveStartTimes = { ...(currentRace?.waveStartTimes || {}), [distance]: startedAt };
        delete waveStartTimes[`${distance} Free Slots`];
        tx.update(raceRef, {
          waveStartTimes,
          // Retain a legacy shared gun time for older race screens. New
          // result calculation always prefers the distance-specific value.
          gunStartTime: currentRace?.gunStartTime || startedAt,
        });
      });
      setEditingGunTimeDistance(null);
      setGunTimeInput('');
    } catch (err: any) {
      alert(err.message || `Failed to save the ${distance} gun time.`);
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
        <p className="text-xs text-[var(--text-secondary)] mt-1">Fire each distance/category when it leaves the line. Free Slots inherit their matching wave's gun time; cutoffs use that wave's official time.</p>
        {distanceGroups.length === 0 && <p className="text-xs text-[var(--text-secondary)] mt-4">Wave controls appear once runners are registered.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {distanceGroups.map((group) => {
            const waveStartTime = getWaveStartTime(race, group.distance);
            const settingThisWave = settingDistance === group.distance;
            const editingThisWave = editingGunTimeDistance === group.distance;
            return (
              <div key={group.distance} className="glass-inset px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black font-display text-[var(--text-primary)]">{group.distance}</span>
                  {waveStartTime ? <LiveClock gunStartTime={waveStartTime} /> : <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Not started</span>}
                </div>
                {editingThisWave ? (
                  <div className="space-y-2">
                    <label className="block text-[9px] font-black uppercase tracking-widest text-amber-500">Verified official gun time</label>
                    <input
                      type="datetime-local"
                      step="0.001"
                      value={gunTimeInput}
                      onChange={(event) => setGunTimeInput(event.target.value)}
                      disabled={!!settingDistance}
                      className="w-full glass-inset px-3 py-2 text-xs font-bold font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-60"
                    />
                    <p className="text-xs font-mono">{gunTimeInput ? formatClockTime(new Date(gunTimeInput)) : '—'}</p>
                    <p className="text-[9px] leading-relaxed text-[var(--text-secondary)]">Only runners with a Finish read but no individual Start read will use this fallback. Chip-start results stay unchanged.</p>
                    <div className="flex gap-2">
                      <button hidden={!can('timing.reset')} type="button" onClick={() => void handleSaveGunTime(group.distance)} disabled={!!settingDistance} className="flex-1 rounded-[12px] bg-amber-500 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-black disabled:opacity-60">
                        {settingThisWave ? 'Saving…' : 'Save gun time'}
                      </button>
                      <button type="button" onClick={() => { setEditingGunTimeDistance(null); setGunTimeInput(''); }} disabled={!!settingDistance} className="rounded-[12px] glass-inset px-3 py-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] disabled:opacity-60">Cancel</button>
                    </div>
                  </div>
                ) : waveStartTime ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-emerald-500">Gun: {formatClockTime(waveStartTime)}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onOpenStartScanner(group.distance)} disabled={!!settingDistance} className="text-[10px] font-black uppercase tracking-wide text-emerald-500 hover:text-emerald-400 disabled:opacity-50 transition">Arm Start RFID</button>
                      <button type="button" onClick={() => openGunTimeEditor(group.distance)} disabled={!!settingDistance} className="text-[10px] font-black uppercase tracking-wide text-amber-500 hover:text-amber-400 disabled:opacity-50 transition">Correct gun time</button>
                      <button hidden={!can('timing.reset')}
                        onClick={() => handleResetWave(group.distance)}
                        disabled={!!settingDistance}
                        className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-50 flex items-center gap-1 transition"
                      >
                        {settingThisWave ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Reset
                      </button>
                    </div>
                  </div>
                ) : race.completedAt ? (
                  <button
                    type="button"
                    onClick={() => openGunTimeEditor(group.distance)}
                    disabled={!!settingDistance}
                    className="w-full text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-black bg-amber-500 hover:bg-amber-400 flex items-center justify-center gap-2 transition disabled:opacity-60"
                  >
                    Set official gun time
                  </button>
                ) : (
                  <button
                    onClick={() => void handleStartWave(group.distance)}
                    disabled={!!settingDistance}
                    className="w-full text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60"
                  >
                    {settingThisWave ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} {settingThisWave ? 'Starting…' : `Start ${group.distance} & Arm RFID`}
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
                          <span className="flex-1 truncate text-[var(--text-secondary)]">{runnerTimingName(r)}</span>
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
  const { can, authority } = useAccess();
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
        <button hidden={!can('roster.export')}
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
                    <span className="text-[var(--text-secondary)] shrink-0">{r.ageNotProvided ? 'Age —' : `${r.gender === 'male' ? 'M' : 'F'} • ${r.age}`}</span>
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

interface RaceRankingsPanelProps {
  race: Race;
  results: RunnerResult[];
  recentlyDequeued?: DequeuedFinisherRecord[];
  busyFinisherBib?: string | null;
  onDequeueFinisher?: (result: RunnerResult) => Promise<void>;
  onDisqualifyFinisher?: (result: RunnerResult, reason: string) => Promise<void>;
  onReinstateFinisher?: (result: RunnerResult) => Promise<void>;
  onRestoreDequeued?: (entry: DequeuedFinisherRecord) => Promise<void>;
  onDismissDequeued?: (bibNumber: string) => void;
}

function RaceRankingsPanel({
  race,
  results,
  recentlyDequeued = [],
  busyFinisherBib = null,
  onDequeueFinisher,
  onDisqualifyFinisher,
  onReinstateFinisher,
  onRestoreDequeued,
  onDismissDequeued,
}: RaceRankingsPanelProps) {
  const { can, authority } = useAccess();
  const { notify } = useFeedback();
  const [presenting, setPresenting] = useState(false);
  const [reviewWindow, setReviewWindow] = useState(String(race.finishReviewWindowMs ?? 0));
  const [reviewError, setReviewError] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [rankingSearch, setRankingSearch] = useState('');
  const [rankingFilter, setRankingFilter] = useState<'all' | 'flagged' | 'invalidated'>('all');
  const [managingFinisher, setManagingFinisher] = useState<RunnerResult | null>(null);
  const [dqReasonInput, setDqReasonInput] = useState(DQ_PRESET_REASONS[0]);
  const [dqReasonError, setDqReasonError] = useState('');
  const cancelManageRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setReviewWindow(String(race.finishReviewWindowMs ?? 0)), [race.id, race.finishReviewWindowMs]);
  useEffect(() => {
    setRankingSearch('');
    setRankingFilter('all');
    setManagingFinisher(null);
    setDqReasonError('');
  }, [race.id]);

  const saveReviewWindow = async () => {
    const value = Number(reviewWindow);
    if (!reviewWindow.trim() || !Number.isFinite(value) || value < 0 || value > 60000) { setReviewError('Enter a window from 0 to 60000 milliseconds.'); return; }
    setSavingReview(true);
    try { await updateDoc(doc(db, 'races', race.id), { finishReviewWindowMs: value }); setReviewError(''); }
    catch { setReviewError('Could not save the review window.'); }
    finally { setSavingReview(false); }
  };

  const canManageFinishers = Boolean(
    (onDequeueFinisher || onDisqualifyFinisher || onReinstateFinisher)
    && (authority || can('timing.correct') || (can('timing.scan') && !race.completedAt)),
  );

  const rankingFolders = useMemo(() => groupRankingFolders(results), [results]);
  const flaggedResults = useMemo(
    () => results.filter((result) => result.rank !== undefined && finisherAnomalyLabels(result).length > 0),
    [results],
  );
  const disqualifiedResults = useMemo(
    () => results.filter((result) => result.disqualified),
    [results],
  );

  const searchTerm = rankingSearch.trim().toLowerCase().replace(/^#/, '');
  const isSearching = searchTerm.length > 0;

  const matchesFinisherSearch = (bibNumber: string, profile?: RunnerProfile, fallbackName?: string): boolean => {
    if (!searchTerm) return true;
    const candidates = [bibNumber, `Bib ${bibNumber}`];
    if (profile && !profile.isFreeSlot) {
      candidates.push(profile.fullName, ...(profile.teamMembers || []));
    } else if (fallbackName) {
      candidates.push(fallbackName);
    }
    return candidates.some((value) => value.toLowerCase().includes(searchTerm));
  };

  const filteredDisqualified = useMemo(
    () => disqualifiedResults.filter((result) => matchesFinisherSearch(result.bibNumber, result.runnerProfile)),
    [disqualifiedResults, searchTerm],
  );
  const filteredDequeued = useMemo(
    () => recentlyDequeued.filter((entry) => matchesFinisherSearch(entry.bibNumber, undefined, entry.runnerName)),
    [recentlyDequeued, searchTerm],
  );

  const folderSourceResults = rankingFilter === 'flagged' ? flaggedResults : results;
  const visibleFolders = useMemo(
    () => groupRankingFolders(folderSourceResults, rankingSearch),
    [folderSourceResults, rankingSearch],
  );

  const matchCount = visibleFolders.reduce((sum, folder) => sum + folder.finisherCount, 0);
  const totalFinishers = rankingFolders.reduce((sum, folder) => sum + folder.finisherCount, 0);
  const flaggedCount = flaggedResults.length;
  const invalidatedCount = disqualifiedResults.length + recentlyDequeued.length;

  const openManageFinisher = (result: RunnerResult) => {
    setManagingFinisher(result);
    setDqReasonInput(result.missingIntermediateLabels?.length ? 'Missed checkpoint or course cut' : DQ_PRESET_REASONS[0]);
    setDqReasonError('');
  };

  const handleConfirmDequeue = async () => {
    if (!managingFinisher || !onDequeueFinisher) return;
    const target = managingFinisher;
    setManagingFinisher(null);
    await onDequeueFinisher(target);
  };

  const handleConfirmDq = async () => {
    if (!managingFinisher || !onDisqualifyFinisher) return;
    const cleaned = dqReasonInput.trim();
    if (!cleaned) {
      setDqReasonError('Select or enter a disqualification reason.');
      return;
    }
    const target = managingFinisher;
    setManagingFinisher(null);
    await onDisqualifyFinisher(target, cleaned);
  };

  if (presenting) {
    return <LiveRankingsScreen race={race} results={results} onClose={() => setPresenting(false)} />;
  }

  const showRankedFolders = rankingFilter !== 'invalidated';
  const showInvalidatedTray = rankingFilter === 'invalidated'
    || (rankingFilter === 'all' && (isSearching ? (filteredDisqualified.length > 0 || filteredDequeued.length > 0) : invalidatedCount > 0));

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
            <Trophy className="w-4 h-4 text-red-500" /> Live Rankings by Distance
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {totalFinishers} finisher{totalFinishers === 1 ? '' : 's'} ranked so far
            {disqualifiedResults.length > 0 ? ` (${disqualifiedResults.length} DQ excluded)` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!generateRankingsReportPdf(race, results)) {
                notify({ tone: 'info', title: 'No ranked finishers yet', message: 'Record at least one valid finish before exporting the PDF report.' });
              }
            }}
            className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-red-500 hover:text-red-500 flex items-center justify-center gap-2 transition"
          >
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition"
          >
            <Maximize2 className="w-4 h-4" /> Present on Screen
          </button>
        </div>
      </div>

      {(authority || can('timing.correct')) && (
        <div className="space-y-2 text-xs">
          <label className="block">
            Calibrated finish review window (milliseconds)
            <input type="number" min="0" max="60000" step="any" value={reviewWindow} onChange={(event) => setReviewWindow(event.target.value)} className="ml-2 w-28 glass-inset p-2" />
          </label>
          <p>0 flags identical times only. Set a wider window after comparing reader detections with finish-line video. Flagged places remain provisional.</p>
          <button type="button" disabled={savingReview} onClick={() => void saveReviewWindow()} className="glass-inset px-3 py-2">
            {savingReview ? 'Saving…' : 'Save review window'}
          </button>
          {reviewError && <p role="alert">{reviewError}</p>}
        </div>
      )}

      {(rankingFolders.length > 0 || invalidatedCount > 0) ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <label htmlFor="ranking-search" className="sr-only">Search rankings by name or bib number</label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="ranking-search"
                type="search"
                value={rankingSearch}
                onChange={(event) => setRankingSearch(event.target.value)}
                placeholder="Search name or bib number"
                className="w-full glass-inset py-3 pl-10 pr-12 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {rankingSearch && (
                <button
                  type="button"
                  onClick={() => setRankingSearch('')}
                  aria-label="Clear ranking search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-3 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <X aria-hidden="true" className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter finisher views">
              <button
                type="button"
                aria-pressed={rankingFilter === 'all'}
                onClick={() => setRankingFilter('all')}
                className={`min-h-[40px] px-3 py-2 rounded-[12px] text-xs font-bold border transition ${rankingFilter === 'all' ? 'border-red-500 bg-red-600 text-white' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                All Ranked ({totalFinishers})
              </button>
              <button
                type="button"
                aria-pressed={rankingFilter === 'flagged'}
                onClick={() => setRankingFilter('flagged')}
                className={`min-h-[40px] px-3 py-2 rounded-[12px] text-xs font-bold border transition flex items-center gap-1.5 ${rankingFilter === 'flagged' ? 'border-amber-500 bg-amber-500 text-black' : flaggedCount > 0 ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Flagged Splits ({flaggedCount})
              </button>
              <button
                type="button"
                aria-pressed={rankingFilter === 'invalidated'}
                onClick={() => setRankingFilter('invalidated')}
                className={`min-h-[40px] px-3 py-2 rounded-[12px] text-xs font-bold border transition flex items-center gap-1.5 ${rankingFilter === 'invalidated' ? 'border-rose-700 bg-rose-700 text-white' : invalidatedCount > 0 ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'glass-inset border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                <Ban className="w-3.5 h-3.5" aria-hidden="true" /> DQ &amp; Dequeued ({invalidatedCount})
              </button>
            </div>
          </div>

          {showRankedFolders && (
            <div className="space-y-3">
              <p role="status" className="text-xs text-[var(--text-secondary)]">
                {rankingFilter === 'flagged'
                  ? (flaggedCount === 0
                    ? 'No flagged finishers right now. All ranked finishers passed checkpoint and close-finish checks.'
                    : `${matchCount} flagged finisher${matchCount === 1 ? '' : 's'} shown with official rank intact. Review or dequeue/DQ invalid scans below.`)
                  : isSearching
                    ? `${matchCount} matching finisher${matchCount === 1 ? '' : 's'}. Official ranks are shown.`
                    : 'Open a distance folder to browse entry divisions and age-category rankings.'}
              </p>

              {rankingFolders.length === 0 && !isSearching && (
                <p className="glass-inset p-4 text-xs text-[var(--text-secondary)]">
                  No active ranked finishers right now. Re-scan the finish line or use Restore / Reinstate in the panel below.
                </p>
              )}

              {isSearching && visibleFolders.length === 0 && filteredDisqualified.length === 0 && filteredDequeued.length === 0 && (
                <p className="glass-inset p-5 text-sm text-[var(--text-secondary)]">
                  No rankings match “{rankingSearch.trim()}”. Try another name or bib number.
                </p>
              )}

              {visibleFolders.map((folder) => (
                <details key={`${rankingFilter}-${isSearching ? rankingSearch : 'browse'}-${folder.distance}`} open={isSearching || rankingFilter === 'flagged' || undefined} className="group/distance glass-inset overflow-hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500">
                    <Folder aria-hidden="true" className="w-6 h-6 shrink-0 text-red-500 group-open/distance:hidden" />
                    <FolderOpen aria-hidden="true" className="hidden w-6 h-6 shrink-0 text-red-500 group-open/distance:block" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-[var(--text-primary)]">{folder.distance}</span>
                      <span className="block mt-1 text-xs text-[var(--text-secondary)]">
                        {folder.subcategories.length} subcategor{folder.subcategories.length === 1 ? 'y' : 'ies'} &bull; {folder.finisherCount} {isSearching || rankingFilter === 'flagged' ? 'matching' : 'finished'}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0 text-[var(--text-muted)] group-open/distance:rotate-90" />
                  </summary>
                  <div className="border-t border-[var(--border-default)] px-3 pb-3 sm:px-4">
                    {folder.subcategories.map((category) => (
                      <details key={category.id} open={isSearching || rankingFilter === 'flagged' || undefined} className="group/category border-b last:border-b-0 border-[var(--border-default)]">
                        <summary className="flex cursor-pointer list-none items-center gap-3 py-4 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-lg">
                          <Folder aria-hidden="true" className="w-4 h-4 shrink-0 text-[var(--text-secondary)] group-open/category:hidden" />
                          <FolderOpen aria-hidden="true" className="hidden w-4 h-4 shrink-0 text-red-500 group-open/category:block" />
                          <span className="min-w-0 flex-1 text-xs font-bold text-[var(--text-primary)]">{category.label}</span>
                          <span className="text-[10px] text-[var(--text-secondary)] shrink-0">
                            {category.results.length} {isSearching || rankingFilter === 'flagged' ? 'matching' : 'finished'}
                          </span>
                          <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0 text-[var(--text-muted)] group-open/category:rotate-90" />
                        </summary>
                        <ol aria-label={`${folder.distance} ${category.label}`} className="space-y-2 max-h-96 overflow-y-auto pb-3">
                          {category.results.map((r) => {
                            const rank = category.ranking === 'age' ? r.categoryRank! : category.ranking === 'special' ? 1 : (r.overallRank ?? r.rank!);
                            const anomalies = finisherAnomalyLabels(r);
                            const isBusy = busyFinisherBib === r.bibNumber;
                            return (
                              <li key={r.bibNumber} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-[14px] bg-[var(--surface-inset)]/40 text-xs gap-2">
                                <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                                  <span className={`font-mono font-black w-9 shrink-0 ${rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-slate-400' : rank === 3 ? 'text-orange-600' : 'text-red-500'}`}>#{rank}</span>
                                  <div className="min-w-0 flex-1" title={runnerTimingName(r.runnerProfile, r.bibNumber)}>
                                    <span className="block truncate font-bold text-[var(--text-primary)]">{runnerTimingName(r.runnerProfile, r.bibNumber)}</span>
                                    <span className="text-[var(--text-muted)]">Bib #{r.bibNumber}</span>
                                    {anomalies.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {anomalies.map((label) => (
                                          <span key={label} className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" /> {label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-12 sm:pl-0">
                                  <span className="font-mono font-bold text-[var(--text-primary)] tabular-nums">{formatRaceTime(r.finishTime)}</span>
                                  {canManageFinishers && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => openManageFinisher(r)}
                                      aria-label={`Manage finisher Bib #${r.bibNumber}`}
                                      className="min-h-[36px] px-3 py-1.5 rounded-[10px] border border-[var(--border-strong)] text-[11px] font-bold text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 transition"
                                    >
                                      {isBusy ? 'Updating…' : 'Dequeue / DQ'}
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          {showInvalidatedTray && (
            <div className="space-y-4 pt-2 border-t border-[var(--border-default)]">
              {invalidatedCount === 0 ? (
                <p className="glass-inset p-4 text-xs text-[var(--text-secondary)]">
                  No disqualified or dequeued finishers right now. Use Dequeue / DQ on any finisher row to handle invalid finish scans.
                </p>
              ) : (
                <>
                  {filteredDisqualified.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-black font-display uppercase tracking-widest text-rose-700 dark:text-rose-400 flex items-center gap-2">
                        <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Disqualified Finishers ({filteredDisqualified.length})
                      </h4>
                      <div className="space-y-2">
                        {filteredDisqualified.map((r) => {
                          const isBusy = busyFinisherBib === r.bibNumber;
                          return (
                            <div key={r.bibNumber} className="glass-inset p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-rose-500/25">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[11px] font-black uppercase tracking-wider text-rose-700 dark:text-rose-400 px-2 py-0.5 rounded bg-rose-500/10">DQ</span>
                                  <span className="font-bold text-xs text-[var(--text-primary)] truncate">{runnerTimingName(r.runnerProfile, r.bibNumber)}</span>
                                  <span className="font-mono text-xs text-[var(--text-muted)]">Bib #{r.bibNumber} &bull; {runnerDivisionLabel(r.runnerProfile)}</span>
                                </div>
                                <p className="text-xs text-[var(--text-secondary)]">
                                  Reason: <span className="font-semibold text-[var(--text-primary)]">{r.dqReason || 'Invalidated by race official'}</span>
                                  {r.finishTime ? <span className="font-mono text-[var(--text-muted)]"> (Recorded scan: {formatRaceTime(r.finishTime)})</span> : null}
                                </p>
                              </div>
                              {canManageFinishers && (
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                  {r.finishTime && onDequeueFinisher && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => { void onDequeueFinisher(r); }}
                                      className="min-h-[36px] px-3 py-1.5 rounded-[10px] border border-amber-500/35 bg-amber-500/10 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-500 hover:text-black disabled:opacity-50 transition"
                                    >
                                      Dequeue Scan
                                    </button>
                                  )}
                                  {onReinstateFinisher && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => { void onReinstateFinisher(r); }}
                                      className="min-h-[36px] px-3 py-1.5 rounded-[10px] border border-emerald-500/35 bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-700 hover:text-white disabled:opacity-50 transition"
                                    >
                                      {isBusy ? 'Updating…' : 'Reinstate'}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {filteredDequeued.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-black font-display uppercase tracking-widest text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Recently Dequeued Finish Scans ({filteredDequeued.length})
                      </h4>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Removed from finisher standings during this session so the bib can be scanned again at the finish line. Restore returns the exact removed finish read.
                      </p>
                      <div className="space-y-2">
                        {filteredDequeued.map((entry) => {
                          const isBusy = busyFinisherBib === entry.bibNumber;
                          return (
                            <div key={entry.bibNumber} className="glass-inset p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-500/25">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[11px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded bg-amber-500/10">Dequeued</span>
                                  <span className="font-bold text-xs text-[var(--text-primary)] truncate">{entry.runnerName}</span>
                                  <span className="font-mono text-xs text-[var(--text-muted)]">Bib #{entry.bibNumber} &bull; {entry.division}</span>
                                </div>
                                <p className="text-xs text-[var(--text-secondary)]">
                                  Removed at {formatClockTime(entry.dequeuedAt)}
                                  {entry.finishTime ? <span className="font-mono text-[var(--text-muted)]"> (Previous time: {formatRaceTime(entry.finishTime)})</span> : null}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {onRestoreDequeued && canManageFinishers && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => { void onRestoreDequeued(entry); }}
                                    className="min-h-[36px] px-3 py-1.5 rounded-[10px] border border-emerald-500/35 bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-700 hover:text-white disabled:opacity-50 transition"
                                  >
                                    {isBusy ? 'Restoring…' : 'Restore Finish'}
                                  </button>
                                )}
                                {onDismissDequeued && (
                                  <button
                                    type="button"
                                    onClick={() => onDismissDequeued(entry.bibNumber)}
                                    className="min-h-[36px] px-3 py-1.5 rounded-[10px] border border-[var(--border-default)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                                  >
                                    Dismiss
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">No finish times recorded yet. Rankings appear once runners cross both the start and finish checkpoints.</p>
      )}

      {managingFinisher && (
        <DialogSurface
          className="rp-confirm !max-w-xl"
          titleId="manage-finisher-title"
          descriptionId="manage-finisher-desc"
          onRequestClose={() => setManagingFinisher(null)}
          initialFocusRef={cancelManageRef}
        >
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 id="manage-finisher-title" className="text-lg font-bold font-display text-[var(--text-primary)]">
                Manage Finisher: Bib #{managingFinisher.bibNumber}
              </h2>
              <p id="manage-finisher-desc" className="text-xs text-[var(--text-secondary)]">
                {runnerTimingName(managingFinisher.runnerProfile, managingFinisher.bibNumber)} ({runnerDivisionLabel(managingFinisher.runnerProfile)})
                {managingFinisher.finishTime ? ` · Recorded ${formatRaceTime(managingFinisher.finishTime)}` : ''}
              </p>
              {finisherAnomalyLabels(managingFinisher).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {finisherAnomalyLabels(managingFinisher).map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" /> {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {onDequeueFinisher && (
              <div className="glass-inset p-4 space-y-3 border border-amber-500/30">
                <div className="space-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Dequeue Finish Scan (Return to Course)
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Removes the finish scan so subsequent finishers move up. The bib stays unlocked and can be scanned again when the runner reaches the finish line.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyFinisherBib === managingFinisher.bibNumber}
                  onClick={() => { void handleConfirmDequeue(); }}
                  className="w-full min-h-11 rounded-[12px] bg-amber-500 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-black hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  Dequeue Finish Scan
                </button>
              </div>
            )}

            {onDisqualifyFinisher && (
              <div className="glass-inset p-4 space-y-3 border border-rose-500/30">
                <div className="space-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                    Disqualify Finisher (Mark DQ)
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Excludes this finisher from official standings, podiums, age awards, and reports while keeping their finish scan locked against RFID re-reads.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DQ_PRESET_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setDqReasonInput(preset);
                        setDqReasonError('');
                      }}
                      className={`px-2.5 py-1.5 rounded-[10px] border text-[11px] font-semibold transition ${dqReasonInput === preset ? 'border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-400' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <label htmlFor="dq-reason-input" className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Disqualification reason
                  </label>
                  <input
                    id="dq-reason-input"
                    type="text"
                    maxLength={120}
                    value={dqReasonInput}
                    onChange={(event) => {
                      setDqReasonInput(event.target.value);
                      if (dqReasonError) setDqReasonError('');
                    }}
                    placeholder="Enter reason for official race record"
                    className="w-full glass-inset px-3 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  {dqReasonError && <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-400">{dqReasonError}</p>}
                </div>
                <button
                  type="button"
                  disabled={busyFinisherBib === managingFinisher.bibNumber}
                  onClick={() => { void handleConfirmDq(); }}
                  className="w-full min-h-11 rounded-[12px] bg-red-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-red-700 disabled:opacity-50 transition"
                >
                  Disqualify Finisher (DQ)
                </button>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                ref={cancelManageRef}
                type="button"
                onClick={() => setManagingFinisher(null)}
                className="rp-button rp-button-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}
