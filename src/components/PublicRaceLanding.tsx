import { lazy, type PointerEvent as ReactPointerEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion, type Variants } from 'motion/react';
import { subscribeSharedRaces } from '../lib/racesStore';
import { subscribeSharedLiveResults } from '../lib/liveResultsStore';
import { parseDistanceAndEntryCategory } from '../lib/publicLandingStats';
import { entryCategoryLabels } from '../lib/raceEntry';
import { isRaceRegistrationOpen, philippineDate } from '../lib/raceRegistration';
import type { PublicLeaderboardEntry, PublicLiveResults, Race, RunnerResult } from '../types';
import {
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Flag,
  Link2,
  Maximize2,
  RefreshCw,
  Search,
  Trophy,
  UserPlus,
  X,
} from 'lucide-react';
import PublicAgeStatsSection from './PublicAgeStatsSection';
import PodiumPulseReel from './PodiumPulseReel';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import DialogSurface from './ui/DialogSurface';
import { Input } from './ui/input';
import {
  GlidingFilterBar,
  isTrailRace,
  KineticBibCard,
  KineticRaceCard,
  OdometerNumber,
  PulseDivider,
  TimingChipDot,
  TopographicContoursSvg,
} from './ui/KineticTelemetry';
import {
  CardSkeletonLoader,
  EMIL_EASE,
  KINETIC_SPRING,
  RaceCardSkeletonGrid,
  ResultsSkeletonList,
} from './ui/MotionPrimitives';
import RaceTimeText from './ui/RaceTimeText';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

const PublicLiveRaceHub = lazy(() => import('./PublicLiveRaceHub'));
const PublicRaceResults = lazy(() => import('./PublicRaceResults'));
const RouteMap3D = lazy(() => import('./RouteMap3D'));

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

const accentText = 'text-red-700 dark:text-red-400';

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  });
}

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

const posterSlideVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? '14%' : '-14%',
    scale: 0.96,
    opacity: 0,
  }),
  center: {
    x: '0%',
    scale: 1,
    opacity: 1,
    transition: {
      ...KINETIC_SPRING,
      opacity: { duration: 0.22, ease: EMIL_EASE },
    },
    transitionEnd: {
      transform: 'none',
    },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? '-18%' : '18%',
    scale: 0.93,
    opacity: 0,
    transition: {
      duration: 0.24,
      ease: EMIL_EASE,
    },
  }),
};

export default function PublicRaceLanding({
  onRegister,
  onLoadState,
  onActiveRaceTitle,
}: PublicRaceLandingProps) {
  const prefersReducedMotion = useReducedMotion();
  const [races, setRaces] = useState<Race[]>([]);
  const [resultsByRaceId, setResultsByRaceId] = useState<Record<string, PublicLiveResults>>({});
  const [resultsLoadState, setResultsLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedRaceId, setSelectedRaceId] = useState<string>(() => initialRaceIdFromUrl());
  const [catalogTab, setCatalogTab] = useState<'upcoming' | 'completed' | 'all'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistanceFilter, setSelectedDistanceFilter] = useState<string>('all');

  const [bibQuery, setBibQuery] = useState('');
  const [bibDistanceFilter, setBibDistanceFilter] = useState<string>('all');
  const [bibRaceFilter, setBibRaceFilter] = useState<string>('all');
  const [showMoreBibs, setShowMoreBibs] = useState(false);

  const [activeSlide, setActiveSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const [carouselInteracted, setCarouselInteracted] = useState(false);
  const [lightboxRace, setLightboxRace] = useState<Race | null>(null);
  const [copiedRaceId, setCopiedRaceId] = useState<string | null>(null);
  const [downloadingBibKey, setDownloadingBibKey] = useState<string | null>(null);
  const [downloadedBibKey, setDownloadedBibKey] = useState<string | null>(null);
  const [certificateNotice, setCertificateNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const bibInputRef = useRef<HTMLInputElement>(null);
  const heroHeaderRef = useRef<HTMLElement>(null);
  const heroRafRef = useRef<number>(0);
  const touchStartXRef = useRef<number | null>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const didInitialUrlScrollRef = useRef(false);
  const didAutoSelectTabRef = useRef(false);

  useEffect(() => {
    return () => {
      if (heroRafRef.current) cancelAnimationFrame(heroRafRef.current);
    };
  }, []);

  useEffect(() => {
    onLoadState?.(loadState);
  }, [loadState, onLoadState]);

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
    return subscribeSharedLiveResults((map, loaded, err) => {
      if (err) {
        console.warn('Public liveResults listener failed:', err);
        setResultsLoadState('error');
        return;
      }
      if (!loaded) return;
      setResultsByRaceId(map);
      setResultsLoadState('ready');
    });
  }, []);

  const today = philippineDate();

  const liveRaces = useMemo(() => races.filter((race) => race.liveBroadcastEnabled), [races]);
  const activeRaces = useMemo(() => races.filter((race) => !race.completedAt && race.date >= today), [races, today]);
  const doneRaces = useMemo(() => races.filter((race) => !!race.completedAt || race.date < today), [races, today]);

  useEffect(() => {
    if (loadState !== 'ready' || didAutoSelectTabRef.current) return;
    didAutoSelectTabRef.current = true;
    if (!selectedRaceId && activeRaces.length === 0 && doneRaces.length > 0) {
      setCatalogTab('completed');
    }
  }, [loadState, selectedRaceId, activeRaces.length, doneRaces.length]);

  // Featured upcoming races for the hero poster carousel: upcoming races with posters first
  const featuredRaces = useMemo(() => {
    if (activeRaces.length === 0) return [];
    const withPosters = activeRaces.filter((r) => Boolean(r.posterImage));
    const withoutPosters = activeRaces.filter((r) => !r.posterImage);
    return [...withPosters, ...withoutPosters].slice(0, 6);
  }, [activeRaces]);

  useEffect(() => {
    if (activeSlide >= featuredRaces.length) {
      setActiveSlide(0);
    }
  }, [activeSlide, featuredRaces.length]);

  const currentTabRaces = useMemo(() => {
    if (catalogTab === 'upcoming') return activeRaces;
    if (catalogTab === 'completed') {
      return [...doneRaces].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return [...activeRaces, ...[...doneRaces].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())];
  }, [catalogTab, activeRaces, doneRaces]);

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

  useEffect(() => {
    onActiveRaceTitle?.(selectedRace ? selectedRace.name : null);
  }, [selectedRace, onActiveRaceTitle]);

  // All published official finishers across started/completed races
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

  const bibAvailableRaces = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { race } of allPublishedFinishers) {
      if (!seen.has(race.id)) seen.set(race.id, race.name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allPublishedFinishers]);

  const bibAvailableDistances = useMemo(() => {
    const set = new Set<string>();
    for (const { entry, race } of allPublishedFinishers) {
      if (bibRaceFilter !== 'all' && race.id !== bibRaceFilter) continue;
      const parsed = parseDistanceAndEntryCategory(entry.distance);
      if (parsed.baseDistance) set.add(parsed.baseDistance);
    }
    return Array.from(set).sort((a, b) => {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [allPublishedFinishers, bibRaceFilter]);

  const filteredOfficialBibs = useMemo<FinisherBibMatch[]>(() => {
    const term = bibQuery.trim().toLowerCase();
    const scoped = allPublishedFinishers.filter(({ race, entry }) => {
      if (bibRaceFilter !== 'all' && race.id !== bibRaceFilter) return false;
      if (
        bibDistanceFilter !== 'all' &&
        parseDistanceAndEntryCategory(entry.distance).baseDistance !== bibDistanceFilter
      ) {
        return false;
      }
      if (!term) return true;
      const bibMatch = entry.bibNumber.toLowerCase().includes(term);
      const nameMatch = !entry.isFreeSlot && entry.fullName.toLowerCase().includes(term);
      const raceMatch = race.name.toLowerCase().includes(term);
      return bibMatch || nameMatch || raceMatch;
    });

    if (term) return scoped;

    // Without a search term, diversify featured bibs across races and base distances
    const buckets = new Map<string, FinisherBibMatch[]>();
    for (const item of scoped) {
      const parsed = parseDistanceAndEntryCategory(item.entry.distance);
      const bucketKey = `${item.race.id}::${parsed.baseDistance || item.entry.distance}`;
      const list = buckets.get(bucketKey) || [];
      list.push(item);
      buckets.set(bucketKey, list);
    }

    const queues = Array.from(buckets.values()).map((items) =>
      [...items].sort((a, b) => {
        const ra = a.entry.overallRank ?? a.entry.rank;
        const rb = b.entry.overallRank ?? b.entry.rank;
        return ra - rb;
      }),
    );

    const diversified: FinisherBibMatch[] = [];
    const indices = new Array(queues.length).fill(0);
    while (diversified.length < scoped.length) {
      let pickedAny = false;
      for (let q = 0; q < queues.length; q += 1) {
        const idx = indices[q];
        if (idx < queues[q].length) {
          diversified.push(queues[q][idx]);
          indices[q] += 1;
          pickedAny = true;
        }
      }
      if (!pickedAny) break;
    }
    return diversified;
  }, [allPublishedFinishers, bibDistanceFilter, bibQuery, bibRaceFilter]);

  const bibVisibleLimit = bibQuery.trim() ? (showMoreBibs ? 24 : 9) : showMoreBibs ? 18 : 6;
  const visibleOfficialBibs = filteredOfficialBibs.slice(0, bibVisibleLimit);

  // Scroll to deep-linked ?race=<id> once races finish loading
  useEffect(() => {
    if (loadState === 'ready' && selectedRace && !didInitialUrlScrollRef.current) {
      didInitialUrlScrollRef.current = true;
      if (selectedRace.completedAt || selectedRace.date < today) {
        setCatalogTab('completed');
      }
      requestAnimationFrame(() => {
        const reduceMotion =
          typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById('public-race-results')?.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    }
  }, [loadState, selectedRace, today]);

  const handleHeroPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (prefersReducedMotion || e.pointerType !== 'mouse') return;
      const node = heroHeaderRef.current;
      if (!node) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (heroRafRef.current) cancelAnimationFrame(heroRafRef.current);
      heroRafRef.current = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = (clientX - rect.left) / rect.width - 0.5;
        const ny = (clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty('--rp-topo-x', `${(nx * -12).toFixed(2)}px`);
        node.style.setProperty('--rp-topo-y', `${(ny * -10).toFixed(2)}px`);
      });
    },
    [prefersReducedMotion],
  );

  const handleHeroPointerLeave = useCallback(() => {
    if (heroRafRef.current) {
      cancelAnimationFrame(heroRafRef.current);
      heroRafRef.current = 0;
    }
    const node = heroHeaderRef.current;
    if (!node) return;
    node.style.setProperty('--rp-topo-x', '0px');
    node.style.setProperty('--rp-topo-y', '0px');
  }, []);

  const goToSlide = useCallback(
    (targetIndex: number, explicitDirection?: 1 | -1) => {
      const count = featuredRaces.length;
      if (count <= 1) return;
      const clamped = ((targetIndex % count) + count) % count;
      if (clamped === activeSlide) return;

      const dir: 1 | -1 = explicitDirection ?? (clamped > activeSlide ? 1 : -1);

      // For exactly 2 slides, redirect focus before an end button becomes disabled
      if (count === 2) {
        if (clamped === 0 && document.activeElement === prevBtnRef.current) {
          nextBtnRef.current?.focus({ preventScroll: true });
        } else if (clamped === 1 && document.activeElement === nextBtnRef.current) {
          prevBtnRef.current?.focus({ preventScroll: true });
        }
      }

      setCarouselInteracted(true);
      setSlideDirection(dir);
      setActiveSlide(clamped);
    },
    [activeSlide, featuredRaces.length],
  );

  const handleSelectRace = (raceId: string) => {
    didInitialUrlScrollRef.current = true;
    const targetRace = races.find((r) => r.id === raceId);
    if (targetRace) {
      setCatalogTab(targetRace.completedAt || targetRace.date < today ? 'completed' : 'upcoming');
    }
    setSelectedRaceId(raceId);
    syncRaceIdToUrl(raceId);
    requestAnimationFrame(() => {
      const reduceMotion =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('public-race-results')?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
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
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setCertificateNotice({
        kind: 'error',
        text: 'Could not copy the link. Copy this race URL from your browser address bar.',
      });
      return;
    }
    setCopiedRaceId(raceId);
    window.setTimeout(() => {
      setCopiedRaceId((current) => (current === raceId ? null : current));
    }, 2200);
  };

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

  const podiumShelfLeaders = useMemo<FinisherBibMatch[]>(() => {
    if (allPublishedFinishers.length === 0) return [];
    const picked: FinisherBibMatch[] = [];
    const seenRace = new Set<string>();
    const seenBucket = new Set<string>();
    const sorted = [...allPublishedFinishers].sort((a, b) => {
      const ra = a.entry.overallRank ?? a.entry.rank;
      const rb = b.entry.overallRank ?? b.entry.rank;
      if (ra !== rb) return ra - rb;
      return new Date(b.race.date).getTime() - new Date(a.race.date).getTime();
    });
    for (const item of sorted) {
      if (seenRace.has(item.race.id)) continue;
      seenRace.add(item.race.id);
      const parsed = parseDistanceAndEntryCategory(item.entry.distance);
      seenBucket.add(`${item.race.id}::${parsed.baseDistance || item.entry.distance}`);
      picked.push(item);
      if (picked.length >= 3) break;
    }
    if (picked.length < 3) {
      for (const item of sorted) {
        const parsed = parseDistanceAndEntryCategory(item.entry.distance);
        const key = `${item.race.id}::${parsed.baseDistance || item.entry.distance}`;
        if (seenBucket.has(key)) continue;
        seenBucket.add(key);
        picked.push(item);
        if (picked.length >= 3) break;
      }
    }
    return picked;
  }, [allPublishedFinishers]);

  const handleResetCatalogFilters = () => {
    setSearchQuery('');
    setSelectedDistanceFilter('all');
  };

  const handleViewHighlightLeaderboard = (raceId?: string) => {
    if (raceId && races.some((r) => r.id === raceId)) {
      handleSelectRace(raceId);
      return;
    }
    setCatalogTab('completed');
    scrollToSection('events-catalog');
  };

  const publishedEventsCount = bibAvailableRaces.length;
  const podiumStaticCompanion =
    podiumShelfLeaders.length > 0 ? (
      <div className="landing-podium-companion glass-panel p-4 sm:p-5 flex flex-col justify-between gap-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Published podium leaders
          </h3>
          <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums">
            {publishedEventsCount} published {publishedEventsCount === 1 ? 'event' : 'events'}
          </span>
        </div>

        <ul className="divide-y divide-[var(--border-default)]">
          {podiumShelfLeaders.map(({ race, entry }) => {
            const parsedDist = parseDistanceAndEntryCategory(entry.distance);
            const distLabel = parsedDist.baseDistance || entry.distance;
            const entrySuffix =
              parsedDist.entryCategory !== 'solo'
                ? ` ${entryCategoryLabels[parsedDist.entryCategory]}`
                : '';
            const displayName = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;
            return (
              <li key={`companion_${race.id}_${entry.bibNumber}_${entry.distance}`}>
                <button
                  type="button"
                  className="w-full min-h-11 py-2 px-2 -mx-2 rounded-lg text-left flex items-center justify-between gap-3 hover:bg-[var(--surface-inset)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-entry-action)]"
                  onClick={() => handleViewHighlightLeaderboard(race.id)}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      <span className="font-mono text-red-700 dark:text-red-400 mr-2">
                        #{entry.overallRank ?? entry.rank}
                      </span>
                      <span>{displayName}</span>
                    </div>
                    <div className="text-xs font-mono text-[var(--text-secondary)] truncate">
                      {race.name} · {distLabel}
                      {entrySuffix}
                    </div>
                  </div>
                  <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)] shrink-0">
                    <RaceTimeText value={entry.finishTime} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="pt-1 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => scrollToSection('official-bibs')}
            className="min-h-11 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline cursor-pointer"
          >
            <span>Browse all official bibs</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    ) : null;

  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'course') {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-grow px-4 py-6 sm:px-6">
        <a
          href={selectedRace ? `/?race=${encodeURIComponent(selectedRace.id)}` : '/'}
          className="inline-flex min-h-11 items-center font-semibold text-red-700 dark:text-red-400"
        >
          {selectedRace ? 'Back to race' : 'Browse races'}
        </a>
        <h1 className="mb-4 text-3xl font-semibold text-[var(--text-primary)]">
          {selectedRace ? `${selectedRace.name} course` : 'Race course'}
        </h1>
        {selectedRace?.routeGpxUrl ? (
          <Suspense fallback={<p role="status">Loading course viewer</p>}>
            <RouteMap3D
              key={selectedRace.routeGpxUrl}
              gpxUrl={selectedRace.routeGpxUrl}
              fileName={selectedRace.routeGpxFileName}
              raceName={selectedRace.name}
              showProfile
            />
          </Suspense>
        ) : (
          <p className="text-[var(--text-secondary)]" role="status">
            {loadState === 'loading' ? 'Loading race' : 'This race course is unavailable.'}
          </p>
        )}
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="public-landing focus:outline-none">
      {/* Network or Data Load Error Banner */}
      {loadState === 'error' && (
        <Card className="border-red-700 dark:border-red-400 p-4 text-center">
          <p role="alert" className="type-lead">
            Could not load events.{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`underline font-semibold cursor-pointer ${accentText}`}
            >
              Retry
            </button>
          </p>
        </Card>
      )}

      {/* Unknown ?race= URL parameter notice */}
      {loadState === 'ready' && selectedRaceId && !selectedRace && (
        <div
          role="status"
          className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
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

      {/* Certificate action feedback */}
      {certificateNotice && (
        <div
          role={certificateNotice.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm ${
            certificateNotice.kind === 'error'
              ? 'border-red-600/35 bg-red-50 dark:bg-red-950/35 text-red-700 dark:text-red-300'
              : 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <span className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{certificateNotice.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setCertificateNotice(null)}
            aria-label="Dismiss notification"
            className="min-h-11 min-w-11 -my-2 -mr-2 flex items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ============================================================
          SECTION 1: HERO SHOWCASE & FEATURED 16:9 POSTER CAROUSEL
          ============================================================ */}
      <section className="space-y-8" aria-labelledby="hero-heading">
        {/* Clean Editorial Intro Header (Zero eyebrow capsule pill above H1) */}
        <header
          ref={heroHeaderRef}
          onPointerMove={handleHeroPointerMove}
          onPointerLeave={handleHeroPointerLeave}
          className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-7"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <TopographicContoursSvg variant="hero" />
          </div>

          <div className="relative z-10 space-y-3 max-w-2xl">
            <h1 id="hero-heading" className="type-hero text-[var(--text-primary)]">
              Your next <span className={accentText}>finish line.</span>
            </h1>
            <p className="type-lead text-[var(--text-secondary)]">
              Official Philippine race schedules, finisher bibs, and age-category timings.
            </p>
            <p className="type-caption font-mono text-[var(--text-secondary)]">
              Happy running ka Racepulse!
            </p>
          </div>

          <div className="relative z-10 flex flex-wrap items-center gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                scrollToSection('official-bibs');
                window.setTimeout(() => {
                  bibInputRef.current?.focus({ preventScroll: true });
                }, 150);
              }}
            >
              <Search className="w-4 h-4" aria-hidden="true" />
              <span>Find my bib</span>
            </Button>
            <Button type="button" size="lg" onClick={() => onRegister()}>
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              <span>Register</span>
            </Button>
          </div>

          <PulseDivider surface="section" delaySec={1.8} className="absolute inset-x-0 bottom-0" />
        </header>

        {/* Featured Upcoming 16:9 Race Poster Carousel (or clean fallback banner) */}
        {loadState === 'ready' && featuredRaces.length > 0 ? (() => {
          const activeFeaturedRace = featuredRaces[activeSlide] ?? featuredRaces[0];
          const regOpen = isRaceRegistrationOpen(activeFeaturedRace, today);
          const scheduleNote = formatRaceScheduleNote(activeFeaturedRace, today);
          const cardTextInitial =
            carouselInteracted && !prefersReducedMotion
              ? { opacity: 0, x: slideDirection * 14 }
              : false;

          return (
            <div
              role="region"
              aria-roledescription="carousel"
              aria-label="Featured upcoming races"
              onTouchStart={(e) => {
                touchStartXRef.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                const startX = touchStartXRef.current;
                touchStartXRef.current = null;
                if (startX === null || featuredRaces.length <= 1) return;
                const endX = e.changedTouches[0]?.clientX;
                if (typeof endX !== 'number') return;
                const dx = endX - startX;
                if (Math.abs(dx) >= 48) {
                  const dir: 1 | -1 = dx < 0 ? 1 : -1;
                  goToSlide(activeSlide + dir, dir);
                }
              }}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden"
            >
              <p className="sr-only" aria-live="polite">
                Slide {activeSlide + 1} of {featuredRaces.length}: {activeFeaturedRace.name}
              </p>

              <div
                role="group"
                aria-roledescription="slide"
                aria-label={`${activeSlide + 1} of ${featuredRaces.length}`}
                className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start lg:items-stretch"
              >
                {/* True 16:9 Uncropped Poster Stage with Parallax Wipe (Zero text overlaid on poster) */}
                <div className="relative aspect-video w-full bg-[var(--surface-inset)] border-b lg:border-b-0 lg:border-r border-[var(--border-default)] overflow-hidden">
                  <AnimatePresence initial={false} mode="popLayout" custom={slideDirection}>
                    <m.div
                      key={activeFeaturedRace.id}
                      custom={slideDirection}
                      variants={posterSlideVariants}
                      initial={carouselInteracted && !prefersReducedMotion ? 'enter' : false}
                      animate="center"
                      exit="exit"
                      className="absolute inset-0 w-full h-full will-change-transform [backface-visibility:hidden]"
                    >
                      {activeFeaturedRace.posterImage ? (
                        <button
                          type="button"
                          onClick={() => setLightboxRace(activeFeaturedRace)}
                          aria-label={`Inspect full poster for ${activeFeaturedRace.name}`}
                          className="group relative block w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
                        >
                          <img
                            src={activeFeaturedRace.posterImage}
                            alt={`${activeFeaturedRace.name} official race poster`}
                            width={800}
                            height={450}
                            fetchPriority={activeSlide === 0 ? 'high' : 'low'}
                            loading="eager"
                            className="rp-race-poster-img w-full h-full object-contain block"
                          />
                        </button>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-10 text-center bg-[#141416] text-white space-y-2">
                          <Trophy className="w-10 h-10 text-red-400" aria-hidden="true" />
                          <p className="font-display text-xl sm:text-3xl font-semibold tracking-tight max-w-xl">
                            {activeFeaturedRace.name}
                          </p>
                          <p className="font-mono text-xs text-zinc-300">
                            {formatReadableRaceDate(activeFeaturedRace.date)}
                          </p>
                        </div>
                      )}
                    </m.div>
                  </AnimatePresence>
                </div>

                {/* Clean Editorial Details Panel Beside (Desktop) / Below (Mobile) Poster (Cascades 50ms behind wipe) */}
                <div className="p-4 sm:p-6 flex flex-col justify-between gap-5 bg-[var(--surface-card)] min-w-0 overflow-hidden">
                  <div key={activeFeaturedRace.id} className="flex flex-col justify-between gap-5 flex-1 min-w-0">
                    <div className="space-y-3 min-w-0">
                      <m.div
                        initial={cardTextInitial}
                        animate={{ opacity: 1, x: 0, transitionEnd: { transform: 'none' } }}
                        transition={{
                          ...KINETIC_SPRING,
                          delay: carouselInteracted ? 0.05 : 0,
                          opacity: { duration: 0.18, delay: carouselInteracted ? 0.05 : 0, ease: EMIL_EASE },
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        {activeFeaturedRace.liveBroadcastEnabled && <Badge variant="live">Live timing</Badge>}
                        <Badge variant={regOpen ? 'success' : 'muted'}>
                          {regOpen && <TimingChipDot />}
                          <span>{regOpen ? 'Registration open' : 'Registration closed'}</span>
                        </Badge>
                      </m.div>

                      <m.div
                        initial={cardTextInitial}
                        animate={{ opacity: 1, x: 0, transitionEnd: { transform: 'none' } }}
                        transition={{
                          ...KINETIC_SPRING,
                          delay: carouselInteracted ? 0.1 : 0,
                          opacity: { duration: 0.18, delay: carouselInteracted ? 0.1 : 0, ease: EMIL_EASE },
                        }}
                        className="space-y-1.5 min-w-0"
                      >
                        <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                          {activeFeaturedRace.name}
                        </h2>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                            <span>{formatReadableRaceDate(activeFeaturedRace.date)}</span>
                          </span>
                          {scheduleNote && (
                            <span className={`font-semibold ${accentText}`}>
                              {scheduleNote}
                            </span>
                          )}
                        </div>
                      </m.div>

                      <m.div
                        initial={cardTextInitial}
                        animate={{ opacity: 1, x: 0, transitionEnd: { transform: 'none' } }}
                        transition={{
                          ...KINETIC_SPRING,
                          delay: carouselInteracted ? 0.15 : 0,
                          opacity: { duration: 0.18, delay: carouselInteracted ? 0.15 : 0, ease: EMIL_EASE },
                        }}
                        className="space-y-3 min-w-0"
                      >
                        {(activeFeaturedRace.distances || []).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {activeFeaturedRace.distances.map((d) => (
                              <span
                                key={`featured_${activeFeaturedRace.id}_${d.id}`}
                                className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 py-1 font-mono text-xs font-semibold text-[var(--text-primary)]"
                              >
                                {d.label}
                                {d.price > 0 ? ` · ₱${d.price.toLocaleString('en-PH')}` : ' · Free'}
                              </span>
                            ))}
                          </div>
                        )}

                        {(activeFeaturedRace.inclusions || []).length > 0 && (
                          <p className="type-caption text-[var(--text-secondary)] line-clamp-3">
                            Kit includes: {activeFeaturedRace.inclusions.join(', ')}
                          </p>
                        )}
                      </m.div>
                    </div>

                    <m.div
                      initial={cardTextInitial}
                      animate={{ opacity: 1, x: 0, transitionEnd: { transform: 'none' } }}
                      transition={{
                        ...KINETIC_SPRING,
                        delay: carouselInteracted ? 0.19 : 0,
                        opacity: { duration: 0.18, delay: carouselInteracted ? 0.19 : 0, ease: EMIL_EASE },
                      }}
                      className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]"
                    >
                      {activeFeaturedRace.posterImage && (
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          onClick={() => setLightboxRace(activeFeaturedRace)}
                        >
                          <Maximize2 className="w-4 h-4" aria-hidden="true" />
                          <span>Full poster</span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant={regOpen ? 'outline' : 'default'}
                        size="default"
                        onClick={() => handleSelectRace(activeFeaturedRace.id)}
                      >
                        <span>View details</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {regOpen && (
                        <Button type="button" size="default" onClick={() => onRegister(activeFeaturedRace.id)}>
                          <UserPlus className="w-4 h-4" aria-hidden="true" />
                          <span>Register</span>
                        </Button>
                      )}
                    </m.div>
                  </div>
                </div>
              </div>

              {featuredRaces.length > 1 && (
                <div className="px-4 sm:px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1" role="group" aria-label="Choose featured upcoming race poster">
                    {featuredRaces.map((race, idx) => {
                      const isCurrent = idx === activeSlide;
                      return (
                        <button
                          key={`marker_${race.id}`}
                          type="button"
                          onClick={() => goToSlide(idx)}
                          aria-label={`Go to slide ${idx + 1}: ${race.name}`}
                          aria-current={isCurrent ? 'true' : undefined}
                          className="min-h-11 min-w-11 px-1.5 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-lg"
                        >
                          <span
                            aria-hidden="true"
                            className={`block h-2.5 rounded-full transition-[width,background-color] duration-150 ${
                              isCurrent
                                ? 'w-7 bg-red-700 dark:bg-red-400'
                                : 'w-2.5 bg-[var(--border-button)]'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)] mr-1">
                      {activeSlide + 1}/{featuredRaces.length}
                    </span>
                    <Button
                      ref={prevBtnRef}
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={featuredRaces.length === 2 && activeSlide === 0}
                      onClick={() => goToSlide(activeSlide - 1, -1)}
                      aria-label="Previous featured race"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      ref={nextBtnRef}
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={featuredRaces.length === 2 && activeSlide === featuredRaces.length - 1}
                      onClick={() => goToSlide(activeSlide + 1, 1)}
                      aria-label="Next featured race"
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })() : loadState === 'ready' ? (
          /* Clean 16:9 Featured Fallback Banner when no upcoming races exist */
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
            <div className="aspect-video w-full bg-[#141416] border-b border-[var(--border-default)]">
              <img
                src="/assets/hero-runners.webp"
                alt="Filipino runners crossing an official RacePulsePH timing start line"
                width={1200}
                height={675}
                fetchPriority="high"
                loading="eager"
                className="w-full h-full object-cover block"
              />
            </div>
            <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold text-[var(--text-primary)]">
                  Explore recent results and upcoming dates
                </h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  Check completed leaderboards, official finisher bibs, and course maps across RacePulsePH events.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="default"
                className="shrink-0"
                onClick={() => {
                  setCatalogTab('completed');
                  scrollToSection('events-catalog');
                }}
              >
                <span>Browse completed races</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ============================================================
          SECTION 2: PODIUM HIGHLIGHTS (Inserted directly above Upcoming races)
          ============================================================ */}
      <PodiumPulseReel
        searchFocused={searchQuery.trim().length > 0 || bibQuery.trim().length > 0}
        onViewLeaderboard={handleViewHighlightLeaderboard}
        staticCompanion={podiumStaticCompanion}
      />

      {/* ============================================================
          SECTION 3: UPCOMING & COMPLETED RACES CATALOG
          ============================================================ */}
      <section
        id="upcoming-races"
        tabIndex={-1}
        className="space-y-6 pt-8 border-t border-[var(--border-default)] scroll-mt-[84px]"
        aria-labelledby="catalog-heading"
      >
        <div id="events-catalog" className="landing-race-grid-scope space-y-5">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-[var(--border-default)] pb-4">
            <div className="space-y-1">
              <h2 id="catalog-heading" className="type-section text-[var(--text-primary)]">
                {catalogTab === 'upcoming'
                  ? 'Upcoming races'
                  : catalogTab === 'completed'
                    ? 'Completed races'
                    : 'All race posters'}
              </h2>
              <p className="type-lead text-[var(--text-secondary)]">
                Select any race poster for full artwork, distances, entry fees, and official standings.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href="/routes"
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('racepulse:navigate', { detail: { url: '/routes' } }));
                }}
                className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] px-4 text-xs font-semibold text-red-700 hover:border-red-600 dark:text-red-400"
              >
                Route Explorer
              </a>
              <Tabs
                variant="accent"
                value={catalogTab}
                onValueChange={(val) => {
                  setCatalogTab(val as 'upcoming' | 'completed' | 'all');
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
                  <TabsTrigger value="all" className="min-h-11 gap-2">
                    <span>All</span>
                    <span className="font-mono">{races.length}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Filter Toolbar */}
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
                placeholder="Search race name, date, or distance"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-h-11 pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {availableDistances.length > 0 && (
              <GlidingFilterBar
                groupId="catalog-distance"
                ariaLabel="Filter races by distance"
                items={[
                  { value: 'all', label: 'All distances' },
                  ...availableDistances.map((dist) => ({ value: dist, label: dist })),
                ]}
                activeValue={selectedDistanceFilter}
                onChange={setSelectedDistanceFilter}
              />
            )}
          </div>

          {loadState === 'loading' ? (
            <RaceCardSkeletonGrid count={4} />
          ) : filteredRaces.length === 0 ? (
            <Card className="p-8 sm:p-10 text-center border-dashed space-y-4">
              <Flag className="w-8 h-8 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                {searchQuery || selectedDistanceFilter !== 'all'
                  ? 'No races match your filters'
                  : 'No races in this view yet'}
              </h3>
              <p className="type-lead text-[var(--text-secondary)] max-w-md mx-auto">
                {searchQuery
                  ? `Nothing matches "${searchQuery}". Clear your search or switch tabs.`
                  : selectedDistanceFilter !== 'all'
                    ? 'No race offers that distance right now. Reset filters to view all events.'
                    : 'Published events in this category will appear here.'}
              </p>
              {(searchQuery || selectedDistanceFilter !== 'all') && (
                <Button variant="outline" size="default" className="min-h-11 px-5" onClick={handleResetCatalogFilters}>
                  Reset filters
                </Button>
              )}
            </Card>
          ) : (() => {
            const raceGridAnimKey = `${catalogTab}:${selectedDistanceFilter}`;
            return (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredRaces.map((race, index) => {
                  const isSelected = race.id === selectedRaceId;
                  const regOpen = isRaceRegistrationOpen(race, today);
                  const isLive = !!race.liveBroadcastEnabled;
                  const isCompleted = !!race.completedAt || race.date < today;
                  const isTrail = isTrailRace(race);
                  const scheduleNote = formatRaceScheduleNote(race, today);
                  const finisherCount = resultsByRaceId[race.id]?.officialResults?.length || 0;
                  const isStaggered = index < 8 && !prefersReducedMotion;
                  const delay = index * 0.04;

                  return (
                    <m.li
                      key={`${raceGridAnimKey}:${race.id}`}
                      id={`race-card-${race.id}`}
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
                      className="flex min-w-0 scroll-mt-24"
                    >
                      <KineticRaceCard isTrail={isTrail} isSelected={isSelected}>
                        <div className="min-w-0">
                          {/* Native 16:9 Race Poster Stage (Zero overlaid text or badges) */}
                          <div className="aspect-video w-full bg-[var(--surface-inset)] border-b border-[var(--border-default)] overflow-hidden">
                            {race.posterImage ? (
                              <button
                                type="button"
                                onClick={() => setLightboxRace(race)}
                                aria-label={`Inspect full poster for ${race.name}`}
                                className="group relative block w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
                              >
                                <img
                                  src={race.posterImage}
                                  alt={`${race.name} official race poster`}
                                  width={800}
                                  height={450}
                                  loading="lazy"
                                  className="rp-race-poster-img w-full h-full object-contain block"
                                />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSelectRace(race.id)}
                                aria-label={`View details for ${race.name}`}
                                className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#141416] text-white space-y-2 cursor-pointer"
                              >
                                <Trophy className="w-8 h-8 text-red-400" aria-hidden="true" />
                                <span className="font-display font-semibold text-base line-clamp-2 max-w-sm">
                                  {race.name}
                                </span>
                              </button>
                            )}
                          </div>

                          <CardContent className="relative overflow-hidden p-4 sm:p-5 space-y-3 min-w-0">
                            {isTrail && <TopographicContoursSvg variant="trail" />}

                            <div className="relative z-10 flex flex-wrap items-center gap-2">
                              {isLive && <Badge variant="live">Live timing</Badge>}
                              {isCompleted ? (
                                <Badge variant="secondary">
                                  {finisherCount > 0 ? `Completed · ${finisherCount} finishers` : 'Completed'}
                                </Badge>
                              ) : regOpen ? (
                                <Badge variant="success">
                                  <TimingChipDot />
                                  <span>Reg open</span>
                                </Badge>
                              ) : (
                                <Badge variant="muted">Reg closed</Badge>
                              )}
                              {scheduleNote && (
                                <span className={`font-mono text-xs font-semibold ${accentText}`}>{scheduleNote}</span>
                              )}
                            </div>

                            <div className="relative z-10 space-y-1 min-w-0">
                              <h3 className="font-display font-semibold text-lg sm:text-xl tracking-tight text-[var(--text-primary)] line-clamp-2">
                                {race.name}
                              </h3>
                              <p className="type-caption text-[var(--text-secondary)] font-mono inline-flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                                <span>{formatReadableRaceDate(race.date)}</span>
                              </p>
                            </div>

                            {(race.distances || []).length > 0 && (
                              <div className="relative z-10 flex flex-wrap gap-2">
                                {race.distances.map((d) => (
                                  <span
                                    key={d.id}
                                    className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] font-mono text-xs font-semibold overflow-hidden"
                                  >
                                    <span className="px-2.5 py-1 bg-red-700/10 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-r border-[var(--border-default)]">
                                      {d.label}
                                    </span>
                                    <span className="px-2.5 py-1 text-[var(--text-primary)]">
                                      {d.price > 0 ? `₱${d.price.toLocaleString('en-PH')}` : 'Free'}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}

                            {(race.inclusions || []).length > 0 && (
                              <p className="relative z-10 type-caption text-[var(--text-secondary)] line-clamp-2">
                                Kit includes: {race.inclusions.join(', ')}
                              </p>
                            )}
                          </CardContent>
                        </div>

                        <div className="relative z-10 px-4 sm:px-5 pb-4 sm:pb-5 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={isSelected ? 'default' : 'secondary'}
                            size="default"
                            aria-pressed={isSelected}
                            onClick={() => handleSelectRace(race.id)}
                            className="min-h-11 flex-1 justify-between px-4"
                          >
                            <span>{isCompleted ? 'Official results' : 'View details'}</span>
                            <ArrowRight className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          {!isCompleted && regOpen && (
                            <Button
                              type="button"
                              size="default"
                              onClick={() => onRegister(race.id)}
                              className="min-h-11 px-4 shrink-0"
                            >
                              Register
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleCopyRaceLink(race.id)}
                            aria-label={copiedRaceId === race.id ? 'Race link copied' : `Copy link for ${race.name}`}
                            title="Copy race link"
                          >
                            {copiedRaceId === race.id ? (
                              <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                            ) : (
                              <Link2 className="w-4 h-4" aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </KineticRaceCard>
                    </m.li>
                  );
                })}
              </ul>
            );
          })()}
        </div>

        {/* Inline Selected Race Drawer (Synced with ?race=<id>) */}
        {selectedRace && (
          <div
            id="public-race-results"
            className="scroll-mt-[84px] rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-6 space-y-4"
            aria-labelledby="selected-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
              <div className="min-w-0">
                <p className="type-caption font-mono text-[var(--text-secondary)]">Selected event standings</p>
                <h3 id="selected-heading" className="type-section text-[var(--text-primary)] truncate">
                  {selectedRace.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  className="min-h-11 px-4"
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
                      <span>Copy link</span>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  className="min-h-11 px-4"
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
          </div>
        )}
      </section>

      {/* ============================================================
          CONDITIONAL LIVE TIMING HUB (Rendered only when race is live)
          ============================================================ */}
      {liveRaces.length > 0 && (
        <section className="space-y-4 pt-8 border-t border-[var(--border-default)]" aria-labelledby="live-heading">
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

      {/* ============================================================
          SECTION 2: OFFICIAL RUNNER BIBS & INSTANT LOOKUP
          ============================================================ */}
      <section
        id="official-bibs"
        tabIndex={-1}
        className="landing-below-fold space-y-6 pt-8 border-t border-[var(--border-default)] scroll-mt-[84px]"
        aria-labelledby="official-bibs-heading"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 id="official-bibs-heading" className="type-section text-[var(--text-primary)]">
              Official runner bibs
            </h2>
            <p className="type-lead text-[var(--text-secondary)]">
              Search by bib number, runner name, or race to verify finish times and download certificates.
            </p>
          </div>

          {allPublishedFinishers.length > 0 && (
            <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)] self-start sm:self-end">
              <OdometerNumber value={filteredOfficialBibs.length} durationMs={350} /> official{' '}
              {filteredOfficialBibs.length === 1 ? 'record' : 'records'}
            </span>
          )}
        </div>

        {/* Unified Lookup Controls */}
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
            <form
              role="search"
              aria-label="Official finisher bib lookup"
              onSubmit={(e) => {
                e.preventDefault();
                bibInputRef.current?.focus({ preventScroll: true });
              }}
              className="relative flex-1 min-w-0"
            >
              <label htmlFor="official-bib-search" className="sr-only">
                Search bib number, runner name, or race
              </label>
              <Search
                className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                aria-hidden="true"
              />
              <Input
                ref={bibInputRef}
                id="official-bib-search"
                type="search"
                value={bibQuery}
                onChange={(e) => {
                  setBibQuery(e.target.value);
                  setShowMoreBibs(false);
                }}
                placeholder="Search bib number, runner name, or race"
                className="min-h-11 pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {bibQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setBibQuery('');
                    bibInputRef.current?.focus();
                  }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  aria-label="Clear bib search"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </form>

            {bibAvailableRaces.length > 1 && (
              <div className="flex items-center gap-2 shrink-0">
                <label htmlFor="bib-race-filter" className="sr-only">
                  Filter bibs by race
                </label>
                <select
                  id="bib-race-filter"
                  value={bibRaceFilter}
                  onChange={(e) => {
                    setBibRaceFilter(e.target.value);
                    setBibDistanceFilter('all');
                    setShowMoreBibs(false);
                  }}
                  className="min-h-11 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] px-3 py-2 text-xs sm:text-sm font-semibold text-[var(--text-primary)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  <option value="all">All published races</option>
                  {bibAvailableRaces.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {bibAvailableDistances.length > 1 && (
            <GlidingFilterBar
              groupId="bib-distance"
              ariaLabel="Filter official finisher bibs by distance"
              items={[
                { value: 'all', label: 'All distances' },
                ...bibAvailableDistances.map((dist) => ({ value: dist, label: dist })),
              ]}
              activeValue={bibDistanceFilter}
              onChange={(val) => {
                setBibDistanceFilter(val);
                setShowMoreBibs(false);
              }}
            />
          )}
        </div>

        {/* Bib Cards Grid States */}
        {resultsLoadState === 'loading' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <CardSkeletonLoader label="Loading official runner bibs" />
            <CardSkeletonLoader label="Loading official runner bibs" />
            <CardSkeletonLoader label="Loading official runner bibs" />
          </div>
        ) : resultsLoadState === 'error' ? (
          <Card className="p-6 text-center border-red-600/40 space-y-3">
            <p role="alert" className="text-sm font-semibold text-[var(--text-primary)]">
              Unable to load official finisher bibs right now.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Retry</span>
            </Button>
          </Card>
        ) : allPublishedFinishers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-2">
            <Trophy className="w-7 h-7 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              No published official finisher bibs yet
            </p>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
              Verified finisher bibs, official times, and certificates appear here once a timed race publishes results.
            </p>
          </div>
        ) : visibleOfficialBibs.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center space-y-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              No official bib matched &ldquo;{bibQuery}&rdquo;
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Check your bib spelling or clear active filters.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBibQuery('');
                setBibDistanceFilter('all');
                setBibRaceFilter('all');
                bibInputRef.current?.focus();
              }}
            >
              Clear search
            </Button>
          </div>
        ) : (() => {
          const bibGridAnimKey = `${bibRaceFilter}:${bibDistanceFilter}`;
          return (
            <div className="space-y-4">
              <ul
                className={`grid gap-5 ${
                  visibleOfficialBibs.length === 1
                    ? 'grid-cols-1 max-w-md'
                    : visibleOfficialBibs.length === 2
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                }`}
              >
                {visibleOfficialBibs.map(({ race, entry }, index) => {
                  const bibKey = `${race.id}_${entry.bibNumber}_${entry.distance}`;
                  const isDownloading = downloadingBibKey === bibKey;
                  const isDownloaded = downloadedBibKey === bibKey;
                  const displayName = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;
                  const parsedDist = parseDistanceAndEntryCategory(entry.distance);
                  const headerDist = parsedDist.baseDistance || entry.distance;
                  const headerFormat =
                    parsedDist.entryCategory !== 'solo' ? entryCategoryLabels[parsedDist.entryCategory] : '';
                  const overallRank = entry.overallRank ?? entry.rank;
                  const isTopThree = overallRank <= 3;
                  const timingLabel =
                    entry.timingMethod === 'gun'
                      ? 'Gun timed'
                      : entry.timingMethod === 'transition'
                        ? 'Transition timed'
                        : 'Chip timed';
                  const isStaggered = index < 8 && !prefersReducedMotion;
                  const delay = index * 0.04;

                  return (
                    <m.li
                      key={`${bibGridAnimKey}:bib_${bibKey}`}
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
                      className="flex min-w-0"
                    >
                      <KineticBibCard>
                        <div className="relative z-10 min-w-0">
                          {/* Signature Race Bib Top Band */}
                          <div
                            className={`px-4 py-2.5 flex items-center justify-between gap-2 font-mono text-xs font-semibold text-white ${
                              isTopThree ? 'bg-red-700' : 'bg-[#141416]'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0 truncate">
                              <span
                                className="w-2 h-2 rounded-full bg-white/30 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="truncate">{race.name}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span>
                                {headerDist}
                                {headerFormat ? ` · ${headerFormat}` : ''}
                              </span>
                              <span
                                className="w-2 h-2 rounded-full bg-white/30 shrink-0"
                                aria-hidden="true"
                              />
                            </span>
                          </div>

                          {/* Race Bib Plate */}
                          <div className="p-4 sm:p-5 space-y-3 min-w-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-[var(--border-default)] pb-3">
                              <span className="font-mono text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                                {entry.bibNumber}
                              </span>
                              <span className="inline-flex items-center gap-2 font-mono text-sm font-semibold tabular-nums px-3 py-1 rounded-lg bg-[var(--surface-inset)] text-emerald-700 dark:text-emerald-400 border border-[var(--border-default)]">
                                <TimingChipDot />
                                <RaceTimeText
                                  value={entry.finishTime}
                                  odometer
                                  odometerKey={bibGridAnimKey}
                                />
                              </span>
                            </div>

                            <div className="space-y-1 min-w-0">
                              <h3 className="font-display font-semibold text-base text-[var(--text-primary)] truncate">
                                {displayName}
                              </h3>
                              <p className="type-caption font-mono text-[var(--text-secondary)]">
                                Rank #{overallRank} Overall
                                {entry.categoryRank ? ` · ${entry.categoryLabel || 'Category'} #${entry.categoryRank}` : ''}
                                {' · '}
                                {timingLabel}
                              </p>
                              <p className="type-caption font-mono text-[var(--text-secondary)]">
                                {formatReadableRaceDate(race.date)}
                              </p>
                              {entry.specialAgeAwards && entry.specialAgeAwards.length > 0 && (
                                <p className="text-xs font-mono font-semibold text-red-700 dark:text-red-400 truncate pt-0.5">
                                  {entry.specialAgeAwards.join(' · ')}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Laminated Tyvek Dotted Tear-Line & Action Stub */}
                        <div className="relative z-10 min-w-0">
                          <div className="rp-bib-tear-seam relative flex items-center" aria-hidden="true">
                            <span className="rp-bib-notch rp-bib-notch-left" />
                            <span className="w-full border-t-2 border-dotted border-[var(--border-default)]" />
                            <span className="rp-bib-notch rp-bib-notch-right" />
                          </div>
                          <div className="px-4 sm:px-5 py-3 bg-[var(--surface-inset)] flex flex-wrap items-center justify-between gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-11 px-3 text-xs"
                              onClick={() => handleSelectRace(race.id)}
                            >
                              <span>Leaderboard</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11 px-4 text-xs hover:border-red-600/60 dark:hover:border-red-400/60"
                              disabled={isDownloading}
                              onClick={() => handleDownloadCertificate(race, entry)}
                            >
                              {isDownloading ? (
                                <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                              ) : isDownloaded ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                              ) : (
                                <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              <span>{isDownloaded ? 'Saved' : 'Certificate'}</span>
                            </Button>
                          </div>
                        </div>
                      </KineticBibCard>
                    </m.li>
                  );
                })}
              </ul>

              {filteredOfficialBibs.length > visibleOfficialBibs.length && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={() => setShowMoreBibs(true)}
                  >
                    Show more bibs ({filteredOfficialBibs.length - visibleOfficialBibs.length} remaining)
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </section>

      {/* ============================================================
          SECTION 3: AGE-CATEGORY STATISTICS
          ============================================================ */}
      <PublicAgeStatsSection
        races={races}
        resultsByRaceId={resultsByRaceId}
        loadState={loadState}
        resultsLoadState={resultsLoadState}
      />

      {/* Full-Resolution Uncropped Race Poster Lightbox (Android back handled by DialogSurface) */}
      {lightboxRace && lightboxRace.posterImage && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="min(96vw, 60rem)"
          titleId="poster-lightbox-title"
          onRequestClose={() => setLightboxRace(null)}
          bodyClassName="p-4 sm:p-6 space-y-4 text-[var(--text-primary)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2
                id="poster-lightbox-title"
                className="font-display text-lg sm:text-xl font-semibold text-[var(--text-primary)]"
              >
                {lightboxRace.name}
              </h2>
              <p className="type-caption font-mono text-[var(--text-secondary)]">
                {formatReadableRaceDate(lightboxRace.date)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setLightboxRace(null)}
              aria-label="Close poster lightbox"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="aspect-video w-full rounded-xl border border-[var(--border-default)] bg-[#141416] overflow-hidden">
            <img
              src={lightboxRace.posterImage}
              alt={`${lightboxRace.name} full official poster`}
              width={800}
              height={450}
              className="w-full h-full object-contain block"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap gap-2">
              {(lightboxRace.distances || []).map((d) => (
                <span
                  key={`lb_${d.id}`}
                  className="inline-flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2.5 py-1 font-mono text-xs font-semibold text-[var(--text-primary)]"
                >
                  {d.label}
                  {d.price > 0 ? ` · ₱${d.price.toLocaleString('en-PH')}` : ' · Free'}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => {
                  const raceId = lightboxRace.id;
                  setLightboxRace(null);
                  handleSelectRace(raceId);
                }}
              >
                <span>View details</span>
              </Button>
              {isRaceRegistrationOpen(lightboxRace, today) && (
                <Button
                  type="button"
                  size="default"
                  onClick={() => {
                    const raceId = lightboxRace.id;
                    setLightboxRace(null);
                    onRegister(raceId);
                  }}
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>Register</span>
                </Button>
              )}
            </div>
          </div>
        </DialogSurface>
      )}
    </main>
  );
}
