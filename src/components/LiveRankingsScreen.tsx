import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Trophy, X } from 'lucide-react';
import { Race, RunnerResult } from '../types';
import { groupRankingFolders } from '../lib/rankingFolders';
import { finishScanOrder } from '../lib/liveRankings';
import { runnerDivisionLabel, runnerEntryCategory } from '../lib/raceEntry';
import { getWaveStartTime } from '../lib/timing';

const badge = 'inline-flex items-center rounded-md border px-2 py-1 text-xs sm:text-sm font-bold';
const distanceColor = 'border-red-500/35 bg-red-500/10 text-red-300';
const divisionColor = 'border-white/15 bg-white/[0.06] text-white/80';
const ageColor = 'border-white/25 bg-white/[0.08] text-white/75';

export default function LiveRankingsScreen({ race, results, onClose }: {
  race: Race; results: RunnerResult[]; onClose: () => void;
}) {
  const [distance, setDistance] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const folders = useMemo(() => groupRankingFolders(results), [results]);
  const scanEntries = useMemo(() => finishScanOrder(results, race), [results, race.checkpoints]);
  const nextByBib = useMemo(() => new Map(results.filter((entry) => entry.runnerProfile?.startsAfterBib)
    .map((entry) => [entry.runnerProfile!.startsAfterBib!, entry])), [results]);
  const distanceLabels = useMemo(() => [...new Set([
    ...race.distances.map((item) => item.label), ...folders.map((folder) => folder.distance),
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [race.distances, folders]);
  const folder = folders.find((item) => item.distance === distance);
  const category = folder?.subcategories.find((item) => item.id === categoryId);
  const matchingBibs = useMemo(() => new Set(groupRankingFolders(results, search)
    .flatMap((item) => item.subcategories.filter((sub) => sub.ranking === 'overall')
      .flatMap((sub) => sub.results.map((result) => result.bibNumber)))), [results, search]);
  const categoryBibs = category ? new Set(category.results.map((result) => result.bibNumber)) : null;
  const visibleEntries = scanEntries.filter(({ result }) => matchingBibs.has(result.bibNumber)
    && (distance === 'all' || result.runnerProfile?.distance === distance)
    && (!categoryBibs || categoryBibs.has(result.bibNumber)));
  if (category) visibleEntries.sort((a, b) => category.ranking === 'age'
    ? a.result.categoryRank! - b.result.categoryRank!
    : (a.result.overallRank ?? a.result.rank!) - (b.result.overallRank ?? b.result.rank!));

  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [distance, categoryId, search]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);

  const changeDistance = (value: string) => { setDistance(value); setCategoryId('all'); };
  const navigate = (step: number) => {
    const options = ['all', ...distanceLabels];
    changeDistance(options[(options.indexOf(distance) + step + options.length) % options.length]);
  };
  const name = (result: RunnerResult) => result.runnerProfile?.isFreeSlot
    ? `Bib ${result.bibNumber}` : result.runnerProfile?.fullName || `Bib ${result.bibNumber}`;
  const waveStart = (result: RunnerResult) => result.runnerProfile
    ? getWaveStartTime(race, result.runnerProfile.distance, runnerEntryCategory(result.runnerProfile)) : undefined;
  const formatTime = (timestamp?: string | number) => timestamp !== undefined && Number.isFinite(new Date(timestamp).getTime())
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
  const title = distance === 'all' ? 'All categories · Finish scan order' : `${distance} · ${category?.label || 'Finish scan order'}`;
  const elapsed = (timestamp: string | undefined) => {
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '—';
    const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
  };
  const clockStarts = (category ? category.results.map(waveStart) : Object.values(race.waveStartTimes || {}))
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  const clockStart = clockStarts.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || race.gunStartTime;
  const control = 'rounded-xl border border-white/20 bg-[#19191c] px-3 py-2.5 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400';

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-[#0a0a0c] text-white flex flex-col p-4 sm:p-8 lg:p-12 overflow-y-auto">
      <header className="flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <p className="text-xs sm:text-sm tracking-[0.2em] font-black text-red-400 uppercase">{race.name}</p>
          <h1 className="text-2xl sm:text-4xl font-black font-display uppercase tracking-tight mt-1 flex items-center gap-3"><Trophy aria-hidden="true" className="w-7 h-7 text-red-400 shrink-0" /> Live Rankings</h1>
        </div>
        <div className="flex items-center gap-4 shrink-0"><div className="hidden sm:block text-right"><p className="text-[10px] uppercase tracking-widest text-white/50">{category ? 'Division gun elapsed' : 'First gun elapsed'}</p><p className="font-mono font-black text-xl">{elapsed(clockStart)}</p></div><button type="button" onClick={onClose} aria-label="Close live rankings" className={`${control} p-3 shrink-0`}><X className="w-5 h-5" /></button></div>
      </header>

      <nav aria-label="Live ranking views" className="flex flex-wrap items-end gap-3 mt-5 shrink-0">
        <button type="button" onClick={() => { changeDistance('all'); setSearch(''); }} className={`${control} ${distance === 'all' ? 'border-red-400 bg-red-500/15' : ''}`} aria-pressed={distance === 'all'}>All categories / Scan order</button>
        <label className="flex flex-col gap-1 text-xs text-white/65">Distance
          <select value={distance} onChange={(event) => changeDistance(event.target.value)} className={control}><option value="all">All distances</option>{distanceLabels.map((label) => <option key={label} value={label}>{label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/65">Category
          <select value={categoryId} disabled={distance === 'all'} onChange={(event) => setCategoryId(event.target.value)} className={`${control} disabled:opacity-50 max-w-[min(80vw,22rem)]`}><option value="all">All categories · Scan order</option>{folder?.subcategories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous distance" onClick={() => navigate(-1)} className={control}><ChevronLeft className="w-5 h-5" /></button>
          <button type="button" aria-label="Next distance" onClick={() => navigate(1)} className={control}><ChevronRight className="w-5 h-5" /></button>
        </div>
        <label className="relative flex-1 min-w-48">
          <span className="sr-only">Search live rankings by name or bib</span><Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or bib" className={`${control} w-full pl-9`} />
        </label>
      </nav>

      <div className="flex flex-wrap gap-2 mt-4 shrink-0" aria-label="Choose a distance">{distanceLabels.map((label) => <button key={label} type="button" onClick={() => changeDistance(label)} aria-pressed={distance === label} className={`${badge} ${distanceColor} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${distance === label ? 'ring-1 ring-red-400' : ''}`}>{label}</button>)}</div>
      <p className="mt-2 text-[11px] text-white/50">Red identifies race categories · 1st, 2nd, and 3rd places use podium colors · Amber: next entry running · Green: next entry finished</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mt-5 mb-3 shrink-0">
        <h2 className="text-lg sm:text-2xl font-black font-display">{title}</h2>
        <p role="status" className="text-xs text-white/60">{visibleEntries.length} finisher{visibleEntries.length === 1 ? '' : 's'} · {category ? 'Official category places' : 'Scan # is arrival order, not an overall rank'}</p>
      </div>
      <div ref={listRef} className="flex-1 min-h-40 overflow-y-auto space-y-2 pr-1" aria-label={title}>
        {visibleEntries.length === 0 && <p className="py-10 text-center text-white/60">{search ? 'No finishers match your search.' : 'Waiting for finishers in this view…'}</p>}
        {visibleEntries.map(({ result, scanOrder, finishedAt }) => {
          const rank = category?.ranking === 'age' ? result.categoryRank! : result.overallRank ?? result.rank!;
          const distanceLabel = result.runnerProfile?.distance || 'Unknown';
          const nextEntry = nextByBib.get(result.bibNumber);
          return (
            <div key={result.bibNumber} className={`flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-5 px-4 sm:px-6 py-4 rounded-2xl ${category && rank <= 3 ? 'bg-white/10 border border-white/10' : 'bg-white/5'}`}>
              <div className="w-14 sm:w-20 shrink-0 text-center"><span className="block text-[10px] uppercase tracking-wider text-white/50">{category ? 'Place' : 'Scan'}</span><span className={`font-mono font-black text-2xl sm:text-3xl ${rank === 1 ? 'text-red-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-500' : 'text-white/70'}`}>{category ? rank : scanOrder}</span></div>
              <div className="flex-1 min-w-0">
                <p className="text-base sm:text-xl font-bold break-words">{name(result)}</p>
                <p className="text-xs text-white/50 mt-1">Bib #{result.bibNumber} · Finish scan {formatTime(finishedAt)}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className={`${badge} ${distanceColor}`}>{distanceLabel}</span>
                  <span className={`${badge} ${divisionColor}`}>{runnerDivisionLabel(result.runnerProfile)} · #{result.overallRank ?? result.rank}</span>
                  {result.categoryRank !== undefined && result.categoryLabel && <span className={`${badge} ${ageColor}`}>{result.categoryLabel} · #{result.categoryRank}</span>}
                  {result.runnerProfile?.startsAfterBib && <span className={`${badge} border-amber-300/40 bg-amber-400/15 text-amber-200`}>Started after bib #{result.runnerProfile.startsAfterBib}</span>}
                  {nextEntry && <span className={`${badge} ${nextEntry.finishTime ? 'border-emerald-300/40 bg-emerald-400/15 text-emerald-200' : 'border-amber-300/40 bg-amber-400/15 text-amber-200'}`}>Next: {runnerDivisionLabel(nextEntry.runnerProfile)} · Bib #{nextEntry.bibNumber} · {nextEntry.finishTime ? `Finished ${nextEntry.finishTime}` : nextEntry.sequenceStartTime ? `Running ${elapsed(nextEntry.sequenceStartTime)}` : 'Waiting'}</span>}
                </div>
              </div>
              <div className="w-full sm:w-auto sm:text-right sm:shrink-0 pl-[4.25rem] sm:pl-0">
                <p className="font-mono font-black text-xl sm:text-3xl">{result.finishTime}</p>
                {result.finishReviewRequired && <p role="status" className="text-sm font-bold text-amber-200">Provisional place · Needs finish review</p>}
                <p className="text-[11px] text-white/55">Official {result.timingMethod === 'transition' ? 'consecutive entry' : result.timingMethod === 'gun' ? 'gun' : 'chip'} time</p>
                {result.sequenceStartTime && <p className="text-xs text-amber-200 mt-1">Entry start {formatTime(result.sequenceStartTime)}</p>}
                <p className="text-xs text-amber-200 mt-1">Gun elapsed {result.gunTime || '—'}</p>
                <p className="text-[11px] text-white/50">Division start {formatTime(waveStart(result))}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="shrink-0 text-center text-[10px] sm:text-xs text-white/40 mt-4">Six decimals show recorded precision; accuracy depends on equipment · Updates live · Selection stays on screen · Press Esc to exit</p>
    </div>
  );
}
