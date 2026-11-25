'use strict';

const {
  STORAGE_PREFIX_BUCKETS,
  aggregateShardedRollups,
  classifyStoragePrefix,
  estimateCollectionBytes,
  evaluateAdrTriggers,
  hashPresenceSession,
  phtDateKey,
  recentPhtDateKeys,
  shardIndexForHash,
} = require('./telemetry-engine');

const SNAPSHOT_CACHE_TTL_MS = 60 * 1000;
const FORCE_REFRESH_COOLDOWN_MS = 10 * 1000;
const PRESENCE_TTL_MS = 20 * 60 * 1000;
const PRESENCE_SHARDS = 10;
const PRESENCE_CONTEXT = 'racepulse-presence-v1';

const VALID_PLATFORMS = new Set(['web', 'android', 'ios']);
const VALID_WORKSPACES = new Set(['personal', 'operations']);
const TRACKED_COLLECTIONS = [
  'users',
  'userAccess',
  'publicProfiles',
  'races',
  'runners',
  'recordedRuns',
  'socialPosts',
  'socialComments',
  'clubs',
  'clubMembers',
  'conversations',
  'messages',
  'userBadges',
  'badges',
  'contentReports',
];

let cachedSnapshotEntry = null;

function createHttpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function getFirestoreTimestampCtor() {
  try {
    return require('firebase-admin').firestore?.Timestamp || null;
  } catch {
    return null;
  }
}

function toFirestoreDateOrTimestamp(ms) {
  const TimestampCtor = getFirestoreTimestampCtor();
  if (TimestampCtor && typeof TimestampCtor.fromMillis === 'function') {
    return TimestampCtor.fromMillis(ms);
  }
  return new Date(ms);
}

function clearTelemetrySnapshotCache() {
  cachedSnapshotEntry = null;
}

async function recordPresenceHeartbeat(
  db,
  { uid, role = 'runner', platform = 'web', workspace = 'personal', now = new Date(), salt } = {},
) {
  if (typeof uid !== 'string' || !uid.trim()) {
    throw createHttpError('Authenticated uid is required.', 401);
  }
  const cleanPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : 'web';
  if (!VALID_PLATFORMS.has(cleanPlatform)) {
    throw createHttpError('Invalid platform.', 400);
  }
  const cleanWorkspace = typeof workspace === 'string' ? workspace.trim().toLowerCase() : 'personal';
  if (!VALID_WORKSPACES.has(cleanWorkspace)) {
    throw createHttpError('Invalid workspace.', 400);
  }
  const cleanRole = typeof role === 'string' && role.trim() ? role.trim().toLowerCase() : 'runner';

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();
  const dayKey = phtDateKey(nowMs);
  const effectiveSalt = salt || process.env.RACEPULSE_PRESENCE_SALT || PRESENCE_CONTEXT;
  const sessionHash = hashPresenceSession(uid, dayKey, effectiveSalt);
  const shard = shardIndexForHash(sessionHash, PRESENCE_SHARDS);
  const shardDocId = `day_${dayKey}_s${shard}`;
  const expiresAt = toFirestoreDateOrTimestamp(nowMs + PRESENCE_TTL_MS);
  const updatedAt = new Date(nowMs).toISOString();

  const presenceRef = db.doc(`activePresence/${sessionHash}`);
  const shardRef = db.doc(`systemTelemetry/${shardDocId}`);

  const outcome = await db.runTransaction(async (tx) => {
    const [presenceSnap, shardSnap] = await Promise.all([tx.get(presenceRef), tx.get(shardRef)]);
    const existingPresence = presenceSnap.exists ? presenceSnap.data() || {} : null;
    const isNewSessionToday = !existingPresence || existingPresence.dayKey !== dayKey;

    const prevShard = shardSnap.exists ? shardSnap.data() || {} : {};
    const nextUnique = Math.max(0, Number(prevShard.uniqueSessions || 0)) + (isNewSessionToday ? 1 : 0);
    const nextHeartbeats = Math.max(0, Number(prevShard.heartbeats || 0)) + 1;

    tx.set(presenceRef, {
      sessionHash,
      role: cleanRole,
      platform: cleanPlatform,
      workspace: cleanWorkspace,
      dayKey,
      expiresAt,
      updatedAt,
    });

    tx.set(
      shardRef,
      {
        kind: 'daily',
        dayKey,
        shard,
        uniqueSessions: nextUnique,
        heartbeats: nextHeartbeats,
        authenticatedWrites: Math.max(0, Number(prevShard.authenticatedWrites || 0)),
        updatedAt,
      },
      { merge: true },
    );

    return { isNewSessionToday };
  });

  return {
    ok: true,
    dayKey,
    shard,
    shardDocId,
    sessionHash,
    isNewSessionToday: outcome.isNewSessionToday,
    expiresAt: new Date(nowMs + PRESENCE_TTL_MS).toISOString(),
  };
}

function buildEmptyStoragePrefixes() {
  const prefixes = {};
  for (const bucket of STORAGE_PREFIX_BUCKETS) {
    prefixes[bucket] = { bytes: 0, objects: 0 };
  }
  return prefixes;
}

async function applyStorageObjectTelemetryDelta(
  db,
  { name, size, direction = 'finalize', now = new Date() } = {},
) {
  const objectName = typeof name === 'string' ? name.trim() : '';
  const sizeBytes = Math.max(0, Math.floor(Number(size) || 0));
  if (!objectName || sizeBytes <= 0) {
    return { skipped: true };
  }
  const bucket = classifyStoragePrefix(objectName);
  const deltaSign = direction === 'delete' ? -1 : 1;
  const nowDate = now instanceof Date ? now : new Date(now);
  const updatedAt = (Number.isFinite(nowDate.getTime()) ? nowDate : new Date()).toISOString();

  const summaryRef = db.doc('systemTelemetry/storageSummary');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(summaryRef);
    const current = snap.exists ? snap.data() || {} : {};
    const prefixes = buildEmptyStoragePrefixes();
    const prevPrefixes = current.prefixes && typeof current.prefixes === 'object' ? current.prefixes : {};
    for (const key of STORAGE_PREFIX_BUCKETS) {
      const prevEntry = prevPrefixes[key] || {};
      prefixes[key] = {
        bytes: Math.max(0, Math.floor(Number(prevEntry.bytes) || 0)),
        objects: Math.max(0, Math.floor(Number(prevEntry.objects) || 0)),
      };
    }

    const nextBucketBytes = Math.max(0, prefixes[bucket].bytes + deltaSign * sizeBytes);
    const nextBucketObjects = Math.max(0, prefixes[bucket].objects + deltaSign);
    prefixes[bucket] = { bytes: nextBucketBytes, objects: nextBucketObjects };

    let totalBytes = 0;
    let objectCount = 0;
    for (const key of STORAGE_PREFIX_BUCKETS) {
      totalBytes += prefixes[key].bytes;
      objectCount += prefixes[key].objects;
    }

    tx.set(
      summaryRef,
      {
        kind: 'storage_summary',
        totalBytes,
        objectCount,
        prefixes,
        updatedAt,
      },
      { merge: true },
    );

    return { bucket, totalBytes, objectCount };
  });
}

async function sumTimeSeriesPoints(projectId, filterExpr, token, startIso, endIso) {
  if (!/^[a-z0-9-]{4,64}$/i.test(projectId)) {
    throw new Error('Invalid GCP project id for Cloud Monitoring.');
  }
  const params = new URLSearchParams({
    filter: filterExpr,
    'interval.startTime': startIso,
    'interval.endTime': endIso,
    view: 'FULL',
  });
  const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Monitoring HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.timeSeries) ? payload.timeSeries : [];
  } finally {
    clearTimeout(timer);
  }
}

async function defaultCloudMonitoringFetcher({ projectId, nowDate }) {
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST) {
    return {
      source: 'unavailable',
      reason: 'Emulator runtime uses Firestore & Storage aggregates.',
    };
  }
  let adminClient;
  try {
    adminClient = require('firebase-admin');
  } catch {
    return { source: 'unavailable', reason: 'Admin SDK unavailable for Monitoring.' };
  }

  const resolvedProject =
    projectId ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    adminClient.app?.()?.options?.projectId ||
    '';
  if (!resolvedProject) {
    return { source: 'unavailable', reason: 'GCP project ID not configured.' };
  }

  let accessToken = '';
  try {
    const tokenObj = await adminClient.credential.applicationDefault().getAccessToken();
    accessToken = tokenObj?.access_token || '';
  } catch {
    return { source: 'unavailable', reason: 'Application default credential unavailable.' };
  }
  if (!accessToken) {
    return { source: 'unavailable', reason: 'Monitoring OAuth token empty.' };
  }

  const endMs = nowDate.getTime();
  const endIso = new Date(endMs).toISOString();
  const start24hIso = new Date(endMs - 24 * 60 * 60 * 1000).toISOString();
  const start30dIso = new Date(endMs - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [egressSeries, fnSeries] = await Promise.all([
    sumTimeSeriesPoints(
      resolvedProject,
      'metric.type="storage.googleapis.com/network/sent_bytes_count"',
      accessToken,
      start30dIso,
      endIso,
    ),
    sumTimeSeriesPoints(
      resolvedProject,
      'metric.type="cloudfunctions.googleapis.com/function/execution_count"',
      accessToken,
      start24hIso,
      endIso,
    ),
  ]);

  let egressBytes = 0;
  for (const series of egressSeries) {
    for (const pt of series.points || []) {
      egressBytes += Number(pt.value?.int64Value ?? pt.value?.doubleValue ?? 0) || 0;
    }
  }

  let totalExec = 0;
  let errorExec = 0;
  for (const series of fnSeries) {
    const statusClass = String(series.metric?.labels?.status || '').toLowerCase();
    const isErr = statusClass && statusClass !== 'ok';
    for (const pt of series.points || []) {
      const val = Number(pt.value?.int64Value ?? pt.value?.doubleValue ?? 0) || 0;
      totalExec += val;
      if (isErr) errorExec += val;
    }
  }

  return {
    source: 'cloud_monitoring',
    monthlyEgressGb: Number((egressBytes / (1024 * 1024 * 1024)).toFixed(2)),
    requests24h: Math.round(totalExec),
    errorRatePct: totalExec > 0 ? Number(((errorExec / totalExec) * 100).toFixed(2)) : 0,
    peakWriteRps: Number((totalExec / 86400).toFixed(2)),
    functionP95Ms: 0,
  };
}

async function safeCountCollection(queryOrRef) {
  if (!queryOrRef) return 0;
  if (typeof queryOrRef.count === 'function') {
    const agg = await queryOrRef.count().get();
    return Math.max(0, Number(agg?.data?.()?.count || 0));
  }
  const snap = await queryOrRef.get();
  return snap.docs ? snap.docs.length : 0;
}

async function getSystemTelemetrySnapshot(
  db,
  { forceRefresh = false, monitoringFetcher, now = new Date(), projectId } = {},
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();

  if (cachedSnapshotEntry) {
    const ageMs = nowMs - cachedSnapshotEntry.computedAtMs;
    const withinTtl = ageMs >= 0 && ageMs < SNAPSHOT_CACHE_TTL_MS;
    const forceBlocked = Boolean(forceRefresh) && ageMs >= 0 && ageMs < FORCE_REFRESH_COOLDOWN_MS;
    if ((withinTtl && !forceRefresh) || forceBlocked) {
      return {
        ...structuredClone(cachedSnapshotEntry.snapshot),
        cache: {
          cached: true,
          ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
          ttlSeconds: Math.round(SNAPSHOT_CACHE_TTL_MS / 1000),
          cooldownSeconds: Math.round(FORCE_REFRESH_COOLDOWN_MS / 1000),
        },
      };
    }
  }

  const todayKey = phtDateKey(nowMs);
  const oldest30DayKey = recentPhtDateKeys(30, todayKey)[0];
  const cutoffTs = toFirestoreDateOrTimestamp(nowMs);

  const [presenceSnap, rollupSnap, storageSummarySnap, openReportsCount, pendingClubReqsCount, collectionCountsEntries] =
    await Promise.all([
      db.collection('activePresence').where('expiresAt', '>', cutoffTs).get(),
      db
        .collection('systemTelemetry')
        .where('kind', '==', 'daily')
        .where('dayKey', '>=', oldest30DayKey)
        .get(),
      db.doc('systemTelemetry/storageSummary').get(),
      safeCountCollection(db.collection('contentReports').where('status', '==', 'open')).catch(() => 0),
      safeCountCollection(db.collection('clubRequests').where('status', '==', 'pending')).catch(() => 0),
      Promise.all(
        TRACKED_COLLECTIONS.map(async (colName) => [
          colName,
          await safeCountCollection(db.collection(colName)).catch(() => 0),
        ]),
      ),
    ]);

  const byRole = {};
  const byPlatform = { web: 0, android: 0, ios: 0 };
  const byWorkspace = { personal: 0, operations: 0 };
  for (const docSnap of presenceSnap.docs || []) {
    const data = docSnap.data() || {};
    const roleKey = typeof data.role === 'string' && data.role ? data.role : 'runner';
    byRole[roleKey] = (byRole[roleKey] || 0) + 1;
    const platformKey = VALID_PLATFORMS.has(data.platform) ? data.platform : 'web';
    byPlatform[platformKey] = (byPlatform[platformKey] || 0) + 1;
    const workspaceKey = VALID_WORKSPACES.has(data.workspace) ? data.workspace : 'personal';
    byWorkspace[workspaceKey] = (byWorkspace[workspaceKey] || 0) + 1;
  }

  const rollups = aggregateShardedRollups(
    (rollupSnap.docs || []).map((d) => d.data()),
    todayKey,
    new Date(nowMs),
  );

  const collectionCounts = Object.fromEntries(collectionCountsEntries);
  const firestoreSizing = estimateCollectionBytes(collectionCounts);

  const storageData = storageSummarySnap.exists ? storageSummarySnap.data() || {} : {};
  const prefixes = buildEmptyStoragePrefixes();
  for (const bucket of STORAGE_PREFIX_BUCKETS) {
    const entry = storageData.prefixes?.[bucket];
    prefixes[bucket] = {
      bytes: Math.max(0, Math.floor(Number(entry?.bytes) || 0)),
      objects: Math.max(0, Math.floor(Number(entry?.objects) || 0)),
    };
  }
  const storageTotalBytes = Math.max(0, Math.floor(Number(storageData.totalBytes) || 0));
  const storageObjectCount = Math.max(0, Math.floor(Number(storageData.objectCount) || 0));

  let monitoring;
  try {
    const fetcher = monitoringFetcher || defaultCloudMonitoringFetcher;
    const fetched = await fetcher({ projectId, nowDate: new Date(nowMs) });
    monitoring = fetched && typeof fetched === 'object'
      ? fetched
      : { source: 'unavailable', reason: 'Monitoring returned empty payload.' };
  } catch (err) {
    monitoring = {
      source: 'unavailable',
      reason: err instanceof Error && err.message ? err.message.slice(0, 140) : 'Cloud Monitoring unavailable.',
    };
  }

  const monthlyEgressGb = Math.max(0, Number(monitoring.monthlyEgressGb) || 0);
  const peakWriteRps = Math.max(0, Number(monitoring.peakWriteRps) || 0);
  const functionP95Ms = Math.max(0, Number(monitoring.functionP95Ms) || 0);
  const totalMessages = Math.max(0, Number(collectionCounts.messages) || 0);
  const dauForGauge = Math.max(rollups.dauToday, (presenceSnap.docs || []).length);

  const snapshot = {
    generatedAt: new Date(nowMs).toISOString(),
    cache: {
      cached: false,
      ageSeconds: 0,
      ttlSeconds: Math.round(SNAPSHOT_CACHE_TTL_MS / 1000),
      cooldownSeconds: Math.round(FORCE_REFRESH_COOLDOWN_MS / 1000),
    },
    onlineNow: {
      total: (presenceSnap.docs || []).length,
      windowMinutes: 20,
      byRole,
      byPlatform,
      byWorkspace,
    },
    rollups,
    storage: {
      totalBytes: storageTotalBytes,
      totalMb: Number((storageTotalBytes / (1024 * 1024)).toFixed(2)),
      totalGb: Number((storageTotalBytes / (1024 * 1024 * 1024)).toFixed(3)),
      objectCount: storageObjectCount,
      updatedAt: storageData.updatedAt || null,
      prefixes,
    },
    firestore: firestoreSizing,
    moderation: {
      openReports: openReportsCount,
      pendingClubRequests: pendingClubReqsCount,
    },
    monitoring: {
      source: monitoring.source || 'unavailable',
      reason: monitoring.reason || null,
      monthlyEgressGb,
      requests24h: Math.max(0, Number(monitoring.requests24h) || 0),
      errorRatePct: Math.max(0, Number(monitoring.errorRatePct) || 0),
      peakWriteRps,
      functionP95Ms,
    },
    triggers: evaluateAdrTriggers({
      monthlyEgressGb,
      peakWriteRps,
      functionP95Ms,
      totalMessages,
      dau: dauForGauge,
    }),
  };

  cachedSnapshotEntry = {
    computedAtMs: nowMs,
    snapshot: structuredClone(snapshot),
  };

  return snapshot;
}

module.exports = {
  PRESENCE_SHARDS,
  PRESENCE_TTL_MS,
  SNAPSHOT_CACHE_TTL_MS,
  TRACKED_COLLECTIONS,
  applyStorageObjectTelemetryDelta,
  clearTelemetrySnapshotCache,
  getSystemTelemetrySnapshot,
  recordPresenceHeartbeat,
};
