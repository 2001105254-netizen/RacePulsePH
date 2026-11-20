import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Download,
  Droplets,
  Flag,
  Footprints,
  Gauge,
  Globe,
  Layers,
  LocateFixed,
  MapPin,
  Mountain,
  Search,
  Share2,
  WifiOff,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { loadGpxRoute } from '../../lib/gpxRoute';
import { subscribeSharedRaces } from '../../lib/racesStore';
import { locateAtChainage } from '../../lib/routes/anchoring';
import { buildCourseAnalytics } from '../../lib/routes/courseAnalytics';
import { exportSanitizedGpx, processCanonicalGeometry, type ProcessedRoute } from '../../lib/routes/geometry';
import type { MapThemeMode } from '../../lib/routes/mapProviders';
import {
  getOfflineCoursePack,
  removeOfflineCoursePack,
  saveOfflineCoursePack,
  type OfflineCoursePack,
} from '../../lib/routes/offlinePacks';
import { resetTileTelemetry } from '../../lib/routes/philippinesMapTiles';
import {
  DEMO_BAGUIO_RACE,
  ensureDemoCoursesSeeded,
  ensurePilotCoursesSeeded,
  isDemoSeedEnabled,
  loadPublishedCourse,
  PILOT_BUKIDNON_RACE,
  PILOT_CEBU_RACE,
  subscribePublishedCatalog,
} from '../../lib/routes/routeStore';
import { buildRaceCoursePath, type RoutePageMatch } from '../../lib/routes/routing';
import {
  computeRunnerLocationRelativeToRoute,
  useRunnerGeolocation,
} from '../../lib/routes/useRunnerGeolocation';
import type {
  PhilippineIslandGroup,
  PublishedRaceRoute,
  RaceRouteCatalogEntry,
  RouteAnchorCandidate,
  RouteChapter,
  RouteMarker,
  RouteSelectionState,
} from '../../lib/routes/types';
import { useWorkspaceHeader } from '../../lib/workspaceHeader';
import type { Race } from '../../types';
import RouteElevationProfile from '../RouteElevationProfile';
import DialogSurface from '../ui/DialogSurface';
import { Select } from '../ui/Select';
import PhilippinesNationalMap from './PhilippinesNationalMap';
import RouteMapCanvas, { type MapColorMode } from './RouteMapCanvas';

interface RouteExplorerPageProps {
  match: RoutePageMatch;
  theme: MapThemeMode;
  canEditRoutes?: boolean;
  onNavigateUrl: (url: string) => void;
  onBackHome: () => void;
}

type DetailTab = 'checkpoints' | 'photos' | 'strategy';

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatCutoffLabel(
  cutoffMinutes: number | undefined,
  race?: Race | null,
  distanceLabel?: string,
): string {
  if (!cutoffMinutes) return 'No cutoff';
  const waveStart = race?.waveStartTimes?.[distanceLabel || ''] || race?.gunStartTime;
  if (!waveStart) {
    return `${cutoffMinutes} min from wave start`;
  }
  const ms = Date.parse(waveStart);
  if (Number.isNaN(ms)) return `${cutoffMinutes} min from wave start`;
  const clock = new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }).format(new Date(ms + cutoffMinutes * 60_000));
  return `${cutoffMinutes} min (${clock} Asia/Manila)`;
}

function gpsQualityLabel(quality: 'high' | 'good' | 'coarse' | 'stale', isStale: boolean): string {
  if (isStale || quality === 'stale') return 'Stale fix';
  if (quality === 'high') return 'High lock';
  if (quality === 'good') return 'Good lock';
  return 'Coarse lock';
}

export default function RouteExplorerPage({
  match,
  theme,
  canEditRoutes = false,
  onNavigateUrl,
  onBackHome,
}: RouteExplorerPageProps) {
  const demoMode = isDemoSeedEnabled();
  const headerCtx = useWorkspaceHeader();
  const [races, setRaces] = useState<Race[]>([]);
  const [catalog, setCatalog] = useState<RaceRouteCatalogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [distanceFilter, setDistanceFilter] = useState('all');
  const [activeIslandGroup, setActiveIslandGroup] = useState<'all' | PhilippineIslandGroup>('all');
  const [selectedCatalogCourseId, setSelectedCatalogCourseId] = useState<string | null>(null);
  const [mobileCatalogSheetOpen, setMobileCatalogSheetOpen] = useState(false);

  // Active course state
  const [loading, setLoading] = useState(false);
  const [publication, setPublication] = useState<PublishedRaceRoute | null>(null);
  const [legacyFallbackRoute, setLegacyFallbackRoute] = useState<ProcessedRoute | null>(null);
  const [legacyRace, setLegacyRace] = useState<Race | null>(null);
  const [courseStatus, setCourseStatus] = useState<'ready' | 'unavailable' | 'withdrawn'>('ready');
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [currentPublicationId, setCurrentPublicationId] = useState<string | undefined>(undefined);
  const [isHistorical, setIsHistorical] = useState(false);
  const [colorMode, setColorMode] = useState<MapColorMode>('default');
  const [satelliteEnabled, setSatelliteEnabled] = useState(false);
  const [terrain3DEnabled, setTerrain3DEnabled] = useState(false);
  const [targetPaceMinPerKm, setTargetPaceMinPerKm] = useState(6.0);

  // Comparison course state
  const [compareDistanceId, setCompareDistanceId] = useState('');
  const [comparisonPublication, setComparisonPublication] = useState<PublishedRaceRoute | null>(null);

  // Synchronized cursor & inspector state
  const [selection, setSelection] = useState<RouteSelectionState | null>(null);
  const [activePass, setActivePass] = useState(1);
  const [overlapCandidates, setOverlapCandidates] = useState<RouteAnchorCandidate[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | undefined>(undefined);
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);
  const [desktopDetailTab, setDesktopDetailTab] = useState<DetailTab>('checkpoints');
  const [mobileDetailSheetOpen, setMobileDetailSheetOpen] = useState(false);
  const [mobileDetailTab, setMobileDetailTab] = useState<DetailTab>('checkpoints');
  const [mobileElevationOpen, setMobileElevationOpen] = useState(false);

  // Landmark photo modal, share modal, offline pack state
  const [photoModalMarker, setPhotoModalMarker] = useState<RouteMarker | null>(null);
  const [photoModalIndex, setPhotoModalIndex] = useState(0);
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Record<string, boolean>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copyFallbackText, setCopyFallbackText] = useState('');
  const [offlinePack, setOfflinePack] = useState<OfflineCoursePack | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState('');

  const geo = useRunnerGeolocation();
  const pendingFlyToUserRef = useRef(false);
  const lastGpsChainageRef = useRef<number | undefined>(undefined);
  const shareTriggerRef = useRef<HTMLButtonElement>(null);

  const setDesktopLocked = headerCtx?.setDesktopLocked;
  const setSplitViewportLocked = headerCtx?.setSplitViewportLocked;

  // Lock full viewport frame cleanly on Route Explorer views and restore on unmount
  useEffect(() => {
    setDesktopLocked?.(true);
    setSplitViewportLocked?.(true);
    return () => {
      setDesktopLocked?.(false);
      setSplitViewportLocked?.(false);
    };
  }, [setDesktopLocked, setSplitViewportLocked]);

  useEffect(() => {
    if (demoMode) {
      void ensurePilotCoursesSeeded();
      void ensureDemoCoursesSeeded();
    }
    const unsubRaces = subscribeSharedRaces((list) => {
      setRaces(list);
    });
    const unsubCatalog = subscribePublishedCatalog((entries) => {
      setCatalog(entries);
    });
    return () => {
      unsubRaces();
      unsubCatalog();
    };
  }, [demoMode]);

  const allRaces = useMemo(() => {
    const map = new Map<string, Race>();
    if (demoMode) {
      map.set(PILOT_CEBU_RACE.id, PILOT_CEBU_RACE);
      map.set(PILOT_BUKIDNON_RACE.id, PILOT_BUKIDNON_RACE);
      map.set(DEMO_BAGUIO_RACE.id, DEMO_BAGUIO_RACE);
    }
    for (const r of races) map.set(r.id, r);
    return Array.from(map.values());
  }, [races, demoMode]);

  // Load course when viewing /races/:raceId/routes/:distanceId or /?race=...&view=course
  useEffect(() => {
    if (match.kind === 'routes-catalog' || match.kind === 'route-studio') {
      setPublication(null);
      setLegacyFallbackRoute(null);
      return;
    }

    let cancelled = false;
    resetTileTelemetry();
    lastGpsChainageRef.current = undefined;
    setSatelliteEnabled(false);
    setTerrain3DEnabled(false);
    setLoading(true);
    setPublication(null);
    setLegacyFallbackRoute(null);
    setLegacyRace(null);
    setCourseStatus('ready');
    setWithdrawalReason('');
    setCompareDistanceId('');
    setComparisonPublication(null);
    setSelectedMarkerId(undefined);
    setOverlapCandidates([]);

    const run = async () => {
      if (demoMode) {
        await ensureDemoCoursesSeeded();
      }
      if (match.kind === 'race-course') {
        const loaded = await loadPublishedCourse(
          match.raceId,
          match.distanceId,
          match.publicationId,
        );
        if (cancelled) return;
        setCurrentPublicationId(loaded.currentPublicationId);
        setIsHistorical(loaded.isHistorical);
        if (loaded.withdrawn) {
          setCourseStatus('withdrawn');
          setWithdrawalReason(
            loaded.withdrawalReason || 'This course was withdrawn by the race organizer.',
          );
          setLoading(false);
          return;
        }
        if (loaded.publication) {
          setPublication(loaded.publication);
          setCourseStatus('ready');
          setLoading(false);
          return;
        }
        setCourseStatus('unavailable');
        setLoading(false);
        return;
      }

      const targetRace = allRaces.find((r) => r.id === match.raceId) || null;
      const firstDistanceId = targetRace?.distances?.[0]?.id;
      if (firstDistanceId) {
        const publishedFirst = await loadPublishedCourse(match.raceId, firstDistanceId);
        if (!cancelled && publishedFirst.publication) {
          setPublication(publishedFirst.publication);
          setCurrentPublicationId(publishedFirst.currentPublicationId);
          setIsHistorical(publishedFirst.isHistorical);
          setCourseStatus('ready');
          setLoading(false);
          return;
        }
      }
      if (targetRace?.routeGpxUrl) {
        try {
          const parsed = await loadGpxRoute(targetRace.routeGpxUrl);
          if (cancelled) return;
          setLegacyRace(targetRace);
          setLegacyFallbackRoute(parsed);
          setCourseStatus('ready');
          setLoading(false);
          return;
        } catch {
          if (cancelled) return;
        }
      }
      if (!cancelled) {
        setCourseStatus('unavailable');
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [match, allRaces, demoMode]);

  const activeRoute = useMemo<ProcessedRoute | null>(() => {
    if (publication) {
      return processCanonicalGeometry(publication.canonicalGeometry, {
        elevationSource: publication.elevationProvenance?.source,
        verticalDatum: publication.elevationProvenance?.verticalDatum,
      });
    }
    return legacyFallbackRoute;
  }, [publication, legacyFallbackRoute]);

  const activeMarkers = useMemo<RouteMarker[]>(() => {
    if (publication) return publication.markers;
    if (activeRoute) {
      const startPt = activeRoute.points[0];
      const endPt = activeRoute.points[activeRoute.points.length - 1];
      return [
        {
          id: 'legacy_start',
          kind: 'start',
          name: 'Start',
          description: 'GPX track start',
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
          services: [],
          photos: [],
          visibility: 'public',
        },
        {
          id: 'legacy_finish',
          kind: 'finish',
          name: 'Finish',
          description: 'GPX track finish',
          latitude: endPt.latitude,
          longitude: endPt.longitude,
          chainageM: activeRoute.distanceM,
          segmentIndex: activeRoute.canonicalSegments.length - 1,
          pointIndex:
            activeRoute.canonicalSegments[activeRoute.canonicalSegments.length - 1].length - 1,
          passNumber: 1,
          offsetMeters: 0,
          needsReview: false,
          offCourseBlocked: false,
          offCourseConfirmed: false,
          services: [],
          photos: [],
          visibility: 'public',
        },
      ];
    }
    return [];
  }, [publication, activeRoute]);

  useEffect(() => {
    if (!activeRoute) {
      setSelection(null);
      return;
    }
    setActivePass(1);
    setSelection(locateAtChainage(activeRoute, 0, 1));
  }, [activeRoute]);

  useEffect(() => {
    if (!publication || !compareDistanceId) {
      setComparisonPublication(null);
      return;
    }
    let cancelled = false;
    void loadPublishedCourse(publication.raceId, compareDistanceId).then((res) => {
      if (!cancelled) setComparisonPublication(res.publication);
    });
    return () => {
      cancelled = true;
    };
  }, [publication, compareDistanceId]);

  const comparisonRoute = useMemo<ProcessedRoute | null>(() => {
    if (!comparisonPublication) return null;
    return processCanonicalGeometry(comparisonPublication.canonicalGeometry);
  }, [comparisonPublication]);

  useEffect(() => {
    if (!publication) {
      setOfflinePack(null);
      return;
    }
    void getOfflineCoursePack(publication.raceId, publication.distanceId).then(setOfflinePack);
  }, [publication]);

  const activeRaceObj = useMemo(() => {
    const raceId = publication?.raceId || legacyRace?.id;
    return raceId ? allRaces.find((r) => r.id === raceId) || null : null;
  }, [allRaces, publication?.raceId, legacyRace?.id]);

  const analyticsBundle = useMemo(() => {
    if (!activeRoute) return null;
    return buildCourseAnalytics(activeRoute, activeMarkers, {
      targetFlatPaceMinPerKm: targetPaceMinPerKm,
      race: activeRaceObj,
    });
  }, [activeRoute, activeMarkers, targetPaceMinPerKm, activeRaceObj]);

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

  useEffect(() => {
    if (!geo.position) return;
    if (!pendingFlyToUserRef.current && !geo.autoFollow) return;
    pendingFlyToUserRef.current = false;
    setFlyToTrigger({
      lat: geo.position.lat,
      lon: geo.position.lon,
      zoom: 15,
      nonce: Date.now() + Math.random(),
    });
  }, [geo.position, geo.autoFollow]);

  const handleLocateMe = useCallback(() => {
    pendingFlyToUserRef.current = true;
    geo.startTracking();
  }, [geo]);

  const handleCenterOnUser = useCallback(() => {
    if (geo.position) {
      geo.setAutoFollow(true);
      setFlyToTrigger({
        lat: geo.position.lat,
        lon: geo.position.lon,
        zoom: 15,
        nonce: Date.now() + Math.random(),
      });
    } else {
      handleLocateMe();
    }
  }, [geo, handleLocateMe]);

  const siblingDistances = useMemo(() => {
    const raceId = publication?.raceId || (match.kind === 'race-course' ? match.raceId : undefined);
    if (!raceId) return [];
    return catalog.filter((c) => c.raceId === raceId && c.status === 'published');
  }, [catalog, publication?.raceId, match]);

  const handleSelectChainage = useCallback(
    (chainageM: number, passNumber = activePass) => {
      if (!activeRoute) return;
      setActivePass(passNumber);
      setSelection(locateAtChainage(activeRoute, chainageM, passNumber));
    },
    [activeRoute, activePass],
  );

  const handleSelectMarker = useCallback(
    (marker: RouteMarker) => {
      if (!activeRoute) return;
      setSelectedMarkerId(marker.id);
      setActivePass(marker.passNumber || 1);
      setSelection({
        ...locateAtChainage(activeRoute, marker.chainageM, marker.passNumber || 1),
        markerId: marker.id,
      });
      setFlyToTrigger({
        lat: marker.latitude,
        lon: marker.longitude,
        zoom: 15,
        nonce: Date.now(),
      });
    },
    [activeRoute],
  );

  const handleJumpChapter = (chapter: RouteChapter) => {
    if (!activeRoute) return;
    setActivePass(chapter.passNumber || 1);
    setSelection(locateAtChainage(activeRoute, chapter.chainageM, chapter.passNumber || 1));
    setFlyToTrigger({
      lat: chapter.latitude,
      lon: chapter.longitude,
      zoom: 15,
      nonce: Date.now(),
    });
  };

  const handleDownloadSanitizedGpx = () => {
    if (!activeRoute) return;
    const title = publication
      ? `${publication.raceName} ${publication.distanceLabel}`
      : `${legacyRace?.name || 'RacePulsePH'} Course`;
    const gpxXml = exportSanitizedGpx(activeRoute.canonicalGeometry, {
      title,
      markers: activeMarkers,
    });
    const blob = new Blob([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.download = `${safeName || 'racepulse-course'}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyShareLink = async () => {
    const shareUrl = window.location.href;
    setCopyFallbackText('');
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      setCopyFallbackText(shareUrl);
    }
  };

  const handleToggleOfflinePack = async () => {
    if (!publication || !activeRoute) return;
    setOfflineBusy(true);
    setOfflineNotice('');
    try {
      if (offlinePack && offlinePack.publicationId === publication.id) {
        await removeOfflineCoursePack(publication.raceId, publication.distanceId);
        setOfflinePack(null);
        setOfflineNotice('Removed saved offline course reference.');
      } else {
        const gpxText = exportSanitizedGpx(activeRoute.canonicalGeometry, {
          title: `${publication.raceName} ${publication.distanceLabel}`,
          markers: activeMarkers,
        });
        const pack: OfflineCoursePack = {
          key: `${publication.raceId}_${publication.distanceId}`,
          publicationId: publication.id,
          versionNumber: publication.versionNumber,
          savedAt: new Date().toISOString(),
          publication,
          gpxText,
        };
        await saveOfflineCoursePack(pack);
        setOfflinePack(pack);
        setOfflineNotice(
          'Saved course manifest, elevation profile, and checkpoints for offline reference.',
        );
      }
    } catch (err) {
      setOfflineNotice(err instanceof Error ? err.message : 'Could not update offline pack.');
    } finally {
      setOfflineBusy(false);
    }
  };

  // =========================================================================
  // CATALOG VIEW (/routes): ISO 100vh Desktop 34/66 Split + 100dvh Mobile Dock
  // =========================================================================
  if (match.kind === 'routes-catalog') {
    const existingRaceIds = new Set(allRaces.map((r) => r.id));
    const publishedList = catalog.filter(
      (c) =>
        c.status === 'published' &&
        (demoMode || existingRaceIds.has(c.raceId)),
    );
    const regions = Array.from(new Set(publishedList.map((c) => c.region))).sort();
    const distances = Array.from(new Set(publishedList.map((c) => c.distanceLabel))).sort();
    const legacyOnlyRaces = allRaces.filter(
      (r) => r.routeGpxUrl && !publishedList.some((c) => c.raceId === r.id),
    );

    const filteredCatalog = publishedList.filter((item) => {
      const term = search.trim().toLowerCase();
      const matchesTerm =
        !term ||
        item.raceName.toLowerCase().includes(term) ||
        item.region.toLowerCase().includes(term) ||
        item.distanceLabel.toLowerCase().includes(term);
      const matchesRegion = regionFilter === 'all' || item.region === regionFilter;
      const matchesDistance = distanceFilter === 'all' || item.distanceLabel === distanceFilter;
      const itemIsland = item.mapLayerProvenance?.islandGroup || 'Luzon';
      const matchesIsland = activeIslandGroup === 'all' || itemIsland === activeIslandGroup;
      return matchesTerm && matchesRegion && matchesDistance && matchesIsland;
    });

    const resetCatalogFilters = () => {
      setSearch('');
      setRegionFilter('all');
      setDistanceFilter('all');
      setActiveIslandGroup('all');
    };

    const filterAndListContent = (insideSheet: boolean) => (
      <div className={insideSheet ? 'space-y-3' : 'flex h-full min-h-0 flex-col'}>
        <div
          className={
            insideSheet
              ? 'space-y-2.5'
              : 'shrink-0 border-b border-[var(--border-default)] p-3 space-y-2'
          }
        >
          <label className="block text-xs font-semibold text-[var(--text-secondary)]">
            <span className="sr-only">Search races or regions</span>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search race, province, or distance..."
                className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-3 text-sm text-[var(--text-primary)]"
              />
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`route-explorer-region-${insideSheet ? 'm' : 'd'}`} className="sr-only">
                Region
              </label>
              <Select
                id={`route-explorer-region-${insideSheet ? 'm' : 'd'}`}
                value={regionFilter}
                onChange={setRegionFilter}
                searchable={regions.length >= 6}
                searchPlaceholder="Filter regions..."
                surface="inset"
                size="sm"
                triggerClassName="min-h-10 font-normal"
                options={[
                  { value: 'all', label: 'All regions' },
                  ...regions.map((reg) => ({ value: reg, label: reg })),
                ]}
              />
            </div>
            <div>
              <label htmlFor={`route-explorer-distance-${insideSheet ? 'm' : 'd'}`} className="sr-only">
                Distance category
              </label>
              <Select
                id={`route-explorer-distance-${insideSheet ? 'm' : 'd'}`}
                value={distanceFilter}
                onChange={setDistanceFilter}
                surface="inset"
                size="sm"
                triggerClassName="min-h-10 font-normal"
                options={[
                  { value: 'all', label: 'All distances' },
                  ...distances.map((dist) => ({ value: dist, label: dist })),
                ]}
              />
            </div>
          </div>
        </div>

        <div
          className={
            insideSheet
              ? 'space-y-2.5 max-h-[55dvh] overflow-y-auto pr-0.5'
              : 'flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5'
          }
        >
          {publishedList.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-5 text-center space-y-2">
              <Compass className="mx-auto h-6 w-6 text-[var(--text-secondary)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No published courses yet
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Create a race in Race Setup and publish a course version in Route Studio.
              </p>
              {canEditRoutes && (
                <a
                  href="/route-studio"
                  onClick={(e) => {
                    e.preventDefault();
                    setMobileCatalogSheetOpen(false);
                    onNavigateUrl('/route-studio');
                  }}
                  className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
                >
                  Open Route Studio
                </a>
              )}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-5 text-center space-y-2">
              <Compass className="mx-auto h-6 w-6 text-[var(--text-secondary)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No courses match your filters
              </p>
              <button
                type="button"
                onClick={resetCatalogFilters}
                className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
              >
                Reset filters
              </button>
            </div>
          ) : (
            filteredCatalog.map((entry) => {
              const courseUrl = buildRaceCoursePath(entry.raceId, entry.distanceId);
              const isSelected = selectedCatalogCourseId === entry.id;
              return (
                <article
                  key={entry.id}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 164px' }}
                  className={`rounded-xl border p-3.5 transition ${
                    isSelected
                      ? 'border-red-600 bg-red-700/5'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-red-700 px-2 py-0.5 text-[11px] font-semibold text-white">
                          {entry.distanceLabel}
                        </span>
                        <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                          v{entry.versionNumber}
                        </span>
                      </div>
                      <h2 className="mt-1.5 truncate text-sm font-semibold text-[var(--text-primary)]">
                        {entry.raceName}
                      </h2>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {entry.raceDate} · {entry.region}
                      </p>
                    </div>
                  </div>

                  <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2 text-xs font-mono tabular-nums">
                    <div>
                      <dt className="font-sans text-[11px] text-[var(--text-secondary)]">Distance</dt>
                      <dd className="font-semibold text-[var(--text-primary)]">
                        {formatKm(entry.measuredDistanceM)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-sans text-[11px] text-[var(--text-secondary)]">Gain</dt>
                      <dd className="font-semibold text-[var(--text-primary)]">
                        {entry.elevationStatus === 'unavailable'
                          ? 'N/A'
                          : `+${Math.round(entry.elevationGainM)} m`}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-sans text-[11px] text-[var(--text-secondary)]">CP / Pics</dt>
                      <dd className="font-semibold text-[var(--text-primary)]">
                        {entry.checkpointCount} / {entry.landmarkCount}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCatalogCourseId(entry.id);
                        if (entry.mapLayerProvenance?.islandGroup) {
                          setActiveIslandGroup(entry.mapLayerProvenance.islandGroup);
                        }
                        if (insideSheet) setMobileCatalogSheetOpen(false);
                      }}
                      className="min-h-11 lg:min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                    >
                      Focus pin
                    </button>
                    <a
                      href={courseUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        setMobileCatalogSheetOpen(false);
                        onNavigateUrl(courseUrl);
                      }}
                      className="inline-flex min-h-11 lg:min-h-9 flex-1 items-center justify-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                    >
                      Open course
                    </a>
                  </div>
                </article>
              );
            })
          )}

          {legacyOnlyRaces.length > 0 && (
            <section className="pt-2 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Legacy GPX courses
              </h3>
              {legacyOnlyRaces.map((r) => {
                const legacyUrl = `/?race=${encodeURIComponent(r.id)}&view=course`;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {r.name}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{r.date}</p>
                    </div>
                    <a
                      href={legacyUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        setMobileCatalogSheetOpen(false);
                        onNavigateUrl(legacyUrl);
                      }}
                      className="inline-flex min-h-11 lg:min-h-9 shrink-0 items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-red-700 dark:text-red-400"
                    >
                      Open
                    </a>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
    );

    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="w-full flex-1 min-h-0 flex flex-col overflow-hidden focus:outline-none"
      >
        {/* Portal slim context controls into App.tsx header bar when available */}
        {headerCtx?.leftSlotEl &&
          createPortal(
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm sm:text-base font-semibold tracking-tight text-white">
                Route Explorer
              </h1>
              <span className="hidden sm:inline-flex shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-200">
                {filteredCatalog.length}
              </span>
            </div>,
            headerCtx.leftSlotEl,
          )}

        {headerCtx?.rightSlotEl &&
          createPortal(
            <div className="hidden lg:flex items-center gap-1.5">
              <div role="group" aria-label="Filter by island group" className="flex items-center gap-1">
                {(['all', 'Luzon', 'Visayas', 'Mindanao'] as const).map((group) => (
                  <button
                    key={group}
                    type="button"
                    aria-pressed={activeIslandGroup === group}
                    onClick={() => setActiveIslandGroup(group)}
                    className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition ${
                      activeIslandGroup === group
                        ? 'border-red-500 bg-red-700 text-white'
                        : 'border-white/15 bg-white/10 text-zinc-100 hover:border-red-400/60'
                    }`}
                  >
                    {group === 'all' ? 'All PH' : group}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-pressed={satelliteEnabled}
                onClick={() => setSatelliteEnabled((v) => !v)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  satelliteEnabled
                    ? 'border-red-500 bg-red-700 text-white'
                    : 'border-white/15 bg-white/10 text-zinc-100 hover:border-red-400/60'
                }`}
              >
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                Satellite
              </button>
              <button
                type="button"
                aria-pressed={terrain3DEnabled}
                onClick={() => setTerrain3DEnabled((v) => !v)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  terrain3DEnabled
                    ? 'border-red-500 bg-red-700 text-white'
                    : 'border-white/15 bg-white/10 text-zinc-100 hover:border-red-400/60'
                }`}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                3D
              </button>
              {canEditRoutes && (
                <a
                  href="/route-studio"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigateUrl('/route-studio');
                  }}
                  className="inline-flex min-h-9 items-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                >
                  Route Studio
                </a>
              )}
            </div>,
            headerCtx.rightSlotEl,
          )}

        {/* Inline compact header fallback when rendered outside WorkspaceHeaderProvider */}
        {!headerCtx?.leftSlotEl && (
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={onBackHome}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </button>
              <h1 className="truncate text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                Route Explorer
              </h1>
            </div>
            {canEditRoutes && (
              <a
                href="/route-studio"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateUrl('/route-studio');
                }}
                className="inline-flex min-h-9 items-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white"
              >
                Route Studio
              </a>
            )}
          </div>
        )}

        {/* Mobile Island Group Chips Bar (<lg) */}
        <div
          role="toolbar"
          aria-label="Filter by island group"
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 lg:hidden"
        >
          {(['all', 'Luzon', 'Visayas', 'Mindanao'] as const).map((group) => (
            <button
              key={group}
              type="button"
              aria-pressed={activeIslandGroup === group}
              onClick={() => setActiveIslandGroup(group)}
              className={`min-h-11 shrink-0 rounded-xl border px-3 text-xs font-semibold transition ${
                activeIslandGroup === group
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
              }`}
            >
              {group === 'all' ? 'All PH' : group}
            </button>
          ))}
        </div>

        {/* Shared 34% / 66% Desktop Split & Full-Bleed Mobile Map Stage */}
        <div className="flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-[34%_66%] lg:overflow-hidden">
          <aside
            aria-label="Course catalog filters and race list"
            className="hidden lg:flex lg:min-h-0 lg:flex-col border-r border-[var(--border-default)] bg-[var(--surface-card)]"
          >
            {filterAndListContent(false)}
          </aside>

          <div className="relative flex-1 min-h-0 h-full">
            <PhilippinesNationalMap
              catalog={filteredCatalog}
              theme={theme}
              onNavigateUrl={onNavigateUrl}
              activeRegion={activeIslandGroup}
              onRegionChange={setActiveIslandGroup}
              selectedCourseId={selectedCatalogCourseId}
              onSelectCourseId={setSelectedCatalogCourseId}
              imageryEnabled={satelliteEnabled}
              onToggleImagery={setSatelliteEnabled}
              is3DEnabled={terrain3DEnabled}
              onToggle3D={setTerrain3DEnabled}
              fullHeight
              hideInternalToolbar
            />
          </div>
        </div>

        {/* Mobile Sticky Bottom Thumb-Zone Dock */}
        <div className="lg:hidden shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileCatalogSheetOpen(true)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Courses ({filteredCatalog.length})
          </button>
          <button
            type="button"
            aria-pressed={satelliteEnabled}
            onClick={() => setSatelliteEnabled((v) => !v)}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${
              satelliteEnabled
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
            }`}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
            Sat
          </button>
          <button
            type="button"
            aria-pressed={terrain3DEnabled}
            onClick={() => setTerrain3DEnabled((v) => !v)}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${
              terrain3DEnabled
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
            }`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            3D
          </button>
          {canEditRoutes && (
            <a
              href="/route-studio"
              onClick={(e) => {
                e.preventDefault();
                onNavigateUrl('/route-studio');
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)]"
            >
              Studio
            </a>
          )}
        </div>

        {/* Mobile Courses Drawer Dialog */}
        {mobileCatalogSheetOpen && (
          <DialogSurface
            titleId="mobile-catalog-sheet-title"
            onRequestClose={() => setMobileCatalogSheetOpen(false)}
            className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 text-[var(--text-primary)] shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="mobile-catalog-sheet-title" className="text-base font-semibold">
                Published Courses ({filteredCatalog.length})
              </h2>
              <button
                type="button"
                onClick={() => setMobileCatalogSheetOpen(false)}
                aria-label="Close courses list"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {filterAndListContent(true)}
          </DialogSurface>
        )}
      </main>
    );
  }

  // =========================================================================
  // COURSE DETAIL VIEW: ISO 100vh Desktop 64/36 Split + 100dvh Mobile Dock
  // =========================================================================
  const raceTitle = publication?.raceName || legacyRace?.name || 'Race Course';
  const distanceLabel = publication?.distanceLabel || '';
  const landmarks = activeMarkers.filter((m) => m.photos.length > 0 || m.kind === 'landmark');
  const staleOfflinePack = offlinePack && publication && offlinePack.publicationId !== publication.id;

  const renderInspectorContent = (tab: DetailTab) => {
    if (tab === 'photos') {
      return (
        <section aria-label="Course photo landmarks" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Camera className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              Course Photo Landmarks
            </h2>
            <span className="font-mono text-xs text-[var(--text-secondary)]">
              {landmarks.length}
            </span>
          </div>
          {landmarks.length === 0 ? (
            <p className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 text-xs text-[var(--text-secondary)]">
              No photo landmarks have been added to this course yet.
            </p>
          ) : (
            <div className="space-y-3">
              {landmarks.map((marker) => {
                const photo = marker.photos[0];
                const isBroken = photo ? brokenPhotoIds[photo.id] : true;
                return (
                  <div
                    key={marker.id}
                    className={`rounded-xl border p-3 transition ${
                      selectedMarkerId === marker.id
                        ? 'border-red-600 bg-red-700/5'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)]'
                    }`}
                  >
                    {photo && !isBroken ? (
                      <img
                        src={photo.thumbnailUrl}
                        alt={photo.altText}
                        width={320}
                        height={180}
                        loading="lazy"
                        onError={() =>
                          setBrokenPhotoIds((prev) => ({ ...prev, [photo.id]: true }))
                        }
                        className="mb-2 aspect-video w-full rounded-lg object-cover"
                      />
                    ) : photo ? (
                      <div className="mb-2 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-xs text-[var(--text-secondary)]">
                        Photo unavailable
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          {marker.name}
                        </p>
                        <p className="font-mono text-xs text-[var(--text-secondary)]">
                          {formatKm(marker.chainageM)} · Pass {marker.passNumber}
                        </p>
                      </div>
                    </div>
                    {photo && (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{photo.caption}</p>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectMarker(marker);
                          setMobileDetailSheetOpen(false);
                        }}
                        className="min-h-11 lg:min-h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                      >
                        Focus on map
                      </button>
                      {photo && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectMarker(marker);
                            setPhotoModalMarker(marker);
                            setPhotoModalIndex(0);
                          }}
                          className="min-h-11 lg:min-h-9 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
                        >
                          View details
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      );
    }

    if (tab === 'strategy' && analyticsBundle) {
      return (
        <section aria-label="Course Strategy and Pace Simulator" className="space-y-3 text-xs">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <Activity className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                Course Strategy & Pace Simulator
              </h2>
              <span className="font-mono text-[11px] font-semibold text-[var(--text-secondary)]">
                Difficulty {analyticsBundle.difficultyIndex}/100
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Gauge className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                Target flat pace (min/km)
                <input
                  type="number"
                  min={3.5}
                  max={15}
                  step={0.25}
                  aria-label="Target flat pace (min/km)"
                  value={targetPaceMinPerKm}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val) && val >= 3.0 && val <= 16.0) {
                      setTargetPaceMinPerKm(val);
                    }
                  }}
                  className="min-h-11 lg:min-h-9 w-20 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs font-mono text-[var(--text-primary)]"
                />
              </label>
              <span className="text-[var(--text-secondary)]">
                Est. finish:{' '}
                <strong className="font-mono text-[var(--text-primary)]">
                  {Math.floor(analyticsBundle.estimatedFinishMinutes / 60)}h{' '}
                  {Math.round(analyticsBundle.estimatedFinishMinutes % 60)}m
                </strong>
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Mountain className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              Categorized Climbs
            </h3>
            {analyticsBundle.climbs.length === 0 ? (
              <p className="text-[var(--text-secondary)]">
                Rolling or flat profile without sustained Category 4 or steeper ascents.
              </p>
            ) : (
              <div className="space-y-2">
                {analyticsBundle.climbs.map((climb) => (
                  <div
                    key={climb.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-primary)]">
                        <span className="mr-1.5 inline-block rounded bg-red-700 px-1.5 py-0.5 text-[11px] text-white">
                          {climb.category}
                        </span>
                        {climb.title}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {(climb.lengthM / 1000).toFixed(2)} km · +{Math.round(climb.gainM)} m ·{' '}
                        {climb.avgGradePct.toFixed(1)}% avg
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectChainage(climb.startKm * 1000, 1);
                        setMobileDetailSheetOpen(false);
                      }}
                      className="min-h-11 lg:min-h-9 shrink-0 rounded-lg border border-[var(--border-default)] px-2.5 font-mono font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                    >
                      {climb.startKm.toFixed(1)} km
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Surface Mix & Grade Distribution
            </h3>
            <div className="space-y-1.5">
              {analyticsBundle.surfaceBreakdown.map((item) => (
                <div key={item.surface} className="space-y-1">
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>{item.label}</span>
                    <span className="font-mono font-semibold text-[var(--text-primary)]">
                      {item.pct}% ({(item.distanceM / 1000).toFixed(1)} km)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-card)]">
                    <div className="h-full bg-red-600" style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-[var(--border-default)] pt-2">
              {analyticsBundle.gradientBreakdown.map((item) => (
                <div key={item.bucket} className="flex justify-between text-[var(--text-secondary)]">
                  <span>{item.label}</span>
                  <span className="font-mono text-[var(--text-primary)]">{item.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Footprints className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              Footwear, Poles & Carry Advisor
            </h3>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {analyticsBundle.gear.shoeCategory} ({analyticsBundle.gear.lugDepthMm} lugs)
            </p>
            <p className="text-[var(--text-secondary)]">
              Poles:{' '}
              <strong className="text-[var(--text-primary)]">
                {analyticsBundle.gear.polesRecommended ? 'Recommended for steep climbs' : 'Optional'}
              </strong>{' '}
              · Carry:{' '}
              <strong className="text-[var(--text-primary)]">
                {analyticsBundle.gear.minimumWaterCarryMl} mL
              </strong>
            </p>
            <ul className="space-y-1 text-[var(--text-secondary)]">
              {analyticsBundle.gear.reasons.map((reason, idx) => (
                <li key={idx}>• {reason}</li>
              ))}
            </ul>
          </div>

          {analyticsBundle.gapSplits.length > 0 && (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Grade-Adjusted Pace (GAP) Splits
                </h3>
                <span className="font-mono text-[var(--text-secondary)]">
                  Avg {analyticsBundle.averageGapPaceMinPerKm.toFixed(2)} min/km
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-default)] text-[var(--text-secondary)]">
                      <th className="py-1.5 pr-2 font-semibold">Checkpoint</th>
                      <th className="py-1.5 pr-2 font-semibold">Dist</th>
                      <th className="py-1.5 pr-2 font-semibold">GAP</th>
                      <th className="py-1.5 pr-2 font-semibold">Split</th>
                      <th className="py-1.5 font-semibold">Cutoff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-default)]">
                    {analyticsBundle.gapSplits.map((split) => (
                      <tr key={split.markerId} className="text-[var(--text-primary)]">
                        <td className="py-1.5 pr-2 font-semibold">{split.markerName}</td>
                        <td className="py-1.5 pr-2 font-mono">{split.distanceKm.toFixed(1)} km</td>
                        <td className="py-1.5 pr-2 font-mono">
                          {split.gapPaceMinPerKm.toFixed(2)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {Math.round(split.elapsedMinutes)}m
                          {split.clockTime ? ` (${split.clockTime})` : ''}
                        </td>
                        <td className="py-1.5">
                          {split.cutoffStatus ? (
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                split.cutoffStatus === 'risk'
                                  ? 'bg-red-700/15 text-red-700 dark:text-red-300'
                                  : split.cutoffStatus === 'caution'
                                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                    : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {split.cutoffStatus.toUpperCase()} (
                              {split.cutoffBufferMinutes! >= 0 ? '+' : ''}
                              {split.cutoffBufferMinutes}m)
                            </span>
                          ) : (
                            <span className="text-[var(--text-secondary)]">Open</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <Droplets className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              Tropical Heat & Hydration Planner
            </h3>
            {analyticsBundle.hydrationPlan.length === 0 ? (
              <p className="text-[var(--text-secondary)]">
                Add aid or water checkpoints to compute leg-by-leg fluid and carbohydrate targets.
              </p>
            ) : (
              <div className="space-y-1.5">
                {analyticsBundle.hydrationPlan.slice(0, 6).map((leg) => (
                  <div
                    key={leg.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-2"
                  >
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">
                        {leg.fromName} to {leg.toName} ({leg.legKm.toFixed(1)} km)
                      </p>
                      <p className="text-[var(--text-secondary)]">
                        {leg.estimatedTempC} °C · Drink {leg.recommendedFluidMl} mL ·{' '}
                        {leg.recommendedCarbsG} g carbs
                      </p>
                    </div>
                    {leg.dryGapWarning && (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-300">
                        Long dry gap
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Pack Bottleneck Forecast
            </h3>
            {analyticsBundle.bottlenecks.length === 0 ? (
              <p className="text-emerald-700 dark:text-emerald-400">
                Low early congestion risk based on current start widths and surface tags.
              </p>
            ) : (
              <div className="space-y-1.5">
                {analyticsBundle.bottlenecks.map((bn) => (
                  <div
                    key={bn.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        {bn.chainageKm.toFixed(1)} km · {bn.reason}
                      </p>
                      <p className="text-[var(--text-secondary)]">{bn.advice}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectChainage(bn.chainageKm * 1000, 1);
                        setMobileDetailSheetOpen(false);
                      }}
                      className="min-h-11 lg:min-h-9 rounded-lg border border-amber-600/40 bg-[var(--surface-card)] px-2.5 font-semibold text-[var(--text-primary)]"
                    >
                      Locate
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    }

    // Default: Checkpoints & Aid Stations
    return (
      <section aria-label="Checkpoints and aid stations" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <MapPin className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
            Checkpoints & Aid Stations
          </h2>
          <span className="font-mono text-xs text-[var(--text-secondary)]">
            {activeMarkers.length}
          </span>
        </div>

        <div className="space-y-2">
          {activeMarkers
            .slice()
            .sort((a, b) => a.chainageM - b.chainageM)
            .map((marker, idx, arr) => {
              const prevM = idx > 0 ? arr[idx - 1].chainageM : 0;
              const splitM = Math.max(0, marker.chainageM - prevM);
              const isSelected = selectedMarkerId === marker.id;
              return (
                <button
                  key={marker.id}
                  type="button"
                  onClick={() => {
                    handleSelectMarker(marker);
                    setMobileDetailSheetOpen(false);
                  }}
                  className={`w-full min-h-11 rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-red-600 bg-red-700/10'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {marker.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatKm(marker.chainageM)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    Kind: {marker.kind} · Pass {marker.passNumber}
                    {idx > 0 ? ` · +${(splitM / 1000).toFixed(2)} km from previous` : ''}
                  </p>
                  {marker.services.length > 0 && (
                    <p className="mt-1 text-xs text-[var(--text-primary)]">
                      Services: {marker.services.join(', ')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                    {marker.cutoffMinutes !== undefined && (
                      <span>
                        Cutoff:{' '}
                        {formatCutoffLabel(marker.cutoffMinutes, activeRaceObj, distanceLabel)}
                      </span>
                    )}
                    {marker.timingCheckpointId && (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Timing split linked
                      </span>
                    )}
                  </div>
                  {marker.instruction && (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Note: {marker.instruction}
                    </p>
                  )}
                </button>
              );
            })}
        </div>
      </section>
    );
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="w-full flex-1 min-h-0 flex flex-col overflow-hidden focus:outline-none"
    >
      {/* Portal slim title, distance switcher & utilities into single top bar */}
      {headerCtx?.leftSlotEl &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            <a
              href="/routes"
              onClick={(e) => {
                e.preventDefault();
                onNavigateUrl('/routes');
              }}
              className="hidden sm:inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white hover:border-red-400/60"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All courses
            </a>
            <h1 className="truncate text-sm sm:text-base font-semibold tracking-tight text-white">
              {raceTitle}
              {distanceLabel ? ` · ${distanceLabel}` : ''}
            </h1>
            {siblingDistances.length > 1 && (
              <div
                role="group"
                aria-label="Select race distance category"
                className="hidden xl:flex items-center gap-1 shrink-0"
              >
                {siblingDistances.map((entry) => {
                  const isCurrent = publication?.distanceId === entry.distanceId;
                  const url = buildRaceCoursePath(entry.raceId, entry.distanceId);
                  return (
                    <a
                      key={entry.id}
                      href={url}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigateUrl(url);
                      }}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={`inline-flex min-h-8 items-center rounded-md border px-2 text-xs font-semibold transition ${
                        isCurrent
                          ? 'border-red-500 bg-red-700 text-white'
                          : 'border-white/15 bg-white/10 text-zinc-200 hover:border-red-400/60'
                      }`}
                    >
                      {entry.distanceLabel}
                    </a>
                  );
                })}
              </div>
            )}
          </div>,
          headerCtx.leftSlotEl,
        )}

      {headerCtx?.rightSlotEl &&
        activeRoute &&
        createPortal(
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={geo.status === 'active'}
              onClick={geo.status === 'active' ? handleCenterOnUser : handleLocateMe}
              className={`hidden lg:inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition ${
                geo.status === 'active'
                  ? 'border-sky-500 bg-sky-600 text-white'
                  : 'border-white/15 bg-white/10 text-white hover:border-sky-400/60'
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              {geo.status === 'locating'
                ? 'Locating...'
                : geo.status === 'active'
                  ? 'Center me'
                  : 'My location'}
            </button>
            <button
              type="button"
              aria-pressed={satelliteEnabled}
              onClick={() => setSatelliteEnabled((v) => !v)}
              className={`hidden lg:inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition ${
                satelliteEnabled
                  ? 'border-red-500 bg-red-700 text-white'
                  : 'border-white/15 bg-white/10 text-white hover:border-red-400/60'
              }`}
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              Satellite
            </button>
            <button
              type="button"
              aria-pressed={terrain3DEnabled}
              onClick={() => setTerrain3DEnabled((v) => !v)}
              className={`hidden lg:inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition ${
                terrain3DEnabled
                  ? 'border-red-500 bg-red-700 text-white'
                  : 'border-white/15 bg-white/10 text-white hover:border-red-400/60'
              }`}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              3D
            </button>
            {publication && (
              <button
                type="button"
                disabled={offlineBusy}
                onClick={handleToggleOfflinePack}
                title={offlinePack && !staleOfflinePack ? 'Saved offline' : 'Save offline'}
                className="hidden sm:inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white hover:border-red-400/60 disabled:opacity-50"
              >
                {offlinePack && !staleOfflinePack ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    Offline
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                    Save offline
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadSanitizedGpx}
              aria-label="Export GPX"
              title="Export GPX"
              className="inline-flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-0 lg:px-2.5 items-center justify-center gap-1 rounded-xl lg:rounded-lg border border-white/15 bg-white/10 text-xs font-semibold text-white hover:border-red-400/60"
            >
              <Download className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">GPX</span>
            </button>
            <button
              ref={shareTriggerRef}
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="Share and QR"
              title="Share & QR"
              className="inline-flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-0 lg:px-2.5 items-center justify-center gap-1 rounded-xl lg:rounded-lg border border-white/15 bg-white/10 text-xs font-semibold text-white hover:border-red-400/60"
            >
              <Share2 className="h-4 w-4 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Share</span>
            </button>
          </div>,
          headerCtx.rightSlotEl,
        )}

      {/* Fallback top bar when WorkspaceHeaderProvider is absent */}
      {!headerCtx?.leftSlotEl && (
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3">
          <div className="flex items-center gap-2 min-w-0">
            <a
              href="/routes"
              onClick={(e) => {
                e.preventDefault();
                onNavigateUrl('/routes');
              }}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All courses
            </a>
            <h1 className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {raceTitle} {distanceLabel ? `· ${distanceLabel}` : ''}
            </h1>
          </div>
          {activeRoute && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDownloadSanitizedGpx}
                className="min-h-9 rounded-lg border border-[var(--border-default)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
              >
                GPX
              </button>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="min-h-9 rounded-lg border border-[var(--border-default)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
              >
                Share
              </button>
            </div>
          )}
        </div>
      )}

      {/* Slim Telemetry, Visualization & Chapters Sub-Ribbon (<= 40px) */}
      {!loading && courseStatus === 'ready' && activeRoute && selection && (
        <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1 flex items-center justify-between gap-2 overflow-x-auto text-xs">
          <div className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
            <span className="font-semibold text-[var(--text-primary)]">
              {formatKm(activeRoute.distanceM)}
            </span>
            <span className="text-[var(--text-secondary)]">
              {activeRoute.elevationProvenance.status === 'unavailable'
                ? 'Elev N/A'
                : `+${Math.round(activeRoute.elevationGainM)} m`}
            </span>
            <span className="hidden sm:inline text-[var(--text-secondary)]">
              {activeMarkers.length} CPs
            </span>
            {analyticsBundle && (
              <span className="hidden md:inline text-[var(--text-secondary)]">
                Est. {Math.floor(analyticsBundle.estimatedFinishMinutes / 60)}h{' '}
                {Math.round(analyticsBundle.estimatedFinishMinutes % 60)}m
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Course map visualization mode"
            >
              {(
                [
                  ['default', 'Route'],
                  ['gradient', 'Slope'],
                  ['surface', 'Surface'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={colorMode === mode}
                  onClick={() => setColorMode(mode)}
                  className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold transition ${
                    colorMode === mode
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {siblingDistances.length > 1 && publication && (
              <div className="hidden sm:inline-flex items-center gap-1.5">
                <label htmlFor="route-compare-distance" className="sr-only">
                  Compare distance
                </label>
                <Select
                  id="route-compare-distance"
                  aria-label="Compare with another race distance"
                  value={compareDistanceId}
                  onChange={setCompareDistanceId}
                  surface="inset"
                  size="sm"
                  className="w-auto min-w-[120px]"
                  triggerClassName="min-h-8 text-xs"
                  options={[
                    { value: '', label: 'Compare...' },
                    ...siblingDistances
                      .filter((d) => d.distanceId !== publication.distanceId)
                      .map((d) => ({
                        value: d.distanceId,
                        label: `${d.distanceLabel} (${formatKm(d.measuredDistanceM)})`,
                      })),
                  ]}
                />
              </div>
            )}

            {publication && publication.chapters.length > 0 && (
              <div className="hidden xl:flex items-center gap-1 border-l border-[var(--border-default)] pl-2">
                {publication.chapters.slice(0, 4).map((chapter) => (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => handleJumpChapter(chapter)}
                    className="min-h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-[11px] font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                  >
                    {chapter.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historical / Offline / Withdrawal / Loading / Main Split Workspace */}
      {loading ? (
        <div
          className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--text-secondary)]"
          role="status"
        >
          Loading published course map and elevation profile...
        </div>
      ) : courseStatus === 'withdrawn' ? (
        <div className="m-auto max-w-lg rounded-2xl border border-red-500/35 bg-red-500/10 p-6 space-y-3" role="alert">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Course temporarily withdrawn</h2>
          </div>
          <p className="text-sm text-[var(--text-primary)]">{withdrawalReason}</p>
          <a
            href="/routes"
            onClick={(e) => {
              e.preventDefault();
              onNavigateUrl('/routes');
            }}
            className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
          >
            Return to Route Explorer
          </a>
        </div>
      ) : courseStatus === 'unavailable' || !activeRoute || !selection ? (
        <div
          className="m-auto max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-3"
          role="status"
        >
          <Flag className="mx-auto h-8 w-8 text-[var(--text-secondary)]" aria-hidden="true" />
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Course not published yet
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            The organizer has not published a verified course map for this race distance yet.
          </p>
          <a
            href="/routes"
            onClick={(e) => {
              e.preventDefault();
              onNavigateUrl('/routes');
            }}
            className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border-default)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
          >
            Browse published courses
          </a>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col lg:grid lg:grid-cols-[64%_36%] lg:overflow-hidden">
          {/* Left Map + Elevation Stage */}
          <div className="flex flex-1 min-h-0 flex-col gap-2 p-2 lg:overflow-hidden">
            {((isHistorical && currentPublicationId && publication) ||
              staleOfflinePack ||
              offlineNotice) && (
              <div className="shrink-0 space-y-1">
                {isHistorical && currentPublicationId && publication && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    <span>
                      Historical version <strong>v{publication.versionNumber}</strong>. A newer official course version is live.
                    </span>
                    <a
                      href={buildRaceCoursePath(publication.raceId, publication.distanceId)}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigateUrl(buildRaceCoursePath(publication.raceId, publication.distanceId));
                      }}
                      className="inline-flex min-h-8 items-center rounded-lg bg-red-700 px-2.5 font-semibold text-white hover:bg-red-600"
                    >
                      View current
                    </a>
                  </div>
                )}
                {staleOfflinePack && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    <span>
                      Offline pack v{offlinePack.versionNumber} behind live v{publication?.versionNumber}.
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleOfflinePack}
                      className="min-h-8 rounded-lg bg-red-700 px-2.5 font-semibold text-white hover:bg-red-600"
                    >
                      Update offline pack
                    </button>
                  </div>
                )}
                {offlineNotice && (
                  <div
                    role="status"
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    {offlineNotice}
                  </div>
                )}
              </div>
            )}

            {/* Live GPS Runner Status Banner */}
            {geo.status !== 'idle' && (
              <div
                role={geo.error ? 'alert' : 'status'}
                aria-live="polite"
                className={`shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-xs ${
                  geo.error
                    ? 'border-amber-500/50 bg-amber-500/10 text-[var(--text-primary)]'
                    : 'border-sky-600/40 bg-sky-600/10 text-[var(--text-primary)]'
                }`}
              >
                {geo.error ? (
                  <>
                    <span>{geo.error}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleLocateMe}
                        className="min-h-10 lg:min-h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold"
                      >
                        Retry GPS
                      </button>
                      <button
                        type="button"
                        onClick={geo.stopTracking}
                        className="min-h-10 lg:min-h-8 rounded-lg px-2 font-semibold text-[var(--text-secondary)]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </>
                ) : geo.status === 'locating' ? (
                  <>
                    <span>Acquiring high-accuracy GNSS fix...</span>
                    <button
                      type="button"
                      onClick={geo.stopTracking}
                      className="min-h-10 lg:min-h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold"
                    >
                      Cancel
                    </button>
                  </>
                ) : locationProjection && geo.position ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="rounded bg-sky-600/20 px-1.5 py-0.5 font-semibold text-sky-800 dark:text-sky-200">
                        {gpsQualityLabel(geo.position.quality, geo.position.isStale)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-sky-700 dark:text-sky-300">
                        <span className="h-2 w-2 rounded-full bg-sky-600" aria-hidden="true" />
                        {locationProjection.onCourse
                          ? `On course (±${geo.position.accuracyM}m)`
                          : `${Math.round(locationProjection.offRouteMeters)} m from route (±${geo.position.accuracyM}m)`}
                      </span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        Nearest {(locationProjection.chainageM / 1000).toFixed(2)} km
                        {locationProjection.nearestElevationM !== undefined
                          ? ` · ${Math.round(locationProjection.nearestElevationM)} m`
                          : ''}
                      </span>
                      {locationProjection.nextMarker && (
                        <span className="text-[var(--text-secondary)]">
                          Next:{' '}
                          <strong className="text-[var(--text-primary)]">
                            {locationProjection.nextMarker.name}
                          </strong>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-pressed={geo.autoFollow}
                        onClick={() => geo.setAutoFollow(!geo.autoFollow)}
                        className={`min-h-10 lg:min-h-8 rounded-lg border px-2.5 font-semibold ${
                          geo.autoFollow
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]'
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
                        className="min-h-10 lg:min-h-8 rounded-lg border border-sky-600/40 bg-[var(--surface-card)] px-2.5 font-semibold text-sky-700 dark:text-sky-300"
                      >
                        Jump cursor
                      </button>
                      <button
                        type="button"
                        onClick={geo.stopTracking}
                        className="min-h-10 lg:min-h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 font-semibold text-[var(--text-secondary)]"
                      >
                        Stop
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            <div className="relative flex-1 min-h-[240px]">
              <div className="absolute inset-0">
                <RouteMapCanvas
                route={activeRoute}
                routeIdentityKey={publication?.id ?? legacyRace?.id}
                comparisonRoute={comparisonRoute}
                comparisonLabel={comparisonPublication?.distanceLabel}
                markers={activeMarkers}
                selection={selection}
                selectedMarkerId={selectedMarkerId}
                activePass={activePass}
                theme={theme}
                colorMode={colorMode}
                gpsLivePosition={
                  geo.position
                    ? {
                        lat: geo.position.lat,
                        lon: geo.position.lon,
                        accuracyM: geo.position.accuracyM,
                        headingDeg: geo.position.headingDeg,
                        isStale: geo.position.isStale,
                      }
                    : null
                }
                locateStatus={geo.status}
                onLocateMe={handleLocateMe}
                onCenterOnUser={handleCenterOnUser}
                imageryEnabled={satelliteEnabled}
                onToggleImagery={setSatelliteEnabled}
                is3DEnabled={terrain3DEnabled}
                onToggle3D={setTerrain3DEnabled}
                hideBuiltInLayerToggles
                hideHud
                provenance={publication?.mapLayerProvenance}
                courseScopeId={
                  publication ? `${publication.raceId}_${publication.distanceId}` : legacyRace?.id
                }
                heightClassName="h-full"
                onSelectChainage={(chainageM, passNum) => handleSelectChainage(chainageM, passNum)}
                onSelectMarker={handleSelectMarker}
                onMapClickCoordinate={(_lat, _lon, proj) => {
                  setOverlapCandidates(proj.candidates);
                  handleSelectChainage(proj.chainageM, proj.passNumber);
                }}
                flyToTrigger={flyToTrigger}
              />
              </div>
            </div>

            <div className={`shrink-0 ${mobileElevationOpen ? 'block' : 'hidden'} lg:block`}>
              <RouteElevationProfile
                route={activeRoute}
                selectedChainageM={selection.chainageM}
                onSelectChainage={handleSelectChainage}
                markers={activeMarkers}
                selectedMarkerId={selectedMarkerId}
                onSelectMarker={handleSelectMarker}
                onOpenMarkerPhotos={(marker) => {
                  handleSelectMarker(marker);
                  setPhotoModalMarker(marker);
                  setPhotoModalIndex(0);
                }}
                runnerLocationChainageM={locationProjection?.chainageM}
                activePass={activePass}
                overlapCandidates={overlapCandidates}
                onSelectPass={(passNum) => {
                  setActivePass(passNum);
                  const matched = overlapCandidates.find((c) => c.passNumber === passNum);
                  if (matched) handleSelectChainage(matched.chainageM, passNum);
                }}
                comparisonRoute={comparisonRoute}
                comparisonLabel={comparisonPublication?.distanceLabel}
                compact
              />
            </div>
          </div>

          {/* Desktop Right Tabbed Inspector Rail (36%) */}
          <aside
            aria-label="Course inspector rail"
            className="hidden lg:flex lg:min-h-0 lg:flex-col border-l border-[var(--border-default)] bg-[var(--surface-card)]"
          >
            <div
              role="tablist"
              aria-label="Course inspector sections"
              className="shrink-0 grid grid-cols-3 gap-1 border-b border-[var(--border-default)] p-2"
            >
              {(
                [
                  ['checkpoints', `CPs (${activeMarkers.length})`],
                  ['photos', `Photos (${landmarks.length})`],
                  ['strategy', 'Strategy'],
                ] as const
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  role="tab"
                  aria-selected={desktopDetailTab === tabId}
                  onClick={() => setDesktopDetailTab(tabId)}
                  className={`min-h-9 rounded-lg border px-2 text-xs font-semibold transition ${
                    desktopDetailTab === tabId
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto p-3"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 420px' }}
            >
              {renderInspectorContent(desktopDetailTab)}
            </div>
          </aside>

          {/* Mobile Sticky Bottom Thumb-Zone Dock */}
          <div className="lg:hidden shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-5 gap-1.5">
            <button
              type="button"
              aria-pressed={geo.status === 'active'}
              onClick={geo.status === 'active' ? handleCenterOnUser : handleLocateMe}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border px-1 text-[11px] font-semibold ${
                geo.status === 'active'
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
              }`}
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
              <span>GPS</span>
            </button>
            <button
              type="button"
              aria-pressed={satelliteEnabled}
              onClick={() => setSatelliteEnabled((v) => !v)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border px-1 text-[11px] font-semibold ${
                satelliteEnabled
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
              }`}
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              <span>Sat</span>
            </button>
            <button
              type="button"
              aria-pressed={terrain3DEnabled}
              onClick={() => setTerrain3DEnabled((v) => !v)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border px-1 text-[11px] font-semibold ${
                terrain3DEnabled
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
              }`}
            >
              <Layers className="h-4 w-4" aria-hidden="true" />
              <span>3D</span>
            </button>
            <button
              type="button"
              aria-pressed={mobileElevationOpen}
              onClick={() => setMobileElevationOpen((v) => !v)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border px-1 text-[11px] font-semibold ${
                mobileElevationOpen
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
              }`}
            >
              <Mountain className="h-4 w-4" aria-hidden="true" />
              <span>Profile</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileDetailSheetOpen(true)}
              className="flex min-h-11 flex-col items-center justify-center rounded-xl bg-red-700 px-1 text-[11px] font-semibold text-white hover:bg-red-600"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span>Details</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Inspector Drawer Dialog */}
      {mobileDetailSheetOpen && activeRoute && (
        <DialogSurface
          titleId="mobile-detail-sheet-title"
          onRequestClose={() => setMobileDetailSheetOpen(false)}
          className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 text-[var(--text-primary)] shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="mobile-detail-sheet-title" className="text-base font-semibold">
              {raceTitle} {distanceLabel}
            </h2>
            <button
              type="button"
              onClick={() => setMobileDetailSheetOpen(false)}
              aria-label="Close course details"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Mobile course inspector tabs"
            className="mb-3 grid grid-cols-3 gap-1.5"
          >
            {(
              [
                ['checkpoints', `CPs (${activeMarkers.length})`],
                ['photos', `Photos (${landmarks.length})`],
                ['strategy', 'Strategy'],
              ] as const
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={mobileDetailTab === tabId}
                onClick={() => setMobileDetailTab(tabId)}
                className={`min-h-11 rounded-xl border px-2 text-xs font-semibold ${
                  mobileDetailTab === tabId
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[60dvh] overflow-y-auto pr-0.5">
            {renderInspectorContent(mobileDetailTab)}
          </div>
        </DialogSurface>
      )}

      {/* Photo Landmark Details Dialog */}
      {photoModalMarker && (
        <DialogSurface
          titleId="landmark-modal-title"
          descriptionId="landmark-modal-desc"
          onRequestClose={() => setPhotoModalMarker(null)}
          className="w-full max-w-2xl rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 text-[var(--text-primary)] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="landmark-modal-title" className="text-xl font-semibold">
                {photoModalMarker.name}
              </h2>
              <p id="landmark-modal-desc" className="text-xs text-[var(--text-secondary)]">
                {formatKm(photoModalMarker.chainageM)} · Pass {photoModalMarker.passNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPhotoModalMarker(null)}
              aria-label="Close landmark photo details"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)] hover:border-red-600/50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {photoModalMarker.photos[photoModalIndex] && (
            <div className="mt-4 space-y-3">
              <img
                src={photoModalMarker.photos[photoModalIndex].detailUrl}
                alt={photoModalMarker.photos[photoModalIndex].altText}
                width={photoModalMarker.photos[photoModalIndex].width}
                height={photoModalMarker.photos[photoModalIndex].height}
                className="aspect-video w-full rounded-xl object-cover"
              />
              <p className="text-sm text-[var(--text-primary)]">
                {photoModalMarker.photos[photoModalIndex].caption}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Credit: {photoModalMarker.photos[photoModalIndex].credit}
              </p>
              {photoModalMarker.photos.length > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoModalIndex(
                        (i) =>
                          (i - 1 + photoModalMarker.photos.length) %
                          photoModalMarker.photos.length,
                      )
                    }
                    className="min-h-11 rounded-xl border border-[var(--border-default)] px-3 text-xs font-semibold"
                  >
                    Previous photo
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoModalIndex((i) => (i + 1) % photoModalMarker.photos.length)
                    }
                    className="min-h-11 rounded-xl border border-[var(--border-default)] px-3 text-xs font-semibold"
                  >
                    Next photo
                  </button>
                </div>
              )}
            </div>
          )}
        </DialogSurface>
      )}

      {/* Share & QR Code Dialog */}
      {shareOpen && (
        <DialogSurface
          titleId="share-course-title"
          onRequestClose={() => setShareOpen(false)}
          className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 text-[var(--text-primary)] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="share-course-title" className="text-xl font-semibold">
                Share Race Course
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Public deep link for runners and spectators
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShareOpen(false)}
              aria-label="Close share dialog"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="rounded-2xl border border-[var(--border-default)] bg-white p-4">
              <QRCodeSVG value={window.location.href} size={180} level="M" />
            </div>
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
            >
              {copiedLink ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copiedLink ? 'Course link copied' : 'Copy shareable link'}
            </button>
            {copyFallbackText && (
              <label className="w-full text-xs text-[var(--text-secondary)]">
                Copy this course link manually:
                <input
                  type="text"
                  readOnly
                  value={copyFallbackText}
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs text-[var(--text-primary)]"
                />
              </label>
            )}
          </div>
        </DialogSurface>
      )}
    </main>
  );
}
