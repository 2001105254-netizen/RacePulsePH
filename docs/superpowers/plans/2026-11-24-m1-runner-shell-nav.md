# Milestone 1: Runner 5-Tab Shell, Merged Explore, You Hub & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Runner Portal into the Strava + TikTok 5-tab shell (`Home | Explore | Record | Inbox | You`), unify Events + Race Catalog + Routes + Clubs inside `Explore`, consolidate Passes/Friends/Engraving/Profile inside `You`, lay down the RBAC and `UserProfile` schema foundations for Milestones 2-5, and add non-blocking Endowed Progress onboarding.

**Architecture:** Preserve the existing registration, live results, bib claim, and friends components by composing them inside focused vertical shell panels (`RunnerHomePanel`, `RunnerExplorePanel`, `RunnerYouHubPanel`, `RunnerRecordPreviewPanel`, `RunnerInboxPreviewPanel`) coordinated by pure state/routing helpers in `src/lib/runnerShell.ts`. Extend the single-source RBAC policy in `functions/access-policy.js` and regenerate `firestore.rules`, `src/lib/access-presets.json`, and `functions/rbac/` through `scripts/build-access-rules.cjs` via `firestore-rules-author`.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS v4, Lucide React, Motion (`motion/react`), Firebase Firestore v12, Node built-in test runner (`node --test` + `tsx --test`), `@firebase/rules-unit-testing`, Playwright 1.65.

**Spec:** `docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md`

## Global Constraints
- Bottom navigation strictly limited to **5 buttons** (`Home`, `Explore`, `Record`, `Inbox`, `You`) with `>= 44 px` touch targets and `aria-current="page"` plus a non-color active indicator (`>= 3:1` contrast, WCAG 1.4.1).
- Contextual onboarding popovers use `popover="manual"` via `setAttribute('popover', 'manual')`, feature-detect `Object.hasOwn(HTMLElement.prototype, 'popover')`, and **never** move focus on page load; declare `transition-behavior: allow-discrete` separately after `transition`; honor `prefers-reduced-motion`.
- `organizer` preset denylist in `functions/access-policy.js` and `scripts/build-access-rules.cjs` MUST explicitly exclude `badges.*`, `clubs.*`, and `moderation.*`.
- `users/{uid}` optional `weightKg` validated to `25..250`, `heightCm` validated to `80..250`, `onboardingSteps` max 10 items, `primaryClubId` valid ID or empty, `allowMessageRequests` boolean.
- Visual and copy gates (`AGENTS.md`): 4-size/2-weight type scale, 4/8 px spacing rhythm, OKLCH 60/30/10 palette, GPU-only `< 300 ms` transitions honoring `prefers-reduced-motion`, zero em dashes (`—`), zero eyebrow pill badges above headlines, zero fabricated metrics, strictly one `<h1>` per active breakpoint.

## Review Focus
1. **Organizer RBAC Denylist Leak:** An `organizer` account must resolve `false` for `badges.view`, `badges.manage`, `badges.grant`, `clubs.view`, `clubs.manage`, and `moderation.manage` in both JS policy and compiled Firestore rules (pinned in Task 1).
2. **Restricted Runner Safe Landing Tab:** A runner with `personal.social = false` and `personal.inbox = false` (moderation restriction) must still land cleanly on an allowed tab (`explore` or `you`) and reach `My Passes` without a blank screen (pinned in Task 2).
3. **Profile Numeric Bounds Rejection:** Out-of-range or non-finite `weightKg` (`0`, `-5`, `251`, `NaN`) and `heightCm` (`79`, `251`) must be rejected by both `AccountPrivacyModal` validation and Firestore rules (pinned in Tasks 1 & 2).
4. **QR & Deep-Link Continuity:** Scanning an event QR or opening `?register=<raceId>` must switch to `explore` (`races`, `open`) and open that race; claiming a bib QR must switch to `you` (`passes`) and focus that pass; Android hardware back returns cleanly to the runner's home tab (pinned in Tasks 2 & 5).
5. **Compact Mobile Keyboard & Overflow Guard:** At `390x844` (light & dark mode), docked 5-button bottom nav must have zero horizontal overflow (`scrollWidth <= innerWidth`), hide when `imeOpen` is true, and never obscure focused elements with onboarding popovers (pinned in Tasks 3 & 6).

---

## File Structure

| Action | File | Responsibility |
| :--- | :--- | :--- |
| Create | `docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md` | Approved master Design Spec + ADR-003 |
| Create | `docs/superpowers/plans/2026-11-24-m1-runner-shell-nav.md` | Milestone 1 implementation plan |
| Modify | `functions/access-policy.js` | Add `Badges`, `Clubs`, `Moderation`, and `personal.{record,social,clubs,inbox}` permissions + dependencies + organizer exclusions |
| Modify | `scripts/build-access-rules.cjs`, `scripts/firestore-base.rules` | Mirror organizer exclusions + `actionDepsOk`; allowlist & validate `weightKg`, `heightCm`, `onboardingSteps`, `primaryClubId`, `allowMessageRequests` on `users/{uid}` |
| Modify | `src/lib/accessPolicy.ts` | Add UI catalog metadata & domain grouping for new permissions |
| Regenerate | `firestore.rules`, `src/lib/access-presets.json`, `functions/rbac/*` | Generated via `npm run generate:access` & `node scripts/build-access-deploy.cjs` |
| Modify | `src/types.ts` | Extend `UserProfile` with `weightKg?`, `heightCm?`, `onboardingSteps?`, `primaryClubId?`, `allowMessageRequests?` |
| Create | `src/lib/runnerShell.ts` | Pure state/routing helpers: 5-tab resolution, race-week quick-pass detector, Starter Trail calculator, body metric validation, back-nav target |
| Create | `src/components/runner/RunnerOnboardingHint.tsx` | Accessible `popover="manual"` contextual tooltip + fixed fallback |
| Modify | `src/components/BottomNav.tsx`, `src/components/WorkspaceShell.tsx`, `src/components/DesktopSidebar.tsx`, `src/index.css` | Optional `emphasis?: 'primary-record'` and `badgeCount?: number`, prominent center Record pill, non-color `>= 3:1` active bar, `.rp-hint-popover` transitions |
| Modify | `src/components/AccountPrivacyModal.tsx` | Optional Body Weight (`kg`), Height (`cm`), and Message Requests toggle |
| Create | `src/components/runner/RunnerExplorePanel.tsx` | Unified `Explore` tab: `Races` (`RunnerEventsPanel` + `RunnerAllRacesPanel`) \| `Routes` \| `Clubs` |
| Create | `src/components/runner/RunnerYouHubPanel.tsx` | Strava-style `You` athlete hub: `Overview` \| `My Passes` \| `Friends` \| `Engraving` |
| Create | `src/components/runner/RunnerHomePanel.tsx` | `Home` tab: Starter Trail card (`1/4` Welcome), Race-Week Quick-Pass banner, Weekly Snapshot Strip, `Discover` / `Following` feed |
| Create | `src/components/runner/RunnerRecordPreviewPanel.tsx` | M1 live GNSS pre-check + course selector + weight link on `Record` tab |
| Create | `src/components/runner/RunnerInboxPreviewPanel.tsx` | M1 TikTok-style grouped Requests/Invites/Alerts on `Inbox` tab |
| Modify | `src/components/RunnerDashboard.tsx` | Rewire to 5-tab `RunnerTab` (`home \| explore \| record \| inbox \| you`), preserve QR/deep-links/Android back/desktop header search |
| Create / Modify | `tests/runner-shell.test.ts`, `tests/access-policy.test.cjs`, `tests/access-rules.test.cjs`, `package.json` | Unit & Firestore rules tests covering all Review Focus cases |

---

### Task 0: Create Branch & Persist Spec + Plan
- [ ] **Step 1:** Create branch `feat/runner-ecosystem`.
- [ ] **Step 2:** Write `docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md`.
- [ ] **Step 3:** Write `docs/superpowers/plans/2026-11-24-m1-runner-shell-nav.md`.
- [ ] **Step 4:** Commit docs baseline.

### Task 1: RBAC Permissions & `UserProfile` Firestore Rules Foundation
**Files:**
- Modify: `functions/access-policy.js`
- Modify (via `firestore-rules-author`): `scripts/firestore-base.rules`, `scripts/build-access-rules.cjs`
- Modify: `src/lib/accessPolicy.ts`
- Regenerate: `firestore.rules`, `src/lib/access-presets.json`, `functions/rbac/*`
- Test: `tests/access-policy.test.cjs`, `tests/access-rules.test.cjs`

**Interfaces:**
- Produces: Permission keys `badges.view`, `badges.manage`, `badges.grant`, `clubs.view`, `clubs.manage`, `moderation.manage`, `personal.record`, `personal.social`, `personal.clubs`, `personal.inbox`; `users/{uid}` update validation for `weightKg`, `heightCm`, `onboardingSteps`, `primaryClubId`, `allowMessageRequests`.

- [ ] **Step 1 (RED):** Add unit and emulator rules tests to `tests/access-policy.test.cjs` and `tests/access-rules.test.cjs` pinning new keys, dependencies, organizer denylist, and `users/{uid}` bounds. Run `node --test tests/access-policy.test.cjs` and verify FAIL.
- [ ] **Step 2 (GREEN):** Update `functions/access-policy.js`, delegate `scripts/firestore-base.rules` + `scripts/build-access-rules.cjs` to `firestore-rules-author`, update `src/lib/accessPolicy.ts`, and run `npm run generate:access` + `node scripts/build-access-deploy.cjs`.
- [ ] **Step 3 (VERIFY):** Run `node --test tests/access-policy.test.cjs && npm run verify:rbac` (exit `0`).
- [ ] **Step 4 (COMMIT):** Commit Task 1 changes.

### Task 2: Pure Runner Shell Domain Module (`src/lib/runnerShell.ts`), `UserProfile` Types & Profile Body Metrics UI
**Files:**
- Modify: `src/types.ts`, `src/components/AccountPrivacyModal.tsx`, `package.json`
- Create: `src/lib/runnerShell.ts`, `tests/runner-shell.test.ts`

**Interfaces:**
- Consumes: `Race`, `RunnerProfile`, `UserProfile` from `src/types.ts`.
- Produces (`src/lib/runnerShell.ts`):
  - `RunnerTab`, `ExploreSection`, `ExploreRacesFilter`, `YouSection`, `OnboardingStepId`, `RUNNER_TAB_ORDER`
  - `resolveAllowedRunnerTabs(can)`
  - `resolveDefaultRunnerTab(can, hasPaymentParam)`
  - `findUpcomingRaceWeekPass(runnerProfiles, races, todayIso)`
  - `computeStarterTrailProgress(completedSteps, signals)`
  - `validateOptionalBodyMetric(raw, min, max, label)`
  - `shouldShowOnboardingHint(storageKey, suppressed, dismissedKeys)`
  - `formatNavBadgeCount(count)`
  - `mapExploreRacesMode(filter)`
  - `resolveBackNavigationTarget(state)`

- [ ] **Step 1 (RED):** Write `tests/runner-shell.test.ts` testing all exports and Review Focus #2, #3, #4, #5 edge cases. Run `npx tsx --test tests/runner-shell.test.ts` and confirm FAIL.
- [ ] **Step 2 (GREEN):** Extend `UserProfile` in `src/types.ts`, implement `src/lib/runnerShell.ts`, add body metrics (`weightKg`, `heightCm`) and `allowMessageRequests` toggle to `AccountPrivacyModal.tsx`, register `tests/runner-shell.test.ts` in `package.json`.
- [ ] **Step 3 (VERIFY):** Run `npx tsx --test tests/runner-shell.test.ts && npm run lint` (exit `0`).
- [ ] **Step 4 (COMMIT):** Commit Task 2 changes.

### Task 3: Upgraded 5-Button `BottomNav`, Synced Rail/Sidebar & Accessible `RunnerOnboardingHint`
**Files:**
- Modify: `src/components/BottomNav.tsx`, `src/components/WorkspaceShell.tsx`, `src/components/DesktopSidebar.tsx`, `src/index.css`
- Create: `src/components/runner/RunnerOnboardingHint.tsx`

**Interfaces:**
- Produces: `WorkspaceNavItem` (`emphasis?: 'primary-record'`, `badgeCount?: number`), `RunnerOnboardingHint`.

- [ ] **Step 1:** Update `BottomNav.tsx` (`variant="docked"` center Record CTA, `>= 44px` tap target, non-color `>= 3:1` active indicator bar on `aria-current="page"`, badge pill), `WorkspaceShell.tsx`, and `DesktopSidebar.tsx`.
- [ ] **Step 2:** Create `RunnerOnboardingHint.tsx` using native `popover="manual"` (`setAttribute('popover', 'manual')` gated by `Object.hasOwn(HTMLElement.prototype, 'popover')`) + fixed-position fallback, non-focus-stealing mount, `Got it` dismiss button, and CSS `.rp-hint-popover` rules with `@starting-style`, separate `transition-behavior: allow-discrete`, and `prefers-reduced-motion`.
- [ ] **Step 3 (VERIFY):** Run `npx tsx --test tests/runner-shell.test.ts && npm run lint && npm run build` (exit `0`).
- [ ] **Step 4 (COMMIT):** Commit Task 3 changes.

### Task 4: Unified `RunnerExplorePanel` (Merged Events + Catalog + Routes + Clubs Shell)
**Files:**
- Create: `src/components/runner/RunnerExplorePanel.tsx`

**Interfaces:**
- Consumes: `RunnerEventsPanel`, `RunnerAllRacesPanel`, `subscribePublishedCatalog`, `buildRaceCoursePath`, `LEGAL_CONFIG`, `mapExploreRacesMode`.

- [ ] **Step 1:** Build `RunnerExplorePanel.tsx` with `Races` (`Open Now` | `Upcoming` | `Completed` | `All` | `Joined`), `Routes` (island-group filter + published course launcher + `Run Course`), and `Clubs` (Admin-verified clubs preview + `Request a Club / Contact Admin` wired to real `LEGAL_CONFIG.supportEmail`).
- [ ] **Step 2 (VERIFY):** Run `npm run lint && npm run build` (exit `0`).
- [ ] **Step 3 (COMMIT):** Commit Task 4 changes.

### Task 5: `RunnerHomePanel`, `RunnerYouHubPanel`, `Record`/`Inbox` Launch Views & `RunnerDashboard` Rewire
**Files:**
- Create: `src/components/runner/RunnerHomePanel.tsx`, `src/components/runner/RunnerYouHubPanel.tsx`, `src/components/runner/RunnerRecordPreviewPanel.tsx`, `src/components/runner/RunnerInboxPreviewPanel.tsx`
- Modify: `src/components/RunnerDashboard.tsx`

- [ ] **Step 1:** Implement `RunnerHomePanel`, `RunnerYouHubPanel`, `RunnerRecordPreviewPanel`, `RunnerInboxPreviewPanel`.
- [ ] **Step 2:** Rewire `RunnerDashboard.tsx` to strictly 5 bottom-nav tabs (`home | explore | record | inbox | you`), preserve QR/deep-links/Android back/desktop header search/single `<h1>`, and attach suppressed-safe `RunnerOnboardingHint` on `Explore` and `Record`.
- [ ] **Step 3 (VERIFY):** Run `npm run lint && npm run test && npm run build` (exit `0`).
- [ ] **Step 4 (COMMIT):** Commit Task 5 changes.

### Task 6: Proof-First Verification Gate (Automated Suites + Playwright Visual/A11y Audit + Comment Hygiene)
- [ ] **Step 1:** Run `npm run lint && npm run test && npm run verify:rbac && npm run security:check && npm run build`.
- [ ] **Step 2:** Run headless Playwright visual & interactive verification (`1440x900` + `390x844`, Light & Dark modes) across all 5 tabs and sub-sections, save screenshots to conversation `scratch/`, inspect every screenshot via `read_file`, verify `scrollWidth <= innerWidth`, `>= 44px` tap targets, `aria-current="page"`, and zero console errors.
- [ ] **Step 3:** Run comment/copy hygiene check (zero em dashes `—`, zero eyebrow pills, zero AI-slop comments).
- [ ] **Step 4:** Hand back to planner via `enter_plan_mode` with full Milestone 1 completion report (without emitting `<!-- GOAL_COMPLETE -->`).
