import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Clock, Flag, Keyboard, Radio, Trophy, Users } from 'lucide-react';
import DialogSurface from './ui/DialogSurface';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import {
  ApproachingCourseEntry,
  BroadcastDivisionView,
  FinishScanEntry,
  buildBroadcastCourseFeed,
  buildBroadcastShortcutGuide,
  buildDistanceDivisionViews,
  computeRunnerPace,
  finishScanOrder,
  formatBroadcastClock,
  formatGapToLeader,
  getDistanceLabelsForRace,
} from '../lib/liveRankings';
import { elapsedSeconds, formatClockTime, formatRaceTime } from '../lib/preciseTime';
import { entryCategoryLabels, runnerDivisionLabel, runnerEntryCategory } from '../lib/raceEntry';
import { getWaveStartTime } from '../lib/timing';
import { Race, RunnerResult } from '../types';

const CHASERS_PER_PAGE = 5;
const DISTANCES_PER_PAGE = 2;
const FEED_APPROACHING_LIMIT = 2;
const FEED_SCAN_LIMIT = 4;
const AUTO_ROTATE_MS = 8000;

interface PodiumStyleConfig {
  title: string;
  cardClass: string;
  badgeClass: string;
  accentTextClass: string;
  gapClass: string;
}

const PODIUM_STYLES: readonly PodiumStyleConfig[] = [
  {
    title: 'Champion',
    cardClass: 'border-[#f59e0b]/70 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.16),#111216_72%)] shadow-[0_0_24px_-6px_rgba(245,158,11,0.35)]',
    badgeClass: 'bg-[#f59e0b] text-[#09090b]',
    accentTextClass: 'text-[#fbbf24]',
    gapClass: 'border-[#f59e0b]/45 bg-[#1a1408] text-[#fcd34d]',
  },
  {
    title: '1st Runner-Up',
    cardClass: 'border-[#e2e8f0]/60 bg-gradient-to-b from-[#e2e8f0]/10 to-[#111216]',
    badgeClass: 'bg-[#e2e8f0] text-[#09090b]',
    accentTextClass: 'text-[#e2e8f0]',
    gapClass: 'border-white/15 bg-white/5 text-[#e4e4e7]',
  },
  {
    title: '2nd Runner-Up',
    cardClass: 'border-[#d97706]/65 bg-gradient-to-b from-[#d97706]/14 to-[#111216]',
    badgeClass: 'bg-[#b45309] text-white',
    accentTextClass: 'text-[#f59e0b]',
    gapClass: 'border-[#d97706]/40 bg-[#1c1308] text-[#fcd34d]',
  },
  {
    title: '3rd Runner-Up',
    cardClass: 'border-[#ef4444]/60 bg-gradient-to-b from-[#dc2626]/14 to-[#111216]',
    badgeClass: 'bg-[#dc2626] text-white',
    accentTextClass: 'text-[#fca5a5]',
    gapClass: 'border-[#ef4444]/40 bg-[#220c0c] text-[#fca5a5]',
  },
];

interface PodiumArrivalAlert {
  key: string;
  podiumTitle: string;
  runner: RunnerResult;
  divisionLabel: string;
  gapLabel: string;
  podiumIndex: number;
}

function formatSafeClock(iso?: string): string {
  if (!iso) return 'Not set';
  const formatted = formatClockTime(iso);
  if (formatted === '—') return 'Not set';
  return /^\d{2}:\d{2}:\d{2}/.test(formatted) ? formatted.slice(0, 8) : formatted;
}

function formatSafeRaceTime(value?: string): string {
  if (!value) return '--:--:--';
  const formatted = formatRaceTime(value);
  return formatted === '—' ? '--:--:--' : formatted;
}

function formatRunnerName(result: RunnerResult): string {
  return result.runnerProfile?.fullName?.trim()
    || result.runnerProfile?.teamName?.trim()
    || `Bib #${result.bibNumber}`;
}

function getOfficialRankNumber(
  result: RunnerResult,
  viewRanking: BroadcastDivisionView['ranking'],
  sequentialPosition: number,
): number | undefined {
  if (viewRanking === 'female-overall' || viewRanking === 'special') return sequentialPosition;
  if (viewRanking === 'age') return result.categoryRank ?? result.rank;
  return result.overallRank ?? result.rank;
}

function resolveRunnerDistanceKm(race: Race, result: RunnerResult): number | undefined {
  const distanceLabel = result.runnerProfile?.distance;
  if (!distanceLabel) return undefined;
  return race.distances.find((item) => item.label === distanceLabel)?.km;
}

function computeBestLeaderSeconds(runners: RunnerResult[]): number | undefined {
  return runners[0]?.finishSeconds;
}

function resolveActiveGunStart(
  race: Race,
  selectedDistance: string,
  activeView?: BroadcastDivisionView,
): { timestamp?: string; label: string } {
  if (selectedDistance === 'all') {
    const candidates = [
      race.gunStartTime,
      ...Object.values(race.waveStartTimes ?? {}),
    ].filter((iso): iso is string => Boolean(iso && Number.isFinite(Date.parse(iso))));

    const earliest = candidates.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return {
      timestamp: earliest,
      label: 'First gun elapsed',
    };
  }

  if (activeView) {
    for (const key of activeView.waveKeys) {
      const waveStart = race.waveStartTimes?.[key];
      if (waveStart && Number.isFinite(Date.parse(waveStart))) {
        return {
          timestamp: waveStart,
          label: `${selectedDistance} gun elapsed`,
        };
      }
    }
  }

  const waveStart = getWaveStartTime(race, selectedDistance);
  return {
    timestamp: waveStart && Number.isFinite(Date.parse(waveStart)) ? waveStart : undefined,
    label: `${selectedDistance} gun elapsed`,
  };
}

function scanCategoryBadge(result: RunnerResult): { label: string; styleClass: string } {
  const rankText = result.rank !== undefined ? ` · #${result.rank}` : '';
  const division = runnerDivisionLabel(result.runnerProfile);
  if (result.categoryLabel) {
    return {
      label: `${division} · ${result.categoryLabel}${rankText}`,
      styleClass: 'border-[#f59e0b]/40 bg-[#1a1408] text-[#fcd34d]',
    };
  }
  return {
    label: `${division}${rankText}`,
    styleClass: 'border-white/15 bg-white/5 text-[#e4e4e7]',
  };
}

function CourseStatusBadge({ entry }: { entry: ApproachingCourseEntry }) {
  if (entry.kind === 'transition') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[#f59e0b]/45 bg-[#1a1408] px-2 py-0.5 text-xs font-semibold text-[#fcd34d] shrink-0">
        Running
      </span>
    );
  }
  if (entry.kind === 'approaching') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[#f59e0b]/45 bg-[#1a1408] px-2 py-0.5 text-xs font-semibold text-[#fcd34d] shrink-0">
        Approaching
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-normal text-[#d4d4d8] shrink-0">
      On course
    </span>
  );
}

/** Control-free, keyboard-driven race broadcast screen showing 4-place podiums, chasers, and finish chute scans. */
export default function LiveRankingsScreen({
  race,
  results,
  onClose,
}: {
  race: Race;
  results: RunnerResult[];
  onClose: () => void;
}) {
  const distanceLabels = useMemo(() => getDistanceLabelsForRace(race, results), [race, results]);

  const [selectedDistance, setSelectedDistance] = useState<string>('all');
  const [divisionIndex, setDivisionIndex] = useState(0);
  const [chaserPage, setChaserPage] = useState(0);
  const [allDistancesPage, setAllDistancesPage] = useState(0);
  const [autoRotatePaused, setAutoRotatePaused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [podiumAlert, setPodiumAlert] = useState<PodiumArrivalAlert | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const helpCloseBtnRef = useRef<HTMLButtonElement>(null);
  const seenPodiumRef = useRef<{ scopeKey: string; bibs: Set<string> }>({
    scopeKey: '',
    bibs: new Set<string>(),
  });

  useAndroidBackHandler(true, onClose);

  // Sync user reduced-motion preference so auto-pagination and banner transitions honor OS settings.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Tick the live digital broadcast clock once per second.
  useEffect(() => {
    const timer = window.setInterval(() => setNowIso(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep selectedDistance valid if race distances update mid-session.
  useEffect(() => {
    if (selectedDistance !== 'all' && !distanceLabels.includes(selectedDistance)) {
      setSelectedDistance('all');
      setDivisionIndex(0);
    }
  }, [distanceLabels, selectedDistance]);

  const divisionViews = useMemo(
    () => (selectedDistance === 'all' ? [] : buildDistanceDivisionViews(race, results, selectedDistance)),
    [race, results, selectedDistance],
  );

  const safeDivisionIndex = divisionViews.length > 0 ? divisionIndex % divisionViews.length : 0;
  const activeDivisionView = divisionViews[safeDivisionIndex];

  // Aggregate per-distance views when presenting All Distances so each podium keeps within-distance gaps.
  const allDistanceDecks = useMemo(() => {
    return distanceLabels.map((dist) => {
      const views = buildDistanceDivisionViews(race, results, dist);
      const primaryView = views.find((v) => v.results.length > 0) ?? views[0];
      const feed = buildBroadcastCourseFeed(results, race, dist);
      const waveStart = race.waveStartTimes?.[dist]
        ?? race.waveStartTimes?.[`${dist} Solo`]
        ?? getWaveStartTime(race, dist);
      return {
        distance: dist,
        view: primaryView,
        runners: primaryView?.results ?? [],
        telemetry: feed.telemetry,
        waveStart: waveStart && Number.isFinite(Date.parse(waveStart)) ? waveStart : undefined,
        km: race.distances.find((d) => d.label === dist)?.km,
      };
    });
  }, [distanceLabels, race, results]);

  const activeDistanceDecks = useMemo(
    () => allDistanceDecks.filter((deck) => deck.runners.length > 0),
    [allDistanceDecks],
  );

  const pendingDistanceDecks = useMemo(
    () => allDistanceDecks.filter((deck) => deck.runners.length === 0),
    [allDistanceDecks],
  );

  const courseFeed = useMemo(
    () => buildBroadcastCourseFeed(results, race, selectedDistance),
    [results, race, selectedDistance],
  );

  const scanEntries = useMemo(() => {
    const allScans = finishScanOrder(results, race);
    if (selectedDistance === 'all') return allScans;
    return allScans.filter((entry) => entry.result.runnerProfile?.distance === selectedDistance);
  }, [results, race, selectedDistance]);

  const recentScanEntries = useMemo(
    () => [...scanEntries].reverse().slice(0, FEED_SCAN_LIMIT),
    [scanEntries],
  );

  const singleViewRunners = activeDivisionView?.results ?? [];
  const chaserRunners = useMemo(() => singleViewRunners.slice(4), [singleViewRunners]);
  const chaserTotalPages = Math.max(1, Math.ceil(chaserRunners.length / CHASERS_PER_PAGE));
  const safeChaserPage = chaserPage % chaserTotalPages;
  const pagedChasers = useMemo(
    () => chaserRunners.slice(safeChaserPage * CHASERS_PER_PAGE, (safeChaserPage + 1) * CHASERS_PER_PAGE),
    [chaserRunners, safeChaserPage],
  );

  const allDistancesTotalPages = Math.max(1, Math.ceil(activeDistanceDecks.length / DISTANCES_PER_PAGE));
  const safeAllDistancesPage = allDistancesPage % allDistancesTotalPages;
  const pagedAllDistanceDecks = useMemo(
    () => activeDistanceDecks.slice(safeAllDistancesPage * DISTANCES_PER_PAGE, (safeAllDistancesPage + 1) * DISTANCES_PER_PAGE),
    [activeDistanceDecks, safeAllDistancesPage],
  );

  // Reset pagination indices cleanly whenever filter scope changes.
  useEffect(() => {
    setChaserPage(0);
    setAllDistancesPage(0);
  }, [selectedDistance, safeDivisionIndex]);

  // Auto-paginate Ranks #5+ or extra distance decks every 8 seconds unless paused or reduced-motion is enabled.
  useEffect(() => {
    if (autoRotatePaused || reducedMotion) return;
    const needsRotation =
      (selectedDistance !== 'all' && chaserTotalPages > 1) ||
      (selectedDistance === 'all' && allDistancesTotalPages > 1);
    if (!needsRotation) return;

    const interval = window.setInterval(() => {
      if (selectedDistance === 'all') {
        setAllDistancesPage((prev) => (prev + 1) % allDistancesTotalPages);
      } else {
        setChaserPage((prev) => (prev + 1) % chaserTotalPages);
      }
    }, AUTO_ROTATE_MS);

    return () => window.clearInterval(interval);
  }, [autoRotatePaused, reducedMotion, selectedDistance, chaserTotalPages, allDistancesTotalPages]);

  // Seed podium state on view change and announce genuinely new Top 4 arrivals during a live broadcast.
  useEffect(() => {
    const scopeKey = `${race.id}::${selectedDistance}::${activeDivisionView?.id ?? 'all'}`;
    const tracked = selectedDistance === 'all'
      ? activeDistanceDecks.flatMap((deck) => deck.runners.slice(0, 4).map((r, idx) => ({
          runner: r,
          podiumIndex: idx,
          divisionLabel: `${deck.distance} · ${deck.view?.label ?? 'Overall'}`,
          leaderSeconds: computeBestLeaderSeconds(deck.runners),
        })))
      : singleViewRunners.slice(0, 4).map((r, idx) => ({
          runner: r,
          podiumIndex: idx,
          divisionLabel: activeDivisionView?.label ?? selectedDistance,
          leaderSeconds: computeBestLeaderSeconds(singleViewRunners),
        }));

    if (seenPodiumRef.current.scopeKey !== scopeKey) {
      seenPodiumRef.current = {
        scopeKey,
        bibs: new Set(tracked.map((item) => `${item.runner.bibNumber}#${item.podiumIndex}`)),
      };
      setPodiumAlert(null);
      return;
    }

    if (tracked.length === 0) {
      seenPodiumRef.current.bibs = new Set();
      setPodiumAlert(null);
      return;
    }

    const newlyArrived = tracked.find(
      (item) => !seenPodiumRef.current.bibs.has(`${item.runner.bibNumber}#${item.podiumIndex}`),
    );
    seenPodiumRef.current.bibs = new Set(tracked.map((item) => `${item.runner.bibNumber}#${item.podiumIndex}`));

    if (!newlyArrived) return;

    const styleCfg = PODIUM_STYLES[newlyArrived.podiumIndex] ?? PODIUM_STYLES[0];
    setPodiumAlert({
      key: `${newlyArrived.runner.bibNumber}-${newlyArrived.podiumIndex}-${Date.now()}`,
      podiumTitle: styleCfg.title,
      runner: newlyArrived.runner,
      divisionLabel: newlyArrived.divisionLabel,
      gapLabel: formatGapToLeader(newlyArrived.leaderSeconds, newlyArrived.runner.finishSeconds),
      podiumIndex: newlyArrived.podiumIndex,
    });

    const timeout = window.setTimeout(() => setPodiumAlert(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [race.id, selectedDistance, activeDivisionView, activeDistanceDecks, singleViewRunners]);

  // Return keyboard focus to broadcast stage after closing Shortcut Guide dialog.
  useEffect(() => {
    if (!helpOpen) {
      stageRef.current?.focus();
    }
  }, [helpOpen]);

  // Global keyboard-only broadcast navigation (no clickable UI controls needed).
  useEffect(() => {
    const distanceCycle = ['all', ...distanceLabels];

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;

      if (key === 'Escape') {
        event.preventDefault();
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        onClose();
        return;
      }

      if (key === '?' || key.toLowerCase() === 'h') {
        event.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }

      if (key === '0' || key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedDistance('all');
        setDivisionIndex(0);
        setHelpOpen(false);
        return;
      }

      if (/^[1-9]$/.test(key)) {
        const idx = Number(key) - 1;
        if (idx < distanceLabels.length) {
          event.preventDefault();
          setSelectedDistance(distanceLabels[idx]);
          setDivisionIndex(0);
          setHelpOpen(false);
        }
        return;
      }

      if (key === 'ArrowLeft' || key === '[') {
        event.preventDefault();
        const currentIdx = distanceCycle.indexOf(selectedDistance);
        const nextIdx = (currentIdx <= 0 ? distanceCycle.length : currentIdx) - 1;
        setSelectedDistance(distanceCycle[nextIdx]);
        setDivisionIndex(0);
        return;
      }

      if (key === 'ArrowRight' || key === ']') {
        event.preventDefault();
        const currentIdx = distanceCycle.indexOf(selectedDistance);
        const nextIdx = (currentIdx + 1) % distanceCycle.length;
        setSelectedDistance(distanceCycle[nextIdx]);
        setDivisionIndex(0);
        return;
      }

      if (key === 'ArrowUp') {
        event.preventDefault();
        if (selectedDistance === 'all' && distanceLabels.length > 0) {
          setSelectedDistance(distanceLabels[0]);
          setDivisionIndex(0);
          return;
        }
        if (divisionViews.length > 1) {
          setDivisionIndex((prev) => (prev - 1 + divisionViews.length) % divisionViews.length);
        }
        return;
      }

      if (key === 'ArrowDown' || key.toLowerCase() === 'c') {
        event.preventDefault();
        if (selectedDistance === 'all' && distanceLabels.length > 0) {
          setSelectedDistance(distanceLabels[0]);
          setDivisionIndex(0);
          return;
        }
        if (divisionViews.length > 1) {
          setDivisionIndex((prev) => (prev + 1) % divisionViews.length);
        }
        return;
      }

      if (key === ' ' || key === 'Spacebar' || key.toLowerCase() === 'p') {
        event.preventDefault();
        setAutoRotatePaused((prev) => !prev);
        return;
      }

      if (key.toLowerCase() === 'f') {
        event.preventDefault();
        try {
          if (document.fullscreenElement) {
            void document.exitFullscreen?.();
          } else {
            void document.documentElement.requestFullscreen?.();
          }
        } catch {
          // Ignore browser fullscreen permission restrictions cleanly.
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [distanceLabels, divisionViews.length, helpOpen, onClose, selectedDistance]);

  const activeGun = resolveActiveGunStart(race, selectedDistance, activeDivisionView);
  const gunElapsedSeconds = activeGun.timestamp ? elapsedSeconds(activeGun.timestamp, nowIso) : undefined;
  const shortcutGuide = useMemo(() => buildBroadcastShortcutGuide(distanceLabels), [distanceLabels]);

  const hasFinishersInScope = selectedDistance === 'all'
    ? activeDistanceDecks.length > 0
    : singleViewRunners.length > 0;

  // Compute unique started wave list for Mode C pre-finish telemetry.
  const waveScheduleCards = useMemo(() => {
    const waveMap = race.waveStartTimes ?? {};
    const entries: { key: string; startIso?: string }[] = [];

    if (selectedDistance === 'all') {
      const waveKeys = Object.keys(waveMap);
      if (waveKeys.length > 0) {
        for (const key of waveKeys) entries.push({ key, startIso: waveMap[key] });
      } else {
        for (const dist of distanceLabels) entries.push({ key: dist, startIso: race.gunStartTime });
      }
    } else {
      const matchingKeys = Object.keys(waveMap).filter(
        (key) => key === selectedDistance || key.startsWith(`${selectedDistance} `),
      );
      if (matchingKeys.length > 0) {
        for (const key of matchingKeys) entries.push({ key, startIso: waveMap[key] });
      } else {
        entries.push({ key: selectedDistance, startIso: activeGun.timestamp });
      }
    }

    return entries;
  }, [race.waveStartTimes, race.gunStartTime, selectedDistance, distanceLabels, activeGun.timestamp]);

  const activeCutoffLabels = useMemo(
    () => race.checkpoints
      .filter((cp) => cp.cutoffMinutes !== undefined && cp.cutoffMinutes > 0)
      .map((cp) => `${cp.label}: ${cp.cutoffMinutes}m`),
    [race.checkpoints],
  );

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      role="region"
      aria-label="Live ranking views"
      className="fixed inset-0 z-50 bg-[#09090b] text-[#f4f4f5] overflow-y-auto lg:overflow-hidden outline-none select-none"
    >
      <div className="min-h-full lg:h-full flex flex-col px-4 py-3 lg:px-6 lg:py-4">
      {/* 1. TOP BROADCAST HEADER (Non-interactive display chrome + enlarged gun clock) */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f87171]">
              {race.name}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-[#10b981]/35 bg-[#10b981]/12 px-2 py-0.5 text-xs font-semibold text-[#6ee7b7]">
              <Radio className="w-3.5 h-3.5" aria-hidden="true" />
              Live telemetry
            </span>
            {autoRotatePaused && (
              <span className="inline-flex items-center rounded border border-[#f59e0b]/45 bg-[#1a1408] px-2 py-0.5 text-xs font-semibold text-[#fcd34d]">
                Rotation paused
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#f4f4f5] leading-none">
              Live rankings
            </h1>
            <span className="rounded border border-white/15 bg-[#111216] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-[#e4e4e7]">
              {selectedDistance === 'all'
                ? 'All distances'
                : `${selectedDistance} · ${activeDivisionView?.label ?? 'Overall'}`}
            </span>
          </div>
        </div>

        {/* Enlarged Digital Broadcast Gun Clock */}
        <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-[#111216] px-4 py-2">
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#a1a1aa]">
              <Clock className="w-3.5 h-3.5 text-[#a1a1aa]" aria-hidden="true" />
              <span>{activeGun.label}</span>
            </div>
            <div
              className={`mt-0.5 font-mono text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-wider tabular-nums leading-none ${
                gunElapsedSeconds !== undefined ? 'text-[#6ee7b7]' : 'text-[#a1a1aa]'
              }`}
            >
              {gunElapsedSeconds !== undefined ? formatBroadcastClock(gunElapsedSeconds) : '00:00:00'}
            </div>
            <div className="mt-1 text-xs font-normal text-[#a1a1aa] tabular-nums">
              {activeGun.timestamp ? `Gun started ${formatSafeClock(activeGun.timestamp)}` : 'Awaiting gun start'}
            </div>
          </div>
        </div>
      </header>

      {/* Live Podium Arrival Banner (fires only for new Top 4 finishes during the session) */}
      {podiumAlert && (
        <div
          role="status"
          aria-live="polite"
          className={`shrink-0 mt-3 rounded-xl border px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 transition-[transform,opacity] duration-200 ${
            (PODIUM_STYLES[podiumAlert.podiumIndex] ?? PODIUM_STYLES[0]).cardClass
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`rounded px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 ${
                (PODIUM_STYLES[podiumAlert.podiumIndex] ?? PODIUM_STYLES[0]).badgeClass
              }`}
            >
              New {podiumAlert.podiumTitle}
            </span>
            <span className="font-mono text-xs font-semibold text-[#d4d4d8] shrink-0">
              #{podiumAlert.runner.bibNumber}
            </span>
            <span className="text-sm sm:text-base font-semibold text-[#f4f4f5] truncate">
              {formatRunnerName(podiumAlert.runner)}
            </span>
            <span className="text-xs font-normal text-[#d4d4d8] whitespace-nowrap shrink-0">
              {podiumAlert.divisionLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm sm:text-base font-semibold text-[#f4f4f5] tabular-nums">
              {formatSafeRaceTime(podiumAlert.runner.finishTime)}
            </span>
            <span
              className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                (PODIUM_STYLES[podiumAlert.podiumIndex] ?? PODIUM_STYLES[0]).gapClass
              }`}
            >
              {podiumAlert.gapLabel}
            </span>
          </div>
        </div>
      )}

      {/* MAIN BROADCAST BODY */}
      <main className="mt-3 lg:flex-1 lg:min-h-0 flex flex-col gap-3">
        {!hasFinishersInScope ? (
          /* MODE C: ACTIVE PRE-FINISH / ON-COURSE TELEMETRY */
          <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-3">
            <section aria-label="On-course race telemetry" className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
              <div className="rounded-xl border border-white/10 bg-[#111216] p-3">
                <div className="flex items-center justify-between text-xs font-normal text-[#a1a1aa]">
                  <span>Registered</span>
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
                <p className="mt-1 font-mono text-2xl sm:text-3xl font-semibold text-[#f4f4f5] tabular-nums">
                  {courseFeed.telemetry.registered}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111216] p-3">
                <div className="flex items-center justify-between text-xs font-normal text-[#a1a1aa]">
                  <span>Started</span>
                  <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
                <p className="mt-1 font-mono text-2xl sm:text-3xl font-semibold text-[#f4f4f5] tabular-nums">
                  {courseFeed.telemetry.started}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111216] p-3">
                <div className="flex items-center justify-between text-xs font-normal text-[#a1a1aa]">
                  <span>On course</span>
                  <Activity className="w-3.5 h-3.5 text-[#6ee7b7]" aria-hidden="true" />
                </div>
                <p className="mt-1 font-mono text-2xl sm:text-3xl font-semibold text-[#6ee7b7] tabular-nums">
                  {courseFeed.telemetry.onCourse}
                </p>
              </div>
              <div className="rounded-xl border border-[#f59e0b]/40 bg-[#1a1408] p-3">
                <div className="flex items-center justify-between text-xs font-normal text-[#fcd34d]">
                  <span>Approaching splits</span>
                  <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
                <p className="mt-1 font-mono text-2xl sm:text-3xl font-semibold text-[#fcd34d] tabular-nums">
                  {courseFeed.telemetry.approaching}
                </p>
              </div>
            </section>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left: Active Waves & Course Splits */}
              <section className="lg:col-span-7 rounded-xl border border-white/10 bg-[#111216] p-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                    Wave start clocks and checkpoints
                  </h2>
                  {activeCutoffLabels.length > 0 && (
                    <span className="text-xs font-normal text-[#a1a1aa]">
                      Cutoffs: {activeCutoffLabels.join(' · ')}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto pr-1">
                  {waveScheduleCards.map((wave) => {
                    const waveSecs = wave.startIso && Number.isFinite(Date.parse(wave.startIso))
                      ? elapsedSeconds(wave.startIso, nowIso)
                      : undefined;
                    return (
                      <div
                        key={wave.key}
                        className="rounded-lg border border-white/10 bg-[#09090b] p-3 flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-sm sm:text-base font-semibold text-[#f4f4f5]">{wave.key}</div>
                          <div className="mt-0.5 text-xs font-normal text-[#a1a1aa] tabular-nums">
                            {wave.startIso ? `Gun ${formatSafeClock(wave.startIso)}` : 'Scheduled'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`font-mono text-xl font-semibold tabular-nums ${
                              waveSecs !== undefined ? 'text-[#6ee7b7]' : 'text-[#a1a1aa]'
                            }`}
                          >
                            {waveSecs !== undefined ? formatBroadcastClock(waveSecs) : '00:00:00'}
                          </div>
                          <span
                            className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-normal ${
                              waveSecs !== undefined
                                ? 'border-[#10b981]/35 bg-[#10b981]/12 text-[#6ee7b7]'
                                : 'border-white/15 bg-white/5 text-[#d4d4d8]'
                            }`}
                          >
                            {waveSecs !== undefined ? 'Wave live' : 'Staged'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Right: Active Runners On Course */}
              <section className="lg:col-span-5 rounded-xl border border-white/10 bg-[#111216] p-4 flex flex-col min-h-0">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                    Active field tracker
                  </h2>
                  <span className="text-xs font-normal text-[#a1a1aa]">Awaiting first finisher</span>
                </div>

                {courseFeed.activeOnCourse.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-6 px-4">
                    <p className="text-sm sm:text-base font-semibold text-[#f4f4f5]">
                      Runners staged for start roll call
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#a1a1aa]">
                      Live timings update here once start waves fire or checkpoint chips scan.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 overflow-y-auto pr-1">
                    {courseFeed.activeOnCourse.slice(0, 7).map((entry) => (
                      <div
                        key={entry.result.bibNumber}
                        className="rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[#d4d4d8]">
                              #{entry.result.bibNumber}
                            </span>
                            <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                              {formatRunnerName(entry.result)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs font-normal text-[#a1a1aa] truncate">
                            {runnerDivisionLabel(entry.result.runnerProfile)} · {entry.checkpointLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {entry.splitTimestamp && (
                            <span className="font-mono text-xs font-normal text-[#d4d4d8] tabular-nums">
                              {formatSafeClock(entry.splitTimestamp)}
                            </span>
                          )}
                          <CourseStatusBadge entry={entry} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : selectedDistance === 'all' ? (
          /* MODE B: ALL DISTANCES OVERVIEW (Per-distance Podium Decks + Unified Live Finish Chute Feed) */
          <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left 8 Columns: Per-Distance 4-Place Podiums */}
            <section className="lg:col-span-8 flex flex-col lg:min-h-0 gap-3">
              <div className="flex items-center justify-between shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                  Official distance podiums · Within-category gaps
                </h2>
                {allDistancesTotalPages > 1 && (
                  <span className="text-xs font-normal text-[#a1a1aa] tabular-nums">
                    Slide {safeAllDistancesPage + 1} / {allDistancesTotalPages}
                  </span>
                )}
              </div>

              <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-3 lg:overflow-hidden">
                {pagedAllDistanceDecks.map((deck) => {
                  const leaderSecs = computeBestLeaderSeconds(deck.runners);
                  const podiumRunners = deck.runners.slice(0, 4);
                  return (
                    <div
                      key={deck.distance}
                      className="rounded-xl border border-white/10 bg-[#111216] p-3 flex flex-col gap-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[#dc2626] px-2 py-0.5 text-xs font-semibold text-white">
                            {deck.distance}
                          </span>
                          <span className="text-sm font-semibold text-[#f4f4f5]">
                            {deck.view?.label ?? 'Overall'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-normal text-[#a1a1aa] tabular-nums">
                          <span>{deck.telemetry.finished} finished</span>
                          <span>{deck.telemetry.onCourse} on course</span>
                          {deck.waveStart && <span>Gun {formatSafeClock(deck.waveStart)}</span>}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                        {PODIUM_STYLES.map((cfg, slotIdx) => {
                          const runner = podiumRunners[slotIdx];
                          if (!runner) {
                            return (
                              <div
                                key={`${deck.distance}-empty-${slotIdx}`}
                                className="rounded-lg border border-dashed border-white/15 bg-[#09090b]/70 p-2.5 flex flex-col justify-between"
                              >
                                <span className={`inline-block w-fit rounded px-2 py-0.5 text-xs font-semibold uppercase ${cfg.badgeClass}`}>
                                  {cfg.title}
                                </span>
                                <span className="mt-2 text-xs font-normal text-[#a1a1aa]">
                                  Open podium slot
                                </span>
                              </div>
                            );
                          }

                          const pace = computeRunnerPace(runner.finishSeconds, deck.km);
                          const gapLabel = formatGapToLeader(leaderSecs, runner.finishSeconds);
                          const rankNum = deck.view
                            ? getOfficialRankNumber(runner, deck.view.ranking, slotIdx + 1) ?? slotIdx + 1
                            : slotIdx + 1;

                          return (
                            <div
                              key={`${deck.distance}-${runner.bibNumber}`}
                              className={`rounded-lg border p-2.5 flex flex-col justify-between gap-2 ${cfg.cardClass}`}
                            >
                              <div>
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${cfg.badgeClass}`}>
                                    {cfg.title}
                                  </span>
                                  <span className="font-mono text-xs font-semibold text-[#d4d4d8]">
                                    #{runner.bibNumber}
                                  </span>
                                </div>

                                <div className="mt-2 flex items-center gap-1.5 min-w-0">
                                  {slotIdx === 0 && (
                                    <Trophy className="w-4 h-4 shrink-0 text-[#fbbf24]" aria-hidden="true" />
                                  )}
                                  <span className="text-sm sm:text-base font-semibold text-[#f4f4f5] truncate">
                                    {formatRunnerName(runner)}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-xs font-normal text-[#d4d4d8] truncate">
                                  #{rankNum} {runnerDivisionLabel(runner.runnerProfile)}
                                </div>
                              </div>

                              <div className="border-t border-white/10 pt-2 flex items-end justify-between gap-2">
                                <div>
                                  <div className={`font-mono text-sm font-semibold tabular-nums ${cfg.accentTextClass}`}>
                                    {formatSafeRaceTime(runner.finishTime)}
                                  </div>
                                  {pace && (
                                    <div className="font-mono text-xs font-normal text-[#a1a1aa] tabular-nums">
                                      {pace}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <span className={`rounded border px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${cfg.gapClass}`}>
                                    {gapLabel}
                                  </span>
                                  <span className="rounded border border-[#10b981]/35 bg-[#10b981]/12 px-1.5 py-0.5 text-xs font-normal text-[#6ee7b7]">
                                    Finished
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {pendingDistanceDecks.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-[#111216] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                      Active distance waves awaiting finishers
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {pendingDistanceDecks.map((deck) => (
                        <div
                          key={deck.distance}
                          className="rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-semibold text-[#f4f4f5]">
                              {deck.distance}
                            </span>
                            <span className="text-xs font-normal text-[#a1a1aa]">
                              {deck.telemetry.onCourse} on course
                            </span>
                          </div>
                          <span className="font-mono text-xs font-normal text-[#a1a1aa] tabular-nums">
                            {deck.waveStart ? `Gun ${formatSafeClock(deck.waveStart)}` : 'Staged'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Right 4 Columns: Unified Live Finish Chute & Course Feed */}
            <FinishChuteFeedPanel
              approachingEntries={courseFeed.approaching.slice(0, FEED_APPROACHING_LIMIT)}
              scanEntries={recentScanEntries}
            />
          </div>
        ) : (
          /* MODE A: SINGLE DISTANCE SELECTED (4-Card Podium Spotlight + Paginated Chasers + Finish Chute Feed) */
          <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-3">
            {/* 4-Card Champion + 1st/2nd/3rd Runner-Up Podium Spotlight */}
            <section aria-label="Official podium standings" className="shrink-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                  Official podium standings · {selectedDistance} {activeDivisionView?.label ?? 'Overall'}
                </h2>
                <span className="text-xs font-normal text-[#a1a1aa] tabular-nums">
                  {courseFeed.telemetry.finished} finished · {courseFeed.telemetry.onCourse} on course · {courseFeed.telemetry.approaching} approaching
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PODIUM_STYLES.map((cfg, slotIdx) => {
                  const runner = singleViewRunners[slotIdx];
                  if (!runner) {
                    return (
                      <div
                        key={`podium-empty-${slotIdx}`}
                        className="rounded-xl border border-dashed border-white/15 bg-[#111216]/70 p-3 flex flex-col justify-between min-h-[132px]"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${cfg.badgeClass}`}>
                            {cfg.title}
                          </span>
                          <span className="font-mono text-xs font-normal text-[#a1a1aa]">
                            Rank #{slotIdx + 1}
                          </span>
                        </div>
                        <p className="text-xs font-normal text-[#a1a1aa]">
                          Awaiting podium finisher on course
                        </p>
                      </div>
                    );
                  }

                  const leaderSecs = computeBestLeaderSeconds(singleViewRunners);
                  const pace = computeRunnerPace(runner.finishSeconds, resolveRunnerDistanceKm(race, runner));
                  const gapLabel = formatGapToLeader(leaderSecs, runner.finishSeconds);
                  const division = runnerDivisionLabel(runner.runnerProfile);

                  return (
                    <div
                      key={`${runner.bibNumber}-${slotIdx}`}
                      className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 ${cfg.cardClass}`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${cfg.badgeClass}`}>
                            {cfg.title}
                          </span>
                          <span className="rounded border border-white/15 bg-[#09090b] px-2 py-0.5 font-mono text-xs font-semibold text-[#f4f4f5]">
                            #{runner.bibNumber}
                          </span>
                        </div>

                        <div className="mt-2.5 flex items-center gap-2 min-w-0">
                          {slotIdx === 0 && (
                            <Trophy className="w-5 h-5 shrink-0 text-[#fbbf24]" aria-hidden="true" />
                          )}
                          <h3 className="text-xl font-semibold text-[#f4f4f5] truncate leading-tight">
                            {formatRunnerName(runner)}
                          </h3>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-normal text-[#d4d4d8]">
                          <span>{division}</span>
                          {runner.categoryLabel && <span>· {runner.categoryLabel}</span>}
                          <span>· {runner.runnerProfile?.gender === 'female' ? 'F' : 'M'}</span>
                        </div>
                      </div>

                      <div className="border-t border-white/10 pt-2 flex items-end justify-between gap-2">
                        <div>
                          <div className={`font-mono text-base sm:text-xl font-semibold tabular-nums leading-none ${cfg.accentTextClass}`}>
                            {formatSafeRaceTime(runner.finishTime)}
                          </div>
                          {pace && (
                            <div className="mt-1 font-mono text-xs font-normal text-[#a1a1aa] tabular-nums">
                              Pace {pace}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${cfg.gapClass}`}>
                            {gapLabel}
                          </span>
                          <span className="rounded border border-[#10b981]/35 bg-[#10b981]/12 px-2 py-0.5 text-xs font-normal text-[#6ee7b7]">
                            Finished
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Lower Split: Chaser Standings (#5+) Left 8 cols + Finish Chute Feed Right 4 cols */}
            <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
              <section className="lg:col-span-8 rounded-xl border border-white/10 bg-[#111216] p-3 flex flex-col lg:min-h-0">
                <div className="flex items-center justify-between border-b border-white/10 pb-2 shrink-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                    {chaserRunners.length > 0
                      ? `Chaser standings · Ranks #5 to #${singleViewRunners.length}`
                      : 'Active field on course'}
                  </h2>
                  {chaserRunners.length > 0 && chaserTotalPages > 1 && (
                    <span className="text-xs font-normal text-[#a1a1aa] tabular-nums">
                      Page {safeChaserPage + 1} / {chaserTotalPages}
                      {autoRotatePaused ? ' · Paused' : ''}
                    </span>
                  )}
                </div>

                {chaserRunners.length > 0 ? (
                  <div className="mt-2.5 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {pagedChasers.map((runner, idx) => {
                      const sequentialPos = 5 + safeChaserPage * CHASERS_PER_PAGE + idx;
                      const displayRank = activeDivisionView
                        ? getOfficialRankNumber(runner, activeDivisionView.ranking, sequentialPos) ?? sequentialPos
                        : sequentialPos;
                      const leaderSecs = computeBestLeaderSeconds(singleViewRunners);
                      const gapLabel = formatGapToLeader(leaderSecs, runner.finishSeconds);
                      const pace = computeRunnerPace(runner.finishSeconds, resolveRunnerDistanceKm(race, runner));

                      return (
                        <div
                          key={`${runner.bibNumber}-${displayRank}`}
                          className="rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 grid grid-cols-12 items-center gap-2"
                        >
                          <div className="col-span-2 sm:col-span-1 font-mono text-sm font-semibold text-[#f4f4f5] tabular-nums">
                            #{displayRank}
                          </div>
                          <div className="col-span-6 sm:col-span-5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-[#a1a1aa]">
                                #{runner.bibNumber}
                              </span>
                              <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                                {formatRunnerName(runner)}
                              </span>
                            </div>
                            <div className="text-xs font-normal text-[#a1a1aa] truncate">
                              {runnerDivisionLabel(runner.runnerProfile)}
                              {runner.categoryLabel ? ` · ${runner.categoryLabel}` : ''}
                            </div>
                          </div>
                          <div className="hidden sm:block sm:col-span-2 font-mono text-xs font-normal text-[#a1a1aa] tabular-nums text-right">
                            {pace ?? runnerDivisionLabel(runner.runnerProfile)}
                          </div>
                          <div className="col-span-4 sm:col-span-4 flex items-center justify-end gap-2">
                            <div className="text-right">
                              <div className="font-mono text-sm font-semibold text-[#f4f4f5] tabular-nums">
                                {formatSafeRaceTime(runner.finishTime)}
                              </div>
                              <div className="font-mono text-xs font-normal text-[#d4d4d8] tabular-nums">
                                {gapLabel}
                              </div>
                            </div>
                            <span className="hidden md:inline-block rounded border border-[#10b981]/35 bg-[#10b981]/12 px-2 py-0.5 text-xs font-normal text-[#6ee7b7]">
                              Finished
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : courseFeed.activeOnCourse.length > 0 ? (
                  <div className="mt-2.5 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {courseFeed.activeOnCourse.slice(0, CHASERS_PER_PAGE).map((entry) => (
                      <div
                        key={entry.result.bibNumber}
                        className="rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[#d4d4d8]">
                              #{entry.result.bibNumber}
                            </span>
                            <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                              {formatRunnerName(entry.result)}
                            </span>
                          </div>
                          <div className="text-xs font-normal text-[#a1a1aa] truncate">
                            {entry.result.runnerProfile
                              ? `${entry.result.runnerProfile.distance} ${entryCategoryLabels[runnerEntryCategory(entry.result.runnerProfile)]}`
                              : ''}{' '}
                            · {entry.checkpointLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {entry.splitTimestamp && (
                            <span className="font-mono text-xs font-normal text-[#d4d4d8] tabular-nums">
                              {formatSafeClock(entry.splitTimestamp)}
                            </span>
                          )}
                          <CourseStatusBadge entry={entry} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs font-normal text-[#a1a1aa] py-4">
                    Top 4 podium standings active above; additional finishers appear here once crossed.
                  </div>
                )}
              </section>

              <FinishChuteFeedPanel
                approachingEntries={courseFeed.approaching.slice(0, FEED_APPROACHING_LIMIT)}
                scanEntries={recentScanEntries}
              />
            </div>
          </div>
        )}
      </main>

      {/* PASSIVE KEYBOARD SHORTCUT HINT STRIP (Zero buttons, non-interactive legend) */}
      <footer className="shrink-0 mt-3 border-t border-white/10 pt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs font-normal text-[#a1a1aa]">
        <div className="flex flex-wrap items-center gap-2">
          <Keyboard className="w-3.5 h-3.5 text-[#a1a1aa] shrink-0" aria-hidden="true" />
          <span
            className={`rounded border px-2 py-0.5 ${
              selectedDistance === 'all'
                ? 'border-[#dc2626] bg-[#dc2626]/20 text-[#f4f4f5] font-semibold'
                : 'border-white/15 bg-[#111216] text-[#d4d4d8]'
            }`}
          >
            <kbd className="font-mono">0</kbd> / <kbd className="font-mono">A</kbd> All
          </span>
          {distanceLabels.slice(0, 9).map((label, idx) => (
            <span
              key={label}
              className={`rounded border px-2 py-0.5 ${
                selectedDistance === label
                  ? 'border-[#dc2626] bg-[#dc2626]/20 text-[#f4f4f5] font-semibold'
                  : 'border-white/15 bg-[#111216] text-[#d4d4d8]'
              }`}
            >
              <kbd className="font-mono">{idx + 1}</kbd> {label}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <kbd className="font-mono text-[#e4e4e7]">Left/Right</kbd> Distance
          </span>
          <span>
            <kbd className="font-mono text-[#e4e4e7]">Up/Down/C</kbd> Category
          </span>
          <span>
            <kbd className="font-mono text-[#e4e4e7]">Space</kbd> {autoRotatePaused ? 'Resume' : 'Pause'}
          </span>
          <span>
            <kbd className="font-mono text-[#e4e4e7]">H</kbd> Guide
          </span>
          <span>
            <kbd className="font-mono text-[#e4e4e7]">Esc</kbd> Exit
          </span>
        </div>
      </footer>

      {/* ON-DEMAND KEYBOARD SHORTCUT GUIDE MODAL (Opened via H or ?) */}
      {helpOpen && (
        <DialogSurface
          titleId="broadcast-guide-title"
          onRequestClose={() => setHelpOpen(false)}
          dismissOnBackdropClick
          initialFocusRef={helpCloseBtnRef}
          className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#111216] p-6 text-[#f4f4f5]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h2 id="broadcast-guide-title" className="text-xl font-semibold text-[#f4f4f5]">
                Live Rankings Keyboard Guide
              </h2>
              <p className="mt-1 text-xs font-normal text-[#a1a1aa]">
                On-screen controls are hidden during broadcast. Use keyboard keys to switch views or press Esc to close.
              </p>
            </div>
            <button
              ref={helpCloseBtnRef}
              type="button"
              onClick={() => setHelpOpen(false)}
              aria-label="Close keyboard guide"
              className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-white/20 bg-[#09090b] hover:bg-white/10 px-3 font-mono text-xs font-semibold text-[#f4f4f5] transition-colors"
            >
              Close (Esc)
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                Distance Hotkeys
              </h3>
              <dl className="mt-2 space-y-2">
                {shortcutGuide.distanceKeys.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#09090b] px-3 py-1.5 text-xs"
                  >
                    <dt className="shrink-0 whitespace-nowrap">
                      <kbd className="font-mono font-semibold text-[#fbbf24]">{item.keys}</kbd>
                    </dt>
                    <dd className="font-normal text-[#e4e4e7] text-right">{item.label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
                Navigation &amp; Display
              </h3>
              <dl className="mt-2 space-y-2">
                {shortcutGuide.navigationKeys.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#09090b] px-3 py-1.5 text-xs"
                  >
                    <dt className="shrink-0 whitespace-nowrap">
                      <kbd className="font-mono font-semibold text-[#6ee7b7]">{item.keys}</kbd>
                    </dt>
                    <dd className="font-normal text-[#e4e4e7] text-right">{item.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </DialogSurface>
      )}
      </div>
    </div>
  );
}

function FinishChuteFeedPanel({
  approachingEntries,
  scanEntries,
}: {
  approachingEntries: ApproachingCourseEntry[];
  scanEntries: FinishScanEntry[];
}) {
  const maxScans = Math.max(2, FEED_SCAN_LIMIT - approachingEntries.length);
  const visibleScans = scanEntries.slice(0, maxScans);

  return (
    <aside className="lg:col-span-4 rounded-xl border border-white/10 bg-[#111216] p-3 flex flex-col lg:min-h-0">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#d4d4d8]">
          Live finish chute feed
        </h2>
        <span className="text-xs font-normal text-[#a1a1aa]">Raw mat arrival order</span>
      </div>

      <div className="mt-2.5 lg:flex-1 lg:min-h-0 space-y-2 overflow-y-auto pr-1">
        {approachingEntries.map((entry) => (
          <div
            key={`approaching-${entry.result.bibNumber}`}
            className="rounded-lg border border-[#f59e0b]/45 bg-[#1a1408] px-3 py-2 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-[#fcd34d]">
                  #{entry.result.bibNumber}
                </span>
                <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                  {formatRunnerName(entry.result)}
                </span>
              </div>
              <div className="mt-0.5 text-xs font-normal text-[#fcd34d]/85 truncate">
                {runnerDivisionLabel(entry.result.runnerProfile)} · {entry.checkpointLabel}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {entry.splitTimestamp && (
                <span className="font-mono text-xs font-semibold text-[#fcd34d] tabular-nums">
                  {formatSafeClock(entry.splitTimestamp)}
                </span>
              )}
              <CourseStatusBadge entry={entry} />
            </div>
          </div>
        ))}

        {visibleScans.map((entry) => {
          const badge = scanCategoryBadge(entry.result);
          return (
            <div
              key={`scan-${entry.result.bibNumber}-${entry.scanOrder}`}
              className="rounded-lg border border-[#10b981]/30 bg-[#09090b] px-3 py-2 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap shrink-0 rounded bg-[#10b981]/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-[#6ee7b7] tabular-nums">
                    SCAN #{entry.scanOrder}
                  </span>
                  <span className="font-mono text-xs font-semibold text-[#a1a1aa]">
                    #{entry.result.bibNumber}
                  </span>
                  <span className="text-sm font-semibold text-[#f4f4f5] truncate">
                    {formatRunnerName(entry.result)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded border px-1.5 py-0.5 text-xs font-normal ${badge.styleClass}`}>
                    {badge.label}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="font-mono text-sm font-semibold text-[#f4f4f5] tabular-nums">
                  {formatSafeRaceTime(entry.result.finishTime)}
                </span>
                <span className="rounded border border-[#10b981]/35 bg-[#10b981]/12 px-1.5 py-0.5 text-xs font-normal text-[#6ee7b7]">
                  Finished
                </span>
              </div>
            </div>
          );
        })}

        {approachingEntries.length === 0 && scanEntries.length === 0 && (
          <div className="py-6 text-center text-xs font-normal text-[#a1a1aa]">
            Waiting for finish mat scans or approaching checkpoint splits.
          </div>
        )}
      </div>
    </aside>
  );
}
