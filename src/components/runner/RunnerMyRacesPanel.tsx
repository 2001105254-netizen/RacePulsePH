import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
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
  QrCode,
  RefreshCw,
  Search,
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
import RaceTimeText from '../ui/RaceTimeText';
import {
  RunnerBottomSheetDetent,
  RunnerFilterRail,
  RunnerFloatingStatusPill,
  RunnerQueueRow,
  RunnerQueueSkeleton,
  RunnerTelemetryStrip,
  type QueueStatusTone,
  type SheetDetent,
} from './RunnerMobilePrimitives';
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
  isSplitPane?: boolean;
  isCompact?: boolean;
  onCanvasModeChange?: (active: boolean) => void;
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

function buildProgressSteps(
  race: Race,
  runnerProfile: RunnerProfile,
  result: ReturnType<typeof computeResults>[number] | undefined,
  orderedCheckpoints: Race['checkpoints'],
): RaceProgressStep[] {
  const splitFor = (checkpointId?: string) => result?.splits.find((split) => split.checkpointId === checkpointId);
  const checkin = orderedCheckpoints.find((cp, index) => checkpointType(cp, index, orderedCheckpoints.length) === 'checkin');
  const start = orderedCheckpoints.find((cp, index) => checkpointType(cp, index, orderedCheckpoints.length) === 'start');
  const finish = orderedCheckpoints.find((cp, index) => checkpointType(cp, index, orderedCheckpoints.length) === 'finish');
  const checkinSplit = splitFor(checkin?.id);
  const startSplit = splitFor(start?.id);
  const finishSplit = splitFor(finish?.id);
  const hasOfficialResult = !!result?.finishTime && !!result.rank;

  return [
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
    <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
          Digital Race Bib
        </h3>
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">#{runnerProfile.bibNumber}</span>
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
        className="min-h-11 w-full px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-wider text-white bg-red-700 hover:bg-red-600 transition disabled:opacity-60 flex items-center justify-center gap-2"
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

function useLivePassTelemetry(runnerProfile: RunnerProfile, race: Race | undefined) {
  const [liveRace, setLiveRace] = useState<Race | null | undefined>(race);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [officialEntry, setOfficialEntry] = useState<PublicLeaderboardEntry | null>(null);

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

  const steps = useMemo(
    () => (activeRace ? buildProgressSteps(activeRace, runnerProfile, result ?? undefined, orderedCheckpoints) : []),
    [activeRace, runnerProfile, result, orderedCheckpoints],
  );

  return { activeRace, result, orderedCheckpoints, steps };
}

function CheckpointSplitList({
  activeRace,
  runnerProfile,
  result,
  orderedCheckpoints,
}: {
  activeRace: Race | undefined;
  runnerProfile: RunnerProfile;
  result: ReturnType<typeof computeResults>[number] | null | undefined;
  orderedCheckpoints: Race['checkpoints'];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
          Checkpoint Splits
        </h3>
        <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {result?.splits.length || 0}/{orderedCheckpoints.length}
        </span>
      </div>
      {!activeRace && <p className="text-xs text-[var(--text-secondary)]">Loading race details...</p>}
      {activeRace && orderedCheckpoints.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]">This race has no checkpoints configured yet.</p>
      )}
      {orderedCheckpoints.length > 0 && (
        <div className="border-y border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
          {orderedCheckpoints.map((cp, index) => {
            const split = result?.splits.find((s) => s.checkpointId === cp.id);
            const phase = checkpointType(cp, index, orderedCheckpoints.length);
            const waveStartTime = runnerProfile.startsAfterBib
              ? result?.sequenceStartTime
              : activeRace
                ? getWaveStartTime(activeRace, runnerProfile.distance, runnerEntryCategory(runnerProfile))
                : undefined;
            const cutoffDeadline =
              cp.cutoffMinutes && waveStartTime
                ? new Date(new Date(waveStartTime).getTime() + cp.cutoffMinutes * 60_000)
                : undefined;
            const afterCutoff = !!split && !!cutoffDeadline && new Date(split.timestamp).getTime() > cutoffDeadline.getTime();
            const usesGunFallback = phase === 'start' && !split && result?.timingMethod === 'gun' && !!waveStartTime;
            const usesSequenceStart = phase === 'start' && !!result?.sequenceStartTime;
            const phaseLabel =
              phase === 'checkin'
                ? 'Check-In'
                : phase === 'start'
                  ? 'Official Start'
                  : phase === 'finish'
                    ? 'Finish'
                    : cutoffDeadline
                      ? `Cutoff ${formatClockTime(cutoffDeadline)}`
                      : 'Split';
            return (
              <div key={cp.id} className="py-2.5 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{cp.label}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">{phaseLabel}</span>
                </span>
                <span
                  className={`font-mono text-sm font-semibold tabular-nums shrink-0 text-right ${
                    afterCutoff
                      ? 'text-amber-800 dark:text-amber-300'
                      : usesSequenceStart || usesGunFallback
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : split
                          ? 'text-red-700 dark:text-red-400'
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
                  {usesSequenceStart && <span className="block text-xs font-sans">Previous finish</span>}
                  {afterCutoff && <span className="block text-xs font-sans">After cutoff</span>}
                  {usesGunFallback && <span className="block text-xs font-sans">Official fallback</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActiveRunMobileView({
  runnerProfile,
  race,
  statusLabel,
  statusTone,
  onBack,
  onOpenEngraving,
}: {
  runnerProfile: RunnerProfile;
  race: Race | undefined;
  statusLabel: string;
  statusTone: QueueStatusTone;
  onBack: () => void;
  onOpenEngraving?: () => void;
}) {
  const { can } = useAccess();
  const { activeRace, result, orderedCheckpoints, steps } = useLivePassTelemetry(runnerProfile, race);
  const [detent, setDetent] = useState<SheetDetent>('peek');
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [certError, setCertError] = useState('');

  useAndroidBackHandler(detent !== 'peek', () => {
    setDetent((curr) => (curr === 'expanded' ? 'half' : 'peek'));
  });

  const completedCount = steps.filter((s) => s.completed).length;
  const currentStep = [...steps].reverse().find((step) => step.completed) || steps[0];

  const handleDownloadCertificate = async () => {
    if (!activeRace || !result) return;
    setDownloadingCert(true);
    setCertError('');
    try {
      await downloadFinisherCertificate(activeRace, runnerProfile, result);
    } catch {
      setCertError('Could not prepare your E-Certificate PDF right now.');
    } finally {
      setDownloadingCert(false);
    }
  };

  if (!can('personal.results')) {
    return (
      <div className="fixed inset-0 z-[45] h-dvh overflow-hidden flex flex-col bg-[var(--surface-page)]">
        <RunnerFloatingStatusPill
          idBadge={`#${runnerProfile.bibNumber}`}
          title={activeRace?.name || 'Race Pass'}
          statusLabel={statusLabel}
          statusTone={statusTone}
          onBack={onBack}
          backLabel="Back to My Passes"
        />
        <div className="flex-1 min-h-0 overflow-y-auto pt-[calc(64px+var(--rp-safe-top))] px-3 pb-6">
          {activeRace && can('personal.bibs') ? (
            <DigitalRaceBib race={activeRace} runnerProfile={runnerProfile} />
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">Results access is disabled for this account.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="active-run-canvas"
      className="fixed inset-0 z-[45] h-dvh overflow-hidden flex flex-col bg-[var(--surface-page)]"
    >
      <RunnerFloatingStatusPill
        idBadge={`#${runnerProfile.bibNumber}`}
        title={activeRace?.name || 'Race Pass'}
        statusLabel={statusLabel}
        statusTone={statusTone}
        onBack={onBack}
        backLabel="Back to My Passes"
      />

      {/* Upper 60-70% Active Run / Course Canvas */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-[calc(76px+var(--rp-safe-top))] pb-[184px] px-3 space-y-3">
        <RunnerTelemetryStrip
          ariaLabel="Live pass summary"
          className="rounded-xl border border-[var(--border-default)]"
          items={[
            { key: 'bib', label: 'Bib', value: `#${runnerProfile.bibNumber}`, accent: 'red' },
            { key: 'dist', label: 'Distance', value: runnerProfile.distance },
            {
              key: 'step',
              label: result?.finishTime ? 'Finish' : 'Progress',
              value: result?.finishTime ? formatRaceTime(result.finishTime) : `${completedCount}/${steps.length || 1}`,
              accent: result?.finishTime ? 'emerald' : 'default',
            },
          ]}
        />

        {/* Active Step Checklist Track */}
        <section aria-label="Active run checkpoints" className="border-y border-[var(--border-subtle)] bg-[var(--surface-card)] divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-default)]">
          {steps.map((step, index) => (
            <div key={step.id} className="px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={step.completed ? 'text-red-700 dark:text-red-400 shrink-0' : 'text-[var(--text-secondary)] shrink-0'}>
                  {step.completed ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Circle className="w-4 h-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--text-primary)] truncate">
                    {index + 1}. {step.label}
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)] truncate">{step.detail}</span>
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
                {step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.completed ? 'Done' : 'Next'}
              </span>
            </div>
          ))}
        </section>

        {activeRace && (
          <EventCourseRunnerPanel race={activeRace} preferredDistance={runnerProfile.distance} compact />
        )}
      </div>

      {/* 3-Detent Bottom Sheet: Peek 20% / Half 50% / Expanded 90% */}
      <RunnerBottomSheetDetent
        detent={detent}
        onDetentChange={setDetent}
        ariaLabel="Race pass details and actions"
        peekSummary={
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {result?.finishTime ? (
                <>
                  Finish <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">{formatRaceTime(result.finishTime)}</span>
                  {result.overallRank ? ` · Rank #${result.overallRank}` : ''}
                </>
              ) : (
                <>
                  Step {completedCount}/{steps.length || 1}: <span className="text-red-700 dark:text-red-400">{currentStep?.label || 'Registered'}</span>
                </>
              )}
            </p>
            <p className="text-xs text-[var(--text-secondary)] truncate tabular-nums">
              {runnerProfile.fullName} · {runnerProfile.distance}
            </p>
          </div>
        }
        primaryAction={
          <div className="flex items-center gap-2">
            {result?.finishTime && activeRace && can('personal.certificates') ? (
              <button
                type="button"
                disabled={downloadingCert}
                onClick={handleDownloadCertificate}
                className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {downloadingCert ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />}
                <span>{downloadingCert ? 'Preparing Certificate...' : 'Download E-Certificate'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setDetent((curr) => (curr === 'peek' ? 'half' : 'expanded'))}
                className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4" aria-hidden="true" />
                <span>{detent === 'peek' ? 'Show Checkpoint QR & Splits' : 'Open Full Manifest'}</span>
              </button>
            )}
            {can('personal.engraving') && onOpenEngraving && (
              <button
                type="button"
                onClick={onOpenEngraving}
                aria-label="Open medal engraving"
                className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 shrink-0"
              >
                <Award className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                <span className="hidden min-[360px]:inline">Engrave</span>
              </button>
            )}
          </div>
        }
      >
        {certError && (
          <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{certError}</span>
          </p>
        )}

        {/* Half Detent Content: Scannable Bib QR + Checkpoint Splits */}
        <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)]">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)]">
              Checkpoint Bib QR
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Show at check-in, start, and finish gates.
            </p>
            <p className="mt-1 font-mono text-base font-semibold tabular-nums text-red-700 dark:text-red-400">
              #{runnerProfile.bibNumber}
            </p>
          </div>
          <div className="bg-white p-2 rounded-xl border border-[var(--border-default)] shrink-0">
            <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={96} level="M" />
          </div>
        </div>

        <CheckpointSplitList
          activeRace={activeRace}
          runnerProfile={runnerProfile}
          result={result}
          orderedCheckpoints={orderedCheckpoints}
        />

        {result?.finishTime && (
          <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Official Finish
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                <RaceTimeText value={result.finishTime} />
              </span>
            </div>
            {result.overallRank && (
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                Overall #{result.overallRank} in {runnerDivisionLabel(runnerProfile)}
                {result.categoryRank ? ` · ${result.categoryLabel || 'Category'} #${result.categoryRank}` : ''}
              </p>
            )}
          </div>
        )}

        {/* Expanded Detent Content: Digital Race Bib */}
        {activeRace && <DigitalRaceBib race={activeRace} runnerProfile={runnerProfile} />}
      </RunnerBottomSheetDetent>
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
  const { activeRace, result, orderedCheckpoints, steps } = useLivePassTelemetry(runnerProfile, race);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [certError, setCertError] = useState('');

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

  const completedCount = steps.filter((s) => s.completed).length;

  return (
    <div className="space-y-4">
      <RunnerTelemetryStrip
        ariaLabel="Pass telemetry"
        className="rounded-xl border border-[var(--border-default)]"
        items={[
          { key: 'bib', label: 'Bib', value: `#${runnerProfile.bibNumber}`, accent: 'red' },
          { key: 'dist', label: 'Distance', value: runnerProfile.distance },
          { key: 'steps', label: 'Steps', value: `${completedCount}/${steps.length || 1}` },
          {
            key: 'time',
            label: 'Official',
            value: result?.finishTime ? formatRaceTime(result.finishTime) : 'Pending',
            accent: result?.finishTime ? 'emerald' : 'default',
          },
        ]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 space-y-4">
          <div className="border border-[var(--border-default)] rounded-xl bg-[var(--surface-card)] p-3 space-y-2">
            <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)]">
              Race Progression
            </h3>
            <ol className="divide-y divide-[var(--border-subtle)]">
              {steps.map((step, index) => (
                <li key={step.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={step.completed ? 'text-red-700 dark:text-red-400 shrink-0' : 'text-[var(--text-secondary)] shrink-0'}>
                      {step.completed ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Circle className="w-4 h-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--text-primary)] truncate">
                        {index + 1}. {step.label}
                      </span>
                      <span className="block text-xs text-[var(--text-secondary)] truncate">{step.detail}</span>
                    </span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
                    {step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.completed ? 'Done' : 'Pending'}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="border border-[var(--border-default)] rounded-xl bg-[var(--surface-card)] p-3 space-y-3">
            <CheckpointSplitList
              activeRace={activeRace}
              runnerProfile={runnerProfile}
              result={result}
              orderedCheckpoints={orderedCheckpoints}
            />

            {result?.finishTime && (
              <div className="border-t border-[var(--border-subtle)] pt-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Finish Time
                  </p>
                  <p className="text-xl font-mono font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                    <RaceTimeText value={result.finishTime} />
                  </p>
                  {result.overallRank && (
                    <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                      Overall #{result.overallRank} in {runnerDivisionLabel(runnerProfile)}
                      {result.categoryRank ? ` · ${result.categoryLabel || 'Category'} #${result.categoryRank}` : ''}
                    </p>
                  )}
                </div>
                {activeRace && (
                  <button
                    type="button"
                    disabled={downloadingCert}
                    hidden={!can('personal.certificates')}
                    onClick={handleDownloadCertificate}
                    className="min-h-11 px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-wider text-white bg-red-700 hover:bg-red-600 disabled:opacity-60 transition inline-flex items-center justify-center gap-2"
                  >
                    {downloadingCert ? (
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <FileDown className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>{downloadingCert ? 'Preparing...' : 'Download E-Certificate'}</span>
                  </button>
                )}
              </div>
            )}
            {certError && (
              <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{certError}</span>
              </p>
            )}
          </div>
        </div>

        <div className="xl:col-span-5 border border-[var(--border-default)] rounded-xl bg-[var(--surface-card)] p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-secondary)]">
                Checkpoint Bib QR
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Present at check-in, start, and finish gates.
              </p>
              <p className="mt-1.5 text-lg font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                #{runnerProfile.bibNumber}
              </p>
            </div>
            <div className="bg-white p-2 rounded-xl border border-[var(--border-default)] shrink-0">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={108} level="M" />
            </div>
          </div>

          {activeRace && <DigitalRaceBib race={activeRace} runnerProfile={runnerProfile} />}
        </div>
      </div>

      {activeRace && (
        <EventCourseRunnerPanel race={activeRace} preferredDistance={runnerProfile.distance} />
      )}
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
  isSplitPane = isDesktop,
  isCompact = !isSplitPane,
  onCanvasModeChange,
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

  useAndroidBackHandler(isCompact && mobileInspecting, () => setMobileInspecting(false));

  useEffect(() => {
    onCanvasModeChange?.(Boolean(isCompact && mobileInspecting));
    return () => onCanvasModeChange?.(false);
  }, [isCompact, mobileInspecting, onCanvasModeChange]);

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
      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        <div className="border border-[var(--border-default)] rounded-xl bg-[var(--surface-card)] p-4 max-w-md w-full text-center space-y-3">
          <ClipboardList className="w-6 h-6 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-base font-display font-semibold text-[var(--text-primary)]">No race passes yet</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Register for an open event or scan your printed race bib QR to track live splits and certificates.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
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

  // Scenario 1: Compact Phone (< 600px) Active Run / Live Execution Mode
  if (isCompact && mobileInspecting && selectedProfile) {
    const isCompleted = !!selectedRace && (Boolean(selectedRace.completedAt) || selectedRace.date < todayStr);
    const isRaceDay = !!selectedRace && !selectedRace.completedAt && selectedRace.date === todayStr;
    return (
      <ActiveRunMobileView
        runnerProfile={selectedProfile}
        race={selectedRace}
        statusLabel={isCompleted ? 'Finished' : isRaceDay ? 'Race day' : 'Upcoming'}
        statusTone={isCompleted ? 'done' : isRaceDay ? 'raceday' : 'upcoming'}
        onBack={() => setMobileInspecting(false)}
        onOpenEngraving={onOpenEngraving}
      />
    );
  }

  return (
    <div id="runner_passes_main" className="w-full flex flex-col flex-1 min-h-0 min-[600px]:overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col min-[600px]:grid min-[600px]:grid-cols-[minmax(236px,38%)_minmax(0,1fr)] min-[920px]:grid-cols-[340px_minmax(0,1fr)]">
        {/* LEFT PASSES QUEUE */}
        <section
          aria-label="Registered race passes"
          className="flex flex-col flex-1 min-h-0 bg-[var(--surface-page)] min-[600px]:border-r min-[600px]:border-[var(--border-default)] overflow-hidden"
        >
          {!isDesktop && (
            <RunnerFilterRail<MyPassesFilter>
              ariaLabel="Filter registered passes"
              options={[
                { key: 'all', label: 'All', count: counts.all },
                { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
                { key: 'completed', label: 'Done', count: counts.completed },
              ]}
              value={statusFilter}
              onChange={onStatusFilterChange}
              searchValue={searchQuery}
              onSearchChange={onSearchQueryChange}
              searchPlaceholder="Search race or bib #..."
              searchLabel="Search passes by race name, distance, or bib number"
              searchInputId="runner_passes_mobile_search"
              searchInputRef={mobileSearchRef}
            />
          )}

          <div
            tabIndex={0}
            role="region"
            aria-label="My race passes list"
            className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain rp-runner-scroll"
          >
            {!racesLoaded && races.length === 0 ? (
              <RunnerQueueSkeleton rows={5} label="Loading race passes" />
            ) : filteredProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
                <Search className="w-6 h-6 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">No matching race passes</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                  Adjust your search term or status filter.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onSearchQueryChange('');
                    onStatusFilterChange('all');
                  }}
                  className="mt-3 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div id="runner_passes_list" className="divide-y divide-[var(--border-subtle)] bg-[var(--surface-card)]">
                {filteredProfiles.map((p) => {
                  const race = raceById.get(p.raceId);
                  const isCompleted = !!race && (Boolean(race.completedAt) || race.date < todayStr);
                  const isRaceDay = !!race && !race.completedAt && race.date === todayStr;
                  const isSelected = selectedProfile?.raceId === p.raceId;
                  const kitLabel = isCompleted ? 'Recorded' : p.kitClaimedAt ? 'Kit claimed' : 'Kit pending';
                  const statusTone: QueueStatusTone = isCompleted ? 'done' : isRaceDay ? 'raceday' : 'upcoming';

                  return (
                    <RunnerQueueRow
                      key={p.raceId}
                      selected={isSelected && isSplitPane}
                      idTag={`#${p.bibNumber}`}
                      title={race?.name || 'Registered Race Event'}
                      meta={`${race?.date || '--'} · ${p.distance} · ${kitLabel}`}
                      metric={p.distance}
                      metricAccent={isRaceDay ? 'red' : 'default'}
                      statusLabel={isCompleted ? 'Completed' : isRaceDay ? 'Race day' : 'Upcoming'}
                      statusTone={statusTone}
                      onClick={() => {
                        setSelectedRaceId(p.raceId);
                        if (isCompact) setMobileInspecting(true);
                      }}
                    />
                  );
                })}
              </div>
            )}
            {!isDesktop && (
              <div className="p-3 bg-[var(--surface-page)] border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={onScanQr}
                  className="min-h-11 w-full px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <QrCode className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Scan Race / Bib QR</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT ACTIVE-RUN INSPECTOR CANVAS (>= 600px) */}
        {isSplitPane && (
          <aside
            id="runner_pass_inspector"
            aria-label="Selected race pass and splits"
            className="flex flex-col min-h-0 h-full bg-[var(--surface-card)] overflow-hidden"
          >
            {selectedProfile ? (
              <>
                <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-red-700 text-white font-mono text-xs font-semibold tabular-nums">
                        #{selectedProfile.bibNumber}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                        {selectedProfile.distance}
                      </span>
                      {selectedRace?.date && (
                        <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                          <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                          {selectedRace.date}
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-display font-semibold text-[var(--text-primary)] truncate mt-0.5">
                      {selectedRace?.name || 'Registered Race Event'}
                    </h2>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
                  <RunnerPassInspector runnerProfile={selectedProfile} race={selectedRace} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                <ClipboardList className="w-7 h-7 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Race Pass Inspector</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                  Choose any registered pass to view its checkpoint QR, digital bib, live splits, and finisher certificate.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
