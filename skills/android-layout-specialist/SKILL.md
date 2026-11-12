---
name: android-layout-specialist
description: Design, build, debug, and optimize native and hybrid Android UI layouts across Jetpack Compose, XML ConstraintLayout, and Capacitor/React Native WebViews. Use when the user asks to create Android screens, fix broken edge-to-edge WindowInsets on Android 15/16+, eliminate nested scroll crashes, build adaptive/foldable UIs with WindowSizeClass, or eliminate frame drops and unnecessary recompositions.
---

# Android Layout Specialist

Architect, implement, and debug Android UI layouts across Jetpack Compose, XML Views (`ConstraintLayout`), and WebView/hybrid containers with API 35+/36+ mandatory edge-to-edge rules, adaptive breakpoints, and layout/draw-phase rendering budgets.

Load with: `antislop`, `antislop-layoutmobile`, `antislop-human`, `capacitor-android-architect`. Related: `racepulse-responsive-ui`. Rules upheld: `C-1`, `C-2`, `C-4`, `C-5`, `R-02`, `R-03`, `R-25`, `R-26`, `R-27`, `R-32`, `R-33`, `R-35`, `R-36`, `R-37`. Details: [edge-to-edge insets](references/edge-to-edge-insets.md) and [adaptive performance](references/adaptive-performance.md).

## Core Layout Checklist

| Step | Action | Reason | Evidence |
| --- | --- | --- | --- |
| 1. Route edge-to-edge insets | Draw backgrounds full-bleed; pad interactive bars, FABs, and scroll content with `WindowInsets.safeDrawing`, `ViewCompat` listeners, or `env(safe-area-inset-*)` | API 35+ enforces edge-to-edge and turns `statusBarColor` and `navigationBarColor` into no-ops; global wrappers break full-bleed surfaces | Inspect `Scaffold`, `consumeWindowInsets`, `ViewCompat` listener, or `viewport-fit=cover` CSS ([edge-to-edge insets](references/edge-to-edge-insets.md)) |
| 2. Pick minimal primitives | Use `Column`/`Row`, `Box`, `ConstraintLayout`, `FlowRow`, or `LazyColumn`/`RecyclerView` with stable `key` and `contentType` | Prevents multi-pass measurement bottlenecks, nested linear weights, and broken view recycling | Flat layout depth (1-level `ConstraintLayout` for multi-axis UI); list items define `key` and `contentType` ([adaptive performance](references/adaptive-performance.md)) |
| 3. Adapt via WindowSizeClass | Branch on Compact (`< 600dp`), Medium (`600dp` to `840dp`), and Expanded (`> 840dp`) width classes instead of hardcoded pixels | Supports portrait phones, foldables, tablets, and landscape views cleanly | Inspect `currentWindowAdaptiveInfo()` / `WindowWidthSizeClass` branches and `ListDetailPaneScaffold` |
| 4. Defer reads & avoid crashes | Read scroll state in lambda `Modifier.offset { ... }` / `graphicsLayer`, merge nested scrolls into one `LazyColumn`, and omit `IntrinsicSize` in lazy lists | Skips per-frame recomposition and prevents `IllegalStateException` unbounded-height crashes | Scroll modifiers run in layout/draw phases; no `LazyColumn` inside `verticalScroll`; `heightIn(min = 48.dp)` used |
| 5. Keyboard & font scaling | Wire `.imePadding()` plus `adjustResize`, use `sp`/`dp`, enforce `>= 48.dp` native touch targets, and replace fixed `height(...)` with `heightIn(min = ...)` | Keeps focused bottom inputs above the IME keyboard and stops clipping under 200% font scaling | Verify IME focus clearance and inspect layouts at 200% system font scale (verify AndroidX APIs against current vendor docs, `R-36`) |

## Critical Gotchas

- **Double-applied Scaffold insets:** Never combine `Modifier.padding(innerPadding)` with `.systemBarsPadding()`; call `.consumeWindowInsets(innerPadding)` or pass `innerPadding` directly into `LazyColumn(contentPadding = innerPadding)` ([edge-to-edge insets](references/edge-to-edge-insets.md)).
- **API 35+ `statusBarColor` trap:** `window.statusBarColor` and `android:statusBarColor` do nothing on Android 15+; render colored surfaces behind the status bar and control icon contrast with `WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars`.
- **Unbounded constraints crash:** Flatten headers into `LazyColumn { item { ... } }` instead of nesting unbounded lazy lists inside vertically scrolling `Column` blocks.

## RacePulsePH Stack Mapping

- RacePulsePH hosts a Capacitor Android WebView inside `android/app/src/main/res/layout/activity_main.xml` (`CoordinatorLayout` + `WebView`) with `compileSdkVersion = 36` and `targetSdkVersion = 36` in `android/variables.gradle`, meaning Android 15/16+ edge-to-edge rules apply directly.
- Native shell configuration lives in `android/app/src/main/java/com/racepulseph/app/MainActivity.java`, `android/app/src/main/AndroidManifest.xml`, and `android/app/src/main/res/values/styles.xml`.
- WebView safe-area inset styling lives in `index.html`, `src/access-ui.css`, `src/components/BottomNav.tsx`, and `src/components/RunningLoader.css` (Jetpack Compose libraries are not installed yet; confirm current BOM versions against Android Developers docs if adding native Kotlin UI, `R-36`).

## Not Covered

- Vite migration, Capacitor plugin replacement, and Gradle R8/ProGuard build shrinking belong to `capacitor-android-architect`.
- Web/Tailwind desktop `100vh` and mobile `100dvh` workspace audits belong to `iso-ui-layout-auditor` and `racepulse-responsive-ui`.

## Verify

1. Edit Kotlin, XML, HTML, and CSS sources directly without patching built files (`R-33`).
2. Confirm every verification check passes (Insets portrait/landscape, IME keyboard, List `key`/`contentType`, Touch targets `>= 48.dp` native / `>= 44px` web, Hierarchy depth) in emulator or device inspection.
3. For RacePulsePH WebView edits, run `npm run lint`, `npm run build`, and `npm run android:sync` (plus `./gradlew bundleRelease` / `.\gradlew.bat bundleRelease` for native shell changes) and deliver the `AGENTS.md` PASS/FAIL Delivery Gate report.

