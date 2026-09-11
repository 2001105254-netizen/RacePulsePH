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
  const status = summary?.status || 'upcoming';
  const statusLabel = status === 'live' ? 'Live now' : status === 'completed' ? 'Race complete' : 'Upcoming';
  const statusClass = status === 'live'
    ? 'bg-red-500/10 border-red-500/30 text-red-500'
    : status === 'completed'
      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
      : 'bg-amber-500/10 border-amber-500/30 text-amber-500';
  const officialResults = summary?.officialResults || [];
  const filteredOfficialResults = officialResults.filter((result) => {
    const term = resultSearch.trim().toLowerCase();
    return !term || result.fullName.toLowerCase().includes(term) || result.bibNumber.toLowerCase().includes(term);
  });

  return (
    <section className="max-w-6xl mx-auto glass-panel overflow-hidden animate-fadeIn">
      <div className="p-5 sm:p-7 border-b border-[var(--border-default)]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full border ${statusClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-red-500 animate-pulse' : 'bg-current'}`} /> {statusLabel}
            </span>
            <h2 className="heading-float mt-3 text-xl sm:text-2xl font-black font-display uppercase tracking-tight text-[var(--text-primary)]">Live Race Hub</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{activeRace.name} · {activeRace.date}</p>
          </div>
          {races.length > 1 && (
            <label className="block sm:w-64">
              <span className="sr-only">Choose live race</span>
              <select value={activeRaceId} onChange={(event) => setActiveRaceId(event.target.value)} className="w-full glass-inset px-3 py-2.5 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                {races.map((race) => <option key={race.id} value={race.id}>{race.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><CirclePlay className="w-4 h-4 text-red-500" /> Race Broadcast</h3>
          {streamEmbed ? (
            <iframe title={`${activeRace.name} livestream`} src={streamEmbed} className="w-full aspect-video rounded-2xl border border-[var(--border-default)] bg-black" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          ) : streamUrl ? (
            <a href={streamUrl} target="_blank" rel="noreferrer" className="glass-inset min-h-40 px-5 py-6 flex flex-col items-center justify-center text-center gap-3 hover:border-red-500/40 transition">
              <CirclePlay className="w-9 h-9 text-red-500" />
              <span className="text-sm font-bold text-[var(--text-primary)]">Open the live broadcast</span>
              <span className="text-xs text-[var(--text-secondary)]">This provider opens in a new tab.</span>
              <span className="text-xs font-black uppercase tracking-wide text-red-500 flex items-center gap-1">Watch live <ExternalLink className="w-3.5 h-3.5" /></span>
            </a>
          ) : (
            <div className="glass-inset min-h-40 px-5 py-6 flex flex-col items-center justify-center text-center gap-2">
              <CirclePlay className="w-8 h-8 text-[var(--text-muted)]" />
              <span className="text-sm font-bold text-[var(--text-primary)]">Livestream coming soon</span>
              <span className="text-xs text-[var(--text-secondary)]">The organizer has not added a stream link yet.</span>
            </div>
          )}

          <h3 className="pt-2 text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><MapPinned className="w-4 h-4 text-red-500" /> Course Map</h3>
          {mapEmbed ? (
            <iframe title={`${activeRace.name} course map`} src={mapEmbed} className="w-full aspect-video rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)]" loading="lazy" />
          ) : mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noreferrer" className="glass-inset px-5 py-4 text-sm font-bold text-red-500 hover:border-red-500/40 transition flex items-center justify-center gap-2">
              <MapPinned className="w-4 h-4" /> Open course map <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <div className="glass-inset px-5 py-4 text-center text-xs text-[var(--text-secondary)]">Course map will be posted by the organizer.</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><Trophy className="w-4 h-4 text-red-500" /> Live Leaderboard</h3>
            {summary?.updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {new Date(summary.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </div>

          {summary === undefined ? (
            <div className="glass-inset p-8 text-center"><RefreshCw className="w-5 h-5 text-[var(--text-muted)] animate-spin mx-auto" /></div>
          ) : summary === null ? (
            <div className="glass-inset p-6 text-center space-y-2">
              <Radio className="w-7 h-7 text-[var(--text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--text-primary)]">Waiting for live timing</p>
              <p className="text-xs text-[var(--text-secondary)]">The organizer will publish results as the race starts.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="glass-inset p-3 text-center"><Users2 className="w-4 h-4 text-red-500 mx-auto mb-1" /><p className="text-lg font-mono font-black text-[var(--text-primary)]">{summary.totalRegistered}</p><p className="text-[10px] uppercase font-bold tracking-wide text-[var(--text-muted)]">Registered</p></div>
                <div className="glass-inset p-3 text-center"><Radio className="w-4 h-4 text-red-500 mx-auto mb-1" /><p className="text-lg font-mono font-black text-[var(--text-primary)]">{summary.totalStarted}</p><p className="text-[10px] uppercase font-bold tracking-wide text-[var(--text-muted)]">Started</p></div>
                <div className="glass-inset p-3 text-center"><Trophy className="w-4 h-4 text-emerald-500 mx-auto mb-1" /><p className="text-lg font-mono font-black text-[var(--text-primary)]">{summary.totalFinished}</p><p className="text-[10px] uppercase font-bold tracking-wide text-[var(--text-muted)]">Finished</p></div>
              </div>
              {summary.leaders.length === 0 ? (
                <div className="glass-inset p-6 text-center text-xs text-[var(--text-secondary)]">Finishers and category leaders will appear here as timing scans arrive.</div>
              ) : (
                <div className="space-y-2 max-h-[27rem] overflow-y-auto">
                  {summary.leaders.map((leader) => (
                    <div key={`${leader.distance}_${leader.rank}_${leader.bibNumber}`} className="glass-inset px-4 py-3 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center text-xs font-mono font-black shrink-0">{leader.rank}</span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[var(--text-primary)] truncate">{leader.fullName}</span><span className="block text-[11px] text-[var(--text-secondary)]">{leader.distance} · #{leader.bibNumber}</span></span>
                      <span className="font-mono font-black text-sm text-emerald-500 shrink-0">{leader.finishTime}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-5 mt-5 border-t border-[var(--border-default)] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">Full Official Results</h4>
                  <span className="text-[11px] font-bold text-[var(--text-muted)]">{officialResults.length} finishers</span>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search name or bib number" className="w-full glass-inset pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" aria-label="Search official results" />
                </div>
                {officialResults.length === 0 ? (
                  <p className="glass-inset px-4 py-5 text-center text-xs text-[var(--text-secondary)]">Official finisher results will appear after the first Finish scan.</p>
                ) : filteredOfficialResults.length === 0 ? (
                  <p className="glass-inset px-4 py-5 text-center text-xs text-[var(--text-secondary)]">No official result matches “{resultSearch}”.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[30rem] overflow-y-auto pr-1">
                    {filteredOfficialResults.map((result) => (
                      <div key={`${result.distance}_${result.rank}_${result.bibNumber}`} className="glass-inset px-4 py-3 flex items-center gap-3">
                        <span className="w-7 text-center font-mono font-black text-red-500 shrink-0">#{result.rank}</span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[var(--text-primary)] truncate">{result.fullName}</span><span className="block text-[11px] text-[var(--text-secondary)]">{result.distance} · Bib #{result.bibNumber}</span></span>
                        <span className="font-mono font-black text-sm text-emerald-500 shrink-0">{result.finishTime}</span>
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
