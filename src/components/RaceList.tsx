import { Race } from '../types';
import { Calendar, Flag, ArrowRight, CheckCircle2, Trophy, Tag } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';

interface RaceListProps {
  races: Race[];
  onSelectRace: (raceId: string) => void;
  selectedRaceId?: string;
  registeredRaceIds?: Set<string>;
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export default function RaceList({
  races,
  onSelectRace,
  selectedRaceId,
  registeredRaceIds,
  title = 'Race Events',
  subtitle = 'Choose an event to continue.',
  actionLabel = 'Select This Race',
  emptyTitle = 'No races configured yet',
  emptyDescription = 'Check back once an Admin or Organizer sets one up.',
}: RaceListProps) {
  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[var(--border-default)] pb-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="text-xs font-normal text-[var(--text-secondary)] mt-1">{subtitle}</p>
        </div>
        <span className="text-xs font-mono font-semibold text-[var(--text-secondary)] tabular-nums self-start sm:self-end px-2.5 py-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)]">
          {races.length} {races.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      {races.length === 0 ? (
        <Card className="p-8 text-center border-dashed border-[var(--border-default)] bg-[var(--surface-card)]">
          <div className="w-12 h-12 rounded-2xl bg-[var(--surface-inset)] border border-[var(--border-default)] flex items-center justify-center mx-auto text-[var(--text-secondary)]">
            <Flag className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)] mt-4">
            {emptyTitle}
          </p>
          <p className="text-xs font-normal text-[var(--text-secondary)] mt-1 max-w-sm mx-auto">
            {emptyDescription}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {races.map((race) => {
            const isSelected = race.id === selectedRaceId;
            const isRegistered = registeredRaceIds?.has(race.id) ?? false;
            const regOpen = isRaceRegistrationOpen(race);
            const isLive = !!race.liveBroadcastEnabled;
            const isCompleted = !!race.completedAt;

            return (
              <Card
                key={race.id}
                className={`group overflow-hidden min-w-0 text-left transition-colors duration-150 border-[var(--border-default)] hover:border-red-600/60 flex flex-col justify-between ${
                  isSelected ? 'ring-2 ring-red-600 border-red-600' : ''
                }`}
              >
                <div className="min-w-0">
                  {/* Uncropped 16:9 Official Race Poster */}
                  <div className="aspect-video w-full overflow-hidden bg-[#141416] border-b border-[var(--border-default)]">
                    {race.posterImage ? (
                      <img
                        src={race.posterImage}
                        alt={race.name}
                        width={800}
                        height={450}
                        loading="lazy"
                        className="w-full h-full object-contain block"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[#141416] p-4 text-center">
                        <Trophy className="w-8 h-8 text-zinc-400 mb-2" aria-hidden="true" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                          RacePulse Official Event
                        </span>
                      </div>
                    )}
                  </div>

                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {isLive && (
                        <Badge variant="live" className="gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600" aria-hidden="true" />
                          Live Timing
                        </Badge>
                      )}
                      {isCompleted ? (
                        <Badge variant="secondary" className="text-xs font-semibold">
                          Finished
                        </Badge>
                      ) : regOpen ? (
                        <Badge variant="success" className="text-xs font-semibold">
                          Reg Open
                        </Badge>
                      ) : (
                        <Badge variant="muted" className="text-xs font-semibold">
                          Reg Closed
                        </Badge>
                      )}
                      {isRegistered && (
                        <Badge variant="default" className="text-xs font-semibold">
                          Registered
                        </Badge>
                      )}
                      {isSelected && (
                        <Badge variant="outline" className="gap-1 text-xs font-semibold border-red-600 text-red-700 dark:text-red-400">
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Selected
                        </Badge>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)] group-hover:text-red-700 dark:group-hover:text-red-400 transition-colors">
                        {race.name}
                      </h3>
                      <p className="text-xs font-normal text-[var(--text-secondary)] mt-1 flex items-center gap-2 tabular-nums">
                        <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        <span>{race.date}</span>
                      </p>
                    </div>

                    {/* Distances & Prices */}
                    <div className="flex flex-wrap gap-2">
                      {(race.distances || []).length === 0 ? (
                        <span className="text-xs text-[var(--text-secondary)]">Distances to be announced</span>
                      ) : (
                        race.distances.map((d) => (
                          <Badge
                            key={d.id}
                            variant="secondary"
                            className="text-xs py-1 px-2 font-semibold border-[var(--border-default)] tabular-nums"
                          >
                            {d.label}
                            {d.price > 0 && <span className="text-red-700 dark:text-red-400 ml-1">₱{d.price.toFixed(0)}</span>}
                          </Badge>
                        ))
                      )}
                    </div>

                    {/* Inclusions */}
                    {(race.inclusions || []).length > 0 && (
                      <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)] line-clamp-1">
                        <Tag className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0 mt-1" aria-hidden="true" />
                        <span className="truncate">Includes: {race.inclusions.join(', ')}</span>
                      </div>
                    )}
                  </CardContent>
                </div>

                <div className="px-4 pb-4 pt-0">
                  <Button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectRace(race.id)}
                    variant={isSelected ? 'default' : 'secondary'}
                    className="w-full min-h-11 h-11 justify-between text-xs"
                  >
                    <span>{isSelected ? 'Active Selection' : actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
