---
name: racepulse-observability
description: Implement and verify RacePulsePH health checks, LAN/bridge liveness status, structured credential-safe logging, operational diagnostics and error-rate alerts. Use when adding logging, health endpoints, bridge diagnostics or monitoring checks.
---

# RacePulse observability, logging and health probes

Make failures in Cloud Functions, SMTP delivery, PayMongo webhooks, the LAN server (`server.ts`) and the RFID bridge (`rfid-bridge/`) immediately diagnosable without leaking secrets or runner PII.

Load with: `racepulse-access`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-27`, `R-35`, `R-36`. Detail: [health probes, logging and SLI checklist](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Surface real-time LAN connectivity (`lanConnected` in `src/lib/dualSync.ts`) and pending offline scan counts (`pendingCount`, `queueError` in `src/lib/offlineScanQueue.ts`) in operator screens | Timing operators on course need immediate visual notice when the LAN server or cloud sync drops (R-27) | Inspect `useDualSync` in `src/lib/dualSync.ts` and `useOfflineScanQueue` in `src/lib/offlineScanQueue.ts` |
| Emit structured diagnostic context (`paymentId`, `route`, `category`) in Cloud Functions logs while stripping tokens, codes, passwords, request bodies and raw SMTP errors | Raw SMTP or auth errors can leak credentials or 6-digit verification codes into Cloud Logging | Inspect `console.error` in `functions/auth-api.js` line 58, `functions/account-security.js` line 74 and `functions/index.js` lines 237 and 310 |
| Preserve RFID bridge diagnostic fields (`bridgeEventId`, `readerSequence`, `monotonicTicks`, `monotonicFrequency`, `clockSource`, `antenna`, `receivedAt`) through `server.ts` | Gives operators verifiable evidence to audit burst reads, dropped sequence numbers or reader reconnects (`docs/finish-precision.md`) | Inspect `ChipRead` and `RfidBridgeEvent` interfaces in `server.ts` lines 23 to 58 |
| Provide deterministic CLI diagnostic scripts (`scripts/check-account-email.cjs`, `scripts/preview-account-emails.cjs`, `scripts/smoke-access.cjs`) for pre-race readiness checks | Lets operators verify SMTP configuration and access endpoints before race morning | Inspect `scripts/check-account-email.cjs` and `scripts/smoke-access.cjs` |
| Define SLIs and SLO targets only from owner-approved requirements and never fabricate uptime or accuracy claims in UI copy | Invented SLA percentages or accuracy claims violate `R-36` and `C-5` | Grep `src/` and `docs/` for uptime or accuracy claims and confirm compliance with `docs/finish-precision.md` |

## Stack mapping

- Liveness and readiness probes map to `lanConnected` in `src/lib/dualSync.ts`, `accessApi/session` checks in `server.ts` and `src/lib/offlineScanQueue.ts`, and `scripts/smoke-access.cjs`.
- Distributed correlation across the RFID reader, LAN server and Firestore uses `bridgeEventId`, `readerSequence` and `paymentId`.

## Not covered

- Backup schedules and offline recovery procedures belong to `racepulse-reliability-dr`.

## Verify

1. Run `npm run lint` and inspect every `console.log`, `console.warn` and `console.error` in `functions/` and `server.ts` for secret or PII leakage.
2. Output the PASS/FAIL report with log-safety evidence and a 1-line purpose log.
