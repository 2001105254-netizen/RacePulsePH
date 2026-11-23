# ADR-001: Hybrid Cloud + On-Site LAN Timing Architecture & Dual-Sync

- **Status:** Accepted
- **Date:** 2026-11-23
- **Owners:** RacePulsePH Engineering

## Context
Philippine road and trail events frequently operate finish-line timing and medal engraving stations under degraded or interrupted cellular connectivity. Cloud Firestore alone cannot guarantee zero-latency on-site hardware delivery from the VF-787P UHF RFID reader (`rfid-bridge`), while a LAN-only store cannot serve public spectator results or multi-device runner profiles.

## Decision
1. **Modular Cloud + LAN Hybrid:**
   - Cloud control plane & public distribution: Firebase Auth, Cloud Firestore (generated rules via `scripts/build-access-rules.cjs`), Firebase Storage, and Node 22 Cloud Functions (`functions/`).
   - Race-day LAN hub: Express server (`server.ts`, compiled to `dist/server.cjs`) backed by atomic JSON persistence (`writeJsonAtomicAsync` with Windows `EPERM`/`EBUSY` retry and explicit `503` failure reporting, never silent `200 OK`) and readiness checks (`GET /api/readyz`).
   - Dual-Sync blending (`src/lib/dualSync.ts`): Blends Firestore `onSnapshot` streams with `GET /api/*?raceId=...` polling, keyed by `queryKey` and resolved by timestamp.
2. **7-Digit Sub-Millisecond Precision:**
   - Timestamps emitted by `.NET` hardware bridges (`HH:mm:ss.fffff` / ISO `O`) are converted to `BigInt` 100-nanosecond ticks (`src/lib/preciseTime.ts`), preventing `Number` or `Date.parse` truncation across elapsed calculations (`elapsedSeconds`) and tie-break sorting (`compareReadOrder`, `compareResultFinishOrder`).
3. **Resilient Hardware Bridge Spooling:**
   - `RfidBridgeService` (`rfid-bridge/`) writes reads to an NDJSON disk spool (`spool.ndjson`), retries FIFO from the queue head with exponential backoff and jitter, and quarantines non-transient `4xx` responses to `dead-letter.ndjson`.

## Consequences & Revisit Triggers
- Requires keeping `functions/lan-policy.js` field-immutability parity aligned with Firestore Rules.
- **Revisit trigger:** Sustained race concurrency above a single LAN node's JSON write throughput (>10,000 reads per event or multi-station active-active LAN replication) warrants migrating `server.ts` local state from JSON files to SQLite WAL.
