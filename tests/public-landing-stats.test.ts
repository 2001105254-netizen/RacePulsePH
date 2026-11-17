import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicRaceStats,
  computePublicLandingBundle,
  inferGenderFromDivisionLabel,
  parseDistanceAndEntryCategory,
} from '../src/lib/publicLandingStats.ts';
import type { RaceRouteCatalogEntry } from '../src/lib/routes/types.ts';
import type { ChipRead, PublicLiveResults, Race, RunnerProfile } from '../src/types.ts';

function assertNoFinancialOrPiiKeys(
  value: unknown,
  options: { piiValues?: string[]; disallowUndefined?: boolean; path?: string } = {}
): void {
  const { piiValues = [], disallowUndefined = true, path = 'root' } = options;
  const forbiddenKeyRe = /(price|revenue|collected|pending|gross|paymongo|fee|amount|currency|email|phone|emergencyContactName|emergencyContactPhone|chipid|fullname|parentalGuardianName)/i;
  if (value === undefined) {
    if (disallowUndefined) {
      assert.fail(`Unexpected undefined at ${path}`);
    }
    return;
  }
  if (typeof value === 'string') {
    assert.equal(value.includes('₱'), false, `Found currency symbol at ${path}: ${value}`);
    for (const pii of piiValues) {
      if (pii) {
        assert.equal(value.includes(pii), false, `Found PII string "${pii}" at ${path}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) =>
      assertNoFinancialOrPiiKeys(item, { piiValues, disallowUndefined, path: `${path}[${idx}]` })
    );
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      assert.equal(forbiddenKeyRe.test(key), false, `Forbidden key "${key}" found at ${path}.${key}`);
      assertNoFinancialOrPiiKeys(val, { piiValues, disallowUndefined, path: `${path}.${key}` });
    }
  }
}

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: 'race_cebu_coastal',
    name: 'Cebu Coastal Half',
    date: '2026-10-18',
    completedAt: '2026-10-18T11:30:00+08:00',
    distances: [
      { id: 'd_5k_solo', label: '5K SOLO', km: 5, price: 950 },
      { id: 'd_5k_duo', label: '5K DUO', km: 5, price: 1800 },
      { id: 'd_12k_solo', label: '12K SOLO', km: 12, price: 1500 },
    ],
    ageCategories: [
      { id: 'ac_m_open', label: 'Male 18-39', gender: 'male', minAge: 18, maxAge: 39 },
      { id: 'ac_f_open', label: 'Female 18-39', gender: 'female', minAge: 18, maxAge: 39 },
    ],
    inclusions: ['Timing Chip', 'Finisher Medal'],
    checkpoints: [
      { id: 'cp_start', label: 'Start Arch', type: 'start', order: 1 },
      { id: 'cp_turn', label: 'Mactan Turn', type: 'intermediate', order: 2 },
      { id: 'cp_finish', label: 'Finish Gantry', type: 'finish', order: 3, cutoffMinutes: 180 },
    ],
    waveStartTimes: {
      '5K SOLO': '2026-10-18T05:30:00+08:00',
      '5K DUO': '2026-10-18T05:35:00+08:00',
      '12K SOLO': '2026-10-18T05:00:00+08:00',
    },
    disqualifiedBibs: { '1209': 'Missed turnaround mat' },
    createdBy: 'org_1',
    createdAt: '2026-09-01T00:00:00.000Z',
    onlinePaymentEnabled: true,
    manualPaymentEnabled: true,
    paymentFeeMode: 'absorbed',
    ...overrides,
  };
}

function makeRunner(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    uid: 'uid_runner_1',
    raceId: 'race_cebu_coastal',
    bibNumber: '5001',
    fullName: 'Maria Clara Santos',
    gender: 'female',
    age: 29,
    distance: '5K SOLO',
    entryCategory: 'solo',
    shirtSize: 'S',
    emergencyContactName: 'Pedro Santos',
    emergencyContactPhone: '09177654321',
    marketingOptIn: true,
    kitClaimedAt: '2026-10-17T10:00:00.000Z',
    chipId: 'EPC_PRIVATE_5001',
    paymentStatus: 'paid',
    createdAt: '2026-10-14T08:00:00.000Z',
    ...overrides,
  };
}

test('parseDistanceAndEntryCategory merges multi-format labels cleanly', () => {
  assert.deepEqual(parseDistanceAndEntryCategory('5K SOLO'), {
    baseDistance: '5K',
    entryCategory: 'solo',
    isFreeSlot: false,
  });
  assert.deepEqual(parseDistanceAndEntryCategory('5K DUO'), {
    baseDistance: '5K',
    entryCategory: 'duo',
    isFreeSlot: false,
  });
  assert.deepEqual(parseDistanceAndEntryCategory('5K DUO FREE SLOTS'), {
    baseDistance: '5K',
    entryCategory: 'duo',
    isFreeSlot: true,
  });
  assert.deepEqual(parseDistanceAndEntryCategory('21K Trio'), {
    baseDistance: '21K',
    entryCategory: 'trio',
    isFreeSlot: false,
  });
  assert.deepEqual(parseDistanceAndEntryCategory('Unknown'), {
    baseDistance: '',
    entryCategory: 'solo',
    isFreeSlot: false,
  });
});

test('inferGenderFromDivisionLabel detects gendered division labels accurately', () => {
  assert.equal(inferGenderFromDivisionLabel('Female 13-39'), 'female');
  assert.equal(inferGenderFromDivisionLabel('Women Open'), 'female');
  assert.equal(inferGenderFromDivisionLabel('Male 40-49'), 'male');
  assert.equal(inferGenderFromDivisionLabel('Men Masters'), 'male');
  assert.equal(inferGenderFromDivisionLabel('Open Category'), null);
});

test('buildPublicRaceStats excludes financial data, excludes PII, and blocks pre-race test scans', () => {
  const race = makeRace();
  const runners: RunnerProfile[] = [
    makeRunner({
      uid: 'u1',
      bibNumber: '5001',
      fullName: 'Secret Name Alpha',
      gender: 'female',
      age: 16,
      distance: '5K SOLO',
      shirtSize: 'S',
      kitClaimedAt: '2026-10-17T09:00:00.000Z',
    }),
    makeRunner({
      uid: 'u2',
      bibNumber: '5002',
      fullName: 'Secret Name Beta',
      gender: 'male',
      age: 52,
      distance: '5K DUO',
      entryCategory: 'duo',
      shirtSize: 'L',
      kitClaimedAt: undefined,
    }),
    makeRunner({
      uid: 'u3',
      bibNumber: '1201',
      fullName: 'Secret Youth Under13',
      gender: 'female',
      age: 12,
      parentalGuardianName: 'Guardian One',
      parentalConsentConfirmed: true,
      distance: '5K SOLO',
      shirtSize: 'XS',
      isFreeSlot: false,
    }),
    makeRunner({
      uid: 'u4',
      bibNumber: '1202',
      fullName: 'Free Slot Placeholder',
      gender: 'male',
      age: 18,
      distance: '5K DUO',
      entryCategory: 'duo',
      shirtSize: 'M',
      isFreeSlot: true,
    }),
  ];

  const reads: ChipRead[] = [
    {
      id: 'r1',
      raceId: race.id,
      bibNumber: '5001',
      checkpointId: 'cp_start',
      timestamp: '2026-10-18T05:30:05+08:00',
      source: 'rfid-bridge',
      recordedBy: 'op1',
      createdAt: '2026-10-18T05:30:05+08:00',
    },
    {
      id: 'r2',
      raceId: race.id,
      bibNumber: '5001',
      checkpointId: 'cp_finish',
      timestamp: '2026-10-18T05:54:15+08:00',
      source: 'rfid-bridge',
      recordedBy: 'op1',
      createdAt: '2026-10-18T05:54:15+08:00',
    },
    {
      id: 'r3',
      raceId: race.id,
      bibNumber: 'UNKNOWN',
      checkpointId: 'cp_finish',
      timestamp: '2026-10-18T05:55:00+08:00',
      source: 'manual',
      recordedBy: 'op1',
      createdAt: '2026-10-18T05:55:00+08:00',
    },
  ];

  // When canPublishTiming is false, chipReads must never leak into publicStats
  const preRaceStats = buildPublicRaceStats({
    race,
    raceRunners: runners,
    chipReads: reads,
    completed: false,
    canPublishTiming: false,
    todayStr: '2026-10-18',
  });

  assertNoFinancialOrPiiKeys(preRaceStats, {
    piiValues: [
      'Secret Name Alpha',
      'Secret Name Beta',
      '09177654321',
      'EPC_PRIVATE_5001',
      'Pedro Santos',
      'Guardian One',
    ],
    disallowUndefined: true,
  });
  assert.equal(preRaceStats.timingMix.rfidReads, 0);
  assert.equal(preRaceStats.timingMix.manualReads, 0);
  assert.equal(preRaceStats.readiness.freeSlotCount, 1);
  assert.equal(preRaceStats.readiness.under13Count, 1);
  assert.equal(preRaceStats.readiness.under13ConsentCount, 1);
  assert.equal(preRaceStats.ageSummary.youthUnder18, 2);
  assert.equal(preRaceStats.ageSummary.masters50Plus, 1);

  // When canPublishTiming is true, full timing telemetry + readiness publish cleanly
  const liveStats = buildPublicRaceStats({
    race,
    raceRunners: runners,
    chipReads: reads,
    completed: true,
    canPublishTiming: true,
    todayStr: '2026-10-18',
  });

  assertNoFinancialOrPiiKeys(liveStats, {
    piiValues: [
      'Secret Name Alpha',
      'Secret Name Beta',
      '09177654321',
      'EPC_PRIVATE_5001',
      'Pedro Santos',
      'Guardian One',
    ],
    disallowUndefined: true,
  });
  assert.equal(liveStats.timingMix.rfidReads, 2);
  assert.equal(liveStats.timingMix.manualReads, 1);
  assert.equal(
    liveStats.byDistance.reduce((sum, d) => sum + d.registered, 0),
    4,
  );
  assert.ok(liveStats.headcount >= 4);
  assert.equal(liveStats.shirtInventory.length > 0, true);
  assert.equal(liveStats.entryFormats.some((f) => f.category === 'duo'), true);
});

test('computePublicLandingBundle combines legacy liveResults and rich publicStats with zero financial leaks', () => {
  const raceWithPub = makeRace({
    id: 'race_subic',
    name: 'Subic Triathlon Split',
    date: '2026-10-11',
  });
  const legacyRace = makeRace({
    id: 'race_bgc',
    name: 'BGC Night 10K',
    date: '2026-10-04',
    distances: [
      { id: 'd10', label: '10K', km: 10, price: 1400 },
      { id: 'd5f', label: '5K DUO FREE SLOTS', km: 5, price: 0 },
    ],
    waveStartTimes: { '10K': '2026-10-04T19:00:00+08:00' },
  });
  const upcomingRace = makeRace({
    id: 'race_upcoming',
    name: 'Manila Bay Sunrise Run',
    date: '2026-12-20',
    completedAt: undefined,
    waveStartTimes: {},
    gunStartTime: undefined,
    distances: [{ id: 'du5', label: '5K', km: 5, price: 1100 }],
  });

  const subicRunners = [
    makeRunner({
      uid: 'sr1',
      raceId: raceWithPub.id,
      bibNumber: '501',
      fullName: 'Subic Leader',
      gender: 'male',
      age: 31,
      distance: '5K SOLO',
      shirtSize: 'M',
    }),
    makeRunner({
      uid: 'sr2',
      raceId: raceWithPub.id,
      bibNumber: '502',
      fullName: 'Subic Duo Runner',
      gender: 'female',
      age: 26,
      distance: '5K DUO',
      entryCategory: 'duo',
      shirtSize: 'S',
    }),
  ];
  const subicPubStats = buildPublicRaceStats({
    race: raceWithPub,
    raceRunners: subicRunners,
    chipReads: [
      {
        id: 's_r1',
        raceId: raceWithPub.id,
        bibNumber: '501',
        checkpointId: 'cp_finish',
        timestamp: '2026-10-11T05:50:00+08:00',
        source: 'rfid-bridge',
        recordedBy: 'op1',
        createdAt: '2026-10-11T05:50:00+08:00',
      },
    ],
    completed: true,
    canPublishTiming: true,
    todayStr: '2026-10-18',
  });

  const resultsByRaceId: Record<string, PublicLiveResults> = {
    [raceWithPub.id]: {
      raceId: raceWithPub.id,
      raceName: raceWithPub.name,
      status: 'completed',
      totalRegistered: 2,
      totalStarted: 2,
      totalFinished: 2,
      leaders: [
        {
          bibNumber: '501',
          fullName: 'Subic Leader',
          distance: '5K SOLO',
          finishTime: '00:20:00.00',
          rank: 1,
          overallRank: 1,
          categoryLabel: 'Male 18-39',
          categoryRank: 1,
          timingMethod: 'chip',
        },
      ],
      officialResults: [
        {
          bibNumber: '501',
          fullName: 'Subic Leader',
          distance: '5K SOLO',
          finishTime: '00:20:00.00',
          rank: 1,
          overallRank: 1,
          categoryLabel: 'Male 18-39',
          categoryRank: 1,
          timingMethod: 'chip',
        },
        {
          bibNumber: '502',
          fullName: 'Subic Duo Runner',
          distance: '5K DUO',
          finishTime: '00:24:30.00',
          rank: 2,
          overallRank: 2,
          categoryLabel: 'Female 18-39',
          categoryRank: 1,
          timingMethod: 'gun',
        },
      ],
      publicStats: subicPubStats,
      updatedAt: '2026-10-11T10:00:00.000Z',
    },
    [legacyRace.id]: {
      raceId: legacyRace.id,
      raceName: legacyRace.name,
      status: 'completed',
      totalRegistered: 40,
      totalStarted: 38,
      totalFinished: 1,
      leaders: [],
      officialResults: [
        {
          bibNumber: '9001',
          fullName: 'BGC Podium',
          distance: '10K',
          finishTime: '00:42:10.00',
          rank: 1,
          overallRank: 1,
          categoryLabel: 'Female 18-39',
          categoryRank: 1,
          timingMethod: 'chip',
        },
      ],
      updatedAt: '2026-10-04T22:00:00.000Z',
    },
    [upcomingRace.id]: {
      raceId: upcomingRace.id,
      raceName: upcomingRace.name,
      status: 'upcoming',
      totalRegistered: 120,
      totalStarted: 0,
      totalFinished: 0,
      leaders: [],
      officialResults: [],
      updatedAt: '2026-10-15T10:00:00.000Z',
    },
  };

  const routes: RaceRouteCatalogEntry[] = [
    {
      id: `${raceWithPub.id}_d_5k_solo`,
      raceId: raceWithPub.id,
      raceName: raceWithPub.name,
      raceDate: raceWithPub.date,
      region: 'Central Visayas',
      distanceId: 'd_5k_solo',
      distanceLabel: '5K',
      advertisedKm: 5,
      measuredDistanceM: 5120,
      elevationGainM: 84,
      elevationStatus: 'complete',
      landmarkCount: 4,
      checkpointCount: 3,
      currentPublicationId: 'pub_subic_5k',
      versionNumber: 1,
      status: 'published',
      publishedAt: '2026-10-10T00:00:00.000Z',
    },
  ];

  const allBundle = computePublicLandingBundle({
    races: [raceWithPub, legacyRace, upcomingRace],
    resultsByRaceId,
    routes,
    selectedRaceId: 'all',
    distanceFilter: 'all',
    entryCategoryFilter: 'all',
    todayStr: '2026-10-18',
  });

  assertNoFinancialOrPiiKeys(allBundle, { disallowUndefined: false });
  assert.equal(allBundle.overview.totalEvents, 3);
  assert.equal(allBundle.overview.upcomingEvents, 1);
  assert.equal(allBundle.overview.completedEvents, 2);
  // Upcoming race's 120 registrants must NOT inflate DNS
  assert.ok(allBundle.overview.dnsCount <= 2);
  // 5K SOLO, 5K DUO, 5K DUO FREE SLOTS merge into a single normalized "5K", leaving ["5K", "10K", "12K"]
  assert.deepEqual(allBundle.availableDistances, ['5K', '10K', '12K']);
  assert.equal(allBundle.performance.finishBuckets.length, 14);
  assert.equal(allBundle.operations.publishedRoutesCount, 1);
  assert.ok(allBundle.operations.totalRouteKm > 5);
  assert.equal(allBundle.operations.maxElevationGainM, 84);
  assert.equal(allBundle.portfolio.length, 3);

  // Filtered by Duo format + 5K distance
  const filteredBundle = computePublicLandingBundle({
    races: [raceWithPub, legacyRace, upcomingRace],
    resultsByRaceId,
    routes,
    selectedRaceId: 'all',
    distanceFilter: '5K',
    entryCategoryFilter: 'duo',
    todayStr: '2026-10-18',
  });

  assertNoFinancialOrPiiKeys(filteredBundle, { disallowUndefined: false });
  assert.equal(filteredBundle.overview.totalFinished, 1);
  assert.equal(filteredBundle.performance.topFinishers[0]?.bibNumber, '502');
});
