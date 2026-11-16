import React, { useMemo, useState } from 'react';
import { Award, Copy, Edit3, Eye, Flag, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import {
  formatReadableDate,
  getHighlightBibDisplay,
  getHighlightDisplayTitle,
  isHighlightExpired,
} from '../../lib/highlights';
import { Race, RunnerHighlight } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import HighlightCustomSelect, { HighlightSelectOption } from './HighlightCustomSelect';

type PublishedFilterMode = 'all' | 'pinned' | 'multi-event' | 'expired';

interface PublishedHighlightsManagerProps {
  highlights: RunnerHighlight[];
  orderedHighlights: RunnerHighlight[];
  races: Race[];
  canManage: boolean;
  onCreateNew: () => void;
  onEdit: (item: RunnerHighlight) => void;
  onDuplicate: (item: RunnerHighlight) => void;
  onTogglePin: (item: RunnerHighlight) => void;
  onDelete: (item: RunnerHighlight) => void;
  onPreviewDossier: (item: RunnerHighlight) => void;
}

export default function PublishedHighlightsManager({
  highlights,
  orderedHighlights,
  races,
  canManage,
  onCreateNew,
  onEdit,
  onDuplicate,
  onTogglePin,
  onDelete,
  onPreviewDossier,
}: PublishedHighlightsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [raceFilterId, setRaceFilterId] = useState('');
  const [filterMode, setFilterMode] = useState<PublishedFilterMode>('all');

  const raceFilterOptions = useMemo<HighlightSelectOption[]>(() => {
    const counts = new Map<string, number>();
    for (const h of highlights) {
      if (h.raceId) counts.set(h.raceId, (counts.get(h.raceId) || 0) + 1);
    }
    return [
      { value: '', label: 'All Published Events', badge: `${highlights.length} cards` },
      ...races.map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: formatReadableDate(r.date),
        badge: `${counts.get(r.id) || 0} cards`,
      })),
    ];
  }, [highlights, races]);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orderedHighlights.filter((item) => {
      if (raceFilterId) {
        const matchesPrimary = item.raceId === raceFilterId;
        const matchesCareer = (item.participatedEvents || []).some((ev) => ev.raceId === raceFilterId);
        if (!matchesPrimary && !matchesCareer) return false;
      }
      if (filterMode === 'pinned' && !item.pinned) return false;
      if (filterMode === 'multi-event' && (item.participatedEvents?.length || 0) < 2) return false;
      if (filterMode === 'expired' && !isHighlightExpired(item)) return false;

      if (!q) return true;
      return (
        item.runnerName.toLowerCase().includes(q) ||
        (item.partnerName || '').toLowerCase().includes(q) ||
        (item.teamName || '').toLowerCase().includes(q) ||
        (item.groupMembers || []).some(
          (m) => m.name.toLowerCase().includes(q) || (m.bibNumber || '').toLowerCase().includes(q),
        ) ||
        (item.achievements || []).some((a) => a.toLowerCase().includes(q)) ||
        (item.participatedEvents || []).some((ev) => ev.raceName.toLowerCase().includes(q)) ||
        item.bibNumber.toLowerCase().includes(q) ||
        item.raceName.toLowerCase().includes(q)
      );
    });
  }, [orderedHighlights, raceFilterId, filterMode, searchQuery]);

  return (
    <section className="glass-panel p-4 sm:p-5 space-y-4" aria-label="Published highlights manager">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Published Podium Cards ({visibleItems.length}/{highlights.length})
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Inspect achievements, career events, pins, or edit any published collectible card.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 lg:w-[520px]">
          <HighlightCustomSelect
            compact
            searchable
            ariaLabel="Filter published cards by event"
            value={raceFilterId}
            options={raceFilterOptions}
            onChange={setRaceFilterId}
          />
          <div className="relative">
            <Search
              className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Filter published highlights"
              placeholder="Search runner, event, or achievement"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`h-10 pl-9 ${searchQuery ? 'pr-9' : 'pr-3'} text-xs sm:text-sm [&::-webkit-search-cancel-button]:hidden`}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Filter Chips */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Published card status filters">
        {([
          { id: 'all', label: 'All Cards' },
          { id: 'pinned', label: 'Pinned Only' },
          { id: 'multi-event', label: 'Multi-Event Career' },
          { id: 'expired', label: 'Expired' },
        ] as const).map((chip) => {
          const active = filterMode === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilterMode(chip.id)}
              className={`min-h-9 px-3 py-1 rounded-lg border text-xs font-mono transition ${
                active
                  ? 'bg-red-700 text-white border-red-800 shadow-xs'
                  : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-6 text-center space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            {highlights.length === 0
              ? 'No highlights published yet. Use Highlight Studio to create your first collectible podium card.'
              : 'No highlights match your current event or keyword filter.'}
          </p>
          {highlights.length === 0 && canManage && (
            <Button type="button" onClick={onCreateNew} className="h-11 px-4 text-xs">
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Create first highlight</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleItems.map((item) => {
            const expired = isHighlightExpired(item);
            const name = getHighlightDisplayTitle(item);
            const bibLabel = getHighlightBibDisplay(item);
            const achCount = item.achievements?.length || 0;
            const evCount = item.participatedEvents?.length || 0;

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3 min-w-0">
                    <img
                      src={item.photoUrl}
                      alt={name}
                      className="w-16 h-20 rounded-xl object-cover border border-[var(--border-default)] shrink-0 bg-zinc-900"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                        <span className="px-2 py-0.5 rounded bg-red-700 text-white font-semibold">
                          {item.placement}
                        </span>
                        <span className="px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)]">
                          {item.mode.toUpperCase()} {item.distance}
                        </span>
                        {item.pinned && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 font-semibold">
                            PINNED
                          </span>
                        )}
                        {expired && (
                          <span className="px-2 py-0.5 rounded bg-zinc-500/20 text-zinc-600 dark:text-zinc-300">
                            EXPIRED
                          </span>
                        )}
                      </div>
                      <p className="font-display font-semibold text-sm text-[var(--text-primary)] truncate">
                        {name}
                      </p>
                      <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                        {item.raceName} · {item.chipTime} · {bibLabel}
                      </p>
                      <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                        {formatReadableDate(item.raceDate)} · {item.borderPreset}
                      </p>
                    </div>
                  </div>

                  {(achCount > 0 || evCount > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--border-default)] text-[11px] font-mono">
                      {achCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                          <Award className="w-3 h-3" aria-hidden="true" />
                          <span>{achCount} achievement{achCount === 1 ? '' : 's'}</span>
                        </span>
                      )}
                      {evCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)]">
                          <Flag className="w-3 h-3 text-red-700 dark:text-red-400" aria-hidden="true" />
                          <span>{evCount} event{evCount === 1 ? '' : 's'} linked</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-default)]">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onPreviewDossier(item)}
                    className="h-10 px-3 text-xs"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>View</span>
                  </Button>
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(item)}
                        className="h-10 px-3 text-xs"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onDuplicate(item)}
                        className="h-10 px-3 text-xs"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copy</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onTogglePin(item)}
                        className="h-10 px-3 text-xs"
                      >
                        {item.pinned ? (
                          <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{item.pinned ? 'Unpin' : 'Pin'}</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onDelete(item)}
                        className="h-10 px-3 text-xs text-red-700 dark:text-red-400 sm:ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
