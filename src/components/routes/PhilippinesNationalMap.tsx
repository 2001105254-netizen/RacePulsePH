import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Compass, ExternalLink, Globe, Layers, MapPin, Minus, Plus, RefreshCw } from 'lucide-react';
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
  buildPhilippinesArchipelagoGeoJson,
  COPERNICUS_TERRAIN_DOC_URL,
  COPERNICUS_TERRAIN_RELEASE,
  DEFAULT_QUARTERLY_MOSAIC_PERIOD,
  ensurePhilippinesMapProtocolRegistered,
  ISLAND_GROUP_VIEWPORTS,
  PHILIPPINES_NATIONAL_BOUNDS,
  recordCourseFirstLoadMs,
  registerCourseCorridorForTiles,
  SENTINEL2_IMAGERY_DOC_URL,
  SENTINEL2_IMAGERY_SOURCE,
  subscribeTileTelemetry,
  type TileTelemetrySnapshot,
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
        <span>Philippines Overview (Luzon, Visayas, Mindanao · WebGL fallback)</span>
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
                {course.province} ({course.entry.distanceLabel})
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
}: PhilippinesNationalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const mountMsRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const [webglReady] = useState(() => supportsWebGL());
  const [providerId, setProviderId] = useState<MapProviderId>('openfreemap');
  const [styleLoadedNonce, setStyleLoadedNonce] = useState(0);
  const [activeRegion, setActiveRegion] = useState<'all' | PhilippineIslandGroup>('all');
  const [imageryEnabled, setImageryEnabled] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [notice, setNotice] = useState('');
  const [mapError, setMapError] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TileTelemetrySnapshot | null>(null);

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

  useEffect(() => {
    return subscribeTileTelemetry(setTelemetry);
  }, []);

  const providerConfig = useMemo(
    () => getMapProviderConfig(theme, providerId, PHILIPPINES_NATIONAL_BOUNDS, 'national'),
    [theme, providerId],
  );

  const fitIslandGroup = useCallback(
    (group: 'all' | PhilippineIslandGroup, immediate = false) => {
      setActiveRegion(group);
      const map = mapRef.current;
      if (!map) return;
      const vp = ISLAND_GROUP_VIEWPORTS[group];
      map.fitBounds(vp.bounds, {
        padding: group === 'all' ? 28 : 36,
        duration: immediate || reducedMotion ? 0 : 240,
      });
    },
    [reducedMotion],
  );

  const focusCourse = useCallback(
    (course: MappedCoursePoint) => {
      setSelectedCourseId(course.entry.id);
      setActiveRegion(course.islandGroup);
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        center: [course.centerLon, course.centerLat],
        zoom: 12.2,
        duration: reducedMotion ? 0 : 250,
      });
    },
    [reducedMotion],
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
        minZoom: 4.5,
        maxZoom: 19,
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
        sourceId === 'rp-ph-sentinel2' ||
        sourceId === 'rp-ph-glo30' ||
        sourceId === 'rp-ph-glo30-hillshade'
      ) {
        setNotice('National tile layer could not load; course pins remain interactive.');
        return;
      }
      if (!map.isStyleLoaded()) {
        setProviderId((curr) => (curr === 'openfreemap' ? 'local-fallback' : curr));
        setNotice('Showing clipped Philippine archipelago base vector map.');
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
      map.fitBounds(ISLAND_GROUP_VIEWPORTS.all.bounds, { padding: 24, duration: 0 });
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

  // Progressive basemap style switch
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
        const res = await fetch(providerConfig.styleUrl, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as maplibregl.StyleSpecification;
        if (!cancelled && json && Array.isArray(json.layers)) {
          enhanceBasemapStyleForOceanAndHybrid(json, theme);
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

  // On-demand High-Res Satellite imagery + hybrid road/label overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (!imageryEnabled || !providerConfig.imageryTiles) {
      try {
        if (map.getLayer('rp-ph-sentinel2-layer')) map.removeLayer('rp-ph-sentinel2-layer');
        if (map.getSource('rp-ph-sentinel2')) map.removeSource('rp-ph-sentinel2');
        applySatelliteHybridRoadStyling(map, false, theme, styleLoadedNonce);
      } catch {
        // Safe cleanup
      }
      return;
    }

    try {
      if (!map.getSource('rp-ph-sentinel2')) {
        map.addSource('rp-ph-sentinel2', {
          type: 'raster',
          tiles: providerConfig.imageryTiles,
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        });
      }
      if (!map.getLayer('rp-ph-sentinel2-layer')) {
        const beforeLayer = map.getLayer('rp-ph-hillshade')
          ? 'rp-ph-hillshade'
          : findFirstVectorOverlayLayerId(map, 'rp-ph-course-halo');
        map.addLayer(
          {
            id: 'rp-ph-sentinel2-layer',
            type: 'raster',
            source: 'rp-ph-sentinel2',
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

  // On-demand Copernicus GLO-30 (2024_1) 3D Terrain
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (!is3D) {
      try {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getLayer('rp-ph-hillshade')) map.removeLayer('rp-ph-hillshade');
        if (map.getSource('rp-ph-glo30-hillshade')) map.removeSource('rp-ph-glo30-hillshade');
        if (map.getSource('rp-ph-glo30')) map.removeSource('rp-ph-glo30');
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
      minzoom: 4,
      maxzoom: 12,
    };
    try {
      if (!map.getSource('rp-ph-glo30')) {
        map.addSource('rp-ph-glo30', demSpec);
      }
      if (!map.getSource('rp-ph-glo30-hillshade')) {
        map.addSource('rp-ph-glo30-hillshade', demSpec);
      }
      if (!map.getLayer('rp-ph-hillshade')) {
        const beforeLayer = findFirstVectorOverlayLayerId(map, 'rp-ph-course-halo');
        map.addLayer(
          {
            id: 'rp-ph-hillshade',
            type: 'hillshade',
            source: 'rp-ph-glo30-hillshade',
            paint: { 'hillshade-exaggeration': imageryEnabled ? 0.22 : 0.42 },
          },
          beforeLayer,
        );
      }
      map.setTerrain({ source: 'rp-ph-glo30', exaggeration: 1.0 });
      const targetPitch = map.getZoom() < 8 ? 36 : 45;
      map.easeTo({ pitch: targetPitch, duration: reducedMotion ? 0 : 220 });
    } catch {
      map.easeTo({ pitch: 42, duration: reducedMotion ? 0 : 200 });
    }
  }, [is3D, imageryEnabled, providerConfig.terrainDemTiles, styleLoadedNonce, reducedMotion]);

  // Render island group badges and interactive course pins on national map
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

  const cebuCourse = mappedCourses.find((c) => c.entry.raceId === 'cebu-highlands-trail-2026');
  const bukidnonCourse = mappedCourses.find((c) => c.entry.raceId === 'bukidnon-kitanglad-trail-2026');

  return (
    <section
      aria-label="Philippines-Wide Race Map"
      className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 space-y-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
            <Compass className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Philippines Course Coverage Map
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Browse Luzon, Visayas, and Mindanao freely from the national view, or focus Cebu and Bukidnon to inspect course imagery and 3D terrain.
          </p>
        </div>

        <div
          role="toolbar"
          aria-label="Philippines map navigation and layers"
          className="flex flex-wrap items-center gap-1.5"
        >
          <div role="group" aria-label="Island group jump controls" className="flex flex-wrap items-center gap-1.5">
            {(['all', 'Luzon', 'Visayas', 'Mindanao'] as const).map((group) => (
              <button
                key={group}
                type="button"
                aria-pressed={activeRegion === group}
                onClick={() => fitIslandGroup(group)}
                className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition ${
                  activeRegion === group
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
                }`}
              >
                {ISLAND_GROUP_VIEWPORTS[group].label}
              </button>
            ))}
          </div>

          <div role="group" aria-label="Satellite and 3D terrain toggles" className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={imageryEnabled}
              onClick={() => setImageryEnabled((v) => !v)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                imageryEnabled
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              Sentinel-2 Satellite (10 m)
            </button>
            <button
              type="button"
              aria-pressed={is3D}
              onClick={() => setIs3D((v) => !v)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
                is3D
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              <Layers className="h-4 w-4" aria-hidden="true" />
              3D Terrain (GLO-30)
            </button>
          </div>
        </div>
      </div>

      {/* Quick Pilot Focus Strip */}
      {(cebuCourse || bukidnonCourse) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-[var(--text-secondary)]">Pilot courses:</span>
          {cebuCourse && (
            <>
              <button
                type="button"
                onClick={() => focusCourse(cebuCourse)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
              >
                <MapPin className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                Focus Cebu 21K (Visayas)
              </button>
              <a
                href={buildRaceCoursePath(cebuCourse.entry.raceId, cebuCourse.entry.distanceId)}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateUrl(buildRaceCoursePath(cebuCourse.entry.raceId, cebuCourse.entry.distanceId));
                }}
                className="inline-flex min-h-11 items-center rounded-xl border border-red-600/40 bg-red-700/10 px-3 font-semibold text-red-700 hover:bg-red-700/15 dark:text-red-300"
              >
                Open Cebu course
              </a>
            </>
          )}
          {bukidnonCourse && (
            <>
              <button
                type="button"
                onClick={() => focusCourse(bukidnonCourse)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 font-semibold text-[var(--text-primary)] hover:border-red-600/50"
              >
                <MapPin className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                Focus Bukidnon 32K (Mindanao)
              </button>
              <a
                href={buildRaceCoursePath(bukidnonCourse.entry.raceId, bukidnonCourse.entry.distanceId)}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateUrl(buildRaceCoursePath(bukidnonCourse.entry.raceId, bukidnonCourse.entry.distanceId));
                }}
                className="inline-flex min-h-11 items-center rounded-xl border border-red-600/40 bg-red-700/10 px-3 font-semibold text-red-700 hover:bg-red-700/15 dark:text-red-300"
              >
                Open Bukidnon course
              </a>
            </>
          )}
        </div>
      )}

      {/* Map Viewport */}
      <div className="relative h-[340px] w-full overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] sm:h-[420px] lg:h-[460px]">
        {!webglReady || mapError ? (
          <NationalSchematicFallback
            courses={mappedCourses}
            selectedId={selectedCourseId}
            onSelectCourse={(c) => setSelectedCourseId(c.entry.id)}
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
            {notice && (
              <div
                role="status"
                className="pointer-events-auto absolute left-3 top-3 z-10 flex max-w-[calc(100%-5rem)] items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-3 py-1.5 text-xs text-[var(--text-primary)] shadow-sm"
              >
                <span>{notice}</span>
                {providerId === 'local-fallback' && (
                  <button
                    type="button"
                    onClick={() => setProviderId('openfreemap')}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-default)] px-2 font-semibold text-red-700 dark:text-red-400"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry
                  </button>
                )}
              </div>
            )}
            <div className="pointer-events-auto absolute right-3 top-3 z-10 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn({ duration: reducedMotion ? 0 : 180 })}
                aria-label="Zoom in Philippines map"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut({ duration: reducedMotion ? 0 : 180 })}
                aria-label="Zoom out Philippines map"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 text-[var(--text-primary)] shadow-sm hover:border-red-600/60"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {selectedCourse && (
              <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]/95 px-3.5 py-2.5 text-xs shadow-md sm:right-auto sm:max-w-md">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--text-primary)]">
                    {selectedCourse.entry.raceName} · {selectedCourse.entry.distanceLabel}
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    {selectedCourse.islandGroup} · {selectedCourse.province} · Imagery {selectedCourse.imageryDate}
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
                  className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-red-700 px-3 font-semibold text-white hover:bg-red-600"
                >
                  Explore course
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {/* National Provenance & Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Terrain: <strong className="text-[var(--text-primary)]">{COPERNICUS_TERRAIN_RELEASE}</strong>
          </span>
          <span>
            Imagery: <strong className="text-[var(--text-primary)]">{SENTINEL2_IMAGERY_SOURCE}</strong> ({DEFAULT_QUARTERLY_MOSAIC_PERIOD})
          </span>
          {telemetry && (
            <span className="font-mono">
              Imagery reqs: {telemetry.imageryRequestsCount} · DEM reqs: {telemetry.demRequestsCount}
              {telemetry.firstLoadMsByCourse['national-ph']
                ? ` · First load: ${telemetry.firstLoadMsByCourse['national-ph']} ms`
                : ''}
            </span>
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
    </section>
  );
}
