import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlaylistRules,
  buildRunnerDirectory,
  computeElapsedHmsFromClockPair,
  computeHighlightPace,
  DEFAULT_MARQUEE_CONFIG,
  deriveHighlightPlacement,
  deriveRaceCode,
  formatHighlightClockTime,
  formatHighlightDuration,
  isHighlightExpired,
  normalizeHighlightConfig,
  parseDistanceKm,
  parseDurationToSeconds,
  parsePacePulseMs,
  sanitizeHexColor,
  sanitizeHighlightPayload,
} from '../src/lib/highlights.ts';
import type { PublicLiveResults, Race, RunnerHighlight, RunnerProfile, RunnerResult } from '../src/types.ts';

function makeHighlight(overrides: Partial<RunnerHighlight> = {}): RunnerHighlight {
  return {
    id: 'hl_base',
    mode: 'solo',
    runnerName: 'Marco Reyes',
    bibNumber: '21-01',
    placement: 'Finisher',
    distance: '21K',
    chipTime: '01:28:12',
    pace: '4:11 /km',
    raceName: 'Manila Dawn Half',
    raceDate: '2026-11-01',
    photoUrl: 'data:image/jpeg;base64,abc',
    borderPreset: 'liquid-gold',
    cornerGeometry: 'rounded',
    accentColor: '#f5b731',
    glowIntensity: 75,
    surfaceFinish: 'glossy',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

test('parsePacePulseMs maps faster paces to shorter pulse periods', () => {
  const fast = parsePacePulseMs('3:15 /km');
  const moderate = parsePacePulseMs('5:30 /km');
  const slow = parsePacePulseMs('8:30 /km');
  assert.ok(fast < moderate);
  assert.ok(moderate < slow);
  assert.ok(fast >= 560 && slow <= 1650);
});

test('applyPlaylistRules filters expired cards, applies race filter, and prioritizes pinned & podium finishers', () => {
  const items: RunnerHighlight[] = [
    makeHighlight({ id: 'h_finisher', placement: 'Finisher', raceId: 'r1', raceDate: '2026-10-01' }),
    makeHighlight({ id: 'h_1st', placement: '1st', raceId: 'r2', raceDate: '2026-11-01' }),
    makeHighlight({ id: 'h_pinned', placement: 'Top 10', pinned: true, raceId: 'r2', raceDate: '2026-11-01' }),
    makeHighlight({ id: 'h_expired', placement: 'Record Holder', expiresAt: '2026-10-15', raceId: 'r2', raceDate: '2026-11-01' }),
  ];

  const filtered = applyPlaylistRules(
    items,
    { ...DEFAULT_MARQUEE_CONFIG, pinPodiumFirst: true, hideExpired: true, filterRaceId: 'r2' },
    '2026-11-10',
  );

  assert.deepEqual(
    filtered.map((x) => x.id),
    ['h_pinned', 'h_1st'],
  );

  const latestOnly = applyPlaylistRules(
    items,
    { ...DEFAULT_MARQUEE_CONFIG, pinPodiumFirst: true, hideExpired: false, filterRaceId: 'latest' },
    '2026-11-10',
  );
  assert.equal(latestOnly[0].id, 'h_pinned');
  assert.ok(latestOnly.every((x) => x.raceId === 'r2'));
});

test('sanitizeHighlightPayload caps lengths, cleans hex accents, and omits invalid duo fields on solo mode', () => {
  const dirty = makeHighlight({
    id: 'hl test!@#',
    mode: 'solo',
    runnerName: 'A'.repeat(100),
    accentColor: 'invalid-color',
    glowIntensity: 999,
    partnerName: 'Should Be Stripped',
  });
  const clean = sanitizeHighlightPayload(dirty);
  assert.equal(clean.id, 'hltest');
  assert.equal(clean.runnerName.length, 36);
  assert.equal(clean.accentColor, '#ff3b30');
  assert.equal(clean.glowIntensity, 100);
  assert.equal('partnerName' in clean, false);
});

test('normalizeHighlightConfig clamps speed, cardGap, and edgeFade bounds', () => {
  const cfg = normalizeHighlightConfig({ speedPxPerSec: 999, cardGapPx: 2, edgeFadePx: 500, direction: 'right' });
  assert.equal(cfg.speedPxPerSec, 120);
  assert.equal(cfg.cardGapPx, 12);
  assert.equal(cfg.edgeFadePx, 120);
  assert.equal(cfg.direction, 'right');
});

test('isHighlightExpired, sanitizeHexColor, and deriveRaceCode behave deterministically', () => {
  assert.equal(isHighlightExpired({ expiresAt: '2026-01-01' }, '2026-02-01'), true);
  assert.equal(isHighlightExpired({ expiresAt: '2026-03-01' }, '2026-02-01'), false);
  assert.equal(sanitizeHexColor('#abc'), '#aabbcc');
  assert.equal(deriveRaceCode('Manila Dawn Half Marathon', '2026-11-15'), 'MAN-DAW-HAL-2026');
});

test('formatHighlightDuration, parseDistanceKm, computeHighlightPace, and deriveHighlightPlacement', () => {
  assert.equal(formatHighlightDuration('01:24:1834210'), '01:24:18');
  assert.equal(formatHighlightDuration('00:41:10.75'), '00:41:10');
  assert.equal(formatHighlightDuration('39:40'), '00:39:40');
  assert.equal(formatHighlightDuration('--:--:--'), '');
  assert.equal(formatHighlightDuration('DNF'), '');

  assert.equal(parseDurationToSeconds('00:40:00'), 2400);
  assert.equal(parseDistanceKm('21K'), 21);
  assert.equal(parseDistanceKm('1500m'), 1.5);
  assert.equal(
    parseDistanceKm('Half', { distances: [{ id: 'd1', label: 'Half', km: 21.1, price: 1500 }] }),
    21.1,
  );

  assert.equal(computeHighlightPace('00:40:00', 10), '4:00 /km');
  assert.equal(computeHighlightPace('01:24:1834210', 21), '4:01 /km');
  assert.equal(computeHighlightPace('', 10), '');

  assert.equal(deriveHighlightPlacement(1), '1st');
  assert.equal(deriveHighlightPlacement(undefined, 2), '2nd');
  assert.equal(deriveHighlightPlacement(3), '3rd');
  assert.equal(deriveHighlightPlacement(7), 'Top 10');
  assert.equal(deriveHighlightPlacement(24), 'Finisher');
  assert.equal(deriveHighlightPlacement(1, 1, true), 'Finisher');
});

test('formatHighlightClockTime, computeElapsedHmsFromClockPair, and 18K Gun-to-Finish pace calculation', () => {
  assert.equal(formatHighlightClockTime('05:00:00'), '05:00:00');
  assert.equal(formatHighlightClockTime('6:35:32'), '06:35:32');
  assert.equal(formatHighlightClockTime('2026-11-14T05:00:00'), '05:00:00');
  assert.equal(computeElapsedHmsFromClockPair('05:00:00', '06:35:32'), '01:35:32');
  assert.equal(computeElapsedHmsFromClockPair('00:00:00', '00:45:10'), '00:45:10');
  assert.equal(computeElapsedHmsFromClockPair('23:55:00', '01:05:00'), '01:10:00');
  assert.equal(computeHighlightPace('01:35:32', parseDistanceKm('18K')), '5:18 /km');
});

test('buildRunnerDirectory groups multi-race runner participations with per-race bibs, results, and duo partners', () => {
  const races: Race[] = [
    {
      id: 'race_manila',
      name: 'Manila Dawn Half Marathon',
      date: '2026-11-14',
      waveStartTimes: { '21K': '2026-11-14T05:00:00' },
      checkpoints: [],
      ageCategories: [],
      distances: [
        { id: 'd21', km: 21, label: '21K', price: 1500 },
        { id: 'd10', km: 10, label: '10K', price: 900 },
      ],
      inclusions: [],
      createdBy: 'admin1',
      createdAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'race_sierra',
      name: 'Sierra Madre Trail 18K',
      date: '2026-11-01',
      waveStartTimes: { '18K': '2026-11-01T05:00:00' },
      checkpoints: [],
      ageCategories: [],
      distances: [{ id: 'd18', km: 18, label: '18K', price: 1200 }],
      inclusions: [],
      createdBy: 'admin1',
      createdAt: '2026-10-15T00:00:00Z',
    },
    {
      id: 'race_clark',
      name: 'Clark Sunset Run',
      date: '2026-09-20',
      checkpoints: [],
      ageCategories: [],
      distances: [{ id: 'd10', km: 10, label: '10K', price: 850 }],
      inclusions: [],
      createdBy: 'admin1',
      createdAt: '2026-08-01T00:00:00Z',
    },
    {
      id: 'race_upcoming',
      name: 'Cebu Coastal Challenge',
      date: '2026-12-10',
      checkpoints: [],
      ageCategories: [],
      distances: [{ id: 'd5', km: 5, label: '5K', price: 650 }],
      inclusions: [],
      createdBy: 'admin1',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];

  const runners: RunnerProfile[] = [
    {
      uid: 'user_marky',
      raceId: 'race_manila',
      fullName: 'Marky Liandres',
      bibNumber: '21-014',
      distance: '21K',
      gender: 'male',
      age: 26,
      createdAt: '2026-10-15T00:00:00Z',
    },
    {
      uid: 'import_marky_clark',
      raceId: 'race_clark',
      fullName: 'marky liandres',
      bibNumber: '10-088',
      distance: '10K',
      gender: 'male',
      age: 26,
      createdAt: '2026-09-01T00:00:00Z',
    },
    {
      uid: 'user_marky',
      raceId: 'race_upcoming',
      fullName: 'Marky Liandres',
      bibNumber: '5-301',
      distance: '5K',
      gender: 'male',
      age: 26,
      createdAt: '2026-11-10T00:00:00Z',
    },
    {
      uid: 'user_ana',
      raceId: 'race_clark',
      fullName: 'Ana Cruz',
      bibNumber: '10-201',
      distance: '10K',
      entryCategory: 'duo',
      gender: 'female',
      age: 24,
      createdAt: '2026-09-02T00:00:00Z',
    },
    {
      uid: 'user_ben',
      raceId: 'race_clark',
      fullName: 'Ben Reyes',
      bibNumber: '10-202',
      distance: '10K',
      entryCategory: 'duo',
      startsAfterBib: '10-201',
      gender: 'male',
      age: 25,
      createdAt: '2026-09-02T00:00:00Z',
    },
    {
      uid: 'user_elena',
      raceId: 'race_sierra',
      fullName: 'Elena Santos',
      bibNumber: '18-007',
      distance: '18K',
      gender: 'female',
      age: 27,
      createdAt: '2026-10-16T00:00:00Z',
    },
  ];

  const liveResultsByRace: Record<string, PublicLiveResults> = {
    race_manila: {
      raceId: 'race_manila',
      raceName: 'Manila Dawn Half Marathon',
      updatedAt: '2026-11-14T08:00:00Z',
      status: 'completed',
      totalRegistered: 100,
      totalStarted: 98,
      totalFinished: 95,
      leaders: [],
      officialResults: [
        {
          bibNumber: '21-014',
          fullName: 'Marky Liandres',
          distance: '21K',
          rank: 1,
          overallRank: 1,
          chipTime: '01:24:1834210',
          gunTime: '01:24:4500000',
          finishTime: '01:24:1834210',
        },
        {
          bibNumber: '10-999',
          fullName: 'Solo Leader Only',
          distance: '10K',
          rank: 3,
          overallRank: 3,
          chipTime: '00:42:0000000',
          gunTime: '00:42:1000000',
          finishTime: '00:42:0000000',
        },
      ],
    },
  };

  const computedResultsByRace: Record<string, RunnerResult[]> = {
    race_clark: [
      {
        bibNumber: '10-088',
        splits: [],
        rank: 2,
        overallRank: 2,
        chipTime: '00:39:4000000',
        gunTime: '00:39:5200000',
        finishTime: '00:39:4000000',
      },
      {
        bibNumber: '10-201',
        splits: [],
        rank: 4,
        overallRank: 4,
        chipTime: '00:45:0000000',
        finishTime: '00:45:0000000',
      },
      {
        bibNumber: '10-202',
        splits: [],
        rank: 5,
        overallRank: 5,
        chipTime: '00:47:0000000',
        finishTime: '00:47:0000000',
      },
    ],
    race_sierra: [
      {
        bibNumber: '18-007',
        splits: [],
        rank: 1,
        overallRank: 1,
        chipTime: '01:30:1000000',
        gunTime: '01:35:3200000',
        finishTime: '01:35:3200000',
        finishReadAt: '2026-11-01T06:35:32',
      },
    ],
  };

  const dir = buildRunnerDirectory({
    runners,
    races,
    liveResultsByRace,
    computedResultsByRace,
    userPhotosByUid: { user_marky: 'data:image/jpeg;base64,marky' },
  });

  const marky = dir.find((r) => r.key === 'marky liandres');
  assert.ok(marky);
  assert.equal(marky.uid, 'user_marky');
  assert.equal(marky.photoUrl, 'data:image/jpeg;base64,marky');
  assert.equal(marky.entries.length, 3);

  // Sorted newest raceDate first: 2026-12-10, 2026-11-14, 2026-09-20
  assert.deepEqual(
    marky.entries.map((e) => e.raceId),
    ['race_upcoming', 'race_manila', 'race_clark'],
  );

  // Upcoming race (no finish scan yet) still carries bib and distance
  assert.equal(marky.entries[0].bibNumber, '5-301');
  assert.equal(marky.entries[0].distance, '5K');
  assert.equal(marky.entries[0].chipTime, '');

  // Manila Dawn Half Marathon sourced from liveResults + waveStartTimes
  assert.equal(marky.entries[1].bibNumber, '21-014');
  assert.equal(marky.entries[1].placement, '1st');
  assert.equal(marky.entries[1].chipTime, '01:24:45');
  assert.equal(marky.entries[1].gunTime, '05:00:00');
  assert.equal(marky.entries[1].splitPace, '06:24:45');
  assert.equal(marky.entries[1].pace, '4:02 /km');
  assert.equal(marky.entries[1].raceCode, 'MAN-DAW-HAL-2026');

  // Clark Sunset Run sourced from computedResultsByRace (no wave start fallback)
  assert.equal(marky.entries[2].bibNumber, '10-088');
  assert.equal(marky.entries[2].placement, '2nd');
  assert.equal(marky.entries[2].chipTime, '00:39:52');
  assert.equal(marky.entries[2].gunTime, '00:00:00');
  assert.equal(marky.entries[2].splitPace, '00:39:52');
  assert.equal(marky.entries[2].pace, '3:59 /km');

  // 18K Trail Race sourced from computedResultsByRace with finishReadAt and waveStartTimes
  const elena = dir.find((r) => r.key === 'elena santos');
  assert.ok(elena);
  assert.equal(elena.entries[0].bibNumber, '18-007');
  assert.equal(elena.entries[0].distance, '18K');
  assert.equal(elena.entries[0].placement, '1st');
  assert.equal(elena.entries[0].gunTime, '05:00:00');
  assert.equal(elena.entries[0].splitPace, '06:35:32');
  assert.equal(elena.entries[0].chipTime, '01:35:32');
  assert.equal(elena.entries[0].pace, '5:18 /km');

  // Duo partner detection via startsAfterBib
  const ana = dir.find((r) => r.key === 'ana cruz');
  assert.ok(ana);
  assert.equal(ana.entries[0].entryCategory, 'duo');
  assert.equal(ana.entries[0].partnerName, 'Ben Reyes');
  assert.equal(ana.entries[0].partnerBibNumber, '10-202');
  assert.equal(ana.entries[0].partnerSplitTime, '00:47:00');
  assert.equal(ana.entries[0].combinedAvgPace, '4:36 /km');

  // Fallback liveResults-only runner
  const solo = dir.find((r) => r.key === 'solo leader only');
  assert.ok(solo);
  assert.equal(solo.entries[0].bibNumber, '10-999');
  assert.equal(solo.entries[0].placement, '3rd');
});
