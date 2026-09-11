import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { CirclePlay, ExternalLink, MapPinned, Radio, RefreshCw, Save, Trophy, Users2 } from 'lucide-react';
import { db } from '../firebase';
import { computeResults, getCheckpointByType } from '../lib/timing';
import { embeddableMapUrl, safeExternalUrl, youtubeEmbedUrl } from '../lib/liveBroadcast';
import { ChipRead, PublicLeaderboardEntry, PublicLiveResults, Race, RunnerProfile } from '../types';

interface LiveBroadcastPanelProps {
  uid: string;
}

// The organizer's publishing desk. It exposes only a compact result summary to
// spectators; private raw reads and registration data stay in their protected
// collections.
export default function LiveBroadcastPanel({ uid }: LiveBroadcastPanelProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [activeRaceId, setActiveRaceId] = useState('');
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[]>([]);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [livestreamUrl, setLivestreamUrl] = useState('');
  const [routeMapUrl, setRouteMapUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');
  const publishingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'races'), where('createdBy', '==', uid)), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((raceDoc) => list.push(raceDoc.data() as Race));
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setRaces(list);
      setActiveRaceId((current) => current && list.some((race) => race.id === current) ? current : (list[0]?.id || ''));
    }, (error) => console.warn('Live broadcast races listener failed:', error.message));
    return () => unsubscribe();
  }, [uid]);

  const activeRace = races.find((race) => race.id === activeRaceId);

  useEffect(() => {
    setEnabled(!!activeRace?.liveBroadcastEnabled);
    setLivestreamUrl(activeRace?.livestreamUrl || '');
    setRouteMapUrl(activeRace?.routeMapUrl || '');
    setMessage('');
  }, [activeRace?.id, activeRace?.liveBroadcastEnabled, activeRace?.livestreamUrl, activeRace?.routeMapUrl]);

  useEffect(() => {
    if (!activeRace) {
      setRunnerProfiles([]);
      setChipReads([]);
      return;
    }
    const runnersUnsubscribe = onSnapshot(query(collection(db, 'runners'), where('raceId', '==', activeRace.id)), (snapshot) => {
      const list: RunnerProfile[] = [];
      snapshot.forEach((runnerDoc) => list.push(runnerDoc.data() as RunnerProfile));
      setRunnerProfiles(list);
    }, (error) => console.warn('Live broadcast runner listener failed:', error.message));
    const readsUnsubscribe = onSnapshot(query(collection(db, 'chipReads'), where('raceId', '==', activeRace.id)), (snapshot) => {
      const list: ChipRead[] = [];
      snapshot.forEach((readDoc) => list.push(readDoc.data() as ChipRead));
      setChipReads(list);
    }, (error) => console.warn('Live broadcast timing listener failed:', error.message));
    return () => {
      runnersUnsubscribe();
      readsUnsubscribe();
    };
  }, [activeRace?.id]);

  const results = useMemo(
    () => activeRace ? computeResults(activeRace.checkpoints, chipReads, runnerProfiles) : [],
    [activeRace, chipReads, runnerProfiles]
  );
  const startedCount = useMemo(() => {
    if (!activeRace) return 0;
    const start = getCheckpointByType(activeRace.checkpoints, 'start') || activeRace.checkpoints[0];
    return start ? new Set(chipReads.filter((read) => read.checkpointId === start.id).map((read) => read.bibNumber)).size : 0;
  }, [activeRace, chipReads]);
  const finishedCount = results.filter((result) => !!result.finishTime).length;

  const publishResults = useCallback(async (quiet = false) => {
    if (!activeRace || publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    try {
      const leaders: PublicLeaderboardEntry[] = activeRace.distances.flatMap((distance) => results
        .filter((result) => result.runnerProfile?.distance === distance.label && result.finishTime && result.rank)
        .slice(0, 5)
        .map((result) => ({
          bibNumber: result.bibNumber,
          fullName: result.runnerProfile?.fullName || `Bib ${result.bibNumber}`,
          distance: distance.label,
          rank: result.rank!,
          finishTime: result.finishTime!,
        }))
      );
      const hasWaveStarted = Object.keys(activeRace.waveStartTimes || {}).length > 0 || !!activeRace.gunStartTime;
      const summary: PublicLiveResults = {
        raceId: activeRace.id,
        raceName: activeRace.name,
        updatedAt: new Date().toISOString(),
        status: finishedCount > 0 && finishedCount === runnerProfiles.length ? 'completed' : hasWaveStarted ? 'live' : 'upcoming',
        totalRegistered: runnerProfiles.length,
        totalStarted: startedCount,
        totalFinished: finishedCount,
        leaders,
      };
      await setDoc(doc(db, 'liveResults', activeRace.id), summary);
      if (!quiet) setMessage('Live leaderboard published. It will update automatically with new scans.');
    } catch (error: any) {
      if (!quiet) setMessage(error.message || 'Could not publish the live leaderboard.');
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }, [activeRace, finishedCount, results, runnerProfiles.length, startedCount]);

  // Once public broadcast is enabled, every incoming timing scan republishes a
  // small aggregate after a short debounce. This avoids exposing chipReads and
  // avoids a write per individual UI render.
  useEffect(() => {
    if (!activeRace?.liveBroadcastEnabled) return;
    const timeout = window.setTimeout(() => { void publishResults(true); }, 700);
    return () => window.clearTimeout(timeout);
  }, [activeRace?.liveBroadcastEnabled, activeRace?.id, chipReads, publishResults, runnerProfiles]);

  const handleSave = async () => {
    if (!activeRace) return;
    const cleanStream = livestreamUrl.trim();
    const cleanMap = routeMapUrl.trim();
    if (cleanStream && !safeExternalUrl(cleanStream)) return setMessage('Use a valid https:// or http:// livestream link.');
    if (cleanMap && !safeExternalUrl(cleanMap)) return setMessage('Use a valid https:// or http:// map link.');
    setSaving(true);
    setMessage('');
    try {
      await updateDoc(doc(db, 'races', activeRace.id), {
        liveBroadcastEnabled: enabled,
        livestreamUrl: cleanStream,
        routeMapUrl: cleanMap,
      });
      setMessage(enabled ? 'Live Race Hub is public. Timing updates will publish automatically.' : 'Live Race Hub is hidden from public visitors.');
    } catch (error: any) {
      setMessage(error.message || 'Could not save broadcast settings.');
    } finally {
      setSaving(false);
    }
  };

  const streamEmbed = youtubeEmbedUrl(livestreamUrl);
  const mapEmbed = embeddableMapUrl(routeMapUrl);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn">
      <div className="text-center">
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">Live Race Hub</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Publish the livestream, course map, and a real-time public leaderboard.</p>
      </div>

      {races.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <Radio className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <p className="text-sm font-bold text-[var(--text-primary)] mt-3">Create a race first</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Your races will appear here for live broadcast setup.</p>
        </div>
      ) : (
        <>
          <div className="glass-panel p-5 space-y-5">
            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race event</span>
              <select value={activeRaceId} onChange={(event) => setActiveRaceId(event.target.value)} className="w-full glass-inset px-4 py-3 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                {races.map((race) => <option key={race.id} value={race.id}>{race.name} · {race.date}</option>)}
              </select>
            </label>

            <label className="flex items-start gap-3 glass-inset px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5 w-4 h-4 accent-red-600" />
              <span>
                <span className="block text-sm font-bold text-[var(--text-primary)]">Make this race publicly live</span>
                <span className="block text-xs text-[var(--text-secondary)] mt-0.5">Spectators can view the map, stream link, and published race results without logging in.</span>
              </span>
            </label>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5"><CirclePlay className="w-3.5 h-3.5 text-red-500" /> Livestream link</span>
                <input value={livestreamUrl} onChange={(event) => setLivestreamUrl(event.target.value)} placeholder="YouTube Live or Facebook Live URL" className="w-full glass-inset px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
                <span className="block text-[11px] text-[var(--text-muted)] mt-1">YouTube Live plays inside the hub. Other providers open from a safe button.</span>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5 mb-1.5"><MapPinned className="w-3.5 h-3.5 text-red-500" /> Course map link</span>
                <input value={routeMapUrl} onChange={(event) => setRouteMapUrl(event.target.value)} placeholder="Google Maps embed or route share URL" className="w-full glass-inset px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
                <span className="block text-[11px] text-[var(--text-muted)] mt-1">Use a Google Maps Embed link or OpenStreetMap embed for an in-page map.</span>
              </label>
            </div>

            <button onClick={handleSave} disabled={saving} className="w-full sm:w-auto text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Live Hub
            </button>
            {message && <p className={`text-xs font-semibold ${message.startsWith('Could not') || message.startsWith('Use a valid') ? 'text-red-500' : 'text-emerald-500'}`}>{message}</p>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="glass-panel p-5 lg:col-span-1 space-y-3">
              <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><Users2 className="w-4 h-4 text-red-500" /> Live Timing Feed</h3>
              <p className="text-sm font-black text-[var(--text-primary)]">{startedCount} started · {finishedCount} finished</p>
              <p className="text-xs text-[var(--text-secondary)]">{runnerProfiles.length} registered runners. When public live mode is on, every new checkpoint scan refreshes the spectator leaderboard.</p>
              <button onClick={() => void publishResults()} disabled={!enabled || publishing} className="w-full text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-[var(--radius-control)] bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2 transition disabled:opacity-50">
                {publishing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />} Publish Leaderboard Now
              </button>
            </div>
            <div className="glass-panel p-5 lg:col-span-2">
              <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">Public Preview</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="glass-inset min-h-32 p-3 flex items-center justify-center">
                  {streamEmbed ? <iframe title="Livestream preview" src={streamEmbed} className="w-full aspect-video rounded-xl" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : safeExternalUrl(livestreamUrl) ? <a href={safeExternalUrl(livestreamUrl)} target="_blank" rel="noreferrer" className="text-xs font-bold text-red-500 flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Open livestream</a> : <span className="text-xs text-[var(--text-muted)]">No livestream link yet</span>}
                </div>
                <div className="glass-inset min-h-32 p-3 flex items-center justify-center">
                  {mapEmbed ? <iframe title="Course map preview" src={mapEmbed} className="w-full aspect-video rounded-xl border-0" loading="lazy" /> : safeExternalUrl(routeMapUrl) ? <a href={safeExternalUrl(routeMapUrl)} target="_blank" rel="noreferrer" className="text-xs font-bold text-red-500 flex items-center gap-1.5"><MapPinned className="w-3.5 h-3.5" /> Open course map</a> : <span className="text-xs text-[var(--text-muted)]">No course map link yet</span>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
