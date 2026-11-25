# Milestone 5 Implementation Plan: Superadmin RBAC System Telemetry

**Date:** 2026-11-25  
**Branch:** `feat/runner-ecosystem`  
**Design Spec:** `docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md`

## Overview
Add Superadmin-only System Telemetry inside `src/components/AccessPanel.tsx` (`Access & Roles` | `System Telemetry` tabs, strictly gated by `authority` / `isSuperAdmin`) monitoring anonymized live active users, PHT daily/weekly/monthly active curves, Cloud Storage sizing by prefix via Eventarc GCS triggers, Firestore collection counts and 2.5x indexed footprint estimates, optional Cloud Monitoring API RED/p95 & egress metrics with graceful fallback, and live ADR-003 scaling gauges.

## Tasks
1. **Task 1 — Pure Telemetry Engine (TDD):**
   - Persist this plan and initialize `m5-progress.md`.
   - `functions/telemetry-engine.js` + `tests/telemetry-engine.test.cjs` (registered in `package.json`): PHT date keys, salted daily session hashing (zero PII), 10-shard routing, storage prefix classifier, collection byte sizing (raw & 2.5x indexed), sharded rollup aggregator, ADR-003 trigger evaluator (`ok` < 70%, `watch` >= 70%, `scale` >= 90%).
2. **Task 2 — Backend Service, GCS Triggers, `accessApi` Routes, Indexes & Firestore Rules (TDD):**
   - `functions/telemetry-service.js` (`recordPresenceHeartbeat`, `getSystemTelemetrySnapshot` with 60s cache + 10s force-refresh cooldown + graceful Cloud Monitoring v3 REST fallback, `applyStorageObjectTelemetryDelta`).
   - `functions/storage-telemetry.js` (`onObjectFinalized`, `onObjectDeleted` in `asia-southeast1`) exported in `functions/index.js`.
   - Wire `/presence/heartbeat` (active signed-in users, rate-limited) and `/telemetry` (Superadmin-only, rate-limited) into `functions/access-api.js`, `functions/access-service.js`, and `scripts/build-access-deploy.cjs` (`functions/rbac/` sync).
   - Update `firestore.indexes.json` (`systemTelemetry` composite index + `activePresence.expiresAt` TTL & single-field index).
   - Delegate Firestore rules for `activePresence` and `systemTelemetry` to `firestore-rules-author` + extend `tests/access-rules.test.cjs`.
   - Add `tests/telemetry-service.test.cjs` and verify `lint`, `security:check`, `npm test`, `verify:rbac`.
3. **Task 3 — Client Telemetry SDK, 15-min Heartbeat Hook & Superadmin UI (TDD):**
   - `src/lib/telemetry/{types,formatters,client}.ts` + `tests/m5-telemetry-client.test.ts` + `usePresenceHeartbeat` hook mounted in `src/components/AuthorizedWorkspace.tsx` (cross-tab `localStorage` 15-min throttle, visibility-gated, skipped on `e2e-*`).
   - Build `src/components/admin/SystemTelemetryPanel.tsx` and integrate `Access & Roles` | `System Telemetry` keyboard-accessible `role="tablist"` inside `src/components/AccessPanel.tsx`.
4. **Task 4 — M5 Verification Gate & Android Compile:**
   - Playwright Desktop (`1440x900`) & Mobile (`390x844`) Light/Dark audit + negative RBAC admin check + `read_file` screenshot inspection.
   - `antislop-human` `contrast-check.py` WCAG AA audit (`0` failures), `antislop-code` hygiene, `racepulse-security-prelaunch` log check.
   - Final `lint`, `security:check`, `npm test`, `verify:rbac`, `build`, `cap sync android`, Gradle `:app:compileDebugJavaWithJavac`.
