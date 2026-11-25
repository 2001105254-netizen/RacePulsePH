import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Focus, Globe, Layers, Minus, Plus, RefreshCw } from 'lucide-react';
import {
  applyMap2D3DBuildingVisibility,
  applySatelliteHybridRoadStyling,
  createPhilippinesTransformRequest,
  findFirstVectorOverlayLayerId,
  getMapProviderConfig,
  resolveAndClipPhilippinesVectorStyle,
  supportsWebGL,
  type MapProviderId,
  type MapThemeMode,
} from '../../lib/routes/mapProviders';
import {
  buildPhilippinesArchipelagoGeoJson,
  DEFAULT_QUARTERLY_MOSAIC_PERIOD,
  ensurePhilippinesMapProtocolRegistered,
  ISLAND_GROUP_VIEWPORTS,
  PHILIPPINES_MAX_BOUNDS,
  PHILIPPINES_NATIONAL_BOUNDS,
  PHILIPPINES_SOURCE_BOUNDS,
  recordCourseFirstLoadMs,
  registerCourseCorridorForTiles,
} from '../../lib/routes/philippinesMapTiles';
import { getRouteStoreSnapshot } from '../../lib/routes/routeStore';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import type { PhilippineIslandGroup, RaceRouteCatalogEntry } from '../../lib/routes/types';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
  ensurePhilippinesMapProtocolRegistered(maplibregl);
}

interface PhilippinesNationalMapProps {
  catalog: RaceRouteCatalogEntry[];
  theme: MapThemeMode;
  onNavigateUrl: (url: string) => void;
  activeRegion?: 'all' | PhilippineIslandGroup;
  onRegionChange?: (region: 'all' | PhilippineIslandGroup) => void;
  selectedCourseId?: string | null;
  onSelectCourseId?: (id: string | null) => void;
  imageryEnabled?: boolean;
  onToggleImagery?: (next: boolean) => void;
  is3DEnabled?: boolean;
  onToggle3D?: (next: boolean) => void;
  fullHeight?: boolean;
  hideInternalToolbar?: boolean;
}

interface MappedCoursePoint {
  entry: RaceRouteCatalogEntry;
  centerLat: number;
  centerLon: number;
  islandGroup: PhilippineIslandGroup;
  province: string;
  imageryDate: string;
  coordinatesList: Array<Array<[number, number]>>;
}

function resolveMappedCourses(catalog: RaceRouteCatalogEntry[]): MappedCoursePoint[] {
  const store = getRouteStoreSnapshot();
  const out: MappedCoursePoint[] = [];

  for (const entry of catalog) {
    const pub = store.publications[entry.currentPublicationId];
    if (!pub) continue;

    registerCourseCorridorForTiles(`${entry.raceId}_${entry.distanceId}`, pub.canonicalGeometry);

    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    const coordinatesList: Array<Array<[number, number]>> = [];

    for (const seg of pub.canonicalGeometry.segments) {
      if (seg.points.length < 2) continue;
      const line: Array<[number, number]> = [];
      for (const pt of seg.points) {
        sumLat += pt.lat;
        sumLon += pt.lon;
        count += 1;
        line.push([pt.lon, pt.lat]);
      }
      coordinatesList.push(line);
    }

    if (count === 0) continue;
    const prov = entry.mapLayerProvenance || pub.mapLayerProvenance;
    out.push({
      entry,
      centerLat: sumLat / count,
      centerLon: sumLon / count,
      islandGroup: prov?.islandGroup || 'Luzon',
      province: prov?.province || entry.region,
      imageryDate: prov?.imageryDate || DEFAULT_QUARTERLY_MOSAIC_PERIOD,
      coordinatesList,
    });
  }
  return out;
}

function NationalSchematicFallback({
  courses,
  selectedId,
  onSelectCourse,
  onNavigateUrl,
}: {
  courses: MappedCoursePoint[];
  selectedId: string | null;
  onSelectCourse: (course: MappedCoursePoint) => void;
  onNavigateUrl: (url: string) => void;
}) {
  const geo = useMemo(() => buildPhilippinesArchipelagoGeoJson(), []);
  const width = 560;
  const height = 640;
  const pad = 28;
  const lonMin = PHILIPPINES_NATIONAL_BOUNDS.west;
  const lonMax = PHILIPPINES_NATIONAL_BOUNDS.east;
  const latMin = PHILIPPINES_NATIONAL_BOUNDS.south;
  const latMax = PHILIPPINES_NATIONAL_BOUNDS.north;
  const scale = Math.min((width - pad * 2) / (lonMax - lonMin), (height - pad * 2) / (latMax - latMin));

  const proj = (lon: number, lat: number) => ({
    x: pad + (lon - lonMin) * scale,
    y: height - pad - (lat - latMin) * scale,
  });

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)]">
        <span>Philippines Overview (Luzon, Visayas, Mindanao)</span>
        <span>{courses.length} published course(s)</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full flex-1"
        role="img"
        aria-label="Philippines archipelago race course overview map"
      >
        {geo.features.map((f, idx) => {
          const poly = f.geometry as GeoJSON.Polygon;
          const d = poly.coordinates[0]
            .map(([lon, lat], i) => {
              const p = proj(lon, lat);
              return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(' ') + ' Z';
          return (
            <path
              key={idx}
              d={d}
              fill="currentColor"
              fillOpacity={0.14}
              stroke="currentColor"
              strokeOpacity={0.4}
              strokeWidth={1.2}
            />
          );
        })}
        {courses.map((course) => {
          const p = proj(course.centerLon, course.centerLat);
          const active = selectedId === course.entry.id;
          return (
            <g
              key={course.entry.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onClick={() => {
                onSelectCourse(course);
                onNavigateUrl(buildRaceCoursePath(course.entry.raceId, course.entry.distanceId));
              }}
            >
              <circle r={active ? 10 : 7} fill="#b91c1c" stroke="#ffffff" strokeWidth={2.5} />
              <text x={12} y={4} fill="currentColor" fontSize="11" fontWeight="600">
                {course.province} · {course.entry.distanceLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function PhilippinesNationalMap({
  catalog,
  theme,
  onNavigateUrl,
  activeRegion: controlledRegion,
  onRegionChange,
  selectedCourseId: controlledSelectedCourseId,
  onSelectCourseId,
  imageryEnabled: controlledImagery,
  onToggleImagery,
  is3DEnabled: controlled3D,
  onToggle3D,
  fullHeight = false,
  hideInternalToolbar = false,
}: PhilippinesNationalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const mountMsRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const [webglReady] = useState(() => supportsWebGL());
  const [providerId, setProviderId] = useState<MapProviderId>('openfreemap');
  const [styleLoadedNonce, setStyleLoadedNonce] = useState(0);
  const [internalRegion, setInternalRegion] = useState<'all' | PhilippineIslandGroup>('all');
  const [internalImagery, setInternalImagery] = useState(false);
  const [internal3D, setInternal3D] = useState(false);
  const [notice, setNotice] = useState('');
  const [mapError, setMapError] = useState(false);
  const [internalSelectedCourseId, setInternalSelectedCourseId] = useState<string | null>(null);

  const activeRegion = controlledRegion ?? internalRegion;
  const selectedCourseId =
    controlledSelectedCourseId !== undefined ? controlledSelectedCourseId : internalSelectedCourseId;
  const imageryEnabled = controlledImagery ?? internalImagery;
  const is3D = controlled3D ?? internal3D;

  const setActiveRegionValue = useCallback(
    (region: 'all' | PhilippineIslandGroup) => {
      if (onRegionChange) onRegionChange(region);
      else setInternalRegion(region);
    },
    [onRegionChange],
  );

  const setSelectedCourseValue = useCallback(
    (id: string | null) => {
      if (onSelectCourseId) onSelectCourseId(id);
      else setInternalSelectedCourseId(id);
    },
    [onSelectCourseId],
  );

  const toggleImageryValue = useCallback(() => {
    const next = !imageryEnabled;
    if (onToggleImagery) onToggleImagery(next);
    else setInternalImagery(next);
  }, [imageryEnabled, onToggleImagery]);

  const toggle3DValue = useCallback(() => {
    const next = !is3D;
    if (onToggle3D) onToggle3D(next);
    else setInternal3D(next);
  }, [is3D, onToggle3D]);

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const mappedCourses = useMemo(() => resolveMappedCourses(catalog), [catalog]);
  const selectedCourse = useMemo(
    () => mappedCourses.find((c) => c.entry.id === selectedCourseId) || null,
    [mappedCourses, selectedCourseId],
  );

  const providerConfig = useMemo(
    () => getMapProviderConfig(theme, providerId, PHILIPPINES_NATIONAL_BOUNDS, 'national'),
    [theme, providerId],
  );

  const fitIslandGroup = useCallback(
    (group: 'all' | PhilippineIslandGroup, immediate = false) => {
      setActiveRegionValue(group);
      const map = mapRef.current;
      if (!map) return;
      const vp = ISLAND_GROUP_VIEWPORTS[group];
      map.fitBounds(vp.bounds, {
        padding: group === 'all' ? { top: 20, bottom: 48, left: 24, right: 24 } : 34,
        duration: immediate || reducedMotion ? 0 : 240,
      });
    },
    [reducedMotion, setActiveRegionValue],
  );

  useEffect(() => {
    if (controlledRegion === undefined) return;
    const map = mapRef.current;
    if (!map) return;
    const vp = ISLAND_GROUP_VIEWPORTS[controlledRegion];
    map.fitBounds(vp.bounds, {
      padding: controlledRegion === 'all' ? { top: 20, bottom: 48, left: 24, right: 24 } : 34,
      duration: reducedMotion ? 0 : 240,
    });
  }, [controlledRegion, reducedMotion]);

  const focusCourse = useCallback(
    (course: MappedCoursePoint) => {
      setSelectedCourseValue(course.entry.id);
      setActiveRegionValue(course.islandGroup);
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        center: [course.centerLon, course.centerLat],
        zoom: 12.2,
        duration: reducedMotion ? 0 : 250,
      });
    },
    [reducedMotion, setActiveRegionValue, setSelectedCourseValue],
  );

  const syncNationalOverlays = useCallback(
    (map: maplibregl.Map) => {
      if (!map.getStyle()) return;

      const routesGeo: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: mappedCourses.flatMap((course) =>
          course.coordinatesList.map((coords) => ({
            type: 'Feature' as const,
            properties: {
              id: course.entry.id,
              raceName: course.entry.raceName,
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: coords,
            },
          })),
        ),
      };

      const ensureGeo = (id: string, data: GeoJSON.FeatureCollection) => {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else map.addSource(id, { type: 'geojson', data });
      };

      ensureGeo('rp-ph-published-courses', routesGeo);

      if (!map.getLayer('rp-ph-course-halo')) {
        map.addLayer({
          id: 'rp-ph-course-halo',
          type: 'line',
          source: 'rp-ph-published-courses',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.9,
          },
        });
      }

      if (!map.getLayer('rp-ph-course-line')) {
        map.addLayer({
          id: 'rp-ph-course-line',
          type: 'line',
          source: 'rp-ph-published-courses',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#dc2626',
            'line-width': 3.5,
          },
        });
      }
    },
    [mappedCourses],
  );

  const syncOverlaysRef = useRef(syncNationalOverlays);
  syncOverlaysRef.current = syncNationalOverlays;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !webglReady) return;

    let cancelled = false;
    let map: maplibregl.Map | null = null;

    try {
      map = new maplibregl.Map({
        container: el,
        style: providerConfig.fallbackStyle,
        center: ISLAND_GROUP_VIEWPORTS.all.center,
        zoom: ISLAND_GROUP_VIEWPORTS.all.zoom,
        pitch: 0,
        bearing: 0,
        minZoom: 4.4,
        maxZoom: 19,
        maxBounds: PHILIPPINES_MAX_BOUNDS,
        renderWorldCopies: false,
        transformRequest: createPhilippinesTransformRequest(),
        attributionControl: false,
        cooperativeGestures: false,
      });
    } catch {
      setMapError(true);
      return;
    }

    mapRef.current = map;

    map.on('error', (ev) => {
      if (cancelled || !map) return;
      const sourceId = (ev as { sourceId?: string })?.sourceId;
      if (
        sourceId === 'rp-ph-sat' ||
        sourceId === 'rp-ph-relief' ||
        sourceId === 'rp-ph-relief-hillshade'
      ) {
        setNotice('National tile layer could not load; course pins remain interactive.');
        return;
      }
      if (!map.isStyleLoaded()) {
        setProviderId((curr) => (curr === 'openfreemap' ? 'local-fallback' : curr));
        setNotice('Showing Philippine archipelago base grid.');
      }
    });

    map.on('style.load', () => {
      if (!map || cancelled) return;
      syncOverlaysRef.current(map);
      setStyleLoadedNonce((n) => n + 1);
    });

    map.on('load', () => {
      if (!map || cancelled) return;
      syncOverlaysRef.current(map);
      const initialVp = ISLAND_GROUP_VIEWPORTS[activeRegion] || ISLAND_GROUP_VIEWPORTS.all;
      map.fitBounds(initialVp.bounds, { padding: 24, duration: 0 });
      if (typeof performance !== 'undefined' && mountMsRef.current > 0) {
        recordCourseFirstLoadMs('national-ph', performance.now() - mountMsRef.current);
      }
      setStyleLoadedNonce((n) => n + 1);
    });

    const resizeObs = new ResizeObserver(() => map?.resize());
    resizeObs.observe(el);

    return () => {
      cancelled = true;
      resizeObs.disconnect();
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, [webglReady]);

  // Progressive basemap style switch clipped strictly to the Philippines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const apply = async () => {
      if (providerId === 'local-fallback' || !providerConfig.styleUrl) {
        map.setStyle(providerConfig.fallbackStyle);
        return;
      }
      try {
        const json = await resolveAndClipPhilippinesVectorStyle(
          providerConfig.styleUrl,
          theme,
          AbortSignal.timeout(6000),
        );
        if (!cancelled) {
          setNotice('');
          map.setStyle(json);
        }
      } catch {
        if (!cancelled) {
          setProviderId('local-fallback');
          map.setStyle(providerConfig.fallbackStyle);
        }
      }
    };
    void apply();
    return () => {
      cancelled = true;
    };
  }, [theme, providerId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    try {
      syncNationalOverlays(map);
    } catch {
      // Wait for style.load
    }
  }, [syncNationalOverlays, styleLoadedNonce]);

  // On-demand satellite imagery + hybrid road/label overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (!imageryEnabled || !providerConfig.imageryTiles) {
      try {
        if (map.getLayer('rp-ph-sat-layer')) map.removeLayer('rp-ph-sat-layer');
        if (map.getSource('rp-ph-sat')) map.removeSource('rp-ph-sat');
        applySatelliteHybridRoadStyling(map, false, theme, styleLoadedNonce);
      } catch {
        // Safe cleanup
      }
      return;
    }

    try {
      if (!map.getSource('rp-ph-sat')) {
        map.addSource('rp-ph-sat', {
          type: 'raster',
          tiles: providerConfig.imageryTiles,
          tileSize: 256,
          bounds: PHILIPPINES_SOURCE_BOUNDS,
          minzoom: 4,
          maxzoom: 19,
        });
      }
      if (!map.getLayer('rp-ph-sat-layer')) {
        const beforeLayer = map.getLayer('rp-ph-hillshade')
          ? 'rp-ph-hillshade'
          : findFirstVectorOverlayLayerId(map, 'rp-ph-course-halo');
        map.addLayer(
          {
            id: 'rp-ph-sat-layer',
            type: 'raster',
            source: 'rp-ph-sat',
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 150 },
          },
          beforeLayer,
        );
      }
      applySatelliteHybridRoadStyling(map, true, theme, styleLoadedNonce);
    } catch {
      setNotice('Satellite tiles could not initialize on this device.');
    }
  }, [imageryEnabled, providerConfig.imageryTiles, styleLoadedNonce, theme]);

  // On-demand 30 m 3D terrain relief
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    applyMap2D3DBuildingVisibility(map, is3D);

    if (!is3D) {
      try {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer('rp-ph-hillshade')) map.removeLayer('rp-ph-hillshade');
        if (map.getSource('rp-ph-relief-hillshade')) map.removeSource('rp-ph-relief-hillshade');
        if (map.getSource('rp-ph-relief')) map.removeSource('rp-ph-relief');
      } catch {
        // ignore
      }
      map.easeTo({ pitch: 0, duration: reducedMotion ? 0 : 200 });
      return;
    }

    if (!providerConfig.terrainDemTiles) return;
    const demSpec: maplibregl.RasterDEMSourceSpecification = {
      type: 'raster-dem',
      tiles: providerConfig.terrainDemTiles,
      tileSize: 256,
      encoding: 'terrarium',
      bounds: PHILIPPINES_SOURCE_BOUNDS,
      minzoom: 4,
      maxzoom: 12,
    };
    try {
      if (!map.getSource('rp-ph-relief')) {
        map.addSource('rp-ph-relief', demSpec);
      }
      if (!map.getSource('rp-ph-relief-hillshade')) {
        map.addSource('rp-ph-relief-hillshade', demSpec);
      }
      if (!map.getLayer('rp-ph-hillshade')) {
        const beforeLayer = findFirstVectorOverlayLayerId(map, 'rp-ph-course-halo');
        map.addLayer(
          {
            id: 'rp-ph-hillshade',
            type: 'hillshade',
            source: 'rp-ph-relief-hillshade',
            paint: { 'hillshade-exaggeration': imageryEnabled ? 0.22 : 0.42 },
          },
          beforeLayer,
        );
      }
      map.setTerrain({ source: 'rp-ph-relief', exaggeration: 1.0 });
      const targetPitch = map.getZoom() < 8 ? 36 : 45;
      map.easeTo({ pitch: targetPitch, duration: reducedMotion ? 0 : 220 });
    } catch {
      map.easeTo({ pitch: 42, duration: reducedMotion ? 0 : 200 });
    }
  }, [is3D, imageryEnabled, providerConfig.terrainDemTiles, styleLoadedNonce, reducedMotion]);

  // Render island group labels and interactive course pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = [];

    for (const group of ['Luzon', 'Visayas', 'Mindanao'] as const) {
      const badge = document.createElement('span');
      badge.className = 'rp-national-island-label';
      badge.textContent = group;
      badge.setAttribute('aria-hidden', 'true');
      badge.style.cssText = [
        'pointer-events: none',
        'user-select: none',
        'padding: 2px 8px',
        'border-radius: 9999px',
        `border: 1px solid ${imageryEnabled || theme === 'dark' ? 'rgba(244,244,245,0.28)' : 'rgba(24,24,27,0.18)'}`,
        `background: ${imageryEnabled || theme === 'dark' ? 'rgba(9,9,11,0.72)' : 'rgba(255,255,255,0.86)'}`,
        `color: ${imageryEnabled || theme === 'dark' ? '#f4f4f5' : '#18181b'}`,
        'font: 600 11px/1.2 system-ui, sans-serif',
        'letter-spacing: 0.03em',
      ].join(';');

      const labelMarker = new maplibregl.Marker({ element: badge })
        .setLngLat(ISLAND_GROUP_VIEWPORTS[group].center)
        .addTo(map);
      markerRefs.current.push(labelMarker);
    }

    for (const course of mappedCourses) {
      const isSelected = course.entry.id === selectedCourseId;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-national-course-pin';
      btn.style.cssText = [
        'display: inline-flex',
        'align-items: center',
        'gap: 4px',
        'min-height: 30px',
        'padding: 0 9px',
        'border-radius: 9999px',
        `border: 2px solid #ffffff`,
        `background: ${isSelected ? '#991b1b' : '#b91c1c'}`,
        'color: #ffffff',
        'font: 600 11px/1 system-ui, sans-serif',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.35)',
        'cursor: pointer',
        `transform: ${isSelected ? 'scale(1.1)' : 'scale(1)'}`,
      ].join(';');
      btn.textContent = `${course.province} · ${course.entry.distanceLabel}`;
      btn.setAttribute(
        'aria-label',
        `Inspect ${course.entry.raceName} ${course.entry.distanceLabel} in ${course.province}`,
      );
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        focusCourse(course);
      });

      const marker = new maplibregl.Marker({ element: btn })
        .setLngLat([course.centerLon, course.centerLat])
        .addTo(map);
      markerRefs.current.push(marker);
    }
  }, [mappedCourses, selectedCourseId, styleLoadedNonce, focusCourse, imageryEnabled, theme]);

  return (
    <section
      aria-label="Philippines Race Map"
      className={
        fullHeight
          ? 'relative h-full w-full overflow-hidden bg-[var(--surface-inset)]'
          : 'relative h-[380px] w-full overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] sm:h-[460px]'
      }
    >
      {!webglReady || mapError ? (
        <NationalSchematicFallback
          courses={mappedCourses}
          selectedId={selectedCourseId}
          onSelectCourse={(c) => setSelectedCourseValue(c.entry.id)}
          onNavigateUrl={onNavigateUrl}
        />
      ) : (
        <>
          <div
            ref={containerRef}
            className="h-full w-full"
            style={{ backgroundColor: theme === 'dark' ? '#0c2640' : '#cbe1f2' }}
            aria-label="Interactive Philippines race coverage map across Luzon, Visayas, and Mindanao"
          />

          {!hideInternalToolbar && (
            <div
              role="toolbar"
              aria-label="Philippines island group filters"
              className="pointer-events-auto absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-1.5"
            >
              {(['all', 'Luzon', 'Visayas', 'Mindanao'] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={activeRegion === group}
                  onClick={() => fitIslandGroup(group)}
                  className={`min-h-11 lg:min-h-9 rounded-xl border px-3 text-xs font-semibold shadow-sm transition ${
                    activeRegion === group
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  {group === 'all' ? 'All PH' : group}
                </button>
              ))}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="pointer-events-auto absolute left-3 top-16 z-10 flex max-w-[calc(100%-5rem)] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-3 py-1.5 text-xs text-[var(--text-primary)] shadow-sm"
            >
              <span>{notice}</span>
              {providerId === 'local-fallback' && (
                <button
                  type="button"
                  onClick={() => setProviderId('openfreemap')}
                  className="inline-flex min-h-11 lg:min-h-9 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold text-red-700 dark:text-red-400"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="pointer-events-auto absolute right-2.5 top-2.5 z-10 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn({ duration: reducedMotion ? 0 : 180 })}
              aria-label="Zoom in Philippines map"
              title="Zoom in"
              className="flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut({ duration: reducedMotion ? 0 : 180 })}
              aria-label="Zoom out Philippines map"
              title="Zoom out"
              className="flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => fitIslandGroup(activeRegion)}
              aria-label="Fit Philippines region on map"
              title="Fit view"
              className="flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60"
            >
              <Focus className="h-4 w-4" aria-hidden="true" />
            </button>
            {!hideInternalToolbar && (
              <>
                <button
                  type="button"
                  aria-pressed={imageryEnabled}
                  aria-label={imageryEnabled ? 'Hide satellite imagery' : 'Show satellite imagery'}
                  title={imageryEnabled ? 'Hide satellite' : 'Satellite imagery'}
                  onClick={toggleImageryValue}
                  className={`flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 items-center justify-center rounded-xl border shadow-sm transition ${
                    imageryEnabled
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  <Globe className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={is3D}
                  aria-label={is3D ? 'Switch to 2D map' : 'Switch to 3D terrain relief'}
                  title={is3D ? '2D map' : '3D relief'}
                  onClick={toggle3DValue}
                  className={`flex min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 items-center justify-center rounded-xl border shadow-sm transition ${
                    is3D
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] hover:border-red-600/50'
                  }`}
                >
                  <Layers className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          {selectedCourse && (
            <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-3.5 py-2.5 text-xs shadow-md sm:right-auto sm:max-w-md">
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--text-primary)]">
                  {selectedCourse.entry.raceName} · {selectedCourse.entry.distanceLabel}
                </p>
                <p className="text-[var(--text-secondary)]">
                  {selectedCourse.islandGroup} · {selectedCourse.province} · {selectedCourse.imageryDate}
                </p>
              </div>
              <a
                href={buildRaceCoursePath(selectedCourse.entry.raceId, selectedCourse.entry.distanceId)}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateUrl(
                    buildRaceCoursePath(selectedCourse.entry.raceId, selectedCourse.entry.distanceId),
                  );
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-red-700 px-3.5 font-semibold text-white hover:bg-red-600"
              >
                Explore course
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}
