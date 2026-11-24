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
import type { RaceRouteCatalogEntry } from '../src/lib/routes/types.ts';
import type { Race, RunnerProfile } from '../src/types.ts';

function makeRouteCatalogEntry(overrides: Partial<RaceRouteCatalogEntry> = {}): RaceRouteCatalogEntry {
  return {
    id: 'race_baguio_21k',
    raceId: 'race_baguio',
    raceName: 'Baguio Cordillera Ridge Run',
    raceDate: '2026-12-13',
    region: 'Baguio / Cordillera',
    distanceId: '21k',
    distanceLabel: '21K',
    advertisedKm: 21,
    measuredDistanceM: 21150,
    elevationGainM: 420,
    elevationStatus: 'complete',
    landmarkCount: 4,
    checkpointCount: 5,
    currentPublicationId: 'pub_baguio_21k_v1',
    versionNumber: 1,
    status: 'published',
    publishedAt: '2026-11-10T08:00:00.000Z',
    ...overrides,
  };
}

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

  const runsSection: runnerShell.YouSection = 'runs';
  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'you',
      homeTab: 'home',
      exploreSection: 'races',
      youSection: runsSection,
    }),
    { tab: 'you', youSection: 'overview' },
  );

  const badgesSection: runnerShell.YouSection = 'badges';
  assert.deepEqual(
    runnerShell.resolveBackNavigationTarget({
      tab: 'you',
      homeTab: 'home',
      exploreSection: 'races',
      youSection: badgesSection,
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

test('filterPublishedExploreRoutes enforces published-only status, island group fallback, and search query', () => {
  const baguioLuzon = makeRouteCatalogEntry({
    id: 'baguio_21k',
    raceId: 'baguio',
    raceName: 'Baguio Cordillera Ridge Run',
    region: 'Baguio / Cordillera',
    distanceLabel: '21K',
    status: 'published',
  });
  const cebuVisayasProv = makeRouteCatalogEntry({
    id: 'cebu_21k',
    raceId: 'cebu',
    raceName: 'Cebu Highlands Trail',
    region: 'Philippines',
    distanceLabel: '21K',
    status: 'published',
    mapLayerProvenance: {
      islandGroup: 'Visayas',
      province: 'Cebu',
      imagerySource: 'RacePulsePH Satellite Imagery',
      imageryPeriod: '2026-Q3',
      imageryDate: '2026-10-01',
      quarterlyMosaicId: 'RP-PH-2026-Q3',
      terrainRelease: 'RacePulsePH 3D Relief (30 m)',
      terrainEncoding: 'terrarium',
      terrainSpacingM: 30,
      imageryResolutionM: 10,
      cdnTileTemplateImagery: 'https://tiles.example/{z}/{x}/{y}.png',
      cdnTileTemplateDem: 'https://dem.example/{z}/{x}/{y}.png',
      attribution: 'RacePulsePH',
      copernicusTerrainDocUrl: '',
      copernicusImageryDocUrl: '',
      cloudMaskCheck: {
        sceneId: 'sc1',
        sceneCapturedAt: '2026-10-01',
        sceneCloudCoverPct: 4,
        routeCorridorCloudPct: 1,
        patchedFromMosaicQuarter: '2026-Q3',
        patchedSegmentsCount: 0,
        clearCoverageAfterFillPct: 99,
      },
      validation: {
        passed: true,
        checkedAt: '2026-10-02',
        withinPhilippineBounds: true,
        nationalTileCount: 1,
        courseDetailTileCount: 4,
        estimatedImageryBytes: 1024,
        estimatedDemBytes: 1024,
        demNodataVoidsCount: 0,
        cloudFreeCoveragePct: 99,
        issues: [],
      },
      lastWeeklyCheckAt: '2026-11-01',
      nextQuarterlyRefreshAt: '2027-01-01',
    },
  });
  const bukidnonMindanao = makeRouteCatalogEntry({
    id: 'bukidnon_32k',
    raceId: 'bukidnon',
    raceName: 'Bukidnon Kitanglad Ultra',
    region: 'Mindanao · Bukidnon',
    distanceLabel: '32K',
    status: 'published',
  });
  const cdoMindanao = makeRouteCatalogEntry({
    id: 'cdo_10k',
    raceId: 'cdo',
    raceName: 'Cagayan de Oro Riverfront 10K',
    region: 'Cagayan de Oro, Misamis Oriental',
    distanceLabel: '10K',
    status: 'published',
  });
  const apoReefMindoro = makeRouteCatalogEntry({
    id: 'apo_reef_10k',
    raceId: 'apo_reef',
    raceName: 'Apo Reef Coastal Run',
    region: 'Apo Reef, Mindoro',
    distanceLabel: '10K',
    status: 'published',
  });
  const mtApoMindanao = makeRouteCatalogEntry({
    id: 'mt_apo_32k',
    raceId: 'mt_apo',
    raceName: 'Mt. Apo Skyrace',
    region: 'Mt. Apo, Davao',
    distanceLabel: '32K',
    status: 'published',
  });
  const cebuTextOnlyVisayas = makeRouteCatalogEntry({
    id: 'cebu_city_10k',
    raceId: 'cebu_city',
    raceName: 'Cebu City Coastal 10K',
    region: 'Cebu',
    distanceLabel: '10K',
    status: 'published',
  });
  const unknownRegion = makeRouteCatalogEntry({
    id: 'unknown_10k',
    raceId: 'unknown',
    raceName: 'Archipelago Open 10K',
    region: 'Philippines',
    distanceLabel: '10K',
    status: 'published',
  });
  const withdrawnRoute = makeRouteCatalogEntry({
    id: 'withdrawn_5k',
    raceId: 'withdrawn',
    raceName: 'Withdrawn Baguio 5K',
    region: 'Baguio / Cordillera',
    status: 'withdrawn',
  });
  const unpublishedRoute = makeRouteCatalogEntry({
    id: 'draft_10k',
    raceId: 'draft',
    raceName: 'Draft Davao 10K',
    region: 'Davao del Sur',
    status: 'unpublished',
  });
  const supersededRoute = makeRouteCatalogEntry({
    id: 'old_21k',
    raceId: 'old',
    raceName: 'Superseded Iloilo 21K',
    region: 'Iloilo · Panay',
    status: 'superseded',
  });

  const allEntries = [
    baguioLuzon,
    cebuVisayasProv,
    bukidnonMindanao,
    cdoMindanao,
    apoReefMindoro,
    mtApoMindanao,
    cebuTextOnlyVisayas,
    unknownRegion,
    withdrawnRoute,
    unpublishedRoute,
    supersededRoute,
  ];

  // Published-only baseline
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries).map((e) => e.id),
    ['baguio_21k', 'cebu_21k', 'bukidnon_32k', 'cdo_10k', 'apo_reef_10k', 'mt_apo_32k', 'cebu_city_10k', 'unknown_10k'],
  );

  // Island group via mapLayerProvenance.islandGroup + region text fallback
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { islandGroup: 'Luzon' }).map((e) => e.id),
    ['baguio_21k', 'apo_reef_10k'],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { islandGroup: 'Visayas' }).map((e) => e.id),
    ['cebu_21k', 'cebu_city_10k'],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { islandGroup: 'Mindanao' }).map((e) => e.id),
    ['bukidnon_32k', 'cdo_10k', 'mt_apo_32k'],
  );

  // Search query filtering combined with island group, inferred island text, and whitespace/case normalization
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { searchQuery: '  bukidnon 32k ' }).map((e) => e.id),
    ['bukidnon_32k'],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { searchQuery: 'visayas' }).map((e) => e.id),
    ['cebu_21k', 'cebu_city_10k'],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { islandGroup: 'Visayas', searchQuery: 'cebu' }).map((e) => e.id),
    ['cebu_21k', 'cebu_city_10k'],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { islandGroup: 'Luzon', searchQuery: 'cebu' }),
    [],
  );
  assert.deepEqual(
    runnerShell.filterPublishedExploreRoutes(allEntries, { searchQuery: 'withdrawn' }),
    [],
  );
});

test('buildClubRequestMailtoHref builds safe mailto URL with subject, body, and fallback email', () => {
  const defaultHref = runnerShell.buildClubRequestMailtoHref();
  assert.ok(defaultHref.startsWith('mailto:events@racepulseph.com?'));
  assert.doesNotMatch(defaultHref, /\u2014/);
  assert.equal(defaultHref.includes('+'), false);
  const parsedDefault = new URL(defaultHref);
  assert.equal(parsedDefault.searchParams.get('subject'), 'Run Club Request on RacePulsePH');
  assert.match(parsedDefault.searchParams.get('body') || '', /Club Name:/);

  const customHref = runnerShell.buildClubRequestMailtoHref({
    supportEmail: '  clubs@racepulseph.com\r\n ',
    runnerDisplayName: 'Maria Santos',
    runnerUsername: 'mariaruns',
    currentRunClub: 'Bukidnon Ridge Pacers',
  });
  assert.ok(customHref.startsWith('mailto:clubs@racepulseph.com?'));
  assert.doesNotMatch(customHref, /\u2014/);
  const parsedCustom = new URL(customHref);
  assert.equal(
    parsedCustom.searchParams.get('subject'),
    'Run Club Request on RacePulsePH: Bukidnon Ridge Pacers',
  );
  const body = parsedCustom.searchParams.get('body') || '';
  assert.match(body, /Bukidnon Ridge Pacers/);
  assert.match(body, /Maria Santos \(@mariaruns\)/);

  const invalidEmailHref = runnerShell.buildClubRequestMailtoHref({ supportEmail: '   ' });
  assert.ok(invalidEmailHref.startsWith('mailto:events@racepulseph.com?'));
});

test('countInboxUnreadTotal aggregates pending requests, invites, and reminders safely', () => {
  assert.equal(
    runnerShell.countInboxUnreadTotal({
      pendingRequestsCount: 2,
      pendingInvitesCount: 1,
      remindersCount: 3,
    }),
    6,
  );
  assert.equal(
    runnerShell.countInboxUnreadTotal({
      pendingRequestsCount: 0,
      pendingInvitesCount: 0,
      remindersCount: 0,
    }),
    0,
  );
  assert.equal(
    runnerShell.countInboxUnreadTotal({
      pendingRequestsCount: -4,
      pendingInvitesCount: Number.NaN,
      remindersCount: 2.9,
    }),
    2,
  );
});

test('buildHomeFriendFeed joins friends with non-empty activities and sorts newest first', () => {
  const friends = [
    { uid: 'f1', username: 'ana', displayName: 'Ana Reyes', nickname: 'Coach Ana', updatedAt: '2026-11-20T01:00:00Z' },
    { uid: 'f2', username: 'ben', displayName: 'Ben Cruz', updatedAt: '2026-11-22T01:00:00Z' },
    { uid: 'f3', username: 'cara', displayName: 'Cara Lim', updatedAt: '2026-11-18T01:00:00Z' },
  ];
  const activities = {
    f1: {
      uid: 'f1',
      updatedAt: '2026-11-20T05:00:00Z',
      recentRaces: [
        { raceId: 'r1', raceName: 'Manila 10K', date: '2026-11-10', distance: '10K' },
        { raceId: 'r2', raceName: 'Baguio 21K', date: '2026-12-13', distance: '21K' },
      ],
    },
    f2: {
      uid: 'f2',
      updatedAt: '2026-11-23T08:00:00Z',
      recentRaces: [],
    },
    f3: {
      uid: 'f3',
      updatedAt: '2026-11-24T06:00:00Z',
      recentRaces: [{ raceId: 'r3', raceName: 'Cebu Trail 21K', date: '2026-11-29', distance: '21K' }],
    },
  };

  const feed = runnerShell.buildHomeFriendFeed(friends, activities);
  assert.equal(feed.length, 2);
  assert.equal(feed[0].uid, 'f3');
  assert.equal(feed[0].displayName, 'Cara Lim');
  assert.equal(feed[1].uid, 'f1');
  assert.equal(feed[1].displayName, 'Coach Ana');
  assert.deepEqual(
    feed[1].recentRaces.map((r: { raceId: string }) => r.raceId),
    ['r2', 'r1'],
  );
});

test('normalizeOnboardingStepIds keeps only canonical valid step IDs and deduplicates', () => {
  assert.deepEqual(
    runnerShell.normalizeOnboardingStepIds(
      ['connect_friend', 'bogus_step', 'welcome', 'connect_friend', 'dismissed'],
      ['explore_community'],
    ),
    ['welcome', 'explore_community', 'connect_friend'],
  );
  assert.deepEqual(runnerShell.normalizeOnboardingStepIds(undefined, ['welcome']), ['welcome']);
});

test('sortHomeDiscoverRaces prioritizes open registrations, excludes completed races, and sorts by date', () => {
  const today = '2026-11-24';
  const races: Race[] = [
    makeRace({ id: 'done', name: 'Finished Race', date: '2026-11-15', completedAt: '2026-11-15T10:00:00Z' }),
    makeRace({ id: 'past', name: 'Past Closed', date: '2026-11-20', registrationOpen: false }),
    makeRace({ id: 'upcoming_closed', name: 'Closed Upcoming', date: '2026-11-26', registrationOpen: false }),
    makeRace({ id: 'open_later', name: 'Open Later', date: '2026-12-20', registrationOpen: true }),
    makeRace({ id: 'open_soon', name: 'Open Soon', date: '2026-12-01', registrationOpen: true }),
  ];

  const sorted = runnerShell.sortHomeDiscoverRaces(races, today);
  assert.deepEqual(
    sorted.map((r: Race) => r.id),
    ['open_soon', 'open_later', 'upcoming_closed'],
  );
});

test('classifyRecordGnssStatus maps geolocation status and quality to exact pill labels', () => {
  assert.deepEqual(runnerShell.classifyRecordGnssStatus('idle', null), { label: 'Idle', tone: 'neutral' });
  assert.deepEqual(runnerShell.classifyRecordGnssStatus('locating', null), { label: 'Locating...', tone: 'amber' });
  assert.deepEqual(runnerShell.classifyRecordGnssStatus('denied', null), { label: 'Denied', tone: 'red' });
  assert.deepEqual(runnerShell.classifyRecordGnssStatus('unavailable', null), { label: 'Unavailable', tone: 'red' });
  assert.deepEqual(runnerShell.classifyRecordGnssStatus('error', null), { label: 'Error', tone: 'red' });
  assert.deepEqual(
    runnerShell.classifyRecordGnssStatus('active', { quality: 'high', isStale: false, accuracyM: 8 }),
    { label: 'High (<=15m)', tone: 'emerald' },
  );
  assert.deepEqual(
    runnerShell.classifyRecordGnssStatus('active', { quality: 'good', isStale: false, accuracyM: 28 }),
    { label: 'Good (<=35m)', tone: 'emerald' },
  );
  assert.deepEqual(
    runnerShell.classifyRecordGnssStatus('active', { quality: 'coarse', isStale: false, accuracyM: 52 }),
    { label: 'Canopy', tone: 'amber' },
  );
  assert.deepEqual(
    runnerShell.classifyRecordGnssStatus('active', { quality: 'high', isStale: true, accuracyM: 10 }),
    { label: 'Canopy', tone: 'amber' },
  );
});

test('computeRunnerPortfolioCounts computes exact pass, upcoming, completed, and open counts', () => {
  const today = '2026-11-24';
  const races: Race[] = [
    makeRace({ id: 'r_open', date: '2026-12-01', registrationOpen: true }),
    makeRace({ id: 'r_done', date: '2026-11-10', completedAt: '2026-11-10T09:00:00Z', registrationOpen: false }),
    makeRace({ id: 'r_closed_upcoming', date: '2026-12-10', registrationOpen: false }),
  ];
  const profiles: RunnerProfile[] = [
    makeRunnerProfile({ raceId: 'r_open', bibNumber: '101' }),
    makeRunnerProfile({ raceId: 'r_done', bibNumber: '102' }),
  ];
  assert.deepEqual(runnerShell.computeRunnerPortfolioCounts(profiles, races, today), {
    totalPasses: 2,
    upcomingPasses: 1,
    completedPasses: 1,
    openRaces: 1,
  });
});

test('PERSONAL_CAPABILITY_KEYS and hasAnyPersonalCapability authorize milestone personal permissions', () => {
  assert.deepEqual(runnerShell.PERSONAL_CAPABILITY_KEYS, [
    'personal.register',
    'personal.results',
    'personal.bibs',
    'personal.certificates',
    'personal.engraving',
    'personal.friends',
    'personal.record',
    'personal.social',
    'personal.clubs',
    'personal.inbox',
  ]);

  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan([])), false);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['race.view', 'timing.view'])), false);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['personal.record'])), true);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['personal.social'])), true);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['personal.clubs'])), true);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['personal.inbox'])), true);
  assert.equal(runnerShell.hasAnyPersonalCapability(makeCan(['personal.register'])), true);
});
