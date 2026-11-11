# Race-day reliability, clock precision and disaster recovery checklist

Harvested from the backend concepts list (items 83 to 87, 95, 96, 109 to 111: Disaster Recovery, Backups, Failover, Multi-Region Deployment, Chaos Engineering, Network Partitions, Clock Skew, Production Incidents, On-Call, Postmortems) and grounded in `docs/finish-precision.md`, `docs/live-rankings.md` and `docs/RFID_BRIDGE_SETUP.md`.

## 1. Local persistence and process restart recovery (items 83 to 85)

- **Writable data directory (`server.ts` lines 61 to 74):**
  - `DATA_DIRECTORY = process.env.RACEPULSE_DATA_DIR || process.cwd()`.
  - `Timing Station.exe` (`rfid-station/MainForm.cs`) supplies a user-writable `RACEPULSE_DATA_DIR` so the bundled server never fails writing under `C:\Program Files`.
- **Three durable local JSON stores (`server.ts`):**
  - `local_orders.json`: engraving queue state.
  - `local_chip_reads.json`: confirmed checkpoint scans.
  - `local_rfid_events.json`: raw EPC sightings retained for a 12-hour recovery window (`pruneRfidEvents`).
- **Corrupt-file resilience:** if a JSON file is unreadable on startup, `server.ts` logs a warning and initializes an empty map rather than crashing the Timing Station process.

## 2. Network partitions and cloud-to-LAN failover (items 85 and 95)

- **Dual-path reads (`src/lib/dualSync.ts`):** blends live Cloud Firestore `onSnapshot` streams with the local LAN Express poller (`pollIntervalMs = 2000`). If the venue internet fails, `onSnapshot` logs a warning while the LAN poller keeps updating operator screens on the local Wi-Fi/Ethernet subnet.
- **Offline scan queue (`src/lib/offlineScanQueue.ts`):** stores scans in `localStorage` under `racepulse_pending_chip_reads_v2:${uid}:${raceId}` and replays them automatically when connectivity and `accessApi/session` authorization return.
- **Station switching (`docs/finish-precision.md`):** changing the active checkpoint station deliberately starts a new receipt window so previous EPC sightings are never assigned to the wrong checkpoint.

## 3. Clock skew and 7-digit sub-millisecond precision (item 96)

- **BigInt tick arithmetic (`src/lib/preciseTime.ts`):**
  - `.NET` emits up to 7 fractional digits (`100ns` ticks).
  - `timestampTicks(timestamp)` parses the ISO string and computes `BigInt(seconds) * 10000n + BigInt(fractionPaddedTo7)` so zero precision is lost to IEEE-754 floating-point rounding.
  - `elapsedSeconds(start, finish)` returns `undefined` if `finish < start`, preventing negative split times when a device clock jumps backward.
- **Consecutive entries (`src/lib/entrySequence.ts`, `docs/live-rankings.md`):**
  - For linked entries (such as `5K Solo` followed by `5K Duo`), the previous entry's finish timestamp automatically becomes the next entry's start timestamp. Loops and missing finishes are rejected so they cannot produce invalid official times.

## 4. Incident handling on race day (items 109 to 111)

- **Close finishes and ties (`docs/finish-precision.md`):**
  - Equal measured elapsed times share competition places (`1, 1, 3`). Never fabricate or nudge a timestamp to break a tie (`R-36`).
  - Operators with timing correction permission can configure a calibrated finish review window in milliseconds to flag close finishes as provisional pending finish-line camera review.
- **Erroneous scan recovery:** use the built-in scan undo/re-entry flow so linked consecutive entries and division placings recalculate deterministically.
