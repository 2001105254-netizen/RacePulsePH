import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CirclePlay,
  ExternalLink,
  ListFilter,
  MapPinned,
  Radio,
  RefreshCw,
  Save,
  Search,
  Trophy,
  Tv,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import { useAccess, useScopedRacesState } from '../lib/access';
import { embeddableMapUrl, safeExternalUrl, youtubeEmbedUrl } from '../lib/liveBroadcast';
import { formatClockTime, formatDateTime, formatRaceTime } from '../lib/preciseTime';
import { runnerDivisionLabel } from '../lib/raceEntry';
import { computeResults, getCheckpointByType } from '../lib/timing';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import {
  ChipRead,
  PublicLeaderboardEntry,
  PublicLiveResults,
  RunnerProfile,
  RunnerResult,
} from '../types';
import { useFeedback } from './ui/FeedbackProvider';

export interface LiveBroadcastLaunchRequest {
  raceId: string;
  nonce: number;
}

interface LiveBroadcastPanelProps {
  uid: string;
  launchRequest?: LiveBroadcastLaunchRequest | null;
}

type MasterTab = 'leaderboard' | 'scans';
type PreviewTab = 'stream' | 'map';
type LeaderboardStatusFilter = 'all' | 'finished' | 'on-course' | 'missing-start' | 'review';

const DESKTOP_QUERY = '(min-width: 1024px)';
const ACTIVE_RACE_STORAGE_KEY = 'racepulse_active_race';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

function sanitizeFallback(value: string): string {
  return !value || value === '—' ? '--' : value;
}

function formatDisplayTime(value?: string): string {
  if (!value) return '--';
  return sanitizeFallback(formatRaceTime(value));
}

function formatDisplayClock(value?: string): string {
  if (!value) return '--';
  return sanitizeFallback(formatClockTime(value));
}

function formatDisplayTimestamp(value?: string): string {
  if (!value) return '--';
  return sanitizeFallback(formatDateTime(value));
}

function runnerPublicName(profile?: RunnerProfile, bibNumber = ''): string {
  if (profile?.isFreeSlot) return `Bib ${bibNumber}`;
  return profile?.fullName || `Bib ${bibNumber}`;
}

function buildPublicEntry(result: RunnerResult, divisionOverride?: string): PublicLeaderboardEntry {
  return {
    bibNumber: result.bibNumber,
    fullName: runnerPublicName(result.runnerProfile, result.bibNumber),
    ...(result.runnerProfile?.isFreeSlot ? { isFreeSlot: true } : {}),
    distance: divisionOverride ?? runnerDivisionLabel(result.runnerProfile),
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
  };
}

function timingMethodLabel(method?: 'chip' | 'gun' | 'transition'): string {
  if (method === 'gun') return 'Gun';
  if (method === 'transition') return 'Transition';
  return 'Chip';
}

// Operator broadcast studio: merges event context, master visibility switch,
// real-time WYSIWYG leaderboard verification, and media/map preview into one locked console.
export default function LiveBroadcastPanel({ uid: _uid, launchRequest }: LiveBroadcastPanelProps) {
  const { can } = useAccess();
  const { races, loading: racesLoading, error: racesError } = useScopedRacesState();
  const { notify } = useFeedback();
  const headerCtx = useWorkspaceHeader();
  const isDesktop = useIsDesktop();

  const sortedRaces = useMemo(
    () => [...races].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [races],
  );

  const [activeRaceId, setActiveRaceId] = useState<string>(() => {
    if (launchRequest?.raceId) return launchRequest.raceId;
    try {
      return localStorage.getItem(ACTIVE_RACE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[]>([]);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [runnersLoaded, setRunnersLoaded] = useState(false);
  const [readsLoaded, setReadsLoaded] = useState(false);
  const [runnersError, setRunnersError] = useState<string | null>(null);
  const [readsError, setReadsError] = useState<string | null>(null);
  const [publishedSnapshot, setPublishedSnapshot] = useState<PublicLiveResults | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [livestreamUrl, setLivestreamUrl] = useState('');
  const [routeMapUrl, setRouteMapUrl] = useState('');
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [masterTab, setMasterTab] = useState<MasterTab>('leaderboard');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('stream');
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceFilter, setDistanceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<LeaderboardStatusFilter>('all');
  const [checkpointFilter, setCheckpointFilter] = useState<string>('all');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const publishingRef = useRef(false);
  const lastSyncedRaceRef = useRef<string>('');
  const lastSyncedLinksRef = useRef<{ stream: string; map: string }>({ stream: '', map: '' });
  const streamInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);

  const setDesktopLocked = headerCtx?.setDesktopLocked;
  useEffect(() => {
    if (!setDesktopLocked) return;
    setDesktopLocked(isDesktop);
    return () => setDesktopLocked(false);
  }, [isDesktop, setDesktopLocked]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (launchRequest?.raceId) {
      setActiveRaceId(launchRequest.raceId);
    }
  }, [launchRequest?.nonce, launchRequest?.raceId]);

  useEffect(() => {
    if (sortedRaces.length > 0 && !sortedRaces.some((race) => race.id === activeRaceId)) {
      const requested =
        launchRequest?.raceId && sortedRaces.some((race) => race.id === launchRequest.raceId)
          ? launchRequest.raceId
          : '';
      setActiveRaceId(requested || sortedRaces[0]?.id || '');
    }
  }, [sortedRaces, activeRaceId, launchRequest?.raceId]);

  useEffect(() => {
    if (!activeRaceId) return;
    try {
      localStorage.setItem(ACTIVE_RACE_STORAGE_KEY, activeRaceId);
    } catch {
      // Ignore storage quota errors in restricted browsing contexts.
    }
  }, [activeRaceId]);

  const activeRace = useMemo(
    () => sortedRaces.find((race) => race.id === activeRaceId),
    [sortedRaces, activeRaceId],
  );

  // Sync incoming Firestore settings without discarding unsaved local URL edits
  // when toggling public visibility on the same race.
  useEffect(() => {
    if (!activeRace) {
      lastSyncedRaceRef.current = '';
      lastSyncedLinksRef.current = { stream: '', map: '' };
      setEnabled(false);
      setLivestreamUrl('');
      setRouteMapUrl('');
      return;
    }

    const nextStream = activeRace.livestreamUrl || '';
    const nextMap = activeRace.routeMapUrl || '';
    const isNewRace = lastSyncedRaceRef.current !== activeRace.id;

    setEnabled(!!activeRace.liveBroadcastEnabled);

    if (isNewRace) {
      lastSyncedRaceRef.current = activeRace.id;
      lastSyncedLinksRef.current = { stream: nextStream, map: nextMap };
      setLivestreamUrl(nextStream);
      setRouteMapUrl(nextMap);
      setSearchQuery('');
      setDistanceFilter('all');
      setStatusFilter('all');
      setCheckpointFilter('all');
      setPreviewTab(!nextStream && nextMap ? 'map' : 'stream');
      return;
    }

    setLivestreamUrl((current) =>
      current === lastSyncedLinksRef.current.stream ? nextStream : current,
    );
    setRouteMapUrl((current) =>
      current === lastSyncedLinksRef.current.map ? nextMap : current,
    );
    lastSyncedLinksRef.current = { stream: nextStream, map: nextMap };
  }, [
    activeRace,
    activeRace?.id,
    activeRace?.liveBroadcastEnabled,
    activeRace?.livestreamUrl,
    activeRace?.routeMapUrl,
  ]);

  const canViewRoster = can('roster.view');
  const canViewTiming = can('timing.view');
  const canInspectTiming = canViewRoster && canViewTiming;

  // Subscribe to private roster + scan feeds (when permitted) and public liveResults snapshot.
  useEffect(() => {
    if (!activeRace?.id) {
      setRunnerProfiles([]);
      setChipReads([]);
      setRunnersLoaded(false);
      setReadsLoaded(false);
      setRunnersError(null);
      setReadsError(null);
      setPublishedSnapshot(null);
      setSnapshotError(null);
      return;
    }

    setPublishedSnapshot(null);
    setSnapshotError(null);

    const snapshotUnsubscribe = onSnapshot(
      doc(db, 'liveResults', activeRace.id),
      (snap) => {
        setPublishedSnapshot(snap.exists() ? (snap.data() as PublicLiveResults) : null);
        setSnapshotError(null);
      },
      (error) => {
        setSnapshotError(error.message || 'Could not load published leaderboard snapshot.');
      },
    );

    if (!canInspectTiming) {
      setRunnerProfiles([]);
      setChipReads([]);
      setRunnersLoaded(false);
      setReadsLoaded(false);
      setRunnersError(null);
      setReadsError(null);
      return () => {
        snapshotUnsubscribe();
      };
    }

    // Fresh race selection resets local collections so temporary empty arrays never
    // overwrite an already published leaderboard.
    setRunnerProfiles([]);
    setChipReads([]);
    setRunnersLoaded(false);
    setReadsLoaded(false);
    setRunnersError(null);
    setReadsError(null);

    const runnersUnsubscribe = onSnapshot(
      query(collection(db, 'runners'), where('raceId', '==', activeRace.id)),
      (snapshot) => {
        const list: RunnerProfile[] = [];
        snapshot.forEach((runnerDoc) => list.push(runnerDoc.data() as RunnerProfile));
        setRunnerProfiles(list);
        setRunnersLoaded(true);
        setRunnersError(null);
      },
      (error) => {
        setRunnersError(error.message || 'Could not load race roster.');
      },
    );

    const readsUnsubscribe = onSnapshot(
      query(collection(db, 'chipReads'), where('raceId', '==', activeRace.id)),
      (snapshot) => {
        const list: ChipRead[] = [];
        snapshot.forEach((readDoc) => list.push(readDoc.data() as ChipRead));
        setChipReads(list);
        setReadsLoaded(true);
        setReadsError(null);
      },
      (error) => {
        setReadsError(error.message || 'Could not load checkpoint scans.');
      },
    );

    return () => {
      snapshotUnsubscribe();
      runnersUnsubscribe();
      readsUnsubscribe();
    };
  }, [activeRace?.id, canInspectTiming]);

  const results = useMemo(
    () =>
      activeRace && canInspectTiming
        ? computeResults(
            activeRace.checkpoints,
            chipReads,
            runnerProfiles,
            activeRace.ageCategories || [],
            activeRace,
          )
        : [],
    [activeRace, canInspectTiming, chipReads, runnerProfiles],
  );

  const startCheckpoint = useMemo(
    () =>
      activeRace
        ? getCheckpointByType(activeRace.checkpoints, 'start') || activeRace.checkpoints[0]
        : undefined,
    [activeRace],
  );

  const checkpointNameById = useMemo(() => {
    const map = new Map<string, string>();
    (activeRace?.checkpoints || []).forEach((cp) => map.set(cp.id, cp.label));
    return map;
  }, [activeRace?.checkpoints]);

  const runnerByBib = useMemo(() => {
    const map = new Map<string, RunnerProfile>();
    runnerProfiles.forEach((runner) => map.set(runner.bibNumber, runner));
    return map;
  }, [runnerProfiles]);

  const startedBibSet = useMemo(() => {
    if (!startCheckpoint) return new Set<string>();
    return new Set(
      chipReads
        .filter((read) => read.checkpointId === startCheckpoint.id)
        .map((read) => read.bibNumber),
    );
  }, [chipReads, startCheckpoint]);

  const startedCount = startedBibSet.size;
  const finishedResults = useMemo(() => results.filter((result) => !!result.finishTime), [results]);
  const finishedCount = finishedResults.length;

  const missingStartBibs = useMemo(
    () =>
      new Set(
        finishedResults
          .filter((result) => !startedBibSet.has(result.bibNumber))
          .map((result) => result.bibNumber),
      ),
    [finishedResults, startedBibSet],
  );

  const reviewRequiredCount = useMemo(
    () => finishedResults.filter((result) => result.finishReviewRequired).length,
    [finishedResults],
  );

  const registeredCount = canInspectTiming
    ? runnerProfiles.length
    : publishedSnapshot?.totalRegistered ?? 0;
  const displayStartedCount = canInspectTiming
    ? startedCount
    : publishedSnapshot?.totalStarted ?? 0;
  const displayFinishedCount = canInspectTiming
    ? finishedCount
    : publishedSnapshot?.totalFinished ?? 0;

  const hasStartFinishDelta =
    canInspectTiming &&
    (finishedCount > startedCount || missingStartBibs.size > 0);
  const startDeltaBadgeCount = Math.max(
    finishedCount - startedCount,
    missingStartBibs.size,
  );

  const hasWaveStarted =
    !!activeRace &&
    (Object.keys(activeRace.waveStartTimes || {}).length > 0 || !!activeRace.gunStartTime);
  const canPublishBoard = !!activeRace && (!!activeRace.completedAt || hasWaveStarted);

  const publishResults = useCallback(
    async (quiet = false) => {
      if (!activeRace || activeRace.completedAt || !can('results.publish') || publishingRef.current) {
        return;
      }
      if (!runnersLoaded || !readsLoaded) {
        if (!quiet) {
          notify({
            tone: 'info',
            title: 'Timing data still syncing',
            message: 'Wait for the roster and checkpoint reads to finish loading, then publish again.',
          });
        }
        return;
      }
      publishingRef.current = true;
      setPublishing(true);
      try {
        const finishedWithRank = results.filter((result) => result.finishTime && result.rank);
        const divisions = [
          ...new Set(finishedWithRank.map((result) => runnerDivisionLabel(result.runnerProfile))),
        ];
        const leaders: PublicLeaderboardEntry[] = divisions.flatMap((division) =>
          finishedWithRank
            .filter((result) => runnerDivisionLabel(result.runnerProfile) === division)
            .slice(0, 5)
            .map((result) => buildPublicEntry(result, division)),
        );
        const officialResults: PublicLeaderboardEntry[] = finishedWithRank
          .map((result) => buildPublicEntry(result))
          .sort((a, b) => a.distance.localeCompare(b.distance) || a.rank - b.rank);

        const summary: PublicLiveResults = {
          raceId: activeRace.id,
          raceName: activeRace.name,
          updatedAt: new Date().toISOString(),
          status: activeRace.completedAt ? 'completed' : hasWaveStarted ? 'live' : 'upcoming',
          totalRegistered: runnerProfiles.length,
          totalStarted: startedCount,
          totalFinished: finishedCount,
          leaders: canPublishBoard ? leaders : [],
          officialResults: canPublishBoard ? officialResults : [],
        };
        await setDoc(doc(db, 'liveResults', activeRace.id), summary);
        if (!quiet) {
          notify({
            tone: 'success',
            title: 'Leaderboard published',
            message: `${officialResults.length} official finisher${officialResults.length === 1 ? '' : 's'} pushed to the public hub.`,
          });
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Could not publish the live leaderboard.';
        if (!quiet) {
          notify({
            tone: 'error',
            title: 'Publish failed',
            message: errorMessage,
          });
        }
      } finally {
        publishingRef.current = false;
        setPublishing(false);
      }
    },
    [
      activeRace,
      can,
      canPublishBoard,
      finishedCount,
      hasWaveStarted,
      notify,
      readsLoaded,
      results,
      runnerProfiles.length,
      runnersLoaded,
      startedCount,
    ],
  );

  // Debounced auto-publish while live broadcast is active (skips completed races so
  // official archived boards are never overwritten by a stale open tab).
  useEffect(() => {
    if (!activeRace?.liveBroadcastEnabled || activeRace.completedAt || !runnersLoaded || !readsLoaded) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void publishResults(true);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [
    activeRace?.completedAt,
    activeRace?.id,
    activeRace?.liveBroadcastEnabled,
    chipReads,
    publishResults,
    readsLoaded,
    runnerProfiles,
    runnersLoaded,
  ]);

  const cleanStreamUrl = livestreamUrl.trim();
  const cleanMapUrl = routeMapUrl.trim();
  const streamUrlError =
    cleanStreamUrl && !safeExternalUrl(cleanStreamUrl)
      ? 'Enter a valid https:// or http:// livestream URL.'
      : '';
  const mapUrlError =
    cleanMapUrl && !safeExternalUrl(cleanMapUrl)
      ? 'Enter a valid https:// or http:// course map URL.'
      : '';

  const streamEmbed = youtubeEmbedUrl(cleanStreamUrl);
  const mapEmbed = embeddableMapUrl(cleanMapUrl);
  const externalStreamHref = safeExternalUrl(cleanStreamUrl);
  const externalMapHref = safeExternalUrl(cleanMapUrl);

  const hasUnsavedLinks =
    !!activeRace &&
    (cleanStreamUrl !== (activeRace.livestreamUrl || '') ||
      cleanMapUrl !== (activeRace.routeMapUrl || ''));

  const handleTogglePublicLive = async () => {
    if (!activeRace || !can('hub.publish') || togglingPublic) return;
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    setTogglingPublic(true);
    try {
      await updateDoc(doc(db, 'races', activeRace.id), {
        liveBroadcastEnabled: nextEnabled,
      });
      notify({
        tone: 'success',
        title: nextEnabled ? 'Race is now publicly live' : 'Public live view paused',
        message: nextEnabled
          ? 'Spectators can now open the Live Race Hub while new scans sync automatically.'
          : 'Live Race Hub is hidden from public visitors (draft mode).',
      });
    } catch (error: unknown) {
      setEnabled(!nextEnabled);
      notify({
        tone: 'error',
        title: 'Visibility change failed',
        message: error instanceof Error ? error.message : 'Could not update broadcast status.',
      });
    } finally {
      setTogglingPublic(false);
    }
  };

  const handleSave = async () => {
    if (!activeRace) return;
    if (streamUrlError) {
      streamInputRef.current?.focus();
      notify({ tone: 'error', title: 'Invalid livestream link', message: streamUrlError });
      return;
    }
    if (mapUrlError) {
      mapInputRef.current?.focus();
      notify({ tone: 'error', title: 'Invalid course map link', message: mapUrlError });
      return;
    }
    if (!can('hub.manage') && !can('hub.publish')) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'races', activeRace.id), {
        ...(can('hub.publish') ? { liveBroadcastEnabled: enabled } : {}),
        ...(can('hub.manage') ? { livestreamUrl: cleanStreamUrl, routeMapUrl: cleanMapUrl } : {}),
      });
      lastSyncedLinksRef.current = { stream: cleanStreamUrl, map: cleanMapUrl };
      notify({
        tone: 'success',
        title: 'Live Hub saved',
        message: enabled
          ? 'Media links saved and public broadcast is active.'
          : 'Media links saved in draft mode.',
      });
    } catch (error: unknown) {
      notify({
        tone: 'error',
        title: 'Could not save settings',
        message: error instanceof Error ? error.message : 'Could not save broadcast settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Filtered rows for the WYSIWYG leaderboard table.
  const filteredResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return results.filter((result) => {
      if (distanceFilter !== 'all' && result.runnerProfile?.distance !== distanceFilter) {
        return false;
      }

      const isFinished = !!result.finishTime;
      const hasStarted = startedBibSet.has(result.bibNumber);
      const isMissingStart = isFinished && !hasStarted;

      if (statusFilter === 'finished' && !isFinished) return false;
      if (statusFilter === 'on-course' && (isFinished || !hasStarted)) return false;
      if (statusFilter === 'missing-start' && !isMissingStart) return false;
      if (statusFilter === 'review' && !result.finishReviewRequired) return false;

      if (!term) return true;
      const name = runnerPublicName(result.runnerProfile, result.bibNumber).toLowerCase();
      const division = runnerDivisionLabel(result.runnerProfile).toLowerCase();
      const category = (result.categoryLabel || '').toLowerCase();
      return (
        result.bibNumber.toLowerCase().includes(term) ||
        name.includes(term) ||
        division.includes(term) ||
        category.includes(term)
      );
    });
  }, [distanceFilter, results, searchQuery, startedBibSet, statusFilter]);

  // Filtered checkpoint scan stream (newest-first).
  const filteredScans = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return [...chipReads]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter((read) => {
        const profile = runnerByBib.get(read.bibNumber);
        if (distanceFilter !== 'all' && profile?.distance !== distanceFilter) return false;
        if (checkpointFilter !== 'all' && read.checkpointId !== checkpointFilter) return false;
        if (!term) return true;
        const runnerName = runnerPublicName(profile, read.bibNumber).toLowerCase();
        const cpName = (checkpointNameById.get(read.checkpointId) || '').toLowerCase();
        return (
          read.bibNumber.toLowerCase().includes(term) ||
          runnerName.includes(term) ||
          cpName.includes(term)
        );
      });
  }, [checkpointFilter, checkpointNameById, chipReads, distanceFilter, runnerByBib, searchQuery]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    distanceFilter !== 'all' ||
    statusFilter !== 'all' ||
    checkpointFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setDistanceFilter('all');
    setStatusFilter('all');
    setCheckpointFilter('all');
  };

  const toggleStartDeltaFilter = () => {
    setMasterTab('leaderboard');
    setStatusFilter((prev) => (prev === 'missing-start' ? 'all' : 'missing-start'));
  };

  const publishDisabledReason = !activeRace
    ? 'Select a race event first'
    : activeRace.completedAt
    ? 'Completed races are locked here; republish corrections from Timing Console'
    : !enabled
    ? 'Turn Public Live on before publishing'
    : !canInspectTiming
    ? 'Requires timing.view and roster.view permissions'
    : !runnersLoaded || !readsLoaded
    ? 'Waiting for roster and timing reads to sync'
    : 'Push current official leaderboard to public spectators';

  const streamStatusLabel = streamEmbed
    ? 'YouTube'
    : externalStreamHref
    ? 'External'
    : 'Unlinked';
  const mapStatusLabel = mapEmbed
    ? 'Embedded'
    : externalMapHref
    ? 'External'
    : 'Unlinked';

  const renderRaceEventSelect = (id: string, className: string, optionClassName?: string) => (
    <select
      id={id}
      value={activeRaceId}
      disabled={sortedRaces.length === 0}
      onChange={(event) => setActiveRaceId(event.target.value)}
      className={className}
    >
      {sortedRaces.length === 0 ? (
        <option value="" className={optionClassName}>
          {racesLoading ? 'Loading events...' : 'No race events'}
        </option>
      ) : (
        sortedRaces.map((race) => (
          <option key={race.id} value={race.id} className={optionClassName}>
            {race.name} ({race.date})
          </option>
        ))
      )}
    </select>
  );

  // Desktop Header Left Cluster (Portaled next to brand logo in App.tsx)
  const headerLeftMarkup = (
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      <span className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-2 min-w-0">
        <Tv className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
        <span className="hidden 2xl:inline text-[11px] font-semibold uppercase tracking-wider text-zinc-300 shrink-0">
          Live Hub
        </span>
        <label htmlFor="hub_header_event_select" className="sr-only">
          Active race event for Live Race Hub
        </label>
        {renderRaceEventSelect(
          'hub_header_event_select',
          'h-9 min-w-[160px] max-w-[220px] xl:max-w-[300px] rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 truncate disabled:opacity-50',
          'bg-[#141416] text-white',
        )}
      </div>

      <div
        className="hidden xl:flex items-center gap-2 px-2.5 h-8 rounded-lg border border-white/10 bg-white/5 text-[11px] font-mono text-zinc-200 shrink-0"
        title={isOnline ? 'Firestore live stream connected' : 'Offline connection mode'}
      >
        {isOnline ? (
          <Wifi className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
        )}
        <span>{isOnline ? 'SYNC' : 'OFFLINE'}</span>
      </div>
    </div>
  );

  // Desktop Header Right Cluster (Master Broadcast Switch + Publish + Save Hub)
  const headerRightMarkup = (
    <div className="flex items-center gap-1.5" role="toolbar" aria-label="Broadcast control actions">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!activeRace || !can('hub.publish') || togglingPublic}
        onClick={() => void handleTogglePublicLive()}
        title={
          can('hub.publish')
            ? enabled
              ? 'Public spectators can view Live Hub. Click to pause.'
              : 'Live Hub is hidden from visitors. Click to go publicly live.'
            : 'You need hub.publish permission to toggle public visibility'
        }
        className={`h-9 px-2.5 xl:px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap disabled:opacity-50 ${
          enabled
            ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500/40 text-white'
            : 'bg-white/10 hover:bg-white/15 border-white/15 text-zinc-200 hover:text-white'
        }`}
      >
        <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{togglingPublic ? 'Updating...' : enabled ? 'Public Live: On' : 'Public Live: Off'}</span>
      </button>

      {can('results.publish') && (
        <button
          type="button"
          onClick={() => void publishResults(false)}
          disabled={
            !activeRace ||
            !enabled ||
            publishing ||
            !runnersLoaded ||
            !readsLoaded ||
            !!activeRace?.completedAt
          }
          title={publishDisabledReason}
          className="h-9 px-2.5 xl:px-3 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap disabled:opacity-45"
        >
          {publishing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
          ) : (
            <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          )}
          <span className="hidden 2xl:inline">Publish Leaderboard Now</span>
          <span className="2xl:hidden">Publish</span>
        </button>
      )}

      {(can('hub.manage') || can('hub.publish')) && (
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!activeRace || saving}
          title="Save livestream and course map links"
          className="h-9 px-2.5 xl:px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white border border-red-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 whitespace-nowrap disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
          ) : (
            <Save className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>Save Live Hub</span>
          {hasUnsavedLinks && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" aria-label="Unsaved link edits" />
          )}
        </button>
      )}
    </div>
  );

  return (
    <div
      id="live_hub_console"
      className="w-full flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden"
    >
      <h1 className="sr-only">Live Race Hub Broadcast Console</h1>

      {isDesktop && headerCtx?.leftSlotEl && createPortal(headerLeftMarkup, headerCtx.leftSlotEl)}
      {isDesktop && headerCtx?.rightSlotEl && createPortal(headerRightMarkup, headerCtx.rightSlotEl)}

      {/* Mobile / Tablet Responsive Command Header (< 1024px) */}
      {!isDesktop && (
        <section
          aria-label="Live Race Hub controls"
          className="glass-panel p-4 mb-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">
                Live Race Hub
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {isOnline ? 'Firestore sync active' : 'Offline connection mode'}
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                enabled
                  ? 'bg-emerald-700 text-white border-emerald-500/40'
                  : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
              }`}
            >
              {enabled ? 'Public Live: On' : 'Draft Mode'}
            </span>
          </div>

          <div>
            <label
              htmlFor="hub_mobile_event_select"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              Race event
            </label>
            {renderRaceEventSelect(
              'hub_mobile_event_select',
              'w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm font-semibold text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50',
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!activeRace || !can('hub.publish') || togglingPublic}
              onClick={() => void handleTogglePublicLive()}
              className={`min-h-11 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 ${
                enabled
                  ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500/40 text-white'
                  : 'bg-[var(--surface-inset)] hover:bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-primary)]'
              }`}
            >
              <Radio className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{enabled ? 'Public Live: On' : 'Public Live: Off'}</span>
            </button>

            {can('results.publish') && (
              <button
                type="button"
                onClick={() => void publishResults(false)}
                disabled={
                  !activeRace ||
                  !enabled ||
                  publishing ||
                  !runnersLoaded ||
                  !readsLoaded ||
                  !!activeRace?.completedAt
                }
                title={publishDisabledReason}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-card)] text-[var(--text-primary)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-45"
              >
                {publishing ? (
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Trophy className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                )}
                <span>Publish Board</span>
              </button>
            )}

            {(can('hub.manage') || can('hub.publish')) && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!activeRace || saving}
                className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>Save Live Hub</span>
              </button>
            )}
          </div>
        </section>
      )}

      {racesError ? (
        <div role="alert" className="glass-panel p-6 m-2 text-center space-y-2">
          <AlertTriangle className="w-7 h-7 text-red-500 mx-auto" aria-hidden="true" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Could not load race events</p>
          <p className="text-xs text-[var(--text-secondary)]">{racesError}</p>
        </div>
      ) : sortedRaces.length === 0 ? (
        <div className="glass-panel p-8 m-2 text-center space-y-2">
          {racesLoading ? (
            <div role="status" className="space-y-2">
              <RefreshCw className="w-7 h-7 text-[var(--text-muted)] mx-auto animate-spin" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Loading race events...</p>
            </div>
          ) : (
            <>
              <Radio className="w-8 h-8 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Create a race first</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Your events will appear here for livestream, route map, and public leaderboard setup.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* 48px Live Broadcast Telemetry Ribbon matching Engraving Command Center */}
          <section
            aria-label="Live broadcast telemetry"
            className="shrink-0 border border-[var(--border-default)] lg:border-x-0 lg:border-t-0 rounded-2xl lg:rounded-none bg-[var(--surface-card)] mb-4 lg:mb-0 lg:h-12 px-3 sm:px-4 py-2.5 lg:py-0 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 lg:gap-4 lg:overflow-x-auto"
          >
            <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 sm:gap-4 text-xs min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[var(--text-secondary)]">Status:</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    enabled
                      ? 'bg-emerald-700 text-white border-emerald-500/40'
                      : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                  }`}
                >
                  {enabled ? 'PUBLIC LIVE' : 'DRAFT'}
                </span>
                {activeRace?.completedAt && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                    COMPLETED
                  </span>
                )}
              </div>

              <span className="hidden lg:inline h-4 w-px bg-[var(--border-default)] shrink-0" aria-hidden="true" />

              <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                <span className="text-[var(--text-secondary)]">
                  Registered:{' '}
                  <strong className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                    {registeredCount}
                  </strong>
                </span>
                <span className="text-[var(--text-secondary)]">
                  Started:{' '}
                  <strong className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                    {displayStartedCount}
                  </strong>
                </span>
                <span className="text-[var(--text-secondary)]">
                  Finished:{' '}
                  <strong className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                    {displayFinishedCount}
                  </strong>
                </span>
              </div>

              {hasStartFinishDelta && (
                <button
                  type="button"
                  onClick={toggleStartDeltaFilter}
                  aria-pressed={statusFilter === 'missing-start'}
                  title="Finished runners lack a recorded Start checkpoint scan. Click to inspect affected bibs."
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 shrink-0 ${
                    statusFilter === 'missing-start'
                      ? 'bg-yellow-300 text-yellow-950 border-yellow-600 dark:bg-yellow-500 dark:text-zinc-950 dark:border-yellow-400'
                      : 'bg-yellow-100 text-yellow-900 border-yellow-400 hover:bg-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900/60'
                  }`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>Start Delta (+{startDeltaBadgeCount})</span>
                </button>
              )}

              <span className="hidden lg:inline h-4 w-px bg-[var(--border-default)] shrink-0" aria-hidden="true" />

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewTab('stream')}
                  className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    previewTab === 'stream'
                      ? 'border-red-500/40 bg-red-500/10 text-[var(--text-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <CirclePlay className="w-3 h-3 text-red-500 shrink-0" aria-hidden="true" />
                  <span>Stream: {streamStatusLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('map')}
                  className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    previewTab === 'map'
                      ? 'border-red-500/40 bg-red-500/10 text-[var(--text-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <MapPinned className="w-3 h-3 text-red-500 shrink-0" aria-hidden="true" />
                  <span>Map: {mapStatusLabel}</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] font-mono text-[var(--text-secondary)] shrink-0 whitespace-nowrap">
              {publishedSnapshot
                ? `Published: ${formatDisplayClock(publishedSnapshot.updatedAt)}`
                : 'Board: Not published'}
            </div>
          </section>

          {/* 64% / 36% Split Control Room Workspace */}
          <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,64fr)_minmax(0,36fr)] gap-4 lg:gap-0 lg:overflow-hidden">
            {/* LEFT MASTER PANE (64%): WYSIWYG Public Leaderboard & Checkpoint Scan Stream */}
            <section
              aria-label="Live leaderboard and scan monitor"
              className="flex-1 min-h-0 flex flex-col glass-panel lg:rounded-none lg:border-0 lg:border-r lg:border-[var(--border-default)] overflow-hidden"
            >
              {/* Filter & Tab Header */}
              <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-[var(--border-default)] space-y-2 bg-[var(--surface-card)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    role="tablist"
                    aria-label="Live telemetry views"
                    className="inline-flex items-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={masterTab === 'leaderboard'}
                      onClick={() => setMasterTab('leaderboard')}
                      className={`min-h-9 lg:min-h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                        masterTab === 'leaderboard'
                          ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Trophy className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                      <span>Leaderboard Preview</span>
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                        {filteredResults.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={masterTab === 'scans'}
                      onClick={() => setMasterTab('scans')}
                      className={`min-h-9 lg:min-h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                        masterTab === 'scans'
                          ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                      <span>Checkpoint Scans</span>
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                        {filteredScans.length}
                      </span>
                    </button>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1 sm:max-w-md justify-end">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search
                        className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <label htmlFor="hub_runner_search" className="sr-only">
                        Search bib or runner name
                      </label>
                      <input
                        id="hub_runner_search"
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search bib or runner..."
                        className="w-full min-h-11 lg:min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] pl-8 pr-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {masterTab === 'leaderboard' ? (
                      <div className="shrink-0">
                        <label htmlFor="hub_status_filter" className="sr-only">
                          Filter runners by timing status
                        </label>
                        <select
                          id="hub_status_filter"
                          value={statusFilter}
                          onChange={(event) =>
                            setStatusFilter(event.target.value as LeaderboardStatusFilter)
                          }
                          className="min-h-11 lg:min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <option value="all">All runners</option>
                          <option value="finished">Finished ({finishedCount})</option>
                          <option value="on-course">On course (started)</option>
                          <option value="missing-start">
                            No start scan ({missingStartBibs.size})
                          </option>
                          {reviewRequiredCount > 0 && (
                            <option value="review">
                              Needs finish review ({reviewRequiredCount})
                            </option>
                          )}
                        </select>
                      </div>
                    ) : (
                      <div className="shrink-0">
                        <label htmlFor="hub_checkpoint_filter" className="sr-only">
                          Filter scans by checkpoint
                        </label>
                        <select
                          id="hub_checkpoint_filter"
                          value={checkpointFilter}
                          onChange={(event) => setCheckpointFilter(event.target.value)}
                          className="min-h-11 lg:min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <option value="all">All checkpoints</option>
                          {(activeRace?.checkpoints || []).map((cp) => (
                            <option key={cp.id} value={cp.id}>
                              {cp.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {/* Distance Filter Chips */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Distance filter">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-secondary)] mr-1">
                      <ListFilter className="w-3 h-3" aria-hidden="true" />
                      Distance:
                    </span>
                    <button
                      type="button"
                      onClick={() => setDistanceFilter('all')}
                      className={`min-h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                        distanceFilter === 'all'
                          ? 'bg-red-700 text-white border-red-500/40'
                          : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      All
                    </button>
                    {(activeRace?.distances || []).map((distance) => (
                      <button
                        key={distance.label}
                        type="button"
                        onClick={() => setDistanceFilter(distance.label)}
                        className={`min-h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          distanceFilter === distance.label
                            ? 'bg-red-700 text-white border-red-500/40'
                            : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {distance.label}
                      </button>
                    ))}
                  </div>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-1"
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                {/* Operational Advisories */}
                {!canInspectTiming && (
                  <p className="text-xs text-[var(--text-secondary)] bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-3 py-1.5">
                    Detailed roster and scan inspection require both roster.view and timing.view access. Public board totals appear in the telemetry ribbon above.
                  </p>
                )}
                {canInspectTiming && !canPublishBoard && (
                  <p className="text-xs text-yellow-900 bg-yellow-100 border border-yellow-300 dark:text-yellow-300 dark:bg-yellow-950/50 dark:border-yellow-800 rounded-lg px-3 py-1.5">
                    No wave gun start is recorded yet. Public visitors see an empty board until a wave starts or the race completes.
                  </p>
                )}
              </div>

              {/* Scrollable Feed / Leaderboard Area */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {!canInspectTiming ? (
                  <div className="p-6 text-center space-y-2">
                    <Trophy className="w-7 h-7 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      Published Snapshot View
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
                      {publishedSnapshot && publishedSnapshot.officialResults.length > 0
                        ? `${publishedSnapshot.officialResults.length} official finisher${publishedSnapshot.officialResults.length === 1 ? '' : 's'} currently live on the spectator leaderboard.`
                        : 'No official leaderboard entries are published yet for this event.'}
                    </p>
                  </div>
                ) : runnersError || readsError ? (
                  <div role="alert" className="p-6 text-center space-y-2">
                    <AlertTriangle className="w-7 h-7 text-red-500 mx-auto" aria-hidden="true" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      Could not load live timing feed
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {runnersError || readsError}
                    </p>
                  </div>
                ) : !runnersLoaded || !readsLoaded ? (
                  <div role="status" className="p-8 text-center space-y-2">
                    <RefreshCw
                      className="w-6 h-6 text-[var(--text-muted)] mx-auto animate-spin"
                      aria-hidden="true"
                    />
                    <p className="text-xs font-semibold text-[var(--text-secondary)]">
                      Syncing runner roster and checkpoint scans...
                    </p>
                  </div>
                ) : masterTab === 'leaderboard' ? (
                  filteredResults.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <Trophy className="w-7 h-7 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {results.length === 0 ? 'No runners registered yet' : 'No matching leaderboard rows'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {results.length === 0
                          ? 'Registered participants and incoming splits appear here in real time.'
                          : 'Try clearing the search term or switching the distance/status filter.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Desktop High-Density Table */}
                      <table className="hidden lg:table w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-[var(--surface-card)] border-b border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          <tr>
                            <th className="py-2.5 pl-4 pr-2 w-16">Rank</th>
                            <th className="py-2.5 px-2">Runner / Bib</th>
                            <th className="py-2.5 px-2">Division</th>
                            <th className="py-2.5 px-2">Official Time</th>
                            <th className="py-2.5 pl-2 pr-4 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-default)] text-xs">
                          {filteredResults.map((result) => {
                            const hasStarted = startedBibSet.has(result.bibNumber);
                            const isFinished = !!result.finishTime;
                            const isMissingStart = isFinished && !hasStarted;
                            const division = runnerDivisionLabel(result.runnerProfile);

                            return (
                              <tr
                                key={result.bibNumber}
                                className="hover:bg-[var(--surface-inset)] transition-colors duration-150"
                              >
                                <td className="py-2.5 pl-4 pr-2 font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                                  {result.rank ? `#${result.rank}` : '--'}
                                </td>
                                <td className="py-2.5 px-2 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)] shrink-0">
                                      {result.bibNumber}
                                    </span>
                                    <span className="font-semibold text-[var(--text-primary)] truncate">
                                      {runnerPublicName(result.runnerProfile, result.bibNumber)}
                                    </span>
                                  </div>
                                  {(result.categoryLabel || result.specialAgeAwards?.length) && (
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">
                                      {result.categoryLabel && (
                                        <span>
                                          {result.categoryLabel}
                                          {result.categoryRank ? ` (#${result.categoryRank})` : ''}
                                        </span>
                                      )}
                                      {result.specialAgeAwards?.length ? (
                                        <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                                          {result.specialAgeAwards.join(', ')}
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-[var(--text-secondary)] whitespace-nowrap">
                                  {division}
                                </td>
                                <td className="py-2.5 px-2 whitespace-nowrap">
                                  {isFinished ? (
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                                          {formatDisplayTime(result.finishTime)}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]">
                                          {timingMethodLabel(result.timingMethod)}
                                        </span>
                                      </div>
                                      {(result.chipTime || result.gunTime) && (
                                        <div className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                                          {result.chipTime ? `Chip ${formatDisplayTime(result.chipTime)}` : 'No chip start'}
                                          {result.gunTime ? ` / Gun ${formatDisplayTime(result.gunTime)}` : ''}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="font-mono text-[var(--text-muted)]">--</span>
                                  )}
                                </td>
                                <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-1">
                                    {result.finishReviewRequired && (
                                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700">
                                        Review
                                      </span>
                                    )}
                                    {isMissingStart ? (
                                      <span
                                        title="Finish recorded without a Start checkpoint scan"
                                        className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700"
                                      >
                                        No Start Scan
                                      </span>
                                    ) : isFinished ? (
                                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-700 text-white border-emerald-500/40">
                                        Finished
                                      </span>
                                    ) : hasStarted ? (
                                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                                        Started
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]">
                                        Registered
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Mobile / Tablet Stacked Cards (< 1024px) */}
                      <div className="lg:hidden divide-y divide-[var(--border-default)]">
                        {filteredResults.map((result) => {
                          const hasStarted = startedBibSet.has(result.bibNumber);
                          const isFinished = !!result.finishTime;
                          const isMissingStart = isFinished && !hasStarted;
                          return (
                            <div key={result.bibNumber} className="p-3.5 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-semibold text-[var(--text-secondary)]">
                                      {result.rank ? `#${result.rank}` : '--'}
                                    </span>
                                    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
                                      {result.bibNumber}
                                    </span>
                                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                      {runnerPublicName(result.runnerProfile, result.bibNumber)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                    {runnerDivisionLabel(result.runnerProfile)}
                                    {result.categoryLabel ? ` · ${result.categoryLabel}` : ''}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-mono tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                                    {isFinished ? formatDisplayTime(result.finishTime) : '--'}
                                  </p>
                                  <span
                                    className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                      isMissingStart
                                        ? 'bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700'
                                        : isFinished
                                        ? 'bg-emerald-700 text-white border-emerald-500/40'
                                        : hasStarted
                                        ? 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                                        : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                    }`}
                                  >
                                    {isMissingStart
                                      ? 'No Start Scan'
                                      : isFinished
                                      ? 'Finished'
                                      : hasStarted
                                      ? 'Started'
                                      : 'Registered'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )
                ) : filteredScans.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <Radio className="w-7 h-7 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {chipReads.length === 0 ? 'No checkpoint scans yet' : 'No matching checkpoint scans'}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {chipReads.length === 0
                        ? 'UHF RFID and manual checkpoint scans appear here as runners cross timing mats.'
                        : 'Try clearing the search term or checkpoint filter.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <table className="hidden lg:table w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10 bg-[var(--surface-card)] border-b border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        <tr>
                          <th className="py-2.5 pl-4 pr-2">Clock</th>
                          <th className="py-2.5 px-2">Bib / Runner</th>
                          <th className="py-2.5 px-2">Distance</th>
                          <th className="py-2.5 px-2">Checkpoint</th>
                          <th className="py-2.5 pl-2 pr-4 text-right">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-default)] text-xs">
                        {filteredScans.map((read) => {
                          const profile = runnerByBib.get(read.bibNumber);
                          return (
                            <tr
                              key={read.id}
                              className="hover:bg-[var(--surface-inset)] transition-colors duration-150"
                            >
                              <td className="py-2.5 pl-4 pr-2 font-mono tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
                                {formatDisplayClock(read.timestamp)}
                              </td>
                              <td className="py-2.5 px-2 min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)] shrink-0">
                                    {read.bibNumber}
                                  </span>
                                  <span className="font-semibold text-[var(--text-primary)] truncate">
                                    {runnerPublicName(profile, read.bibNumber)}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-[var(--text-secondary)] whitespace-nowrap">
                                {profile?.distance || '--'}
                              </td>
                              <td className="py-2.5 px-2 font-semibold text-[var(--text-primary)] whitespace-nowrap">
                                {checkpointNameById.get(read.checkpointId) || read.checkpointId}
                              </td>
                              <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-[11px] font-mono text-[var(--text-secondary)]">
                                  {read.source === 'rfid-bridge'
                                    ? `RFID${read.antenna ? ` · ANT ${read.antenna}` : ''}`
                                    : 'Manual'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div className="lg:hidden divide-y divide-[var(--border-default)]">
                      {filteredScans.map((read) => {
                        const profile = runnerByBib.get(read.bibNumber);
                        return (
                          <div key={read.id} className="p-3.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
                                  {read.bibNumber}
                                </span>
                                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                  {runnerPublicName(profile, read.bibNumber)}
                                </span>
                              </div>
                              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                {checkpointNameById.get(read.checkpointId) || read.checkpointId}
                                {profile?.distance ? ` · ${profile.distance}` : ''}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono tabular-nums text-xs font-semibold text-[var(--text-primary)]">
                                {formatDisplayClock(read.timestamp)}
                              </p>
                              <p className="text-[11px] font-mono text-[var(--text-muted)]">
                                {read.source === 'rfid-bridge' ? 'RFID' : 'Manual'}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* RIGHT DETAIL DOCK (36%): Media URL Inputs + Tabbed 16:9 Live Preview */}
            <aside
              aria-label="Broadcast media and route preview studio"
              className="shrink-0 lg:shrink lg:min-h-0 flex flex-col glass-panel lg:rounded-none lg:border-0 bg-[var(--surface-card)] overflow-hidden"
            >
              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4">
                {/* Co-located URL Inputs */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-red-500 shrink-0" aria-hidden="true" />
                      <span>Broadcast Media & Course Links</span>
                    </h2>
                    {hasUnsavedLinks && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-900 border border-yellow-400 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-700">
                        Unsaved edits
                      </span>
                    )}
                  </div>

                  {/* Livestream URL Input */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label
                        htmlFor="hub_livestream_url"
                        className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5"
                      >
                        <CirclePlay className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                        <span>Livestream link</span>
                      </label>
                      {externalStreamHref && (
                        <a
                          href={externalStreamHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
                        >
                          <span>Test link</span>
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        ref={streamInputRef}
                        id="hub_livestream_url"
                        type="url"
                        value={livestreamUrl}
                        disabled={!can('hub.manage')}
                        onChange={(event) => {
                          setLivestreamUrl(event.target.value);
                          setPreviewTab('stream');
                        }}
                        placeholder="YouTube Live or Facebook Live URL"
                        aria-invalid={!!streamUrlError}
                        className={`w-full min-h-11 lg:min-h-10 rounded-xl border bg-[var(--surface-inset)] px-3 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-60 ${
                          streamUrlError ? 'border-red-500' : 'border-[var(--border-default)]'
                        }`}
                      />
                      {livestreamUrl && can('hub.manage') && (
                        <button
                          type="button"
                          onClick={() => setLivestreamUrl('')}
                          aria-label="Clear livestream link"
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {streamUrlError ? (
                      <p role="alert" className="text-[11px] font-semibold text-red-500 mt-1">
                        {streamUrlError}
                      </p>
                    ) : (
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">
                        YouTube Live embeds directly below. Other platforms show a launch button.
                      </p>
                    )}
                  </div>

                  {/* Course Map URL Input */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label
                        htmlFor="hub_route_map_url"
                        className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5"
                      >
                        <MapPinned className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                        <span>Course map link</span>
                      </label>
                      {externalMapHref && (
                        <a
                          href={externalMapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
                        >
                          <span>Test link</span>
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        ref={mapInputRef}
                        id="hub_route_map_url"
                        type="url"
                        value={routeMapUrl}
                        disabled={!can('hub.manage')}
                        onChange={(event) => {
                          setRouteMapUrl(event.target.value);
                          setPreviewTab('map');
                        }}
                        placeholder="Google Maps embed or route share URL"
                        aria-invalid={!!mapUrlError}
                        className={`w-full min-h-11 lg:min-h-10 rounded-xl border bg-[var(--surface-inset)] px-3 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-60 ${
                          mapUrlError ? 'border-red-500' : 'border-[var(--border-default)]'
                        }`}
                      />
                      {routeMapUrl && can('hub.manage') && (
                        <button
                          type="button"
                          onClick={() => setRouteMapUrl('')}
                          aria-label="Clear course map link"
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {mapUrlError ? (
                      <p role="alert" className="text-[11px] font-semibold text-red-500 mt-1">
                        {mapUrlError}
                      </p>
                    ) : (
                      <p className="text-[11px] text-[var(--text-muted)] mt-1">
                        Paste a Google Maps Embed or OpenStreetMap embed link for an in-page map.
                      </p>
                    )}
                  </div>
                </div>

                {/* Tabbed 16:9 Interactive Embed Preview */}
                <div className="pt-3 border-t border-[var(--border-default)] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Public Embed Preview
                    </span>
                    <div
                      role="tablist"
                      aria-label="Public embed preview mode"
                      className="inline-flex items-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={previewTab === 'stream'}
                        onClick={() => setPreviewTab('stream')}
                        className={`min-h-9 lg:min-h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          previewTab === 'stream'
                            ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <CirclePlay className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                        <span>Stream</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={previewTab === 'map'}
                        onClick={() => setPreviewTab('map')}
                        className={`min-h-9 lg:min-h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                          previewTab === 'map'
                            ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <MapPinned className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                        <span>Map</span>
                      </button>
                    </div>
                  </div>

                  {/* Fixed 16:9 container prevents layout shift while loading iframes */}
                  <div className="aspect-video w-full rounded-xl overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center">
                    {previewTab === 'stream' ? (
                      streamEmbed ? (
                        <iframe
                          title="Livestream preview"
                          src={streamEmbed}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      ) : externalStreamHref ? (
                        <div className="p-4 text-center space-y-2">
                          <CirclePlay className="w-7 h-7 text-red-500 mx-auto" aria-hidden="true" />
                          <p className="text-xs text-[var(--text-secondary)]">
                            External stream link configured. Spectators will launch it in a new tab.
                          </p>
                          <a
                            href={externalStreamHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors duration-150"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Open livestream</span>
                          </a>
                        </div>
                      ) : (
                        <div className="p-4 text-center space-y-1.5">
                          <CirclePlay className="w-7 h-7 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
                          <p className="text-xs font-semibold text-[var(--text-secondary)]">
                            No livestream link yet
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Paste a YouTube or Facebook Live URL above to preview.
                          </p>
                        </div>
                      )
                    ) : mapEmbed ? (
                      <iframe
                        title="Course map preview"
                        src={mapEmbed}
                        className="w-full h-full border-0"
                        loading="lazy"
                      />
                    ) : externalMapHref ? (
                      <div className="p-4 text-center space-y-2">
                        <MapPinned className="w-7 h-7 text-red-500 mx-auto" aria-hidden="true" />
                        <p className="text-xs text-[var(--text-secondary)]">
                          External map URL configured. Spectators will open it in a new tab.
                        </p>
                        <a
                          href={externalMapHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold transition-colors duration-150"
                        >
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Open course map</span>
                        </a>
                      </div>
                    ) : (
                      <div className="p-4 text-center space-y-1.5">
                        <MapPinned className="w-7 h-7 text-[var(--text-muted)] mx-auto" aria-hidden="true" />
                        <p className="text-xs font-semibold text-[var(--text-secondary)]">
                          No course map link yet
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          Paste a Google Maps or OpenStreetMap embed URL above to preview.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Published Spectator Snapshot Readout */}
                <div className="pt-3 border-t border-[var(--border-default)]">
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                        <span>Spectator Snapshot</span>
                      </span>
                      <span className="text-[11px] font-mono uppercase text-[var(--text-secondary)]">
                        {publishedSnapshot ? publishedSnapshot.status : 'Unpublished'}
                      </span>
                    </div>
                    {snapshotError ? (
                      <p className="text-[11px] text-red-500">{snapshotError}</p>
                    ) : publishedSnapshot ? (
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                        <div>
                          <span className="block text-[var(--text-muted)]">Last pushed</span>
                          <span className="font-mono text-[var(--text-primary)]">
                            {formatDisplayTimestamp(publishedSnapshot.updatedAt)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[var(--text-muted)]">Published board</span>
                          <span className="font-mono text-[var(--text-primary)]">
                            {publishedSnapshot.officialResults.length} finishers ({publishedSnapshot.totalStarted} started)
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        No public leaderboard snapshot has been written for this race yet. Turn Public Live on or click Publish.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
