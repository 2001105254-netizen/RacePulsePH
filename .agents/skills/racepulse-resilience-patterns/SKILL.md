---
name: racepulse-resilience-patterns
description: Design and verify RacePulsePH timeouts, retries, idempotency keys, webhook deduplication, offline scan queues and backpressure across Cloud Functions, PayMongo, SMTP and the LAN server. Use when editing network calls, webhooks, background queues or RFID event ingestion.
---

# RacePulse resilience and fault-tolerance patterns

Keep registrations, payments, emails and race-day timing splits reliable when external networks slow down, retry or drop out. Covers `functions/index.js`, `functions/auth-api.js`, `functions/account-security.js`, `server.ts` and `src/lib/offlineScanQueue.ts`.

Load with: `racepulse-access`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-35`, `R-36`. Detail: [resilience patterns and repo mapping](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Enforce rate limits and `Retry-After` headers on code and auth endpoints (`functions/account-security.js`, `functions/auth-api.js`) | Stops retry storms and abuse while telling the client exactly how long to wait | Inspect `AccountError` `retryAfter` handling in `functions/account-security.js` and `functions/auth-api.js` |
| Set explicit timeouts on outbound network and SMTP calls (`AbortSignal.timeout(8000)` in `server.ts`, `15000ms`/`30000ms` in `functions/auth-api.js`) | Prevents hung sockets from exhausting Function or LAN server concurrency | Inspect `fetch` timeout in `server.ts` line 182 and `nodemailer.createTransport` timeouts in `functions/auth-api.js` line 30 |
| Make checkout creation and webhook processing idempotent (`Idempotency-Key: paymentId`, 30-minute pending session reuse, `payment.status === 'paid'` guard) | Duplicate clicks or PayMongo webhook retries must never double-charge or issue two bibs | Inspect `createCheckout` lines 170 to 209 and `handleWebhook` lines 268 to 308 in `functions/index.js` |
| Invalidate failed outbound deliveries safely without clobbering newer requests (`functions/account-security.js` lines 76 to 79) | If SMTP fails, the user must be able to retry without a stale challenge blocking them | Inspect the compensation transaction in `functions/account-security.js` |
| Buffer offline timing scans in `src/lib/offlineScanQueue.ts` and re-verify permissions before replaying on reconnect (`online`, `focus`, `12s` interval) | Race-course checkpoints often lose mobile signal; scans must persist locally and replay safely | Inspect `useOfflineScanQueue` in `src/lib/offlineScanQueue.ts` |
| Retain raw RFID bridge events in `server.ts` (`local_rfid_events.json`) across a 12-hour recovery window without dropping high-volume finish bursts | Pack finishes generate rapid EPC bursts that must survive browser refreshes or server restarts | Inspect `pruneRfidEvents` and `saveRfidEventsDB` in `server.ts` lines 132 to 150 |

## Stack mapping

- Message queues and Dead Letter Queues map to `useOfflineScanQueue` (`localStorage` key `racepulse_pending_chip_reads_v2:${uid}:${raceId}` with `queueError` hold-for-review state) and `local_rfid_events.json` in `server.ts`.
- Webhooks map to `POST /webhooks/paymongo` in `functions/index.js`.

## Not covered

- Firestore transaction locking and bib counter serialization belong to `racepulse-data-integrity`.
- Multi-hour disaster recovery and clock precision belong to `racepulse-reliability-dr`.

## Verify

1. Run `npm run lint` and `npm run verify:rbac` (which exercises duplicate requests and offline replay checks).
2. Output the PASS/FAIL report with evidence for every network boundary touched.
