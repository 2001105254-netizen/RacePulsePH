# RacePulsePH All-Screen Audit Report & Remediation Plan

**Baseline Revision**: `3e40a43` (`v1.0.8`, `QA` fast-forwarded cleanly to `main`)  
**Scope**: `29` UI surfaces x `45` browser/viewport/theme/resilience profiles = `1,305` audited cases  
**Baseline Verdict**: `FAIL` (`19 PASS`, `881 FAIL` [`877` DOM/runtime + `4` visual PNG downgrades], `405 BLOCKED`, `11` open findings)

> [!IMPORTANT]
> Every fix chunk below is committed atomically onto `QA`, verified with `npm run lint`, `npm run build`, and relevant `node:test` suites, and re-audited via headless Playwright across desktop (`1440x900`, `1280x800`), mobile (`390x844`, `320x568`, `844x390`, `412x915`), light/dark themes, breakpoint transitions, `200%` text resize, `200%`/`400%` zoom, and `prefers-reduced-motion: reduce`.

---

## 1. Baseline Surface Coverage & Results

### Reachable Surfaces Audited (`20` surfaces, `900` cases)

| Surface ID | Source | Role / State | Pass | Fail | Key Failures Observed |
|---|---|---|---:|---:|---|
| `public-landing-default` | `src/App.tsx:439` | Guest default | 0 | 45 | Contrast (`PH`, tabs), `prefers-reduced-motion`, 4px spacing, Cookie banner overlap, `<24px` links |
| `public-landing-search-results` | `src/components/PublicRaceLanding.tsx:135` | Filtered results | 0 | 45 | Same systemic issues + `FIND BIB \| REGISTER` dock & filter control collisions |
| `public-cookie-preferences` | `src/components/CookieConsentBanner.tsx:134` | Dialog open | 0 | 45 | `bg-red-600` contrast, `<24px` `20x20` checkboxes, sticky close button collision |
| `public-privacy-policy` | `src/App.tsx:455` | Legal doc | 0 | 45 | Systemic tokens + Section 4 SDK table clipping at `1280px` `200%` text resize |
| `public-terms-of-service` | `src/App.tsx:455` | Legal doc | 2 | 43 | Systemic header/footer/link targets, contrast, reduced motion, 4px spacing |
| `public-refund-policy` | `src/App.tsx:455` | Legal doc | 2 | 43 | Systemic header/footer/link targets, contrast, reduced motion, 4px spacing |
| `public-cookie-policy` | `src/App.tsx:455` | Legal doc | 2 | 43 | Systemic header/footer/link targets, contrast, reduced motion, 4px spacing |
| `public-unsubscribe` | `src/App.tsx:468` | Invalid/missing token | 5 | 40 | Systemic tokens + `390px` `200%` text-resize right card overflow (`mail` link / padding) |
| `public-not-found` | `src/App.tsx:474` | Not found route | 7 | 38 | Systemic brand nav `PH` contrast, 4px spacing, reduced motion, narrow header |
| `guest-login-default` | `src/App.tsx:429` | Sign in + validation | 0 | 45 | Cookie banner overlapping `Sign in`, button target height (`40px`), 4px spacing, contrast |
| `guest-signup-default` | `src/components/AuthGate.tsx:186` | Sign up form | 1 | 44 | `<24px` (`16x16`) checkboxes & legal links (`20px`), `p-3.5`/`gap-2.5` spacing, contrast |
| `guest-password-reset` | `src/components/AuthGate.tsx:186` | Reset flow | 0 | 45 | `bg-red-600` button contrast (`4.44:1`), `10px`/`11px` copy, eyebrow badge, `16px` back button |
| `fixture-workspace-shell` | `tests/fixtures/workspace-shell.html:1` | SuperAdmin shell | 0 | 45 | Missing favicon `404`, brand `PH` contrast (`3.12:1`), light sidebar label contrast (`1.05:1`), `heading-float` transparent fill |
| `fixture-access-ui` | `tests/fixtures/access-ui.html:1` | Access UI modal | 0 | 45 | `rp-button-primary` (`4.29:1`), `<24px` (`20x20`) inputs, `10px` `.access-eyebrow`, off-4px rems, `390px` clipping |
| `runner-events-portal` | `src/components/RunnerDashboard.tsx:208` | Runner Events | 0 | 45 | `.heading-float`, `font-black` (`900`), `<12px` stepper labels, avatar `"D"` contrast, `BottomNav`/sidebar collisions |
| `runner-allraces-portal` | `src/components/RunnerDashboard.tsx:530` | Runner All Races | 0 | 45 | Missing `'allraces'` key in `navItems` capability filter (`RunnerDashboard.tsx:406`), plus systemic issues |
| `runner-myraces-portal` | `src/components/RunnerDashboard.tsx:525` | Runner My Races | 0 | 45 | `bg-red-600` (`4.44:1`), `font-black`, `py-3.5`, systemic issues |
| `runner-friends-portal` | `src/components/RunnerDashboard.tsx:537` | Runner Friends | 0 | 45 | `font-black`, `10px`/`11px` typography, `bg-red-600` button, external net error when offline/closed |
| `runner-engraving-portal` | `src/components/RunnerDashboard.tsx:541` | Runner Engraving | 0 | 45 | Unfiltered `orders` query causing Firestore permission error (`42`+ cases), `font-black`, `9px`/`10px`/`10.5px` micro-fonts, `-top-6` mobile overflow |
| `runner-account-modals` | `src/components/RunnerDashboard.tsx:2498` | Account Modals | 0 | 45 | `ProfileModal` `relative` overriding `.rp-dialog` centering (`(0,0)`), email truncation missing, `16x16` checkbox, systemic issues |

### Environment / Credential / Hardware Blocked Surfaces (`9` surfaces, `405` cases)

These surfaces cannot execute live runtime transitions cleanly without provisioned emulator/live stream/multi-role accounts, Firefox/WebKit engines, or native Android runtime. Their source files are still audited and fixed statically in Chunk 5 so latent styling, contrast, spacing, and typography defects are eliminated:

| Surface ID | Source | Blocker Reason |
|---|---|---|
| `public-live-hub` | `src/components/PublicRaceLanding.tsx:747` | Live Firestore currently has `0` races with `liveBroadcastEnabled: true` |
| `account-verify-email` | `src/App.tsx:420` | Requires unverified authenticated Firebase account |
| `staff-organizer-hub` | `src/components/AdminDashboard.tsx:176` | Requires organizer/admin role credentials or emulator |
| `staff-timing-console` | `src/components/AdminDashboard.tsx:172` | Requires timing official/admin credentials or emulator |
| `staff-race-setup` | `src/components/AdminDashboard.tsx:173` | Requires organizer/admin credentials or emulator |
| `staff-live-broadcast` | `src/components/AdminDashboard.tsx:187` | Requires broadcast/admin credentials or emulator |
| `staff-bib-studio` | `src/components/AdminDashboard.tsx:174` | Requires organizer/admin credentials or emulator |
| `staff-engraving-operator` | `src/components/AdminDashboard.tsx:171` | Requires operator/admin credentials or emulator |
| `staff-access-management` | `src/components/AdminDashboard.tsx:190` | Requires superadmin credentials or emulator |

*(Additional host blockers: Firefox & WebKit browser binaries not installed on host; native Capacitor Android WebView `WindowInsets`/IME runtime cannot run inside desktop headless Chromium.)*

---

## 2. All Open Audit Findings (`11` Findings)

| # | Finding ID | Severity | Occurrences | Affected Areas & Root Causes |
|---|---|---|---:|---|
| 1 | `wcag-contrast-failure` | High | 637 | `src/index.css` `--color-red-600: #e0362c` yields `4.44:1` (`#ffffff`) and `4.29:1` (`#fffafa`). Light `:root` `--color-red-500: #c22419` leaks into dark `.brand-nav` (`PH` on `#141416` = `3.12:1`). `.dark .heading-float` uses `color: transparent` clip (`1.0:1` sampled). Runner avatar `"D"` `text-red-500` on light gradient fails (`4.12:1` / `3.55:1`). Workspace sidebar light mode `"Operations"` / `"Engraving"` fails (`1.05:1`). |
| 2 | `spacing-non-4px` | Medium | 703 | Non-4px Tailwind utilities (`px-1.5` = `6px`, `px-3.5` = `14px`, `py-2.5` = `10px`, `py-3.5` = `14px`, `py-4.5` = `18px`, `gap-1.5`/`2.5`, `pt`/`pb` `6px`) and off-4px `rem` padding/gaps (`1.5rem`, `0.35rem`, etc.) in `src/access-ui.css`. |
| 3 | `sub-44px-touch-target` | High | 491 | Interactive controls below `44x44px` on touch/mobile or `<24x24px` desktop minimum: `16x16` / `20x20` checkboxes (`AuthGate`, `CookieConsentBanner`, `ProfileModal`, `AccessWorkspace`), `15-20px` inline button/anchor links (`Read Cookie Policy`, legal doc buttons, `Back to sign in`), `40px` `h-10` segmented toggle tabs. |
| 4 | `typography-or-copy-violation` | Medium | 285 | `font-black` (`900`) headings/buttons violating the 2-weight system (`400`/`600`); sub-12px micro-fonts (`8px`, `9px`, `10px`, `10.5px`, `11px`) in `CustomerForm`, `RunnerDashboard`, `AccountSecurity`, `AccessWorkspace`, `ui/button.tsx`; eyebrow badge (`Your account, protected`) parked above H1. |
| 5 | `sticky-or-cramped-overlap` | High | 185 | Fixed `CookieConsentBanner` overlaps `Sign in` and footer links (`guest-login-default`, `public-landing-*`); fixed `BottomNav`, `FIND BIB \| REGISTER` dock, sticky top nav, and desktop `aside` overlap controls/headings; `<4px` horizontal gaps (`-2px` to `2.5px`) between adjacent header/toolbar buttons. |
| 6 | `reduced-motion-violation` | Medium | 72 | `@media (prefers-reduced-motion: reduce)` in `src/index.css` and `src/access-ui.css` clears `animation` on selected classes only, leaving CSS `transition-duration` (`0.15s` Tailwind `transition*` classes) non-zero. |
| 7 | `runtime-console-or-page-error` | High | 48 | (1) `CustomerForm.tsx` queries `collection(db, 'orders')` without `ownerUid` filter when user lacks `engraving.view`, failing `firestore.rules:556`. (2) `tests/fixtures/workspace-shell.html` lacks `<link rel="icon">`, causing Chromium `/favicon.ico` `404`. |
| 8 | `text-clipping` | High | 44 | Horizontally clipped containers (`overflow-hidden` / `overflow-x-clip`) at `390px` and `200%` text resize across landing cards, buttons, `App.tsx` flex rows, and `.access-workspace-body`. |
| 9 | `horizontal-overflow` | High | 29 | Narrow (`320px`) header brand vs CTA collision (`App.tsx`), `CustomerForm` `-top-6` `heading-float-chip` overflow, un-wrapped monospace spans/buttons escaping `390px`/`1280px` under `200%` text resize. |
| 10 | `visual-text-resize-200-overflow-or-table-truncation` | High | 4 | PNG visual audit caught Section 4 SDK `<table>` horizontal clipping in `PublicInfoPages.tsx` (`1280px` `200%` text resize) and `UnsubscribePage.tsx` email/card overflow (`390px` `200%` text resize). |
| 11 | `runner-allraces-unreachable-nav` | High | 1 | `RunnerDashboard.tsx:406` filters `navItems` against `{ events, friends, engraving }`, omitting `'allraces'`, making `AllRacesView` unreachable from navigation. |

---

## 3. Grouped, Chunked Remediation Plan (on `QA`)

### Chunk 1: Baseline Audit Report, Documentation & Audit Harness Contract (`QA`)
- **Files**: `docs/all-screen-audit-report.md`, `AGENTS.md`, `skills/racepulse-all-screen-audit/`, `tests/all-screen-audit.test.cjs`
- **Verify**: `node --test tests/all-screen-audit.test.cjs`

### Chunk 2: Design System Tokens, Contrast, Reduced Motion, 4px Rhythm & Modal Core
- **Targets**: `src/index.css`, `src/access-ui.css`, `src/components/ui/DialogSurface.tsx`, `src/components/ui/button.tsx`, `index.html`
- **Fixes**:
  - Calibrate `--color-red-600` (`#c22419` >= `5.9:1` on white) and `.brand-nav` `--color-red-500: #ff6259` (`6.26:1` on `#141416`).
  - Fix `.dark .heading-float` so foreground text renders opaque high-contrast color instead of `color: transparent` clip failures.
  - Enforce global `@media (prefers-reduced-motion: reduce)` zero `transition-duration` and `animation-duration` (`0.01ms` / `none`) in `src/index.css` and `src/access-ui.css`.
  - Fix `<dialog>` `DialogSurface` centering/scroll behavior (`dialog:modal { margin: auto; overscroll-behavior: contain; }`, prevent caller `relative` class overriding fixed centering).
  - Normalize off-4px CSS/utility spacing in `src/index.css`, `src/access-ui.css`, `src/components/ui/button.tsx` (`sm` -> `>=12px` / 4px padding / `>=44px` or `>=32px` hit area as appropriate), and check text-scale support in `index.html`.
- **Verify**: Contrast check via `contrast-check.py`, `npm run lint`, `npm run build`

### Chunk 3: Functional Routing Bug, Firestore Query Security Fix & Fixture Surfaces
- **Targets**: `src/components/RunnerDashboard.tsx`, `src/components/CustomerForm.tsx`, `src/components/AccessWorkspace.tsx`, `src/components/WorkspaceShell.tsx`, `tests/fixtures/workspace-shell.html`, `tests/fixtures/workspace-shell.tsx`, `tests/fixtures/access-ui.html`
- **Fixes**:
  - Add `allraces: 'personal.results'` (matching runner results/discovery permission) in `RunnerDashboard.tsx:406` so `AllRacesView` is reachable and rendered cleanly.
  - Fix `CustomerForm.tsx` `orders` query to filter `where('ownerUid', '==', ownerUid)` unless `can('engraving.view')` is granted, matching `firestore.rules:556`.
  - Add `<link rel="icon" ...>` to `tests/fixtures/workspace-shell.html` and `tests/fixtures/access-ui.html` to eliminate `/favicon.ico` `404` errors.
  - Fix `WorkspaceShell` sidebar light-mode text contrast (`1.05:1` issue) and spacing/touch targets.
  - Fix `AccessWorkspace` / `access-ui.css`: `<24px`/`44px` checkbox & switch hit areas, disabled primary button contrast, Chrome light mode contrast, `390px` tab clipping, mid-scroll footer overlap, and `10px` `.access-eyebrow` micro-font + off-4px `rem` units.
- **Verify**: `npm run lint`, `npm run build`, `node --test tests/access-policy.test.cjs`

### Chunk 4: Header Collision, Cookie Banner Docking, Auth & Public Guest Screens
- **Targets**: `src/App.tsx`, `src/components/CookieConsentBanner.tsx`, `src/components/PublicRaceLanding.tsx`, `src/components/PublicRaceResults.tsx`, `src/components/PublicInfoPages.tsx`, `src/components/UnsubscribePage.tsx`, `src/components/AccountSecurity.tsx`, `src/components/AuthGate.tsx`
- **Fixes**:
  - Fix `App.tsx` `320px` narrow topbar logo vs `LOG IN`/`REGISTER` collision, off-4px nav padding/gaps, `<4px` button gaps, and `font-black`.
  - Fix `CookieConsentBanner.tsx` sticky overlap on login/landing/short viewports by reserving dynamic safe scroll/dock space (`padding-bottom`) and compact non-blocking positioning under `zoom-400`/`phone` heights, plus enlarging `"Read Cookie Policy"` & `"Save Settings"` / checkbox target ergonomics and contrast.
  - Fix `PublicRaceLanding.tsx` & `PublicRaceResults.tsx` floating `FIND BIB | REGISTER` bottom bar overlap, 4px spacing, and `text-resize-200` horizontal clipping.
  - Convert `PublicInfoPages.tsx` Section 4 SDK table to a responsive table pattern (`0` horizontal clipping at `200%` text resize) and fix `UnsubscribePage.tsx` `390px` `200%` text-resize wrap/padding overflow.
  - Remove eyebrow pill above `AccountSecurity` H1 (`Your account, protected`), replace `10px`/`11px` micro-fonts, enlarge `"Back to sign in"` hit box (`>=44px`), and fix `AuthGate.tsx` checkbox/legal-link touch boxes (`>=24x24px` desktop / `>=44px` coarse mobile target wrappers with zero sub-4px gaps) and `p-3.5`/`gap-2.5` spacing.
- **Verify**: `npm run lint`, `npm run build`

### Chunk 5: Runner Portal, Account Modals & Staff/Ops Component Hygiene
- **Targets**: `src/components/RunnerDashboard.tsx`, `src/components/CustomerForm.tsx`, `src/components/DeleteAccountModal.tsx`, `src/components/AccountPrivacyModal.tsx`, `src/components/BottomNav.tsx`, `src/components/AdminDashboard.tsx`, `src/components/OperatorDashboard.tsx`, `src/components/TimingConsole.tsx`, `src/components/RaceSetupPanel.tsx`, `src/components/BibStudioPanel.tsx`, `src/components/LiveBroadcastPanel.tsx`, `src/components/OrganizerDashboard.tsx`, `src/components/RunnerReminderCenter.tsx`, `src/components/PublicLiveRaceHub.tsx`, `src/components/RouteMap3D.tsx`, plus any remaining `font-black` / `<12px` / off-4px utilities across `src/`.
- **Fixes**:
  - Center `ProfileModal` (`DialogSurface`) properly on all viewports, prevent `ACCOUNT EMAIL` overflow, enlarge marketing checkbox hit area, and clear desktop sidebar / mobile `BottomNav` scroll collisions.
  - Fix `RunnerDashboard` `font-black`, avatar `"D"` contrast, stepper `10px` labels, `Friends` `10px`/`11px`/`bg-red-600`, `My Races` `py-3.5`/`font-black`.
  - Fix `CustomerForm` `-top-6` negative badge `320px` overflow, `9px`/`10px`/`10.5px` micro-fonts, `font-black`, and `py-4.5` spacing.
  - Clean all remaining `font-black`, `<12px` `text-[...]` classes, off-4px `*-0.5`/`*-1.5`/`*-2.5`/`*-3.5`/`*-4.5`, and low-contrast red accents across staff/ops components (`TimingConsole`, `AdminDashboard`, `OperatorDashboard`, `RaceSetupPanel`, `BibStudioPanel`, `LiveBroadcastPanel`, etc.).
- **Verify**: `npm run lint`, `npm run build`

### Chunk 6: Full Playwright Re-Audit, Visual PNG Verification & Final CI Gate (`QA`)
- **Verification**:
  - Re-run headless Playwright audit across ALL `29` surfaces x `45` profiles (`1,305` cases).
  - Inspect screenshots directly via `read_file` across desktop, mobile, light/dark, breakpoints, `text-resize-200`, `zoom-200`/`400`, Chrome profile.
  - Confirm `0` remaining FAIL cases on all `20` reachable surfaces; update `docs/all-screen-audit-report.md` with final post-fix metrics; commit Chunk 6 onto `QA`.
  - Run full CI parity checks (`npm run generate:access && git diff --exit-code firestore.rules functions/`, `npm run version:check`, `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs`, `npm run lint`, `npm run build`, all `tests/*.test.cjs`, `npm run verify:rbac`).
  - Push `QA` to `origin QA`.
