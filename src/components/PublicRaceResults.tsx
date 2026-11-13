import { formatDateTime, formatRaceTime } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Calendar, FileDown, Medal, Search, Trophy, UserPlus } from 'lucide-react';
import { ResultsSkeletonList } from './ui/MotionPrimitives';
import { db } from '../firebase';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';
import RouteMap3D from './RouteMap3D';

interface PublicRaceResultsProps {
  race: Race;
  onRegister: (raceId: string) => void;
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
export default function PublicRaceResults({ race, onRegister }: PublicRaceResultsProps) {
  const [summary, setSummary] = useState<PublicLiveResults | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [distance, setDistance] = useState('all');

  useEffect(() => {
    setSummary(undefined);
    setSearch('');
    setDistance('all');
    const unsubscribe = onSnapshot(doc(db, 'liveResults', race.id), (snapshot) => {
      setSummary(snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null);
    }, (error) => {
      console.warn('Public race result listener failed:', error.message);
      setSummary(null);
    });
    return () => unsubscribe();
  }, [race.id]);

  // Do not trust an old/stale leaderboard document on its own: the actual
  // race settings decide when results may become public. This hides any
  // pre-race scanner test records until an organizer starts a wave.
  const raceHasStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
  const resultsArePublic = !!race.completedAt || raceHasStarted;
  const officialResults = resultsArePublic
    ? (summary?.officialResults || []).filter((entry) => entry.distance !== 'Unknown')
    : [];
  const distances = useMemo(() => [...new Set(officialResults.map((entry) => entry.distance))], [officialResults]);
  const filteredResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    return officialResults.filter((entry) => {
      const matchesDistance = distance === 'all' || entry.distance === distance;
      const matchesSearch = !term || entry.fullName.toLowerCase().includes(term) || entry.bibNumber.toLowerCase().includes(term);
      return matchesDistance && matchesSearch;
    });
  }, [distance, officialResults, search]);
  const registrationOpen = isRaceRegistrationOpen(race);

  return (
    <section className="glass-panel overflow-hidden scroll-mt-[84px] animate-fadeIn" aria-label={`${race.name} official results`}>
      <div className="relative p-4 sm:p-6 border-b border-[var(--border-default)] hero-glow overflow-x-clip">
        {race.posterImage && <img src={race.posterImage} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-[0.1]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/35 to-[var(--surface-card)]/90" />
        <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="heading-float font-display text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{race.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                <span>{race.date}</span>
              </p>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-700/30 bg-emerald-700/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Trophy className="w-3.5 h-3.5" aria-hidden="true" /> Official results
              </span>
            </div>
          </div>
          {registrationOpen && (
            <button type="button" onClick={() => onRegister(race.id)} className="shrink-0 min-h-11 h-11 px-5 rounded-full font-semibold text-xs text-white bg-red-700 hover:bg-red-600 border border-[#3d0b09] dark:border-red-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)] transition-[background-color,transform] duration-150 flex items-center justify-center gap-2 motion-safe:active:scale-[0.97]">
              <UserPlus className="w-4 h-4" aria-hidden="true" /> Sign up to register
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
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{officialResults.length} official finishers. Search your name or bib, then download your certificate. Free Slots are identified by bib only.</p>
              </div>
              {summary.updatedAt && <span className="text-xs text-[var(--text-secondary)]">Updated {formatDateTime(summary.updatedAt)}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <label className="relative block">
                <span className="sr-only">Search official finishers by name or bib number</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or bib number" className="w-full glass-inset py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400" />
              </label>
              {distances.length > 1 && <select aria-label="Filter results by distance" value={distance} onChange={(event) => setDistance(event.target.value)} className="min-h-11 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700 dark:focus:ring-red-400"><option value="all">All distances</option>{distances.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            </div>

            {filteredResults.length === 0 ? (
              <p className="glass-inset px-4 py-6 text-center text-xs text-[var(--text-secondary)]">No official result matches &ldquo;{search}&rdquo;.</p>
            ) : (
              <div className="space-y-2 max-h-[38rem] overflow-y-auto pr-1">
                {filteredResults.map((entry) => (
                  <div key={`${entry.distance}_${entry.rank}_${entry.bibNumber}`} className="glass-inset px-3 py-3 sm:px-4 flex items-center gap-3">
                    <span className="w-8 text-center font-mono font-semibold text-red-700 dark:text-red-400 shrink-0">#{entry.overallRank ?? entry.rank}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName}</span><span className="block mt-1 text-xs text-[var(--text-secondary)]">{entry.distance} · Bib #{entry.bibNumber}{entry.categoryRank ? ` · ${entry.categoryLabel || 'Category'} #${entry.categoryRank}` : ''}{entry.specialAgeAwards?.length ? ` · ${entry.specialAgeAwards.join(' / ')}` : ''}{entry.timingMethod === 'gun' ? ' · Gun time' : ''}</span></span>
                    <span className="hidden sm:block shrink-0 font-mono text-sm font-semibold text-emerald-800 dark:text-emerald-300">{formatRaceTime(entry.finishTime)}{entry.finishReviewRequired && <span className="block text-xs text-amber-800 dark:text-amber-300">Provisional · finish review</span>}</span>
                    <button type="button" onClick={() => downloadFinisherCertificate(race, entry, certificateResult(entry))} className="shrink-0 min-h-11 min-w-11 rounded-full border border-red-700/30 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-700 hover:text-white transition-all duration-150 flex items-center justify-center motion-safe:active:scale-95" title={`Download ${entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName}'s certificate`} aria-label={`Download certificate for ${entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName}`}><FileDown className="w-4 h-4" aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
