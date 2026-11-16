import { formatDateTime, parseRaceDurationSeconds } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Calendar, FileDown, Medal, RefreshCw, Search, Trophy, UserPlus, X } from 'lucide-react';
import { ResultsSkeletonList } from './ui/MotionPrimitives';
import RaceTimeText from './ui/RaceTimeText';
import { db } from '../firebase';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';
import RouteMap3D from './RouteMap3D';

interface PublicRaceResultsProps {
  race: Race;
  onRegister: (raceId: string) => void;
  registerLabel?: string;
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
export default function PublicRaceResults({ race, onRegister, registerLabel = 'Sign up to register' }: PublicRaceResultsProps) {
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
    const unsubscribe = onSnapshot(doc(db, 'liveResults', race.id), (snapshot) => {
      setSummary(snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null);
    }, (error) => {
      console.warn('Public race result listener failed:', error.message);
      setSummary(null);
    });
    return () => unsubscribe();
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
    <section className="glass-panel overflow-hidden scroll-mt-[84px] animate-fadeIn" aria-label={`${race.name} official results`}>
      <div className="relative p-4 sm:p-6 border-b border-[var(--border-default)] hero-glow overflow-x-clip">
        {race.posterImage && <img src={race.posterImage} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-[0.1]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/35 to-[var(--surface-card)]/90" />
        <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-base sm:text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              {resultsArePublic ? 'Official leaderboard & finisher certificates' : 'Event schedule, distances & route preview'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                <span>{race.date}</span>
              </p>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-700/30 bg-emerald-700/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Trophy className="w-3.5 h-3.5" aria-hidden="true" />{' '}
                {resultsArePublic ? 'Official results' : registrationOpen ? 'Registration open' : 'Upcoming event'}
              </span>
            </div>
          </div>
          {registrationOpen && (
            <button type="button" onClick={() => onRegister(race.id)} className="shrink-0 min-h-11 h-11 px-5 rounded-full font-semibold text-xs text-white bg-red-700 hover:bg-red-600 border border-[#3d0b09] dark:border-red-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)] transition-[background-color,transform] duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.97]">
              <UserPlus className="w-4 h-4" aria-hidden="true" /> {registerLabel}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {race.routeGpxUrl && <RouteMap3D gpxUrl={race.routeGpxUrl} fileName={race.routeGpxFileName} raceName={race.name} />}
        {summary === undefined ? (
          <ResultsSkeletonList rows={5} />
        ) : summary === null || officialResults.length === 0 ? (
          <div className="glass-inset px-5 py-8 text-center space-y-2">
            <Medal className="w-8 h-8 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Official results are not published yet</p>
            <p className="text-xs text-[var(--text-secondary)]">Results and E-certificates become available after the organizer starts the race and records finishers.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Official ranking</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{officialResults.length} official finishers. Search your name or bib, filter by age division, then download your certificate. Free Slots are identified by bib only.</p>
              </div>
              {summary.updatedAt && <span className="text-xs text-[var(--text-secondary)]">Updated {formatDateTime(summary.updatedAt)}</span>}
            </div>

            {raceStats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" aria-label="Race finish statistics">
                <div className="glass-inset px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Finishers</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    {raceStats.finished}{raceStats.registered > 0 ? ` / ${raceStats.registered}` : ''}
                    {raceStats.finishRatePct !== null && (
                      <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">({raceStats.finishRatePct}%)</span>
                    )}
                  </div>
                </div>
                <div className="glass-inset px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Fastest Finish</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    <RaceTimeText value={raceStats.fastestTime} fallback="--:--:--" />
                  </div>
                </div>
                <div className="glass-inset px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Median Finish</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    <RaceTimeText value={raceStats.medianTime} fallback="--:--:--" />
                  </div>
                </div>
                <div className="glass-inset px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Chip / Special Age</div>
                  <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    {raceStats.chipCount} chip{raceStats.specialAwardsCount > 0 ? ` / ${raceStats.specialAwardsCount} award${raceStats.specialAwardsCount === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <label className="relative block">
                <span className="sr-only">Search official finishers by name or bib number</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or bib number" className="w-full glass-inset py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400" />
              </label>
              {distances.length > 1 && <select aria-label="Filter results by distance" value={distance} onChange={(event) => setDistance(event.target.value)} className="min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400"><option value="all">All distances</option>{distances.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            </div>

            {categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter results by age division">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  aria-pressed={categoryFilter === 'all'}
                  className={`min-h-11 px-3 py-2 rounded-full border text-xs font-semibold transition-colors ${
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
                    className={`min-h-11 px-3 py-2 rounded-full border text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
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
                className="rounded-xl border border-red-700/30 bg-red-50 dark:bg-red-950/35 px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center justify-between gap-2"
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
              <p className="glass-inset px-4 py-6 text-center text-xs text-[var(--text-secondary)]">No official result matches &ldquo;{search}&rdquo;.</p>
            ) : (
              <div className="space-y-2 max-h-[38rem] overflow-y-auto pr-1">
                {filteredResults.map((entry) => {
                  const entryKey = `${entry.distance}_${entry.rank}_${entry.bibNumber}`;
                  const isDownloading = downloadingKey === entryKey;
                  const finisherLabel = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;
                  return (
                    <div key={entryKey} className="glass-inset px-3 py-3 sm:px-4 flex items-center gap-3">
                      <span className="w-8 text-center font-mono font-semibold text-red-700 dark:text-red-400 shrink-0">#{entry.overallRank ?? entry.rank}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{finisherLabel}</span>
                        <span className="block mt-1 text-xs text-[var(--text-secondary)]">
                          {entry.distance} · Bib #{entry.bibNumber}
                          {entry.categoryRank ? ` · ${entry.categoryLabel || 'Category'} #${entry.categoryRank}` : ''}
                          {entry.specialAgeAwards?.length ? ` · ${entry.specialAgeAwards.join(' / ')}` : ''}
                          {entry.timingMethod === 'gun' ? ' · Gun time' : ''}
                        </span>
                        <span className="sm:hidden block mt-1 font-mono text-xs font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                          <RaceTimeText value={entry.finishTime} />
                          {entry.finishReviewRequired && <span className="ml-2 text-amber-800 dark:text-amber-300">Provisional · finish review</span>}
                        </span>
                      </span>
                      <span className="hidden sm:block shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        <RaceTimeText value={entry.finishTime} />
                        {entry.finishReviewRequired && <span className="block text-xs text-amber-800 dark:text-amber-300">Provisional · finish review</span>}
                      </span>
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handleDownloadCertificate(entry)}
                        className="shrink-0 min-h-11 min-w-11 rounded-full border border-red-700/30 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-700 hover:text-white disabled:opacity-60 transition-all duration-150 flex items-center justify-center motion-safe:active:scale-95"
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
