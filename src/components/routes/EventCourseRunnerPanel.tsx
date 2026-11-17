import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Download,
  ExternalLink,
  Flag,
  Footprints,
  Gauge,
  Globe,
  Layers,
  MapPin,
  Mountain,
} from 'lucide-react';
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
import type { PublishedRaceRoute, RouteMarker, RouteSelectionState } from '../../lib/routes/types';
import type { Race } from '../../types';
import RouteElevationProfile from '../RouteElevationProfile';
import RouteMap3D from '../RouteMap3D';
import RouteMapCanvas, { type MapColorMode } from './RouteMapCanvas';

interface EventCourseRunnerPanelProps {
  race: Race;
  preferredDistance?: string;
  compact?: boolean;
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

function normalizeDistToken(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
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

function surfaceBarColorClass(surface: string): string {
  if (surface === 'paved') return 'bg-zinc-600 dark:bg-zinc-400';
  if (surface === 'dirt') return 'bg-amber-700 dark:bg-amber-500';
  if (surface === 'grass') return 'bg-emerald-600 dark:bg-emerald-400';
  if (surface === 'gravel') return 'bg-amber-600 dark:bg-amber-400';
  if (surface === 'singletrack') return 'bg-green-700 dark:bg-green-500';
  if (surface === 'technical') return 'bg-red-700 dark:bg-red-500';
  return 'bg-sky-600 dark:bg-sky-400';
}

export default function EventCourseRunnerPanel({
  race,
  preferredDistance,
  compact = false,
}: EventCourseRunnerPanelProps) {
  const theme = useDocumentMapTheme();
  const [courses, setCourses] = useState<PublishedRaceRoute[]>([]);
  const [selectedDistanceId, setSelectedDistanceId] = useState<string>('');
  const [colorMode, setColorMode] = useState<MapColorMode>('surface');
  const [satelliteEnabled, setSatelliteEnabled] = useState(false);
  const [terrain3DEnabled, setTerrain3DEnabled] = useState(false);
  const [targetPaceMinPerKm, setTargetPaceMinPerKm] = useState<number>(6.0);
  const [selection, setSelection] = useState<RouteSelectionState | null>(null);
  const [activePass, setActivePass] = useState(1);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | undefined>(undefined);
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    void ensurePilotCoursesSeeded();
    if (isDemoSeedEnabled()) {
      void ensureDemoCoursesSeeded();
    }
    return subscribeRacePublishedCourses(race.id, setCourses);
  }, [race.id]);

  useEffect(() => {
    if (courses.length === 0) {
      if (selectedDistanceId) setSelectedDistanceId('');
      return;
    }
    const prefToken = normalizeDistToken(preferredDistance);
    if (prefToken) {
      const matched = courses.find(
        (c) =>
          normalizeDistToken(c.distanceId) === prefToken ||
          normalizeDistToken(c.distanceLabel) === prefToken,
      );
      if (matched) {
        setSelectedDistanceId(matched.distanceId);
        return;
      }
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
    if (!activePub) return null;
    try {
      return processCanonicalGeometry(activePub.canonicalGeometry, {
        elevationSource: activePub.elevationProvenance?.source,
        verticalDatum: activePub.elevationProvenance?.verticalDatum,
      });
    } catch {
      return null;
    }
  }, [activePub]);

  const activeMarkers = useMemo<RouteMarker[]>(
    () => activePub?.markers || [],
    [activePub],
  );

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

  const cursorSurfaceLabel = useMemo(() => {
    if (!activeRoute || !selection) return 'Unknown surface';
    const point =
      activeRoute.canonicalSegments[selection.segmentIndex]?.[selection.pointIndex] ??
      activeRoute.points[0];
    const resolvedSurface =
      point?.surfaceType || (point?.sourceKind === 'drawn' ? 'singletrack' : 'paved');
    return SURFACE_LABELS[resolvedSurface];
  }, [activeRoute, selection]);

  const handleSelectChainage = (chainageM: number, passNumber = activePass) => {
    if (!activeRoute) return;
    setActivePass(passNumber);
    setSelection(locateAtChainage(activeRoute, chainageM, passNumber));
  };

  const flyCameraTo = (lat: number, lon: number, zoom = 15) => {
    setFlyToTrigger({ lat, lon, zoom, nonce: Date.now() + Math.random() });
  };

  const handleSelectMarker = (marker: RouteMarker) => {
    setSelectedMarkerId(marker.id);
    handleSelectChainage(marker.chainageM, marker.passNumber || 1);
    flyCameraTo(marker.latitude, marker.longitude, 15);
  };

  const handleExportGpx = () => {
    if (!activePub || !activeRoute) return;
    const gpx = exportSanitizedGpx(activeRoute.canonicalGeometry, {
      title: `${activePub.raceName} ${activePub.distanceLabel}`,
      markers: activeMarkers,
    });
    const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activePub.raceId}-${activePub.distanceId}-v${activePub.versionNumber}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activePub || !activeRoute || !selection || !analytics || !terrainSummary) {
    if (!race.routeGpxUrl) return null;
    return (
      <div className="space-y-3">
        <a
          href={`/?race=${encodeURIComponent(race.id)}&view=course`}
          onClick={(e) => {
            e.preventDefault();
            window.dispatchEvent(
              new CustomEvent('racepulse:navigate', {
                detail: { url: `/?race=${encodeURIComponent(race.id)}&view=course` },
              }),
            );
          }}
          className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-red-700 dark:text-red-400"
        >
          <span>Explore course and elevation</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
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

  const courseUrl = buildRaceCoursePath(activePub.raceId, activePub.distanceId);

  return (
    <section
      aria-label={`${race.name} read-only course map and running statistics`}
      className={`rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] ${
        compact ? 'p-3 space-y-3' : 'p-3 sm:p-4 space-y-3.5'
      } overflow-x-clip`}
    >
      {/* Header + Distance Switcher + Actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm sm:text-base font-display font-semibold text-[var(--text-primary)]">
            <Flag className="h-4 w-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span className="truncate">Official Course Map &amp; Stats</span>
          </h3>
          <p className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
            {activePub.distanceLabel} (v{activePub.versionNumber}) · Road {terrainSummary.roadPct}% / Trail {terrainSummary.offRoadPct}% · Effort {analytics.difficultyIndex}/100
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportGpx}
            className="inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50"
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
            className="inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-600"
          >
            <span>Full Route Explorer</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Horizontal Divide-X Telemetry Strip (< 96px, zero stacked KPI cards) */}
      <div className="overflow-x-auto racepulse-horizontal-scroll rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
        <dl
          className="grid grid-flow-col auto-cols-[minmax(108px,1fr)] divide-x divide-[var(--border-subtle)]"
          aria-label="Key race course statistics"
        >
          <div className="px-2.5 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Distance</dt>
            <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
              {activeRoute.distanceKm.toFixed(2)} km
            </dd>
          </div>
          <div className="px-2.5 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Elev Gain / Loss</dt>
            <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
              {activeRoute.elevationProvenance.status === 'unavailable'
                ? 'Unavailable'
                : `+${Math.round(activeRoute.elevationGainM)}m / -${Math.round(activeRoute.elevationLossM)}m`}
            </dd>
          </div>
          <div className="px-2.5 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Alt &amp; Grade</dt>
            <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
              {terrainSummary.minEleM !== null && terrainSummary.maxEleM !== null
                ? `${terrainSummary.minEleM}-${terrainSummary.maxEleM}m (${terrainSummary.maxGradePct}%)`
                : `Max ${terrainSummary.maxGradePct}%`}
            </dd>
          </div>
          <div className="px-2.5 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Surface</dt>
            <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
              {terrainSummary.roadPct}% Rd · {terrainSummary.offRoadPct}% Trl
            </dd>
          </div>
          <div className="px-2.5 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
              Est. ({formatPaceMinKm(targetPaceMinPerKm)})
            </dt>
            <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
              {formatDurationMinutes(analytics.estimatedFinishMinutes)} ({formatPaceMinKm(analytics.averageGapPaceMinPerKm)} GAP)
            </dd>
          </div>
        </dl>
      </div>

      {courses.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Course distance maps">
          {courses.map((c) => {
            const active = c.distanceId === activePub.distanceId;
            return (
              <button
                key={c.distanceId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedDistanceId(c.distanceId)}
                className={`min-h-11 sm:min-h-9 rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
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

      {/* Map View Switcher (Strictly Read-Only for Runners) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Course layer color mode">
          {(
            [
              ['surface', 'Ground Surface'],
              ['gradient', 'Slope Heatmap'],
              ['default', 'Route Line'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={colorMode === mode}
              onClick={() => setColorMode(mode)}
              className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
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
            aria-pressed={satelliteEnabled}
            onClick={() => setSatelliteEnabled((v) => !v)}
            className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
              satelliteEnabled
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
            }`}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            Satellite
          </button>
          <button
            type="button"
            aria-pressed={terrain3DEnabled}
            onClick={() => setTerrain3DEnabled((v) => !v)}
            className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
              terrain3DEnabled
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
            }`}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            3D Terrain
          </button>
        </div>
      </div>

      {/* Synchronized Interactive Map Canvas (editable={false}) */}
      <RouteMapCanvas
        route={activeRoute}
        routeIdentityKey={activePub.id}
        markers={activeMarkers}
        selection={selection}
        selectedMarkerId={selectedMarkerId}
        activePass={activePass}
        theme={theme}
        colorMode={colorMode}
        editable={false}
        imageryEnabled={satelliteEnabled}
        onToggleImagery={setSatelliteEnabled}
        is3DEnabled={terrain3DEnabled}
        onToggle3D={setTerrain3DEnabled}
        provenance={activePub.mapLayerProvenance}
        courseScopeId={`${activePub.raceId}_${activePub.distanceId}`}
        heightClassName={compact ? 'h-[260px] sm:h-[320px]' : 'h-[320px] sm:h-[380px]'}
        flyToTrigger={flyToTrigger}
        onSelectChainage={(chainageM, passNum) => handleSelectChainage(chainageM, passNum)}
        onSelectMarker={handleSelectMarker}
        onMapClickCoordinate={(_lat, _lon, proj) => handleSelectChainage(proj.chainageM, proj.passNumber)}
      />

      {/* Strava-Style Live Scrub Readout Strip */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
          <span>
            <strong className="text-[var(--text-primary)]">
              {(selection.chainageM / 1000).toFixed(2)} km
            </strong>{' '}
            <span className="text-[var(--text-secondary)]">marker</span>
          </span>
          <span>
            <strong className="text-[var(--text-primary)]">
              {selection.elevation !== undefined ? `${Math.round(selection.elevation)} m` : 'Unavailable'}
            </strong>{' '}
            <span className="text-[var(--text-secondary)]">elev</span>
          </span>
          <span>
            <strong className="text-[var(--text-primary)]">
              {selection.gradePct !== undefined ? `${selection.gradePct > 0 ? '+' : ''}${selection.gradePct.toFixed(1)}%` : '0.0%'}
            </strong>{' '}
            <span className="text-[var(--text-secondary)]">slope</span>
          </span>
        </div>
        <span className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-0.5 font-semibold text-[var(--text-primary)]">
          Ground: {cursorSurfaceLabel}
        </span>
      </div>

      <RouteElevationProfile
        route={activeRoute}
        selectedChainageM={selection.chainageM}
        onSelectChainage={handleSelectChainage}
        markers={activeMarkers}
        selectedMarkerId={selectedMarkerId}
        onSelectMarker={handleSelectMarker}
        activePass={activePass}
      />

      {/* Strava-Style Surface Mix & Grade Distribution + Runner Gear & Pace Planner */}
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3.5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Mountain className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              Surface &amp; Ground Breakdown
            </h4>
            <span className="font-mono font-semibold text-[var(--text-secondary)]">
              Road {terrainSummary.roadPct}% · Off-Road {terrainSummary.offRoadPct}%
            </span>
          </div>

          {/* Stacked Proportion Bar */}
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

          <div className="space-y-2">
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

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3.5 space-y-3 text-xs">
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
                  className={`min-h-7 rounded-lg border px-2 font-mono font-semibold ${
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
              <span>Target pace (min/km)</span>
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
                className="min-h-8 w-16 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 font-mono text-xs text-[var(--text-primary)]"
              />
            </label>
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              Finish: {formatDurationMinutes(analytics.estimatedFinishMinutes)} ({formatPaceMinKm(analytics.averageGapPaceMinPerKm)} GAP)
            </span>
          </div>

          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 space-y-1">
            <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Footprints className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              {analytics.gear.shoeCategory}
            </p>
            <p className="text-[var(--text-secondary)]">
              Lugs: <strong className="text-[var(--text-primary)]">{analytics.gear.lugDepthMm}</strong> ·{' '}
              Poles: <strong className="text-[var(--text-primary)]">{analytics.gear.polesRecommended ? 'Recommended' : 'Optional'}</strong> ·{' '}
              Min carry: <strong className="font-mono text-[var(--text-primary)]">{analytics.gear.minimumWaterCarryMl} mL</strong>
            </p>
          </div>
          {analytics.gear.reasons.map((reason, idx) => (
            <p key={idx} className="text-[var(--text-secondary)] leading-relaxed">
              {reason}
            </p>
          ))}

          {analytics.climbs.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                Categorized Climbs ({analytics.climbs.length})
              </p>
              <div className="space-y-1">
                {analytics.climbs.slice(0, compact ? 3 : 5).map((climb) => (
                  <button
                    key={climb.id}
                    type="button"
                    onClick={() => {
                      handleSelectChainage(climb.startKm * 1000, 1);
                      flyCameraTo(climb.peakLat, climb.peakLon, 15);
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-1.5 text-left hover:border-red-600/50"
                  >
                    <span className="truncate font-semibold text-[var(--text-primary)]">
                      <span className="mr-1.5 inline-block rounded bg-red-700 px-1.5 py-0.5 text-[11px] text-white">
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
            </div>
          )}
        </div>
      </div>

      {/* Aid Stations, Water & GAP Timing Splits */}
      {activeMarkers.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)]/70 p-3.5 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              Checkpoints, Hydration &amp; Predicted Split Times ({activeMarkers.length})
            </h4>
          </div>
          <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {activeMarkers
              .slice()
              .sort((a, b) => a.chainageM - b.chainageM)
              .map((marker) => {
                const split = analytics.gapSplits.find((s) => s.markerId === marker.id);
                return (
                  <button
                    key={marker.id}
                    type="button"
                    onClick={() => handleSelectMarker(marker)}
                    className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                      selectedMarkerId === marker.id
                        ? 'border-red-600 bg-red-700/10'
                        : 'border-[var(--border-default)] bg-[var(--surface-card)] hover:border-red-600/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-primary)] truncate">{marker.name}</p>
                      <p className="text-[var(--text-secondary)] truncate">
                        {marker.services.length > 0 ? marker.services.join(', ') : marker.kind}
                        {split ? ` · Est ${formatDurationMinutes(split.elapsedMinutes)}` : ''}
                        {split?.clockTime ? ` (${split.clockTime})` : ''}
                      </p>
                      {marker.cutoffMinutes !== undefined && split?.cutoffBufferMinutes !== undefined && (
                        <p
                          className={`mt-0.5 font-semibold ${
                            split.cutoffStatus === 'safe'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : split.cutoffStatus === 'caution'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          Cutoff {marker.cutoffMinutes}m · {split.cutoffBufferMinutes >= 0 ? `+${split.cutoffBufferMinutes}m buffer` : `${split.cutoffBufferMinutes}m over cutoff`}
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
      )}
    </section>
  );
}
