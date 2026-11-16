import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Clock,
  FileDown,
  Flag,
  Hash,
  MapPin,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';
import { downloadFinisherCertificate } from '../../lib/finisherCertificate';
import { formatClockTime, formatRaceTime } from '../../lib/preciseTime';
import { raceBibNameLines, resolveRaceBibTemplate } from '../../lib/raceBib';
import { ensureRaceBibCustomFont, raceBibFontFamily } from '../../lib/raceBibFont';
import { runnerDivisionLabel, runnerEntryCategory } from '../../lib/raceEntry';
import { checkpointType, computeResults, getWaveStartTime } from '../../lib/timing';
import { ChipRead, PublicLeaderboardEntry, PublicLiveResults, Race, RunnerProfile } from '../../types';
import EventCourseRunnerPanel from '../routes/EventCourseRunnerPanel';
import { ValueSkeleton } from '../ui/MotionPrimitives';
import RaceTimeText from '../ui/RaceTimeText';
import {
  drawFallbackRaceBibCanvas,
  drawFittedRaceBibText,
  drawFittedRaceBibTextLines,
  loadDataImage,
  philippineTodayStr,
} from './runnerUtils';

export type MyPassesFilter = 'all' | 'upcoming' | 'completed';

interface RaceProgressStep {
  id: string;
  label: string;
  detail: string;
  completed: boolean;
  timestamp?: string;
}

export interface RunnerMyRacesPanelProps {
  runnerProfiles: RunnerProfile[];
  races: Race[];
  racesLoaded: boolean;
  onBrowseEvents: () => void;
  onScanQr: () => void;
  onOpenEngraving?: () => void;
  requestedRaceId?: string | null;
  onRequestedRaceHandled?: () => void;
  isDesktop: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: MyPassesFilter;
  onStatusFilterChange: (value: MyPassesFilter) => void;
  onMetricsChange?: (metrics: { all: number; upcoming: number; completed: number; showing: number }) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

function formatScanTime(timestamp?: string): string | undefined {
  return timestamp ? formatClockTime(timestamp) : undefined;
}

function RunnerRacePassCard({
  race,
  runnerProfile,
  result,
  orderedCheckpoints,
}: {
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
    { id: 'registered', label: 'Registered', detail: 'Slot confirmed', completed: true, timestamp: runnerProfile.createdAt },
    {
      id: 'kit',
      label: 'Kit claimed',
      detail: runnerProfile.kitClaimedAt ? 'Kit released' : 'Claim at kit desk',
      completed: !!runnerProfile.kitClaimedAt,
      timestamp: runnerProfile.kitClaimedAt,
    },
    ...(checkin ? [{ id: 'checkin', label: 'Checked in', detail: checkin.label, completed: !!checkinSplit, timestamp: checkinSplit?.timestamp }] : []),
    ...(start
      ? [
          {
            id: 'start',
            label: 'Started',
            detail: result?.sequenceStartTime
              ? 'Sequence transition start'
              : startSplit
                ? start.label
                : result?.timingMethod === 'gun'
                  ? 'Roll Call gun start'
                  : start.label,
            completed: !!startSplit || !!result?.sequenceStartTime || result?.timingMethod === 'gun',
            timestamp:
              result?.sequenceStartTime ||
              startSplit?.timestamp ||
              (result?.timingMethod === 'gun'
                ? getWaveStartTime(race, runnerProfile.distance, runnerEntryCategory(runnerProfile))
                : undefined),
          },
        ]
      : []),
    ...(finish ? [{ id: 'finish', label: 'Finished', detail: finish.label, completed: !!finishSplit, timestamp: finishSplit?.timestamp }] : []),
    {
      id: 'result',
      label: 'Official result',
      detail: hasOfficialResult ? `Rank #${result!.rank} · ${formatRaceTime(result!.finishTime)}` : 'Pending finish',
      completed: hasOfficialResult,
      timestamp: hasOfficialResult ? finishSplit?.timestamp : undefined,
    },
  ];
  const currentStep = [...steps].reverse().find((step) => step.completed)?.label || 'Registered';

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]/45 overflow-hidden">
      <div className="relative p-4 sm:p-5 overflow-hidden border-b border-[var(--border-default)]">
        {race.posterImage && (
          <img src={race.posterImage} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-[0.1]" />
        )}
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-red-700 dark:text-red-300 bg-red-700/10 border border-red-500/25 rounded-full px-2.5 py-0.5">
                <Radio className="w-3 h-3" aria-hidden="true" />
                My Race Pass
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                {race.date}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-primary)]">
                <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                {runnerProfile.distance}
              </span>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mt-2 truncate">{runnerProfile.fullName}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 py-2 text-center min-w-[96px]">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Bib #</span>
              <span className="block text-lg font-mono font-semibold text-red-700 dark:text-red-400">
                #{runnerProfile.bibNumber}
              </span>
            </div>
            <div className="bg-white p-1.5 rounded-xl border border-[var(--border-default)]" title="Show this QR code at a race checkpoint">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={58} level="M" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs">
            <span className="font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Progress: </span>
            <span className="font-semibold text-red-700 dark:text-red-400">{currentStep}</span>
          </div>
          {result?.finishTime && (
            <span className="text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-3 py-0.5">
              Official time <RaceTimeText value={result.finishTime} />
            </span>
          )}
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                step.completed
                  ? 'border-red-500/25 bg-red-500/5'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)]'
              }`}
            >
              <span className={step.completed ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'}>
                {step.completed ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Circle className="w-4 h-4" aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[var(--text-primary)]">
                  {index + 1}. {step.label}
                </span>
                <span className="block text-xs text-[var(--text-secondary)] truncate">
                  {step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DigitalRaceBib({ race, runnerProfile }: { race: Race; runnerProfile: RunnerProfile }) {
  const { can } = useAccess();
  const bibRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const bibTemplate = resolveRaceBibTemplate(race, runnerProfile.distance, runnerProfile.entryCategory || 'solo');
  const layout = bibTemplate?.layout;
  const nameLines = raceBibNameLines(runnerProfile);
  const previewNameSize = Math.min(layout?.runnerNameSize ?? 5, 11 / Math.max(1, nameLines.length));

  useEffect(() => {
    void ensureRaceBibCustomFont(race.raceBibCustomFont).catch((error) => console.warn('Unable to load custom race bib font:', error));
  }, [race.raceBibCustomFont?.url]);

  const handleDownload = async () => {
    if (!bibTemplate || !layout) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await ensureRaceBibCustomFont(race.raceBibCustomFont);
      await document.fonts?.ready;
      const canvas = document.createElement('canvas');
      let templateLoaded = false;
      try {
        const template = await loadDataImage(bibTemplate.image);
        canvas.width = template.naturalWidth;
        canvas.height = template.naturalHeight;
        const imgCtx = canvas.getContext('2d');
        if (!imgCtx) throw new Error('Canvas rendering is not supported by this browser.');
        imgCtx.drawImage(template, 0, 0, canvas.width, canvas.height);
        templateLoaded = true;
      } catch {
        canvas.width = 1200;
        canvas.height = 800;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas rendering is not supported by this browser.');
      if (!templateLoaded) {
        drawFallbackRaceBibCanvas(ctx, canvas.width, canvas.height, race, runnerProfile);
      }
      drawFittedRaceBibText(
        ctx,
        runnerProfile.bibNumber,
        canvas.width,
        canvas.height,
        layout.bibNumberX,
        layout.bibNumberY,
        layout.bibNumberSize ?? 12,
        layout.bibNumberColor ?? '#FFFFFF',
        layout.bibNumberStrokeColor ?? '#000000',
        layout.bibNumberStrokeWidth ?? 0,
        raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont, true),
      );
      if (race.raceBibShowRaffleNumber) {
        drawFittedRaceBibText(
          ctx,
          runnerProfile.bibNumber,
          canvas.width,
          canvas.height,
          layout.raffleNumberX ?? 50,
          layout.raffleNumberY ?? 88,
          layout.raffleNumberSize ?? 7,
          layout.raffleNumberColor ?? '#FFFFFF',
          layout.raffleNumberStrokeColor ?? '#000000',
          layout.raffleNumberStrokeWidth ?? 0,
          raceBibFontFamily(layout.raffleNumberFont ?? 'mono', race.raceBibCustomFont, true),
        );
      }
      drawFittedRaceBibTextLines(
        ctx,
        nameLines,
        canvas.width,
        canvas.height,
        layout.runnerNameX,
        layout.runnerNameY,
        layout.runnerNameSize ?? 5,
        layout.runnerNameColor ?? '#FFFFFF',
        layout.runnerNameStrokeColor ?? '#000000',
        layout.runnerNameStrokeWidth ?? 0,
        raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont, true),
      );
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

  if (!bibTemplate || !layout) return null;

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]/45 p-4 space-y-3">
      <div>
        <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
          <Hash className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
          Digital Race Bib
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Your name and official bib number preview.</p>
      </div>
      <div
        ref={bibRef}
        className="relative w-full aspect-[3/2] overflow-hidden rounded-xl bg-[var(--surface-inset)] select-none border border-[var(--border-default)]"
        style={{ containerType: 'inline-size' }}
      >
        <img src={bibTemplate.image} alt={`${race.name} personalized race bib`} className="absolute inset-0 w-full h-full object-cover" />
        <span
          className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap"
          style={{
            left: `${layout.bibNumberX}%`,
            top: `${layout.bibNumberY}%`,
            fontSize: `${layout.bibNumberSize ?? 12}cqw`,
            color: layout.bibNumberColor ?? '#FFFFFF',
            fontFamily: raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont),
            WebkitTextStroke: `${layout.bibNumberStrokeWidth ?? 0}cqw ${layout.bibNumberStrokeColor ?? '#000000'}`,
            paintOrder: 'stroke fill',
          }}
        >
          {runnerProfile.bibNumber}
        </span>
        {race.raceBibShowRaffleNumber && (
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap"
            style={{
              left: `${layout.raffleNumberX ?? 50}%`,
              top: `${layout.raffleNumberY ?? 88}%`,
              fontSize: `${layout.raffleNumberSize ?? 7}cqw`,
              color: layout.raffleNumberColor ?? '#FFFFFF',
              fontFamily: raceBibFontFamily(layout.raffleNumberFont ?? 'mono', race.raceBibCustomFont),
              WebkitTextStroke: `${layout.raffleNumberStrokeWidth ?? 0}cqw ${layout.raffleNumberStrokeColor ?? '#000000'}`,
              paintOrder: 'stroke fill',
            }}
          >
            {runnerProfile.bibNumber}
          </span>
        )}
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 w-[90%] text-center leading-[1.16] font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]"
          style={{
            left: `${layout.runnerNameX}%`,
            top: `${layout.runnerNameY}%`,
            fontSize: `${previewNameSize}cqw`,
            color: layout.runnerNameColor ?? '#FFFFFF',
            fontFamily: raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont),
            WebkitTextStroke: `${layout.runnerNameStrokeWidth ?? 0}cqw ${layout.runnerNameStrokeColor ?? '#000000'}`,
            paintOrder: 'stroke fill',
          }}
        >
          {nameLines.map((name, index) => (
            <span key={`${name}-${index}`} className="block">
              {name}
            </span>
          ))}
        </div>
      </div>
      <button
        hidden={!can('personal.bibs')}
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="min-h-11 w-full py-2.5 px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-wider text-white bg-red-700 hover:bg-red-600 transition disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {downloading ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />}
        <span>{downloading ? 'Preparing Bib...' : 'Download Race Bib'}</span>
      </button>
      {downloadError && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400 text-center">
          {downloadError}
        </p>
      )}
    </div>
  );
}

function RunnerPassInspector({
  runnerProfile,
  race,
}: {
  runnerProfile: RunnerProfile;
  race: Race | undefined;
}) {
  const { can } = useAccess();
  const [liveRace, setLiveRace] = useState<Race | null | undefined>(race);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [officialEntry, setOfficialEntry] = useState<PublicLeaderboardEntry | null>(null);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [certError, setCertError] = useState('');

  useEffect(() => {
    setLiveRace(race);
    const unsubscribe = onSnapshot(
      doc(db, 'races', runnerProfile.raceId),
      (docSnap) => {
        setLiveRace(docSnap.exists() ? (docSnap.data() as Race) : null);
      },
      (err) => console.warn('Race listener failed:', err.message),
    );
    return () => unsubscribe();
  }, [runnerProfile.raceId, race]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'chipReads'), where('raceId', '==', runnerProfile.raceId), where('bibNumber', '==', runnerProfile.bibNumber)),
      (snapshot) => {
        const list: ChipRead[] = [];
        snapshot.forEach((docSnap) => list.push(docSnap.data() as ChipRead));
        setChipReads(list);
      },
      (err) => {
        console.warn('Runner split listener failed:', err.message);
        setChipReads([]);
      },
    );
    return () => unsubscribe();
  }, [runnerProfile.raceId, runnerProfile.bibNumber]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'liveResults', runnerProfile.raceId),
      (snapshot) => {
        const summary = snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null;
        setOfficialEntry(summary?.officialResults?.find((entry) => entry.bibNumber === runnerProfile.bibNumber) || null);
      },
      () => setOfficialEntry(null),
    );
    return () => unsubscribe();
  }, [runnerProfile.raceId, runnerProfile.bibNumber]);

  const activeRace = liveRace ?? race;
  const resultsArePublic = !!activeRace?.completedAt || Object.keys(activeRace?.waveStartTimes || {}).length > 0 || !!activeRace?.gunStartTime;

  const localResult = useMemo(() => {
    if (!activeRace) return null;
    return computeResults(activeRace.checkpoints, chipReads, [runnerProfile], activeRace.ageCategories || [], activeRace).find(
      (r) => r.bibNumber === runnerProfile.bibNumber,
    );
  }, [activeRace, chipReads, runnerProfile]);

  const result = useMemo(() => {
    if (!localResult || !officialEntry || !resultsArePublic) return localResult;
    return {
      ...localResult,
      finishTime: formatRaceTime(officialEntry.finishTime),
      finishReviewRequired: officialEntry.finishReviewRequired,
      chipTime: officialEntry.chipTime ? formatRaceTime(officialEntry.chipTime) : undefined,
      gunTime: officialEntry.gunTime ? formatRaceTime(officialEntry.gunTime) : undefined,
      sequenceStartTime: officialEntry.sequenceStartTime,
      rank: officialEntry.overallRank ?? officialEntry.rank,
      overallRank: officialEntry.overallRank ?? officialEntry.rank,
      categoryRank: officialEntry.categoryRank,
      categoryLabel: officialEntry.categoryLabel,
      timingMethod: officialEntry.timingMethod || localResult.timingMethod,
    };
  }, [localResult, officialEntry, resultsArePublic]);

  const orderedCheckpoints = useMemo(
    () => (activeRace ? [...activeRace.checkpoints].sort((a, b) => a.order - b.order) : []),
    [activeRace],
  );

  const handleDownloadCertificate = async () => {
    if (!activeRace || !result) return;
    setDownloadingCert(true);
    setCertError('');
    try {
      await downloadFinisherCertificate(activeRace, runnerProfile, result);
    } catch {
      setCertError('Could not prepare your E-Certificate PDF right now. Please try again.');
    } finally {
      setDownloadingCert(false);
    }
  };

  if (!can('personal.results')) {
    return activeRace && can('personal.bibs') ? (
      <DigitalRaceBib race={activeRace} runnerProfile={runnerProfile} />
    ) : (
      <p className="text-xs text-[var(--text-secondary)]">Results access is disabled for this account.</p>
    );
  }

  return (
    <div className="space-y-4">
      {activeRace && (
        <RunnerRacePassCard
          race={activeRace}
          runnerProfile={runnerProfile}
          result={result ?? undefined}
          orderedCheckpoints={orderedCheckpoints}
        />
      )}

      {activeRace && (
        <EventCourseRunnerPanel race={activeRace} preferredDistance={runnerProfile.distance} />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]/45 p-4 space-y-3">
          <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
            <Clock className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
            Checkpoint Splits
          </h3>
          {!activeRace && <p className="text-xs text-[var(--text-secondary)]">Loading race details...</p>}
          {activeRace && orderedCheckpoints.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">This race has no checkpoints configured yet.</p>
          )}
          <div className="space-y-2">
            {orderedCheckpoints.map((cp, index) => {
              const split = result?.splits.find((s) => s.checkpointId === cp.id);
              const phase = checkpointType(cp, index, orderedCheckpoints.length);
              const waveStartTime = runnerProfile.startsAfterBib
                ? result?.sequenceStartTime
                : getWaveStartTime(activeRace, runnerProfile.distance, runnerEntryCategory(runnerProfile));
              const cutoffDeadline =
                cp.cutoffMinutes && waveStartTime
                  ? new Date(new Date(waveStartTime).getTime() + cp.cutoffMinutes * 60_000)
                  : undefined;
              const afterCutoff = !!split && !!cutoffDeadline && new Date(split.timestamp).getTime() > cutoffDeadline.getTime();
              const usesGunFallback = phase === 'start' && !split && result?.timingMethod === 'gun' && !!waveStartTime;
              const usesSequenceStart = phase === 'start' && !!result?.sequenceStartTime;
              return (
                <div
                  key={cp.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 py-2.5 gap-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{cp.label}</span>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mt-0.5">
                      {phase === 'checkin'
                        ? 'Check-In'
                        : phase === 'start'
                          ? 'Official Start'
                          : phase === 'finish'
                            ? 'Finish'
                            : cutoffDeadline
                              ? `Cutoff ${formatClockTime(cutoffDeadline)}`
                              : 'Split'}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-sm font-semibold shrink-0 text-right ${
                      afterCutoff
                        ? 'text-amber-800 dark:text-amber-300'
                        : usesSequenceStart
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : split
                            ? 'text-red-700 dark:text-red-400'
                            : usesGunFallback
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {usesSequenceStart
                      ? formatClockTime(result!.sequenceStartTime!)
                      : split
                        ? formatClockTime(split.timestamp)
                        : usesGunFallback
                          ? `Gun ${formatClockTime(waveStartTime!)}`
                          : 'Pending'}
                    {usesSequenceStart && <span className="block text-xs font-sans uppercase tracking-wide">Previous finish</span>}
                    {afterCutoff && <span className="block text-xs font-sans uppercase tracking-wide">After cutoff</span>}
                    {usesGunFallback && <span className="block text-xs font-sans uppercase tracking-wide">Official fallback</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {result?.finishTime && (
            <div className="bg-emerald-950/15 dark:bg-emerald-950/30 border border-emerald-700/35 p-4 rounded-xl text-center space-y-2">
              <p className="text-xs uppercase font-semibold tracking-widest text-emerald-700 dark:text-emerald-400">
                Finish Time
              </p>
              <p className="text-2xl font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                <RaceTimeText value={result.finishTime} />
              </p>
              {result.finishReviewRequired && (
                <p className="text-amber-800 dark:text-amber-300 text-xs">Provisional place · Needs finish review</p>
              )}
              {result.overallRank && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Overall #{result.overallRank} in {runnerDivisionLabel(runnerProfile)}
                  {result.categoryRank ? ` · ${result.categoryLabel || 'Category'} #${result.categoryRank}` : ''}
                </p>
              )}
              {activeRace && (
                <button
                  type="button"
                  disabled={downloadingCert}
                  hidden={!can('personal.certificates')}
                  onClick={handleDownloadCertificate}
                  className="min-h-11 w-full sm:w-auto px-4 py-2.5 rounded-xl font-display font-semibold uppercase text-xs tracking-wider text-white bg-red-700 hover:bg-red-600 disabled:opacity-60 transition inline-flex items-center justify-center gap-2"
                >
                  {downloadingCert ? (
                    <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <FileDown className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{downloadingCert ? 'Preparing E-Certificate...' : 'Download E-Certificate'}</span>
                </button>
              )}
              {certError && (
                <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center justify-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{certError}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="xl:col-span-5 space-y-4">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]/45 p-4 text-center space-y-3">
            <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)]">
              Checkpoint Bib QR
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Show this QR code to organizers at check-in, start, and finish gates.
            </p>
            <div className="bg-white p-3 rounded-2xl inline-block border border-[var(--border-default)]">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={160} level="M" />
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
              <span className="text-xs font-mono text-[var(--text-secondary)] uppercase block tracking-wider">Bib Number</span>
              <span className="text-lg font-mono font-semibold text-red-700 dark:text-red-400 tracking-widest">
                #{runnerProfile.bibNumber}
              </span>
            </div>
          </div>

          {activeRace && <DigitalRaceBib race={activeRace} runnerProfile={runnerProfile} />}
        </div>
      </div>
    </div>
  );
}

export default function RunnerMyRacesPanel({
  runnerProfiles,
  races,
  racesLoaded,
  onBrowseEvents,
  onScanQr,
  onOpenEngraving,
  requestedRaceId,
  onRequestedRaceHandled,
  isDesktop,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  onMetricsChange,
  desktopSearchRef,
}: RunnerMyRacesPanelProps) {
  const { can } = useAccess();
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [mobileInspecting, setMobileInspecting] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  useAndroidBackHandler(!isDesktop && mobileInspecting, () => setMobileInspecting(false));

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  const todayStr = philippineTodayStr();

  const isDoneRace = (rp: RunnerProfile) => {
    const race = raceById.get(rp.raceId);
    return !!race?.completedAt || (race?.date || '9999') < todayStr;
  };

  const sortedProfiles = useMemo(
    () =>
      [...runnerProfiles].sort((a, b) => {
        const aDone = isDoneRace(a);
        const bDone = isDoneRace(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        const aDate = raceById.get(a.raceId)?.date || '';
        const bDate = raceById.get(b.raceId)?.date || '';
        return bDate.localeCompare(aDate);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runnerProfiles, races, todayStr],
  );

  const counts = useMemo(() => {
    const completed = sortedProfiles.filter(isDoneRace).length;
    return {
      all: sortedProfiles.length,
      upcoming: sortedProfiles.length - completed,
      completed,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedProfiles, races, todayStr]);

  const filteredProfiles = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return sortedProfiles.filter((rp) => {
      const done = isDoneRace(rp);
      if (statusFilter === 'upcoming' && done) return false;
      if (statusFilter === 'completed' && !done) return false;
      if (!term) return true;
      const race = raceById.get(rp.raceId);
      return (
        (race?.name || '').toLowerCase().includes(term) ||
        (race?.date || '').includes(term) ||
        rp.distance.toLowerCase().includes(term) ||
        rp.bibNumber.toLowerCase().includes(term)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedProfiles, statusFilter, searchQuery, raceById, todayStr]);

  useEffect(() => {
    onMetricsChange?.({
      all: counts.all,
      upcoming: counts.upcoming,
      completed: counts.completed,
      showing: filteredProfiles.length,
    });
  }, [counts.all, counts.upcoming, counts.completed, filteredProfiles.length, onMetricsChange]);

  useEffect(() => {
    if (!requestedRaceId) return;
    if (runnerProfiles.some((rp) => rp.raceId === requestedRaceId)) {
      setSelectedRaceId(requestedRaceId);
      setMobileInspecting(true);
    }
    onRequestedRaceHandled?.();
  }, [requestedRaceId, runnerProfiles, onRequestedRaceHandled]);

  useEffect(() => {
    if (filteredProfiles.length === 0) return;
    if (!filteredProfiles.some((rp) => rp.raceId === selectedRaceId)) {
      setSelectedRaceId(filteredProfiles[0].raceId);
    }
  }, [filteredProfiles, selectedRaceId]);

  const selectedIndex = filteredProfiles.findIndex((rp) => rp.raceId === selectedRaceId);
  const selectedProfile = selectedIndex >= 0 ? filteredProfiles[selectedIndex] : undefined;
  const selectedRace = selectedProfile ? raceById.get(selectedProfile.raceId) : undefined;

  const stepSelectedPass = (delta: -1 | 1) => {
    if (filteredProfiles.length === 0) return;
    if (selectedIndex === -1) {
      setSelectedRaceId(filteredProfiles[0].raceId);
      return;
    }
    const nextIdx = (selectedIndex + delta + filteredProfiles.length) % filteredProfiles.length;
    setSelectedRaceId(filteredProfiles[nextIdx].raceId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (event.key === '/' && !isFormField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        (isDesktop ? desktopSearchRef?.current : mobileSearchRef.current)?.focus();
        return;
      }
      if (!isFormField && filteredProfiles.length > 1) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          stepSelectedPass(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          stepSelectedPass(-1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (runnerProfiles.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        <div className="glass-panel p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center mx-auto text-[var(--text-secondary)]">
            <ClipboardList className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-display font-semibold text-[var(--text-primary)]">No race passes yet</h2>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Register for an open event or scan the QR printed on an existing race bib to link your pass, live splits, and
              digital bib.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={onBrowseEvents}
              className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Flag className="w-4 h-4" aria-hidden="true" />
              <span>Browse Open Events</span>
            </button>
            <button
              type="button"
              onClick={onScanQr}
              className="min-h-11 flex-1 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 transition-colors"
            >
              <QrCode className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Scan Bib QR</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showMobileDetailOnly = !isDesktop && mobileInspecting && Boolean(selectedProfile);

  return (
    <div id="runner_passes_main" className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
      {/* Mobile / Tablet Compact Command Header */}
      {!isDesktop && !showMobileDetailOnly && (
        <div className="space-y-3 mb-3">
          <div className="glass-panel p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-display font-semibold text-[var(--text-primary)]">My Race Passes</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  QR passes, splits, digital bibs, and certificates
                </p>
              </div>
              <button
                type="button"
                onClick={onBrowseEvents}
                className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              >
                <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Find Race</span>
              </button>
            </div>

            <div className="relative">
              <Search
                className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="runner_passes_mobile_search" className="sr-only">
                Search passes by race name, distance, or bib number
              </label>
              <input
                ref={mobileSearchRef}
                id="runner_passes_mobile_search"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Search race or bib #..."
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-11 text-sm font-semibold text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  aria-label="Clear pass search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter registered passes">
              {(
                [
                  { key: 'all', label: 'All', count: counts.all },
                  { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
                  { key: 'completed', label: 'Completed', count: counts.completed },
                ] as const
              ).map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onStatusFilterChange(item.key)}
                    aria-pressed={active}
                    className={`min-h-11 min-w-11 px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono tabular-nums">{item.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Split Workspace: 38% Passes List Left / 62% Pass Console Right */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] gap-4 lg:gap-0">
        {!showMobileDetailOnly && (
          <section
            aria-label="Registered race passes"
            className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-page)] rounded-2xl lg:rounded-none border border-[var(--border-default)] lg:border-y-0 lg:border-l-0 lg:border-r overflow-hidden"
          >
            <div
              tabIndex={0}
              role="region"
              aria-label="My race passes list"
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain"
            >
              {!racesLoaded && races.length === 0 ? (
                <div role="status" aria-label="Loading race passes" className="p-4 space-y-3">
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
                    >
                      <ValueSkeleton widthClass="w-40" heightClass="h-4" />
                      <ValueSkeleton widthClass="w-16" heightClass="h-5" />
                    </div>
                  ))}
                </div>
              ) : filteredProfiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                  <Search className="w-8 h-8 text-[var(--text-secondary)] mb-3" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">No matching race passes</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                    Adjust your search term or status filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onSearchQueryChange('');
                      onStatusFilterChange('all');
                    }}
                    className="mt-4 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Reset filters
                  </button>
                </div>
              ) : !isDesktop ? (
                <div id="runner_passes_cards" className="p-3 space-y-3">
                  {filteredProfiles.map((p) => {
                    const race = raceById.get(p.raceId);
                    const isCompleted = !!race && (Boolean(race.completedAt) || race.date < todayStr);
                    const isRaceDay = !!race && !race.completedAt && race.date === todayStr;
                    const isSelected = selectedProfile?.raceId === p.raceId;
                    const leftBorderClass = isSelected
                      ? 'border-l-red-600 bg-red-500/[0.06] ring-2 ring-red-600/70'
                      : isCompleted
                        ? 'border-l-zinc-500 bg-[var(--surface-card)]'
                        : isRaceDay
                          ? 'border-l-red-600 bg-[var(--surface-card)]'
                          : 'border-l-emerald-600 bg-[var(--surface-card)]';
                    return (
                      <article key={p.raceId} className={`rounded-2xl border border-[var(--border-default)] border-l-4 ${leftBorderClass} p-4 space-y-3`}>
                        <div className="flex items-start gap-3">
                          <div className="w-16 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                            {race?.posterImage ? (
                              <img
                                src={race.posterImage}
                                alt={`${race.name} poster`}
                                width={64}
                                height={44}
                                className="w-16 h-11 object-cover block"
                              />
                            ) : (
                              <Flag className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="text-base font-display font-semibold text-[var(--text-primary)] truncate">
                              {race?.name || 'Registered Race Event'}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] mt-1">
                              <span className="font-mono">{race?.date || '--'}</span>
                              <span className="px-2 py-0.5 rounded bg-red-600/10 border border-red-600/20 text-red-700 dark:text-red-400 font-mono font-semibold">
                                {p.distance}
                              </span>
                              <span className="font-mono font-semibold text-[var(--text-primary)]">#{p.bibNumber}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                              isCompleted
                                ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                : isRaceDay
                                  ? 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/25'
                                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/25'
                            }`}
                          >
                            {isCompleted ? 'Completed' : isRaceDay ? 'Race day' : 'Upcoming'}
                          </span>
                          {!isCompleted && (
                            <span
                              className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                                p.kitClaimedAt
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/25'
                                  : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25'
                              }`}
                            >
                              {p.kitClaimedAt ? 'Kit Claimed' : 'Kit Desk Pending'}
                            </span>
                          )}
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRaceId(p.raceId);
                              setMobileInspecting(true);
                            }}
                            className="min-h-11 w-full px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                          >
                            <span>{isCompleted ? 'View Splits & Certificate' : 'Open QR Pass & Splits'}</span>
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div id="runner_passes_list" className="divide-y divide-[var(--border-subtle)]">
                  {filteredProfiles.map((p) => {
                    const race = raceById.get(p.raceId);
                    const isCompleted = !!race && (Boolean(race.completedAt) || race.date < todayStr);
                    const isRaceDay = !!race && !race.completedAt && race.date === todayStr;
                    const isSelected = selectedProfile?.raceId === p.raceId;

                    return (
                      <div
                        key={p.raceId}
                        className={`border-l-4 transition-colors px-4 py-3 flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-l-red-600 bg-red-500/[0.08]'
                            : isCompleted
                              ? 'border-l-zinc-400 dark:border-l-zinc-600 hover:bg-[var(--surface-hover)]/65'
                              : isRaceDay
                                ? 'border-l-red-500 hover:bg-[var(--surface-hover)]/65'
                                : 'border-l-emerald-600 dark:border-l-emerald-500 hover:bg-[var(--surface-hover)]/65'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedRaceId(p.raceId)}
                          aria-pressed={isSelected}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline"
                        >
                          <div className="w-12 h-8 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                            {race?.posterImage ? (
                              <img
                                src={race.posterImage}
                                alt={`${race.name} thumbnail`}
                                width={48}
                                height={32}
                                className="w-12 h-8 object-cover block"
                              />
                            ) : (
                              <Flag className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-display font-semibold text-sm leading-tight text-[var(--text-primary)] truncate">
                              {race?.name || 'Registered Race Event'}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)] mt-1">
                              <span className="font-mono tabular-nums">{race?.date || '--'}</span>
                              <span className="font-mono font-semibold text-red-700 dark:text-red-400">{p.distance}</span>
                              <span className="font-mono font-semibold text-[var(--text-primary)]">#{p.bibNumber}</span>
                            </div>
                          </div>
                        </button>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded border text-xs font-semibold ${
                              isCompleted
                                ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                : isRaceDay
                                  ? 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/25'
                                  : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                            }`}
                          >
                            {isCompleted ? 'Completed' : isRaceDay ? 'Race day' : 'Upcoming'}
                          </span>
                          {!isCompleted && (
                            <span className="text-xs text-[var(--text-secondary)]">
                              {p.kitClaimedAt ? 'Kit claimed' : 'Kit pending'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* RIGHT PASS INSPECTOR CONSOLE (62% Desktop / Focused Detail on Mobile) */}
        {(isDesktop || showMobileDetailOnly) && (
          <aside
            id="runner_pass_inspector"
            aria-label="Selected race pass and splits"
            className="flex flex-col min-h-0 lg:h-full bg-[var(--surface-card)] rounded-2xl lg:rounded-none border lg:border-0 border-[var(--border-default)] overflow-hidden"
          >
            {selectedProfile ? (
              <>
                <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 space-y-2">
                  {!isDesktop && (
                    <button
                      type="button"
                      onClick={() => setMobileInspecting(false)}
                      className="min-h-11 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                      <span>Back to My Passes</span>
                    </button>
                  )}

                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-red-700 text-white font-mono text-xs font-semibold">
                          #{selectedProfile.bibNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] font-mono text-xs font-semibold text-[var(--text-primary)]">
                          {selectedProfile.distance}
                        </span>
                        {selectedRace?.date && (
                          <span className="inline-flex items-center gap-1 text-xs font-mono text-[var(--text-secondary)]">
                            <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                            {selectedRace.date}
                          </span>
                        )}
                      </div>
                      <h2 className="text-base sm:text-lg font-display font-semibold text-[var(--text-primary)] line-clamp-2 lg:truncate mt-1">
                        {selectedRace?.name || 'Registered Race Event'}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {can('personal.engraving') && onOpenEngraving && (
                        <button
                          type="button"
                          onClick={onOpenEngraving}
                          className="min-h-11 lg:min-h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Award className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                          <span>Engrave Medal</span>
                        </button>
                      )}
                      {filteredProfiles.length > 1 && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => stepSelectedPass(-1)}
                            aria-label="Previous pass"
                            className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                          >
                            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <span className="px-1 font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                            {selectedIndex + 1}/{filteredProfiles.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => stepSelectedPass(1)}
                            aria-label="Next pass"
                            className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                          >
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 sm:p-5">
                  <RunnerPassInspector runnerProfile={selectedProfile} race={selectedRace} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <ClipboardList className="w-8 h-8 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Race Pass Inspector</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                  Choose any registered pass to view its checkpoint QR, digital race bib, live splits, and finisher
                  certificate.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
