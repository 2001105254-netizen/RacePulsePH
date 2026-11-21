---
name: racepulse-gps-precision
description: Calibrate and harden GPS and GNSS tracking across browser geolocation, Capacitor Android FusedLocationProviderClient, Kalman smoothing, and course map-matching. Use when GPS is inaccurate, drifting, lagging, jumping, or failing field capture.
---

# RacePulse GPS and GNSS precision

Calibrate, harden, and verify high-precision geographic positioning across RacePulsePH route authoring (`src/components/routes/RouteStudioPanel.tsx`), live runner course tracking (`src/components/routes/EventCourseRunnerPanel.tsx`, `src/lib/routes/useRunnerGeolocation.ts`), and native Android Capacitor packaging (`android/app/src/main/AndroidManifest.xml`, `capacitor.config.ts`).

Load with: `capacitor-android-architect`, `racepulse-runner-mobile-ui`, `modern-web-guidance`. Rules upheld: `C-1`, `C-2`, `C-4`, `C-5`, `R-02`, `R-03`, `R-25`, `R-26`, `R-33`, `R-35`, `R-36`, `R-37`. Details: [GNSS calibration](references/gnss-calibration.md) and [filter tuning](references/filter-tuning.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Never fabricate GPS fixes or fake accuracies from visual map centers | Prevents misleading users into believing the map center is a locked GPS position (C-1, C-5) | Inspect `handleCenterOnGps` in `RouteStudioPanel.tsx`; confirm no fake ±12m fixes |
| Clearly distinguish manual pin drops from satellite GNSS locks in status copy | Gives users honest provenance of coordinate fixes and avoids deceptive accuracy claims (C-5, R-02) | Inspect status text in `RouteStudioPanel.tsx` and `useRunnerGeolocation.ts` |
| Warn desktop users that PC browsers use Wi-Fi or IP geolocation without GNSS hardware | In the Philippines, ISP geolocation is 15km to 100km+ inaccurate (C-5) | Verify desktop advisory presence in Route Studio and runner views |
| Query Google Play Services FusedLocationProviderClient on Android via `@capacitor/geolocation` | Provides true multi-constellation GPS/GLONASS/Galileo sub-3m accuracy instead of WebView IP fallback (C-4) | Confirm `@capacitor/geolocation` in `package.json` and `MainActivity.java` |
| Request `ACCESS_FINE_LOCATION` and configure `enableHighAccuracy: true` with zero stale cache | Ensures receivers power up satellite tracking rather than returning stale cached cell-tower fixes (C-4) | Inspect geolocation options in `useRunnerGeolocation.ts` and `RouteStudioPanel.tsx` |
| Adapt Kalman filter gain dynamically based on speed to prevent runner position lag | Constant low gain freezes position 20m to 50m behind a running athlete (C-4, R-35) | Verify speed-adaptive gain calculations in `src/lib/routes/gpsFilter.ts` |
| Scale accuracy gate dynamically between 35m and 65m under dense mountain and trail canopy | Hard 35m cutoff discards legitimate trail fixes in Philippine mountain terrain (C-4) | Run `tests/gpx-route-foundation.test.ts` GPS filter suite |
| Clamp stationary jitter below 2.5m displacement while preserving slow uphill hiking steps | Avoids inflating route distance at aid stations without dropping valid slow trail movement (C-1) | Verify jitter clamp thresholds in `src/lib/routes/trailTools.ts` |
| Snap live runner fixes to active course polyline within 50m corridor via `projectCoordinateToRoute` | Raw GNSS wander is eliminated when athletes run on verified course corridors (C-3, C-4) | Inspect `computeRunnerLocationRelativeToRoute` in `useRunnerGeolocation.ts` |
| Support Android Foreground Service with WakeLock during active race recording | Prevents Android OS from freezing GPS updates when runner locks their phone screen (C-4) | Inspect `AndroidManifest.xml` permissions and background service config |

## Stack mapping

- Core Kalman smoothing and accuracy gating live in `src/lib/routes/gpsFilter.ts`.
- Runner course projection and corridor map-matching live in `src/lib/routes/useRunnerGeolocation.ts` and `src/lib/routes/anchoring.ts`.
- Trail recording breadcrumb processing and drift clamping live in `src/lib/routes/trailTools.ts`.
- Route Studio GPS controls live in `src/components/routes/RouteStudioPanel.tsx`.
- Event course live runner HUD lives in `src/components/routes/EventCourseRunnerPanel.tsx`.
- Native Android permissions and plugins live in `android/app/src/main/AndroidManifest.xml` and `capacitor.config.ts`.

## Not covered

- MapLibre tile rasterization and vector rendering belong to `maplibre-source-wiring` and `maplibre-cartography`.
- RFID timing hardware, mat transponders, and bridge synchronizations belong to `racepulse-realtime-delivery`.

## Verify

1. Run `npm run lint` and `npm run build` from the repository root; both must exit `0`.
2. Run `npx tsx --test tests/gpx-route-foundation.test.ts` and verify all GPS filtering and projection tests pass with code `0`.
3. Verify `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs` exits `0`.
