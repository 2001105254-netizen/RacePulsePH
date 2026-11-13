import { formatClockTime, formatRaceTime } from '../lib/preciseTime';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { CirclePlay, ExternalLink, MapPinned, Radio, RefreshCw, Search, Trophy, Users2 } from 'lucide-react';
import { db } from '../firebase';
import { embeddableMapUrl, safeExternalUrl, youtubeEmbedUrl } from '../lib/liveBroadcast';
import { PublicLiveResults, Race } from '../types';

interface PublicLiveRaceHubProps {
  races: Race[];
}

// A read-only spectator surface. Its Firestore source is the compact
// liveResults document, not the private per-runner timing feed.
export default function PublicLiveRaceHub({ races }: PublicLiveRaceHubProps) {
  const [activeRaceId, setActiveRaceId] = useState(races[0]?.id || '');
  const [summary, setSummary] = useState<PublicLiveResults | null | undefined>(undefined);
  const [resultSearch, setResultSearch] = useState('');

  useEffect(() => {
    setActiveRaceId((current) => current && races.some((race) => race.id === current) ? current : (races[0]?.id || ''));
  }, [races]);

  const activeRace = useMemo(() => races.find((race) => race.id === activeRaceId), [activeRaceId, races]);

  useEffect(() => {
    if (!activeRace) {
      setSummary(null);
      return;
    }
    setSummary(undefined);
    const unsubscribe = onSnapshot(doc(db, 'liveResults', activeRace.id), (snapshot) => {
      setSummary(snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null);
    }, (error) => {
      console.warn('Public live results listener failed:', error.message);
      setSummary(null);
    });
    return () => unsubscribe();
  }, [activeRace?.id]);

  if (!activeRace) return null;

  const streamUrl = safeExternalUrl(activeRace.livestreamUrl);
  const streamEmbed = youtubeEmbedUrl(activeRace.livestreamUrl);
  const mapUrl = safeExternalUrl(activeRace.routeMapUrl);
  const mapEmbed = embeddableMapUrl(activeRace.routeMapUrl);
  // The race record is the source of truth. A stale public summary from a
  // pre-race scanner test must not make an upcoming event appear finished.
  const raceHasStarted = Object.keys(activeRace.waveStartTimes || {}).length > 0 || !!activeRace.gunStartTime;
  const resultsArePublic = !!activeRace.completedAt || raceHasStarted;
  const status = activeRace.completedAt ? 'completed' : raceHasStarted ? 'live' : 'upcoming';
  const statusLabel = status === 'live' ? 'Live now' : status === 'completed' ? 'Race complete' : 'Upcoming';
  const statusClass = status === 'live'
    ? 'bg-red-700/10 border-red-700/30 text-red-800 dark:bg-red-500/15 dark:border-red-500/30 dark:text-red-300'
    : status === 'completed'
      ? 'bg-emerald-700/10 border-emerald-700/30 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300'
      : 'bg-amber-700/10 border-amber-700/30 text-amber-900 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300';
  const officialResults = resultsArePublic
    ? (summary?.officialResults || []).filter((entry) => entry.distance !== 'Unknown')
    : [];
  const filteredOfficialResults = officialResults.filter((result) => {
    const term = resultSearch.trim().toLowerCase();
    return !term || result.fullName.toLowerCase().includes(term) || result.bibNumber.toLowerCase().includes(term);
  });

  return (
    <section className="w-full glass-panel overflow-hidden animate-fadeIn">
      <div className="p-4 sm:p-6 border-b border-[var(--border-default)] hero-glow">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h3 className="heading-float text-xl sm:text-2xl font-semibold font-display tracking-tight text-[var(--text-primary)]">{activeRace.name}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-xs text-[var(--text-secondary)]">{activeRace.date}</p>
              <span className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full border ${statusClass}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" /> {statusLabel}
              </span>
            </div>
          </div>
          {races.length > 1 && (
            <label className="block sm:w-64">
              <span className="sr-only">Choose live race</span>
              <select value={activeRaceId} onChange={(event) => setActiveRaceId(event.target.value)} className="w-full min-h-11 glass-inset px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50">
                {races.map((race) => <option key={race.id} value={race.id}>{race.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><CirclePlay className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Race broadcast</h4>
          {streamEmbed ? (
            <iframe title={`${activeRace.name} livestream`} src={streamEmbed} className="w-full aspect-video rounded-2xl border border-[var(--border-default)] bg-black" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          ) : streamUrl ? (
            <a href={streamUrl} target="_blank" rel="noreferrer" className="glass-inset min-h-40 px-5 py-6 flex flex-col items-center justify-center text-center gap-3 hover:border-red-500/40 transition">
              <CirclePlay className="w-9 h-9 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Open the live broadcast</span>
              <span className="text-xs text-[var(--text-secondary)]">This provider opens in a new tab.</span>
              <span className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1">Watch live <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></span>
            </a>
          ) : (
            <div className="glass-inset min-h-40 px-5 py-6 flex flex-col items-center justify-center text-center gap-2">
              <CirclePlay className="w-8 h-8 text-[var(--text-secondary)]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Livestream coming soon</span>
              <span className="text-xs text-[var(--text-secondary)]">The organizer has not added a stream link yet.</span>
            </div>
          )}

          <h4 className="pt-2 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPinned className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Course map</h4>
          {mapEmbed ? (
            <iframe title={`${activeRace.name} course map`} src={mapEmbed} className="w-full aspect-video rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]" loading="lazy" />
          ) : mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="min-h-11 glass-inset px-5 py-3 text-sm font-semibold text-red-700 dark:text-red-400 hover:border-red-700/40 dark:hover:border-red-400/40 transition flex items-center justify-center gap-2">
              <MapPinned className="w-4 h-4" /> Open course map <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <div className="glass-inset px-5 py-4 text-center text-xs text-[var(--text-secondary)]">Course map will be posted by the organizer.</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Trophy className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Live leaderboard</h4>
            {summary?.updatedAt && <span className="text-xs text-[var(--text-secondary)]">Updated {formatClockTime(summary.updatedAt)}</span>}
          </div>

          {summary === undefined ? (
            <div className="glass-inset p-8 text-center flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)]" role="status">
              <RefreshCw className="w-4 h-4 text-[var(--text-secondary)] motion-safe:animate-spin" aria-hidden="true" />
              <span>Loading live checkpoint splits...</span>
            </div>
          ) : summary === null ? (
            <div className="glass-inset p-6 text-center space-y-2">
              <Radio className="w-7 h-7 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Waiting for live timing</p>
              <p className="text-xs text-[var(--text-secondary)]">The organizer will publish results as the race starts.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="glass-inset p-3 text-center"><Users2 className="w-4 h-4 text-red-700 dark:text-red-400 mx-auto mb-1" aria-hidden="true" /><p className="text-lg font-mono font-semibold text-[var(--text-primary)]">{summary.totalRegistered}</p><p className="text-xs font-semibold text-[var(--text-secondary)]">Registered</p></div>
                <div className="glass-inset p-3 text-center"><Radio className="w-4 h-4 text-red-700 dark:text-red-400 mx-auto mb-1" aria-hidden="true" /><p className="text-lg font-mono font-semibold text-[var(--text-primary)]">{summary.totalStarted}</p><p className="text-xs font-semibold text-[var(--text-secondary)]">Started</p></div>
                <div className="glass-inset p-3 text-center"><Trophy className="w-4 h-4 text-emerald-700 dark:text-emerald-400 mx-auto mb-1" aria-hidden="true" /><p className="text-lg font-mono font-semibold text-[var(--text-primary)]">{summary.totalFinished}</p><p className="text-xs font-semibold text-[var(--text-secondary)]">Finished</p></div>
              </div>
              {summary.leaders.length === 0 ? (
                <div className="glass-inset p-6 text-center text-xs text-[var(--text-secondary)]">Finishers and category leaders will appear here as timing scans arrive.</div>
              ) : (
                <div className="space-y-2 max-h-[27rem] overflow-y-auto">
                  {summary.leaders.map((leader) => (
                    <div key={`${leader.distance}_${leader.rank}_${leader.bibNumber}`} className="glass-inset px-4 py-3 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-red-700/10 text-red-700 dark:bg-red-500/15 dark:text-red-400 flex items-center justify-center text-xs font-mono font-semibold shrink-0">{leader.rank}</span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{(leader as { isFreeSlot?: boolean }).isFreeSlot ? `Bib ${leader.bibNumber}` : leader.fullName}</span><span className="block text-xs text-[var(--text-secondary)]">{leader.distance} · #{leader.bibNumber}</span></span>
                      <span className="font-mono font-semibold text-sm text-emerald-700 dark:text-emerald-400 shrink-0">{formatRaceTime(leader.finishTime)}{leader.finishReviewRequired && " · Provisional"}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-5 mt-5 border-t border-[var(--border-default)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Full official results</h4>
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">{officialResults.length} finishers</span>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                  <input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search name or bib number" className="w-full min-h-11 glass-inset pl-10 pr-4 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" aria-label="Search official results" />
                </div>
                {officialResults.length === 0 ? (
                  <p className="glass-inset px-4 py-5 text-center text-xs text-[var(--text-secondary)]">Official finisher results will appear after the first Finish scan.</p>
                ) : filteredOfficialResults.length === 0 ? (
                  <p className="glass-inset px-4 py-5 text-center text-xs text-[var(--text-secondary)]">No official result matches “{resultSearch}”.</p>
                ) : (
                  <div className="space-y-2 max-h-[30rem] overflow-y-auto pr-1">
                    {filteredOfficialResults.map((result) => (
                      <div key={`${result.distance}_${result.rank}_${result.bibNumber}`} className="glass-inset px-4 py-3 flex items-center gap-3">
                        <span className="w-7 text-center font-mono font-semibold text-red-700 dark:text-red-400 shrink-0">#{result.rank}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--text-primary)] truncate">{(result as { isFreeSlot?: boolean }).isFreeSlot ? `Bib ${result.bibNumber}` : result.fullName}</span><span className="block text-xs text-[var(--text-secondary)]">{result.distance} · Bib #{result.bibNumber}</span></span>
                        <span className="font-mono font-semibold text-sm text-emerald-700 dark:text-emerald-400 shrink-0">{formatRaceTime(result.finishTime)}{result.finishReviewRequired && " · Provisional"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
