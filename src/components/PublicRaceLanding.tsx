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
  Pause,
  Play,
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

const chipBase = 'landing-distance';
const chipIdle = '';
const chipActive = 'is-active';

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

function OdometerStat({ value, paused }: { value: number; paused: boolean }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const reduceMotion =
      paused ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduceMotion || value <= 0) {
      setDisplayValue(value);
      return;
    }

    let rafId = 0;
    const durationMs = 260;
    const startTime = performance.now();
    setDisplayValue(0);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(eased * value));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };

    rafId = requestAnimationFrame(step);
    const fallbackTimer = window.setTimeout(() => {
      setDisplayValue(value);
    }, durationMs + 60);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(fallbackTimer);
    };
  }, [value, paused]);

  return (
    <span className="landing-odometer" aria-label={String(value)}>
      {displayValue}
    </span>
  );
}

export default function PublicRaceLanding({
  onRegister,
  onLoadState,
  onActiveRaceTitle,
}: PublicRaceLandingProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [resultsByRaceId, setResultsByRaceId] = useState<Record<string, PublicLiveResults>>({});
  const [resultsLoadState, setResultsLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedRaceId, setSelectedRaceId] = useState<string>(() => initialRaceIdFromUrl());
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistanceFilter, setSelectedDistanceFilter] = useState<string>('all');
  const [bibQuery, setBibQuery] = useState('');
  const [isBibSearchFocused, setIsBibSearchFocused] = useState(false);
  const [copiedRaceId, setCopiedRaceId] = useState<string | null>(null);
  const [downloadingBibKey, setDownloadingBibKey] = useState<string | null>(null);
  const [downloadedBibKey, setDownloadedBibKey] = useState<string | null>(null);
  const [certificateNotice, setCertificateNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [heroOutOfView, setHeroOutOfView] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const bibInputRef = useRef<HTMLInputElement>(null);
  const heroSectionRef = useRef<HTMLElement>(null);
  const runnersFigureRef = useRef<HTMLElement>(null);
  const runnersStageRef = useRef<HTMLDivElement>(null);
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

  // Single requestAnimationFrame listener for Hero 3D Cursor & Gyroscope Tilt + Scroll Parallax Fallback
  useEffect(() => {
    const figureEl = runnersFigureRef.current;
    const stageEl = runnersStageRef.current;
    const heroEl = heroSectionRef.current;
    if (!figureEl || !stageEl || !heroEl || typeof window === 'undefined') return;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotionQuery.matches || motionPaused) {
      figureEl.style.setProperty('--tilt-x', '0');
      figureEl.style.setProperty('--tilt-y', '0');
      return;
    }

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId = 0;

    const scheduleFrame = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        currentX += (targetX - currentX) * 0.18;
        currentY += (targetY - currentY) * 0.18;
        figureEl.style.setProperty('--tilt-x', currentX.toFixed(4));
        figureEl.style.setProperty('--tilt-y', currentY.toFixed(4));
        if (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002) {
          scheduleFrame();
        }
      });
    };

    const canHoverFine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const isCoarseTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const rect = heroEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetX = Math.max(-1, Math.min(1, nx));
      targetY = Math.max(-1, Math.min(1, ny));
      scheduleFrame();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      scheduleFrame();
    };

    const onDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const gx = Math.max(-1, Math.min(1, e.gamma / 28));
      const by = Math.max(-1, Math.min(1, (e.beta - 45) / 28));
      targetX = gx * 0.65;
      targetY = by * 0.65;
      scheduleFrame();
    };

    if (canHoverFine) {
      heroEl.addEventListener('pointermove', onPointerMove, { passive: true });
      heroEl.addEventListener('pointerleave', onPointerLeave, { passive: true });
    } else if (isCoarseTouch && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
    }

    // Fallback for browsers that don't support view() scroll-driven animations (modern-web-guidance: parallax-scroll-effects)
    let viewObserver: IntersectionObserver | null = null;
    const supportsViewTimeline =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('(animation-timeline: view()) and (animation-range: entry)');

    const onScrollParallaxFallback = () => {
      const scrollY = window.scrollY;
      const rect = stageEl.getBoundingClientRect();
      const wrapperTop = rect.top + scrollY;
      const wrapperHeight = rect.height;
      const windowHeight = window.innerHeight;
      if (scrollY >= wrapperTop - windowHeight && scrollY <= wrapperTop + wrapperHeight) {
        const scrollPercent = (scrollY - (wrapperTop - windowHeight)) / Math.max(1, wrapperHeight + windowHeight);
        const layers = stageEl.querySelectorAll<HTMLElement>('.landing-parallax-layer');
        layers.forEach((layer, index) => {
          const initialTranslateY = 6 * (index + 1);
          const translateY = initialTranslateY * (1 - scrollPercent);
          layer.style.setProperty(`--scroll-shift-${index + 1}`, `${translateY.toFixed(2)}px`);
        });
      }
    };

    if (!supportsViewTimeline && typeof IntersectionObserver !== 'undefined') {
      viewObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              window.addEventListener('scroll', onScrollParallaxFallback, { passive: true });
              onScrollParallaxFallback();
            } else {
              window.removeEventListener('scroll', onScrollParallaxFallback);
            }
          });
        },
        { threshold: 0 }
      );
      viewObserver.observe(stageEl);
    }

    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      heroEl.removeEventListener('pointermove', onPointerMove);
      heroEl.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('deviceorientation', onDeviceOrientation);
      window.removeEventListener('scroll', onScrollParallaxFallback);
      viewObserver?.disconnect();
    };
  }, [motionPaused]);

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
        setResultsLoadState('ready');
      },
      (err) => {
        console.warn('Public liveResults listener failed:', err.message);
        setResultsLoadState('error');
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
        const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById('public-race-results')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    }
  }, [loadState, selectedRace, today]);

  const handleSelectRace = (raceId: string) => {
    didInitialUrlScrollRef.current = true;
    setSelectedRaceId(raceId);
    syncRaceIdToUrl(raceId);
    requestAnimationFrame(() => {
      const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('public-race-results')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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
      setCertificateNotice({ kind: 'error', text: 'Could not copy the link. You can copy this race link from your browser address bar.' });
      return;
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
    setSearchQuery('');
    setSelectedDistanceFilter('all');
    setSelectedRaceId('');
    syncRaceIdToUrl('');
    requestAnimationFrame(() => {
      scrollToSection('events-catalog');
      searchInputRef.current?.focus({ preventScroll: true });
    });
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDistanceFilter('all');
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-motion-paused={motionPaused ? 'true' : 'false'}
      className="public-landing focus:outline-none"
    >
      {/* Finisher Spotlight Focus Backdrop Scrim */}
      <div
        aria-hidden="true"
        className={`landing-spotlight-scrim ${isBibSearchFocused ? 'is-active' : ''}`}
      />

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
              Retry
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
            className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm ${
              certificateNotice.kind === 'error'
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

      {/* 1. Hero Section: Kinetic Typography, Odometer Live Counter & 4-Layer Cutout Parallax Stage */}
      <section
        ref={heroSectionRef}
        aria-label="RacePulsePH overview"
        className="landing-intro"
      >
        <div className="landing-intro-copy">
          <h1>
            <span className="landing-hero-line landing-hero-line-1">Your next</span>
            <span className="landing-hero-line landing-hero-line-2">
              <span className="landing-finish-phrase">finish line.</span>
            </span>
          </h1>
          <p>Find your race. Choose your distance. Make it to the start with RacePulsePH.</p>
          <div className="landing-intro-actions">
            <Button className="landing-primary" onClick={() => scrollToSection('events-catalog')}>
              Browse races <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" onClick={() => onRegister()}>
              Create account
            </Button>
          </div>
          <div className="landing-race-summary" aria-live="polite">
            {loadState === 'ready' ? (
              <>
                <span>
                  <strong>
                    <OdometerStat value={activeRaces.length} paused={motionPaused} />
                  </strong>{' '}
                  upcoming {activeRaces.length === 1 ? 'race' : 'races'}
                </span>
                <span>
                  <strong>
                    <OdometerStat value={doneRaces.length} paused={motionPaused} />
                  </strong>{' '}
                  completed
                </span>
                {liveRaces.length > 0 && (
                  <span className="landing-live-count">
                    <OdometerStat value={liveRaces.length} paused={motionPaused} /> live now
                  </span>
                )}
              </>
            ) : (
              <span>
                {loadState === 'loading' ? 'Loading the race calendar...' : 'Race calendar temporarily unavailable'}
              </span>
            )}
          </div>
        </div>

        <figure ref={runnersFigureRef} className="landing-runners">
          <div ref={runnersStageRef} className="landing-runners-stage">
            {/* Layer 1: Rounded red/orange background card (.webp) + inline SVG Animated GPX Pace Lines */}
            <div className="landing-track landing-parallax-layer" data-depth="1" aria-hidden="true">
              <img
                src="/assets/hero-layer-1-track.webp"
                alt=""
                width={888}
                height={571}
                decoding="async"
                className="landing-track-card-img"
              />
              <svg
                className="landing-gpx-lines"
                viewBox="0 0 560 360"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  className="landing-gpx-base"
                  d="M -40 245 C 110 150, 290 110, 600 135"
                />
                <path
                  className="landing-gpx-base"
                  d="M -40 290 C 125 190, 310 148, 600 175"
                />
                <path
                  className="landing-gpx-base"
                  d="M -40 332 C 140 232, 330 190, 600 218"
                />
                <path
                  className="landing-gpx-pace landing-gpx-pace-1"
                  d="M -40 245 C 110 150, 290 110, 600 135"
                />
                <path
                  className="landing-gpx-pace landing-gpx-pace-2"
                  d="M -40 290 C 125 190, 310 148, 600 175"
                />
                <path
                  className="landing-gpx-pace landing-gpx-pace-3"
                  d="M -40 332 C 140 232, 330 190, 600 218"
                />
              </svg>
            </div>

            {/* Layer 2: Back-row runners (.webp) */}
            <img
              src="/assets/hero-layer-2-back.webp"
              alt=""
              aria-hidden="true"
              width={888}
              height={571}
              fetchPriority="high"
              decoding="async"
              className="landing-runner-layer landing-layer-back landing-parallax-layer"
              data-depth="2"
            />

            {/* Layer 3: Middle row featuring the "SUGAKOD" banner (.webp) */}
            <img
              src="/assets/hero-layer-3-mid.webp"
              alt=""
              aria-hidden="true"
              width={888}
              height={571}
              fetchPriority="high"
              decoding="async"
              className="landing-runner-layer landing-layer-mid landing-parallax-layer"
              data-depth="3"
            />

            {/* Layer 4: Front-row runners in white, pink, and orange singlets (.webp) */}
            <img
              src="/assets/hero-layer-4-front.webp"
              alt="Philippine road and trail runners in race singlets and numbered bibs"
              width={888}
              height={571}
              fetchPriority="high"
              decoding="async"
              className="landing-runner-layer landing-layer-front landing-parallax-layer"
              data-depth="4"
            />
          </div>

          <figcaption>
            <button
              type="button"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((prev) => !prev)}
              className="landing-motion-toggle"
            >
              {motionPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Resume motion</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Pause motion</span>
                </>
              )}
            </button>
            <span className="landing-caption-brand">
              <span className="landing-finish-mark" aria-hidden="true" />
              <span>Happy running ka Racepulse!</span>
            </span>
          </figcaption>
        </figure>
      </section>

      {/* 2. Finisher Lookup Bar with Animated ECG Heartbeat Perimeter & Podium Spotlight Focus */}
      <section
        className={`landing-lookup ${isBibSearchFocused ? 'is-spotlight-active' : ''}`}
        aria-labelledby="lookup-heading"
      >
        {/* Animated ECG Heartbeat Perimeter SVG */}
        <svg
          className="landing-ecg-perimeter"
          viewBox="0 0 800 180"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="landing-ecg-track"
            pathLength={1000}
            d="M 20 2 L 780 2 Q 798 2 798 20 L 798 160 Q 798 178 780 178 L 20 178 Q 2 178 2 160 L 2 126 L 2 110 L 8 104 L 2 98 L -8 90 L 18 78 L -10 66 L 10 56 L 2 48 L 2 20 Q 2 2 20 2 Z"
          />
          <path
            className="landing-ecg-pulse"
            pathLength={1000}
            d="M 20 2 L 780 2 Q 798 2 798 20 L 798 160 Q 798 178 780 178 L 20 178 Q 2 178 2 160 L 2 126 L 2 110 L 8 104 L 2 98 L -8 90 L 18 78 L -10 66 L 10 56 L 2 48 L 2 20 Q 2 2 20 2 Z"
          />
        </svg>

        <div className="landing-lookup-copy">
          <h2 id="lookup-heading">Already crossed the line?</h2>
          <p>Find your finish time and finisher certificate.</p>
        </div>
        <form
          role="search"
          aria-label="Finisher result and certificate lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (!bibQuery.trim()) {
              handleSwitchToCompletedAndSearch();
            } else {
              document.getElementById('finisher-matches')?.focus({ preventScroll: true });
              scrollToSection('finisher-matches');
            }
          }}
          className="landing-lookup-form"
        >
          <label htmlFor="hero-bib-search" className="landing-field-label">
            Bib number, runner name or race
          </label>
          <div className="flex flex-row items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                aria-hidden="true"
              />
              <Input
                ref={bibInputRef}
                id="hero-bib-search"
                type="search"
                value={bibQuery}
                onFocus={() => setIsBibSearchFocused(true)}
                onBlur={() => setIsBibSearchFocused(false)}
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
              <span>Find result</span>
            </Button>
          </div>
        </form>

        {/* Instant Race Bib Result Matches */}
        {bibQuery.trim().length > 0 && (
          <div
            role="region"
            id="finisher-matches"
            tabIndex={-1}
            aria-live="polite"
            aria-label="Matching finisher results"
            className="landing-lookup-matches space-y-3"
          >
            {loadState === 'error' || resultsLoadState === 'error' ? (
              <div className="landing-empty" role="status">
                <p>Finisher results are temporarily unavailable. Reload the page to try again.</p>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Reload results
                </Button>
              </div>
            ) : loadState === 'loading' || resultsLoadState === 'loading' ? (
              <ResultsSkeletonList rows={2} />
            ) : matchingBibResults.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-secondary)]">
                  No published finisher matches <strong className="text-[var(--text-primary)]">"{bibQuery}"</strong>.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 px-4"
                  onClick={handleSwitchToCompletedAndSearch}
                >
                  Browse completed races
                </Button>
              </div>
            ) : (
              <ul className="space-y-3">
                {matchingBibResults.map(({ race, entry }) => {
                  const key = `${race.id}_${entry.bibNumber}_${entry.distance}`;
                  const isDownloading = downloadingBibKey === key;
                  const displayName = entry.isFreeSlot ? `Bib ${entry.bibNumber}` : entry.fullName;

                  return (
                    <li
                      key={key}
                      className="min-w-0 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] shadow-sm"
                    >
                      {/* Physical Race Bib Header Strip */}
                      <div className="rounded-t-2xl overflow-hidden bg-red-700 text-white px-4 py-2 flex items-center justify-between gap-2 text-xs font-mono font-semibold">
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
                      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-center shrink-0">
                            <span className="block text-xs font-mono text-[var(--text-secondary)]">Bib</span>
                            <span className="block font-mono text-base sm:text-lg font-semibold text-[var(--text-primary)] leading-tight">
                              {entry.bibNumber}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-display font-semibold text-base text-[var(--text-primary)] break-words">
                              {displayName}
                            </p>
                            <p className="text-xs font-mono text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-1">
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

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            className="h-11 px-4"
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
                            className="h-11 px-4"
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
              className="flex flex-wrap items-center gap-2 py-1"
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
            className={`grid gap-4 ${
              filteredRaces.length <= 2
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
                  className="flex min-w-0"
                >
                  <Card
                    className={`group w-full min-w-0 flex flex-col justify-between transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg ${
                      isSelected ? 'ring-2 ring-red-700 dark:ring-red-400' : ''
                    }`}
                  >
                    <div>
                      {/* Poster Art with Status Badges matching Dashboard RaceList height */}
                      <div className="relative h-36 sm:h-40 w-full rounded-t-2xl overflow-hidden bg-[var(--surface-inset)] border-b border-[var(--border-default)]">
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

                        <div className="absolute top-3 left-3 flex flex-wrap gap-2">
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

                      <CardContent className="p-4 sm:p-5 space-y-3 min-w-0">
                        <div className="space-y-2 min-w-0">
                          <h3 className="font-display font-semibold text-lg sm:text-xl tracking-tight text-[var(--text-primary)] line-clamp-2">
                            {race.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-[var(--text-secondary)] font-mono">
                            <span className="flex items-center gap-2">
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
                                className="inline-flex flex-wrap items-center max-w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] font-mono text-xs font-semibold"
                              >
                                <span className="px-3 py-1 bg-red-700/10 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-r border-[var(--border-default)]">
                                  {d.label}
                                </span>
                                <span className="px-3 py-1 text-[var(--text-primary)]">
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
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex flex-wrap gap-2">
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
            className="scroll-mt-[84px] space-y-4 [backface-visibility:hidden]"
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
            className={`grid gap-4 ${
              featuredBibFinishers.length <= 2
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
                  className="flex min-w-0"
                >
                  <div className="w-full min-w-0 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-md flex flex-col justify-between">
                    <div className="min-w-0">
                      {/* Authentic Race Bib Top Header */}
                      <div className="rounded-t-2xl overflow-hidden bg-red-700 text-white px-4 py-2 flex items-center justify-between gap-2 font-mono text-xs font-semibold">
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
                      <div className="p-4 sm:p-5 space-y-3 min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-[var(--border-default)] pb-3">
                          <span className="font-mono text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
                            {entry.bibNumber}
                          </span>
                          <span className="font-mono text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25 max-w-full break-words">
                            {formatRaceTime(entry.finishTime)}
                          </span>
                        </div>

                        <div className="space-y-1 min-w-0">
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
                    <div className="rounded-b-2xl px-4 sm:px-5 py-3 bg-[var(--surface-inset)] border-t border-dashed border-[var(--border-default)] flex flex-wrap items-center justify-between gap-2">
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
                        className="h-11 px-4 text-xs"
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

      {/* Mobile In-Flow Quick Actions Card (non-overlapping replacement for fixed mobile bottom dock) */}
      {heroOutOfView && (
        <div className="md:hidden glass-panel p-4">
          <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 text-xs font-semibold gap-2"
              onClick={() => {
                bibInputRef.current?.focus({ preventScroll: true });
                scrollToSection('hero-bib-search');
              }}
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Find bib</span>
            </Button>
            <Button
              type="button"
              className="h-11 text-xs font-semibold gap-2"
              onClick={() => onRegister()}
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Register</span>
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
