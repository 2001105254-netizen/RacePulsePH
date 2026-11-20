import { formatRaceTime } from './src/lib/preciseTime';
import express from "express";
import path from "path";
import fs from "fs";
import crypto from 'crypto';
import zlib from 'zlib';
import * as lanPolicy from './functions/lan-policy.js';
import * as requestGuard from './functions/request-guard.js';

interface EngravingOrder {
  id: string;
  runnerName: string;
  bibNumber: string;
  distance: string;
  finishingTime: string;
  status: 'queued' | 'inprogress' | 'ready' | 'completed';
  createdAt: string;
  updatedAt: string;
  rank?: string;
  customInscription?: string;
  ownerUid?: string;
}

interface ChipRead {
  bridgeEventId?: string;
  antenna?: number;
  readerSequence?: number;
  monotonicTicks?: string;
  monotonicFrequency?: string;
  clockSource?: string;

  id: string;
  raceId: string;
  bibNumber: string;
  chipId?: string;
  checkpointId: string;
  timestamp: string;
  source: 'manual' | 'rfid-bridge';
  recordedBy: string;
  createdAt: string;
}

// A raw EPC sighting sent by the Windows RFID bridge.  It deliberately does
// not contain a race, bib, or user ID: the authenticated Timing Console owns
// that matching and persists the final checkpoint result.
interface RfidBridgeEvent {
  bridgeEventId?: string;
  readerSequence?: number;
  monotonicTicks?: string;
  monotonicFrequency?: string;
  clockSource?: string;

  raceId?: string;
  id: string;
  epc: string;
  antenna: number;
  timestamp: string;
  receivedAt: string;
}

const PORT = Number(process.env.PORT || 3000);
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FORBIDDEN_IDS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);
const VALID_ORDER_STATUSES = new Set(['queued', 'inprogress', 'ready', 'completed']);

const MAX_LOCAL_ORDERS = 25_000;
const MAX_LOCAL_CHIP_READS = 100_000;
const MAX_RFID_EVENTS = 100_000;
const PRIVATE_LAN_ORIGIN_RE = /^https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://racepulseph.web.app',
  'https://racepulseph.firebaseapp.com',
  'https://localhost',
  'capacitor://localhost',
]);

function isValidRecordId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID_RE.test(value) && !FORBIDDEN_IDS.has(value);
}

function ownRecord<T>(store: Record<string, T>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.hasOwn(store, id) ? store[id] : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripPrototypeKeys<T extends Record<string, unknown>>(obj: T): T {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!FORBIDDEN_IDS.has(key)) {
      safe[key] = value;
    }
  }
  return safe as T;
}

function sanitizeLog(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 128);
}

function parseAllowedOrigins(): Set<string> {
  const set = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const item of (process.env.RACEPULSE_ALLOWED_ORIGINS || '').split(',')) {
    const trimmed = item.trim();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

function isAllowedCorsOrigin(origin: string, extraOrigins: Set<string>): boolean {
  return extraOrigins.has(origin) || PRIVATE_LAN_ORIGIN_RE.test(origin);
}

function loadJsonStore<T>(filePath: string, label: string): Record<string, T> {
  const result: Record<string, T> = {};
  try {
    if (!fs.existsSync(filePath)) return result;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return result;
    for (const [key, value] of Object.entries(parsed)) {
      if (isValidRecordId(key) && isPlainRecord(value)) {
        result[key] = stripPrototypeKeys(value) as T;
      }
    }
    console.log(`${label} Loaded ${Object.keys(result).length} records from storage.`);
  } catch (e) {
    console.warn(`${label} Failed to parse local store file, running with fresh store:`, e);
  }
  return result;
}
// Timing Station.exe runs the local server from Program Files, which Windows
// intentionally protects from normal writes.  The desktop wrapper supplies a
// user-writable RACEPULSE_DATA_DIR; the normal developer workflow keeps using
// the repository root with no configuration change.
const DATA_DIRECTORY = process.env.RACEPULSE_DATA_DIR || process.cwd();
try {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
} catch (error) {
  console.warn("[Local Server DB] Could not create data directory:", error);
}
const DB_FILE = path.join(DATA_DIRECTORY, "local_orders.json");
const CHIP_READS_DB_FILE = path.join(DATA_DIRECTORY, "local_chip_reads.json");
const RFID_EVENTS_DB_FILE = path.join(DATA_DIRECTORY, "local_rfid_events.json");

// Load initial orders from a local JSON db file (handles on-site server restarts)
let orders: Record<string, EngravingOrder> = loadJsonStore<EngravingOrder>(DB_FILE, "[Local Server DB Orders]");

function writeJsonAtomic(filePath: string, data: unknown): void {
  const serialized = JSON.stringify(data, null, 2);
  const tmpFile = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpFile, serialized, "utf-8");
    fs.renameSync(tmpFile, filePath);
  } catch {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup error if temp file was never created
    }
    fs.writeFileSync(filePath, serialized, "utf-8");
  }
}

function saveDB() {
  try {
    writeJsonAtomic(DB_FILE, orders);
  } catch (err) {
    console.error("[Local Server DB] Write failed:", err);
  }
}

// Load initial chip reads (timing checkpoint scans - manual today, RFID bridge later)
let chipReads: Record<string, ChipRead> = loadJsonStore<ChipRead>(CHIP_READS_DB_FILE, "[Local Server DB ChipReads]");

function saveChipReadsDB() {
  try {
    writeJsonAtomic(CHIP_READS_DB_FILE, chipReads);
  } catch (err) {
    console.error("[Local Server DB] Chip reads write failed:", err);
  }
}

// Keep a small, durable hand-off queue between the Windows reader process and
// the signed-in browser.  Events are pruned regularly so old race-day traffic
// cannot be replayed on a later race.
let rfidEvents: Record<string, RfidBridgeEvent> = loadJsonStore<RfidBridgeEvent>(RFID_EVENTS_DB_FILE, "[RFID Bridge]");

function pruneRfidEvents(): void {
  const oldestAllowed = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, event] of Object.entries(rfidEvents)) {
    if (Number.isNaN(Date.parse(event.receivedAt)) || Date.parse(event.receivedAt) < oldestAllowed) {
      delete rfidEvents[id];
    }
  }

  // Retain every event within the recovery window, including large bursts.
}

let rfidEventsFlushTimer: NodeJS.Timeout | null = null;
let rfidEventsDirty = false;

function saveRfidEventsDBNow(): void {
  if (rfidEventsFlushTimer) {
    clearTimeout(rfidEventsFlushTimer);
    rfidEventsFlushTimer = null;
  }
  rfidEventsDirty = false;
  try {
    pruneRfidEvents();
    writeJsonAtomic(RFID_EVENTS_DB_FILE, rfidEvents);
  } catch (err) {
    console.error("[RFID Bridge] Event queue write failed:", err);
  }
}

function saveRfidEventsDB(): void {
  rfidEventsDirty = true;
  if (rfidEventsFlushTimer) return;
  rfidEventsFlushTimer = setTimeout(() => {
    rfidEventsFlushTimer = null;
    if (rfidEventsDirty) {
      saveRfidEventsDBNow();
    }
  }, 120);
  rfidEventsFlushTimer.unref?.();
}

const SESSION_CACHE_TTL_MS = Math.max(0, Number(process.env.RACEPULSE_SESSION_CACHE_MS ?? 5000) || 0);
const sessionCache = new Map<string, { expiresAt: number; session: Record<string, unknown> }>();
const sessionInFlight = new Map<string, Promise<{ status: number; ok: boolean; session?: Record<string, unknown> }>>();

async function resolveAccessSession(endpoint: string, bearer: string, scanningRaceId?: string) {
  const key = crypto
    .createHash('sha256')
    .update(`${bearer}|${scanningRaceId || ''}`)
    .digest('hex');

  if (SESSION_CACHE_TTL_MS > 0) {
    const cached = sessionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { status: 200, ok: true, session: cached.session };
    }
    if (cached) sessionCache.delete(key);
  }

  const existingFlight = sessionInFlight.get(key);
  if (existingFlight) return existingFlight;

  const promise = (async () => {
    const response = await fetch(`${endpoint}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer },
      body: JSON.stringify(scanningRaceId ? { scanningRaceId } : {}),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { status: response.status, ok: false };
    }
    const session = (await response.json()) as Record<string, unknown>;
    if (SESSION_CACHE_TTL_MS > 0) {
      if (sessionCache.size > 2000) {
        const nowMs = Date.now();
        for (const [k, v] of sessionCache) {
          if (v.expiresAt <= nowMs) sessionCache.delete(k);
        }
        if (sessionCache.size > 2000) sessionCache.clear();
      }
      sessionCache.set(key, { expiresAt: Date.now() + SESSION_CACHE_TTL_MS, session });
    }
    return { status: 200, ok: true, session };
  })().finally(() => {
    sessionInFlight.delete(key);
  });

  sessionInFlight.set(key, promise);
  return promise;
}

async function startServer() {
  const app = express();
  const allowedOrigins = parseAllowedOrigins();
  const lanLimiter = requestGuard.createMemoryLimiter({ maxEntries: 10_000 });
  if (process.env.RACEPULSE_TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
  app.disable("x-powered-by");

  const clientIpOf = (req: express.Request) => requestGuard.normalizeIpBucket(req.ip || req.socket.remoteAddress || 'unknown');
  const sendRateLimitExceeded = (res: express.Response, retryAfter: number, message: string) => {
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
    return res.status(429).json({ error: message, retryAfter: Math.max(1, retryAfter) });
  };

  // Security headers on all responses
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  // Lightweight gzip compression for JSON API payloads > 1 KiB
  app.use('/api', (req, res, next) => {
    const acceptEncoding = String(req.get('Accept-Encoding') || '');
    if (!/\bgzip\b/i.test(acceptEncoding)) {
      next();
      return;
    }
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const payload = Buffer.from(JSON.stringify(body), 'utf-8');
      if (payload.byteLength < 1024 || res.headersSent) {
        return origJson(body);
      }
      const compressed = zlib.gzipSync(payload);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(compressed);
    }) as express.Response['json'];
    next();
  });

  // Global per-IP flood guard (protects SPA & static routes from tight request storms)
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const isBridgePost = req.path === '/api/rfid-events' && req.method === 'POST';
    const ip = clientIpOf(req);
    const limitCheck = lanLimiter.consume(`global:${ip}`, {
      limit: isBridgePost ? 10_000 : 600,
      windowMs: 60 * 1000,
      penaltyMultiplier: 1.5,
    });
    if (!limitCheck.allowed) {
      if (req.path.startsWith('/api')) {
        sendRateLimitExceeded(res, limitCheck.retryAfter, 'Too many requests. Please slow down briefly.');
        return;
      }
      res.setHeader('Retry-After', String(Math.max(1, limitCheck.retryAfter)));
      res.status(429).send('Too many requests. Please retry shortly.');
      return;
    }
    next();
  });

  // Allow bounded JSON payloads
  app.use(express.json({ limit: "64kb" }));

  // Scoped CORS Headers (hosted domains, Capacitor localhost, and private RFC1918 LAN terminals)
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin) {
      if (!isAllowedCorsOrigin(origin, allowedOrigins)) {
        if (req.method === "OPTIONS") {
          res.sendStatus(403);
          return;
        }
        next();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-RacePulse-Bridge-Key, X-Firebase-AppCheck, X-Turnstile-Token, Idempotency-Key");
      res.setHeader("Access-Control-Expose-Headers", "Retry-After");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'racepulse-lan-hub',
      bridgeConfigured: Boolean((process.env.RACEPULSE_BRIDGE_KEY || '').length >= 32 && process.env.RACEPULSE_BRIDGE_RACE_ID),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/routes/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'racepulse-routes',
      engine: 'racepulse-geo-ph',
      fallbackEngine: 'ph-archipelago-grid',
      terrainModel: 'racepulse-ph-30m',
      imageryLayer: 'racepulse-ph-sat',
      coverage: 'Philippines',
      bounds: { west: 115.6, south: 4.1, east: 127.8, north: 21.6 },
      maxGpxBytes: 8 * 1024 * 1024,
      maxGpxPoints: 100000,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/tiles/manifest', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      country: 'Philippines',
      islandGroups: ['Luzon', 'Visayas', 'Mindanao'],
      bounds: { west: 115.6, south: 4.1, east: 127.8, north: 21.6 },
      terrainModel: 'racepulse-ph-30m',
      imageryLayer: 'racepulse-ph-sat',
      attribution: 'RacePulsePH Philippines Map',
      pilotCourses: [
        {
          id: 'cebu-highlands-trail-2026_21k',
          islandGroup: 'Visayas',
          province: 'Cebu',
          gpxFixture: '/fixtures/cebu-highlands-21k.gpx',
          zoomRange: 'z=12..16',
        },
        {
          id: 'bukidnon-kitanglad-trail-2026_32k',
          islandGroup: 'Mindanao',
          province: 'Bukidnon',
          gpxFixture: '/fixtures/bukidnon-kitanglad-32k.gpx',
          zoomRange: 'z=12..16',
        },
      ],
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', async (req, res, next) => {
    const cleanSubpath = req.path.replace(/\/+$/, '') || '/';
    const route = '/api' + (cleanSubpath === '/' ? '' : cleanSubpath);
    const clientIp = clientIpOf(req);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!isPlainRecord(req.body)) {
        return res.status(400).json({ error: 'Expected a JSON object body.' });
      }
      req.body = stripPrototypeKeys(req.body);
    }
    if (route === '/api/rfid-events' && req.method === 'POST') {
      const expected = process.env.RACEPULSE_BRIDGE_KEY || '';
      const supplied = req.get('X-RacePulse-Bridge-Key') || '';
      if (expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) || !process.env.RACEPULSE_BRIDGE_RACE_ID) {
        const badBridge = lanLimiter.consume(`bad_bridge:${clientIp}`, { limit: 15, windowMs: 5 * 60 * 1000, penaltyMultiplier: 2 });
        if (!badBridge.allowed) {
          return sendRateLimitExceeded(res, badBridge.retryAfter, 'Too many failed bridge authentication attempts.');
        }
        return res.status(401).json({ error: 'Bridge pairing is required.' });
      }
      return next();
    }

    const apiBucket = route === '/api/rfid-events' ? 'rfid_get' : req.method === 'GET' ? 'api_read' : 'api_write';
    const apiLimit = route === '/api/rfid-events' ? 300 : req.method === 'GET' ? 240 : 120;
    const rateRes = lanLimiter.consume(`${apiBucket}:${clientIp}`, {
      limit: apiLimit,
      windowMs: 60 * 1000,
      penaltyMultiplier: 1.5,
    });
    if (!rateRes.allowed) {
      return sendRateLimitExceeded(res, rateRes.retryAfter, 'Too many race-day API requests. Retrying after backoff.');
    }

    try {
      const bearer = req.get('Authorization');
      if (!bearer?.startsWith('Bearer ')) {
        const badBearer = lanLimiter.consume(`bad_auth:${clientIp}`, { limit: 30, windowMs: 5 * 60 * 1000, penaltyMultiplier: 2 });
        if (!badBearer.allowed) {
          return sendRateLimitExceeded(res, badBearer.retryAfter, 'Too many unauthenticated requests. Please wait.');
        }
        return res.status(401).json({ error: 'Sign in to use race-day services.' });
      }
      const endpoint = process.env.RACEPULSE_ACCESS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi';
      const scanningRaceId = route === '/api/chip-reads' && req.method === 'POST' && typeof req.body?.raceId === 'string'
        ? req.body.raceId
        : undefined;
      const authResult = await resolveAccessSession(endpoint, bearer, scanningRaceId);
      if (!authResult.ok || !authResult.session) {
        if (authResult.status === 401 || authResult.status === 403) {
          const badAuth = lanLimiter.consume(`bad_auth:${clientIp}`, { limit: 30, windowMs: 5 * 60 * 1000, penaltyMultiplier: 2 });
          if (!badAuth.allowed) {
            return sendRateLimitExceeded(res, badAuth.retryAfter, 'Too many rejected authorization attempts. Please wait.');
          }
        }
        return res.status(authResult.status).json({ error: 'Current authorization could not be confirmed. Work remains queued.' });
      }
      const session = authResult.session;
      const id = route.split('/').at(-1);
      const bodyId = typeof req.body?.id === 'string' ? req.body.id : undefined;
      if (req.method !== 'GET' && !route.endsWith('/reset')) {
        const candidateId = req.method === 'DELETE' ? id : bodyId;
        if (candidateId !== undefined && !isValidRecordId(candidateId)) {
          return res.status(400).json({ error: 'Invalid record identifier.' });
        }
      }
      const existing = route.startsWith('/api/orders')
        ? ownRecord(orders, id) || ownRecord(orders, bodyId)
        : ownRecord(chipReads, id) || ownRecord(chipReads, bodyId);
      const queryRaceId = typeof req.query.raceId === 'string' ? req.query.raceId : undefined;
      if (!lanPolicy.authorize(session, req.method, route, { ...(isPlainRecord(req.body) ? req.body : {}), raceId: queryRaceId || req.body?.raceId }, existing)) return res.status(403).json({ error: 'This action is disabled for your account or race.' });
      res.locals.accessSession = session;
      next();
    } catch { return res.status(503).json({ error: 'Authorization is unavailable. Captured scans remain queued.' }); }
  });

  // ========== LOCAL SYNC APIS ==========

  // GET/Read order queue
  app.get("/api/orders", (req, res) => {
    const ordersList = Object.values(orders).filter(record => lanPolicy.visible(res.locals.accessSession, 'orders', record));
    res.json({ orders: ordersList });
  });

  // POST/Create/Update order
  app.post("/api/orders", (req, res) => {
    const orderData = req.body as Partial<EngravingOrder>;
    if (
      !isValidRecordId(orderData.id) ||
      typeof orderData.runnerName !== "string" || !orderData.runnerName.trim() || orderData.runnerName.trim().length > 100 ||
      typeof orderData.bibNumber !== "string" || !orderData.bibNumber.trim() || orderData.bibNumber.trim().length > 20 ||
      (orderData.distance !== undefined && (typeof orderData.distance !== "string" || orderData.distance.trim().length > 50)) ||
      (orderData.finishingTime !== undefined && (typeof orderData.finishingTime !== "string" || orderData.finishingTime.length > 32)) ||
      (orderData.status !== undefined && !VALID_ORDER_STATUSES.has(orderData.status)) ||
      (orderData.rank !== undefined && (typeof orderData.rank !== "string" || orderData.rank.trim().length > 50)) ||
      (orderData.customInscription !== undefined && (typeof orderData.customInscription !== "string" || orderData.customInscription.trim().length > 150)) ||
      (orderData.createdAt !== undefined && (typeof orderData.createdAt !== "string" || orderData.createdAt.length > 64)) ||
      (orderData.ownerUid !== undefined && (typeof orderData.ownerUid !== "string" || orderData.ownerUid.length > 128))
    ) {
      res.status(400).json({ error: "Missing or invalid required fields (id, runnerName, bibNumber, status)" });
      return;
    }

    const orderId = orderData.id;
    const existing = ownRecord(orders, orderId);
    if (!existing && Object.keys(orders).length >= MAX_LOCAL_ORDERS) {
      res.status(507).json({ error: "Local order queue capacity reached." });
      return;
    }
    const timestamp = new Date().toISOString();

    const merged: EngravingOrder = {
      id: orderId,
      runnerName: orderData.runnerName.trim(),
      bibNumber: orderData.bibNumber.trim(),
      distance: orderData.distance?.trim() || (existing ? existing.distance : "Marathon"),
      finishingTime: formatRaceTime(orderData.finishingTime || (existing ? existing.finishingTime : "00:00:0000000")),
      status: orderData.status || (existing ? existing.status : "queued"),
      createdAt: existing ? existing.createdAt : (orderData.createdAt || timestamp),
      updatedAt: timestamp,
      rank: orderData.rank?.trim() || (existing ? existing.rank : undefined),
      customInscription: orderData.customInscription?.trim() || (existing ? existing.customInscription : undefined),
      ownerUid: existing?.ownerUid || orderData.ownerUid,
    };

    orders[orderId] = merged;
    saveDB();

    console.log(`[Local Server DB] Order ${sanitizeLog(orderId)} saved/updated for runner ${sanitizeLog(merged.runnerName)}. Status: ${merged.status}`);
    res.json({ success: true, order: merged });
  });

  // DELETE single order
  app.delete("/api/orders/:id", (req, res) => {
    const orderId = req.params.id;
    if (!isValidRecordId(orderId)) {
      res.status(400).json({ error: "Invalid order ID." });
      return;
    }
    const existing = ownRecord(orders, orderId);
    if (existing) {
      const removedName = existing.runnerName;
      delete orders[orderId];
      saveDB();
      console.log(`[Local Server DB] Removed order ${sanitizeLog(orderId)} for runner ${sanitizeLog(removedName)}.`);
      res.json({ success: true, message: `Order ${orderId} deleted.` });
    } else {
      res.status(404).json({ error: "Order not found." });
    }
  });

  // DELETE ALL (Reset Queue)
  app.post("/api/orders/reset", (req, res) => {
    orders = {};
    saveDB();
    console.log("[Local Server DB] Active queue completely reset by administrator.");
    res.json({ success: true, message: "Local queue completely cleared." });
  });

  // ========== TIMING CHIP READ APIS ==========
  // Same contract works for manual entry today and a future RFID reader bridge
  // (it just needs to POST here with source: "rfid-bridge" instead of "manual").

  // GET/Read all recorded checkpoint reads
  app.get("/api/chip-reads", (req, res) => {
    res.json({ chipReads: Object.values(chipReads).filter(record => lanPolicy.visible(res.locals.accessSession, 'chipReads', record)) });
  });

  // POST/Create a new chip read
  app.post("/api/chip-reads", (req, res) => {
    const readData = req.body as Partial<ChipRead>;
    if (
      !isValidRecordId(readData.id) ||
      !isValidRecordId(readData.raceId) ||
      typeof readData.bibNumber !== "string" || !readData.bibNumber.trim() || readData.bibNumber.trim().length > 20 ||
      typeof readData.checkpointId !== "string" || !readData.checkpointId.trim() || readData.checkpointId.trim().length > 64 ||
      typeof readData.timestamp !== "string" || !readData.timestamp.trim() || readData.timestamp.length > 64 ||
      (readData.chipId !== undefined && (typeof readData.chipId !== "string" || readData.chipId.trim().length > 128)) ||
      (readData.bridgeEventId !== undefined && !isValidRecordId(readData.bridgeEventId)) ||
      (readData.antenna !== undefined && (!Number.isInteger(readData.antenna) || readData.antenna < 1 || readData.antenna > 8)) ||
      (readData.readerSequence !== undefined && (!Number.isSafeInteger(readData.readerSequence) || readData.readerSequence < 0)) ||
      (readData.monotonicTicks !== undefined && (typeof readData.monotonicTicks !== "string" || readData.monotonicTicks.length > 32)) ||
      (readData.monotonicFrequency !== undefined && (typeof readData.monotonicFrequency !== "string" || readData.monotonicFrequency.length > 32)) ||
      (readData.clockSource !== undefined && (typeof readData.clockSource !== "string" || readData.clockSource.length > 64)) ||
      (readData.source !== undefined && readData.source !== "manual" && readData.source !== "rfid-bridge")
    ) {
      res.status(400).json({ error: "Missing or invalid required fields (id, raceId, bibNumber, checkpointId, timestamp)" });
      return;
    }

    if (!ownRecord(chipReads, readData.id) && Object.keys(chipReads).length >= MAX_LOCAL_CHIP_READS) {
      res.status(507).json({ error: "Local chip-reads capacity reached." });
      return;
    }

    const timestamp = new Date().toISOString();
    const record: ChipRead = {
      id: readData.id,
      raceId: readData.raceId,
      bibNumber: readData.bibNumber.trim(),
      chipId: readData.chipId?.trim() || undefined,
      checkpointId: readData.checkpointId.trim(),
      timestamp: readData.timestamp,
      ...(readData.bridgeEventId ? { bridgeEventId: readData.bridgeEventId, antenna: readData.antenna, readerSequence: readData.readerSequence, monotonicTicks: readData.monotonicTicks, monotonicFrequency: readData.monotonicFrequency, clockSource: readData.clockSource } : {}),
      source: readData.source || 'manual',
      recordedBy: readData.recordedBy || 'unknown',
      createdAt: timestamp,
    };

    chipReads[record.id] = record;
    saveChipReadsDB();

    console.log(`[Local Server DB] Chip read ${sanitizeLog(record.id)} saved for bib ${sanitizeLog(record.bibNumber)} @ checkpoint ${sanitizeLog(record.checkpointId)}.`);
    res.json({ success: true, chipRead: record });
  });

  // DELETE single chip read
  app.delete("/api/chip-reads/:id", (req, res) => {
    const readId = req.params.id;
    if (!isValidRecordId(readId)) {
      res.status(400).json({ error: "Invalid chip read ID." });
      return;
    }
    if (ownRecord(chipReads, readId)) {
      delete chipReads[readId];
      saveChipReadsDB();
      res.json({ success: true, message: `Chip read ${readId} deleted.` });
    } else {
      res.status(404).json({ error: "Chip read not found." });
    }
  });

  // DELETE ALL (Reset timing data)
  app.post("/api/chip-reads/reset", (req, res) => {
    chipReads = {};
    saveChipReadsDB();
    console.log("[Local Server DB] Chip reads completely reset by administrator.");
    res.json({ success: true, message: "Local chip reads completely cleared." });
  });

  // ========== RAW RFID BRIDGE HAND-OFF ==========
  // The VF-787P Windows bridge is the only process that POSTs here.  The web
  // app polls this queue while the operator is in Record Splits mode, then
  // applies its normal runner/chip validation and offline-safe persistence.
  app.get("/api/rfid-events", (req, res) => {
    pruneRfidEvents();
    const raceId = typeof req.query.raceId === 'string' ? req.query.raceId : '';
    const afterRaw = typeof req.query.after === 'string' ? req.query.after : '';
    const after = Date.parse(afterRaw);
    const events = Object.values(rfidEvents)
      .filter((event) => event.raceId === raceId && (Number.isNaN(after) || Date.parse(event.receivedAt) >= after))
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id.localeCompare(b.id));
    res.json({ events });
  });

  app.post("/api/rfid-events", (req, res) => {
    const eventData = req.body as Partial<RfidBridgeEvent>;
    const id = typeof eventData.id === 'string' ? eventData.id.trim() : '';
    const epc = typeof eventData.epc === 'string' ? eventData.epc.trim().toUpperCase() : '';
    const antenna = Number(eventData.antenna);
    const timestamp = typeof eventData.timestamp === 'string' ? eventData.timestamp : '';

    if (
      !isValidRecordId(id) ||
      !/^[0-9A-F]{8,128}$/.test(epc) ||
      !Number.isInteger(antenna) || antenna < 1 || antenna > 8 ||
      timestamp.length > 64 || Number.isNaN(Date.parse(timestamp)) ||
      (eventData.readerSequence !== undefined && (!Number.isSafeInteger(eventData.readerSequence) || eventData.readerSequence < 0)) ||
      (eventData.monotonicTicks !== undefined && (typeof eventData.monotonicTicks !== 'string' || !/^\d{1,30}$/.test(eventData.monotonicTicks))) ||
      (eventData.monotonicFrequency !== undefined && (typeof eventData.monotonicFrequency !== 'string' || !/^\d{1,30}$/.test(eventData.monotonicFrequency)))
    ) {
      res.status(400).json({ error: 'Expected valid id, hexadecimal EPC, antenna (1-8), and ISO timestamp.' });
      return;
    }

    const existingEvent = ownRecord(rfidEvents, id);
    if (existingEvent) { res.json({ success: true, event: existingEvent }); return; }
    pruneRfidEvents();
    if (Object.keys(rfidEvents).length >= MAX_RFID_EVENTS) {
      res.status(507).json({ error: 'RFID event queue capacity reached.' });
      return;
    }
    const event: RfidBridgeEvent = {
      ...(Number.isSafeInteger(eventData.readerSequence) ? { readerSequence: eventData.readerSequence } : {}),
      ...(typeof eventData.monotonicTicks === 'string' ? { monotonicTicks: eventData.monotonicTicks } : {}),
      ...(typeof eventData.monotonicFrequency === 'string' ? { monotonicFrequency: eventData.monotonicFrequency } : {}),
      clockSource: 'bridge-receipt',
      raceId: process.env.RACEPULSE_BRIDGE_RACE_ID,
      id,
      epc,
      antenna,
      timestamp,
      receivedAt: new Date().toISOString(),
    };
    rfidEvents[id] = event;
    saveRfidEventsDB();
    console.log(`[RFID Bridge] EPC ${sanitizeLog(epc)} received from ANT${antenna}.`);
    res.status(201).json({ success: true, event });
  });

  // ========== VITE / STATIC WEB FILES SERVING ==========

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (base === 'index.html' || base === 'sw.js' || base === 'manifest.webmanifest') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 RACEPULSEPH BACKEND HUB RUNNING ONLINE!`);
    console.log(`🔗 Local Terminal Host: http://localhost:${PORT}`);
    console.log(`💻 LAN Wi-Fi Hotspot IP: http://<YOUR_LAPTOP_IP_HERE>:${PORT}`);
    console.log(`======================================================\n`);
  });

  // Mitigate Slowloris / slow-client socket exhaustion
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  const flushOnShutdown = () => {
    if (rfidEventsDirty) saveRfidEventsDBNow();
  };
  process.once('SIGINT', () => {
    flushOnShutdown();
    server.close(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    flushOnShutdown();
    server.close(() => process.exit(0));
  });
}

startServer();
