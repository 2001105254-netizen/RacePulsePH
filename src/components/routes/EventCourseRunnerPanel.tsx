import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Flag,
  Gauge,
  Globe,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Mountain,
  X,
} from 'lucide-react';
import { safeExternalUrl } from '../../lib/liveBroadcast';
import { loadGpxRoute, type GpxRoute } from '../../lib/gpxRoute';
import { locateAtChainage } from '../../lib/routes/anchoring';
import { buildCourseAnalytics } from '../../lib/routes/courseAnalytics';
import {
  exportSanitizedGpx,
  processCanonicalGeometry,
  type ProcessedRoute,
} from '../../lib/routes/geometry';
import type { MapThemeMode } from '../../lib/routes/mapProviders';
import {
  ensureDemoCoursesSeeded,
  ensurePilotCoursesSeeded,
  isDemoSeedEnabled,
  subscribeRacePublishedCourses,
} from '../../lib/routes/routeStore';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import { SURFACE_LABELS } from '../../lib/routes/trailTools';
import type {
  PublishedRaceRoute,
  RouteMarker,
  RoutePhotoAsset,
  RouteSelectionState,
} from '../../lib/routes/types';
import {
  computeRunnerLocationRelativeToRoute,
  selectPublishedCourseForDistance,
  useRunnerGeolocation,
} from '../../lib/routes/useRunnerGeolocation';
import type { Race } from '../../types';
import RouteElevationProfile from '../RouteElevationProfile';
import RouteMap3D from '../RouteMap3D';
import DialogSurface from '../ui/DialogSurface';
import RouteMapCanvas, { type MapColorMode } from './RouteMapCanvas';

interface EventCourseRunnerPanelProps {
  race: Race;
  preferredDistance?: string;
  compact?: boolean;
}

type RunnerInspectorTab = 'trailmarks' | 'terrain' | 'pace';

interface SnapshotGalleryEntry {
  marker: RouteMarker;
  photo: RoutePhotoAsset;
  index: number;
}

function useDocumentMapTheme(): MapThemeMode {
  const [theme, setTheme] = useState<MapThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    const sync = () => {
      setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function formatDurationMinutes(totalMin: number): string {
  const rounded = Math.max(1, Math.round(totalMin));
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function formatPaceMinKm(pace: number): string {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  const adjMins = secs === 60 ? mins + 1 : mins;
  const adjSecs = secs === 60 ? 0 : secs;
  return `${adjMins}:${String(adjSecs).padStart(2, '0')} /km`;
}

function formatDistanceOffset(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function surfaceBarColorClass(surface: string): string {
  if (surface === 'paved') return 'bg-zinc-600 dark:bg-zinc-400';
  if (surface === 'dirt') return 'bg-amber-700 dark:bg-amber-500';
  if (surface === 'grass') return 'bg-emerald-600 dark:bg-emerald-400';
  if (surface === 'gravel') return 'bg-amber-600 dark:bg-amber-400';
  if (surface === 'singletrack') return 'bg-green-700 dark:bg-green-500';
  if (surface === 'technical') return 'bg-red-700 dark:bg-red-500';
  return 'bg-sky-600 dark:bg-sky-400';
}

function buildMarkersFromLegacyRace(race: Race, gpxRoute: GpxRoute): RouteMarker[] {
  const sorted = [...(race.checkpoints || [])].sort((a, b) => a.order - b.order);
  if (sorted.length === 0 || gpxRoute.points.length === 0) return [];
  const totalM = Math.max(1, gpxRoute.distanceM);
  return sorted.map((cp, idx) => {
    const ratio = sorted.length > 1 ? idx / (sorted.length - 1) : 0;
    const loc = locateAtChainage(gpxRoute, totalM * ratio, 1);
    const kind =
      idx === 0 ? 'start' : idx === sorted.length - 1 ? 'finish' : 'timing';
    return {
      id: `legacy_${cp.id}`,
      kind,
      name: cp.label,
      description: 'Event checkpoint along legacy GPX track',
      latitude: loc.latitude,
      longitude: loc.longitude,
      chainageM: loc.chainageM,
      segmentIndex: loc.segmentIndex,
      pointIndex: loc.pointIndex,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: cp.id,
      services: [],
      photos: [],
      visibility: 'public',
    };
  });
}

export default function EventCourseRunnerPanel({
  race,
  preferredDistance,
  compact = false,
}: EventCourseRunnerPanelProps) {
  const theme = useDocumentMapTheme();
  const [courses, setCourses] = useState<PublishedRaceRoute[]>([]);
  const [selectedDistanceId, setSelectedDistanceId] = useState<string>('');
  const [legacyGpx, setLegacyGpx] = useState<{
    route: GpxRoute | null;
    loading: boolean;
    error: boolean;
  }>({ route: null, loading: false, error: false });

  const [colorMode, setColorMode] = useState<MapColorMode>('surface');
  const [satelliteEnabled, setSatelliteEnabled] = useState(false);
  const [terrain3DEnabled, setTerrain3DEnabled] = useState(false);
  const [targetPaceMinPerKm, setTargetPaceMinPerKm] = useState<number>(6.0);
  const [selection, setSelection] = useState<RouteSelectionState | null>(null);
  const [activePass, setActivePass] = useState(1);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<RunnerInspectorTab>('trailmarks');
  const [expandOpen, setExpandOpen] = useState(false);
  const [activeSnapshotIndex, setActiveSnapshotIndex] = useState<number | null>(null);
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);

  const geo = useRunnerGeolocation();
  const pendingFlyToUserRef = useRef(false);

  useEffect(() => {
    if (isDemoSeedEnabled()) {
      void ensurePilotCoursesSeeded();
      void ensureDemoCoursesSeeded();
    }
    return subscribeRacePublishedCourses(race.id, setCourses);
  }, [race.id]);

  // Load legacy race GPX cleanly when no Route Studio publication is attached yet
  useEffect(() => {
    if (courses.length > 0 || !race.routeGpxUrl) {
      setLegacyGpx({ route: null, loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    setLegacyGpx({ route: null, loading: true, error: false });
    loadGpxRoute(race.routeGpxUrl, controller.signal)
      .then((parsed) => {
        if (controller.signal.aborted) return;
        setLegacyGpx({ route: parsed, loading: false, error: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLegacyGpx({ route: null, loading: false, error: true });
      });
    return () => controller.abort();
  }, [courses.length, race.routeGpxUrl]);

  useEffect(() => {
    if (courses.length === 0) {
      if (selectedDistanceId) setSelectedDistanceId('');
      return;
    }
    const matched = selectPublishedCourseForDistance(courses, preferredDistance);
    if (preferredDistance && matched) {
      setSelectedDistanceId(matched.distanceId);
      return;
    }
    if (!courses.some((c) => c.distanceId === selectedDistanceId)) {
      setSelectedDistanceId(courses[0].distanceId);
    }
  }, [courses, preferredDistance, selectedDistanceId]);

  const activePub = useMemo<PublishedRaceRoute | null>(
    () => courses.find((c) => c.distanceId === selectedDistanceId) || courses[0] || null,
    [courses, selectedDistanceId],
  );

  const activeRoute = useMemo<ProcessedRoute | null>(() => {
    if (activePub) {
      try {
        return processCanonicalGeometry(activePub.canonicalGeometry, {
          elevationSource: activePub.elevationProvenance?.source,
          verticalDatum: activePub.elevationProvenance?.verticalDatum,
        });
      } catch {
        return null;
      }
    }
    return legacyGpx.route;
  }, [activePub, legacyGpx.route]);

  const activeMarkers = useMemo<RouteMarker[]>(() => {
    if (activePub) return activePub.markers || [];
    if (legacyGpx.route) return buildMarkersFromLegacyRace(race, legacyGpx.route);
    return [];
  }, [activePub, legacyGpx.route, race]);

  const snapshotEntries = useMemo<SnapshotGalleryEntry[]>(() => {
    const items: SnapshotGalleryEntry[] = [];
    const ordered = [...activeMarkers].sort((a, b) => a.chainageM - b.chainageM);
    for (const marker of ordered) {
      for (const photo of marker.photos || []) {
        items.push({ marker, photo, index: items.length });
      }
    }
    return items;
  }, [activeMarkers]);

  useEffect(() => {
    if (!activeRoute) {
      setSelection(null);
      return;
    }
    setActivePass(1);
    setSelectedMarkerId(undefined);
    setSelection(locateAtChainage(activeRoute, 0, 1));
  }, [activeRoute]);

  const analytics = useMemo(() => {
    if (!activeRoute) return null;
    return buildCourseAnalytics(activeRoute, activeMarkers, {
      targetFlatPaceMinPerKm: targetPaceMinPerKm,
      race,
    });
  }, [activeRoute, activeMarkers, targetPaceMinPerKm, race]);

  const terrainSummary = useMemo(() => {
    if (!analytics || !activeRoute) return null;
    let roadPct = 0;
    let offRoadPct = 0;
    for (const item of analytics.surfaceBreakdown) {
      if (item.surface === 'paved' || item.surface === 'boardwalk') {
        roadPct += item.pct;
      } else {
        offRoadPct += item.pct;
      }
    }
    let minEle = Infinity;
    let maxEle = -Infinity;
    let maxGradePct = 0;
    for (const pt of activeRoute.points) {
      const ele = pt.elevation ?? pt.rawElevation;
      if (ele !== undefined && Number.isFinite(ele)) {
        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;
      }
      if (pt.gradePct !== undefined && Number.isFinite(pt.gradePct)) {
        maxGradePct = Math.max(maxGradePct, Math.abs(pt.gradePct));
      }
    }
    return {
      roadPct,
      offRoadPct,
      minEleM: Number.isFinite(minEle) ? Math.round(minEle) : null,
      maxEleM: Number.isFinite(maxEle) ? Math.round(maxEle) : null,
      maxGradePct: Number(maxGradePct.toFixed(1)),
    };
  }, [analytics, activeRoute]);

  const lastGpsChainageRef = useRef<number | undefined>(undefined);

  const locationProjection = useMemo(() => {
    if (!activeRoute || !geo.position) return null;
    return computeRunnerLocationRelativeToRoute(
      activeRoute,
      geo.position.lat,
      geo.position.lon,
      activeMarkers,
      activePass,
      {
        accuracyM: geo.position.accuracyM,
        previousChainageM: lastGpsChainageRef.current,
        headingDeg: geo.position.headingDeg,
      },
    );
  }, [activeRoute, geo.position, activeMarkers, activePass]);

  useEffect(() => {
    if (locationProjection) {
      lastGpsChainageRef.current = locationProjection.chainageM;
    }
  }, [locationProjection]);

  const cursorSurfaceLabel = useMemo(() => {
    if (!activeRoute || !selection) return 'Unknown surface';
    const point =
      activeRoute.canonicalSegments[selection.segmentIndex]?.[selection.pointIndex] ??
      activeRoute.points[0];
    const resolvedSurface =
      point?.surfaceType || (point?.sourceKind === 'drawn' ? 'singletrack' : 'paved');
    return SURFACE_LABELS[resolvedSurface];
  }, [activeRoute, selection]);

  const selectedMarker = useMemo(
    () => activeMarkers.find((m) => m.id === selectedMarkerId) || null,
    [activeMarkers, selectedMarkerId],
  );

  const selectedMarkerElevation = useMemo(() => {
    if (!activeRoute || !selectedMarker) return undefined;
    return locateAtChainage(activeRoute, selectedMarker.chainageM, selectedMarker.passNumber).elevation;
  }, [activeRoute, selectedMarker]);

  const flyCameraTo = (lat: number, lon: number, zoom = 15) => {
    setFlyToTrigger({ lat, lon, zoom, nonce: Date.now() + Math.random() });
  };

  useEffect(() => {
    if (!geo.position) return;
    if (!pendingFlyToUserRef.current && !geo.autoFollow) return;
    pendingFlyToUserRef.current = false;
    flyCameraTo(geo.position.lat, geo.position.lon, 15);
  }, [geo.position, geo.autoFollow]);

  // Keyboard navigation in snapshot lightbox
  useEffect(() => {
    if (activeSnapshotIndex === null || snapshotEntries.length <= 1) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveSnapshotIndex((curr) =>
          curr === null ? null : (curr + 1) % snapshotEntries.length,
        );
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveSnapshotIndex((curr) =>
          curr === null ? null : (curr - 1 + snapshotEntries.length) % snapshotEntries.length,
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSnapshotIndex, snapshotEntries.length]);

  const handleSelectChainage = (chainageM: number, passNumber = activePass) => {
    if (!activeRoute) return;
    setActivePass(passNumber);
    setSelection(locateAtChainage(activeRoute, chainageM, passNumber));
  };

  const handleSelectMarker = (marker: RouteMarker) => {
    setSelectedMarkerId(marker.id);
    handleSelectChainage(marker.chainageM, marker.passNumber || 1);
    flyCameraTo(marker.latitude, marker.longitude, 15);
  };

  const openSnapshotsForMarker = (marker: RouteMarker) => {
    handleSelectMarker(marker);
    const matchIdx = snapshotEntries.findIndex((item) => item.marker.id === marker.id);
    if (matchIdx >= 0) {
      setActiveSnapshotIndex(matchIdx);
    }
  };

  const handleLocateMe = () => {
    pendingFlyToUserRef.current = true;
    geo.startTracking();
  };

  const handleCenterOnUser = () => {
    if (geo.position) {
      geo.setAutoFollow(true);
      flyCameraTo(geo.position.lat, geo.position.lon, 15);
    } else {
      handleLocateMe();
    }
  };

  const handleExportGpx = () => {
    if (!activeRoute) return;
    const title = activePub
      ? `${activePub.raceName} ${activePub.distanceLabel}`
      : `${race.name} Course`;
    const gpx = exportSanitizedGpx(activeRoute.canonicalGeometry, {
      title,
      markers: activeMarkers,
    });
    const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activePub
      ? `${activePub.raceId}-${activePub.distanceId}-v${activePub.versionNumber}.gpx`
      : `${race.id}-course.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Fallback for races with legacy GPX error or external course URL only
  if (!activeRoute || !selection || !analytics || !terrainSummary) {
    if (legacyGpx.loading) {
      return (
        <div
          role="status"
          className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 text-xs text-[var(--text-secondary)]"
        >
          Loading published GPX course map and elevation profile...
        </div>
      );
    }
    if (race.routeGpxUrl && legacyGpx.error) {
      return (
        <div className="space-y-3">
          <RouteMap3D
            gpxUrl={race.routeGpxUrl}
            fileName={race.routeGpxFileName}
            raceName={race.name}
            compact={compact}
            showProfile
          />
        </div>
      );
    }
    const safeMapUrl = safeExternalUrl(race.routeMapUrl);
    if (safeMapUrl) {
      return (
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Organizer Course Map Link
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Open the organizer published course reference in a new window.
            </p>
          </div>
          <a
            href={safeMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-red-700 hover:border-red-600/50 dark:text-red-400"
          >
            <span>Open External Map</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </section>
      );
    }
    return null;
  }

  const courseUrl = activePub
    ? buildRaceCoursePath(activePub.raceId, activePub.distanceId)
    : `/?race=${encodeURIComponent(race.id)}&view=course`;

  const distanceTitle = activePub
    ? `${activePub.distanceLabel} (v${activePub.versionNumber})`
    : preferredDistance || race.routeGpxFileName || 'GPX Course';

  const gpsLivePosition = geo.position
    ? {
        lat: geo.position.lat,
        lon: geo.position.lon,
        accuracyM: geo.position.accuracyM,
        headingDeg: geo.position.headingDeg,
        isStale: geo.position.isStale,
      }
    : null;

  const inspectorTabList: Array<{ id: RunnerInspectorTab; label: string }> = [
    {
      id: 'trailmarks',
      label:
        snapshotEntries.length > 0
          ? `Snapshots & Trailmarks (${activeMarkers.length})`
          : `Trailmarks & Splits (${activeMarkers.length})`,
    },
    { id: 'terrain', label: 'Surface & Climbs' },
    { id: 'pace', label: 'Pace & Kit' },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent, idx: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    let nextIdx = idx;
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % inspectorTabList.length;
    if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + inspectorTabList.length) % inspectorTabList.length;
    if (event.key === 'Home') nextIdx = 0;
    if (event.key === 'End') nextIdx = inspectorTabList.length - 1;
    setActiveTab(inspectorTabList[nextIdx].id);
  };

  const renderExplorerContent = (isExpandedView: boolean) => {
    const selectedMarkerElevationValue =
      selectedMarker && activeSnapshot
        ? locateAtChainage(activeRoute, activeSnapshot.marker.chainageM, activeSnapshot.marker.passNumber).elevation
        : undefined;
    void selectedMarkerElevationValue;

    return (
      <div className="space-y-3">
        {/* Distance Selector when organizer published multiple distances */}
        {courses.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Course distance maps">
            {courses.map((c) => {
              const active = activePub?.distanceId === c.distanceId;
              return (
                <button
                  key={c.distanceId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedDistanceId(c.distanceId)}
                  className={`min-h-11 lg:min-h-9 rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
                    active
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  {c.distanceLabel} ({(c.measuredDistanceM / 1000).toFixed(1)} km)
                </button>
              );
            })}
          </div>
        )}

        {/* Horizontal Divide-X Telemetry Strip (< 96px height) */}
        <div className="overflow-x-auto racepulse-horizontal-scroll rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
          <dl
            className="grid grid-flow-col auto-cols-[minmax(102px,1fr)] divide-x divide-[var(--border-subtle)]"
            aria-label="Key race course statistics"
          >
            <div className="px-2.5 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Distance</dt>
              <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {activeRoute.distanceKm.toFixed(2)} km
              </dd>
            </div>
            <div className="px-2.5 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Elev Gain / Loss</dt>
              <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {activeRoute.elevationProvenance.status === 'unavailable'
                  ? 'Unavailable'
                  : `+${Math.round(activeRoute.elevationGainM)}m / -${Math.round(activeRoute.elevationLossM)}m`}
              </dd>
            </div>
            <div className="px-2.5 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Alt &amp; Grade</dt>
              <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {terrainSummary.minEleM !== null && terrainSummary.maxEleM !== null
                  ? `${terrainSummary.minEleM}-${terrainSummary.maxEleM}m (${terrainSummary.maxGradePct}%)`
                  : `Max ${terrainSummary.maxGradePct}%`}
              </dd>
            </div>
            <div className="px-2.5 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Surface</dt>
              <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {terrainSummary.roadPct}% Rd · {terrainSummary.offRoadPct}% Trl
              </dd>
            </div>
            <div className="px-2.5 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
                Est. ({formatPaceMinKm(targetPaceMinPerKm)})
              </dt>
              <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {formatDurationMinutes(analytics.estimatedFinishMinutes)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Layer Switcher & Live Location Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Course layer color mode">
            {(
              [
                ['surface', 'Surface'],
                ['gradient', 'Slope'],
                ['default', 'Route'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={colorMode === mode}
                onClick={() => setColorMode(mode)}
                className={`min-h-11 lg:min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                  colorMode === mode
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={geo.status === 'active'}
              onClick={geo.status === 'active' ? handleCenterOnUser : handleLocateMe}
              className={`inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                geo.status === 'active'
                  ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-500'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-sky-600/50 hover:text-sky-700 dark:hover:text-sky-400'
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {geo.status === 'locating'
                  ? 'Locating...'
                  : geo.status === 'active'
                    ? 'Center on me'
                    : 'My location'}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={satelliteEnabled}
              onClick={() => setSatelliteEnabled((v) => !v)}
              className={`inline-flex min-h-11 lg:min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                satelliteEnabled
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sat</span>
            </button>
            <button
              type="button"
              aria-pressed={terrain3DEnabled}
              onClick={() => setTerrain3DEnabled((v) => !v)}
              className={`inline-flex min-h-11 lg:min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                terrain3DEnabled
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>3D</span>
            </button>
          </div>
        </div>

        {/* Live Runner Location Readout relative to Course */}
        {geo.status !== 'idle' && (
          <div
            role={geo.error ? 'alert' : 'status'}
            aria-live="polite"
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
              geo.error
                ? 'border-amber-500/50 bg-amber-500/10 text-[var(--text-primary)]'
                : 'border-sky-600/40 bg-sky-600/10 text-[var(--text-primary)]'
            }`}
          >
            {geo.error ? (
              <>
                <span>{geo.error}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLocateMe}
                    className="min-h-11 rounded-lg border border-[var(--border-control)] bg-[var(--surface-card)] px-3 font-semibold hover:border-red-600/50"
                  >
                    Retry GPS
                  </button>
                  <button
                    type="button"
                    onClick={geo.stopTracking}
                    className="min-h-11 rounded-lg px-3 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : geo.status === 'locating' ? (
              <>
                <span>Waiting for GPS coordinate fix...</span>
                <button
                  type="button"
                  onClick={geo.stopTracking}
                  className="min-h-11 rounded-lg border border-[var(--border-control)] bg-[var(--surface-card)] px-3 font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : locationProjection && geo.position ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1 font-semibold text-sky-700 dark:text-sky-300">
                    <span className="h-2 w-2 rounded-full bg-sky-600" aria-hidden="true" />
                    {locationProjection.onCourse
                      ? `On course (±${geo.position.accuracyM}m)`
                      : `${formatDistanceOffset(locationProjection.offRouteMeters)} from route (±${geo.position.accuracyM}m)`}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">
                    Nearest {(locationProjection.chainageM / 1000).toFixed(2)} km
                    {locationProjection.nearestElevationM !== undefined
                      ? ` · ${Math.round(locationProjection.nearestElevationM)} m`
                      : ''}
                  </span>
                  {locationProjection.nextMarker && (
                    <span className="text-[var(--text-secondary)]">
                      Next: <strong className="text-[var(--text-primary)]">{locationProjection.nextMarker.name}</strong>
                      {locationProjection.nextMarkerDistanceAlongM !== null
                        ? ` (+${formatDistanceOffset(locationProjection.nextMarkerDistanceAlongM)})`
                        : ''}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={geo.autoFollow}
                    onClick={() => geo.setAutoFollow(!geo.autoFollow)}
                    className={`min-h-11 rounded-lg border px-3 font-semibold ${
                      geo.autoFollow
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)]'
                    }`}
                  >
                    Follow
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectChainage(
                        locationProjection.chainageM,
                        locationProjection.passNumber,
                      )
                    }
                    className="min-h-11 rounded-lg border border-sky-600/40 bg-[var(--surface-card)] px-3 font-semibold text-sky-700 hover:border-sky-600 dark:text-sky-300"
                  >
                    Jump cursor here
                  </button>
                  <button
                    type="button"
                    onClick={geo.stopTracking}
                    className="min-h-11 rounded-lg border border-[var(--border-control)] bg-[var(--surface-card)] px-3 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Stop GPS
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* Synchronized Interactive Map + Elevation Profile */}
        <div className={isExpandedView ? 'grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : 'space-y-3'}>
          <div className="space-y-2.5">
            {isExpandedView || !expandOpen ? (
              <RouteMapCanvas
                route={activeRoute}
                routeIdentityKey={activePub?.id || `legacy_${race.id}`}
                markers={activeMarkers}
                selection={selection}
                selectedMarkerId={selectedMarkerId}
                activePass={activePass}
                theme={theme}
                colorMode={colorMode}
                editable={false}
                gpsLivePosition={gpsLivePosition}
                locateStatus={geo.status}
                onLocateMe={handleLocateMe}
                onCenterOnUser={handleCenterOnUser}
                imageryEnabled={satelliteEnabled}
                onToggleImagery={setSatelliteEnabled}
                is3DEnabled={terrain3DEnabled}
                onToggle3D={setTerrain3DEnabled}
                hideBuiltInLayerToggles
                provenance={activePub?.mapLayerProvenance}
                courseScopeId={
                  activePub ? `${activePub.raceId}_${activePub.distanceId}` : `legacy_${race.id}`
                }
                heightClassName={
                  isExpandedView
                    ? 'h-[320px] sm:h-[400px]'
                    : compact
                      ? 'h-[230px] sm:h-[268px]'
                      : 'h-[300px] sm:h-[360px]'
                }
                flyToTrigger={flyToTrigger}
                onSelectChainage={(chainageM, passNum) => handleSelectChainage(chainageM, passNum)}
                onSelectMarker={handleSelectMarker}
                onMapClickCoordinate={(_lat, _lon, proj) =>
                  handleSelectChainage(proj.chainageM, proj.passNumber)
                }
              />
            ) : (
              <div className="flex h-[200px] items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)]">
                Course map active in expanded explorer
              </div>
            )}

            {/* Synchronized Cursor Readout Strip */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
                <span>
                  <strong className="text-[var(--text-primary)]">
                    {(selection.chainageM / 1000).toFixed(2)} km
                  </strong>{' '}
                  <span className="text-[var(--text-secondary)]">spot</span>
                </span>
                <span>
                  <strong className="text-[var(--text-primary)]">
                    {selection.elevation !== undefined ? `${Math.round(selection.elevation)} m` : 'Unavailable'}
                  </strong>{' '}
                  <span className="text-[var(--text-secondary)]">elev</span>
                </span>
                <span>
                  <strong className="text-[var(--text-primary)]">
                    {selection.gradePct !== undefined
                      ? `${selection.gradePct > 0 ? '+' : ''}${selection.gradePct.toFixed(1)}%`
                      : '0.0%'}
                  </strong>{' '}
                  <span className="text-[var(--text-secondary)]">grade</span>
                </span>
              </div>
              <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-0.5 font-semibold text-[var(--text-primary)]">
                Surface: {cursorSurfaceLabel}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <RouteElevationProfile
              route={activeRoute}
              selectedChainageM={selection.chainageM}
              onSelectChainage={handleSelectChainage}
              markers={activeMarkers}
              selectedMarkerId={selectedMarkerId}
              onSelectMarker={handleSelectMarker}
              onOpenMarkerPhotos={openSnapshotsForMarker}
              runnerLocationChainageM={locationProjection?.chainageM}
              activePass={activePass}
            />

            {/* Selected Trailmark Interactive Inspector Card */}
            {selectedMarker && (
              <div className="rounded-xl border border-red-600/35 bg-[var(--surface-inset)] p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-red-700 px-1.5 py-0.5 text-xs font-semibold uppercase text-white">
                        {selectedMarker.kind}
                      </span>
                      <h4 className="font-semibold text-[var(--text-primary)] truncate">
                        {selectedMarker.name}
                      </h4>
                    </div>
                    <p className="mt-0.5 font-mono text-[var(--text-secondary)]">
                      {(selectedMarker.chainageM / 1000).toFixed(2)} km
                      {selectedMarkerElevation !== undefined
                        ? ` · ${Math.round(selectedMarkerElevation)} m`
                        : ''}
                      {selectedMarker.cutoffMinutes !== undefined
                        ? ` · Cutoff ${selectedMarker.cutoffMinutes}m`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMarkerId(undefined)}
                    aria-label="Clear selected trailmark"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                {selectedMarker.description && (
                  <p className="text-[var(--text-secondary)] leading-relaxed">
                    {selectedMarker.description}
                  </p>
                )}
                {selectedMarker.services.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMarker.services.map((srv) => (
                      <span
                        key={srv}
                        className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 font-semibold text-[var(--text-primary)]"
                      >
                        {srv}
                      </span>
                    ))}
                  </div>
                )}
                {selectedMarker.photos && selectedMarker.photos.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {selectedMarker.photos.map((photo, pIdx) => {
                      const galleryIdx = snapshotEntries.findIndex(
                        (entry) => entry.photo.id === photo.id && entry.marker.id === selectedMarker.id,
                      );
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => {
                            if (galleryIdx >= 0) setActiveSnapshotIndex(galleryIdx);
                          }}
                          className="group flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-1 pr-2.5 text-left hover:border-red-600/50"
                        >
                          <img
                            src={photo.thumbnailUrl || photo.detailUrl}
                            alt={photo.altText || photo.caption || selectedMarker.name}
                            className="h-10 w-12 rounded object-cover"
                          />
                          <span className="max-w-[140px] truncate font-semibold text-[var(--text-primary)] group-hover:text-red-700 dark:group-hover:text-red-400">
                            {photo.caption || `Snapshot ${pIdx + 1}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Accessible Inspector Section Tabs */}
        <div>
          <div
            role="tablist"
            aria-label="Course breakdown sections"
            className="flex flex-wrap items-center gap-1 border-b border-[var(--border-default)]"
          >
            {inspectorTabList.map((tab, idx) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`course-tab-${race.id}-${tab.id}`}
                  aria-selected={active}
                  aria-controls={`course-panel-${race.id}-${tab.id}`}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-11 sm:min-h-10 border-b-2 px-3 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-red-700 text-red-700 dark:border-red-400 dark:text-red-400'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Panel 1: Trailmark Snapshots & Checkpoints / Splits */}
          {activeTab === 'trailmarks' && (
            <div
              role="tabpanel"
              id={`course-panel-${race.id}-trailmarks`}
              aria-labelledby={`course-tab-${race.id}-trailmarks`}
              className="pt-3 space-y-3 text-xs"
            >
              {snapshotEntries.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                      <Camera className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      Trailmark Snapshots ({snapshotEntries.length})
                    </h4>
                    <span className="text-[var(--text-secondary)]">Click photo to inspect on map</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {snapshotEntries.map((entry) => (
                      <button
                        key={`${entry.marker.id}_${entry.photo.id}`}
                        type="button"
                        onClick={() => {
                          handleSelectMarker(entry.marker);
                          setActiveSnapshotIndex(entry.index);
                        }}
                        className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                          selectedMarkerId === entry.marker.id
                            ? 'border-red-600 bg-red-700/10'
                            : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50'
                        }`}
                      >
                        <div className="relative h-28 w-full overflow-hidden bg-[var(--surface-card)]">
                          <img
                            src={entry.photo.thumbnailUrl || entry.photo.detailUrl}
                            alt={entry.photo.altText || entry.photo.caption || entry.marker.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                          />
                          <span className="absolute bottom-1.5 left-1.5 rounded bg-zinc-950/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">
                            {(entry.marker.chainageM / 1000).toFixed(1)} km
                          </span>
                        </div>
                        <div className="p-2.5 space-y-0.5">
                          <p className="font-semibold text-[var(--text-primary)] truncate">
                            {entry.marker.name}
                          </p>
                          <p className="text-[var(--text-secondary)] truncate">
                            {entry.photo.caption || entry.marker.kind}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeMarkers.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                    <MapPin className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Course Checkpoints, Hydration &amp; Split Times ({activeMarkers.length})
                  </h4>
                  <div className={`grid gap-2 ${isExpandedView || !compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                    {activeMarkers
                      .slice()
                      .sort((a, b) => a.chainageM - b.chainageM)
                      .map((marker) => {
                        const split = analytics.gapSplits.find((s) => s.markerId === marker.id);
                        const photoCount = marker.photos?.length || 0;
                        return (
                          <button
                            key={marker.id}
                            type="button"
                            onClick={() => handleSelectMarker(marker)}
                            className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                              selectedMarkerId === marker.id
                                ? 'border-red-600 bg-red-700/10'
                                : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-[var(--text-primary)] truncate">
                                {marker.name}
                              </p>
                              <p className="text-[var(--text-secondary)] truncate">
                                {marker.services.length > 0 ? marker.services.join(', ') : marker.kind}
                                {split ? ` · Est ${formatDurationMinutes(split.elapsedMinutes)}` : ''}
                                {photoCount > 0 ? ` · ${photoCount} photo${photoCount > 1 ? 's' : ''}` : ''}
                              </p>
                              {marker.cutoffMinutes !== undefined &&
                                split?.cutoffBufferMinutes !== undefined && (
                                  <p
                                    className={`mt-0.5 font-semibold ${
                                      split.cutoffStatus === 'safe'
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : split.cutoffStatus === 'caution'
                                          ? 'text-amber-700 dark:text-amber-300'
                                          : 'text-red-700 dark:text-red-400'
                                    }`}
                                  >
                                    Cutoff {marker.cutoffMinutes}m ·{' '}
                                    {split.cutoffBufferMinutes >= 0
                                      ? `+${split.cutoffBufferMinutes}m buffer`
                                      : `${split.cutoffBufferMinutes}m over cutoff`}
                                  </p>
                                )}
                            </div>
                            <span className="shrink-0 font-mono font-semibold text-red-700 dark:text-red-400">
                              {(marker.chainageM / 1000).toFixed(2)} km
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] p-3 text-[var(--text-secondary)]">
                  No organizer trailmarks or snapshots pinned on this course yet.
                </p>
              )}
            </div>
          )}

          {/* Panel 2: Ground Surface & Categorized Climbs */}
          {activeTab === 'terrain' && (
            <div
              role="tabpanel"
              id={`course-panel-${race.id}-terrain`}
              aria-labelledby={`course-tab-${race.id}-terrain`}
              className={`pt-3 grid gap-3 text-xs ${isExpandedView || !compact ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}
            >
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Mountain className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Surface &amp; Grade Distribution
                  </h4>
                  <span className="font-mono font-semibold text-[var(--text-secondary)]">
                    Road {terrainSummary.roadPct}% · Off-Road {terrainSummary.offRoadPct}%
                  </span>
                </div>

                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-card)] border border-[var(--border-subtle)]"
                  role="img"
                  aria-label={`Surface proportion: ${analytics.surfaceBreakdown.map((s) => `${s.label} ${s.pct}%`).join(', ')}`}
                >
                  {analytics.surfaceBreakdown.map((item) => (
                    <div
                      key={item.surface}
                      className={surfaceBarColorClass(item.surface)}
                      style={{ width: `${Math.max(item.pct > 0 ? 3 : 0, item.pct)}%` }}
                      title={`${item.label}: ${item.pct}% (${(item.distanceM / 1000).toFixed(2)} km)`}
                    />
                  ))}
                </div>

                <div className="space-y-1.5">
                  {analytics.surfaceBreakdown.map((item) => (
                    <div key={item.surface} className="flex items-center justify-between gap-2 text-[var(--text-secondary)]">
                      <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)] min-w-0">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${surfaceBarColorClass(item.surface)}`} aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="font-mono tabular-nums shrink-0">
                        {item.pct}% ({(item.distanceM / 1000).toFixed(2)} km)
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                  <p className="font-semibold text-[var(--text-primary)]">Slope Grade Zones</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                    {analytics.gradientBreakdown
                      .filter((g) => g.pct > 0)
                      .map((g) => (
                        <div key={g.bucket} className="flex items-center justify-between gap-2 text-[var(--text-secondary)]">
                          <span className="truncate">{g.label}</span>
                          <span className="font-mono font-semibold text-[var(--text-primary)]">{g.pct}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3 space-y-2">
                <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  Categorized Climbs ({analytics.climbs.length})
                </p>
                {analytics.climbs.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.climbs.map((climb) => (
                      <button
                        key={climb.id}
                        type="button"
                        onClick={() => {
                          handleSelectChainage(climb.startKm * 1000, 1);
                          flyCameraTo(climb.peakLat, climb.peakLon, 15);
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2 text-left hover:border-red-600/50"
                      >
                        <span className="truncate font-semibold text-[var(--text-primary)]">
                          <span className="mr-1.5 inline-block rounded bg-red-700 px-1.5 py-0.5 text-xs text-white">
                            {climb.category}
                          </span>
                          {climb.startKm.toFixed(1)} to {climb.endKm.toFixed(1)} km
                        </span>
                        <span className="shrink-0 font-mono text-[var(--text-secondary)]">
                          +{climb.gainM}m · {climb.avgGradePct}% ({climb.maxGradePct}% max)
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[var(--text-secondary)]">
                    Flat or rolling course with no steep categorized climbs.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Panel 3: Runner Pace & Kit Estimator */}
          {activeTab === 'pace' && (
            <div
              role="tabpanel"
              id={`course-panel-${race.id}-pace`}
              aria-labelledby={`course-tab-${race.id}-pace`}
              className="pt-3 text-xs"
            >
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Runner Pace &amp; Kit Estimator
                  </h4>
                  <div className="flex items-center gap-1" role="group" aria-label="Preset target flat paces">
                    {[5, 6, 7, 8].map((pace) => (
                      <button
                        key={pace}
                        type="button"
                        aria-pressed={Math.abs(targetPaceMinPerKm - pace) < 0.05}
                        onClick={() => setTargetPaceMinPerKm(pace)}
                        className={`min-h-8 rounded-lg border px-2 font-mono font-semibold ${
                          Math.abs(targetPaceMinPerKm - pace) < 0.05
                            ? 'border-red-600 bg-red-700 text-white'
                            : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]'
                        }`}
                      >
                        {pace}:00
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5">
                  <label className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                    <span>Target flat pace (min/km)</span>
                    <input
                      type="number"
                      min={3.5}
                      max={15}
                      step={0.25}
                      value={targetPaceMinPerKm}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 3.0 && v <= 16.0) setTargetPaceMinPerKm(v);
                      }}
                      className="min-h-9 w-20 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </label>
                  <span className="font-mono font-semibold text-red-700 dark:text-red-400">
                    ETA {formatDurationMinutes(analytics.estimatedFinishMinutes)} ({formatPaceMinKm(analytics.averageGapPaceMinPerKm)} GAP)
                  </span>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 space-y-1">
                  <p className="font-semibold text-[var(--text-primary)]">
                    Recommended Kit: {analytics.gear.shoeCategory} ({analytics.gear.lugDepthMm} lugs)
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    Carry at least {analytics.gear.minimumWaterCarryMl} ml fluids
                    {analytics.gear.polesRecommended ? ' · Trekking poles recommended' : ''}
                  </p>
                  {analytics.gear.reasons.map((reason, idx) => (
                    <p key={idx} className="text-[var(--text-secondary)] leading-relaxed">
                      {reason}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const activeSnapshot =
    activeSnapshotIndex !== null ? snapshotEntries[activeSnapshotIndex] || null : null;
  const activeSnapshotElev = activeSnapshot
    ? locateAtChainage(activeRoute, activeSnapshot.marker.chainageM, activeSnapshot.marker.passNumber).elevation
    : undefined;

  return (
    <section
      aria-label={`${race.name} interactive course map, elevation, snapshots and location`}
      className={`rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] ${
        compact ? 'p-3 space-y-3' : 'p-3 sm:p-4 space-y-3.5'
      } overflow-x-clip`}
    >
      {/* Header + Actions (stacks vertically in compact panes so narrow side docks never squeeze subtitle or clip actions) */}
      <div
        className={
          compact
            ? 'flex flex-col gap-2'
            : 'flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'
        }
      >
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm sm:text-base font-display font-semibold text-[var(--text-primary)]">
            <Flag className="h-4 w-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span className="truncate">Official Course Map, Elevation &amp; Snapshots</span>
          </h3>
          <p className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
            {distanceTitle} · Road {terrainSummary.roadPct}% / Trail {terrainSummary.offRoadPct}% · Effort {analytics.difficultyIndex}/100
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpandOpen(true)}
            className="inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Expand Map</span>
          </button>
          <button
            type="button"
            onClick={handleExportGpx}
            className="inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            GPX
          </button>
          <a
            href={courseUrl}
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url: courseUrl } }));
            }}
            className="inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-xl bg-red-700 px-2.5 text-xs font-semibold text-white hover:bg-red-600"
          >
            <span>Route Explorer</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {renderExplorerContent(false)}

      {/* Expanded Course Explorer Modal */}
      {expandOpen && (
        <DialogSurface
          titleId={`course-expand-title-${race.id}`}
          descriptionId={`course-expand-desc-${race.id}`}
          onRequestClose={() => setExpandOpen(false)}
          dismissOnBackdropClick
          maxWidthCss="1100px"
          className="w-full rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2
                id={`course-expand-title-${race.id}`}
                className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
              >
                {race.name} · {distanceTitle}
              </h2>
              <p
                id={`course-expand-desc-${race.id}`}
                className="text-xs text-[var(--text-secondary)]"
              >
                Click map or scrub elevation to inspect terrain, trailmarks and snapshots.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpandOpen(false)}
              aria-label="Close expanded course map"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="p-4 sm:p-5">{renderExplorerContent(true)}</div>
        </DialogSurface>
      )}

      {/* Interactive Trailmark Snapshot Lightbox */}
      {activeSnapshot && (
        <DialogSurface
          titleId={`course-snapshot-title-${race.id}`}
          onRequestClose={() => setActiveSnapshotIndex(null)}
          dismissOnBackdropClick
          maxWidthCss="820px"
          className="w-full rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-2xl"
        >
          <div>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-mono text-[var(--text-secondary)]">
                  Snapshot {(activeSnapshotIndex ?? 0) + 1} of {snapshotEntries.length} ·{' '}
                  {(activeSnapshot.marker.chainageM / 1000).toFixed(2)} km
                  {activeSnapshotElev !== undefined
                    ? ` · ${Math.round(activeSnapshotElev)} m`
                    : ''}
                </p>
                <h2
                  id={`course-snapshot-title-${race.id}`}
                  className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
                >
                  {activeSnapshot.marker.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveSnapshotIndex(null)}
                aria-label="Close snapshot viewer"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
              <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-zinc-950/90">
                <img
                  src={activeSnapshot.photo.detailUrl || activeSnapshot.photo.thumbnailUrl}
                  alt={
                    activeSnapshot.photo.altText ||
                    activeSnapshot.photo.caption ||
                    activeSnapshot.marker.name
                  }
                  className="mx-auto max-h-[58vh] w-full object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="space-y-0.5">
                  {activeSnapshot.photo.caption && (
                    <p className="font-semibold text-[var(--text-primary)]">
                      {activeSnapshot.photo.caption}
                    </p>
                  )}
                  <p className="text-[var(--text-secondary)]">
                    {activeSnapshot.marker.services.length > 0
                      ? `Services: ${activeSnapshot.marker.services.join(', ')}`
                      : `Type: ${activeSnapshot.marker.kind}`}
                    {activeSnapshot.photo.credit ? ` · Photo by ${activeSnapshot.photo.credit}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectMarker(activeSnapshot.marker);
                      setActiveSnapshotIndex(null);
                    }}
                    className="inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Focus on Map</span>
                  </button>
                  {snapshotEntries.length > 1 && (
                    <>
                      <button
                        type="button"
                        aria-label="Previous snapshot"
                        onClick={() =>
                          setActiveSnapshotIndex((curr) =>
                            curr === null
                              ? null
                              : (curr - 1 + snapshotEntries.length) % snapshotEntries.length,
                          )
                        }
                        className="inline-flex min-h-11 lg:min-h-9 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        <span>Prev</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Next snapshot"
                        onClick={() =>
                          setActiveSnapshotIndex((curr) =>
                            curr === null ? null : (curr + 1) % snapshotEntries.length,
                          )
                        }
                        className="inline-flex min-h-11 lg:min-h-9 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {snapshotEntries.length > 1 && (
                <div className="flex gap-2 overflow-x-auto racepulse-horizontal-scroll pt-1">
                  {snapshotEntries.map((item) => (
                    <button
                      key={`thumb_${item.marker.id}_${item.photo.id}`}
                      type="button"
                      onClick={() => {
                        handleSelectMarker(item.marker);
                        setActiveSnapshotIndex(item.index);
                      }}
                      className={`shrink-0 overflow-hidden rounded-lg border-2 ${
                        item.index === activeSnapshotIndex
                          ? 'border-red-600'
                          : 'border-transparent opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={item.photo.thumbnailUrl || item.photo.detailUrl}
                        alt={item.photo.caption || item.marker.name}
                        className="h-12 w-16 object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogSurface>
      )}
    </section>
  );
}
