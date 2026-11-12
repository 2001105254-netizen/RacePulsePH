import { formatRaceTime } from './src/lib/preciseTime';
import express from "express";
import path from "path";
import fs from "fs";
import crypto from 'crypto';
import * as lanPolicy from './functions/lan-policy.js';
import { createServer as createViteServer } from "vite";

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

function isValidRecordId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID_RE.test(value) && !FORBIDDEN_IDS.has(value);
}

function ownRecord<T>(store: Record<string, T>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.hasOwn(store, id) ? store[id] : undefined;
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
let orders: Record<string, EngravingOrder> = {};
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    orders = JSON.parse(raw);
    console.log(`[Local Server DB] Loaded ${Object.keys(orders).length} orders from storage.`);
  }
} catch (e) {
  console.warn("[Local Server DB] Failed to parse localdb file, running with fresh store:", e);
  orders = {};
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const serialized = JSON.stringify(data, null, 2);
  const tmpFile = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpFile, serialized, "utf-8");
    fs.renameSync(tmpFile, filePath);
  } catch {
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
let chipReads: Record<string, ChipRead> = {};
try {
  if (fs.existsSync(CHIP_READS_DB_FILE)) {
    const raw = fs.readFileSync(CHIP_READS_DB_FILE, "utf-8");
    chipReads = JSON.parse(raw);
    console.log(`[Local Server DB] Loaded ${Object.keys(chipReads).length} chip reads from storage.`);
  }
} catch (e) {
  console.warn("[Local Server DB] Failed to parse chip reads localdb file, running with fresh store:", e);
  chipReads = {};
}

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
let rfidEvents: Record<string, RfidBridgeEvent> = {};
try {
  if (fs.existsSync(RFID_EVENTS_DB_FILE)) {
    const raw = fs.readFileSync(RFID_EVENTS_DB_FILE, "utf-8");
    rfidEvents = JSON.parse(raw);
    console.log(`[RFID Bridge] Loaded ${Object.keys(rfidEvents).length} pending RFID events.`);
  }
} catch (e) {
  console.warn("[RFID Bridge] Failed to parse local RFID event store, starting fresh:", e);
  rfidEvents = {};
}

function pruneRfidEvents(): void {
  const oldestAllowed = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, event] of Object.entries(rfidEvents)) {
    if (Number.isNaN(Date.parse(event.receivedAt)) || Date.parse(event.receivedAt) < oldestAllowed) {
      delete rfidEvents[id];
    }
  }

  // Retain every event within the recovery window, including large bursts.
}

function saveRfidEventsDB(): void {
  try {
    pruneRfidEvents();
    writeJsonAtomic(RFID_EVENTS_DB_FILE, rfidEvents);
  } catch (err) {
    console.error("[RFID Bridge] Event queue write failed:", err);
  }
}

async function startServer() {
  const app = express();

  // Allow bounded JSON payloads
  app.use(express.json({ limit: "64kb" }));

  // CORS Headers (so if they reference local server IP from another subnet, browser doesn't block it)
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
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

  app.use('/api', async (req, res, next) => {
    const route = '/api' + req.path;
    if (route === '/api/rfid-events' && req.method === 'POST') {
      const expected = process.env.RACEPULSE_BRIDGE_KEY || '';
      const supplied = req.get('X-RacePulse-Bridge-Key') || '';
      if (expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) || !process.env.RACEPULSE_BRIDGE_RACE_ID) return res.status(401).json({ error: 'Bridge pairing is required.' });
      return next();
    }
    try {
      const bearer = req.get('Authorization');
      if (!bearer?.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in to use race-day services.' });
      const endpoint = process.env.RACEPULSE_ACCESS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi';
      const response = await fetch(endpoint + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: bearer }, body: JSON.stringify(route === '/api/chip-reads' && req.method === 'POST' ? { scanningRaceId: req.body?.raceId } : {}), signal: AbortSignal.timeout(8000) });
      if (!response.ok) return res.status(response.status).json({ error: 'Current authorization could not be confirmed. Work remains queued.' });
      const session = await response.json();
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
      if (!lanPolicy.authorize(session, req.method, route, { ...req.body, raceId: req.query.raceId || req.body?.raceId }, existing)) return res.status(403).json({ error: 'This action is disabled for your account or race.' });
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
      (orderData.status !== undefined && !VALID_ORDER_STATUSES.has(orderData.status)) ||
      (orderData.rank !== undefined && (typeof orderData.rank !== "string" || orderData.rank.trim().length > 50)) ||
      (orderData.customInscription !== undefined && (typeof orderData.customInscription !== "string" || orderData.customInscription.trim().length > 150))
    ) {
      res.status(400).json({ error: "Missing or invalid required fields (id, runnerName, bibNumber, status)" });
      return;
    }

    const orderId = orderData.id;
    const existing = ownRecord(orders, orderId);
    const timestamp = new Date().toISOString();

    const merged: EngravingOrder = {
      id: orderId,
      runnerName: orderData.runnerName.trim(),
      bibNumber: orderData.bibNumber.trim(),
      distance: orderData.distance || (existing ? existing.distance : "Marathon"),
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

    console.log(`[Local Server DB] Order ${orderId} saved/updated for runner ${merged.runnerName}. Status: ${merged.status}`);
    res.json({ success: true, order: merged });
  });

  // DELETE single order
  app.delete("/api/orders/:id", (req, res) => {
    const orderId = req.params.id;
    const existing = ownRecord(orders, orderId);
    if (existing) {
      const removedName = existing.runnerName;
      delete orders[orderId];
      saveDB();
      console.log(`[Local Server DB] Removed order ${orderId} for runner ${removedName}.`);
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
      (readData.source !== undefined && readData.source !== "manual" && readData.source !== "rfid-bridge")
    ) {
      res.status(400).json({ error: "Missing or invalid required fields (id, raceId, bibNumber, checkpointId, timestamp)" });
      return;
    }

    const timestamp = new Date().toISOString();
    const record: ChipRead = {
      id: readData.id,
      raceId: readData.raceId,
      bibNumber: readData.bibNumber.trim(),
      chipId: readData.chipId?.trim() || undefined,
      checkpointId: readData.checkpointId,
      timestamp: readData.timestamp,
      ...(readData.bridgeEventId ? { bridgeEventId: readData.bridgeEventId, antenna: readData.antenna, readerSequence: readData.readerSequence, monotonicTicks: readData.monotonicTicks, monotonicFrequency: readData.monotonicFrequency, clockSource: readData.clockSource } : {}),
      source: readData.source || 'manual',
      recordedBy: readData.recordedBy || 'unknown',
      createdAt: timestamp,
    };

    chipReads[record.id] = record;
    saveChipReadsDB();

    console.log(`[Local Server DB] Chip read ${record.id} saved for bib ${record.bibNumber} @ checkpoint ${record.checkpointId}.`);
    res.json({ success: true, chipRead: record });
  });

  // DELETE single chip read
  app.delete("/api/chip-reads/:id", (req, res) => {
    const readId = req.params.id;
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
    const afterRaw = typeof req.query.after === 'string' ? req.query.after : '';
    const after = Date.parse(afterRaw);
    const events = Object.values(rfidEvents)
      .filter((event) => event.raceId === req.query.raceId && (Number.isNaN(after) || Date.parse(event.receivedAt) >= after))
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id.localeCompare(b.id));
    res.json({ events: events.filter(event => event.raceId === req.query.raceId) });
  });

  app.post("/api/rfid-events", (req, res) => {
    const eventData = req.body as Partial<RfidBridgeEvent>;
    const id = typeof eventData.id === 'string' ? eventData.id.trim() : '';
    const epc = typeof eventData.epc === 'string' ? eventData.epc.trim().toUpperCase() : '';
    const antenna = Number(eventData.antenna);
    const timestamp = typeof eventData.timestamp === 'string' ? eventData.timestamp : '';

    if (!isValidRecordId(id) || !/^[0-9A-F]{8,128}$/.test(epc) || !Number.isInteger(antenna) || antenna < 1 || antenna > 8 || Number.isNaN(Date.parse(timestamp))) {
      res.status(400).json({ error: 'Expected valid id, hexadecimal EPC, antenna (1-8), and ISO timestamp.' });
      return;
    }

    const existingEvent = ownRecord(rfidEvents, id);
    if (existingEvent) { res.json({ success: true, event: existingEvent }); return; }
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
    console.log(`[RFID Bridge] EPC ${epc} received from ANT${antenna}.`);
    res.status(201).json({ success: true, event });
  });

  // ========== VITE / STATIC WEB FILES SERVING ==========

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 RACEPULSEPH BACKEND HUB RUNNING ONLINE!`);
    console.log(`🔗 Local Terminal Host: http://localhost:${PORT}`);
    console.log(`💻 LAN Wi-Fi Hotspot IP: http://<YOUR_LAPTOP_IP_HERE>:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer();
