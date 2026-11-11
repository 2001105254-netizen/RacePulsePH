# Real-time delivery channels and listener lifecycle checklist

Harvested from the backend concepts list (items 22 to 24: WebSockets, Long Polling, Server-Sent Events) and mapped to RacePulsePH's hybrid Cloud Firestore + on-site LAN architecture (`src/lib/dualSync.ts`, `src/lib/liveBroadcast.ts`, `src/lib/liveRankings.ts`, `server.ts`).

## 1. Transport selection in RacePulsePH (items 22 to 24)

| Use case | Transport used in RacePulsePH | Why this transport fits |
| --- | --- | --- |
| Public live rankings and spectator screens (`src/components/LiveRankingsScreen.tsx`, `src/components/PublicLiveRaceHub.tsx`) | Cloud Firestore `onSnapshot` | Spectators are on mobile networks outside the venue LAN; Firestore manages persistent connections, reconnection and fan-out automatically. |
| Operator engraving queue and checkpoint timing (`src/lib/dualSync.ts`) | Hybrid: Firestore `onSnapshot` + `2000ms` HTTP poll to `server.ts` (`/api/orders`, `/api/chip-reads`) | Combines cloud visibility with zero-internet local LAN survival inside the race tent. |
| Windows RFID reader bridge to `server.ts` (`rfid-bridge/` to `/api/rfid-events`) | Authenticated HTTP POST (`X-RacePulse-Bridge-Key`) into durable `local_rfid_events.json` queue, polled by the Timing Console | Decouples the C# reader process from browser tab reloads and preserves a 12-hour event recovery window. |
| Offline checkpoint scan replay (`src/lib/offlineScanQueue.ts`) | Event-driven (`online`, `focus`) + `12000ms` interval flush | Replays local `localStorage` scans as soon as cellular signal returns without holding open sockets. |

## 2. Listener lifecycle and memory-leak prevention (item 41)

- **Mandatory cleanup:** every `onSnapshot(...)` call inside a React `useEffect` must return `() => unsubscribe()`, and every `setInterval(...)` must return `() => clearInterval(interval)` (`src/lib/dualSync.ts` lines 78 and 107).
- **In-flight guard on async pollers:** set `let active = true` inside the effect and `active = false` in the cleanup before calling `setState` after an `await` (`src/lib/dualSync.ts` lines 85 to 108).
- **Reset on disable or scope change:** when `enabled` becomes `false` or the user's access `version` changes, clear cached refs (`firestoreItemsRef.current = []`, `lanItemsRef.current = []`) so data from a previous account or race never flashes on screen (`src/lib/dualSync.ts` lines 68 to 70).

## 3. Arrival order vs sporting rank (`docs/live-rankings.md`)

- In `src/lib/liveRankings.ts`, `finishScanOrder` computes `scanOrder` from `finishTicks` (`BigInt` 100-nanosecond ticks) as the arrival order across all distances, while each entry's `result.rank` preserves its official division or age-category placing. Keep both values distinct in live broadcast UI.
