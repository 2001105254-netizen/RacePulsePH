import { Race, RaceEntryCategory, RunnerProfile } from '../types';

export const entryCategoryLabels: Record<RaceEntryCategory, string> = {
  solo: 'Solo',
  duo: 'Duo',
  trio: 'Trio',
};

export const entryMemberCount: Record<RaceEntryCategory, number> = {
  solo: 1,
  duo: 2,
  trio: 3,
};

export function raceEntryCategories(race: Pick<Race, 'entryCategories'>): RaceEntryCategory[] {
  const configured = race.entryCategories?.filter((category): category is RaceEntryCategory => category === 'solo' || category === 'duo' || category === 'trio') || [];
  return configured.length > 0 ? configured : ['solo'];
}

export function runnerEntryCategory(runner?: Pick<RunnerProfile, 'entryCategory'>): RaceEntryCategory {
  return runner?.entryCategory || 'solo';
}

export function runnerDivisionLabel(runner?: Pick<RunnerProfile, 'distance' | 'entryCategory'>): string {
  if (!runner) return 'Unknown';
  return `${runner.distance} ${entryCategoryLabels[runnerEntryCategory(runner)]}`;
}
