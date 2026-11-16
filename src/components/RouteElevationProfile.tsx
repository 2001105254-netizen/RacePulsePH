import { useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { GpxRoute } from '../lib/gpxRoute';
import { locateAtChainage } from '../lib/routes/anchoring';
import type { ProcessedRoute } from '../lib/routes/geometry';
import type { RouteAnchorCandidate, RouteMarker } from '../lib/routes/types';

interface RouteElevationProfileProps {
  route: GpxRoute | ProcessedRoute;
  // Legacy point-index API (used by RouteMap3D)
  selected?: number;
  onSelect?: (index: number) => void;
  // Chainage & marker sync API (used by RouteExplorerPage & RouteStudioPanel)
  selectedChainageM?: number;
  onSelectChainage?: (chainageM: number, passNumber?: number) => void;
  markers?: RouteMarker[];
  selectedMarkerId?: string;
  onSelectMarker?: (marker: RouteMarker) => void;
  activePass?: number;
  overlapCandidates?: RouteAnchorCandidate[];
  onSelectPass?: (passNumber: number) => void;
  comparisonRoute?: ProcessedRoute | null;
  comparisonLabel?: string;
}

const CHART_WIDTH = 680;
const CHART_HEIGHT = 156;
const PAD_LEFT = 42;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PLOT_W = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

export default function RouteElevationProfile({
  route,
  selected,
  onSelect,
  selectedChainageM,
  onSelectChainage,
  markers = [],
  selectedMarkerId,
  onSelectMarker,
  activePass = 1,
  overlapCandidates = [],
  onSelectPass,
  comparisonRoute,
  comparisonLabel,
}: RouteElevationProfileProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);

  const totalDistanceM = Math.max(1, route.distanceM || route.distanceKm * 1000);
  const activeChainageM =
    selectedChainageM !== undefined
      ? Math.max(0, Math.min(totalDistanceM, selectedChainageM))
      : selected !== undefined
        ? route.distancesM[Math.max(0, Math.min(route.points.length - 1, selected))] ?? 0
        : 0;

  const chartData = useMemo(() => {
    const samples = route.profileSamples;
    let minEle = Infinity;
    let maxEle = -Infinity;

    for (const s of samples) {
      if (s.elevation !== undefined) {
        minEle = Math.min(minEle, s.elevation);
        maxEle = Math.max(maxEle, s.elevation);
      }
    }
    if (comparisonRoute) {
      for (const s of comparisonRoute.profileSamples) {
        if (s.elevation !== undefined) {
          minEle = Math.min(minEle, s.elevation);
          maxEle = Math.max(maxEle, s.elevation);
        }
      }
    }

    const hasElevation = Number.isFinite(minEle) && Number.isFinite(maxEle);
    const eleRange = hasElevation ? Math.max(10, maxEle - minEle) : 1;
    const xForChainage = (m: number) =>
      PAD_LEFT + (Math.max(0, Math.min(totalDistanceM, m)) / totalDistanceM) * PLOT_W;
    const yForEle = (ele: number) =>
      PAD_TOP + PLOT_H - ((ele - minEle) / eleRange) * PLOT_H;

    const buildLinePaths = (sourceRoute: ProcessedRoute) => {
      const segPaths: string[] = [];
      let currentPath = '';
      let lastSegIdx = -1;
      for (const sample of sourceRoute.profileSamples) {
        if (sample.segmentIndex !== lastSegIdx) {
          if (currentPath) segPaths.push(currentPath);
          currentPath = '';
          lastSegIdx = sample.segmentIndex;
        }
        if (sample.elevation === undefined) {
          if (currentPath) {
            segPaths.push(currentPath);
            currentPath = '';
          }
          continue;
        }
        const cx = xForChainage(sample.chainageM).toFixed(1);
        const cy = yForEle(sample.elevation).toFixed(1);
        currentPath += currentPath ? ` L${cx},${cy}` : `M${cx},${cy}`;
      }
      if (currentPath) segPaths.push(currentPath);
      return segPaths;
    };

    const primaryPaths = hasElevation ? buildLinePaths(route) : [];
    const compPaths =
      hasElevation && comparisonRoute ? buildLinePaths(comparisonRoute) : [];

    return {
      hasElevation,
      minEle: hasElevation ? minEle : 0,
      maxEle: hasElevation ? maxEle : 0,
      xForChainage,
      yForEle,
      primaryPaths,
      compPaths,
    };
  }, [route, comparisonRoute, totalDistanceM]);

  const activePoint = useMemo(
    () => locateAtChainage(route, activeChainageM, activePass),
    [route, activeChainageM, activePass],
  );

  const emitChainage = (nextChainageM: number, pass = activePass) => {
    const clamped = Math.max(0, Math.min(totalDistanceM, nextChainageM));
    if (onSelectChainage) {
      onSelectChainage(clamped, pass);
    }
    if (onSelect) {
      let nearestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < route.distancesM.length; i += 1) {
        const diff = Math.abs(route.distancesM[i] - clamped);
        if (diff < bestDiff) {
          bestDiff = diff;
          nearestIdx = i;
        }
      }
      onSelect(nearestIdx);
    }
  };

  const handleSvgPointer = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
    const ratio = Math.max(0, Math.min(1, (svgX - PAD_LEFT) / PLOT_W));
    const targetM = ratio * totalDistanceM;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      emitChainage(targetM);
    });
  };

  const orderedMarkers = useMemo(
    () => [...markers].sort((a, b) => a.chainageM - b.chainageM),
    [markers],
  );

  const stepMarker = (direction: -1 | 1) => {
    if (orderedMarkers.length === 0) return;
    const currentIdx = selectedMarkerId
      ? orderedMarkers.findIndex((m) => m.id === selectedMarkerId)
      : orderedMarkers.findIndex((m) => m.chainageM >= activeChainageM - 5);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = direction > 0 ? 0 : orderedMarkers.length - 1;
    } else {
      nextIdx = (currentIdx + direction + orderedMarkers.length) % orderedMarkers.length;
    }
    const target = orderedMarkers[nextIdx];
    onSelectMarker?.(target);
    emitChainage(target.chainageM, target.passNumber);
  };

  const prov = route.elevationProvenance;
  const provLabel =
    prov.status === 'unavailable'
      ? 'Elevation unavailable'
      : prov.status === 'partial'
        ? `${prov.source.toUpperCase()} elevation · ${prov.coveragePct}% coverage (gaps left blank)`
        : `${prov.source.toUpperCase()} elevation · smoothed (${prov.algorithmVersion})`;

  const cursorX = chartData.xForChainage(activeChainageM);

  return (
    <section
      aria-label="Course elevation profile"
      className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
            Elevation profile
          </h2>
          <p className="text-xs text-[var(--text-secondary)]">{provLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
          {prov.status !== 'unavailable' ? (
            <>
              <span>
                Ascent{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  +{Math.round(route.elevationGainM)} m
                </strong>
              </span>
              <span>
                Descent{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  -{Math.round(route.elevationLossM)} m
                </strong>
              </span>
              {route.minElevationM !== undefined && route.maxElevationM !== undefined && (
                <span>
                  Range{' '}
                  <strong className="font-semibold text-[var(--text-primary)]">
                    {Math.round(route.minElevationM)} to {Math.round(route.maxElevationM)} m
                  </strong>
                </span>
              )}
            </>
          ) : (
            <span className="font-semibold text-[var(--text-primary)]">
              Elevation data unavailable
            </span>
          )}
        </div>
      </div>

      {overlapCandidates.length > 1 && onSelectPass && (
        <div
          role="group"
          aria-label="Select course pass at this coordinate"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-2 text-xs"
        >
          <span className="font-semibold text-[var(--text-primary)]">
            Multiple passes share this road:
          </span>
          {overlapCandidates.map((cand) => (
            <button
              key={`${cand.passNumber}_${cand.chainageM}`}
              type="button"
              onClick={() => {
                onSelectPass(cand.passNumber);
                emitChainage(cand.chainageM, cand.passNumber);
              }}
              aria-pressed={activePass === cand.passNumber}
              className={`min-h-9 rounded-lg border px-2.5 font-semibold transition ${
                activePass === cand.passNumber
                  ? 'border-red-600 bg-red-700 text-white'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600/50'
              }`}
            >
              Pass {cand.passNumber} ({(cand.chainageM / 1000).toFixed(2)} km)
            </button>
          ))}
        </div>
      )}

      {chartData.hasElevation ? (
        <div className="mt-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="block w-full touch-pan-y select-none"
            role="img"
            aria-label="Course elevation profile by cumulative distance"
            onPointerDown={(event) => handleSvgPointer(event.clientX)}
            onPointerMove={(event) => {
              if (event.buttons === 1) handleSvgPointer(event.clientX);
            }}
          >
            {/* Horizontal elevation reference lines */}
            {[0, 0.5, 1].map((frac, idx) => {
              const y = PAD_TOP + PLOT_H * (1 - frac);
              const val = Math.round(
                chartData.minEle + (chartData.maxEle - chartData.minEle) * frac,
              );
              return (
                <g key={idx}>
                  <line
                    x1={PAD_LEFT}
                    x2={CHART_WIDTH - PAD_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="var(--border-default)"
                    strokeOpacity={0.35}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="var(--text-secondary)"
                  >
                    {val}m
                  </text>
                </g>
              );
            })}

            {/* Distance ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
              const x = PAD_LEFT + PLOT_W * frac;
              const kmLabel = ((totalDistanceM * frac) / 1000).toFixed(1);
              return (
                <text
                  key={idx}
                  x={x}
                  y={CHART_HEIGHT - 6}
                  textAnchor={frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}
                  fontSize="10"
                  fill="var(--text-secondary)"
                >
                  {kmLabel} km
                </text>
              );
            })}

            {/* Optional comparison category profile */}
            {chartData.compPaths.map((d, idx) => (
              <path
                key={`comp_${idx}`}
                d={d}
                fill="none"
                stroke="#0284c7"
                strokeWidth="2"
                strokeDasharray="5 4"
                opacity="0.8"
              />
            ))}

            {/* Primary route elevation curve */}
            {chartData.primaryPaths.map((d, idx) => (
              <path
                key={`prim_${idx}`}
                d={d}
                fill="none"
                stroke="currentColor"
                className="text-red-700 dark:text-red-400"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* Checkpoint / Landmark pins along chart */}
            {orderedMarkers.map((marker) => {
              const mx = chartData.xForChainage(marker.chainageM);
              const loc = locateAtChainage(route, marker.chainageM, marker.passNumber);
              const my =
                loc.elevation !== undefined
                  ? chartData.yForEle(loc.elevation)
                  : PAD_TOP + PLOT_H / 2;
              const isSelected = marker.id === selectedMarkerId;
              return (
                <g
                  key={marker.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectMarker?.(marker);
                    emitChainage(marker.chainageM, marker.passNumber);
                  }}
                >
                  <line
                    x1={mx}
                    x2={mx}
                    y1={PAD_TOP}
                    y2={PAD_TOP + PLOT_H}
                    stroke={isSelected ? '#dc2626' : 'var(--text-secondary)'}
                    strokeOpacity={isSelected ? 0.65 : 0.25}
                    strokeDasharray={isSelected ? undefined : '2 2'}
                  />
                  <circle
                    cx={mx}
                    cy={my}
                    r={isSelected ? 5.5 : 3.5}
                    fill={isSelected ? '#dc2626' : 'var(--surface-card)'}
                    stroke="#dc2626"
                    strokeWidth="2"
                  />
                </g>
              );
            })}

            {/* Active synchronized cursor line */}
            <line
              x1={cursorX}
              x2={cursorX}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_H}
              stroke="#dc2626"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            {activePoint.elevation !== undefined && (
              <circle
                cx={cursorX}
                cy={chartData.yForEle(activePoint.elevation)}
                r={5.5}
                fill="#dc2626"
                stroke="#ffffff"
                strokeWidth="2"
              />
            )}
          </svg>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] px-4 py-5 text-center text-xs text-[var(--text-secondary)]">
          Elevation is unavailable for this file. Distance position along the map remains active.
        </div>
      )}

      {/* Keyboard range slider + checkpoint stepper + readout */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex-1 text-xs font-semibold text-[var(--text-primary)]">
          Course position
          <input
            type="range"
            min={0}
            max={Math.round(totalDistanceM)}
            step={Math.max(10, Math.round(totalDistanceM / 400))}
            value={Math.round(activeChainageM)}
            onChange={(event) => emitChainage(event.currentTarget.valueAsNumber)}
            aria-valuetext={`${(activeChainageM / 1000).toFixed(2)} km, ${
              activePoint.elevation === undefined
                ? 'elevation unavailable'
                : `${Math.round(activePoint.elevation)} meters`
            }`}
            className="mt-1 block h-11 w-full accent-red-700 dark:accent-red-400"
          />
        </label>

        {orderedMarkers.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => stepMarker(-1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-700 dark:hover:text-red-400"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev checkpoint
            </button>
            <button
              type="button"
              onClick={() => stepMarker(1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-red-600/50 hover:text-red-700 dark:hover:text-red-400"
            >
              Next checkpoint
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-2 text-xs text-[var(--text-secondary)]">
        <output className="font-mono text-[var(--text-primary)]">
          {(activeChainageM / 1000).toFixed(2)} km
          {' · '}
          {activePoint.elevation === undefined
            ? 'Elevation unavailable here'
            : `${Math.round(activePoint.elevation)} m`}
          {activePoint.gradePct !== undefined ? ` · ${activePoint.gradePct > 0 ? '+' : ''}${activePoint.gradePct}% grade` : ''}
          {activePoint.passNumber > 1 ? ` · Pass ${activePoint.passNumber}` : ''}
        </output>
        {comparisonRoute && comparisonLabel && (
          <span className="text-sky-700 dark:text-sky-300">
            Dashed line: {comparisonLabel} ({comparisonRoute.distanceKm.toFixed(2)} km)
          </span>
        )}
      </div>
    </section>
  );
}
