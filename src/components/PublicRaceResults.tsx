import { formatDateTime, parseRaceDurationSeconds } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, FileDown, Medal, RefreshCw, Search, Trophy, UserPlus, X } from 'lucide-react';
import { ResultsSkeletonList } from './ui/MotionPrimitives';
import RaceTimeText from './ui/RaceTimeText';
import { Select } from './ui/Select';
import { subscribeLiveResultByRace } from '../lib/liveResultsStore';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';
import EventCourseRunnerPanel from './routes/EventCourseRunnerPanel';

interface PublicRaceResultsProps {
  race: Race;
  onRegister: (raceId: string) => void;
  registerLabel?: string;
  embedded?: boolean;
  hideCoursePreview?: boolean;
}

function certificateResult(entry: PublicLeaderboardEntry): RunnerResult {
  return {
    bibNumber: entry.bibNumber,
    finishTime: entry.finishTime,
    finishReviewRequired: entry.finishReviewRequired,
    rank: entry.rank,
    overallRank: entry.overallRank ?? entry.rank,
    categoryRank: entry.categoryRank,
    categoryLabel: entry.categoryLabel,
    specialAgeAwards: entry.specialAgeAwards,
    timingMethod: entry.timingMethod,
    sequenceStartTime: entry.sequenceStartTime,
    chipTime: entry.chipTime,
    gunTime: entry.gunTime,
    splits: [],
  };
}

// Read-only results view. It deliberately reads only the compact public
// `liveResults` record published by the timing console: never raw scan data or
// runner contact details.
export default function PublicRaceResults({
  race,
  onRegister,
  registerLabel = 'Sign up to register',
  embedded = false,
  hideCoursePreview = false,
}: PublicRaceResultsProps) {
  const [summary, setSummary] = useState<PublicLiveResults | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [distance, setDistance] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [certError, setCertError] = useState('');

  useEffect(() => {
    setSummary(undefined);
    setSearch('');
    setDistance('all');
    setCategoryFilter('all');
    setDownloadingKey(null);
    setCertError('');
    return subscribeLiveResultByRace(race.id, setSummary);
  }, [race.id]);

  const handleDownloadCertificate = async (entry: PublicLeaderboardEntry) => {
    const entryKey = `${entry.distance}_${entry.rank}_${entry.bibNumber}`;
    setDownloadingKey(entryKey);
    setCertError('');
    try {
      await downloadFinisherCertificate(race, entry, certificateResult(entry));
    } catch {
      const who = entry.isFreeSlot ? `Bib #${entry.bibNumber}` : entry.fullName;
      setCertError(`Could not prepare the certificate for ${who}. Please try again.`);
    } finally {
      setDownloadingKey((curr) => (curr === entryKey ? null : curr));
    }
  };

  // Do not trust an old/stale leaderboard document on its own: the actual
  // race settings decide when results may become public. This hides any
  // pre-race scanner test records until an organizer starts a wave.
  const raceHasStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
  const resultsArePublic = !!race.completedAt || raceHasStarted;
  const officialResults = resultsArePublic
    ? (summary?.officialResults || []).filter((entry) => entry.distance !== 'Unknown')
    : [];
  const distances = useMemo(() => [...new Set(officialResults.map((entry) => entry.distance))], [officialResults]);

  const categories = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; fastestSecs: number | null; fastestRaw: string }>();
    for (const entry of officialResults) {
      if (distance !== 'all' && entry.distance !== distance) continue;
      const label = entry.categoryLabel?.trim();
      if (!label) continue;
      const secs = parseRaceDurationSeconds(entry.finishTime);
      const prev = counts.get(label);
      if (!prev) {
        counts.set(label, { label, count: 1, fastestSecs: secs, fastestRaw: entry.finishTime });
      } else {
        prev.count += 1;
        if (secs !== null && (prev.fastestSecs === null || secs < prev.fastestSecs)) {
          prev.fastestSecs = secs;
          prev.fastestRaw = entry.finishTime;
        }
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [distance, officialResults]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !categories.some((cat) => cat.label === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categories, categoryFilter]);

  const raceStats = useMemo(() => {
    if (officialResults.length === 0) return null;
    const sortedTimes = officialResults
      .map((entry) => ({ secs: parseRaceDurationSeconds(entry.finishTime), raw: entry.finishTime }))
      .filter((item): item is { secs: number; raw: string } => item.secs !== null)
      .sort((a, b) => a.secs - b.secs);
    const chipCount = officialResults.filter((entry) => entry.timingMethod !== 'gun').length;
    const gunCount = officialResults.length - chipCount;
    const specialAwardsCount = officialResults.filter((entry) => (entry.specialAgeAwards?.length ?? 0) > 0).length;
    const registered = summary?.totalRegistered ?? 0;
    const finishRatePct = registered > 0 ? Math.min(100, Math.round((officialResults.length / registered) * 100)) : null;

    return {
      finished: officialResults.length,
      registered,
      finishRatePct,
      fastestTime: sortedTimes[0]?.raw ?? '',
      medianTime: sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length / 2)].raw : '',
      chipCount,
      gunCount,
      specialAwardsCount,
    };
  }, [officialResults, summary?.totalRegistered]);

  const filteredResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    return officialResults.filter((entry) => {
      const matchesDistance = distance === 'all' || entry.distance === distance;
      const matchesCategory = categoryFilter === 'all' || entry.categoryLabel === categoryFilter;
      const matchesSearch = !term || entry.fullName.toLowerCase().includes(term) || entry.bibNumber.toLowerCase().includes(term);
      return matchesDistance && matchesCategory && matchesSearch;
    });
  }, [categoryFilter, distance, officialResults, search]);
  const registrationOpen = isRaceRegistrationOpen(race);

  return (
    <section
      className={embedded ? 'space-y-4' : 'glass-panel overflow-hidden scroll-mt-[84px] animate-fadeIn'}
      aria-label={`${race.name} official results`}
    >
      {!embedded && (
        <div className="p-4 sm:p-6 border-b border-[var(--border-default)] bg-[var(--surface-card)]">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-base sm:text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                {resultsArePublic ? 'Official leaderboard & finisher certificates' : 'Event schedule, distances & route preview'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>{race.date}</span>
                </p>
                <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/30 bg-emerald-700/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <Trophy className="w-3.5 h-3.5" aria-hidden="true" />{' '}
                  {resultsArePublic ? 'Official results' : registrationOpen ? 'Registration open' : 'Upcoming event'}
                </span>
              </div>
            </div>
            {registrationOpen && (
              <button
                type="button"
                onClick={() => onRegister(race.id)}
                className="shrink-0 min-h-11 h-11 px-5 rounded-xl font-semibold text-xs text-white bg-red-700 hover:bg-red-600 border border-red-800 dark:border-red-500/40 cursor-pointer transition-[background-color,transform] duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.98]"
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" /> {registerLabel}
              </button>
            )}
          </div>
        </div>
      )}

      <div className={embedded ? 'space-y-3' : 'p-3 sm:p-5 space-y-4'}>
        {!hideCoursePreview && (
          <EventCourseRunnerPanel race={race} preferredDistance={distance !== 'all' ? distance : undefined} />
        )}
        {summary === undefined ? (
          <ResultsSkeletonList rows={5} />
        ) : summary === null || officialResults.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-6 text-center space-y-1.5">
            <Medal className="w-7 h-7 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Official results are not published yet</p>
            <p className="text-xs text-[var(--text-secondary)]">Results and E-certificates become available after the organizer starts the race and records finishers.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Official ranking</h3>
                <p className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
                  {officialResults.length} official finishers · Search name or bib to download certificate
                </p>
              </div>
              {summary.updatedAt && <span className="text-xs tabular-nums text-[var(--text-secondary)]">Updated {formatDateTime(summary.updatedAt)}</span>}
            </div>

            {raceStats && (
              <div className="overflow-x-auto racepulse-horizontal-scroll rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
                <dl
                  className="grid grid-flow-col auto-cols-[minmax(112px,1fr)] divide-x divide-[var(--border-subtle)]"
                  aria-label="Race finish statistics"
                >
                  <div className="px-2.5 py-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Finishers</dt>
                    <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                      {raceStats.finished}{raceStats.registered > 0 ? `/${raceStats.registered}` : ''}
                      {raceStats.finishRatePct !== null && (
                        <span className="ml-1.5 text-xs text-emerald-700 dark:text-emerald-400">({raceStats.finishRatePct}%)</span>
                      )}
                    </dd>
                  </div>
                  <div className="px-2.5 py-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Fastest</dt>
                    <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 truncate">
                      <RaceTimeText value={raceStats.fastestTime} fallback="--:--:--" />
                    </dd>
                  </div>
                  <div className="px-2.5 py-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Median</dt>
                    <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                      <RaceTimeText value={raceStats.medianTime} fallback="--:--:--" />
                    </dd>
                  </div>
                  <div className="px-2.5 py-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">Chip Timing</dt>
                    <dd className="mt-0.5 font-mono text-xs sm:text-sm font-semibold tabular-nums text-[var(--text-primary)] truncate">
                      {raceStats.chipCount} chip{raceStats.specialAwardsCount > 0 ? ` · ${raceStats.specialAwardsCount} awd` : ''}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <label className="relative block">
                <span className="sr-only">Search official finishers by name or bib number</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or bib number"
                  className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400"
                />
              </label>
              {distances.length > 1 && (
                <Select
                  aria-label="Filter results by distance"
                  value={distance}
                  onChange={setDistance}
                  surface="inset"
                  size="md"
                  className="sm:w-auto sm:min-w-[160px]"
                  triggerClassName="text-xs"
                  options={[
                    { value: 'all', label: 'All distances' },
                    ...distances.map((item) => ({ value: item, label: item })),
                  ]}
                />
              )}
            </div>

            {categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter results by age division">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  aria-pressed={categoryFilter === 'all'}
                  className={`min-h-11 px-3 py-1.5 rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                    categoryFilter === 'all'
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                  }`}
                >
                  All divisions ({distance === 'all' ? officialResults.length : officialResults.filter((e) => e.distance === distance).length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.label}
                    type="button"
                    onClick={() => setCategoryFilter(cat.label)}
                    aria-pressed={categoryFilter === cat.label}
                    className={`min-h-11 px-3 py-1.5 rounded-full border text-xs font-semibold tabular-nums transition-colors inline-flex items-center gap-1.5 ${
                      categoryFilter === cat.label
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span className="font-mono text-[11px] opacity-85">({cat.count})</span>
                  </button>
                ))}
              </div>
            )}

            {certError && (
              <div
                role="alert"
                className="rounded-xl border border-red-700/30 bg-red-50 dark:bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{certError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCertError('')}
                  aria-label="Dismiss certificate error"
                  className="min-h-11 min-w-11 shrink-0 rounded-lg inline-flex items-center justify-center hover:bg-red-500/10"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {filteredResults.length === 0 ? (
              <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
                No official result matches &ldquo;{search}&rdquo;.
              </p>
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] divide-y divide-[var(--border-subtle)] max-h-[38rem] overflow-y-auto">
                {filteredResults.map((entry) => {
                  const entryKey = `${entry.distance}_${entry.rank}_${entry.bibNumber}`;
                  const isDownloading = downloadingKey === entryKey;
                  const finisherLabel = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;
                  return (
                    <div key={entryKey} className="px-3 py-2.5 flex items-center gap-2.5">
                      <span className="w-8 text-center font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400 shrink-0">
                        #{entry.overallRank ?? entry.rank}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{finisherLabel}</span>
                        <span className="block mt-0.5 text-xs tabular-nums text-[var(--text-secondary)] truncate">
                          {entry.distance} · Bib #{entry.bibNumber}
                          {entry.categoryRank ? ` · ${entry.categoryLabel || 'Cat'} #${entry.categoryRank}` : ''}
                          {entry.specialAgeAwards?.length ? ` · ${entry.specialAgeAwards.join(' / ')}` : ''}
                          {entry.timingMethod === 'gun' ? ' · Gun' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        <RaceTimeText value={entry.finishTime} />
                        {entry.finishReviewRequired && <span className="block text-[11px] text-amber-800 dark:text-amber-300">Provisional</span>}
                      </span>
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handleDownloadCertificate(entry)}
                        className="shrink-0 min-h-11 min-w-11 rounded-full border border-red-700/30 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-700 hover:text-white disabled:opacity-60 transition-colors flex items-center justify-center"
                        title={`Download ${finisherLabel}'s certificate`}
                        aria-label={`Download certificate for ${finisherLabel}`}
                      >
                        {isDownloading ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
