import type {
  CanonicalRouteGeometry,
  CanonicalSegmentInput,
  ElevationProfileSample,
  ElevationProvenance,
  GpxCanonicalPoint,
  ParsedGpxWaypoint,
  RouteJumpWarning,
  RouteMarker,
  RouteTrackSummary,
  RouteValidationReport,
} from './types';
import { samplePhilippineDemElevationM } from './philippinesMapTiles';

export const MAX_GPX_BYTES = 8 * 1024 * 1024;
export const MAX_GPX_POINTS = 100_000;
export const ELEVATION_ALGORITHM_VERSION = 'rp-elev-v1' as const;
export const MEDIAN_WINDOW_M = 60;
export const SMOOTHING_WINDOW_M = 40;
export const HYSTERESIS_THRESHOLD_M = 3;
export const GRADE_WINDOW_M = 100;
const MIN_GRADE_SPAN_M = 20;
const JUMP_WARNING_M = 250;
const DUPLICATE_EPSILON_M = 0.25;
const OVERLAP_CORRIDOR_M = 35;
const OVERLAP_MIN_CHAINAGE_SEPARATION_M = 280;

export interface ProcessedRoute {
  points: GpxCanonicalPoint[];
  segments: GpxCanonicalPoint[][];
  canonicalSegments: GpxCanonicalPoint[][];
  displaySegments: GpxCanonicalPoint[][];
  profileSamples: ElevationProfileSample[];
  distancesM: number[];
  distanceM: number;
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  minElevationM?: number;
  maxElevationM?: number;
  bounds: { north: number; south: number; east: number; west: number };
  waypoints: ParsedGpxWaypoint[];
  elevationProvenance: ElevationProvenance;
  validationReport: RouteValidationReport;
  canonicalGeometry: CanonicalRouteGeometry;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function geodesicDistanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const earthRadiusM = 6_371_000;
  const latDelta = toRadians(b.latitude - a.latitude);
  const lonDelta = toRadians(b.longitude - a.longitude);
  const startLat = toRadians(a.latitude);
  const endLat = toRadians(b.latitude);
  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
  const clamped = Math.max(0, Math.min(1, h));
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function validateCoordinatePair(latRaw: string | null | undefined, lonRaw: string | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (latRaw === null || latRaw === undefined || lonRaw === null || lonRaw === undefined) {
    return null;
  }
  const latTrimmed = latRaw.trim();
  const lonTrimmed = lonRaw.trim();
  if (!latTrimmed || !lonTrimmed) return null;
  const latitude = Number(latTrimmed);
  const longitude = Number(lonTrimmed);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function parseElevationValue(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < -450 || value > 9000) return undefined;
  return value;
}

interface RawParsedTrack {
  name: string;
  kind: 'trk' | 'rte';
  segments: Array<{
    points: Array<{ lat: number; lon: number; ele?: number }>;
  }>;
}

interface RawParsedGpx {
  tracks: RawParsedTrack[];
  waypoints: ParsedGpxWaypoint[];
  totalPointCount: number;
  rejectedPointCount: number;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function extractTagText(innerXml: string, tagLocalName: string): string | undefined {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagLocalName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagLocalName}>`, 'i');
  const match = re.exec(innerXml);
  return match ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : undefined;
}

function parseGpxWithFallbackXml(source: string): RawParsedGpx {
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const gpxMatch = /<(?:[a-zA-Z0-9_-]+:)?gpx\b[^>]*>([\s\S]*)<\/(?:[a-zA-Z0-9_-]+:)?gpx>/i.exec(withoutComments);
  if (!gpxMatch) {
    throw new Error('This GPX file could not be read. Export it again as a GPX track.');
  }
  const body = gpxMatch[1];
  const tracks: RawParsedTrack[] = [];
  const waypoints: ParsedGpxWaypoint[] = [];
  let totalPointCount = 0;
  let rejectedPointCount = 0;

  const parsePointTags = (xmlBlock: string, tagName: 'trkpt' | 'rtept') => {
    const out: Array<{ lat: number; lon: number; ele?: number }> = [];
    const pointRe = new RegExp(
      `<(?:[a-zA-Z0-9_-]+:)?${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>)`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = pointRe.exec(xmlBlock)) !== null) {
      totalPointCount += 1;
      if (totalPointCount > MAX_GPX_POINTS) {
        throw new Error(`The GPX route has at least ${totalPointCount.toLocaleString()} points, exceeding the ${MAX_GPX_POINTS.toLocaleString()} point limit. Export a smaller track.`);
      }
      const attrs = parseAttributes(m[1] || '');
      const coords = validateCoordinatePair(attrs.lat, attrs.lon);
      if (!coords) {
        rejectedPointCount += 1;
        continue;
      }
      const ele = m[2] ? parseElevationValue(extractTagText(m[2], 'ele')) : undefined;
      out.push({ lat: coords.latitude, lon: coords.longitude, ...(ele !== undefined ? { ele } : {}) });
    }
    return out;
  };

  const wptRe = /<(?:[a-zA-Z0-9_-]+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?wpt>)/gi;
  let wptMatch: RegExpExecArray | null;
  let wptIndex = 0;
  while ((wptMatch = wptRe.exec(body)) !== null) {
    const attrs = parseAttributes(wptMatch[1] || '');
    const coords = validateCoordinatePair(attrs.lat, attrs.lon);
    if (!coords) continue;
    const inner = wptMatch[2] || '';
    const ele = parseElevationValue(extractTagText(inner, 'ele'));
    const name = extractTagText(inner, 'name') || `Waypoint ${++wptIndex}`;
    const desc = extractTagText(inner, 'desc');
    waypoints.push({
      id: `wpt_${wptIndex}`,
      name,
      ...(desc ? { description: desc } : {}),
      latitude: coords.latitude,
      longitude: coords.longitude,
      ...(ele !== undefined ? { elevation: ele } : {}),
      confirmed: false,
    });
  }

  const trkRe = /<(?:[a-zA-Z0-9_-]+:)?trk\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?trk>/gi;
  let trkMatch: RegExpExecArray | null;
  let trkIdx = 0;
  while ((trkMatch = trkRe.exec(body)) !== null) {
    const trkInner = trkMatch[1];
    const name = extractTagText(trkInner, 'name') || `Track ${++trkIdx}`;
    const segRe = /<(?:[a-zA-Z0-9_-]+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?trkseg>/gi;
    const segs: Array<{ points: Array<{ lat: number; lon: number; ele?: number }> }> = [];
    let segMatch: RegExpExecArray | null;
    while ((segMatch = segRe.exec(trkInner)) !== null) {
      const pts = parsePointTags(segMatch[1], 'trkpt');
      if (pts.length >= 2) segs.push({ points: pts });
    }
    if (segs.length > 0) {
      tracks.push({ name, kind: 'trk', segments: segs });
    }
  }

  if (tracks.length === 0) {
    const rteRe = /<(?:[a-zA-Z0-9_-]+:)?rte\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?rte>/gi;
    let rteMatch: RegExpExecArray | null;
    let rteIdx = 0;
    while ((rteMatch = rteRe.exec(body)) !== null) {
      const rteInner = rteMatch[1];
      const name = extractTagText(rteInner, 'name') || `Route ${++rteIdx}`;
      const pts = parsePointTags(rteInner, 'rtept');
      if (pts.length >= 2) {
        tracks.push({ name, kind: 'rte', segments: [{ points: pts }] });
      }
    }
  }

  return { tracks, waypoints, totalPointCount, rejectedPointCount };
}

function parseGpxWithDomParser(source: string): RawParsedGpx {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError || !doc.documentElement || doc.documentElement.localName !== 'gpx') {
    throw new Error('This GPX file could not be read. Export it again as a GPX track.');
  }
  const childrenByLocalName = (parent: Element, localName: string): Element[] =>
    Array.from(parent.children).filter((child) => child.localName === localName);

  const tracks: RawParsedTrack[] = [];
  const waypoints: ParsedGpxWaypoint[] = [];
  let totalPointCount = 0;
  let rejectedPointCount = 0;

  let wptCounter = 0;
  for (const wptEl of childrenByLocalName(doc.documentElement, 'wpt')) {
    const coords = validateCoordinatePair(wptEl.getAttribute('lat'), wptEl.getAttribute('lon'));
    if (!coords) continue;
    wptCounter += 1;
    const ele = parseElevationValue(childrenByLocalName(wptEl, 'ele')[0]?.textContent);
    const name = childrenByLocalName(wptEl, 'name')[0]?.textContent?.trim() || `Waypoint ${wptCounter}`;
    const desc = childrenByLocalName(wptEl, 'desc')[0]?.textContent?.trim();
    waypoints.push({
      id: `wpt_${wptCounter}`,
      name,
      ...(desc ? { description: desc } : {}),
      latitude: coords.latitude,
      longitude: coords.longitude,
      ...(ele !== undefined ? { elevation: ele } : {}),
      confirmed: false,
    });
  }

  const readPointElement = (el: Element): { lat: number; lon: number; ele?: number } | null => {
    totalPointCount += 1;
    if (totalPointCount > MAX_GPX_POINTS) {
      throw new Error(`The GPX route has at least ${totalPointCount.toLocaleString()} points, exceeding the ${MAX_GPX_POINTS.toLocaleString()} point limit. Export a smaller track.`);
    }
    const coords = validateCoordinatePair(el.getAttribute('lat'), el.getAttribute('lon'));
    if (!coords) {
      rejectedPointCount += 1;
      return null;
    }
    const ele = parseElevationValue(childrenByLocalName(el, 'ele')[0]?.textContent);
    return { lat: coords.latitude, lon: coords.longitude, ...(ele !== undefined ? { ele } : {}) };
  };

  const trkElements = childrenByLocalName(doc.documentElement, 'trk');
  trkElements.forEach((trkEl, idx) => {
    const name = childrenByLocalName(trkEl, 'name')[0]?.textContent?.trim() || `Track ${idx + 1}`;
    const segElements = childrenByLocalName(trkEl, 'trkseg');
    const segs: Array<{ points: Array<{ lat: number; lon: number; ele?: number }> }> = [];
    for (const segEl of segElements) {
      let currentPts: Array<{ lat: number; lon: number; ele?: number }> = [];
      for (const ptEl of childrenByLocalName(segEl, 'trkpt')) {
        const parsed = readPointElement(ptEl);
        if (parsed) {
          currentPts.push(parsed);
        } else {
          if (currentPts.length >= 2) segs.push({ points: currentPts });
          currentPts = [];
        }
      }
      if (currentPts.length >= 2) segs.push({ points: currentPts });
    }
    if (segs.length > 0) {
      tracks.push({ name, kind: 'trk', segments: segs });
    }
  });

  if (tracks.length === 0) {
    const rteElements = childrenByLocalName(doc.documentElement, 'rte');
    rteElements.forEach((rteEl, idx) => {
      const name = childrenByLocalName(rteEl, 'name')[0]?.textContent?.trim() || `Route ${idx + 1}`;
      let currentPts: Array<{ lat: number; lon: number; ele?: number }> = [];
      const segs: Array<{ points: Array<{ lat: number; lon: number; ele?: number }> }> = [];
      for (const ptEl of childrenByLocalName(rteEl, 'rtept')) {
        const parsed = readPointElement(ptEl);
        if (parsed) {
          currentPts.push(parsed);
        } else {
          if (currentPts.length >= 2) segs.push({ points: currentPts });
          currentPts = [];
        }
      }
      if (currentPts.length >= 2) segs.push({ points: currentPts });
      if (segs.length > 0) {
        tracks.push({ name, kind: 'rte', segments: segs });
      }
    });
  }

  return { tracks, waypoints, totalPointCount, rejectedPointCount };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function smoothSegmentElevations(
  points: GpxCanonicalPoint[],
  medianWindowM = MEDIAN_WINDOW_M,
  smoothingWindowM = SMOOTHING_WINDOW_M,
): void {
  // Identify continuous spans where rawElevation is defined
  let spanStart = -1;
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].rawElevation !== undefined) {
      if (spanStart === -1) spanStart = i;
    } else if (spanStart !== -1) {
      spans.push([spanStart, i - 1]);
      spanStart = -1;
    }
  }
  if (spanStart !== -1) spans.push([spanStart, points.length - 1]);

  const halfMedian = medianWindowM / 2;
  const halfSmooth = smoothingWindowM / 2;

  for (const [start, end] of spans) {
    const medianed: number[] = [];
    for (let i = start; i <= end; i += 1) {
      const c = points[i].chainageM;
      const win: number[] = [];
      for (let j = i; j >= start && c - points[j].chainageM <= halfMedian; j -= 1) {
        win.push(points[j].rawElevation!);
      }
      for (let j = i + 1; j <= end && points[j].chainageM - c <= halfMedian; j += 1) {
        win.push(points[j].rawElevation!);
      }
      // On sparser GPX tracks (>30 m point spacing), ensure a 3-point local window
      // within 2x medianWindowM so isolated single-point GNSS spikes are still filtered.
      if (win.length < 3 && end - start + 1 >= 3) {
        const maxNeighborDist = medianWindowM * 2;
        if (i > start && c - points[i - 1].chainageM > halfMedian && c - points[i - 1].chainageM <= maxNeighborDist) {
          win.push(points[i - 1].rawElevation!);
        }
        if (i < end && points[i + 1].chainageM - c > halfMedian && points[i + 1].chainageM - c <= maxNeighborDist) {
          win.push(points[i + 1].rawElevation!);
        }
        if (win.length < 3 && i === start && start + 2 <= end && points[start + 2].chainageM - c <= maxNeighborDist) {
          win.push(points[start + 2].rawElevation!);
        } else if (win.length < 3 && i === end && end - 2 >= start && c - points[end - 2].chainageM <= maxNeighborDist) {
          win.push(points[end - 2].rawElevation!);
        }
      }
      medianed.push(medianOf(win));
    }

    for (let i = start; i <= end; i += 1) {
      const c = points[i].chainageM;
      let weightedSum = 0;
      let weightTotal = 0;
      for (let j = i; j >= start && c - points[j].chainageM <= halfSmooth; j -= 1) {
        const w = 1 - Math.abs(c - points[j].chainageM) / (halfSmooth + 1);
        weightedSum += medianed[j - start] * w;
        weightTotal += w;
      }
      for (let j = i + 1; j <= end && points[j].chainageM - c <= halfSmooth; j += 1) {
        const w = 1 - Math.abs(points[j].chainageM - c) / (halfSmooth + 1);
        weightedSum += medianed[j - start] * w;
        weightTotal += w;
      }
      const smoothed = weightTotal > 0 ? weightedSum / weightTotal : medianed[i - start];
      points[i].smoothedElevation = Number(smoothed.toFixed(2));
      points[i].elevation = points[i].smoothedElevation;
    }
  }
}

function computeHysteresisElevationTotals(
  segments: GpxCanonicalPoint[][],
  thresholdM = HYSTERESIS_THRESHOLD_M,
): { gainM: number; lossM: number; missingSpansCount: number } {
  let gainM = 0;
  let lossM = 0;
  let missingSpansCount = 0;

  for (const seg of segments) {
    let inMissing = false;
    let anchorEle: number | undefined;
    let trend: 'up' | 'down' | null = null;
    let extremeEle = 0;

    for (const pt of seg) {
      const ele = pt.smoothedElevation ?? pt.rawElevation;
      if (ele === undefined) {
        if (!inMissing) {
          missingSpansCount += 1;
          inMissing = true;
        }
        // Flush any open trend when hitting an elevation gap
        if (anchorEle !== undefined && trend !== null) {
          if (trend === 'up' && extremeEle > anchorEle) gainM += extremeEle - anchorEle;
          if (trend === 'down' && extremeEle < anchorEle) lossM += anchorEle - extremeEle;
        }
        anchorEle = undefined;
        trend = null;
        continue;
      }
      inMissing = false;
      if (anchorEle === undefined) {
        anchorEle = ele;
        extremeEle = ele;
        trend = null;
        continue;
      }
      if (trend === null) {
        if (ele - anchorEle >= thresholdM) {
          trend = 'up';
          extremeEle = ele;
        } else if (anchorEle - ele >= thresholdM) {
          trend = 'down';
          extremeEle = ele;
        }
      } else if (trend === 'up') {
        if (ele > extremeEle) {
          extremeEle = ele;
        } else if (extremeEle - ele >= thresholdM) {
          gainM += extremeEle - anchorEle;
          anchorEle = extremeEle;
          extremeEle = ele;
          trend = 'down';
        }
      } else {
        if (ele < extremeEle) {
          extremeEle = ele;
        } else if (ele - extremeEle >= thresholdM) {
          lossM += anchorEle - extremeEle;
          anchorEle = extremeEle;
          extremeEle = ele;
          trend = 'up';
        }
      }
    }

    if (anchorEle !== undefined && trend !== null) {
      if (trend === 'up' && extremeEle > anchorEle) gainM += extremeEle - anchorEle;
      if (trend === 'down' && extremeEle < anchorEle) lossM += anchorEle - extremeEle;
    }
  }

  return {
    gainM: Number(gainM.toFixed(1)),
    lossM: Number(lossM.toFixed(1)),
    missingSpansCount,
  };
}

function computeSegmentGrades(segments: GpxCanonicalPoint[][]): void {
  const halfWindow = GRADE_WINDOW_M / 2;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) {
      const center = seg[i];
      const centerEle = center.smoothedElevation ?? center.rawElevation;
      if (centerEle === undefined) {
        center.gradePct = undefined;
        continue;
      }
      let leftIdx = i;
      while (leftIdx > 0 && center.chainageM - seg[leftIdx - 1].chainageM <= halfWindow) {
        if ((seg[leftIdx - 1].smoothedElevation ?? seg[leftIdx - 1].rawElevation) === undefined) break;
        leftIdx -= 1;
      }
      let rightIdx = i;
      while (rightIdx < seg.length - 1 && seg[rightIdx + 1].chainageM - center.chainageM <= halfWindow) {
        if ((seg[rightIdx + 1].smoothedElevation ?? seg[rightIdx + 1].rawElevation) === undefined) break;
        rightIdx += 1;
      }
      // Fallback for sparser tracks (>50m point spacing): step to immediate valid neighbors.
      if (seg[rightIdx].chainageM - seg[leftIdx].chainageM < MIN_GRADE_SPAN_M) {
        if (leftIdx === i && i > 0 && (seg[i - 1].smoothedElevation ?? seg[i - 1].rawElevation) !== undefined) {
          leftIdx = i - 1;
        }
        if (rightIdx === i && i < seg.length - 1 && (seg[i + 1].smoothedElevation ?? seg[i + 1].rawElevation) !== undefined) {
          rightIdx = i + 1;
        }
      }
      const horizSpan = seg[rightIdx].chainageM - seg[leftIdx].chainageM;
      const leftEle = seg[leftIdx].smoothedElevation ?? seg[leftIdx].rawElevation;
      const rightEle = seg[rightIdx].smoothedElevation ?? seg[rightIdx].rawElevation;
      if (horizSpan >= MIN_GRADE_SPAN_M && leftEle !== undefined && rightEle !== undefined) {
        const rawGrade = ((rightEle - leftEle) / horizSpan) * 100;
        center.gradePct = Number(Math.max(-65, Math.min(65, rawGrade)).toFixed(1));
      } else {
        center.gradePct = undefined;
      }
    }
  }
}

function perpendicularDistanceM(
  point: GpxCanonicalPoint,
  lineStart: GpxCanonicalPoint,
  lineEnd: GpxCanonicalPoint,
): number {
  const totalLen = geodesicDistanceM(lineStart, lineEnd);
  if (totalLen < 0.5) return geodesicDistanceM(point, lineStart);
  const cosLat = Math.cos(toRadians(lineStart.latitude));
  const x = (point.longitude - lineStart.longitude) * 111_320 * cosLat;
  const y = (point.latitude - lineStart.latitude) * 110_540;
  const dx = (lineEnd.longitude - lineStart.longitude) * 111_320 * cosLat;
  const dy = (lineEnd.latitude - lineStart.latitude) * 110_540;
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  const projX = dx * t;
  const projY = dy * t;
  return Math.hypot(x - projX, y - projY);
}

function simplifySegmentForDisplay(segment: GpxCanonicalPoint[], toleranceM = 4): GpxCanonicalPoint[] {
  if (segment.length <= 24) return segment;
  const keep = new Uint8Array(segment.length);
  keep[0] = 1;
  keep[segment.length - 1] = 1;

  // Preserve local elevation extrema so map/profile peaks match
  for (let i = 1; i < segment.length - 1; i += 1) {
    const prev = segment[i - 1].elevation;
    const curr = segment[i].elevation;
    const next = segment[i + 1].elevation;
    if (curr !== undefined && prev !== undefined && next !== undefined) {
      if ((curr > prev && curr >= next) || (curr < prev && curr <= next)) {
        keep[i] = 1;
      }
    } else if ((curr === undefined) !== (prev === undefined)) {
      keep[i] = 1;
    }
  }

  const stack: Array<[number, number]> = [[0, segment.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i += 1) {
      const d = perpendicularDistanceM(segment[i], segment[start], segment[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM && maxIdx > start && maxIdx < end) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  return segment.filter((_, idx) => keep[idx] === 1);
}

function buildProfileSamples(
  canonicalSegments: GpxCanonicalPoint[][],
  totalDistanceM: number,
): ElevationProfileSample[] {
  const stepM = Math.max(20, Math.ceil(totalDistanceM / 1100));
  const samples: ElevationProfileSample[] = [];
  for (const seg of canonicalSegments) {
    if (seg.length === 0) continue;
    let lastSampledChainage = -Infinity;
    for (let i = 0; i < seg.length; i += 1) {
      const pt = seg[i];
      const isEdge = i === 0 || i === seg.length - 1;
      const isGapEdge =
        i > 0 && ((pt.elevation === undefined) !== (seg[i - 1].elevation === undefined));
      if (isEdge || isGapEdge || pt.chainageM - lastSampledChainage >= stepM) {
        samples.push({
          chainageM: pt.chainageM,
          segmentIndex: pt.segmentIndex,
          pointIndex: pt.pointIndex,
          latitude: pt.latitude,
          longitude: pt.longitude,
          ...(pt.elevation !== undefined ? { elevation: pt.elevation } : {}),
          ...(pt.rawElevation !== undefined ? { rawElevation: pt.rawElevation } : {}),
          ...(pt.gradePct !== undefined ? { gradePct: pt.gradePct } : {}),
          sourceKind: pt.sourceKind,
          ...(pt.surfaceType ? { surfaceType: pt.surfaceType } : {}),
          ...(pt.terrainScenario ? { terrainScenario: pt.terrainScenario } : {}),
        });
        lastSampledChainage = pt.chainageM;
      }
    }
  }
  return samples;
}

export function processCanonicalGeometry(
  geometry: CanonicalRouteGeometry,
  options?: {
    bytes?: number;
    waypoints?: ParsedGpxWaypoint[];
    trackSummaries?: RouteTrackSummary[];
    selectedTrackIndices?: number[];
    extraWarnings?: string[];
    elevationSource?: ElevationProvenance['source'];
    verticalDatum?: ElevationProvenance['verticalDatum'];
  },
): ProcessedRoute {
  const canonicalSegments: GpxCanonicalPoint[][] = [];
  const allPoints: GpxCanonicalPoint[] = [];
  const distancesM: number[] = [];
  const jumpWarnings: RouteJumpWarning[] = [];

  let cumulativeDistanceM = 0;
  let duplicatePointsCount = 0;
  let antimeridianWarning = false;
  let hasDrawnSections = false;
  let hasNonDrawnSections = false;
  let autoDemSampled = false;

  geometry.segments.forEach((segInput, segIdx) => {
    if (!segInput || segInput.points.length < 2) return;
    if (segInput.sourceKind === 'drawn') hasDrawnSections = true;
    else hasNonDrawnSections = true;

    const segPoints: GpxCanonicalPoint[] = [];
    for (let ptIdx = 0; ptIdx < segInput.points.length; ptIdx += 1) {
      const rawPt = segInput.points[ptIdx];
      if (!Number.isFinite(rawPt.lat) || !Number.isFinite(rawPt.lon)) continue;
      if (ptIdx > 0) {
        const prev = segPoints[segPoints.length - 1];
        if (Math.abs(rawPt.lon - prev.longitude) > 180) {
          antimeridianWarning = true;
        }
        const deltaM = geodesicDistanceM(prev, { latitude: rawPt.lat, longitude: rawPt.lon });
        if (deltaM < DUPLICATE_EPSILON_M) {
          duplicatePointsCount += 1;
        }
        if (deltaM > JUMP_WARNING_M && segInput.sourceKind !== 'drawn') {
          jumpWarnings.push({
            segmentIndex: segIdx,
            pointIndex: segPoints.length,
            distanceM: Number(deltaM.toFixed(1)),
            chainageM: Number((cumulativeDistanceM + deltaM).toFixed(1)),
          });
        }
        cumulativeDistanceM += deltaM;
      }

      let rawElevation =
        rawPt.rawEle !== undefined && Number.isFinite(rawPt.rawEle)
          ? rawPt.rawEle
          : rawPt.ele !== undefined && Number.isFinite(rawPt.ele)
            ? rawPt.ele
            : undefined;
      if (segInput.sourceKind === 'drawn' && rawElevation === undefined && !geometry.isCanvasCleared) {
        rawElevation = Number(
          samplePhilippineDemElevationM(rawPt.lat, rawPt.lon, { assumeInsideLand: true }).toFixed(1),
        );
        autoDemSampled = true;
      }

      const canonicalPoint: GpxCanonicalPoint = {
        latitude: rawPt.lat,
        longitude: rawPt.lon,
        ...(rawElevation !== undefined ? { rawElevation, elevation: rawElevation } : {}),
        chainageM: Number(cumulativeDistanceM.toFixed(2)),
        segmentIndex: canonicalSegments.length,
        pointIndex: segPoints.length,
        sourceKind: segInput.sourceKind,
        surfaceType: rawPt.surfaceType || segInput.surfaceType,
        terrainScenario: rawPt.terrainScenario || segInput.terrainScenario,
        ...(rawPt.accuracyM !== undefined ? { gpsAccuracyM: rawPt.accuracyM } : {}),
      };
      segPoints.push(canonicalPoint);
      allPoints.push(canonicalPoint);
      distancesM.push(canonicalPoint.chainageM);
    }

    if (segPoints.length >= 2) {
      smoothSegmentElevations(segPoints);
      canonicalSegments.push(segPoints);
    }
  });

  if (allPoints.length < 2) {
    throw new Error('The route needs at least two valid connected points.');
  }

  computeSegmentGrades(canonicalSegments);
  const { gainM, lossM, missingSpansCount } = computeHysteresisElevationTotals(canonicalSegments);

  let validPoints = 0;
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;
  const bounds = { north: -Infinity, south: Infinity, east: -Infinity, west: Infinity };

  for (const pt of allPoints) {
    bounds.north = Math.max(bounds.north, pt.latitude);
    bounds.south = Math.min(bounds.south, pt.latitude);
    bounds.east = Math.max(bounds.east, pt.longitude);
    bounds.west = Math.min(bounds.west, pt.longitude);
    if (pt.elevation !== undefined) {
      validPoints += 1;
      minElevationM = Math.min(minElevationM, pt.elevation);
      maxElevationM = Math.max(maxElevationM, pt.elevation);
    }
  }

  const coverageRatio = allPoints.length > 0 ? validPoints / allPoints.length : 0;
  const coveragePct = Math.round(coverageRatio * 100);
  const status: ElevationProvenance['status'] =
    validPoints === 0 ? 'unavailable' : validPoints === allPoints.length ? 'complete' : 'partial';

  const elevationProvenance: ElevationProvenance = {
    source:
      validPoints === 0
        ? 'unavailable'
        : options?.elevationSource ||
          (hasDrawnSections && !hasNonDrawnSections
            ? 'dem'
            : hasDrawnSections || autoDemSampled
              ? 'mixed'
              : 'gpx'),
    status,
    coverageRatio: Number(coverageRatio.toFixed(4)),
    coveragePct,
    validPoints,
    totalPoints: allPoints.length,
    missingSpansCount,
    verticalDatum: options?.verticalDatum || 'unknown',
    algorithmVersion: ELEVATION_ALGORITHM_VERSION,
    medianWindowM: MEDIAN_WINDOW_M,
    smoothingWindowM: SMOOTHING_WINDOW_M,
    hysteresisThresholdM: HYSTERESIS_THRESHOLD_M,
    gradeWindowM: GRADE_WINDOW_M,
    calculatedAt: new Date().toISOString(),
  };

  // Loop & overlap detection (bounded stride for very dense tracks)
  const stride = Math.max(1, Math.floor(allPoints.length / 600));
  const sampled = allPoints.filter((_, idx) => idx % stride === 0 || idx === allPoints.length - 1);
  const startEndDist = geodesicDistanceM(allPoints[0], allPoints[allPoints.length - 1]);
  const hasLoops = cumulativeDistanceM > 300 && startEndDist <= 150;
  let hasOverlapPasses = false;
  for (let i = 0; i < sampled.length && !hasOverlapPasses; i += 1) {
    for (let j = i + 1; j < sampled.length; j += 1) {
      if (sampled[j].chainageM - sampled[i].chainageM < OVERLAP_MIN_CHAINAGE_SEPARATION_M) continue;
      if (geodesicDistanceM(sampled[i], sampled[j]) <= OVERLAP_CORRIDOR_M) {
        hasOverlapPasses = true;
        break;
      }
    }
  }

  const isCleared = Boolean(geometry.sourceKind === 'drawn' && geometry.isCanvasCleared);
  const warnings: string[] = [...(options?.extraWarnings || [])];
  if (isCleared) {
    warnings.push('Canvas cleared. Use Paint Trail, Draw Points, GPS Survey, or Import GPX to author your route.');
  }
  if (!isCleared && canonicalSegments.length > 1) {
    warnings.push(
      `Course contains ${canonicalSegments.length} separate segments. Disconnected gaps are preserved without straight-line bridging.`,
    );
  }
  if (!isCleared && duplicatePointsCount > 0) {
    warnings.push(`${duplicatePointsCount} consecutive repeated coordinates detected.`);
  }
  if (!isCleared && jumpWarnings.length > 0) {
    warnings.push(
      `${jumpWarnings.length} coordinate jump(s) over ${JUMP_WARNING_M} m detected. Inspect segment continuity before publishing.`,
    );
  }
  if (antimeridianWarning) {
    warnings.push('Course crosses the 180-degree antimeridian. Verify map bounds carefully.');
  }
  if (!isCleared && status === 'unavailable') {
    warnings.push('Elevation data is unavailable for this route.');
  } else if (!isCleared && status === 'partial') {
    warnings.push(
      `Partial elevation coverage (${coveragePct}%). Totals reflect recorded spans only; missing sections remain blank.`,
    );
  }
  if (!isCleared && hasOverlapPasses) {
    warnings.push('Course contains overlapping out-and-back or multi-lap sections. Verify pass order on checkpoints.');
  }
  if (!isCleared && hasDrawnSections && status !== 'complete') {
    warnings.push('Manually drawn sections have no automatic GPS elevation unless estimated or supplied.');
  }

  const displaySegments = isCleared ? [] : canonicalSegments.map((seg) => simplifySegmentForDisplay(seg));
  const profileSamples = isCleared ? [] : buildProfileSamples(canonicalSegments, cumulativeDistanceM);
  const trackSummaries =
    options?.trackSummaries ||
    canonicalSegments.map((seg, idx) => ({
      index: idx,
      name: geometry.segments[idx]?.name || `Segment ${idx + 1}`,
      kind: 'trk' as const,
      segmentCount: 1,
      pointCount: seg.length,
      distanceM: seg[seg.length - 1].chainageM - seg[0].chainageM,
    }));

  const validationReport: RouteValidationReport = {
    valid: !isCleared,
    bytes: options?.bytes ?? 0,
    pointCount: isCleared ? 0 : allPoints.length,
    segmentCount: isCleared ? 0 : canonicalSegments.length,
    trackNames: isCleared ? [] : trackSummaries.map((t) => t.name),
    tracks: isCleared ? [] : trackSummaries,
    selectedTrackIndices: options?.selectedTrackIndices || trackSummaries.map((t) => t.index),
    duplicatePointsCount: isCleared ? 0 : duplicatePointsCount,
    jumpWarnings: isCleared ? [] : jumpWarnings,
    hasLoops: isCleared ? false : hasLoops,
    hasOverlapPasses: isCleared ? false : hasOverlapPasses,
    antimeridianWarning,
    hasMissingElevation: isCleared ? true : status !== 'complete',
    hasDrawnSections: !isCleared && hasDrawnSections,
    warnings,
    errors: isCleared ? ['Course canvas is cleared and requires at least one trail section before publishing.'] : [],
  };

  const normalizedCanonical: CanonicalRouteGeometry = {
    version: 1,
    sourceKind: geometry.sourceKind,
    ...(isCleared ? { isCanvasCleared: true } : {}),
    ...(geometry.isStartPointRemoved ? { isStartPointRemoved: true } : {}),
    segments: canonicalSegments.map((seg, idx) => ({
      id: geometry.segments[idx]?.id || `seg_${idx + 1}`,
      name: geometry.segments[idx]?.name,
      sourceKind: geometry.segments[idx]?.sourceKind || 'gpx',
      ...(geometry.segments[idx]?.surfaceType ? { surfaceType: geometry.segments[idx]?.surfaceType } : {}),
      ...(geometry.segments[idx]?.terrainScenario ? { terrainScenario: geometry.segments[idx]?.terrainScenario } : {}),
      points: seg.map((pt) => ({
        lat: pt.latitude,
        lon: pt.longitude,
        ...(pt.smoothedElevation !== undefined ? { ele: pt.smoothedElevation } : {}),
        ...(pt.rawElevation !== undefined ? { rawEle: pt.rawElevation } : {}),
        ...(pt.surfaceType ? { surfaceType: pt.surfaceType } : {}),
        ...(pt.terrainScenario ? { terrainScenario: pt.terrainScenario } : {}),
        ...(pt.gpsAccuracyM !== undefined ? { accuracyM: pt.gpsAccuracyM } : {}),
      })),
    })),
  };

  return {
    points: allPoints,
    segments: isCleared ? [] : canonicalSegments,
    canonicalSegments: isCleared ? [] : canonicalSegments,
    displaySegments,
    profileSamples,
    distancesM: isCleared ? [] : distancesM,
    distanceM: isCleared ? 0 : Number(cumulativeDistanceM.toFixed(1)),
    distanceKm: isCleared ? 0 : Number((cumulativeDistanceM / 1000).toFixed(3)),
    elevationGainM: isCleared || status === 'unavailable' ? 0 : gainM,
    elevationLossM: isCleared || status === 'unavailable' ? 0 : lossM,
    ...( !isCleared && Number.isFinite(minElevationM) ? { minElevationM: Number(minElevationM.toFixed(1)) } : {}),
    ...( !isCleared && Number.isFinite(maxElevationM) ? { maxElevationM: Number(maxElevationM.toFixed(1)) } : {}),
    bounds,
    waypoints: options?.waypoints || [],
    elevationProvenance,
    validationReport,
    canonicalGeometry: normalizedCanonical,
  };
}

export function parseGpxCourse(
  source: string,
  options?: { selectedTrackIndices?: number[] },
): ProcessedRoute {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_GPX_BYTES) {
    throw new Error('The GPX route file exceeds the 8 MB limit.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error('GPX document declarations are unsupported.');
  }
  if (!source.trim()) {
    throw new Error('The GPX file is empty.');
  }

  const parsed =
    typeof DOMParser !== 'undefined'
      ? parseGpxWithDomParser(source)
      : parseGpxWithFallbackXml(source);

  if (parsed.tracks.length === 0) {
    throw new Error('The GPX file needs at least two connected route points.');
  }

  const trackSummaries: RouteTrackSummary[] = parsed.tracks.map((trk, index) => {
    let ptCount = 0;
    let distM = 0;
    for (const seg of trk.segments) {
      ptCount += seg.points.length;
      for (let i = 1; i < seg.points.length; i += 1) {
        distM += geodesicDistanceM(
          { latitude: seg.points[i - 1].lat, longitude: seg.points[i - 1].lon },
          { latitude: seg.points[i].lat, longitude: seg.points[i].lon },
        );
      }
    }
    return {
      index,
      name: trk.name,
      kind: trk.kind,
      segmentCount: trk.segments.length,
      pointCount: ptCount,
      distanceM: Number(distM.toFixed(1)),
    };
  });

  const selectedIndices =
    options?.selectedTrackIndices && options.selectedTrackIndices.length > 0
      ? options.selectedTrackIndices.filter((idx) => idx >= 0 && idx < parsed.tracks.length)
      : parsed.tracks.map((_, idx) => idx);

  const chosenIndices = selectedIndices.length > 0 ? selectedIndices : [0];
  const segments: CanonicalSegmentInput[] = [];
  chosenIndices.forEach((trkIdx) => {
    const trk = parsed.tracks[trkIdx];
    trk.segments.forEach((seg, segIdx) => {
      segments.push({
        id: `trk_${trkIdx}_seg_${segIdx + 1}`,
        name: trk.segments.length > 1 ? `${trk.name} (Segment ${segIdx + 1})` : trk.name,
        sourceKind: 'gpx',
        points: seg.points.map((pt) => ({
          lat: pt.lat,
          lon: pt.lon,
          ...(pt.ele !== undefined ? { ele: pt.ele, rawEle: pt.ele } : {}),
        })),
      });
    });
  });

  const extraWarnings: string[] = [];
  if (parsed.rejectedPointCount > 0) {
    extraWarnings.push(
      `${parsed.rejectedPointCount} invalid coordinate point(s) were rejected and excluded from segments.`,
    );
  }
  if (parsed.tracks.length > 1 && chosenIndices.length === parsed.tracks.length) {
    extraWarnings.push(
      `File contains ${parsed.tracks.length} tracks/routes. Confirm the intended track selection before publishing.`,
    );
  }

  return processCanonicalGeometry(
    { version: 1, sourceKind: 'gpx', segments },
    {
      bytes,
      waypoints: parsed.waypoints,
      trackSummaries,
      selectedTrackIndices: chosenIndices,
      extraWarnings,
      elevationSource: 'gpx',
    },
  );
}

export function reverseCanonicalGeometry(geometry: CanonicalRouteGeometry): CanonicalRouteGeometry {
  return {
    version: 1,
    sourceKind: geometry.sourceKind,
    ...(geometry.isCanvasCleared ? { isCanvasCleared: true } : {}),
    ...(geometry.isStartPointRemoved ? { isStartPointRemoved: true } : {}),
    segments: [...geometry.segments].reverse().map((seg, idx) => ({
      ...seg,
      id: seg.id || `seg_${idx + 1}`,
      points: [...seg.points].reverse(),
    })),
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportSanitizedGpx(
  geometry: CanonicalRouteGeometry,
  options: {
    title: string;
    markers?: RouteMarker[];
  },
): string {
  const safeTitle = escapeXml(options.title.trim() || 'RacePulsePH Course');
  const publicMarkers = (options.markers || []).filter((m) => m.visibility === 'public');
  const wptXml = publicMarkers
    .map((m) => {
      const descParts = [m.description, m.instruction, m.services.length ? `Services: ${m.services.join(', ')}` : '']
        .filter(Boolean)
        .join(' | ');
      return [
        `  <wpt lat="${m.latitude.toFixed(6)}" lon="${m.longitude.toFixed(6)}">`,
        `    <name>${escapeXml(m.name)}</name>`,
        ...(descParts ? [`    <desc>${escapeXml(descParts)}</desc>`] : []),
        `    <type>${escapeXml(m.kind)}</type>`,
        `  </wpt>`,
      ].join('\n');
    })
    .join('\n');

  const segXml = geometry.segments
    .filter((seg) => seg.points.length >= 2)
    .map((seg) => {
      const pts = seg.points
        .map((pt) => {
          const eleVal = pt.ele ?? pt.rawEle;
          return eleVal !== undefined
            ? `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}"><ele>${eleVal.toFixed(1)}</ele></trkpt>`
            : `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}" />`;
        })
        .join('\n');
      return `    <trkseg>\n${pts}\n    </trkseg>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RacePulsePH Sanitized Course Export" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${safeTitle}</name>`,
    '  </metadata>',
    ...(wptXml ? [wptXml] : []),
    '  <trk>',
    `    <name>${safeTitle}</name>`,
    segXml,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
