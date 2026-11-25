'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ADR_THRESHOLDS,
  STORAGE_PREFIX_BUCKETS,
  aggregateShardedRollups,
  classifyStoragePrefix,
  estimateCollectionBytes,
  evaluateAdrTriggers,
  hashPresenceSession,
  phtDateKey,
  recentPhtDateKeys,
  shardIndexForHash,
} = require('../functions/telemetry-engine');

test('phtDateKey and recentPhtDateKeys handle Asia/Manila UTC+8 midnight cleanly', () => {
  // 2026-11-25T16:30:00.000Z == 2026-11-26T00:30:00+08:00 (already next day in PHT)
  const sample = new Date('2026-11-25T16:30:00.000Z');
  assert.equal(phtDateKey(sample), '2026-11-26');

  const beforeMidnight = new Date('2026-11-25T15:59:59.000Z');
  assert.equal(phtDateKey(beforeMidnight), '2026-11-25');

  const series = recentPhtDateKeys(3, sample);
  assert.deepEqual(series, ['2026-11-24', '2026-11-25', '2026-11-26']);
});

test('hashPresenceSession is deterministic 32-hex, strips PII, rotates per PHT day, and maps to 0..9 shard', () => {
  const uid = 'runner_secret_uid_991';
  const dayA = '2026-11-25';
  const dayB = '2026-11-26';
  const h1 = hashPresenceSession(uid, dayA, 'salt-v1');
  const h2 = hashPresenceSession(uid, dayA, 'salt-v1');
  const h3 = hashPresenceSession(uid, dayB, 'salt-v1');

  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{32}$/);
  assert.equal(h1.includes(uid), false);

  const shard = shardIndexForHash(h1, 10);
  assert.equal(Number.isInteger(shard), true);
  assert.equal(shard >= 0 && shard < 10, true);
  assert.equal(shardIndexForHash(h1, 10), shard);
});

test('classifyStoragePrefix maps all RacePulse Storage buckets and falls back safely', () => {
  assert.equal(classifyStoragePrefix('social-media/uid1/post1/img.jpg'), 'social-media');
  assert.equal(classifyStoragePrefix('/chat-media/dm_a_b/uid1/photo.webp'), 'chat-media');
  assert.equal(classifyStoragePrefix('run-tracks/uid1/run1/track.json'), 'run-tracks');
  assert.equal(classifyStoragePrefix('badge-assets/admin1/badge1/crest.png'), 'badge-assets');
  assert.equal(classifyStoragePrefix('club-assets/admin1/club1/logo.jpg'), 'club-assets');
  assert.equal(classifyStoragePrefix('race-assets/org1/race1/poster.png'), 'race-assets');
  assert.equal(classifyStoragePrefix('bib-templates/race1/front.png'), 'race-assets');
  assert.equal(classifyStoragePrefix('bib-fonts/race1/font.woff2'), 'race-assets');
  assert.equal(classifyStoragePrefix('posters/race1/cover.png'), 'race-assets');
  assert.equal(classifyStoragePrefix('highlights/race1/reel.mp4'), 'race-assets');
  assert.equal(classifyStoragePrefix('misc/temp.bin'), 'other');
  assert.equal(classifyStoragePrefix(''), 'other');
  assert.equal(STORAGE_PREFIX_BUCKETS.includes('social-media'), true);
});

test('estimateCollectionBytes computes deterministic raw & 2.5x indexed MB without NaN or negatives', () => {
  const sizing = estimateCollectionBytes({
    users: 1000,
    recordedRuns: 500,
    socialPosts: 200,
    conversations: 50,
    messages: 4000,
    clubs: 25,
    userBadges: 600,
    races: 10,
  });

  assert.equal(sizing.totalDocuments, 1000 + 500 + 200 + 50 + 4000 + 25 + 600 + 10);
  assert.equal(sizing.rawBytes > 0, true);
  assert.equal(sizing.indexedBytes, Math.round(sizing.rawBytes * 2.5));
  assert.equal(Number.isFinite(sizing.rawMb), true);
  assert.equal(Number.isFinite(sizing.indexedMb), true);
  assert.equal(Array.isArray(sizing.collections), true);
  assert.equal(sizing.collections.some((c) => c.collection === 'users' && c.documents === 1000), true);
});

test('aggregateShardedRollups sums 10-shard PHT daily buckets into DAU, WAU, MAU and series', () => {
  const todayKey = '2026-11-26';
  const docs = [
    { dayKey: '2026-11-26', uniqueSessions: 120, heartbeats: 240, authenticatedWrites: 40 },
    { dayKey: '2026-11-26', uniqueSessions: 80, heartbeats: 150, authenticatedWrites: 25 },
    { dayKey: '2026-11-22', uniqueSessions: 150, heartbeats: 300 },
    { dayKey: '2026-11-05', uniqueSessions: 500, heartbeats: 900 },
    { dayKey: '2026-10-01', uniqueSessions: 9999, heartbeats: 9999 }, // outside 30-day window
  ];

  const out = aggregateShardedRollups(docs, todayKey, new Date('2026-11-26T04:00:00.000Z'));
  assert.equal(out.dauToday, 200);
  assert.equal(out.wau7d, 350);
  assert.equal(out.mau30d, 850);
  assert.equal(out.heartbeatsToday, 390);
  assert.equal(out.dailySeries.length, 14);
  assert.equal(out.dailySeries[out.dailySeries.length - 1].dayKey, '2026-11-26');
  assert.equal(out.dailySeries[out.dailySeries.length - 1].uniqueSessions, 200);
});

test('evaluateAdrTriggers classifies ok (<70%), watch (>=70%), and scale (>=90%) thresholds accurately', () => {
  assert.equal(ADR_THRESHOLDS.monthlyEgressGb, 500);
  assert.equal(ADR_THRESHOLDS.peakWriteRps, 300);
  assert.equal(ADR_THRESHOLDS.functionP95Ms, 800);
  assert.equal(ADR_THRESHOLDS.totalMessages, 5_000_000);
  assert.equal(ADR_THRESHOLDS.dau, 25_000);

  const okRes = evaluateAdrTriggers({
    monthlyEgressGb: 100,
    peakWriteRps: 50,
    functionP95Ms: 200,
    totalMessages: 500_000,
    dau: 5_000,
  });
  assert.equal(okRes.every((g) => g.status === 'ok'), true);

  const mixedRes = evaluateAdrTriggers({
    monthlyEgressGb: 350, // exactly 70% -> watch
    peakWriteRps: 280, // 93.3% -> scale
    functionP95Ms: 400,
    totalMessages: 3_600_000, // 72% -> watch
    dau: 23_000, // 92% -> scale
  });
  assert.equal(mixedRes.find((g) => g.id === 'storage_egress').status, 'watch');
  assert.equal(mixedRes.find((g) => g.id === 'functions_latency_rps').status, 'scale');
  assert.equal(mixedRes.find((g) => g.id === 'chat_volume').status, 'watch');
  assert.equal(mixedRes.find((g) => g.id === 'active_dau').status, 'scale');
});
