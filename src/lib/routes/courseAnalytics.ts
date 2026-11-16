import type { Race } from '../../types';
import type { ProcessedRoute } from './geometry';
import type { RouteMarker, RouteSurfaceType, TerrainScenarioTag } from './types';

export type ClimbCategory = 'HC' | 'Cat 1' | 'Cat 2' | 'Cat 3' | 'Cat 4' | 'Punchy';

export interface CategorizedClimb {
  id: string;
  title: string;
  category: ClimbCategory;
  score: number;
  startKm: number;
  endKm: number;
  lengthM: number;
  gainM: number;
  avgGradePct: number;
  maxGradePct: number;
  startLat: number;
  startLon: number;
  peakLat: number;
  peakLon: number;
}

export interface SurfaceBreakdownItem {
  surface: RouteSurfaceType;
  label: string;
  distanceM: number;
  pct: number;
}

export interface GradientBreakdownItem {
  bucket: 'descent' | 'flat' | 'moderate' | 'steep' | 'wall';
  label: string;
  distanceM: number;
  pct: number;
}

export interface GapSplitPrediction {
  markerId: string;
  markerName: string;
  kind: RouteMarker['kind'];
  distanceKm: number;
  legKm: number;
  legGainM: number;
  legAvgGradePct: number;
  gapPaceMinPerKm: number;
  elapsedMinutes: number;
  clockTime?: string;
  cutoffMinutes?: number;
  cutoffBufferMinutes?: number;
  cutoffStatus?: 'safe' | 'caution' | 'risk';
  recommendedPaceToBeatCutoff?: number;
}

export interface HydrationLegAdvice {
  id: string;
  fromName: string;
  toName: string;
  startKm: number;
  endKm: number;
  legKm: number;
  estimatedTempC: number;
  recommendedFluidMl: number;
  recommendedCarbsG: number;
  dryGapWarning: boolean;
}

export interface BottleneckHotspot {
  id: string;
  chainageKm: number;
  reason: string;
  severity: 'high' | 'moderate';
  advice: string;
  latitude: number;
  longitude: number;
}

export interface GearRecommendation {
  shoeCategory: string;
  lugDepthMm: string;
  polesRecommended: boolean;
  minimumWaterCarryMl: number;
  reasons: string[];
}

export interface CourseAnalyticsBundle {
  climbs: CategorizedClimb[];
  surfaceBreakdown: SurfaceBreakdownItem[];
  gradientBreakdown: GradientBreakdownItem[];
  scenarioCounts: Partial<Record<TerrainScenarioTag, number>>;
  gapSplits: GapSplitPrediction[];
  hydrationPlan: HydrationLegAdvice[];
  bottlenecks: BottleneckHotspot[];
  gear: GearRecommendation;
  estimatedFinishMinutes: number;
  averageGapPaceMinPerKm: number;
  difficultyIndex: number;
}

function classifyClimbCategory(lengthM: number, avgGradePct: number, gainM: number): ClimbCategory | null {
  const score = lengthM * Math.max(0, avgGradePct);
  if (gainM < 18 || lengthM < 180) return null;
  if (score >= 80000) return 'HC';
  if (score >= 64000) return 'Cat 1';
  if (score >= 32000) return 'Cat 2';
  if (score >= 16000) return 'Cat 3';
  if (score >= 8000 && avgGradePct >= 3) return 'Cat 4';
  if (gainM >= 25 && avgGradePct >= 4.2) return 'Punchy';
  return null;
}

export function detectCategorizedClimbs(route: ProcessedRoute): CategorizedClimb[] {
  const climbs: CategorizedClimb[] = [];

  route.canonicalSegments.forEach((seg, segIdx) => {
    if (seg.length < 4) return;
    let startIdx = -1;
    let peakIdx = -1;
    let peakEle = -Infinity;
    let valleyEle = Infinity;
    let climbGainM = 0;

    const flush = (endIdx: number) => {
      if (startIdx === -1 || peakIdx <= startIdx) return;
      const startPt = seg[startIdx];
      const peakPt = seg[peakIdx];
      const lengthM = Math.max(1, peakPt.chainageM - startPt.chainageM);
      const gainM = Math.max(0, (peakPt.elevation ?? peakPt.rawElevation ?? 0) - (startPt.elevation ?? startPt.rawElevation ?? 0));
      const avgGradePct = Number(((gainM / lengthM) * 100).toFixed(1));
      const category = classifyClimbCategory(lengthM, avgGradePct, gainM);
      if (category) {
        let maxGradePct = avgGradePct;
        for (let k = startIdx; k <= peakIdx; k += 1) {
          if (seg[k].gradePct !== undefined && seg[k].gradePct! > maxGradePct) {
            maxGradePct = seg[k].gradePct!;
          }
        }
        climbs.push({
          id: `climb_${segIdx}_${climbs.length + 1}`,
          title: `Climb ${climbs.length + 1} (${(startPt.chainageM / 1000).toFixed(1)} to ${(peakPt.chainageM / 1000).toFixed(1)} km)`,
          category,
          score: Math.round(lengthM * avgGradePct),
          startKm: Number((startPt.chainageM / 1000).toFixed(2)),
          endKm: Number((peakPt.chainageM / 1000).toFixed(2)),
          lengthM: Math.round(lengthM),
          gainM: Math.round(gainM),
          avgGradePct,
          maxGradePct: Number(maxGradePct.toFixed(1)),
          startLat: startPt.latitude,
          startLon: startPt.longitude,
          peakLat: peakPt.latitude,
          peakLon: peakPt.longitude,
        });
      }
      startIdx = endIdx;
      peakIdx = endIdx;
    };

    for (let i = 0; i < seg.length; i += 1) {
      const ele = seg[i].elevation ?? seg[i].rawElevation;
      if (ele === undefined) {
        if (startIdx !== -1) flush(i);
        startIdx = -1;
        peakIdx = -1;
        peakEle = -Infinity;
        valleyEle = Infinity;
        climbGainM = 0;
        continue;
      }
      if (startIdx === -1) {
        startIdx = i;
        peakIdx = i;
        peakEle = ele;
        valleyEle = ele;
        continue;
      }
      if (ele > peakEle) {
        peakEle = ele;
        peakIdx = i;
        climbGainM = peakEle - valleyEle;
      } else if (peakEle - ele >= 14 || (ele < valleyEle && climbGainM < 12)) {
        if (climbGainM >= 22) {
          flush(i);
        }
        startIdx = i;
        peakIdx = i;
        peakEle = ele;
        valleyEle = ele;
        climbGainM = 0;
      } else if (ele < valleyEle && peakIdx === startIdx) {
        valleyEle = ele;
        startIdx = i;
        peakIdx = i;
        peakEle = ele;
      }
    }
    if (climbGainM >= 22) flush(seg.length - 1);
  });

  return climbs.sort((a, b) => a.startKm - b.startKm);
}

export function computeSurfaceAndGradientBreakdown(route: ProcessedRoute): {
  surfaceBreakdown: SurfaceBreakdownItem[];
  gradientBreakdown: GradientBreakdownItem[];
  scenarioCounts: Partial<Record<TerrainScenarioTag, number>>;
} {
  const surfaceDist: Record<RouteSurfaceType, number> = {
    paved: 0,
    gravel: 0,
    singletrack: 0,
    technical: 0,
    boardwalk: 0,
  };
  const gradDist: Record<GradientBreakdownItem['bucket'], number> = {
    descent: 0,
    flat: 0,
    moderate: 0,
    steep: 0,
    wall: 0,
  };
  const scenarioCounts: Partial<Record<TerrainScenarioTag, number>> = {};

  for (const seg of route.canonicalSegments) {
    for (let i = 1; i < seg.length; i += 1) {
      const a = seg[i - 1];
      const b = seg[i];
      const d = Math.max(0, b.chainageM - a.chainageM);
      if (d <= 0) continue;

      const surface: RouteSurfaceType =
        b.surfaceType || (b.sourceKind === 'drawn' ? 'singletrack' : 'paved');
      surfaceDist[surface] += d;

      if (b.terrainScenario && b.terrainScenario !== 'normal') {
        scenarioCounts[b.terrainScenario] = (scenarioCounts[b.terrainScenario] || 0) + Math.round(d);
      }

      const g = b.gradePct ?? 0;
      if (g < -3) gradDist.descent += d;
      else if (g <= 3) gradDist.flat += d;
      else if (g <= 6) gradDist.moderate += d;
      else if (g <= 10) gradDist.steep += d;
      else gradDist.wall += d;
    }
  }

  const totalM = Math.max(1, route.distanceM);
  const surfaceLabels: Record<RouteSurfaceType, string> = {
    paved: 'Paved Road',
    gravel: 'Gravel / Fire Road',
    singletrack: 'Singletrack',
    technical: 'Technical Rock/Roots',
    boardwalk: 'Stairs / Boardwalk',
  };
  const surfaceBreakdown: SurfaceBreakdownItem[] = (Object.keys(surfaceLabels) as RouteSurfaceType[])
    .filter((k) => surfaceDist[k] > 0)
    .map((k) => ({
      surface: k,
      label: surfaceLabels[k],
      distanceM: Math.round(surfaceDist[k]),
      pct: Math.round((surfaceDist[k] / totalM) * 100),
    }));

  const gradLabels: Array<[GradientBreakdownItem['bucket'], string]> = [
    ['flat', 'Rolling / Flat (-3% to +3%)'],
    ['moderate', 'Steady Climb (+3% to +6%)'],
    ['steep', 'Steep Climb (+6% to +10%)'],
    ['wall', 'Pitch / Wall (> +10%)'],
    ['descent', 'Descending (< -3%)'],
  ];
  const gradientBreakdown: GradientBreakdownItem[] = gradLabels.map(([bucket, label]) => ({
    bucket,
    label,
    distanceM: Math.round(gradDist[bucket]),
    pct: Math.round((gradDist[bucket] / totalM) * 100),
  }));

  return { surfaceBreakdown, gradientBreakdown, scenarioCounts };
}

export function computePaceMultiplier(
  gradePct = 0,
  surface: RouteSurfaceType = 'paved',
  scenario: TerrainScenarioTag = 'normal',
): number {
  const g = Math.max(-25, Math.min(30, gradePct));
  // Running Grade-Adjusted Pace curve: uphills cost +3.5% per 1% grade, steep downhills brake slightly.
  const slopeFactor =
    g >= 0
      ? 1 + 0.036 * g + 0.0012 * g * g
      : g >= -8
        ? 1 + 0.014 * g
        : 0.89 + 0.015 * Math.abs(g + 8);

  const surfacePenalty: Record<RouteSurfaceType, number> = {
    paved: 1.0,
    gravel: 1.05,
    singletrack: 1.12,
    technical: 1.24,
    boardwalk: 1.18,
  };
  const scenarioPenalty: Record<TerrainScenarioTag, number> = {
    normal: 1.0,
    'steep-climb': 1.06,
    'technical-descent': 1.12,
    'river-crossing': 1.25,
    'exposed-ridge': 1.04,
    'mud-hazard': 1.22,
    stairs: 1.3,
  };

  return Number((Math.max(0.84, slopeFactor) * surfacePenalty[surface] * scenarioPenalty[scenario]).toFixed(3));
}

function addMinutesToClockTime(gunStartIso: string | undefined, minutes: number): string | undefined {
  if (!gunStartIso) return undefined;
  const baseMs = Date.parse(gunStartIso);
  if (!Number.isFinite(baseMs)) return undefined;
  const d = new Date(baseMs + Math.round(minutes * 60_000));
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function buildCourseAnalytics(
  route: ProcessedRoute,
  markers: RouteMarker[],
  options?: {
    targetFlatPaceMinPerKm?: number;
    race?: Race | null;
    ambientStartTempC?: number;
  },
): CourseAnalyticsBundle {
  const flatPace = Math.max(2.5, Math.min(18, options?.targetFlatPaceMinPerKm ?? 6.0));
  const climbs = detectCategorizedClimbs(route);
  const { surfaceBreakdown, gradientBreakdown, scenarioCounts } = computeSurfaceAndGradientBreakdown(route);

  // Precompute cumulative predicted elapsed time along canonical points
  const cumulativeTimeAtPoint: number[] = [];
  let runningMinutes = 0;
  for (const seg of route.canonicalSegments) {
    for (let i = 0; i < seg.length; i += 1) {
      if (i > 0) {
        const distKm = Math.max(0, seg[i].chainageM - seg[i - 1].chainageM) / 1000;
        const mult = computePaceMultiplier(
          seg[i].gradePct ?? 0,
          seg[i].surfaceType || 'paved',
          seg[i].terrainScenario || 'normal',
        );
        runningMinutes += distKm * flatPace * mult;
      }
      cumulativeTimeAtPoint.push(runningMinutes);
    }
  }

  const timeAtChainage = (chainageM: number): number => {
    const idx = route.points.findIndex((p) => p.chainageM >= chainageM);
    if (idx === -1) return runningMinutes;
    return cumulativeTimeAtPoint[idx] ?? runningMinutes;
  };

  const orderedMarkers = [...markers].sort(
    (a, b) => a.chainageM - b.chainageM || a.passNumber - b.passNumber,
  );
  const gunStartIso = options?.race?.gunStartTime;

  // Strava GAP Splits + Exclusive #1: Cutoff Survival & Sweeper Buffer Simulator
  let prevChainage = 0;
  let prevElapsed = 0;
  const gapSplits: GapSplitPrediction[] = orderedMarkers.map((m) => {
    const elapsed = Number(timeAtChainage(m.chainageM).toFixed(1));
    const legKm = Number(((m.chainageM - prevChainage) / 1000).toFixed(2));
    const legMinutes = Math.max(0.1, elapsed - prevElapsed);
    const legPace = legKm > 0.05 ? Number((legMinutes / legKm).toFixed(2)) : flatPace;

    let legGain = 0;
    let lastEle: number | undefined;
    for (const pt of route.points) {
      if (pt.chainageM < prevChainage || pt.chainageM > m.chainageM) continue;
      if (pt.elevation !== undefined) {
        if (lastEle !== undefined && pt.elevation > lastEle + 2) {
          legGain += pt.elevation - lastEle;
        }
        lastEle = pt.elevation;
      }
    }
    const legAvgGrade = legKm > 0.05 ? Number(((legGain / (legKm * 1000)) * 100).toFixed(1)) : 0;

    let cutoffStatus: GapSplitPrediction['cutoffStatus'];
    let bufferMin: number | undefined;
    let reqPace: number | undefined;
    if (m.cutoffMinutes !== undefined) {
      bufferMin = Number((m.cutoffMinutes - elapsed).toFixed(1));
      cutoffStatus = bufferMin >= 20 ? 'safe' : bufferMin >= 5 ? 'caution' : 'risk';
      if (m.chainageM > 100) {
        reqPace = Number((m.cutoffMinutes / (m.chainageM / 1000)).toFixed(2));
      }
    }

    prevChainage = m.chainageM;
    prevElapsed = elapsed;

    return {
      markerId: m.id,
      markerName: m.name,
      kind: m.kind,
      distanceKm: Number((m.chainageM / 1000).toFixed(2)),
      legKm,
      legGainM: Math.round(legGain),
      legAvgGradePct: legAvgGrade,
      gapPaceMinPerKm: legPace,
      elapsedMinutes: elapsed,
      clockTime: addMinutesToClockTime(gunStartIso, elapsed),
      cutoffMinutes: m.cutoffMinutes,
      ...(bufferMin !== undefined ? { cutoffBufferMinutes: bufferMin } : {}),
      ...(cutoffStatus ? { cutoffStatus } : {}),
      ...(reqPace !== undefined ? { recommendedPaceToBeatCutoff: reqPace } : {}),
    };
  });

  // Exclusive #2: Philippine Tropical Heat, Altitude & Aid-Station Hydration Planner
  const waterStops = orderedMarkers.filter(
    (m) =>
      m.kind === 'start' ||
      m.kind === 'finish' ||
      m.kind === 'water' ||
      m.kind === 'aid' ||
      m.services.some((s) => /water|electrolyte/i.test(s)),
  );
  const startTemp = options?.ambientStartTempC ?? 25;
  const hydrationPlan: HydrationLegAdvice[] = [];
  for (let i = 1; i < waterStops.length; i += 1) {
    const a = waterStops[i - 1];
    const b = waterStops[i];
    const legKm = Math.max(0.1, Number(((b.chainageM - a.chainageM) / 1000).toFixed(2)));
    const legMinutes = Math.max(1, timeAtChainage(b.chainageM) - timeAtChainage(a.chainageM));
    const midChainage = (a.chainageM + b.chainageM) / 2;
    const midPt = route.points.find((p) => p.chainageM >= midChainage) || route.points[0];
    const altitudeCooling = ((midPt?.elevation ?? 200) / 1000) * 6.5;
    const elapsedHr = timeAtChainage(midChainage) / 60;
    const morningWarmup = Math.min(7, elapsedHr * 1.4);
    const exposedPenalty = midPt?.terrainScenario === 'exposed-ridge' ? 2.5 : 0;
    const estTemp = Number((startTemp + morningWarmup - altitudeCooling + exposedPenalty).toFixed(1));
    const mlPerHr = Math.max(450, Math.min(950, 500 + Math.max(0, estTemp - 20) * 28));
    const recommendedFluidMl = Math.round((mlPerHr * legMinutes) / 60);
    const recommendedCarbsG = Math.round((55 * legMinutes) / 60);

    hydrationPlan.push({
      id: `hyd_${a.id}_${b.id}`,
      fromName: a.name,
      toName: b.name,
      startKm: Number((a.chainageM / 1000).toFixed(1)),
      endKm: Number((b.chainageM / 1000).toFixed(1)),
      legKm,
      estimatedTempC: estTemp,
      recommendedFluidMl,
      recommendedCarbsG,
      dryGapWarning: legKm > 5.0 || legMinutes > 45,
    });
  }

  // Exclusive #3: Pack Bottleneck & Single-File Congestion Detector
  const bottlenecks: BottleneckHotspot[] = [];
  let lastHotspotKm = -2;
  for (const pt of route.points) {
    const km = pt.chainageM / 1000;
    if (km - lastHotspotKm < 1.2) continue;
    const scenario = pt.terrainScenario;
    const surface = pt.surfaceType;
    const earlyCourse = km <= 4.5;
    if (
      scenario === 'stairs' ||
      scenario === 'river-crossing' ||
      scenario === 'mud-hazard' ||
      (earlyCourse && (surface === 'singletrack' || surface === 'technical' || surface === 'boardwalk')) ||
      (earlyCourse && (pt.gradePct ?? 0) > 10)
    ) {
      lastHotspotKm = km;
      const severity: 'high' | 'moderate' =
        earlyCourse || scenario === 'river-crossing' || scenario === 'stairs' ? 'high' : 'moderate';
      const reason =
        scenario === 'stairs'
          ? 'Narrow steps / bottleneck pinch'
          : scenario === 'river-crossing'
            ? 'Creek/river crossing slows single-file flow'
            : scenario === 'mud-hazard'
              ? 'Slippery mud corridor narrows fast line'
              : earlyCourse && surface === 'singletrack'
                ? 'Early race compression entering singletrack'
                : 'Steep >10% pitch slows pack momentum';
      bottlenecks.push({
        id: `bn_${bottlenecks.length + 1}`,
        chainageKm: Number(km.toFixed(2)),
        reason,
        severity,
        advice:
          severity === 'high'
            ? 'Position near target pace wave before this point or expect 45 to 90 sec queuing.'
            : 'Short passing gaps exist after the pitch crests; maintain steady cadence.',
        latitude: pt.latitude,
        longitude: pt.longitude,
      });
    }
  }

  // Exclusive #4: Objective Shoe Lug, Pole & Kit Advisor
  const techPct =
    surfaceBreakdown
      .filter((s) => s.surface === 'singletrack' || s.surface === 'technical')
      .reduce((sum, s) => sum + s.pct, 0);
  const mudMeters = (scenarioCounts['mud-hazard'] || 0) + (scenarioCounts['river-crossing'] || 0);
  const steepWallPct = gradientBreakdown.find((g) => g.bucket === 'wall')?.pct || 0;
  const estFinishMin = Math.round(runningMinutes);
  const avgGapPace = route.distanceKm > 0.1 ? Number((estFinishMin / route.distanceKm).toFixed(2)) : flatPace;
  const maxHydrationGapMl = hydrationPlan.reduce((m, h) => Math.max(m, h.recommendedFluidMl), 350);

  const reasons: string[] = [];
  let shoeCategory = 'Road Carbon / Lightweight Trainer';
  let lugDepthMm = '1.5 to 2.5 mm road rubber';
  if (mudMeters > 150 || techPct >= 35) {
    shoeCategory = 'Aggressive Trail Shoes (Sticky Wet-Rock Grip)';
    lugDepthMm = '4.5 to 6.0 mm multi-directional lugs';
    reasons.push('Technical rock/roots or mud/river crossings detected on course.');
  } else if (techPct >= 10 || (surfaceBreakdown.some((s) => s.surface === 'gravel' && s.pct >= 20))) {
    shoeCategory = 'Door-to-Trail / Hybrid Gravel Trainer';
    lugDepthMm = '3.0 to 4.0 mm hybrid lugs';
    reasons.push('Mixed paved and dirt/gravel surface transitions favor versatile outsole grip.');
  } else {
    reasons.push('Predominantly runnable road surface favors road cushioning.');
  }

  const polesRecommended =
    route.elevationGainM >= 900 || steepWallPct >= 8 || Boolean(scenarioCounts['steep-climb']);
  if (polesRecommended) {
    reasons.push('Sustained steep climbs or >900m cumulative vertical warrant collapsible trekking poles.');
  }
  const minimumWaterCarryMl = Math.max(300, Math.ceil(maxHydrationGapMl / 100) * 100);
  if (minimumWaterCarryMl >= 500) {
    reasons.push(`Carry at least ${minimumWaterCarryMl} mL between sparse aid stations.`);
  }

  const difficultyIndex = Math.min(
    100,
    Math.round(
      route.distanceKm * 1.1 +
        route.elevationGainM / 42 +
        techPct * 0.35 +
        steepWallPct * 1.4,
    ),
  );

  return {
    climbs,
    surfaceBreakdown,
    gradientBreakdown,
    scenarioCounts,
    gapSplits,
    hydrationPlan,
    bottlenecks,
    gear: {
      shoeCategory,
      lugDepthMm,
      polesRecommended,
      minimumWaterCarryMl,
      reasons,
    },
    estimatedFinishMinutes: estFinishMin,
    averageGapPaceMinPerKm: avgGapPace,
    difficultyIndex,
  };
}
