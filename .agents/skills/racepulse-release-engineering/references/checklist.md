# Release engineering, flags and rollback checklist

Harvested from the backend concepts list (items 6, 51 to 55, 102 to 108: CI/CD, Feature Flags, Blue-Green Deployment, Canary Releases, Rolling Deployments, Rollbacks, API Versioning, Semantic Versioning, Infrastructure as Code, Build Caching, Dependency Hell) and mapped to RacePulsePH.

## 1. Deterministic verification pipeline (item 6)

Before any production deploy, run the repository verification pipeline in order:

1. `npm run generate:access` (`node scripts/build-access-rules.cjs`) to regenerate `firestore.rules` and policy modules.
2. `npm run lint` (`tsc --noEmit`) for static type checking.
3. `npm run build` (`vite build` + `esbuild server.ts --outfile=dist/server.cjs`) to verify both the browser SPA and the bundled LAN server compile cleanly.
4. `node --test tests/timing-sequence.test.cjs` and `npm run verify:rbac` (`node scripts/verify-rbac.cjs`, which writes `output/rbac-verification.json` with a cryptographic source hash from `scripts/verification-hash.cjs`).

## 2. Feature flags and staged rollout (items 51 to 55)

- **Access rollout flag (`accessSystem/rollout.enforcementReady`):**
  - Keep `enforcementReady` false or absent until emulator tests, request-level tests, rule deploys and data backfill succeed (`racepulse-access`, `racepulse-access-validation`).
  - `scripts/migrate-access.cjs --apply --activate` refuses to activate unless `output/rbac-verification.json` matches the current source hash.
- **Per-race operational flags:**
  - `race.registrationOpen`, `race.onlinePaymentEnabled`, `race.registrationCloseDate` and `race.paymentFeeMode` (`functions/index.js` lines 154 to 222) let organizers enable or pause paid checkout per event without redeploying code.
- **Isolated Functions codebases (`firebase.json` lines 2 to 14):**
  - `default` (`functions/`) and `rbac` (`functions/rbac/`) are separate codebases in `firebase.json`, allowing targeted deployments and isolated rollbacks.

## 3. API and storage schema versioning (items 102 and 103)

- **Local storage key versioning:** when changing the shape of persisted browser queues, bump the key suffix (`racepulse_pending_chip_reads_v1` to `racepulse_pending_chip_reads_v2:${uid}:${raceId}` in `src/lib/offlineScanQueue.ts`) and migrate the current user's items cleanly.
- **Bridge and timing compatibility (`docs/finish-precision.md`):** `server.ts` and `src/lib/preciseTime.ts` accept both legacy bridge payloads (`HH:MM:SS.fffffff`) and current compact timestamps (`HH:MM:SSfffff`) so an updated web app continues working with an older `Timing Station.exe` binary.

## 4. Build artifacts and dependency hygiene (items 104, 107, 108)

- **Multi-target builds:**
  - Web + LAN server: `npm run build` outputs `dist/` and `dist/server.cjs`.
  - Android: `npm run android:sync` builds `dist/` and syncs Capacitor into `android/`.
  - Windows Timing Station: `rfid-station/package-station.ps1` packages the desktop wrapper around `dist/server.cjs`.
- **Never patch compiled files:** per `R-33` and `AGENTS.md`, always edit source files under `src/`, `functions/`, `server.ts` or `scripts/firestore-base.rules` and run the build/generator scripts.
