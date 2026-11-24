import type { Race, RunnerProfile } from '../types';

export type RunnerTab = 'home' | 'explore' | 'record' | 'inbox' | 'you';
export type ExploreSection = 'races' | 'routes' | 'clubs';
export type ExploreRacesFilter = 'open' | 'upcoming' | 'completed' | 'all' | 'joined';
export type YouSection = 'overview' | 'passes' | 'friends' | 'engraving';
export type OnboardingStepId = 'welcome' | 'first_run' | 'explore_community' | 'connect_friend';

export const RUNNER_TAB_ORDER: readonly RunnerTab[] = ['home', 'explore', 'record', 'inbox', 'you'];

const MS_PER_DAY = 86_400_000;
const STRICT_NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

function parseUtcCalendarDateMs(raw: string, allowIsoTimeSuffix = false): number | null {
  const trimmed = raw.trim();
  const pattern = allowIsoTimeSuffix ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/ : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = pattern.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return utcMs;
}

export function resolveAllowedRunnerTabs(can: (action: string) => boolean): RunnerTab[] {
  const checks: Record<RunnerTab, () => boolean> = {
    home: () => can('personal.social'),
    explore: () => can('personal.register') || can('personal.results') || can('personal.clubs'),
    record: () => can('personal.record'),
    inbox: () => can('personal.inbox'),
    you: () =>
      can('personal.results') ||
      can('personal.bibs') ||
      can('personal.certificates') ||
      can('personal.register') ||
      can('personal.friends') ||
      can('personal.engraving'),
  };

  const allowed = RUNNER_TAB_ORDER.filter((tab) => checks[tab]());
  return allowed.length > 0 ? allowed : ['you'];
}

export function resolveDefaultRunnerTab(
  can: (action: string) => boolean,
  hasPaymentParam: boolean,
): RunnerTab {
  const allowed = resolveAllowedRunnerTabs(can);
  if (hasPaymentParam && allowed.includes('explore')) {
    return 'explore';
  }

  const priorityOrder: readonly RunnerTab[] = ['home', 'explore', 'you', 'record', 'inbox'];
  for (const tab of priorityOrder) {
    if (allowed.includes(tab)) {
      return tab;
    }
  }
  return 'you';
}

export function findUpcomingRaceWeekPass(
  runnerProfiles: RunnerProfile[],
  races: Race[],
  todayIso: string,
): { race: Race; profile: RunnerProfile; daysUntil: number } | null {
  const todayMs = parseUtcCalendarDateMs(todayIso, true);
  if (todayMs === null) return null;

  const raceById = new Map<string, Race>();
  for (const race of races) {
    raceById.set(race.id, race);
  }

  let best: { race: Race; profile: RunnerProfile; daysUntil: number } | null = null;
  for (const profile of runnerProfiles) {
    const race = raceById.get(profile.raceId);
    if (!race || race.completedAt) continue;

    const raceMs = parseUtcCalendarDateMs(race.date);
    if (raceMs === null) continue;

    const daysUntil = (raceMs - todayMs) / MS_PER_DAY;
    if (daysUntil < 0 || daysUntil > 7) continue;

    if (!best || daysUntil < best.daysUntil) {
      best = { race, profile, daysUntil };
    }
  }

  return best;
}

export function computeStarterTrailProgress(
  completedSteps: readonly string[] | undefined,
  signals: { hasRuns: boolean; hasJoinedRaceOrClub: boolean; hasFriends: boolean },
): { completed: OnboardingStepId[]; total: 4; percent: number; isComplete: boolean } {
  const persisted = new Set(completedSteps ?? []);
  const completed: OnboardingStepId[] = ['welcome'];

  if (persisted.has('first_run') || signals.hasRuns) {
    completed.push('first_run');
  }
  if (persisted.has('explore_community') || signals.hasJoinedRaceOrClub) {
    completed.push('explore_community');
  }
  if (persisted.has('connect_friend') || signals.hasFriends) {
    completed.push('connect_friend');
  }

  const total = 4 as const;
  return {
    completed,
    total,
    percent: Math.round((completed.length / total) * 100),
    isComplete: completed.length === total,
  };
}

export function validateOptionalBodyMetric(
  raw: string,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (!STRICT_NUMBER_PATTERN.test(trimmed)) {
    return { ok: false, error: `${label} must be a valid number.` };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${label} must be a valid number.` };
  }
  if (parsed < min || parsed > max) {
    return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  }

  const rounded = Math.round(parsed * 10) / 10;
  if (rounded < min || rounded > max) {
    return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: Object.is(rounded, -0) ? 0 : rounded };
}

export function shouldShowOnboardingHint(
  storageKey: string,
  suppressed: boolean,
  dismissedKeys: ReadonlySet<string>,
): boolean {
  if (!storageKey || !storageKey.trim() || suppressed || dismissedKeys.has(storageKey)) {
    return false;
  }
  return true;
}

export function formatNavBadgeCount(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  const whole = Math.floor(count);
  if (whole <= 0) {
    return null;
  }
  return whole >= 100 ? '99+' : String(whole);
}

export function mapExploreRacesMode(
  filter: ExploreRacesFilter,
): { mode: 'events'; eventsFilter: 'all' | 'registered' } | { mode: 'catalog'; catalogFilter: 'all' | 'upcoming' | 'completed' } {
  switch (filter) {
    case 'open':
      return { mode: 'events', eventsFilter: 'all' };
    case 'joined':
      return { mode: 'events', eventsFilter: 'registered' };
    case 'upcoming':
    case 'completed':
    case 'all':
      return { mode: 'catalog', catalogFilter: filter };
  }
}

export function resolveBackNavigationTarget(state: {
  tab: RunnerTab;
  homeTab: RunnerTab;
  exploreSection: ExploreSection;
  youSection: YouSection;
}): { tab: RunnerTab; exploreSection?: ExploreSection; youSection?: YouSection } | null {
  if (state.tab === 'explore' && state.exploreSection !== 'races') {
    return { tab: 'explore', exploreSection: 'races' };
  }
  if (state.tab === 'you' && state.youSection !== 'overview') {
    return { tab: 'you', youSection: 'overview' };
  }
  if (state.tab !== state.homeTab) {
    return { tab: state.homeTab };
  }
  return null;
}
