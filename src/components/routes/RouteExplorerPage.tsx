import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ExternalLink,
  Flag,
  Footprints,
  Gauge,
  Globe,
  Layers,
  MapPin,
  Mountain,
  QrCode,
  Search,
  Share2,
  Trash2,
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
import {
  COPERNICUS_TERRAIN_DOC_URL,
  COPERNICUS_TERRAIN_RELEASE,
  getRolloutBudgetBenchmarks,
  resetTileTelemetry,
  SENTINEL2_IMAGERY_DOC_URL,
  SENTINEL2_IMAGERY_SOURCE,
  subscribeTileTelemetry,
  type TileTelemetrySnapshot,
} from '../../lib/routes/philippinesMapTiles';
import {
  DEMO_BAGUIO_RACE,
  ensureDemoCoursesSeeded,
  ensurePilotCoursesSeeded,
  isDemoSeedEnabled,
  loadPublishedCourse,
  PILOT_BUKIDNON_RACE,
  PILOT_CEBU_RACE,
  PILOT_COURSE_RACE_IDS,
  subscribePublishedCatalog,
} from '../../lib/routes/routeStore';
import { buildRaceCoursePath, type RoutePageMatch } from '../../lib/routes/routing';
import type {
  PublishedRaceRoute,
  RaceRouteCatalogEntry,
  RouteAnchorCandidate,
  RouteChapter,
  RouteMarker,
  RouteSelectionState,
} from '../../lib/routes/types';
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

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatCutoffLabel(cutoffMinutes: number | undefined, race?: Race | null, distanceLabel?: string): string {
  if (!cutoffMinutes) return 'No cutoff';
  const waveStart =
    race?.waveStartTimes?.[distanceLabel || ''] || race?.gunStartTime;
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

export default function RouteExplorerPage({
  match,
  theme,
  canEditRoutes = false,
  onNavigateUrl,
  onBackHome,
}: RouteExplorerPageProps) {
  const demoMode = isDemoSeedEnabled();
  const [races, setRaces] = useState<Race[]>([]);
  const [catalog, setCatalog] = useState<RaceRouteCatalogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [distanceFilter, setDistanceFilter] = useState('all');

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
  const [simulateTileFailure, setSimulateTileFailure] = useState(false);
  const [tileTelemetry, setTileTelemetry] = useState<TileTelemetrySnapshot | null>(null);
  const [targetPaceMinPerKm, setTargetPaceMinPerKm] = useState(6.0);

  // Comparison course state
  const [compareDistanceId, setCompareDistanceId] = useState('');
  const [comparisonPublication, setComparisonPublication] = useState<PublishedRaceRoute | null>(null);

  // Synchronized cursor & detail state
  const [selection, setSelection] = useState<RouteSelectionState | null>(null);
  const [activePass, setActivePass] = useState(1);
  const [overlapCandidates, setOverlapCandidates] = useState<RouteAnchorCandidate[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | undefined>(undefined);
  const [flyToTrigger, setFlyToTrigger] = useState<{ lat: number; lon: number; zoom?: number; nonce: number } | null>(null);
  const [mobileSection, setMobileSection] = useState<'map' | 'details'>('map');

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

  const shareTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void ensurePilotCoursesSeeded();
    if (demoMode) {
      void ensureDemoCoursesSeeded();
    }
    const unsubTelemetry = subscribeTileTelemetry(setTileTelemetry);
    const unsubRaces = subscribeSharedRaces((list) => {
      setRaces(list);
    });
    const unsubCatalog = subscribePublishedCatalog((entries) => {
      setCatalog(entries);
    });
    return () => {
      unsubTelemetry();
      unsubRaces();
      unsubCatalog();
    };
  }, [demoMode]);

  const allRaces = useMemo(() => {
    const map = new Map<string, Race>();
    map.set(PILOT_CEBU_RACE.id, PILOT_CEBU_RACE);
    map.set(PILOT_BUKIDNON_RACE.id, PILOT_BUKIDNON_RACE);
    if (demoMode) {
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
    setSatelliteEnabled(false);
    setTerrain3DEnabled(false);
    setSimulateTileFailure(false);
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
          setWithdrawalReason(loaded.withdrawalReason || 'This course was withdrawn by the race organizer.');
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

      // Legacy ?race=RACE_ID&view=course: check published binding first, then fallback to race.routeGpxUrl
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
  }, [match, allRaces]);

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
          pointIndex: activeRoute.canonicalSegments[activeRoute.canonicalSegments.length - 1].length - 1,
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

  // Reset cursor selection to start whenever activeRoute loads
  useEffect(() => {
    if (!activeRoute) {
      setSelection(null);
      return;
    }
    setActivePass(1);
    setSelection(locateAtChainage(activeRoute, 0, 1));
  }, [activeRoute]);

  // Load comparison route when compareDistanceId changes
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

  // Check IndexedDB offline pack status
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
        setOfflineNotice('Saved course manifest, elevation profile, and checkpoints for offline reference.');
      }
    } catch (err) {
      setOfflineNotice(err instanceof Error ? err.message : 'Could not update offline pack.');
    } finally {
      setOfflineBusy(false);
    }
  };

  // Catalog view (/routes)
  if (match.kind === 'routes-catalog') {
    const existingRaceIds = new Set(allRaces.map((r) => r.id));
    const publishedList = catalog.filter(
      (c) =>
        c.status === 'published' &&
        (demoMode || existingRaceIds.has(c.raceId) || PILOT_COURSE_RACE_IDS.has(c.raceId)),
    );
    const rolloutBenchmarks = getRolloutBudgetBenchmarks(tileTelemetry ?? undefined);
    const regions = Array.from(new Set(publishedList.map((c) => c.region))).sort();
    const distances = Array.from(new Set(publishedList.map((c) => c.distanceLabel))).sort();
    const legacyOnlyRaces = allRaces.filter(
      (r) =>
        r.routeGpxUrl &&
        !publishedList.some((c) => c.raceId === r.id),
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
      return matchesTerm && matchesRegion && matchesDistance;
    });

    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-grow px-4 py-6 sm:px-6 space-y-6 focus:outline-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button
              type="button"
              onClick={onBackHome}
              className="mb-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-red-700 hover:underline dark:text-red-400"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to RacePulsePH
            </button>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
              Race Route Explorer
            </h1>
            <p className="mt-1 text-sm sm:text-base text-[var(--text-secondary)]">
              Browse nationwide coverage across Luzon, Visayas, and Mindanao, then inspect verified course maps, elevation profiles, and aid stations before race day.
            </p>
          </div>
          {canEditRoutes && (
            <a
              href="/route-studio"
              onClick={(e) => {
                e.preventDefault();
                onNavigateUrl('/route-studio');
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
            >
              Open Route Studio
            </a>
          )}
        </div>

        <PhilippinesNationalMap
          catalog={publishedList}
          theme={theme}
          onNavigateUrl={onNavigateUrl}
        />

        {/* Search & Filters */}
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-[var(--text-secondary)]">
            Search races or regions
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Baguio, 21K, ridge..."
                className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] pl-9 pr-3 text-sm text-[var(--text-primary)]"
              />
            </div>
          </label>
          <div className="block text-xs font-semibold text-[var(--text-secondary)] space-y-1">
            <label htmlFor="route-explorer-region" className="block">Region</label>
            <Select
              id="route-explorer-region"
              value={regionFilter}
              onChange={setRegionFilter}
              searchable={regions.length >= 6}
              searchPlaceholder="Filter regions..."
              surface="inset"
              size="md"
              triggerClassName="font-normal"
              options={[
                { value: 'all', label: 'All regions' },
                ...regions.map((reg) => ({ value: reg, label: reg })),
              ]}
            />
          </div>
          <div className="block text-xs font-semibold text-[var(--text-secondary)] space-y-1">
            <label htmlFor="route-explorer-distance" className="block">Distance category</label>
            <Select
              id="route-explorer-distance"
              value={distanceFilter}
              onChange={setDistanceFilter}
              surface="inset"
              size="md"
              triggerClassName="font-normal"
              options={[
                { value: 'all', label: 'All distances' },
                ...distances.map((dist) => ({ value: dist, label: dist })),
              ]}
            />
          </div>
        </div>

        {/* Published Courses Grid */}
        {publishedList.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-3">
            <Compass className="mx-auto h-8 w-8 text-[var(--text-secondary)]" aria-hidden="true" />
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
              No published courses for existing races yet
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Create an existing race in Race Setup and publish a course version in Route Studio to make interactive race maps available here.
            </p>
            {canEditRoutes && (
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href="/route-studio"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigateUrl('/route-studio');
                  }}
                  className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
                >
                  Open Route Studio
                </a>
              </div>
            )}
          </div>
        ) : filteredCatalog.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-3">
            <Compass className="mx-auto h-8 w-8 text-[var(--text-secondary)]" aria-hidden="true" />
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
              No published courses match your filters
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Clear your search or filter selections to browse published Philippine race courses.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setRegionFilter('all');
                setDistanceFilter('all');
              }}
              className="min-h-11 rounded-xl border border-[var(--border-default)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCatalog.map((entry) => {
              const courseUrl = buildRaceCoursePath(entry.raceId, entry.distanceId);
              return (
                <article
                  key={entry.id}
                  className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="rounded-lg bg-red-700/10 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400">
                        {entry.distanceLabel}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        Version {entry.versionNumber}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                        {entry.raceName}
                      </h2>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {entry.raceDate} · {entry.region}
                      </p>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 text-xs">
                      <div>
                        <dt className="text-[var(--text-secondary)]">Measured distance</dt>
                        <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                          {formatKm(entry.measuredDistanceM)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-secondary)]">Advertised</dt>
                        <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                          {entry.advertisedKm} km
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-secondary)]">Estimated ascent</dt>
                        <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                          {entry.elevationStatus === 'unavailable'
                            ? 'Unavailable'
                            : `+${Math.round(entry.elevationGainM)} m`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-secondary)]">Checkpoints / Photos</dt>
                        <dd className="mt-0.5 font-semibold text-[var(--text-primary)]">
                          {entry.checkpointCount} / {entry.landmarkCount}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <a
                    href={courseUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigateUrl(courseUrl);
                    }}
                    className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-600"
                  >
                    Explore course map & profile
                  </a>
                </article>
              );
            })}
          </div>
        )}

        {/* Rollout Budget & Pilot Course Storage Telemetry */}
        <section
          aria-label="Staging Tile Budget and Telemetry"
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 space-y-3"
        >
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              National Coverage & Pilot Course Tile Budget
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Imagery and elevation tiles stay at zero requests on initial summaries and load on demand when Satellite or 3D is toggled.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-secondary)]">
                  <th className="py-2 pr-4 font-semibold">Coverage layer</th>
                  <th className="py-2 pr-4 font-semibold">Island group</th>
                  <th className="py-2 pr-4 font-semibold">Imagery & cloud fill</th>
                  <th className="py-2 pr-4 font-semibold">Zoom & tiles</th>
                  <th className="py-2 pr-4 font-semibold">Prepared storage</th>
                  <th className="py-2 font-semibold">Measured first load</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {rolloutBenchmarks.map((row) => (
                  <tr key={row.id} className="text-[var(--text-primary)]">
                    <td className="py-2.5 pr-4 font-semibold">{row.label}</td>
                    <td className="py-2.5 pr-4">{row.islandGroup}</td>
                    <td className="py-2.5 pr-4 text-[var(--text-secondary)]">
                      {row.imageryDate} · {row.cloudPatchSummary}
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {row.zoomRange} · {row.tileCount} tiles
                    </td>
                    <td className="py-2.5 pr-4 font-mono">
                      {(row.preparedStorageKb / 1024).toFixed(1)} MB
                    </td>
                    <td className="py-2.5 font-mono">
                      {row.measuredFirstLoadMs ? `${row.measuredFirstLoadMs} ms` : 'Pending open'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Legacy GPX races not yet migrated */}
        {legacyOnlyRaces.length > 0 && (
          <section className="space-y-3 pt-2">
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
              Legacy GPX courses
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {legacyOnlyRaces.map((r) => {
                const legacyUrl = `/?race=${encodeURIComponent(r.id)}&view=course`;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {r.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {r.date} · {r.routeGpxFileName || 'Uploaded GPX'}
                      </p>
                    </div>
                    <a
                      href={legacyUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigateUrl(legacyUrl);
                      }}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[var(--border-default)] px-3 text-xs font-semibold text-red-700 hover:border-red-600/50 dark:text-red-400"
                    >
                      Open course
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    );
  }

  // Course Viewer (/races/:raceId/routes/:distanceId or /?race=...&view=course)
  const raceTitle = publication?.raceName || legacyRace?.name || 'Race Course';
  const distanceLabel = publication?.distanceLabel || '';
  const landmarks = activeMarkers.filter((m) => m.photos.length > 0 || m.kind === 'landmark');
  const staleOfflinePack =
    offlinePack && publication && offlinePack.publicationId !== publication.id;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-grow px-4 py-4 sm:px-6 sm:py-6 space-y-4 focus:outline-none">
      {/* Top breadcrumb & utility bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/routes"
            onClick={(e) => {
              e.preventDefault();
              onNavigateUrl('/routes');
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All courses
          </a>
          {siblingDistances.length > 1 && (
            <div role="group" aria-label="Select race distance category" className="flex flex-wrap items-center gap-1.5">
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
                    className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-xs font-semibold transition ${
                      isCurrent
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
                    }`}
                  >
                    {entry.distanceLabel}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {activeRoute && (
          <div className="flex flex-wrap items-center gap-2">
            {siblingDistances.length > 1 && publication && (
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <label htmlFor="route-compare-distance">Compare:</label>
                <Select
                  id="route-compare-distance"
                  aria-label="Compare with another race distance"
                  value={compareDistanceId}
                  onChange={setCompareDistanceId}
                  surface="card"
                  size="md"
                  className="w-auto min-w-[130px]"
                  triggerClassName="text-xs"
                  options={[
                    { value: '', label: 'None' },
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
            <button
              ref={shareTriggerRef}
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share & QR
            </button>
            <button
              type="button"
              onClick={handleDownloadSanitizedGpx}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export GPX
            </button>
            {publication && (
              <button
                type="button"
                disabled={offlineBusy}
                onClick={handleToggleOfflinePack}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 disabled:opacity-50"
              >
                {offlinePack && !staleOfflinePack ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Saved offline
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                    Save offline
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Historical version or offline pack banners */}
      {isHistorical && currentPublicationId && publication && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-[var(--text-primary)]">
          <span>
            You are viewing historical version <strong>v{publication.versionNumber}</strong>. A newer official course version is published.
          </span>
          <a
            href={buildRaceCoursePath(publication.raceId, publication.distanceId)}
            onClick={(e) => {
              e.preventDefault();
              onNavigateUrl(buildRaceCoursePath(publication.raceId, publication.distanceId));
            }}
            className="min-h-11 inline-flex items-center rounded-lg bg-red-700 px-3 font-semibold text-white hover:bg-red-600"
          >
            View current course
          </a>
        </div>
      )}

      {staleOfflinePack && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-[var(--text-primary)]">
          <span>
            Your saved offline pack is from <strong>v{offlinePack.versionNumber}</strong>, while the live course is now <strong>v{publication?.versionNumber}</strong>.
          </span>
          <button
            type="button"
            onClick={handleToggleOfflinePack}
            className="min-h-11 rounded-lg bg-red-700 px-3 font-semibold text-white hover:bg-red-600"
          >
            Update offline pack
          </button>
        </div>
      )}

      {offlineNotice && (
        <div role="status" className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-2 text-xs text-[var(--text-secondary)]">
          {offlineNotice}
        </div>
      )}

      {/* Loading / Unavailable / Withdrawn States */}
      {loading ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center text-sm text-[var(--text-secondary)]" role="status">
          Loading published course map and elevation profile...
        </div>
      ) : courseStatus === 'withdrawn' ? (
        <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-6 space-y-3" role="alert">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <h1 className="text-xl sm:text-2xl font-semibold">Course temporarily withdrawn</h1>
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
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-3" role="status">
          <Flag className="mx-auto h-8 w-8 text-[var(--text-secondary)]" aria-hidden="true" />
          <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
            Course not published yet
          </h1>
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
        <>
          {/* Functional Title + Course Summary Header */}
          <header className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
                  {raceTitle} {distanceLabel ? `· ${distanceLabel}` : ''}
                </h1>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {publication
                    ? `Published course v${publication.versionNumber} · Reviewed ${new Date(publication.reviewedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : `Legacy GPX preview · ${legacyRace?.routeGpxFileName || 'route.gpx'}`}
                  {publication?.overrideReason ? ` · Course update note: ${publication.overrideReason}` : ''}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2">
                  <dt className="text-xs text-[var(--text-secondary)]">Measured distance</dt>
                  <dd className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    {formatKm(activeRoute.distanceM)}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2">
                  <dt className="text-xs text-[var(--text-secondary)]">Advertised category</dt>
                  <dd className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    {publication ? `${publication.advertisedKm} km` : 'Unspecified'}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2">
                  <dt className="text-xs text-[var(--text-secondary)]">Estimated ascent</dt>
                  <dd className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    {activeRoute.elevationProvenance.status === 'unavailable'
                      ? 'Unavailable'
                      : `+${Math.round(activeRoute.elevationGainM)} m`}
                  </dd>
                </div>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2">
                  <dt className="text-xs text-[var(--text-secondary)]">Checkpoints / Photos</dt>
                  <dd className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    {activeMarkers.length} / {landmarks.length}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Course Chapters Bar */}
            {publication && publication.chapters.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-default)] pt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Chapters:
                </span>
                {publication.chapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => handleJumpChapter(chapter)}
                    className="min-h-11 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-700 dark:hover:text-red-400"
                  >
                    {chapter.label} ({(chapter.chainageM / 1000).toFixed(1)} km)
                  </button>
                ))}
              </div>
            )}
          </header>

          {/* Mobile Map / Details explicit switcher */}
          <div className="flex gap-2 lg:hidden" role="tablist" aria-label="Course view sections">
            <button
              type="button"
              role="tab"
              aria-selected={mobileSection === 'map'}
              onClick={() => setMobileSection('map')}
              className={`min-h-11 flex-1 rounded-xl border text-xs font-semibold ${
                mobileSection === 'map'
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]'
              }`}
            >
              Map & Elevation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileSection === 'details'}
              onClick={() => setMobileSection('details')}
              className={`min-h-11 flex-1 rounded-xl border text-xs font-semibold ${
                mobileSection === 'details'
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]'
              }`}
            >
              Checkpoints ({activeMarkers.length}) & Photos ({landmarks.length})
            </button>
          </div>

          {/* Main synchronized workspace: Map + Profile on left, Checkpoints & Landmarks Rail on right */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
            <div className={`space-y-4 lg:col-span-8 ${mobileSection === 'details' ? 'hidden lg:block' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Course map visualization mode">
                  {(
                    [
                      ['default', 'Standard Route'],
                      ['gradient', 'Slope Heatmap'],
                      ['surface', 'Surface & Terrain'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={colorMode === mode}
                      onClick={() => setColorMode(mode)}
                      className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition ${
                        colorMode === mode
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sentinel-2 imagery and Copernicus 3D controls">
                  <button
                    type="button"
                    aria-pressed={satelliteEnabled}
                    onClick={() => setSatelliteEnabled((v) => !v)}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                      satelliteEnabled
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                    }`}
                  >
                    <Globe className="h-4 w-4" aria-hidden="true" />
                    Satellite view (10 m)
                  </button>
                  <button
                    type="button"
                    aria-pressed={terrain3DEnabled}
                    onClick={() => setTerrain3DEnabled((v) => !v)}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                      terrain3DEnabled
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                    }`}
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                    3D terrain (GLO-30)
                  </button>
                  {canEditRoutes && (
                    <button
                      type="button"
                      aria-pressed={simulateTileFailure}
                      onClick={() => setSimulateTileFailure((v) => !v)}
                      className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition ${
                        simulateTileFailure
                          ? 'border-amber-600 bg-amber-600 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:border-red-600/50'
                      }`}
                    >
                      {simulateTileFailure ? 'Restore tiles' : 'Test tile fallback'}
                    </button>
                  )}
                </div>
              </div>

              {/* Course Imagery Date, Cloud-Mask & Live Request Telemetry */}
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-secondary)]">
                    <span>
                      Imagery date:{' '}
                      <strong className="font-mono text-[var(--text-primary)]">
                        {publication?.mapLayerProvenance?.imageryDate || '2026-Q3 mosaic'}
                      </strong>
                    </span>
                    {publication?.mapLayerProvenance && (
                      <>
                        <span>
                          Region:{' '}
                          <strong className="text-[var(--text-primary)]">
                            {publication.mapLayerProvenance.islandGroup} · {publication.mapLayerProvenance.province}
                          </strong>
                        </span>
                        <span>
                          Cloud mask:{' '}
                          <strong className="text-[var(--text-primary)]">
                            {publication.mapLayerProvenance.cloudMaskCheck.routeCorridorCloudPct}% route cloud filled from{' '}
                            {publication.mapLayerProvenance.cloudMaskCheck.patchedFromMosaicQuarter} ({publication.mapLayerProvenance.cloudMaskCheck.clearCoverageAfterFillPct}% clear)
                          </strong>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={COPERNICUS_TERRAIN_DOC_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline dark:text-red-400"
                    >
                      Terrain release <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    <a
                      href={SENTINEL2_IMAGERY_DOC_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline dark:text-red-400"
                    >
                      Imagery specifications <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--text-secondary)]">
                  <span>
                    Terrain: {publication?.mapLayerProvenance?.terrainRelease || COPERNICUS_TERRAIN_RELEASE}
                  </span>
                  <span>
                    Imagery: {publication?.mapLayerProvenance?.imagerySource || SENTINEL2_IMAGERY_SOURCE}
                  </span>
                  {canEditRoutes && tileTelemetry && (
                    <span>
                      Imagery requests: {tileTelemetry.imageryRequestsCount} ({(tileTelemetry.imageryBytesTransferred / 1024).toFixed(1)} KB) · DEM requests: {tileTelemetry.demRequestsCount} ({(tileTelemetry.demBytesTransferred / 1024).toFixed(1)} KB)
                      {publication &&
                      tileTelemetry.firstLoadMsByCourse[`${publication.raceId}_${publication.distanceId}`]
                        ? ` · First load: ${tileTelemetry.firstLoadMsByCourse[`${publication.raceId}_${publication.distanceId}`]} ms`
                        : ''}
                      {publication?.mapLayerProvenance
                        ? ` · Prepared CDN: ${((publication.mapLayerProvenance.validation.estimatedImageryBytes + publication.mapLayerProvenance.validation.estimatedDemBytes) / 1024).toFixed(0)} KB`
                        : ''}
                    </span>
                  )}
                </div>
              </div>

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
                imageryEnabled={satelliteEnabled}
                onToggleImagery={setSatelliteEnabled}
                is3DEnabled={terrain3DEnabled}
                onToggle3D={setTerrain3DEnabled}
                provenance={publication?.mapLayerProvenance}
                courseScopeId={publication ? `${publication.raceId}_${publication.distanceId}` : legacyRace?.id}
                simulateTileError={simulateTileFailure}
                heightClassName="h-[340px] sm:h-[400px] lg:h-[440px]"
                onSelectChainage={(chainageM, passNum) => handleSelectChainage(chainageM, passNum)}
                onSelectMarker={handleSelectMarker}
                onMapClickCoordinate={(_lat, _lon, proj) => {
                  setOverlapCandidates(proj.candidates);
                  handleSelectChainage(proj.chainageM, proj.passNumber);
                }}
                flyToTrigger={flyToTrigger}
              />

              <RouteElevationProfile
                route={activeRoute}
                selectedChainageM={selection.chainageM}
                onSelectChainage={handleSelectChainage}
                markers={activeMarkers}
                selectedMarkerId={selectedMarkerId}
                onSelectMarker={handleSelectMarker}
                activePass={activePass}
                overlapCandidates={overlapCandidates}
                onSelectPass={(passNum) => {
                  setActivePass(passNum);
                  const matched = overlapCandidates.find((c) => c.passNumber === passNum);
                  if (matched) handleSelectChainage(matched.chainageM, passNum);
                }}
                comparisonRoute={comparisonRoute}
                comparisonLabel={comparisonPublication?.distanceLabel}
              />
            </div>

            {/* Details Rail (320-384px equivalent on desktop) */}
            <aside
              aria-label="Checkpoints and photo landmarks"
              className={`space-y-4 lg:col-span-4 lg:max-h-[740px] lg:overflow-y-auto lg:pr-1 ${mobileSection === 'map' ? 'hidden lg:block' : ''}`}
            >
              {/* Photo Landmarks Section */}
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    <Camera className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Course Photo Landmarks
                  </h2>
                  <span className="text-xs text-[var(--text-secondary)]">{landmarks.length}</span>
                </div>
                {landmarks.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
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
                              <p className="text-xs text-[var(--text-secondary)]">
                                {formatKm(marker.chainageM)} · Pass {marker.passNumber}
                              </p>
                            </div>
                          </div>
                          {photo && (
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">
                              {photo.caption}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleSelectMarker(marker)}
                              className="min-h-11 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
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
                                className="min-h-11 rounded-lg bg-red-700 px-2.5 text-xs font-semibold text-white hover:bg-red-600"
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

              {/* Checkpoints Preparation List & Table */}
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                    <MapPin className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Checkpoints & Aid Stations
                  </h2>
                  <span className="text-xs text-[var(--text-secondary)]">{activeMarkers.length}</span>
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
                          onClick={() => handleSelectMarker(marker)}
                          className={`w-full rounded-xl border p-3 text-left transition ${
                            isSelected
                              ? 'border-red-600 bg-red-700/10'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {marker.name}
                            </span>
                            <span className="shrink-0 font-mono text-xs font-semibold text-red-700 dark:text-red-400">
                              {formatKm(marker.chainageM)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
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
                                Cutoff: {formatCutoffLabel(marker.cutoffMinutes, activeRaceObj, distanceLabel)}
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
            </aside>
          </div>

          {/* Strava-Class Metrics & Beyond-Strava Philippine Race Intelligence */}
          {analyticsBundle && (
            <section
              aria-label="Course Analytics and Race Strategy"
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 space-y-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-[var(--border-default)] pb-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
                    <Activity className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Strava Course Analytics & Race Strategy Simulator
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Calculated estimates from measured elevation, surface mix, checkpoint spacing, and wave start times.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs">
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
                      className="min-h-10 w-20 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-xs font-mono text-[var(--text-primary)]"
                    />
                  </label>
                  <div className="text-[var(--text-secondary)]">
                    Est. finish:{' '}
                    <strong className="font-mono text-[var(--text-primary)]">
                      {Math.floor(analyticsBundle.estimatedFinishMinutes / 60)}h {Math.round(analyticsBundle.estimatedFinishMinutes % 60)}m
                    </strong>{' '}
                    · Difficulty <strong className="text-[var(--text-primary)]">{analyticsBundle.difficultyIndex}/100</strong>
                  </div>
                </div>
              </div>

              {/* Row 1: Categorized Climbs + Surface & Slope Breakdown */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2.5">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    <Mountain className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Categorized Climbs
                  </h3>
                  {analyticsBundle.climbs.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      Rolling or flat profile without sustained Category 4 or steeper ascents.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {analyticsBundle.climbs.map((climb) => (
                        <div
                          key={climb.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--text-primary)]">
                              <span className="mr-1.5 inline-block rounded bg-red-700 px-1.5 py-0.5 text-[11px] text-white">
                                {climb.category}
                              </span>
                              {climb.title}
                            </p>
                            <p className="mt-0.5 text-[var(--text-secondary)]">
                              {(climb.lengthM / 1000).toFixed(2)} km · +{Math.round(climb.gainM)} m · {climb.avgGradePct.toFixed(1)}% avg
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectChainage(climb.startKm * 1000, 1)}
                            className="min-h-10 shrink-0 rounded-lg border border-[var(--border-default)] px-2.5 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
                          >
                            {climb.startKm.toFixed(1)} km
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3 text-xs">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    Surface Mix & Grade Distribution
                  </h3>
                  <div className="space-y-2">
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
                  <div className="space-y-1.5 border-t border-[var(--border-default)] pt-2">
                    {analyticsBundle.gradientBreakdown.map((item) => (
                      <div key={item.bucket} className="flex justify-between text-[var(--text-secondary)]">
                        <span>{item.label}</span>
                        <span className="font-mono text-[var(--text-primary)]">{item.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footwear, Poles & Kit Advisor */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2.5 text-xs">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    <Footprints className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Footwear, Poles & Carry Advisor
                  </h3>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {analyticsBundle.gear.shoeCategory} ({analyticsBundle.gear.lugDepthMm} lugs)
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    Poles: <strong className="text-[var(--text-primary)]">{analyticsBundle.gear.polesRecommended ? 'Recommended for steep climbs' : 'Optional'}</strong> · Minimum carry: <strong className="text-[var(--text-primary)]">{analyticsBundle.gear.minimumWaterCarryMl} mL</strong>
                  </p>
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {analyticsBundle.gear.reasons.map((reason, idx) => (
                      <li key={idx}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Row 2: Beyond-Strava GAP Splits + Cutoff Survival Simulator */}
              {analyticsBundle.gapSplits.length > 0 && (
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      Grade-Adjusted Pace (GAP) Splits & Cutoff Survival Simulator
                    </h3>
                    <span className="text-xs text-[var(--text-secondary)]">
                      Avg GAP: <strong className="font-mono text-[var(--text-primary)]">{analyticsBundle.averageGapPaceMinPerKm.toFixed(2)} min/km</strong>
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-default)] text-[var(--text-secondary)]">
                          <th className="py-2 pr-3 font-semibold">Checkpoint</th>
                          <th className="py-2 pr-3 font-semibold">Distance</th>
                          <th className="py-2 pr-3 font-semibold">Leg Gain</th>
                          <th className="py-2 pr-3 font-semibold">GAP Pace</th>
                          <th className="py-2 pr-3 font-semibold">Est. Split</th>
                          <th className="py-2 font-semibold">Cutoff Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-default)]">
                        {analyticsBundle.gapSplits.map((split) => (
                          <tr key={split.markerId} className="text-[var(--text-primary)]">
                            <td className="py-2 pr-3 font-semibold">{split.markerName}</td>
                            <td className="py-2 pr-3 font-mono">{split.distanceKm.toFixed(1)} km</td>
                            <td className="py-2 pr-3 font-mono">+{Math.round(split.legGainM)} m</td>
                            <td className="py-2 pr-3 font-mono">{split.gapPaceMinPerKm.toFixed(2)} min/km</td>
                            <td className="py-2 pr-3 font-mono">
                              {Math.round(split.elapsedMinutes)} min{split.clockTime ? ` (${split.clockTime})` : ''}
                            </td>
                            <td className="py-2">
                              {split.cutoffStatus ? (
                                <span
                                  className={`inline-flex items-center rounded-lg px-2 py-0.5 font-semibold ${
                                    split.cutoffStatus === 'risk'
                                      ? 'bg-red-700/15 text-red-700 dark:text-red-300'
                                      : split.cutoffStatus === 'caution'
                                        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                        : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                                  }`}
                                >
                                  {split.cutoffStatus.toUpperCase()} ({split.cutoffBufferMinutes! >= 0 ? '+' : ''}{split.cutoffBufferMinutes} min)
                                </span>
                              ) : (
                                <span className="text-[var(--text-secondary)]">No cutoff set</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Row 3: Tropical Heat Hydration Planner + Pack Bottleneck Hotspots */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    <Droplets className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    Tropical Heat & Hydration Leg Planner
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
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2"
                        >
                          <div>
                            <p className="font-semibold text-[var(--text-primary)]">
                              {leg.fromName} to {leg.toName} ({leg.legKm.toFixed(1)} km)
                            </p>
                            <p className="text-[var(--text-secondary)]">
                              Est. {leg.estimatedTempC} °C · Drink {leg.recommendedFluidMl} mL · {leg.recommendedCarbsG} g carbs
                            </p>
                          </div>
                          {leg.dryGapWarning && (
                            <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-300">
                              Long dry gap
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    Pack Bottleneck & Single-File Congestion Forecast
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
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              {bn.chainageKm.toFixed(1)} km · {bn.reason}
                            </p>
                            <p className="text-[var(--text-secondary)]">{bn.advice}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectChainage(bn.chainageKm * 1000, 1)}
                            className="min-h-9 rounded-lg border border-amber-600/40 bg-[var(--surface-card)] px-2.5 font-semibold text-[var(--text-primary)]"
                          >
                            Locate
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
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
                        (i) => (i - 1 + photoModalMarker.photos.length) % photoModalMarker.photos.length,
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
              {copiedLink ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
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
