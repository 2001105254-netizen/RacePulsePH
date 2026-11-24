# Implementation Plan: Milestone 2 — High-Precision GPS Record Engine, Android Foreground Service & Server-Verified `recordedRuns`

**Branch:** `feat/runner-ecosystem` (continuing from Milestone 1 `8316bf3`)
**Spec:** [2026-11-24-runner-ecosystem-design.md](file:///c:/Users/patri/Desktop/Holy%20folder/RacePulsePH/RacePulsePH/docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md)
**Status:** Active

---

## Architecture Overview

Milestone 2 upgrades the placeholder Record tab (`RunnerRecordPreviewPanel`) into a production-grade, crash-resilient GPS run tracker covering **Free Run** and **Race / Course Follow** sessions across Web browsers and Capacitor 8 Android (`targetSdkVersion = 36`, Java 21):

1. **Client Pure Recording & Metabolic Science Engines (`src/lib/runs/`):**
   - `types.ts`: Canonical types (`RecordedRunSummary`, `RecordedTrackPoint`, `RunSplitKm`, `RunCalorieEstimate`, `ActiveRunSession`, `PendingRunUpload`).
   - `calorieEngine.ts`: Exact implementation of Minetti et al. (2002) grade-adjusted running/walking net energy cost ($v \ge 1.8\ \text{m/s}$ vs $v < 1.8\ \text{m/s}$, $i \in [-0.45, +0.45]$) + Herrmann et al. (2024) resting 1-MET baseline (`1.05 * kg * dtHours`), using saved `profile.weightKg` (`25..250`) or disclosed `65 kg` reference fallback.
   - `runRecorderEngine.ts`: Reuses `gpsFilter.ts` speed-adaptive Kalman smoothing and canopy gate (`<= 65m`), moving-time detection, hysteresis elevation (`>= 2.5m`), per-km splits, 30m DEM enrichment (`philippinesMapTiles.ts`), 200m on-device home privacy trim (zero short-run leak), polyline decimation (`<= 240` points), Philippine island group detection, and XML-safe GPX 1.1 export.
   - `runCrashRecovery.ts`: IndexedDB persistence (`racepulse_run_recovery_v1`) with `localStorage` fallback for active run crash recovery and offline pending upload queuing.
   - `nativeRunTracking.ts`: Capacitor `registerPlugin('RunTracking', ...)` bridge wrapping Android's foreground GNSS service on native devices and `watchDeviceLocation` + Screen Wake Lock (`navigator.wakeLock`) on web browsers.
   - `communityRunsClient.ts`: Authenticated + App-Check-guarded client calls to `communityApi`, Cloud Storage `run-tracks/{uid}/{runId}.json` upload, and Firestore `recordedRuns` subscription.

2. **Capacitor 8 Android Native Foreground GPS Service (`android/app/`):**
   - `RunTrackingForegroundService.java`: Low-importance persistent notification (`racepulse_run_tracking`), `ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION`, 6h-bounded `PARTIAL_WAKE_LOCK` reliably released on stop/destroy, `FusedLocationProviderClient` 1 Hz (`Priority.PRIORITY_HIGH_ACCURACY`), and a 20,000-fix ring buffer to recover screen-off pocket fixes.
   - `RunTrackingPlugin.java`: Permission-checked start (never calls `startForeground` without `ACCESS_FINE_LOCATION`), `POST_NOTIFICATIONS` graceful handling on API 33+, `notifyListeners("locationFix", ...)`, `getBufferedFixes`, `stopTracking`, `updateNotification`, `getStatus`.
   - Registered in `MainActivity.java` before `super.onCreate(savedInstanceState)`; declared in `AndroidManifest.xml`; backed by `play-services-location:21.3.0` in `android/app/build.gradle`.

3. **Backend Verification, Storage, Firestore Rules & Indexes (`functions/`, `storage.rules`, `firestore.rules`, `firestore.indexes.json`):**
   - `functions/run-math.js`: CommonJS exact mirror of `calorieEngine.ts`, geodesic distance, per-km splits, bounded (`<= 250m` head/tail) trim accounting, polyline decimation, and anti-cheat speed/distance verification (`verified` | `flagged`).
   - `functions/community-service.js` & `functions/community-api.js`: Express v2 endpoint `communityApi` (`asia-southeast1`) implementing `POST /runs/complete` (idempotent via `communityIdempotency/{uid}_{requestId}`, appends `'first_run'` to `users/{uid}.onboardingSteps` if `< 10`), `POST /runs/update` (owner title/privacy), and `POST /runs/delete` (Firestore doc + `run-tracks/` cleanup).
   - `functions/auth-api.js`: Updates `purgeAndAnonymizeUserAccount` to delete user `recordedRuns` and `run-tracks/{uid}/`.
   - `storage.rules`: `run-tracks/{ownerUid}/{file}` strictly owner-scoped JSON `< 5 MB` with `canPersonalRecord()`.
   - `firestore.rules` (authored via `firestore-rules-author`): `recordedRuns/{runId}` read-gated by ownership, superadmin, `'public'`, or `'friends'` via `isFriendOf(resource.data.uid)`, client writes forbidden; `communityIdempotency/{id}` locked (`allow read, write: if false;`).

4. **UI Integration & Verification (`src/components/runner/`, `src/components/RunnerDashboard.tsx`):**
   - `RunnerRecordPanel.tsx`: Pre-run setup (crash recovery banner, pending upload banner, Free Run vs Course Follow, 200m home privacy trim toggle default ON, non-auto-start `Test GPS Signal`, calorie calibration + study citation dialog), live HUD (`RouteMapCanvas` live puck + accuracy circle + breadcrumbs + course corridor progress + pause/resume/finish/discard + hardware back guard), and post-run summary/save sheet (30m DEM elevation enrichment, splits, GPX export, privacy selector, offline retry queue).
   - `RunnerDashboard.tsx` & `RunnerYouHubPanel.tsx`: Hides bottom nav and suppresses onboarding hints during active recording, streams user `recordedRuns`, surfaces `Recorded Runs` inside `You` with GPX export, privacy update, and confirmed delete.
   - `RunnerExplorePanel.tsx`: Fix M1 minor (`overflow-hidden` gated on `!(section === 'races' && eventsInFormFlow)` so desktop Registration Summary stays sticky during form scroll).

---

## Task Checklist & Verification Gates

- **Task 0:** Persist plan + initialize M2 SDD ledger + commit.
- **Task 1:** Pure TypeScript GPS recording, Minetti/Herrmann calorie, privacy trim, splits, GPX, and crash recovery engines + `tests/run-recorder.test.ts` (TDD) -> `npx tsx --test tests/run-recorder.test.ts && npm run lint && npm test`.
- **Task 2:** Custom Capacitor 8 Android `RunTrackingForegroundService` + `RunTrackingPlugin` + `MainActivity.java` + `AndroidManifest.xml` + `build.gradle` + `nativeRunTracking.ts` -> `npm run lint && npm test && npm run build && npm run android:sync` + `:app:compileDebugJavaWithJavac`.
- **Task 3:** `functions/run-math.js` (parity-tested against `calorieEngine.ts`), `communityApi`, `auth-api.js` purge extension, `firestore.indexes.json`, `storage.rules`, `firestore.rules` (via `firestore-rules-author`), and `tests/community-runs.test.cjs` + rules/purge tests -> `npm test && npm run verify:rbac && npm run security:check`.
- **Task 4:** `communityRunsClient.ts` + `RunnerRecordPanel.tsx` -> `npm run lint && npm test && npm run build`.
- **Task 5:** Wire `RunnerDashboard.tsx`, `RunnerYouHubPanel.tsx`, and `RunnerExplorePanel.tsx` sticky-aside polish; remove `RunnerRecordPreviewPanel.tsx` -> `npm run lint && npm test && npm run verify:rbac && npm run security:check && npm run build`.
- **Task 6:** Full Playwright Desktop (`1440x900`) & Mobile (`390x844`) Light & Dark interactive audit (idle zero-auto-GPS, mocked GNSS live Free Run stream, Pause + Reload Crash Recovery, Finish + Post-Run Save/GPX sheet, Calorie Science modal, `You` Recorded Runs), direct screenshot inspection via `read_file`, WCAG contrast check via `contrast-check.py`, `antislop-code` comment hygiene, M2 whole-branch final review (`m1-reviewer` Pro), final Android compile check, and hand back via `enter_plan_mode` for Milestone 3 planning.
