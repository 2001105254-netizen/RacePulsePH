import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Compass,
  Crosshair,
  Focus,
  Globe,
  Layers,
  LocateFixed,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { ProcessedRoute } from '../../lib/routes/geometry';
import { projectCoordinateToRoute } from '../../lib/routes/anchoring';
import {
  applySatelliteHybridRoadStyling,
  enhanceBasemapStyleForOceanAndHybrid,
  findFirstVectorOverlayLayerId,
  getMapProviderConfig,
  supportsWebGL,
  type MapProviderId,
  type MapThemeMode,
} from '../../lib/routes/mapProviders';
import {
  COPERNICUS_TERRAIN_RELEASE,
  ensurePhilippinesMapProtocolRegistered,
  recordCourseFirstLoadMs,
  registerCourseCorridorForTiles,
  setSimulateTileFailure,
} from '../../lib/routes/philippinesMapTiles';
import type {
  CanonicalSegmentInput,
  CourseMapLayerProvenance,
  RouteAnchorCandidate,
  RouteMarker,
  RouteSelectionState,
  RouteSurfaceType,
  TerrainScenarioTag,
} from '../../lib/routes/types';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
  ensurePhilippinesMapProtocolRegistered(maplibregl);
}

export type MapDrawMode = 'view' | 'set-start' | 'paint' | 'draw' | 'erase' | 'edit' | 'place-marker';
export type MapColorMode = 'default' | 'gradient' | 'surface';

const PAINT_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="6" cy="22" r="4" fill="#ea580c" stroke="#ffffff" stroke-width="1.5"/><path d="M8 16L22 2l4 4L12 20z" fill="#ffffff" stroke="#18181b" stroke-width="1.5"/></svg>',
  )}") 6 22, crosshair`;

const ERASE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M16 4l8 8-10 10H6l-2-2 12-16z" fill="#fca5a5" stroke="#991b1b" stroke-width="1.8"/><circle cx="14" cy="14" r="2" fill="#dc2626"/></svg>',
  )}") 10 20, cell`;

interface RouteMapCanvasProps {
  route: ProcessedRoute;
  routeIdentityKey?: string;
  comparisonRoute?: ProcessedRoute | null;
  comparisonLabel?: string;
  markers: RouteMarker[];
  selection: RouteSelectionState;
  selectedMarkerId?: string;
  activePass?: number;
  theme: MapThemeMode;
  colorMode?: MapColorMode;
  heightClassName?: string;
  editable?: boolean;
  drawMode?: MapDrawMode;
  eraseRadiusM?: number;
  paintSpacingM?: number;
  mapPanLocked?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  studioOverlaySlot?: React.ReactNode;
  gpsLivePosition?: { lat: number; lon: number; accuracyM: number } | null;
  locateStatus?: 'idle' | 'locating' | 'active' | 'denied' | 'unavailable' | 'error';
  onLocateMe?: () => void;
  onCenterOnUser?: () => void;
  selectedMarkerOverlay?: React.ReactNode;
  imageryEnabled?: boolean;
  onToggleImagery?: (enabled: boolean) => void;
  is3DEnabled?: boolean;
  onToggle3D?: (enabled: boolean) => void;
  provenance?: CourseMapLayerProvenance;
  courseScopeId?: string;
  simulateTileError?: boolean;
  onSelectChainage?: (chainageM: number, passNumber?: number) => void;
  onSelectMarker?: (marker: RouteMarker) => void;
  onMapClickCoordinate?: (
    lat: number,
    lon: number,
    projection: {
      chainageM: number;
      passNumber: number;
      candidates: RouteAnchorCandidate[];
    },
  ) => void;
  onDrawnSegmentsChange?: (segments: CanonicalSegmentInput[]) => void;
  onPaintStrokeCommit?: (points: Array<{ lat: number; lon: number }>) => void;
  onEraseAtCoordinate?: (lat: number, lon: number) => void;
  cursorVisible?: boolean;
  onPlaceStartPoint?: (lat: number, lon: number) => Promise<boolean> | boolean | void;
  onRemoveStartPoint?: () => void;
  onRequestStartPointMode?: () => void;
  flyToTrigger?: { lat: number; lon: number; zoom?: number; nonce: number } | null;
}

function markerColorForKind(kind: RouteMarker['kind']): { bg: string; label: string } {
  switch (kind) {
    case 'start':
      return { bg: '#15803d', label: 'S' };
    case 'finish':
      return { bg: '#b91c1c', label: 'F' };
    case 'timing':
      return { bg: '#1d4ed8', label: 'T' };
    case 'aid':
      return { bg: '#c2410c', label: 'A' };
    case 'water':
      return { bg: '#0369a1', label: 'W' };
    case 'medical':
      return { bg: '#be123c', label: '+' };
    case 'hazard':
      return { bg: '#a16207', label: '!' };
    case 'landmark':
      return { bg: '#7c2d12', label: 'P' };
  }
}

function buildRouteGeoJson(route: ProcessedRoute, drawnOnly: boolean) {
  return {
    type: 'FeatureCollection' as const,
    features: route.displaySegments
      .filter((seg) => seg.length >= 2 && (drawnOnly ? seg[0].sourceKind === 'drawn' : seg[0].sourceKind !== 'drawn'))
      .map((seg, idx) => ({
        type: 'Feature' as const,
        properties: { segmentIndex: idx, sourceKind: seg[0].sourceKind },
        geometry: {
          type: 'LineString' as const,
          coordinates: seg.map((pt) => [pt.longitude, pt.latitude]),
        },
      })),
  };
}

function colorForGradientPct(gradePct: number | undefined): string {
  const g = gradePct ?? 0;
  if (g < -3) return '#0284c7';
  if (g <= 3) return '#16a34a';
  if (g <= 6) return '#eab308';
  if (g <= 10) return '#ea580c';
  return '#b91c1c';
}

function colorForSurface(
  surface: RouteSurfaceType | undefined,
  scenario: TerrainScenarioTag | undefined,
  theme: MapThemeMode,
): string {
  if (scenario === 'mud-hazard' || scenario === 'river-crossing' || surface === 'technical') {
    return '#dc2626';
  }
  if (scenario === 'stairs' || surface === 'boardwalk') return '#0284c7';
  if (surface === 'gravel') return '#d97706';
  if (surface === 'dirt') return '#b45309';
  if (surface === 'grass') return '#16a34a';
  if (surface === 'singletrack') return '#15803d';
  return theme === 'dark' ? '#d4d4d8' : '#3f3f46';
}

function buildColorStyledGeoJson(
  route: ProcessedRoute,
  colorMode: MapColorMode,
  theme: MapThemeMode,
) {
  if (colorMode === 'default') {
    return { type: 'FeatureCollection' as const, features: [] };
  }
  const features: Array<{
    type: 'Feature';
    properties: { color: string };
    geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] };
  }> = [];

  for (const seg of route.displaySegments) {
    for (let i = 1; i < seg.length; i += 1) {
      const a = seg[i - 1];
      const b = seg[i];
      const color =
        colorMode === 'gradient'
          ? colorForGradientPct(b.gradePct ?? a.gradePct)
          : colorForSurface(b.surfaceType ?? a.surfaceType, b.terrainScenario ?? a.terrainScenario, theme);
      features.push({
        type: 'Feature',
        properties: { color },
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.longitude, a.latitude],
            [b.longitude, b.latitude],
          ],
        },
      });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}

function SchematicMapFallback({
  route,
  markers,
  selection,
  selectedMarkerId,
  cursorVisible = true,
  editable = false,
  drawMode = 'view',
  gpsLivePosition,
  locateStatus = 'idle',
  onLocateMe,
  onCenterOnUser,
  onSelectMarker,
  onSelectChainage,
  onPlaceStartPoint,
}: {
  route: ProcessedRoute;
  markers: RouteMarker[];
  selection: RouteSelectionState;
  selectedMarkerId?: string;
  cursorVisible?: boolean;
  editable?: boolean;
  drawMode?: MapDrawMode;
  gpsLivePosition?: { lat: number; lon: number; accuracyM: number } | null;
  locateStatus?: 'idle' | 'locating' | 'active' | 'denied' | 'unavailable' | 'error';
  onLocateMe?: () => void;
  onCenterOnUser?: () => void;
  onSelectMarker?: (marker: RouteMarker) => void;
  onSelectChainage?: (chainageM: number, passNumber?: number) => void;
  onPlaceStartPoint?: (lat: number, lon: number) => Promise<boolean> | boolean | void;
}) {
  const width = 800;
  const height = 420;
  const pad = 36;
  const lonSpan = Math.max(0.0001, route.bounds.east - route.bounds.west);
  const latSpan = Math.max(0.0001, route.bounds.north - route.bounds.south);
  const scale = Math.min((width - pad * 2) / lonSpan, (height - pad * 2) / latSpan);

  const project = (lat: number, lon: number) => ({
    x: pad + (lon - route.bounds.west) * scale,
    y: height - pad - (lat - route.bounds.south) * scale,
  });

  const selPt = project(selection.latitude, selection.longitude);
  const gpsPtRaw = gpsLivePosition ? project(gpsLivePosition.lat, gpsLivePosition.lon) : null;
  const gpsPt = gpsPtRaw
    ? {
        x: Math.max(18, Math.min(width - 18, gpsPtRaw.x)),
        y: Math.max(18, Math.min(height - 18, gpsPtRaw.y)),
      }
    : null;
  const canClickPlaceStart =
    editable &&
    Boolean(onPlaceStartPoint) &&
    (drawMode === 'set-start' || (drawMode === 'view' && Boolean(route.canonicalGeometry.isCanvasCleared)));

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)]">
        <span>Course geometry overview (WebGL basemap unavailable in this environment)</span>
        <div className="flex items-center gap-2">
          {onLocateMe && (
            <button
              type="button"
              onClick={locateStatus === 'active' && onCenterOnUser ? onCenterOnUser : onLocateMe}
              aria-pressed={locateStatus === 'active'}
              className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 font-semibold ${
                locateStatus === 'active'
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              {locateStatus === 'locating' ? 'Locating...' : locateStatus === 'active' ? 'My spot active' : 'My location'}
            </button>
          )}
          <span className="font-mono font-semibold text-[var(--text-primary)]">{route.distanceKm.toFixed(2)} km</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`h-full w-full flex-1 ${canClickPlaceStart ? 'cursor-crosshair' : ''}`}
        role="img"
        aria-label="Course geometry schematic fallback"
        onClick={(ev) => {
          if (!canClickPlaceStart || !onPlaceStartPoint) return;
          const rect = ev.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const svgX = ((ev.clientX - rect.left) / rect.width) * width;
          const svgY = ((ev.clientY - rect.top) / rect.height) * height;
          const lon = route.bounds.west + (svgX - pad) / scale;
          const lat = route.bounds.south + (height - pad - svgY) / scale;
          void onPlaceStartPoint(lat, lon);
        }}
      >
        {route.displaySegments.map((seg, idx) => {
          const d = seg
            .map((pt, i) => {
              const p = project(pt.latitude, pt.longitude);
              return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke={seg[0]?.sourceKind === 'drawn' ? '#ea580c' : '#dc2626'}
              strokeWidth={4}
              strokeDasharray={seg[0]?.sourceKind === 'drawn' ? '8 6' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {markers.map((marker) => {
          const p = project(marker.latitude, marker.longitude);
          const color = markerColorForKind(marker.kind);
          const isSelected = marker.id === selectedMarkerId;
          const photoCount = marker.photos?.length || 0;
          return (
            <g
              key={marker.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectMarker?.(marker);
                onSelectChainage?.(marker.chainageM, marker.passNumber);
              }}
            >
              <circle r={isSelected ? 12 : 9} fill={color.bg} stroke="#ffffff" strokeWidth={2} />
              <text textAnchor="middle" dy="0.35em" fill="#ffffff" fontSize="10" fontWeight="600">
                {color.label}
              </text>
              {photoCount > 0 && (
                <circle cx={8} cy={-8} r={4} fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} />
              )}
            </g>
          );
        })}
        {gpsPt && (
          <g transform={`translate(${gpsPt.x}, ${gpsPt.y})`}>
            <circle r={13} fill="#2563eb" fillOpacity={0.22} stroke="#2563eb" strokeWidth={2} />
            <circle r={5.5} fill="#2563eb" stroke="#ffffff" strokeWidth={2} />
          </g>
        )}
        {cursorVisible && (
          <circle cx={selPt.x} cy={selPt.y} r={8} fill="#ffffff" stroke="#dc2626" strokeWidth={3} />
        )}
      </svg>
    </div>
  );
}

export default function RouteMapCanvas({
  route,
  routeIdentityKey,
  comparisonRoute,
  comparisonLabel,
  markers,
  selection,
  selectedMarkerId,
  activePass = 1,
  theme,
  colorMode = 'default',
  heightClassName = 'h-[360px] lg:h-[460px]',
  editable = false,
  drawMode = 'view',
  eraseRadiusM = 50,
  paintSpacingM = 12,
  mapPanLocked = false,
  isFullscreen,
  onToggleFullscreen,
  studioOverlaySlot,
  gpsLivePosition,
  locateStatus = 'idle',
  onLocateMe,
  onCenterOnUser,
  selectedMarkerOverlay,
  imageryEnabled,
  onToggleImagery,
  is3DEnabled,
  onToggle3D,
  provenance,
  courseScopeId,
  simulateTileError = false,
  onSelectChainage,
  onSelectMarker,
  onMapClickCoordinate,
  onDrawnSegmentsChange,
  onPaintStrokeCommit,
  onEraseAtCoordinate,
  cursorVisible = true,
  onPlaceStartPoint,
  onRemoveStartPoint,
  onRequestStartPointMode,
  flyToTrigger,
}: RouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mountStartMsRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);
  const markerInstancesRef = useRef<maplibregl.Marker[]>([]);
  const cursorMarkerRef = useRef<maplibregl.Marker | null>(null);
  const cursorButtonRef = useRef<HTMLButtonElement | null>(null);
  const cursorModeRef = useRef<'readonly' | 'editable' | null>(null);
  const cursorDraggedRef = useRef(false);
  const gpsLiveMarkerRef = useRef<maplibregl.Marker | null>(null);
  const terraDrawRef = useRef<{
    setMode: (mode: string) => void;
    getSnapshot: () => Array<{
      geometry: { type: string; coordinates: number[][] };
      properties?: Record<string, unknown>;
    }>;
    clear: () => void;
    stop: () => void;
    addFeatures: (features: unknown[]) => unknown;
    undo?: () => boolean;
    redo?: () => boolean;
  } | null>(null);
  const terraDrawStyleNonceRef = useRef<number>(0);

  const [webglReady] = useState(() => supportsWebGL());
  const [providerId, setProviderId] = useState<MapProviderId>('openfreemap');
  const [basemapNotice, setBasemapNotice] = useState<string>('');
  const [tileErrorNotice, setTileErrorNotice] = useState<string>('');
  const [styleLoadedNonce, setStyleLoadedNonce] = useState(0);
  const [internalImagery, setInternalImagery] = useState(false);
  const [internal3D, setInternal3D] = useState(false);
  const [terrainNotice, setTerrainNotice] = useState('');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [mapFatalError, setMapFatalError] = useState(false);
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [startMenuCoords, setStartMenuCoords] = useState<{ x: number; y: number } | null>(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');
  const [hoverReticle, setHoverReticle] = useState<{
    x: number;
    y: number;
    pixelDiameter: number;
  } | null>(null);

  const activeImagery = imageryEnabled ?? internalImagery;
  const active3D = is3DEnabled ?? internal3D;
  const effectiveScopeId = courseScopeId || routeIdentityKey || 'course';

  const toggleImagery = useCallback(() => {
    const next = !activeImagery;
    if (onToggleImagery) onToggleImagery(next);
    else setInternalImagery(next);
  }, [activeImagery, onToggleImagery]);

  const toggle3D = useCallback(() => {
    const next = !active3D;
    if (onToggle3D) onToggle3D(next);
    else setInternal3D(next);
  }, [active3D, onToggle3D]);

  useEffect(() => {
    registerCourseCorridorForTiles(effectiveScopeId, route.canonicalGeometry);
  }, [effectiveScopeId, route.canonicalGeometry]);

  useEffect(() => {
    setSimulateTileFailure(simulateTileError);
    if (!simulateTileError) {
      setTileErrorNotice('');
    }
    return () => {
      setSimulateTileFailure(false);
    };
  }, [simulateTileError]);

  const fullscreenActive = isFullscreen ?? internalFullscreen;
  const toggleFullscreen = useCallback(() => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    } else {
      setInternalFullscreen((v) => !v);
    }
  }, [onToggleFullscreen]);

  const maxGradePct = useMemo(() => {
    if (route.canonicalGeometry.isCanvasCleared) return 0;
    return route.points.reduce((maxG, pt) => Math.max(maxG, Math.abs(pt.gradePct ?? 0)), 0);
  }, [route.points, route.canonicalGeometry.isCanvasCleared]);

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const latestCallbacksRef = useRef({
    route,
    selection,
    activePass,
    drawMode,
    editable,
    cursorVisible,
    startMenuOpen,
    onSelectChainage,
    onSelectMarker,
    onMapClickCoordinate,
    onDrawnSegmentsChange,
    onPaintStrokeCommit,
    onEraseAtCoordinate,
    onPlaceStartPoint,
    onRemoveStartPoint,
    onRequestStartPointMode,
  });
  latestCallbacksRef.current = {
    route,
    selection,
    activePass,
    drawMode,
    editable,
    cursorVisible,
    startMenuOpen,
    onSelectChainage,
    onSelectMarker,
    onMapClickCoordinate,
    onDrawnSegmentsChange,
    onPaintStrokeCommit,
    onEraseAtCoordinate,
    onPlaceStartPoint,
    onRemoveStartPoint,
    onRequestStartPointMode,
  };

  const providerConfig = useMemo(
    () => getMapProviderConfig(theme, providerId, route.bounds, effectiveScopeId),
    [theme, providerId, route.bounds, effectiveScopeId],
  );

  const fitRouteBounds = useCallback((immediate = false) => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      [
        [route.bounds.west, route.bounds.south],
        [route.bounds.east, route.bounds.north],
      ],
      { padding: 48, duration: immediate || reducedMotion ? 0 : 240, maxZoom: 16 },
    );
  }, [route.bounds, reducedMotion]);

  const syncRouteLayers = useCallback((map: maplibregl.Map) => {
    if (!map.getStyle()) return;

    const gpxData = buildRouteGeoJson(route, false);
    const drawnData = buildRouteGeoJson(route, true);
    const compData = comparisonRoute ? buildRouteGeoJson(comparisonRoute, false) : { type: 'FeatureCollection' as const, features: [] };
    const coloredData = buildColorStyledGeoJson(route, colorMode, theme);

    const ensureGeoJsonSource = (id: string, data: GeoJSON.FeatureCollection) => {
      const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(id, { type: 'geojson', data });
      }
    };

    ensureGeoJsonSource('rp-route-comp', compData as GeoJSON.FeatureCollection);
    ensureGeoJsonSource('rp-route-gpx', gpxData as GeoJSON.FeatureCollection);
    ensureGeoJsonSource('rp-route-drawn', drawnData as GeoJSON.FeatureCollection);
    ensureGeoJsonSource('rp-route-colored', coloredData as GeoJSON.FeatureCollection);
    if (!map.getSource('rp-paint-preview')) {
      map.addSource('rp-paint-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!map.getLayer('rp-route-comp-line')) {
      map.addLayer({
        id: 'rp-route-comp-line',
        type: 'line',
        source: 'rp-route-comp',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': theme === 'dark' ? '#38bdf8' : '#0284c7',
          'line-width': 3.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.85,
        },
      });
    }

    if (!map.getLayer('rp-route-outer-halo')) {
      map.addLayer({
        id: 'rp-route-outer-halo',
        type: 'line',
        source: 'rp-route-gpx',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#09090b',
          'line-width': activeImagery ? 10 : 8,
          'line-opacity': activeImagery ? 0.94 : 0,
        },
      });
    } else {
      map.setPaintProperty('rp-route-outer-halo', 'line-width', activeImagery ? 10 : 8);
      map.setPaintProperty('rp-route-outer-halo', 'line-opacity', activeImagery ? 0.94 : 0);
    }

    if (!map.getLayer('rp-route-casing')) {
      map.addLayer({
        id: 'rp-route-casing',
        type: 'line',
        source: 'rp-route-gpx',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': activeImagery ? '#ffffff' : theme === 'dark' ? '#09090b' : '#ffffff',
          'line-width': activeImagery ? 7 : 8,
          'line-opacity': activeImagery ? 0.98 : 0.92,
        },
      });
    } else {
      map.setPaintProperty('rp-route-casing', 'line-color', activeImagery ? '#ffffff' : theme === 'dark' ? '#09090b' : '#ffffff');
      map.setPaintProperty('rp-route-casing', 'line-width', activeImagery ? 7 : 8);
    }

    if (!map.getLayer('rp-route-line')) {
      map.addLayer({
        id: 'rp-route-line',
        type: 'line',
        source: 'rp-route-gpx',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': activeImagery ? '#ffde59' : theme === 'dark' ? '#ff453a' : '#dc2626',
          'line-width': 4.5,
        },
      });
    } else {
      map.setPaintProperty(
        'rp-route-line',
        'line-color',
        activeImagery ? '#ffde59' : theme === 'dark' ? '#ff453a' : '#dc2626',
      );
    }

    if (!map.getLayer('rp-route-drawn-casing')) {
      map.addLayer({
        id: 'rp-route-drawn-casing',
        type: 'line',
        source: 'rp-route-drawn',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': theme === 'dark' ? '#09090b' : '#ffffff',
          'line-width': 8,
          'line-opacity': 0.92,
        },
      });
    }

    if (!map.getLayer('rp-route-drawn-line')) {
      map.addLayer({
        id: 'rp-route-drawn-line',
        type: 'line',
        source: 'rp-route-drawn',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ea580c',
          'line-width': 4.5,
          'line-dasharray': [2, 1.5],
        },
      });
    }

    if (!map.getLayer('rp-route-colored-line')) {
      map.addLayer({
        id: 'rp-route-colored-line',
        type: 'line',
        source: 'rp-route-colored',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: colorMode === 'default' ? 'none' : 'visible' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
        },
      });
    } else {
      map.setLayoutProperty('rp-route-colored-line', 'visibility', colorMode === 'default' ? 'none' : 'visible');
    }

    const stdVis = colorMode === 'default' ? 'visible' : 'none';
    if (map.getLayer('rp-route-line')) map.setLayoutProperty('rp-route-line', 'visibility', stdVis);
    if (map.getLayer('rp-route-drawn-line')) map.setLayoutProperty('rp-route-drawn-line', 'visibility', stdVis);

    if (!map.getLayer('rp-paint-preview-line')) {
      map.addLayer({
        id: 'rp-paint-preview-line',
        type: 'line',
        source: 'rp-paint-preview',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#f97316',
          'line-width': 6,
          'line-opacity': 0.9,
        },
      });
    }
  }, [route, comparisonRoute, theme, colorMode, activeImagery]);

  const syncRouteLayersRef = useRef(syncRouteLayers);
  syncRouteLayersRef.current = syncRouteLayers;
  const fitRouteBoundsRef = useRef(fitRouteBounds);
  fitRouteBoundsRef.current = fitRouteBounds;

  // Initialize MapLibre once immediately with the local WGS84 reference grid,
  // then progressively upgrade to OpenFreeMap tiles without blocking first paint.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !webglReady) return;

    let cancelled = false;
    let map: maplibregl.Map | null = null;

    try {
      map = new maplibregl.Map({
        container: el,
        style: providerConfig.fallbackStyle,
        center: [
          (route.bounds.west + route.bounds.east) / 2,
          (route.bounds.south + route.bounds.north) / 2,
        ],
        zoom: 13,
        maxZoom: 19,
        attributionControl: false,
        cooperativeGestures: false,
      });
    } catch {
      setMapFatalError(true);
      return;
    }

    mapRef.current = map;

    map.on('error', (ev) => {
      if (cancelled || !map) return;
      const sourceId = (ev as { sourceId?: string })?.sourceId;
      if (
        sourceId === 'rp-sentinel2-imagery' ||
        sourceId === 'rp-terrain-dem' ||
        sourceId === 'rp-terrain-hillshade-dem'
      ) {
        setTileErrorNotice('Satellite or terrain tiles failed to load. GPX course and elevation profile remain usable.');
        return;
      }
      if (!map.isStyleLoaded()) {
        setProviderId((curr) => (curr === 'openfreemap' ? 'local-fallback' : curr));
        setBasemapNotice('External basemap tiles unavailable. Showing Philippine archipelago reference.');
      }
    });

    map.on('style.load', () => {
      if (!map || cancelled) return;
      syncRouteLayersRef.current(map);
      setStyleLoadedNonce((n) => n + 1);
    });

    map.on('load', () => {
      if (!map || cancelled) return;
      syncRouteLayersRef.current(map);
      fitRouteBoundsRef.current(true);
      if (typeof performance !== 'undefined' && mountStartMsRef.current > 0) {
        recordCourseFirstLoadMs(effectiveScopeId, performance.now() - mountStartMsRef.current);
      }
      setStyleLoadedNonce((n) => n + 1);
    });

    map.on('click', (ev) => {
      const {
        route: currentRoute,
        activePass: currentPass,
        drawMode: currentDrawMode,
        editable: isEditable,
        startMenuOpen: isStartMenuOpen,
        onSelectChainage: selectChainageCb,
        onMapClickCoordinate: clickCb,
        onPlaceStartPoint: placeStartCb,
      } = latestCallbacksRef.current;

      if (isStartMenuOpen) {
        setStartMenuOpen(false);
        return;
      }

      if (currentDrawMode === 'set-start' && isEditable && placeStartCb) {
        void placeStartCb(ev.lngLat.lat, ev.lngLat.lng);
        setSrAnnouncement('Starting point placed on map.');
        return;
      }

      if (
        currentDrawMode === 'view' &&
        isEditable &&
        currentRoute.canonicalGeometry.isCanvasCleared &&
        placeStartCb
      ) {
        void placeStartCb(ev.lngLat.lat, ev.lngLat.lng);
        setSrAnnouncement('Starting point placed on map.');
        return;
      }

      if (
        currentDrawMode === 'draw' ||
        currentDrawMode === 'edit' ||
        currentDrawMode === 'paint' ||
        currentDrawMode === 'erase'
      ) {
        return;
      }

      const projected = projectCoordinateToRoute(
        currentRoute,
        ev.lngLat.lat,
        ev.lngLat.lng,
        currentPass,
      );
      if (clickCb) {
        clickCb(ev.lngLat.lat, ev.lngLat.lng, {
          chainageM: projected.best.chainageM,
          passNumber: projected.best.passNumber,
          candidates: projected.candidates,
        });
      }
      if (currentDrawMode === 'view' && projected.best.offsetMeters <= 450 && selectChainageCb) {
        selectChainageCb(projected.best.chainageM, projected.best.passNumber);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      map?.resize();
    });
    resizeObserver.observe(el);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (terraDrawRef.current) {
        try {
          terraDrawRef.current.stop();
        } catch {
          // safe cleanup
        }
        terraDrawRef.current = null;
      }
      markerInstancesRef.current.forEach((m) => m.remove());
      markerInstancesRef.current = [];
      cursorMarkerRef.current?.remove();
      cursorMarkerRef.current = null;
      cursorButtonRef.current = null;
      cursorModeRef.current = null;
      gpsLiveMarkerRef.current?.remove();
      gpsLiveMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [webglReady]);

  // Switch map style on theme or provider change without recreating MapLibre instance
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const applyStyle = async () => {
      if (providerId === 'local-fallback' || !providerConfig.styleUrl) {
        map.setStyle(providerConfig.fallbackStyle);
        return;
      }
      try {
        const response = await fetch(providerConfig.styleUrl, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as maplibregl.StyleSpecification;
        if (!cancelled && json && Array.isArray(json.layers)) {
          enhanceBasemapStyleForOceanAndHybrid(json, theme);
          setBasemapNotice('');
          map.setStyle(json);
        }
      } catch {
        if (!cancelled) {
          setProviderId('local-fallback');
          setBasemapNotice('External basemap unavailable. Showing local WGS84 course grid.');
          map.setStyle(providerConfig.fallbackStyle);
        }
      }
    };
    void applyStyle();
    return () => {
      cancelled = true;
    };
  }, [theme, providerId]);

  // Sync route GeoJSON layers whenever route or comparison changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    try {
      syncRouteLayers(map);
    } catch {
      // Wait for next style.load if style swap is mid-flight
    }
  }, [syncRouteLayers, styleLoadedNonce]);

  // Auto-fit when route identity changes (in editable mode, avoid jumping camera during paint/erase strokes)
  const boundsKey = `${route.bounds.west.toFixed(4)}:${route.bounds.east.toFixed(4)}:${route.bounds.south.toFixed(4)}:${route.bounds.north.toFixed(4)}`;
  const autoFitKey = editable
    ? `editable:${routeIdentityKey || 'default'}`
    : `view:${routeIdentityKey || ''}:${boundsKey}`;
  useEffect(() => {
    fitRouteBounds(true);
  }, [autoFitKey]);

  // Trigger map resize cleanly after toggling fullscreen layout or when parent container/dialog resizes
  useEffect(() => {
    const map = mapRef.current;
    const containerEl = containerRef.current;
    if (!map) return;
    const safeResize = () => {
      try {
        map.resize();
      } catch {
        // Map torn down
      }
    };
    const raf = window.requestAnimationFrame(safeResize);
    const timer = window.setTimeout(safeResize, 80);
    const observer =
      typeof ResizeObserver !== 'undefined' && containerEl
        ? new ResizeObserver(() => safeResize())
        : null;
    if (observer && containerEl) observer.observe(containerEl);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [fullscreenActive, styleLoadedNonce]);

  // Escape closes starting point menu or exits fullscreen; holding Spacebar temporarily enables hand pan
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (startMenuOpen) {
          setStartMenuOpen(false);
          return;
        }
        if (fullscreenActive) {
          if (onToggleFullscreen) onToggleFullscreen();
          else setInternalFullscreen(false);
        }
      }
      if (!editable || ev.code !== 'Space') return;
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      ev.preventDefault();
      setSpacePanActive(true);
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') setSpacePanActive(false);
    };
    const onBlur = () => setSpacePanActive(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [editable, fullscreenActive, onToggleFullscreen, startMenuOpen]);

  // Fly/jump to triggered chapter or marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTrigger) return;
    map.easeTo({
      center: [flyToTrigger.lon, flyToTrigger.lat],
      zoom: flyToTrigger.zoom ?? Math.max(map.getZoom(), 14.5),
      duration: reducedMotion ? 0 : 250,
    });
  }, [flyToTrigger, reducedMotion]);

  // On-demand High-Res Satellite imagery overlay + hybrid roads/labels (0 requests until enabled)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (!activeImagery || !providerConfig.imageryTiles) {
      try {
        if (map.getLayer('rp-sentinel2-layer')) map.removeLayer('rp-sentinel2-layer');
        if (map.getSource('rp-sentinel2-imagery')) map.removeSource('rp-sentinel2-imagery');
        applySatelliteHybridRoadStyling(map, false, theme, styleLoadedNonce);
      } catch {
        // Safe cleanup if style swapping
      }
      return;
    }

    try {
      setTileErrorNotice('');
      if (!map.getSource('rp-sentinel2-imagery')) {
        map.addSource('rp-sentinel2-imagery', {
          type: 'raster',
          tiles: providerConfig.imageryTiles,
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        });
      }
      if (!map.getLayer('rp-sentinel2-layer')) {
        const beforeLayer = map.getLayer('rp-terrain-hillshade')
          ? 'rp-terrain-hillshade'
          : findFirstVectorOverlayLayerId(map, 'rp-route-comp-line');
        map.addLayer(
          {
            id: 'rp-sentinel2-layer',
            type: 'raster',
            source: 'rp-sentinel2-imagery',
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 150 },
          },
          beforeLayer,
        );
      }
      applySatelliteHybridRoadStyling(map, true, theme, styleLoadedNonce);
    } catch {
      setTileErrorNotice('Satellite tiles could not initialize. GPX course and elevation profile remain usable.');
    }
  }, [activeImagery, providerConfig.imageryTiles, styleLoadedNonce, theme]);

  // 2D / 3D Copernicus GLO-30 (2024_1) Terrain toggle (0 DEM requests until enabled)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    if (!active3D) {
      try {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer('rp-terrain-hillshade')) map.removeLayer('rp-terrain-hillshade');
        if (map.getSource('rp-terrain-hillshade-dem')) map.removeSource('rp-terrain-hillshade-dem');
        if (map.getSource('rp-terrain-dem')) map.removeSource('rp-terrain-dem');
      } catch {
        // ignore
      }
      map.easeTo({ pitch: 0, duration: reducedMotion ? 0 : 200 });
      setTerrainNotice('');
      return;
    }

    if (!providerConfig.terrainDemTiles) {
      map.easeTo({ pitch: 45, duration: reducedMotion ? 0 : 200 });
      setTerrainNotice('3D terrain tiles are unavailable; showing tilted 2D view.');
      return;
    }

    const demSpec: maplibregl.RasterDEMSourceSpecification = {
      type: 'raster-dem',
      tiles: providerConfig.terrainDemTiles,
      tileSize: 256,
      encoding: 'terrarium',
      minzoom: 4,
      maxzoom: 12,
    };

    try {
      if (!map.getSource('rp-terrain-dem')) {
        map.addSource('rp-terrain-dem', demSpec);
      }
      if (!map.getSource('rp-terrain-hillshade-dem')) {
        map.addSource('rp-terrain-hillshade-dem', demSpec);
      }
      if (!map.getLayer('rp-terrain-hillshade')) {
        const beforeLayer = findFirstVectorOverlayLayerId(map, 'rp-route-comp-line');
        map.addLayer(
          {
            id: 'rp-terrain-hillshade',
            type: 'hillshade',
            source: 'rp-terrain-hillshade-dem',
            paint: {
              'hillshade-exaggeration': activeImagery ? 0.22 : 0.42,
              'hillshade-shadow-color': theme === 'dark' ? '#09090b' : '#27272a',
            },
          },
          beforeLayer,
        );
      }
      map.setTerrain({ source: 'rp-terrain-dem', exaggeration: 1.0 });
      map.easeTo({ pitch: 45, duration: reducedMotion ? 0 : 220 });
      setTerrainNotice(
        `3D terrain active (${provenance?.terrainRelease || COPERNICUS_TERRAIN_RELEASE}). Official profile uses GPX elevation.`,
      );
    } catch {
      map.easeTo({ pitch: 45, duration: reducedMotion ? 0 : 200 });
      setTerrainNotice('3D terrain could not initialize on this device; showing tilted 2D view.');
    }
  }, [
    active3D,
    activeImagery,
    theme,
    provenance?.terrainRelease,
    providerConfig.terrainDemTiles,
    styleLoadedNonce,
    reducedMotion,
  ]);

  // Render Checkpoint, Start, Finish & Landmark DOM Markers cleanly (no innerHTML)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerInstancesRef.current.forEach((m) => m.remove());
    markerInstancesRef.current = [];

    markers.forEach((marker) => {
      const style = markerColorForKind(marker.kind);
      const isSelected = marker.id === selectedMarkerId;
      const photoCount = marker.photos?.length || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-map-marker';
      btn.style.cssText = [
        `position: relative`,
        `min-width: 28px`,
        `height: 28px`,
        `padding: 0 7px`,
        `border-radius: 9999px`,
        `border: ${isSelected ? '3px solid #ffffff' : '2px solid #ffffff'}`,
        `background: ${style.bg}`,
        `color: #ffffff`,
        `font: 600 11px/1 system-ui, sans-serif`,
        `box-shadow: 0 2px 8px rgba(0,0,0,0.35)`,
        `cursor: pointer`,
        `transform: ${isSelected ? 'scale(1.18)' : 'scale(1)'}`,
      ].join(';');
      btn.textContent =
        marker.passNumber > 1 ? `${style.label}${marker.passNumber}` : style.label;
      if (photoCount > 0) {
        const badge = document.createElement('span');
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = photoCount > 9 ? '+' : String(photoCount);
        badge.style.cssText = [
          'position: absolute',
          'top: -5px',
          'right: -5px',
          'min-width: 14px',
          'height: 14px',
          'padding: 0 3px',
          'border-radius: 9999px',
          'background: #f59e0b',
          'border: 1.5px solid #ffffff',
          'color: #18181b',
          'font: 700 9px/11px system-ui, sans-serif',
          'text-align: center',
        ].join(';');
        btn.appendChild(badge);
      }
      const photoLabel = photoCount > 0 ? `, ${photoCount} snapshot${photoCount > 1 ? 's' : ''}` : '';
      btn.title = `${marker.name} (${(marker.chainageM / 1000).toFixed(2)} km${photoLabel})`;
      btn.setAttribute(
        'aria-label',
        `${marker.name} (${marker.kind}, ${(marker.chainageM / 1000).toFixed(2)} km, Pass ${marker.passNumber}${photoLabel})`,
      );
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        latestCallbacksRef.current.onSelectMarker?.(marker);
        latestCallbacksRef.current.onSelectChainage?.(marker.chainageM, marker.passNumber);
      });

      const instance = new maplibregl.Marker({ element: btn })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(map);
      markerInstancesRef.current.push(instance);
    });
  }, [markers, selectedMarkerId, styleLoadedNonce]);

  // Render synchronized Starting Point / Preview Position cursor marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!cursorVisible) {
      cursorMarkerRef.current?.remove();
      cursorMarkerRef.current = null;
      cursorButtonRef.current = null;
      cursorModeRef.current = null;
      setStartMenuOpen(false);
      return;
    }

    const desiredMode = editable ? 'editable' : 'readonly';
    if (cursorMarkerRef.current && cursorModeRef.current !== desiredMode) {
      cursorMarkerRef.current.remove();
      cursorMarkerRef.current = null;
      cursorButtonRef.current = null;
      cursorModeRef.current = null;
    }

    const isDotInteractive =
      editable && (drawMode === 'view' || drawMode === 'edit' || drawMode === 'set-start');
    const kmText = (selection.chainageM / 1000).toFixed(2);
    const accessibleLabel = `Starting point at ${kmText} km. Drag to move, press Enter for actions, Delete to remove, or arrow keys to nudge.`;

    if (!cursorMarkerRef.current) {
      if (editable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rp-start-dot-btn';
        btn.setAttribute('aria-label', accessibleLabel);
        btn.title = 'Starting point (drag to move, click for options)';
        btn.style.cssText = [
          'width: 32px',
          'height: 32px',
          'padding: 0',
          'border: 0',
          'border-radius: 9999px',
          'background: transparent',
          'display: grid',
          'place-items: center',
          'touch-action: none',
          '-webkit-user-select: none',
          'user-select: none',
          `cursor: ${isDotInteractive ? 'grab' : 'default'}`,
          `pointer-events: ${isDotInteractive ? 'auto' : 'none'}`,
        ].join(';');

        const ring = document.createElement('span');
        ring.setAttribute('aria-hidden', 'true');
        ring.style.cssText = [
          'width: 18px',
          'height: 18px',
          'border-radius: 9999px',
          'background: #ffffff',
          'border: 4px solid #dc2626',
          'box-shadow: 0 2px 10px rgba(0,0,0,0.4)',
          'display: block',
        ].join(';');
        btn.appendChild(ring);

        const marker = new maplibregl.Marker({
          element: btn,
          draggable: isDotInteractive,
        })
          .setLngLat([selection.longitude, selection.latitude])
          .addTo(map);

        let downPoint: { x: number; y: number } | null = null;
        btn.addEventListener('pointerdown', (ev) => {
          downPoint = { x: ev.clientX, y: ev.clientY };
          cursorDraggedRef.current = false;
        });
        btn.addEventListener('pointermove', (ev) => {
          if (!downPoint) return;
          if (Math.hypot(ev.clientX - downPoint.x, ev.clientY - downPoint.y) >= 4) {
            cursorDraggedRef.current = true;
          }
        });

        marker.on('dragstart', () => {
          cursorDraggedRef.current = true;
          btn.style.cursor = 'grabbing';
          setStartMenuOpen(false);
        });

        marker.on('dragend', () => {
          btn.style.cursor = 'grab';
          downPoint = null;
          const origin = latestCallbacksRef.current.selection;
          const dropped = marker.getLngLat();
          void Promise.resolve(
            latestCallbacksRef.current.onPlaceStartPoint?.(dropped.lat, dropped.lng),
          ).then((accepted) => {
            if (accepted === false) {
              marker.setLngLat([origin.longitude, origin.latitude]);
            } else {
              setSrAnnouncement('Starting point moved to new map location.');
            }
          });
          window.requestAnimationFrame(() => {
            cursorDraggedRef.current = false;
          });
        });

        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (cursorDraggedRef.current) {
            cursorDraggedRef.current = false;
            return;
          }
          setStartMenuOpen((open) => !open);
        });

        btn.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setStartMenuOpen(true);
        });

        btn.addEventListener('keydown', (ev) => {
          if (ev.key === 'Delete' || ev.key === 'Backspace') {
            ev.preventDefault();
            ev.stopPropagation();
            setStartMenuOpen(false);
            latestCallbacksRef.current.onRemoveStartPoint?.();
            setSrAnnouncement('Starting point removed.');
            return;
          }
          if (ev.key === 'Escape') {
            setStartMenuOpen(false);
            return;
          }
          if (
            ev.key === 'ArrowUp' ||
            ev.key === 'ArrowDown' ||
            ev.key === 'ArrowLeft' ||
            ev.key === 'ArrowRight'
          ) {
            ev.preventDefault();
            ev.stopPropagation();
            const origin = latestCallbacksRef.current.selection;
            const stepM = ev.shiftKey ? 50 : 12;
            const dLat =
              ev.key === 'ArrowUp' ? stepM / 111_132 : ev.key === 'ArrowDown' ? -stepM / 111_132 : 0;
            const cosLat = Math.max(0.2, Math.cos((origin.latitude * Math.PI) / 180));
            const dLon =
              ev.key === 'ArrowRight'
                ? stepM / (111_320 * cosLat)
                : ev.key === 'ArrowLeft'
                  ? -stepM / (111_320 * cosLat)
                  : 0;
            void latestCallbacksRef.current.onPlaceStartPoint?.(
              origin.latitude + dLat,
              origin.longitude + dLon,
            );
            setSrAnnouncement('Starting point nudged.');
          }
        });

        cursorButtonRef.current = btn;
        cursorMarkerRef.current = marker;
        cursorModeRef.current = 'editable';
      } else {
        const dot = document.createElement('div');
        dot.setAttribute('role', 'status');
        dot.setAttribute('aria-label', 'Preview position on course');
        dot.style.cssText = [
          'width: 18px',
          'height: 18px',
          'border-radius: 9999px',
          'background: #ffffff',
          'border: 4px solid #dc2626',
          'box-shadow: 0 2px 10px rgba(0,0,0,0.4)',
          'pointer-events: none',
        ].join(';');
        cursorMarkerRef.current = new maplibregl.Marker({ element: dot })
          .setLngLat([selection.longitude, selection.latitude])
          .addTo(map);
        cursorModeRef.current = 'readonly';
      }
    } else {
      cursorMarkerRef.current.setLngLat([selection.longitude, selection.latitude]);
      if (editable && cursorButtonRef.current) {
        cursorMarkerRef.current.setDraggable(isDotInteractive);
        cursorButtonRef.current.style.pointerEvents = isDotInteractive ? 'auto' : 'none';
        cursorButtonRef.current.style.cursor = isDotInteractive ? 'grab' : 'default';
        cursorButtonRef.current.setAttribute('aria-label', accessibleLabel);
      }
    }
  }, [
    selection.latitude,
    selection.longitude,
    selection.chainageM,
    cursorVisible,
    editable,
    drawMode,
    styleLoadedNonce,
  ]);

  // Keep the starting point action menu anchored to the projected screen coordinates
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !startMenuOpen || !editable || !cursorVisible) {
      setStartMenuCoords(null);
      return;
    }
    const updateMenuPos = () => {
      const pt = map.project([selection.longitude, selection.latitude]);
      const width = container.clientWidth || 320;
      const height = container.clientHeight || 360;
      const menuWidth = 236;
      const menuHeight = 160;
      const rightReserve = width < 520 ? 64 : 12;
      const clampedX = Math.max(
        12,
        Math.min(Math.max(12, width - menuWidth - rightReserve), pt.x - menuWidth / 2),
      );
      const clampedY =
        pt.y > menuHeight + 16
          ? pt.y - menuHeight - 16
          : Math.min(Math.max(12, height - menuHeight - 12), pt.y + 22);
      setStartMenuCoords({ x: clampedX, y: clampedY });
    };
    updateMenuPos();
    map.on('move', updateMenuPos);
    map.on('zoom', updateMenuPos);
    return () => {
      map.off('move', updateMenuPos);
      map.off('zoom', updateMenuPos);
    };
  }, [startMenuOpen, editable, cursorVisible, selection.latitude, selection.longitude, styleLoadedNonce]);

  // Render live GPS survey indicator dot when GNSS tracking is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gpsLivePosition) {
      gpsLiveMarkerRef.current?.remove();
      gpsLiveMarkerRef.current = null;
      return;
    }
    if (!gpsLiveMarkerRef.current) {
      const gpsNode = document.createElement('div');
      gpsNode.setAttribute('aria-label', `Live GPS survey fix (±${Math.round(gpsLivePosition.accuracyM)}m)`);
      gpsNode.style.cssText = [
        'width: 24px',
        'height: 24px',
        'border-radius: 9999px',
        'background: rgba(37, 99, 235, 0.22)',
        'border: 2px solid #2563eb',
        'display: grid',
        'place-items: center',
        'pointer-events: none',
      ].join(';');
      const centerDot = document.createElement('span');
      centerDot.style.cssText = 'width: 10px; height: 10px; border-radius: 9999px; background: #2563eb; border: 2px solid #ffffff;';
      gpsNode.appendChild(centerDot);
      gpsLiveMarkerRef.current = new maplibregl.Marker({ element: gpsNode })
        .setLngLat([gpsLivePosition.lon, gpsLivePosition.lat])
        .addTo(map);
    } else {
      gpsLiveMarkerRef.current.setLngLat([gpsLivePosition.lon, gpsLivePosition.lat]);
    }
  }, [gpsLivePosition, styleLoadedNonce]);

  // Lock map pan/rotate & enforce tool-appropriate cursor + live brush/eraser pointer capture
  const lockCamera =
    editable &&
    !spacePanActive &&
    (mapPanLocked || (drawMode !== 'view' && drawMode !== 'set-start'));
  const activeCursor = !editable
    ? 'grab'
    : spacePanActive || (drawMode === 'view' && !mapPanLocked)
      ? (isPointerDown ? 'grabbing' : 'grab')
      : drawMode === 'paint'
        ? PAINT_CURSOR
        : drawMode === 'erase'
          ? ERASE_CURSOR
          : drawMode === 'draw' || drawMode === 'place-marker' || drawMode === 'set-start'
            ? 'crosshair'
            : drawMode === 'edit'
              ? 'pointer'
              : 'not-allowed';

  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;

    const applyCursor = (cursorValue: string) => {
      el.style.cursor = cursorValue;
      try {
        map.getCanvas().style.cursor = cursorValue;
        map.getCanvasContainer().style.cursor = cursorValue;
      } catch {
        // Map torn down
      }
    };

    applyCursor(activeCursor);

    if (editable) {
      try {
        if (lockCamera) {
          map.dragPan.disable();
          map.dragRotate.disable();
          map.doubleClickZoom.disable();
          map.boxZoom.disable();
          map.touchZoomRotate.disableRotation();
        } else {
          map.dragPan.enable();
          map.dragRotate.enable();
          map.doubleClickZoom.enable();
          map.boxZoom.enable();
          map.touchZoomRotate.enableRotation();
        }
      } catch {
        // Ignore if map torn down
      }
    }

    const computeReticle = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      const centerLat = map.getCenter().lat;
      const metersPerPx =
        (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) /
        Math.pow(2, map.getZoom());
      const pixelDiameter =
        drawMode === 'erase'
          ? Math.max(22, Math.min(180, (eraseRadiusM * 2) / Math.max(0.05, metersPerPx)))
          : 26;
      return { x, y, pixelDiameter };
    };

    const isBrushActive = editable && !spacePanActive && (drawMode === 'paint' || drawMode === 'erase');

    let drawing = false;
    let stroke: Array<{ lat: number; lon: number }> = [];
    let lastEraseAt = 0;

    const updatePreview = (coords: Array<{ lat: number; lon: number }>) => {
      const src = map.getSource('rp-paint-preview') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(
        coords.length >= 2
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates: coords.map((p) => [p.lon, p.lat]),
                  },
                },
              ],
            }
          : { type: 'FeatureCollection', features: [] },
      );
    };

    const unprojectPointer = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
      return { lat: Number(lngLat.lat.toFixed(6)), lon: Number(lngLat.lng.toFixed(6)) };
    };

    const handleDown = (ev: PointerEvent) => {
      setIsPointerDown(true);
      if (!isBrushActive || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      drawing = true;
      const pt = unprojectPointer(ev.clientX, ev.clientY);
      if (drawMode === 'paint') {
        stroke = [pt];
        updatePreview(stroke);
      } else if (drawMode === 'erase') {
        lastEraseAt = Date.now();
        latestCallbacksRef.current.onEraseAtCoordinate?.(pt.lat, pt.lon);
      }
    };

    const handleMove = (ev: PointerEvent) => {
      if (isBrushActive) {
        setHoverReticle(computeReticle(ev.clientX, ev.clientY));
      } else {
        setHoverReticle((curr) => (curr !== null ? null : curr));
      }

      if (!drawing || !isBrushActive) return;
      ev.preventDefault();
      ev.stopPropagation();
      const pt = unprojectPointer(ev.clientX, ev.clientY);
      if (drawMode === 'paint') {
        stroke.push(pt);
        updatePreview(stroke);
      } else if (drawMode === 'erase') {
        const now = Date.now();
        if (now - lastEraseAt >= 85) {
          lastEraseAt = now;
          latestCallbacksRef.current.onEraseAtCoordinate?.(pt.lat, pt.lon);
        }
      }
    };

    const handleLeave = () => {
      setHoverReticle(null);
    };

    const finishStroke = () => {
      setIsPointerDown(false);
      if (!drawing) return;
      drawing = false;
      if (drawMode === 'paint' && stroke.length >= 2) {
        latestCallbacksRef.current.onPaintStrokeCommit?.(stroke);
      }
      stroke = [];
      updatePreview([]);
    };

    el.addEventListener('pointerdown', handleDown, { capture: true });
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerleave', handleLeave);
    window.addEventListener('pointermove', handleMove, { capture: true });
    window.addEventListener('pointerup', finishStroke);
    window.addEventListener('pointercancel', finishStroke);

    return () => {
      el.removeEventListener('pointerdown', handleDown, { capture: true });
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
      window.removeEventListener('pointermove', handleMove, { capture: true });
      window.removeEventListener('pointerup', finishStroke);
      window.removeEventListener('pointercancel', finishStroke);
      setHoverReticle(null);
      setIsPointerDown(false);
      applyCursor('');
    };
  }, [editable, drawMode, mapPanLocked, spacePanActive, eraseRadiusM, activeCursor, isPointerDown, lockCamera, styleLoadedNonce]);

  // Lazy-load Terra Draw ONLY when draw/edit mode is entered, and re-bind cleanly after MapLibre style swaps
  useEffect(() => {
    const map = mapRef.current;
    if (!editable || !map || !styleLoadedNonce) return;

    let cancelled = false;
    const setupTerraDraw = async () => {
      if (terraDrawRef.current && terraDrawStyleNonceRef.current !== styleLoadedNonce) {
        try {
          terraDrawRef.current.stop();
        } catch {
          // Previous style swap already removed Terra Draw layers/sources
        }
        terraDrawRef.current = null;
      }

      if (!terraDrawRef.current && drawMode !== 'draw' && drawMode !== 'edit') {
        return;
      }

      if (!terraDrawRef.current) {
        const [
          { TerraDraw, TerraDrawLineStringMode, TerraDrawSelectMode, TerraDrawRenderMode },
          { TerraDrawMapLibreGLAdapter },
        ] = await Promise.all([
          import('terra-draw'),
          import('terra-draw-maplibre-gl-adapter'),
        ]);
        if (cancelled || !map.getStyle()) return;

        const adapter = new TerraDrawMapLibreGLAdapter({ map });
        const td = new TerraDraw({
          adapter,
          modes: [
            new TerraDrawLineStringMode({
              styles: {
                lineStringColor: '#ea580c',
                lineStringWidth: 4,
              },
            }),
            new TerraDrawSelectMode({
              flags: {
                linestring: {
                  feature: {
                    draggable: false,
                    coordinates: {
                      midpoints: true,
                      draggable: true,
                      deletable: true,
                    },
                  },
                },
              },
            }),
            new TerraDrawRenderMode({
              modeName: 'render',
              styles: {},
            }),
          ],
        });
        td.start();

        td.on('finish', () => {
          const snapshot = td.getSnapshot();
          const lineSegs: CanonicalSegmentInput[] = snapshot
            .filter((f) => f.geometry.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
            .map((f, idx) => ({
              id: `drawn_${idx + 1}`,
              name: `Drawn section ${idx + 1}`,
              sourceKind: 'drawn',
              points: (f.geometry.coordinates as number[][]).map((coord) => ({
                lat: coord[1],
                lon: coord[0],
              })),
            }));
          latestCallbacksRef.current.onDrawnSegmentsChange?.(lineSegs);
        });

        terraDrawRef.current = td as unknown as typeof terraDrawRef.current;
        terraDrawStyleNonceRef.current = styleLoadedNonce;
      }

      const td = terraDrawRef.current;
      if (!td) return;
      try {
        if (drawMode === 'draw' || drawMode === 'edit') {
          td.clear();
          const drawnFeatures = route.canonicalGeometry.isCanvasCleared
            ? []
            : route.canonicalGeometry.segments
                .filter((s) => s.sourceKind === 'drawn' && s.points.length >= 2)
                .map((s) => ({
                  type: 'Feature' as const,
                  geometry: {
                    type: 'LineString' as const,
                    coordinates: s.points.map((p) => [p.lon, p.lat]),
                  },
                  properties: { mode: 'linestring' },
                }));
          if (drawnFeatures.length > 0) {
            td.addFeatures(drawnFeatures as unknown as Parameters<typeof td.addFeatures>[0]);
          }
          td.setMode(drawMode === 'draw' ? 'linestring' : 'select');
        } else {
          td.clear();
          td.setMode('render');
        }
      } catch {
        // Style swap in progress; next styleLoadedNonce will re-bind Terra Draw cleanly
      }
    };

    void setupTerraDraw();

    return () => {
      cancelled = true;
    };
  }, [editable, drawMode, styleLoadedNonce]);

  // Course preview playback (respects prefers-reduced-motion)
  useEffect(() => {
    if (!isPlayingPreview || !onSelectChainage) return;
    if (reducedMotion) {
      setIsPlayingPreview(false);
      return;
    }
    const stepM = Math.max(40, route.distanceM / 120);
    const interval = window.setInterval(() => {
      const next = selection.chainageM + stepM;
      if (next >= route.distanceM) {
        onSelectChainage(route.distanceM, 1);
        setIsPlayingPreview(false);
      } else {
        onSelectChainage(next, selection.passNumber);
      }
    }, 120);
    return () => window.clearInterval(interval);
  }, [isPlayingPreview, selection.chainageM, selection.passNumber, route.distanceM, onSelectChainage, reducedMotion]);

  if (!webglReady || mapFatalError) {
    return (
      <div className={`w-full ${heightClassName}`}>
        <SchematicMapFallback
          route={route}
          markers={markers}
          selection={selection}
          selectedMarkerId={selectedMarkerId}
          cursorVisible={cursorVisible}
          editable={editable}
          drawMode={drawMode}
          gpsLivePosition={gpsLivePosition}
          locateStatus={locateStatus}
          onLocateMe={onLocateMe}
          onCenterOnUser={onCenterOnUser}
          onSelectMarker={onSelectMarker}
          onSelectChainage={onSelectChainage}
          onPlaceStartPoint={onPlaceStartPoint}
        />
      </div>
    );
  }

  return (
    <div
      data-fullscreen={fullscreenActive ? 'true' : 'false'}
      data-draw-mode={drawMode}
      data-pan-locked={lockCamera ? 'true' : 'false'}
      className={
        fullscreenActive
          ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-[var(--surface-page)] p-3 sm:p-4'
          : 'space-y-2'
      }
    >
      {fullscreenActive && studioOverlaySlot}

      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] ${
          fullscreenActive ? 'min-h-0 flex-1' : heightClassName
        }`}
      >
        <div
          ref={containerRef}
          style={{
            backgroundColor: theme === 'dark' ? '#0c2640' : '#cbe1f2',
            touchAction: lockCamera ? 'none' : 'auto',
          }}
          className="h-full w-full"
          aria-label="Interactive geographic race course map"
        />

        <div className="sr-only" aria-live="polite">
          {srAnnouncement}
        </div>

        {/* Starting Point Quick Action Popover */}
        {startMenuOpen && editable && cursorVisible && startMenuCoords && (
          <div
            role="group"
            aria-label="Starting point actions"
            style={{
              left: `${startMenuCoords.x}px`,
              top: `${startMenuCoords.y}px`,
            }}
            className="pointer-events-auto absolute z-30 w-[236px] rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 shadow-lg space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Starting point
                </p>
                <p className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
                  {selection.latitude.toFixed(5)}, {selection.longitude.toFixed(5)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close starting point menu"
                onClick={() => setStartMenuOpen(false)}
                className="flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setStartMenuOpen(false);
                  onRequestStartPointMode?.();
                }}
                className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/60"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                Place elsewhere
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartMenuOpen(false);
                  onRemoveStartPoint?.();
                  setSrAnnouncement('Starting point removed.');
                }}
                className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-500/20 dark:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove dot
              </button>
            </div>
          </div>
        )}

        {/* Real-time Paintbrush / Eraser Cursor Reticle */}
        {hoverReticle && editable && !spacePanActive && (drawMode === 'paint' || drawMode === 'erase') && (
          <div
            aria-hidden="true"
            style={{
              left: `${hoverReticle.x}px`,
              top: `${hoverReticle.y}px`,
              width: `${hoverReticle.pixelDiameter}px`,
              height: `${hoverReticle.pixelDiameter}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className={`pointer-events-none absolute z-20 flex items-center justify-center rounded-full ${
              drawMode === 'erase'
                ? 'border-2 border-dashed border-red-500 bg-red-500/15'
                : 'border-2 border-orange-500 bg-orange-500/15'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                drawMode === 'erase' ? 'bg-red-500' : 'bg-orange-500'
              }`}
            />
            <span className="absolute -bottom-5 whitespace-nowrap rounded bg-zinc-900/85 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white shadow">
              {drawMode === 'erase' ? `${eraseRadiusM}m eraser` : `Paint · ${paintSpacingM}m`}
            </span>
          </div>
        )}

        {/* Top-left basemap, tile error, or terrain recovery banner */}
        {(tileErrorNotice || basemapNotice || terrainNotice) && (
          <div
            role="status"
            className="pointer-events-auto absolute left-3 top-3 z-10 flex max-w-[calc(100%-6rem)] flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-3 py-1.5 text-xs text-[var(--text-primary)] shadow-sm"
          >
            <span>{tileErrorNotice || terrainNotice || basemapNotice}</span>
            {providerId === 'local-fallback' && !tileErrorNotice && (
              <button
                type="button"
                onClick={() => setProviderId('openfreemap')}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold text-red-700 hover:bg-[var(--surface-hover)] dark:text-red-400"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry basemap
              </button>
            )}
          </div>
        )}

        {/* Top-right compact 2-column map zoom, fit, locate, fullscreen, satellite, 3D & preview controls */}
        <div className="pointer-events-auto absolute right-2.5 top-2.5 z-10 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn({ duration: reducedMotion ? 0 : 180 })}
            aria-label="Zoom in map"
            title="Zoom in"
            className="flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60 hover:text-red-700 dark:hover:text-red-400"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut({ duration: reducedMotion ? 0 : 180 })}
            aria-label="Zoom out map"
            title="Zoom out"
            className="flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60 hover:text-red-700 dark:hover:text-red-400"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => fitRouteBounds(false)}
            aria-label="Fit entire course on map"
            title="Fit course"
            className="flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60 hover:text-red-700 dark:hover:text-red-400"
          >
            <Focus className="h-4 w-4" aria-hidden="true" />
          </button>
          {onLocateMe && (
            <button
              type="button"
              onClick={() => {
                if (gpsLivePosition && onCenterOnUser) {
                  onCenterOnUser();
                } else {
                  onLocateMe();
                }
              }}
              aria-pressed={locateStatus === 'active'}
              aria-label={
                locateStatus === 'locating'
                  ? 'Finding your location on the map'
                  : gpsLivePosition
                    ? 'Center map on your live location'
                    : 'Show my location on the map'
              }
              title={
                locateStatus === 'locating'
                  ? 'Locating your spot...'
                  : gpsLivePosition
                    ? 'Center on my spot'
                    : 'Show my location'
              }
              className={`flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border text-xs font-semibold shadow-sm ${
                locateStatus === 'active'
                  ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-500'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-sky-600/60 hover:text-sky-700 dark:hover:text-sky-400'
              }`}
            >
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreenActive}
            aria-label={fullscreenActive ? 'Exit fullscreen map' : 'Toggle fullscreen map'}
            title={fullscreenActive ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
            className={`flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border text-xs font-semibold shadow-sm ${
              fullscreenActive
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/60'
            }`}
          >
            {fullscreenActive ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleImagery}
            aria-pressed={activeImagery}
            aria-label={activeImagery ? 'Hide Sentinel-2 satellite imagery' : 'Show Sentinel-2 satellite imagery'}
            title={activeImagery ? 'Hide Satellite' : 'Sentinel-2 Satellite'}
            className={`flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border text-xs font-semibold shadow-sm ${
              activeImagery
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/60'
            }`}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggle3D}
            aria-pressed={active3D}
            aria-label={active3D ? 'Switch to 2D map view' : 'Switch to 3D terrain relief view'}
            title={active3D ? 'Switch to 2D' : '3D Terrain'}
            className={`flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border text-xs font-semibold shadow-sm ${
              active3D
                ? 'border-red-600 bg-red-700 text-white'
                : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/60'
            }`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
          </button>
          {onSelectChainage && !editable && !reducedMotion && (
            <button
              type="button"
              onClick={() => setIsPlayingPreview((p) => !p)}
              aria-pressed={isPlayingPreview}
              aria-label={isPlayingPreview ? 'Pause course preview' : 'Play course preview'}
              title={isPlayingPreview ? 'Pause preview' : 'Preview course'}
              className={`flex min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 items-center justify-center rounded-xl border text-xs font-semibold shadow-sm ${
                isPlayingPreview
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/60'
              }`}
            >
              {isPlayingPreview ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {/* Bottom-left Course Telemetry HUD + Preview Position + Pan Lock status */}
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex max-w-[calc(100%-6.75rem)] flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-2.5 py-1.5 text-xs text-[var(--text-primary)] shadow-sm">
          <Compass className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
          <span className="font-mono font-semibold">
            {route.canonicalGeometry.isCanvasCleared
              ? '0.00 km (Cleared)'
              : `${route.distanceKm.toFixed(2)} km`}
          </span>
          <span className="font-mono text-[var(--text-secondary)]">
            +{Math.round(route.elevationGainM)}m / -{Math.round(route.elevationLossM)}m
          </span>
          <span className="font-mono text-[var(--text-secondary)]">
            Max {maxGradePct.toFixed(1)}%
          </span>
          <span className="font-mono text-[var(--text-secondary)]">
            {cursorVisible ? (
              <>
                Cursor {(selection.chainageM / 1000).toFixed(2)} km
                {selection.elevation !== undefined ? ` (${Math.round(selection.elevation)} m)` : ''}
              </>
            ) : route.canonicalGeometry.isCanvasCleared ? (
              'Start point not placed'
            ) : (
              'Start dot removed'
            )}
          </span>
          {selection.passNumber > 1 && (
            <span className="rounded-md bg-red-700/15 px-1.5 py-0.5 font-semibold text-red-700 dark:text-red-300">
              Pass {selection.passNumber}
            </span>
          )}
          {comparisonRoute && comparisonLabel && (
            <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
              <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-current" aria-hidden="true" />
              {comparisonLabel}
            </span>
          )}
          {editable && lockCamera && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-800 dark:text-amber-300">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Canvas locked (hold Space to pan)
            </span>
          )}
          {colorMode === 'gradient' && (
            <span className="rounded-md bg-emerald-600/15 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
              Slope: Green &lt;3% · Amber 3-10% · Red &gt;10%
            </span>
          )}
          {colorMode === 'surface' && (
            <span className="rounded-md bg-sky-600/15 px-1.5 py-0.5 font-semibold text-sky-700 dark:text-sky-300">
              Surface: Gray Paved · Amber Gravel · Green Trail · Red Tech
            </span>
          )}
        </div>
        {selectedMarkerOverlay}
      </div>

      {/* Explicit map attribution & fallback toggle footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--text-secondary)]">
        <span>
          Map source: {providerConfig.attribution}
          {activeImagery && providerConfig.imageryAttribution ? ` · ${providerConfig.imageryAttribution}` : ''}
          {active3D && providerConfig.terrainAttribution ? ` · ${providerConfig.terrainAttribution}` : ''}
          {provenance ? ` · Imagery date: ${provenance.imageryDate}` : ''}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {route.validationReport.hasDrawnSections && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
              <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-current" aria-hidden="true" />
              Dashed: manually drawn section
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              setProviderId((curr) => (curr === 'openfreemap' ? 'local-fallback' : 'openfreemap'))
            }
            className="min-h-8 font-semibold text-[var(--text-primary)] underline decoration-[var(--border-default)] underline-offset-4 hover:text-red-700 dark:hover:text-red-400"
          >
            {providerId === 'openfreemap' ? 'Use Philippine reference map' : 'Use OpenFreeMap tiles'}
          </button>
        </div>
      </div>
    </div>
  );
}
