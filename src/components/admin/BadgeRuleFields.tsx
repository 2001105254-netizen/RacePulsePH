import { useId, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  BADGE_RULE_META,
  BADGE_RULE_TYPES,
  formatBadgeRuleSummary,
} from '../../lib/badges/presets';
import {
  buildBadgeRuleFromDraft,
  PHILIPPINE_BADGE_REGIONS,
  type BadgeFormDraft,
} from '../../lib/badges/studioDraft';
import type { BadgeRuleType } from '../../lib/badges/types';
import type { Race } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, type SelectOption } from '../ui/Select';

export interface BadgeRuleFieldsProps {
  draft: BadgeFormDraft;
  races: Race[];
  disabled: boolean;
  onPatchDraft: (patch: Partial<BadgeFormDraft>) => void;
}

export function BadgeRuleFields({
  draft,
  races,
  disabled,
  onPatchDraft,
}: BadgeRuleFieldsProps) {
  const baseId = useId();
  const [customRegionInput, setCustomRegionInput] = useState('');

  const ruleOptions: SelectOption[] = useMemo(
    () =>
      BADGE_RULE_TYPES.map((ruleId) => {
        const meta = BADGE_RULE_META[ruleId];
        return {
          value: ruleId,
          label: meta.label,
          sublabel: meta.description,
          badge: meta.unit || (meta.usesThreshold ? 'count' : 'auto'),
        };
      }),
    [],
  );

  const raceOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'Any official event', sublabel: 'Count across all RacePulsePH events' },
      ...races
        .slice()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .map((race) => ({
          value: race.id,
          label: race.name,
          sublabel: `${race.date || 'Scheduled'} (${race.id})`,
        })),
    ],
    [races],
  );

  const ruleMeta = BADGE_RULE_META[draft.ruleType] ?? BADGE_RULE_META.manual_grant;
  const rulePreview = buildBadgeRuleFromDraft(draft);
  const isRaceRule = draft.ruleType === 'race_joined' || draft.ruleType === 'race_finished';
  const isDecimalRule =
    draft.ruleType === 'run_single_distance_km' ||
    draft.ruleType === 'run_total_distance_km';
  const isTimeWindow = draft.ruleType === 'run_time_window';
  const isRegionsRule = draft.ruleType === 'regions_explored';
  const showsSingleThreshold =
    ruleMeta.usesThreshold &&
    !isTimeWindow &&
    !isRegionsRule &&
    !(isRaceRule && draft.raceId.trim().length > 0);

  const clampRegionThreshold = (regionCount: number, currentThreshold: string): string => {
    if (regionCount <= 0) return currentThreshold;
    const parsedThresh = Number.parseInt(currentThreshold, 10);
    if (!Number.isFinite(parsedThresh) || parsedThresh < 1 || parsedThresh > regionCount) {
      return String(regionCount);
    }
    return currentThreshold;
  };

  const toggleRegion = (regionName: string) => {
    const exists = draft.targetRegions.some(
      (r) => r.toLowerCase() === regionName.toLowerCase(),
    );
    const nextRegions = exists
      ? draft.targetRegions.filter((r) => r.toLowerCase() !== regionName.toLowerCase())
      : [...draft.targetRegions, regionName].slice(0, 20);

    onPatchDraft({
      targetRegions: nextRegions,
      threshold: clampRegionThreshold(nextRegions.length, draft.threshold),
    });
  };

  const addCustomRegion = () => {
    const trimmed = customRegionInput.trim().slice(0, 64);
    if (!trimmed || draft.targetRegions.length >= 20) return;
    const duplicate = draft.targetRegions.some(
      (r) => r.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setCustomRegionInput('');
      return;
    }
    const nextRegions = [...draft.targetRegions, trimmed];
    setCustomRegionInput('');
    onPatchDraft({
      targetRegions: nextRegions,
      threshold: clampRegionThreshold(nextRegions.length, draft.threshold),
    });
  };

  return (
    <fieldset className="space-y-4 border-0 p-0 m-0">
      <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
        Unlock Rule Configuration
      </legend>

      <div className="space-y-1.5">
        <label
          htmlFor={`${baseId}-rule-type`}
          className="block text-xs font-semibold text-[var(--text-primary)]"
        >
          Rule Type
        </label>
        <Select
          id={`${baseId}-rule-type`}
          value={draft.ruleType}
          options={ruleOptions}
          disabled={disabled}
          searchable
          searchPlaceholder="Search all 17 rule types..."
          onChange={(nextType) => {
            const type = nextType as BadgeRuleType;
            const patch: Partial<BadgeFormDraft> = { ruleType: type };
            if (type === 'welcome' || type === 'profile_complete' || type === 'manual_grant') {
              patch.threshold = '1';
              patch.raceId = '';
            } else if (type === 'regions_explored' && draft.targetRegions.length > 0) {
              const curr = Number.parseInt(draft.threshold, 10);
              if (!Number.isFinite(curr) || curr < 1 || curr > draft.targetRegions.length) {
                patch.threshold = String(draft.targetRegions.length);
              }
            } else if (!draft.threshold.trim() || Number(draft.threshold) <= 0) {
              patch.threshold = '1';
            }
            onPatchDraft(patch);
          }}
        />
        <p className="text-xs text-[var(--text-secondary)]">
          {ruleMeta.description}
        </p>
      </div>

      {isRaceRule && (
        <div className="space-y-1.5">
          <label
            htmlFor={`${baseId}-rule-race`}
            className="block text-xs font-semibold text-[var(--text-primary)]"
          >
            Specific Event (Optional)
          </label>
          <Select
            id={`${baseId}-rule-race`}
            value={draft.raceId}
            options={raceOptions}
            disabled={disabled}
            searchable
            searchPlaceholder="Search events..."
            onChange={(raceId) =>
              onPatchDraft({
                raceId,
                ...(raceId ? { threshold: '1' } : {}),
              })
            }
          />
        </div>
      )}

      {showsSingleThreshold && (
        <div className="space-y-1.5">
          <label
            htmlFor={`${baseId}-rule-threshold`}
            className="block text-xs font-semibold text-[var(--text-primary)]"
          >
            {ruleMeta.thresholdLabel || 'Threshold'}
            {ruleMeta.unit ? ` (${ruleMeta.unit})` : ''}
          </label>
          <Input
            id={`${baseId}-rule-threshold`}
            type="number"
            min={isDecimalRule ? 0.1 : 1}
            step={isDecimalRule ? '0.1' : '1'}
            disabled={disabled}
            value={draft.threshold}
            onChange={(e) => onPatchDraft({ threshold: e.target.value })}
          />
        </div>
      )}

      {isTimeWindow && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-window-threshold`}
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              Qualifying Runs
            </label>
            <Input
              id={`${baseId}-window-threshold`}
              type="number"
              min={1}
              max={1000}
              step={1}
              disabled={disabled}
              value={draft.threshold}
              onChange={(e) => onPatchDraft({ threshold: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-start-hour`}
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              Start Hour (PHT, 0 to 23)
            </label>
            <Input
              id={`${baseId}-start-hour`}
              type="number"
              min={0}
              max={23}
              step={1}
              disabled={disabled}
              value={draft.startHourPht}
              onChange={(e) => onPatchDraft({ startHourPht: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-end-hour`}
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              End Hour (PHT, 0 to 23)
            </label>
            <Input
              id={`${baseId}-end-hour`}
              type="number"
              min={0}
              max={23}
              step={1}
              disabled={disabled}
              value={draft.endHourPht}
              onChange={(e) => onPatchDraft({ endHourPht: e.target.value })}
            />
          </div>
        </div>
      )}

      {isRegionsRule && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-[var(--text-primary)]">
              Target Philippine Regions (Optional)
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Philippine island regions">
              {PHILIPPINE_BADGE_REGIONS.map((region) => {
                const active = draft.targetRegions.some(
                  (r) => r.toLowerCase() === region.toLowerCase(),
                );
                return (
                  <button
                    key={region}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => toggleRegion(region)}
                    className={`min-h-11 px-4 rounded-xl border text-xs font-semibold transition-colors ${
                      active
                        ? 'border-red-600 bg-red-700 text-white'
                        : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {region}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <label htmlFor={`${baseId}-custom-region`} className="sr-only">
                Add custom region label
              </label>
              <Input
                id={`${baseId}-custom-region`}
                value={customRegionInput}
                maxLength={64}
                disabled={disabled || draft.targetRegions.length >= 20}
                onChange={(e) => setCustomRegionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomRegion();
                  }
                }}
                placeholder="Add custom region (e.g. Cordillera, Cebu)"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || !customRegionInput.trim() || draft.targetRegions.length >= 20}
              onClick={addCustomRegion}
              className="min-h-11 shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Add Region</span>
            </Button>
          </div>

          {draft.targetRegions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {draft.targetRegions.map((region) => (
                <span
                  key={region}
                  className="inline-flex items-center gap-1 pl-3 pr-1 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]"
                >
                  <span>{region}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Remove ${region}`}
                    onClick={() => toggleRegion(region)}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor={`${baseId}-regions-threshold`}
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              Regions Required (1 to {draft.targetRegions.length > 0 ? draft.targetRegions.length : 100})
            </label>
            <Input
              id={`${baseId}-regions-threshold`}
              type="number"
              min={1}
              max={draft.targetRegions.length > 0 ? draft.targetRegions.length : 100}
              step={1}
              disabled={disabled}
              value={draft.threshold}
              onChange={(e) => onPatchDraft({ threshold: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="glass-inset px-3.5 py-2.5 text-xs text-[var(--text-secondary)]">
        <span className="font-semibold text-[var(--text-primary)]">Rule summary: </span>
        <span>
          {rulePreview.ok
            ? formatBadgeRuleSummary(rulePreview.rule)
            : rulePreview.error}
        </span>
      </div>
    </fieldset>
  );
}
