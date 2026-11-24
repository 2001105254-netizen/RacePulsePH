import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as runnerShell from '../src/lib/runnerShell.ts';
import { getWorkspaceNavBadge, type WorkspaceNavItem } from '../src/components/BottomNav.tsx';
import {
  mergeDismissedOnboardingHints,
  persistDismissedOnboardingHint,
  readDismissedOnboardingHints,
  supportsNativePopover,
} from '../src/components/runner/RunnerOnboardingHint.tsx';
import type { Race, RunnerProfile } from '../src/types.ts';

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: 'race_1',
    name: 'Bukidnon Trail Run',
    date: '2026-12-01',
    checkpoints: [],
    ageCategories: [],
    distances: [{ id: 'd1', label: '10K', km: 10, price: 900 }],
    inclusions: [],
    createdBy: 'org_1',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRunnerProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    uid: 'runner_1',
    raceId: 'race_1',
    fullName: 'Juan Dela Cruz',
    bibNumber: '1001',
    distance: '10K',
    gender: 'male',
    age: 28,
    createdAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeCan(allowed: readonly string[] | Record<string, boolean>) {
  if (Array.isArray(allowed)) {
    const set = new Set(allowed);
    return (action: string) => set.has(action);
  }
  const map = allowed as Record<string, boolean>;
  return (action: string) => Boolean(map[action]);
}

const ALL_PERSONAL_ACTIONS = [
  'personal.register',
  'personal.checkout',
  'personal.results',
  'personal.bibs',
  'personal.certificates',
  'personal.engraving',
  'personal.friends',
  'personal.invites',
  'personal.record',
  'personal.social',
  'personal.clubs',
  'personal.inbox',
] as const;

test('RUNNER_TAB_ORDER matches the 5-tab runner shell contract', () => {
  assert.deepEqual(runnerShell.RUNNER_TAB_ORDER, ['home', 'explore', 'record', 'inbox', 'you']);
});

test('resolveAllowedRunnerTabs enables all 5 tabs in canonical order for full personal access', () => {
  const can = makeCan(ALL_PERSONAL_ACTIONS);
  const tabs = runnerShell.resolveAllowedRunnerTabs(can);
  assert.deepEqual(tabs, ['home', 'explore', 'record', 'inbox', 'you']);
  assert.ok(tabs.length <= 5);
});

test('resolveAllowedRunnerTabs gates each tab cleanly and falls back to you when none match', () => {
  const withoutSocialInbox = runnerShell.resolveAllowedRunnerTabs(
    makeCan(ALL_PERSONAL_ACTIONS.filter((a) => a !== 'personal.social' && a !== 'personal.inbox')),
  );
  assert.deepEqual(withoutSocialInbox, ['explore', 'record', 'you']);

  const clubsOnly = runnerShell.resolveAllowedRunnerTabs(makeCan(['personal.clubs']));
  assert.deepEqual(clubsOnly, ['explore']);

  const recordOnly = runnerShell.resolveAllowedRunnerTabs(makeCan(['personal.record']));
  assert.deepEqual(recordOnly, ['record']);

  const inboxOnly = runnerShell.resolveAllowedRunnerTabs(makeCan(['personal.inbox']));
  assert.deepEqual(inboxOnly, ['inbox']);

  const engravingOnly = runnerShell.resolveAllowedRunnerTabs(makeCan(['personal.engraving']));
  assert.deepEqual(engravingOnly, ['you']);

  const noneAllowed = runnerShell.resolveAllowedRunnerTabs(makeCan([]));
  assert.deepEqual(noneAllowed, ['you']);
});

test('resolveDefaultRunnerTab respects payment return, preference order, and permission overrides', () => {
  const fullCan = makeCan(ALL_PERSONAL_ACTIONS);
  assert.equal(runnerShell.resolveDefaultRunnerTab(fullCan, false), 'home');
  assert.equal(runnerShell.resolveDefaultRunnerTab(fullCan, true), 'explore');

  // Review Focus: personal.social = false and personal.inbox = false lands on explore while keeping you
  const noSocialNoInbox = makeCan(
    ALL_PERSONAL_ACTIONS.filter((a) => a !== 'personal.social' && a !== 'personal.inbox'),
  );
  assert.equal(runnerShell.resolveDefaultRunnerTab(noSocialNoInbox, false), 'explore');
  assert.equal(runnerShell.resolveAllowedRunnerTabs(noSocialNoInbox).includes('you'), true);

  // When register/results/clubs are also false, lands cleanly on you and keeps you
  const noSocialInboxExplore = makeCan(['personal.bibs', 'personal.record']);
  assert.equal(runnerShell.resolveDefaultRunnerTab(noSocialInboxExplore, false), 'you');
  assert.equal(runnerShell.resolveAllowedRunnerTabs(noSocialInboxExplore).includes('you'), true);

  // Payment param ignored if explore is disallowed
  const socialOnly = makeCan(['personal.social']);
  assert.equal(runnerShell.resolveDefaultRunnerTab(socialOnly, true), 'home');

  // Record and inbox fallback order
  assert.equal(runnerShell.resolveDefaultRunnerTab(makeCan(['personal.record', 'personal.inbox']), false), 'record');
  assert.equal(runnerShell.resolveDefaultRunnerTab(makeCan(['personal.inbox']), false), 'inbox');
  assert.equal(runnerShell.resolveDefaultRunnerTab(makeCan([]), true), 'you');
});

test('findUpcomingRaceWeekPass picks smallest 0..7 daysUntil non-completed race via Date.UTC', () => {
  const todayIso = '2026-11-24';
  const races: Race[] = [
    makeRace({ id: 'past', name: 'Yesterday Run', date: '2026-11-23' }),
    makeRace({ id: 'completed', name: 'Finished Early', date: '2026-11-25', completedAt: '2026-11-25T10:00:00Z' }),
    makeRace({ id: 'too_far', name: 'Day 8 Marathon', date: '2026-12-02' }),
    makeRace({ id: 'invalid_date', name: 'Leap Bad Date', date: '2026-02-30' }),
    makeRace({ id: 'day_7', name: 'Next Week 10K', date: '2026-12-01' }),
    makeRace({ id: 'day_3', name: 'Weekend 21K', date: '2026-11-27' }),
    makeRace({ id: 'unregistered', name: 'Tomorrow Open', date: '2026-11-25' }),
  ];

  const profiles: RunnerProfile[] = [
    makeRunnerProfile({ raceId: 'past', bibNumber: '101' }),
    makeRunnerProfile({ raceId: 'completed', bibNumber: '102' }),
    makeRunnerProfile({ raceId: 'too_far', bibNumber: '103' }),
    makeRunnerProfile({ raceId: 'invalid_date', bibNumber: '104' }),
    makeRunnerProfile({ raceId: 'day_7', bibNumber: '105' }),
    makeRunnerProfile({ raceId: 'day_3', bibNumber: '106' }),
  ];

  const match = runnerShell.findUpcomingRaceWeekPass(profiles, races, todayIso);
  assert.ok(match);
  assert.equal(match.race.id, 'day_3');
  assert.equal(match.profile.bibNumber, '106');
  assert.equal(match.daysUntil, 3);
});

test('findUpcomingRaceWeekPass handles same-day (0), boundary (7), year rollover, and invalid inputs', () => {
  const sameDay = runnerShell.findUpcomingRaceWeekPass(
    [makeRunnerProfile({ raceId: 'today_race' })],
    [makeRace({ id: 'today_race', date: '2026-11-24' })],
    '2026-11-24',
  );
  assert.ok(sameDay);
  assert.equal(sameDay.daysUntil, 0);

  const rollover = runnerShell.findUpcomingRaceWeekPass(
    [makeRunnerProfile({ raceId: 'ny_race' })],
    [makeRace({ id: 'ny_race', date: '2027-01-05' })],
    '2026-12-29',
  );
  assert.ok(rollover);
  assert.equal(rollover.daysUntil, 7);

  assert.equal(runnerShell.findUpcomingRaceWeekPass([], [], '2026-11-24'), null);
  assert.equal(
    runnerShell.findUpcomingRaceWeekPass(
      [makeRunnerProfile({ raceId: 'r1' })],
      [makeRace({ id: 'r1', date: '2026-11-25' })],
      'not-a-date',
    ),
    null,
  );
  assert.equal(
    runnerShell.findUpcomingRaceWeekPass(
      [makeRunnerProfile({ raceId: 'r1' })],
      [makeRace({ id: 'r1', date: '2026-11-25' })],
      '2026-02-29',
    ),
    null,
  );
});

test('computeStarterTrailProgress enforces Endowed Progress and merges persisted steps with live signals', () => {
  const baseline = runnerShell.computeStarterTrailProgress(undefined, {
    hasRuns: false,
    hasJoinedRaceOrClub: false,
    hasFriends: false,
  });
  assert.deepEqual(baseline, {
    completed: ['welcome'],
    total: 4,
    percent: 25,
    isComplete: false,
  });

  const deduplicated = runnerShell.computeStarterTrailProgress(
    ['welcome', 'welcome', 'unknown_step', 'first_run'],
    { hasRuns: true, hasJoinedRaceOrClub: true, hasFriends: false },
  );
  assert.deepEqual(deduplicated, {
    completed: ['welcome', 'first_run', 'explore_community'],
    total: 4,
    percent: 75,
    isComplete: false,
  });

  const finished = runnerShell.computeStarterTrailProgress(['connect_friend'], {
    hasRuns: true,
    hasJoinedRaceOrClub: true,
    hasFriends: false,
  });
  assert.deepEqual(finished, {
    completed: ['welcome', 'first_run', 'explore_community', 'connect_friend'],
    total: 4,
    percent: 100,
    isComplete: true,
  });
});

test('validateOptionalBodyMetric accepts blank/valid numbers, rounds to 1 decimal, and rejects invalid/out-of-range', () => {
  assert.deepEqual(runnerShell.validateOptionalBodyMetric('', 25, 250, 'Body weight'), { ok: true, value: null });
  assert.deepEqual(runnerShell.validateOptionalBodyMetric('   ', 80, 250, 'Height'), { ok: true, value: null });

  assert.deepEqual(runnerShell.validateOptionalBodyMetric('25', 25, 250, 'Body weight'), { ok: true, value: 25 });
  assert.deepEqual(runnerShell.validateOptionalBodyMetric('250', 25, 250, 'Body weight'), { ok: true, value: 250 });
  assert.deepEqual(runnerShell.validateOptionalBodyMetric(' 68.54 ', 25, 250, 'Body weight'), { ok: true, value: 68.5 });
  assert.deepEqual(runnerShell.validateOptionalBodyMetric('68.56', 25, 250, 'Body weight'), { ok: true, value: 68.6 });
  assert.deepEqual(runnerShell.validateOptionalBodyMetric('172.5', 80, 250, 'Height'), { ok: true, value: 172.5 });

  for (const badRange of ['24.9', '250.1', '-65', '0']) {
    const res = runnerShell.validateOptionalBodyMetric(badRange, 25, 250, 'Body weight');
    assert.equal(res.ok, false, `Expected ${badRange} to fail range check`);
    if (!res.ok) {
      assert.match(res.error, /Body weight/);
      assert.doesNotMatch(res.error, /—/);
    }
  }

  for (const badFormat of ['abc', '65kg', 'NaN', 'Infinity', '-Infinity', '1e2', '0x41', '65..2', '.']) {
    const res = runnerShell.validateOptionalBodyMetric(badFormat, 25, 250, 'Body weight');
    assert.equal(res.ok, false, `Expected ${badFormat} to fail numeric format check`);
    if (!res.ok) {
      assert.match(res.error, /Body weight/);
      assert.doesNotMatch(res.error, /—/);
    }
  }
});

test('shouldShowOnboardingHint hides when key is empty, suppressed, or dismissed', () => {
  const dismissed = new Set(['hint_a']);
  assert.equal(runnerShell.shouldShowOnboardingHint('hint_b', false, dismissed), true);
  assert.equal(runnerShell.shouldShowOnboardingHint('hint_a', false, dismissed), false);
  assert.equal(runnerShell.shouldShowOnboardingHint('hint_b', true, dismissed), false);
  assert.equal(runnerShell.shouldShowOnboardingHint('', false, dismissed), false);
  assert.equal(runnerShell.shouldShowOnboardingHint('   ', false, dismissed), false);
});

test('formatNavBadgeCount formats positive counts up to 99+ and omits invalid/non-positive values', () => {
  assert.equal(runnerShell.formatNavBadgeCount(undefined), null);
  assert.equal(runnerShell.formatNavBadgeCount(0), null);
  assert.equal(runnerShell.formatNavBadgeCount(-4), null);
  assert.equal(runnerShell.formatNavBadgeCount(0.5), null);
  assert.equal(runnerShell.formatNavBadgeCount(Number.NaN), null);
  assert.equal(runnerShell.formatNavBadgeCount(Number.POSITIVE_INFINITY), null);
  assert.equal(runnerShell.formatNavBadgeCount(1), '1');
  assert.equal(runnerShell.formatNavBadgeCount(9.8), '9');
  assert.equal(runnerShell.formatNavBadgeCount(99), '99');
  assert.equal(runnerShell.formatNavBadgeCount(100), '99+');
  assert.equal(runnerShell.formatNavBadgeCount(250), '99+');
});

test('mapExploreRacesMode maps ExploreRacesFilter to events or catalog modes', () => {
  assert.deepEqual(runnerShell.mapExploreRacesMode('open'), { mode: 'events', eventsFilter: 'all' });
  assert.deepEqual(runnerShell.mapExploreRacesMode('joined'), { mode: 'events', eventsFilter: 'registered' });
  assert.deepEqual(runnerShell.mapExploreRacesMode('upcoming'), { mode: 'catalog', catalogFilter: 'upcoming' });
  assert.deepEqual(runnerShell.mapExploreRacesMode('completed'), { mode: 'catalog', catalogFilter: 'completed' });
  assert.deepEqual(runnerShell.mapExploreRacesMode('all'), { mode: 'catalog', catalogFilter: 'all' });
});

test('resolveBackNavigationTarget steps out of sub-sections before returning to homeTab and null at root', () => {
  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'explore',
      homeTab: 'home',
      exploreSection: 'clubs',
      youSection: 'overview',
    }),
    { tab: 'explore', exploreSection: 'races' },
  );

  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'explore',
      homeTab: 'home',
      exploreSection: 'races',
      youSection: 'overview',
    }),
    { tab: 'home' },
  );

  assert.equal(
    runnerShell.resolveBackNavigationTarget({
      tab: 'explore',
      homeTab: 'explore',
      exploreSection: 'races',
      youSection: 'overview',
    }),
    null,
  );

  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'you',
      homeTab: 'home',
      exploreSection: 'races',
      youSection: 'passes',
    }),
    { tab: 'you', youSection: 'overview' },
  );

  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'you',
      homeTab: 'home',
      exploreSection: 'races',
      youSection: 'overview',
    }),
    { tab: 'home' },
  );

  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'record',
      homeTab: 'home',
      exploreSection: 'routes',
      youSection: 'friends',
    }),
    { tab: 'home' },
  );

  assert.equal(
    runnerShell.resolveBackNavigationTarget({
      tab: 'home',
      homeTab: 'home',
      exploreSection: 'clubs',
      youSection: 'passes',
    }),
    null,
  );
});

test('getWorkspaceNavBadge formats badge counts and appends unread context to ariaLabel', () => {
  const recordItem: WorkspaceNavItem = {
    key: 'record',
    icon: null,
    label: 'Record Run',
    shortLabel: 'Record',
    active: false,
    onClick: () => {},
    emphasis: 'primary-record',
  };
  assert.deepEqual(getWorkspaceNavBadge(recordItem), {
    badgeText: null,
    ariaLabel: 'Record Run',
  });

  assert.deepEqual(getWorkspaceNavBadge({ label: 'Inbox', badgeCount: 0 }), {
    badgeText: null,
    ariaLabel: 'Inbox',
  });
  assert.deepEqual(getWorkspaceNavBadge({ label: 'Inbox', badgeCount: 4 }), {
    badgeText: '4',
    ariaLabel: 'Inbox, 4 unread',
  });
  assert.deepEqual(getWorkspaceNavBadge({ label: 'Inbox', badgeCount: 120 }), {
    badgeText: '99+',
    ariaLabel: 'Inbox, 99+ unread',
  });
});

test('RunnerOnboardingHint persistence helpers safely read, persist, and integrate with shouldShowOnboardingHint', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  assert.equal(supportsNativePopover(), false);

  const key = 'rp_hint_record_v1';
  const initialDismissed = readDismissedOnboardingHints(key, mockStorage);
  assert.equal(initialDismissed.size, 0);
  assert.equal(runnerShell.shouldShowOnboardingHint(key, false, initialDismissed), true);
  assert.equal(runnerShell.shouldShowOnboardingHint(key, true, initialDismissed), false);
  assert.equal(store.has(key), false);

  assert.equal(persistDismissedOnboardingHint(key, mockStorage), true);
  assert.equal(store.get(key), 'dismissed');

  const afterDismiss = readDismissedOnboardingHints(key, mockStorage);
  assert.equal(afterDismiss.has(key), true);
  assert.equal(runnerShell.shouldShowOnboardingHint(key, false, afterDismiss), false);

  const brokenStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(readDismissedOnboardingHints(key, brokenStorage).size, 0);
  assert.equal(persistDismissedOnboardingHint(key, brokenStorage), false);
  assert.equal(readDismissedOnboardingHints('   ', mockStorage).size, 0);
  assert.equal(persistDismissedOnboardingHint('   ', mockStorage), false);

  // Switching storageKey preserves prior in-session dismissals when storage is blocked or misses
  store.set('rp_hint_explore_v1', 'dismissed');
  const inSession = new Set(['rp_hint_session_only']);
  const mergedWithStorage = mergeDismissedOnboardingHints(inSession, 'rp_hint_explore_v1', mockStorage);
  assert.equal(mergedWithStorage.has('rp_hint_session_only'), true);
  assert.equal(mergedWithStorage.has('rp_hint_explore_v1'), true);

  const mergedWithBroken = mergeDismissedOnboardingHints(mergedWithStorage, 'rp_hint_other', brokenStorage);
  assert.equal(mergedWithBroken.has('rp_hint_session_only'), true);
  assert.equal(mergedWithBroken.has('rp_hint_explore_v1'), true);
  assert.equal(mergedWithBroken.has('rp_hint_other'), false);
});
