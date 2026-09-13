import express from "express";
import path from "path";
import fs from "fs";
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
}

interface ChipRead {
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
  id: string;
  epc: string;
  antenna: number;
  timestamp: string;
  receivedAt: string;
}

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "local_orders.json");
const CHIP_READS_DB_FILE = path.join(process.cwd(), "local_chip_reads.json");
const RFID_EVENTS_DB_FILE = path.join(process.cwd(), "local_rfid_events.json");

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

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2), "utf-8");
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
    fs.writeFileSync(CHIP_READS_DB_FILE, JSON.stringify(chipReads, null, 2), "utf-8");
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

  const newestFirst = Object.values(rfidEvents)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  for (const event of newestFirst.slice(2_000)) delete rfidEvents[event.id];
}

function saveRfidEventsDB(): void {
  try {
    pruneRfidEvents();
    fs.writeFileSync(RFID_EVENTS_DB_FILE, JSON.stringify(rfidEvents, null, 2), "utf-8");
  } catch (err) {
    console.error("[RFID Bridge] Event queue write failed:", err);
  }
}

async function startServer() {
  const app = express();

  // Allow JSON payloads
  app.use(express.json());

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

  // ========== LOCAL SYNC APIS ==========

  // GET/Read order queue
  app.get("/api/orders", (req, res) => {
    const ordersList = Object.values(orders);
    res.json({ orders: ordersList });
  });

  // POST/Create/Update order
  app.post("/api/orders", (req, res) => {
    const orderData = req.body as Partial<EngravingOrder>;
    if (!orderData.id || !orderData.runnerName || !orderData.bibNumber) {
      res.status(400).json({ error: "Missing required fields (id, runnerName, bibNumber)" });
      return;
    }

    const orderId = orderData.id;
    const existing = orders[orderId];
    const timestamp = new Date().toISOString();

    const merged: EngravingOrder = {
      id: orderId,
      runnerName: orderData.runnerName.trim(),
      bibNumber: orderData.bibNumber.trim(),
      distance: orderData.distance || (existing ? existing.distance : "Marathon"),
      finishingTime: orderData.finishingTime || (existing ? existing.finishingTime : "00:00:00"),
      status: orderData.status || (existing ? existing.status : "queued"),
      createdAt: existing ? existing.createdAt : (orderData.createdAt || timestamp),
      updatedAt: timestamp,
      rank: orderData.rank?.trim() || (existing ? existing.rank : undefined),
      customInscription: orderData.customInscription?.trim() || (existing ? existing.customInscription : undefined),
    };

    orders[orderId] = merged;
    saveDB();

    console.log(`[Local Server DB] Order ${orderId} saved/updated for runner ${merged.runnerName}. Status: ${merged.status}`);
    res.json({ success: true, order: merged });
  });

  // DELETE single order
  app.delete("/api/orders/:id", (req, res) => {
    const orderId = req.params.id;
    if (orders[orderId]) {
      const removedName = orders[orderId].runnerName;
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
    res.json({ chipReads: Object.values(chipReads) });
  });

  // POST/Create a new chip read
  app.post("/api/chip-reads", (req, res) => {
    const readData = req.body as Partial<ChipRead>;
    if (!readData.id || !readData.raceId || !readData.bibNumber || !readData.checkpointId || !readData.timestamp) {
      res.status(400).json({ error: "Missing required fields (id, raceId, bibNumber, checkpointId, timestamp)" });
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
    if (chipReads[readId]) {
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
      .filter((event) => Number.isNaN(after) || Date.parse(event.receivedAt) >= after)
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || a.id.localeCompare(b.id))
      .slice(-500);
    res.json({ events });
  });

  app.post("/api/rfid-events", (req, res) => {
    const eventData = req.body as Partial<RfidBridgeEvent>;
    const id = typeof eventData.id === 'string' ? eventData.id.trim() : '';
    const epc = typeof eventData.epc === 'string' ? eventData.epc.trim().toUpperCase() : '';
    const antenna = Number(eventData.antenna);
    const timestamp = typeof eventData.timestamp === 'string' ? eventData.timestamp : '';

    if (!id || !/^[0-9A-F]{8,128}$/.test(epc) || !Number.isInteger(antenna) || antenna < 1 || antenna > 8 || Number.isNaN(Date.parse(timestamp))) {
      res.status(400).json({ error: 'Expected id, hexadecimal EPC, antenna (1-8), and ISO timestamp.' });
      return;
    }

    const event: RfidBridgeEvent = {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n======================================================`);
    console.log(`🚀 RACEPULSEPH BACKEND HUB RUNNING ONLINE!`);
    console.log(`🔗 Local Terminal Host: http://localhost:${PORT}`);
    console.log(`💻 LAN Wi-Fi Hotspot IP: http://<YOUR_LAPTOP_IP_HERE>:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer();
