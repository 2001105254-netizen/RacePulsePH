import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalyticsCsv,
  buildEventViewerBundle,
  buildPortfolioComparison,
  formatPacePerKm,
  formatShortDuration,
} from '../src/lib/eventAnalytics.ts';
import type { ChipRead, Race, RunnerProfile } from '../src/types.ts';

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: 'race_manila_test',
    name: 'Manila Heritage Run',
    date: '2026-10-10',
    distances: [
      { id: 'd_10k', label: '10K', km: 10, price: 1200 },
      { id: 'd_5k', label: '5K', km: 5, price: 800 },
    ],
    ageCategories: [],
    inclusions: [],
    checkpoints: [
      { id: 'cp_start', label: 'Start Mat', type: 'start', order: 1 },
      { id: 'cp_mid', label: 'Turnaround 5K', type: 'intermediate', order: 2 },
      { id: 'cp_finish', label: 'Finish Arch', type: 'finish', order: 3, cutoffMinutes: 120 },
    ],
    waveStartTimes: {
      '10K': '2026-10-10T05:30:00+08:00',
    },
    disqualifiedBibs: { '1006': 'Shortened turnaround' },
    createdBy: 'owner_1',
    createdAt: '2026-09-01T00:00:00.000Z',
    onlinePaymentEnabled: true,
    manualPaymentEnabled: true,
    paymentFeeMode: 'absorbed',
    ...overrides,
  };
}

function makeRunner(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    uid: 'uid_default',
    raceId: 'race_manila_test',
    bibNumber: '1001',
    fullName: 'Juan Dela Cruz',
    gender: 'male',
    age: 28,
    distance: '10K',
    shirtSize: 'M',
    emergencyContactName: '',
    emergencyContactPhone: '',
    chipId: 'EPC1001',
    paymentStatus: 'paid',
    createdAt: '2026-10-05T08:00:00.000Z',
    ...overrides,
  };
}

function makeRead(overrides: Partial<ChipRead> = {}): ChipRead {
  return {
    id: 'cr_default',
    raceId: 'race_manila_test',
    bibNumber: '1001',
    checkpointId: 'cp_finish',
    timestamp: '2026-10-10T06:15:00+08:00',
    source: 'rfid-bridge',
    recordedBy: 'operator_1',
    createdAt: '2026-10-10T06:15:00+08:00',
    ...overrides,
  };
}

test('formatShortDuration and formatPacePerKm handle standard values and boundaries', () => {
  assert.equal(formatShortDuration(undefined), '--:--:--');
  assert.equal(formatShortDuration(-5), '--:--:--');
  assert.equal(formatShortDuration(3723), '01:02:03');

  assert.equal(formatPacePerKm(undefined, 10), '--:-- /km');
  assert.equal(formatPacePerKm(3000, 0), '--:-- /km');
  assert.equal(formatPacePerKm(3000, 10), '05:00 /km');
  assert.equal(formatPacePerKm(599, 10), '01:00 /km');
});

test('buildEventViewerBundle computes performance, financial, demographics, operations, and distance filtering accurately', () => {
  const race = makeRace();
  const runners: RunnerProfile[] = [
    makeRunner({
      uid: 'u1',
      bibNumber: '1001',
      fullName: 'Carlo Santos',
      gender: 'male',
      age: 27,
      distance: '10K',
      shirtSize: 'M',
      kitClaimedAt: '2026-10-08T14:00:00.000Z',
      paymentMethod: 'paymongo',
      paymentAmount: 1200,
      paymentPaidAt: '2026-10-05T09:00:00.000Z',
      emergencyContactName: 'Ana Santos',
      emergencyContactPhone: '09171234567',
      marketingOptIn: true,
    }),
    makeRunner({
      uid: 'u2',
      bibNumber: '1002',
      fullName: 'Lea Reyes',
      gender: 'female',
      age: 31,
      distance: '10K',
      shirtSize: 'S',
      paymentMethod: 'manual',
      paymentAmount: 1200,
      paymentPaidAt: '2026-10-06T10:00:00.000Z',
    }),
    makeRunner({
      uid: 'u3',
      bibNumber: '1003',
      fullName: 'Mark Lim',
      gender: 'male',
      age: 34,
      distance: '10K',
      paymentStatus: 'pending',
      paymentMethod: 'manual',
      paymentAmount: 1200,
      paymentReference: 'GCASH-881',
    }),
    makeRunner({
      uid: 'u4',
      bibNumber: '1004',
      fullName: 'Noel Go',
      distance: '10K',
      paymentStatus: undefined,
    }),
    makeRunner({
      uid: 'u5',
      bibNumber: '1005',
      fullName: 'Bea Tan',
      gender: 'female',
      distance: '10K',
      paymentStatus: undefined,
    }),
    makeRunner({
      uid: 'u6',
      bibNumber: '1006',
      fullName: 'Ken Yu',
      distance: '10K',
      paymentStatus: undefined,
    }),
    makeRunner({
      uid: 'u7',
      bibNumber: '5001',
      fullName: 'Group BGC Leg 2',
      distance: '5K',
      shirtSize: 'L',
      entryCategory: 'group',
      teamName: 'BGC Pacers',
      startsAfterBib: '5002',
      paymentMethod: 'paymongo',
      paymentAmount: 2400,
      paymentPaidAt: '2026-10-07T08:00:00.000Z',
    }),
    makeRunner({
      uid: 'u8',
      bibNumber: '5002',
      fullName: 'Solo Chip 5K',
      distance: '5K',
      shirtSize: 'M',
      paymentMethod: 'paymongo',
      paymentAmount: 800,
      paymentPaidAt: '2026-10-07T08:30:00.000Z',
    }),
    makeRunner({
      uid: 'u9',
      bibNumber: '5003',
      fullName: 'Broken Relay Link',
      distance: '5K',
      startsAfterBib: '9999',
      paymentStatus: undefined,
    }),
    makeRunner({
      uid: 'u10',
      bibNumber: '',
      fullName: 'Unassigned Runner',
      chipId: '',
      distance: '3K Walk',
      paymentStatus: undefined,
      isFreeSlot: true,
    }),
  ];

  const chipReads: ChipRead[] = [
    // 1001: 10K gun-timed (wave start 05:30 -> finish 06:12 = 42m; chip split 05:31 -> 06:12)
    makeRead({ id: 'c1', bibNumber: '1001', checkpointId: 'cp_start', timestamp: '2026-10-10T05:31:00+08:00', source: 'rfid-bridge' }),
    makeRead({ id: 'c2', bibNumber: '1001', checkpointId: 'cp_mid', timestamp: '2026-10-10T05:52:00+08:00', source: 'rfid-bridge' }),
    makeRead({ id: 'c3', bibNumber: '1001', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:12:00+08:00', source: 'rfid-bridge' }),
    // 1002: 10K gun-timed manual finish (05:30 -> 06:25 = 55m)
    makeRead({ id: 'c4', bibNumber: '1002', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:25:00+08:00', source: 'manual' }),
    // 1005: DNF (start scan only)
    makeRead({ id: 'c5', bibNumber: '1005', checkpointId: 'cp_start', timestamp: '2026-10-10T05:32:00+08:00', source: 'rfid-bridge' }),
    // 1006: DQ via race.disqualifiedBibs
    makeRead({ id: 'c6', bibNumber: '1006', checkpointId: 'cp_start', timestamp: '2026-10-10T05:32:30+08:00', source: 'rfid-bridge' }),
    makeRead({ id: 'c7', bibNumber: '1006', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:10:00+08:00', source: 'rfid-bridge' }),
    // 5002: 5K chip-timed (06:00 -> 06:22 = 22m)
    makeRead({ id: 'c8', bibNumber: '5002', checkpointId: 'cp_start', timestamp: '2026-10-10T06:00:00+08:00', source: 'rfid-bridge' }),
    makeRead({ id: 'c9', bibNumber: '5002', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:22:00+08:00', source: 'rfid-bridge' }),
    // 5001: 5K transition-timed (starts after 5002 finish 06:22 -> finishes 06:46 = 24m)
    makeRead({ id: 'c10', bibNumber: '5001', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:46:00+08:00', source: 'rfid-bridge' }),
    // Unmatched phantom RFID scan
    makeRead({ id: 'c11', bibNumber: '8888', checkpointId: 'cp_finish', timestamp: '2026-10-10T06:50:00+08:00', source: 'rfid-bridge' }),
  ];

  const bundle = buildEventViewerBundle({
    race,
    raceRunners: runners,
    allRaces: [race],
    runnersByRace: new Map([[race.id, runners]]),
    chipReads,
    completed: true,
    todayStr: '2026-10-12',
  });

  const row10k = bundle.performance.byDistance.find((d) => d.label === '10K');
  assert.ok(row10k, '10K performance row exists');
  assert.equal(row10k.registered, 6);
  assert.equal(row10k.started, 4);
  assert.equal(row10k.finished, 2);
  assert.equal(row10k.dns, 2);
  assert.equal(row10k.dnf, 1);
  assert.equal(row10k.dq, 1);
  assert.equal(row10k.gunTimed, 2);
  assert.equal(row10k.fastestSeconds, 42 * 60);
  assert.equal(row10k.slowestSeconds, 55 * 60);

  const row5k = bundle.performance.byDistance.find((d) => d.label === '5K');
  assert.ok(row5k, '5K performance row exists');
  assert.equal(row5k.chipTimed, 1);
  assert.equal(row5k.transitionTimed, 1);
  assert.equal(row5k.fastestSeconds, 22 * 60);

  assert.equal(bundle.performance.timingHealth.totalReads, 11);
  assert.equal(bundle.performance.timingHealth.rfidBridgeReads, 10);
  assert.equal(bundle.performance.timingHealth.manualReads, 1);
  assert.deepEqual(bundle.performance.timingHealth.unmatchedBibs, ['8888']);
  assert.equal(bundle.performance.topFinishers.length, 4);
  assert.equal(bundle.performance.topFinishers[0].bibNumber, '5002');

  // Check distance filter isolates 5K only while keeping availableDistances
  const filtered5k = buildEventViewerBundle({
    race,
    raceRunners: runners,
    allRaces: [race],
    runnersByRace: new Map([[race.id, runners]]),
    chipReads,
    completed: true,
    todayStr: '2026-10-12',
    distanceFilter: '5K',
  });
  assert.deepEqual(filtered5k.availableDistances, ['5K', '10K']);
  assert.equal(filtered5k.activeDistanceFilter, '5K');
  assert.equal(filtered5k.telemetry.totalRunners, 3);
  assert.equal(filtered5k.performance.byDistance.length, 1);
  assert.equal(filtered5k.performance.byDistance[0].label, '5K');

  // Financial checks on unfiltered bundle:
  // onlinePaid: 1001 (1200) + 5001 (2400) + 5002 (800) = 4400 (3 paid)
  // manualPaid: 1002 (1200)
  // pending: 1003 (1200)
  assert.equal(bundle.financial.onlinePaidCount, 3);
  assert.equal(bundle.financial.onlinePaidAmount, 4400);
  assert.equal(bundle.financial.manualPaidCount, 1);
  assert.equal(bundle.financial.manualPaidAmount, 1200);
  assert.equal(bundle.financial.pendingCount, 1);
  assert.equal(bundle.financial.pendingAmount, 1200);
  assert.equal(bundle.financial.pendingPayments.length, 1);
  assert.equal(bundle.financial.pendingPayments[0].reference, 'GCASH-881');
  assert.equal(bundle.financial.freeSlotCount, 1);

  // Demographics checks: 9 solo runners (headcount 1 each) + 1 group (headcount 4) = 13
  assert.equal(bundle.demographics.compliance.totalHeadcount, 13);
  assert.equal(bundle.demographics.compliance.emergencyContactCount, 1);
  assert.equal(bundle.demographics.compliance.marketingOptInCount, 1);
  const groupFormat = bundle.demographics.entryFormatHeadcount.find((item) => item.category === 'group');
  assert.ok(groupFormat, 'group format breakdown exists');
  assert.equal(groupFormat.entriesCount, 1);
  assert.equal(groupFormat.headcount, 4);

  const mShirt = bundle.demographics.shirtInventory.find((s) => s.size === 'M');
  assert.ok(mShirt);
  assert.equal(mShirt.claimedCount, 1);

  // Operations audit checks
  assert.equal(bundle.operations.missingBibCount, 1);
  assert.equal(bundle.operations.missingChipCount, 1);
  assert.equal(bundle.operations.unmappedDistanceCount, 1);
  assert.deepEqual(bundle.operations.brokenRelayLinks, [{ bibNumber: '5003', targetBib: '9999' }]);
  assert.ok(bundle.operations.attentionItems.some((item) => item.kind === 'unmatched-scan' && item.bibNumber === '8888'));
  assert.ok(bundle.operations.attentionItems.some((item) => item.kind === 'broken-relay' && item.bibNumber === '5003'));
});

test('buildPortfolioComparison and buildAnalyticsCsv honor RBAC and sanitize spreadsheet formulas', () => {
  const maliciousRace = makeRace({
    id: 'race_evil',
    name: '+CMD_INJECT',
    date: '2026-11-15',
    distances: [{ id: 'd_10k', label: '=10K', km: 10, price: 1200 }],
  });
  const runners: RunnerProfile[] = [
    makeRunner({
      uid: 'u_evil',
      raceId: maliciousRace.id,
      bibNumber: '1001',
      fullName: '=1+1 @SUM',
      chipId: '',
      distance: '=10K',
      paymentStatus: 'paid',
      paymentMethod: 'paymongo',
      paymentAmount: 1200,
    }),
  ];
  const reads: ChipRead[] = [
    makeRead({
      id: 'c_evil',
      raceId: maliciousRace.id,
      bibNumber: '1001',
      checkpointId: 'cp_finish',
      timestamp: '2026-10-10T06:15:00+08:00',
    }),
  ];

  const runnersByRace = new Map([[maliciousRace.id, runners]]);
  const portfolio = buildPortfolioComparison([maliciousRace], runnersByRace, '2026-11-01');
  assert.equal(portfolio.length, 1);
  assert.equal(portfolio[0].runners, 1);
  assert.equal(portfolio[0].collectedAmount, 1200);
  assert.equal(portfolio[0].collectionRatePct, 100);

  const bundle = buildEventViewerBundle({
    race: maliciousRace,
    raceRunners: runners,
    allRaces: [maliciousRace],
    runnersByRace,
    chipReads: reads,
    completed: false,
    todayStr: '2026-11-01',
  });

  // 1) Portfolio CSV without revenue permission omits revenue columns and neutralizes +CMD_INJECT
  const noRevPortfolioCsv = buildAnalyticsCsv({
    scope: 'portfolio',
    category: 'performance',
    bundle,
    portfolio,
    canViewRevenue: false,
  });
  assert.ok(!noRevPortfolioCsv.csv.includes('Collected PHP'));
  assert.ok(noRevPortfolioCsv.csv.includes("'+CMD_INJECT"));

  // 2) Financial CSV without canViewRevenue falls back safely instead of dumping revenue
  const deniedFinancialCsv = buildAnalyticsCsv({
    scope: 'event',
    category: 'financial',
    bundle,
    portfolio,
    canViewRevenue: false,
  });
  assert.ok(!deniedFinancialCsv.csv.includes('Collected PHP'));

  // 3) Performance CSV neutralizes formula distance label ('=10K) and Operations CSV neutralizes runner formula ('=1+1 @SUM)
  const perfCsv = buildAnalyticsCsv({
    scope: 'event',
    category: 'performance',
    bundle,
    portfolio,
    canViewRevenue: true,
  });
  assert.ok(perfCsv.csv.includes("'=10K"));

  const opsCsv = buildAnalyticsCsv({
    scope: 'event',
    category: 'operations',
    bundle,
    portfolio,
    canViewRevenue: true,
  });
  assert.ok(opsCsv.csv.includes("'=1+1 @SUM"));
});
