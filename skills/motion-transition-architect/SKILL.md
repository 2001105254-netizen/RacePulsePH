---
name: motion-transition-architect
description: Engineer 60/120fps page transitions, staggered component mounts, shared element morphs, shimmer skeletons, and vector graphics for React, Capacitor, and Android apps. Use when animating page switches, adding loading motion, building skeleton loaders, or implementing layoutId and View Transitions.
---

# Motion Transition Architect

Design and build compositor-safe 60/120fps page transitions, block-level mount staggers, shared element morphs, geometry-matched shimmer skeletons, and accessible vector motion for React, Capacitor, and Android WebView screens.

Load with: `antislop`, `antislop-ui`, `antislop-layoutmobile`, `capacitor-android-architect`, `android-layout-specialist`. Related: `antislop-human`, `racepulse-responsive-ui`, `racepulse-delivery-performance`. Rules upheld: `C-1`, `C-2`, `C-4`, `C-5`, `R-02`, `R-03`, `R-10`, `R-19`, `R-23`, `R-26`, `R-27`, `R-31`, `R-33`, `R-35`, `R-36`, `R-37`, `R-39`, `R-40`. Details: [transitions and gestures](references/transitions-and-gestures.md) and [skeletons and vectors](references/skeletons-and-vectors.md).

## Core Motion Checklist

| Step | Action | Reason | Evidence |
| --- | --- | --- | --- |
| 1. Set direction & compositor rules | Confirm `DESIGN.md` MOTION dial (`R-37`, `R-19`), animate only `transform` (`translate3d`, `scale`, `rotate`) and `opacity`, keep UI transitions under `300ms`, and hold `backdrop-filter` static (`R-10`) | Layout properties (`top`, `left`, `width`, `height`, `margin`) and animated blurs trigger Android WebView reflows and GPU frame drops | Inspect variants/CSS for compositor-only keys, `< 300ms` timings, and `backface-visibility: hidden` ([transitions](references/transitions-and-gestures.md)) |
| 2. Wire directional Push/Pop | Wrap route outlets with `AnimatePresence mode="popLayout"`, spring physics (`stiffness: 380, damping: 34, mass: 0.8`), `[0.32, 0.72, 0, 1]` exit ease, and Android back-button direction state | Forward navigation slides in from the trailing edge while hardware back reverses stack direction without waiting on exit | Inspect `popstate` / `backButton` listener and `custom={direction}` variants ([transitions](references/transitions-and-gestures.md)) |
| 3. Cascade blocks & morphs | Group screen elements into 3 to 4 visual blocks, cap item staggers at 6 to 8 items (`Math.min(index * 0.04, 0.28)`), and scope `layoutId` inside `LayoutGroup` with explicit image aspect ratios | Uncapped list staggers hide scrolled items and unsized morphing media snaps FLIP bounds mid-flight (`R-40`) | Inspect `LayoutGroup`, `aspect-ratio` / `width`+`height`, and stagger caps ([transitions](references/transitions-and-gestures.md)) |
| 4. Build shimmers & vectors | Replace blocking spinners with geometry-matched `translateX` shimmer skeletons (`R-27`) and lazy-loaded Lottie/Rive/sprite animations after confirming visual assets (`R-23`) | Skeleton masks preserve layout geometry before async data resolves and isolate shimmer sweeps on the GPU | Inspect `role="status"` skeleton bounds, `aspect-ratio`, and dynamic `import()` for vector runtimes ([skeletons](references/skeletons-and-vectors.md)) |
| 5. Enforce reduced motion | Wrap the app root in `<MotionConfig reducedMotion="user">`, honor `@media (prefers-reduced-motion: reduce)`, pause hidden loops, and provide pause controls for motion over 5s (`R-39`) | Prevents motion sickness, stops background battery drain on mobile WebViews, and degrades spatial slides to crossfades | Inspect `<MotionConfig>`, CSS reduced-motion queries, and `document.hidden` listeners ([skeletons](references/skeletons-and-vectors.md)) |

## Critical Gotchas

- **Using `AnimatePresence mode="wait"` on full-screen routes:** `mode="wait"` stalls incoming route mount until exit completes (for example 180ms+ delay). Use `mode="popLayout"` for push/pop stacks so exiting layers detach immediately while incoming screens enter ([transitions](references/transitions-and-gestures.md)).
- **Animating `backdrop-filter: blur()` on Android WebViews:** Dynamic blur radius interpolation drops frames on mid-range mobile GPUs and violates the `R-10` glassmorphism cap. Keep blur static on fixed headers/dialogs and animate only `transform` and `opacity`.
- **Unsized images inside `layoutId` or View Transitions:** Async image decode changes bounding boxes mid-transition and causes CLS (`R-40`). Set explicit `width`, `height`, or `aspect-ratio` on every shared container.

## RacePulsePH Stack Mapping

- **Motion runtime & root config:** `package.json` installs `motion` (`^12.23.24`, imported from `motion/react`); `src/App.tsx` wraps the root in `<LazyMotion features={domMax}>` and `<MotionConfig reducedMotion="user">` with `AnimatePresence` and `m`.
- **Navigation & Android back stack:** Guest routes use `window.history.pushState` / `popstate` in `src/App.tsx`; signed-in workspaces and overlays coordinate through `subscribeAndroidBackButton`, `useAndroidBackHandler`, and `racepulse:back` in `src/lib/capacitorAndroid.ts` and `src/components/ui/DialogSurface.tsx`.
- **Curves, shared pills & loaders:** `src/index.css` defines `--ease-out-quart`, `--ease-out-quint`, `--ease-out-expo`, and `@media (prefers-reduced-motion: reduce)`; `src/components/ui/tabs.tsx` implements `LayoutGroup` + `layoutId` tab pills; `src/components/RunningLoader.tsx` (`src/assets/RUNNER-MOTION.md`) drives visibility-aware sprite frames.
- **Uninstalled OSS packages:** `vaul`, `react-content-loader`, `lottie-web`, `rive-react`, and `react-router-dom` are not installed in `package.json`. Verify current vendor docs and check bundle impact with `racepulse-delivery-performance` before adding them (`R-36`).

## Not Covered

- Edge-to-edge `WindowInsets`, `WindowSizeClass`, and Compose/XML view hierarchy belong to `android-layout-specialist`.
- Capacitor APK/AAB packaging, Gradle R8/ProGuard, and native plugin setup belong to `capacitor-android-architect`.
- Bundle size budgets, CDN cache headers, and Firestore query latency belong to `racepulse-delivery-performance`.

## Verify

1. Confirm design direction (`R-37`), MOTION dial (`R-19`), and visual asset approval (`R-23`), then edit `.tsx` and `.css` sources directly without patch scripts (`R-33`).
2. Run `npm run lint`, `npm run build`, and `npm run android:sync` (all exit `0`) and test forward push, hardware back pop, tab `layoutId`, loading/error states (`R-27`), and OS reduced-motion mode in browser and Android WebView.
3. Deliver the `AGENTS.md` PASS/FAIL report listing tested interactions, command exit codes, and a 1-line `R-31` UX purpose for every animated surface.
