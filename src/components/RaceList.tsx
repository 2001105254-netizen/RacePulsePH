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
  title = 'Race Events',
  subtitle = 'Choose an event to continue.',
  actionLabel = 'Select This Race',
  emptyTitle = 'No races configured yet',
  emptyDescription = 'Check back once an Admin or Organizer sets one up.',
}: RaceListProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[var(--border-default)] pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold uppercase tracking-tight text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="text-xs font-normal text-[var(--text-secondary)] mt-1">{subtitle}</p>
        </div>
        <span className="text-xs font-mono font-semibold text-[var(--text-muted)] self-start sm:self-end">
          {races.length} {races.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      {races.length === 0 ? (
        <Card className="p-8 text-center border-dashed border-[var(--border-default)] bg-[var(--surface-card)]">
          <div className="w-12 h-12 rounded-2xl bg-[var(--surface-inset)] border border-[var(--border-default)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
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
            const regOpen = isRaceRegistrationOpen(race);
            const isLive = !!race.liveBroadcastEnabled;
            const isCompleted = !!race.completedAt;

            return (
              <Card
                key={race.id}
                onClick={() => onSelectRace(race.id)}
                className={`group cursor-pointer overflow-hidden text-left transition-colors duration-200 border-[var(--border-default)] hover:border-red-500/50 flex flex-col justify-between ${
                  isSelected ? 'ring-2 ring-red-600 border-red-600' : ''
                }`}
              >
                <div>
                  {/* Poster or Fallback Banner */}
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-900 border-b border-[var(--border-default)]">
                    {race.posterImage ? (
                      <img
                        src={race.posterImage}
                        alt={race.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 p-6 text-center">
                        <Trophy className="w-10 h-10 text-zinc-600 mb-2" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          RacePulse Official Event
                        </span>
                      </div>
                    )}

                    {/* Status Badges Overlay */}
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 z-10">
                      {isLive && (
                        <Badge variant="live" className="gap-1.5 shadow-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                          Live Timing
                        </Badge>
                      )}
                      {isCompleted ? (
                        <Badge variant="secondary" className="shadow-sm text-xs font-semibold uppercase">
                          Finished
                        </Badge>
                      ) : regOpen ? (
                        <Badge variant="success" className="shadow-sm text-xs font-semibold uppercase">
                          Reg Open
                        </Badge>
                      ) : (
                        <Badge variant="muted" className="shadow-sm text-xs font-semibold uppercase">
                          Reg Closed
                        </Badge>
                      )}
                    </div>

                    {isSelected && (
                      <div className="absolute top-3 right-3 z-10">
                        <Badge variant="default" className="gap-1 shadow-sm text-xs font-semibold uppercase">
                          <CheckCircle2 className="w-3 h-3" /> Selected
                        </Badge>
                      </div>
                    )}
                  </div>

                  <CardContent className="p-6 space-y-4">
                    <div>
                      <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)] group-hover:text-red-600 transition-colors">
                        {race.name}
                      </h3>
                      <p className="text-xs font-normal text-[var(--text-secondary)] mt-1.5 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        <span>{race.date}</span>
                      </p>
                    </div>

                    {/* Distances & Prices */}
                    <div className="flex flex-wrap gap-1.5">
                      {(race.distances || []).length === 0 ? (
                        <span className="text-xs text-[var(--text-muted)] italic">Distances to be announced</span>
                      ) : (
                        race.distances.map((d) => (
                          <Badge
                            key={d.id}
                            variant="secondary"
                            className="text-xs py-0.5 px-2 font-semibold border-[var(--border-default)]"
                          >
                            {d.label}
                            {d.price > 0 && <span className="text-red-600 ml-1">₱{d.price.toFixed(0)}</span>}
                          </Badge>
                        ))
                      )}
                    </div>

                    {/* Inclusions */}
                    {(race.inclusions || []).length > 0 && (
                      <div className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)] line-clamp-1">
                        <Tag className="w-3 h-3 text-red-600 shrink-0 mt-0.5" />
                        <span className="truncate">Includes: {race.inclusions.join(', ')}</span>
                      </div>
                    )}
                  </CardContent>
                </div>

                <div className="px-6 pb-6 pt-0">
                  <Button
                    type="button"
                    variant={isSelected ? 'default' : 'secondary'}
                    size="sm"
                    className="w-full justify-between text-xs"
                  >
                    <span>{isSelected ? 'Active Selection' : actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
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
