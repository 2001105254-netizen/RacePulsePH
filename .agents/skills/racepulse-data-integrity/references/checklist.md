# Data integrity, concurrency and migration checklist

Harvested from the backend concepts list (items 25 to 29, 32, 35 to 40, 81, 82: Database Indexing, Query Optimization, N+1 Queries, Connection Pooling, Read Replicas, Replication, Eventual Consistency, Optimistic Locking, Pessimistic Locking, Distributed Locks, Race Conditions, Deadlocks, Database Migrations, Schema Versioning) and mapped to RacePulsePH.

## 1. Indexing and N+1 query prevention (items 25 to 27)

- **Composite indexes (`firestore.indexes.json`):** preserve existing indexes (such as `accessHistory` by `targetUid` ASC and `at` DESC). Inspect production indexes before adding new composite queries (`racepulse-access-validation`).
- **Single-collection race queries (`functions/race-bib-claim-api.js` lines 72 to 81):** `findRunner` queries `db.collection('runners').where('raceId', '==', raceId).get()` and matches `bibNumber` in memory to avoid requiring a new composite index on every deployment while avoiding N+1 single-document reads.
- **Parallel independent reads:** use `Promise.all([db.doc(...).get(), db.doc(...).get()])` for independent documents (`functions/index.js` line 87, `functions/race-bib-claim-api.js` line 97) instead of sequential awaits.

## 2. Transactions, locking and race conditions (items 36 to 40)

- **Bib number serialization (`functions/index.js` lines 121 to 125, 277 to 285):**
  - Counter document ID: `bibCounters/${counterIdFor(raceId, distance, entryCategory)}`.
  - Both browser-side free registration (`src/lib/raceRegistration.ts`) and webhook paid registration (`functions/index.js`) increment the same counter inside a Firestore transaction so two runners never receive the same bib.
- **Deterministic document IDs as distributed locks:**
  - `runners/${uid}_${raceId}`, `pendingRegistrations/${uid}_${raceId}` and `runnerClaims/${uid}_${raceId}` guarantee at the key level that a user can hold only one entry per race.
- **Deadlock avoidance:** Cloud Firestore transactions use optimistic concurrency control on server side and SDK side (read all documents first, then issue writes). Never nest a second `db.runTransaction` inside a transaction callback.

## 3. Eventual consistency and cloud/LAN dual sync (items 29, 32, 35)

- `src/lib/dualSync.ts` merges live Firestore `onSnapshot` documents with the on-site LAN Express server (`/api/orders`, `/api/chip-reads`) by comparing `new Date(getUpdatedAt(item)).getTime()`.
- Every mutation on `server.ts` stamps `updatedAt = new Date().toISOString()` (`server.ts` line 221) so the latest edit wins across cloud and LAN.

## 4. Schema versioning and migrations (items 81 and 82)

- **Cloud migrations (`scripts/migrate-access.cjs`):** default to dry-run reporting unless `--apply` is passed, use transactions, and verify the fresh `output/rbac-verification.json` source hash before `--activate`.
- **Browser storage versioning (`src/lib/offlineScanQueue.ts` lines 42 to 45):** migrates only the signed-in actor's records from `racepulse_pending_chip_reads_v1` into `racepulse_pending_chip_reads_v2:${uid}:${raceId}` while leaving other actors' legacy items intact.
- **Display format backward compatibility (`src/lib/preciseTime.ts` lines 30 to 36):** `formatRaceTime` normalizes both legacy `HH:MM:SS.fffffff` and compact `HH:MM:SSfffff` strings without mutating stored raw ISO timestamps (`docs/finish-precision.md`).
