import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Download,
  Flag,
  Info,
  LocateFixed,
  Lock,
  MapPin,
  Mountain,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { isClientNavigationClick } from '../../lib/appRouting';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';
import { createEmptyRouteGeometry, processCanonicalGeometry } from '../../lib/routes/geometry';
import { loadPublishedCourse, subscribePublishedCatalog } from '../../lib/routes/routeStore';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import type {
  PublishedRaceRoute,
  RaceRouteCatalogEntry,
  RouteSelectionState,
} from '../../lib/routes/types';
import {
  computeRunnerLocationRelativeToRoute,
  useRunnerGeolocation,
} from '../../lib/routes/useRunnerGeolocation';
import {
  classifyRecordGnssStatus,
  filterPublishedExploreRoutes,
} from '../../lib/runnerShell';
import {
  computeRunCalorieEstimate,
  computeSegmentCaloriesKcal,
  resolveCalorieWeightKg,
  round1,
} from '../../lib/runs/calorieEngine';
import {
  CommunityRunApiError,
  completeRecordedRun,
  createCommunityRequestId,
  createRecordedRunId,
  type CompleteRecordedRunInput,
} from '../../lib/runs/communityRunsClient';
import {
  RunTracking,
  type DeviceLocationError,
  type NativeRunFix,
} from '../../lib/runs/nativeRunTracking';
import {
  clearActiveRunSnapshot,
  listPendingRunUploads,
  loadActiveRunSnapshot,
  removePendingRunUpload,
  saveActiveRunSnapshot,
  savePendingRunUpload,
} from '../../lib/runs/runCrashRecovery';
import {
  DEFAULT_PRIVACY_TRIM_M,
  buildRunGpxXml,
  computeActiveElapsedTimeMs,
  computePerKmSplits,
  createActiveRunSession,
  detectPhilippineIslandGroups,
  enrichRunTrackElevation,
  ingestRunFix,
  pauseActiveRun,
  resumeActiveRun,
  trimRunTrackEndpoints,
} from '../../lib/runs/runRecorderEngine';
import type {
  ActiveRunSession,
  PendingRunUpload,
  RecordedRunCourseRef,
  RecordedRunMode,
  RecordedRunPrivacy,
  RecordedRunSummary,
  RecordedTrackPoint,
  RunCalorieEstimate,
  RunSplitKm,
} from '../../lib/runs/types';
import type { UserProfile } from '../../types';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import { Select, type SelectOption } from '../ui/Select';
import type { ExploreCourseRunTarget } from './RunnerExplorePanel';

const RouteMapCanvas = lazy(() => import('../routes/RouteMapCanvas'));

export interface RunnerRecordPanelProps {
  profile: UserProfile;
  preselectedCourse?: ExploreCourseRunTarget | null;
  onSelectCourse?: (course: ExploreCourseRunTarget | null) => void;
  onOpenProfile: () => void;
  onBrowseRoutes?: () => void;
  onRecordingStateChange?: (active: boolean) => void;
  onRunSaved?: (run: RecordedRunSummary) => void;
  theme: 'light' | 'dark';
}

type RecordPhase = 'setup' | 'live' | 'summary';

interface SummaryComputation {
  runId: string;
  requestId: string;
  mode: RecordedRunMode;
  courseRef?: RecordedRunCourseRef;
  startedAt: string;
  finishedAt: string;
  elapsedTimeMs: number;
  movingTimeMs: number;
  clientDistanceM: number;
  homePrivacyTrimEnabled: boolean;
  trimmedHeadM: number;
  trimmedTailM: number;
  enrichedPoints: RecordedTrackPoint[];
  trimmedPoints: RecordedTrackPoint[];
  elevationGainM: number;
  elevationLossM: number;
  elevationSource: 'dem' | 'gps' | 'mixed';
  splits: RunSplitKm[];
  calorieEstimate: RunCalorieEstimate;
  islandGroups: Array<'Luzon' | 'Visayas' | 'Mindanao'>;
}

const PRIVACY_OPTIONS: ReadonlyArray<{
  value: RecordedRunPrivacy;
  label: string;
  hint: string;
}> = [
  { value: 'private', label: 'Private', hint: 'Only visible to you' },
  { value: 'friends', label: 'Friends', hint: 'Accepted RacePulsePH friends' },
  { value: 'public', label: 'Public', hint: 'Visible on public runner feed' },
];

const MIN_SERVER_MOVING_TIME_MS = 10_000;

function buildCourseKey(raceId: string, distanceId: string): string {
  return `${raceId}::${distanceId}`;
}

function dispatchAppNavigate(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url } }));
}

function formatDuration(ms: number): string {
  const safeSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function formatPace(secPerKm: number | null | undefined): string {
  if (
    secPerKm === null ||
    secPerKm === undefined ||
    !Number.isFinite(secPerKm) ||
    secPerKm <= 0 ||
    secPerKm > 3600
  ) {
    return '--:-- /km';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

function formatShortDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function buildDefaultRunTitle(
  mode: RecordedRunMode,
  courseRef?: RecordedRunCourseRef,
  now = new Date(),
): string {
  if (mode === 'course' && courseRef) {
    return `${courseRef.raceName} (${courseRef.distanceLabel})`.slice(0, 120);
  }
  let hour = now.getHours();
  try {
    const manilaHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        hour12: false,
      }).format(now),
    );
    if (Number.isFinite(manilaHour)) {
      hour = manilaHour % 24;
    }
  } catch {
    // Fallback to device clock hour when Intl timeZone is unavailable.
  }
  if (hour >= 5 && hour < 12) return 'Morning Free Run';
  if (hour >= 12 && hour < 17) return 'Afternoon Free Run';
  if (hour >= 17 && hour < 21) return 'Evening Free Run';
  return 'Night Free Run';
}

function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'racepulse-run';
}

function deriveSummaryCalorieEstimate(
  points: RecordedTrackPoint[],
  distanceM: number,
  movingTimeMs: number,
  weightKg?: number | null,
): RunCalorieEstimate {
  if (points.length >= 2) {
    return computeRunCalorieEstimate(points, weightKg);
  }
  const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(weightKg);
  const seg = computeSegmentCaloriesKcal({
    distanceM,
    deltaElevationM: 0,
    durationSec: movingTimeMs / 1000,
    weightKg: weightKgUsed,
  });
  const netKcal = round1(seg.netKcal);
  const restingKcal = round1(seg.restingKcal);
  return {
    totalKcal: round1(netKcal + restingKcal),
    netKcal,
    restingKcal,
    weightKgUsed,
    usedReferenceWeight,
    methodVersion: 'minetti2002-herrmann2024-v1',
  };
}

function formatNotificationSubtitle(session: ActiveRunSession, elapsedMs: number): string {
  const km = (session.distanceM / 1000).toFixed(2);
  const time = formatDuration(elapsedMs);
  return `${km} km · ${time} · ${Math.round(session.totalKcal)} kcal`;
}

function computeElevationGainLossFromPoints(points: RecordedTrackPoint[]): {
  gainM: number;
  lossM: number;
} {
  let anchor: number | null = null;
  let gainM = 0;
  let lossM = 0;

  for (const pt of points) {
    if (pt.segmentBreak) {
      anchor = typeof pt.ele === 'number' && Number.isFinite(pt.ele) ? pt.ele : null;
      continue;
    }
    if (typeof pt.ele !== 'number' || !Number.isFinite(pt.ele)) {
      continue;
    }
    if (anchor === null) {
      anchor = pt.ele;
      continue;
    }
    const delta = pt.ele - anchor;
    if (delta >= 2.5) {
      gainM = round1(gainM + delta);
      anchor = pt.ele;
    } else if (delta <= -2.5) {
      lossM = round1(lossM + Math.abs(delta));
      anchor = pt.ele;
    }
  }
  return { gainM, lossM };
}

export default function RunnerRecordPanel({
  profile,
  preselectedCourse,
  onSelectCourse,
  onOpenProfile,
  onBrowseRoutes,
  onRecordingStateChange,
  onRunSaved,
  theme,
}: RunnerRecordPanelProps) {
  const baseId = useId();
  const courseLabelId = `${baseId}-course-label`;
  const courseSelectId = `${baseId}-course-select`;
  const summaryTitleId = `${baseId}-summary-title`;
  const summaryTitleErrorId = `${baseId}-summary-title-error`;
  const calorieDialogTitleId = `${baseId}-calorie-dialog-title`;
  const calorieDialogDescId = `${baseId}-calorie-dialog-desc`;

  const { confirm, notify } = useFeedback();
  const geo = useRunnerGeolocation();

  const [phase, setPhase] = useState<RecordPhase>('setup');
  const [publishedRoutes, setPublishedRoutes] = useState<RaceRouteCatalogEntry[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [selectedCourseKey, setSelectedCourseKey] = useState<string>(() =>
    preselectedCourse ? buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId) : '',
  );
  const [loadedCourse, setLoadedCourse] = useState<PublishedRaceRoute | null>(null);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);
  const [homePrivacyTrimEnabled, setHomePrivacyTrimEnabled] = useState(true);
  const [calorieInfoOpen, setCalorieInfoOpen] = useState(false);

  const [recoveredDraft, setRecoveredDraft] = useState<ActiveRunSession | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingRunUpload[]>([]);
  const [recoveryLoaded, setRecoveryLoaded] = useState(false);
  const [syncingPending, setSyncingPending] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [session, setSession] = useState<ActiveRunSession | null>(null);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());
  const [liveTrackingError, setLiveTrackingError] = useState<string | null>(null);
  const [splitsOpen, setSplitsOpen] = useState(false);
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);

  const [summaryData, setSummaryData] = useState<SummaryComputation | null>(null);
  const [enrichingSummary, setEnrichingSummary] = useState(false);
  const [summaryTitle, setSummaryTitle] = useState('');
  const [summaryPrivacy, setSummaryPrivacy] = useState<RecordedRunPrivacy>('private');
  const [summaryTitleError, setSummaryTitleError] = useState<string | null>(null);
  const [savingRun, setSavingRun] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sessionRef = useRef<ActiveRunSession | null>(null);
  const phaseRef = useRef<RecordPhase>(phase);
  const profileWeightRef = useRef<number | null | undefined>(profile.weightKg);
  const onRecordingStateChangeRef = useRef(onRecordingStateChange);
  const listenerHandlesRef = useRef<PluginListenerHandle[]>([]);
  const trackingGenerationRef = useRef(0);
  const trackingStartedRef = useRef(false);
  const hasAutoCenteredRef = useRef(false);
  const lastNotificationAtRef = useRef(0);
  const lastRawTimestampRef = useRef(0);
  const prevCorridorChainageRef = useRef<number | undefined>(undefined);
  const flyNonceRef = useRef(0);

  phaseRef.current = phase;
  profileWeightRef.current = profile.weightKg;
  onRecordingStateChangeRef.current = onRecordingStateChange;

  const centerMapOn = useCallback((lat: number, lon: number) => {
    flyNonceRef.current += 1;
    setFlyToTrigger({
      lat,
      lon,
      zoom: 16,
      nonce: flyNonceRef.current,
    });
  }, []);

  const updateSession = useCallback((next: ActiveRunSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const stopNativeTracking = useCallback(async () => {
    trackingGenerationRef.current += 1;
    const handles = listenerHandlesRef.current;
    listenerHandlesRef.current = [];
    await Promise.all(
      handles.map((h) =>
        h.remove().catch((err) => {
          console.warn('[RunnerRecordPanel] listener remove skipped', err);
        }),
      ),
    );
    if (trackingStartedRef.current) {
      trackingStartedRef.current = false;
      await RunTracking.stopTracking().catch((err) => {
        console.warn('[RunnerRecordPanel] stopTracking warning', err);
      });
    }
  }, []);

  useEffect(() => {
    onRecordingStateChangeRef.current?.(phase === 'live' || phase === 'summary');
  }, [phase]);

  useEffect(() => {
    return () => {
      void stopNativeTracking();
      onRecordingStateChangeRef.current?.(false);
    };
  }, [stopNativeTracking]);

  useEffect(() => {
    const unsubscribe = subscribePublishedCatalog((entries) => {
      setPublishedRoutes(filterPublishedExploreRoutes(entries));
      setRoutesLoaded(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!preselectedCourse) return;
    setSelectedCourseKey(buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId));
  }, [preselectedCourse]);

  useEffect(() => {
    let cancelled = false;
    setRecoveredDraft(null);
    setPendingUploads([]);
    setRecoveryLoaded(false);
    setPendingError(null);

    Promise.all([loadActiveRunSnapshot(profile.uid), listPendingRunUploads(profile.uid)])
      .then(([draft, pending]) => {
        if (cancelled) return;
        setRecoveredDraft(draft);
        setPendingUploads(pending);
        setRecoveryLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[RunnerRecordPanel] crash recovery load failed', err);
        setRecoveryLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [profile.uid]);

  const selectedCatalogEntry = useMemo(
    () =>
      publishedRoutes.find(
        (entry) => buildCourseKey(entry.raceId, entry.distanceId) === selectedCourseKey,
      ) ?? null,
    [publishedRoutes, selectedCourseKey],
  );

  useEffect(() => {
    if (!selectedCourseKey) {
      setLoadedCourse(null);
      setCourseLoading(false);
      setCourseLoadError(null);
      return;
    }

    const [raceId, distanceId] = selectedCourseKey.split('::');
    if (!raceId || !distanceId) {
      setLoadedCourse(null);
      setCourseLoading(false);
      setCourseLoadError('Invalid course selection.');
      return;
    }

    const publicationId =
      selectedCatalogEntry?.currentPublicationId ??
      (preselectedCourse &&
      buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId) === selectedCourseKey
        ? preselectedCourse.publicationId
        : undefined);

    let cancelled = false;
    setCourseLoading(true);
    setCourseLoadError(null);

    loadPublishedCourse(raceId, distanceId, publicationId)
      .then((res) => {
        if (cancelled) return;
        if (!res.publication || res.withdrawn) {
          setLoadedCourse(null);
          setCourseLoadError(
            res.withdrawn
              ? res.withdrawalReason || 'This published course was withdrawn by the organizer.'
              : 'Course geometry could not be loaded. Try again or switch to Free Run.',
          );
        } else {
          setLoadedCourse(res.publication);
          setCourseLoadError(null);
        }
        setCourseLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[RunnerRecordPanel] loadPublishedCourse failed', err);
        setLoadedCourse(null);
        setCourseLoadError('Unable to load course map right now.');
        setCourseLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCourseKey, selectedCatalogEntry?.currentPublicationId, preselectedCourse]);

  const emptyFreeRunRoute = useMemo(
    () => processCanonicalGeometry(createEmptyRouteGeometry()),
    [],
  );

  const courseRoute = useMemo(
    () => (loadedCourse ? processCanonicalGeometry(loadedCourse.canonicalGeometry) : null),
    [loadedCourse],
  );

  const courseMarkers = useMemo(() => loadedCourse?.markers ?? [], [loadedCourse]);

  const handleIncomingFix = useCallback(
    (fix: NativeRunFix, options?: { fromBuffer?: boolean }) => {
      const current = sessionRef.current;
      if (!current || current.status !== 'recording') return;

      const fixTs =
        typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp) && fix.timestamp > 0
          ? fix.timestamp
          : Date.now();
      if (options?.fromBuffer && fixTs <= lastRawTimestampRef.current) {
        return;
      }
      if (fixTs < lastRawTimestampRef.current) {
        return;
      }
      lastRawTimestampRef.current = fixTs;

      const nextSession = ingestRunFix(
        current,
        {
          lat: fix.latitude,
          lon: fix.longitude,
          accuracyM: fix.accuracyM,
          altitudeM: fix.altitudeM,
          headingDeg: fix.headingDeg,
          speedMps: fix.speedMps,
          timestampMs: fixTs,
        },
        { weightKg: profileWeightRef.current },
      );

      sessionRef.current = nextSession;
      setSession(nextSession);
      setLiveTrackingError(null);

      if (nextSession.points.length > current.points.length) {
        void saveActiveRunSnapshot(nextSession).catch((err) => {
          console.warn('[RunnerRecordPanel] snapshot persist failed', err);
        });
      }

      if (!hasAutoCenteredRef.current && nextSession.gpsFilter.current) {
        hasAutoCenteredRef.current = true;
        centerMapOn(nextSession.gpsFilter.current.lat, nextSession.gpsFilter.current.lon);
      }

      const now = Date.now();
      if (now - lastNotificationAtRef.current >= 5000) {
        lastNotificationAtRef.current = now;
        const elapsedMs = computeActiveElapsedTimeMs(nextSession, now);
        const notifTitle =
          nextSession.mode === 'course' && nextSession.courseRef
            ? `${nextSession.courseRef.raceName} (${nextSession.courseRef.distanceLabel})`
            : 'RacePulsePH Live Run';
        void RunTracking.updateNotification({
          title: notifTitle,
          subtitle: formatNotificationSubtitle(nextSession, elapsedMs),
        }).catch(() => undefined);
      }
    },
    [centerMapOn],
  );

  const handleTrackingError = useCallback(
    (err: DeviceLocationError) => {
      const msg = err.message || 'Waiting for stronger GPS signal.';
      setLiveTrackingError(msg);
      if (err.code === 1 && sessionRef.current?.status === 'recording') {
        const paused = pauseActiveRun(sessionRef.current, Date.now());
        updateSession(paused);
        void saveActiveRunSnapshot(paused).catch((saveErr) => {
          console.warn('[RunnerRecordPanel] snapshot persist on permission deny failed', saveErr);
        });
        void stopNativeTracking();
        notify({
          tone: 'error',
          title: 'Location permission denied',
          message: 'Recording was paused. Enable location permission and tap Resume.',
        });
      }
    },
    [notify, stopNativeTracking, updateSession],
  );

  const startNativeTracking = useCallback(
    async (activeSession: ActiveRunSession) => {
      const gen = ++trackingGenerationRef.current;
      await Promise.all(
        listenerHandlesRef.current.map((h) => h.remove().catch(() => undefined)),
      );
      listenerHandlesRef.current = [];

      try {
        const fixHandle = await RunTracking.addListener('locationFix', (fix) => {
          if (trackingGenerationRef.current !== gen) return;
          handleIncomingFix(fix);
        });
        if (trackingGenerationRef.current !== gen) {
          void fixHandle.remove().catch(() => undefined);
          return;
        }

        const errHandle = await RunTracking.addListener('trackingError', (err) => {
          if (trackingGenerationRef.current !== gen) return;
          handleTrackingError(err);
        });
        if (trackingGenerationRef.current !== gen) {
          void fixHandle.remove().catch(() => undefined);
          void errHandle.remove().catch(() => undefined);
          return;
        }

        listenerHandlesRef.current = [fixHandle, errHandle];
        trackingStartedRef.current = true;
        const notifTitle =
          activeSession.mode === 'course' && activeSession.courseRef
            ? `${activeSession.courseRef.raceName} (${activeSession.courseRef.distanceLabel})`
            : 'RacePulsePH Live Run';
        await RunTracking.startTracking({
          title: notifTitle,
          subtitle: formatNotificationSubtitle(
            activeSession,
            computeActiveElapsedTimeMs(activeSession),
          ),
        });
      } catch (err) {
        if (trackingGenerationRef.current !== gen) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to start GPS tracking on this device.';
        setLiveTrackingError(message);
      }
    },
    [handleIncomingFix, handleTrackingError],
  );

  useEffect(() => {
    if (phase !== 'live' || session?.status !== 'recording') {
      return;
    }
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, session?.status]);

  useEffect(() => {
    if (phase !== 'live' || session?.status !== 'recording' || typeof document === 'undefined') {
      return;
    }
    let draining = false;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || draining) return;
      draining = true;
      void RunTracking.getBufferedFixes()
        .then(({ fixes }) => {
          if (!Array.isArray(fixes) || fixes.length === 0) return;
          const sorted = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
          for (const fix of sorted) {
            handleIncomingFix(fix, { fromBuffer: true });
          }
        })
        .catch((err) => {
          console.warn('[RunnerRecordPanel] buffered fix drain failed', err);
        })
        .finally(() => {
          draining = false;
        });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [phase, session?.status, handleIncomingFix]);

  const handleCourseChange = (nextKey: string) => {
    setSelectedCourseKey(nextKey);
    if (!nextKey) {
      onSelectCourse?.(null);
      return;
    }
    const matched = publishedRoutes.find(
      (entry) => buildCourseKey(entry.raceId, entry.distanceId) === nextKey,
    );
    if (matched) {
      onSelectCourse?.({
        raceId: matched.raceId,
        distanceId: matched.distanceId,
        label: `${matched.raceName} (${matched.distanceLabel})`,
        publicationId: matched.currentPublicationId,
      });
    }
  };

  const resetToSetup = useCallback(async () => {
    await stopNativeTracking();
    updateSession(null);
    setSummaryData(null);
    setSaveError(null);
    setSummaryTitleError(null);
    setLiveTrackingError(null);
    setSplitsOpen(false);
    hasAutoCenteredRef.current = false;
    lastRawTimestampRef.current = 0;
    lastNotificationAtRef.current = 0;
    prevCorridorChainageRef.current = undefined;
    setPhase('setup');
    const latestPending = await listPendingRunUploads(profile.uid).catch(() => []);
    setPendingUploads(latestPending);
    setRecoveredDraft(null);
  }, [profile.uid, stopNativeTracking, updateSession]);

  const handleStartRun = async () => {
    geo.stopTracking();
    hasAutoCenteredRef.current = false;
    lastRawTimestampRef.current = 0;
    lastNotificationAtRef.current = 0;
    prevCorridorChainageRef.current = undefined;
    setLiveTrackingError(null);
    setSplitsOpen(false);

    let courseRef: RecordedRunCourseRef | undefined;
    if (selectedCourseKey) {
      if (loadedCourse) {
        courseRef = {
          raceId: loadedCourse.raceId,
          distanceId: loadedCourse.distanceId,
          publicationId: loadedCourse.id,
          raceName: loadedCourse.raceName,
          distanceLabel: loadedCourse.distanceLabel,
          advertisedKm: loadedCourse.advertisedKm,
          ...(selectedCatalogEntry?.region ? { region: selectedCatalogEntry.region } : {}),
        };
      } else if (selectedCatalogEntry) {
        courseRef = {
          raceId: selectedCatalogEntry.raceId,
          distanceId: selectedCatalogEntry.distanceId,
          publicationId: selectedCatalogEntry.currentPublicationId,
          raceName: selectedCatalogEntry.raceName,
          distanceLabel: selectedCatalogEntry.distanceLabel,
          advertisedKm: selectedCatalogEntry.advertisedKm,
          region: selectedCatalogEntry.region,
        };
      }
    }

    const newSession = createActiveRunSession({
      sessionId: createRecordedRunId(),
      uid: profile.uid,
      mode: courseRef ? 'course' : 'free',
      courseRef,
      homePrivacyTrimEnabled,
    });
    updateSession(newSession);
    setNowTickMs(newSession.startedAtMs);
    setPhase('live');
    await saveActiveRunSnapshot(newSession).catch((err) => {
      console.warn('[RunnerRecordPanel] initial snapshot save failed', err);
    });
    await startNativeTracking(newSession);
  };

  const handleResumeRecoveredDraft = async () => {
    if (!recoveredDraft) return;
    geo.stopTracking();
    hasAutoCenteredRef.current = false;
    lastNotificationAtRef.current = 0;
    prevCorridorChainageRef.current = undefined;
    lastRawTimestampRef.current = recoveredDraft.lastAcceptedAtMs || 0;
    setLiveTrackingError(null);
    setSplitsOpen(false);

    // Normalize crash downtime as paused at the last recorded timestamp so dead crash hours
    // are never counted toward active elapsed time or resting calorie expenditure.
    const crashPausedAtMs =
      recoveredDraft.updatedAtMs || recoveredDraft.lastAcceptedAtMs || Date.now();
    const normalizedPaused = pauseActiveRun(recoveredDraft, crashPausedAtMs);

    if (normalizedPaused.courseRef) {
      const courseKey = buildCourseKey(
        normalizedPaused.courseRef.raceId,
        normalizedPaused.courseRef.distanceId,
      );
      setSelectedCourseKey(courseKey);
    } else {
      setSelectedCourseKey('');
    }

    setHomePrivacyTrimEnabled(normalizedPaused.homePrivacyTrimEnabled);
    updateSession(normalizedPaused);
    setRecoveredDraft(null);
    setNowTickMs(crashPausedAtMs);
    setPhase('live');
    await saveActiveRunSnapshot(normalizedPaused).catch((err) => {
      console.warn('[RunnerRecordPanel] normalized draft save failed', err);
    });
  };

  const handleDiscardRecoveredDraft = async () => {
    const ok = await confirm({
      title: 'Discard saved run draft?',
      message:
        'This permanently deletes your interrupted GPS track and distance totals from this device.',
      confirmLabel: 'Discard draft',
      cancelLabel: 'Keep draft',
      destructive: true,
    });
    if (!ok) return;
    await clearActiveRunSnapshot(profile.uid);
    setRecoveredDraft(null);
    notify({ tone: 'info', title: 'Draft discarded' });
  };

  const handlePauseRun = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status === 'paused') return;
    await stopNativeTracking();
    const paused = pauseActiveRun(current, Date.now());
    updateSession(paused);
    setNowTickMs(paused.pausedAtMs ?? Date.now());
    await saveActiveRunSnapshot(paused).catch((err) => {
      console.warn('[RunnerRecordPanel] pause snapshot save failed', err);
    });
  }, [stopNativeTracking, updateSession]);

  const handleResumeRun = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status === 'recording') return;
    const now = Date.now();
    const resumed = resumeActiveRun(current, now);
    updateSession(resumed);
    setNowTickMs(now);
    setLiveTrackingError(null);
    await saveActiveRunSnapshot(resumed).catch((err) => {
      console.warn('[RunnerRecordPanel] resume snapshot save failed', err);
    });
    await startNativeTracking(resumed);
  }, [startNativeTracking, updateSession]);

  const handleDiscardLiveOrSummaryRun = useCallback(async () => {
    const ok = await confirm({
      title: 'Discard this recorded run?',
      message:
        'Your recorded distance, splits, and GPS track for this session will be deleted and cannot be recovered.',
      confirmLabel: 'Discard run',
      cancelLabel: 'Keep run',
      destructive: true,
    });
    if (!ok) return;
    await clearActiveRunSnapshot(profile.uid);
    await resetToSetup();
    notify({ tone: 'info', title: 'Run discarded' });
  }, [confirm, notify, profile.uid, resetToSetup]);

  const handleFinishRun = async () => {
    const current = sessionRef.current;
    if (!current) return;

    if (current.movingTimeMs < MIN_SERVER_MOVING_TIME_MS) {
      const discardShort = await confirm({
        title: 'Run is under 10 seconds',
        message:
          'Verified runs require at least 10 seconds of active moving time. Keep recording to reach 10 seconds, or discard this short session.',
        confirmLabel: 'Discard session',
        cancelLabel: 'Keep recording',
        destructive: true,
      });
      if (discardShort) {
        await clearActiveRunSnapshot(profile.uid);
        await resetToSetup();
        notify({ tone: 'info', title: 'Short session discarded' });
      }
      return;
    }

    await stopNativeTracking();
    const nowMs = Date.now();
    const paused = pauseActiveRun(current, nowMs);
    updateSession(paused);
    await saveActiveRunSnapshot(paused).catch((err) => {
      console.warn('[RunnerRecordPanel] finish snapshot save failed', err);
    });

    const elapsedTimeMs = computeActiveElapsedTimeMs(paused, nowMs);
    const finishedMs = Math.max(paused.startedAtMs + 1000, nowMs);
    const startedAtIso = new Date(paused.startedAtMs).toISOString();
    const finishedAtIso = new Date(finishedMs).toISOString();
    const clientDistanceM = round1(paused.distanceM);

    const initialTrim = paused.homePrivacyTrimEnabled
      ? trimRunTrackEndpoints(paused.points, DEFAULT_PRIVACY_TRIM_M)
      : { trimmedPoints: [...paused.points], trimmedHeadM: 0, trimmedTailM: 0 };
    const initialSafeTrimmed =
      initialTrim.trimmedPoints.length >= 2 ? initialTrim.trimmedPoints : [];
    const initialMetricsPoints =
      initialSafeTrimmed.length >= 2 ? initialSafeTrimmed : paused.points;

    const initialSummary: SummaryComputation = {
      runId: paused.sessionId,
      requestId: createCommunityRequestId(),
      mode: paused.mode,
      courseRef: paused.courseRef,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      elapsedTimeMs,
      movingTimeMs: Math.round(paused.movingTimeMs),
      clientDistanceM,
      homePrivacyTrimEnabled: paused.homePrivacyTrimEnabled,
      trimmedHeadM: initialTrim.trimmedHeadM,
      trimmedTailM: initialTrim.trimmedTailM,
      enrichedPoints: paused.points,
      trimmedPoints: initialSafeTrimmed,
      elevationGainM: round1(paused.elevationGainM),
      elevationLossM: round1(paused.elevationLossM),
      elevationSource: 'gps',
      splits: computePerKmSplits(initialMetricsPoints, profile.weightKg),
      calorieEstimate: deriveSummaryCalorieEstimate(
        initialSafeTrimmed,
        clientDistanceM,
        paused.movingTimeMs,
        profile.weightKg,
      ),
      islandGroups: detectPhilippineIslandGroups(paused.points),
    };

    setSummaryTitle(buildDefaultRunTitle(paused.mode, paused.courseRef, new Date(paused.startedAtMs)));
    setSummaryPrivacy('private');
    setSummaryTitleError(null);
    setSaveError(null);
    setSummaryData(initialSummary);
    setEnrichingSummary(true);
    setPhase('summary');

    try {
      const enriched = await enrichRunTrackElevation(paused.points);
      if (phaseRef.current !== 'summary') return;

      const trimmed = paused.homePrivacyTrimEnabled
        ? trimRunTrackEndpoints(enriched.points, DEFAULT_PRIVACY_TRIM_M)
        : { trimmedPoints: [...enriched.points], trimmedHeadM: 0, trimmedTailM: 0 };
      const normalizedTrimmedPoints =
        trimmed.trimmedPoints.length >= 2 ? trimmed.trimmedPoints : [];
      const activeTrack =
        normalizedTrimmedPoints.length >= 2 ? normalizedTrimmedPoints : enriched.points;
      const elevTotals =
        normalizedTrimmedPoints.length >= 2
          ? computeElevationGainLossFromPoints(normalizedTrimmedPoints)
          : { gainM: enriched.elevationGainM, lossM: enriched.elevationLossM };

      setSummaryData((prev) =>
        prev
          ? {
              ...prev,
              enrichedPoints: enriched.points,
              trimmedPoints: normalizedTrimmedPoints,
              trimmedHeadM: trimmed.trimmedHeadM,
              trimmedTailM: trimmed.trimmedTailM,
              elevationGainM: elevTotals.gainM,
              elevationLossM: elevTotals.lossM,
              elevationSource: enriched.elevationSource,
              splits: computePerKmSplits(activeTrack, profileWeightRef.current),
              calorieEstimate: deriveSummaryCalorieEstimate(
                normalizedTrimmedPoints,
                prev.clientDistanceM,
                prev.movingTimeMs,
                profileWeightRef.current,
              ),
              islandGroups: detectPhilippineIslandGroups(enriched.points),
            }
          : prev,
      );
    } catch (err) {
      console.warn('[RunnerRecordPanel] summary elevation enrichment failed', err);
    } finally {
      setEnrichingSummary(false);
    }
  };

  const handleResumeFromSummary = () => {
    if (!session || savingRun) return;
    setSummaryData(null);
    setSaveError(null);
    setSummaryTitleError(null);
    setPhase('live');
  };

  const handleExportGpx = () => {
    if (!summaryData) return;
    if (summaryData.trimmedPoints.length === 0) {
      notify({
        tone: 'info',
        title: 'No GPX points to export',
        message: summaryData.homePrivacyTrimEnabled
          ? 'Runs under 450 m are fully inside the 200 m privacy zone, so GPS coordinates are omitted.'
          : 'No GPS track points were captured for this session.',
      });
      return;
    }

    const title = summaryTitle.trim() || 'RacePulsePH Recorded Run';
    const xml = buildRunGpxXml({
      title,
      startedAt: summaryData.startedAt,
      points: summaryData.trimmedPoints,
      privacyTrimApplied: summaryData.homePrivacyTrimEnabled,
    });
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyFilename(title)}.gpx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notify({ tone: 'success', title: 'GPX track exported' });
  };

  const handleSaveRun = async () => {
    if (!summaryData || savingRun) return;
    const trimmedTitle = summaryTitle.trim();
    if (!trimmedTitle || trimmedTitle.length > 120) {
      setSummaryTitleError('Enter a run title between 1 and 120 characters.');
      return;
    }
    if (
      summaryData.trimmedPoints.length === 0 &&
      (!summaryData.homePrivacyTrimEnabled || summaryData.clientDistanceM > 500)
    ) {
      setSaveError(
        'Cannot save run without at least 2 GPS track points unless short privacy trim (<= 500 m) applies.',
      );
      return;
    }

    setSummaryTitleError(null);
    setSaveError(null);
    setSavingRun(true);

    const completeInput: CompleteRecordedRunInput = {
      requestId: summaryData.requestId,
      runId: summaryData.runId,
      mode: summaryData.mode,
      privacy: summaryPrivacy,
      title: trimmedTitle,
      startedAt: summaryData.startedAt,
      finishedAt: summaryData.finishedAt,
      movingTimeMs: summaryData.movingTimeMs,
      clientDistanceM: summaryData.clientDistanceM,
      trimmedHeadM: summaryData.trimmedHeadM,
      trimmedTailM: summaryData.trimmedTailM,
      homePrivacyTrimEnabled: summaryData.homePrivacyTrimEnabled,
      ...(summaryData.courseRef ? { courseRef: summaryData.courseRef } : {}),
      trackPoints: summaryData.trimmedPoints,
    };

    try {
      const savedRun = await completeRecordedRun(completeInput);
      await clearActiveRunSnapshot(profile.uid);
      notify({
        tone: 'success',
        title: 'Run saved',
        message: `${(savedRun.distanceM / 1000).toFixed(2)} km logged to your activity feed.`,
      });
      onRunSaved?.(savedRun);
      await resetToSetup();
    } catch (err) {
      const apiErr =
        err instanceof CommunityRunApiError
          ? err
          : new CommunityRunApiError(
              err instanceof Error && err.message ? err.message : 'Unable to save run.',
              0,
              { retryable: true },
            );

      if (apiErr.retryable) {
        const { trackPoints: _omitPoints, ...payloadMeta } = completeInput;
        const pendingEntry: PendingRunUpload = {
          requestId: summaryData.requestId,
          runId: summaryData.runId,
          uid: profile.uid,
          payload: payloadMeta as Record<string, unknown>,
          trimmedTrackPoints: summaryData.trimmedPoints,
          createdAt: new Date().toISOString(),
          attempts: 1,
          lastError: apiErr.message,
        };
        await savePendingRunUpload(pendingEntry);
        await clearActiveRunSnapshot(profile.uid);
        notify({
          tone: 'info',
          title: 'Saved offline to pending queue',
          message: 'Your run is stored safely on this device and ready to sync when online.',
        });
        await resetToSetup();
      } else {
        setSaveError(apiErr.message);
      }
    } finally {
      setSavingRun(false);
    }
  };

  const handleRetryPendingSync = async () => {
    if (syncingPending || pendingUploads.length === 0) return;
    setSyncingPending(true);
    setPendingError(null);
    let syncedCount = 0;

    try {
      for (const item of pendingUploads) {
        const rawPayload = item.payload as Partial<CompleteRecordedRunInput>;
        const trackPoints =
          item.trimmedTrackPoints.length > 0
            ? item.trimmedTrackPoints
            : (rawPayload.trackPoints ?? []);
        const input: CompleteRecordedRunInput = {
          requestId: item.requestId,
          runId: item.runId,
          mode: rawPayload.mode ?? 'free',
          privacy: rawPayload.privacy ?? 'private',
          title: rawPayload.title || 'Recorded Run',
          startedAt: rawPayload.startedAt || item.createdAt,
          finishedAt: rawPayload.finishedAt || new Date().toISOString(),
          movingTimeMs: Number(rawPayload.movingTimeMs ?? MIN_SERVER_MOVING_TIME_MS),
          clientDistanceM: Number(rawPayload.clientDistanceM ?? 0),
          trimmedHeadM: Number(rawPayload.trimmedHeadM ?? 0),
          trimmedTailM: Number(rawPayload.trimmedTailM ?? 0),
          homePrivacyTrimEnabled: Boolean(rawPayload.homePrivacyTrimEnabled ?? true),
          ...(rawPayload.courseRef ? { courseRef: rawPayload.courseRef } : {}),
          trackPoints,
        };

        try {
          const savedRun = await completeRecordedRun(input);
          await removePendingRunUpload(profile.uid, item.requestId);
          syncedCount += 1;
          onRunSaved?.(savedRun);
        } catch (err) {
          const apiErr =
            err instanceof CommunityRunApiError
              ? err
              : new CommunityRunApiError(
                  err instanceof Error && err.message ? err.message : 'Pending sync failed.',
                  0,
                  { retryable: true },
                );

          await savePendingRunUpload({
            ...item,
            attempts: item.attempts + 1,
            lastError: apiErr.message,
          });
          setPendingError(apiErr.message);
          notify({
            tone: 'error',
            title: apiErr.retryable ? 'Sync paused' : 'Run upload rejected',
            message: apiErr.message,
          });
          if (!apiErr.retryable) {
            continue;
          }
          break;
        }
      }

      const remaining = await listPendingRunUploads(profile.uid);
      setPendingUploads(remaining);
      if (syncedCount > 0 && remaining.length === 0) {
        notify({
          tone: 'success',
          title: syncedCount === 1 ? 'Pending run synced' : `${syncedCount} pending runs synced`,
        });
      }
    } finally {
      setSyncingPending(false);
    }
  };

  const handleDeletePendingUpload = async (item: PendingRunUpload) => {
    const runTitle =
      typeof item.payload.title === 'string' && item.payload.title.trim()
        ? item.payload.title.trim()
        : 'this queued run';
    const ok = await confirm({
      title: 'Remove queued upload?',
      message: `Remove "${runTitle}" from the local upload queue? It has not been saved to the cloud yet.`,
      confirmLabel: 'Remove upload',
      cancelLabel: 'Keep in queue',
      destructive: true,
    });
    if (!ok) return;
    await removePendingRunUpload(profile.uid, item.requestId);
    setPendingUploads((prev) => prev.filter((p) => p.requestId !== item.requestId));
    setPendingError(null);
    notify({ tone: 'info', title: 'Removed from upload queue' });
  };

  useAndroidBackHandler(phase === 'live' || phase === 'summary', () => {
    if (phase === 'live') {
      if (sessionRef.current?.status === 'recording') {
        void handlePauseRun();
        notify({ tone: 'info', title: 'Run paused' });
        return true;
      }
      void handleDiscardLiveOrSummaryRun();
      return true;
    }
    if (phase === 'summary') {
      if (!savingRun) {
        handleResumeFromSummary();
      }
      return true;
    }
    return false;
  });

  // Live telemetry derived values
  const liveElapsedMs = session ? computeActiveElapsedTimeMs(session, nowTickMs) : 0;
  const liveAvgPaceSecPerKm =
    session && session.distanceM >= 10 && session.movingTimeMs > 0
      ? (session.movingTimeMs / 1000 / session.distanceM) * 1000
      : null;
  const liveCurrentSpeed = session?.gpsFilter.current?.speedMps ?? null;
  const liveCurrentPaceSecPerKm =
    liveCurrentSpeed !== null && liveCurrentSpeed >= 0.45 ? 1000 / liveCurrentSpeed : null;
  const liveSplits = useMemo(
    () => (session ? computePerKmSplits(session.points, profile.weightKg) : []),
    [session, profile.weightKg],
  );
  const liveBreadcrumbPoints = useMemo(
    () => (session ? session.points.map((pt) => ({ lat: pt.lat, lon: pt.lon })) : []),
    [session],
  );
  const liveGpsPosition = useMemo(() => {
    const c = session?.gpsFilter.current;
    if (!c) return null;
    const isStale = session?.status === 'recording' && nowTickMs - c.updatedAtMs > 15_000;
    return {
      lat: c.lat,
      lon: c.lon,
      accuracyM: c.accuracyM,
      headingDeg: c.headingDeg,
      isStale,
    };
  }, [session?.gpsFilter.current, session?.status, nowTickMs]);

  const liveCorridor = useMemo(() => {
    if (!session || session.mode !== 'course' || !courseRoute || !liveGpsPosition) {
      return null;
    }
    const projection = computeRunnerLocationRelativeToRoute(
      courseRoute,
      liveGpsPosition.lat,
      liveGpsPosition.lon,
      courseMarkers,
      undefined,
      {
        accuracyM: liveGpsPosition.accuracyM,
        previousChainageM: prevCorridorChainageRef.current,
        headingDeg: liveGpsPosition.headingDeg,
      },
    );
    if (projection) {
      prevCorridorChainageRef.current = projection.chainageM;
    }
    return projection;
  }, [session, courseRoute, courseMarkers, liveGpsPosition]);

  const mapSelection = useMemo<RouteSelectionState>(() => {
    if (liveCorridor && courseRoute) {
      return {
        chainageM: liveCorridor.chainageM,
        passNumber: liveCorridor.passNumber,
        segmentIndex: 0,
        pointIndex: 0,
        latitude: liveGpsPosition?.lat ?? courseRoute.points[0]?.latitude ?? 14.55,
        longitude: liveGpsPosition?.lon ?? courseRoute.points[0]?.longitude ?? 121.05,
        elevation: liveCorridor.nearestElevationM,
        gradePct: liveCorridor.nearestGradePct,
      };
    }
    const first = courseRoute?.points[0];
    return {
      chainageM: 0,
      passNumber: 1,
      segmentIndex: 0,
      pointIndex: 0,
      latitude: first?.latitude ?? liveGpsPosition?.lat ?? 14.55,
      longitude: first?.longitude ?? liveGpsPosition?.lon ?? 121.05,
    };
  }, [liveCorridor, courseRoute, liveGpsPosition]);

  const gnssBadge = classifyRecordGnssStatus(geo.status, geo.position);
  const isCheckingGnss = geo.status === 'locating' || geo.status === 'active';

  const pillClasses =
    gnssBadge.tone === 'emerald'
      ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
      : gnssBadge.tone === 'amber'
        ? 'border-amber-600/35 bg-amber-500/10 text-amber-900 dark:text-amber-300'
        : gnssBadge.tone === 'red'
          ? 'border-red-600/35 bg-red-500/10 text-red-800 dark:text-red-300'
          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]';

  const courseOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [
      {
        value: '',
        label: 'Free Run (from current location)',
        sublabel: 'Open GPS tracking without a fixed race course',
      },
    ];

    const seenKeys = new Set<string>(['']);
    for (const entry of publishedRoutes) {
      const key = buildCourseKey(entry.raceId, entry.distanceId);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const km = (
        (entry.measuredDistanceM > 0 ? entry.measuredDistanceM : entry.advertisedKm * 1000) / 1000
      ).toFixed(2);
      opts.push({
        value: key,
        label: `${entry.raceName} (${entry.distanceLabel})`,
        sublabel: `${entry.region} · ${km} km`,
        badge:
          entry.elevationStatus === 'unavailable'
            ? undefined
            : `+${Math.round(entry.elevationGainM)} m`,
      });
    }

    if (preselectedCourse) {
      const preKey = buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId);
      if (!seenKeys.has(preKey)) {
        opts.push({
          value: preKey,
          label: preselectedCourse.label,
          sublabel: 'Selected from Explore routes',
        });
      }
    }

    return opts;
  }, [publishedRoutes, preselectedCourse]);

  const hasWeight = profile.weightKg != null && Number.isFinite(profile.weightKg);
  const weightLabel = hasWeight ? `${profile.weightKg} kg` : '65 kg reference';

  if (phase === 'live' && session) {
    const isPaused = session.status === 'paused';
    const activeRunTitle =
      session.mode === 'course' && session.courseRef
        ? `${session.courseRef.raceName} (${session.courseRef.distanceLabel})`
        : 'Free Run';
    const liveLocateStatus = isPaused
      ? 'idle'
      : liveTrackingError
        ? 'error'
        : liveGpsPosition
          ? 'active'
          : 'locating';

    return (
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-3 pb-[max(1rem,var(--rp-safe-bottom))] space-y-3">
        {/* Compact Active Run Status Header */}
        <section
          aria-label="Active run status"
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="min-w-0 flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0 ${
                isPaused
                  ? 'border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-300'
                  : 'border-red-600/40 bg-red-600/15 text-red-800 dark:text-red-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isPaused ? 'bg-amber-600 dark:bg-amber-400' : 'bg-red-600 dark:bg-red-400'
                }`}
                aria-hidden="true"
              />
              <span>{isPaused ? 'Paused' : 'Recording'}</span>
            </span>
            <h2 className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
              {activeRunTitle}
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
            {liveGpsPosition ? (
              <span>
                GPS ±{liveGpsPosition.accuracyM} m{liveGpsPosition.isStale ? ' (Stale)' : ''}
              </span>
            ) : (
              <span>{isPaused ? 'GPS paused' : 'Acquiring GPS...'}</span>
            )}
          </div>
        </section>

        {liveTrackingError && (
          <div
            role="alert"
            className="rounded-xl border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{liveTrackingError}</span>
          </div>
        )}

        {session.mode === 'course' && liveCorridor && (
          <section
            aria-label="Course corridor tracking"
            className={`rounded-xl border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
              liveCorridor.onCourse
                ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                : 'border-amber-600/40 bg-amber-500/10 text-amber-950 dark:text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {liveCorridor.onCourse
                  ? 'On Course'
                  : `Off Course (+${Math.round(liveCorridor.offRouteMeters)} m)`}
              </span>
              <span className="font-mono tabular-nums">
                {liveCorridor.progressPct.toFixed(1)}% ({formatShortDistance(liveCorridor.distanceRemainingM)} left)
              </span>
            </div>
            {liveCorridor.nextMarker && (
              <span className="font-mono tabular-nums">
                Next: {liveCorridor.nextMarker.name} (
                {formatShortDistance(liveCorridor.nextMarkerDistanceAlongM)})
              </span>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* Map Canvas (60-70% mobile visual focus, split-pane left on desktop) */}
          <div className="lg:col-span-7 min-w-0">
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label="Loading live map"
                  className="h-[320px] sm:h-[420px] lg:h-[480px] w-full rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)]"
                >
                  Loading Philippine route map...
                </div>
              }
            >
              <RouteMapCanvas
                route={session.mode === 'course' && courseRoute ? courseRoute : emptyFreeRunRoute}
                routeIdentityKey={
                  session.mode === 'course' && loadedCourse
                    ? loadedCourse.id
                    : `free-run-${session.sessionId}`
                }
                markers={session.mode === 'course' ? courseMarkers : []}
                selection={mapSelection}
                theme={theme}
                heightClassName="h-[320px] sm:h-[420px] lg:h-[480px]"
                editable={false}
                cursorVisible={false}
                hideHud={session.mode === 'free'}
                hideBuiltInLayerToggles={false}
                provenance={loadedCourse?.mapLayerProvenance}
                courseScopeId={
                  loadedCourse ? `${loadedCourse.raceId}_${loadedCourse.distanceId}` : undefined
                }
                gpsLivePosition={liveGpsPosition}
                gpsBreadcrumbPoints={liveBreadcrumbPoints}
                locateStatus={liveLocateStatus}
                flyToTrigger={flyToTrigger}
                onLocateMe={() => {
                  if (liveGpsPosition) {
                    centerMapOn(liveGpsPosition.lat, liveGpsPosition.lon);
                  } else if (isPaused) {
                    void handleResumeRun();
                  }
                }}
                onCenterOnUser={() => {
                  if (!liveGpsPosition) return;
                  centerMapOn(liveGpsPosition.lat, liveGpsPosition.lon);
                }}
              />
            </Suspense>
          </div>

          {/* Live Telemetry, Splits & Thumb-Zone Controls */}
          <div className="lg:col-span-5 min-w-0 space-y-3">
            <section
              aria-label="Live run telemetry"
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
            >
              <dl className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)]">
                <div className="p-3 space-y-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Distance</dt>
                  <dd className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                    {(session.distanceM / 1000).toFixed(2)}{' '}
                    <span className="text-xs font-normal text-[var(--text-secondary)]">km</span>
                  </dd>
                </div>
                <div className="p-3 space-y-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Elapsed Time</dt>
                  <dd className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                    {formatDuration(liveElapsedMs)}
                  </dd>
                  <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                    Moving {formatDuration(session.movingTimeMs)}
                  </dd>
                </div>
                <div className="p-3 space-y-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">Avg Pace</dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                    {formatPace(liveAvgPaceSecPerKm)}
                  </dd>
                  <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                    Current {formatPace(liveCurrentPaceSecPerKm)}
                  </dd>
                </div>
                <div className="p-3 space-y-0.5">
                  <dt className="text-xs font-normal text-[var(--text-secondary)]">
                    Elev Gain &amp; Calories
                  </dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                    +{Math.round(session.elevationGainM)} m
                  </dd>
                  <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                    {session.totalKcal.toFixed(1)} kcal
                  </dd>
                </div>
              </dl>

              {/* Collapsible Splits Drawer */}
              <div className="border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setSplitsOpen((open) => !open)}
                  aria-expanded={splitsOpen}
                  className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <span className="font-mono tabular-nums">
                    Kilometer Splits ({liveSplits.length})
                  </span>
                  {splitsOpen ? (
                    <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                </button>

                {splitsOpen && (
                  <div className="border-t border-[var(--border-subtle)] max-h-48 overflow-y-auto px-3 py-2">
                    {liveSplits.length === 0 ? (
                      <p className="text-xs text-[var(--text-secondary)] py-1">
                        Per-kilometer splits appear after recording 50 meters of movement.
                      </p>
                    ) : (
                      <table className="w-full text-left text-xs font-mono tabular-nums">
                        <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                          <tr>
                            <th scope="col" className="py-1 pr-2 font-semibold">
                              KM
                            </th>
                            <th scope="col" className="py-1 pr-2 font-semibold">
                              Pace
                            </th>
                            <th scope="col" className="py-1 pr-2 font-semibold">
                              Elev
                            </th>
                            <th scope="col" className="py-1 font-semibold text-right">
                              kcal
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                          {liveSplits.map((split) => (
                            <tr key={split.kmIndex}>
                              <td className="py-1.5 pr-2">
                                {split.kmIndex}
                                {split.distanceM < 990 ? ` (${Math.round(split.distanceM)}m)` : ''}
                              </td>
                              <td className="py-1.5 pr-2">{formatPace(split.paceSecPerKm)}</td>
                              <td className="py-1.5 pr-2">+{Math.round(split.elevationGainM)}m</td>
                              <td className="py-1.5 text-right">{split.caloriesKcal.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Thumb-Zone Controls */}
            <div className="grid grid-cols-2 gap-2.5">
              {isPaused ? (
                <button
                  type="button"
                  onClick={() => void handleResumeRun()}
                  className="min-h-12 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handlePauseRun()}
                  className="min-h-12 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                >
                  <Pause className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Pause</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleFinishRun()}
                className={`min-h-12 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  isPaused
                    ? 'border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                    : 'bg-red-700 hover:bg-red-600 text-white'
                }`}
              >
                <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Finish Run</span>
              </button>

              <button
                type="button"
                onClick={() => void handleDiscardLiveOrSummaryRun()}
                className="col-span-2 min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Discard Run</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'summary' && summaryData) {
    const avgPaceSec =
      summaryData.clientDistanceM > 0 && summaryData.movingTimeMs > 0
        ? (summaryData.movingTimeMs / 1000 / summaryData.clientDistanceM) * 1000
        : null;

    return (
      <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 py-3 pb-[max(1.25rem,var(--rp-safe-bottom))] space-y-4">
        <section
          aria-labelledby={`${baseId}-summary-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2
                id={`${baseId}-summary-heading`}
                className="font-display font-semibold text-lg text-[var(--text-primary)]"
              >
                Run Summary
              </h2>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                Review your metrics, choose visibility, and save to your RacePulsePH profile.
              </p>
            </div>

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {summaryData.homePrivacyTrimEnabled
                  ? summaryData.trimmedPoints.length === 0
                    ? 'Short run: GPS omitted'
                    : `200m trim (${Math.round(summaryData.trimmedHeadM)}m / ${Math.round(summaryData.trimmedTailM)}m)`
                  : 'Full track kept'}
              </span>
            </span>
          </div>

          {enrichingSummary && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
              <span>Enriching Philippine DEM elevation and kilometer splits...</span>
            </div>
          )}

          {/* Title & Privacy Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor={summaryTitleId}
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Run Title
              </label>
              <input
                id={summaryTitleId}
                type="text"
                maxLength={120}
                value={summaryTitle}
                onChange={(e) => {
                  setSummaryTitle(e.target.value);
                  if (summaryTitleError) setSummaryTitleError(null);
                }}
                aria-invalid={Boolean(summaryTitleError)}
                aria-describedby={summaryTitleError ? summaryTitleErrorId : undefined}
                placeholder="Morning Free Run"
                className="w-full min-h-11 px-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
              />
              {summaryTitleError && (
                <p
                  id={summaryTitleErrorId}
                  role="alert"
                  className="text-xs font-semibold text-red-700 dark:text-red-400"
                >
                  {summaryTitleError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--text-primary)]">
                Visibility
              </span>
              <div
                role="group"
                aria-label="Run privacy visibility"
                className="grid grid-cols-3 gap-1.5"
              >
                {PRIVACY_OPTIONS.map((opt) => {
                  const active = summaryPrivacy === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSummaryPrivacy(opt.value)}
                      aria-pressed={active}
                      className={`min-h-11 px-2.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                        active
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {PRIVACY_OPTIONS.find((opt) => opt.value === summaryPrivacy)?.hint}
              </p>
            </div>
          </div>

          {/* Summary Metrics */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Distance</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                {(summaryData.clientDistanceM / 1000).toFixed(2)} km
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Moving Time</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                {formatDuration(summaryData.movingTimeMs)}
              </dd>
              <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                Elapsed {formatDuration(summaryData.elapsedTimeMs)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Avg Pace</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                {formatPace(avgPaceSec)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Elevation</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                +{Math.round(summaryData.elevationGainM)} m / -{Math.round(summaryData.elevationLossM)} m
              </dd>
              <dd className="text-xs text-[var(--text-secondary)]">
                Source: {summaryData.elevationSource.toUpperCase()}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Calories</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                {summaryData.calorieEstimate.totalKcal.toFixed(1)} kcal
              </dd>
              <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                Net {summaryData.calorieEstimate.netKcal.toFixed(1)} + Rest{' '}
                {summaryData.calorieEstimate.restingKcal.toFixed(1)} ({summaryData.calorieEstimate.weightKgUsed} kg)
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
              <dt className="text-xs text-[var(--text-secondary)]">Island Groups</dt>
              <dd className="text-sm font-semibold text-[var(--text-primary)]">
                {summaryData.islandGroups.length > 0
                  ? summaryData.islandGroups.join(', ')
                  : 'Not classified'}
              </dd>
            </div>
          </dl>

          {/* Kilometer Splits Table */}
          {summaryData.splits.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-2">
              <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                Kilometer Splits
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                    <tr>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        KM
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Distance
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Pace
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-semibold">
                        Elev Gain
                      </th>
                      <th scope="col" className="py-1.5 font-semibold text-right">
                        Calories
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                    {summaryData.splits.map((split) => (
                      <tr key={split.kmIndex}>
                        <td className="py-1.5 pr-3">{split.kmIndex}</td>
                        <td className="py-1.5 pr-3">{Math.round(split.distanceM)} m</td>
                        <td className="py-1.5 pr-3">{formatPace(split.paceSecPerKm)}</td>
                        <td className="py-1.5 pr-3">+{Math.round(split.elevationGainM)} m</td>
                        <td className="py-1.5 text-right">{split.caloriesKcal.toFixed(1)} kcal</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Summary Actions */}
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportGpx}
                disabled={savingRun}
                className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Export GPX</span>
              </button>

              <button
                type="button"
                onClick={handleResumeFromSummary}
                disabled={savingRun || enrichingSummary}
                className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Resume Run</span>
              </button>

              <button
                type="button"
                onClick={() => void handleDiscardLiveOrSummaryRun()}
                disabled={savingRun}
                className="min-h-11 px-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Discard Run</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveRun()}
              disabled={savingRun || enrichingSummary}
              className="min-h-12 px-5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              {savingRun ? (
                <>
                  <RefreshCw className="w-4 h-4 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                  <span>Saving Run...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Save Run</span>
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Phase 1: Setup & Pre-Run Readiness
  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 py-3 pb-[max(1.25rem,var(--rp-safe-bottom))] space-y-4">
      {/* Interrupted Run Recovery Banner */}
      {recoveryLoaded && recoveredDraft && (
        <section
          aria-labelledby={`${baseId}-recovery-heading`}
          className="rounded-2xl border border-amber-600/45 bg-amber-500/10 p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <h2
                id={`${baseId}-recovery-heading`}
                className="font-display font-semibold text-base text-amber-950 dark:text-amber-200"
              >
                Interrupted Run Found
              </h2>
              <p className="text-xs font-normal text-amber-900 dark:text-amber-200/90 font-mono tabular-nums">
                {recoveredDraft.mode === 'course' && recoveredDraft.courseRef
                  ? `${recoveredDraft.courseRef.raceName} (${recoveredDraft.courseRef.distanceLabel})`
                  : 'Free Run'}{' '}
                · {(recoveredDraft.distanceM / 1000).toFixed(2)} km ·{' '}
                {formatDuration(recoveredDraft.movingTimeMs)} · {recoveredDraft.points.length} GPS points
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDiscardRecoveredDraft()}
                className="min-h-11 px-3 rounded-xl border border-amber-700/35 bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Discard Draft</span>
              </button>
              <button
                type="button"
                onClick={() => void handleResumeRecoveredDraft()}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Resume Saved Run</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Offline Pending Uploads Queue Banner */}
      {recoveryLoaded && pendingUploads.length > 0 && (
        <section
          aria-labelledby={`${baseId}-pending-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="space-y-0.5">
              <h2
                id={`${baseId}-pending-heading`}
                className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] flex items-center gap-2"
              >
                <UploadCloud className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>
                  {pendingUploads.length === 1
                    ? '1 Offline Run Waiting to Sync'
                    : `${pendingUploads.length} Offline Runs Waiting to Sync`}
                </span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                {pendingError || 'Runs recorded offline stay queued on this device until uploaded.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleRetryPendingSync()}
              disabled={syncingPending}
              className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 ${syncingPending ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncingPending ? 'Syncing...' : 'Retry Sync Now'}</span>
            </button>
          </div>

          <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
            {pendingUploads.map((item) => {
              const itemTitle =
                typeof item.payload.title === 'string' && item.payload.title.trim()
                  ? item.payload.title.trim()
                  : 'Recorded Run';
              const distKm = (Number(item.payload.clientDistanceM ?? 0) / 1000).toFixed(2);
              return (
                <li
                  key={item.requestId}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{itemTitle}</p>
                    <p className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {distKm} km · Attempts: {item.attempts}
                      {item.lastError ? ` · ${item.lastError}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeletePendingUpload(item)}
                    disabled={syncingPending}
                    aria-label={`Remove ${itemTitle} from upload queue`}
                    className="min-h-11 min-w-11 px-2.5 rounded-lg text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 hover:bg-[var(--surface-hover)] inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Live GNSS Signal Readiness Card */}
      <section
        aria-labelledby={`${baseId}-gnss-heading`}
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={`${baseId}-gnss-heading`}
                className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]"
              >
                Live GNSS Signal Check
              </h2>
              <span
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold tabular-nums ${pillClasses}`}
              >
                <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{gnssBadge.label}</span>
              </span>
            </div>
            <p className="text-xs font-normal text-[var(--text-secondary)]">
              Run a pre-start satellite lock check before your session. Location starts only when you press Test GPS Signal or Start Run.
            </p>
          </div>

          <button
            type="button"
            onClick={isCheckingGnss ? geo.stopTracking : geo.startTracking}
            aria-pressed={isCheckingGnss}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            {isCheckingGnss ? (
              <>
                <Square className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Stop GPS Check</span>
              </>
            ) : (
              <>
                <LocateFixed className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>Test GPS Signal</span>
              </>
            )}
          </button>
        </div>

        {geo.error && (
          <div
            role="alert"
            className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{geo.error}</span>
          </div>
        )}

        {geo.position && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Accuracy</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                ±{geo.position.accuracyM} m
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Coordinates</dt>
              <dd className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {geo.position.lat.toFixed(5)}, {geo.position.lon.toFixed(5)}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Signal Region</dt>
              <dd className="text-xs font-semibold text-[var(--text-primary)]">
                {geo.position.insidePhilippines === false
                  ? 'Outside Philippines'
                  : 'Philippines bounds OK'}
              </dd>
            </div>
          </dl>
        )}

        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs font-normal text-[var(--text-secondary)] flex items-start gap-2">
          <Info className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
          <span>Desktop browsers use Wi-Fi or IP geolocation without GNSS hardware.</span>
        </p>
      </section>

      {/* Course Selection & Calorie / Privacy Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section
          aria-labelledby={courseLabelId}
          className="lg:col-span-2 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id={courseLabelId}
                className="font-display font-semibold text-base text-[var(--text-primary)]"
              >
                Course Selection
              </h2>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                {routesLoaded
                  ? `${publishedRoutes.length} published Philippine ${publishedRoutes.length === 1 ? 'course' : 'courses'} available.`
                  : 'Loading published Philippine courses...'}
              </p>
            </div>

            {onBrowseRoutes && (
              <button
                type="button"
                onClick={onBrowseRoutes}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>Browse Routes</span>
              </button>
            )}
          </div>

          <Select
            id={courseSelectId}
            ariaLabelledBy={courseLabelId}
            value={selectedCourseKey}
            options={courseOptions}
            onChange={handleCourseChange}
            searchable
            searchPlaceholder="Filter published courses..."
            leadingIcon={<Flag className="w-4 h-4" />}
            showSublabelInTrigger
          />

          {courseLoading && (
            <p className="text-xs font-semibold text-[var(--text-secondary)]">
              Loading course geometry and checkpoints...
            </p>
          )}

          {courseLoadError && (
            <div
              role="alert"
              className="rounded-xl border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{courseLoadError}</span>
            </div>
          )}

          {selectedCatalogEntry ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-display font-semibold text-sm text-[var(--text-primary)]">
                    {selectedCatalogEntry.raceName} ({selectedCatalogEntry.distanceLabel})
                  </p>
                  <p className="text-xs font-normal text-[var(--text-secondary)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {selectedCatalogEntry.mapLayerProvenance?.province || selectedCatalogEntry.region} ·{' '}
                      {selectedCatalogEntry.raceDate}
                    </span>
                  </p>
                </div>

                <a
                  href={buildRaceCoursePath(
                    selectedCatalogEntry.raceId,
                    selectedCatalogEntry.distanceId,
                    selectedCatalogEntry.currentPublicationId,
                  )}
                  onClick={(e) => {
                    const targetUrl = buildRaceCoursePath(
                      selectedCatalogEntry.raceId,
                      selectedCatalogEntry.distanceId,
                      selectedCatalogEntry.currentPublicationId,
                    );
                    if (isClientNavigationClick(e)) {
                      e.preventDefault();
                      dispatchAppNavigate(targetUrl);
                    }
                  }}
                  className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Flag className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <span>Open Course Map</span>
                </a>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] py-2 text-center font-mono tabular-nums">
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">Distance</dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {(
                      (selectedCatalogEntry.measuredDistanceM > 0
                        ? selectedCatalogEntry.measuredDistanceM
                        : selectedCatalogEntry.advertisedKm * 1000) / 1000
                    ).toFixed(2)}{' '}
                    km
                  </dd>
                </div>
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)] inline-flex items-center gap-1">
                    <Mountain className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Gain</span>
                  </dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {selectedCatalogEntry.elevationStatus === 'unavailable'
                      ? 'N/A'
                      : `+${Math.round(selectedCatalogEntry.elevationGainM)} m`}
                  </dd>
                </div>
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">
                    Checkpoints
                  </dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {selectedCatalogEntry.checkpointCount}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-xs font-normal text-[var(--text-secondary)]">
              <strong className="font-semibold text-[var(--text-primary)]">
                {preselectedCourse && selectedCourseKey
                  ? preselectedCourse.label
                  : 'Free Run (from current location)'}
              </strong>{' '}
              is selected. Tap Start Run below when you are ready outdoors.
            </div>
          )}

          {/* 200m Home Privacy Trim Toggle */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span
                  id={`${baseId}-privacy-trim-label`}
                  className="text-xs font-semibold text-[var(--text-primary)]"
                >
                  200 m Home Privacy Trim
                </span>
              </div>
              <p
                id={`${baseId}-privacy-trim-desc`}
                className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed"
              >
                Removes points within 200 m of your start and finish locations before upload or GPX export. Runs under 450 m store summary metrics without GPS coordinates.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={homePrivacyTrimEnabled}
              aria-labelledby={`${baseId}-privacy-trim-label`}
              aria-describedby={`${baseId}-privacy-trim-desc`}
              onClick={() => setHomePrivacyTrimEnabled((v) => !v)}
              className={`min-h-11 min-w-14 px-1 rounded-full border inline-flex items-center shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                homePrivacyTrimEnabled
                  ? 'border-red-700 bg-red-700 justify-end'
                  : 'border-[var(--border-control)] bg-[var(--surface-card)] justify-start'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full shadow-sm transition-transform ${
                  homePrivacyTrimEnabled ? 'bg-white' : 'bg-[var(--text-secondary)]'
                }`}
                aria-hidden="true"
              />
            </button>
          </div>
        </section>

        {/* Body Weight Calibration Card */}
        <section
          aria-labelledby={`${baseId}-weight-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <h2
              id={`${baseId}-weight-heading`}
              className="font-display font-semibold text-base text-[var(--text-primary)]"
            >
              Calorie Calibration
            </h2>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
              <Scale className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                {weightLabel}
              </span>
            </div>
            <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
              {hasWeight
                ? 'Your saved body weight calibrates grade-adjusted calorie expenditure during live runs.'
                : 'Add your body weight in Profile settings to replace the 65 kg reference value for calorie estimates.'}
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="min-h-11 w-full px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Scale className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span>Edit Weight in Profile</span>
            </button>

            <button
              type="button"
              onClick={() => setCalorieInfoOpen(true)}
              className="min-h-11 w-full px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>How Calories Are Calculated</span>
            </button>
          </div>
        </section>
      </div>

      {/* Thumb-Zone Start Run CTA */}
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-display font-semibold text-sm text-[var(--text-primary)]">
            {selectedCatalogEntry
              ? `Course Ready: ${selectedCatalogEntry.raceName} (${selectedCatalogEntry.distanceLabel})`
              : 'Free Run Ready'}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            GPS tracking starts when you tap Start Run and saves a recovery snapshot on each accepted fix.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleStartRun()}
          disabled={Boolean(selectedCourseKey && courseLoading)}
          className="min-h-12 w-full sm:w-auto sm:min-w-[200px] px-5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
        >
          <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{selectedCourseKey && courseLoading ? 'Loading Course...' : 'Start Run'}</span>
        </button>
      </div>

      {calorieInfoOpen && (
        <DialogSurface
          variant="sheet"
          maxWidthCss="34rem"
          titleId={calorieDialogTitleId}
          descriptionId={calorieDialogDescId}
          onRequestClose={() => setCalorieInfoOpen(false)}
          dismissOnBackdropClick
        >
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <h2
                id={calorieDialogTitleId}
                className="font-display font-semibold text-lg text-[var(--text-primary)]"
              >
                How Calories Are Calculated
              </h2>
              <p id={calorieDialogDescId} className="text-xs text-[var(--text-secondary)]">
                Both live telemetry and server verification run the exact same metabolic formula.
              </p>
            </div>

            <div className="space-y-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p>
                <strong className="text-[var(--text-primary)]">
                  Net Exercise Cost (Minetti et al., 2002):
                </strong>{' '}
                Published in <em>J Appl Physiol 93:1039-1046</em>, this fifth-order grade polynomial models the energetic cost of running (at 1.8 m/s or faster) and walking (below 1.8 m/s) across terrain grades clamped between -45% and +45%.
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">
                  Resting Baseline (Herrmann et al., 2024):
                </strong>{' '}
                From the 2024 Adult Compendium of Physical Activities, a resting 1-MET baseline (1.05 kcal/kg/hr) is added for active moving duration so total calories match exercise science totals.
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">
                  Weight &amp; Stationary Protection:
                </strong>{' '}
                Calculations scale by your saved body weight ({weightLabel}). Stationary gaps longer than 180 seconds with under 10 meters of movement are excluded so forgotten pauses do not accrue ghost calories.
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setCalorieInfoOpen(false)}
                className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}
