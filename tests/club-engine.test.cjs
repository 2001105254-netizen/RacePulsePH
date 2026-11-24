'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const clubEngine = require('../functions/club-engine');

const {
  CLUB_MODULES,
  CLUB_JOIN_POLICIES,
  CLUB_BILLING_TIERS,
  CLUB_SUBSCRIPTION_STATUSES,
  CLUB_BILLING_PROVIDERS,
  ALLOWED_CLUB_ASSET_PATH_RE,
  slugifyClubId,
  normalizeClubModules,
  validateClubAssetUrl,
  validateClubDefinitionInput,
  validateClubMeetupInput,
  validateClubAnnouncementInput,
  validateClubSpotlightInput,
  validateClubRequestInput,
  computeClubLeaderboard,
} = clubEngine;

function makeValidClubInput(overrides = {}) {
  return {
    clubId: 'bgc_striders_ph',
    name: 'BGC Striders PH',
    description: 'Early morning tempo and long run community around Bonifacio Global City.',
    city: 'Taguig, Metro Manila',
    scheduleSummary: 'Tue/Thu 5:30 AM, Sun 5:00 AM PHT',
    joinPolicy: 'open',
    modules: {
      chat: true,
      leaderboard: true,
      events: true,
      badges: true,
      routeLibrary: true,
      announcements: true,
      memberSpotlight: true,
      customTheme: true,
    },
    primaryColor: '#dc2626',
    accentColor: '#f59e0b',
    logoUrl: '',
    logoStoragePath: '',
    coverUrl: '',
    coverStoragePath: '',
    captainUids: ['captain_1'],
    linkedBadgeIds: ['welcome_ka_racepulse'],
    featuredRouteIds: ['bgc_5k_loop'],
    linkedRaceIds: ['manila_half_2026'],
    memberLimit: 500,
    billingTier: 'community',
    subscriptionStatus: 'active',
    billingProvider: 'admin_manual',
    status: 'active',
    ...overrides,
  };
}

test('slugifyClubId builds safe lowercase IDs and enforces character/length bounds', () => {
  assert.equal(slugifyClubId('BGC Striders PH!'), 'bgc_striders_ph');
  assert.equal(slugifyClubId('   UP Oval Track — Dawn Pacers  '), 'up_oval_track_dawn_pacers');
  assert.equal(slugifyClubId('___'), 'club');
});

test('validateClubDefinitionInput enforces all 8 modular features, hex colors, billing metadata, and caps', () => {
  assert.equal(CLUB_MODULES.length, 8);
  assert.deepEqual(CLUB_JOIN_POLICIES, ['open', 'approval', 'invite_only']);
  assert.deepEqual(CLUB_BILLING_TIERS, ['free', 'community', 'pro']);
  assert.deepEqual(CLUB_SUBSCRIPTION_STATUSES, ['active', 'trial', 'past_due', 'canceled']);
  assert.deepEqual(CLUB_BILLING_PROVIDERS, ['admin_manual', 'paymongo']);

  const saved = validateClubDefinitionInput(
    makeValidClubInput(),
    'admin_1',
    '2026-11-25T02:00:00.000Z',
  );
  assert.equal(saved.clubId, 'bgc_striders_ph');
  assert.equal(saved.primaryColor, '#DC2626');
  assert.equal(saved.accentColor, '#F59E0B');
  assert.equal(saved.modules.chat, true);
  assert.equal(saved.modules.customTheme, true);
  assert.equal(saved.billingTier, 'community');
  assert.equal(saved.billingProvider, 'admin_manual');
  assert.equal(saved.createdBy, 'admin_1');
  assert.equal(saved.memberCount, 0);

  const normalizedPartial = normalizeClubModules({ chat: false, leaderboard: false });
  assert.equal(normalizedPartial.chat, false);
  assert.equal(normalizedPartial.leaderboard, false);
  assert.equal(normalizedPartial.events, true);

  assert.throws(() =>
    validateClubDefinitionInput(
      makeValidClubInput({ modules: { nonexistent: true } }),
      'admin_1',
      '2026-11-25T02:00:00.000Z',
    ),
  );
  assert.throws(() =>
    validateClubDefinitionInput(
      makeValidClubInput({ primaryColor: 'not-a-color' }),
      'admin_1',
      '2026-11-25T02:00:00.000Z',
    ),
  );
  assert.throws(() =>
    validateClubDefinitionInput(
      makeValidClubInput({ captainUids: Array.from({ length: 26 }, (_, i) => `cap_${i}`) }),
      'admin_1',
      '2026-11-25T02:00:00.000Z',
    ),
  );
  assert.throws(() =>
    validateClubDefinitionInput(
      makeValidClubInput({ linkedBadgeIds: Array.from({ length: 51 }, (_, i) => `b_${i}`) }),
      'admin_1',
      '2026-11-25T02:00:00.000Z',
    ),
  );
});

test('validateClubAssetUrl allows raster Firebase Storage club-assets and rejects SVG or foreign URLs', () => {
  const validPath = 'club-assets/admin_1/bgc_striders_ph/logo.webp';
  assert.equal(ALLOWED_CLUB_ASSET_PATH_RE.test(validPath), true);

  const validUrl =
    'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/club-assets%2Fadmin_1%2Fbgc_striders_ph%2Flogo.webp?alt=media';
  const checked = validateClubAssetUrl(validUrl, validPath, 'bgc_striders_ph', 'logo');
  assert.equal(checked.storagePath, validPath);
  assert.equal(checked.url, validUrl);

  assert.throws(() =>
    validateClubAssetUrl(
      'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/club-assets%2Fadmin_1%2Fbgc_striders_ph%2Flogo.svg?alt=media',
      'club-assets/admin_1/bgc_striders_ph/logo.svg',
      'bgc_striders_ph',
      'logo',
    ),
  );
  assert.throws(() =>
    validateClubAssetUrl('https://evil.example.com/logo.png', validPath, 'bgc_striders_ph', 'logo'),
  );
  assert.throws(() =>
    validateClubAssetUrl(validUrl, 'club-assets/admin_1/other_club/logo.webp', 'bgc_striders_ph', 'logo'),
  );
});

test('validateClubMeetupInput, announcement, spotlight, and request reject invalid payloads', () => {
  const meetup = validateClubMeetupInput(
    {
      meetupId: 'sun_long_run_1',
      clubId: 'bgc_striders_ph',
      title: 'Sunday Heritage Loop 16K',
      description: 'Easy Zone 2 group pace.',
      startAtIso: '2026-12-06T21:00:00.000Z',
      locationName: 'High Street South Plaza, BGC',
      lat: 14.5504,
      lon: 121.0507,
      distanceLabel: '16K',
      status: 'scheduled',
    },
    'captain_1',
    '2026-11-25T02:00:00.000Z',
  );
  assert.equal(meetup.createdBy, 'captain_1');
  assert.equal(meetup.distanceLabel, '16K');

  const announcement = validateClubAnnouncementInput(
    {
      announcementId: 'ann_1',
      clubId: 'bgc_striders_ph',
      title: 'Singlet Pickup Schedule',
      body: 'Bring your club pass this Thursday after intervals.',
      pinned: true,
    },
    'captain_1',
    '2026-11-25T02:00:00.000Z',
  );
  assert.equal(announcement.pinned, true);

  const spotlight = validateClubSpotlightInput(
    {
      clubId: 'bgc_striders_ph',
      targetUid: 'runner_42',
      headline: 'First Sub-50 10K Pacer',
      note: 'Consistent morning sweeps all month.',
    },
    'captain_1',
    '2026-11-25T02:00:00.000Z',
  );
  assert.equal(spotlight.targetUid, 'runner_42');

  const request = validateClubRequestInput(
    {
      requestId: 'req_makati_1',
      clubName: 'Makati Ayala Pacers',
      city: 'Makati City',
      scheduleSummary: 'Wed/Sat 5:30 AM',
      notes: 'Requesting chat and leaderboard modules.',
      desiredModules: { chat: true, leaderboard: true },
    },
    'runner_1',
    '2026-11-25T02:00:00.000Z',
  );
  assert.equal(request.status, 'pending');
  assert.equal(request.requesterUid, 'runner_1');
});

test('computeClubLeaderboard ranks active members from verified runs with integer metrics', () => {
  const members = [
    { uid: 'r1', clubId: 'bgc', status: 'active', role: 'captain' },
    { uid: 'r2', clubId: 'bgc', status: 'active', role: 'member' },
    { uid: 'r_removed', clubId: 'bgc', status: 'removed', role: 'member' },
  ];
  const runs = [
    { runId: 'run1', uid: 'r1', verificationStatus: 'verified', distanceM: 12000, movingTimeMs: 3600000, elevationGainM: 80, startedAt: '2026-11-24T22:00:00.000Z' },
    { runId: 'run2', uid: 'r2', verificationStatus: 'verified', distanceM: 15000, movingTimeMs: 4200000, elevationGainM: 120, startedAt: '2026-11-25T00:00:00.000Z' },
    { runId: 'run_unverified', uid: 'r1', verificationStatus: 'rejected', distanceM: 50000, movingTimeMs: 5000000, elevationGainM: 0, startedAt: '2026-11-25T01:00:00.000Z' },
    { runId: 'run_rem', uid: 'r_removed', verificationStatus: 'verified', distanceM: 99000, movingTimeMs: 9000000, elevationGainM: 200, startedAt: '2026-11-25T01:00:00.000Z' },
  ];
  const board = computeClubLeaderboard(members, runs, {
    r1: { displayName: 'Ana Reyes', username: 'anareyes' },
    r2: { displayName: 'Ben Cruz', username: 'bencruz' },
  });
  assert.equal(board.length, 2);
  assert.equal(board[0].uid, 'r2');
  assert.equal(board[0].totalDistanceM, 15000);
  assert.equal(board[1].uid, 'r1');
  assert.equal(board[1].totalDistanceM, 12000);
});
