import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  AlertTriangle,
  Compass,
  Flag,
  Info,
  LocateFixed,
  Lock,
  MapPin,
  Mountain,
  Play,
  Radio,
  RefreshCw,
  Scale,
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
import { resolveCalorieWeightKg } from '../../lib/runs/calorieEngine';
import {
  CommunityRunApiError,
  completeRecordedRun,
  createRecordedRunId,
  prepareCompleteRecordedRunInput,
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
  buildCourseKey,
  buildDefaultRunTitle,
  buildNotificationTitle,
  buildSummaryComputation,
  formatDuration,
  formatNotificationSubtitle,
  mergeAndFilterRunFixes,
  MIN_SERVER_MOVING_TIME_MS,
  slugifyFilename,
  toGpsRawFix,
  type SummaryComputation,
} from '../../lib/runs/runLiveHelpers';
import {
  buildRunGpxXml,
  computeActiveElapsedTimeMs,
  computePerKmSplits,
  createActiveRunSession,
  enrichRunTrackElevation,
  ingestRunFix,
  pauseActiveRun,
  resumeActiveRun,
} from '../../lib/runs/runRecorderEngine';
import type {
  ActiveRunSession,
  PendingRunUpload,
  RecordedRunCourseRef,
  RecordedRunPrivacy,
  RecordedRunSummary,
} from '../../lib/runs/types';
import type { UserProfile } from '../../types';
import { useFeedback } from '../ui/FeedbackProvider';
import { Select, type SelectOption } from '../ui/Select';
import type { ExploreCourseRunTarget } from './RunnerExplorePanel';
import {
  RecordCalorieInfoDialog,
  RecordLiveView,
  RecordSummaryView,
} from './RunnerRecordViews';

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

function dispatchAppNavigate(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url } }));
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
  const [recoveredCourseRef, setRecoveredCourseRef] = useState<RecordedRunCourseRef | null>(null);
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
  const transitionLockRef = useRef(false);
  const enrichmentGenRef = useRef(0);
  const hasAutoCenteredRef = useRef(false);
  const mapReadyForFreeCenterRef = useRef(false);
  const lastNotificationAtRef = useRef(0);
  const lastRawTimestampRef = useRef(0);
  const segmentStartFloorMsRef = useRef(0);
  const drainGenRef = useRef(0);
  const drainingBufferRef = useRef(false);
  const queuedFixesDuringDrainRef = useRef<NativeRunFix[]>([]);
  const prevCorridorChainageRef = useRef<number | undefined>(undefined);
  const flyNonceRef = useRef(0);

  // Latest-wins serialized IndexedDB writer so concurrent ticks never overwrite newer snapshots.
  const pendingSnapshotRef = useRef<ActiveRunSession | null>(null);
  const writingSnapshotRef = useRef(false);
  const snapshotWritePromiseRef = useRef<Promise<void>>(Promise.resolve());

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

  const persistSnapshotLatest = useCallback((snapshot: ActiveRunSession): Promise<void> => {
    pendingSnapshotRef.current = snapshot;
    if (writingSnapshotRef.current) {
      return snapshotWritePromiseRef.current;
    }
    writingSnapshotRef.current = true;
    const writePromise = (async () => {
      try {
        while (pendingSnapshotRef.current) {
          const nextToWrite = pendingSnapshotRef.current;
          pendingSnapshotRef.current = null;
          await saveActiveRunSnapshot(nextToWrite).catch((err) => {
            console.warn('[RunnerRecordPanel] snapshot persist failed', err);
          });
        }
      } finally {
        writingSnapshotRef.current = false;
      }
    })();
    snapshotWritePromiseRef.current = writePromise;
    return writePromise;
  }, []);

  const clearActiveSnapshotSafely = useCallback(async (uid: string) => {
    pendingSnapshotRef.current = null;
    await snapshotWritePromiseRef.current;
    await clearActiveRunSnapshot(uid).catch((err) => {
      console.warn('[RunnerRecordPanel] clearActiveRunSnapshot failed', err);
    });
  }, []);

  const stopNativeTracking = useCallback(async () => {
    trackingGenerationRef.current += 1;
    drainGenRef.current += 1;
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
    drainingBufferRef.current = false;
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
        if (cancelled || phaseRef.current !== 'setup') return;
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

    const recoveredPubId =
      recoveredCourseRef &&
      recoveredCourseRef.raceId === raceId &&
      recoveredCourseRef.distanceId === distanceId
        ? recoveredCourseRef.publicationId
        : undefined;

    const publicationId =
      selectedCatalogEntry?.currentPublicationId ??
      (preselectedCourse &&
      buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId) === selectedCourseKey
        ? preselectedCourse.publicationId
        : recoveredPubId);

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
  }, [
    selectedCourseKey,
    selectedCatalogEntry?.currentPublicationId,
    preselectedCourse,
    recoveredCourseRef,
  ]);

  const emptyFreeRunRoute = useMemo(
    () => processCanonicalGeometry(createEmptyRouteGeometry()),
    [],
  );

  const courseRoute = useMemo(
    () => (loadedCourse ? processCanonicalGeometry(loadedCourse.canonicalGeometry) : null),
    [loadedCourse],
  );

  const courseMarkers = useMemo(() => loadedCourse?.markers ?? [], [loadedCourse]);

  const applyAcceptedFixBatch = useCallback(
    (fixes: NativeRunFix[], baseSession: ActiveRunSession): ActiveRunSession | null => {
      if (fixes.length === 0) return null;
      const weightKg = profileWeightRef.current;
      const nextSession = fixes.reduce(
        (acc, fix) => ingestRunFix(acc, toGpsRawFix(fix), { weightKg }),
        baseSession,
      );
      lastRawTimestampRef.current = Math.max(
        lastRawTimestampRef.current,
        fixes[fixes.length - 1].timestamp,
      );
      updateSession(nextSession);
      setLiveTrackingError(null);

      if (nextSession.points.length > baseSession.points.length) {
        void persistSnapshotLatest(nextSession);
      }

      if (
        nextSession.mode === 'free' &&
        mapReadyForFreeCenterRef.current &&
        !hasAutoCenteredRef.current &&
        nextSession.gpsFilter.current
      ) {
        hasAutoCenteredRef.current = true;
        centerMapOn(nextSession.gpsFilter.current.lat, nextSession.gpsFilter.current.lon);
      }

      const now = Date.now();
      if (now - lastNotificationAtRef.current >= 5000) {
        lastNotificationAtRef.current = now;
        void RunTracking.updateNotification({
          title: buildNotificationTitle(nextSession.mode, nextSession.courseRef),
          subtitle: formatNotificationSubtitle(nextSession, now),
        }).catch((err) => {
          console.warn('[RunnerRecordPanel] updateNotification failed', err);
        });
      }
      return nextSession;
    },
    [centerMapOn, persistSnapshotLatest, updateSession],
  );

  const flushQueuedFixesIntoSession = useCallback(
    (
      baseSession: ActiveRunSession,
      extraFixes: NativeRunFix[] = [],
      minLastTimestampMs?: number,
    ): ActiveRunSession => {
      const queued = queuedFixesDuringDrainRef.current;
      queuedFixesDuringDrainRef.current = [];
      const incomingFixes = extraFixes.length > 0 ? [...extraFixes, ...queued] : queued;
      if (incomingFixes.length === 0) return baseSession;

      const existingTimestamps = new Set(baseSession.points.map((pt) => pt.timestampMs));
      const merged = mergeAndFilterRunFixes({
        incomingFixes,
        minAcceptedTimestampMs: segmentStartFloorMsRef.current,
        existingTimestamps,
        lastProcessedTimestampMs: minLastTimestampMs ?? lastRawTimestampRef.current,
      });
      return applyAcceptedFixBatch(merged, baseSession) ?? baseSession;
    },
    [applyAcceptedFixBatch],
  );

  const drainNativeBufferedFixesForStop = useCallback(async (): Promise<NativeRunFix[]> => {
    drainGenRef.current += 1;
    drainingBufferRef.current = true;
    try {
      const result = await RunTracking.getBufferedFixes();
      return Array.isArray(result?.fixes) ? result.fixes : [];
    } catch (err) {
      console.warn('[RunnerRecordPanel] pre-stop buffered fix drain failed', err);
      return [];
    }
  }, []);

  const stopAndFlushActiveSession = useCallback(async (): Promise<ActiveRunSession | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    const preDrainLastTs = lastRawTimestampRef.current;
    const preStopBuffered =
      current.status === 'recording' ? await drainNativeBufferedFixesForStop() : [];
    await stopNativeTracking();
    const latestBase = sessionRef.current;
    if (!latestBase) return null;
    return flushQueuedFixesIntoSession(latestBase, preStopBuffered, preDrainLastTs);
  }, [drainNativeBufferedFixesForStop, flushQueuedFixesIntoSession, stopNativeTracking]);

  const handleIncomingFix = useCallback(
    (fix: NativeRunFix) => {
      if (phaseRef.current !== 'live' || sessionRef.current?.status !== 'recording') return;
      if (drainingBufferRef.current) {
        queuedFixesDuringDrainRef.current.push(fix);
        return;
      }

      const current = sessionRef.current;
      const fixTs =
        typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp) && fix.timestamp > 0
          ? fix.timestamp
          : Date.now();
      if (fixTs < segmentStartFloorMsRef.current || fixTs <= lastRawTimestampRef.current) {
        return;
      }
      applyAcceptedFixBatch([{ ...fix, timestamp: fixTs }], current);
    },
    [applyAcceptedFixBatch],
  );

  const handleTrackingError = useCallback(
    (err: DeviceLocationError) => {
      const msg = err.message || 'Waiting for stronger GPS signal.';
      setLiveTrackingError(msg);
      if (err.code === 1 && sessionRef.current?.status === 'recording') {
        void stopNativeTracking();
        const latest = sessionRef.current;
        if (!latest) return;
        const paused = pauseActiveRun(latest, Date.now());
        updateSession(paused);
        void persistSnapshotLatest(paused);
        notify({
          tone: 'error',
          title: 'Location permission denied',
          message: 'Recording was paused. Enable location permission and tap Resume.',
        });
      }
    },
    [notify, persistSnapshotLatest, stopNativeTracking, updateSession],
  );

  const startNativeTracking = useCallback(
    async (activeSession: ActiveRunSession) => {
      const gen = ++trackingGenerationRef.current;
      await Promise.all(
        listenerHandlesRef.current.map((h) =>
          h.remove().catch((err) => {
            console.warn('[RunnerRecordPanel] stale listener remove failed', err);
          }),
        ),
      );
      listenerHandlesRef.current = [];

      const detachPendingHandles = async (handles: PluginListenerHandle[]) => {
        await Promise.all(
          handles.map((h) =>
            h.remove().catch((err) => {
              console.warn('[RunnerRecordPanel] handle cleanup failed', err);
            }),
          ),
        );
      };

      let ownHandles: PluginListenerHandle[] = [];
      let ownStarted = false;

      try {
        const fixHandle = await RunTracking.addListener('locationFix', (fix) => {
          if (trackingGenerationRef.current !== gen) return;
          handleIncomingFix(fix);
        });
        if (trackingGenerationRef.current !== gen) {
          await detachPendingHandles([fixHandle]);
          return;
        }
        ownHandles = [fixHandle];

        const errHandle = await RunTracking.addListener('trackingError', (err) => {
          if (trackingGenerationRef.current !== gen) return;
          handleTrackingError(err);
        });
        if (trackingGenerationRef.current !== gen) {
          await detachPendingHandles([fixHandle, errHandle]);
          return;
        }

        ownHandles = [fixHandle, errHandle];
        listenerHandlesRef.current = ownHandles;
        trackingStartedRef.current = true;
        ownStarted = true;
        await RunTracking.startTracking({
          title: buildNotificationTitle(activeSession.mode, activeSession.courseRef),
          subtitle: formatNotificationSubtitle(activeSession),
        });

        if (
          trackingGenerationRef.current !== gen ||
          phaseRef.current !== 'live' ||
          sessionRef.current?.status !== 'recording'
        ) {
          if (trackingGenerationRef.current === gen) {
            listenerHandlesRef.current = [];
            trackingStartedRef.current = false;
            await RunTracking.stopTracking().catch((err) => {
              console.warn('[RunnerRecordPanel] stale startTracking stop failed', err);
            });
          }
          await detachPendingHandles(ownHandles);
        }
      } catch (err) {
        await detachPendingHandles(ownHandles);
        if (trackingGenerationRef.current !== gen) return;
        listenerHandlesRef.current = [];
        if (ownStarted) {
          trackingStartedRef.current = false;
        }
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to start GPS tracking on this device.';
        setLiveTrackingError(message);
        const active = sessionRef.current;
        if (active && active.status === 'recording' && phaseRef.current === 'live') {
          const pausedAt = Date.now();
          const paused = pauseActiveRun(active, pausedAt);
          updateSession(paused);
          setNowTickMs(paused.pausedAtMs ?? pausedAt);
          void persistSnapshotLatest(paused);
        }
        notify({
          tone: 'error',
          title: 'GPS tracking unavailable',
          message,
        });
      }
    },
    [handleIncomingFix, handleTrackingError, notify, persistSnapshotLatest, updateSession],
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
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || drainingBufferRef.current) return;
      const myDrainGen = ++drainGenRef.current;
      drainingBufferRef.current = true;
      const preDrainLastTs = lastRawTimestampRef.current;

      void (async () => {
        let bufferedFixes: NativeRunFix[] = [];
        try {
          const result = await RunTracking.getBufferedFixes();
          bufferedFixes = Array.isArray(result?.fixes) ? result.fixes : [];
        } catch (err) {
          console.warn('[RunnerRecordPanel] buffered fix drain failed', err);
        } finally {
          if (drainGenRef.current === myDrainGen) {
            drainingBufferRef.current = false;
          }
        }

        if (drainGenRef.current !== myDrainGen) {
          return;
        }

        const queued = queuedFixesDuringDrainRef.current;
        queuedFixesDuringDrainRef.current = [];
        const latestSession = sessionRef.current;
        if (
          !latestSession ||
          latestSession.status !== 'recording' ||
          phaseRef.current !== 'live'
        ) {
          return;
        }

        const existingTimestamps = new Set(latestSession.points.map((pt) => pt.timestampMs));
        const merged = mergeAndFilterRunFixes({
          incomingFixes: [...bufferedFixes, ...queued],
          minAcceptedTimestampMs: segmentStartFloorMsRef.current,
          existingTimestamps,
          lastProcessedTimestampMs: preDrainLastTs,
        });
        applyAcceptedFixBatch(merged, latestSession);
      })();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityChange);
    }
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityChange);
      }
    };
  }, [phase, session?.status, applyAcceptedFixBatch]);

  const handleCourseChange = (nextKey: string) => {
    setSelectedCourseKey(nextKey);
    setRecoveredCourseRef(null);
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
    enrichmentGenRef.current += 1;
    drainGenRef.current += 1;
    setEnrichingSummary(false);
    await stopNativeTracking();
    drainGenRef.current += 1;
    drainingBufferRef.current = false;
    queuedFixesDuringDrainRef.current = [];
    updateSession(null);
    setSummaryData(null);
    setSaveError(null);
    setSummaryTitleError(null);
    setLiveTrackingError(null);
    setSplitsOpen(false);
    setRecoveredCourseRef(null);
    hasAutoCenteredRef.current = false;
    mapReadyForFreeCenterRef.current = false;
    lastRawTimestampRef.current = 0;
    segmentStartFloorMsRef.current = 0;
    lastNotificationAtRef.current = 0;
    prevCorridorChainageRef.current = undefined;
    setPhase('setup');
    const latestPending = await listPendingRunUploads(profile.uid).catch((err) => {
      console.warn('[RunnerRecordPanel] listPendingRunUploads failed during reset', err);
      return [];
    });
    setPendingUploads(latestPending);
    setRecoveredDraft(null);
  }, [profile.uid, stopNativeTracking, updateSession]);

  const handleStartRun = async () => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      geo.stopTracking();
      hasAutoCenteredRef.current = false;
      mapReadyForFreeCenterRef.current = false;
      lastNotificationAtRef.current = 0;
      prevCorridorChainageRef.current = undefined;
      drainGenRef.current += 1;
      queuedFixesDuringDrainRef.current = [];
      drainingBufferRef.current = false;
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
        } else if (selectedCatalogEntry && !courseLoadError) {
          courseRef = {
            raceId: selectedCatalogEntry.raceId,
            distanceId: selectedCatalogEntry.distanceId,
            publicationId: selectedCatalogEntry.currentPublicationId,
            raceName: selectedCatalogEntry.raceName,
            distanceLabel: selectedCatalogEntry.distanceLabel,
            advertisedKm: selectedCatalogEntry.advertisedKm,
            region: selectedCatalogEntry.region,
          };
        } else {
          const fallbackToFree = await confirm({
            title: 'Selected course unavailable',
            message:
              courseLoadError ||
              'The selected course map could not load. Start this session as a Free Run instead?',
            confirmLabel: 'Start Free Run',
            cancelLabel: 'Cancel',
          });
          if (!fallbackToFree) return;
        }
      }

      const newSession = createActiveRunSession({
        sessionId: createRecordedRunId(),
        uid: profile.uid,
        mode: courseRef ? 'course' : 'free',
        courseRef,
        homePrivacyTrimEnabled,
      });

      segmentStartFloorMsRef.current = newSession.startedAtMs - 2000;
      lastRawTimestampRef.current = 0;
      updateSession(newSession);
      setNowTickMs(newSession.startedAtMs);
      setPhase('live');

      await persistSnapshotLatest(newSession);
      if (
        sessionRef.current?.sessionId !== newSession.sessionId ||
        sessionRef.current?.status !== 'recording' ||
        phaseRef.current !== 'live'
      ) {
        return;
      }
      await startNativeTracking(newSession);
    } finally {
      transitionLockRef.current = false;
    }
  };

  const handleResumeRecoveredDraft = async () => {
    if (!recoveredDraft || transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      geo.stopTracking();
      hasAutoCenteredRef.current = false;
      mapReadyForFreeCenterRef.current = false;
      lastNotificationAtRef.current = 0;
      prevCorridorChainageRef.current = undefined;
      drainGenRef.current += 1;
      queuedFixesDuringDrainRef.current = [];
      drainingBufferRef.current = false;
      setLiveTrackingError(null);
      setSplitsOpen(false);

      // Normalize crash downtime as paused at the last recorded timestamp so dead crash hours
      // are never counted toward active elapsed time or resting calorie expenditure.
      const crashPausedAtMs =
        recoveredDraft.updatedAtMs || recoveredDraft.lastAcceptedAtMs || Date.now();
      const normalizedPaused = pauseActiveRun(recoveredDraft, crashPausedAtMs);
      segmentStartFloorMsRef.current = crashPausedAtMs;
      lastRawTimestampRef.current = recoveredDraft.lastAcceptedAtMs || 0;

      if (normalizedPaused.courseRef) {
        setRecoveredCourseRef(normalizedPaused.courseRef);
        setSelectedCourseKey(
          buildCourseKey(
            normalizedPaused.courseRef.raceId,
            normalizedPaused.courseRef.distanceId,
          ),
        );
      } else {
        setRecoveredCourseRef(null);
        setSelectedCourseKey('');
      }

      setHomePrivacyTrimEnabled(normalizedPaused.homePrivacyTrimEnabled);
      updateSession(normalizedPaused);
      setRecoveredDraft(null);
      setNowTickMs(crashPausedAtMs);
      setPhase('live');
      await persistSnapshotLatest(normalizedPaused);
    } finally {
      transitionLockRef.current = false;
    }
  };

  const handleDiscardRecoveredDraft = async () => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      const ok = await confirm({
        title: 'Discard saved run draft?',
        message:
          'This permanently deletes your interrupted GPS track and distance totals from this device.',
        confirmLabel: 'Discard draft',
        cancelLabel: 'Keep draft',
        destructive: true,
      });
      if (!ok) return;
      await RunTracking.stopTracking().catch((err) => {
        console.warn('[RunnerRecordPanel] stop tracking on draft discard failed', err);
      });
      await clearActiveSnapshotSafely(profile.uid);
      setRecoveredDraft(null);
      notify({ tone: 'info', title: 'Draft discarded' });
    } finally {
      transitionLockRef.current = false;
    }
  };

  const handlePauseRun = useCallback(
    async (options?: { notifyUser?: boolean }) => {
      if (transitionLockRef.current) return;
      if (!sessionRef.current || sessionRef.current.status === 'paused') return;
      transitionLockRef.current = true;
      try {
        const flushed = await stopAndFlushActiveSession();
        if (!flushed || flushed.status === 'paused') return;
        const nowMs = Date.now();
        const paused = pauseActiveRun(flushed, nowMs);
        updateSession(paused);
        setNowTickMs(paused.pausedAtMs ?? nowMs);
        await persistSnapshotLatest(paused);
        if (options?.notifyUser) {
          notify({ tone: 'info', title: 'Run paused' });
        }
      } finally {
        transitionLockRef.current = false;
      }
    },
    [notify, persistSnapshotLatest, stopAndFlushActiveSession, updateSession],
  );

  const handleResumeRun = useCallback(async () => {
    if (transitionLockRef.current) return;
    const current = sessionRef.current;
    if (!current || current.status === 'recording') return;
    transitionLockRef.current = true;
    try {
      const now = Date.now();
      const resumed = resumeActiveRun(current, now);
      segmentStartFloorMsRef.current = Math.max(current.lastAcceptedAtMs || 0, now - 2000);
      lastRawTimestampRef.current = Math.max(
        lastRawTimestampRef.current,
        current.lastAcceptedAtMs || 0,
      );
      drainGenRef.current += 1;
      queuedFixesDuringDrainRef.current = [];
      drainingBufferRef.current = false;
      updateSession(resumed);
      setNowTickMs(now);
      setLiveTrackingError(null);
      await persistSnapshotLatest(resumed);
      if (
        sessionRef.current?.sessionId !== resumed.sessionId ||
        sessionRef.current?.status !== 'recording' ||
        phaseRef.current !== 'live'
      ) {
        return;
      }
      await startNativeTracking(resumed);
    } finally {
      transitionLockRef.current = false;
    }
  }, [persistSnapshotLatest, startNativeTracking, updateSession]);

  const handleDiscardLiveOrSummaryRun = useCallback(async () => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      const ok = await confirm({
        title: 'Discard this recorded run?',
        message:
          'Your recorded distance, splits, and GPS track for this session will be deleted and cannot be recovered.',
        confirmLabel: 'Discard run',
        cancelLabel: 'Keep run',
        destructive: true,
      });
      if (!ok) return;
      await resetToSetup();
      await clearActiveSnapshotSafely(profile.uid);
      notify({ tone: 'info', title: 'Run discarded' });
    } finally {
      transitionLockRef.current = false;
    }
  }, [clearActiveSnapshotSafely, confirm, notify, profile.uid, resetToSetup]);

  const handleFinishRun = async () => {
    if (transitionLockRef.current) return;
    let initial = sessionRef.current;
    if (!initial) return;

    transitionLockRef.current = true;
    try {
      if (initial.status === 'recording' && initial.movingTimeMs < MIN_SERVER_MOVING_TIME_MS) {
        const preDrainLastTs = lastRawTimestampRef.current;
        let preCheckBuffered: NativeRunFix[] = [];
        try {
          preCheckBuffered = await drainNativeBufferedFixesForStop();
        } finally {
          drainingBufferRef.current = false;
        }
        const refreshed = sessionRef.current;
        if (refreshed) {
          initial = flushQueuedFixesIntoSession(refreshed, preCheckBuffered, preDrainLastTs);
        }
      }

      if (initial.movingTimeMs < MIN_SERVER_MOVING_TIME_MS) {
        const discardShort = await confirm({
          title: 'Run is under 10 seconds',
          message:
            'Verified runs require at least 10 seconds of active moving time. Keep recording to reach 10 seconds, or discard this short session.',
          confirmLabel: 'Discard session',
          cancelLabel: 'Keep recording',
          destructive: true,
        });
        if (discardShort) {
          await resetToSetup();
          await clearActiveSnapshotSafely(profile.uid);
          notify({ tone: 'info', title: 'Short session discarded' });
        }
        return;
      }

      const flushed = await stopAndFlushActiveSession();
      if (!flushed) return;
      const nowMs = Date.now();
      const paused = pauseActiveRun(flushed, nowMs);
      updateSession(paused);
      await persistSnapshotLatest(paused);

      const elapsedTimeMs = computeActiveElapsedTimeMs(paused, nowMs);
      const initialSummary = buildSummaryComputation({
        runId: paused.sessionId,
        mode: paused.mode,
        courseRef: paused.courseRef,
        startedAtMs: paused.startedAtMs,
        finishedAtMs: nowMs,
        elapsedTimeMs,
        movingTimeMs: paused.movingTimeMs,
        clientDistanceM: paused.distanceM,
        homePrivacyTrimEnabled: paused.homePrivacyTrimEnabled,
        points: paused.points,
        elevationSource: 'gps',
        fallbackElevationGainM: paused.elevationGainM,
        fallbackElevationLossM: paused.elevationLossM,
        weightKg: profile.weightKg,
      });

      const myEnrichGen = ++enrichmentGenRef.current;
      setSummaryTitle(
        buildDefaultRunTitle(paused.mode, paused.courseRef, new Date(paused.startedAtMs)),
      );
      setSummaryPrivacy('private');
      setSummaryTitleError(null);
      setSaveError(null);
      setSummaryData(initialSummary);
      setEnrichingSummary(true);
      setPhase('summary');

      void (async () => {
        let timeoutId: number | undefined;
        try {
          const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const offlineFallbackSampler = () =>
            Promise.resolve(new Array<number | null>(paused.points.length).fill(null));
          const timed = await Promise.race([
            enrichRunTrackElevation(paused.points, isOffline ? offlineFallbackSampler : undefined),
            new Promise<null>((resolve) => {
              timeoutId = window.setTimeout(() => resolve(null), 3500);
            }),
          ]);
          const enriched =
            timed ?? (await enrichRunTrackElevation(paused.points, offlineFallbackSampler));
          if (enrichmentGenRef.current !== myEnrichGen || phaseRef.current !== 'summary') return;

          setSummaryData((prev) =>
            prev
              ? buildSummaryComputation({
                  runId: prev.runId,
                  requestId: prev.requestId,
                  mode: prev.mode,
                  courseRef: prev.courseRef,
                  startedAtMs: Date.parse(prev.startedAt),
                  finishedAtMs: Date.parse(prev.finishedAt),
                  elapsedTimeMs: prev.elapsedTimeMs,
                  movingTimeMs: prev.movingTimeMs,
                  clientDistanceM: prev.clientDistanceM,
                  homePrivacyTrimEnabled: prev.homePrivacyTrimEnabled,
                  points: enriched.points,
                  elevationSource: enriched.elevationSource,
                  fallbackElevationGainM: enriched.elevationGainM,
                  fallbackElevationLossM: enriched.elevationLossM,
                  weightKg: profileWeightRef.current,
                })
              : prev,
          );
        } catch (err) {
          console.warn('[RunnerRecordPanel] summary elevation enrichment failed', err);
        } finally {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
          if (enrichmentGenRef.current === myEnrichGen) {
            setEnrichingSummary(false);
          }
        }
      })();
    } finally {
      transitionLockRef.current = false;
    }
  };

  const handleResumeFromSummary = useCallback(() => {
    if (!sessionRef.current || savingRun) return;
    enrichmentGenRef.current += 1;
    setEnrichingSummary(false);
    hasAutoCenteredRef.current = false;
    mapReadyForFreeCenterRef.current = false;
    setSummaryData(null);
    setSaveError(null);
    setSummaryTitleError(null);
    setPhase('live');
  }, [savingRun]);

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
      const preparedInput = await prepareCompleteRecordedRunInput(completeInput);
      try {
        const savedRun = await completeRecordedRun(preparedInput);
        await clearActiveSnapshotSafely(profile.uid);
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
          const { trackPoints: _omitPoints, ...payloadMeta } = preparedInput;
          const pendingEntry: PendingRunUpload = {
            requestId: preparedInput.requestId ?? summaryData.requestId,
            runId: preparedInput.runId,
            uid: profile.uid,
            payload: { ...payloadMeta, storageUploadSettled: true } as Record<string, unknown>,
            trimmedTrackPoints: preparedInput.trackPoints,
            createdAt: new Date().toISOString(),
            attempts: 1,
            lastError: apiErr.message,
          };
          await savePendingRunUpload(pendingEntry);
          await clearActiveSnapshotSafely(profile.uid);
          notify({
            tone: 'info',
            title: 'Saved offline to pending queue',
            message: 'Your run is stored safely on this device and ready to sync when online.',
          });
          await resetToSetup();
        } else {
          setSaveError(apiErr.message);
        }
      }
    } catch (prepErr) {
      setSaveError(
        prepErr instanceof Error && prepErr.message ? prepErr.message : 'Unable to save run.',
      );
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
          ...(rawPayload.trackStoragePath ? { trackStoragePath: rawPayload.trackStoragePath } : {}),
          storageUploadSettled: true,
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
    if (savingRun || enrichingSummary) {
      return true;
    }
    if (phase === 'live') {
      if (transitionLockRef.current) {
        return true;
      }
      if (sessionRef.current?.status === 'recording') {
        void handlePauseRun({ notifyUser: true });
        return true;
      }
      void handleDiscardLiveOrSummaryRun();
      return true;
    }
    if (phase === 'summary') {
      handleResumeFromSummary();
      return true;
    }
    return false;
  });

  // Live telemetry derived values (primitive deps avoid 1 Hz GeoJSON churn)
  const liveElapsedMs = session ? computeActiveElapsedTimeMs(session, nowTickMs) : 0;
  const liveAvgPaceSecPerKm =
    session && session.distanceM >= 10 && session.movingTimeMs > 0
      ? (session.movingTimeMs / 1000 / session.distanceM) * 1000
      : null;
  const gpsCur = session?.gpsFilter.current;
  const gpsCurLat = gpsCur?.lat;
  const gpsCurLon = gpsCur?.lon;
  const gpsCurAcc = gpsCur?.accuracyM;
  const gpsCurHeading = gpsCur?.headingDeg;
  const gpsCurUpdatedAt = gpsCur?.updatedAtMs ?? 0;
  const liveCurrentSpeed = gpsCur?.speedMps ?? null;
  const liveCurrentPaceSecPerKm =
    liveCurrentSpeed !== null && liveCurrentSpeed >= 0.45 ? 1000 / liveCurrentSpeed : null;
  const isGpsStale =
    session?.status === 'recording' && gpsCurUpdatedAt > 0 && nowTickMs - gpsCurUpdatedAt > 15_000;

  const liveSplits = useMemo(
    () => (session?.points ? computePerKmSplits(session.points, profile.weightKg) : []),
    [session?.points, profile.weightKg],
  );
  const liveBreadcrumbPoints = useMemo(
    () => (session?.points ? session.points.map((pt) => ({ lat: pt.lat, lon: pt.lon })) : []),
    [session?.points],
  );
  const liveGpsPosition = useMemo(() => {
    if (gpsCurLat === undefined || gpsCurLon === undefined || gpsCurAcc === undefined) {
      return null;
    }
    return {
      lat: gpsCurLat,
      lon: gpsCurLon,
      accuracyM: gpsCurAcc,
      headingDeg: gpsCurHeading,
      isStale: isGpsStale,
    };
  }, [gpsCurLat, gpsCurLon, gpsCurAcc, gpsCurHeading, isGpsStale]);

  const liveCorridor = useMemo(() => {
    if (!session || session.mode !== 'course' || !courseRoute || !liveGpsPosition) {
      return null;
    }
    return computeRunnerLocationRelativeToRoute(
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
  }, [session?.mode, courseRoute, courseMarkers, liveGpsPosition]);

  useEffect(() => {
    prevCorridorChainageRef.current = liveCorridor?.chainageM;
  }, [liveCorridor?.chainageM]);

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

  const { weightKgUsed, usedReferenceWeight } = resolveCalorieWeightKg(profile.weightKg);
  const hasWeight = !usedReferenceWeight;
  const weightLabel = hasWeight ? `${weightKgUsed} kg` : '65 kg reference';

  if (phase === 'live' && session) {
    return (
      <RecordLiveView
        session={session}
        theme={theme}
        mapRoute={session.mode === 'course' && courseRoute ? courseRoute : emptyFreeRunRoute}
        routeIdentityKey={
          session.mode === 'course' && loadedCourse
            ? loadedCourse.id
            : `free-run-${session.sessionId}`
        }
        markers={session.mode === 'course' ? courseMarkers : []}
        selection={mapSelection}
        provenance={session.mode === 'course' ? loadedCourse?.mapLayerProvenance : undefined}
        courseScopeId={
          session.mode === 'course' && loadedCourse
            ? `${loadedCourse.raceId}_${loadedCourse.distanceId}`
            : undefined
        }
        liveGpsPosition={liveGpsPosition}
        liveBreadcrumbPoints={liveBreadcrumbPoints}
        liveCorridor={liveCorridor}
        liveTrackingError={liveTrackingError}
        liveElapsedMs={liveElapsedMs}
        liveAvgPaceSecPerKm={liveAvgPaceSecPerKm}
        liveCurrentPaceSecPerKm={liveCurrentPaceSecPerKm}
        liveSplits={liveSplits}
        splitsOpen={splitsOpen}
        onToggleSplits={() => setSplitsOpen((open) => !open)}
        flyToTrigger={flyToTrigger}
        onMapFirstCameraReady={() => {
          if (!mapReadyForFreeCenterRef.current) {
            mapReadyForFreeCenterRef.current = true;
            const cur = sessionRef.current;
            if (cur?.mode === 'free' && cur.gpsFilter.current && !hasAutoCenteredRef.current) {
              hasAutoCenteredRef.current = true;
              centerMapOn(cur.gpsFilter.current.lat, cur.gpsFilter.current.lon);
            }
          }
        }}
        onLocateMe={() => {
          if (liveGpsPosition) {
            centerMapOn(liveGpsPosition.lat, liveGpsPosition.lon);
          } else if (session.status === 'paused') {
            notify({
              tone: 'info',
              title: 'Run is paused',
              message: 'Tap Resume to acquire your live GPS position.',
            });
          } else {
            notify({
              tone: 'info',
              title: 'Acquiring GPS fix',
              message: 'Waiting for your first accepted GPS location fix to center the map.',
            });
          }
        }}
        onCenterOnUser={() => {
          if (!liveGpsPosition) return;
          centerMapOn(liveGpsPosition.lat, liveGpsPosition.lon);
        }}
        onPauseRun={() => void handlePauseRun()}
        onResumeRun={() => void handleResumeRun()}
        onFinishRun={() => void handleFinishRun()}
        onDiscardRun={() => void handleDiscardLiveOrSummaryRun()}
      />
    );
  }

  if (phase === 'summary' && summaryData) {
    return (
      <RecordSummaryView
        baseId={baseId}
        summaryData={summaryData}
        summaryTitleId={summaryTitleId}
        summaryTitleErrorId={summaryTitleErrorId}
        summaryTitle={summaryTitle}
        summaryTitleError={summaryTitleError}
        summaryPrivacy={summaryPrivacy}
        enrichingSummary={enrichingSummary}
        savingRun={savingRun}
        saveError={saveError}
        onChangeTitle={(next) => {
          setSummaryTitle(next);
          if (summaryTitleError) setSummaryTitleError(null);
        }}
        onChangePrivacy={setSummaryPrivacy}
        onExportGpx={handleExportGpx}
        onResumeRun={handleResumeFromSummary}
        onDiscardRun={() => void handleDiscardLiveOrSummaryRun()}
        onSaveRun={() => void handleSaveRun()}
      />
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto py-1 pb-[max(1.25rem,var(--rp-safe-bottom))] space-y-4">
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
                {formatDuration(recoveredDraft.movingTimeMs)} · {recoveredDraft.points.length} GPS
                points
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
                <UploadCloud
                  className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0"
                  aria-hidden="true"
                />
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
              Run a pre-start satellite lock check before your session. Location starts only when
              you press Test GPS Signal or Start Run.
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
                <LocateFixed
                  className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0"
                  aria-hidden="true"
                />
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
                <Compass
                  className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0"
                  aria-hidden="true"
                />
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
                    <MapPin
                      className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {selectedCatalogEntry.mapLayerProvenance?.province ||
                        selectedCatalogEntry.region}{' '}
                      · {selectedCatalogEntry.raceDate}
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
                  <Flag
                    className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0"
                    aria-hidden="true"
                  />
                  <span>Open Course Map</span>
                </a>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] py-2 text-center font-mono tabular-nums">
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">
                    Distance
                  </dt>
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

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                <Lock
                  className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0"
                  aria-hidden="true"
                />
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
                Removes points within 200 m of your start and finish locations before upload or GPX
                export. Runs under 450 m store summary metrics without GPS coordinates.
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
              <Scale
                className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0"
                aria-hidden="true"
              />
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
              <Scale
                className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0"
                aria-hidden="true"
              />
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

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-display font-semibold text-sm text-[var(--text-primary)]">
            {selectedCatalogEntry
              ? `Course Ready: ${selectedCatalogEntry.raceName} (${selectedCatalogEntry.distanceLabel})`
              : 'Free Run Ready'}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            GPS tracking starts when you tap Start Run and saves a recovery snapshot on each
            accepted fix.
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
        <RecordCalorieInfoDialog
          titleId={calorieDialogTitleId}
          descriptionId={calorieDialogDescId}
          weightLabel={weightLabel}
          onClose={() => setCalorieInfoOpen(false)}
        />
      )}
    </div>
  );
}
