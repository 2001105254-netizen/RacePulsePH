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

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "local_orders.json");

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
