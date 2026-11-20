import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { getAppCheckHeaders } from '../botProtection';
import { parseRetryAfterSeconds } from '../resilientFetch';
import type { Race } from '../../types';
import { fetchGpxText, parseGpxRoute } from '../gpxRoute';
import { deriveDefaultChapters, evaluateMarkerOffset, reanchorMarkersForRoute } from './anchoring';
import { createEmptyRouteGeometry, processCanonicalGeometry, type ProcessedRoute } from './geometry';
import { isDefaultStarterGeometry } from './trailTools';
import {
  DEFAULT_QUARTERLY_MOSAIC_PERIOD,
  prepareCourseMapLayerManifest,
  refreshPublicationImageryProvenance,
  registerCourseCorridorForTiles,
} from './philippinesMapTiles';
import type {
  CanonicalRouteGeometry,
  PublishedRaceRoute,
  RaceRouteBinding,
  RaceRouteCatalogEntry,
  RouteAuditEvent,
  RouteChapter,
  RouteDraft,
  RouteMarker,
  RoutePreset,
  RoutePresetVersion,
} from './types';

export interface RouteWorkspaceStore {
  presets: Record<string, RoutePreset>;
  drafts: Record<string, RouteDraft>; // keyed by `${presetId}::${draftId}`
  versions: Record<string, RoutePresetVersion>; // keyed by versionId
  bindings: Record<string, RaceRouteBinding>; // keyed by `${raceId}_${distanceId}`
  publications: Record<string, PublishedRaceRoute>; // keyed by publicationId
  catalog: Record<string, RaceRouteCatalogEntry>; // keyed by `${raceId}_${distanceId}`
  audit: RouteAuditEvent[];
  migratedLegacyKeys: Record<string, { presetId: string; raceId: string; distanceId?: string; sourceUrl: string; migratedAt: string }>;
}

const STORAGE_KEY = 'racepulse_route_workspace_v1';

export const DEMO_BAGUIO_RACE: Race = {
  id: 'baguio-cordillera-2026',
  name: 'Baguio Cordillera Ridge Run',
  date: '2026-12-13',
  createdBy: 'demo-organizer',
  createdAt: '2026-10-01T00:00:00Z',
  registrationOpen: true,
  inclusions: ['Timed RFID bib', 'Finisher medal', 'Post-race Cordillera coffee'],
  checkpoints: [
    { id: 'cp_start', label: 'Melvin Jones Start', order: 0, type: 'start' },
    { id: 'cp_south_drive', label: 'South Drive Aid', order: 1, type: 'intermediate', cutoffMinutes: 75 },
    { id: 'cp_turnaround', label: 'Itogon Ridge Turnaround', order: 2, type: 'intermediate', cutoffMinutes: 145 },
    { id: 'cp_botanical', label: 'Botanical Medical', order: 3, type: 'intermediate', cutoffMinutes: 195 },
    { id: 'cp_finish', label: 'Melvin Jones Finish', order: 4, type: 'finish', cutoffMinutes: 240 },
  ],
  ageCategories: [],
  distances: [
    { id: '21k', km: 21, label: '21K', price: 1450 },
    { id: '10k', km: 10, label: '10K', price: 950 },
  ],
};

export const PILOT_CEBU_RACE: Race = {
  id: 'cebu-highlands-trail-2026',
  name: 'Cebu Central Highlands Trail',
  date: '2026-11-29',
  createdBy: 'pilot-cebu-organizer',
  createdAt: '2026-10-15T00:00:00Z',
  registrationOpen: true,
  inclusions: ['Timed RFID bib', 'Finisher medal', 'Highland recovery meal'],
  checkpoints: [
    { id: 'cp_cebu_start', label: 'Busay Highlands Start', order: 0, type: 'start' },
    { id: 'cp_cebu_babag', label: 'Babag Ridge Aid', order: 1, type: 'intermediate', cutoffMinutes: 95 },
    { id: 'cp_cebu_manunggal', label: 'Mt. Manunggal Turnaround', order: 2, type: 'intermediate', cutoffMinutes: 190 },
    { id: 'cp_cebu_cantipla', label: 'Cantipla Forest Medical', order: 3, type: 'intermediate', cutoffMinutes: 255 },
    { id: 'cp_cebu_finish', label: 'Busay Finish Arch', order: 4, type: 'finish', cutoffMinutes: 320 },
  ],
  ageCategories: [],
  distances: [{ id: '21k', km: 21, label: '21K', price: 1500 }],
};

export const PILOT_BUKIDNON_RACE: Race = {
  id: 'bukidnon-kitanglad-trail-2026',
  name: 'Bukidnon Kitanglad Ridge Ultra',
  date: '2026-12-06',
  createdBy: 'pilot-bukidnon-organizer',
  createdAt: '2026-10-15T00:00:00Z',
  registrationOpen: true,
  inclusions: ['Timed RFID bib', 'Finisher shirt', 'Ranch hydration support'],
  checkpoints: [
    { id: 'cp_buk_start', label: 'Impasugong Ranch Start', order: 0, type: 'start' },
    { id: 'cp_buk_panimahawa', label: 'Panimahawa Ridge Aid', order: 1, type: 'intermediate', cutoffMinutes: 110 },
    { id: 'cp_buk_atugan', label: 'Atugan Canyon Crossing', order: 2, type: 'intermediate', cutoffMinutes: 195 },
    { id: 'cp_buk_kitanglad', label: 'Kitanglad Foothill Turnaround', order: 3, type: 'intermediate', cutoffMinutes: 295 },
    { id: 'cp_buk_medical', label: 'Communal Ranch Medical', order: 4, type: 'intermediate', cutoffMinutes: 410 },
    { id: 'cp_buk_finish', label: 'Impasugong Finish Arch', order: 5, type: 'finish', cutoffMinutes: 510 },
  ],
  ageCategories: [],
  distances: [{ id: '32k', km: 32, label: '32K', price: 1950 }],
};

export const PILOT_COURSE_RACES: readonly Race[] = [PILOT_CEBU_RACE, PILOT_BUKIDNON_RACE];
export const PILOT_COURSE_RACE_IDS = new Set(PILOT_COURSE_RACES.map((r) => r.id));

function createLandmarkImageSvgDataUrl(title: string, subtitle: string, accentHex: string): string {
  const safeTitle = title.replace(/[<>&"']/g, '');
  const safeSub = subtitle.replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#18181b"/><stop offset="100%" stop-color="${accentHex}"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><path d="M0 340 L190 210 L350 295 L530 175 L800 315 L800 450 L0 450 Z" fill="rgba(255,255,255,0.12)"/><text x="48" y="210" fill="#ffffff" font-family="system-ui,sans-serif" font-size="34" font-weight="600">${safeTitle}</text><text x="48" y="252" fill="#e4e4e7" font-family="system-ui,sans-serif" font-size="20">${safeSub}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildDemoMarkersFor21K(route: ProcessedRoute): RouteMarker[] {
  const base: RouteMarker[] = [
    {
      id: 'm_21k_start',
      kind: 'start',
      name: 'Melvin Jones Grandstand Start',
      description: 'Official start arch and timing mat at Burnham Park.',
      latitude: 16.4119,
      longitude: 120.5947,
      chainageM: 0,
      segmentIndex: 0,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_start',
      services: ['Timing mat', 'Bag drop', 'Restrooms'],
      photos: [],
      visibility: 'public',
      instruction: 'Line up in seeded pace corrals 15 minutes before gun start.',
    },
    {
      id: 'm_21k_south_out',
      kind: 'aid',
      name: 'South Drive Aid (Outbound)',
      description: 'First aid and hydration stop before entering Wright Park.',
      latitude: 16.4095,
      longitude: 120.6075,
      chainageM: 1550,
      segmentIndex: 0,
      pointIndex: 10,
      passNumber: 1,
      offsetMeters: 2,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_south_drive',
      services: ['Water', 'Electrolytes', 'Bananas', 'Timing split'],
      cutoffMinutes: 75,
      photos: [],
      visibility: 'public',
      instruction: 'Stay in the right lane past the South Drive junction.',
    },
    {
      id: 'm_21k_turnaround',
      kind: 'timing',
      name: 'Itogon Ridge Turnaround',
      description: 'High ridge U-turn timing mat overlooking Cordillera valley.',
      latitude: 16.3868,
      longitude: 120.6588,
      chainageM: 8100,
      segmentIndex: 0,
      pointIndex: 52,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_turnaround',
      services: ['Timing mat', 'Water', 'Medical outpost'],
      cutoffMinutes: 145,
      photos: [
        {
          id: 'photo_itogon_ridge',
          thumbnailUrl: createLandmarkImageSvgDataUrl('Itogon Ridge Turnaround', '1,498 m · Cordillera overlook U-turn', '#991b1b'),
          detailUrl: createLandmarkImageSvgDataUrl('Itogon Ridge Turnaround', '1,498 m · Cordillera overlook U-turn', '#991b1b'),
          width: 800,
          height: 450,
          byteSize: 4200,
          sha256: 'demo_itogon_ridge_v1',
          caption: 'Turn right onto the ridge spur for the 180-degree turnaround mat.',
          altText: 'Graphic course preview illustration of Itogon Ridge Turnaround at 1,498 meters',
          credit: 'RacePulsePH Course Survey Team',
          rightsConfirmed: true,
          capturedOrReviewedAt: '2026-11-10T06:30:00+08:00',
        },
      ],
      visibility: 'public',
      instruction: 'Cross the timing mat completely before starting the climb back toward Mines View.',
    },
    {
      id: 'm_21k_botanical_in',
      kind: 'medical',
      name: 'Botanical Medical Station (Inbound Pass)',
      description: 'Inbound return pass along South Drive corridor.',
      latitude: 16.4141,
      longitude: 120.6145,
      chainageM: 14200,
      segmentIndex: 0,
      pointIndex: 88,
      passNumber: 2,
      offsetMeters: 3,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_botanical',
      services: ['First aid', 'Water', 'Ice', 'Timing split'],
      cutoffMinutes: 195,
      photos: [],
      visibility: 'public',
      instruction: 'Second pass on the South Drive shared corridor before Camp John Hay segment.',
    },
    {
      id: 'm_21k_landmark_cjh',
      kind: 'landmark',
      name: 'Camp John Hay Pine Ridge',
      description: 'Transition into Segment 2 descending through Scout Hill.',
      latitude: 16.4060,
      longitude: 120.6095,
      chainageM: 15900,
      segmentIndex: 1,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: ['Course marshals'],
      photos: [
        {
          id: 'photo_cjh_pine',
          thumbnailUrl: createLandmarkImageSvgDataUrl('Camp John Hay Pine Ridge', 'Segment 2 entrance · Scout Hill descent', '#7c2d12'),
          detailUrl: createLandmarkImageSvgDataUrl('Camp John Hay Pine Ridge', 'Segment 2 entrance · Scout Hill descent', '#7c2d12'),
          width: 800,
          height: 450,
          byteSize: 4100,
          sha256: 'demo_cjh_pine_v1',
          caption: 'Enter Camp John Hay gate and follow pine-lined asphalt toward Loakan.',
          altText: 'Graphic course preview illustration of Camp John Hay Pine Ridge segment gate',
          credit: 'RacePulsePH Course Survey Team',
          rightsConfirmed: true,
          capturedOrReviewedAt: '2026-11-10T07:15:00+08:00',
        },
      ],
      visibility: 'public',
      instruction: 'Follow yellow directional cones into Camp John Hay.',
    },
    {
      id: 'm_21k_finish',
      kind: 'finish',
      name: 'Melvin Jones Finish Arch',
      description: 'Official finish gantry and medal engraving tent.',
      latitude: 16.4119,
      longitude: 120.5947,
      chainageM: route.distanceM,
      segmentIndex: 1,
      pointIndex: route.canonicalSegments[1]?.length ? route.canonicalSegments[1].length - 1 : 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_finish',
      services: ['Finish timing', 'Recovery nutrition', 'Medal engraving'],
      cutoffMinutes: 240,
      photos: [],
      visibility: 'public',
      instruction: 'Keep chip bib visible on the front torso for finish mat detection.',
    },
  ];
  return reanchorMarkersForRoute(route, base);
}

function buildDemoMarkersFor10K(route: ProcessedRoute): RouteMarker[] {
  const base: RouteMarker[] = [
    {
      id: 'm_10k_start',
      kind: 'start',
      name: 'Melvin Jones Start',
      description: '10K wave start at Burnham Park.',
      latitude: 16.4119,
      longitude: 120.5947,
      chainageM: 0,
      segmentIndex: 0,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_start',
      services: ['Timing mat', 'Restrooms'],
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_10k_turnaround',
      kind: 'timing',
      name: 'Gibraltar Turnaround',
      description: '10K turnaround near Mines View and Gibraltar ridge.',
      latitude: 16.4132,
      longitude: 120.6352,
      chainageM: route.distanceM / 2,
      segmentIndex: 0,
      pointIndex: Math.floor(route.points.length / 2),
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_turnaround',
      services: ['Water', 'Electrolytes', 'Timing split'],
      cutoffMinutes: 90,
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_10k_finish',
      kind: 'finish',
      name: 'Melvin Jones Finish',
      description: '10K finish arch at Burnham Park.',
      latitude: 16.4119,
      longitude: 120.5947,
      chainageM: route.distanceM,
      segmentIndex: 0,
      pointIndex: route.points.length - 1,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_finish',
      services: ['Finish timing', 'Hydration'],
      cutoffMinutes: 140,
      photos: [],
      visibility: 'public',
    },
  ];
  return reanchorMarkersForRoute(route, base);
}

function snapCoordinateIfOffCourse(
  route: ProcessedRoute,
  lat: number,
  lon: number,
  fallbackChainageM: number,
): { latitude: number; longitude: number } {
  const start = route.points[0];
  if (!start) return { latitude: lat, longitude: lon };
  // Use the nearest actual route vertex along fallbackChainage when hardcoded coords drift off trail.
  let best = route.points[0];
  let bestDiff = Infinity;
  for (const pt of route.points) {
    const dLat = (pt.latitude - lat) * 111_132;
    const dLon = (pt.longitude - lon) * 109_000;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestDiff) {
      bestDiff = d2;
      best = pt;
    }
  }
  if (Math.sqrt(bestDiff) <= 60) {
    return { latitude: best.latitude, longitude: best.longitude };
  }
  const byChainage = route.points.reduce(
    (prev, curr) =>
      Math.abs(curr.chainageM - fallbackChainageM) < Math.abs(prev.chainageM - fallbackChainageM)
        ? curr
        : prev,
    route.points[0],
  );
  return { latitude: byChainage.latitude, longitude: byChainage.longitude };
}

function buildPilotMarkersForCebu(route: ProcessedRoute): RouteMarker[] {
  const startPt = route.points[0];
  const endPt = route.points[route.points.length - 1] || startPt;
  const babagCoord = snapCoordinateIfOffCourse(route, 10.3972, 123.8548, route.distanceM * 0.16);
  const mauyogCoord = snapCoordinateIfOffCourse(route, 10.4252, 123.8308, route.distanceM * 0.36);
  const manunggalCoord = snapCoordinateIfOffCourse(route, 10.4462, 123.8168, route.distanceM * 0.5);
  const cantiplaCoord = snapCoordinateIfOffCourse(route, 10.4295, 123.8342, route.distanceM * 0.68);

  const base: RouteMarker[] = [
    {
      id: 'm_cebu_start',
      kind: 'start',
      name: 'Busay Highlands Start',
      description: 'Official Cebu 21K trailhead start gantry overlooking Metro Cebu.',
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
      timingCheckpointId: 'cp_cebu_start',
      services: ['Timing mat', 'Bag drop', 'Restrooms'],
      photos: [],
      visibility: 'public',
      instruction: 'Seeded trail wave starts along Transcentral Highway trailhead.',
    },
    {
      id: 'm_cebu_babag',
      kind: 'aid',
      name: 'Babag Ridge Aid Station',
      description: 'Hydration and fruit station along the Babag limestone ridge.',
      latitude: babagCoord.latitude,
      longitude: babagCoord.longitude,
      chainageM: route.distanceM * 0.16,
      segmentIndex: 0,
      pointIndex: 27,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_cebu_babag',
      services: ['Water', 'Electrolytes', 'Bananas', 'Timing split'],
      cutoffMinutes: 95,
      photos: [],
      visibility: 'public',
      instruction: 'Single-file trail narrows past Babag chapel ridge.',
    },
    {
      id: 'm_cebu_mauyog',
      kind: 'landmark',
      name: 'Mt. Mauyog Ridge Viewpoint',
      description: 'Narrow karst ridge singletrack crest in Central Cebu.',
      latitude: mauyogCoord.latitude,
      longitude: mauyogCoord.longitude,
      chainageM: route.distanceM * 0.36,
      segmentIndex: 0,
      pointIndex: 54,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      services: ['Course marshals'],
      photos: [
        {
          id: 'photo_cebu_mauyog',
          thumbnailUrl: createLandmarkImageSvgDataUrl('Mt. Mauyog Ridge', '985 m · Central Cebu karst ridge trail', '#991b1b'),
          detailUrl: createLandmarkImageSvgDataUrl('Mt. Mauyog Ridge', '985 m · Central Cebu karst ridge trail', '#991b1b'),
          width: 800,
          height: 450,
          byteSize: 4100,
          sha256: 'pilot_cebu_mauyog_v1',
          caption: 'Follow ribbon markers along the exposed limestone crest.',
          altText: 'Elevation graphic of Mt. Mauyog Ridge viewpoint at 985 meters',
          credit: 'RacePulsePH Cebu Survey',
          rightsConfirmed: true,
          capturedOrReviewedAt: '2026-11-08T07:00:00+08:00',
        },
      ],
      visibility: 'public',
    },
    {
      id: 'm_cebu_manunggal',
      kind: 'timing',
      name: 'Mt. Manunggal Turnaround',
      description: 'Highest highland turnaround mat at 1,003 m.',
      latitude: manunggalCoord.latitude,
      longitude: manunggalCoord.longitude,
      chainageM: route.distanceM * 0.5,
      segmentIndex: 1,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_cebu_manunggal',
      services: ['Timing mat', 'Water', 'First aid'],
      cutoffMinutes: 190,
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_cebu_cantipla',
      kind: 'medical',
      name: 'Cantipla Forest Medical',
      description: 'Inbound forest corridor hydration and medical outpost.',
      latitude: cantiplaCoord.latitude,
      longitude: cantiplaCoord.longitude,
      chainageM: route.distanceM * 0.68,
      segmentIndex: 1,
      pointIndex: 18,
      passNumber: 2,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_cebu_cantipla',
      services: ['First aid', 'Water', 'Ice'],
      cutoffMinutes: 255,
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_cebu_finish',
      kind: 'finish',
      name: 'Busay Finish Arch',
      description: 'Official Cebu 21K finish timing mat.',
      latitude: endPt.latitude,
      longitude: endPt.longitude,
      chainageM: route.distanceM,
      segmentIndex: 1,
      pointIndex: route.canonicalSegments[1]?.length ? route.canonicalSegments[1].length - 1 : 0,
      passNumber: 2,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_cebu_finish',
      services: ['Finish timing', 'Recovery nutrition'],
      cutoffMinutes: 320,
      photos: [],
      visibility: 'public',
    },
  ];
  return reanchorMarkersForRoute(route, base);
}

function buildPilotMarkersForBukidnon(route: ProcessedRoute): RouteMarker[] {
  const startPt = route.points[0];
  const endPt = route.points[route.points.length - 1] || startPt;
  const base: RouteMarker[] = [
    {
      id: 'm_buk_start',
      kind: 'start',
      name: 'Impasugong Ranch Start',
      description: 'Communal Ranch grass paddock start line at 820 m.',
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
      timingCheckpointId: 'cp_buk_start',
      services: ['Timing mat', 'Bag drop', 'Restrooms'],
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_buk_panimahawa',
      kind: 'aid',
      name: 'Panimahawa Ridge Aid',
      description: 'Open grassland ridge hydration and timing mat.',
      latitude: 8.2040,
      longitude: 124.9965,
      chainageM: 5100,
      segmentIndex: 0,
      pointIndex: 27,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_buk_panimahawa',
      services: ['Water', 'Electrolytes', 'Timing split'],
      cutoffMinutes: 110,
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_buk_atugan',
      kind: 'hazard',
      name: 'Atugan Canyon Crossing',
      description: 'Steep gorge descent to river footbridge and timing check.',
      latitude: 8.1720,
      longitude: 124.9710,
      chainageM: 10800,
      segmentIndex: 0,
      pointIndex: 54,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_buk_atugan',
      services: ['Water', 'River crossing marshals'],
      cutoffMinutes: 195,
      photos: [],
      visibility: 'public',
      instruction: 'Use fixed rope lines descending into Atugan gorge.',
    },
    {
      id: 'm_buk_kitanglad',
      kind: 'timing',
      name: 'Kitanglad Foothill Turnaround',
      description: 'High mountain pine spur turnaround at 1,890 m.',
      latitude: 8.1305,
      longitude: 124.9370,
      chainageM: route.distanceM * 0.5,
      segmentIndex: 1,
      pointIndex: 0,
      passNumber: 1,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_buk_kitanglad',
      services: ['Timing mat', 'Hot soup', 'First aid'],
      cutoffMinutes: 295,
      photos: [
        {
          id: 'photo_buk_kitanglad',
          thumbnailUrl: createLandmarkImageSvgDataUrl('Kitanglad Foothills', '1,890 m · Bukidnon mountain turnaround', '#7c2d12'),
          detailUrl: createLandmarkImageSvgDataUrl('Kitanglad Foothills', '1,890 m · Bukidnon mountain turnaround', '#7c2d12'),
          width: 800,
          height: 450,
          byteSize: 4200,
          sha256: 'pilot_buk_kitanglad_v1',
          caption: 'Turnaround timing tent below Mt. Kitanglad pine ridge.',
          altText: 'Course landmark graphic for Kitanglad Foothill turnaround at 1,890 meters',
          credit: 'RacePulsePH Bukidnon Survey',
          rightsConfirmed: true,
          capturedOrReviewedAt: '2026-11-05T07:30:00+08:00',
        },
      ],
      visibility: 'public',
    },
    {
      id: 'm_buk_medical',
      kind: 'medical',
      name: 'Communal Ranch Medical',
      description: 'Inbound grassland ridge medical outpost and drop bag point.',
      latitude: 8.1818,
      longitude: 124.9828,
      chainageM: route.distanceM * 0.72,
      segmentIndex: 1,
      pointIndex: 36,
      passNumber: 2,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_buk_medical',
      services: ['First aid', 'Water', 'Drop bags'],
      cutoffMinutes: 410,
      photos: [],
      visibility: 'public',
    },
    {
      id: 'm_buk_finish',
      kind: 'finish',
      name: 'Impasugong Finish Arch',
      description: 'Official Bukidnon 32K finish timing gantry.',
      latitude: endPt.latitude,
      longitude: endPt.longitude,
      chainageM: route.distanceM,
      segmentIndex: 1,
      pointIndex: route.canonicalSegments[1]?.length ? route.canonicalSegments[1].length - 1 : 0,
      passNumber: 2,
      offsetMeters: 0,
      needsReview: false,
      offCourseBlocked: false,
      offCourseConfirmed: false,
      timingCheckpointId: 'cp_buk_finish',
      services: ['Finish timing', 'Recovery meal'],
      cutoffMinutes: 510,
      photos: [],
      visibility: 'public',
    },
  ];
  return reanchorMarkersForRoute(route, base);
}

let inMemoryStore: RouteWorkspaceStore | null = null;
const storeListeners = new Set<(store: RouteWorkspaceStore) => void>();
let demoSeedPromise: Promise<void> | null = null;
let pilotSeedPromise: Promise<void> | null = null;

function emptyStore(): RouteWorkspaceStore {
  return {
    presets: {},
    drafts: {},
    versions: {},
    bindings: {},
    publications: {},
    catalog: {},
    audit: [],
    migratedLegacyKeys: {},
  };
}

export function isDemoSeedEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('seedDemo') === '1';
}

export function stripDemoArtifacts(store: RouteWorkspaceStore): RouteWorkspaceStore {
  const demoPresetIds = new Set([
    'preset_baguio_21k',
    'preset_baguio_10k',
    'preset_pilot_cebu_21k',
    'preset_pilot_bukidnon_32k',
  ]);
  const demoPubIds = new Set([
    'pub_baguio_21k_v1',
    'pub_baguio_10k_v1',
    'pub_cebu_highlands_21k_v1',
    'pub_bukidnon_kitanglad_32k_v1',
  ]);
  const demoCatalogIds = new Set([
    'baguio-cordillera-2026_21k',
    'baguio-cordillera-2026_10k',
    'cebu-highlands-trail-2026_21k',
    'bukidnon-kitanglad-trail-2026_32k',
  ]);

  for (const id of demoPresetIds) delete store.presets[id];
  delete store.drafts['preset_baguio_21k::draft_main'];
  delete store.drafts['preset_baguio_10k::draft_main'];
  delete store.drafts['preset_pilot_cebu_21k::draft_main'];
  delete store.drafts['preset_pilot_bukidnon_32k::draft_main'];
  delete store.versions['preset_baguio_21k_v1'];
  delete store.versions['preset_baguio_10k_v1'];
  delete store.versions['preset_pilot_cebu_21k_v1'];
  delete store.versions['preset_pilot_bukidnon_32k_v1'];
  for (const id of demoPubIds) delete store.publications[id];
  for (const id of demoCatalogIds) {
    delete store.bindings[id];
    delete store.catalog[id];
  }
  store.audit = store.audit.filter((a) => a.id !== 'audit_seed_baguio_v1');

  // Purge legacy auto-created unmodified 3-point Baguio starter drafts not bound/published
  const referencedPresetIds = new Set<string>();
  for (const binding of Object.values(store.bindings)) {
    if (binding.presetId) referencedPresetIds.add(binding.presetId);
  }
  for (const publication of Object.values(store.publications)) {
    if (publication.presetId) referencedPresetIds.add(publication.presetId);
  }
  for (const [presetId, preset] of Object.entries(store.presets)) {
    if (referencedPresetIds.has(presetId) || preset.latestVersionNumber !== 0) continue;
    const draftKey = `${presetId}::${preset.latestDraftId || 'draft_main'}`;
    const draft = store.drafts[draftKey];
    if (
      draft &&
      draft.revision === 1 &&
      draft.markers.length === 0 &&
      isDefaultStarterGeometry(draft.canonicalGeometry)
    ) {
      delete store.presets[presetId];
      delete store.drafts[draftKey];
      store.audit = store.audit.filter((a) => a.presetId !== presetId);
    }
  }
  return store;
}

function storeFingerprint(store: RouteWorkspaceStore): string {
  return [
    Object.keys(store.presets).length,
    Object.keys(store.drafts).length,
    Object.keys(store.versions).length,
    Object.keys(store.bindings).length,
    Object.keys(store.publications).length,
    Object.keys(store.catalog).length,
    store.audit.length,
  ].join(':');
}

function loadFromStorage(): RouteWorkspaceStore {
  if (typeof localStorage === 'undefined') return emptyStore();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<RouteWorkspaceStore>;
    const loaded: RouteWorkspaceStore = {
      presets: parsed.presets || {},
      drafts: parsed.drafts || {},
      versions: parsed.versions || {},
      bindings: parsed.bindings || {},
      publications: parsed.publications || {},
      catalog: parsed.catalog || {},
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      migratedLegacyKeys: parsed.migratedLegacyKeys || {},
    };
    if (isDemoSeedEnabled()) return loaded;
    const before = storeFingerprint(loaded);
    const cleaned = stripDemoArtifacts(loaded);
    if (storeFingerprint(cleaned) !== before) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      } catch {
        // Ignore storage write errors on read cleanup
      }
    }
    return cleaned;
  } catch {
    return emptyStore();
  }
}

function saveToStorage(store: RouteWorkspaceStore): void {
  inMemoryStore = store;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignore quota exceeded; memory copy remains current
    }
  }
  for (const listener of storeListeners) {
    listener(store);
  }
}

export function getRouteStoreSnapshot(): RouteWorkspaceStore {
  if (!inMemoryStore) {
    inMemoryStore = loadFromStorage();
  }
  return inMemoryStore;
}

export function subscribeRouteStore(listener: (store: RouteWorkspaceStore) => void): () => void {
  storeListeners.add(listener);
  listener(getRouteStoreSnapshot());
  if (isDemoSeedEnabled()) {
    void ensureDemoCoursesSeeded();
  }
  return () => {
    storeListeners.delete(listener);
  };
}

export async function ensureDemoCoursesSeeded(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!force && !isDemoSeedEnabled()) return;
  const current = getRouteStoreSnapshot();
  if (current.publications['pub_baguio_21k_v1'] && current.publications['pub_baguio_10k_v1']) {
    return;
  }
  if (demoSeedPromise) return demoSeedPromise;

  demoSeedPromise = (async () => {
    try {
      const [gpx21Text, gpx10Text] = await Promise.all([
        fetchGpxText('/fixtures/baguio-cordillera-21k.gpx'),
        fetchGpxText('/fixtures/baguio-cordillera-10k.gpx'),
      ]);
      const route21 = parseGpxRoute(gpx21Text);
      const route10 = parseGpxRoute(gpx10Text);
      const markers21 = buildDemoMarkersFor21K(route21);
      const markers10 = buildDemoMarkersFor10K(route10);
      const chapters21 = deriveDefaultChapters(route21, markers21);
      const chapters10 = deriveDefaultChapters(route10, markers10);
      const now = '2026-11-12T08:00:00.000Z';

      const store = structuredClone(getRouteStoreSnapshot());

      store.presets['preset_baguio_21k'] = {
        id: 'preset_baguio_21k',
        title: 'Baguio Cordillera 21K Ridge Course',
        region: 'Baguio / Cordillera',
        activity: 'trail',
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '21k',
        ownerUid: 'demo-organizer',
        editorIds: [],
        archived: false,
        latestDraftId: 'draft_main',
        latestVersionId: 'preset_baguio_21k_v1',
        latestVersionNumber: 1,
        revision: 2,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };
      store.drafts['preset_baguio_21k::draft_main'] = {
        id: 'draft_main',
        presetId: 'preset_baguio_21k',
        title: 'Baguio Cordillera 21K Ridge Course',
        region: 'Baguio / Cordillera',
        revision: 1,
        processingState: 'ready',
        sourceFileName: 'baguio-cordillera-21k.gpx',
        sourceBytes: gpx21Text.length,
        selectedTrackIndices: [0],
        canonicalGeometry: route21.canonicalGeometry,
        elevationProvenance: route21.elevationProvenance,
        validationReport: route21.validationReport,
        markers: markers21,
        distanceM: route21.distanceM,
        elevationGainM: route21.elevationGainM,
        elevationLossM: route21.elevationLossM,
        editSummary: 'Verified Baguio multi-segment 21K course with Itogon turnaround',
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };
      store.versions['preset_baguio_21k_v1'] = {
        id: 'preset_baguio_21k_v1',
        presetId: 'preset_baguio_21k',
        versionNumber: 1,
        title: 'Baguio Cordillera 21K Ridge Course',
        region: 'Baguio / Cordillera',
        geometryHash: 'hash_baguio_21k_v1',
        canonicalGeometry: route21.canonicalGeometry,
        elevationProvenance: route21.elevationProvenance,
        validationReport: route21.validationReport,
        markers: markers21,
        distanceM: route21.distanceM,
        elevationGainM: route21.elevationGainM,
        elevationLossM: route21.elevationLossM,
        reviewNotes: 'Reviewed multi-segment course, out-and-back passes, and landmark photos.',
        reviewedBy: 'demo-organizer',
        reviewedAt: now,
        createdAt: now,
      };

      store.presets['preset_baguio_10k'] = {
        id: 'preset_baguio_10k',
        title: 'Baguio Cordillera 10K City Loop',
        region: 'Baguio / Cordillera',
        activity: 'road',
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '10k',
        ownerUid: 'demo-organizer',
        editorIds: [],
        archived: false,
        latestDraftId: 'draft_main',
        latestVersionId: 'preset_baguio_10k_v1',
        latestVersionNumber: 1,
        revision: 2,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };
      store.drafts['preset_baguio_10k::draft_main'] = {
        id: 'draft_main',
        presetId: 'preset_baguio_10k',
        title: 'Baguio Cordillera 10K City Loop',
        region: 'Baguio / Cordillera',
        revision: 1,
        processingState: 'ready',
        sourceFileName: 'baguio-cordillera-10k.gpx',
        sourceBytes: gpx10Text.length,
        selectedTrackIndices: [0],
        canonicalGeometry: route10.canonicalGeometry,
        elevationProvenance: route10.elevationProvenance,
        validationReport: route10.validationReport,
        markers: markers10,
        distanceM: route10.distanceM,
        elevationGainM: route10.elevationGainM,
        elevationLossM: route10.elevationLossM,
        editSummary: 'Verified 10K city loop course',
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };
      store.versions['preset_baguio_10k_v1'] = {
        id: 'preset_baguio_10k_v1',
        presetId: 'preset_baguio_10k',
        versionNumber: 1,
        title: 'Baguio Cordillera 10K City Loop',
        region: 'Baguio / Cordillera',
        geometryHash: 'hash_baguio_10k_v1',
        canonicalGeometry: route10.canonicalGeometry,
        elevationProvenance: route10.elevationProvenance,
        validationReport: route10.validationReport,
        markers: markers10,
        distanceM: route10.distanceM,
        elevationGainM: route10.elevationGainM,
        elevationLossM: route10.elevationLossM,
        reviewNotes: 'Verified 10K turnaround and finish.',
        reviewedBy: 'demo-organizer',
        reviewedAt: now,
        createdAt: now,
      };

      store.bindings['baguio-cordillera-2026_21k'] = {
        id: 'baguio-cordillera-2026_21k',
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '21k',
        distanceLabel: '21K',
        advertisedKm: 21,
        presetId: 'preset_baguio_21k',
        versionId: 'preset_baguio_21k_v1',
        versionNumber: 1,
        currentPublicationId: 'pub_baguio_21k_v1',
        bindingRevision: 1,
        checkpointLinks: {
          m_21k_start: 'cp_start',
          m_21k_south_out: 'cp_south_drive',
          m_21k_turnaround: 'cp_turnaround',
          m_21k_botanical_in: 'cp_botanical',
          m_21k_finish: 'cp_finish',
        },
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };

      store.bindings['baguio-cordillera-2026_10k'] = {
        id: 'baguio-cordillera-2026_10k',
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '10k',
        distanceLabel: '10K',
        advertisedKm: 10,
        presetId: 'preset_baguio_10k',
        versionId: 'preset_baguio_10k_v1',
        versionNumber: 1,
        currentPublicationId: 'pub_baguio_10k_v1',
        bindingRevision: 1,
        checkpointLinks: {
          m_10k_start: 'cp_start',
          m_10k_turnaround: 'cp_turnaround',
          m_10k_finish: 'cp_finish',
        },
        updatedAt: now,
        updatedBy: 'demo-organizer',
      };

      const prov21 = prepareCourseMapLayerManifest(route21.canonicalGeometry, {
        courseId: `${DEMO_BAGUIO_RACE.id}_21k`,
        provinceOverride: 'Benguet · Cordillera',
        sceneCapturedAt: '2026-11-11',
      });
      const prov10 = prepareCourseMapLayerManifest(route10.canonicalGeometry, {
        courseId: `${DEMO_BAGUIO_RACE.id}_10k`,
        provinceOverride: 'Benguet · Cordillera',
        sceneCapturedAt: '2026-11-11',
      });

      store.publications['pub_baguio_21k_v1'] = {
        id: 'pub_baguio_21k_v1',
        raceId: DEMO_BAGUIO_RACE.id,
        raceName: DEMO_BAGUIO_RACE.name,
        raceDate: DEMO_BAGUIO_RACE.date,
        distanceId: '21k',
        distanceLabel: '21K',
        advertisedKm: 21,
        measuredDistanceM: route21.distanceM,
        elevationGainM: route21.elevationGainM,
        elevationLossM: route21.elevationLossM,
        presetId: 'preset_baguio_21k',
        versionId: 'preset_baguio_21k_v1',
        versionNumber: 1,
        geometryHash: 'hash_baguio_21k_v1',
        canonicalGeometry: route21.canonicalGeometry,
        elevationProvenance: route21.elevationProvenance,
        markers: markers21,
        chapters: chapters21,
        status: 'published',
        publishedAt: now,
        publishedBy: 'demo-organizer',
        reviewedAt: now,
        mapLayerProvenance: prov21,
      };

      store.publications['pub_baguio_10k_v1'] = {
        id: 'pub_baguio_10k_v1',
        raceId: DEMO_BAGUIO_RACE.id,
        raceName: DEMO_BAGUIO_RACE.name,
        raceDate: DEMO_BAGUIO_RACE.date,
        distanceId: '10k',
        distanceLabel: '10K',
        advertisedKm: 10,
        measuredDistanceM: route10.distanceM,
        elevationGainM: route10.elevationGainM,
        elevationLossM: route10.elevationLossM,
        presetId: 'preset_baguio_10k',
        versionId: 'preset_baguio_10k_v1',
        versionNumber: 1,
        geometryHash: 'hash_baguio_10k_v1',
        canonicalGeometry: route10.canonicalGeometry,
        elevationProvenance: route10.elevationProvenance,
        markers: markers10,
        chapters: chapters10,
        status: 'published',
        publishedAt: now,
        publishedBy: 'demo-organizer',
        reviewedAt: now,
        mapLayerProvenance: prov10,
      };

      store.catalog['baguio-cordillera-2026_21k'] = {
        id: 'baguio-cordillera-2026_21k',
        raceId: DEMO_BAGUIO_RACE.id,
        raceName: DEMO_BAGUIO_RACE.name,
        raceDate: DEMO_BAGUIO_RACE.date,
        region: 'Baguio / Cordillera',
        distanceId: '21k',
        distanceLabel: '21K',
        advertisedKm: 21,
        measuredDistanceM: route21.distanceM,
        elevationGainM: route21.elevationGainM,
        elevationStatus: route21.elevationProvenance.status,
        landmarkCount: markers21.filter((m) => m.kind === 'landmark').length,
        checkpointCount: markers21.length,
        currentPublicationId: 'pub_baguio_21k_v1',
        versionNumber: 1,
        status: 'published',
        publishedAt: now,
        mapLayerProvenance: prov21,
      };

      store.catalog['baguio-cordillera-2026_10k'] = {
        id: 'baguio-cordillera-2026_10k',
        raceId: DEMO_BAGUIO_RACE.id,
        raceName: DEMO_BAGUIO_RACE.name,
        raceDate: DEMO_BAGUIO_RACE.date,
        region: 'Baguio / Cordillera',
        distanceId: '10k',
        distanceLabel: '10K',
        advertisedKm: 10,
        measuredDistanceM: route10.distanceM,
        elevationGainM: route10.elevationGainM,
        elevationStatus: route10.elevationProvenance.status,
        landmarkCount: markers10.filter((m) => m.kind === 'landmark').length,
        checkpointCount: markers10.length,
        currentPublicationId: 'pub_baguio_10k_v1',
        versionNumber: 1,
        status: 'published',
        publishedAt: now,
        mapLayerProvenance: prov10,
      };

      store.audit.unshift({
        id: 'audit_seed_baguio_v1',
        action: 'publish',
        actorUid: 'demo-organizer',
        actorName: 'Course Director',
        presetId: 'preset_baguio_21k',
        versionId: 'preset_baguio_21k_v1',
        raceId: DEMO_BAGUIO_RACE.id,
        distanceId: '21k',
        publicationId: 'pub_baguio_21k_v1',
        reason: 'Published verified Baguio Cordillera 21K and 10K official courses',
        at: now,
      });

      saveToStorage(store);
    } catch {
      // Non-fatal in offline/test unit runs without HTTP dev server
    }
  })();
  return demoSeedPromise;
}

export function seedPilotCoursesFromGpxText(cebuGpxText: string, bukidnonGpxText: string): void {
  const cebuRoute = parseGpxRoute(cebuGpxText);
  const bukRoute = parseGpxRoute(bukidnonGpxText);
  const cebuMarkers = buildPilotMarkersForCebu(cebuRoute);
  const bukMarkers = buildPilotMarkersForBukidnon(bukRoute);
  const cebuChapters = deriveDefaultChapters(cebuRoute, cebuMarkers);
  const bukChapters = deriveDefaultChapters(bukRoute, bukMarkers);
  const now = '2026-11-15T08:00:00.000Z';

  const cebuProv = prepareCourseMapLayerManifest(cebuRoute.canonicalGeometry, {
    courseId: `${PILOT_CEBU_RACE.id}_21k`,
    provinceOverride: 'Cebu',
    sceneCapturedAt: '2026-11-08',
  });
  const bukProv = prepareCourseMapLayerManifest(bukRoute.canonicalGeometry, {
    courseId: `${PILOT_BUKIDNON_RACE.id}_32k`,
    provinceOverride: 'Bukidnon',
    sceneCapturedAt: '2026-11-05',
  });

  const store = structuredClone(getRouteStoreSnapshot());

  store.bindings['cebu-highlands-trail-2026_21k'] = {
    id: 'cebu-highlands-trail-2026_21k',
    raceId: PILOT_CEBU_RACE.id,
    distanceId: '21k',
    distanceLabel: '21K',
    advertisedKm: 21,
    presetId: 'preset_pilot_cebu_21k',
    versionId: 'preset_pilot_cebu_21k_v1',
    versionNumber: 1,
    currentPublicationId: 'pub_cebu_highlands_21k_v1',
    bindingRevision: 1,
    checkpointLinks: {
      m_cebu_start: 'cp_cebu_start',
      m_cebu_babag: 'cp_cebu_babag',
      m_cebu_manunggal: 'cp_cebu_manunggal',
      m_cebu_cantipla: 'cp_cebu_cantipla',
      m_cebu_finish: 'cp_cebu_finish',
    },
    updatedAt: now,
    updatedBy: 'pilot-cebu-organizer',
  };

  store.bindings['bukidnon-kitanglad-trail-2026_32k'] = {
    id: 'bukidnon-kitanglad-trail-2026_32k',
    raceId: PILOT_BUKIDNON_RACE.id,
    distanceId: '32k',
    distanceLabel: '32K',
    advertisedKm: 32,
    presetId: 'preset_pilot_bukidnon_32k',
    versionId: 'preset_pilot_bukidnon_32k_v1',
    versionNumber: 1,
    currentPublicationId: 'pub_bukidnon_kitanglad_32k_v1',
    bindingRevision: 1,
    checkpointLinks: {
      m_buk_start: 'cp_buk_start',
      m_buk_panimahawa: 'cp_buk_panimahawa',
      m_buk_atugan: 'cp_buk_atugan',
      m_buk_kitanglad: 'cp_buk_kitanglad',
      m_buk_medical: 'cp_buk_medical',
      m_buk_finish: 'cp_buk_finish',
    },
    updatedAt: now,
    updatedBy: 'pilot-bukidnon-organizer',
  };

  store.publications['pub_cebu_highlands_21k_v1'] = {
    id: 'pub_cebu_highlands_21k_v1',
    raceId: PILOT_CEBU_RACE.id,
    raceName: PILOT_CEBU_RACE.name,
    raceDate: PILOT_CEBU_RACE.date,
    distanceId: '21k',
    distanceLabel: '21K',
    advertisedKm: 21,
    measuredDistanceM: cebuRoute.distanceM,
    elevationGainM: cebuRoute.elevationGainM,
    elevationLossM: cebuRoute.elevationLossM,
    presetId: 'preset_pilot_cebu_21k',
    versionId: 'preset_pilot_cebu_21k_v1',
    versionNumber: 1,
    geometryHash: 'hash_cebu_highlands_21k_v1',
    canonicalGeometry: cebuRoute.canonicalGeometry,
    elevationProvenance: cebuRoute.elevationProvenance,
    markers: cebuMarkers,
    chapters: cebuChapters,
    status: 'published',
    publishedAt: now,
    publishedBy: 'pilot-cebu-organizer',
    reviewedAt: now,
    mapLayerProvenance: cebuProv,
  };

  store.publications['pub_bukidnon_kitanglad_32k_v1'] = {
    id: 'pub_bukidnon_kitanglad_32k_v1',
    raceId: PILOT_BUKIDNON_RACE.id,
    raceName: PILOT_BUKIDNON_RACE.name,
    raceDate: PILOT_BUKIDNON_RACE.date,
    distanceId: '32k',
    distanceLabel: '32K',
    advertisedKm: 32,
    measuredDistanceM: bukRoute.distanceM,
    elevationGainM: bukRoute.elevationGainM,
    elevationLossM: bukRoute.elevationLossM,
    presetId: 'preset_pilot_bukidnon_32k',
    versionId: 'preset_pilot_bukidnon_32k_v1',
    versionNumber: 1,
    geometryHash: 'hash_bukidnon_kitanglad_32k_v1',
    canonicalGeometry: bukRoute.canonicalGeometry,
    elevationProvenance: bukRoute.elevationProvenance,
    markers: bukMarkers,
    chapters: bukChapters,
    status: 'published',
    publishedAt: now,
    publishedBy: 'pilot-bukidnon-organizer',
    reviewedAt: now,
    mapLayerProvenance: bukProv,
  };

  store.catalog['cebu-highlands-trail-2026_21k'] = {
    id: 'cebu-highlands-trail-2026_21k',
    raceId: PILOT_CEBU_RACE.id,
    raceName: PILOT_CEBU_RACE.name,
    raceDate: PILOT_CEBU_RACE.date,
    region: 'Visayas · Cebu',
    distanceId: '21k',
    distanceLabel: '21K',
    advertisedKm: 21,
    measuredDistanceM: cebuRoute.distanceM,
    elevationGainM: cebuRoute.elevationGainM,
    elevationStatus: cebuRoute.elevationProvenance.status,
    landmarkCount: cebuMarkers.filter((m) => m.kind === 'landmark').length,
    checkpointCount: cebuMarkers.length,
    currentPublicationId: 'pub_cebu_highlands_21k_v1',
    versionNumber: 1,
    status: 'published',
    publishedAt: now,
    mapLayerProvenance: cebuProv,
  };

  store.catalog['bukidnon-kitanglad-trail-2026_32k'] = {
    id: 'bukidnon-kitanglad-trail-2026_32k',
    raceId: PILOT_BUKIDNON_RACE.id,
    raceName: PILOT_BUKIDNON_RACE.name,
    raceDate: PILOT_BUKIDNON_RACE.date,
    region: 'Mindanao · Bukidnon',
    distanceId: '32k',
    distanceLabel: '32K',
    advertisedKm: 32,
    measuredDistanceM: bukRoute.distanceM,
    elevationGainM: bukRoute.elevationGainM,
    elevationStatus: bukRoute.elevationProvenance.status,
    landmarkCount: bukMarkers.filter((m) => m.kind === 'landmark').length,
    checkpointCount: bukMarkers.length,
    currentPublicationId: 'pub_bukidnon_kitanglad_32k_v1',
    versionNumber: 1,
    status: 'published',
    publishedAt: now,
    mapLayerProvenance: bukProv,
  };

  saveToStorage(store);
}

export async function ensurePilotCoursesSeeded(force = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!force && !isDemoSeedEnabled()) return;
  const current = getRouteStoreSnapshot();
  const cebuPub = current.publications['pub_cebu_highlands_21k_v1'];
  const bukPub = current.publications['pub_bukidnon_kitanglad_32k_v1'];
  if (cebuPub?.mapLayerProvenance && bukPub?.mapLayerProvenance) {
    registerCourseCorridorForTiles(`${PILOT_CEBU_RACE.id}_21k`, cebuPub.canonicalGeometry);
    registerCourseCorridorForTiles(`${PILOT_BUKIDNON_RACE.id}_32k`, bukPub.canonicalGeometry);
    return;
  }
  if (pilotSeedPromise) return pilotSeedPromise;

  pilotSeedPromise = (async () => {
    try {
      const [cebuText, bukText] = await Promise.all([
        fetchGpxText('/fixtures/cebu-highlands-21k.gpx'),
        fetchGpxText('/fixtures/bukidnon-kitanglad-32k.gpx'),
      ]);
      seedPilotCoursesFromGpxText(cebuText, bukText);
    } catch {
      // Non-fatal in offline/test unit runs without HTTP dev server
    }
  })();
  return pilotSeedPromise;
}

function toValidFirestoreId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length > 0 && cleaned.length <= 64) return cleaned;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  const head = (cleaned || fallbackPrefix).slice(0, Math.max(8, 63 - suffix.length));
  return `${head}_${suffix}`.slice(0, 64);
}

function sanitizeForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistPublicationToCloud(params: {
  publication: PublishedRaceRoute;
  catalogEntry?: RaceRouteCatalogEntry;
  binding?: RaceRouteBinding;
}): void {
  if (typeof window === 'undefined' || !auth.currentUser) return;
  const { publication, catalogEntry, binding } = params;
  const pubDocId = toValidFirestoreId(publication.id, 'pub');
  void setDoc(doc(db, 'publishedRaceRoutes', pubDocId), sanitizeForFirestore(publication), { merge: true }).catch(() => {});
  if (catalogEntry) {
    const catDocId = toValidFirestoreId(catalogEntry.id, 'cat');
    void setDoc(doc(db, 'raceRouteCatalog', catDocId), sanitizeForFirestore(catalogEntry), { merge: true }).catch(() => {});
  }
  if (binding) {
    const distDocId = toValidFirestoreId(binding.distanceId, 'dist');
    void setDoc(
      doc(db, 'races', binding.raceId, 'routeBindings', distDocId),
      sanitizeForFirestore(binding),
      { merge: true },
    ).catch(() => {});
  }
}

export function getPublishedCoursesForRace(raceId: string): PublishedRaceRoute[] {
  const store = getRouteStoreSnapshot();
  const seen = new Set<string>();
  const results: PublishedRaceRoute[] = [];
  for (const entry of Object.values(store.catalog)) {
    if (entry.raceId !== raceId || entry.status !== 'published') continue;
    const pub = store.publications[entry.currentPublicationId];
    if (pub && pub.status === 'published' && !seen.has(pub.id)) {
      seen.add(pub.id);
      results.push(pub);
    }
  }
  for (const binding of Object.values(store.bindings)) {
    if (binding.raceId !== raceId) continue;
    const pub = store.publications[binding.currentPublicationId];
    if (pub && pub.status === 'published' && !seen.has(pub.id)) {
      seen.add(pub.id);
      results.push(pub);
    }
  }
  return results.sort((a, b) => a.advertisedKm - b.advertisedKm || a.distanceLabel.localeCompare(b.distanceLabel));
}

export function subscribeRacePublishedCourses(
  raceId: string,
  onUpdate: (courses: PublishedRaceRoute[]) => void,
): () => void {
  let active = true;
  let localCourses: PublishedRaceRoute[] = getPublishedCoursesForRace(raceId);
  let remoteCatalogEntries: RaceRouteCatalogEntry[] = [];
  let remoteBindings: RaceRouteBinding[] = [];
  const remotePublications = new Map<string, PublishedRaceRoute>();
  const inFlightPubIds = new Set<string>();

  const queueFetchPublication = (pubId: string) => {
    if (!pubId || remotePublications.has(pubId) || inFlightPubIds.has(pubId)) return;
    const localPub = getRouteStoreSnapshot().publications[pubId];
    if (localPub && localPub.status === 'published') {
      remotePublications.set(pubId, localPub);
      return;
    }
    inFlightPubIds.add(pubId);
    void getDoc(doc(db, 'publishedRaceRoutes', toValidFirestoreId(pubId, 'pub')))
      .then((pubSnap) => {
        if (!active) return;
        if (pubSnap.exists()) {
          const pub = { ...(pubSnap.data() as PublishedRaceRoute), id: pubSnap.id };
          if (pub.status === 'published') {
            remotePublications.set(pubId, pub);
            emit();
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightPubIds.delete(pubId);
      });
  };

  const emit = () => {
    if (!active) return;
    const byDistance = new Map<string, PublishedRaceRoute>();
    for (const c of localCourses) {
      if (c.status === 'published') byDistance.set(c.distanceId, c);
    }
    for (const binding of remoteBindings) {
      if (binding.raceId !== raceId || !binding.currentPublicationId) continue;
      const pub = remotePublications.get(binding.currentPublicationId);
      if (pub && pub.status === 'published') {
        byDistance.set(pub.distanceId, pub);
      }
    }
    for (const entry of remoteCatalogEntries) {
      if (entry.raceId !== raceId || entry.status !== 'published') continue;
      const pub = remotePublications.get(entry.currentPublicationId);
      if (pub && pub.status === 'published') {
        byDistance.set(pub.distanceId, pub);
      }
    }
    const sorted = Array.from(byDistance.values()).sort(
      (a, b) => a.advertisedKm - b.advertisedKm || a.distanceLabel.localeCompare(b.distanceLabel),
    );
    onUpdate(sorted);
  };

  emit();

  const unsubLocal = subscribeRouteStore((store) => {
    const nextLocal: PublishedRaceRoute[] = [];
    const seen = new Set<string>();
    for (const entry of Object.values(store.catalog)) {
      if (entry.raceId !== raceId || entry.status !== 'published') continue;
      const pub = store.publications[entry.currentPublicationId];
      if (pub && pub.status === 'published' && !seen.has(pub.id)) {
        seen.add(pub.id);
        nextLocal.push(pub);
      }
    }
    for (const binding of Object.values(store.bindings)) {
      if (binding.raceId !== raceId) continue;
      const pub = store.publications[binding.currentPublicationId];
      if (pub && pub.status === 'published' && !seen.has(pub.id)) {
        seen.add(pub.id);
        nextLocal.push(pub);
      }
    }
    localCourses = nextLocal;
    emit();
  });

  // Query by raceId alone so Firestore never requires a composite index for runner discovery.
  const unsubRemoteCatalog = onSnapshot(
    query(collection(db, 'raceRouteCatalog'), where('raceId', '==', raceId)),
    (snap) => {
      remoteCatalogEntries = snap.docs
        .map((d) => ({ ...(d.data() as RaceRouteCatalogEntry), id: d.id }))
        .filter((entry) => entry.status === 'published');
      for (const entry of remoteCatalogEntries) {
        queueFetchPublication(entry.currentPublicationId);
      }
      emit();
    },
    () => {
      // Offline / unauthenticated fallback keeps local courses intact
    },
  );

  const unsubRemoteBindings = onSnapshot(
    collection(db, 'races', raceId, 'routeBindings'),
    (snap) => {
      remoteBindings = snap.docs.map((d) => ({ ...(d.data() as RaceRouteBinding), distanceId: (d.data() as RaceRouteBinding).distanceId || d.id }));
      for (const binding of remoteBindings) {
        queueFetchPublication(binding.currentPublicationId);
      }
      emit();
    },
    () => {
      // Keep local/catalog fallback when subcollection is unreadable offline
    },
  );

  return () => {
    active = false;
    unsubLocal();
    unsubRemoteCatalog();
    unsubRemoteBindings();
  };
}

export function subscribePublishedCatalog(
  onUpdate: (entries: RaceRouteCatalogEntry[]) => void,
): () => void {
  let localEntries: RaceRouteCatalogEntry[] = Object.values(getRouteStoreSnapshot().catalog);
  let remoteEntries: RaceRouteCatalogEntry[] = [];

  const emit = () => {
    const merged = new Map<string, RaceRouteCatalogEntry>();
    for (const item of localEntries) merged.set(item.id, item);
    for (const item of remoteEntries) merged.set(item.id, item);
    onUpdate(Array.from(merged.values()));
  };

  const unsubLocal = subscribeRouteStore((store) => {
    localEntries = Object.values(store.catalog);
    emit();
  });

  const unsubRemote = onSnapshot(
    query(collection(db, 'raceRouteCatalog'), where('status', '==', 'published')),
    (snap) => {
      remoteEntries = snap.docs.map((d) => ({ ...(d.data() as RaceRouteCatalogEntry), id: d.id }));
      emit();
    },
    () => {
      // Keep local catalog available when offline or unauthenticated
    },
  );

  return () => {
    unsubLocal();
    unsubRemote();
  };
}

function withFirestoreTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('firestore-read-timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function loadPublishedCourse(
  raceId: string,
  distanceId: string,
  requestedPublicationId?: string,
): Promise<{
  publication: PublishedRaceRoute | null;
  currentPublicationId?: string;
  isHistorical: boolean;
  withdrawn: boolean;
  withdrawalReason?: string;
}> {
  if (isDemoSeedEnabled()) {
    await Promise.all([ensurePilotCoursesSeeded(), ensureDemoCoursesSeeded()]);
  }
  const store = getRouteStoreSnapshot();
  const bindingKey = `${raceId}_${distanceId}`;
  let currentPubId = store.bindings[bindingKey]?.currentPublicationId || store.catalog[bindingKey]?.currentPublicationId;
  const hasLocalBinding = Boolean(currentPubId && store.publications[currentPubId]);
  const readBudgetMs = hasLocalBinding ? 1200 : 4000;

  try {
    const bindingSnap = await withFirestoreTimeout(
      getDoc(doc(db, 'races', raceId, 'routeBindings', toValidFirestoreId(distanceId, 'dist'))),
      readBudgetMs,
    );
    if (bindingSnap.exists()) {
      const data = bindingSnap.data() as RaceRouteBinding;
      if (data.currentPublicationId) currentPubId = data.currentPublicationId;
    }
    if (!currentPubId && !requestedPublicationId) {
      const catSnap = await withFirestoreTimeout(
        getDocs(query(collection(db, 'raceRouteCatalog'), where('raceId', '==', raceId))),
        readBudgetMs,
      );
      const normalizedDist = distanceId.trim().toLowerCase();
      for (const docSnap of catSnap.docs) {
        const entry = docSnap.data() as RaceRouteCatalogEntry;
        if (entry.status !== 'published' || !entry.currentPublicationId) continue;
        if (
          entry.distanceId.toLowerCase() === normalizedDist ||
          entry.distanceLabel.toLowerCase() === normalizedDist
        ) {
          currentPubId = entry.currentPublicationId;
          break;
        }
      }
    }
  } catch {
    // Fallback cleanly to local/seeded store
  }

  const targetPubId = requestedPublicationId || currentPubId;
  if (!targetPubId) {
    return { publication: null, isHistorical: false, withdrawn: false };
  }

  let publication = store.publications[targetPubId] || null;
  try {
    const pubSnap = await withFirestoreTimeout(
      getDoc(doc(db, 'publishedRaceRoutes', toValidFirestoreId(targetPubId, 'pub'))),
      publication ? 1200 : 4000,
    );
    if (pubSnap.exists()) {
      publication = { ...(pubSnap.data() as PublishedRaceRoute), id: pubSnap.id };
    }
  } catch {
    // Keep local publication
  }

  if (!publication) {
    return { publication: null, currentPublicationId: currentPubId, isHistorical: false, withdrawn: false };
  }
  if (publication.status === 'withdrawn') {
    return {
      publication: null,
      currentPublicationId: currentPubId,
      isHistorical: false,
      withdrawn: true,
      withdrawalReason: publication.withdrawalReason,
    };
  }

  const courseScopeId = `${publication.raceId}_${publication.distanceId}`;
  registerCourseCorridorForTiles(courseScopeId, publication.canonicalGeometry);
  if (!publication.mapLayerProvenance) {
    publication = {
      ...publication,
      mapLayerProvenance: prepareCourseMapLayerManifest(publication.canonicalGeometry, {
        courseId: courseScopeId,
      }),
    };
  }

  return {
    publication,
    currentPublicationId: currentPubId,
    isHistorical: Boolean(currentPubId && publication.id !== currentPubId),
    withdrawn: false,
  };
}

export interface PublicationReadinessIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export function validatePublicationReadiness(params: {
  title: string;
  geometry: CanonicalRouteGeometry;
  markers: RouteMarker[];
  race?: Race | null;
  distanceId?: string;
}): { ready: boolean; issues: PublicationReadinessIssue[] } {
  const issues: PublicationReadinessIssue[] = [];
  if (!params.title.trim()) {
    issues.push({ code: 'title', severity: 'error', message: 'Course title is required.' });
  }
  const processed = processCanonicalGeometry(params.geometry);
  if (processed.canonicalGeometry.isCanvasCleared || processed.points.length < 2) {
    issues.push({
      code: 'empty-geometry',
      severity: 'error',
      message: 'Course has no route path yet. Draw, paint, record GPS, or import a GPX file before publishing.',
    });
  }
  if (processed.canonicalSegments.length > 1) {
    issues.push({
      code: 'multi-segment',
      severity: 'warning',
      message: `Course contains ${processed.canonicalSegments.length} separate segments. Verify transition handling.`,
    });
  }
  if (processed.validationReport.hasDrawnSections) {
    issues.push({
      code: 'drawn-sections',
      severity: 'warning',
      message: 'Course includes manually drawn segments without GPX elevation.',
    });
  }

  const hasStart = params.markers.some((m) => m.kind === 'start');
  const hasFinish = params.markers.some((m) => m.kind === 'finish');
  if (!hasStart) issues.push({ code: 'start', severity: 'error', message: 'Start marker is required.' });
  if (!hasFinish) issues.push({ code: 'finish', severity: 'error', message: 'Finish marker is required.' });

  for (const m of params.markers) {
    const { needsReview, offCourseBlocked } = evaluateMarkerOffset(m.offsetMeters, m.offCourseConfirmed);
    if (offCourseBlocked) {
      issues.push({
        code: `offcourse_${m.id}`,
        severity: 'error',
        message: `"${m.name}" is ${Math.round(m.offsetMeters)} m off the course (>100 m). Confirm off-course facility access instructions or move it closer.`,
      });
    } else if (needsReview) {
      issues.push({
        code: `review_${m.id}`,
        severity: 'warning',
        message: `"${m.name}" is ${Math.round(m.offsetMeters)} m off the course (>30 m review threshold).`,
      });
    }
    if (m.offCourseConfirmed && !m.offCourseInstruction?.trim()) {
      issues.push({
        code: `instruction_${m.id}`,
        severity: 'error',
        message: `Off-course facility "${m.name}" needs written runner access instructions.`,
      });
    }
    for (const p of m.photos) {
      if (!p.rightsConfirmed || !p.altText.trim() || !p.caption.trim() || !p.credit.trim()) {
        issues.push({
          code: `photo_${m.id}`,
          severity: 'error',
          message: `Photo on "${m.name}" is missing alt text, caption, credit, or rights confirmation.`,
        });
      }
    }
  }

  if (params.race) {
    const orderById = new Map(params.race.checkpoints.map((cp, idx) => [cp.id, cp.order ?? idx]));
    const linked = params.markers
      .filter((m) => m.kind === 'timing' && m.timingCheckpointId)
      .sort((a, b) => a.chainageM - b.chainageM || (a.passNumber || 1) - (b.passNumber || 1));
    let lastOrder = -1;
    for (const item of linked) {
      const order = orderById.get(item.timingCheckpointId!);
      if (order === undefined) {
        issues.push({
          code: `cp_unknown_${item.id}`,
          severity: 'error',
          message: `Timing marker "${item.name}" links to a checkpoint not in this race.`,
        });
      } else if (order < lastOrder && (item.passNumber || 1) <= 1) {
        issues.push({
          code: `cp_order_${item.id}`,
          severity: 'error',
          message: `Timing marker "${item.name}" is out of order relative to official timing checkpoints.`,
        });
      } else {
        lastOrder = order;
      }
    }
  }

  return {
    ready: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}

function appendAudit(store: RouteWorkspaceStore, event: Omit<RouteAuditEvent, 'id' | 'at'>): void {
  store.audit.unshift({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    ...event,
  });
  store.audit = store.audit.slice(0, 120);
}

function resolveRemoteRouteApiUrl(): string | null {
  const configured = import.meta.env.VITE_ROUTE_API_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return null;
}

async function tryRemoteCommand(path: string, payload: Record<string, unknown>): Promise<void> {
  const apiUrl = resolveRemoteRouteApiUrl();
  const user = auth.currentUser;
  if (!apiUrl || !user) return;
  const [token, appCheckHeaders] = await Promise.all([
    user.getIdToken(),
    getAppCheckHeaders(),
  ]);
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...appCheckHeaders,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const retryAfter = parseRetryAfterSeconds(res, err);
    if (res.status === 429 && retryAfter > 0) {
      throw new Error(err.error || `Too many route updates. Please wait ${retryAfter}s.`);
    }
    throw new Error(err.error || 'Remote route command failed.');
  }
}

export function createPresetDraftCommand(input: {
  actorUid: string;
  actorName: string;
  title: string;
  region: string;
  activity: 'road' | 'trail' | 'mixed';
  raceId?: string;
  distanceId?: string;
  geometry: CanonicalRouteGeometry;
  markers?: RouteMarker[];
  sourceFileName?: string;
}): { preset: RoutePreset; draft: RouteDraft } {
  const store = structuredClone(getRouteStoreSnapshot());
  const now = new Date().toISOString();
  const presetId = `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const draftId = 'draft_main';
  const processed = processCanonicalGeometry(input.geometry);
  const anchoredMarkers = reanchorMarkersForRoute(processed, input.markers || []);

  const preset: RoutePreset = {
    id: presetId,
    title: input.title.trim() || 'Untitled Course',
    region: input.region.trim() || 'Philippines',
    activity: input.activity,
    ...(input.raceId ? { raceId: input.raceId } : {}),
    ...(input.distanceId ? { distanceId: input.distanceId } : {}),
    ownerUid: input.actorUid,
    editorIds: [],
    archived: false,
    latestDraftId: draftId,
    latestVersionNumber: 0,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: input.actorUid,
  };
  const courseScopeId = input.raceId && input.distanceId ? `${input.raceId}_${input.distanceId}` : presetId;
  const mapLayerProvenance = prepareCourseMapLayerManifest(processed.canonicalGeometry, {
    courseId: courseScopeId,
  });

  const draft: RouteDraft = {
    id: draftId,
    presetId,
    ...(input.raceId ? { raceId: input.raceId } : {}),
    ...(input.distanceId ? { distanceId: input.distanceId } : {}),
    title: preset.title,
    region: preset.region,
    revision: 1,
    processingState: processed.validationReport.warnings.length ? 'needs_review' : 'ready',
    sourceFileName: input.sourceFileName,
    selectedTrackIndices: [0],
    canonicalGeometry: processed.canonicalGeometry,
    elevationProvenance: processed.elevationProvenance,
    validationReport: processed.validationReport,
    markers: anchoredMarkers,
    distanceM: processed.distanceM,
    elevationGainM: processed.elevationGainM,
    elevationLossM: processed.elevationLossM,
    editSummary: 'Created course preset',
    updatedAt: now,
    updatedBy: input.actorUid,
    mapLayerProvenance,
  };

  store.presets[presetId] = preset;
  store.drafts[`${presetId}::${draftId}`] = draft;
  appendAudit(store, {
    action: 'create_preset',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId,
    draftId,
    reason: preset.title,
  });
  saveToStorage(store);
  void tryRemoteCommand('/create-preset', {
    requestId: crypto.randomUUID(),
    presetId,
    draftId,
    ...preset,
    ...draft,
  }).catch(() => {});
  return { preset, draft };
}

export function ensurePresetForRaceDistanceCommand(input: {
  actorUid: string;
  actorName: string;
  race: Race;
  distanceId: string;
  starterGeometry?: CanonicalRouteGeometry;
}): { preset: RoutePreset; draft: RouteDraft } | null {
  const store = getRouteStoreSnapshot();
  const binding = store.bindings[`${input.race.id}_${input.distanceId}`];
  if (binding && store.presets[binding.presetId]) {
    const preset = store.presets[binding.presetId];
    const draft = store.drafts[`${preset.id}::${preset.latestDraftId}`];
    if (draft) return { preset, draft };
  }
  const existing = Object.values(store.presets).find(
    (p) => p.raceId === input.race.id && (p.distanceId === input.distanceId || !p.distanceId),
  );
  if (existing) {
    const draft = store.drafts[`${existing.id}::${existing.latestDraftId}`];
    if (draft) return { preset: existing, draft };
  }

  const distObj = input.race.distances.find((d) => d.id === input.distanceId) || input.race.distances[0];
  const distLabel = distObj?.label || input.distanceId || 'Course';
  return createPresetDraftCommand({
    actorUid: input.actorUid,
    actorName: input.actorName,
    title: `${input.race.name} (${distLabel})`,
    region: 'Philippines',
    activity: distObj && distObj.km >= 21 ? 'trail' : 'road',
    raceId: input.race.id,
    distanceId: distObj?.id || input.distanceId,
    geometry: input.starterGeometry ?? createEmptyRouteGeometry(),
  });
}

export function savePresetDraftCommand(input: {
  actorUid: string;
  actorName: string;
  presetId: string;
  draftId?: string;
  expectedRevision: number;
  title: string;
  region: string;
  geometry: CanonicalRouteGeometry;
  markers: RouteMarker[];
  sourceFileName?: string;
  editSummary?: string;
}): RouteDraft {
  const store = structuredClone(getRouteStoreSnapshot());
  const draftId = input.draftId || 'draft_main';
  const key = `${input.presetId}::${draftId}`;
  const preset = store.presets[input.presetId];
  const existingDraft = store.drafts[key];
  if (!preset || !existingDraft) {
    throw new Error('Preset or draft was not found.');
  }
  if (existingDraft.revision !== input.expectedRevision) {
    throw new Error(
      `Revision conflict: draft is at revision ${existingDraft.revision}, but you edited revision ${input.expectedRevision}. Reload the latest draft before saving.`,
    );
  }

  const processed = processCanonicalGeometry(input.geometry);
  const anchoredMarkers = reanchorMarkersForRoute(processed, input.markers);
  const now = new Date().toISOString();
  const courseScopeId =
    preset.raceId && preset.distanceId ? `${preset.raceId}_${preset.distanceId}` : preset.id;
  const mapLayerProvenance = prepareCourseMapLayerManifest(processed.canonicalGeometry, {
    courseId: courseScopeId,
  });
  const nextDraft: RouteDraft = {
    ...existingDraft,
    title: input.title.trim() || existingDraft.title,
    region: input.region.trim() || existingDraft.region,
    revision: existingDraft.revision + 1,
    processingState: processed.validationReport.warnings.length ? 'needs_review' : 'ready',
    sourceFileName: input.sourceFileName ?? existingDraft.sourceFileName,
    canonicalGeometry: processed.canonicalGeometry,
    elevationProvenance: processed.elevationProvenance,
    validationReport: processed.validationReport,
    markers: anchoredMarkers,
    distanceM: processed.distanceM,
    elevationGainM: processed.elevationGainM,
    elevationLossM: processed.elevationLossM,
    editSummary: input.editSummary?.trim() || 'Updated course draft',
    updatedAt: now,
    updatedBy: input.actorUid,
    mapLayerProvenance,
  };

  store.drafts[key] = nextDraft;
  store.presets[input.presetId] = {
    ...preset,
    title: nextDraft.title,
    region: nextDraft.region,
    revision: preset.revision + 1,
    updatedAt: now,
    updatedBy: input.actorUid,
  };
  appendAudit(store, {
    action: 'save_draft',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId: input.presetId,
    draftId,
    reason: nextDraft.editSummary,
  });
  saveToStorage(store);
  return nextDraft;
}

export function duplicatePresetCommand(input: {
  actorUid: string;
  actorName: string;
  sourcePresetId: string;
}): { preset: RoutePreset; draft: RouteDraft } {
  const store = getRouteStoreSnapshot();
  const sourcePreset = store.presets[input.sourcePresetId];
  const sourceDraft = store.drafts[`${input.sourcePresetId}::${sourcePreset?.latestDraftId || 'draft_main'}`];
  if (!sourcePreset || !sourceDraft) {
    throw new Error('Source preset not found.');
  }
  const created = createPresetDraftCommand({
    actorUid: input.actorUid,
    actorName: input.actorName,
    title: `${sourcePreset.title} (Copy)`,
    region: sourcePreset.region,
    activity: sourcePreset.activity,
    raceId: sourcePreset.raceId,
    distanceId: sourcePreset.distanceId,
    geometry: sourceDraft.canonicalGeometry,
    markers: sourceDraft.markers.map((m) => ({ ...m })),
    sourceFileName: sourceDraft.sourceFileName,
  });
  const nextStore = structuredClone(getRouteStoreSnapshot());
  appendAudit(nextStore, {
    action: 'duplicate_preset',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId: created.preset.id,
    reason: `Duplicated from ${sourcePreset.title}`,
  });
  saveToStorage(nextStore);
  return created;
}

export function archivePresetCommand(input: {
  actorUid: string;
  actorName: string;
  presetId: string;
  archived: boolean;
}): RoutePreset {
  const store = structuredClone(getRouteStoreSnapshot());
  const preset = store.presets[input.presetId];
  if (!preset) throw new Error('Preset not found.');
  const now = new Date().toISOString();
  const updated: RoutePreset = {
    ...preset,
    archived: input.archived,
    revision: preset.revision + 1,
    updatedAt: now,
    updatedBy: input.actorUid,
  };
  store.presets[input.presetId] = updated;
  appendAudit(store, {
    action: 'archive_preset',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId: input.presetId,
    reason: input.archived ? 'Archived preset (existing publications preserved)' : 'Restored preset',
  });
  saveToStorage(store);
  return updated;
}

export function createPresetVersionCommand(input: {
  actorUid: string;
  actorName: string;
  presetId: string;
  draftId?: string;
  expectedRevision: number;
  reviewNotes?: string;
}): RoutePresetVersion {
  const store = structuredClone(getRouteStoreSnapshot());
  const draftId = input.draftId || 'draft_main';
  const preset = store.presets[input.presetId];
  const draft = store.drafts[`${input.presetId}::${draftId}`];
  if (!preset || !draft) throw new Error('Preset or draft not found.');
  if (draft.revision !== input.expectedRevision) {
    throw new Error('Draft revision changed. Save or reload before creating a version.');
  }

  const nextVersionNumber = (preset.latestVersionNumber || 0) + 1;
  const versionId = `${input.presetId}_v${nextVersionNumber}`;
  const now = new Date().toISOString();

  const mapLayerProvenance =
    draft.mapLayerProvenance ||
    prepareCourseMapLayerManifest(draft.canonicalGeometry, {
      courseId: preset.raceId && preset.distanceId ? `${preset.raceId}_${preset.distanceId}` : preset.id,
    });

  const version: RoutePresetVersion = {
    id: versionId,
    presetId: input.presetId,
    versionNumber: nextVersionNumber,
    title: draft.title,
    region: draft.region,
    geometryHash: `sha_${Math.abs(draft.canonicalGeometry.segments.reduce((s, seg) => s + seg.points.length * 31, 7)).toString(16)}_${Date.now().toString(36)}`,
    canonicalGeometry: structuredClone(draft.canonicalGeometry),
    elevationProvenance: structuredClone(draft.elevationProvenance),
    validationReport: structuredClone(draft.validationReport),
    markers: structuredClone(draft.markers),
    distanceM: draft.distanceM,
    elevationGainM: draft.elevationGainM,
    elevationLossM: draft.elevationLossM,
    reviewNotes: input.reviewNotes?.trim() || 'Reviewed for race assignment',
    reviewedBy: input.actorUid,
    reviewedAt: now,
    createdAt: now,
    mapLayerProvenance,
  };

  store.versions[versionId] = version;
  store.presets[input.presetId] = {
    ...preset,
    latestVersionId: versionId,
    latestVersionNumber: nextVersionNumber,
    revision: preset.revision + 1,
    updatedAt: now,
    updatedBy: input.actorUid,
  };
  appendAudit(store, {
    action: 'create_version',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId: input.presetId,
    versionId,
    reason: version.reviewNotes,
  });
  saveToStorage(store);
  return version;
}

export function bindAndPublishRaceRouteCommand(input: {
  actorUid: string;
  actorName: string;
  race: Race;
  distanceId: string;
  presetId: string;
  versionId: string;
  checkpointLinks?: Record<string, string>;
  overrideFreeze?: boolean;
  reason?: string;
}): { binding: RaceRouteBinding; publication: PublishedRaceRoute; catalogEntry: RaceRouteCatalogEntry } {
  const store = structuredClone(getRouteStoreSnapshot());
  const version = store.versions[input.versionId];
  if (!version || version.presetId !== input.presetId) {
    throw new Error('Selected preset version does not exist.');
  }
  const distance = input.race.distances.find((d) => d.id === input.distanceId);
  if (!distance) {
    throw new Error('Selected race distance category was not found.');
  }

  const raceStarted = Boolean(
    input.race.gunStartTime ||
      input.race.completedAt ||
      (input.race.waveStartTimes && Object.keys(input.race.waveStartTimes).length > 0),
  );
  if (raceStarted && !input.overrideFreeze) {
    throw new Error(
      'Race-day freeze is active because timing has started. Confirm explicit freeze override with a written reason.',
    );
  }
  if (raceStarted && input.overrideFreeze && !input.reason?.trim()) {
    throw new Error('A written correction reason is required to override the race-day freeze.');
  }

  const checkpointLinks = input.checkpointLinks || {};
  const mergedMarkers: RouteMarker[] = version.markers.map((m) => ({
    ...m,
    timingCheckpointId: checkpointLinks[m.id] || m.timingCheckpointId,
    visibility: 'public',
    reviewedBy: input.actorUid,
    reviewedAt: new Date().toISOString(),
  }));

  const readiness = validatePublicationReadiness({
    title: version.title,
    geometry: version.canonicalGeometry,
    markers: mergedMarkers,
    race: input.race,
    distanceId: input.distanceId,
  });
  if (!readiness.ready) {
    const firstError = readiness.issues.find((i) => i.severity === 'error');
    throw new Error(firstError?.message || 'Course failed pre-publish validation.');
  }

  const bindingKey = `${input.race.id}_${input.distanceId}`;
  const prevBinding = store.bindings[bindingKey];
  const prevPubId = prevBinding?.currentPublicationId;
  if (prevPubId && store.publications[prevPubId]) {
    store.publications[prevPubId] = {
      ...store.publications[prevPubId],
      status: 'superseded',
    };
  }

  const now = new Date().toISOString();
  const rawPubId = `pub_${input.race.id}_${input.distanceId}_v${version.versionNumber}_${Date.now().toString(36)}`;
  const publicationId = toValidFirestoreId(rawPubId, 'pub');
  const processed = processCanonicalGeometry(version.canonicalGeometry);
  const chapters: RouteChapter[] = deriveDefaultChapters(processed, mergedMarkers);
  const mapLayerProvenance = prepareCourseMapLayerManifest(version.canonicalGeometry, {
    courseId: bindingKey,
  });
  if (!mapLayerProvenance.validation.passed) {
    throw new Error(
      mapLayerProvenance.validation.issues[0] ||
        'Prepared imagery and elevation tiles failed validation.',
    );
  }

  const publication: PublishedRaceRoute = {
    id: publicationId,
    raceId: input.race.id,
    raceName: input.race.name,
    raceDate: input.race.date,
    distanceId: input.distanceId,
    distanceLabel: distance.label,
    advertisedKm: distance.km,
    measuredDistanceM: version.distanceM,
    elevationGainM: version.elevationGainM,
    elevationLossM: version.elevationLossM,
    presetId: input.presetId,
    versionId: input.versionId,
    versionNumber: version.versionNumber,
    geometryHash: version.geometryHash,
    canonicalGeometry: structuredClone(version.canonicalGeometry),
    elevationProvenance: structuredClone(version.elevationProvenance),
    markers: mergedMarkers,
    chapters,
    status: 'published',
    publishedAt: now,
    publishedBy: input.actorUid,
    reviewedAt: version.reviewedAt || now,
    mapLayerProvenance,
    ...(prevPubId ? { supersedesPublicationId: prevPubId } : {}),
    ...(raceStarted && input.overrideFreeze ? { overrideReason: input.reason?.trim() } : {}),
  };

  const binding: RaceRouteBinding = {
    id: bindingKey,
    raceId: input.race.id,
    distanceId: input.distanceId,
    distanceLabel: distance.label,
    advertisedKm: distance.km,
    presetId: input.presetId,
    versionId: input.versionId,
    versionNumber: version.versionNumber,
    currentPublicationId: publicationId,
    bindingRevision: (prevBinding?.bindingRevision || 0) + 1,
    checkpointLinks,
    updatedAt: now,
    updatedBy: input.actorUid,
  };

  const catalogEntry: RaceRouteCatalogEntry = {
    id: bindingKey,
    raceId: input.race.id,
    raceName: input.race.name,
    raceDate: input.race.date,
    region:
      version.region && version.region !== 'Philippines'
        ? version.region
        : `${mapLayerProvenance.islandGroup} · ${mapLayerProvenance.province}`,
    distanceId: input.distanceId,
    distanceLabel: distance.label,
    advertisedKm: distance.km,
    measuredDistanceM: version.distanceM,
    elevationGainM: version.elevationGainM,
    elevationStatus: version.elevationProvenance.status,
    landmarkCount: mergedMarkers.filter((m) => m.kind === 'landmark').length,
    checkpointCount: mergedMarkers.length,
    currentPublicationId: publicationId,
    versionNumber: version.versionNumber,
    status: 'published',
    publishedAt: now,
    mapLayerProvenance,
  };

  store.bindings[bindingKey] = binding;
  store.publications[publicationId] = publication;
  store.catalog[bindingKey] = catalogEntry;
  appendAudit(store, {
    action: raceStarted && input.overrideFreeze ? 'freeze_override' : 'publish',
    actorUid: input.actorUid,
    actorName: input.actorName,
    presetId: input.presetId,
    versionId: input.versionId,
    raceId: input.race.id,
    distanceId: input.distanceId,
    publicationId,
    previousPublicationId: prevPubId,
    reason: input.reason?.trim() || `Published v${version.versionNumber} for ${distance.label}`,
  });

  saveToStorage(store);
  persistPublicationToCloud({ publication, catalogEntry, binding });
  return { binding, publication, catalogEntry };
}

export function withdrawPublicationCommand(input: {
  actorUid: string;
  actorName: string;
  raceId: string;
  distanceId: string;
  publicationId: string;
  reason: string;
}): void {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Withdrawal reason is required.');
  const store = structuredClone(getRouteStoreSnapshot());
  const pub = store.publications[input.publicationId];
  if (!pub) throw new Error('Publication not found.');
  const updatedPub: PublishedRaceRoute = {
    ...pub,
    status: 'withdrawn',
    withdrawalReason: reason,
  };
  store.publications[input.publicationId] = updatedPub;
  const catKey = `${input.raceId}_${input.distanceId}`;
  let updatedCat: RaceRouteCatalogEntry | undefined;
  if (store.catalog[catKey]) {
    updatedCat = { ...store.catalog[catKey], status: 'withdrawn' };
    store.catalog[catKey] = updatedCat;
  }
  appendAudit(store, {
    action: 'withdraw',
    actorUid: input.actorUid,
    actorName: input.actorName,
    raceId: input.raceId,
    distanceId: input.distanceId,
    publicationId: input.publicationId,
    reason,
  });
  saveToStorage(store);
  persistPublicationToCloud({ publication: updatedPub, catalogEntry: updatedCat });
}

export function rollbackPublicationCommand(input: {
  actorUid: string;
  actorName: string;
  raceId: string;
  distanceId: string;
  targetPublicationId: string;
  reason?: string;
}): PublishedRaceRoute {
  const store = structuredClone(getRouteStoreSnapshot());
  const target = store.publications[input.targetPublicationId];
  if (!target || target.raceId !== input.raceId || target.distanceId !== input.distanceId) {
    throw new Error('Target publication does not belong to this race distance.');
  }
  const bindingKey = `${input.raceId}_${input.distanceId}`;
  const binding = store.bindings[bindingKey];
  const prevPubId = binding?.currentPublicationId;
  if (prevPubId && prevPubId !== target.id && store.publications[prevPubId]) {
    store.publications[prevPubId] = { ...store.publications[prevPubId], status: 'superseded' };
  }

  const restored: PublishedRaceRoute = {
    ...target,
    status: 'published',
    withdrawalReason: undefined,
  };
  store.publications[target.id] = restored;
  let updatedBinding: RaceRouteBinding | undefined;
  if (binding) {
    updatedBinding = {
      ...binding,
      currentPublicationId: target.id,
      versionId: target.versionId,
      versionNumber: target.versionNumber,
      bindingRevision: binding.bindingRevision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorUid,
    };
    store.bindings[bindingKey] = updatedBinding;
  }
  let updatedCat: RaceRouteCatalogEntry | undefined;
  if (store.catalog[bindingKey]) {
    updatedCat = {
      ...store.catalog[bindingKey],
      currentPublicationId: target.id,
      versionNumber: target.versionNumber,
      status: 'published',
    };
    store.catalog[bindingKey] = updatedCat;
  }
  appendAudit(store, {
    action: 'rollback',
    actorUid: input.actorUid,
    actorName: input.actorName,
    raceId: input.raceId,
    distanceId: input.distanceId,
    publicationId: target.id,
    previousPublicationId: prevPubId,
    reason: input.reason?.trim() || `Rolled back to v${target.versionNumber}`,
  });
  saveToStorage(store);
  persistPublicationToCloud({
    publication: restored,
    catalogEntry: updatedCat,
    binding: updatedBinding,
  });
  return restored;
}

export interface LegacyMigrationResult {
  status: 'imported' | 'already_imported' | 'needs_distance_choice' | 'external_link_only' | 'failed';
  raceId: string;
  presetId?: string;
  message: string;
}

export async function migrateLegacyRaceGpxCommand(input: {
  actorUid: string;
  actorName: string;
  race: Race;
  targetDistanceId?: string;
  dryRun?: boolean;
}): Promise<LegacyMigrationResult> {
  const store = structuredClone(getRouteStoreSnapshot());
  if (!input.race.routeGpxUrl) {
    return {
      status: 'external_link_only',
      raceId: input.race.id,
      message: input.race.routeMapUrl
        ? 'Uses external routeMapUrl only; retained as-is without scraping.'
        : 'No legacy GPX asset present.',
    };
  }

  if (input.race.distances.length > 1 && !input.targetDistanceId) {
    return {
      status: 'needs_distance_choice',
      raceId: input.race.id,
      message: `Race has ${input.race.distances.length} distance categories. Select the target category explicitly so one GPX is not assigned to the wrong distance.`,
    };
  }

  const distId = input.targetDistanceId || input.race.distances[0]?.id || 'default';
  const migrationKey = `legacy_${input.race.id}_${distId}`;
  const existing = store.migratedLegacyKeys[migrationKey];
  if (existing && store.presets[existing.presetId]) {
    return {
      status: 'already_imported',
      raceId: input.race.id,
      presetId: existing.presetId,
      message: `Already imported as preset ${store.presets[existing.presetId].title}. Duplicate import skipped.`,
    };
  }

  if (input.dryRun) {
    return {
      status: 'imported',
      raceId: input.race.id,
      message: `Dry run ready: ${input.race.routeGpxFileName || 'legacy route.gpx'} can be imported into ${distId}.`,
    };
  }

  try {
    const gpxText = await fetchGpxText(input.race.routeGpxUrl);
    const parsed = parseGpxRoute(gpxText);
    const startPt = parsed.points[0];
    const endPt = parsed.points[parsed.points.length - 1];
    const defaultMarkers: RouteMarker[] = [
      {
        id: `m_leg_start_${Date.now().toString(36)}`,
        kind: 'start',
        name: 'Start',
        description: 'Migrated start point (review before publishing)',
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
        visibility: 'draft',
      },
      {
        id: `m_leg_finish_${Date.now().toString(36)}`,
        kind: 'finish',
        name: 'Finish',
        description: 'Migrated finish point (review before publishing)',
        latitude: endPt.latitude,
        longitude: endPt.longitude,
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
        visibility: 'draft',
      },
    ];

    const created = createPresetDraftCommand({
      actorUid: input.actorUid,
      actorName: input.actorName,
      title: `${input.race.name} (${distId.toUpperCase()} migrated)`,
      region: 'Philippines',
      activity: 'road',
      raceId: input.race.id,
      distanceId: distId,
      geometry: parsed.canonicalGeometry,
      markers: defaultMarkers,
      sourceFileName: input.race.routeGpxFileName || 'legacy-route.gpx',
    });

    const latestStore = structuredClone(getRouteStoreSnapshot());
    latestStore.migratedLegacyKeys[migrationKey] = {
      presetId: created.preset.id,
      raceId: input.race.id,
      distanceId: distId,
      sourceUrl: input.race.routeGpxUrl,
      migratedAt: new Date().toISOString(),
    };
    appendAudit(latestStore, {
      action: 'migrate_legacy',
      actorUid: input.actorUid,
      actorName: input.actorName,
      presetId: created.preset.id,
      raceId: input.race.id,
      distanceId: distId,
      reason: `Imported legacy GPX ${input.race.routeGpxFileName || input.race.routeGpxUrl}`,
    });
    saveToStorage(latestStore);

    return {
      status: 'imported',
      raceId: input.race.id,
      presetId: created.preset.id,
      message: `Imported into draft "${created.preset.title}". Review markers and publish when ready.`,
    };
  } catch (err) {
    return {
      status: 'failed',
      raceId: input.race.id,
      message: err instanceof Error ? err.message : 'Legacy GPX file failed validation.',
    };
  }
}

export function runWeeklyClearImageryCheckCommand(input: {
  actorUid: string;
  actorName: string;
  newSceneDate?: string;
}): { checkedCount: number; updatedCount: number; skippedCount: number } {
  const store = structuredClone(getRouteStoreSnapshot());
  const sceneDate = input.newSceneDate || new Date().toISOString().slice(0, 10);
  let checkedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [pubId, pub] of Object.entries(store.publications)) {
    if (pub.status !== 'published') continue;
    checkedCount += 1;
    const { updated, validation } = refreshPublicationImageryProvenance(pub, {
      newSceneDate: sceneDate,
    });
    if (!validation.passed) {
      skippedCount += 1;
      continue;
    }
    store.publications[pubId] = updated;
    const catKey = `${pub.raceId}_${pub.distanceId}`;
    if (store.catalog[catKey]) {
      store.catalog[catKey] = {
        ...store.catalog[catKey],
        mapLayerProvenance: updated.mapLayerProvenance,
      };
    }
    updatedCount += 1;
  }

  appendAudit(store, {
    action: 'refresh_imagery',
    actorUid: input.actorUid,
    actorName: input.actorName,
    reason: `Course imagery check (${sceneDate}): ${updatedCount} validated and updated, ${skippedCount} held`,
  });
  saveToStorage(store);
  return { checkedCount, updatedCount, skippedCount };
}

export function runQuarterlyNationalMosaicRefreshCommand(input: {
  actorUid: string;
  actorName: string;
  quarterlyMosaicPeriod?: string;
}): { checkedCount: number; updatedCount: number; skippedCount: number; quarter: string } {
  const store = structuredClone(getRouteStoreSnapshot());
  const quarter = input.quarterlyMosaicPeriod || DEFAULT_QUARTERLY_MOSAIC_PERIOD;
  let checkedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [pubId, pub] of Object.entries(store.publications)) {
    if (pub.status !== 'published') continue;
    checkedCount += 1;
    const { updated, validation } = refreshPublicationImageryProvenance(pub, {
      quarterlyMosaicPeriod: quarter,
      newSceneDate: pub.mapLayerProvenance?.imageryDate,
    });
    if (!validation.passed) {
      skippedCount += 1;
      continue;
    }
    store.publications[pubId] = updated;
    const catKey = `${pub.raceId}_${pub.distanceId}`;
    if (store.catalog[catKey]) {
      store.catalog[catKey] = {
        ...store.catalog[catKey],
        mapLayerProvenance: updated.mapLayerProvenance,
      };
    }
    updatedCount += 1;
  }

  appendAudit(store, {
    action: 'refresh_mosaic',
    actorUid: input.actorUid,
    actorName: input.actorName,
    reason: `National map mosaic refresh (${quarter}): ${updatedCount} course layers validated`,
  });
  saveToStorage(store);
  return { checkedCount, updatedCount, skippedCount, quarter };
}

export async function refreshRemotePresets(): Promise<void> {
  if (!auth.currentUser) return;
  try {
    const snap = await getDocs(collection(db, 'routePresets'));
    if (snap.empty) return;
    const store = structuredClone(getRouteStoreSnapshot());
    for (const d of snap.docs) {
      store.presets[d.id] = { ...(d.data() as RoutePreset), id: d.id };
    }
    saveToStorage(store);
  } catch {
    // Permission/offline fallback
  }
}

export type RoutePresetConfigKind =
  | 'active'
  | 'active_other_distance'
  | 'withdrawn'
  | 'draft'
  | 'archived';

export interface RoutePresetConfigStatus {
  kind: RoutePresetConfigKind;
  isActiveForDistance: boolean;
  sortRank: number;
  badge: string;
  badgeTone: 'neutral' | 'success' | 'warning' | 'info';
  accentDot?: string;
  sublabel: string;
  activeVersionNumber?: number;
  activeDistanceLabels: string[];
}

export function describePresetConfigStatus(
  preset: RoutePreset,
  store: RouteWorkspaceStore,
  raceId: string,
  distanceId: string,
): RoutePresetConfigStatus {
  const currentBinding = distanceId ? store.bindings[`${raceId}_${distanceId}`] : undefined;
  const currentPub = currentBinding?.currentPublicationId
    ? store.publications[currentBinding.currentPublicationId]
    : undefined;

  if (currentBinding?.presetId === preset.id && currentPub?.status === 'published') {
    const stagedSuffix =
      preset.latestVersionNumber > currentPub.versionNumber
        ? ` · v${preset.latestVersionNumber} staged`
        : '';
    const archivedSuffix = preset.archived ? ' · Archived preset' : '';
    return {
      kind: 'active',
      isActiveForDistance: true,
      sortRank: 0,
      accentDot: '#10b981',
      badge: `Active · v${currentPub.versionNumber}`,
      badgeTone: 'success',
      activeVersionNumber: currentPub.versionNumber,
      activeDistanceLabels: [currentPub.distanceLabel],
      sublabel: `Live on ${currentPub.distanceLabel} · ${(currentPub.measuredDistanceM / 1000).toFixed(2)} km${stagedSuffix}${archivedSuffix}`,
    };
  }

  const otherLiveBindings = Object.values(store.bindings).filter(
    (b) =>
      b.raceId === raceId &&
      b.distanceId !== distanceId &&
      b.presetId === preset.id &&
      Boolean(b.currentPublicationId) &&
      store.publications[b.currentPublicationId!]?.status === 'published',
  );

  if (otherLiveBindings.length > 0) {
    const labels = otherLiveBindings.map((b) => b.distanceLabel);
    const liveDetails = otherLiveBindings
      .map((b) => {
        const pub = b.currentPublicationId ? store.publications[b.currentPublicationId] : undefined;
        return `${b.distanceLabel} v${pub?.versionNumber ?? b.versionNumber}`;
      })
      .join(', ');
    return {
      kind: 'active_other_distance',
      isActiveForDistance: false,
      sortRank: 1,
      accentDot: '#0ea5e9',
      badge: `Active (${labels.join(', ')})`,
      badgeTone: 'info',
      activeDistanceLabels: labels,
      sublabel: `Live on ${liveDetails}`,
    };
  }

  if (currentBinding?.presetId === preset.id && currentPub?.status === 'withdrawn') {
    return {
      kind: 'withdrawn',
      isActiveForDistance: false,
      sortRank: 2,
      accentDot: '#f59e0b',
      badge: 'Withdrawn',
      badgeTone: 'warning',
      activeDistanceLabels: [],
      sublabel: `Withdrawn from ${currentPub.distanceLabel} · v${currentPub.versionNumber}`,
    };
  }

  if (preset.archived) {
    return {
      kind: 'archived',
      isActiveForDistance: false,
      sortRank: 4,
      accentDot: '#71717a',
      badge: 'Archived',
      badgeTone: 'neutral',
      activeDistanceLabels: [],
      sublabel:
        preset.latestVersionNumber > 0
          ? `Archived · v${preset.latestVersionNumber} · Not active`
          : 'Archived · Not active',
    };
  }

  const draft = store.drafts[`${preset.id}::${preset.latestDraftId}`];
  const distText =
    draft && draft.distanceM > 0 && !draft.canonicalGeometry?.isCanvasCleared
      ? `${(draft.distanceM / 1000).toFixed(2)} km draft`
      : 'Empty draft';

  return {
    kind: 'draft',
    isActiveForDistance: false,
    sortRank: distanceId && preset.distanceId === distanceId ? 2 : 3,
    accentDot: undefined,
    badge: preset.latestVersionNumber > 0 ? `Draft · v${preset.latestVersionNumber}` : 'Draft',
    badgeTone: 'neutral',
    activeDistanceLabels: [],
    sublabel: `Not active · ${distText}`,
  };
}

export function sortRoutePresetsForDistance(
  presets: RoutePreset[],
  store: RouteWorkspaceStore,
  raceId: string,
  distanceId: string,
): RoutePreset[] {
  return [...presets].sort((a, b) => {
    const rankDiff =
      describePresetConfigStatus(a, store, raceId, distanceId).sortRank -
      describePresetConfigStatus(b, store, raceId, distanceId).sortRank;
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
