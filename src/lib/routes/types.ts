export type RouteSourceKind = 'gpx' | 'drawn' | 'gps-tracked' | 'mixed';

export type RouteSurfaceType =
  | 'paved'
  | 'dirt'
  | 'grass'
  | 'gravel'
  | 'singletrack'
  | 'technical'
  | 'boardwalk';

export type TerrainScenarioTag =
  | 'normal'
  | 'steep-climb'
  | 'technical-descent'
  | 'river-crossing'
  | 'exposed-ridge'
  | 'mud-hazard'
  | 'stairs';

export type ElevationSource = 'gpx' | 'dem' | 'mixed' | 'unavailable';

export type ElevationStatus = 'complete' | 'partial' | 'unavailable';

export interface ElevationProvenance {
  source: ElevationSource;
  status: ElevationStatus;
  coverageRatio: number;
  coveragePct: number;
  validPoints: number;
  totalPoints: number;
  missingSpansCount: number;
  verticalDatum: 'unknown' | 'EGM96';
  algorithmVersion: 'rp-elev-v1';
  medianWindowM: number;
  smoothingWindowM: number;
  hysteresisThresholdM: number;
  gradeWindowM: number;
  calculatedAt: string;
}

export interface GpxCanonicalPoint {
  latitude: number;
  longitude: number;
  elevation?: number;
  rawElevation?: number;
  smoothedElevation?: number;
  chainageM: number;
  segmentIndex: number;
  pointIndex: number;
  gradePct?: number;
  sourceKind: 'gpx' | 'drawn' | 'gps-tracked';
  surfaceType?: RouteSurfaceType;
  terrainScenario?: TerrainScenarioTag;
  gpsAccuracyM?: number;
}

export interface ElevationProfileSample {
  chainageM: number;
  segmentIndex: number;
  pointIndex: number;
  latitude: number;
  longitude: number;
  elevation?: number;
  rawElevation?: number;
  gradePct?: number;
  sourceKind: 'gpx' | 'drawn' | 'gps-tracked';
  surfaceType?: RouteSurfaceType;
  terrainScenario?: TerrainScenarioTag;
}

export interface ParsedGpxWaypoint {
  id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  confirmed: false;
}

export interface RouteJumpWarning {
  segmentIndex: number;
  pointIndex: number;
  distanceM: number;
  chainageM: number;
}

export interface RouteTrackSummary {
  index: number;
  name: string;
  kind: 'trk' | 'rte';
  segmentCount: number;
  pointCount: number;
  distanceM: number;
}

export interface RouteValidationReport {
  valid: boolean;
  bytes: number;
  pointCount: number;
  segmentCount: number;
  trackNames: string[];
  tracks: RouteTrackSummary[];
  selectedTrackIndices: number[];
  duplicatePointsCount: number;
  jumpWarnings: RouteJumpWarning[];
  hasLoops: boolean;
  hasOverlapPasses: boolean;
  antimeridianWarning: boolean;
  hasMissingElevation: boolean;
  hasDrawnSections: boolean;
  warnings: string[];
  errors: string[];
}

export interface CanonicalSegmentInput {
  id: string;
  name?: string;
  sourceKind: 'gpx' | 'drawn' | 'gps-tracked';
  surfaceType?: RouteSurfaceType;
  terrainScenario?: TerrainScenarioTag;
  points: Array<{
    lat: number;
    lon: number;
    ele?: number;
    rawEle?: number;
    surfaceType?: RouteSurfaceType;
    terrainScenario?: TerrainScenarioTag;
    accuracyM?: number;
    timestamp?: number;
  }>;
}

export interface CanonicalRouteGeometry {
  version: 1;
  sourceKind: RouteSourceKind;
  isCanvasCleared?: boolean;
  isStartPointRemoved?: boolean;
  segments: CanonicalSegmentInput[];
}

export type RouteMarkerKind =
  | 'start'
  | 'finish'
  | 'timing'
  | 'aid'
  | 'water'
  | 'medical'
  | 'hazard'
  | 'landmark';

export interface RoutePhotoAsset {
  id: string;
  thumbnailUrl: string;
  detailUrl: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  caption: string;
  altText: string;
  credit: string;
  rightsConfirmed: boolean;
  capturedOrReviewedAt: string;
}

export interface RouteMarker {
  id: string;
  kind: RouteMarkerKind;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  chainageM: number;
  segmentIndex: number;
  pointIndex: number;
  passNumber: number;
  offsetMeters: number;
  needsReview: boolean;
  offCourseBlocked: boolean;
  offCourseConfirmed: boolean;
  offCourseInstruction?: string;
  timingCheckpointId?: string;
  services: string[];
  cutoffMinutes?: number;
  photos: RoutePhotoAsset[];
  visibility: 'draft' | 'public';
  reviewedBy?: string;
  reviewedAt?: string;
  instruction?: string;
}

export interface RouteChapter {
  id: string;
  label: string;
  chainageM: number;
  passNumber: number;
  latitude: number;
  longitude: number;
  markerId?: string;
}

export type DraftProcessingState =
  | 'uploaded'
  | 'processing'
  | 'needs_review'
  | 'ready'
  | 'failed';

export type PublicationStatus =
  | 'unpublished'
  | 'published'
  | 'superseded'
  | 'withdrawn';

export interface RoutePreset {
  id: string;
  title: string;
  region: string;
  activity: 'road' | 'trail' | 'mixed';
  raceId?: string;
  distanceId?: string;
  ownerUid: string;
  editorIds: string[];
  archived: boolean;
  latestDraftId: string;
  latestVersionId?: string;
  latestVersionNumber: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type PhilippineIslandGroup = 'Luzon' | 'Visayas' | 'Mindanao';

export interface CourseCloudMaskCheck {
  sceneId: string;
  sceneCapturedAt: string;
  sceneCloudCoverPct: number;
  routeCorridorCloudPct: number;
  patchedFromMosaicQuarter: string;
  patchedSegmentsCount: number;
  clearCoverageAfterFillPct: number;
}

export interface CourseTileValidationReport {
  passed: boolean;
  checkedAt: string;
  withinPhilippineBounds: boolean;
  nationalTileCount: number;
  courseDetailTileCount: number;
  estimatedImageryBytes: number;
  estimatedDemBytes: number;
  demNodataVoidsCount: number;
  cloudFreeCoveragePct: number;
  issues: string[];
}

export interface CourseMapLayerProvenance {
  islandGroup: PhilippineIslandGroup;
  province: string;
  imagerySource: string;
  imageryPeriod: string;
  imageryDate: string;
  quarterlyMosaicId: string;
  terrainRelease: string;
  terrainEncoding: 'terrarium';
  terrainSpacingM: 30;
  imageryResolutionM: 10;
  cdnTileTemplateImagery: string;
  cdnTileTemplateDem: string;
  attribution: string;
  copernicusTerrainDocUrl: string;
  copernicusImageryDocUrl: string;
  cloudMaskCheck: CourseCloudMaskCheck;
  validation: CourseTileValidationReport;
  lastWeeklyCheckAt: string;
  nextQuarterlyRefreshAt: string;
}

export interface RouteDraft {
  id: string;
  presetId: string;
  raceId?: string;
  distanceId?: string;
  title: string;
  region: string;
  revision: number;
  processingState: DraftProcessingState;
  sourceFileName?: string;
  sourceHash?: string;
  sourceBytes?: number;
  selectedTrackIndices: number[];
  canonicalGeometry: CanonicalRouteGeometry;
  elevationProvenance: ElevationProvenance;
  validationReport: RouteValidationReport;
  markers: RouteMarker[];
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  editSummary: string;
  updatedAt: string;
  updatedBy: string;
  mapLayerProvenance?: CourseMapLayerProvenance;
}

export interface RoutePresetVersion {
  id: string;
  presetId: string;
  versionNumber: number;
  title: string;
  region: string;
  geometryHash: string;
  canonicalGeometry: CanonicalRouteGeometry;
  elevationProvenance: ElevationProvenance;
  validationReport: RouteValidationReport;
  markers: RouteMarker[];
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  reviewNotes: string;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
  mapLayerProvenance?: CourseMapLayerProvenance;
}

export interface RaceRouteBinding {
  id: string; // `${raceId}_${distanceId}`
  raceId: string;
  distanceId: string;
  distanceLabel: string;
  advertisedKm: number;
  presetId: string;
  versionId: string;
  versionNumber: number;
  currentPublicationId?: string;
  bindingRevision: number;
  checkpointLinks: Record<string, string>; // markerId -> race.checkpoints[].id
  raceNotices?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PublishedRaceRoute {
  id: string; // publicationId
  raceId: string;
  raceName: string;
  raceDate: string;
  distanceId: string;
  distanceLabel: string;
  advertisedKm: number;
  measuredDistanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  presetId: string;
  versionId: string;
  versionNumber: number;
  geometryHash: string;
  canonicalGeometry: CanonicalRouteGeometry;
  elevationProvenance: ElevationProvenance;
  markers: RouteMarker[];
  chapters: RouteChapter[];
  status: PublicationStatus;
  publishedAt: string;
  publishedBy: string;
  reviewedAt: string;
  withdrawalReason?: string;
  overrideReason?: string;
  supersedesPublicationId?: string;
  legacyOriginUrl?: string;
  mapLayerProvenance?: CourseMapLayerProvenance;
}

export interface RaceRouteCatalogEntry {
  id: string; // `${raceId}_${distanceId}`
  raceId: string;
  raceName: string;
  raceDate: string;
  region: string;
  distanceId: string;
  distanceLabel: string;
  advertisedKm: number;
  measuredDistanceM: number;
  elevationGainM: number;
  elevationStatus: ElevationStatus;
  landmarkCount: number;
  checkpointCount: number;
  currentPublicationId: string;
  versionNumber: number;
  status: PublicationStatus;
  publishedAt: string;
  mapLayerProvenance?: CourseMapLayerProvenance;
}

export interface RouteAuditEvent {
  id: string;
  action:
    | 'create_preset'
    | 'save_draft'
    | 'duplicate_preset'
    | 'archive_preset'
    | 'create_version'
    | 'bind_distance'
    | 'publish'
    | 'withdraw'
    | 'rollback'
    | 'freeze_override'
    | 'migrate_legacy'
    | 'refresh_imagery'
    | 'refresh_mosaic';
  actorUid: string;
  actorName: string;
  presetId?: string;
  draftId?: string;
  versionId?: string;
  raceId?: string;
  distanceId?: string;
  publicationId?: string;
  previousPublicationId?: string;
  reason?: string;
  at: string;
}

export interface RouteAnchorCandidate {
  chainageM: number;
  segmentIndex: number;
  pointIndex: number;
  passNumber: number;
  latitude: number;
  longitude: number;
  elevation?: number;
  offsetMeters: number;
}

export interface RouteSelectionState {
  chainageM: number;
  passNumber: number;
  segmentIndex: number;
  pointIndex: number;
  latitude: number;
  longitude: number;
  elevation?: number;
  gradePct?: number;
  markerId?: string;
}
