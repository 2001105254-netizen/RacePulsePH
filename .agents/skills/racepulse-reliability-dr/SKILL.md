---
name: racepulse-reliability-dr
description: Maintain RacePulsePH race-day continuity across network partitions, local JSON persistence, monotonic clock skew protection, 7-digit BigInt tick precision and incident recovery. Use when editing timing calculations, server.ts storage, rfid-bridge, rfid-station or recovery scripts.
---

# RacePulse race-day reliability and disaster recovery

Keep checkpoint timing, finisher rankings and engraving orders accurate when venue internet drops, processes restart or clocks drift. Covers `src/lib/preciseTime.ts`, `src/lib/liveRankings.ts`, `src/lib/entrySequence.ts`, `server.ts`, `rfid-bridge/` and `rfid-station/`.

Load with: `racepulse-data-integrity`, `racepulse-resilience-patterns`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-35`, `R-36`. Detail: [partition survival, clock precision and recovery checklist](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Persist LAN server state to disk (`local_orders.json`, `local_chip_reads.json`, `local_rfid_events.json`) inside user-writable `RACEPULSE_DATA_DIR` | `Timing Station.exe` runs under `Program Files` where normal writes fail unless redirected to a writable directory | Inspect `DATA_DIRECTORY`, `saveDB`, `saveChipReadsDB` and `saveRfidEventsDB` in `server.ts` lines 65 to 150 |
| Survive venue internet partitions by combining `src/lib/offlineScanQueue.ts` (`localStorage`) with `src/lib/dualSync.ts` (LAN + Firestore merge) | Remote trail and road checkpoints frequently lose cellular connectivity during a race | Inspect `useOfflineScanQueue` (`src/lib/offlineScanQueue.ts`) and `useDualSync` (`src/lib/dualSync.ts`) |
| Parse and rank timestamps with `BigInt` 100-nanosecond ticks (`timestampTicks` in `src/lib/preciseTime.ts`) and never pass raw epoch ticks through `Number` or `Date` | JavaScript `Date` truncates to 3 millisecond digits and `Number` loses sub-millisecond precision | Inspect `timestampTicks`, `elapsedSeconds` and `formatElapsed` in `src/lib/preciseTime.ts` and `finishScanOrder` in `src/lib/liveRankings.ts` |
| Preserve sporting ties on equal elapsed times (`1, 1, 3`) and never break an official placing tie by bib number (`docs/finish-precision.md`) | Breaking an exact time tie by bib number fabricates a winner without timing evidence (C-5, R-36) | Inspect `docs/finish-precision.md` and run `node --test tests/timing-sequence.test.cjs` |
| Retain monotonic clock diagnostics (`monotonicTicks`, `monotonicFrequency`, `clockSource`) and reject negative elapsed durations (`b < a` returns `undefined`) | Protects results against wall-clock NTP jumps on the Windows timing laptop | Inspect `elapsedSeconds` (`if (a === undefined || b === undefined || b < a) return undefined`) in `src/lib/preciseTime.ts` line 14 |
| Keep scan undo/re-entry and consecutive-entry recalculation (`src/lib/entrySequence.ts`) non-destructive | Operators must be able to correct an erroneous scan during a race incident without corrupting linked bibs | Inspect `src/lib/entrySequence.ts` and `docs/live-rankings.md` |

## Stack mapping

- Network partitions map to venue cellular blackouts handled by `src/lib/offlineScanQueue.ts`, `src/lib/dualSync.ts` and `server.ts`.
- Clock skew and precision map to `src/lib/preciseTime.ts`, `rfid-bridge/RfidBridgeService.cs` and `docs/finish-precision.md`.

## Not covered

- Cloud Functions rate limiting and PayMongo webhook retries belong to `racepulse-resilience-patterns`.

## Verify

1. Run `node --test tests/timing-sequence.test.cjs` and `npm run lint`.
2. Output the PASS/FAIL report with test results, precision checks and a 1-line purpose log.
