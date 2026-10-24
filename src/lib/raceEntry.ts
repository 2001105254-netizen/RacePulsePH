import { Race, RaceEntryCategory, RunnerProfile } from '../types';

export const entryCategoryLabels: Record<RaceEntryCategory, string> = {
  solo: 'Solo',
  duo: 'Duo',
  trio: 'Trio',
  group: 'Group',
};

export const entryMemberCount: Record<RaceEntryCategory, number> = {
  solo: 1,
  duo: 2,
  trio: 3,
  // A Group entry is a four-person shared-bib team. It stays separate from
  // Trio in bib allocation and rankings so teams are compared fairly.
  group: 4,
};

export function raceEntryCategories(race: Pick<Race, 'entryCategories'>): RaceEntryCategory[] {
  const configured = race.entryCategories?.filter((category): category is RaceEntryCategory => category === 'solo' || category === 'duo' || category === 'trio' || category === 'group') || [];
  return configured.length > 0 ? configured : ['solo'];
}

export function runnerEntryCategory(runner?: Pick<RunnerProfile, 'entryCategory'>): RaceEntryCategory {
  return runner?.entryCategory || 'solo';
}

export function runnerDivisionLabel(runner?: Pick<RunnerProfile, 'distance' | 'entryCategory' | 'isFreeSlot'>): string {
  if (!runner) return 'Unknown';
  if (runner.isFreeSlot) return `${runner.distance} ${entryCategoryLabels[runnerEntryCategory(runner)]} Free Slots`;
  return `${runner.distance} ${entryCategoryLabels[runnerEntryCategory(runner)]}`;
}

// A Free Slot is a placeholder in an existing Solo/Duo/Trio/Group wave, not
// its own race wave.  Keep this separate from runnerDivisionLabel because the
// latter deliberately distinguishes Free Slots in rosters and results.
export function runnerWaveLabel(runner?: Pick<RunnerProfile, 'distance' | 'entryCategory'>): string {
  if (!runner) return 'Unknown';
  return `${runner.distance} ${entryCategoryLabels[runnerEntryCategory(runner)]}`;
}
