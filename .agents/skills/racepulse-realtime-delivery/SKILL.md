---
name: racepulse-realtime-delivery
description: Choose and maintain RacePulsePH live update channels across Firestore onSnapshot listeners, LAN HTTP polling in useDualSync and RFID bridge polling. Use when adding or modifying live rankings, broadcast screens, engraving queues or checkpoint scan feeds.
---

# RacePulse real-time delivery channels

Keep live leaderboards, operator dashboards and RFID scan feeds responsive while preventing listener leaks, duplicate subscriptions and unnecessary cloud reads. Covers `src/lib/dualSync.ts`, `src/lib/liveBroadcast.ts`, `src/components/LiveRankingsScreen.tsx` and `server.ts`.

Load with: `racepulse-data-integrity`, `racepulse-delivery-performance`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-35`, `R-36`. Detail: [listener lifecycle and transport selection](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Always return the `unsubscribe()` cleanup function and `clearInterval` timer from every `useEffect` that opens `onSnapshot` or a LAN poller | Unclosed listeners leak memory and multiply Firestore billable reads when operators switch tabs | Inspect cleanup returns in `src/lib/dualSync.ts` lines 78 and 105 to 108 |
| Gate `onSnapshot` and LAN polling behind an explicit `enabled` flag and re-subscribe on access `version` changes | Prevents unauthorized or backgrounded panels from polling endpoints they do not need | Inspect `enabled` and `version` handling in `src/lib/dualSync.ts` lines 32 to 34 and 68 to 80 |
| Provide an error callback on every `onSnapshot` subscription so offline or permission errors degrade gracefully instead of throwing unhandled rejections | Unhandled `onSnapshot` errors crash the listener when Firestore rules deny a query or the network drops | Inspect the error handler in `src/lib/dualSync.ts` lines 75 to 77 |
| Use `useDualSync` (`onSnapshot` + `2000ms` LAN poll) for hybrid cloud/LAN collections (`orders`, `chipReads`) rather than inventing ad-hoc WebSockets | Reuses the tested conflict-resolution and LAN health indicator across all operational screens | Inspect `src/lib/dualSync.ts` and its callers in `src/components/` |
| Keep public live rankings and broadcast screens on scoped Firestore snapshots with in-memory sorting (`src/lib/liveRankings.ts`, `src/lib/liveBroadcast.ts`) | Spectators outside the venue LAN reach only Firebase cloud endpoints | Inspect `src/lib/liveRankings.ts`, `src/lib/liveBroadcast.ts` and `src/components/LiveRankingsScreen.tsx` |

## Stack mapping

- WebSockets / Server-Sent Events in generic architectures map to Cloud Firestore `onSnapshot` persistent streams (`src/lib/dualSync.ts`, `src/lib/liveBroadcast.ts`) for cloud clients.
- Short/long polling maps to the `2000ms` LAN Express poller in `src/lib/dualSync.ts` and the `12000ms` offline queue retry loop in `src/lib/offlineScanQueue.ts`.

## Not covered

- Timestamp tie-breaking and 7-digit tick math belong to `racepulse-reliability-dr`.

## Verify

1. Run `npm run lint` and `node --test tests/timing-sequence.test.cjs`.
2. Inspect every `onSnapshot` and `setInterval` in `src/` to confirm cleanup functions and error callbacks are present, then output the PASS/FAIL report.
