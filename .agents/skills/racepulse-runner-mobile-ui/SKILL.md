---
name: racepulse-runner-mobile-ui
description: Architect high-density, thumb-zone mobile and foldable Runner UI views with anti-slop spatial discipline and Android safe-area compliance. Use when building or refactoring RacePulsePH runner screens, sheets, queues, or adaptive split panes.
---

# RacePulse runner mobile UI architecture

Enforce high-density mobile Runner UI ergonomics, one-handed thumb-zone reach, and adaptive split-pane layouts across RacePulsePH runner screens (`src/components/RunnerDashboard.tsx`, `src/components/runner/`, `src/components/CustomerForm.tsx`, `src/components/WorkspaceShell.tsx`, `src/components/BottomNav.tsx`, and `src/components/ui/DialogSurface.tsx`).

Load with: `antislop`, `antislop-layoutmobile`, `antislop-human`, `android-layout-specialist`. Related: `racepulse-responsive-ui`, `racepulse-feedback`. Rules upheld: `C-1`, `C-2`, `C-3`, `C-4`, `C-5`, `R-02`, `R-03`, `R-11`, `R-15`, `R-25`, `R-26`, `R-27`, `R-31`, `R-32`, `R-34`, `R-35`, `R-36`, `R-37`, `R-39`, `R-40`. Detail: [mobile architecture](references/mobile-architecture.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Strip nested card wrappers, heavy drop shadows, decorative hero banners, and redundant row icons | Prevents vertical waste so at least 78% of a 375x812 viewport shows runner data (`R-03`, `C-1`) | Inspect `RunnerDashboard.tsx` and runner panels at `375x812` in Playwright |
| Cap root mobile gutters at `12px-16px` (`px-3` or `px-4`) and card padding at `12px` (`p-3`) | Maximizes horizontal line width on 320px and 375px phones without overflow (`R-03`) | Measure computed padding and `scrollWidth <= innerWidth` at `320px` and `375px` |
| Replace stacked equal-weight KPI grids with a single compact `divide-x` telemetry strip under `96px` using `tabular-nums` | Eliminates vertical bloat and numeric layout jitter on live updates (`C-1`, `R-03`) | Inspect telemetry strip bounding box height and `font-variant-numeric` |
| Architect Active Run / Pass Execution with 60-70% upper canvas, floating top status pill (`top: max(12px, env(safe-area-inset-top))`), and 3-detent bottom sheet (`Peek 20%`, `Half 50%`, `Expanded 90%`) | Keeps route/progress visible while anchoring primary actions in thumb reach (`C-3`, `R-03`) | Click detent controls and verify upper canvas plus sheet heights on `375x812` |
| Format Queue & Triage views with a `48px` header, `40px` sticky segmented filter rail, and 3-point `divide-y` rows | Shows 3-4+ actionable rows above the fold on `375x667` and `390x844` without scrolling (`R-03`, `C-1`) | Count visible queue rows above the fold at `375x667` and `390x844` |
| Convert centered modals and confirmations into bottom-anchored sheets (`items-end sm:items-center`) via `DialogSurface` | Keeps dismissals and primary confirmations inside single-handed thumb reach (`R-03`, `R-32`) | Open bib claim, QR scanner, profile, and delete modals at `375x812` |
| Ship zero-CLS exact-height skeletons, a `28px` non-blocking offline/sync top banner, compact empty states, and IME-aware bottom-nav hiding | Prevents layout shift, preserves offline race-day clarity, and keeps inputs clear of keyboards (`R-27`, `C-4`) | Test offline state, loading state, and input focus on `375x812` |
| Transition at `>= 600px` from bottom bar (`56px + env(safe-area-inset-bottom)`) to a vertical `NavigationRail` and two-pane split (`340px` left queue + flexible right canvas) inside `100dvh` | Supports foldables, tablets, and phone landscape with independent single-scroll panes (`R-03`, `C-4`) | Capture and inspect `600x900` and `844x390` viewports |
| Anchor primary progression CTAs in the bottom 35% thumb arc with `>= 44x44px` (`48x48dp`) targets and zero top-corner primary workflow buttons | Prevents awkward top-corner thumb strain and missed taps on touch screens (`R-03`, `R-39`) | Verify button bounding rects and hit target dimensions in Playwright |

## Stack mapping

- Root safe-area tokens and edge-to-edge viewport live in `index.html`, `src/index.css`, and `src/access-ui.css`.
- Mobile navigation bar, vertical rail, and shell container live in `src/components/BottomNav.tsx` and `src/components/WorkspaceShell.tsx`.
- Runner queues, active race pass canvas, registration flow, friends, and engraving live in `src/components/RunnerDashboard.tsx`, `src/components/runner/RunnerEventsPanel.tsx`, `src/components/runner/RunnerAllRacesPanel.tsx`, `src/components/runner/RunnerMyRacesPanel.tsx`, `src/components/runner/RunnerFriendsPanel.tsx`, and `src/components/CustomerForm.tsx`.
- Bottom sheets and confirmations route through `src/components/ui/DialogSurface.tsx`, `src/components/AccountPrivacyModal.tsx`, `src/components/QrScannerModal.tsx`, and `src/components/DeleteAccountModal.tsx`.

## Not covered

- Organizer timing console, admin RBAC workspace, and native Gradle/Capacitor plugin migration belong to `iso-ui-layout-auditor`, `racepulse-access`, and `capacitor-android-architect`.
- App-wide exhaustive screen audit certification belongs to `racepulse-all-screen-audit`.

## Verify

1. Run `npm run lint` and `npm run build` from the repository root; both must exit `0`.
2. Verify Playwright screenshots across `320x568`, `375x812`, `390x844`, `600x900`, `844x390`, and `1440x900` in both light and dark modes with zero horizontal overflow (`scrollWidth <= innerWidth`) and zero console errors.
3. Deliver the `AGENTS.md` PASS/FAIL report with interactive click-through evidence, guard exit codes, and a one-line purpose log.
