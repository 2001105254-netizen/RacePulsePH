---
name: capacitor-android-architect
description: Convert React Native or React applications into production-ready Capacitor Android apps with optimal performance and native integration. Use when the user asks to convert React Native to Capacitor, migrate a mobile app to Capacitor, wrap a React or React Native Web project into an Android APK/AAB, replace React Native modules with Capacitor plugins, or optimize a Capacitor Android build.
---

# Capacitor Android Architect

Convert React Native or React codebases into store-ready Capacitor Android applications using Vite bundling, native Capacitor bridges, and Android WebView optimization. In this repository, maintain the existing Capacitor v8 Android shell (`capacitor.config.ts`, `android/`, `npm run android:sync`).

Load with: `antislop`, `antislop-layoutmobile`. Related: `racepulse-responsive-ui`, `racepulse-release-engineering`, `racepulse-delivery-performance`. Rules upheld: `C-1`, `C-2`, `C-4`, `C-5`, `R-02`, `R-03`, `R-26`, `R-33`, `R-35`, `R-36`. Details: [migration workflow](references/migration-workflow.md) and [Android hardening](references/android-hardening.md).

## Architectural Reality Check

Clarify the build path with the user before migrating files:

- **Direct React Native Android build:** React Native already compiles to native Android Views (`android.view.*`) without Capacitor. If the user only needs an Android APK or App Bundle (`.aab`) from an existing React Native project, advise running `npx expo run:android` or `cd android && ./gradlew bundleRelease` directly.
- **Path A (React Native Web Adapter):** Alias `react-native` to `react-native-web` in Vite to keep existing `<View>`, `<Text>`, and `StyleSheet` primitives intact for the fastest migration into a Capacitor Android wrapper.
- **Path B (Pure Web / UI Refactor):** Replace React Native primitives with semantic HTML/CSS (`@ionic/react` or Tailwind CSS), swap `react-native-*` modules for `@capacitor/*` plugins, and follow `.impeccable.md` plus `racepulse-responsive-ui` for lightweight bundles with zero adapter overhead.

## Workflow Checklist

| Step | Action | Reason | Evidence |
| --- | --- | --- | --- |
| 1. Audit dependencies | Inspect `package.json` for `react-native-*`, `@react-native-*`, and C++/JSI TurboModules | Separates convertible UI/device packages from native SDKs needing custom Kotlin plugins | Audit table covering UI, Device APIs, and Native SDKs ([workflow](references/migration-workflow.md)) |
| 2. Configure Vite | Bundle `index.html`, JS, and CSS into `dist/` (alias `react-native-web` only on Path A) | Capacitor packages compiled static web assets into the Android WebView container | `npm run build` exits `0` and emits `dist/index.html` |
| 3. Initialize Capacitor | Install `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` and maintain root `capacitor.config.ts` | Sets `appId`, `webDir`, Android signing options, and plugin defaults | `capacitor.config.ts` and `android/` present; `allowMixedContent` disabled |
| 4. Replace native modules | Map `react-native-*` libraries to `@capacitor/*` plugins and run `npx cap sync android` | Registers native Kotlin/Java bridge classes and avoids runtime `PluginNotImplemented` errors | All native calls use `@capacitor/*`; `npx cap sync android` exits `0` |
| 5. Harden Android ergonomics | Handle `@capacitor/app` `backButton`, `viewport-fit=cover`, `env(safe-area-inset-*)`, and touch/overscroll CSS | Prevents accidental exits on back press, gesture-bar overlap, and web pull-to-refresh bounce | Inspect `index.html`, CSS safe-area rules, and back-button listener ([hardening](references/android-hardening.md)) |
| 6. Optimize Android build | Confirm `android:hardwareAccelerated`, lazy-load heavy plugins/routes, and configure R8/ProGuard for release | Minimizes startup WebView JS parse cost and shrinks release APK/AAB size | Inspect `android/app/src/main/AndroidManifest.xml` and `android/app/build.gradle` |

## Critical Gotchas

- Never commit a live-reload `server.url` in `capacitor.config.ts`; guard it behind `process.env.NODE_ENV === 'development'` so production installs do not show a white screen.
- Avoid Base64 for large photos or videos across the bridge; use `CameraResultType.Uri` with `Capacitor.convertFileSrc(uri)` to prevent Android OOM crashes ([hardening](references/android-hardening.md)).
- Always run `npx cap sync android` (or `npm run android:sync`) after installing or updating Capacitor plugins so Gradle includes the native plugin code.

## RacePulsePH Stack Mapping

- Web and Capacitor scripts live in `package.json` (`npm run build`, `npm run android:sync`, `npm run android:open`) with `@capacitor/core`, `@capacitor/android`, and `@capacitor/cli`.
- Bundler and Capacitor configs live in `vite.config.ts`, `capacitor.config.ts`, and `index.html`.
- Native Android shell files live in `android/variables.gradle`, `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, and `android/app/src/main/java/com/racepulseph/app/MainActivity.java`.
- Existing safe-area inset styling lives in `src/access-ui.css`, `src/components/BottomNav.tsx`, and `src/components/RunningLoader.css`.

## Not Covered

- Desktop and mobile console layout audits belong to `iso-ui-layout-auditor` and `racepulse-responsive-ui`.
- Firebase Hosting, Cloud Functions deployments, and Windows Timing Station builds belong to `racepulse-release-engineering` and `racepulse-delivery-performance`.

## Verify

1. Edit source, config, CSS, and Gradle/Manifest files directly without patching built artifacts (`R-33`).
2. Run `npm run lint`, `npm run build`, and `npm run android:sync` (or `npx cap sync android`) and confirm exit code `0`.
3. For APK/AAB releases, verify `cd android && ./gradlew bundleRelease` (`.\gradlew.bat bundleRelease` on Windows) exits `0` and deliver the `AGENTS.md` PASS/FAIL report.

