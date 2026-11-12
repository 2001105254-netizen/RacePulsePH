---
name: racepulse-data-integrity
description: Preserve RacePulsePH Firestore concurrency, bib counter serialization, composite indexes, query efficiency, dual-sync merge rules and backward-compatible schema migrations. Use when writing Firestore transactions, queries, indexes, bib assignment logic or migration scripts.
---

# RacePulse data integrity and concurrency

Prevent race conditions, duplicate bib numbers, lost updates and unindexed query failures across Firestore and the on-site LAN store. Covers `functions/index.js`, `functions/race-bib-claim-api.js`, `src/lib/raceRegistration.ts`, `src/lib/dualSync.ts`, `firestore.indexes.json` and `scripts/migrate-access.cjs`.

Load with: `racepulse-access`, `racepulse-access-validation`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-35`, `R-36`. Detail: [concurrency, indexing and migration rules](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Use identical `counterIdFor(raceId, distance, entryCategory)` keys inside `runTransaction` for both free/manual and PayMongo registrations | Prevents a paid runner and a free or manual entry in the same category from receiving the same bib number | Compare `counterIdFor` in `functions/index.js` lines 121 to 125 with `src/lib/raceRegistration.ts` |
| Key runner and pending registration documents deterministically as `${uid}_${raceId}` and check existence inside a transaction | Prevents a single account from creating duplicate registrations for the same race under concurrent clicks | Inspect `runners/${uid}_${raceId}` and `pendingRegistrations/${uid}_${raceId}` in `functions/index.js` and `functions/race-bib-claim-api.js` |
| Perform all reads before writes inside `db.runTransaction` and commit access history in the same transaction as role mutations | Firestore transactions require reads before writes, and partial access updates corrupt audit trails | Inspect `functions/access-service.js`, `functions/index.js` and `scripts/migrate-access.cjs` |
| Scope Firestore queries by a single indexed equality (`where('raceId', '==', raceId)`) or register required composite indexes in `firestore.indexes.json` | Avoids runtime missing-index failures and N+1 per-runner document fetches | Inspect `findRunner` in `functions/race-bib-claim-api.js` lines 72 to 81 and `firestore.indexes.json` |
| Resolve cloud-vs-LAN conflicts in `src/lib/dualSync.ts` deterministically by comparing ISO `updatedAt` timestamps (`timeNew >= timeExisting`) | Keeps operator tablets and cloud views consistent when LAN and Firestore updates arrive out of order | Inspect `mergeAndPublish` in `src/lib/dualSync.ts` lines 42 to 64 |
| Write schema migrations as idempotent, dry-runnable scripts (`scripts/migrate-access.cjs`) and normalize legacy formats at read time (`src/lib/preciseTime.ts`) | Protects existing production race records and local storage queues during upgrades | Inspect `scripts/migrate-access.cjs`, `src/lib/preciseTime.ts` (`formatRaceTime`) and `v1`-to-`v2` queue migration in `src/lib/offlineScanQueue.ts` |

## Stack mapping

- Optimistic locking in Firestore is implemented via `db.runTransaction(...)` (which retries automatically on document contention) and explicit revision checks in `functions/access-service.js`.
- Read replicas and replication are managed by Cloud Firestore; on-site high availability uses the dual-sync LAN store (`server.ts` + `src/lib/dualSync.ts`).

## Not covered

- Network timeouts and webhook retry headers belong to `racepulse-resilience-patterns`.
- Sub-millisecond tick math and clock skew belong to `racepulse-reliability-dr`.

## Verify

1. Run `npm run lint`, `node --test tests/timing-sequence.test.cjs` and `npm run verify:rbac` (when emulators are available).
2. Output the PASS/FAIL report with transaction and query evidence.
