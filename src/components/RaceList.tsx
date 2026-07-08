import { Race } from '../types';
import { Calendar, Flag, ArrowRight, CheckCircle } from 'lucide-react';

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

// Shared race-picker card grid used by every role: Runners browse it to register,
// Admins/Organizers browse it to pick which race they're actively timing.
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
    <div className="max-w-4xl mx-auto space-y-5 animate-fadeIn">
      <div className="text-center">
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">{title}</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{subtitle}</p>
      </div>

      {races.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <Flag className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <p className="text-sm font-bold text-[var(--text-primary)] mt-3">{emptyTitle}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">{emptyDescription}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {races.map((race) => {
            const isSelected = race.id === selectedRaceId;
            return (
              <button
                key={race.id}
                onClick={() => onSelectRace(race.id)}
                className={`glass-panel p-5 text-left space-y-3 hover:shadow-2xl hover:shadow-red-950/10 transition duration-300 transform hover:-translate-y-1 relative ${
                  isSelected ? 'border-red-500/60' : 'hover:border-red-500/40'
                }`}
              >
                {isSelected && (
                  <span className="absolute top-3 right-3 text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full bg-red-600 text-white flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Active
                  </span>
                )}

                <div>
                  <h3 className="text-md font-bold font-display tracking-tight text-[var(--text-primary)] pr-16">{race.name}</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-red-500" /> {race.date}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(race.distances || []).length === 0 ? (
                    <span className="text-[10px] text-[var(--text-muted)]">Distances not set yet</span>
                  ) : (
                    race.distances.map((d) => (
                      <span key={d.id} className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">
                        {d.label}{d.price > 0 && ` · ₱${d.price.toFixed(0)}`}
                      </span>
                    ))
                  )}
                </div>

                {(race.inclusions || []).length > 0 && (
                  <p className="text-[10.5px] text-[var(--text-secondary)]">
                    Includes: {race.inclusions.join(', ')}
                  </p>
                )}

                <p className="text-[10.5px] text-[var(--text-muted)]">
                  {race.checkpoints.length} checkpoints &bull; {(race.ageCategories || []).length} age categories
                </p>

                {!isSelected && (
                  <div className="text-xs font-bold text-red-500 flex items-center gap-1 font-display pt-1 uppercase tracking-wide">
                    {actionLabel} <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
