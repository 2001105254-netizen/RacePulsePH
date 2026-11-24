import React, { Suspense, lazy } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Flag,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import type { ProcessedRoute } from '../../lib/routes/geometry';
import type {
  CourseMapLayerProvenance,
  RouteMarker,
  RouteSelectionState,
} from '../../lib/routes/types';
import type { RunnerLocationProjection } from '../../lib/routes/useRunnerGeolocation';
import {
  formatDuration,
  formatPace,
  formatShortDistance,
  PRIVACY_OPTIONS,
  type SummaryComputation,
} from '../../lib/runs/runLiveHelpers';
import type { ActiveRunSession, RecordedRunPrivacy, RunSplitKm } from '../../lib/runs/types';
import DialogSurface from '../ui/DialogSurface';

const RouteMapCanvas = lazy(() => import('../routes/RouteMapCanvas'));

export interface RecordLiveViewProps {
  session: ActiveRunSession;
  theme: 'light' | 'dark';
  mapRoute: ProcessedRoute;
  routeIdentityKey: string;
  markers: RouteMarker[];
  selection: RouteSelectionState;
  provenance?: CourseMapLayerProvenance;
  courseScopeId?: string;
  liveGpsPosition: {
    lat: number;
    lon: number;
    accuracyM: number;
    headingDeg?: number | null;
    isStale?: boolean;
  } | null;
  liveBreadcrumbPoints: Array<{ lat: number; lon: number }>;
  liveCorridor: RunnerLocationProjection | null;
  liveTrackingError: string | null;
  liveElapsedMs: number;
  liveAvgPaceSecPerKm: number | null;
  liveCurrentPaceSecPerKm: number | null;
  liveSplits: RunSplitKm[];
  splitsOpen: boolean;
  onToggleSplits: () => void;
  flyToTrigger: { lat: number; lon: number; zoom?: number; nonce: number } | null;
  onMapFirstCameraReady: () => void;
  onLocateMe: () => void;
  onCenterOnUser: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onFinishRun: () => void;
  onDiscardRun: () => void;
}

export function RecordLiveView({
  session,
  theme,
  mapRoute,
  routeIdentityKey,
  markers,
  selection,
  provenance,
  courseScopeId,
  liveGpsPosition,
  liveBreadcrumbPoints,
  liveCorridor,
  liveTrackingError,
  liveElapsedMs,
  liveAvgPaceSecPerKm,
  liveCurrentPaceSecPerKm,
  liveSplits,
  splitsOpen,
  onToggleSplits,
  flyToTrigger,
  onMapFirstCameraReady,
  onLocateMe,
  onCenterOnUser,
  onPauseRun,
  onResumeRun,
  onFinishRun,
  onDiscardRun,
}: RecordLiveViewProps) {
  const isPaused = session.status === 'paused';
  const activeRunTitle =
    session.mode === 'course' && session.courseRef
      ? `${session.courseRef.raceName} (${session.courseRef.distanceLabel})`
      : 'Free Run';
  const liveLocateStatus = isPaused
    ? 'idle'
    : liveTrackingError
      ? 'error'
      : liveGpsPosition
        ? 'active'
        : 'locating';

  return (
    <div className="w-full max-w-6xl mx-auto py-1 pb-[max(1rem,var(--rp-safe-bottom))] space-y-3">
      {/* Compact Active Run Status Header */}
      <section
        aria-label="Active run status"
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
      >
        <div className="min-w-0 flex items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0 ${
              isPaused
                ? 'border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-300'
                : 'border-red-600/40 bg-red-600/15 text-red-800 dark:text-red-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isPaused ? 'bg-amber-600 dark:bg-amber-400' : 'bg-red-600 dark:bg-red-400'
              }`}
              aria-hidden="true"
            />
            <span>{isPaused ? 'Paused' : 'Recording'}</span>
          </span>
          <h2 className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
            {activeRunTitle}
          </h2>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
          {liveGpsPosition ? (
            <span>
              GPS ±{liveGpsPosition.accuracyM} m{liveGpsPosition.isStale ? ' (Stale)' : ''}
            </span>
          ) : (
            <span>{isPaused ? 'GPS paused' : 'Acquiring GPS...'}</span>
          )}
        </div>
      </section>

      {liveTrackingError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{liveTrackingError}</span>
        </div>
      )}

      {session.mode === 'course' && liveCorridor && (
        <section
          aria-label="Course corridor tracking"
          className={`rounded-xl border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
            liveCorridor.onCourse
              ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
              : 'border-amber-600/40 bg-amber-500/10 text-amber-950 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {liveCorridor.onCourse
                ? 'On Course'
                : `Off Course (+${Math.round(liveCorridor.offRouteMeters)} m)`}
            </span>
            <span className="font-mono tabular-nums">
              {liveCorridor.progressPct.toFixed(1)}% (
              {formatShortDistance(liveCorridor.distanceRemainingM)} left)
            </span>
          </div>
          {liveCorridor.nextMarker && (
            <span className="font-mono tabular-nums">
              Next: {liveCorridor.nextMarker.name} (
              {formatShortDistance(liveCorridor.nextMarkerDistanceAlongM)})
            </span>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Map Canvas */}
        <div className="lg:col-span-7 min-w-0">
          <Suspense
            fallback={
              <div
                role="status"
                aria-label="Loading live map"
                className="h-[320px] sm:h-[420px] lg:h-[480px] w-full rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)]"
              >
                Loading Philippine route map...
              </div>
            }
          >
            <RouteMapCanvas
              route={mapRoute}
              routeIdentityKey={routeIdentityKey}
              markers={markers}
              selection={selection}
              theme={theme}
              heightClassName="h-[320px] sm:h-[420px] lg:h-[480px]"
              editable={false}
              cursorVisible={false}
              hideHud={session.mode === 'free'}
              hideBuiltInLayerToggles={false}
              provenance={provenance}
              courseScopeId={courseScopeId}
              gpsLivePosition={liveGpsPosition}
              gpsBreadcrumbPoints={liveBreadcrumbPoints}
              locateStatus={liveLocateStatus}
              flyToTrigger={flyToTrigger}
              onCameraMove={onMapFirstCameraReady}
              onLocateMe={onLocateMe}
              onCenterOnUser={onCenterOnUser}
            />
          </Suspense>
        </div>

        {/* Live Telemetry, Splits & Thumb-Zone Controls */}
        <div className="lg:col-span-5 min-w-0 space-y-3">
          <section
            aria-label="Live run telemetry"
            className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
          >
            <dl className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)]">
              <div className="p-3 space-y-0.5">
                <dt className="text-xs font-normal text-[var(--text-secondary)]">Distance</dt>
                <dd className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {(session.distanceM / 1000).toFixed(2)}{' '}
                  <span className="text-xs font-normal text-[var(--text-secondary)]">km</span>
                </dd>
              </div>
              <div className="p-3 space-y-0.5">
                <dt className="text-xs font-normal text-[var(--text-secondary)]">Elapsed Time</dt>
                <dd className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatDuration(liveElapsedMs)}
                </dd>
                <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  Moving {formatDuration(session.movingTimeMs)}
                </dd>
              </div>
              <div className="p-3 space-y-0.5">
                <dt className="text-xs font-normal text-[var(--text-secondary)]">Avg Pace</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatPace(liveAvgPaceSecPerKm)}
                </dd>
                <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  Current {formatPace(liveCurrentPaceSecPerKm)}
                </dd>
              </div>
              <div className="p-3 space-y-0.5">
                <dt className="text-xs font-normal text-[var(--text-secondary)]">
                  Elev Gain &amp; Calories
                </dt>
                <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
                  +{Math.round(session.elevationGainM)} m
                </dd>
                <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  {session.totalKcal.toFixed(1)} kcal
                </dd>
              </div>
            </dl>

            {/* Collapsible Splits Drawer */}
            <div className="border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onToggleSplits}
                aria-expanded={splitsOpen}
                className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <span className="font-mono tabular-nums">
                  Kilometer Splits ({liveSplits.length})
                </span>
                {splitsOpen ? (
                  <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
              </button>

              {splitsOpen && (
                <div className="border-t border-[var(--border-subtle)] max-h-48 overflow-y-auto px-3 py-2">
                  {liveSplits.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] py-1">
                      Per-kilometer splits appear after recording 50 meters of movement.
                    </p>
                  ) : (
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                        <tr>
                          <th scope="col" className="py-1 pr-2 font-semibold">
                            KM
                          </th>
                          <th scope="col" className="py-1 pr-2 font-semibold">
                            Pace
                          </th>
                          <th scope="col" className="py-1 pr-2 font-semibold">
                            Elev
                          </th>
                          <th scope="col" className="py-1 font-semibold text-right">
                            kcal
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                        {liveSplits.map((split) => (
                          <tr key={split.kmIndex}>
                            <td className="py-1.5 pr-2">
                              {split.kmIndex}
                              {split.distanceM < 990 ? ` (${Math.round(split.distanceM)}m)` : ''}
                            </td>
                            <td className="py-1.5 pr-2">{formatPace(split.paceSecPerKm)}</td>
                            <td className="py-1.5 pr-2">+{Math.round(split.elevationGainM)}m</td>
                            <td className="py-1.5 text-right">{split.caloriesKcal.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Thumb-Zone Controls */}
          <div className="grid grid-cols-2 gap-2.5">
            {isPaused ? (
              <button
                type="button"
                onClick={onResumeRun}
                className="min-h-12 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPauseRun}
                className="min-h-12 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
              >
                <Pause className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Pause</span>
              </button>
            )}

            <button
              type="button"
              onClick={onFinishRun}
              className={`min-h-12 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                isPaused
                  ? 'border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                  : 'bg-red-700 hover:bg-red-600 text-white'
              }`}
            >
              <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Finish Run</span>
            </button>

            <button
              type="button"
              onClick={onDiscardRun}
              className="col-span-2 min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Discard Run</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface RecordSummaryViewProps {
  baseId: string;
  summaryData: SummaryComputation;
  summaryTitleId: string;
  summaryTitleErrorId: string;
  summaryTitle: string;
  summaryTitleError: string | null;
  summaryPrivacy: RecordedRunPrivacy;
  enrichingSummary: boolean;
  savingRun: boolean;
  saveError: string | null;
  onChangeTitle: (next: string) => void;
  onChangePrivacy: (next: RecordedRunPrivacy) => void;
  onExportGpx: () => void;
  onResumeRun: () => void;
  onDiscardRun: () => void;
  onSaveRun: () => void;
}

export function RecordSummaryView({
  baseId,
  summaryData,
  summaryTitleId,
  summaryTitleErrorId,
  summaryTitle,
  summaryTitleError,
  summaryPrivacy,
  enrichingSummary,
  savingRun,
  saveError,
  onChangeTitle,
  onChangePrivacy,
  onExportGpx,
  onResumeRun,
  onDiscardRun,
  onSaveRun,
}: RecordSummaryViewProps) {
  const avgPaceSec =
    summaryData.clientDistanceM > 0 && summaryData.movingTimeMs > 0
      ? (summaryData.movingTimeMs / 1000 / summaryData.clientDistanceM) * 1000
      : null;

  return (
    <div className="w-full max-w-4xl mx-auto py-1 pb-[max(1.25rem,var(--rp-safe-bottom))] space-y-4">
      <section
        aria-labelledby={`${baseId}-summary-heading`}
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2
              id={`${baseId}-summary-heading`}
              className="font-display font-semibold text-lg text-[var(--text-primary)]"
            >
              Run Summary
            </h2>
            <p className="text-xs font-normal text-[var(--text-secondary)]">
              Review your metrics, choose visibility, and save to your RacePulsePH profile.
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)]">
            <ShieldCheck
              className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0"
              aria-hidden="true"
            />
            <span>
              {summaryData.homePrivacyTrimEnabled
                ? summaryData.trimmedPoints.length === 0
                  ? 'Short run: GPS omitted'
                  : `200m trim (${Math.round(summaryData.trimmedHeadM)}m / ${Math.round(summaryData.trimmedTailM)}m)`
                : 'Full track kept'}
            </span>
          </span>
        </div>

        {enrichingSummary && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2"
          >
            <RefreshCw
              className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0"
              aria-hidden="true"
            />
            <span>Enriching Philippine DEM elevation and kilometer splits...</span>
          </div>
        )}

        {/* Title & Privacy Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor={summaryTitleId}
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              Run Title
            </label>
            <input
              id={summaryTitleId}
              type="text"
              maxLength={120}
              value={summaryTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              aria-invalid={Boolean(summaryTitleError)}
              aria-describedby={summaryTitleError ? summaryTitleErrorId : undefined}
              placeholder="Morning Free Run"
              className="w-full min-h-11 px-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
            />
            {summaryTitleError && (
              <p
                id={summaryTitleErrorId}
                role="alert"
                className="text-xs font-semibold text-red-700 dark:text-red-400"
              >
                {summaryTitleError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-[var(--text-primary)]">
              Visibility
            </span>
            <div
              role="group"
              aria-label="Run privacy visibility"
              className="grid grid-cols-3 gap-1.5"
            >
              {PRIVACY_OPTIONS.map((opt) => {
                const active = summaryPrivacy === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChangePrivacy(opt.value)}
                    aria-pressed={active}
                    className={`min-h-11 px-2.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                      active
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {active && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {PRIVACY_OPTIONS.find((opt) => opt.value === summaryPrivacy)?.hint}
            </p>
          </div>
        </div>

        {/* Summary Metrics */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Distance</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {(summaryData.clientDistanceM / 1000).toFixed(2)} km
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Moving Time</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {formatDuration(summaryData.movingTimeMs)}
            </dd>
            <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
              Elapsed {formatDuration(summaryData.elapsedTimeMs)}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Avg Pace</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {formatPace(avgPaceSec)}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Elevation</dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
              +{Math.round(summaryData.elevationGainM)} m / -
              {Math.round(summaryData.elevationLossM)} m
            </dd>
            <dd className="text-xs text-[var(--text-secondary)]">
              Source: {summaryData.elevationSource.toUpperCase()}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Calories</dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
              {summaryData.calorieEstimate.totalKcal.toFixed(1)} kcal
            </dd>
            <dd className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
              Net {summaryData.calorieEstimate.netKcal.toFixed(1)} + Rest{' '}
              {summaryData.calorieEstimate.restingKcal.toFixed(1)} (
              {summaryData.calorieEstimate.weightKgUsed} kg)
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3">
            <dt className="text-xs text-[var(--text-secondary)]">Island Groups</dt>
            <dd className="text-sm font-semibold text-[var(--text-primary)]">
              {summaryData.islandGroups.length > 0
                ? summaryData.islandGroups.join(', ')
                : 'Not classified'}
            </dd>
          </div>
        </dl>

        {/* Kilometer Splits Table */}
        {summaryData.splits.length > 0 && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-2">
            <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
              Kilometer Splits
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      KM
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      Distance
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      Pace
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      Elev Gain
                    </th>
                    <th scope="col" className="py-1.5 font-semibold text-right">
                      Calories
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-primary)]">
                  {summaryData.splits.map((split) => (
                    <tr key={split.kmIndex}>
                      <td className="py-1.5 pr-3">{split.kmIndex}</td>
                      <td className="py-1.5 pr-3">{Math.round(split.distanceM)} m</td>
                      <td className="py-1.5 pr-3">{formatPace(split.paceSecPerKm)}</td>
                      <td className="py-1.5 pr-3">+{Math.round(split.elevationGainM)} m</td>
                      <td className="py-1.5 text-right">{split.caloriesKcal.toFixed(1)} kcal</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Summary Actions */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExportGpx}
              disabled={savingRun}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Export GPX</span>
            </button>

            <button
              type="button"
              onClick={onResumeRun}
              disabled={savingRun || enrichingSummary}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Resume Run</span>
            </button>

            <button
              type="button"
              onClick={onDiscardRun}
              disabled={savingRun}
              className="min-h-11 px-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Discard Run</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onSaveRun}
            disabled={savingRun || enrichingSummary}
            className="min-h-12 px-5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            {savingRun ? (
              <>
                <RefreshCw
                  className="w-4 h-4 motion-safe:animate-spin shrink-0"
                  aria-hidden="true"
                />
                <span>Saving Run...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Save Run</span>
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

export function RecordCalorieInfoDialog({
  titleId,
  descriptionId,
  weightLabel,
  onClose,
}: {
  titleId: string;
  descriptionId: string;
  weightLabel: string;
  onClose: () => void;
}) {
  return (
    <DialogSurface
      variant="sheet"
      maxWidthCss="34rem"
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={onClose}
      dismissOnBackdropClick
    >
      <div className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 id={titleId} className="font-display font-semibold text-lg text-[var(--text-primary)]">
            How Calories Are Calculated
          </h2>
          <p id={descriptionId} className="text-xs text-[var(--text-secondary)]">
            Both live telemetry and server verification run the exact same metabolic formula.
          </p>
        </div>

        <div className="space-y-2.5 text-xs text-[var(--text-secondary)] leading-relaxed">
          <p>
            <strong className="text-[var(--text-primary)]">
              Net Exercise Cost (Minetti et al., 2002):
            </strong>{' '}
            Published in <em>J Appl Physiol 93:1039-1046</em>, this fifth-order grade polynomial
            models the energetic cost of running (at 1.8 m/s or faster) and walking (below 1.8 m/s)
            across terrain grades clamped between -45% and +45%.
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">
              Resting Baseline (Herrmann et al., 2024):
            </strong>{' '}
            From the 2024 Adult Compendium of Physical Activities, a resting 1-MET baseline (1.05
            kcal/kg/hr) is added for active moving duration so total calories match exercise science
            totals.
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">
              Weight &amp; Stationary Protection:
            </strong>{' '}
            Calculations scale by your saved body weight ({weightLabel}). Stationary gaps longer
            than 180 seconds with under 10 meters of movement are excluded so forgotten pauses do not
            accrue ghost calories.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </DialogSurface>
  );
}
