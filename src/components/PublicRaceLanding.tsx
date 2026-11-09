import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Calendar, Flag, UserPlus, Search, Trophy, ArrowRight, X } from 'lucide-react';
import { db } from '../firebase';
import { Race } from '../types';
import PublicLiveRaceHub from './PublicLiveRaceHub';
import PublicRaceResults from './PublicRaceResults';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { isRaceRegistrationOpen, philippineDate } from '../lib/raceRegistration';

interface PublicRaceLandingProps {
  onRegister: (raceId?: string) => void;
  onLoadState?: (state: 'loading' | 'ready' | 'error') => void;
}

// Accent text must clear 4.5:1 on both surfaces: red-700 on light, red-400 on dark.
const accentText = 'text-red-700 dark:text-red-400';

const chipBase =
  'text-xs font-semibold px-4 py-2 rounded-full border transition-all duration-150 motion-safe:active:scale-[0.96] select-none';
const chipIdle =
  'border-[var(--border-default)] bg-[var(--surface-card)] dark:bg-[#141416] text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.25)] hover:border-red-600/50 hover:text-[var(--text-primary)]';
const chipActive =
  'bg-red-700 text-white border-red-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)]';

export default function PublicRaceLanding({ onRegister, onLoadState }: PublicRaceLandingProps) {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistanceFilter, setSelectedDistanceFilter] = useState<string>('all');

  useEffect(() => {
    onLoadState?.(loadState);
  }, [loadState, onLoadState]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'races'),
      (snapshot) => {
        const list: Race[] = [];
        snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
        list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setRaces(list);
        setLoadState('ready');
      },
      (err) => {
        console.warn('Public race list failed to load:', err.message);
        setRaces([]);
        setLoadState('error');
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
    return Array.from(set).sort();
  }, [races]);

  const filteredRaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return currentTabRaces.filter((race) => {
      const matchesSearch =
        !query ||
        race.name.toLowerCase().includes(query) ||
        race.date.includes(query) ||
        (race.distances || []).some((d) => d.label.toLowerCase().includes(query));

      const matchesDistance =
        selectedDistanceFilter === 'all' ||
        (race.distances || []).some((d) => d.label.trim().toUpperCase() === selectedDistanceFilter);

      return matchesSearch && matchesDistance;
    });
  }, [currentTabRaces, searchQuery, selectedDistanceFilter]);

  const selectedRace = useMemo(
    () => races.find((race) => race.id === selectedRaceId),
    [races, selectedRaceId]
  );

  const handleSelectRace = (raceId: string) => {
    setSelectedRaceId(raceId);
    requestAnimationFrame(() => {
      document.getElementById('public-race-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-24 space-y-12">
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

      {/* Hero: states what the site does and gives the two real next actions (browse, sign up). */}
      <section className="space-y-6 py-4 sm:py-8">
        <h1 className="type-hero max-w-4xl text-[var(--text-primary)]">
          Find a Philippine race. <span className="text-red-700 dark:text-red-400">Follow it live.</span> Get your result.
        </h1>
        <p className="type-lead max-w-2xl text-[var(--text-secondary)]">
          Browse upcoming runs, register for a distance, watch checkpoint splits during the race, and download your finisher certificate once results are published.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            size="lg"
            onClick={() => document.getElementById('events-catalog')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <span>Browse races</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => onRegister()}>
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>Create an account</span>
          </Button>
        </div>
        {loadState === 'ready' && (
          <p className="type-caption text-[var(--text-secondary)] font-mono flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
            <span>{activeRaces.length} upcoming, {liveRaces.length} with a live broadcast, {doneRaces.length} completed.</span>
          </p>
        )}
      </section>

      {liveRaces.length > 0 && (
        <section className="space-y-4" aria-labelledby="live-heading">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-700 dark:bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-700 dark:bg-red-400" />
            </span>
            <h2 id="live-heading" className="type-section text-[var(--text-primary)]">
              Live now
            </h2>
          </div>
          <PublicLiveRaceHub races={liveRaces} />
        </section>
      )}

      <section id="events-catalog" className="space-y-6 scroll-mt-24" aria-labelledby="catalog-heading">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--border-default)] pb-4">
          <div className="space-y-2">
            <h2 id="catalog-heading" className="type-section text-[var(--text-primary)]">
              {activeTab === 'upcoming' ? 'Upcoming races' : 'Completed races'}
            </h2>
            <p className="type-lead text-[var(--text-secondary)]">
              {activeTab === 'upcoming'
                ? 'Pick a race to see its distances, fees and status.'
                : 'Pick a race to search its results and download certificates.'}
            </p>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              setActiveTab(val as 'upcoming' | 'completed');
              setSelectedRaceId('');
            }}
            className="w-auto shrink-0"
          >
            <TabsList>
              <TabsTrigger value="upcoming" className="gap-2">
                <span>Upcoming</span>
                <span className="font-mono">{activeRaces.length}</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-2">
                <span>Completed</span>
                <span className="font-mono">{doneRaces.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search races by name, date or distance"
              placeholder="Search by name, date or distance"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {availableDistances.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by distance">
              <button
                type="button"
                aria-pressed={selectedDistanceFilter === 'all'}
                onClick={() => setSelectedDistanceFilter('all')}
                className={`${chipBase} ${selectedDistanceFilter === 'all' ? chipActive : chipIdle}`}
              >
                All distances
              </button>
              {availableDistances.slice(0, 6).map((dist) => (
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

        {filteredRaces.length === 0 ? (
          <Card className="p-12 text-center border-dashed space-y-4">
            <Flag className="w-8 h-8 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
            <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              {searchQuery || selectedDistanceFilter !== 'all' ? 'No races match your filters' : 'No races in this list yet'}
            </h3>
            <p className="type-lead text-[var(--text-secondary)] max-w-md mx-auto">
              {searchQuery
                ? `Nothing matches "${searchQuery}". Clear the search or pick another distance.`
                : selectedDistanceFilter !== 'all'
                  ? 'No race offers that distance. Pick another one.'
                  : 'Organizers have not published a race here yet.'}
            </p>
            {(searchQuery || selectedDistanceFilter !== 'all') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedDistanceFilter('all');
                }}
              >
                Reset filters
              </Button>
            )}
          </Card>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRaces.map((race) => {
              const isSelected = race.id === selectedRaceId;
              const regOpen = isRaceRegistrationOpen(race, today);
              const isLive = !!race.liveBroadcastEnabled;
              const isCompleted = !!race.completedAt;

              return (
                <li key={race.id} className="flex">
                  <Card
                    className={`w-full overflow-hidden flex flex-col justify-between ${
                      isSelected ? 'ring-2 ring-red-700 dark:ring-red-400' : ''
                    }`}
                  >
                    <div>
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--surface-inset)] border-b border-[var(--border-default)]">
                        {race.posterImage ? (
                          <img src={race.posterImage} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-6 text-center">
                            <Trophy className="w-8 h-8 text-[var(--text-secondary)]" aria-hidden="true" />
                          </div>
                        )}

                        <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                          {isLive && <Badge variant="live">Live timing</Badge>}
                          {isCompleted ? (
                            <Badge variant="secondary">Completed</Badge>
                          ) : regOpen ? (
                            <Badge variant="success">Registration open</Badge>
                          ) : (
                            <Badge variant="muted">Registration closed</Badge>
                          )}
                        </div>
                      </div>

                      <CardContent className="p-6 space-y-4">
                        <div className="space-y-2">
                          <h3 className="font-display font-semibold text-lg sm:text-xl tracking-tight text-[var(--text-primary)] line-clamp-2">{race.name}</h3>
                          <p className="type-caption text-[var(--text-secondary)] flex items-center gap-2 font-mono">
                            <Calendar className="w-3.5 h-3.5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                            <span>{race.date}</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {(race.distances || []).length === 0 ? (
                            <span className="type-caption text-[var(--text-secondary)]">Distances not announced yet</span>
                          ) : (
                            race.distances.slice(0, 4).map((d) => (
                              <Badge key={d.id} variant="secondary" className="font-mono font-semibold">
                                {d.label}
                                {d.price > 0 && <span className={accentText}>₱{d.price.toFixed(0)}</span>}
                              </Badge>
                            ))
                          )}
                          {(race.distances || []).length > 4 && (
                            <Badge variant="outline" className="font-mono font-semibold">+{(race.distances || []).length - 4} more</Badge>
                          )}
                        </div>

                        {(race.inclusions || []).length > 0 && (
                          <p className="type-caption text-[var(--text-secondary)] line-clamp-2">
                            Includes: {race.inclusions.join(', ')}
                          </p>
                        )}
                      </CardContent>
                    </div>

                    <div className="px-6 pb-6 flex gap-2">
                      <Button
                        type="button"
                        variant={isSelected ? 'default' : 'secondary'}
                        size="sm"
                        aria-pressed={isSelected}
                        onClick={() => handleSelectRace(race.id)}
                        className="flex-1 justify-between"
                      >
                        <span>{isCompleted ? 'View results' : 'View details'}</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {!isCompleted && regOpen && (
                        <Button type="button" size="sm" onClick={() => onRegister(race.id)} className="shrink-0">
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

      {selectedRace && (
        <section id="public-race-results" className="scroll-mt-24 space-y-4" aria-labelledby="selected-heading">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--border-default)] pb-4">
            <h2 id="selected-heading" className="type-section text-[var(--text-primary)]">
              {selectedRace.name}
            </h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedRaceId('')}>
              <X className="w-4 h-4" aria-hidden="true" />
              <span>Close</span>
            </Button>
          </div>
          <PublicRaceResults race={selectedRace} onRegister={onRegister} />
        </section>
      )}

      <footer className="pt-8 border-t border-[var(--border-default)] flex flex-col sm:flex-row items-center justify-between gap-4 type-caption text-[var(--text-secondary)]">
        <span>&copy; {new Date().getFullYear()} RacePulsePH</span>
        <p>Happy running ka Racepulse!</p>
      </footer>
    </main>
  );
}
