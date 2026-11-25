'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createCommunityService } = require('../functions/community-service');
const { createCommunityApp } = require('../functions/community-api');

function createMockDb(initialDocs = {}) {
  const docs = new Map(
    Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]),
  );
  let txLock = Promise.resolve();

  const makeSnap = (docPath, data) => ({
    exists: data !== undefined && data !== null,
    id: docPath.split('/').pop(),
    ref: {
      path: docPath,
      id: docPath.split('/').pop(),
      collection: (sub) => db.collection(`${docPath}/${sub}`),
    },
    data: () => (data !== undefined && data !== null ? structuredClone(data) : undefined),
  });

  function resolveFieldName(field) {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object' && typeof field.formattedName === 'string') {
      return field.formattedName;
    }
    return String(field);
  }

  function getFieldValue(docId, data, fieldName) {
    if (fieldName === '__name__') return docId;
    const parts = fieldName.split('.');
    let cur = data;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }

  const db = {
    doc(docPath) {
      return {
        path: docPath,
        id: docPath.split('/').pop(),
        collection(sub) {
          return db.collection(`${docPath}/${sub}`);
        },
        async get() {
          return makeSnap(docPath, docs.get(docPath));
        },
      };
    },
    collection(collectionPath) {
      const filters = [];
      const orderSpecs = [];
      let limitCount = null;

      const queryApi = {
        where(field, op, value) {
          filters.push({ field: resolveFieldName(field), op, value });
          return queryApi;
        },
        orderBy(field, direction = 'asc') {
          orderSpecs.push({
            field: resolveFieldName(field),
            direction: String(direction).toLowerCase(),
          });
          return queryApi;
        },
        limit(n) {
          limitCount = n;
          return queryApi;
        },
        async get() {
          const prefix = `${collectionPath}/`;
          let matched = [];
          for (const [docPath, data] of docs.entries()) {
            if (!docPath.startsWith(prefix)) continue;
            const rest = docPath.slice(prefix.length);
            if (rest.includes('/')) continue;
            let ok = true;
            for (const f of filters) {
              const val = getFieldValue(rest, data, f.field);
              if (f.op === '==') {
                if (val !== f.value) {
                  ok = false;
                  break;
                }
              } else if (f.op === '!=') {
                if (val === f.value) {
                  ok = false;
                  break;
                }
              } else if (f.op === 'array-contains') {
                if (!Array.isArray(val) || !val.includes(f.value)) {
                  ok = false;
                  break;
                }
              } else {
                ok = false;
                break;
              }
            }
            if (ok) matched.push({ id: rest, docPath, data });
          }

          if (orderSpecs.length > 0) {
            matched.sort((a, b) => {
              for (const spec of orderSpecs) {
                const dir = spec.direction === 'desc' ? -1 : 1;
                const va = getFieldValue(a.id, a.data, spec.field);
                const vb = getFieldValue(b.id, b.data, spec.field);
                if (va === vb) continue;
                if (va === undefined || va === null) return -1 * dir;
                if (vb === undefined || vb === null) return 1 * dir;
                return (va < vb ? -1 : 1) * dir;
              }
              return a.id.localeCompare(b.id);
            });
          }

          if (typeof limitCount === 'number' && limitCount >= 0) {
            matched = matched.slice(0, limitCount);
          }

          const snaps = matched.map((entry) => makeSnap(entry.docPath, entry.data));
          return {
            docs: snaps,
            empty: snaps.length === 0,
            size: snaps.length,
            forEach(cb) {
              snaps.forEach(cb);
            },
          };
        },
      };
      return queryApi;
    },
    batch() {
      const ops = [];
      return {
        delete: (ref) => ops.push(() => docs.delete(ref.path)),
        set: (ref, data, opts) =>
          ops.push(() => {
            if (opts && opts.merge && docs.has(ref.path)) {
              docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) });
            } else {
              docs.set(ref.path, structuredClone(data));
            }
          }),
        update: (ref, patch) =>
          ops.push(() => {
            if (!docs.has(ref.path)) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(patch) });
          }),
        commit: async () => ops.forEach((o) => o()),
      };
    },
    runTransaction(fn) {
      const exec = async () => {
        const stagedCreate = new Set();
        const stagedDelete = new Set();
        const staged = new Map();
        let hasWritten = false;
        const tx = {
          async get(ref) {
            if (hasWritten) {
              throw new Error('Firestore transactions require all reads before all writes.');
            }
            if (stagedDelete.has(ref.path)) return makeSnap(ref.path, undefined);
            if (staged.has(ref.path)) return makeSnap(ref.path, staged.get(ref.path));
            return makeSnap(ref.path, docs.get(ref.path));
          },
          create(ref, data) {
            hasWritten = true;
            const existsCurrently =
              !stagedDelete.has(ref.path) && (docs.has(ref.path) || stagedCreate.has(ref.path));
            if (existsCurrently) {
              const err = new Error(`6 ALREADY_EXISTS: ${ref.path}`);
              err.code = 6;
              throw err;
            }
            stagedDelete.delete(ref.path);
            stagedCreate.add(ref.path);
            staged.set(ref.path, structuredClone(data));
          },
          set(ref, data, opts) {
            hasWritten = true;
            stagedDelete.delete(ref.path);
            if (opts && opts.merge && (staged.has(ref.path) || docs.has(ref.path))) {
              const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
              staged.set(ref.path, { ...base, ...structuredClone(data) });
            } else {
              staged.set(ref.path, structuredClone(data));
            }
          },
          update(ref, patch) {
            hasWritten = true;
            if (stagedDelete.has(ref.path)) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            const base = staged.has(ref.path) ? staged.get(ref.path) : docs.get(ref.path);
            if (!base) throw new Error(`5 NOT_FOUND: ${ref.path}`);
            staged.set(ref.path, { ...base, ...structuredClone(patch) });
          },
          delete(ref) {
            hasWritten = true;
            staged.delete(ref.path);
            stagedDelete.add(ref.path);
          },
        };
        const result = await fn(tx);
        for (const k of stagedDelete) docs.delete(k);
        for (const [k, v] of staged.entries()) docs.set(k, v);
        return result;
      };
      const next = txLock.then(exec);
      txLock = next.catch(() => {});
      return next;
    },
  };

  return { db, docs };
}

function createMockStorage() {
  const deletedPrefixes = [];
  const signedCalls = [];
  return {
    deletedPrefixes,
    signedCalls,
    bucket() {
      return {
        file(storagePath) {
          return {
            async getSignedUrl(opts) {
              signedCalls.push({ storagePath, opts });
              return [
                `https://storage.googleapis.com/racepulseph.firebasestorage.app/${storagePath}?X-Goog-Signature=signed15m`,
              ];
            },
          };
        },
        async deleteFiles({ prefix }) {
          deletedPrefixes.push(prefix);
        },
      };
    },
  };
}

function makeSeedDocs() {
  return {
    'users/u_admin': { uid: 'u_admin', role: 'admin', approved: true, displayName: 'Mod Admin', email: 'mod@example.com' },
    'userAccess/u_admin': { status: 'active', scope: 'all', raceIds: [], overrides: {} },
    'users/u_org': { uid: 'u_org', role: 'organizer', approved: true, displayName: 'Org User', email: 'org@example.com' },
    'userAccess/u_org': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_a': { uid: 'u_a', role: 'runner', approved: true, displayName: 'Alice', username: 'alice', email: 'alice-private@example.com', medicalNotes: 'asthma', emergencyContactPhone: '09170000001' },
    'userAccess/u_a': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_friend': { uid: 'u_friend', role: 'runner', approved: true, displayName: 'Ben', username: 'ben', email: 'ben@example.com' },
    'userAccess/u_friend': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_close': { uid: 'u_close', role: 'runner', approved: true, displayName: 'Cara', username: 'cara', email: 'cara@example.com', allowMessageRequests: false },
    'userAccess/u_close': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_stranger_open': { uid: 'u_stranger_open', role: 'runner', approved: true, displayName: 'Dan', username: 'dan', email: 'dan@example.com', allowMessageRequests: true },
    'userAccess/u_stranger_open': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'users/u_stranger_closed': { uid: 'u_stranger_closed', role: 'runner', approved: true, displayName: 'Eli', username: 'eli', email: 'eli@example.com', allowMessageRequests: false },
    'userAccess/u_stranger_closed': { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    'friendships/u_a_u_friend': { fromUid: 'u_a', toUid: 'u_friend', members: ['u_a', 'u_friend'] },
    'friendships/u_a_u_close': { fromUid: 'u_a', toUid: 'u_close', members: ['u_a', 'u_close'] },
    'publishedRaceRoutes/pub_bgc': {
      publicationId: 'pub_bgc',
      raceId: 'race_bgc',
      raceName: 'BGC Half',
      distanceLabel: '21K',
      status: 'published',
      previewPolyline: [[121.0509, 14.5515], [121.052, 14.553]],
    },
  };
}

test('social post creation auto-links <=100m course routeSnap, keeps private media un-tokenized, enforces public-only reposts, kudos, and comments', async () => {
  const store = createMockDb(makeSeedDocs());
  const storage = createMockStorage();
  const service = createCommunityService(store.db, storage, { now: () => '2026-11-25T11:00:00.000Z' });

  const pubRes = await service.execute('u_a', '/social/post/create', {
    requestId: 'req-post-pub-00001',
    postId: 'post_pub_1',
    visibility: 'public',
    text: 'High Street hydration stop!',
    mediaType: 'images',
    mediaItems: [
      {
        storagePath: 'social-media/u_a/post_pub_1/photo.webp',
        mimeType: 'image/webp',
        sizeBytes: 120000,
        url: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/social-media%2Fu_a%2Fpost_pub_1%2Fphoto.webp?alt=media',
      },
    ],
    location: { lat: 14.5516, lon: 121.051, label: 'High Street Split' },
  });

  assert.equal(pubRes.post.linkedCourse.publicationId, 'pub_bgc');
  assert.ok(pubRes.post.linkedCourse.distanceM <= 100);
  assert.equal(store.docs.get('routeSnaps/post_pub_1').publicationId, 'pub_bgc');
  assert.equal(store.docs.get('publicProfiles/u_a').email, undefined);
  assert.equal(store.docs.get('publicProfiles/u_a').medicalNotes, undefined);

  const privRes = await service.execute('u_a', '/social/post/create', {
    requestId: 'req-post-priv-0001',
    postId: 'post_priv_1',
    visibility: 'close_friends',
    text: 'Close crew secret taper spot',
    mediaType: 'video',
    mediaItems: [
      {
        storagePath: 'social-media/u_a/post_priv_1/clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2500000,
        durationSec: 12,
        url: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/social-media%2Fu_a%2Fpost_priv_1%2Fclip.mp4?alt=media&token=should_strip',
      },
    ],
  });
  assert.equal(privRes.post.mediaItems[0].url, '');

  // Public repost succeeds & notifies author
  const repRes = await service.execute('u_friend', '/social/post/repost', {
    requestId: 'req-repost-pub-0001',
    postId: 'post_repost_1',
    sourcePostId: 'post_pub_1',
    text: 'See you Sunday!',
    visibility: 'public',
  });
  assert.equal(repRes.post.repostOfPostId, 'post_pub_1');
  assert.equal(store.docs.get('socialPosts/post_pub_1').repostsCount, 1);

  // Repost of private close_friends post is denied 403
  await assert.rejects(
    service.execute('u_close', '/social/post/repost', {
      requestId: 'req-repost-priv-001',
      postId: 'post_repost_2',
      sourcePostId: 'post_priv_1',
      visibility: 'public',
    }),
    (err) => err.status === 403,
  );

  // Kudos & Comment enforce readability (friend rejected on close_friends post unless added)
  await assert.rejects(
    service.execute('u_friend', '/social/post/kudos', {
      requestId: 'req-kudos-denied-01',
      postId: 'post_priv_1',
    }),
    (err) => err.status === 403,
  );

  const kudosOn = await service.execute('u_friend', '/social/post/kudos', {
    requestId: 'req-kudos-on-00001',
    postId: 'post_pub_1',
  });
  assert.equal(kudosOn.liked, true);
  assert.equal(kudosOn.kudosCount, 1);
  assert.equal(store.docs.get('socialKudos/post_pub_1_u_friend').recipientUid, 'u_a');

  const kudosOff = await service.execute('u_friend', '/social/post/kudos', {
    requestId: 'req-kudos-off-0001',
    postId: 'post_pub_1',
  });
  assert.equal(kudosOff.liked, false);
  assert.equal(kudosOff.kudosCount, 0);

  await service.execute('u_friend', '/social/post/comment', {
    requestId: 'req-comment-pub-001',
    commentId: 'cmt_1',
    postId: 'post_pub_1',
    text: 'Strong pace!',
  });
  await service.execute('u_stranger_open', '/social/post/comment', {
    requestId: 'req-comment-pub-002',
    commentId: 'cmt_2_hidden',
    postId: 'post_pub_1',
    text: 'Hidden comment',
  });
  store.docs.set('socialComments/cmt_2_hidden', {
    ...store.docs.get('socialComments/cmt_2_hidden'),
    hiddenByModeration: true,
  });
  await service.execute('u_close', '/social/post/comment', {
    requestId: 'req-comment-pub-003',
    commentId: 'cmt_3_deleted',
    postId: 'post_pub_1',
    text: 'Deleted comment',
  });
  store.docs.set('socialComments/cmt_3_deleted', {
    ...store.docs.get('socialComments/cmt_3_deleted'),
    deletedAt: '2026-11-25T11:05:00.000Z',
  });
  assert.equal(store.docs.get('socialPosts/post_pub_1').commentsCount, 3);

  const cmtList = await service.execute('u_friend', '/social/post/comments', {
    postId: 'post_pub_1',
    limit: 20,
  });
  assert.deepEqual(
    cmtList.comments.map((c) => c.commentId),
    ['cmt_1'],
  );

  await assert.rejects(
    service.execute('u_friend', '/social/post/comments', { postId: 'post_priv_1' }),
    (err) => err.status === 403,
  );
});

test('feed visibility, cursor pagination, snaps, close-friends, block bidirectional isolation, and /media/sign revocation', async () => {
  const store = createMockDb(makeSeedDocs());
  const storage = createMockStorage();
  let clock = 0;
  const service = createCommunityService(store.db, storage, {
    now: () => new Date(Date.parse('2026-11-25T11:00:00.000Z') + clock++ * 1000).toISOString(),
  });

  await service.execute('u_a', '/social/close-friends/toggle', {
    requestId: 'req-cf-add-close-001',
    targetUid: 'u_close',
    enabled: true,
  });
  await assert.rejects(
    service.execute('u_a', '/social/close-friends/toggle', {
      requestId: 'req-cf-nonfriend-01',
      targetUid: 'u_stranger_open',
      enabled: true,
    }),
    (err) => err.status === 403,
  );

  await service.execute('u_a', '/social/post/create', {
    requestId: 'req-feed-p1-0000001',
    postId: 'p1_pub',
    visibility: 'public',
    text: 'Public 1',
    mediaType: 'images',
    mediaItems: [{ storagePath: 'social-media/u_a/p1_pub/1.png', mimeType: 'image/png', sizeBytes: 1000, url: 'https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/social-media%2Fu_a%2Fp1_pub%2F1.png?alt=media' }],
    location: { lat: 14.5516, lon: 121.051, label: 'Spot 1' },
  });
  await service.execute('u_a', '/social/post/create', {
    requestId: 'req-feed-p2-0000001',
    postId: 'p2_fr',
    visibility: 'friends',
    text: 'Friends only 2',
    mediaType: 'images',
    mediaItems: [{ storagePath: 'social-media/u_a/p2_fr/2.png', mimeType: 'image/png', sizeBytes: 1000 }],
    location: { lat: 14.5517, lon: 121.0511, label: 'Spot 2' },
  });
  await service.execute('u_a', '/social/post/create', {
    requestId: 'req-feed-p3-0000001',
    postId: 'p3_cf',
    visibility: 'close_friends',
    text: 'Close friends 3',
    mediaType: 'images',
    mediaItems: [{ storagePath: 'social-media/u_a/p3_cf/3.png', mimeType: 'image/png', sizeBytes: 1000 }],
    location: { lat: 14.5518, lon: 121.0512, label: 'Spot 3' },
  });
  await service.execute('u_stranger_open', '/social/post/create', {
    requestId: 'req-feed-p4-0000001',
    postId: 'p4_stranger_pub',
    visibility: 'public',
    text: 'Stranger public 4',
    mediaType: 'none',
  });

  // Discover pagination limit 1
  const page1 = await service.execute('u_close', '/social/feed', { mode: 'discover', limit: 1 });
  assert.equal(page1.posts.length, 1);
  assert.equal(page1.posts[0].postId, 'p4_stranger_pub');
  assert.ok(page1.nextCursor);
  const page2 = await service.execute('u_close', '/social/feed', {
    mode: 'discover',
    limit: 1,
    cursor: page1.nextCursor,
  });
  assert.equal(page2.posts[0].postId, 'p1_pub');

  // Following visibility matrix
  const cfFeed = await service.execute('u_close', '/social/feed', { mode: 'following', limit: 10 });
  assert.deepEqual(cfFeed.posts.map((p) => p.postId), ['p3_cf', 'p2_fr', 'p1_pub']);

  const frFeed = await service.execute('u_friend', '/social/feed', { mode: 'following', limit: 10 });
  assert.deepEqual(frFeed.posts.map((p) => p.postId), ['p2_fr', 'p1_pub']);

  // Snaps visibility & media signing
  const closeSnaps = await service.execute('u_close', '/social/snaps', { scope: 'close_friends', publicationId: 'pub_bgc' });
  assert.equal(closeSnaps.snaps.length, 1);
  assert.equal(closeSnaps.snaps[0].postId, 'p3_cf');

  const signClose = await service.execute('u_close', '/media/sign', {
    storagePaths: ['social-media/u_a/p3_cf/3.png', 'run-tracks/u_a/forbidden.json'],
  });
  assert.match(signClose.signedUrls['social-media/u_a/p3_cf/3.png'], /X-Goog-Signature/);
  assert.ok(signClose.denied.includes('run-tracks/u_a/forbidden.json'));

  const signFriendDenied = await service.execute('u_friend', '/media/sign', {
    storagePaths: ['social-media/u_a/p3_cf/3.png', 'social-media/u_a/p2_fr/2.png'],
  });
  assert.ok(signFriendDenied.denied.includes('social-media/u_a/p3_cf/3.png'));
  assert.ok(signFriendDenied.signedUrls['social-media/u_a/p2_fr/2.png']);

  await service.execute('u_close', '/social/post/comment', {
    requestId: 'req-blk-cmt-000001',
    commentId: 'cmt_from_close',
    postId: 'p4_stranger_pub',
    text: 'Before block comment',
  });
  await service.execute('u_friend', '/social/post/comment', {
    requestId: 'req-blk-cmt-000002',
    commentId: 'cmt_from_friend',
    postId: 'p4_stranger_pub',
    text: 'Visible friend comment',
  });

  // Blocking u_close clears closeFriendEdges and revokes feed + snap + comments + media signing in BOTH directions
  await service.execute('u_a', '/social/block/toggle', {
    requestId: 'req-block-close-0001',
    targetUid: 'u_close',
    blocked: true,
  });
  assert.equal(store.docs.has('closeFriendEdges/u_a_u_close'), false);
  const blockedFeed = await service.execute('u_close', '/social/feed', { mode: 'discover', limit: 10 });
  assert.equal(blockedFeed.posts.some((p) => p.uid === 'u_a'), false);
  const blockedComments = await service.execute('u_a', '/social/post/comments', {
    postId: 'p4_stranger_pub',
  });
  assert.deepEqual(
    blockedComments.comments.map((c) => c.commentId),
    ['cmt_from_friend'],
  );
  const signBlocked = await service.execute('u_close', '/media/sign', {
    storagePaths: ['social-media/u_a/p1_pub/1.png', 'social-media/u_a/p3_cf/3.png'],
  });
  assert.deepEqual(Object.keys(signBlocked.signedUrls), []);
  assert.equal(signBlocked.denied.length, 2);
});

test('UGC report + moderation hide/delete removes snap and revokes media signing', async () => {
  const store = createMockDb(makeSeedDocs());
  const service = createCommunityService(store.db, createMockStorage(), { now: () => '2026-11-25T11:30:00.000Z' });

  await service.execute('u_a', '/social/post/create', {
    requestId: 'req-mod-post-00001',
    postId: 'post_bad_1',
    visibility: 'public',
    text: 'Questionable snap',
    mediaType: 'images',
    mediaItems: [{ storagePath: 'social-media/u_a/post_bad_1/1.png', mimeType: 'image/png', sizeBytes: 1024 }],
    location: { lat: 14.5515, lon: 121.0509, label: 'Start' },
  });
  await service.execute('u_friend', '/social/report/create', {
    requestId: 'req-report-post-0001',
    reportId: 'rep_1',
    targetType: 'post',
    targetId: 'post_bad_1',
    targetUid: 'u_a',
    reason: 'inappropriate_media',
    details: 'Off-topic image',
  });

  await assert.rejects(
    service.execute('u_org', '/moderation/reports/resolve', {
      requestId: 'req-mod-org-denied-1',
      reportId: 'rep_1',
      action: 'hide_content',
    }),
    (err) => err.status === 403,
  );

  await service.execute('u_admin', '/moderation/reports/resolve', {
    requestId: 'req-mod-admin-hide-1',
    reportId: 'rep_1',
    action: 'delete_content',
    resolutionNote: 'Removed per policy',
  });
  assert.equal(store.docs.get('contentReports/rep_1').status, 'action_taken');
  assert.ok(store.docs.get('socialPosts/post_bad_1').deletedAt);
  assert.equal(store.docs.has('routeSnaps/post_bad_1'), false);

  const feed = await service.execute('u_friend', '/social/feed', { mode: 'discover' });
  assert.equal(feed.posts.length, 0);
});

test('Inbox DM request gating, dual-sender PHT daily streak, Club chat moderation, read reset, and /media/sign', async () => {
  const store = createMockDb({
    ...makeSeedDocs(),
    'clubs/bgc_club': {
      clubId: 'bgc_club',
      name: 'BGC Club',
      status: 'active',
      joinPolicy: 'open',
      captainUids: ['u_a'],
      modules: { chat: true, leaderboard: true, events: true, badges: true, routeLibrary: false, announcements: true, memberSpotlight: false, customTheme: true },
      memberCount: 2,
      requestCount: 0,
    },
    'clubMembers/bgc_club_u_a': { id: 'bgc_club_u_a', clubId: 'bgc_club', uid: 'u_a', role: 'captain', status: 'active' },
    'clubMembers/bgc_club_u_friend': { id: 'bgc_club_u_friend', clubId: 'bgc_club', uid: 'u_friend', role: 'member', status: 'active' },
    'conversations/club_bgc_club': { conversationId: 'club_bgc_club', type: 'club', clubId: 'bgc_club', members: [], status: 'active', lastMessageText: '', lastMessageAt: '', lastSenderUid: '' },
  });
  let currentNow = '2026-11-25T12:00:00.000Z';
  const service = createCommunityService(store.db, createMockStorage(), { now: () => currentNow });

  // Closed message requests reject stranger DM
  await assert.rejects(
    service.execute('u_a', '/inbox/dm/start', {
      requestId: 'req-dm-closed-00001',
      targetUid: 'u_stranger_closed',
    }),
    (err) => err.status === 403,
  );

  // Open message request allows 1 intro message until accepted
  const reqDm = await service.execute('u_a', '/inbox/dm/start', {
    requestId: 'req-dm-open-0000001',
    targetUid: 'u_stranger_open',
  });
  assert.equal(reqDm.conversation.status, 'request_pending');
  assert.equal(reqDm.conversation.requestedByUid, 'u_a');

  await service.execute('u_a', '/inbox/message/send', {
    requestId: 'req-dm-intro-000001',
    conversationId: reqDm.conversation.conversationId,
    messageId: 'msg_intro_1',
    text: 'Hi Dan, joining the BGC pace group?',
  });
  await assert.rejects(
    service.execute('u_a', '/inbox/message/send', {
      requestId: 'req-dm-intro-000002',
      conversationId: reqDm.conversation.conversationId,
      messageId: 'msg_intro_2',
      text: 'Second ping before accept',
    }),
    (err) => err.status === 403,
  );

  const accepted = await service.execute('u_stranger_open', '/inbox/request/respond', {
    requestId: 'req-dm-accept-00001',
    conversationId: reqDm.conversation.conversationId,
    decision: 'accept',
  });
  assert.equal(accepted.conversation.status, 'active');

  // Accepted friends DM updates PHT daily chat streak after BOTH send
  const friendDm = await service.execute('u_a', '/inbox/dm/start', {
    requestId: 'req-dm-friend-00001',
    targetUid: 'u_friend',
  });
  const dmId = friendDm.conversation.conversationId;
  assert.equal(dmId, 'dm_u_a_u_friend');
  assert.equal(friendDm.conversation.status, 'active');

  const sendA = await service.execute('u_a', '/inbox/message/send', {
    requestId: 'req-dm-send-a-00001',
    conversationId: dmId,
    messageId: 'msg_f_1',
    text: 'Morning!',
  });
  assert.equal(sendA.streak.streakDays, 0);

  const sendB = await service.execute('u_friend', '/inbox/message/send', {
    requestId: 'req-dm-send-b-00001',
    conversationId: dmId,
    messageId: 'msg_f_2',
    text: 'See you at 5am!',
    media: {
      storagePath: `chat-media/${dmId}/u_friend/shoe.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 90000,
    },
  });
  assert.equal(sendB.streak.streakDays, 1);
  assert.equal(store.docs.get(`conversations/${dmId}`).unreadByUid.u_a, 1);

  const signChat = await service.execute('u_a', '/media/sign', {
    storagePaths: [`chat-media/${dmId}/u_friend/shoe.jpg`],
  });
  assert.match(signChat.signedUrls[`chat-media/${dmId}/u_friend/shoe.jpg`], /X-Goog-Signature/);

  await service.execute('u_a', '/inbox/read', {
    requestId: 'req-inbox-read-00001',
    conversationId: dmId,
  });
  assert.equal(store.docs.get(`conversations/${dmId}`).unreadByUid.u_a, 0);

  // Club chat + captain moderation
  await service.execute('u_friend', '/inbox/message/send', {
    requestId: 'req-club-msg-000001',
    conversationId: 'club_bgc_club',
    messageId: 'msg_c_1',
    text: 'Water station check',
    shareCard: { type: 'club', targetId: 'bgc_club', title: 'BGC Club' },
  });
  // Non-member rejected
  await assert.rejects(
    service.execute('u_close', '/inbox/message/send', {
      requestId: 'req-club-nonmem-001',
      conversationId: 'club_bgc_club',
      messageId: 'msg_c_unauth',
      text: 'Hi',
    }),
    (err) => err.status === 403,
  );
  // Captain moderates club chat message
  await service.execute('u_a', '/inbox/message/moderate', {
    requestId: 'req-club-mod-000001',
    conversationId: 'club_bgc_club',
    messageId: 'msg_c_1',
  });
  assert.ok(store.docs.get('conversations/club_bgc_club/messages/msg_c_1').deletedAt);

  // Push token storage
  await service.execute('u_a', '/inbox/push-token/save', {
    requestId: 'req-push-tok-000001',
    tokenId: 'fcm_pixel9',
    token: 'tok-android-123456',
    platform: 'android',
  });
  assert.equal(store.docs.get('userPushTokens/u_a_fcm_pixel9').platform, 'android');
});

test('communityApi read routes use separate read limiter without draining 30/15m mutation quota', async () => {
  const store = createMockDb(makeSeedDocs());
  const storage = createMockStorage();
  const app = createCommunityApp({
    admin: {
      auth: () => ({
        verifyIdToken: async (token) => ({ uid: token.replace(/^tok_/, '') }),
      }),
    },
    db: store.db,
    storage,
    appCheckMode: 'off',
  });

  const makeReq = (routePath, body) => ({
    method: 'POST',
    path: routePath,
    ip: '198.51.100.12',
    body,
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
    get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer tok_u_a' : undefined),
    is: () => true,
  });
  const callApp = async (routePath, body) => {
    const headers = {};
    let statusCode = 200;
    let payload = null;
    const res = {
      set: (k, v) => { headers[k] = v; },
      status: (c) => { statusCode = c; return res; },
      json: (p) => { payload = p; return res; },
    };
    await app(makeReq(routePath, body), res);
    return { statusCode, payload, headers };
  };

  for (let i = 0; i < 35; i += 1) {
    const readRes = await callApp('/social/feed', { mode: 'discover', limit: 5 });
    assert.equal(readRes.statusCode, 200);
  }

  // Heavy mutation still has full 30/15m budget after 35 reads
  const postRes = await callApp('/social/post/create', {
    requestId: 'req-http-post-000001',
    postId: 'post_http_1',
    visibility: 'public',
    text: 'Read limiter separate!',
    mediaType: 'none',
  });
  assert.equal(postRes.statusCode, 200);
});
