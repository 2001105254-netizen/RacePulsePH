'use strict';

const crypto = require('crypto');

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STORAGE_PREFIX_BUCKETS = Object.freeze([
  'social-media',
  'chat-media',
  'run-tracks',
  'badge-assets',
  'club-assets',
  'race-assets',
  'other',
]);

const COLLECTION_AVG_DOC_BYTES = Object.freeze({
  users: 1450,
  userAccess: 950,
  publicProfiles: 900,
  races: 9200,
  runners: 1650,
  recordedRuns: 6400,
  socialPosts: 2100,
  socialComments: 720,
  clubs: 3400,
  clubMembers: 680,
  conversations: 1100,
  messages: 960,
  userBadges: 640,
  badges: 1850,
  contentReports: 1150,
});

const ADR_THRESHOLDS = Object.freeze({
  monthlyEgressGb: 500,
  peakWriteRps: 300,
  functionP95Ms: 800,
  totalMessages: 5_000_000,
  dau: 25_000,
});

function toNonNegativeFinite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

/** Format any timestamp or Date into `YYYY-MM-DD` in Asia/Manila (UTC+8). */
function phtDateKey(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const ms = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  const pht = new Date(ms + PHT_OFFSET_MS);
  return pht.toISOString().slice(0, 10);
}

/** Return ascending list of `days` `YYYY-MM-DD` PHT keys ending on `anchorInput`'s PHT date. */
function recentPhtDateKeys(days = 14, anchorInput = new Date()) {
  const count = Math.max(1, Math.min(90, Math.floor(Number(days) || 14)));
  const endKey = typeof anchorInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchorInput)
    ? anchorInput
    : phtDateKey(anchorInput);
  const [year, month, day] = endKey.split('-').map(Number);
  const endUtcMidnight = Date.UTC(year, month - 1, day);
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(new Date(endUtcMidnight - i * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/** Produce a non-reversible 32-hex daily presence session hash (zero PII). */
function hashPresenceSession(uid, dayKey, salt = 'racepulse-presence-v1') {
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  const safeDay = typeof dayKey === 'string' ? dayKey.trim() : '';
  if (!safeUid || !safeDay) {
    throw new Error('uid and dayKey are required for presence hashing.');
  }
  return crypto
    .createHmac('sha256', String(salt || 'racepulse-presence-v1'))
    .update(`${safeDay}:${safeUid}`)
    .digest('hex')
    .slice(0, 32);
}

function shardIndexForHash(sessionHash, shardCount = 10) {
  const count = Math.max(1, Math.floor(Number(shardCount) || 10));
  const slice = typeof sessionHash === 'string' && sessionHash.length >= 8
    ? sessionHash.slice(0, 8)
    : '0';
  const parsed = Number.parseInt(slice, 16);
  return Number.isFinite(parsed) ? parsed % count : 0;
}

function classifyStoragePrefix(objectPath) {
  const raw = typeof objectPath === 'string' ? objectPath.trim().replace(/^\/+/, '') : '';
  if (!raw) return 'other';
  const firstSegment = raw.split('/')[0].toLowerCase();
  if (firstSegment === 'social-media') return 'social-media';
  if (firstSegment === 'chat-media') return 'chat-media';
  if (firstSegment === 'run-tracks') return 'run-tracks';
  if (firstSegment === 'badge-assets') return 'badge-assets';
  if (firstSegment === 'club-assets') return 'club-assets';
  if (
    firstSegment === 'race-assets' ||
    firstSegment === 'bib-templates' ||
    firstSegment === 'bib-fonts' ||
    firstSegment === 'posters' ||
    firstSegment === 'highlights'
  ) {
    return 'race-assets';
  }
  return 'other';
}

function estimateCollectionBytes(counts = {}) {
  const collections = [];
  let totalDocuments = 0;
  let rawBytes = 0;

  for (const [name, countRaw] of Object.entries(counts || {})) {
    const documents = Math.floor(toNonNegativeFinite(countRaw, 0));
    const avgDocBytes = COLLECTION_AVG_DOC_BYTES[name] || 1024;
    const estRawBytes = documents * avgDocBytes;
    const estIndexedBytes = Math.round(estRawBytes * 2.5);
    totalDocuments += documents;
    rawBytes += estRawBytes;
    collections.push({
      collection: name,
      documents,
      avgDocBytes,
      rawBytes: estRawBytes,
      indexedBytes: estIndexedBytes,
      rawMb: Number((estRawBytes / (1024 * 1024)).toFixed(3)),
      indexedMb: Number((estIndexedBytes / (1024 * 1024)).toFixed(3)),
    });
  }

  collections.sort((a, b) => b.indexedBytes - a.indexedBytes || a.collection.localeCompare(b.collection));
  const indexedBytes = Math.round(rawBytes * 2.5);

  return {
    totalDocuments,
    rawBytes,
    indexedBytes,
    rawMb: Number((rawBytes / (1024 * 1024)).toFixed(2)),
    indexedMb: Number((indexedBytes / (1024 * 1024)).toFixed(2)),
    collections,
  };
}

function aggregateShardedRollups(docs = [], todayKeyInput, anchorDate = new Date()) {
  const todayKey = typeof todayKeyInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayKeyInput)
    ? todayKeyInput
    : phtDateKey(anchorDate);
  const window30 = new Set(recentPhtDateKeys(30, todayKey));
  const window7 = new Set(recentPhtDateKeys(7, todayKey));
  const seriesKeys = recentPhtDateKeys(14, todayKey);

  const byDay = new Map();
  for (const key of seriesKeys) {
    byDay.set(key, {
      dayKey: key,
      uniqueSessions: 0,
      heartbeats: 0,
      authenticatedWrites: 0,
    });
  }

  let dauToday = 0;
  let wau7d = 0;
  let mau30d = 0;
  let heartbeatsToday = 0;

  for (const doc of docs || []) {
    if (!doc || typeof doc.dayKey !== 'string') continue;
    const dayKey = doc.dayKey;
    const uniqueSessions = toNonNegativeFinite(doc.uniqueSessions, 0);
    const heartbeats = toNonNegativeFinite(doc.heartbeats, 0);
    const authenticatedWrites = toNonNegativeFinite(doc.authenticatedWrites, 0);

    if (dayKey === todayKey) {
      dauToday += uniqueSessions;
      heartbeatsToday += heartbeats;
    }
    if (window7.has(dayKey)) {
      wau7d += uniqueSessions;
    }
    if (window30.has(dayKey)) {
      mau30d += uniqueSessions;
    }
    if (byDay.has(dayKey)) {
      const bucket = byDay.get(dayKey);
      bucket.uniqueSessions += uniqueSessions;
      bucket.heartbeats += heartbeats;
      bucket.authenticatedWrites += authenticatedWrites;
    }
  }

  return {
    todayKey,
    dauToday,
    wau7d,
    mau30d,
    heartbeatsToday,
    dailySeries: seriesKeys.map((k) => byDay.get(k)),
  };
}

function classifyThresholdStatus(ratio) {
  if (ratio >= 0.9) return 'scale';
  if (ratio >= 0.7) return 'watch';
  return 'ok';
}

function evaluateAdrTriggers(metrics = {}) {
  const monthlyEgressGb = toNonNegativeFinite(metrics.monthlyEgressGb, 0);
  const peakWriteRps = toNonNegativeFinite(metrics.peakWriteRps, 0);
  const functionP95Ms = toNonNegativeFinite(metrics.functionP95Ms, 0);
  const totalMessages = toNonNegativeFinite(metrics.totalMessages, 0);
  const dau = toNonNegativeFinite(metrics.dau, 0);

  const egressRatio = monthlyEgressGb / ADR_THRESHOLDS.monthlyEgressGb;
  const rpsRatio = peakWriteRps / ADR_THRESHOLDS.peakWriteRps;
  const latencyRatio = functionP95Ms / ADR_THRESHOLDS.functionP95Ms;
  const functionsRatio = Math.max(rpsRatio, latencyRatio);
  const chatRatio = totalMessages / ADR_THRESHOLDS.totalMessages;
  const dauRatio = dau / ADR_THRESHOLDS.dau;

  return [
    {
      id: 'storage_egress',
      label: 'Monthly Storage Egress',
      currentValue: Number(monthlyEgressGb.toFixed(2)),
      thresholdValue: ADR_THRESHOLDS.monthlyEgressGb,
      unit: 'GB/mo',
      percent: Math.min(999, Math.round(egressRatio * 1000) / 10),
      status: classifyThresholdStatus(egressRatio),
      recommendation: 'Migrate video delivery/transcoding to Cloudflare Stream or R2 when >= 500 GB/mo.',
    },
    {
      id: 'functions_latency_rps',
      label: 'Peak Write RPS & Functions p95',
      currentValue: peakWriteRps > 0 ? Number(peakWriteRps.toFixed(1)) : Math.round(functionP95Ms),
      thresholdValue: peakWriteRps >= functionP95Ms * (ADR_THRESHOLDS.peakWriteRps / ADR_THRESHOLDS.functionP95Ms)
        ? ADR_THRESHOLDS.peakWriteRps
        : ADR_THRESHOLDS.functionP95Ms,
      unit: peakWriteRps >= functionP95Ms * (ADR_THRESHOLDS.peakWriteRps / ADR_THRESHOLDS.functionP95Ms)
        ? 'RPS'
        : 'ms p95',
      secondaryText: `${peakWriteRps.toFixed(1)} RPS / ${Math.round(functionP95Ms)} ms p95`,
      percent: Math.min(999, Math.round(functionsRatio * 1000) / 10),
      status: classifyThresholdStatus(functionsRatio),
      recommendation: 'Raise minInstances or split hot realtime handlers when >= 300 RPS or >= 800 ms p95.',
    },
    {
      id: 'chat_volume',
      label: 'Chat & Community Message Volume',
      currentValue: totalMessages,
      thresholdValue: ADR_THRESHOLDS.totalMessages,
      unit: 'docs',
      percent: Math.min(999, Math.round(chatRatio * 1000) / 10),
      status: classifyThresholdStatus(chatRatio),
      recommendation: 'Enable cold message archival TTL policy when messages exceed 5M documents.',
    },
    {
      id: 'active_dau',
      label: 'Daily Active Users (PHT)',
      currentValue: dau,
      thresholdValue: ADR_THRESHOLDS.dau,
      unit: 'DAU',
      percent: Math.min(999, Math.round(dauRatio * 1000) / 10),
      status: classifyThresholdStatus(dauRatio),
      recommendation: 'Enable Firebase BigQuery export alongside live telemetry when DAU exceeds 25,000.',
    },
  ];
}

module.exports = {
  ADR_THRESHOLDS,
  COLLECTION_AVG_DOC_BYTES,
  STORAGE_PREFIX_BUCKETS,
  aggregateShardedRollups,
  classifyStoragePrefix,
  estimateCollectionBytes,
  evaluateAdrTriggers,
  hashPresenceSession,
  phtDateKey,
  recentPhtDateKeys,
  shardIndexForHash,
};
