import React, { useState } from 'react';
import { Award, Check, Flag, Plus, Sparkles, Star, Trash2, X } from 'lucide-react';
import {
  deriveRunnerAchievements,
  DirectoryRunner,
  entriesToParticipatedEvents,
  formatReadableDate,
  HIGHLIGHT_ACHIEVEMENT_PRESETS,
  HIGHLIGHT_CAPS,
  HIGHLIGHT_PLACEMENTS,
  RunnerRaceEntry,
} from '../../lib/highlights';
import { HighlightParticipatedEvent, RunnerHighlight } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import HighlightCustomSelect from './HighlightCustomSelect';

interface CareerAchievementsEditorProps {
  draft: RunnerHighlight;
  activeRunner: DirectoryRunner | null;
  canManage: boolean;
  onUpdateDraft: (updater: (prev: RunnerHighlight) => RunnerHighlight) => void;
  onSelectPrimaryEntry: (entry: RunnerRaceEntry, runner: DirectoryRunner) => void;
}

/**
 * Unifies Achievements and Participated Events + Placements inside a single Highlight card,
 * with 1-click career synchronization from any DirectoryRunner plus manual customization.
 */
export default function CareerAchievementsEditor({
  draft,
  activeRunner,
  canManage,
  onUpdateDraft,
  onSelectPrimaryEntry,
}: CareerAchievementsEditorProps) {
  const [newAchievement, setNewAchievement] = useState('');
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [customRaceName, setCustomRaceName] = useState('');
  const [customRaceDate, setCustomRaceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customDistance, setCustomDistance] = useState('10K');
  const [customPlacement, setCustomPlacement] = useState('Finisher');
  const [customChipTime, setCustomChipTime] = useState('');
  const [customBibNumber, setCustomBibNumber] = useState('');

  const achievements = draft.achievements || [];
  const participatedEvents = draft.participatedEvents || [];

  const handleTogglePresetAchievement = (preset: string) => {
    const clean = preset.trim().toUpperCase().slice(0, 28);
    if (!clean) return;
    onUpdateDraft((prev) => {
      const current = prev.achievements || [];
      const exists = current.some((a) => a.toLowerCase() === clean.toLowerCase());
      if (exists) {
        return {
          ...prev,
          achievements: current.filter((a) => a.toLowerCase() !== clean.toLowerCase()),
        };
      }
      if (current.length >= 8) return prev;
      return {
        ...prev,
        achievements: [...current, clean],
      };
    });
  };

  const handleAddCustomAchievement = () => {
    const clean = newAchievement.trim().replace(/\s+/g, ' ').slice(0, 28);
    if (!clean) return;
    onUpdateDraft((prev) => {
      const current = prev.achievements || [];
      if (current.some((a) => a.toLowerCase() === clean.toLowerCase()) || current.length >= 8) {
        return prev;
      }
      return {
        ...prev,
        achievements: [...current, clean],
      };
    });
    setNewAchievement('');
  };

  const handleAutoDeriveAchievements = () => {
    const sourceEntries =
      activeRunner && activeRunner.entries.length > 0
        ? activeRunner.entries
        : participatedEvents;
    const derived = deriveRunnerAchievements(sourceEntries, draft.placement, draft.badgeStamp);
    onUpdateDraft((prev) => ({
      ...prev,
      achievements: derived,
    }));
  };

  const handleSyncAllRunnerEvents = () => {
    if (!activeRunner || activeRunner.entries.length === 0) return;
    const syncedEvents = entriesToParticipatedEvents(activeRunner.entries);
    const derived = deriveRunnerAchievements(activeRunner.entries, draft.placement, draft.badgeStamp);
    onUpdateDraft((prev) => ({
      ...prev,
      participatedEvents: syncedEvents,
      achievements: derived.length > 0 ? derived : prev.achievements,
    }));
  };

  const handleUpdateEventPlacement = (idx: number, placement: string) => {
    onUpdateDraft((prev) => {
      const list = [...(prev.participatedEvents || [])];
      if (!list[idx]) return prev;
      list[idx] = { ...list[idx], placement };
      return { ...prev, participatedEvents: list };
    });
  };

  const handleRemoveParticipatedEvent = (idx: number) => {
    onUpdateDraft((prev) => ({
      ...prev,
      participatedEvents: (prev.participatedEvents || []).filter((_, i) => i !== idx),
    }));
  };

  const handleSetPrimaryFromEvent = (ev: HighlightParticipatedEvent) => {
    if (activeRunner && ev.raceId) {
      const matched = activeRunner.entries.find(
        (e) => e.raceId === ev.raceId && (!ev.bibNumber || e.bibNumber === ev.bibNumber),
      );
      if (matched) {
        onSelectPrimaryEntry(matched, activeRunner);
        return;
      }
    }
    onUpdateDraft((prev) => ({
      ...prev,
      raceId: ev.raceId || prev.raceId,
      raceName: ev.raceName.slice(0, HIGHLIGHT_CAPS.raceName),
      raceDate: ev.raceDate || prev.raceDate,
      distance: ev.distance.slice(0, HIGHLIGHT_CAPS.distance),
      placement: ev.placement,
      chipTime: ev.chipTime || prev.chipTime,
      pace: ev.pace || prev.pace,
      bibNumber: ev.bibNumber || prev.bibNumber,
    }));
  };

  const handleAddCustomEvent = () => {
    const cleanName = customRaceName.trim().slice(0, 56);
    if (!cleanName) return;
    const item: HighlightParticipatedEvent = {
      raceName: cleanName,
      raceDate: customRaceDate || draft.raceDate,
      distance: customDistance.trim().slice(0, 18) || '10K',
      placement: customPlacement || 'Finisher',
    };
    if (customChipTime.trim()) item.chipTime = customChipTime.trim().slice(0, HIGHLIGHT_CAPS.chipTime);
    if (customBibNumber.trim()) item.bibNumber = customBibNumber.trim().slice(0, HIGHLIGHT_CAPS.bibNumber);

    onUpdateDraft((prev) => ({
      ...prev,
      participatedEvents: [...(prev.participatedEvents || []).slice(0, 7), item],
    }));
    setCustomRaceName('');
    setCustomChipTime('');
    setCustomBibNumber('');
    setShowAddEvent(false);
  };

  const placementSelectOptions = HIGHLIGHT_PLACEMENTS.map((pl) => ({
    value: pl,
    label: pl,
  }));

  return (
    <div className="space-y-4">
      {/* Section A: Card Achievements & Honors */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-mono font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
              <span>Achievements on Card ({achievements.length}/8)</span>
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Displayed on the card ribbon and Finisher Dossier honors ledger.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canManage}
            onClick={handleAutoDeriveAchievements}
            className="min-h-11 px-3 text-xs font-mono"
          >
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            <span>Auto-Derive</span>
          </Button>
        </div>

        {/* Preset Honors */}
        <div className="flex flex-wrap gap-1.5">
          {HIGHLIGHT_ACHIEVEMENT_PRESETS.map((preset) => {
            const active = achievements.some((a) => a.toLowerCase() === preset.toLowerCase());
            return (
              <button
                key={preset}
                type="button"
                disabled={!canManage}
                onClick={() => handleTogglePresetAchievement(preset)}
                aria-pressed={active}
                className={`min-h-11 px-2.5 py-1 rounded-lg border text-xs font-mono transition inline-flex items-center gap-1 ${
                  active
                    ? 'bg-red-700 text-white border-red-800 shadow-xs'
                    : 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                }`}
              >
                {active && <Check className="w-3 h-3" aria-hidden="true" />}
                <span>{preset}</span>
              </button>
            );
          })}
        </div>

        {/* Active Achievement Chips */}
        {achievements.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--border-default)]">
            {achievements.map((ach, idx) => (
              <span
                key={`${ach}-${idx}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/12 text-xs font-mono font-semibold text-amber-800 dark:text-amber-300"
              >
                <span>{ach}</span>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Remove achievement ${ach}`}
                    onClick={() => handleTogglePresetAchievement(ach)}
                    className="hover:text-red-500 transition"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Custom Achievement Adder */}
        <div className="flex items-center gap-2">
          <Input
            value={newAchievement}
            disabled={!canManage || achievements.length >= 8}
            maxLength={28}
            placeholder="Add custom achievement (e.g. SUB-45 10K)"
            aria-label="Custom achievement label"
            onChange={(e) => setNewAchievement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomAchievement();
              }
            }}
            className="h-10 text-xs font-mono flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!canManage || !newAchievement.trim() || achievements.length >= 8}
            onClick={handleAddCustomAchievement}
            className="h-10 px-3 text-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add</span>
          </Button>
        </div>
      </div>

      {/* Section B: All Participated Events & Placements */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-mono font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span>All Participated Events & Placements ({participatedEvents.length}/8)</span>
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Shown together inside this card and expandable in the Finisher Dossier.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {activeRunner && activeRunner.entries.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canManage}
                onClick={handleSyncAllRunnerEvents}
                className="min-h-11 px-3 text-xs font-mono"
              >
                Sync {activeRunner.entries.length} Race{activeRunner.entries.length === 1 ? '' : 's'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage || participatedEvents.length >= 8}
              onClick={() => setShowAddEvent((prev) => !prev)}
              className="min-h-11 px-3 text-xs font-mono"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span>{showAddEvent ? 'Cancel' : 'Add Event'}</span>
            </Button>
          </div>
        </div>

        {showAddEvent && (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={customRaceName}
                maxLength={56}
                placeholder="Race event name"
                aria-label="Participated event race name"
                onChange={(e) => setCustomRaceName(e.target.value)}
                className="h-10 text-xs"
              />
              <Input
                type="date"
                value={customRaceDate}
                aria-label="Participated event date"
                onChange={(e) => setCustomRaceDate(e.target.value)}
                className="h-10 font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input
                value={customDistance}
                maxLength={18}
                placeholder="21K"
                aria-label="Participated event distance"
                onChange={(e) => setCustomDistance(e.target.value)}
                className="h-10 font-mono text-xs"
              />
              <Input
                value={customChipTime}
                maxLength={18}
                placeholder="01:45:20"
                aria-label="Participated event finish time"
                onChange={(e) => setCustomChipTime(e.target.value)}
                className="h-10 font-mono text-xs"
              />
              <Input
                value={customBibNumber}
                maxLength={16}
                placeholder="Bib #"
                aria-label="Participated event bib number"
                onChange={(e) => setCustomBibNumber(e.target.value)}
                className="h-10 font-mono text-xs"
              />
              <HighlightCustomSelect
                compact
                ariaLabel="Participated event placement"
                value={customPlacement}
                options={placementSelectOptions}
                onChange={setCustomPlacement}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={!customRaceName.trim()}
                onClick={handleAddCustomEvent}
                className="h-9 px-3 text-xs"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Event to Card</span>
              </Button>
            </div>
          </div>
        )}

        {participatedEvents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
            {activeRunner
              ? `Click "Sync ${activeRunner.entries.length} Races" to attach all participated events and placements for ${activeRunner.fullName}.`
              : 'Pick a runner from the race directory above or click "Add Event" to attach multi-event placements to one card.'}
          </div>
        ) : (
          <div className="space-y-2">
            {participatedEvents.map((ev, idx) => {
              const isPrimary =
                ev.raceName.trim().toLowerCase() === draft.raceName.trim().toLowerCase() &&
                ev.distance.trim().toLowerCase() === draft.distance.trim().toLowerCase();
              const isCustomPlacement = !HIGHLIGHT_PLACEMENTS.includes(ev.placement as any);
              const options = isCustomPlacement
                ? [{ value: ev.placement, label: ev.placement }, ...placementSelectOptions]
                : placementSelectOptions;

              return (
                <div
                  key={`${ev.raceId || ev.raceName}-${idx}`}
                  className={`rounded-xl border p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    isPrimary
                      ? 'border-red-600/55 bg-red-600/8'
                      : 'border-[var(--border-default)] bg-[var(--surface-card)]'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {isPrimary && (
                        <span className="px-1.5 py-0.5 rounded bg-red-700 text-white text-xs font-mono font-semibold shrink-0">
                          PRIMARY
                        </span>
                      )}
                      <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {ev.raceName}
                      </p>
                    </div>
                    <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                      {ev.distance}
                      {ev.raceDate ? ` · ${formatReadableDate(ev.raceDate)}` : ''}
                      {ev.chipTime ? ` · ${ev.chipTime}` : ''}
                      {ev.bibNumber ? ` · #${ev.bibNumber}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-32">
                      <HighlightCustomSelect
                        compact
                        ariaLabel={`Placement for ${ev.raceName}`}
                        disabled={!canManage}
                        value={ev.placement}
                        options={options}
                        onChange={(val) => handleUpdateEventPlacement(idx, val)}
                      />
                    </div>
                    {!isPrimary && (
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => handleSetPrimaryFromEvent(ev)}
                        title="Set as primary card spotlight race"
                        aria-label={`Set ${ev.raceName} as primary race`}
                        className="min-h-11 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-mono text-[var(--text-primary)] inline-flex items-center gap-1"
                      >
                        <Star className="w-3 h-3 text-amber-500" aria-hidden="true" />
                        <span className="hidden md:inline">Spotlight</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => handleRemoveParticipatedEvent(idx)}
                      aria-label={`Remove ${ev.raceName} from card`}
                      className="h-10 w-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:text-red-600 inline-flex items-center justify-center text-[var(--text-secondary)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
