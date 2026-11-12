# Resilience and fault-tolerance checklist

Harvested from the backend concepts list (items 1, 10 to 17, 20, 21, 44, 101: Rate Limiting, Circuit Breakers, Timeouts, Retries, Exponential Backoff, Idempotency, Message Queues, Pub/Sub, Event-Driven Architecture, Dead Letter Queues, Cron Jobs, Backpressure, Webhooks) and mapped to RacePulsePH.

## 1. Rate limiting and Retry-After (item 1)

- `functions/account-security.js` enforces:
  - Per-IP limit: `60` requests per hour in `accountRateLimits/${hash('ip:' + ip)}`.
  - Per-email cooldown: `60` seconds between sends and `5` sends per hour in `accountChallenges/${hash(purpose + ':' + email)}`.
- `functions/auth-api.js` translates `error.retryAfter` into the standard HTTP `Retry-After` header alongside the JSON `retryAfter` field so the UI can display an accurate countdown.

## 2. Timeouts and failing closed (items 10 and 11)

- **LAN server authorization check (`server.ts` line 182):** uses `AbortSignal.timeout(8000)` when calling `accessApi/session`. If the cloud endpoint is unreachable or times out, `server.ts` returns `503` (`Authorization is unavailable. Captured scans remain queued.`) so the client keeps scans in its local queue rather than dropping them or bypassing auth.
- **SMTP transport (`functions/auth-api.js` line 30):** sets `connectionTimeout: 15000`, `greetingTimeout: 15000` and `socketTimeout: 30000`.

## 3. Idempotency and webhook deduplication (items 14 and 101)

- **PayMongo checkout (`functions/index.js`):**
  - Reuses an existing `creating` or `pending` session in `pendingRegistrations/${uid}_${raceId}` if created within the last 30 minutes (`lines 174-179`).
  - Sends `'Idempotency-Key': paymentId` to `https://api.paymongo.com/v2/checkout_sessions` (`line 208`).
- **PayMongo webhook (`handleWebhook` in `functions/index.js`):**
  - Verifies the `paymongo-signature` HMAC first.
  - Runs inside `db.runTransaction`. If `payment.status === 'paid'`, returns `200 { received: true }` immediately without incrementing `bibCounters` a second time (`line 272`).
- **RFID chip reads (`server.ts` and `src/lib/offlineScanQueue.ts`):**
  - Uses deterministic or caller-generated `record.id` values with `setDoc(doc(db, 'chipReads', record.id), record)` so replaying a queued scan overwrites the same document idempotently.

## 4. Queues, backpressure and dead-letter handling (items 15 to 17, 20, 44)

- **Browser offline scan queue (`src/lib/offlineScanQueue.ts`):**
  - Persists unconfirmed `ChipRead` items in `localStorage` under `racepulse_pending_chip_reads_v2:${uid}:${raceId}`.
  - Guards concurrent flushes with `flushing.current` (single-flight backpressure).
  - Retries on `window` `online`, `focus` and a `12000ms` interval.
  - Holds rejected items in the queue and surfaces `queueError` (`Race access changed. Queued scans require review.`) as a dead-letter state until an operator inspects or discards them.
- **RFID bridge hand-off queue (`server.ts`):**
  - Persists raw `RfidBridgeEvent` sightings in `local_rfid_events.json` and prunes only entries older than 12 hours (`pruneRfidEvents`), preserving all events during high-density finish bursts (`docs/finish-precision.md`).
