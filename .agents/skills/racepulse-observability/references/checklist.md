# Observability, logging and health probes checklist

Harvested from the backend concepts list (items 56 to 66: Health Checks, Liveness and Readiness Probes, Monitoring, Logging, Distributed Tracing, Metrics, Alerts, SLOs, SLIs, Error Budgets, Observability) and mapped to RacePulsePH.

## 1. Health checks and readiness probes (items 56 and 57)

- **LAN server readiness (`src/lib/dualSync.ts` lines 86 to 100):** `pollLocalServer` polls the local Express server every `2000ms` and updates `lanConnected` (`true`, `false` or `null` during initial load) so `OperatorDashboard` and `TimingConsole` reflect real LAN health.
- **Authorization readiness (`server.ts` line 182, `src/lib/offlineScanQueue.ts` line 24):** probes `accessApi/session` before committing or replaying scans, returning HTTP `503` if cloud authorization cannot be confirmed so work stays safely queued.
- **Pre-race smoke checks:**
  - `scripts/check-account-email.cjs` and `scripts/preview-account-emails.cjs` verify SMTP configuration (`docs/ACCOUNT_EMAIL_SETUP.md`, `docs/EMAIL_DELIVERABILITY.md`).
  - `scripts/smoke-access.cjs` checks deployed access endpoints.

## 2. Structured, credential-safe logging (item 59)

- **Hard rule (`functions/auth-api.js` line 57, `functions/account-security.js` line 74):**
  - Never log `req.body`, `Authorization` headers, 6-digit verification codes, password reset tokens, passwords or raw `nodemailer` SMTP error objects (which can echo `SMTP_APP_PASSWORD` in authentication diagnostics).
  - Log only safe correlation identifiers: `{ route, category: 'internal' }` or `{ paymentId, message: error.message }`.

## 3. Distributed correlation across hardware, LAN and cloud (item 60)

- **Payment correlation:** `paymentId` (`pay_<timestamp>_<randomHex>`) links the browser return URL (`?payment=`), the PayMongo Checkout `reference_number` and `Idempotency-Key`, the `payments/${paymentId}` document, the `pendingRegistrations/${uid}_${raceId}` document and `runners/${uid}_${raceId}.paymentId`.
- **RFID timing correlation (`server.ts` lines 23 to 58, `docs/finish-precision.md`):**
  - `bridgeEventId`, `readerSequence`, `monotonicTicks`, `monotonicFrequency`, `clockSource`, `antenna` and `receivedAt` trace an EPC sighting from `rfid-bridge/RfidBridgeService.cs` through `local_rfid_events.json` into the confirmed `ChipRead` record.

## 4. SLIs, SLOs and honest measurement (items 61 to 66)

- **Candidate SLIs for RacePulsePH:**
  - Webhook completion rate (`POST /webhooks/paymongo` HTTP `200` vs `500`).
  - Account email delivery success rate (`requestCode` HTTP `200` vs `503` in `functions/account-security.js`).
  - Pending offline scan queue depth (`pendingCount` and `queueError` in `src/lib/offlineScanQueue.ts`).
  - Reader sequence continuity (`readerSequence` gaps per antenna).
- **Evidence gate (`R-36`, `C-5`, `docs/finish-precision.md`):** never invent SLO percentages or timing accuracy numbers. As documented in `docs/finish-precision.md`, retained 7-digit timestamp precision (`0.1` microsecond tick units) is for calculation and tie preservation and does not establish hardware detection accuracy unless calibrated against finish-line camera footage.
