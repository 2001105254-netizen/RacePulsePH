import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  Compass,
  Copy,
  Crosshair,
  Eraser,
  Flag,
  Hand,
  History,
  Layers,
  LocateFixed,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Mountain,
  Navigation,
  Paintbrush,
  PenTool,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { fetchGpxText, parseGpxRoute } from '../../lib/gpxRoute';
import { useAccess, useScopedRaces } from '../../lib/access';
import { locateAtChainage, projectCoordinateToRoute, reanchorMarkersForRoute } from '../../lib/routes/anchoring';
import { buildCourseAnalytics } from '../../lib/routes/courseAnalytics';
import {
  createEmptyRouteGeometry,
  geodesicDistanceM,
  processCanonicalGeometry,
  reverseCanonicalGeometry,
} from '../../lib/routes/geometry';
import type { MapThemeMode } from '../../lib/routes/mapProviders';
import {
  prepareCourseMapLayerManifest,
  RACEPULSE_TERRAIN_LABEL,
} from '../../lib/routes/philippinesMapTiles';
import { createSyntheticLandmarkPhoto, processLandmarkPhotoFile } from '../../lib/routes/photoProcessor';
import {
  archivePresetCommand,
  bindAndPublishRaceRouteCommand,
  createPresetDraftCommand,
  createPresetVersionCommand,
  DEMO_BAGUIO_RACE,
  describePresetConfigStatus,
  duplicatePresetCommand,
  ensureDemoCoursesSeeded,
  getRouteStoreSnapshot,
  isDemoSeedEnabled,
  migrateLegacyRaceGpxCommand,
  rollbackPublicationCommand,
  runQuarterlyNationalMosaicRefreshCommand,
  runWeeklyClearImageryCheckCommand,
  savePresetDraftCommand,
  sortRoutePresetsForDistance,
  subscribeRouteStore,
  validatePublicationReadiness,
  withdrawPublicationCommand,
  type LegacyMigrationResult,
  type RouteWorkspaceStore,
} from '../../lib/routes/routeStore';
import {
  appendPaintedStrokeToGeometry,
  applyTerrainScenarioToRange,
  clearRouteCanvas,
  closeRouteLoopToStart,
  commitGpsTrackToGeometry,
  createGpsTrailState,
  densifyAndElevateDrawnSegments,
  erasePointsInRadius,
  estimatePhilippineTopographicElevationM,
  generateSimulatedGpsWalk,
  generateSplitKmMarkers,
  isDefaultStarterGeometry,
  mirrorOutAndBackRoute,
  processGpsBreadcrumbFix,
  relocateStartPointInGeometry,
  removeStartPointFromGeometry,
  sampleTerrainElevationForGeometry,
  smoothEntireGeometry,
  SURFACE_LABELS,
  TERRAIN_SCENARIO_LABELS,
  type GpsBreadcrumbFix,
  type GpsTrailState,
} from '../../lib/routes/trailTools';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import type {
  CanonicalRouteGeometry,
  RouteMarker,
  RouteMarkerKind,
  RouteSelectionState,
  RouteSurfaceType,
  TerrainScenarioTag,
} from '../../lib/routes/types';
import { useWorkspaceHeader } from '../../lib/workspaceHeader';
import type { Race, UserProfile } from '../../types';
import RouteElevationProfile from '../RouteElevationProfile';
import RouteMapCanvas, { type MapColorMode, type MapDrawMode } from './RouteMapCanvas';
import { Select } from '../ui/Select';
import { useFeedback } from '../ui/FeedbackProvider';

type StudioTab = 'course' | 'markers' | 'photos' | 'analytics' | 'versions' | 'publish';
type TrailEditOption = 'draw' | 'gps';

const SERVICE_OPTIONS = [
  'Water',
  'Electrolytes',
  'Energy gels',
  'First aid',
  'Restrooms',
  'Bag drop',
  'Timing mat',
] as const;

const MARKER_KINDS: RouteMarkerKind[] = [
  'start',
  'finish',
  'timing',
  'aid',
  'water',
  'medical',
  'hazard',
  'landmark',
];

interface RouteStudioPanelProps {
  profile: UserProfile;
  theme?: MapThemeMode;
  initialPresetId?: string;
  racesOverride?: Race[];
  onNavigateUrl?: (url: string) => void;
  onBackHome?: () => void;
}

export default function RouteStudioPanel({
  profile,
  theme: propTheme,
  initialPresetId,
  racesOverride,
  onNavigateUrl,
  onBackHome,
}: RouteStudioPanelProps) {
  const { confirm } = useFeedback();
  const { can } = useAccess();
  const canCreateRoute = can('routes.create');
  const canEditRoute = can('routes.edit');
  const canUploadRouteMedia = can('routes.media');
  const canPublishRoute = can('routes.publish');
  const canAssignRoute = can('routes.assign');
  const canArchiveRoute = can('routes.archive');
  const scopedRaces = useScopedRaces();
  const demoMode = isDemoSeedEnabled();
  const [store, setStore] = useState<RouteWorkspaceStore>(() => getRouteStoreSnapshot());
  const [activeTab, setActiveTab] = useState<StudioTab>('course');
  const [trailOption, setTrailOption] = useState<TrailEditOption>('draw');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialPresetId || '');

  // Draft working copy with Undo / Redo history
  const [draftTitle, setDraftTitle] = useState('');
  const [draftRegion, setDraftRegion] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [rawGpxText, setRawGpxText] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<number[]>([0]);
  const [geometry, setGeometry] = useState<CanonicalRouteGeometry>(createEmptyRouteGeometry);
  const [markers, setMarkers] = useState<RouteMarker[]>([]);
  const [undoStack, setUndoStack] = useState<Array<{ geometry: CanonicalRouteGeometry; markers: RouteMarker[] }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ geometry: CanonicalRouteGeometry; markers: RouteMarker[] }>>([]);
  const [expectedRevision, setExpectedRevision] = useState(1);
  const [dirty, setDirty] = useState(false);

  // Interactive Map + Draw + Paintbrush + Terrain Scenario + Color Layer State
  const [drawMode, setDrawMode] = useState<MapDrawMode>('view');
  const [colorMode, setColorMode] = useState<MapColorMode>('default');
  const [paintSpacingM, setPaintSpacingM] = useState<number>(12);
  const [eraseRadiusM, setEraseRadiusM] = useState<number>(50);
  const [mapPanLocked, setMapPanLocked] = useState<boolean>(false);
  const [studioFullscreen, setStudioFullscreen] = useState<boolean>(false);
  const [importFitNonce, setImportFitNonce] = useState<number>(0);
  const justCreatedPresetIdRef = useRef<string | null>(null);
  const [activeSurfaceType, setActiveSurfaceType] = useState<RouteSurfaceType>('singletrack');
  const [activeTerrainScenario, setActiveTerrainScenario] = useState<TerrainScenarioTag>('normal');
  const [rangeFromKm, setRangeFromKm] = useState('');
  const [rangeToKm, setRangeToKm] = useState('');
  const [selection, setSelection] = useState<RouteSelectionState | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string>('');
  const [coordLat, setCoordLat] = useState('');
  const [coordLon, setCoordLon] = useState('');
  const [coordEle, setCoordEle] = useState('');

  // Live Accurate GPS Trail Tracking State + Refs to avoid stale closure in GNSS callback
  const [gpsState, setGpsState] = useState<GpsTrailState>(() => createGpsTrailState({ maxAccuracyM: 25 }));
  const [gpsError, setGpsError] = useState('');
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);
  const initialGpsCenteredRef = useRef(false);
  const currentMapCenterRef = useRef<{ lat: number; lon: number }>({ lat: 16.4121, lon: 120.595 });
  const gpsWatchIdRef = useRef<number | null>(null);
  const gpsFixReceivedRef = useRef(false);
  const activeSurfaceTypeRef = useRef(activeSurfaceType);
  activeSurfaceTypeRef.current = activeSurfaceType;
  const activeTerrainScenarioRef = useRef(activeTerrainScenario);
  activeTerrainScenarioRef.current = activeTerrainScenario;
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  const headerCtx = useWorkspaceHeader();
  const setDesktopLocked = headerCtx?.setDesktopLocked;
  const setSplitViewportLocked = headerCtx?.setSplitViewportLocked;

  useEffect(() => {
    if (!onBackHome) return;
    setDesktopLocked?.(true);
    setSplitViewportLocked?.(true);
    return () => {
      setDesktopLocked?.(false);
      setSplitViewportLocked?.(false);
    };
  }, [onBackHome, setDesktopLocked, setSplitViewportLocked]);

  // Photo Upload State
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoAlt, setPhotoAlt] = useState('');
  const [photoCredit, setPhotoCredit] = useState('');
  const [photoRights, setPhotoRights] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Versioning, Race Binding, Publish, Withdraw & Migration State
  const [reviewNotes, setReviewNotes] = useState('');
  const requestedUrlParamsRef = useRef<{ raceId: string; distanceId: string; applied: boolean }>(
    (() => {
      if (typeof window === 'undefined') return { raceId: '', distanceId: '', applied: true };
      const params = new URLSearchParams(window.location.search);
      return {
        raceId: params.get('raceId') || '',
        distanceId: params.get('distanceId') || '',
        applied: false,
      };
    })(),
  );
  const [targetRaceId, setTargetRaceId] = useState('');
  const [targetDistanceId, setTargetDistanceId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [checkpointLinks, setCheckpointLinks] = useState<Record<string, string>>({});
  const [overrideFreeze, setOverrideFreeze] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [simulatedRaceFreeze, setSimulatedRaceFreeze] = useState(false);
  const [migrationDistanceByRace, setMigrationDistanceByRace] = useState<Record<string, string>>({});
  const [migrationResults, setMigrationResults] = useState<Record<string, LegacyMigrationResult>>({});

  // Status / Error banners
  const [statusNotice, setStatusNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState('');

  const gpxInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const detectedTheme: MapThemeMode =
    propTheme ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light');

  useEffect(() => {
    if (demoMode) {
      void ensureDemoCoursesSeeded();
    }
    return subscribeRouteStore(setStore);
  }, [demoMode]);

  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  // Photoshop-style quick keyboard tool switching (V/B/P/E/A/M) and Undo/Redo (Ctrl+Z/Y)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const targetTag = (document.activeElement?.tagName || '').toUpperCase();
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) {
          if (redoStack.length > 0) {
            const next = redoStack[0];
            setUndoStack((u) => [...u, { geometry, markers }]);
            setRedoStack(redoStack.slice(1));
            setGeometry(next.geometry);
            setMarkers(next.markers);
            setDirty(true);
          }
        } else if (undoStack.length > 0) {
          const prev = undoStack[undoStack.length - 1];
          setRedoStack((r) => [{ geometry, markers }, ...r]);
          setUndoStack(undoStack.slice(0, -1));
          setGeometry(prev.geometry);
          setMarkers(prev.markers);
          setDirty(true);
        }
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        if (redoStack.length > 0) {
          const next = redoStack[0];
          setUndoStack((u) => [...u, { geometry, markers }]);
          setRedoStack(redoStack.slice(1));
          setGeometry(next.geometry);
          setMarkers(next.markers);
          setDirty(true);
        }
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      switch (ev.key.toLowerCase()) {
        case 'v':
          setDrawMode('view');
          break;
        case 's':
          setDrawMode('set-start');
          break;
        case 'b':
          setDrawMode('paint');
          setTrailOption('draw');
          break;
        case 'p':
          setDrawMode('draw');
          setTrailOption('draw');
          break;
        case 'e':
          setDrawMode('erase');
          setTrailOption('draw');
          break;
        case 'a':
          setDrawMode('edit');
          break;
        case 'm':
          setDrawMode('place-marker');
          break;
        case 'f':
          setStudioFullscreen((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoStack, redoStack, geometry, markers]);

  const allRaces = useMemo(() => {
    if (racesOverride) return racesOverride;
    const map = new Map<string, Race>();
    if (demoMode) {
      map.set(DEMO_BAGUIO_RACE.id, DEMO_BAGUIO_RACE);
    }
    for (const r of scopedRaces) map.set(r.id, r);
    return Array.from(map.values());
  }, [racesOverride, demoMode, scopedRaces]);

  useEffect(() => {
    if (allRaces.length === 0) {
      if (targetRaceId) setTargetRaceId('');
      return;
    }
    if (!requestedUrlParamsRef.current.applied && requestedUrlParamsRef.current.raceId) {
      const requestedRace = allRaces.find((r) => r.id === requestedUrlParamsRef.current.raceId);
      if (requestedRace) {
        requestedUrlParamsRef.current.applied = true;
        setTargetRaceId(requestedRace.id);
        const reqDist = requestedUrlParamsRef.current.distanceId;
        if (reqDist && requestedRace.distances.some((d) => d.id === reqDist)) {
          setTargetDistanceId(reqDist);
        }
        return;
      }
    }
    if (!targetRaceId || !allRaces.some((r) => r.id === targetRaceId)) {
      setTargetRaceId(allRaces[0].id);
    }
  }, [allRaces, targetRaceId]);

  const targetRace = useMemo<Race | null>(() => {
    if (allRaces.length === 0) return null;
    const found = allRaces.find((r) => r.id === targetRaceId) || allRaces[0];
    if (simulatedRaceFreeze && demoMode && found.id === DEMO_BAGUIO_RACE.id) {
      return { ...found, gunStartTime: '2026-12-13T05:00:00+08:00' };
    }
    return found;
  }, [allRaces, targetRaceId, simulatedRaceFreeze, demoMode]);

  useEffect(() => {
    if (!targetRace) {
      if (targetDistanceId) setTargetDistanceId('');
      return;
    }
    if (!targetRace.distances.some((d) => d.id === targetDistanceId)) {
      setTargetDistanceId(targetRace.distances[0]?.id || '');
    }
  }, [targetRace, targetDistanceId]);

  // Scope presets to the selected race and sort Active configuration first, Archived last.
  const presetList = useMemo(() => {
    if (!targetRace) return [];
    const boundIdsForRace = new Set(
      Object.values(store.bindings)
        .filter((b) => b.raceId === targetRace.id)
        .map((b) => b.presetId),
    );
    const scoped = Object.values(store.presets).filter(
      (p) => p.raceId === targetRace.id || boundIdsForRace.has(p.id),
    );
    return sortRoutePresetsForDistance(scoped, store, targetRace.id, targetDistanceId);
  }, [store, targetRace, targetDistanceId]);

  const lastContextKeyRef = useRef<string>('');

  const resetWorkspaceToEmpty = (keepNotices = false) => {
    setSelectedPresetId('');
    setDraftTitle('');
    setDraftRegion('');
    setEditSummary('');
    setSourceFileName('');
    setRawGpxText('');
    setSelectedTracks([0]);
    setGeometry(createEmptyRouteGeometry());
    setMarkers([]);
    setUndoStack([]);
    setRedoStack([]);
    setExpectedRevision(1);
    setDirty(false);
    setSelectedMarkerId('');
    setSelectedVersionId('');
    setCoordLat('');
    setCoordLon('');
    setCoordEle('');
    setRangeFromKm('');
    setRangeToKm('');
    if (!keepNotices) {
      setStatusNotice('');
      setErrorNotice('');
    }
  };

  useEffect(() => {
    if (!targetRace) return;
    const contextKey = `${targetRace.id}::${targetDistanceId || ''}`;
    const contextChanged = lastContextKeyRef.current !== contextKey;
    if (!contextChanged && selectedPresetId && presetList.some((p) => p.id === selectedPresetId)) {
      return;
    }
    if (!contextChanged) {
      return;
    }
    lastContextKeyRef.current = contextKey;

    const boundPresetId = targetDistanceId
      ? store.bindings[`${targetRace.id}_${targetDistanceId}`]?.presetId
      : undefined;
    const boundMatch = boundPresetId
      ? presetList.find((p) => p.id === boundPresetId)
      : undefined;
    const initialMatch = initialPresetId
      ? presetList.find(
          (p) =>
            p.id === initialPresetId &&
            (!targetDistanceId || !p.distanceId || p.distanceId === targetDistanceId),
        )
      : undefined;
    const distMatch = presetList.find((p) => p.distanceId === targetDistanceId);
    const fallbackMatch = !targetDistanceId ? presetList[0] : undefined;
    const match = boundMatch || initialMatch || distMatch || fallbackMatch;

    if (match) {
      setSelectedPresetId(match.id);
      return;
    }
    resetWorkspaceToEmpty();
  }, [presetList, selectedPresetId, initialPresetId, targetRace, targetDistanceId, store.bindings]);

  const activePreset = store.presets[selectedPresetId];
  const activeDraft = activePreset
    ? store.drafts[`${activePreset.id}::${activePreset.latestDraftId}`]
    : undefined;

  // Hydrate editor working copy when switching presets
  useEffect(() => {
    if (!activePreset || !activeDraft) return;
    if (justCreatedPresetIdRef.current === activePreset.id) {
      justCreatedPresetIdRef.current = null;
      setSelectedVersionId(activePreset.latestVersionId || '');
      return;
    }
    setDraftTitle(activeDraft.title);
    setDraftRegion(activeDraft.region);
    setSourceFileName(activeDraft.sourceFileName || '');
    setSelectedTracks(activeDraft.selectedTrackIndices || [0]);
    const hydratedGeom = structuredClone(activeDraft.canonicalGeometry);
    if (!hydratedGeom.isCanvasCleared && hydratedGeom.segments.some((s) => s.sourceKind === 'drawn')) {
      hydratedGeom.segments = densifyAndElevateDrawnSegments(hydratedGeom.segments);
    }
    setGeometry(hydratedGeom);
    setMarkers(structuredClone(activeDraft.markers));
    setExpectedRevision(activeDraft.revision);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setSelectedMarkerId(activeDraft.markers[0]?.id || '');
    setSelectedVersionId(activePreset.latestVersionId || '');
    setRawGpxText('');
    setStatusNotice('');
    setErrorNotice('');
  }, [activePreset?.id, activeDraft?.id]);

  const processedRoute = useMemo(() => {
    try {
      return processCanonicalGeometry(geometry);
    } catch {
      return processCanonicalGeometry(createEmptyRouteGeometry());
    }
  }, [geometry]);

  const isCanvasEmpty = Boolean(
    processedRoute.canonicalGeometry.isCanvasCleared && processedRoute.points.length === 0,
  );
  const hasRoutePath =
    !processedRoute.canonicalGeometry.isCanvasCleared && processedRoute.points.length >= 2;

  const analyticsBundle = useMemo(
    () => buildCourseAnalytics(processedRoute, markers, { targetFlatPaceMinPerKm: 6.0, race: targetRace }),
    [processedRoute, markers, targetRace],
  );

  useEffect(() => {
    setSelection((curr) =>
      locateAtChainage(processedRoute, curr ? Math.min(curr.chainageM, processedRoute.distanceM) : 0, 1),
    );
  }, [processedRoute]);

  const presetVersions = useMemo(
    () =>
      Object.values(store.versions)
        .filter((v) => v.presetId === selectedPresetId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    [store.versions, selectedPresetId],
  );

  const selectedVersion =
    store.versions[selectedVersionId] || presetVersions[0] || undefined;

  const currentBinding = targetRace ? store.bindings[`${targetRace.id}_${targetDistanceId}`] : undefined;
  const currentPublication = currentBinding?.currentPublicationId
    ? store.publications[currentBinding.currentPublicationId]
    : undefined;
  const priorPublications = useMemo(
    () =>
      targetRace
        ? Object.values(store.publications)
            .filter(
              (p) =>
                p.raceId === targetRace.id &&
                p.distanceId === targetDistanceId &&
                p.id !== currentPublication?.id,
            )
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        : [],
    [store.publications, targetRace, targetDistanceId, currentPublication?.id],
  );

  const readiness = useMemo(() => {
    const checkGeom = selectedVersion?.canonicalGeometry || geometry;
    const checkMarkers = (selectedVersion?.markers || markers).map((m) => ({
      ...m,
      timingCheckpointId: checkpointLinks[m.id] || m.timingCheckpointId,
    }));
    return validatePublicationReadiness({
      title: selectedVersion?.title || draftTitle,
      geometry: checkGeom,
      markers: checkMarkers,
      race: targetRace,
      distanceId: targetDistanceId,
    });
  }, [selectedVersion, geometry, markers, checkpointLinks, draftTitle, targetRace, targetDistanceId]);

  const pushHistory = (nextGeom: CanonicalRouteGeometry, nextMarkers: RouteMarker[]) => {
    setUndoStack((prev) => [...prev.slice(-24), { geometry: structuredClone(geometry), markers: structuredClone(markers) }]);
    setRedoStack([]);
    setGeometry(nextGeom);
    setMarkers(nextMarkers);
    setDirty(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, { geometry: structuredClone(geometry), markers: structuredClone(markers) }]);
    setUndoStack((prev) => prev.slice(0, -1));
    setGeometry(last.geometry);
    setMarkers(last.markers);
    setDirty(true);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, { geometry: structuredClone(geometry), markers: structuredClone(markers) }]);
    setRedoStack((prev) => prev.slice(0, -1));
    setGeometry(next.geometry);
    setMarkers(next.markers);
    setDirty(true);
  };

  const handleImportGpxText = (text: string, fileLabel: string, trackSelection?: number[]) => {
    setErrorNotice('');
    setStatusNotice('');
    try {
      const parsed = parseGpxRoute(text, trackSelection ? { selectedTrackIndices: trackSelection } : undefined);
      setRawGpxText(text);
      setSourceFileName(fileLabel);
      setSelectedTracks(parsed.validationReport.selectedTrackIndices);
      const reanchored =
        markers.length > 0
          ? reanchorMarkersForRoute(parsed, markers)
          : [
              {
                id: `m_start_${Date.now().toString(36)}`,
                kind: 'start' as const,
                name: 'Start',
                description: 'Imported start point',
                latitude: parsed.points[0].latitude,
                longitude: parsed.points[0].longitude,
                chainageM: 0,
                segmentIndex: 0,
                pointIndex: 0,
                passNumber: 1,
                offsetMeters: 0,
                needsReview: false,
                offCourseBlocked: false,
                offCourseConfirmed: false,
                services: [],
                photos: [],
                visibility: 'draft' as const,
              },
              {
                id: `m_finish_${Date.now().toString(36)}`,
                kind: 'finish' as const,
                name: 'Finish',
                description: 'Imported finish point',
                latitude: parsed.points[parsed.points.length - 1].latitude,
                longitude: parsed.points[parsed.points.length - 1].longitude,
                chainageM: parsed.distanceM,
                segmentIndex: parsed.canonicalSegments.length - 1,
                pointIndex: parsed.canonicalSegments[parsed.canonicalSegments.length - 1].length - 1,
                passNumber: 1,
                offsetMeters: 0,
                needsReview: false,
                offCourseBlocked: false,
                offCourseConfirmed: false,
                services: [],
                photos: [],
                visibility: 'draft' as const,
              },
            ];
      pushHistory(parsed.canonicalGeometry, reanchored);
      setImportFitNonce((n) => n + 1);
      setStatusNotice(
        `Imported ${fileLabel}: ${parsed.distanceKm.toFixed(2)} km across ${parsed.canonicalSegments.length} segment(s), ${parsed.points.length} points.`,
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'GPX import failed.');
    }
  };

  const handleGpxFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setErrorNotice('The GPX route file exceeds the 8 MB limit.');
      return;
    }
    const text = await file.text();
    handleImportGpxText(text, file.name);
  };

  const handleLoadFixture = async (path: string, fileLabel: string) => {
    setErrorNotice('');
    try {
      const text = await fetchGpxText(path);
      handleImportGpxText(text, fileLabel);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not load GPX fixture.');
    }
  };

  const handleReverseCourse = () => {
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a GPX route before reversing.');
      return;
    }
    const reversed = reverseCanonicalGeometry(geometry);
    const reprocessed = processCanonicalGeometry(reversed);
    const reanchored = reanchorMarkersForRoute(reprocessed, markers);
    pushHistory(reversed, reanchored);
    setStatusNotice('Course direction reversed and marker chainages recomputed.');
  };

  const clearGpsWatch = () => {
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
  };

  const formatGeolocationError = (err: GeolocationPositionError): string => {
    if (err.code === 1) {
      return 'Location permission denied. Allow location access in your browser or Android app settings, then tap Start GPS tracking again.';
    }
    if (err.code === 2) {
      return 'Device location is unavailable. Turn on Location / GPS services on your device and try again.';
    }
    if (err.code === 3) {
      return 'GNSS fix timed out. Step outdoors for a clearer sky view or widen the accuracy gate, then try again.';
    }
    return err.message || 'Location permission denied or GNSS signal lost.';
  };

  const handleSetGpsLocation = (lat: number, lon: number, accuracyM = 10) => {
    const manualFix: GpsBreadcrumbFix = {
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
      accuracyM,
      timestamp: Date.now(),
    };
    gpsFixReceivedRef.current = true;
    setGpsError('');
    setGpsState((prev) =>
      processGpsBreadcrumbFix(
        prev,
        manualFix,
        activeSurfaceTypeRef.current,
        activeTerrainScenarioRef.current,
      ),
    );
    setFlyToTrigger({
      lat: manualFix.latitude,
      lon: manualFix.longitude,
      zoom: 16,
      nonce: Date.now(),
    });
    setStatusNotice(
      `GPS pinpoint set to ${manualFix.latitude.toFixed(5)}, ${manualFix.longitude.toFixed(5)} (±${accuracyM}m).`,
    );
  };

  const handlePinpointMapCenter = () => {
    const center = currentMapCenterRef.current || { lat: 16.4121, lon: 120.595 };
    handleSetGpsLocation(center.lat, center.lon, 12);
  };

  const startGpsWatch = (highAccuracy: boolean) => {
    clearGpsWatch();
    initialGpsCenteredRef.current = false;
    gpsFixReceivedRef.current = false;

    if (typeof navigator !== 'undefined' && 'permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((perm) => {
          if (perm.state === 'prompt') {
            setStatusNotice('Awaiting location approval: please click "Allow" in your browser address bar.');
          } else if (perm.state === 'denied') {
            setGpsError(
              'Location permission is blocked. Click the tune/lock icon in your browser address bar and enable Location access for RacePulsePH.',
            );
            setGpsState((prev) => ({ ...prev, status: 'paused' }));
          }
          perm.onchange = () => {
            if (perm.state === 'granted') {
              startGpsWatch(true);
            } else if (perm.state === 'denied') {
              setGpsError('Location permission denied.');
              setGpsState((prev) => ({ ...prev, status: 'paused' }));
            }
          };
        })
        .catch(() => {});
    }

    const recordFixAndCenter = (fix: {
      latitude: number;
      longitude: number;
      altitude?: number;
      accuracyM: number;
      timestamp: number;
      headingDeg?: number;
    }) => {
      gpsFixReceivedRef.current = true;
      setGpsError('');
      setGpsState((prev) =>
        processGpsBreadcrumbFix(
          prev,
          fix,
          activeSurfaceTypeRef.current,
          activeTerrainScenarioRef.current,
        ),
      );
      if (!initialGpsCenteredRef.current) {
        initialGpsCenteredRef.current = true;
        setFlyToTrigger({
          lat: fix.latitude,
          lon: fix.longitude,
          zoom: 16,
          nonce: Date.now(),
        });
        if (fix.accuracyM <= gpsState.maxAccuracyM) {
          setStatusNotice(`Live GNSS locked (±${Math.round(fix.accuracyM)}m). Recording trail breadcrumbs.`);
        } else {
          setStatusNotice(
            `Initial location locked (±${Math.round(fix.accuracyM)}m). Acquiring high-accuracy GNSS satellites...`,
          );
        }
      }
    };

    // Fast-path immediate coarse / cached lock so the map centers within milliseconds
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (coarsePos) => {
          const fix = {
            latitude: coarsePos.coords.latitude,
            longitude: coarsePos.coords.longitude,
            altitude: coarsePos.coords.altitude ?? undefined,
            accuracyM: coarsePos.coords.accuracy ?? 999,
            timestamp: coarsePos.timestamp || Date.now(),
            headingDeg: coarsePos.coords.heading ?? undefined,
          };
          recordFixAndCenter(fix);
        },
        () => {
          // Fast coarse lock unavailable or permission prompt still open; watchPosition will catch it
        },
        { enableHighAccuracy: false, maximumAge: 120000, timeout: 4000 },
      );
    }

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      gpsWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude ?? undefined,
            accuracyM: pos.coords.accuracy ?? 999,
            timestamp: pos.timestamp || Date.now(),
            headingDeg: pos.coords.heading ?? undefined,
          };
          recordFixAndCenter(fix);
        },
        (err) => {
          if (err.code === 1) {
            clearGpsWatch();
            setGpsError(formatGeolocationError(err));
            setGpsState((prev) => ({ ...prev, status: 'paused' }));
            return;
          }
          if (gpsFixReceivedRef.current) {
            setGpsError(
              err.code === 3
                ? 'Waiting for next GNSS fix (signal momentarily weak)...'
                : 'GNSS signal momentarily unavailable; waiting for next fix...',
            );
            return;
          }
          if (highAccuracy && (err.code === 2 || err.code === 3)) {
            setStatusNotice('High-accuracy GNSS unavailable. Checking network / Wi-Fi position...');
            navigator.geolocation.getCurrentPosition(
              (coarsePos) => {
                const fix = {
                  latitude: coarsePos.coords.latitude,
                  longitude: coarsePos.coords.longitude,
                  altitude: coarsePos.coords.altitude ?? undefined,
                  accuracyM: coarsePos.coords.accuracy ?? 999,
                  timestamp: coarsePos.timestamp || Date.now(),
                  headingDeg: coarsePos.coords.heading ?? undefined,
                };
                recordFixAndCenter(fix);
              },
              (fallbackErr) => {
                clearGpsWatch();
                setGpsError(
                  fallbackErr.code === 1
                    ? 'Location permission denied. Please allow location in your browser.'
                    : 'Device GPS fix unavailable (Windows location may be off or no GPS/Wi-Fi positioning hardware present). Click "Pinpoint Map Center" or click on the map to set your location.',
                );
                setGpsState((prev) => ({ ...prev, status: 'paused' }));
              },
              { enableHighAccuracy: false, maximumAge: 30000, timeout: 6000 },
            );
            return;
          }
          clearGpsWatch();
          setGpsError(formatGeolocationError(err));
          setGpsState((prev) => ({ ...prev, status: 'paused' }));
        },
        highAccuracy
          ? { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
          : { enableHighAccuracy: false, maximumAge: 5000, timeout: 10000 },
      );
    }
  };

  const handleStartGpsTracking = () => {
    setGpsError('');
    setErrorNotice('');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Browser geolocation is unavailable on this device. Use Simulate GPS walk to test field capture.');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const isLocalhost = window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1';
      if (!isLocalhost) {
        setGpsError('Live GPS requires HTTPS, localhost, or the RacePulsePH Android app. Use Simulate GPS walk on local HTTP.');
        return;
      }
    }
    gpsFixReceivedRef.current = false;
    initialGpsCenteredRef.current = false;
    setTrailOption('gps');
    setGpsState((prev) => ({ ...prev, status: 'tracking' }));
    setStatusNotice(`Live GNSS tracking started (accuracy gate <= ${gpsState.maxAccuracyM} m). Locating your spot...`);
    startGpsWatch(true);
  };

  const handleStopGpsTracking = () => {
    clearGpsWatch();
    setGpsState((prev) => ({ ...prev, status: 'paused' }));
    setStatusNotice('GPS field recording paused. Review captured fixes or commit to the route.');
  };

  const handleCenterOnGps = () => {
    if (latestGpsFix) {
      setFlyToTrigger({
        lat: latestGpsFix.latitude,
        lon: latestGpsFix.longitude,
        zoom: 16,
        nonce: Date.now(),
      });
      setStatusNotice(
        `Centered on GPS fix (${latestGpsFix.latitude.toFixed(5)}, ${latestGpsFix.longitude.toFixed(5)} · ±${Math.round(latestGpsFix.accuracyM)}m).`,
      );
    } else {
      handlePinpointMapCenter();
    }
  };

  const handleSimulateGpsWalk = () => {
    setGpsError('');
    setErrorNotice('');
    setTrailOption('gps');
    const anchorPt =
      selection && processedRoute.points.length > 0
        ? selection
        : processedRoute.points[0]
          ? {
              latitude: processedRoute.points[0].latitude,
              longitude: processedRoute.points[0].longitude,
              elevation: processedRoute.points[0].elevation ?? 0,
            }
          : currentMapCenterRef.current
            ? {
                latitude: currentMapCenterRef.current.lat,
                longitude: currentMapCenterRef.current.lon,
                elevation: 1450,
              }
            : {
                latitude: 16.4121,
                longitude: 120.595,
                elevation: 1450,
              };
    const fixes = generateSimulatedGpsWalk(
      anchorPt.latitude,
      anchorPt.longitude,
      anchorPt.elevation ?? 0,
      12,
    );
    let nextState = {
      ...createGpsTrailState({ maxAccuracyM: gpsState.maxAccuracyM }),
      status: 'paused' as GpsTrailState['status'],
    };
    for (const fix of fixes) {
      nextState = processGpsBreadcrumbFix(nextState, fix, activeSurfaceType, activeTerrainScenario);
    }
    setGpsState(nextState);
    if (fixes.length > 0) {
      setFlyToTrigger({
        lat: fixes[0].latitude,
        lon: fixes[0].longitude,
        zoom: 16,
        nonce: Date.now(),
      });
    }
    setStatusNotice(
      `Simulated GPS survey captured ${nextState.acceptedPoints.length} accurate fixes (${nextState.rejectedCount} noisy outlier rejected).`,
    );
  };

  const handleCommitGpsTrack = (replaceExisting = false) => {
    setErrorNotice('');
    try {
      const nextGeom = commitGpsTrackToGeometry(geometry, gpsState, replaceExisting);
      const reprocessed = processCanonicalGeometry(nextGeom);
      pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
      setStatusNotice(
        `${replaceExisting ? 'Replaced route with' : 'Appended'} ${gpsState.acceptedPoints.length}-point GPS survey track.`,
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not commit GPS track.');
    }
  };

  const handleDropMarkerAtGps = () => {
    const latest = gpsState.acceptedPoints[gpsState.acceptedPoints.length - 1];
    if (!latest) {
      setErrorNotice('Capture at least 1 accepted GPS fix before dropping a marker at your position.');
      return;
    }
    handleAddMarkerAtSelection(latest.lat, latest.lon, 'aid');
  };

  const handlePaintStrokeCommit = (rawPoints: Array<{ lat: number; lon: number }>) => {
    setErrorNotice('');
    const nextGeom = appendPaintedStrokeToGeometry(geometry, rawPoints, {
      spacingM: paintSpacingM,
      surfaceType: activeSurfaceType,
      terrainScenario: activeTerrainScenario,
      replaceStarter: isDefaultStarterGeometry(geometry),
    });
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice(
      `Painted ${SURFACE_LABELS[activeSurfaceType]} section (${TERRAIN_SCENARIO_LABELS[activeTerrainScenario]}).`,
    );
  };

  const handleEraseAtCoordinate = (lat: number, lon: number) => {
    setErrorNotice('');
    try {
      const distToCursorM = selection
        ? geodesicDistanceM({ latitude: lat, longitude: lon }, selection)
        : Infinity;
      if (geometry.isCanvasCleared) {
        if (!geometry.isStartPointRemoved && distToCursorM <= Math.max(eraseRadiusM, 75)) {
          pushHistory(removeStartPointFromGeometry(geometry), markers);
          setStatusNotice(
            'Starting point removed. Select Start Point (S) or click the map to place a new starting point.',
          );
        }
        return;
      }
      const nextGeom = erasePointsInRadius(geometry, lat, lon, eraseRadiusM);
      const cursorErased =
        !geometry.isStartPointRemoved && distToCursorM <= Math.max(eraseRadiusM, 35);
      const finalGeom = cursorErased ? removeStartPointFromGeometry(nextGeom) : nextGeom;
      const reprocessed = processCanonicalGeometry(finalGeom);
      pushHistory(finalGeom, reanchorMarkersForRoute(reprocessed, markers));
      setStatusNotice(
        finalGeom.isCanvasCleared
          ? 'Course canvas cleared (0.00 km). Place a starting point, Paint Trail, Draw Points, or Import GPX to continue.'
          : cursorErased
            ? `Erased trail vertices and removed starting point dot within ${eraseRadiusM} m.`
            : `Erased trail vertices within ${eraseRadiusM} m.`,
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not erase vertices.');
    }
  };

  const handleClearCanvas = () => {
    setErrorNotice('');
    const cleared = clearRouteCanvas(geometry);
    pushHistory(cleared, []);
    setSelectedMarkerId('');
    setStatusNotice(
      'Course canvas cleared. Use Start Point (S), Paint Trail (B), Draw Points (P), GPS Survey, or Import GPX.',
    );
  };

  const syncStartMarkers = (nextRoute: ReturnType<typeof processCanonicalGeometry>, lat: number, lon: number) => {
    const fixedLat = Number(lat.toFixed(6));
    const fixedLon = Number(lon.toFixed(6));
    const updated = markers.map((m) =>
      m.kind === 'start' ? { ...m, latitude: fixedLat, longitude: fixedLon } : m,
    );
    return reanchorMarkersForRoute(nextRoute, updated);
  };

  const handleRemoveStartPoint = () => {
    setErrorNotice('');
    if (geometry.isStartPointRemoved) return;
    const nextGeom = removeStartPointFromGeometry(geometry);
    pushHistory(nextGeom, markers);
    setStatusNotice(
      geometry.isCanvasCleared
        ? 'Starting point removed. Select Start Point (S) or click the map to place a new starting point.'
        : 'Starting point dot removed. Select Start Point (S) or click along the course to show it again.',
    );
  };

  const handlePlaceStartPoint = async (lat: number, lon: number): Promise<boolean> => {
    setErrorNotice('');
    const result = relocateStartPointInGeometry(geometry, lat, lon, processedRoute);
    if (result.mode === 'needs-reset-confirm') {
      const ok = await confirm({
        title: 'Move starting point to new location?',
        message: `This point is ${result.distanceFromCourseKm} km from the current course. Clear the current path and place a new starting point here? You can Undo anytime.`,
        confirmLabel: 'Clear & place start here',
        destructive: true,
      });
      if (!ok) return false;
      const reprocessed = processCanonicalGeometry(result.fallbackAnchor);
      const nextMarkers = syncStartMarkers(reprocessed, lat, lon);
      pushHistory(result.fallbackAnchor, nextMarkers);
      setSelection(locateAtChainage(reprocessed, 0, 1));
      setStatusNotice(`Moved starting point to ${lat.toFixed(5)}, ${lon.toFixed(5)}.`);
      return true;
    }

    const reprocessed = processCanonicalGeometry(result.geometry);
    const nextMarkers = syncStartMarkers(reprocessed, lat, lon);
    pushHistory(result.geometry, nextMarkers);
    setSelection(locateAtChainage(reprocessed, 0, 1));
    setStatusNotice(
      result.mode === 'rotated-loop'
        ? 'Moved loop starting point along the course.'
        : `Placed starting point at ${lat.toFixed(5)}, ${lon.toFixed(5)}.`,
    );
    return true;
  };

  const handleSelectChainageWithCursor = (chainageM: number, passNum?: number) => {
    if (geometry.isStartPointRemoved && !geometry.isCanvasCleared) {
      setGeometry((curr) => {
        if (!curr.isStartPointRemoved) return curr;
        const { isStartPointRemoved: _removed, ...rest } = curr;
        return rest;
      });
    }
    setSelection(locateAtChainage(processedRoute, chainageM, passNum));
  };

  const handleApplyTerrainRange = () => {
    setErrorNotice('');
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before tagging terrain.');
      return;
    }
    const fromKm = Number(rangeFromKm);
    const toKm = Number(rangeToKm);
    if (!Number.isFinite(fromKm) || !Number.isFinite(toKm) || fromKm < 0 || toKm <= fromKm) {
      setErrorNotice('Enter a valid start and end distance range in km (for example 0.5 to 3.0).');
      return;
    }
    const nextGeom = applyTerrainScenarioToRange(
      geometry,
      fromKm,
      toKm,
      activeSurfaceType,
      activeTerrainScenario,
    );
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice(
      `Tagged ${fromKm.toFixed(1)}-${toKm.toFixed(1)} km as ${SURFACE_LABELS[activeSurfaceType]} (${TERRAIN_SCENARIO_LABELS[activeTerrainScenario]}).`,
    );
  };

  const handleSampleElevation = async () => {
    setErrorNotice('');
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before sampling terrain elevation.');
      return;
    }
    const res = await sampleTerrainElevationForGeometry(geometry);
    const reprocessed = processCanonicalGeometry(res.geometry);
    pushHistory(res.geometry, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice(
      res.filledCount > 0
        ? `Sampled topographic elevation for ${res.filledCount} drawn points.`
        : 'All vertices already have elevation values.',
    );
  };

  const handleSmoothTrail = () => {
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before smoothing.');
      return;
    }
    const nextGeom = smoothEntireGeometry(geometry, paintSpacingM);
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice(`Smoothed trail corners with ${paintSpacingM} m resampling.`);
  };

  const handleMirrorOutAndBack = () => {
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before mirroring out-and-back.');
      return;
    }
    const nextGeom = mirrorOutAndBackRoute(geometry);
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice('Mirrored outgoing route as an out-and-back return leg.');
  };

  const handleCloseLoop = () => {
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before closing a loop.');
      return;
    }
    const nextGeom = closeRouteLoopToStart(geometry);
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice('Closed course loop back to the start coordinate.');
  };

  const handleGenerateSplitMarkers = () => {
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a route before generating 1 km markers.');
      return;
    }
    const nextMarkers = generateSplitKmMarkers(processedRoute, 1, markers);
    pushHistory(geometry, nextMarkers);
    setStatusNotice(`Generated 1 km distance and water split markers (${nextMarkers.length} total markers).`);
  };

  const handleAppendManualPoint = () => {
    setErrorNotice('');
    const lat = Number(coordLat);
    const lon = Number(coordLon);
    const ele = coordEle.trim() ? Number(coordEle) : undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setErrorNotice('Enter valid WGS84 latitude (-90..90) and longitude (-180..180).');
      return;
    }
    if (ele !== undefined && (!Number.isFinite(ele) || ele < -450 || ele > 9000)) {
      setErrorNotice('Elevation must be between -450 m and 9000 m.');
      return;
    }

    const pointEle = ele !== undefined ? ele : estimatePhilippineTopographicElevationM(lat, lon);
    const nextGeom = structuredClone(geometry);
    if (nextGeom.isCanvasCleared) {
      if (nextGeom.isStartPointRemoved) {
        const res = relocateStartPointInGeometry(nextGeom, lat, lon, processedRoute);
        if (res.mode !== 'needs-reset-confirm') {
          const reprocessed = processCanonicalGeometry(res.geometry);
          pushHistory(res.geometry, syncStartMarkers(reprocessed, lat, lon));
          setSelection(locateAtChainage(reprocessed, 0, 1));
          setStatusNotice(`Placed starting point at ${lat.toFixed(5)}, ${lon.toFixed(5)}. Append another coordinate to extend the course.`);
        }
        return;
      }
      const placedStart = nextGeom.segments[0]?.points[0] || { lat, lon };
      const startEle =
        placedStart.ele ??
        placedStart.rawEle ??
        estimatePhilippineTopographicElevationM(placedStart.lat, placedStart.lon);
      const freshGeom: CanonicalRouteGeometry = {
        version: 1,
        sourceKind: 'drawn',
        segments: densifyAndElevateDrawnSegments([
          {
            id: 'drawn_1',
            name: 'Drawn course section',
            sourceKind: 'drawn',
            points: [
              { lat: placedStart.lat, lon: placedStart.lon, ele: startEle, rawEle: startEle },
              { lat, lon, ele: pointEle, rawEle: pointEle },
            ],
          },
        ]),
      };
      const reprocessed = processCanonicalGeometry(freshGeom);
      pushHistory(freshGeom, reanchorMarkersForRoute(reprocessed, markers));
      setStatusNotice('Created drawn segment from starting point.');
      return;
    }

    const lastSeg = nextGeom.segments[nextGeom.segments.length - 1];
    if (lastSeg && lastSeg.sourceKind === 'drawn') {
      lastSeg.points.push({ lat, lon, ele: pointEle, rawEle: pointEle });
    } else {
      const anchor = lastSeg?.points[lastSeg.points.length - 1] || { lat, lon };
      const anchorEle =
        anchor.ele ?? anchor.rawEle ?? estimatePhilippineTopographicElevationM(anchor.lat, anchor.lon);
      nextGeom.segments.push({
        id: `drawn_${nextGeom.segments.length + 1}`,
        name: 'Drawn extension',
        sourceKind: 'drawn',
        points: [
          { lat: anchor.lat, lon: anchor.lon, ele: anchorEle, rawEle: anchorEle },
          { lat, lon, ele: pointEle, rawEle: pointEle },
        ],
      });
    }
    delete nextGeom.isStartPointRemoved;
    nextGeom.segments = densifyAndElevateDrawnSegments(nextGeom.segments);
    nextGeom.sourceKind = nextGeom.segments.some((s) => s.sourceKind === 'gpx') ? 'mixed' : 'drawn';
    const reprocessed = processCanonicalGeometry(nextGeom);
    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
    setStatusNotice('Appended manually drawn point to course.');
  };

  const createDraftFromCurrentCanvas = (
    nextGeometry = geometry,
    nextMarkers = markers,
  ) => {
    if (!targetRace) {
      throw new Error('Create an existing race in Race Setup first.');
    }
    const distLabel = selectedDistanceObj?.label || targetDistanceId || 'Course';
    const resolvedTitle = draftTitle.trim() || `${targetRace.name} (${distLabel})`;
    const resolvedRegion = draftRegion.trim() || 'Philippines';
    const created = createPresetDraftCommand({
      actorUid: profile.uid,
      actorName: profile.displayName || profile.email,
      title: resolvedTitle,
      region: resolvedRegion,
      activity: (selectedDistanceObj?.km ?? 0) >= 21 ? 'trail' : 'road',
      raceId: targetRace.id,
      distanceId: selectedDistanceObj?.id || targetDistanceId || undefined,
      geometry: nextGeometry,
      markers: nextMarkers,
      sourceFileName,
    });
    justCreatedPresetIdRef.current = created.preset.id;
    setSelectedPresetId(created.preset.id);
    setDraftTitle(created.draft.title);
    setDraftRegion(created.draft.region);
    setExpectedRevision(created.draft.revision);
    setDirty(false);
    return created;
  };

  const handleNewPreset = () => {
    if (!canCreateRoute) {
      setErrorNotice('Creating course presets is disabled for your account.');
      return;
    }
    if (!targetRace) {
      setErrorNotice('Create an existing race in Race Setup before creating a course preset.');
      return;
    }
    resetWorkspaceToEmpty(true);
    setErrorNotice('');
    setStatusNotice(`Ready for a new empty course draft in ${targetRace.name}.`);
  };

  const handleDuplicatePreset = () => {
    if (!canCreateRoute) {
      setErrorNotice('Duplicating course presets is disabled for your account.');
      return;
    }
    if (!activePreset) {
      setErrorNotice('Save a course draft first before duplicating.');
      return;
    }
    setErrorNotice('');
    try {
      const dup = duplicatePresetCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        sourcePresetId: activePreset.id,
      });
      setSelectedPresetId(dup.preset.id);
      setStatusNotice(`Duplicated preset as "${dup.preset.title}".`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not duplicate preset.');
    }
  };

  const handleSaveDraft = () => {
    if (!canEditRoute) {
      setErrorNotice('Editing course drafts is disabled for your account.');
      return;
    }
    if (isCanvasEmpty && markers.length === 0) {
      setErrorNotice('Draw, paint, record GPS, or import a GPX route before saving.');
      return;
    }
    setErrorNotice('');
    try {
      if (!activePreset) {
        const { draft } = createDraftFromCurrentCanvas();
        setStatusNotice(`Saved new course draft "${draft.title}" (revision ${draft.revision}).`);
        return;
      }
      const saved = savePresetDraftCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        presetId: activePreset.id,
        draftId: activePreset.latestDraftId,
        expectedRevision,
        title: draftTitle,
        region: draftRegion,
        geometry,
        markers,
        sourceFileName,
        editSummary: editSummary || 'Updated course draft in Route Studio',
      });
      setExpectedRevision(saved.revision);
      setDirty(false);
      setStatusNotice(`Saved draft revision ${saved.revision}.`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const handleReloadLatestDraft = () => {
    if (!activeDraft) return;
    setDraftTitle(activeDraft.title);
    setDraftRegion(activeDraft.region);
    const hydratedGeom = structuredClone(activeDraft.canonicalGeometry);
    if (!hydratedGeom.isCanvasCleared && hydratedGeom.segments.some((s) => s.sourceKind === 'drawn')) {
      hydratedGeom.segments = densifyAndElevateDrawnSegments(hydratedGeom.segments);
    }
    setGeometry(hydratedGeom);
    setMarkers(structuredClone(activeDraft.markers));
    setExpectedRevision(activeDraft.revision);
    setDirty(false);
    setErrorNotice('');
    setStatusNotice(`Reloaded latest draft revision ${activeDraft.revision}.`);
  };

  const handleCreateVersion = () => {
    if (!canPublishRoute) {
      setErrorNotice('Creating reviewed versions is disabled for your account.');
      return;
    }
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, record GPS, or import a GPX route before creating a version.');
      return;
    }
    setErrorNotice('');
    try {
      let presetRef = activePreset;
      let currentRev = expectedRevision;
      if (!presetRef) {
        const created = createDraftFromCurrentCanvas();
        presetRef = created.preset;
        currentRev = created.draft.revision;
      } else if (dirty) {
        const saved = savePresetDraftCommand({
          actorUid: profile.uid,
          actorName: profile.displayName || profile.email,
          presetId: presetRef.id,
          draftId: presetRef.latestDraftId,
          expectedRevision: currentRev,
          title: draftTitle,
          region: draftRegion,
          geometry,
          markers,
          sourceFileName,
          editSummary: 'Saved prior to creating immutable version',
        });
        currentRev = saved.revision;
        setExpectedRevision(currentRev);
        setDirty(false);
      }
      const ver = createPresetVersionCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        presetId: presetRef.id,
        draftId: presetRef.latestDraftId,
        expectedRevision: currentRev,
        reviewNotes,
      });
      setSelectedVersionId(ver.id);
      setReviewNotes('');
      setStatusNotice(`Created immutable preset version v${ver.versionNumber}. Existing published races are untouched.`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not create version.');
    }
  };

  const handleAddMarkerAtSelection = (
    lat = selection?.latitude ?? processedRoute.points[0]?.latitude,
    lon = selection?.longitude ?? processedRoute.points[0]?.longitude,
    kind: RouteMarkerKind = 'aid',
  ) => {
    if (!hasRoutePath || lat === undefined || lon === undefined) {
      setErrorNotice('Draw, paint, record GPS, or import a route before adding checkpoints.');
      return;
    }
    const projected = projectCoordinateToRoute(processedRoute, lat, lon);
    const id = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const newMarker: RouteMarker = {
      id,
      kind,
      name: `${kind.charAt(0).toUpperCase() + kind.slice(1)} Station ${markers.length + 1}`,
      description: '',
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
      chainageM: projected.best.chainageM,
      segmentIndex: projected.best.segmentIndex,
      pointIndex: projected.best.pointIndex,
      passNumber: projected.best.passNumber,
      offsetMeters: projected.best.offsetMeters,
      needsReview: projected.best.offsetMeters > 30,
      offCourseBlocked: projected.best.offsetMeters > 100,
      offCourseConfirmed: false,
      services: kind === 'aid' ? ['Water'] : [],
      photos: [],
      visibility: 'public',
    };
    const nextMarkers = [...markers, newMarker];
    pushHistory(geometry, nextMarkers);
    setSelectedMarkerId(id);
    setDrawMode('view');
    setStatusNotice(`Added ${newMarker.name} at ${(newMarker.chainageM / 1000).toFixed(2)} km.`);
  };

  const selectedMarker = markers.find((m) => m.id === selectedMarkerId) || markers[0];

  const updateSelectedMarker = (patch: Partial<RouteMarker>) => {
    if (!selectedMarker) return;
    const updated = markers.map((m) => {
      if (m.id !== selectedMarker.id) return m;
      const merged = { ...m, ...patch };
      if (patch.latitude !== undefined || patch.longitude !== undefined || patch.passNumber !== undefined) {
        const proj = projectCoordinateToRoute(
          processedRoute,
          merged.latitude,
          merged.longitude,
          merged.passNumber,
        );
        merged.chainageM = proj.best.chainageM;
        merged.segmentIndex = proj.best.segmentIndex;
        merged.pointIndex = proj.best.pointIndex;
        merged.offsetMeters = proj.best.offsetMeters;
      }
      merged.needsReview = merged.offsetMeters > 30;
      merged.offCourseBlocked = merged.offsetMeters > 100 && !merged.offCourseConfirmed;
      return merged;
    });
    pushHistory(geometry, updated);
  };

  const handleUploadPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!canUploadRouteMedia) {
      setErrorNotice('Uploading landmark photos is disabled for your account.');
      return;
    }
    if (!file || !selectedMarker) return;
    setPhotoBusy(true);
    setErrorNotice('');
    try {
      const processedPhoto = await processLandmarkPhotoFile(file, {
        caption: photoCaption,
        altText: photoAlt,
        credit: photoCredit,
        rightsConfirmed: photoRights,
      });
      updateSelectedMarker({
        photos: [...selectedMarker.photos, processedPhoto].slice(0, 3),
      });
      setPhotoCaption('');
      setPhotoAlt('');
      setPhotoCredit('');
      setPhotoRights(false);
      setStatusNotice(`Processed landmark photo (stripped EXIF metadata, ${processedPhoto.width}x${processedPhoto.height}).`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Photo processing failed.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleAttachVerifiedSamplePhoto = async () => {
    if (!canUploadRouteMedia) {
      setErrorNotice('Uploading landmark photos is disabled for your account.');
      return;
    }
    if (!selectedMarker) return;
    setErrorNotice('');
    try {
      if (!photoCaption.trim() || !photoAlt.trim() || !photoCredit.trim() || !photoRights) {
        throw new Error('Enter caption, alt text, credit, and confirm publication rights first.');
      }
      const asset = await createSyntheticLandmarkPhoto({
        title: selectedMarker.name,
        caption: photoCaption.trim(),
        altText: photoAlt.trim(),
        credit: photoCredit.trim(),
      });
      updateSelectedMarker({
        photos: [...selectedMarker.photos, asset].slice(0, 3),
      });
      setPhotoCaption('');
      setPhotoAlt('');
      setPhotoCredit('');
      setPhotoRights(false);
      setStatusNotice(`Attached verified landmark photo to ${selectedMarker.name}.`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not attach landmark photo.');
    }
  };

  const handlePublishBinding = () => {
    if (!canPublishRoute || !canAssignRoute) {
      setErrorNotice('Publishing and binding race courses requires routes.publish and routes.assign permissions.');
      return;
    }
    if (!targetRace || !activePreset || !selectedVersion) {
      setErrorNotice('Select an existing race and create an immutable preset version before publishing.');
      return;
    }
    setErrorNotice('');
    try {
      const res = bindAndPublishRaceRouteCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        race: targetRace,
        distanceId: targetDistanceId,
        presetId: activePreset.id,
        versionId: selectedVersion.id,
        checkpointLinks,
        overrideFreeze,
        reason: publishReason,
      });
      setPublishReason('');
      setOverrideFreeze(false);
      setStatusNotice(
        `Published ${res.publication.raceName} ${res.publication.distanceLabel} (v${res.publication.versionNumber}). Runners can now view this map and course stats on the event.`,
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not publish course binding.');
    }
  };

  const handleQuickAttachAndPublish = () => {
    if (!canPublishRoute || !canAssignRoute) {
      setErrorNotice('Attaching and publishing courses requires routes.publish and routes.assign permissions.');
      return;
    }
    if (!targetRace || !targetDistanceId) {
      setErrorNotice('Select an event and distance category first.');
      return;
    }
    if (!hasRoutePath) {
      setErrorNotice('Draw, paint, or import a route with at least 2 points before attaching it to the event.');
      return;
    }
    setErrorNotice('');
    try {
      let workingMarkers = [...markers];
      const hasStart = workingMarkers.some((m) => m.kind === 'start');
      const hasFinish = workingMarkers.some((m) => m.kind === 'finish');
      if (!hasStart) {
        const startPt = processedRoute.points[0];
        workingMarkers = [
          {
            id: `m_start_${Date.now().toString(36)}`,
            kind: 'start',
            name: 'Start',
            description: 'Course start arch',
            latitude: startPt.latitude,
            longitude: startPt.longitude,
            chainageM: 0,
            segmentIndex: 0,
            pointIndex: 0,
            passNumber: 1,
            offsetMeters: 0,
            needsReview: false,
            offCourseBlocked: false,
            offCourseConfirmed: false,
            services: ['Timing mat'],
            photos: [],
            visibility: 'public',
          },
          ...workingMarkers,
        ];
      }
      if (!hasFinish) {
        const lastIdx = processedRoute.points.length - 1;
        const endPt = processedRoute.points[lastIdx];
        const lastSegIdx = Math.max(0, processedRoute.canonicalSegments.length - 1);
        const lastSegLen = Math.max(1, processedRoute.canonicalSegments[lastSegIdx]?.length || 1);
        workingMarkers = [
          ...workingMarkers,
          {
            id: `m_finish_${Date.now().toString(36)}`,
            kind: 'finish',
            name: 'Finish',
            description: 'Course finish arch',
            latitude: endPt.latitude,
            longitude: endPt.longitude,
            chainageM: processedRoute.distanceM,
            segmentIndex: lastSegIdx,
            pointIndex: lastSegLen - 1,
            passNumber: 1,
            offsetMeters: 0,
            needsReview: false,
            offCourseBlocked: false,
            offCourseConfirmed: false,
            services: ['Timing mat', 'Water'],
            photos: [],
            visibility: 'public',
          },
        ];
      }

      if (!hasStart || !hasFinish) {
        setMarkers(workingMarkers);
      }

      let presetRef = activePreset;
      let draftRev = expectedRevision;
      if (!presetRef) {
        const created = createDraftFromCurrentCanvas(geometry, workingMarkers);
        presetRef = created.preset;
        draftRev = created.draft.revision;
      } else {
        const saved = savePresetDraftCommand({
          actorUid: profile.uid,
          actorName: profile.displayName || profile.email,
          presetId: presetRef.id,
          draftId: presetRef.latestDraftId,
          expectedRevision: draftRev,
          title: draftTitle,
          region: draftRegion,
          geometry,
          markers: workingMarkers,
          sourceFileName,
          editSummary: editSummary || `Attached to ${targetRace.name}`,
        });
        draftRev = saved.revision;
        setExpectedRevision(draftRev);
        setDirty(false);
      }

      const ver = createPresetVersionCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        presetId: presetRef.id,
        draftId: presetRef.latestDraftId,
        expectedRevision: draftRev,
        reviewNotes: reviewNotes || `Attached to ${targetRace.name}`,
      });
      setSelectedVersionId(ver.id);

      const res = bindAndPublishRaceRouteCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        race: targetRace,
        distanceId: targetDistanceId,
        presetId: presetRef.id,
        versionId: ver.id,
        checkpointLinks,
        overrideFreeze,
        reason: publishReason,
      });
      setPublishReason('');
      setOverrideFreeze(false);
      setStatusNotice(
        `Attached and published to ${res.publication.raceName} (${res.publication.distanceLabel} v${res.publication.versionNumber}). Runners can now inspect the map and stats on the event.`,
      );
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not attach and publish route.');
    }
  };

  const handleWithdrawPublication = () => {
    if (!canPublishRoute) {
      setErrorNotice('Withdrawing published courses is disabled for your account.');
      return;
    }
    if (!targetRace || !currentPublication) return;
    setErrorNotice('');
    try {
      withdrawPublicationCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        raceId: targetRace.id,
        distanceId: targetDistanceId,
        publicationId: currentPublication.id,
        reason: withdrawReason,
      });
      setWithdrawReason('');
      setStatusNotice('Course publication withdrawn from public Explorer.');
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Withdrawal failed.');
    }
  };

  const handleRollback = (targetPubId: string) => {
    if (!canAssignRoute) {
      setErrorNotice('Rolling back race course bindings is disabled for your account.');
      return;
    }
    if (!targetRace) return;
    setErrorNotice('');
    try {
      const restored = rollbackPublicationCommand({
        actorUid: profile.uid,
        actorName: profile.displayName || profile.email,
        raceId: targetRace.id,
        distanceId: targetDistanceId,
        targetPublicationId: targetPubId,
      });
      setStatusNotice(`Rolled back public course to v${restored.versionNumber}.`);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Rollback failed.');
    }
  };

  const handleMigrateLegacy = async (race: Race, dryRun: boolean) => {
    const res = await migrateLegacyRaceGpxCommand({
      actorUid: profile.uid,
      actorName: profile.displayName || profile.email,
      race,
      targetDistanceId: migrationDistanceByRace[race.id],
      dryRun,
    });
    setMigrationResults((prev) => ({ ...prev, [race.id]: res }));
    if (res.presetId && !dryRun) {
      setSelectedPresetId(res.presetId);
    }
  };

  const handleWeeklyImageryCheck = () => {
    setErrorNotice('');
    const res = runWeeklyClearImageryCheckCommand({
      actorUid: profile.uid,
      actorName: profile.displayName || profile.email,
    });
    setStatusNotice(
      `Weekly imagery check finished: ${res.updatedCount} course(s) validated and updated (${res.skippedCount} skipped).`,
    );
  };

  const handleQuarterlyMosaicRefresh = () => {
    setErrorNotice('');
    const res = runQuarterlyNationalMosaicRefreshCommand({
      actorUid: profile.uid,
      actorName: profile.displayName || profile.email,
    });
    setStatusNotice(
      `Quarterly national mosaic (${res.quarter}) refreshed and validated across ${res.updatedCount} published course(s).`,
    );
  };

  const draftTileManifest = useMemo(
    () =>
      prepareCourseMapLayerManifest(processedRoute.canonicalGeometry, {
        courseId: targetRace && targetDistanceId ? `${targetRace.id}_${targetDistanceId}` : selectedPresetId || 'draft',
      }),
    [processedRoute.canonicalGeometry, targetRace, targetDistanceId, selectedPresetId],
  );

  const legacyRaces = allRaces.filter((r) => Boolean(r.routeGpxUrl || r.routeMapUrl));
  const raceStarted = Boolean(
    targetRace?.gunStartTime ||
      targetRace?.completedAt ||
      (targetRace?.waveStartTimes && Object.keys(targetRace.waveStartTimes).length > 0),
  );
  const selectedDistanceObj = targetRace?.distances.find((d) => d.id === targetDistanceId);
  const activeBoundPreset = currentBinding ? store.presets[currentBinding.presetId] : undefined;
  const distLabel = selectedDistanceObj?.label || targetDistanceId || 'Distance';
  const isEditingActiveConfig = Boolean(
    currentPublication?.status === 'published' &&
      currentBinding &&
      activePreset &&
      activePreset.id === currentBinding.presetId,
  );

  const buildDistanceOptions = (useAdvertisedLabel = false) => {
    if (!targetRace) return [];
    return targetRace.distances.map((d) => {
      const binding = store.bindings[`${targetRace.id}_${d.id}`];
      const pub = binding?.currentPublicationId
        ? store.publications[binding.currentPublicationId]
        : undefined;
      const presetTitle = binding?.presetId ? store.presets[binding.presetId]?.title : undefined;
      const label = useAdvertisedLabel
        ? `${d.label} (Advertised ${d.km} km)`
        : `${d.label} (${d.km} km)`;
      if (pub?.status === 'published') {
        return {
          value: d.id,
          label,
          sublabel: `Active: ${presetTitle || 'Published course'} · v${pub.versionNumber}`,
          badge: 'Active',
          badgeTone: 'success' as const,
          accentDot: '#10b981',
        };
      }
      if (pub?.status === 'withdrawn') {
        return {
          value: d.id,
          label,
          sublabel: `Withdrawn · v${pub.versionNumber}`,
          badge: 'Withdrawn',
          badgeTone: 'warning' as const,
          accentDot: '#f59e0b',
        };
      }
      return {
        value: d.id,
        label,
        sublabel: 'No active configuration',
      };
    });
  };

  const latestGpsFix = gpsState.lastFix ?? (
    gpsState.acceptedPoints.length > 0
      ? {
          latitude: gpsState.acceptedPoints[gpsState.acceptedPoints.length - 1].lat,
          longitude: gpsState.acceptedPoints[gpsState.acceptedPoints.length - 1].lon,
          accuracyM: gpsState.acceptedPoints[gpsState.acceptedPoints.length - 1].accuracyM,
          headingDeg: undefined as number | undefined,
        }
      : null
  );

  if (allRaces.length === 0 || !targetRace) {
    return (
      <section className="m-auto max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 space-y-3">
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
          Route Studio
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Create an existing race first in Race Setup before drawing courses, recording GPS surveys, or publishing maps. Every course preset stays linked directly to a real race and distance category.
        </p>
        <div className="pt-1">
          <a
            href="/?tab=race"
            onClick={(e) => {
              if (onNavigateUrl) {
                e.preventDefault();
                onNavigateUrl('/?tab=race');
              }
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
          >
            Open Race Setup
          </a>
        </div>
      </section>
    );
  }

  const maxGradePct = processedRoute.canonicalGeometry.isCanvasCleared
    ? 0
    : processedRoute.points.reduce((m, pt) => Math.max(m, Math.abs(pt.gradePct ?? 0)), 0);
  const startDotVisible =
    !geometry.isStartPointRemoved &&
    !(geometry.isCanvasCleared && geometry.segments.length === 0);
  const isPanCurrentlyLocked = mapPanLocked || (drawMode !== 'view' && drawMode !== 'set-start');

  const studioContextualBar = (
    <div className="shrink-0 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
        <span className="font-semibold text-[var(--text-primary)]">
          {isCanvasEmpty
            ? '0.00 km (Empty)'
            : processedRoute.canonicalGeometry.isCanvasCleared
              ? '0.00 km (Start placed)'
              : `${processedRoute.distanceKm.toFixed(2)} km`}
        </span>
        <span className="text-[var(--text-secondary)]">
          +{Math.round(processedRoute.elevationGainM)}m / -{Math.round(processedRoute.elevationLossM)}m
        </span>
        <span className="hidden sm:inline text-[var(--text-secondary)]">
          Max {maxGradePct.toFixed(1)}% · {processedRoute.validationReport.pointCount} pts · {markers.length} CPs
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {drawMode === 'erase' && (
          <div className="flex items-center gap-1" role="group" aria-label="Eraser radius presets">
            {[15, 25, 50, 100].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setEraseRadiusM(r)}
                className={`min-h-8 rounded-lg border px-2 font-mono font-semibold ${
                  eraseRadiusM === r
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                }`}
              >
                {r}m
              </button>
            ))}
          </div>
        )}

        {(drawMode === 'paint' || drawMode === 'draw') && (
          <div className="flex items-center gap-1" role="group" aria-label="Paint step presets">
            {[5, 12, 25].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPaintSpacingM(s)}
                className={`min-h-8 rounded-lg border px-2 font-mono font-semibold ${
                  paintSpacingM === s
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                }`}
              >
                {s}m
              </button>
            ))}
            <span className="hidden xl:inline rounded-lg bg-[var(--surface-inset)] px-2 py-1 text-[var(--text-secondary)]">
              {SURFACE_LABELS[activeSurfaceType]}
            </span>
          </div>
        )}

        {(drawMode === 'set-start' || geometry.isCanvasCleared) && startDotVisible && (
          <button
            type="button"
            onClick={handleRemoveStartPoint}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2 font-semibold text-red-700 hover:bg-red-500/20 dark:text-red-300"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Remove start dot
          </button>
        )}

        <div className="inline-flex items-center">
          <label htmlFor="route-studio-color-mode" className="sr-only">
            Map color layer
          </label>
          <Select
            id="route-studio-color-mode"
            aria-label="Map color layer"
            value={colorMode}
            onChange={(val) => setColorMode(val as MapColorMode)}
            surface="inset"
            size="sm"
            className="w-auto min-w-[126px]"
            triggerClassName="min-h-8 rounded-lg text-xs"
            options={[
              { value: 'default', label: 'Standard Route' },
              { value: 'gradient', label: 'Slope Heatmap' },
              { value: 'surface', label: 'Surface & Terrain' },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          aria-label="Undo course edit"
          title="Undo (Ctrl+Z)"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden xl:inline">Undo</span>
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          aria-label="Redo course edit"
          title="Redo (Ctrl+Y)"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold disabled:opacity-40"
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden xl:inline">Redo</span>
        </button>
        <button
          type="button"
          disabled={!hasRoutePath}
          onClick={handleReverseCourse}
          title="Reverse direction"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold hover:border-red-600/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden xl:inline">Reverse</span>
        </button>
        <button
          type="button"
          aria-pressed={isPanCurrentlyLocked}
          onClick={() => setMapPanLocked((v) => !v)}
          className="hidden sm:inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
        >
          {isPanCurrentlyLocked ? (
            <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          ) : (
            <Unlock className="h-3 w-3" aria-hidden="true" />
          )}
          {isPanCurrentlyLocked ? 'Pan lock' : 'Pan free'}
        </button>
        {latestGpsFix ? (
          <button
            type="button"
            onClick={handleCenterOnGps}
            aria-label="Center map on live GPS position"
            title={`Center on GPS (${latestGpsFix.latitude.toFixed(5)}, ${latestGpsFix.longitude.toFixed(5)} · ±${Math.round(latestGpsFix.accuracyM)}m)`}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-red-500/50 bg-red-500/10 px-2 font-semibold text-red-700 hover:bg-red-500/20 dark:text-red-300"
          >
            <LocateFixed className="h-3 w-3" aria-hidden="true" />
            <span className="hidden xl:inline">Center GPS</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePinpointMapCenter}
            aria-label="Pinpoint GPS marker at map center"
            title="Set your GPS pinpoint to the center of the current map view"
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
          >
            <MapPin className="h-3 w-3 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span className="hidden xl:inline">Pinpoint Center</span>
          </button>
        )}
      </div>
    </div>
  );

  const activeConfigStatusControl =
    currentPublication?.status === 'published' && currentBinding ? (
      isEditingActiveConfig ? (
        <div
          role="status"
          aria-live="polite"
          className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-emerald-600/35 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/60 dark:text-emerald-300"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Active ({distLabel}): {activeBoundPreset?.title || activePreset?.title || 'Published course'} · v
            {currentPublication.versionNumber}
            {dirty ? ' · Unsaved edits' : ''}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSelectedPresetId(currentBinding.presetId)}
          title="Switch editor to the active published configuration"
          className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-400/40 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/80"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Active ({distLabel}): {activeBoundPreset?.title || 'Published course'} · v
            {currentPublication.versionNumber}
          </span>
          <span className="shrink-0 underline underline-offset-2">View active</span>
        </button>
      )
    ) : currentPublication?.status === 'withdrawn' ? (
      <button
        type="button"
        onClick={() => setActiveTab('publish')}
        className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-amber-600/35 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950/80"
      >
        <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {distLabel} withdrawn · v{currentPublication.versionNumber}
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setActiveTab('publish')}
        className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-red-600/50 hover:text-[var(--text-primary)]"
      >
        <span className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" aria-hidden="true" />
        <span className="truncate">
          No active configuration for {distLabel}
        </span>
      </button>
    );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--surface-page)]">
      {/* Portal concise Route Studio context into App.tsx header when rendered standalone */}
      {onBackHome &&
        headerCtx?.leftSlotEl &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm sm:text-base font-semibold tracking-tight text-white">
              Route Studio
            </h1>
            <span className="hidden md:inline truncate text-xs text-zinc-300">
              {targetRace.name}
            </span>
          </div>,
          headerCtx.leftSlotEl,
        )}

      {onBackHome &&
        headerCtx?.rightSlotEl &&
        onNavigateUrl &&
        createPortal(
          <a
            href="/routes"
            onClick={(e) => {
              e.preventDefault();
              onNavigateUrl('/routes');
            }}
            className="inline-flex min-h-9 items-center rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white hover:border-red-400/60"
          >
            Public Explorer
          </a>,
          headerCtx.rightSlotEl,
        )}

      {/* Compact Top Studio Command Bar & Slim Section Tabs */}
      <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-1.5 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {!onBackHome && (
              <h1 className="mr-1 text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                Route Studio
              </h1>
            )}
            <div className="inline-flex items-center">
              <label htmlFor="route-studio-race-select" className="sr-only">
                Select existing race
              </label>
              <Select
                id="route-studio-race-select"
                aria-label="Select existing race"
                value={targetRace.id}
                onChange={setTargetRaceId}
                searchable={allRaces.length >= 6}
                searchPlaceholder="Filter existing races..."
                surface="inset"
                size="sm"
                className="w-auto min-w-[150px] sm:min-w-[180px]"
                triggerClassName="min-h-9 text-xs"
                options={allRaces.map((r) => ({
                  value: r.id,
                  label: `${r.name} (${r.date})`,
                }))}
              />
            </div>
            <div className="inline-flex items-center">
              <label htmlFor="route-studio-distance-select" className="sr-only">
                Select race distance
              </label>
              <Select
                id="route-studio-distance-select"
                aria-label="Select race distance"
                value={targetDistanceId}
                onChange={setTargetDistanceId}
                surface="inset"
                size="sm"
                className="w-auto min-w-[115px]"
                minMenuWidth={240}
                triggerClassName="min-h-9 text-xs"
                options={buildDistanceOptions(false)}
              />
            </div>
            <div className="inline-flex items-center max-w-full">
              <label htmlFor="route-studio-preset-select" className="sr-only">
                Select route preset
              </label>
              <Select
                id="route-studio-preset-select"
                aria-label="Select route preset"
                value={selectedPresetId}
                onChange={(val) => {
                  if (!val) {
                    resetWorkspaceToEmpty();
                  } else {
                    setSelectedPresetId(val);
                  }
                }}
                searchable={presetList.length >= 6}
                searchPlaceholder="Filter route presets..."
                surface="inset"
                size="sm"
                className="w-auto min-w-[190px] max-w-[300px]"
                minMenuWidth={320}
                triggerClassName="min-h-9 text-xs"
                options={[
                  ...(!selectedPresetId || presetList.length === 0
                    ? [
                        {
                          value: '',
                          label: 'Unconfigured (Empty)',
                          sublabel: 'No route configuration selected',
                          badge: 'Not active',
                          badgeTone: 'neutral' as const,
                        },
                      ]
                    : []),
                  ...presetList.map((p) => {
                    const cfg = describePresetConfigStatus(p, store, targetRace.id, targetDistanceId);
                    return {
                      value: p.id,
                      label: p.title,
                      sublabel: cfg.sublabel,
                      badge: cfg.badge,
                      badgeTone: cfg.badgeTone,
                      accentDot: cfg.accentDot,
                    };
                  }),
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              hidden={!canCreateRoute}
              onClick={handleNewPreset}
              title="New variant"
              className="hidden md:inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New
            </button>
            <button
              type="button"
              hidden={!canCreateRoute}
              disabled={!activePreset}
              onClick={handleDuplicatePreset}
              title="Duplicate"
              className="hidden md:inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Dup
            </button>
            {activePreset && (
              <button
                type="button"
                hidden={!canArchiveRoute}
                onClick={() =>
                  archivePresetCommand({
                    actorUid: profile.uid,
                    actorName: profile.displayName || profile.email,
                    presetId: activePreset.id,
                    archived: !activePreset.archived,
                  })
                }
                title={activePreset.archived ? 'Restore' : 'Archive'}
                className="hidden xl:inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                {activePreset.archived ? 'Restore' : 'Archive'}
              </button>
            )}
            <button
              type="button"
              disabled={!canEditRoute}
              onClick={handleSaveDraft}
              className="hidden sm:inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save {dirty ? '*' : ''}
            </button>
            <button
              type="button"
              disabled={!canPublishRoute || !canAssignRoute}
              onClick={handleQuickAttachAndPublish}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden="true" />
              Attach &amp; Publish
            </button>
          </div>
        </div>

        {/* Desktop Slim Section Tabs Bar & Persistent Active Configuration Bar */}
        <div className="hidden lg:flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-1.5">
          <div
            role="tablist"
            aria-label="Route Studio sections"
            className="flex items-center gap-1.5 overflow-x-auto"
          >
            {(
              [
                ['course', 'Course, GPS & Paint', Layers],
                ['markers', 'Checkpoints', MapPin],
                ['photos', 'Photo Landmarks', Camera],
                ['analytics', 'Race Intelligence', Activity],
                ['versions', 'Versions', History],
                ['publish', 'Publish & Bind', Flag],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  activeTab === id
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="shrink-0 min-w-0 max-w-[340px]">
            {activeConfigStatusControl}
          </div>
        </div>
        <div className="flex lg:hidden items-center justify-between gap-2 border-t border-[var(--border-default)] pt-1.5">
          {activeConfigStatusControl}
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          className="shrink-0 mx-2 mt-1.5 flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{statusNotice}</span>
        </div>
      )}

      {errorNotice && (
        <div
          role="alert"
          className="shrink-0 mx-2 mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {errorNotice}
          </span>
          <button
            type="button"
            onClick={handleReloadLatestDraft}
            className="min-h-8 rounded-lg border border-red-500/40 px-2.5 font-semibold hover:bg-red-500/10"
          >
            Reload latest draft
          </button>
        </div>
      )}

      {/* Synchronized Workspace visible in Course, Checkpoints, Photos, Intelligence tabs */}
      {activeTab !== 'versions' && activeTab !== 'publish' && selection && (
        <div className="flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-[minmax(0,64%)_36%] lg:overflow-hidden">
          <div className="flex flex-1 min-h-0 flex-col gap-1.5 p-2 lg:overflow-hidden">
            {studioContextualBar}

            <div className="flex flex-1 min-h-0 flex-col gap-1.5 sm:flex-row">
              {/* Vertical Quick Trail Tool Rail */}
              <aside
                aria-label="Quick trail tool dock"
                className="flex flex-row sm:w-12 shrink-0 items-center justify-start gap-1 overflow-x-auto sm:flex-col sm:overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-1"
              >
                {(
                  [
                    ['view', Hand, 'Inspect (V)'],
                    ['set-start', Crosshair, 'Start Point (S)'],
                    ['paint', Paintbrush, 'Paint Trail (B)'],
                    ['draw', PenTool, 'Draw Points (P)'],
                    ['erase', Eraser, 'Erase (E)'],
                    ['edit', SlidersHorizontal, 'Edit Vertices (A)'],
                    ['place-marker', MapPin, 'Place Marker (M)'],
                  ] as const
                ).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`Tool shortcut: ${label}`}
                    title={label}
                    aria-pressed={drawMode === mode}
                    onClick={() => {
                      setDrawMode(mode);
                      if (mode === 'paint' || mode === 'draw' || mode === 'erase') {
                        setTrailOption('draw');
                      }
                    }}
                    className={`flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                      drawMode === mode
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Tool shortcut: Center map on GPS"
                  title={latestGpsFix ? `Center on GPS (${latestGpsFix.latitude.toFixed(5)}, ${latestGpsFix.longitude.toFixed(5)})` : 'Center on GPS (Start GPS first)'}
                  onClick={handleCenterOnGps}
                  className={`flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                    latestGpsFix
                      ? 'border-red-600 bg-red-700 text-white hover:bg-red-600'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  <LocateFixed className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="hidden sm:block my-0.5 h-px w-7 bg-[var(--border-default)]" />
                <button
                  type="button"
                  aria-label="Tool shortcut: Clear canvas"
                  title="Clear course canvas"
                  disabled={isCanvasEmpty && markers.length === 0 && Boolean(geometry.isStartPointRemoved)}
                  onClick={handleClearCanvas}
                  className="flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-red-700 hover:border-red-600/50 dark:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Tool shortcut: Fullscreen editor"
                  title="Fullscreen editor (F)"
                  onClick={() => setStudioFullscreen((v) => !v)}
                  className="flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50"
                >
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </aside>

              <div className="relative min-w-0 flex-1 min-h-[240px]">
                <div className="absolute inset-0">
                  <RouteMapCanvas
                  route={processedRoute}
                  routeIdentityKey={`${targetRace.id}:${targetDistanceId}:${selectedPresetId || 'empty'}:${importFitNonce}`}
                  markers={markers}
                  selection={selection}
                  selectedMarkerId={selectedMarkerId}
                  theme={detectedTheme}
                  colorMode={colorMode}
                  editable
                  drawMode={drawMode}
                  eraseRadiusM={eraseRadiusM}
                  paintSpacingM={paintSpacingM}
                  mapPanLocked={mapPanLocked}
                  cursorVisible={startDotVisible}
                  isFullscreen={studioFullscreen}
                  onToggleFullscreen={() => setStudioFullscreen((v) => !v)}
                  studioOverlaySlot={studioContextualBar}
                  hideHud
                  flyToTrigger={flyToTrigger}
                  locateStatus={gpsState.status === 'tracking' ? 'active' : 'idle'}
                  onLocateMe={handleStartGpsTracking}
                  onCenterOnUser={handleCenterOnGps}
                  onCameraMove={(lat, lon) => {
                    currentMapCenterRef.current = { lat, lon };
                  }}
                  gpsLivePosition={
                    latestGpsFix
                      ? {
                          lat: latestGpsFix.latitude,
                          lon: latestGpsFix.longitude,
                          accuracyM: latestGpsFix.accuracyM,
                          headingDeg: latestGpsFix.headingDeg ?? null,
                        }
                      : null
                  }
                  gpsBreadcrumbPoints={gpsState.acceptedPoints.map((pt) => ({
                    lat: pt.lat,
                    lon: pt.lon,
                  }))}
                  heightClassName="h-full"
                  onSelectChainage={handleSelectChainageWithCursor}
                  onSelectMarker={(m) => {
                    setSelectedMarkerId(m.id);
                    handleSelectChainageWithCursor(m.chainageM, m.passNumber);
                  }}
                  onMapClickCoordinate={(lat, lon, proj) => {
                    if (drawMode === 'place-marker') {
                      handleAddMarkerAtSelection(lat, lon, activeTab === 'photos' ? 'landmark' : 'aid');
                    } else if (trailOption === 'gps' && gpsState.status === 'tracking') {
                      handleSetGpsLocation(lat, lon);
                    } else if (hasRoutePath) {
                      handleSelectChainageWithCursor(proj.chainageM, proj.passNumber);
                    }
                  }}
                  onPlaceStartPoint={handlePlaceStartPoint}
                  onRemoveStartPoint={handleRemoveStartPoint}
                  onRequestStartPointMode={() => setDrawMode('set-start')}
                  onPaintStrokeCommit={handlePaintStrokeCommit}
                  onEraseAtCoordinate={handleEraseAtCoordinate}
                  onDrawnSegmentsChange={(drawnSegs) => {
                    const keepSegs = geometry.segments.filter(
                      (s) => s.sourceKind === 'gpx' || s.sourceKind === 'gps-tracked',
                    );
                    const elevatedDrawnSegs = densifyAndElevateDrawnSegments(drawnSegs);
                    const nextSegments = [...keepSegs, ...elevatedDrawnSegs];
                    if (nextSegments.length === 0) return;
                    const hasMultiple = new Set(nextSegments.map((s) => s.sourceKind)).size > 1;
                    const nextGeom: CanonicalRouteGeometry = {
                      version: 1,
                      sourceKind: hasMultiple ? 'mixed' : 'drawn',
                      segments: nextSegments,
                    };
                    const reprocessed = processCanonicalGeometry(nextGeom);
                    pushHistory(nextGeom, reanchorMarkersForRoute(reprocessed, markers));
                  }}
                />
                </div>
              </div>
            </div>

            <div className="hidden sm:block shrink-0">
              <RouteElevationProfile
                route={processedRoute}
                selectedChainageM={selection.chainageM}
                onSelectChainage={handleSelectChainageWithCursor}
                markers={markers}
                selectedMarkerId={selectedMarkerId}
                onSelectMarker={(m) => setSelectedMarkerId(m.id)}
                compact
              />
            </div>
          </div>

          {/* Right Inspector Rail (Desktop docked side pane; Mobile overlay sheet when toggled) */}
          <aside
            aria-label="Route Studio inspector"
            className={
              mobileInspectorOpen
                ? 'fixed inset-0 z-50 flex flex-col bg-[var(--surface-card)] p-3 lg:static lg:inset-auto lg:z-auto lg:min-h-0 lg:border-l lg:border-[var(--border-default)] lg:p-0'
                : 'hidden lg:flex lg:min-h-0 lg:flex-col lg:border-l lg:border-[var(--border-default)] lg:bg-[var(--surface-card)]'
            }
          >
            <div className="lg:hidden shrink-0 mb-2 space-y-2 border-b border-[var(--border-default)] pb-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Studio Inspector
                </h2>
                <button
                  type="button"
                  onClick={() => setMobileInspectorOpen(false)}
                  aria-label="Close studio inspector"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Mobile studio tabs">
                {(
                  [
                    ['course', 'Course & GPS'],
                    ['markers', 'Checkpoints'],
                    ['photos', 'Photos'],
                    ['analytics', 'Intel'],
                    ['versions', 'Versions'],
                    ['publish', 'Publish'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    onClick={() => {
                      setActiveTab(id);
                      if (id === 'versions' || id === 'publish') {
                        setMobileInspectorOpen(false);
                      }
                    }}
                    className={`min-h-10 rounded-lg border px-2.5 text-xs font-semibold ${
                      activeTab === id
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 420px' }}
            >
            {activeTab === 'course' && (
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3.5 space-y-3">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                  Course Import, Drawing & Validation
                </h2>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Course title
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value);
                        setDirty(true);
                      }}
                      placeholder={`${targetRace.name} (${selectedDistanceObj?.label || targetDistanceId || 'Course'})`}
                      className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Region
                    <input
                      type="text"
                      value={draftRegion}
                      onChange={(e) => {
                        setDraftRegion(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="e.g., Luzon, Visayas, or Mindanao"
                      className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                    />
                  </label>
                </div>

                {/* GPX Import */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    Import GPX Track or Route (max 8 MB, 100,000 points)
                  </p>
                  <input
                    ref={gpxInputRef}
                    type="file"
                    accept=".gpx,application/gpx+xml,application/xml,text/xml"
                    onChange={(e) => void handleGpxFileChange(e)}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => gpxInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Upload GPX file
                    </button>
                    {demoMode && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void handleLoadFixture(
                              '/fixtures/baguio-cordillera-21k.gpx',
                              'baguio-cordillera-21k.gpx',
                            )
                          }
                          className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Load Baguio 21K GPX
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleLoadFixture(
                              '/fixtures/baguio-cordillera-10k.gpx',
                              'baguio-cordillera-10k.gpx',
                            )
                          }
                          className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Load Baguio 10K GPX
                        </button>
                      </>
                    )}
                  </div>
                  {rawGpxText && processedRoute.validationReport.tracks.length > 1 && (
                    <div className="pt-2 space-y-1">
                      <p className="text-xs font-semibold text-[var(--text-secondary)]">
                        Select included tracks:
                      </p>
                      {processedRoute.validationReport.tracks.map((trk) => {
                        const checked = selectedTracks.includes(trk.index);
                        return (
                          <label key={trk.index} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...selectedTracks, trk.index]
                                  : selectedTracks.filter((i) => i !== trk.index);
                                if (next.length > 0) handleImportGpxText(rawGpxText, sourceFileName, next);
                              }}
                            />
                            {trk.name} ({(trk.distanceM / 1000).toFixed(2)} km, {trk.pointCount} pts)
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Dual Trail Editing Mode Selector: Option 1 (GPS Tracking) vs Option 2 (Paintbrush & Terrain) */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Trail editing options">
                    <button
                      type="button"
                      aria-pressed={trailOption === 'gps'}
                      onClick={() => setTrailOption('gps')}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                        trailOption === 'gps'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
                      }`}
                    >
                      <Navigation className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Option 1: GPS Trail Tracking
                    </button>
                    <button
                      type="button"
                      aria-pressed={trailOption === 'draw'}
                      onClick={() => setTrailOption('draw')}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                        trailOption === 'draw'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
                      }`}
                    >
                      <Paintbrush className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Option 2: Paintbrush & Terrain
                    </button>
                  </div>

                  {trailOption === 'gps' && (
                    <div className="space-y-3 border-t border-[var(--border-default)] pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">
                          Accuracy-Gated Field GPS Tracking
                        </p>
                        <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 text-xs font-mono text-[var(--text-secondary)]">
                          {gpsState.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                          <label htmlFor="route-studio-gps-accuracy" className="block text-xs text-[var(--text-secondary)]">
                            Accuracy gate
                          </label>
                          <Select
                            id="route-studio-gps-accuracy"
                            aria-label="GPS accuracy gate"
                            value={String(gpsState.maxAccuracyM)}
                            onChange={(val) => {
                              const gate = Number(val);
                              setGpsState((prev) => ({ ...prev, maxAccuracyM: gate }));
                            }}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={[
                              { value: '10', label: '10 m (Open Sky)' },
                              { value: '25', label: '25 m (Trail Standard)' },
                              { value: '50', label: '50 m (Heavy Canopy)' },
                            ]}
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="route-studio-gps-surface" className="block text-xs text-[var(--text-secondary)]">
                            Recorded surface
                          </label>
                          <Select
                            id="route-studio-gps-surface"
                            aria-label="GPS recorded surface"
                            value={activeSurfaceType}
                            onChange={(val) => setActiveSurfaceType(val as RouteSurfaceType)}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={Object.entries(SURFACE_LABELS).map(([k, label]) => ({
                              value: k,
                              label,
                            }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="route-studio-gps-scenario" className="block text-xs text-[var(--text-secondary)]">
                            Field scenario
                          </label>
                          <Select
                            id="route-studio-gps-scenario"
                            aria-label="GPS field scenario"
                            value={activeTerrainScenario}
                            onChange={(val) => setActiveTerrainScenario(val as TerrainScenarioTag)}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={Object.entries(TERRAIN_SCENARIO_LABELS).map(([k, label]) => ({
                              value: k,
                              label,
                            }))}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {gpsState.status !== 'tracking' ? (
                          <button
                            type="button"
                            onClick={handleStartGpsTracking}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                          >
                            <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            Start GPS tracking
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleStopGpsTracking}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-amber-500/60 bg-amber-500/15 px-3 text-xs font-semibold text-amber-800 dark:text-amber-300"
                          >
                            <Square className="h-3.5 w-3.5" aria-hidden="true" />
                            Pause GPS
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleCenterOnGps}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                          title={latestGpsFix ? `Center map on your GPS coordinates (${latestGpsFix.latitude.toFixed(5)}, ${latestGpsFix.longitude.toFixed(5)})` : 'Center map on GPS location'}
                        >
                          <LocateFixed className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                          Center on GPS
                        </button>
                        <button
                          type="button"
                          onClick={handlePinpointMapCenter}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                          title="Pinpoint your live spot at the current center of the map"
                        >
                          <MapPin className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                          Pinpoint Map Center
                        </button>
                        <button
                          type="button"
                          onClick={handleSimulateGpsWalk}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                          Simulate GPS walk
                        </button>
                        <button
                          type="button"
                          onClick={handleDropMarkerAtGps}
                          disabled={gpsState.acceptedPoints.length === 0}
                          className="min-h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-45"
                        >
                          Drop marker at GPS
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCommitGpsTrack(false)}
                          disabled={gpsState.acceptedPoints.length < 2}
                          className="min-h-10 rounded-xl border border-emerald-600/50 bg-emerald-600/10 px-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300 disabled:opacity-45"
                        >
                          Commit GPS track
                        </button>
                      </div>

                      {gpsError && (
                        <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">{gpsError}</p>
                      )}

                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 text-xs tabular-nums">
                        <div>
                          <span className="text-[var(--text-secondary)]">Accepted fixes</span>
                          <p className="font-semibold text-[var(--text-primary)]">
                            {gpsState.acceptedPoints.length} ({(gpsState.totalDistanceM / 1000).toFixed(2)} km)
                          </p>
                        </div>
                        <div>
                          <span className="text-[var(--text-secondary)]">Rejected outliers / gain</span>
                          <p className="font-semibold text-[var(--text-primary)]">
                            {gpsState.rejectedCount} rejected (+{gpsState.estimatedGainM.toFixed(0)} m)
                          </p>
                        </div>
                        {gpsState.lastFix && (
                          <p className="col-span-2 text-[var(--text-secondary)] font-mono">
                            Latest GNSS: {gpsState.lastFix.latitude.toFixed(5)}, {gpsState.lastFix.longitude.toFixed(5)} (±{Math.round(gpsState.lastFix.accuracyM)} m)
                          </p>
                        )}
                        {gpsState.lastRejectReason && (
                          <p className="col-span-2 text-amber-700 dark:text-amber-300">
                            Last filter event: {gpsState.lastRejectReason}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {trailOption === 'draw' && (
                    <div className="space-y-3 border-t border-[var(--border-default)] pt-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label htmlFor="route-studio-brush-spacing" className="block text-xs text-[var(--text-secondary)]">
                            Brush smoothing step
                          </label>
                          <Select
                            id="route-studio-brush-spacing"
                            aria-label="Paintbrush spacing"
                            value={String(paintSpacingM)}
                            onChange={(val) => setPaintSpacingM(Number(val))}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={[
                              { value: '5', label: '5 m (Technical Detail)' },
                              { value: '12', label: '12 m (Balanced Trail)' },
                              { value: '25', label: '25 m (Fast Sweep)' },
                            ]}
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="route-studio-eraser-radius" className="block text-xs text-[var(--text-secondary)]">
                            Eraser radius
                          </label>
                          <Select
                            id="route-studio-eraser-radius"
                            aria-label="Eraser brush radius"
                            value={String(eraseRadiusM)}
                            onChange={(val) => setEraseRadiusM(Number(val))}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={[
                              { value: '15', label: '15 m fine eraser' },
                              { value: '25', label: '25 m radius' },
                              { value: '50', label: '50 m radius' },
                              { value: '100', label: '100 m radius' },
                            ]}
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="route-studio-brush-surface" className="block text-xs text-[var(--text-secondary)]">
                            Active surface type
                          </label>
                          <Select
                            id="route-studio-brush-surface"
                            aria-label="Brush surface type"
                            value={activeSurfaceType}
                            onChange={(val) => setActiveSurfaceType(val as RouteSurfaceType)}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={Object.entries(SURFACE_LABELS).map(([k, label]) => ({
                              value: k,
                              label,
                            }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="route-studio-brush-scenario" className="block text-xs text-[var(--text-secondary)]">
                            Terrain scenario tag
                          </label>
                          <Select
                            id="route-studio-brush-scenario"
                            aria-label="Brush terrain scenario"
                            value={activeTerrainScenario}
                            onChange={(val) => setActiveTerrainScenario(val as TerrainScenarioTag)}
                            surface="card"
                            size="sm"
                            triggerClassName="min-h-10 font-normal"
                            options={Object.entries(TERRAIN_SCENARIO_LABELS).map(([k, label]) => ({
                              value: k,
                              label,
                            }))}
                          />
                        </div>
                      </div>

                      {/* Tag existing km range with surface & scenario */}
                      <div className="grid grid-cols-3 gap-2 items-end rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                        <label className="text-xs text-[var(--text-secondary)]">
                          From km
                          <input
                            type="text"
                            value={rangeFromKm}
                            onChange={(e) => setRangeFromKm(e.target.value)}
                            placeholder="0.0"
                            className="mt-1 min-h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                          />
                        </label>
                        <label className="text-xs text-[var(--text-secondary)]">
                          To km
                          <input
                            type="text"
                            value={rangeToKm}
                            onChange={(e) => setRangeToKm(e.target.value)}
                            placeholder="2.0"
                            className="mt-1 min-h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleApplyTerrainRange}
                          className="min-h-9 rounded-lg bg-red-700 px-2.5 text-xs font-semibold text-white hover:bg-red-600"
                        >
                          Tag range
                        </button>
                      </div>

                      {/* Course Shape & Scenario Utilities */}
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleSampleElevation()}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          <Mountain className="h-3.5 w-3.5" aria-hidden="true" />
                          Fill Elevation (DEM)
                        </button>
                        <button
                          type="button"
                          onClick={handleSmoothTrail}
                          className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Smooth Trail
                        </button>
                        <button
                          type="button"
                          onClick={handleMirrorOutAndBack}
                          className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Out-and-Back Return
                        </button>
                        <button
                          type="button"
                          onClick={handleCloseLoop}
                          className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Close Loop
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateSplitMarkers}
                          className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                        >
                          Auto 1K Markers
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Keyboard / Coordinate Manual Drawing Entry */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    Keyboard Coordinate Entry (manually drawn section)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs text-[var(--text-secondary)]">
                      Latitude
                      <input
                        type="text"
                        value={coordLat}
                        onChange={(e) => setCoordLat(e.target.value)}
                        placeholder="e.g., 14.5995"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      Longitude
                      <input
                        type="text"
                        value={coordLon}
                        onChange={(e) => setCoordLon(e.target.value)}
                        placeholder="e.g., 120.9842"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="text-xs text-[var(--text-secondary)]">
                      Elevation (m)
                      <input
                        type="text"
                        value={coordEle}
                        onChange={(e) => setCoordEle(e.target.value)}
                        placeholder="Optional"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handleAppendManualPoint}
                    className="min-h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                  >
                    Append drawn coordinate
                  </button>
                </div>

                {/* Validation & Provenance Summary */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--text-primary)]">
                      Validation Report
                    </span>
                    <span className="font-mono text-[var(--text-secondary)]">
                      Draft rev {expectedRevision}
                    </span>
                  </div>
                  <p className="text-[var(--text-secondary)]">
                    Distance: <strong className="text-[var(--text-primary)]">{processedRoute.distanceKm.toFixed(2)} km</strong> ·{' '}
                    Segments: <strong className="text-[var(--text-primary)]">{processedRoute.canonicalSegments.length}</strong> ·{' '}
                    Points: <strong className="text-[var(--text-primary)]">{processedRoute.validationReport.pointCount}</strong>
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    {isCanvasEmpty || processedRoute.canonicalGeometry.isCanvasCleared
                      ? 'Elevation: Not calculated yet (draw or import a route)'
                      : `Elevation: ${processedRoute.elevationProvenance.coveragePct}% verified (${
                          processedRoute.elevationProvenance.source === 'gpx'
                            ? 'track elevation'
                            : 'terrain relief'
                        })`}
                  </p>
                  {processedRoute.validationReport.warnings.map((warn, idx) => (
                    <p key={idx} className="text-amber-700 dark:text-amber-300">
                      Notice: {warn}
                    </p>
                  ))}
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <label className="flex-1 text-xs text-[var(--text-secondary)]">
                      Edit summary
                      <input
                        type="text"
                        value={editSummary}
                        onChange={(e) => setEditSummary(e.target.value)}
                        placeholder="Adjusted turnaround coordinates"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'markers' && (
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    Checkpoints & Course Annotations
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleAddMarkerAtSelection()}
                    className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add at cursor
                  </button>
                </div>

                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {markers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMarkerId(m.id);
                        handleSelectChainageWithCursor(m.chainageM, m.passNumber);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs ${
                        selectedMarker?.id === m.id
                          ? 'border-red-600 bg-red-700/10'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)]'
                      }`}
                    >
                      <span className="font-semibold text-[var(--text-primary)]">
                        {m.name} ({m.kind})
                      </span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        {(m.chainageM / 1000).toFixed(2)} km · P{m.passNumber}
                      </span>
                    </button>
                  ))}
                </div>

                {selectedMarker && (
                  <div className="space-y-3 border-t border-[var(--border-default)] pt-3 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="font-semibold text-[var(--text-secondary)]">
                        Marker name
                        <input
                          type="text"
                          value={selectedMarker.name}
                          onChange={(e) => updateSelectedMarker({ name: e.target.value })}
                          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs text-[var(--text-primary)]"
                        />
                      </label>
                      <div className="font-semibold text-[var(--text-secondary)] space-y-1">
                        <label htmlFor="route-marker-kind" className="block">Kind</label>
                        <Select
                          id="route-marker-kind"
                          value={selectedMarker.kind}
                          onChange={(value) => updateSelectedMarker({ kind: value as RouteMarkerKind })}
                          surface="inset"
                          size="sm"
                          triggerClassName="font-normal"
                          options={MARKER_KINDS.map((k) => ({ value: k, label: k }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <label className="font-semibold text-[var(--text-secondary)]">
                        Latitude
                        <input
                          type="number"
                          step="0.0001"
                          value={selectedMarker.latitude}
                          onChange={(e) =>
                            updateSelectedMarker({ latitude: Number(e.target.value) || 0 })
                          }
                          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                        />
                      </label>
                      <label className="font-semibold text-[var(--text-secondary)]">
                        Longitude
                        <input
                          type="number"
                          step="0.0001"
                          value={selectedMarker.longitude}
                          onChange={(e) =>
                            updateSelectedMarker({ longitude: Number(e.target.value) || 0 })
                          }
                          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                        />
                      </label>
                      <label className="font-semibold text-[var(--text-secondary)]">
                        Pass number
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={selectedMarker.passNumber}
                          onChange={(e) =>
                            updateSelectedMarker({
                              passNumber: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                        />
                      </label>
                    </div>

                    <p className="text-[var(--text-secondary)]">
                      Anchored at <strong>{(selectedMarker.chainageM / 1000).toFixed(2)} km</strong> ·
                      Course offset: <strong>{selectedMarker.offsetMeters.toFixed(1)} m</strong>
                      {selectedMarker.needsReview && ' (Exceeds 30 m review threshold)'}
                    </p>

                    {selectedMarker.offsetMeters > 100 && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2">
                        <label className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                          <input
                            type="checkbox"
                            checked={selectedMarker.offCourseConfirmed}
                            onChange={(e) =>
                              updateSelectedMarker({ offCourseConfirmed: e.target.checked })
                            }
                          />
                          Confirm off-course facility ({Math.round(selectedMarker.offsetMeters)} m off line)
                        </label>
                        <input
                          type="text"
                          value={selectedMarker.offCourseInstruction || ''}
                          onChange={(e) =>
                            updateSelectedMarker({ offCourseInstruction: e.target.value })
                          }
                          placeholder="Required access instruction for runners"
                          className="min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="font-semibold text-[var(--text-secondary)] space-y-1">
                        <label htmlFor="route-marker-checkpoint" className="block">Link timing checkpoint</label>
                        <Select
                          id="route-marker-checkpoint"
                          value={selectedMarker.timingCheckpointId || ''}
                          onChange={(value) => updateSelectedMarker({ timingCheckpointId: value || undefined })}
                          surface="inset"
                          size="sm"
                          triggerClassName="font-normal"
                          options={[
                            { value: '', label: 'Informational only' },
                            ...targetRace.checkpoints.map((cp) => ({
                              value: cp.id,
                              label: `#${cp.order + 1} ${cp.label}`,
                            })),
                          ]}
                        />
                      </div>
                      <label className="font-semibold text-[var(--text-secondary)]">
                        Cutoff (min from wave)
                        <input
                          type="number"
                          min={0}
                          value={selectedMarker.cutoffMinutes ?? ''}
                          onChange={(e) =>
                            updateSelectedMarker({
                              cutoffMinutes: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          placeholder="Optional"
                          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
                        />
                      </label>
                    </div>

                    <div>
                      <p className="mb-1.5 font-semibold text-[var(--text-secondary)]">
                        Verified station services
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {SERVICE_OPTIONS.map((svc) => {
                          const active = selectedMarker.services.includes(svc);
                          return (
                            <button
                              key={svc}
                              type="button"
                              aria-pressed={active}
                              onClick={() => {
                                const next = active
                                  ? selectedMarker.services.filter((s) => s !== svc)
                                  : [...selectedMarker.services, svc];
                                updateSelectedMarker({ services: next });
                              }}
                              className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold ${
                                active
                                  ? 'border-red-600 bg-red-700 text-white'
                                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                              }`}
                            >
                              {svc}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const filtered = markers.filter((m) => m.id !== selectedMarker.id);
                        pushHistory(geometry, filtered);
                        setSelectedMarkerId(filtered[0]?.id || '');
                      }}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-red-500/40 px-3 text-xs font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove marker
                    </button>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'photos' && (
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                  Photo Landmarks
                </h2>
                {!selectedMarker ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Add or select a course marker first to attach landmark photos.
                  </p>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="space-y-1 font-semibold text-[var(--text-secondary)]">
                      <label htmlFor="route-photo-marker" className="block">Attach to marker</label>
                      <Select
                        id="route-photo-marker"
                        value={selectedMarker.id}
                        onChange={setSelectedMarkerId}
                        searchable={markers.length >= 6}
                        searchPlaceholder="Filter markers..."
                        surface="inset"
                        size="sm"
                        triggerClassName="font-normal"
                        options={markers.map((m) => ({
                          value: m.id,
                          label: `${m.name} (${(m.chainageM / 1000).toFixed(2)} km)`,
                        }))}
                      />
                    </div>

                    <label className="block font-semibold text-[var(--text-secondary)]">
                      Caption (course guidance)
                      <input
                        type="text"
                        value={photoCaption}
                        onChange={(e) => setPhotoCaption(e.target.value)}
                        placeholder="Turn left past the pine ridge gate"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="block font-semibold text-[var(--text-secondary)]">
                      Alternative text (required for accessibility)
                      <input
                        type="text"
                        value={photoAlt}
                        onChange={(e) => setPhotoAlt(e.target.value)}
                        placeholder="Pine-lined road junction with kilometer marker"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="block font-semibold text-[var(--text-secondary)]">
                      Photographer or organization credit
                      <input
                        type="text"
                        value={photoCredit}
                        onChange={(e) => setPhotoCredit(e.target.value)}
                        placeholder="RacePulsePH Survey Team"
                        className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={photoRights}
                        onChange={(e) => setPhotoRights(e.target.checked)}
                      />
                      I confirm we hold publication rights for this landmark photo.
                    </label>

                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => void handleUploadPhoto(e)}
                      className="hidden"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canUploadRouteMedia || photoBusy || selectedMarker.photos.length >= 3}
                        onClick={() => photoInputRef.current?.click()}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        {photoBusy ? 'Processing...' : 'Upload & strip EXIF'}
                      </button>
                      <button
                        type="button"
                        disabled={!canUploadRouteMedia || selectedMarker.photos.length >= 3}
                        onClick={() => void handleAttachVerifiedSamplePhoto()}
                        className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-50"
                      >
                        Create survey marker card
                      </button>
                    </div>

                    {selectedMarker.photos.length > 0 && (
                      <div className="space-y-2 border-t border-[var(--border-default)] pt-3">
                        <p className="font-semibold text-[var(--text-primary)]">
                          Attached photos ({selectedMarker.photos.length}/3)
                        </p>
                        {selectedMarker.photos.map((photo) => (
                          <div
                            key={photo.id}
                            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2"
                          >
                            <img
                              src={photo.thumbnailUrl}
                              alt={photo.altText}
                              width={88}
                              height={50}
                              className="h-12 w-20 rounded-lg object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold text-[var(--text-primary)]">
                                {photo.caption}
                              </p>
                              <p className="truncate text-[var(--text-secondary)]">
                                Credit: {photo.credit} · {photo.width}x{photo.height}
                              </p>
                            </div>
                            <button
                              type="button"
                              aria-label="Remove landmark photo"
                              onClick={() =>
                                updateSelectedMarker({
                                  photos: selectedMarker.photos.filter((p) => p.id !== photo.id),
                                })
                              }
                              className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-red-500/30 text-red-700 dark:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'analytics' && (
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4">
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    Course Metrics & Race-Day Intelligence
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Deterministic climb grading, pack congestion screening, cutoff margin checks, and gear advisories computed from your active course geometry.
                  </p>
                </div>

                {!hasRoutePath ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] p-4 text-xs text-[var(--text-secondary)]">
                    No route configured yet. Paint a trail, draw points, record GPS, or import a GPX file to compute climbs, grade splits, and gear recommendations.
                  </div>
                ) : (
                  <>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2.5">
                    <span className="text-[var(--text-secondary)]">Difficulty Index</span>
                    <p className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                      {analyticsBundle.difficultyIndex}/100
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2.5">
                    <span className="text-[var(--text-secondary)]">Avg GAP Pace (6:00 base)</span>
                    <p className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                      {analyticsBundle.averageGapPaceMinPerKm.toFixed(2)} min/km
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2.5">
                    <span className="text-[var(--text-secondary)]">Categorized Climbs</span>
                    <p className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                      {analyticsBundle.climbs.length}
                    </p>
                  </div>
                </div>

                {/* Categorized Climbs */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    Categorized Climbs
                  </h3>
                  {analyticsBundle.climbs.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      No sustained steep climb meets Category 4 or Punchy thresholds on the current geometry.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {analyticsBundle.climbs.map((climb) => (
                        <div
                          key={climb.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-red-700 dark:text-red-300">
                              {climb.category}
                            </span>{' '}
                            <span className="font-semibold text-[var(--text-primary)]">
                              {climb.title}
                            </span>
                            <p className="text-[var(--text-secondary)]">
                              {(climb.lengthM / 1000).toFixed(2)} km · +{Math.round(climb.gainM)} m · {climb.avgGradePct.toFixed(1)}% avg ({climb.maxGradePct.toFixed(1)}% max)
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectChainageWithCursor(climb.startKm * 1000, 1)}
                            className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                          >
                            Jump to {climb.startKm.toFixed(1)} km
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Surface & Slope Distribution */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-1.5">
                    <p className="font-semibold text-[var(--text-primary)]">Surface Breakdown</p>
                    {analyticsBundle.surfaceBreakdown.map((item) => (
                      <div key={item.surface} className="space-y-0.5">
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>{item.label}</span>
                          <span className="font-mono">{item.pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-card)]">
                          <div className="h-full bg-red-600" style={{ width: `${item.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-1.5">
                    <p className="font-semibold text-[var(--text-primary)]">Slope Grade Zones</p>
                    {analyticsBundle.gradientBreakdown.map((item) => (
                      <div key={item.bucket} className="space-y-0.5">
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>{item.label}</span>
                          <span className="font-mono">{item.pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-card)]">
                          <div className="h-full bg-amber-600" style={{ width: `${item.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pack Bottleneck Screening */}
                <div className="space-y-2 text-xs">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    Pack Bottleneck Hotspots
                  </h3>
                  {analyticsBundle.bottlenecks.length === 0 ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      No early single-file compression zones or sharp pinch hazards flagged.
                    </p>
                  ) : (
                    analyticsBundle.bottlenecks.map((bn) => (
                      <div
                        key={bn.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-amber-800 dark:text-amber-300">
                            {bn.chainageKm.toFixed(1)} km ({bn.severity.toUpperCase()}) : {bn.reason}
                          </p>
                          <p className="text-[var(--text-secondary)]">{bn.advice}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectChainageWithCursor(bn.chainageKm * 1000, 1)}
                          className="min-h-9 rounded-lg border border-amber-600/40 bg-[var(--surface-card)] px-2.5 font-semibold text-[var(--text-primary)]"
                        >
                          Inspect
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Gear & Kit Advisor */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-1.5 text-xs">
                  <p className="font-semibold text-[var(--text-primary)]">
                    Objective Kit & Footwear Brief
                  </p>
                  <p className="text-[var(--text-primary)]">
                    <strong>{analyticsBundle.gear.shoeCategory}</strong> · {analyticsBundle.gear.lugDepthMm} lugs · {analyticsBundle.gear.polesRecommended ? 'Trekking poles recommended' : 'Poles optional'} · Carry at least {analyticsBundle.gear.minimumWaterCarryMl} mL between aid stations
                  </p>
                  {analyticsBundle.gear.reasons.map((reason, idx) => (
                    <p key={idx} className="text-[var(--text-secondary)]">
                      {reason}
                    </p>
                  ))}
                </div>
                  </>
                )}
              </section>
            )}
            </div>
          </aside>
        </div>
      )}

      {(activeTab === 'versions' || activeTab === 'publish') && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
          <div className="flex lg:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('course')}
              className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)]"
            >
              Back to Map &amp; Tools
            </button>
          </div>
      {/* Versions Tab */}
      {activeTab === 'versions' && (
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                Immutable Preset Versions
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Freeze a reviewed draft into an immutable version. Future edits to the draft never alter courses already published to races.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Version review summary"
                className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs text-[var(--text-primary)]"
              />
              <button
                type="button"
                disabled={!canPublishRoute}
                onClick={handleCreateVersion}
                className="min-h-11 rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Create immutable version
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {presetVersions.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No frozen versions yet for this preset. Review the draft and create v1 above.
              </p>
            ) : (
              presetVersions.map((ver) => {
                const usedIn = Object.values(store.bindings).filter((b) => b.versionId === ver.id);
                const liveUsedIn = usedIn.filter(
                  (b) =>
                    Boolean(b.currentPublicationId) &&
                    store.publications[b.currentPublicationId!]?.status === 'published',
                );
                const isActiveForSelectedDist =
                  currentBinding?.versionId === ver.id && currentPublication?.status === 'published';
                return (
                  <div
                    key={ver.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          Version {ver.versionNumber}: {ver.title}
                        </p>
                        {isActiveForSelectedDist && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/35 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/70 dark:text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                            Active on {distLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {(ver.distanceM / 1000).toFixed(2)} km · +{Math.round(ver.elevationGainM)} m · Hash {ver.geometryHash}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Notes: {ver.reviewNotes} ·{' '}
                        {liveUsedIn.length > 0
                          ? `Active on ${liveUsedIn.map((b) => b.distanceLabel).join(', ')}`
                          : usedIn.length > 0
                            ? `Bound (not live): ${usedIn.map((b) => b.distanceLabel).join(', ')}`
                            : 'Not currently bound'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVersionId(ver.id);
                        setActiveTab('publish');
                      }}
                      className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                    >
                      Bind to race distance
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Publish, Race Binding, Freeze & Legacy Migration Tab */}
      {activeTab === 'publish' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 space-y-4">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Race Distance Binding & Publication Review
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="text-xs font-semibold text-[var(--text-secondary)] space-y-1">
                <label htmlFor="route-publish-race" className="block">Target race</label>
                <Select
                  id="route-publish-race"
                  value={targetRace.id}
                  onChange={setTargetRaceId}
                  searchable={allRaces.length >= 6}
                  searchPlaceholder="Filter target races..."
                  surface="inset"
                  size="md"
                  triggerClassName="font-normal"
                  options={allRaces.map((r) => ({
                    value: r.id,
                    label: `${r.name} (${r.date})`,
                  }))}
                />
              </div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] space-y-1">
                <label htmlFor="route-publish-distance" className="block">Distance category</label>
                <Select
                  id="route-publish-distance"
                  value={targetDistanceId}
                  onChange={setTargetDistanceId}
                  surface="inset"
                  size="md"
                  triggerClassName="font-normal"
                  options={buildDistanceOptions(true)}
                />
              </div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] space-y-1">
                <label htmlFor="route-publish-version" className="block">Immutable preset version</label>
                <Select
                  id="route-publish-version"
                  value={selectedVersion?.id || ''}
                  onChange={setSelectedVersionId}
                  surface="inset"
                  size="md"
                  triggerClassName="font-normal"
                  options={
                    presetVersions.length === 0
                      ? [{ value: '', label: 'Create a version first' }]
                      : presetVersions.map((v) => {
                          const isLiveVersion =
                            currentBinding?.versionId === v.id &&
                            currentPublication?.status === 'published';
                          return {
                            value: v.id,
                            label: `v${v.versionNumber} (${(v.distanceM / 1000).toFixed(2)} km measured)`,
                            ...(isLiveVersion
                              ? {
                                  accentDot: '#10b981',
                                  badge: 'Active',
                                  badgeTone: 'success' as const,
                                }
                              : {}),
                          };
                        })
                  }
                />
              </div>
            </div>

            {selectedDistanceObj && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 sm:grid-cols-3 text-xs">
                <div>
                  <p className="text-[var(--text-secondary)]">Advertised category distance</p>
                  <p className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                    {selectedDistanceObj.km} km ({selectedDistanceObj.label})
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)]">
                    {selectedVersion ? 'Measured GPX course distance' : 'Current draft distance'}
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
                    {selectedVersion
                      ? `${(selectedVersion.distanceM / 1000).toFixed(2)} km`
                      : hasRoutePath
                        ? `${(processedRoute.distanceM / 1000).toFixed(2)} km draft`
                        : 'No route yet'}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)]">Active configuration</p>
                  <p
                    className={`mt-0.5 text-base font-semibold ${
                      currentPublication?.status === 'published'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : currentPublication?.status === 'withdrawn'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {currentPublication?.status === 'published'
                      ? `${activeBoundPreset?.title || currentPublication.raceName} · v${currentPublication.versionNumber} (Active)`
                      : currentPublication?.status === 'withdrawn'
                        ? `v${currentPublication.versionNumber} (Withdrawn)`
                        : 'No active configuration'}
                  </p>
                </div>
              </div>
            )}

            {/* Pre-publish validation issues */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2 text-xs">
              <p className="font-semibold text-[var(--text-primary)]">
                Pre-Publish Readiness Checklist
              </p>
              {readiness.issues.length === 0 ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  All geometry, marker anchor, checkpoint order, and landmark photo checks passed.
                </p>
              ) : (
                readiness.issues.map((issue) => (
                  <p
                    key={issue.code}
                    className={
                      issue.severity === 'error'
                        ? 'font-semibold text-red-700 dark:text-red-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }
                  >
                    {issue.severity === 'error' ? 'Blocking: ' : 'Review: '}
                    {issue.message}
                  </p>
                ))
              )}
            </div>

            {/* Automatic Philippines Terrain & Imagery Tile Preparation & Refresh */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">
                    Philippines Terrain & Imagery Pipeline (Auto-Prepared from GPX)
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    {!hasRoutePath
                      ? 'Unconfigured course draft'
                      : `${draftTileManifest.islandGroup} · ${draftTileManifest.province} · ${draftTileManifest.imageryPeriod} · ${RACEPULSE_TERRAIN_LABEL}`}
                  </p>
                </div>
                {hasRoutePath && (
                  <span
                    className={`rounded-lg px-2.5 py-1 font-semibold ${
                      draftTileManifest.validation.passed
                        ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-700/15 text-red-700 dark:text-red-300'
                    }`}
                  >
                    {draftTileManifest.validation.passed ? 'Tiles validated' : 'Tile validation failed'}
                  </span>
                )}
              </div>
              {!hasRoutePath ? (
                <p className="text-[var(--text-secondary)]">
                  No route geometry configured yet. Draw, paint, record GPS, or import a GPX course before preparing imagery and elevation tiles.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <span className="text-[var(--text-secondary)]">Imagery date</span>
                      <p className="font-mono font-semibold text-[var(--text-primary)]">
                        {draftTileManifest.imageryDate}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-secondary)]">Cloud mask fill</span>
                      <p className="font-mono font-semibold text-[var(--text-primary)]">
                        {draftTileManifest.cloudMaskCheck.routeCorridorCloudPct}% via {draftTileManifest.cloudMaskCheck.patchedFromMosaicQuarter}
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-secondary)]">Course detail tiles</span>
                      <p className="font-mono font-semibold text-[var(--text-primary)]">
                        {draftTileManifest.validation.courseDetailTileCount} tiles (z12-16)
                      </p>
                    </div>
                    <div>
                      <span className="text-[var(--text-secondary)]">CDN storage est.</span>
                      <p className="font-mono font-semibold text-[var(--text-primary)]">
                        {((draftTileManifest.validation.estimatedImageryBytes + draftTileManifest.validation.estimatedDemBytes) / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleWeeklyImageryCheck}
                      className="min-h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                    >
                      Run weekly clear-imagery check
                    </button>
                    <button
                      type="button"
                      onClick={handleQuarterlyMosaicRefresh}
                      className="min-h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                    >
                      Refresh quarterly national mosaic
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Race-Day Freeze Guard */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  Race-Day Freeze Status: {raceStarted ? 'Active (timing started)' : 'Unlocked (pre-race)'}
                </span>
                {demoMode && targetRace.id === DEMO_BAGUIO_RACE.id && (
                  <button
                    type="button"
                    onClick={() => setSimulatedRaceFreeze((v) => !v)}
                    className="min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold"
                  >
                    {simulatedRaceFreeze ? 'Clear test freeze' : 'Simulate active gun start'}
                  </button>
                )}
              </div>
              {raceStarted && (
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                    <input
                      type="checkbox"
                      checked={overrideFreeze}
                      onChange={(e) => setOverrideFreeze(e.target.checked)}
                    />
                    Override race-day freeze for emergency course correction (timing records remain unchanged)
                  </label>
                  <input
                    type="text"
                    value={publishReason}
                    onChange={(e) => setPublishReason(e.target.value)}
                    placeholder="Written correction reason (required when overriding freeze)"
                    className="min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs text-[var(--text-primary)]"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canPublishRoute || !canAssignRoute || !selectedVersion || !readiness.ready}
                onClick={handlePublishBinding}
                className="min-h-11 rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                Publish course to {targetDistanceId}
              </button>
              <button
                type="button"
                disabled={!canPublishRoute || !canAssignRoute}
                onClick={handleQuickAttachAndPublish}
                className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 disabled:opacity-50"
              >
                Save, version &amp; attach draft to {targetDistanceId || 'event'}
              </button>
              {currentPublication && onNavigateUrl && (
                <a
                  href={buildRaceCoursePath(targetRace.id, targetDistanceId)}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigateUrl(buildRaceCoursePath(targetRace.id, targetDistanceId));
                  }}
                  className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border-default)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                >
                  Open public course view
                </a>
              )}
            </div>

            {/* Withdraw & Rollback Controls */}
            {currentPublication && (
              <div className="grid grid-cols-1 gap-4 border-t border-[var(--border-default)] pt-4 lg:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 text-xs">
                  <p className="font-semibold text-[var(--text-primary)]">Withdraw current publication</p>
                  <input
                    type="text"
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Reason for withdrawal (e.g., road closure diversion)"
                    className="min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    disabled={!canPublishRoute}
                    onClick={handleWithdrawPublication}
                    className="min-h-10 rounded-xl border border-red-500/40 px-3 font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300 disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    Withdraw published course
                  </button>
                </div>

                <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 text-xs">
                  <p className="font-semibold text-[var(--text-primary)]">Roll back to prior version</p>
                  {priorPublications.length === 0 ? (
                    <p className="text-[var(--text-secondary)]">
                      No earlier publication exists for this distance yet.
                    </p>
                  ) : (
                    priorPublications.slice(0, 3).map((prev) => (
                      <div key={prev.id} className="flex items-center justify-between gap-2">
                        <span>
                          v{prev.versionNumber} ({new Date(prev.publishedAt).toLocaleDateString()})
                        </span>
                        <button
                          type="button"
                          disabled={!canAssignRoute}
                          onClick={() => handleRollback(prev.id)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore v{prev.versionNumber}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Legacy GPX Migration */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Legacy GPX Migration
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Import existing race GPX uploads into Route Studio drafts without breaking legacy course links or duplicating prior imports.
            </p>
            {legacyRaces.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                No legacy GPX uploads detected across your races.
              </p>
            ) : (
              <div className="space-y-2">
                {legacyRaces.map((r) => {
                  const res = migrationResults[r.id];
                  return (
                    <div
                      key={r.id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 sm:flex-row sm:items-center text-xs"
                    >
                      <div className="space-y-1">
                        <p className="font-semibold text-[var(--text-primary)]">{r.name}</p>
                        <p className="text-[var(--text-secondary)]">
                          {r.routeGpxFileName || r.routeMapUrl || 'Legacy route'} · {r.distances.length} distance(s)
                        </p>
                        {res && (
                          <p className="font-semibold text-red-700 dark:text-red-400">
                            {res.status}: {res.message}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.distances.length > 1 && (
                          <Select
                            aria-label={`Select distance for migrating ${r.name}`}
                            value={migrationDistanceByRace[r.id] || ''}
                            onChange={(value) =>
                              setMigrationDistanceByRace((prev) => ({
                                ...prev,
                                [r.id]: value,
                              }))
                            }
                            surface="card"
                            size="sm"
                            className="w-auto min-w-[150px]"
                            triggerClassName="font-normal"
                            options={[
                              { value: '', label: 'Choose category' },
                              ...r.distances.map((d) => ({ value: d.id, label: d.label })),
                            ]}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => void handleMigrateLegacy(r, true)}
                          className="min-h-10 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 font-semibold"
                        >
                          Dry run
                        </button>
                        <button
                          type="button"
                          disabled={!canEditRoute}
                          onClick={() => void handleMigrateLegacy(r, false)}
                          className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-red-700 px-3 font-semibold text-white hover:bg-red-600 disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          Import draft
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Audit History */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Course Audit History
            </h2>
            <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {store.audit.slice(0, 20).map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2"
                >
                  <div>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {ev.action}
                    </span>{' '}
                    <span className="text-[var(--text-secondary)]">
                      by {ev.actorName}
                      {ev.reason ? ` (${ev.reason})` : ''}
                    </span>
                  </div>
                  <span className="font-mono text-[var(--text-secondary)]">
                    {new Date(ev.at).toLocaleString('en-PH')}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
        </div>
      )}

      {/* Mobile Sticky Bottom Thumb-Zone Dock */}
      <div className="lg:hidden shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-3 gap-2">
        {gpsState.status !== 'tracking' ? (
          <button
            type="button"
            onClick={handleStartGpsTracking}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs font-semibold text-[var(--text-primary)]"
          >
            <Play className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span>Track GPS</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopGpsTracking}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/60 bg-amber-500/15 px-2 text-xs font-semibold text-amber-800 dark:text-amber-300"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            <span>Pause GPS</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setMobileInspectorOpen(true)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-red-700 px-2 text-xs font-semibold text-white hover:bg-red-600"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>Inspector</span>
        </button>
        <button
          type="button"
          disabled={!canEditRoute}
          onClick={handleSaveDraft}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs font-semibold text-[var(--text-primary)] disabled:opacity-45"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          <span>Save {dirty ? '*' : ''}</span>
        </button>
      </div>
    </div>
  );
}
