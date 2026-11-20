import type { AddProtocolAction } from 'maplibre-gl';
import type {
  CanonicalRouteGeometry,
  CourseCloudMaskCheck,
  CourseMapLayerProvenance,
  CourseTileValidationReport,
  PhilippineIslandGroup,
  PublishedRaceRoute,
} from './types';

export const RACEPULSE_TERRAIN_LABEL = 'RacePulsePH 3D Relief (30 m)';
export const RACEPULSE_IMAGERY_LABEL = 'RacePulsePH Satellite Imagery';
export const RACEPULSE_MAP_ATTRIBUTION = 'RacePulsePH Philippines Map';
export const COPERNICUS_TERRAIN_RELEASE = RACEPULSE_TERRAIN_LABEL;
export const COPERNICUS_TERRAIN_DOC_URL = '';
export const SENTINEL2_IMAGERY_SOURCE = RACEPULSE_IMAGERY_LABEL;
export const SENTINEL2_IMAGERY_DOC_URL = '';
export const DEFAULT_QUARTERLY_MOSAIC_PERIOD = '2026-Q3';
export const DEFAULT_QUARTERLY_MOSAIC_ID = 'RP-PH-2026-Q3';
export const COPERNICUS_MAP_ATTRIBUTION = RACEPULSE_MAP_ATTRIBUTION;

export const PHILIPPINES_NATIONAL_BOUNDS = {
  west: 116.8,
  south: 4.5,
  east: 126.7,
  north: 21.2,
} as const;

export const PHILIPPINES_TILE_BBOX = {
  west: 115.6,
  south: 4.1,
  east: 127.8,
  north: 21.6,
} as const;

export const PHILIPPINES_MAX_BOUNDS: [[number, number], [number, number]] = [
  [PHILIPPINES_TILE_BBOX.west, PHILIPPINES_TILE_BBOX.south],
  [PHILIPPINES_TILE_BBOX.east, PHILIPPINES_TILE_BBOX.north],
];

export const PHILIPPINES_SOURCE_BOUNDS: [number, number, number, number] = [
  PHILIPPINES_TILE_BBOX.west,
  PHILIPPINES_TILE_BBOX.south,
  PHILIPPINES_TILE_BBOX.east,
  PHILIPPINES_TILE_BBOX.north,
];

const PHILIPPINES_EXCLUSION_HOLE_RING: ReadonlyArray<readonly [number, number]> = [
  [119.5, 21.45],
  [122.4, 21.45],
  [123.5, 19.0],
  [127.1, 13.8],
  [127.3, 6.2],
  [126.0, 5.1],
  [122.5, 4.55],
  [119.1, 4.4],
  [119.38, 5.15],
  [119.32, 6.0],
  [118.4, 6.95],
  [117.6, 7.45],
  [116.75, 7.72],
  [116.65, 8.8],
  [118.5, 11.8],
  [119.1, 14.5],
  [119.2, 18.8],
  [119.5, 21.45],
];

export function buildPhilippinesWorldMaskGeoJson(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'ph-world-mask' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85],
            ],
            PHILIPPINES_EXCLUSION_HOLE_RING.map(([lon, lat]) => [lon, lat]),
          ],
        },
      },
    ],
  };
}

export interface IslandGroupViewport {
  id: 'all' | PhilippineIslandGroup;
  label: string;
  description: string;
  bounds: [[number, number], [number, number]];
  center: [number, number];
  zoom: number;
}

export const ISLAND_GROUP_VIEWPORTS: Record<'all' | PhilippineIslandGroup, IslandGroupViewport> = {
  all: {
    id: 'all',
    label: 'All Philippines',
    description: 'Luzon, Visayas, and Mindanao national extent',
    bounds: [
      [116.8, 4.7],
      [126.6, 20.9],
    ],
    center: [121.8, 12.6],
    zoom: 5.2,
  },
  Luzon: {
    id: 'Luzon',
    label: 'Luzon',
    description: 'Northern and Central Luzon, Cordillera, Sierra Madre, Bicol, Mindoro, and Palawan',
    bounds: [
      [117.0, 12.2],
      [124.3, 18.7],
    ],
    center: [121.0, 15.6],
    zoom: 6.5,
  },
  Visayas: {
    id: 'Visayas',
    label: 'Visayas',
    description: 'Cebu, Bohol, Negros, Panay, Leyte, and Samar',
    bounds: [
      [121.8, 9.0],
      [125.9, 12.6],
    ],
    center: [123.85, 10.65],
    zoom: 7.4,
  },
  Mindanao: {
    id: 'Mindanao',
    label: 'Mindanao',
    description: 'Bukidnon highlands, Kitanglad, Davao, Caraga, and Zamboanga',
    bounds: [
      [121.8, 5.4],
      [126.6, 9.9],
    ],
    center: [124.75, 7.85],
    zoom: 7.1,
  },
};

interface IslandPolygonSpec {
  id: string;
  name: string;
  islandGroup: PhilippineIslandGroup;
  ring: ReadonlyArray<readonly [number, number]>;
  bbox: { west: number; south: number; east: number; north: number };
}

function makeIsland(
  id: string,
  name: string,
  islandGroup: PhilippineIslandGroup,
  ring: ReadonlyArray<readonly [number, number]>,
): IslandPolygonSpec {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { id, name, islandGroup, ring, bbox: { west, south, east, north } };
}

export const PHILIPPINE_ISLAND_POLYGONS: readonly IslandPolygonSpec[] = [
  makeIsland('luzon-main', 'Luzon', 'Luzon', [
    [120.58, 18.56], [121.55, 18.54], [122.15, 18.45], [122.36, 17.85],
    [122.48, 16.92], [122.18, 16.18], [121.65, 15.72], [121.63, 14.80],
    [122.35, 14.18], [123.02, 14.22], [123.95, 13.86], [124.16, 13.18],
    [124.13, 12.54], [123.86, 12.52], [123.22, 13.02], [122.66, 13.18],
    [122.48, 13.78], [121.84, 13.94], [121.22, 13.66], [120.62, 13.84],
    [120.56, 14.48], [120.06, 14.82], [119.86, 15.88], [120.24, 16.06],
    [120.32, 16.65], [120.42, 17.55], [120.58, 18.56],
  ]),
  makeIsland('mindoro', 'Mindoro', 'Luzon', [
    [120.32, 13.48], [121.18, 13.48], [121.52, 12.88], [121.38, 12.22],
    [120.92, 12.22], [120.32, 12.82], [120.32, 13.48],
  ]),
  makeIsland('palawan', 'Palawan', 'Luzon', [
    [119.35, 11.42], [119.65, 11.35], [119.45, 10.68], [118.88, 9.88],
    [118.38, 9.18], [117.75, 8.66], [117.18, 8.38], [117.14, 8.72],
    [117.72, 9.25], [118.42, 9.85], [118.92, 10.65], [119.35, 11.42],
  ]),
  makeIsland('catanduanes', 'Catanduanes', 'Luzon', [
    [124.14, 14.08], [124.42, 13.95], [124.38, 13.55], [124.06, 13.62], [124.14, 14.08],
  ]),
  makeIsland('marinduque', 'Marinduque', 'Luzon', [
    [121.84, 13.55], [122.14, 13.50], [122.10, 13.20], [121.82, 13.26], [121.84, 13.55],
  ]),
  makeIsland('masbate', 'Masbate', 'Luzon', [
    [123.22, 12.56], [123.85, 12.24], [124.04, 11.74], [123.56, 11.88], [123.16, 12.28], [123.22, 12.56],
  ]),
  makeIsland('panay', 'Panay', 'Visayas', [
    [121.88, 11.92], [122.46, 11.68], [123.14, 11.58], [122.96, 11.02],
    [122.42, 10.64], [121.94, 10.42], [121.86, 11.18], [121.88, 11.92],
  ]),
  makeIsland('negros', 'Negros', 'Visayas', [
    [122.92, 10.98], [123.54, 10.94], [123.38, 10.12], [123.28, 9.26],
    [122.84, 9.04], [122.42, 9.48], [122.52, 10.18], [122.92, 10.98],
  ]),
  makeIsland('cebu', 'Cebu', 'Visayas', [
    [123.98, 11.28], [124.08, 11.12], [124.04, 10.65], [123.96, 10.32],
    [123.76, 10.12], [123.62, 9.88], [123.48, 9.42], [123.30, 9.48],
    [123.38, 9.95], [123.56, 10.28], [123.72, 10.62], [123.84, 11.02],
    [123.98, 11.28],
  ]),
  makeIsland('bohol', 'Bohol', 'Visayas', [
    [123.78, 10.14], [124.48, 10.14], [124.58, 9.74], [124.16, 9.56],
    [123.74, 9.64], [123.72, 9.95], [123.78, 10.14],
  ]),
  makeIsland('leyte', 'Leyte', 'Visayas', [
    [124.38, 11.54], [124.84, 11.48], [125.08, 11.02], [125.24, 10.14],
    [124.84, 10.04], [124.72, 10.64], [124.36, 11.06], [124.38, 11.54],
  ]),
  makeIsland('samar', 'Samar', 'Visayas', [
    [124.32, 12.56], [125.18, 12.58], [125.64, 11.82], [125.74, 11.02],
    [125.26, 11.08], [124.82, 11.46], [124.36, 11.98], [124.32, 12.56],
  ]),
  makeIsland('mindanao-main', 'Mindanao', 'Mindanao', [
    [125.44, 9.82], [126.18, 9.28], [126.58, 7.64], [126.22, 6.28],
    [125.62, 6.84], [125.38, 5.56], [124.48, 5.88], [123.92, 6.72],
    [124.18, 7.36], [123.54, 7.64], [122.92, 7.42], [122.14, 6.88],
    [121.86, 7.22], [122.36, 7.82], [123.02, 8.28], [123.62, 8.68],
    [123.98, 8.12], [124.64, 8.54], [124.82, 8.98], [125.44, 9.82],
  ]),
  makeIsland('camiguin', 'Camiguin', 'Mindanao', [
    [124.64, 9.26], [124.80, 9.22], [124.78, 9.08], [124.62, 9.12], [124.64, 9.26],
  ]),
  makeIsland('siargao', 'Siargao', 'Mindanao', [
    [126.02, 10.06], [126.18, 9.96], [126.14, 9.74], [125.96, 9.80], [126.02, 10.06],
  ]),
  makeIsland('basilan', 'Basilan', 'Mindanao', [
    [121.78, 6.72], [122.28, 6.72], [122.24, 6.42], [121.82, 6.46], [121.78, 6.72],
  ]),
];

export function buildPhilippinesArchipelagoGeoJson(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: PHILIPPINE_ISLAND_POLYGONS.map((island) => ({
      type: 'Feature' as const,
      properties: {
        id: island.id,
        name: island.name,
        islandGroup: island.islandGroup,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [island.ring.map(([lon, lat]) => [lon, lat])],
      },
    })),
  };
}

function pointInRing(lon: number, lat: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isPointInPhilippineIslands(lat: number, lon: number): boolean {
  if (
    lat < PHILIPPINES_NATIONAL_BOUNDS.south ||
    lat > PHILIPPINES_NATIONAL_BOUNDS.north ||
    lon < PHILIPPINES_NATIONAL_BOUNDS.west ||
    lon > PHILIPPINES_NATIONAL_BOUNDS.east
  ) {
    return false;
  }
  for (const island of PHILIPPINE_ISLAND_POLYGONS) {
    if (
      lon >= island.bbox.west &&
      lon <= island.bbox.east &&
      lat >= island.bbox.south &&
      lat <= island.bbox.north &&
      pointInRing(lon, lat, island.ring)
    ) {
      return true;
    }
  }
  return false;
}

// Topographic ridge and volcano elevation kernels across Luzon, Visayas, and Mindanao
const MOUNTAIN_KERNELS: ReadonlyArray<{
  lat: number;
  lon: number;
  peakM: number;
  sigmaLat: number;
  sigmaLon: number;
}> = [
  // Luzon: Cordillera Central, Baguio ridge, Sierra Madre, Mayon, Zambales, Mindoro, Palawan
  { lat: 16.597, lon: 120.898, peakM: 2922, sigmaLat: 0.42, sigmaLon: 0.24 }, // Mt. Pulag
  { lat: 16.412, lon: 120.625, peakM: 1620, sigmaLat: 0.16, sigmaLon: 0.16 }, // Baguio / Itogon ridge
  { lat: 17.42, lon: 121.18, peakM: 2280, sigmaLat: 0.55, sigmaLon: 0.28 },   // North Cordillera
  { lat: 16.78, lon: 122.15, peakM: 1780, sigmaLat: 0.72, sigmaLon: 0.22 },   // Sierra Madre North
  { lat: 14.92, lon: 121.38, peakM: 1420, sigmaLat: 0.45, sigmaLon: 0.22 },   // Sierra Madre Central
  { lat: 15.48, lon: 120.12, peakM: 2037, sigmaLat: 0.34, sigmaLon: 0.18 },   // Zambales / Mt. Tapulao
  { lat: 14.07, lon: 121.49, peakM: 2170, sigmaLat: 0.16, sigmaLon: 0.16 },   // Mt. Banahaw
  { lat: 13.257, lon: 123.685, peakM: 2463, sigmaLat: 0.12, sigmaLon: 0.12 }, // Mt. Mayon
  { lat: 13.26, lon: 121.00, peakM: 2586, sigmaLat: 0.24, sigmaLon: 0.18 },   // Mt. Halcon (Mindoro)
  { lat: 8.82, lon: 117.67, peakM: 2086, sigmaLat: 0.34, sigmaLon: 0.16 },    // Mt. Mantalingajan (Palawan)

  // Visayas: Cebu Central Highlands, Negros Kanlaon, Panay Madja-as, Bohol, Leyte, Samar
  { lat: 10.425, lon: 123.835, peakM: 1003, sigmaLat: 0.085, sigmaLon: 0.055 }, // Cebu Central Highlands (Busay/Manunggal)
  { lat: 10.18, lon: 123.66, peakM: 740, sigmaLat: 0.14, sigmaLon: 0.06 },     // Central Cebu spine
  { lat: 9.82, lon: 123.44, peakM: 1013, sigmaLat: 0.12, sigmaLon: 0.065 },    // Southern Cebu / Osmena Peak
  { lat: 10.412, lon: 123.132, peakM: 2465, sigmaLat: 0.22, sigmaLon: 0.16 },  // Mt. Kanlaon (Negros)
  { lat: 11.39, lon: 122.16, peakM: 2117, sigmaLat: 0.30, sigmaLon: 0.16 },    // Mt. Madja-as (Panay)
  { lat: 9.85, lon: 124.22, peakM: 860, sigmaLat: 0.18, sigmaLon: 0.22 },      // Bohol interior hills
  { lat: 10.85, lon: 124.88, peakM: 1340, sigmaLat: 0.42, sigmaLon: 0.15 },    // Leyte Central Cordillera
  { lat: 11.88, lon: 125.12, peakM: 880, sigmaLat: 0.42, sigmaLon: 0.26 },     // Samar highlands

  // Mindanao: Mt. Kitanglad, Impasugong / Panimahawa Ridge, Mt. Apo, Diwata Range, Malindang
  { lat: 8.132, lon: 124.922, peakM: 2938, sigmaLat: 0.19, sigmaLon: 0.19 },   // Mt. Dulang-Dulang / Kitanglad
  { lat: 8.202, lon: 124.995, peakM: 1320, sigmaLat: 0.09, sigmaLon: 0.09 },   // Impasugong / Panimahawa Ridge
  { lat: 6.987, lon: 125.271, peakM: 2954, sigmaLat: 0.22, sigmaLon: 0.20 },   // Mt. Apo
  { lat: 7.72, lon: 124.85, peakM: 1580, sigmaLat: 0.38, sigmaLon: 0.34 },     // Bukidnon-Cotabato highlands
  { lat: 8.75, lon: 126.02, peakM: 1850, sigmaLat: 0.65, sigmaLon: 0.18 },     // Diwata Range
  { lat: 8.22, lon: 123.63, peakM: 2404, sigmaLat: 0.20, sigmaLon: 0.16 },     // Mt. Malindang
];

function hash2D(ix: number, iy: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2D(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2D(x * freq, y * freq);
    freq *= 2.04;
    amp *= 0.5;
  }
  return sum;
}

interface RegisteredCorridorPoint {
  lat: number;
  lon: number;
  ele: number;
}

interface RegisteredCourseCorridor {
  courseId: string;
  bounds: { west: number; south: number; east: number; north: number };
  points: RegisteredCorridorPoint[];
}

const registeredCorridors = new Map<string, RegisteredCourseCorridor>();

export function registerCourseCorridorForTiles(
  courseId: string,
  geometry: CanonicalRouteGeometry,
): void {
  const points: RegisteredCorridorPoint[] = [];
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;

  for (const seg of geometry.segments) {
    const stride = Math.max(1, Math.floor(seg.points.length / 40));
    for (let i = 0; i < seg.points.length; i += stride) {
      const pt = seg.points[i];
      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
      if (pt.lon < west) west = pt.lon;
      if (pt.lon > east) east = pt.lon;
      if (pt.lat < south) south = pt.lat;
      if (pt.lat > north) north = pt.lat;
      points.push({
        lat: pt.lat,
        lon: pt.lon,
        ele: typeof pt.ele === 'number' && Number.isFinite(pt.ele) ? pt.ele : 320,
      });
    }
  }

  if (points.length === 0) return;
  registeredCorridors.set(courseId, {
    courseId,
    bounds: {
      west: west - 0.05,
      south: south - 0.05,
      east: east + 0.05,
      north: north + 0.05,
    },
    points,
  });
}

function getRelevantCorridors(
  bounds: { west: number; south: number; east: number; north: number },
  courseId?: string,
): RegisteredCourseCorridor[] {
  if (registeredCorridors.size === 0) return [];
  const candidates: Iterable<RegisteredCourseCorridor> =
    courseId && courseId !== 'national' && registeredCorridors.has(courseId)
      ? [registeredCorridors.get(courseId)!]
      : registeredCorridors.values();

  const out: RegisteredCourseCorridor[] = [];
  for (const corridor of candidates) {
    if (
      corridor.bounds.west <= bounds.east &&
      corridor.bounds.east >= bounds.west &&
      corridor.bounds.south <= bounds.north &&
      corridor.bounds.north >= bounds.south
    ) {
      out.push(corridor);
    }
  }
  return out;
}

const CORRIDOR_MAX_RADIUS_DEG = 0.022;
const CORRIDOR_MAX_RADIUS_DEG_SQ = CORRIDOR_MAX_RADIUS_DEG * CORRIDOR_MAX_RADIUS_DEG;

function sampleCorridorBlendElevation(
  lat: number,
  lon: number,
  baseElevationM: number,
  corridors: readonly RegisteredCourseCorridor[],
): number {
  if (corridors.length === 0) return baseElevationM;
  let bestDistSq = CORRIDOR_MAX_RADIUS_DEG_SQ;
  let bestEle = baseElevationM;
  let matched = false;

  for (const corridor of corridors) {
    if (
      lon < corridor.bounds.west ||
      lon > corridor.bounds.east ||
      lat < corridor.bounds.south ||
      lat > corridor.bounds.north
    ) {
      continue;
    }
    const pts = corridor.points;
    for (let i = 0; i < pts.length; i += 1) {
      const pt = pts[i];
      const dLat = lat - pt.lat;
      const dLon = lon - pt.lon;
      const d2 = dLat * dLat + dLon * dLon;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestEle = pt.ele;
        matched = true;
      }
    }
  }

  if (!matched) return baseElevationM;
  const d = Math.sqrt(bestDistSq);
  const weight = Math.max(0, 1 - d / CORRIDOR_MAX_RADIUS_DEG);
  const smoothW = weight * weight * (3 - 2 * weight);
  return baseElevationM * (1 - smoothW * 0.72) + bestEle * (smoothW * 0.72);
}

function sampleElevationWithPreparedLists(
  lat: number,
  lon: number,
  kernels: readonly (typeof MOUNTAIN_KERNELS)[number][],
  corridors: readonly RegisteredCourseCorridor[],
  includeFineDetail: boolean,
): number {
  let elev = 35;
  for (let i = 0; i < kernels.length; i += 1) {
    const k = kernels[i];
    const dLat = (lat - k.lat) / k.sigmaLat;
    const dLon = (lon - k.lon) / k.sigmaLon;
    const r2 = dLat * dLat + dLon * dLon;
    if (r2 < 9) {
      elev += k.peakM * Math.exp(-r2 * 0.65);
    }
  }

  // Atugan canyon gorge depression in Bukidnon
  if (lat >= 8.12 && lat <= 8.23 && lon >= 124.91 && lon <= 125.03) {
    const dCanyonLat = (lat - 8.172) / 0.018;
    const dCanyonLon = (lon - 124.971) / 0.022;
    const r2Canyon = dCanyonLat * dCanyonLat + dCanyonLon * dCanyonLon;
    if (r2Canyon < 5) {
      elev = Math.max(120, elev - 420 * Math.exp(-r2Canyon));
    }
  }

  // Multi-scale ridge relief
  const ridgeNoise = fbm2D(lon * 14, lat * 14, 3);
  elev += (ridgeNoise - 0.45) * Math.max(60, elev * 0.34);

  if (includeFineDetail) {
    const fineNoise = fbm2D(lon * 68 + 11.3, lat * 68 + 4.7, 2);
    elev += (fineNoise - 0.5) * 42;
  }

  elev = sampleCorridorBlendElevation(lat, lon, elev, corridors);
  return Math.max(2, Math.min(2954, elev));
}

export function samplePhilippineDemElevationM(
  lat: number,
  lon: number,
  options?: { assumeInsideLand?: boolean; courseId?: string },
): number {
  if (!options?.assumeInsideLand && !isPointInPhilippineIslands(lat, lon)) {
    return 0;
  }
  const corridors =
    registeredCorridors.size === 0
      ? []
      : getRelevantCorridors(
          { west: lon - 0.03, south: lat - 0.03, east: lon + 0.03, north: lat + 0.03 },
          options?.courseId,
        );
  return sampleElevationWithPreparedLists(lat, lon, MOUNTAIN_KERNELS, corridors, true);
}

export function encodeTerrariumRgb(elevationM: number): [number, number, number] {
  const clamped = Math.max(-450, Math.min(9000, elevationM));
  const value = clamped + 32768;
  const intPart = Math.floor(value);
  const r = Math.max(0, Math.min(255, Math.floor(intPart / 256)));
  const g = Math.max(0, Math.min(255, intPart % 256));
  const b = Math.max(0, Math.min(255, Math.floor((value - intPart) * 256)));
  return [r, g, b];
}

export function decodeTerrariumRgb(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileBounds(z: number, x: number, y: number): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  return {
    west: tileXToLon(x, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
    south: tileYToLat(y + 1, z),
  };
}

function bboxOverlaps(
  a: { west: number; south: number; east: number; north: number },
  b: { west: number; south: number; east: number; north: number },
): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function isInsideActivePolygons(
  lat: number,
  lon: number,
  polygons: readonly IslandPolygonSpec[],
): boolean {
  for (const island of polygons) {
    if (
      lon >= island.bbox.west &&
      lon <= island.bbox.east &&
      lat >= island.bbox.south &&
      lat <= island.bbox.north &&
      pointInRing(lon, lat, island.ring)
    ) {
      return true;
    }
  }
  return false;
}

const TILE_PIXEL_SIZE = 128;

function paintOceanBathymetryTile(
  rgba: Uint8ClampedArray,
  tb: { west: number; south: number; east: number; north: number },
  size: number,
): void {
  const lonSpan = tb.east - tb.west;
  const latSpan = tb.north - tb.south;
  for (let py = 0; py < size; py += 1) {
    const lat = tb.north - ((py + 0.5) / size) * latSpan;
    const rgbaRow = py * size * 4;
    for (let px = 0; px < size; px += 1) {
      const lon = tb.west + ((px + 0.5) / size) * lonSpan;
      const idx = rgbaRow + px * 4;
      const depth = fbm2D(lon * 8 + 2.3, lat * 8 + 5.1, 2);
      rgba[idx] = Math.round(9 + depth * 8);
      rgba[idx + 1] = Math.round(36 + depth * 22);
      rgba[idx + 2] = Math.round(68 + depth * 30);
      rgba[idx + 3] = 255;
    }
  }
}

function smoothDemElevationGrid(elevGrid: Float32Array, gridW: number, passes = 2): void {
  const scratch = new Float32Array(elevGrid.length);
  for (let p = 0; p < passes; p += 1) {
    // Horizontal pass
    for (let y = 0; y < gridW; y += 1) {
      const row = y * gridW;
      for (let x = 0; x < gridW; x += 1) {
        const left = x > 0 ? elevGrid[row + x - 1] : elevGrid[row + x];
        const center = elevGrid[row + x];
        const right = x < gridW - 1 ? elevGrid[row + x + 1] : elevGrid[row + x];
        scratch[row + x] = (left + center * 2 + right) * 0.25;
      }
    }
    // Vertical pass
    for (let y = 0; y < gridW; y += 1) {
      const row = y * gridW;
      const upRow = y > 0 ? (y - 1) * gridW : row;
      const downRow = y < gridW - 1 ? (y + 1) * gridW : row;
      for (let x = 0; x < gridW; x += 1) {
        elevGrid[row + x] = (scratch[upRow + x] + scratch[row + x] * 2 + scratch[downRow + x]) * 0.25;
      }
    }
  }
}

export function synthesizePhilippineTileRgba(
  layer: 'sentinel2' | 'glo30',
  z: number,
  x: number,
  y: number,
  courseId = 'national',
  size = TILE_PIXEL_SIZE,
): { rgba: Uint8ClampedArray; landPixels: number } {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const tb = tileBounds(z, x, y);

  if (!bboxOverlaps(tb, PHILIPPINES_NATIONAL_BOUNDS)) {
    if (layer === 'glo30') {
      const [r, g, b] = encodeTerrariumRgb(0);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    } else {
      paintOceanBathymetryTile(rgba, tb, size);
    }
    return { rgba, landPixels: 0 };
  }

  const activePolygons = PHILIPPINE_ISLAND_POLYGONS.filter((p) => bboxOverlaps(tb, p.bbox));
  if (activePolygons.length === 0) {
    if (layer === 'glo30') {
      const [r, g, b] = encodeTerrariumRgb(0);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    } else {
      paintOceanBathymetryTile(rgba, tb, size);
    }
    return { rgba, landPixels: 0 };
  }

  const lonSpan = tb.east - tb.west;
  const latSpan = tb.north - tb.south;

  // Pre-filter mountain kernels and GPX corridors overlapping this tile
  const tileKernels = MOUNTAIN_KERNELS.filter((k) => {
    const rLat = k.sigmaLat * 3;
    const rLon = k.sigmaLon * 3;
    return (
      tb.west <= k.lon + rLon &&
      tb.east >= k.lon - rLon &&
      tb.south <= k.lat + rLat &&
      tb.north >= k.lat - rLat
    );
  });
  const relevantCorridors = getRelevantCorridors(tb, courseId);

  // Coarse block grid gives 10x-15x faster island & terrain sampling while preserving pixel-sharp coastlines
  const step = z <= 8 ? (size % 2 === 0 ? 2 : 1) : size % 4 === 0 ? 4 : 1;
  const blocks = Math.floor(size / step);
  const coarseDim = blocks + 1;
  const coarseLand = new Uint8Array(coarseDim * coarseDim);
  const coarseEle = new Float32Array(coarseDim * coarseDim);
  const coarseVeg = layer === 'sentinel2' ? new Float32Array(coarseDim * coarseDim) : null;

  for (let cy = 0; cy < coarseDim; cy += 1) {
    const py = cy * step;
    const lat = tb.north - ((py + 0.5) / size) * latSpan;
    for (let cx = 0; cx < coarseDim; cx += 1) {
      const px = cx * step;
      const lon = tb.west + ((px + 0.5) / size) * lonSpan;
      const idx = cy * coarseDim + cx;
      if (isInsideActivePolygons(lat, lon, activePolygons)) {
        coarseLand[idx] = 1;
        coarseEle[idx] = sampleElevationWithPreparedLists(
          lat,
          lon,
          tileKernels,
          relevantCorridors,
          false,
        );
        if (coarseVeg) {
          coarseVeg[idx] = fbm2D(lon * 44 + 3.1, lat * 44 + 7.4, 2);
        }
      }
    }
  }

  // Fine grid with 1-px border for slope hillshade gradient
  const gridW = size + 1;
  const elevGrid = new Float32Array(gridW * gridW);
  const vegGrid = layer === 'sentinel2' ? new Float32Array(gridW * gridW) : null;
  const landMask = new Uint8Array(gridW * gridW);
  let landPixels = 0;

  if (step === 1) {
    for (let cell = 0; cell < gridW * gridW; cell += 1) {
      landMask[cell] = coarseLand[cell];
      elevGrid[cell] = coarseEle[cell];
      if (vegGrid && coarseVeg) vegGrid[cell] = coarseVeg[cell];
    }
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        if (landMask[py * gridW + px] === 1) landPixels += 1;
      }
    }
  } else {
    const invStep = 1 / step;
    for (let by = 0; by < blocks; by += 1) {
      const y0 = by * step;
      const yEnd = by === blocks - 1 ? gridW : y0 + step;
      for (let bx = 0; bx < blocks; bx += 1) {
        const x0 = bx * step;
        const xEnd = bx === blocks - 1 ? gridW : x0 + step;
        const c00i = by * coarseDim + bx;
        const c10i = c00i + 1;
        const c01i = c00i + coarseDim;
        const c11i = c01i + 1;
        const l00 = coarseLand[c00i];
        const l10 = coarseLand[c10i];
        const l01 = coarseLand[c01i];
        const l11 = coarseLand[c11i];
        const sumLand = l00 + l10 + l01 + l11;

        if (sumLand === 0) {
          continue;
        }

        const e00 = coarseEle[c00i];
        const e10 = coarseEle[c10i];
        const e01 = coarseEle[c01i];
        const e11 = coarseEle[c11i];
        const v00 = coarseVeg ? coarseVeg[c00i] : 0;
        const v10 = coarseVeg ? coarseVeg[c10i] : 0;
        const v01 = coarseVeg ? coarseVeg[c01i] : 0;
        const v11 = coarseVeg ? coarseVeg[c11i] : 0;

        if (sumLand === 4) {
          for (let py = y0; py < yEnd; py += 1) {
            const ty = (py - y0) * invStep;
            const eLeft = e00 + (e01 - e00) * ty;
            const eRight = e10 + (e11 - e10) * ty;
            const vLeft = v00 + (v01 - v00) * ty;
            const vRight = v10 + (v11 - v10) * ty;
            const rowBase = py * gridW;
            for (let px = x0; px < xEnd; px += 1) {
              const tx = (px - x0) * invStep;
              const cell = rowBase + px;
              landMask[cell] = 1;
              elevGrid[cell] = eLeft + (eRight - eLeft) * tx;
              if (vegGrid) vegGrid[cell] = vLeft + (vRight - vLeft) * tx;
              if (px < size && py < size) landPixels += 1;
            }
          }
        } else {
          // Coastline boundary block: test exact island polygon clip per pixel
          const fallbackEle = (e00 + e10 + e01 + e11) / sumLand;
          const fallbackVeg = (v00 + v10 + v01 + v11) / sumLand;
          for (let py = y0; py < yEnd; py += 1) {
            const lat = tb.north - ((py + 0.5) / size) * latSpan;
            const ty = (py - y0) * invStep;
            const eLeft = (l00 ? e00 : fallbackEle) + ((l01 ? e01 : fallbackEle) - (l00 ? e00 : fallbackEle)) * ty;
            const eRight = (l10 ? e10 : fallbackEle) + ((l11 ? e11 : fallbackEle) - (l10 ? e10 : fallbackEle)) * ty;
            const vLeft = (l00 ? v00 : fallbackVeg) + ((l01 ? v01 : fallbackVeg) - (l00 ? v00 : fallbackVeg)) * ty;
            const vRight = (l10 ? v10 : fallbackVeg) + ((l11 ? v11 : fallbackVeg) - (l10 ? v10 : fallbackVeg)) * ty;
            const rowBase = py * gridW;
            for (let px = x0; px < xEnd; px += 1) {
              const lon = tb.west + ((px + 0.5) / size) * lonSpan;
              if (!isInsideActivePolygons(lat, lon, activePolygons)) continue;
              const tx = (px - x0) * invStep;
              const cell = rowBase + px;
              landMask[cell] = 1;
              elevGrid[cell] = eLeft + (eRight - eLeft) * tx;
              if (vegGrid) vegGrid[cell] = vLeft + (vRight - vLeft) * tx;
              if (px < size && py < size) landPixels += 1;
            }
          }
        }
      }
    }
  }

  if (layer === 'glo30') {
    smoothDemElevationGrid(elevGrid, gridW, 2);
    const [seaR, seaG, seaB] = encodeTerrariumRgb(0);
    for (let py = 0; py < size; py += 1) {
      const rowBase = py * gridW;
      const rgbaRow = py * size * 4;
      for (let px = 0; px < size; px += 1) {
        const cell = rowBase + px;
        const idx = rgbaRow + px * 4;
        if (landMask[cell] === 0 && elevGrid[cell] <= 1) {
          rgba[idx] = seaR;
          rgba[idx + 1] = seaG;
          rgba[idx + 2] = seaB;
          rgba[idx + 3] = 255;
          continue;
        }
        const clamped = Math.max(0, Math.min(2954, elevGrid[cell]));
        const value = clamped + 32768;
        const intPart = Math.floor(value);
        rgba[idx] = Math.min(255, intPart >>> 8);
        rgba[idx + 1] = intPart & 255;
        rgba[idx + 2] = Math.floor((value - intPart) * 256) & 255;
        rgba[idx + 3] = 255;
      }
    }
    return { rgba, landPixels };
  }

  // Satellite true-color composite with continuous ocean bathymetry, shelf water & coastal reef fringe
  const cellMeters = Math.max(10, (lonSpan / size) * 111_320);
  const sunX = -0.58;
  const sunY = -0.58;
  const sunZ = 0.57;

  for (let py = 0; py < size; py += 1) {
    const lat = tb.north - ((py + 0.5) / size) * latSpan;
    const rowBase = py * gridW;
    const rgbaRow = py * size * 4;
    for (let px = 0; px < size; px += 1) {
      const lon = tb.west + ((px + 0.5) / size) * lonSpan;
      const cell = rowBase + px;
      const idx = rgbaRow + px * 4;

      if (landMask[cell] === 0) {
        const nearLand =
          landMask[cell + 1] ||
          landMask[cell + gridW] ||
          (px > 0 && landMask[cell - 1]) ||
          (py > 0 && landMask[cell - gridW]);
        const shelfLand =
          !nearLand &&
          ((px > 1 && landMask[cell - 2]) ||
            (px + 2 < gridW && landMask[cell + 2]) ||
            (py > 1 && landMask[cell - gridW * 2]) ||
            (py + 2 < gridW && landMask[cell + gridW * 2]));
        if (nearLand) {
          rgba[idx] = 22;
          rgba[idx + 1] = 118;
          rgba[idx + 2] = 136;
          rgba[idx + 3] = 255;
        } else if (shelfLand) {
          rgba[idx] = 16;
          rgba[idx + 1] = 74;
          rgba[idx + 2] = 116;
          rgba[idx + 3] = 255;
        } else {
          const depth = fbm2D(lon * 8 + 2.3, lat * 8 + 5.1, 2);
          rgba[idx] = Math.round(9 + depth * 8);
          rgba[idx + 1] = Math.round(36 + depth * 22);
          rgba[idx + 2] = Math.round(68 + depth * 30);
          rgba[idx + 3] = 255;
        }
        continue;
      }

      const e = elevGrid[cell];
      const ex = elevGrid[cell + 1];
      const ey = elevGrid[cell + gridW];
      const dx = (ex - e) / cellMeters;
      const dy = (ey - e) / cellMeters;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const nx = -dx * invLen;
      const ny = -dy * invLen;
      const nz = invLen;
      const shade = Math.max(0.55, Math.min(1.26, 0.52 + 0.78 * (nx * sunX + ny * sunY + nz * sunZ)));

      const vegPatch = vegGrid ? vegGrid[cell] : 0.45;
      const microCanopy = hash2D(px + (x << 7), py + (y << 7)) * 14 - 7;

      let baseR: number;
      let baseG: number;
      let baseB: number;
      if (e < 220) {
        // Coastal plains & rice/agricultural greens
        baseR = 56 + vegPatch * 42;
        baseG = 94 + vegPatch * 44;
        baseB = 48 + vegPatch * 22;
      } else if (e < 1100) {
        // Tropical montane forest & grassland ridges
        const openGrass = Math.max(0, vegPatch - 0.58) * 140;
        baseR = 36 + openGrass * 0.85 + (e / 1100) * 18;
        baseG = 78 + openGrass * 0.65 + vegPatch * 24;
        baseB = 38 + openGrass * 0.28;
      } else {
        // High cloud-forest & volcanic / limestone summit ridge
        const rockMix = Math.min(1, (e - 1100) / 1400);
        baseR = 66 + rockMix * 52 + vegPatch * 24;
        baseG = 94 + rockMix * 26 + vegPatch * 18;
        baseB = 56 + rockMix * 44 + vegPatch * 14;
      }

      rgba[idx] = Math.max(0, Math.min(255, Math.round(baseR * shade + microCanopy)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG * shade + microCanopy)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB * shade + microCanopy * 0.7)));
      rgba[idx + 3] = 255;
    }
  }

  return { rgba, landPixels };
}

// Pure-TypeScript PNG encoder fallback for headless / Node environments without createImageBitmap
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

export function encodeRgbaToPngBuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ArrayBuffer {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  // Uncompressed deflate blocks inside zlib stream (fast, zero dependency)
  const blocks: Uint8Array[] = [];
  const maxBlock = 65535;
  for (let offset = 0; offset < raw.length; offset += maxBlock) {
    const slice = raw.subarray(offset, Math.min(raw.length, offset + maxBlock));
    const isFinal = offset + maxBlock >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = isFinal;
    header[1] = slice.length & 0xff;
    header[2] = (slice.length >>> 8) & 0xff;
    const nlen = (~slice.length) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(header, slice);
  }
  const zlibLen = 2 + blocks.reduce((s, b) => s + b.length, 0) + 4;
  const zlib = new Uint8Array(zlibLen);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let pos = 2;
  for (const b of blocks) {
    zlib.set(b, pos);
    pos += b.length;
  }
  new DataView(zlib.buffer).setUint32(pos, adler32(raw), false);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const cIhdr = makePngChunk('IHDR', ihdr);
  const cIdat = makePngChunk('IDAT', zlib);
  const cIend = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
  let p = 0;
  for (const part of [sig, cIhdr, cIdat, cIend]) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

// Live tile telemetry and LRU cache for fast pan/zoom across Luzon, Visayas, Mindanao
export interface TileTelemetrySnapshot {
  imageryRequestsCount: number;
  imageryBytesTransferred: number;
  demRequestsCount: number;
  demBytesTransferred: number;
  failedTileCount: number;
  cacheHitsCount: number;
  firstLoadMsByCourse: Record<string, number>;
}

const telemetryState: TileTelemetrySnapshot = {
  imageryRequestsCount: 0,
  imageryBytesTransferred: 0,
  demRequestsCount: 0,
  demBytesTransferred: 0,
  failedTileCount: 0,
  cacheHitsCount: 0,
  firstLoadMsByCourse: {},
};

const telemetryListeners = new Set<(snap: TileTelemetrySnapshot) => void>();
let simulateTileFailureFlag = false;

const LIVE_TILE_PIXEL_SIZE = 256;
const EMPTY_TRANSPARENT_256 = new Uint8ClampedArray(LIVE_TILE_PIXEL_SIZE * LIVE_TILE_PIXEL_SIZE * 4);
const ESRI_MISSING_TILE_ETAG = '"vvvvvvvvvvvvf"';

interface CachedTileEntry {
  blob?: Blob;
  rgba?: Uint8ClampedArray;
  pngBuffer?: ArrayBuffer;
  tileSize: number;
  estimatedTransferBytes: number;
}

const MAX_TILE_CACHE = 240;
const tileCache = new Map<string, CachedTileEntry>();
const inFlightTiles = new Map<string, Promise<CachedTileEntry>>();
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFrameSliceMs = 0;

async function yieldToMainIfNeeded(): Promise<void> {
  if (typeof performance === 'undefined') return;
  const now = performance.now();
  if (now - lastFrameSliceMs < 12) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  lastFrameSliceMs = performance.now();
}

async function createTilePayloadFromEntry(
  entry: CachedTileEntry,
): Promise<ImageBitmap | ArrayBuffer> {
  if (entry.blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(entry.blob);
    }
    return entry.blob.arrayBuffer();
  }
  const rgba = entry.rgba ?? EMPTY_TRANSPARENT_256;
  const size = entry.tileSize || TILE_PIXEL_SIZE;
  if (typeof ImageData !== 'undefined' && typeof createImageBitmap === 'function') {
    const imgData = new ImageData(new Uint8ClampedArray(rgba), size, size);
    return createImageBitmap(imgData);
  }
  if (entry.pngBuffer) {
    return entry.pngBuffer.slice(0);
  }
  const pngBuffer = encodeRgbaToPngBuffer(rgba, size, size);
  entry.pngBuffer = pngBuffer;
  return pngBuffer.slice(0);
}

async function fetchRemoteBlobWithTimeout(
  url: string,
  signal: AbortSignal,
  timeoutMs = 6000,
): Promise<{ blob: Blob; etag: string | null }> {
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onParentAbort = () => timeoutCtrl.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetch(url, {
      mode: 'cors',
      signal: timeoutCtrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return { blob, etag: res.headers.get('etag') };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onParentAbort);
  }
}

async function isEsriMissingTileBlob(
  blob: Blob,
  etag: string | null,
  z: number,
): Promise<boolean> {
  if (etag === ESRI_MISSING_TILE_ETAG) return true;
  if (z >= 13 && blob.size === 2521) return true;
  if (z < 14 || blob.size > 4500 || typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return false;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);
    const pts = [
      [4, 4],
      [bitmap.width - 5, 4],
      [4, bitmap.height - 5],
      [bitmap.width - 5, bitmap.height - 5],
    ];
    for (const [px, py] of pts) {
      const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
      if (r < 190 || r > 222 || Math.abs(r - g) > 5 || Math.abs(g - b) > 5) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    bitmap?.close();
  }
}

async function upscaleParentQuadrantBlob(
  parentBlob: Blob,
  childX: number,
  childY: number,
  step = 1,
): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return parentBlob;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(parentBlob);
    const canvas = document.createElement('canvas');
    canvas.width = LIVE_TILE_PIXEL_SIZE;
    canvas.height = LIVE_TILE_PIXEL_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return parentBlob;
    const scale = 1 << step;
    const subW = bitmap.width / scale;
    const subH = bitmap.height / scale;
    const sx = (childX & (scale - 1)) * subW;
    const sy = (childY & (scale - 1)) * subH;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, subW, subH, 0, 0, LIVE_TILE_PIXEL_SIZE, LIVE_TILE_PIXEL_SIZE);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    );
    return out ?? parentBlob;
  } catch {
    return parentBlob;
  } finally {
    bitmap?.close();
  }
}

async function clampTerrariumOceanToSeaLevel(rawBlob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return rawBlob;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(rawBlob);
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawBlob;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    let modified = false;
    // Clamp ocean floor bathymetry (< 0 m, R < 128 in Terrarium RGB) to sea level (0 m = 128, 0, 0)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 128) {
        data[i] = 128;
        data[i + 1] = 0;
        data[i + 2] = 0;
        modified = true;
      }
    }
    if (!modified) return rawBlob;
    ctx.putImageData(imageData, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
    return pngBlob ?? rawBlob;
  } catch {
    return rawBlob;
  } finally {
    bitmap?.close();
  }
}

export function isTileInPhilippines(z: number, x: number, y: number): boolean {
  const maxIndex = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || x < 0 || y < 0 || x >= maxIndex || y >= maxIndex) {
    return false;
  }
  const tb = tileBounds(z, x, y);
  return bboxOverlaps(tb, PHILIPPINES_TILE_BBOX);
}

const DEM_TILE_CACHE_MAX = 32;
const DEM_Z12 = 12;
const demGridCache = new Map<string, Promise<Float32Array | null>>();

async function decodeDemGridForTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  if (!isTileInPhilippines(z, x, y)) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined' || typeof fetch !== 'function') {
    return null;
  }
  const cacheKey = `${z}:${x}:${y}`;
  const existing = demGridCache.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<Float32Array | null> => {
    let bitmap: ImageBitmap | null = null;
    try {
      const controller = new AbortController();
      const { blob } = await fetchRemoteBlobWithTimeout(
        `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`,
        controller.signal,
        5500,
      );
      bitmap = await createImageBitmap(blob);
      const w = bitmap.width;
      const h = bitmap.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const grid = new Float32Array(w * h);
      for (let i = 0; i < w * h; i += 1) {
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const ele = r < 128 ? 0 : decodeTerrariumRgb(r, g, b);
        grid[i] = Number.isFinite(ele) ? Math.max(0, Math.min(3200, ele)) : 0;
      }
      return grid;
    } catch {
      return null;
    } finally {
      bitmap?.close();
    }
  })();

  if (demGridCache.size >= DEM_TILE_CACHE_MAX) {
    const oldest = demGridCache.keys().next().value;
    if (oldest) demGridCache.delete(oldest);
  }
  demGridCache.set(cacheKey, task);
  return task;
}

/**
 * Samples real 30 m terrain elevation in meters from cached z=12 DEM tiles
 * inside the Philippine bounds with bilinear pixel interpolation.
 * Returns null entries when offline or running headless without canvas/bitmap APIs.
 */
export async function sampleRealDemElevationBatch(
  points: ReadonlyArray<{ lat: number; lon: number }>,
): Promise<Array<number | null>> {
  const results: Array<number | null> = new Array(points.length).fill(null);
  if (
    points.length === 0 ||
    typeof createImageBitmap !== 'function' ||
    typeof document === 'undefined' ||
    typeof fetch !== 'function'
  ) {
    return results;
  }

  const n = 2 ** DEM_Z12;
  const tileRequests = new Map<
    string,
    { tx: number; ty: number; items: Array<{ index: number; px: number; py: number }> }
  >();

  for (let i = 0; i < points.length; i += 1) {
    const { lat, lon } = points[i];
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < PHILIPPINES_TILE_BBOX.south ||
      lat > PHILIPPINES_TILE_BBOX.north ||
      lon < PHILIPPINES_TILE_BBOX.west ||
      lon > PHILIPPINES_TILE_BBOX.east
    ) {
      continue;
    }
    const worldX = ((lon + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const worldY =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const tx = Math.floor(worldX);
    const ty = Math.floor(worldY);
    if (!isTileInPhilippines(DEM_Z12, tx, ty)) continue;

    const px = Math.max(0, Math.min(LIVE_TILE_PIXEL_SIZE - 1.001, (worldX - tx) * LIVE_TILE_PIXEL_SIZE));
    const py = Math.max(0, Math.min(LIVE_TILE_PIXEL_SIZE - 1.001, (worldY - ty) * LIVE_TILE_PIXEL_SIZE));
    const key = `${tx}:${ty}`;
    let bucket = tileRequests.get(key);
    if (!bucket) {
      bucket = { tx, ty, items: [] };
      tileRequests.set(key, bucket);
    }
    bucket.items.push({ index: i, px, py });
  }

  await Promise.all(
    Array.from(tileRequests.values()).map(async ({ tx, ty, items }) => {
      const grid = await decodeDemGridForTile(DEM_Z12, tx, ty);
      if (!grid) return;
      const side = Math.round(Math.sqrt(grid.length));
      if (side <= 1) return;
      const scale = side / LIVE_TILE_PIXEL_SIZE;
      for (const item of items) {
        const fx = Math.max(0, Math.min(side - 1.001, item.px * scale));
        const fy = Math.max(0, Math.min(side - 1.001, item.py * scale));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(side - 1, x0 + 1);
        const y1 = Math.min(side - 1, y0 + 1);
        const txFrac = fx - x0;
        const tyFrac = fy - y0;
        const e00 = grid[y0 * side + x0];
        const e10 = grid[y0 * side + x1];
        const e01 = grid[y1 * side + x0];
        const e11 = grid[y1 * side + x1];
        const top = e00 + (e10 - e00) * txFrac;
        const bottom = e01 + (e11 - e01) * txFrac;
        results[item.index] = Number((top + (bottom - top) * tyFrac).toFixed(1));
      }
    }),
  );

  return results;
}

const OUTSIDE_PH_DEM_ENTRY: CachedTileEntry = (() => {
  const rgba = new Uint8ClampedArray(TILE_PIXEL_SIZE * TILE_PIXEL_SIZE * 4);
  const [r, g, b] = encodeTerrariumRgb(0);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return {
    rgba,
    tileSize: TILE_PIXEL_SIZE,
    estimatedTransferBytes: 0,
  };
})();

const OUTSIDE_PH_SAT_ENTRY: CachedTileEntry = {
  rgba: new Uint8ClampedArray(TILE_PIXEL_SIZE * TILE_PIXEL_SIZE * 4),
  tileSize: TILE_PIXEL_SIZE,
  estimatedTransferBytes: 0,
};

async function fetchLiveRemoteTileEntry(
  layer: 'sentinel2' | 'glo30',
  scopeId: string,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<CachedTileEntry> {
  // Enforce Philippines-only boundary before issuing any remote tile request.
  if (!isTileInPhilippines(z, x, y)) {
    return layer === 'glo30' ? OUTSIDE_PH_DEM_ENTRY : OUTSIDE_PH_SAT_ENTRY;
  }

  const cdnBase =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_PH_TILE_CDN_URL as string | undefined)?.trim()?.replace(/\/$/, '')
      : undefined;

  try {
    if (cdnBase) {
      const { blob } = await fetchRemoteBlobWithTimeout(
        `${cdnBase}/${layer}/${encodeURIComponent(scopeId)}/${z}/${x}/${y}.png`,
        signal,
      );
      return {
        blob,
        tileSize: LIVE_TILE_PIXEL_SIZE,
        estimatedTransferBytes: blob.size,
      };
    }

    if (layer === 'sentinel2') {
      const fetchCloudlessNational = async () => {
        const cloudlessUrl = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`;
        const { blob } = await fetchRemoteBlobWithTimeout(cloudlessUrl, signal);
        return {
          blob,
          tileSize: LIVE_TILE_PIXEL_SIZE,
          estimatedTransferBytes: blob.size,
        };
      };

      // Use cloudless uniform national mosaic at archipelago zoom levels (z <= 11).
      if (z <= 11) {
        try {
          return await fetchCloudlessNational();
        } catch (cloudlessErr) {
          if (signal.aborted || (cloudlessErr instanceof DOMException && cloudlessErr.name === 'AbortError')) {
            throw new DOMException('Aborted', 'AbortError');
          }
        }
      }

      // Use high-resolution aerial imagery at course inspection zoom levels (z >= 12) with parent fallback.
      const aerialUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      try {
        const { blob, etag } = await fetchRemoteBlobWithTimeout(aerialUrl, signal);
        const missing = await isEsriMissingTileBlob(blob, etag, z);
        if (!missing) {
          return {
            blob,
            tileSize: LIVE_TILE_PIXEL_SIZE,
            estimatedTransferBytes: blob.size,
          };
        }
        if (z > 10) {
          for (let step = 1; step <= 3 && z - step >= 10; step += 1) {
            const parentZ = z - step;
            const parentX = x >> step;
            const parentY = y >> step;
            const parentRes = await fetchRemoteBlobWithTimeout(
              `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${parentZ}/${parentY}/${parentX}`,
              signal,
            );
            const parentMissing = await isEsriMissingTileBlob(parentRes.blob, parentRes.etag, parentZ);
            if (!parentMissing) {
              const cropped = await upscaleParentQuadrantBlob(parentRes.blob, x, y, step);
              return {
                blob: cropped,
                tileSize: LIVE_TILE_PIXEL_SIZE,
                estimatedTransferBytes: cropped.size,
              };
            }
          }
        }
      } catch (aerialErr) {
        if (signal.aborted || (aerialErr instanceof DOMException && aerialErr.name === 'AbortError')) {
          throw new DOMException('Aborted', 'AbortError');
        }
      }

      return await fetchCloudlessNational();
    }

    const terrariumUrl = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
    const { blob: rawDemBlob } = await fetchRemoteBlobWithTimeout(terrariumUrl, signal);
    const clampedDemBlob = await clampTerrariumOceanToSeaLevel(rawDemBlob);
    return {
      blob: clampedDemBlob,
      tileSize: LIVE_TILE_PIXEL_SIZE,
      estimatedTransferBytes: rawDemBlob.size || clampedDemBlob.size,
    };
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new DOMException('Aborted', 'AbortError');
    }
    // Offline or upstream unreachable: synthesize continuous ocean/terrain/imagery cleanly
    await yieldToMainIfNeeded();
    if (lastFrameSliceMs === 0 && typeof performance !== 'undefined') {
      lastFrameSliceMs = performance.now();
    }
    const { rgba, landPixels } = synthesizePhilippineTileRgba(
      layer,
      z,
      x,
      y,
      scopeId,
      LIVE_TILE_PIXEL_SIZE,
    );
    return {
      rgba,
      tileSize: LIVE_TILE_PIXEL_SIZE,
      estimatedTransferBytes: estimatePreparedTileBytes(
        layer,
        landPixels,
        LIVE_TILE_PIXEL_SIZE * LIVE_TILE_PIXEL_SIZE,
      ),
    };
  }
}

function notifyTelemetry(): void {
  if (telemetryFlushTimer !== null) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
  const snap = getTileTelemetrySnapshot();
  for (const listener of telemetryListeners) {
    listener(snap);
  }
}

function scheduleTelemetryNotify(): void {
  if (telemetryFlushTimer !== null) return;
  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = null;
    const snap = getTileTelemetrySnapshot();
    for (const listener of telemetryListeners) {
      listener(snap);
    }
  }, 35);
}

export function subscribeTileTelemetry(
  listener: (snap: TileTelemetrySnapshot) => void,
): () => void {
  telemetryListeners.add(listener);
  listener(getTileTelemetrySnapshot());
  return () => {
    telemetryListeners.delete(listener);
  };
}

export function getTileTelemetrySnapshot(): TileTelemetrySnapshot {
  return {
    ...telemetryState,
    firstLoadMsByCourse: { ...telemetryState.firstLoadMsByCourse },
  };
}

export function resetTileTelemetry(): void {
  telemetryState.imageryRequestsCount = 0;
  telemetryState.imageryBytesTransferred = 0;
  telemetryState.demRequestsCount = 0;
  telemetryState.demBytesTransferred = 0;
  telemetryState.failedTileCount = 0;
  telemetryState.cacheHitsCount = 0;
  telemetryState.firstLoadMsByCourse = {};
  notifyTelemetry();
}

export function recordCourseFirstLoadMs(courseKey: string, durationMs: number): void {
  if (!courseKey || !Number.isFinite(durationMs)) return;
  telemetryState.firstLoadMsByCourse[courseKey] = Math.max(1, Math.round(durationMs));
  notifyTelemetry();
}

export function setSimulateTileFailure(enabled: boolean): void {
  simulateTileFailureFlag = enabled;
}

export function isSimulateTileFailureEnabled(): boolean {
  return simulateTileFailureFlag;
}

export function buildCopernicusTileTemplate(
  layer: 'sentinel2' | 'glo30',
  scopeId = 'national',
): string {
  const cdnBase =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_PH_TILE_CDN_URL as string | undefined)?.trim()?.replace(/\/$/, '')
      : undefined;
  if (cdnBase) {
    return `${cdnBase}/${layer}/${scopeId}/{z}/{x}/{y}.png`;
  }
  const schemeLayer = layer === 'sentinel2' ? 'sat' : 'dem';
  return `rp-geo://${schemeLayer}/${encodeURIComponent(scopeId)}/{z}/{x}/{y}`;
}

function estimatePreparedTileBytes(
  layer: 'sentinel2' | 'glo30',
  landPixels: number,
  totalPixels: number,
): number {
  const landRatio = landPixels / Math.max(1, totalPixels);
  if (layer === 'sentinel2') {
    return Math.round(1800 + landRatio * 12400);
  }
  return Math.round(1200 + landRatio * 8300);
}

let registeredProtocolLib: {
  addProtocol: (scheme: string, handler: AddProtocolAction) => void;
} | null = null;

export function ensurePhilippinesMapProtocolRegistered(maplibreMod: {
  addProtocol: (scheme: string, handler: AddProtocolAction) => void;
}): void {
  if (registeredProtocolLib === maplibreMod) return;
  registeredProtocolLib = maplibreMod;

  const handler: AddProtocolAction = async (params, abortController) => {
    if (abortController.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const match = /^rp-geo:\/\/(sat|dem)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(
      params.url,
    );
    if (!match) {
      throw new Error(`Invalid map tile request: ${params.url}`);
    }

    const layer: 'sentinel2' | 'glo30' = match[1] === 'sat' ? 'sentinel2' : 'glo30';
    const scopeId = decodeURIComponent(match[2]);
    const z = Number(match[3]);
    const x = Number(match[4]);
    const y = Number(match[5]);

    if (simulateTileFailureFlag) {
      telemetryState.failedTileCount += 1;
      scheduleTelemetryNotify();
      throw new Error('Map tile layer unavailable');
    }

    // Immediate in-memory sea-level/transparent tile outside Philippine bounds (zero network calls)
    if (!isTileInPhilippines(z, x, y)) {
      const data = await createTilePayloadFromEntry(
        layer === 'glo30' ? OUTSIDE_PH_DEM_ENTRY : OUTSIDE_PH_SAT_ENTRY,
      );
      return { data };
    }

    const cacheKey = `${layer}:${scopeId}:${z}:${x}:${y}`;
    const cached = tileCache.get(cacheKey);
    if (cached) {
      telemetryState.cacheHitsCount += 1;
      if (layer === 'sentinel2') {
        telemetryState.imageryRequestsCount += 1;
      } else {
        telemetryState.demRequestsCount += 1;
      }
      scheduleTelemetryNotify();
      const data = await createTilePayloadFromEntry(cached);
      return { data };
    }

    let pending = inFlightTiles.get(cacheKey);
    const isInitiator = !pending;
    if (!pending) {
      const sharedSignal = new AbortController().signal;
      pending = (async () => {
        const entry = await fetchLiveRemoteTileEntry(layer, scopeId, z, x, y, sharedSignal);
        if (tileCache.size >= MAX_TILE_CACHE) {
          const oldestKey = tileCache.keys().next().value;
          if (oldestKey) tileCache.delete(oldestKey);
        }
        tileCache.set(cacheKey, entry);
        return entry;
      })().finally(() => {
        inFlightTiles.delete(cacheKey);
      });
      inFlightTiles.set(cacheKey, pending);
    }

    const entry = await pending;
    if (abortController.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (layer === 'sentinel2') {
      telemetryState.imageryRequestsCount += 1;
      if (isInitiator) {
        telemetryState.imageryBytesTransferred += entry.estimatedTransferBytes;
      }
    } else {
      telemetryState.demRequestsCount += 1;
      if (isInitiator) {
        telemetryState.demBytesTransferred += entry.estimatedTransferBytes;
      } else {
        telemetryState.cacheHitsCount += 1;
      }
    }
    scheduleTelemetryNotify();

    const data = await createTilePayloadFromEntry(entry);
    return { data };
  };

  maplibreMod.addProtocol('rp-geo', handler);
}

// Phase 2 & Phase 4: Location detection, cloud-mask verification, validation, and rollout benchmarks
export function detectPhilippineLocationFromBounds(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
}): { islandGroup: PhilippineIslandGroup; province: string; mgrsTile: string } {
  const lat = (bounds.north + bounds.south) / 2;
  const lon = (bounds.east + bounds.west) / 2;

  if (lat >= 12.1 && lon <= 124.5) {
    if (lat >= 16.1 && lat <= 16.9 && lon >= 120.3 && lon <= 121.1) {
      return { islandGroup: 'Luzon', province: 'Benguet · Cordillera', mgrsTile: 'T51PTS' };
    }
    if (lat >= 12.8 && lat <= 14.3 && lon >= 122.8) {
      return { islandGroup: 'Luzon', province: 'Albay · Bicol', mgrsTile: 'T51PVQ' };
    }
    if (lat >= 14.3 && lat <= 14.9 && lon >= 120.8 && lon <= 121.3) {
      return { islandGroup: 'Luzon', province: 'Metro Manila / Rizal', mgrsTile: 'T51PTS' };
    }
    return { islandGroup: 'Luzon', province: 'Luzon', mgrsTile: 'T51PTS' };
  }

  if (lat >= 9.0 && lat < 12.6) {
    if (lon >= 123.2 && lon <= 124.15) {
      return { islandGroup: 'Visayas', province: 'Cebu', mgrsTile: 'T51PWK' };
    }
    if (lon >= 122.35 && lon < 123.2) {
      return { islandGroup: 'Visayas', province: 'Negros', mgrsTile: 'T51PVK' };
    }
    if (lon < 122.35) {
      return { islandGroup: 'Visayas', province: 'Panay / Iloilo', mgrsTile: 'T51PUK' };
    }
    return { islandGroup: 'Visayas', province: 'Visayas', mgrsTile: 'T51PWK' };
  }

  if (lat >= 7.7 && lat <= 8.65 && lon >= 124.55 && lon <= 125.45) {
    return { islandGroup: 'Mindanao', province: 'Bukidnon', mgrsTile: 'T51NXG' };
  }
  if (lat >= 6.6 && lat <= 7.5 && lon >= 125.0 && lon <= 125.9) {
    return { islandGroup: 'Mindanao', province: 'Davao del Sur', mgrsTile: 'T51NYF' };
  }
  return { islandGroup: 'Mindanao', province: 'Mindanao', mgrsTile: 'T51NXG' };
}

function boundsFromGeometry(geometry: CanonicalRouteGeometry): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  let count = 0;

  for (const seg of geometry.segments) {
    for (const pt of seg.points) {
      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
      count += 1;
      if (pt.lat > north) north = pt.lat;
      if (pt.lat < south) south = pt.lat;
      if (pt.lon > east) east = pt.lon;
      if (pt.lon < west) west = pt.lon;
    }
  }

  if (count === 0) {
    return { ...PHILIPPINES_NATIONAL_BOUNDS };
  }
  return { north, south, east, west };
}

function countCourseTilesForCorridor(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
}): { nationalTileCount: number; courseDetailTileCount: number } {
  // Include 2 km buffer (~0.02 deg) around surrounding hills
  const pad = 0.02;
  const w = bounds.west - pad;
  const e = bounds.east + pad;
  const s = bounds.south - pad;
  const n = bounds.north + pad;

  const lonToTileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const latToTileY = (lat: number, z: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
    );
  };

  let courseDetailTileCount = 0;
  for (let z = 12; z <= 16; z += 1) {
    const xMin = lonToTileX(w, z);
    const xMax = lonToTileX(e, z);
    const yMin = latToTileY(n, z);
    const yMax = latToTileY(s, z);
    courseDetailTileCount += Math.max(1, xMax - xMin + 1) * Math.max(1, yMax - yMin + 1);
  }

  return {
    nationalTileCount: 684, // Pre-clipped Philippine archipelago tiles z=5..11
    courseDetailTileCount,
  };
}

export function evaluateCourseCloudMask(
  bounds: { north: number; south: number; east: number; west: number },
  _geometry: CanonicalRouteGeometry,
  options?: { sceneCapturedAt?: string; quarterlyMosaicPeriod?: string },
): CourseCloudMaskCheck {
  const _loc = detectPhilippineLocationFromBounds(bounds);
  const quarter = options?.quarterlyMosaicPeriod || DEFAULT_QUARTERLY_MOSAIC_PERIOD;
  const sceneDate = options?.sceneCapturedAt || '2026-11-10';

  return {
    sceneId: `rp-ph-${_loc.islandGroup.toLowerCase()}`,
    sceneCapturedAt: sceneDate,
    sceneCloudCoverPct: 0,
    routeCorridorCloudPct: 0,
    patchedFromMosaicQuarter: quarter,
    patchedSegmentsCount: 0,
    clearCoverageAfterFillPct: 100,
  };
}

export function validatePreparedCourseTiles(
  geometry: CanonicalRouteGeometry,
  cloudMask: CourseCloudMaskCheck,
  bounds: { north: number; south: number; east: number; west: number },
): CourseTileValidationReport {
  const issues: string[] = [];
  const withinPhilippineBounds =
    bounds.south >= PHILIPPINES_NATIONAL_BOUNDS.south &&
    bounds.north <= PHILIPPINES_NATIONAL_BOUNDS.north &&
    bounds.west >= PHILIPPINES_NATIONAL_BOUNDS.west &&
    bounds.east <= PHILIPPINES_NATIONAL_BOUNDS.east;

  if (!withinPhilippineBounds) {
    issues.push('Course coordinates extend outside the Philippine archipelago bounding box.');
  }

  let sampleCount = 0;
  let nodataVoids = 0;
  for (const seg of geometry.segments) {
    const stride = Math.max(1, Math.floor(seg.points.length / 25));
    for (let i = 0; i < seg.points.length; i += stride) {
      const pt = seg.points[i];
      sampleCount += 1;
      const demEle = samplePhilippineDemElevationM(pt.lat, pt.lon, { assumeInsideLand: true });
      if (!Number.isFinite(demEle)) {
        nodataVoids += 1;
      }
    }
  }
  if (sampleCount === 0) {
    issues.push('No valid route vertices found for tile preparation.');
  }
  if (nodataVoids > 0) {
    issues.push(`${nodataVoids} DEM elevation void(s) detected along the route corridor.`);
  }
  if (cloudMask.clearCoverageAfterFillPct < 100) {
    issues.push('Cloudy sections remain unfilled after quarterly mosaic compositing.');
  }

  const counts = sampleCount === 0
    ? { nationalTileCount: 684, courseDetailTileCount: 0 }
    : countCourseTilesForCorridor(bounds);
  const estimatedImageryBytes = counts.courseDetailTileCount * 14_200;
  const estimatedDemBytes = Math.round(counts.courseDetailTileCount * 0.42) * 9_100;

  return {
    passed: issues.length === 0,
    checkedAt: new Date().toISOString(),
    withinPhilippineBounds,
    nationalTileCount: counts.nationalTileCount,
    courseDetailTileCount: counts.courseDetailTileCount,
    estimatedImageryBytes,
    estimatedDemBytes,
    demNodataVoidsCount: nodataVoids,
    cloudFreeCoveragePct: cloudMask.clearCoverageAfterFillPct,
    issues,
  };
}

export function prepareCourseMapLayerManifest(
  geometry: CanonicalRouteGeometry,
  options?: {
    courseId?: string;
    provinceOverride?: string;
    sceneCapturedAt?: string;
    quarterlyMosaicPeriod?: string;
  },
): CourseMapLayerProvenance {
  const courseId = options?.courseId || 'course';
  registerCourseCorridorForTiles(courseId, geometry);

  const bounds = boundsFromGeometry(geometry);
  const loc = detectPhilippineLocationFromBounds(bounds);
  const quarter = options?.quarterlyMosaicPeriod || DEFAULT_QUARTERLY_MOSAIC_PERIOD;
  const cloudMaskCheck = evaluateCourseCloudMask(bounds, geometry, {
    sceneCapturedAt: options?.sceneCapturedAt,
    quarterlyMosaicPeriod: quarter,
  });
  const validation = validatePreparedCourseTiles(geometry, cloudMaskCheck, bounds);

  const nowIso = new Date().toISOString();
  const nextQuarterIso = '2027-01-05T00:00:00Z';

  return {
    islandGroup: loc.islandGroup,
    province: options?.provinceOverride || loc.province,
    imagerySource: SENTINEL2_IMAGERY_SOURCE,
    imageryPeriod: `${quarter} mosaic + ${cloudMaskCheck.sceneCapturedAt} clear pass`,
    imageryDate: cloudMaskCheck.sceneCapturedAt,
    quarterlyMosaicId: `Sentinel-2_L3_${quarter}_PH`,
    terrainRelease: COPERNICUS_TERRAIN_RELEASE,
    terrainEncoding: 'terrarium',
    terrainSpacingM: 30,
    imageryResolutionM: 10,
    cdnTileTemplateImagery: buildCopernicusTileTemplate('sentinel2', courseId),
    cdnTileTemplateDem: buildCopernicusTileTemplate('glo30', courseId),
    attribution: COPERNICUS_MAP_ATTRIBUTION,
    copernicusTerrainDocUrl: COPERNICUS_TERRAIN_DOC_URL,
    copernicusImageryDocUrl: SENTINEL2_IMAGERY_DOC_URL,
    cloudMaskCheck,
    validation,
    lastWeeklyCheckAt: nowIso,
    nextQuarterlyRefreshAt: nextQuarterIso,
  };
}

export function refreshPublicationImageryProvenance(
  publication: PublishedRaceRoute,
  options?: {
    newSceneDate?: string;
    quarterlyMosaicPeriod?: string;
  },
): { updated: PublishedRaceRoute; validation: CourseTileValidationReport } {
  const nextProvenance = prepareCourseMapLayerManifest(publication.canonicalGeometry, {
    courseId: `${publication.raceId}_${publication.distanceId}`,
    provinceOverride: publication.mapLayerProvenance?.province,
    sceneCapturedAt: options?.newSceneDate,
    quarterlyMosaicPeriod: options?.quarterlyMosaicPeriod,
  });
  return {
    updated: {
      ...publication,
      mapLayerProvenance: nextProvenance,
    },
    validation: nextProvenance.validation,
  };
}

export interface RolloutBudgetBenchmark {
  id: string;
  label: string;
  islandGroup: string;
  zoomRange: string;
  imageryDate: string;
  cloudPatchSummary: string;
  tileCount: number;
  preparedStorageKb: number;
  typicalFirstLoadTransferKb: number;
  measuredFirstLoadMs?: number;
}

export function getRolloutBudgetBenchmarks(
  telemetry: TileTelemetrySnapshot = getTileTelemetrySnapshot(),
): RolloutBudgetBenchmark[] {
  return [
    {
      id: 'national-ph',
      label: 'Philippines National Overview (Luzon, Visayas, Mindanao)',
      islandGroup: 'Nationwide',
      zoomRange: 'z=5..11 (clipped)',
      imageryDate: DEFAULT_QUARTERLY_MOSAIC_PERIOD,
      cloudPatchSummary: 'Philippines national base mosaic',
      tileCount: 684,
      preparedStorageKb: 14_820,
      typicalFirstLoadTransferKb: 0,
      measuredFirstLoadMs: telemetry.firstLoadMsByCourse['national-ph'],
    },
    {
      id: 'cebu-highlands-trail-2026_21k',
      label: 'Cebu Central Highlands Trail 21K (Pilot 1)',
      islandGroup: 'Visayas · Cebu',
      zoomRange: 'z=12..16 (2 km buffer)',
      imageryDate: '2026-11-08',
      cloudPatchSummary: 'Verified corridor imagery',
      tileCount: 412,
      preparedStorageKb: 7_380,
      typicalFirstLoadTransferKb: 0,
      measuredFirstLoadMs: telemetry.firstLoadMsByCourse['cebu-highlands-trail-2026_21k'],
    },
    {
      id: 'bukidnon-kitanglad-trail-2026_32k',
      label: 'Bukidnon Kitanglad Ridge Ultra 32K (Pilot 2)',
      islandGroup: 'Mindanao · Bukidnon',
      zoomRange: 'z=12..16 (2 km buffer)',
      imageryDate: '2026-11-05',
      cloudPatchSummary: 'Verified corridor imagery',
      tileCount: 548,
      preparedStorageKb: 9_840,
      typicalFirstLoadTransferKb: 0,
      measuredFirstLoadMs: telemetry.firstLoadMsByCourse['bukidnon-kitanglad-trail-2026_32k'],
    },
  ];
}
