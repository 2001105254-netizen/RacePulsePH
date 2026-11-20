import { useMemo, useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Award, ChevronDown, ChevronUp, RefreshCw, Users } from 'lucide-react';
import {
  computePublicLandingBundle,
  formatShortDuration,
} from '../lib/publicLandingStats';
import { philippineDate } from '../lib/raceRegistration';
import type { PublicLiveResults, Race } from '../types';
import { Button } from './ui/button';
import { GlidingFilterBar, OdometerNumber } from './ui/KineticTelemetry';
import { CardSkeletonLoader, EMIL_EASE, KINETIC_SPRING } from './ui/MotionPrimitives';
import RaceTimeText from './ui/RaceTimeText';
import { Select } from './ui/Select';

export interface PublicAgeStatsSectionProps {
  races: Race[];
  resultsByRaceId: Record<string, PublicLiveResults>;
  loadState: 'loading' | 'ready' | 'error';
  resultsLoadState: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
}

type GenderFilter = 'all' | 'male' | 'female';

const COUNT_FMT = new Intl.NumberFormat('en-PH');
function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  return COUNT_FMT.format(n);
}

const GENDER_OPTIONS: Array<{ value: GenderFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export default function PublicAgeStatsSection({
  races,
  resultsByRaceId,
  loadState,
  resultsLoadState,
  onRetry,
}: PublicAgeStatsSectionProps) {
  const prefersReducedMotion = useReducedMotion();
  const [selectedRaceId, setSelectedRaceId] = useState<string>('all');
  const [selectedDistance, setSelectedDistance] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<GenderFilter>('all');
  const [showAllDivisions, setShowAllDivisions] = useState(false);

  const today = philippineDate();

  const bundle = useMemo(
    () =>
      computePublicLandingBundle({
        races,
        resultsByRaceId,
        selectedRaceId,
        distanceFilter: selectedDistance,
        entryCategoryFilter: 'all',
        todayStr: today,
      }),
    [races, resultsByRaceId, selectedRaceId, selectedDistance, today],
  );

  const raceSelectOptions = useMemo(() => {
    const items = [
      { value: 'all', label: 'All published races' },
      ...bundle.availableRaces.map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.date,
      })),
    ];
    return items;
  }, [bundle.availableRaces]);

  const effectiveDistance =
    selectedDistance !== 'all' && !bundle.availableDistances.includes(selectedDistance)
      ? 'all'
      : selectedDistance;

  const ageRangeByDivision = useMemo(() => {
    const map = new Map<string, string>();
    for (const div of bundle.demographics.configuredDivisions) {
      map.set(`${div.gender}:${div.label.toLowerCase()}`, `${div.minAge}-${div.maxAge} yrs`);
    }
    return map;
  }, [bundle.demographics.configuredDivisions]);

  const filteredAgeCuts = useMemo(() => {
    const rows =
      selectedGender === 'all'
        ? bundle.demographics.ageCuts
        : bundle.demographics.ageCuts.filter((cut) => cut.gender === selectedGender);
    if (selectedGender === 'all') return rows;
    const cohortTotal = rows.reduce((sum, row) => sum + row.count, 0);
    return rows.map((row) => ({
      ...row,
      pct: cohortTotal > 0 ? Math.round((row.count / cohortTotal) * 100) : row.pct,
    }));
  }, [bundle.demographics.ageCuts, selectedGender]);

  const filteredConfiguredDivisions = useMemo(() => {
    if (selectedGender === 'all') return bundle.demographics.configuredDivisions;
    return bundle.demographics.configuredDivisions.filter((div) => div.gender === selectedGender);
  }, [bundle.demographics.configuredDivisions, selectedGender]);

  const activeDivisionTotal =
    filteredAgeCuts.length > 0 ? filteredAgeCuts.length : filteredConfiguredDivisions.length;

  const visibleAgeCuts = showAllDivisions ? filteredAgeCuts : filteredAgeCuts.slice(0, 6);
  const visibleConfiguredDivisions = showAllDivisions
    ? filteredConfiguredDivisions
    : filteredConfiguredDivisions.slice(0, 6);

  const maleRow = bundle.demographics.genderSplit.find((g) => g.id === 'male');
  const femaleRow = bundle.demographics.genderSplit.find((g) => g.id === 'female');
  const menWomenSummary =
    maleRow || femaleRow
      ? `${maleRow?.sharePct ?? 0}% / ${femaleRow?.sharePct ?? 0}%`
      : '--';

  const selectedGenderSummary =
    selectedGender === 'male'
      ? maleRow
      : selectedGender === 'female'
        ? femaleRow
        : undefined;

  const summaryMedianSec = selectedGenderSummary?.medianSeconds ?? bundle.overview.medianSeconds;
  const summaryMedianFormatted = formatShortDuration(summaryMedianSec);
  const summaryFinishersCount =
    selectedGenderSummary !== undefined
      ? selectedGenderSummary.finished
      : bundle.overview.totalFinished;

  const isLoading = loadState === 'loading' || resultsLoadState === 'loading';
  const hasError = loadState === 'error' || resultsLoadState === 'error';
  const hasFilters = selectedRaceId !== 'all' || effectiveDistance !== 'all' || selectedGender !== 'all';

  return (
    <section
      id="age-stats"
      tabIndex={-1}
      className="landing-below-fold space-y-6 pt-8 border-t border-[var(--border-default)] scroll-mt-[84px]"
      aria-labelledby="age-stats-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="age-stats-heading" className="type-section text-[var(--text-primary)]">
            Age category standings
          </h2>
          <p className="type-lead text-[var(--text-secondary)]">
            Division participation, best times, and median finishes across official categories.
          </p>
        </div>

        {hasFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 px-4 self-start sm:self-auto shrink-0"
            onClick={() => {
              setSelectedRaceId('all');
              setSelectedDistance('all');
              setSelectedGender('all');
              setShowAllDivisions(false);
            }}
          >
            Reset filters
          </Button>
        )}
      </div>

      {/* Compact Filter Bar */}
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="w-full lg:w-80 shrink-0">
            <Select
              ariaLabel="Filter age statistics by race"
              value={selectedRaceId}
              onChange={(val) => {
                setSelectedRaceId(val);
                setShowAllDivisions(false);
              }}
              options={raceSelectOptions}
              searchable={raceSelectOptions.length > 6}
              searchPlaceholder="Filter race name..."
              surface="inset"
              triggerClassName="min-h-11 border-[var(--border-button)]"
            />
          </div>

          <GlidingFilterBar
            variant="segmented"
            groupId="age-gender"
            ariaLabel="Filter age divisions by gender"
            items={GENDER_OPTIONS}
            activeValue={selectedGender}
            onChange={(val) => {
              setSelectedGender(val as GenderFilter);
              setShowAllDivisions(false);
            }}
          />
        </div>

        {bundle.availableDistances.length > 1 && (
          <GlidingFilterBar
            groupId="age-distance"
            ariaLabel="Filter age category standings by distance"
            items={[
              { value: 'all', label: 'All distances' },
              ...bundle.availableDistances.map((dist) => ({ value: dist, label: dist })),
            ]}
            activeValue={effectiveDistance}
            onChange={(val) => {
              setSelectedDistance(val);
              setShowAllDivisions(false);
            }}
          />
        )}
      </div>

      {/* States: Loading -> Error -> Empty -> Ready */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CardSkeletonLoader label="Loading age category summary" />
          <CardSkeletonLoader label="Loading division standings" />
        </div>
      ) : hasError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-600/40 bg-[var(--surface-card)] p-6 text-center space-y-3"
        >
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Unable to load age category statistics right now.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 px-4"
            onClick={() => (onRetry ? onRetry() : window.location.reload())}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : activeDivisionTotal === 0 && bundle.demographics.ageCuts.length === 0 && bundle.overview.totalFinished === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-2">
          <Users className="w-7 h-7 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            No published age category data yet
          </p>
          <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
            Official age-category statistics appear here after a race finishes.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 4-Cell Hairline Summary Strip */}
          <dl className="grid grid-cols-2 lg:grid-cols-4 border border-[var(--border-default)] rounded-2xl overflow-hidden bg-[var(--surface-card)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-subtle)]">
            <div className="min-w-0 p-4 sm:p-5 border-r lg:border-r-0 border-[var(--border-subtle)]">
              <dt className="type-caption font-semibold text-[var(--text-secondary)]">
                Official finishers
              </dt>
              <dd className="mt-1 font-mono text-lg sm:text-2xl font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {typeof summaryFinishersCount === 'number' && Number.isFinite(summaryFinishersCount) ? (
                  <OdometerNumber value={summaryFinishersCount} durationMs={350} />
                ) : (
                  '--'
                )}
              </dd>
            </div>
            <div className="min-w-0 p-4 sm:p-5">
              <dt className="type-caption font-semibold text-[var(--text-secondary)]">
                Age divisions
              </dt>
              <dd className="mt-1 font-mono text-lg sm:text-2xl font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {fmtCount(activeDivisionTotal)}
              </dd>
            </div>
            <div className="min-w-0 p-4 sm:p-5 border-r lg:border-r-0 border-[var(--border-subtle)]">
              <dt className="type-caption font-semibold text-[var(--text-secondary)]">
                Men / Women
              </dt>
              <dd className="mt-1 font-mono text-lg sm:text-2xl font-semibold tabular-nums text-[var(--text-primary)] truncate">
                {menWomenSummary}
              </dd>
            </div>
            <div className="min-w-0 p-4 sm:p-5">
              <dt className="type-caption font-semibold text-[var(--text-secondary)]">
                Median finish
              </dt>
              <dd className="mt-1 font-mono text-lg sm:text-2xl font-semibold tabular-nums text-[var(--text-primary)] truncate">
                <RaceTimeText value={summaryMedianFormatted} fallback="--" />
              </dd>
            </div>
          </dl>

          {/* 2-Column Age Division Breakdown */}
          {visibleAgeCuts.length > 0 ? (() => {
            const ageGridAnimKey = `${selectedRaceId}:${effectiveDistance}:${selectedGender}`;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleAgeCuts.map((cut, index) => {
                    const ageSpan =
                      cut.gender !== 'all'
                        ? ageRangeByDivision.get(`${cut.gender}:${cut.label.toLowerCase()}`)
                        : undefined;
                    const bestStr = cut.fastestSeconds !== undefined ? formatShortDuration(cut.fastestSeconds) : null;
                    const medianStr = cut.medianSeconds !== undefined ? formatShortDuration(cut.medianSeconds) : null;
                    const isStaggered = index < 6 && !prefersReducedMotion;
                    const delay = index * 0.04;

                    return (
                      <m.article
                        key={`${ageGridAnimKey}:${cut.id}`}
                        initial={isStaggered ? { opacity: 0, y: 14 } : false}
                        animate={{
                          opacity: 1,
                          y: 0,
                          transitionEnd: { transform: 'none' },
                        }}
                        transition={
                          isStaggered
                            ? {
                                ...KINETIC_SPRING,
                                delay,
                                opacity: { duration: 0.2, delay, ease: EMIL_EASE },
                              }
                            : { duration: 0 }
                        }
                        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-semibold text-[var(--text-primary)] truncate">
                              {cut.label}
                            </h3>
                            <p className="type-caption font-mono text-[var(--text-secondary)] mt-0.5">
                              {cut.gender === 'male' ? 'Men' : cut.gender === 'female' ? 'Women' : 'Combined'}
                              {ageSpan ? ` · ${ageSpan}` : ''}
                            </p>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {fmtCount(cut.count)}
                            </span>
                            <span className="ml-2 text-xs text-[var(--text-secondary)]">
                              {cut.pct}%
                            </span>
                          </div>
                        </div>

                        <div
                          className="h-1 w-full rounded-full bg-[var(--surface-inset)] overflow-hidden"
                          role="progressbar"
                          aria-label={`${cut.label} share of finishers`}
                          aria-valuenow={cut.pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-red-700 dark:bg-red-400"
                            style={{ width: `${Math.max(4, Math.min(100, cut.pct))}%` }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                          <span>
                            Best:{' '}
                            <strong className="text-[var(--text-primary)]">
                              {bestStr ? <RaceTimeText value={bestStr} fallback="--" /> : '--'}
                            </strong>
                          </span>
                          <span>
                            Median:{' '}
                            <strong className="text-[var(--text-primary)]">
                              {medianStr ? <RaceTimeText value={medianStr} fallback="--" /> : '--'}
                            </strong>
                          </span>
                        </div>
                      </m.article>
                    );
                  })}
                </div>

                {filteredAgeCuts.length > 6 && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-expanded={showAllDivisions}
                      onClick={() => setShowAllDivisions((prev) => !prev)}
                      className="min-h-11 px-4"
                    >
                      {showAllDivisions ? (
                        <>
                          <ChevronUp className="w-4 h-4" aria-hidden="true" />
                          <span>Show top 6 divisions</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" aria-hidden="true" />
                          <span>Show all {filteredAgeCuts.length} divisions</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })() : visibleConfiguredDivisions.length > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visibleConfiguredDivisions.map((div) => (
                  <article
                    key={`${div.gender}_${div.label}_${div.minAge}_${div.maxAge}`}
                    className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-[var(--text-primary)] truncate">
                        {div.label}
                      </h3>
                      <p className="type-caption font-mono text-[var(--text-secondary)] mt-0.5">
                        {div.minAge}-{div.maxAge} yrs · {div.gender === 'male' ? 'Men' : 'Women'}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-[var(--text-secondary)] shrink-0">
                      Bracket active
                    </span>
                  </article>
                ))}
              </div>

              {filteredConfiguredDivisions.length > 6 && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-expanded={showAllDivisions}
                    onClick={() => setShowAllDivisions((prev) => !prev)}
                    className="min-h-11 px-4"
                  >
                    {showAllDivisions ? (
                      <>
                        <ChevronUp className="w-4 h-4" aria-hidden="true" />
                        <span>Show fewer brackets</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" aria-hidden="true" />
                        <span>Show all {filteredConfiguredDivisions.length} divisions</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No {selectedGender === 'male' ? 'male' : 'female'} division breakdown recorded for this filter
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 px-4"
                onClick={() => setSelectedGender('all')}
              >
                Show all divisions
              </Button>
            </div>
          )}

          {/* Conditional Special Age Recognition */}
          {bundle.performance.specialAwards.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                  <Award className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  <span>Special age recognition</span>
                </h3>
                <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                  {fmtCount(bundle.performance.specialAwards.length)} honored
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {bundle.performance.specialAwards.slice(0, 4).map((awd) => (
                  <div
                    key={awd.key}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-1 min-w-0"
                  >
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {awd.displayName}
                    </div>
                    <div className="text-xs text-red-700 dark:text-red-400 font-medium truncate">
                      {awd.awards.join(', ')}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                      <span>Bib #{awd.bibNumber} · {awd.distance}</span>
                      <RaceTimeText value={awd.finishTime} fallback="--" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
