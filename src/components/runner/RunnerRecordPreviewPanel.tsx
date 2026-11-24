import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Compass,
  Flag,
  Info,
  LocateFixed,
  MapPin,
  Mountain,
  Radio,
  Scale,
  Square,
} from 'lucide-react';
import { isClientNavigationClick } from '../../lib/appRouting';
import { subscribePublishedCatalog } from '../../lib/routes/routeStore';
import { buildRaceCoursePath } from '../../lib/routes/routing';
import type { RaceRouteCatalogEntry } from '../../lib/routes/types';
import { useRunnerGeolocation } from '../../lib/routes/useRunnerGeolocation';
import {
  classifyRecordGnssStatus,
  filterPublishedExploreRoutes,
} from '../../lib/runnerShell';
import type { UserProfile } from '../../types';
import { Select, type SelectOption } from '../ui/Select';
import type { ExploreCourseRunTarget } from './RunnerExplorePanel';

export interface RunnerRecordPreviewPanelProps {
  profile: UserProfile;
  preselectedCourse?: ExploreCourseRunTarget | null;
  onSelectCourse?: (course: ExploreCourseRunTarget | null) => void;
  onOpenProfile: () => void;
  onBrowseRoutes?: () => void;
}

function buildCourseKey(raceId: string, distanceId: string): string {
  return `${raceId}::${distanceId}`;
}

function dispatchAppNavigate(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url } }));
}

export default function RunnerRecordPreviewPanel({
  profile,
  preselectedCourse,
  onSelectCourse,
  onOpenProfile,
  onBrowseRoutes,
}: RunnerRecordPreviewPanelProps) {
  const baseId = useId();
  const courseLabelId = `${baseId}-course-label`;
  const courseSelectId = `${baseId}-course-select`;

  const geo = useRunnerGeolocation();
  const [publishedRoutes, setPublishedRoutes] = useState<RaceRouteCatalogEntry[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [selectedCourseKey, setSelectedCourseKey] = useState<string>(() =>
    preselectedCourse ? buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId) : '',
  );

  useEffect(() => {
    const unsubscribe = subscribePublishedCatalog((entries) => {
      setPublishedRoutes(filterPublishedExploreRoutes(entries));
      setRoutesLoaded(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!preselectedCourse) return;
    setSelectedCourseKey(buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId));
  }, [preselectedCourse]);

  const gnssBadge = classifyRecordGnssStatus(geo.status, geo.position);
  const isTracking = geo.status === 'locating' || geo.status === 'active';

  const pillClasses =
    gnssBadge.tone === 'emerald'
      ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
      : gnssBadge.tone === 'amber'
        ? 'border-amber-600/35 bg-amber-500/10 text-amber-900 dark:text-amber-300'
        : gnssBadge.tone === 'red'
          ? 'border-red-600/35 bg-red-500/10 text-red-800 dark:text-red-300'
          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]';

  const courseOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [
      {
        value: '',
        label: 'Free Run (from current location)',
        sublabel: 'Open GNSS check without a fixed course',
      },
    ];

    const seenKeys = new Set<string>(['']);
    for (const entry of publishedRoutes) {
      const key = buildCourseKey(entry.raceId, entry.distanceId);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const km = ((entry.measuredDistanceM > 0 ? entry.measuredDistanceM : entry.advertisedKm * 1000) / 1000).toFixed(2);
      opts.push({
        value: key,
        label: `${entry.raceName} (${entry.distanceLabel})`,
        sublabel: `${entry.region} · ${km} km`,
        badge: entry.elevationStatus === 'unavailable' ? undefined : `+${Math.round(entry.elevationGainM)} m`,
      });
    }

    if (preselectedCourse) {
      const preKey = buildCourseKey(preselectedCourse.raceId, preselectedCourse.distanceId);
      if (!seenKeys.has(preKey)) {
        opts.push({
          value: preKey,
          label: preselectedCourse.label,
          sublabel: 'Selected from Explore routes',
        });
      }
    }

    return opts;
  }, [publishedRoutes, preselectedCourse]);

  const selectedCatalogEntry = useMemo(
    () =>
      publishedRoutes.find(
        (entry) => buildCourseKey(entry.raceId, entry.distanceId) === selectedCourseKey,
      ) ?? null,
    [publishedRoutes, selectedCourseKey],
  );

  const handleCourseChange = (nextKey: string) => {
    setSelectedCourseKey(nextKey);
    if (!nextKey) {
      onSelectCourse?.(null);
      return;
    }
    const matched = publishedRoutes.find(
      (entry) => buildCourseKey(entry.raceId, entry.distanceId) === nextKey,
    );
    if (matched) {
      onSelectCourse?.({
        raceId: matched.raceId,
        distanceId: matched.distanceId,
        label: `${matched.raceName} (${matched.distanceLabel})`,
        publicationId: matched.currentPublicationId,
      });
    }
  };

  const hasWeight = profile.weightKg != null && Number.isFinite(profile.weightKg);
  const weightLabel = hasWeight ? `${profile.weightKg} kg` : '65 kg reference';

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 pb-2">
      {/* Live GNSS Signal Readiness Card */}
      <section
        aria-labelledby={`${baseId}-gnss-heading`}
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={`${baseId}-gnss-heading`}
                className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]"
              >
                Live GNSS Signal Check
              </h2>
              <span
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold tabular-nums ${pillClasses}`}
              >
                <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{gnssBadge.label}</span>
              </span>
            </div>
            <p className="text-xs font-normal text-[var(--text-secondary)]">
              Run a pre-start satellite lock check before your session. Location starts only when you press Test GPS Signal.
            </p>
          </div>

          <button
            type="button"
            onClick={isTracking ? geo.stopTracking : geo.startTracking}
            aria-pressed={isTracking}
            className={`min-h-11 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
              isTracking
                ? 'border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                : 'bg-red-700 hover:bg-red-600 text-white'
            }`}
          >
            {isTracking ? (
              <>
                <Square className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Stop GPS Check</span>
              </>
            ) : (
              <>
                <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Test GPS Signal</span>
              </>
            )}
          </button>
        </div>

        {geo.error && (
          <div
            role="alert"
            className="rounded-xl border border-red-600/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{geo.error}</span>
          </div>
        )}

        {geo.position && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Accuracy</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                ±{geo.position.accuracyM} m
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Coordinates</dt>
              <dd className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {geo.position.lat.toFixed(5)}, {geo.position.lon.toFixed(5)}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 flex flex-col gap-0.5">
              <dt className="text-xs font-normal text-[var(--text-secondary)]">Signal Region</dt>
              <dd className="text-xs font-semibold text-[var(--text-primary)]">
                {geo.position.insidePhilippines === false ? 'Outside Philippines' : 'Philippines bounds OK'}
              </dd>
            </div>
          </dl>
        )}

        <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-xs font-normal text-[var(--text-secondary)] flex items-start gap-2">
          <Info className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
          <span>Desktop browsers use Wi-Fi or IP geolocation without GNSS hardware.</span>
        </p>
      </section>

      {/* Course Selection & Calorie Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section
          aria-labelledby={courseLabelId}
          className="lg:col-span-2 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id={courseLabelId}
                className="font-display font-semibold text-base text-[var(--text-primary)]"
              >
                Course Selection
              </h2>
              <p className="text-xs font-normal text-[var(--text-secondary)]">
                {routesLoaded
                  ? `${publishedRoutes.length} published Philippine ${publishedRoutes.length === 1 ? 'course' : 'courses'} available.`
                  : 'Loading published Philippine courses...'}
              </p>
            </div>

            {onBrowseRoutes && (
              <button
                type="button"
                onClick={onBrowseRoutes}
                className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>Browse Routes</span>
              </button>
            )}
          </div>

          <Select
            id={courseSelectId}
            ariaLabelledBy={courseLabelId}
            value={selectedCourseKey}
            options={courseOptions}
            onChange={handleCourseChange}
            searchable
            searchPlaceholder="Filter published courses..."
            leadingIcon={<Flag className="w-4 h-4" />}
            showSublabelInTrigger
          />

          {selectedCatalogEntry ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-display font-semibold text-sm text-[var(--text-primary)]">
                    {selectedCatalogEntry.raceName} ({selectedCatalogEntry.distanceLabel})
                  </p>
                  <p className="text-xs font-normal text-[var(--text-secondary)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {selectedCatalogEntry.mapLayerProvenance?.province || selectedCatalogEntry.region} · {selectedCatalogEntry.raceDate}
                    </span>
                  </p>
                </div>

                <a
                  href={buildRaceCoursePath(
                    selectedCatalogEntry.raceId,
                    selectedCatalogEntry.distanceId,
                    selectedCatalogEntry.currentPublicationId,
                  )}
                  onClick={(e) => {
                    const targetUrl = buildRaceCoursePath(
                      selectedCatalogEntry.raceId,
                      selectedCatalogEntry.distanceId,
                      selectedCatalogEntry.currentPublicationId,
                    );
                    if (isClientNavigationClick(e)) {
                      e.preventDefault();
                      dispatchAppNavigate(targetUrl);
                    }
                  }}
                  className="min-h-11 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Flag className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <span>Open Course Map</span>
                </a>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] py-2 text-center font-mono tabular-nums">
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">Distance</dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {((selectedCatalogEntry.measuredDistanceM > 0 ? selectedCatalogEntry.measuredDistanceM : selectedCatalogEntry.advertisedKm * 1000) / 1000).toFixed(2)} km
                  </dd>
                </div>
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)] inline-flex items-center gap-1">
                    <Mountain className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Gain</span>
                  </dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {selectedCatalogEntry.elevationStatus === 'unavailable'
                      ? 'N/A'
                      : `+${Math.round(selectedCatalogEntry.elevationGainM)} m`}
                  </dd>
                </div>
                <div className="px-2">
                  <dt className="font-sans text-xs font-normal text-[var(--text-secondary)]">Checkpoints</dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)]">
                    {selectedCatalogEntry.checkpointCount}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 text-xs font-normal text-[var(--text-secondary)]">
              <strong className="font-semibold text-[var(--text-primary)]">
                {preselectedCourse && selectedCourseKey ? preselectedCourse.label : 'Free Run (from current location)'}
              </strong>{' '}
              is selected. Use Test GPS Signal above to confirm satellite accuracy before starting outdoors.
            </div>
          )}
        </section>

        {/* Body Weight Calibration + M1 Honest Status */}
        <section
          aria-labelledby={`${baseId}-weight-heading`}
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <h2
              id={`${baseId}-weight-heading`}
              className="font-display font-semibold text-base text-[var(--text-primary)]"
            >
              Calorie Calibration
            </h2>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
              <Scale className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                {weightLabel}
              </span>
            </div>
            <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
              {hasWeight
                ? 'Your saved body weight calibrates run energy expenditure once activity recording launches.'
                : 'Add your body weight in Profile settings to replace the 65 kg reference value for calorie estimates.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenProfile}
            className="min-h-11 w-full px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          >
            <Scale className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Edit Weight in Profile</span>
          </button>
        </section>
      </div>

      {/* Honest Milestone 1 Status */}
      <section
        aria-labelledby={`${baseId}-m1-heading`}
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-1.5"
      >
        <h2
          id={`${baseId}-m1-heading`}
          className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)]"
        >
          Milestone 1 Readiness Preview
        </h2>
        <p className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
          Live GNSS signal testing and course selection are active now. Full Start Run trail recording, split pace tracking, and calorie logging activate in Milestone 2.
        </p>
      </section>
    </div>
  );
}
