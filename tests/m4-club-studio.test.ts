import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as clubClient from '../src/lib/clubs/client';
import * as clubDraft from '../src/lib/clubs/studioDraft';
import * as clubFixtures from '../src/lib/clubs/e2eFixtures';
import type { ClubDefinition, ClubRequestRecord } from '../src/lib/clubs/types';
import type { ContentReportRecord, SocialPostRecord } from '../src/lib/social/types';

test('validateClubAssetUploadFile accepts <8MB PNG/JPEG/WebP/AVIF and rejects SVG, 0B, >=8MB, and MIME mismatches', () => {
  const valid = clubClient.validateClubAssetUploadFile({
    name: 'Manila Pacers Logo!.webp',
    type: 'image/webp',
    size: 512_000,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.match(valid.safeFilename, /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.webp$/);
    assert.equal(valid.contentType, 'image/webp');
  }

  const svgRejected = clubClient.validateClubAssetUploadFile({
    name: 'crest.svg',
    type: 'image/svg+xml',
    size: 1200,
  });
  assert.equal(svgRejected.ok, false);

  const tooBig = clubClient.validateClubAssetUploadFile({
    name: 'banner.png',
    type: 'image/png',
    size: 8 * 1024 * 1024,
  });
  assert.equal(tooBig.ok, false);

  const emptyFile = clubClient.validateClubAssetUploadFile({
    name: 'logo.jpg',
    type: 'image/jpeg',
    size: 0,
  });
  assert.equal(emptyFile.ok, false);

  const mismatch = clubClient.validateClubAssetUploadFile({
    name: 'logo.png',
    type: 'image/jpeg',
    size: 2048,
  });
  assert.equal(mismatch.ok, false);

  const path = clubClient.buildClubAssetStoragePath('u_admin', 'manila_pacers', 'logo_crest.png');
  assert.equal(path, 'club-assets/u_admin/manila_pacers/logo_crest.png');
  assert.equal(clubClient.isValidClubAssetStoragePath(path, 'manila_pacers'), true);
  assert.equal(clubClient.isValidClubAssetStoragePath('club-assets/../evil.png', 'manila_pacers'), false);
});

test('studioDraft helpers build, convert, preview, normalize, and validate Club Studio drafts cleanly', () => {
  const blank = clubDraft.createBlankClubDraft();
  assert.equal(blank.joinPolicy, 'open');
  assert.equal(blank.billingTier, 'free');
  assert.equal(blank.billingProvider, 'admin_manual');
  assert.equal(blank.modules.chat, true);
  assert.equal(blank.modules.routeLibrary, false);

  const req: ClubRequestRecord = {
    requestId: 'cr_bgc_striders',
    requesterUid: 'u_req_1',
    clubName: 'BGC Tempo Crew',
    city: 'Taguig',
    scheduleSummary: 'Thu 06:00 PM PHT',
    notes: 'Interval sessions at High Street',
    contactHandle: '@bgctempo',
    desiredModules: {
      chat: true,
      leaderboard: true,
      events: true,
      badges: true,
      routeLibrary: true,
      announcements: true,
      memberSpotlight: true,
      customTheme: true,
    },
    status: 'pending',
    createdAt: '2026-11-25T02:00:00.000Z',
    updatedAt: '2026-11-25T02:00:00.000Z',
  };

  const fromReq = clubDraft.clubRequestToDraft(req);
  assert.equal(fromReq.clubId, 'bgc_tempo_crew');
  assert.equal(fromReq.name, 'BGC Tempo Crew');
  assert.equal(fromReq.city, 'Taguig');
  assert.deepEqual(fromReq.captainUids, ['u_req_1']);
  assert.equal(fromReq.modules.routeLibrary, true);

  const validDraft = {
    ...fromReq,
    description: 'Guided track and road sessions across BGC.',
    primaryColor: '#abc',
    accentColor: '#f59e0b',
    memberLimit: '250',
    billingTier: 'community' as const,
  };
  const validRes = clubDraft.validateAndBuildClubSavePayload(validDraft);
  assert.equal(validRes.ok, true);
  if (validRes.ok) {
    assert.equal(validRes.payload.primaryColor, '#AABBCC');
    assert.equal(validRes.payload.accentColor, '#F59E0B');
    assert.equal(validRes.payload.memberLimit, 250);
    assert.equal(validRes.payload.modules.memberSpotlight, true);
    assert.equal(validRes.payload.billingTier, 'community');
  }

  const preview = clubDraft.draftToPreviewClub(validDraft, 'u_admin');
  assert.equal(preview.clubId, 'bgc_tempo_crew');
  assert.equal(preview.primaryColor, '#AABBCC');

  const roundTrip = clubDraft.clubDefinitionToDraft(preview as ClubDefinition);
  assert.equal(roundTrip.clubId, 'bgc_tempo_crew');
  assert.equal(roundTrip.memberLimit, '250');

  const invalidRes = clubDraft.validateAndBuildClubSavePayload({
    ...blank,
    clubId: 'a',
    name: 'X',
    description: '',
    city: '',
    primaryColor: '#GG0000',
    accentColor: 'red',
    memberLimit: '1',
  });
  assert.equal(invalidRes.ok, false);
  if (!invalidRes.ok) {
    assert.ok(invalidRes.fieldErrors.clubId);
    assert.ok(invalidRes.fieldErrors.name);
    assert.ok(invalidRes.fieldErrors.description);
    assert.ok(invalidRes.fieldErrors.city);
    assert.ok(invalidRes.fieldErrors.primaryColor);
    assert.ok(invalidRes.fieldErrors.accentColor);
    assert.ok(invalidRes.fieldErrors.memberLimit);
  }
});

test('club e2eFixtures persist deterministic club studio, request approval, and moderation actions in sessionStorage', () => {
  const mem = new Map<string, string>();
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
  };

  try {
    const draft = clubDraft.createBlankClubDraft();
    const saveRes = clubFixtures.saveDevClubFixture(
      [],
      {
        ...draft,
        clubId: 'makati_striders',
        name: 'Makati Striders',
        description: 'Ayala Triangle Sunday tempo crew.',
        city: 'Makati',
        scheduleSummary: 'Sun 05:30 AM PHT',
        captainUids: ['e2e-runner'],
      },
      'e2e-admin',
      '2026-11-25T08:00:00.000Z',
    );
    assert.equal(saveRes.clubs.length, 1);
    assert.equal(saveRes.clubs[0].memberCount, 1);
    assert.equal(
      clubFixtures.readDevSessionJson<ClubDefinition>(clubFixtures.E2E_CLUBS_KEY)?.length,
      1,
    );

    const archived = clubFixtures.archiveDevClubFixture(
      saveRes.clubs,
      'makati_striders',
      'archived',
      '2026-11-25T08:01:00.000Z',
    );
    assert.equal(archived[0].status, 'archived');

    const reqSeed: ClubRequestRecord = {
      requestId: 'cr_up_oval',
      requesterUid: 'e2e-runner-2',
      clubName: 'UP Oval Mileage',
      city: 'Quezon City',
      scheduleSummary: 'Tue 06:00 PM PHT',
      notes: 'Evening track laps',
      contactHandle: '@upoval',
      desiredModules: {
        chat: true,
        leaderboard: true,
        events: true,
        badges: false,
        routeLibrary: false,
        announcements: true,
        memberSpotlight: false,
        customTheme: true,
      },
      status: 'pending',
      createdAt: '2026-11-25T07:00:00.000Z',
      updatedAt: '2026-11-25T07:00:00.000Z',
    };

    const resolvedReq = clubFixtures.resolveDevClubRequestFixture(
      [reqSeed],
      archived,
      {
        clubRequestId: 'cr_up_oval',
        decision: 'approved',
        reviewNote: 'Approved for QC launch.',
        actorUid: 'e2e-admin',
        clubPayload: {
          ...clubDraft.clubRequestToDraft(reqSeed),
          description: 'Diliman Oval paced intervals.',
        },
        nowIso: '2026-11-25T08:05:00.000Z',
      },
    );
    assert.equal(resolvedReq.requests[0].status, 'approved');
    assert.equal(resolvedReq.clubs.length, 2);

    const reportSeed: ContentReportRecord = {
      reportId: 'rep_post_spam',
      reporterUid: 'e2e-runner',
      targetType: 'post',
      targetId: 'post_flagged_1',
      targetUid: 'e2e-bad-actor',
      reason: 'spam',
      details: 'Repeated commercial links',
      status: 'open',
      createdAt: '2026-11-25T07:30:00.000Z',
      updatedAt: '2026-11-25T07:30:00.000Z',
    };
    const postSeed: SocialPostRecord = {
      postId: 'post_flagged_1',
      uid: 'e2e-bad-actor',
      visibility: 'public',
      text: 'Spam link here',
      mediaType: 'none',
      mediaItems: [],
      attachedBadgeId: null,
      attachedClubId: null,
      attachedRaceId: null,
      attachedRunId: null,
      location: null,
      repostOfPostId: null,
      kudosCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      createdAt: '2026-11-25T07:00:00.000Z',
      updatedAt: '2026-11-25T07:00:00.000Z',
      deletedAt: null,
    };

    const modRes = clubFixtures.resolveDevContentReportFixture(
      [reportSeed],
      [postSeed],
      {
        reportId: 'rep_post_spam',
        action: 'delete_content',
        actorUid: 'e2e-admin',
        resolutionNote: 'Removed spam post.',
        nowIso: '2026-11-25T08:10:00.000Z',
      },
    );
    assert.equal(modRes.reports[0].status, 'action_taken');
    assert.ok(modRes.posts[0].deletedAt);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }
});
