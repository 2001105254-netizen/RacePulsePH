import type * as maplibregl from 'maplibre-gl';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import {
  buildCopernicusTileTemplate,
  buildPhilippinesArchipelagoGeoJson,
  COPERNICUS_MAP_ATTRIBUTION,
  COPERNICUS_TERRAIN_RELEASE,
} from './philippinesMapTiles';

export type MapThemeMode = 'light' | 'dark';
export type MapProviderId = 'openfreemap' | 'local-fallback';

export const COPERNICUS_ATTRIBUTION = COPERNICUS_MAP_ATTRIBUTION;

export interface MapProviderConfig {
  id: MapProviderId;
  label: string;
  attribution: string;
  styleUrl?: string;
  fallbackStyle: StyleSpecification;
  terrainDemTiles?: string[];
  terrainAttribution?: string;
  imageryTiles?: string[];
  imageryAttribution?: string;
}

export const OPENFREEMAP_HOSTS = [
  'https://tiles.openfreemap.org',
  'https://services.arcgisonline.com',
  'https://server.arcgisonline.com',
  'https://tiles.maps.eox.at',
  'https://elevation-tiles-prod.s3.amazonaws.com',
] as const;

export function buildLocalFallbackStyle(
  theme: MapThemeMode,
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  },
): StyleSpecification {
  const isDark = theme === 'dark';
  const bg = isDark ? '#0c2640' : '#cbe1f2';
  const landFill = isDark ? '#1c2429' : '#e7e4db';
  const landOutline = isDark ? '#3a464e' : '#b2aea2';
  const gridColor = isDark ? '#193b5c' : '#b6cee2';
  const minorGridColor = isDark ? '#13314e' : '#c3d9eb';

  // Generate lightweight geographic graticule GeoJSON inside/around the route bounds
  const south = bounds ? Math.floor(bounds.south * 20) / 20 - 0.15 : 4.0;
  const north = bounds ? Math.ceil(bounds.north * 20) / 20 + 0.15 : 21.5;
  const west = bounds ? Math.floor(bounds.west * 20) / 20 - 0.15 : 116.5;
  const east = bounds ? Math.ceil(bounds.east * 20) / 20 + 0.15 : 127.0;

  const features: Array<{
    type: 'Feature';
    properties: { kind: 'major' | 'minor' };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }> = [];

  const step = Math.max(0.01, Number(((north - south) / 14).toFixed(3)));
  for (let lat = south, idx = 0; lat <= north && idx < 40; lat += step, idx += 1) {
    features.push({
      type: 'Feature',
      properties: { kind: idx % 2 === 0 ? 'major' : 'minor' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [west, lat],
          [east, lat],
        ],
      },
    });
  }
  const lonStep = Math.max(0.01, Number(((east - west) / 14).toFixed(3)));
  for (let lon = west, idx = 0; lon <= east && idx < 40; lon += lonStep, idx += 1) {
    features.push({
      type: 'Feature',
      properties: { kind: idx % 2 === 0 ? 'major' : 'minor' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, south],
          [lon, north],
        ],
      },
    });
  }

  return {
    version: 8,
    name: `RacePulsePH Philippines Reference (${theme})`,
    sources: {
      graticule: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      },
      'rp-ph-archipelago': {
        type: 'geojson',
        data: buildPhilippinesArchipelagoGeoJson(),
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': bg },
      },
      {
        id: 'graticule-minor',
        type: 'line',
        source: 'graticule',
        filter: ['==', ['get', 'kind'], 'minor'],
        paint: { 'line-color': minorGridColor, 'line-width': 1 },
      },
      {
        id: 'graticule-major',
        type: 'line',
        source: 'graticule',
        filter: ['==', ['get', 'kind'], 'major'],
        paint: { 'line-color': gridColor, 'line-width': 1.25 },
      },
      {
        id: 'rp-ph-archipelago-fill',
        type: 'fill',
        source: 'rp-ph-archipelago',
        paint: {
          'fill-color': landFill,
          'fill-opacity': 0.92,
        },
      },
      {
        id: 'rp-ph-archipelago-outline',
        type: 'line',
        source: 'rp-ph-archipelago',
        paint: {
          'line-color': landOutline,
          'line-width': 1.35,
        },
      },
    ],
  };
}

export function getMapProviderConfig(
  theme: MapThemeMode,
  providerId: MapProviderId = 'openfreemap',
  bounds?: { north: number; south: number; east: number; west: number },
  courseScopeId = 'national',
): MapProviderConfig {
  const fallbackStyle = buildLocalFallbackStyle(theme, bounds);
  const demTiles = [buildCopernicusTileTemplate('glo30', courseScopeId)];
  const imageryTiles = [buildCopernicusTileTemplate('sentinel2', courseScopeId)];

  if (providerId === 'local-fallback') {
    return {
      id: 'local-fallback',
      label: 'Philippine archipelago reference',
      attribution: 'RacePulsePH Philippine Archipelago (WGS84)',
      fallbackStyle,
      terrainDemTiles: demTiles,
      terrainAttribution: COPERNICUS_TERRAIN_RELEASE,
      imageryTiles,
      imageryAttribution: COPERNICUS_MAP_ATTRIBUTION,
    };
  }

  return {
    id: 'openfreemap',
    label: 'OpenFreeMap + Copernicus',
    attribution: 'OpenFreeMap © OpenMapTiles · OpenStreetMap',
    styleUrl:
      theme === 'dark'
        ? 'https://tiles.openfreemap.org/styles/dark'
        : 'https://tiles.openfreemap.org/styles/liberty',
    fallbackStyle,
    terrainDemTiles: demTiles,
    terrainAttribution: COPERNICUS_TERRAIN_RELEASE,
    imageryTiles,
    imageryAttribution: COPERNICUS_MAP_ATTRIBUTION,
  };
}

export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

const HYBRID_OVERLAY_SOURCE_LAYERS = new Set([
  'aeroway',
  'transportation',
  'boundary',
  'water_name',
  'transportation_name',
  'poi',
  'place',
  'aerodrome_label',
]);

const MAJOR_ROAD_IDS = new Set([
  'highway_motorway_inner',
  'highway_major_inner',
  'road_motorway',
  'road_trunk_primary',
  'road_secondary_tertiary',
  'bridge_motorway',
  'bridge_trunk_primary',
  'bridge_secondary_tertiary',
  'tunnel_motorway',
  'tunnel_trunk_primary',
  'tunnel_secondary_tertiary',
]);

const MINOR_ROAD_IDS = new Set([
  'highway_minor',
  'road_minor',
  'road_link',
  'road_service_track',
  'bridge_street',
  'bridge_link',
  'bridge_service_track',
  'bridge_motorway_link',
  'road_motorway_link',
  'tunnel_minor',
  'tunnel_link',
  'tunnel_service_track',
  'tunnel_motorway_link',
]);

const PATH_ROAD_IDS = new Set([
  'highway_path',
  'road_path_pedestrian',
  'bridge_path_pedestrian',
  'tunnel_path_pedestrian',
]);

const HYBRID_LABEL_RE = /^(highway[_-]name|place_|label_|water_name)/;

export function enhanceBasemapStyleForOceanAndHybrid(
  style: StyleSpecification,
  theme: MapThemeMode,
): StyleSpecification {
  if (!style || !Array.isArray(style.layers)) return style;
  const isDark = theme === 'dark';

  for (const layer of style.layers as LayerSpecification[]) {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    const textFont = layout?.['text-font'];
    if (Array.isArray(textFont) && textFont.length > 1 && textFont.every((f) => typeof f === 'string')) {
      layout!['text-font'] = [textFont[0]];
    }

    const paint = ((layer as { paint?: Record<string, unknown> }).paint ??= {});
    if (layer.id === 'background' && layer.type === 'background') {
      if (isDark) paint['background-color'] = '#161b22';
      continue;
    }

    if (layer.id === 'water' && layer.type === 'fill') {
      paint['fill-color'] = isDark ? '#0c2640' : '#a5cdf0';
      continue;
    }

    if (layer.type === 'line' && (layer.id === 'waterway' || layer.id.startsWith('waterway_'))) {
      paint['line-color'] = isDark ? '#164670' : '#7ab6e8';
      continue;
    }

    if (isDark && layer.type === 'line') {
      if (MAJOR_ROAD_IDS.has(layer.id)) {
        paint['line-color'] = '#334155';
      } else if (MINOR_ROAD_IDS.has(layer.id)) {
        paint['line-color'] = '#293241';
      } else if (PATH_ROAD_IDS.has(layer.id)) {
        paint['line-color'] = '#475569';
      }
    }

    if (isDark && layer.type === 'symbol' && HYBRID_LABEL_RE.test(layer.id)) {
      if (layer.id.startsWith('water_name')) {
        paint['text-color'] = '#7dd3fc';
        paint['text-halo-color'] = 'rgba(12, 38, 64, 0.85)';
        paint['text-halo-width'] = 1.2;
      } else {
        paint['text-color'] = '#cbd5e1';
        paint['text-halo-color'] = 'rgba(15, 23, 42, 0.88)';
        paint['text-halo-width'] = 1.4;
      }
    }
  }

  return style;
}

export function findFirstVectorOverlayLayerId(
  map: maplibregl.Map,
  fallbackLayerId?: string,
): string | undefined {
  const layers = map.getStyle()?.layers;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
      if (sourceLayer && HYBRID_OVERLAY_SOURCE_LAYERS.has(sourceLayer)) {
        return layer.id;
      }
      if (layer.id === 'rp-ph-archipelago-outline') {
        return layer.id;
      }
    }
  }
  if (fallbackLayerId && map.getLayer(fallbackLayerId)) {
    return fallbackLayerId;
  }
  return undefined;
}

type PaintPropName = Parameters<maplibregl.Map['setPaintProperty']>[1];

interface SavedHybridLayerState {
  visibility?: 'visible' | 'none';
  paint: Record<string, unknown>;
}

const hybridStyleCache = new WeakMap<
  maplibregl.Map,
  { styleNonce: number; modified: boolean; originals: Map<string, SavedHybridLayerState> }
>();

export function applySatelliteHybridRoadStyling(
  map: maplibregl.Map,
  imageryActive: boolean,
  _theme: MapThemeMode,
  styleNonce = 0,
): void {
  const style = map.getStyle();
  if (!style || !Array.isArray(style.layers)) return;

  let cache = hybridStyleCache.get(map);
  if (!cache || cache.styleNonce !== styleNonce) {
    cache = { styleNonce, modified: false, originals: new Map() };
    hybridStyleCache.set(map, cache);
  }

  if (!imageryActive) {
    if (!cache.modified) return;
    for (const [layerId, saved] of cache.originals.entries()) {
      if (!map.getLayer(layerId)) continue;
      try {
        if (saved.visibility !== undefined) {
          map.setLayoutProperty(layerId, 'visibility', saved.visibility);
        }
        for (const [prop, val] of Object.entries(saved.paint)) {
          map.setPaintProperty(layerId, prop as PaintPropName, val);
        }
      } catch {
        // Ignore layers removed during rapid style swap
      }
    }
    cache.modified = false;
    return;
  }

  const recordAndSetPaint = (layerId: string, prop: PaintPropName, value: unknown) => {
    let saved = cache!.originals.get(layerId);
    if (!saved) {
      saved = { paint: {} };
      cache!.originals.set(layerId, saved);
    }
    if (!(prop in saved.paint)) {
      saved.paint[prop] = map.getPaintProperty(layerId, prop);
    }
    map.setPaintProperty(layerId, prop, value);
  };

  const recordAndSetVisibility = (layerId: string, vis: 'visible' | 'none') => {
    let saved = cache!.originals.get(layerId);
    if (!saved) {
      saved = { paint: {} };
      cache!.originals.set(layerId, saved);
    }
    if (saved.visibility === undefined) {
      const curr = map.getLayoutProperty(layerId, 'visibility');
      saved.visibility = curr === 'none' ? 'none' : 'visible';
    }
    map.setLayoutProperty(layerId, 'visibility', vis);
  };

  for (const layer of style.layers) {
    const id = layer.id;
    try {
      if (id === 'building' || id === 'building-3d') {
        recordAndSetVisibility(id, 'none');
        continue;
      }

      if (id === 'rp-ph-archipelago-fill' && layer.type === 'fill') {
        recordAndSetPaint(id, 'fill-opacity', 0.05);
        continue;
      }

      if (layer.type === 'line') {
        if (id.includes('casing') && (id.includes('road') || id.includes('highway') || id.includes('bridge') || id.includes('tunnel'))) {
          recordAndSetPaint(id, 'line-color', 'rgba(9, 9, 11, 0.82)');
          continue;
        }
        if (MAJOR_ROAD_IDS.has(id)) {
          recordAndSetPaint(id, 'line-color', 'rgba(254, 240, 138, 0.88)');
          continue;
        }
        if (MINOR_ROAD_IDS.has(id)) {
          recordAndSetPaint(id, 'line-color', 'rgba(255, 255, 255, 0.78)');
          continue;
        }
        if (PATH_ROAD_IDS.has(id)) {
          recordAndSetPaint(id, 'line-color', 'rgba(253, 186, 116, 0.92)');
          continue;
        }
        if (id === 'waterway' || id.startsWith('waterway_')) {
          recordAndSetPaint(id, 'line-color', 'rgba(56, 189, 248, 0.65)');
          continue;
        }
      }

      if (layer.type === 'symbol' && HYBRID_LABEL_RE.test(id)) {
        recordAndSetPaint(id, 'text-color', '#f8fafc');
        recordAndSetPaint(id, 'text-halo-color', 'rgba(9, 9, 11, 0.92)');
        recordAndSetPaint(id, 'text-halo-width', 1.8);
      }
    } catch {
      // Ignore individual layer mismatches safely
    }
  }

  cache.modified = true;
}
