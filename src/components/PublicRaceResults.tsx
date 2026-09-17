import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Calendar, FileDown, Medal, RefreshCw, Search, Trophy, UserPlus } from 'lucide-react';
import { db } from '../firebase';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';

interface PublicRaceResultsProps {
  race: Race;
  onRegister: (raceId: string) => void;
}

function certificateResult(entry: PublicLeaderboardEntry): RunnerResult {
  return {
    bibNumber: entry.bibNumber,
    finishTime: entry.finishTime,
    rank: entry.rank,
    overallRank: entry.overallRank ?? entry.rank,
    categoryRank: entry.categoryRank,
    categoryLabel: entry.categoryLabel,
    timingMethod: entry.timingMethod,
    splits: [],
  };
}

// Read-only results view. It deliberately reads only the compact public
// `liveResults` record published by the timing console—never raw scan data or
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
    <section className="glass-panel overflow-hidden scroll-mt-6 animate-fadeIn" aria-label={`${race.name} official results`}>
      <div className="relative px-5 py-6 sm:px-7 sm:py-8 border-b border-[var(--border-default)] overflow-hidden">
        {race.posterImage && <img src={race.posterImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.1]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/35 to-[var(--surface-panel)]/85" />
        <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-500"><Trophy className="w-3.5 h-3.5" /> Official Results</span>
            <h2 className="heading-float mt-3 text-xl sm:text-2xl font-black font-display uppercase tracking-tight text-[var(--text-primary)]">{race.name}</h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><Calendar className="w-3.5 h-3.5 text-red-500" /> {race.date}</p>
          </div>
          {registrationOpen && (
            <button type="button" onClick={() => onRegister(race.id)} className="shrink-0 px-4 py-2.5 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition flex items-center justify-center gap-2">
              <UserPlus className="w-4 h-4" /> Sign up to register
            </button>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-7 space-y-4">
        {summary === undefined ? (
          <div className="glass-inset p-8 text-center"><RefreshCw className="w-5 h-5 animate-spin text-[var(--text-muted)] mx-auto" /></div>
        ) : summary === null || officialResults.length === 0 ? (
          <div className="glass-inset px-5 py-8 text-center space-y-2">
            <Medal className="w-8 h-8 mx-auto text-[var(--text-muted)]" />
            <p className="text-sm font-bold text-[var(--text-primary)]">Official results are not published yet</p>
            <p className="text-xs text-[var(--text-secondary)]">Results and E-certificates become available after the organizer starts the race and records finishers.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">Official Ranking</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{officialResults.length} official finishers. Search your name or bib, then download your certificate.</p>
              </div>
              {summary.updatedAt && <span className="text-[10px] text-[var(--text-muted)]">Updated {new Date(summary.updatedAt).toLocaleString()}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or bib number" className="w-full glass-inset py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
              </label>
              {distances.length > 1 && <select value={distance} onChange={(event) => setDistance(event.target.value)} className="glass-inset px-3 py-3 text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"><option value="all">All distances</option>{distances.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
            </div>

            {filteredResults.length === 0 ? (
              <p className="glass-inset px-4 py-6 text-center text-xs text-[var(--text-secondary)]">No official result matches “{search}”.</p>
            ) : (
              <div className="space-y-1.5 max-h-[38rem] overflow-y-auto pr-1">
                {filteredResults.map((entry) => (
                  <div key={`${entry.distance}_${entry.rank}_${entry.bibNumber}`} className="glass-inset px-3 py-3 sm:px-4 flex items-center gap-3">
                    <span className="w-8 text-center font-mono font-black text-red-500 shrink-0">#{entry.overallRank ?? entry.rank}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-[var(--text-primary)]">{entry.fullName}</span><span className="block mt-0.5 text-[10.5px] text-[var(--text-secondary)]">{entry.distance} · Bib #{entry.bibNumber}{entry.categoryRank ? ` · ${entry.categoryLabel || 'Category'} #${entry.categoryRank}` : ''}{entry.timingMethod === 'gun' ? ' · Gun time' : ''}</span></span>
                    <span className="hidden sm:block shrink-0 font-mono text-sm font-black text-emerald-500">{entry.finishTime}</span>
                    <button type="button" onClick={() => downloadFinisherCertificate(race, entry, certificateResult(entry))} className="shrink-0 rounded-xl border border-red-500/25 bg-red-500/10 p-2 text-red-500 hover:bg-red-500 hover:text-white transition" title={`Download ${entry.fullName}'s certificate`} aria-label={`Download certificate for ${entry.fullName}`}><FileDown className="w-4 h-4" /></button>
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
