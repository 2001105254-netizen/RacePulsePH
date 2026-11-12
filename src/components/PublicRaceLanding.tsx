import React, { useEffect, useMemo, useState, useRef, Suspense, lazy } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { subscribeSharedRaces } from '../lib/racesStore';
import { AnimatePresence, m } from 'motion/react';
import {
  Calendar,
  Flag,
  UserPlus,
  Search,
  Trophy,
  ArrowRight,
  X,
  CheckCircle2,
  FileDown,
  Link2,
  Check,
  RefreshCw,
} from 'lucide-react';
import { db } from '../firebase';
import { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { isRaceRegistrationOpen, philippineDate } from '../lib/raceRegistration';
import { formatRaceTime } from '../lib/preciseTime';
import {
  CardSkeletonLoader,
  EMIL_EASE,
  QUINT_EASE,
  RaceCardSkeletonGrid,
  ResultsSkeletonList,
} from './ui/MotionPrimitives';

const PublicLiveRaceHub = lazy(() => import('./PublicLiveRaceHub'));
const PublicRaceResults = lazy(() => import('./PublicRaceResults'));

interface PublicRaceLandingProps {
  onRegister: (raceId?: string) => void;
  onLoadState?: (state: 'loading' | 'ready' | 'error') => void;
  revealed?: boolean;
  onActiveRaceTitle?: (raceName: string | null) => void;
}

interface FinisherBibMatch {
  race: Race;
  entry: PublicLeaderboardEntry;
}

// Accent text clears 4.5:1 WCAG AA on both surfaces: red-700 on light, red-400 on dark.
const accentText = 'text-red-700 dark:text-red-400';

// Tactile Stopwatch Chip Tokens (Sports Watch Hardware Language, >= 44px tap height)
const chipBase =
  'min-h-11 text-xs font-semibold px-4 py-2 rounded-full border transition-all duration-150 motion-safe:active:scale-[0.96] select-none shrink-0 inline-flex items-center justify-center gap-1.5 font-mono';
const chipIdle =
  'border border-[var(--border-button)] bg-[var(--surface-card)] dark:bg-[#141416] text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.25)] hover:border-red-600 hover:text-[var(--text-primary)]';
const chipActive =
  'bg-red-700 text-white border border-[#3d0b09] dark:border-red-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)]';

function initialRaceIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('race')?.trim() || '';
}

function syncRaceIdToUrl(raceId: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (raceId) {
    url.searchParams.set('race', raceId);
  } else {
    url.searchParams.delete('race');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function formatReadableRaceDate(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

function formatRaceScheduleNote(race: Race, todayStr: string): string | null {
  if (race.completedAt) return null;
  const toUtcMs = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return NaN;
    return Date.UTC(y, m - 1, d);
  };
  const raceMs = toUtcMs(race.date);
  const todayMs = toUtcMs(todayStr);
  if (Number.isNaN(raceMs) || Number.isNaN(todayMs)) return null;

  const diffDays = Math.round((raceMs - todayMs) / 86_400_000);
  const closeNote =
    race.registrationCloseDate && race.registrationCloseDate < race.date
      ? `Closes ${formatReadableRaceDate(race.registrationCloseDate).replace(/, \d{4}$/, '')}`
      : null;

  if (diffDays === 0) return 'Race day today';
  if (diffDays === 1) return closeNote ? `Tomorrow · ${closeNote}` : 'Tomorrow';
  if (diffDays > 1 && diffDays <= 60) {
    return closeNote ? `In ${diffDays} days · ${closeNote}` : `In ${diffDays} days`;
  }
  return closeNote;
}

function toRunnerResult(entry: PublicLeaderboardEntry): RunnerResult {
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

export default function PublicRaceLanding({
  onRegister,
  onLoadState,
  revealed = true,
  onActiveRaceTitle,
}: PublicRaceLandingProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [resultsByRaceId, setResultsByRaceId] = useState<Record<string, PublicLiveResults>>({});
  const [selectedRaceId, setSelectedRaceId] = useState<string>(() => initialRaceIdFromUrl());
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistanceFilter, setSelectedDistanceFilter] = useState<string>('all');
  const [bibQuery, setBibQuery] = useState('');
  const [copiedRaceId, setCopiedRaceId] = useState<string | null>(null);
  const [downloadingBibKey, setDownloadingBibKey] = useState<string | null>(null);
  const [downloadedBibKey, setDownloadedBibKey] = useState<string | null>(null);
  const [certificateNotice, setCertificateNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [heroOutOfView, setHeroOutOfView] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bibInputRef = useRef<HTMLInputElement>(null);
  const heroSectionRef = useRef<HTMLElement>(null);
  const didInitialUrlScrollRef = useRef(false);

  useEffect(() => {
    onLoadState?.(loadState);
  }, [loadState, onLoadState]);

  useEffect(() => {
    const heroEl = heroSectionRef.current;
    if (!heroEl || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeroOutOfView(!entry.isIntersecting);
      },
      { threshold: 0.08 }
    );
    observer.observe(heroEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Public race list failed to load:', err);
        setRaces([]);
        setLoadState('error');
        return;
      }
      if (!loaded) return;
      const list = [...rawList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setRaces(list);
      setLoadState('ready');
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'liveResults'),
      (snapshot) => {
        const map: Record<string, PublicLiveResults> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as PublicLiveResults;
          map[docSnap.id] = data;
        });
        setResultsByRaceId(map);
      },
      (err) => {
        console.warn('Public liveResults listener failed:', err.message);
      }
    );
    return () => unsubscribe();
  }, []);

  const today = philippineDate();

  const liveRaces = useMemo(() => races.filter((race) => race.liveBroadcastEnabled), [races]);
  const activeRaces = useMemo(() => races.filter((race) => !race.completedAt && race.date >= today), [races, today]);
  const doneRaces = useMemo(() => races.filter((race) => !!race.completedAt || race.date < today), [races, today]);

  const currentTabRaces = activeTab === 'upcoming' ? activeRaces : doneRaces;

  const availableDistances = useMemo(() => {
    const set = new Set<string>();
    races.forEach((race) => {
      (race.distances || []).forEach((d) => {
        if (d.label) set.add(d.label.trim().toUpperCase());
      });
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [races]);

  const filteredRaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return currentTabRaces.filter((race) => {
      const matchesSearch =
        !query ||
        race.name.toLowerCase().includes(query) ||
        race.date.includes(query) ||
        formatReadableRaceDate(race.date).toLowerCase().includes(query) ||
        (race.distances || []).some((d) => d.label.toLowerCase().includes(query));

      const matchesDistance =
        selectedDistanceFilter === 'all' ||
        (race.distances || []).some((d) => d.label.trim().toUpperCase() === selectedDistanceFilter);

      return matchesSearch && matchesDistance;
    });
  }, [currentTabRaces, searchQuery, selectedDistanceFilter]);

  const selectedRace = useMemo(() => races.find((race) => race.id === selectedRaceId), [races, selectedRaceId]);

  // All published official finishers across races that have started or completed
  const allPublishedFinishers = useMemo<FinisherBibMatch[]>(() => {
    const list: FinisherBibMatch[] = [];
    const sortedRaces = [...races].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const race of sortedRaces) {
      const raceHasStarted = Object.keys(race.waveStartTimes || {}).length > 0 || !!race.gunStartTime;
      const resultsArePublic = !!race.completedAt || raceHasStarted;
      if (!resultsArePublic) continue;
      const summary = resultsByRaceId[race.id];
      if (!summary?.officialResults) continue;
      for (const entry of summary.officialResults) {
        if (entry.distance === 'Unknown') continue;
        list.push({ race, entry });
      }
    }
    return list;
  }, [races, resultsByRaceId]);

  const matchingBibResults = useMemo<FinisherBibMatch[]>(() => {
    const term = bibQuery.trim().toLowerCase();
    if (!term) return [];
    return allPublishedFinishers
      .filter(({ entry, race }) => {
        const bibMatch = entry.bibNumber.toLowerCase().includes(term);
        const nameMatch = !entry.isFreeSlot && entry.fullName.toLowerCase().includes(term);
        const raceMatch = race.name.toLowerCase().includes(term);
        return bibMatch || nameMatch || raceMatch;
      })
      .slice(0, 6);
  }, [allPublishedFinishers, bibQuery]);

  // Top podium finishers across recent completed/live races for the Bib Showcase board
  const featuredBibFinishers = useMemo<FinisherBibMatch[]>(() => {
    const podiumOnly = allPublishedFinishers.filter(({ entry }) => (entry.overallRank ?? entry.rank) <= 3);
    return (podiumOnly.length > 0 ? podiumOnly : allPublishedFinishers).slice(0, 6);
  }, [allPublishedFinishers]);

  // Scroll to deep-linked ?race=<id> once races finish loading
  useEffect(() => {
    if (loadState === 'ready' && selectedRace && !didInitialUrlScrollRef.current) {
      didInitialUrlScrollRef.current = true;
      if (selectedRace.completedAt || selectedRace.date < today) {
        setActiveTab('completed');
      }
      requestAnimationFrame(() => {
        document.getElementById('public-race-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [loadState, selectedRace, today]);

  const handleSelectRace = (raceId: string) => {
    didInitialUrlScrollRef.current = true;
    setSelectedRaceId(raceId);
    syncRaceIdToUrl(raceId);
    requestAnimationFrame(() => {
      document.getElementById('public-race-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleCloseSelectedRace = () => {
    setSelectedRaceId('');
    syncRaceIdToUrl('');
  };

  const handleCopyRaceLink = async (raceId: string) => {
    syncRaceIdToUrl(raceId);
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard?.writeText(shareUrl);
    } catch {
      // Fallback if clipboard permission is restricted
    }
    setCopiedRaceId(raceId);
    window.setTimeout(() => {
      setCopiedRaceId((current) => (current === raceId ? null : current));
    }, 2200);
  };

  useEffect(() => {
    onActiveRaceTitle?.(selectedRace ? selectedRace.name : null);
  }, [selectedRace, onActiveRaceTitle]);

  const handleDownloadCertificate = async (race: Race, entry: PublicLeaderboardEntry) => {
    const key = `${race.id}_${entry.bibNumber}_${entry.distance}`;
    setDownloadingBibKey(key);
    setCertificateNotice(null);
    try {
      const { downloadFinisherCertificate } = await import('../lib/finisherCertificate');
      await downloadFinisherCertificate(race, entry, toRunnerResult(entry));
      setDownloadedBibKey(key);
      setCertificateNotice({
        kind: 'success',
        text: `Official finisher certificate prepared for bib ${entry.bibNumber} (${race.name}).`,
      });
      window.setTimeout(() => {
        setDownloadedBibKey((current) => (current === key ? null : current));
      }, 2600);
    } catch {
      setCertificateNotice({
        kind: 'error',
        text: `Could not prepare the certificate for bib ${entry.bibNumber}. Please try again.`,
      });
    } finally {
      setDownloadingBibKey(null);
    }
  };

  const handleSwitchToCompletedAndSearch = () => {
    setActiveTab('completed');
    setSelectedRaceId('');
    syncRaceIdToUrl('');
    requestAnimationFrame(() => {
      document.getElementById('events-catalog')?.scrollIntoView({ behavior: 'smooth' });
      searchInputRef.current?.focus();
    });
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDistanceFilter('all');
  };

  return (
    <main id="main-content" tabIndex={-1} className="w-full max-w-[1600px] mx-auto pl-[max(1rem,var(--rp-safe-left))] pr-[max(1rem,var(--rp-safe-right))] sm:pl-[max(1.5rem,var(--rp-safe-left))] sm:pr-[max(1.5rem,var(--rp-safe-right))] py-4 sm:py-5 pb-[calc(6.5rem+var(--rp-safe-bottom))] md:pb-8 space-y-5 focus:outline-none">
      {/* Network or Data Load Error Banner */}
      {loadState === 'error' && (
        <Card className="border-red-700 dark:border-red-400 p-4 text-center">
          <p role="alert" className="type-lead">
            Could not load events.{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`underline font-semibold ${accentText}`}
            >
              Try again
            </button>
          </p>
        </Card>
      )}

      {/* Unknown ?race= URL parameter notice */}
      {loadState === 'ready' && selectedRaceId && !selectedRace && (
        <div
          role="status"
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm"
        >
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            No active race matched that shared link (<code className="font-mono text-xs">{selectedRaceId}</code>). Browse
            published Philippine races below.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 px-4 text-xs"
            onClick={handleCloseSelectedRace}
          >
            Clear race filter
          </Button>
        </div>
      )}

      {/* Certificate status announcement */}
      <AnimatePresence>
        {certificateNotice && (
          <m.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role={certificateNotice.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm ${certificateNotice.kind === 'error'
                ? 'border-red-600/35 bg-red-50 dark:bg-red-950/35 text-red-700 dark:text-red-300'
                : 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              }`}
          >
            <span className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{certificateNotice.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setCertificateNotice(null)}
              aria-label="Dismiss notification"
              className="min-h-11 min-w-11 -my-2 -mr-2 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </m.div>
        )}
      </AnimatePresence>

      {/* Hero Banner: Theme-native surface in light and dark mode with transparent Philippine runners cutout */}
      <section
        ref={heroSectionRef}
        aria-label="RacePulsePH overview"
        className="glass-panel relative overflow-hidden"
      >
        {/* Luminous light red gradient backdrop consistent with dashboard panel headers */}
        <div aria-hidden="true" className="hero-glow hero-banner-glow pointer-events-none absolute inset-0" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 items-center lg:items-end gap-3">
          {/* Left Copy, Instant Bib Lookup & Action Column */}
          <div className="lg:col-span-7 p-4 sm:p-5 lg:p-6 space-y-3">
            <m.h1
              initial={{ opacity: 0, y: 12 }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              transition={{ duration: 0.24, delay: 0.02, ease: QUINT_EASE }}
              className="type-hero uppercase tracking-tight"
            >
              <span className="heading-float block">Find your next</span>
              <span className="inline-flex flex-col items-start mt-1">
                <span className="hero-finish-accent italic tracking-tight">finish line</span>
                <span aria-hidden="true" className="hero-finish-tape w-full mt-1.5" />
              </span>
            </m.h1>
            <m.p
              initial={{ opacity: 0, y: 10 }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.22, delay: 0.06, ease: QUINT_EASE }}
              className="type-lead max-w-xl text-[var(--text-secondary)] dark:text-white"
            >
              Browse upcoming{' '}
              <span className="font-semibold text-[var(--text-primary)] dark:text-white">RacePulsePH</span> events, compare distances
              and fees, then create an account to secure your spot.
            </m.p>

            {/* Instant Finisher & Bib Lookup Form */}
            <m.form
              initial={{ opacity: 0, y: 10 }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.24, delay: 0.1, ease: QUINT_EASE }}
              role="search"
              aria-label="Finisher result and certificate lookup"
              onSubmit={(e) => {
                e.preventDefault();
                if (!bibQuery.trim()) {
                  handleSwitchToCompletedAndSearch();
                }
              }}
              className="space-y-2 pt-1 max-w-xl"
            >
              <label
                htmlFor="hero-bib-search"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] dark:text-white font-mono"
              >
                Instant finisher &amp; certificate lookup
              </label>
              <div className="flex flex-row items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search
                    className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                    aria-hidden="true"
                  />
                  <Input
                    ref={bibInputRef}
                    id="hero-bib-search"
                    type="search"
                    value={bibQuery}
                    onChange={(e) => setBibQuery(e.target.value)}
                    placeholder="Bib or name"
                    className={`h-11 pl-9 ${bibQuery ? 'pr-9' : 'pr-3'} text-xs sm:text-sm [&::-webkit-search-cancel-button]:hidden`}
                  />
                  {bibQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setBibQuery('');
                        bibInputRef.current?.focus();
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      aria-label="Clear bib search"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <Button type="submit" size="default" className="h-11 px-4 sm:px-5 shrink-0 text-xs">
                  <Trophy className="w-4 h-4" aria-hidden="true" />
                  <span>Find result</span>
                </Button>
              </div>
            </m.form>

            {/* Instant Race Bib Result Matches */}
            {bibQuery.trim().length > 0 && (
              <div
                role="region"
                aria-live="polite"
                aria-label="Matching finisher results"
                className="space-y-2.5 pt-1 max-w-xl"
              >
                {matchingBibResults.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-[var(--text-secondary)]">
                      No published finisher matches <strong className="text-[var(--text-primary)]">"{bibQuery}"</strong>.
                    </p>
                    <Button type="button" variant="outline" size="sm" className="h-11 px-4" onClick={handleSwitchToCompletedAndSearch}>
                      Browse completed races
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {matchingBibResults.map(({ race, entry }) => {
                      const key = `${race.id}_${entry.bibNumber}_${entry.distance}`;
                      const isDownloading = downloadingBibKey === key;
                      const displayName = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;

                      return (
                        <li
                          key={key}
                          className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] shadow-sm"
                        >
                          {/* Physical Race Bib Header Strip */}
                          <div className="bg-red-700 text-white px-3.5 py-1.5 flex items-center justify-between gap-2 text-xs font-mono font-semibold">
                            <span className="flex items-center gap-2 min-w-0 truncate">
                              <span className="w-2 h-2 rounded-full bg-white/75 shrink-0" aria-hidden="true" />
                              <span className="truncate">{race.name}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span>{entry.distance}</span>
                              <span className="w-2 h-2 rounded-full bg-white/75 shrink-0" aria-hidden="true" />
                            </span>
                          </div>

                          {/* Race Bib Body */}
                          <div className="p-3.5 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="px-3 py-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-center shrink-0">
                                <span className="block text-xs font-mono text-[var(--text-secondary)]">
                                  Bib
                                </span>
                                <span className="block font-mono text-base sm:text-lg font-semibold text-[var(--text-primary)] leading-tight">
                                  {entry.bibNumber}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="font-display font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
                                  {displayName}
                                </p>
                                <p className="text-xs font-mono text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className={accentText}>#{entry.overallRank ?? entry.rank} Overall</span>
                                  {entry.categoryRank && (
                                    <span>
                                      &bull; {entry.categoryLabel || 'Division'} #{entry.categoryRank}
                                    </span>
                                  )}
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    &bull; {formatRaceTime(entry.finishTime)}
                                  </span>
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                type="button"
                                size="sm"
                                className="h-11 px-3.5"
                                disabled={isDownloading}
                                onClick={() => handleDownloadCertificate(race, entry)}
                              >
                                {isDownloading ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                ) : downloadedBibKey === `${race.id}_${entry.bibNumber}_${entry.distance}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                ) : (
                                  <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                <span>
                                  {downloadedBibKey === `${race.id}_${entry.bibNumber}_${entry.distance}`
                                    ? 'Saved'
                                    : 'Certificate'}
                                </span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 px-3.5"
                                onClick={() => handleSelectRace(race.id)}
                              >
                                <span>Leaderboard</span>
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Compact Action Button Strip: single wrapping row across phone, tablet, and desktop */}
            <m.div
              initial={{ opacity: 0, y: 10 }}
              animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.22, delay: 0.14, ease: QUINT_EASE }}
              className="flex flex-wrap items-center gap-2 pt-0.5"
            >
              <Button
                size="default"
                className="group h-11 px-4 text-xs tracking-normal sm:tracking-wider"
                onClick={() => document.getElementById('events-catalog')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <span>Browse races</span>
                <ArrowRight
                  className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Button>

              <Button
                size="default"
                variant="outline"
                className="h-11 gap-2 px-3.5 sm:px-4 text-xs tracking-normal sm:tracking-wider"
                onClick={() => onRegister()}
              >
                <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
                <span>Create account</span>
              </Button>

              <Button
                size="default"
                variant="outline"
                className="h-11 gap-2 px-3.5 sm:px-4 text-xs tracking-normal sm:tracking-wider text-[var(--text-primary)]"
                onClick={handleSwitchToCompletedAndSearch}
              >
                <Trophy className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                <span>Certificates</span>
              </Button>
            </m.div>

            {/* Single-Line Real Data Counter Ticker */}
            {loadState === 'ready' && (
              <m.div
                initial={{ opacity: 0, y: 8 }}
                animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                transition={{ duration: 0.22, delay: 0.18, ease: QUINT_EASE }}
                className="pt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-[var(--text-secondary)] dark:text-white font-mono"
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
                  <strong className="text-[var(--text-primary)] font-semibold">{activeRaces.length}</strong> upcoming
                </span>

                {liveRaces.length > 0 && (
                  <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-semibold">
                    <span className="inline-flex rounded-full h-2 w-2 bg-red-700 dark:bg-red-400" aria-hidden="true" />
                    <strong className="text-red-700 dark:text-red-400">{liveRaces.length}</strong> live now
                  </span>
                )}

                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--text-secondary)] dark:text-white" aria-hidden="true" />
                  <strong className="text-[var(--text-primary)] font-semibold">{doneRaces.length}</strong> completed
                </span>
              </m.div>
            )}
          </div>

          {/* Right Runner Cutout Column: LCP-safe translate-only glide docked flush to banner bottom */}
          <m.div
            initial={{ y: 8 }}
            animate={revealed ? { y: 0 } : { y: 8 }}
            transition={{ duration: 0.26, ease: QUINT_EASE }}
            className="lg:col-span-5 flex items-end justify-center lg:justify-end px-4 sm:px-6 lg:px-0 lg:pr-6 pt-0 self-end"
          >
            <img
              src="/assets/hero-runners.webp"
              alt="Philippine road and trail runners in race singlets and numbered bibs"
              width={888}
              height={571}
              fetchPriority="high"
              decoding="async"
              className="w-auto max-w-full max-h-40 sm:max-h-52 lg:max-h-[280px] h-auto object-contain object-bottom block select-none pointer-events-none drop-shadow-[0_14px_24px_rgba(0,0,0,0.14)] dark:drop-shadow-[0_18px_36px_rgba(0,0,0,0.65)]"
            />
          </m.div>
        </div>

        <div className="track-ticks-rule relative z-10 w-full" aria-hidden="true" />
      </section>

      {/* Live Timing Feed Spotlight (Conditional on active broadcast) */}
      {liveRaces.length > 0 && (
        <section className="space-y-4" aria-labelledby="live-heading">
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] pb-3">
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-red-700 dark:bg-red-400" aria-hidden="true" />
            <h2 id="live-heading" className="type-section text-[var(--text-primary)]">
              Live checkpoint split board
            </h2>
          </div>
          <Suspense fallback={<CardSkeletonLoader label="Loading live timing board" />}>
            <PublicLiveRaceHub races={liveRaces} />
          </Suspense>
        </section>
      )}

      {/* Events Catalog: Tab switcher, full-width tablet-safe search, scrollable distance bib chips, and card grid */}
      <section id="events-catalog" className="space-y-3 scroll-mt-20" aria-labelledby="catalog-heading">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-[var(--border-default)] pb-3">
          <div className="space-y-1">
            <h2 id="catalog-heading" className="type-section text-[var(--text-primary)]">
              {activeTab === 'upcoming' ? 'Upcoming races' : 'Completed races'}
            </h2>
            <p className="type-lead text-[var(--text-secondary)]">
              {activeTab === 'upcoming'
                ? 'Select a race to review category distances, entry fees, and registration status.'
                : 'Search official finisher rankings, chip times, and download verified certificates.'}
            </p>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              setActiveTab(val as 'upcoming' | 'completed');
              setSelectedRaceId('');
              syncRaceIdToUrl('');
            }}
            className="w-auto shrink-0"
          >
            <TabsList>
              <TabsTrigger value="upcoming" className="min-h-11 gap-2">
                <span>Upcoming</span>
                <span className="font-mono">{activeRaces.length}</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="min-h-11 gap-2">
                <span>Completed</span>
                <span className="font-mono">{doneRaces.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tablet-Safe Search Bar + Horizontally Scrollable Distance Filter Row (No 7-chip cap) */}
        <div className="flex flex-col xl:flex-row gap-3 items-stretch xl:items-center justify-between">
          <div className="relative w-full xl:max-w-md shrink-0">
            <Search
              className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
              aria-hidden="true"
            />
            <Input
              ref={searchInputRef}
              type="search"
              aria-label="Search races by name, date or distance"
              placeholder="Search by race name, date or distance"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {availableDistances.length > 0 && (
            <div
              className="racepulse-horizontal-scroll flex items-center gap-2 overflow-x-auto py-1"
              role="group"
              aria-label="Filter by distance"
            >
              <button
                type="button"
                aria-pressed={selectedDistanceFilter === 'all'}
                onClick={() => setSelectedDistanceFilter('all')}
                className={`${chipBase} ${selectedDistanceFilter === 'all' ? chipActive : chipIdle}`}
              >
                All distances
              </button>
              {availableDistances.map((dist) => (
                <button
                  key={dist}
                  type="button"
                  aria-pressed={selectedDistanceFilter === dist}
                  onClick={() => setSelectedDistanceFilter(dist)}
                  className={`${chipBase} ${selectedDistanceFilter === dist ? chipActive : chipIdle}`}
                >
                  {dist}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Events Grid, Loading Skeletons, or Empty State */}
        {loadState === 'loading' ? (
          <RaceCardSkeletonGrid count={3} />
        ) : filteredRaces.length === 0 ? (
          <Card className="p-8 sm:p-10 text-center border-dashed space-y-4">
            <Flag className="w-8 h-8 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
            <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              {searchQuery || selectedDistanceFilter !== 'all'
                ? 'No races match your filters'
                : 'No races in this list yet'}
            </h3>
            <p className="type-lead text-[var(--text-secondary)] max-w-md mx-auto">
              {searchQuery
                ? `Nothing matches "${searchQuery}". Clear the search query or pick another distance category.`
                : selectedDistanceFilter !== 'all'
                  ? 'No race offers that distance. Choose another distance or reset filters.'
                  : 'Race organizers have not published an event in this view yet.'}
            </p>
            {(searchQuery || selectedDistanceFilter !== 'all') && (
              <Button variant="outline" size="default" className="h-11 px-5" onClick={handleResetFilters}>
                Reset filters
              </Button>
            )}
          </Card>
        ) : (
          <ul
            className={`grid gap-4 ${filteredRaces.length <= 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
          >
            {filteredRaces.map((race) => {
              const isSelected = race.id === selectedRaceId;
              const regOpen = isRaceRegistrationOpen(race, today);
              const isLive = !!race.liveBroadcastEnabled;
              const isCompleted = !!race.completedAt;
              const scheduleNote = formatRaceScheduleNote(race, today);
              const finisherCount = resultsByRaceId[race.id]?.officialResults?.length || 0;

              return (
                <li
                  key={race.id}
                  className="flex"
                >
                  <Card
                    className={`group w-full overflow-hidden flex flex-col justify-between transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg ${isSelected ? 'ring-2 ring-red-700 dark:ring-red-400' : ''
                      }`}
                  >
                    <div>
                      {/* Poster Art with Status Badges matching Dashboard RaceList height */}
                      <div className="relative h-36 sm:h-40 w-full overflow-hidden bg-[var(--surface-inset)] border-b border-[var(--border-default)]">
                        {race.posterImage ? (
                          <img
                            src={race.posterImage}
                            alt={`${race.name} official event poster`}
                            width={640}
                            height={400}
                            className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-6 text-center">
                            <Trophy className="w-8 h-8 text-[var(--text-secondary)]" aria-hidden="true" />
                          </div>
                        )}

                        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                          {isLive && <Badge variant="live">Live timing</Badge>}
                          {isCompleted ? (
                            <Badge variant="secondary">
                              {finisherCount > 0 ? `Completed · ${finisherCount} finishers` : 'Completed'}
                            </Badge>
                          ) : regOpen ? (
                            <Badge variant="success">Registration open</Badge>
                          ) : (
                            <Badge variant="muted">Registration closed</Badge>
                          )}
                        </div>
                      </div>

                      <CardContent className="p-4 sm:p-5 space-y-3">
                        <div className="space-y-1.5">
                          <h3 className="font-display font-semibold text-lg sm:text-xl tracking-tight text-[var(--text-primary)] line-clamp-2">
                            {race.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 type-caption text-[var(--text-secondary)] font-mono">
                            <span className="flex items-center gap-1.5">
                              <Calendar
                                className="w-3.5 h-3.5 shrink-0 text-red-700 dark:text-red-400"
                                aria-hidden="true"
                              />
                              <span>{formatReadableRaceDate(race.date)}</span>
                            </span>
                            {scheduleNote && (
                              <span className={`font-semibold ${accentText}`}>&bull; {scheduleNote}</span>
                            )}
                          </div>
                        </div>

                        {/* Race Bib Distance Tags with Entry Fees */}
                        <div className="flex flex-wrap gap-2">
                          {(race.distances || []).length === 0 ? (
                            <span className="type-caption text-[var(--text-secondary)]">
                              Distances to be announced
                            </span>
                          ) : (
                            race.distances.map((d) => (
                              <span
                                key={d.id}
                                className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] font-mono text-xs font-semibold"
                              >
                                <span className="px-2.5 py-1 bg-red-700/10 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-r border-[var(--border-default)]">
                                  {d.label}
                                </span>
                                <span className="px-2.5 py-1 text-[var(--text-primary)]">
                                  {d.price > 0 ? `₱${d.price.toLocaleString('en-PH')}` : 'Free'}
                                </span>
                              </span>
                            ))
                          )}
                        </div>

                        {/* Inclusions Microcopy */}
                        {(race.inclusions || []).length > 0 && (
                          <p className="type-caption text-[var(--text-secondary)] line-clamp-2">
                            Kit includes: {race.inclusions.join(', ')}
                          </p>
                        )}
                      </CardContent>
                    </div>

                    {/* Action Footer (>= 44px tap targets) */}
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex gap-2">
                      <Button
                        type="button"
                        variant={isSelected ? 'default' : 'secondary'}
                        size="default"
                        aria-pressed={isSelected}
                        onClick={() => handleSelectRace(race.id)}
                        className="h-11 flex-1 justify-between px-4"
                      >
                        <span>{isCompleted ? 'View results' : 'View details'}</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {!isCompleted && regOpen && (
                        <Button
                          type="button"
                          size="default"
                          onClick={() => onRegister(race.id)}
                          className="h-11 px-4 shrink-0"
                        >
                          Register
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Selected Race Results Inspector Section (Synced with ?race=<id>) */}
      <AnimatePresence mode="wait" initial={false}>
        {selectedRace && (
          <m.section
            key={selectedRace.id}
            id="public-race-results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12, ease: EMIL_EASE } }}
            transition={{ duration: 0.2, ease: EMIL_EASE }}
            className="scroll-mt-24 space-y-4 [backface-visibility:hidden]"
            aria-labelledby="selected-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
              <h2 id="selected-heading" className="type-section text-[var(--text-primary)]">
                {selectedRace.name}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  className="h-11 px-4"
                  onClick={() => handleCopyRaceLink(selectedRace.id)}
                >
                  {copiedRaceId === selectedRace.id ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      <span>Link copied</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" aria-hidden="true" />
                      <span>Share race link</span>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  className="h-11 px-4 border border-[var(--border-default)]"
                  onClick={handleCloseSelectedRace}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                  <span>Close</span>
                </Button>
              </div>
            </div>
            <Suspense fallback={<ResultsSkeletonList rows={5} />}>
              <PublicRaceResults race={selectedRace} onRegister={onRegister} />
            </Suspense>
          </m.section>
        )}
      </AnimatePresence>

      {/* Official Finisher Bib Board: Driven by real published finishers instead of generic feature template cards */}
      {featuredBibFinishers.length > 0 && (
        <section
          className="space-y-4 pt-5 border-t border-[var(--border-default)]"
          aria-labelledby="bib-board-heading"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 id="bib-board-heading" className="type-section text-[var(--text-primary)]">
                Recent official finisher bibs
              </h2>
              <p className="type-lead text-[var(--text-secondary)]">
                Verified podium and official finisher records from published RacePulsePH events.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="default"
              className="h-11 px-5 self-start sm:self-auto shrink-0"
              onClick={handleSwitchToCompletedAndSearch}
            >
              <span>Search all archives</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>

          <ul
            className={`grid gap-4 ${featuredBibFinishers.length <= 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
          >
            {featuredBibFinishers.map(({ race, entry }) => {
              const bibKey = `${race.id}_${entry.bibNumber}_${entry.distance}`;
              const key = `featured_${bibKey}`;
              const isDownloading = downloadingBibKey === bibKey;
              const isDownloaded = downloadedBibKey === bibKey;
              const displayName = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;

              return (
                <li
                  key={key}
                  className="flex"
                >
                  <div className="w-full overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-md flex flex-col justify-between">
                    <div>
                      {/* Authentic Race Bib Top Header */}
                      <div className="bg-red-700 text-white px-4 py-2 flex items-center justify-between gap-2 font-mono text-xs font-semibold">
                        <span className="flex items-center gap-2 min-w-0 truncate">
                          <span className="w-2.5 h-2.5 rounded-full bg-black/35 border border-white/40 shrink-0" aria-hidden="true" />
                          <span className="truncate">{race.name}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span>{entry.distance}</span>
                          <span className="w-2.5 h-2.5 rounded-full bg-black/35 border border-white/40 shrink-0" aria-hidden="true" />
                        </span>
                      </div>

                      {/* Race Bib Number & Runner Plate */}
                      <div className="p-4 sm:p-5 space-y-3">
                        <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[var(--border-default)] pb-3">
                          <span className="font-mono text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
                            {entry.bibNumber}
                          </span>
                          <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25">
                            {formatRaceTime(entry.finishTime)}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <h3 className="font-display font-semibold text-base text-[var(--text-primary)] truncate">
                            {displayName}
                          </h3>
                          <p className="type-caption font-mono text-[var(--text-secondary)]">
                            Rank #{entry.overallRank ?? entry.rank} Overall
                            {entry.categoryRank ? ` · ${entry.categoryLabel || 'Category'} #${entry.categoryRank}` : ''}
                            {' · '}
                            {formatReadableRaceDate(race.date)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Bib Bottom Tear-Off Stub Actions */}
                    <div className="px-4 sm:px-5 py-3 bg-[var(--surface-inset)] border-t border-dashed border-[var(--border-default)] flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 px-3 text-xs"
                        onClick={() => handleSelectRace(race.id)}
                      >
                        <span>Race results</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 px-3.5 text-xs"
                        disabled={isDownloading}
                        onClick={() => handleDownloadCertificate(race, entry)}
                      >
                        {isDownloading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : isDownloaded ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        ) : (
                          <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{isDownloaded ? 'Saved' : 'Certificate'}</span>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Smart Sticky Mobile Bottom CTA Bar (matches dashboard BottomNav floating glass-panel dock when scrolled past hero) */}
      <AnimatePresence>
        {heroOutOfView && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden fixed bottom-3 inset-x-3 z-30 glass-panel px-3 py-2.5 mb-[var(--rp-safe-bottom)] shadow-[0_12px_32px_rgba(0,0,0,0.22)]"
          >
            <div className="max-w-md mx-auto grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-11 text-xs font-semibold gap-1.5"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  window.setTimeout(() => bibInputRef.current?.focus(), 220);
                }}
              >
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Find bib</span>
              </Button>
              <Button
                type="button"
                className="h-11 text-xs font-semibold gap-1.5"
                onClick={() => onRegister()}
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Register</span>
              </Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </main>
  );
}
