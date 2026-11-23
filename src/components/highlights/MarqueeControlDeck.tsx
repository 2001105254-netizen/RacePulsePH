import React, { useMemo } from 'react';
import { Save } from 'lucide-react';
import { formatReadableDate } from '../../lib/highlights';
import { HighlightsMarqueeConfig, Race } from '../../types';
import { Button } from '../ui/button';
import HighlightCustomSelect, { HighlightSelectOption } from './HighlightCustomSelect';

interface MarqueeControlDeckProps {
  config: HighlightsMarqueeConfig;
  races: Race[];
  canSettings: boolean;
  canPlaylist: boolean;
  savingConfig: boolean;
  onChangeConfig: (updater: (prev: HighlightsMarqueeConfig) => HighlightsMarqueeConfig) => void;
  onSaveDeck: () => void;
}

const chipBtn = (active: boolean) =>
  `min-h-11 px-3 py-2 rounded-xl border text-xs font-semibold transition inline-flex items-center justify-center gap-1.5 ${
    active
      ? 'bg-red-700 text-white border-red-800 shadow-sm'
      : 'bg-[var(--surface-card)] text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--surface-hover)]'
  }`;

export default function MarqueeControlDeck({
  config,
  races,
  canSettings,
  canPlaylist,
  savingConfig,
  onChangeConfig,
  onSaveDeck,
}: MarqueeControlDeckProps) {
  const filterOptions = useMemo<HighlightSelectOption[]>(() => [
    { value: '', label: 'All Published Races', sublabel: 'Show highlights across all events' },
    { value: 'latest', label: 'Latest Race Event Only', sublabel: 'Auto-follow newest race date' },
    ...races.map((r) => ({
      value: r.id,
      label: r.name,
      sublabel: formatReadableDate(r.date),
    })),
  ], [races]);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-5" aria-label="Global marquee control deck">
      <div className="lg:col-span-7 glass-panel p-4 sm:p-5 space-y-5">
        <h2 className="font-display text-lg font-semibold text-[var(--text-primary)] border-b border-[var(--border-default)] pb-2.5">
          Velocity, Direction &amp; Geometry Controls
        </h2>

        <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
          <div className="flex items-center justify-between text-sm">
            <label htmlFor="deck-speed" className="font-semibold text-[var(--text-primary)]">
              Cruise Velocity
            </label>
            <span className="font-mono text-sm font-semibold text-red-700 dark:text-red-400">
              {config.speedPxPerSec} px/sec
            </span>
          </div>
          <input
            id="deck-speed"
            type="range"
            min={10}
            max={120}
            step={2}
            disabled={!canSettings}
            value={config.speedPxPerSec}
            onChange={(e) => onChangeConfig((c) => ({ ...c, speedPxPerSec: Number(e.target.value) }))}
            className="w-full accent-red-600 cursor-pointer"
          />
          <div className="flex justify-between text-xs font-mono text-[var(--text-secondary)]">
            <span>10 px/s (Calm gallery)</span>
            <span>60 px/s (Broadcast)</span>
            <span>120 px/s (Sprint)</span>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
            Card Hover Behavior
          </span>
          <div className="grid grid-cols-3 gap-2.5">
            {([
              { id: 'stop', label: 'Full Stop (0%)' },
              { id: 'slow', label: 'Slow-Mo (20%)' },
              { id: 'keep', label: 'Keep Moving' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!canSettings}
                onClick={() => onChangeConfig((c) => ({ ...c, hoverBehavior: opt.id }))}
                className={chipBtn(config.hoverBehavior === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
              Flow Direction
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canSettings}
                onClick={() => onChangeConfig((c) => ({ ...c, direction: 'left' }))}
                className={chipBtn(config.direction === 'left')}
              >
                Left
              </button>
              <button
                type="button"
                disabled={!canSettings}
                onClick={() => onChangeConfig((c) => ({ ...c, direction: 'right' }))}
                className={chipBtn(config.direction === 'right')}
              >
                Right
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
              Global Card Layout
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canSettings}
                onClick={() => onChangeConfig((c) => ({ ...c, layoutMode: 'card' }))}
                className={chipBtn(config.layoutMode === 'card')}
              >
                Card (260x340)
              </button>
              <button
                type="button"
                disabled={!canSettings}
                onClick={() => onChangeConfig((c) => ({ ...c, layoutMode: 'pill' }))}
                className={chipBtn(config.layoutMode === 'pill')}
              >
                Pill (360x140)
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor="deck-gap" className="text-[var(--text-secondary)]">Card Gap</label>
              <span className="font-semibold text-[var(--text-primary)]">{config.cardGapPx}px</span>
            </div>
            <input
              id="deck-gap"
              type="range"
              min={12}
              max={32}
              step={4}
              disabled={!canSettings}
              value={config.cardGapPx}
              onChange={(e) => onChangeConfig((c) => ({ ...c, cardGapPx: Number(e.target.value) }))}
              className="w-full accent-red-600 cursor-pointer"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor="deck-fade" className="text-[var(--text-secondary)]">Edge Fade Mask</label>
              <span className="font-semibold text-[var(--text-primary)]">{config.edgeFadePx}px</span>
            </div>
            <input
              id="deck-fade"
              type="range"
              min={0}
              max={120}
              step={8}
              disabled={!canSettings}
              value={config.edgeFadePx}
              onChange={(e) => onChangeConfig((c) => ({ ...c, edgeFadePx: Number(e.target.value) }))}
              className="w-full accent-red-600 cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 glass-panel p-4 sm:p-5 flex flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="border-b border-[var(--border-default)] pb-2.5">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Smart Playlist Rules
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {canPlaylist
                ? 'Control podium prioritization, event filtering, and expiration rules.'
                : 'Managed by Super Admin or accounts granted Smart Playlist Rules permission.'}
            </p>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 cursor-pointer">
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--text-primary)]">
                Pin top podium finishers first
              </span>
              <span className="block text-xs text-[var(--text-secondary)]">
                Always place Record Holders, 1st, 2nd, and 3rd ahead of general highlights.
              </span>
            </div>
            <input
              type="checkbox"
              disabled={!canPlaylist}
              checked={config.pinPodiumFirst}
              onChange={(e) => onChangeConfig((c) => ({ ...c, pinPodiumFirst: e.target.checked }))}
              className="w-5 h-5 accent-red-600 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 cursor-pointer">
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--text-primary)]">
                Auto-hide expired highlights
              </span>
              <span className="block text-xs text-[var(--text-secondary)]">
                Automatically pull highlights once their scheduled expiration date passes.
              </span>
            </div>
            <input
              type="checkbox"
              disabled={!canPlaylist}
              checked={config.hideExpired}
              onChange={(e) => onChangeConfig((c) => ({ ...c, hideExpired: e.target.checked }))}
              className="w-5 h-5 accent-red-600 shrink-0"
            />
          </label>

          <div className="space-y-1.5">
            <label htmlFor="playlist-race-filter" className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
              Filter Public Reel by Event
            </label>
            <HighlightCustomSelect
              id="playlist-race-filter"
              searchable
              disabled={!canPlaylist}
              value={config.filterRaceId}
              options={filterOptions}
              onChange={(val) => onChangeConfig((c) => ({ ...c, filterRaceId: val }))}
            />
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--border-default)] flex justify-end">
          <Button
            type="button"
            disabled={!canSettings || savingConfig}
            onClick={onSaveDeck}
            className="h-11 px-5 text-xs w-full sm:w-auto"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>{savingConfig ? 'Saving settings...' : 'Save Marquee Controls'}</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
