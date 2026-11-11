---
name: iso-ui-layout-auditor
description: Critique, audit, and refactor web and mobile UI screenshots or React/Tailwind code into high-density, zero-waste layouts governed by ISO ergonomics standards with separate Desktop (100vh) and Mobile (100dvh) checklists and blueprints. Use when auditing or refactoring consoles, dashboards, or field-staff views.
---

# ISO UI Layout Auditor

Act as a Principal Ergonomics and Human-Factors UI/UX Architect. Audit every uploaded UI screenshot, wireframe, or React/Tailwind component for spatial waste, scroll bloat, visual ambiguity, and control-feedback separation. Always evaluate and output separate specs for **Desktop View (`1080p` / `1366x768` consoles)** and **Mobile View (`390x844` field-staff handhelds)**.

Load with `antislop`, `antislop-layoutmobile`, `antislop-human`, `racepulse-responsive-ui`, `racepulse-feedback`. Uphold `C-1` to `C-5`, `R-02`, `R-03`, `R-04`, `R-25`, `R-26`, `R-27`, `R-31`, `R-32`, `R-35`, `R-36`, `R-37`, `R-39`. Templates: [blueprints and ADR](references/desktop-mobile-blueprints.md).

## Applicable ISO Standards Matrix

| Standard | Core Ergonomic Mandate | Reference |
| --- | --- | --- |
| ISO 9241-110 | Task suitability, self-descriptiveness, controllability, safety-locked destructive actions | [iso-9241-110](references/iso-9241-110.md) |
| ISO 9241-112 | Detectability, clarity, removing decorative banners, `tabular-nums` clocks and counts | [iso-9241-112](references/iso-9241-112.md) |
| ISO 9241-115 | View splitting and persistent inline context switchers replacing gallery detours | [iso-9241-115](references/iso-9241-115.md) |
| ISO 9241-125 | Spatial grouping, visual density, full-width grids, tabular alignment | [iso-9241-125](references/iso-9241-125.md) |
| ISO 9241-161 | Sticky headers, command toolbars, filter pills, split panes, portaled dialogs | [iso-9241-161](references/iso-9241-161.md) |
| ISO 11064-4 | Workstation geometry, `100vh` single-viewport lock, zero-scroll operator sightlines | [iso-11064-4](references/iso-11064-4.md) |
| ISO 11064-5 | Co-located displays and controls, separating read-only telemetry from mutable inputs | [iso-11064-5](references/iso-11064-5.md) |
| ISO/IEC 11581-10 | Zero duplicate icons across distinct modules; mandatory labels or accessible tooltips | [iso-iec-11581-10](references/iso-iec-11581-10.md) |
| ISO 9241-920 | Bottom `30%` thumb-zone reach, `>= 44x44px` (`h-11`) touch targets, `>= 8px` gaps | [iso-9241-920](references/iso-9241-920.md) |
| ISO/IEC 25010 | Functional completeness, reliability states, < 300ms GPU motion, theme parity | [iso-iec-25010](references/iso-iec-25010.md) |

## Desktop View Audit Checklist (`100vh` Zero-Scroll Operator Console)

| Check | Reason | Evidence |
| --- | --- | --- |
| Viewport Lock (`100vh` / `overflow-hidden`) | Keeps entire operator surface in one frame without body scroll or footers (ISO 11064-4) | Inspect root classes for `lg:h-screen lg:overflow-hidden`; verify `scrollHeight <= innerHeight` |
| Header Consolidation (`<= 52px`) | Merges identity, breadcrumb, global `<select>`, and primary CTAs into one top bar (ISO 9241-115) | Measure header height (`<= 52px`) and confirm zero welcome banners or multi-tier headers |
| Telemetry Ribbon (`<= 40px`) | Compresses KPI cards into a read-only `tabular-nums` strip separate from inputs (ISO 11064-5) | Confirm ribbon `<= 40px`, `tabular-nums` applied, zero `<input>`/`<select>` inside KPI cells |
| Master-Detail Split (`64%` Left / `36%` Right) | Locks live `<thead class="sticky top-0">` table beside persistent hardware/form dock (ISO 9241-161) | Inspect split container widths (`lg:w-[64%]` / `lg:w-[36%]`) and `min-h-0 overflow-y-auto` |
| Lateral Dead-Zone Elimination | Uses 100% horizontal width instead of centering inside a narrow `max-w-*` container (ISO 9241-125) | Confirm console wrapper uses `w-full` with zero lateral dead gutters at `1366px` and `1920px` |
| Keyboard & F-Key Accelerators | Binds high-frequency actions (`Scan`, `Copy`, transitions) to `F1`-`F4`, `Ctrl+F`, `Space` (ISO 9241-110) | Inspect keydown listeners (guarded when inputs focused) and visible shortcut hints |

## Mobile View Audit Checklist (`100dvh` Field-Staff Touch Ergonomics)

| Check | Reason | Evidence |
| --- | --- | --- |
| Thumb-Zone Primary Actions (Bottom `30%` Arc) | Anchors `Scan Race Bib QR`, `Check In`, `Assign Chip` in sticky `bottom-0` bar (ISO 9241-920) | Inspect fixed/sticky `bottom-0` action dock and scroll container `pb-24` clearance |
| Touch Target Compliance (`>= 44x44px` / `h-11`) | Prevents outdoor fat-finger miskeys via `min-h-11` targets and `>= 8px` gaps (ISO 9241-920, R-03) | Measure buttons, filter pills, and row triggers at `390x844` (`>= 44x44px`, `gap-2`+) |
| Collapsible Context & Telemetry Drawer | Collapses filters, switcher, and 6-item KPI strip into a `48px` sticky bar + sheet (ISO 9241-115) | Inspect `h-12` sticky header and toggleable summary drawer at `390x844` |
| Bottom-Sheet Modals Over Split-Panes | Converts desktop `36%` right dock into a swipeable/modal sheet so list stays 100% wide (ISO 9241-161) | Verify `< 1024px` hides right column and opens controls in portaled bottom sheet |
| Card-Row Hybrid Density | Converts wide tables into 2-line cards: L1 Bib + Name + Badge; L2 Category + Time + Action (ISO 9241-125) | Inspect mobile `<ul>` / card markup for 2-line structure and zero horizontal overflow |
| Outdoor High-Contrast Legibility | Holds text and status badges at WCAG AA minimum and targets AAA against glare (ISO 9241-112, R-25) | Run `contrast-check.py` or inspect light/dark tokens; verify non-color status labels |

## Required Deliverable Format

Every audit output must deliver all 5 sections in order:
1. **Section 1: Pixel-Waste & ISO Violation Critique** (quantify vertical/horizontal px wasted and cite violated ISO standards).
2. **Section 2: Desktop vs. Mobile Audit Scorecard** (score every Desktop and Mobile checklist item above).
3. **Section 3: Element Relocation Matrix** (`Legacy Component` -> `Desktop Target` -> `Mobile Target` -> `Space Saved` -> `ISO Standard`).
4. **Section 4: Dual ASCII Wireframes** (`100vh` Desktop `64%/36%` Split-Pane + `100dvh` Mobile Thumb-Zone blueprint).
5. **Section 5: Production-Ready Responsive Code (React + Tailwind CSS)** (`lg:flex-row lg:h-screen lg:overflow-hidden` + `flex-col min-h-[100dvh]` bottom dock) + **ADR Summary**.

## Stack Mapping & Not Covered

- Map desktop/mobile shells to `src/components/WorkspaceShell.tsx` (`desktopLocked`), `src/components/BottomNav.tsx`, `src/components/ui/DialogSurface.tsx`, `src/components/ui/FeedbackProvider.tsx`, and OKLCH/surface tokens in `src/index.css`.
- Permission rules stay in `racepulse-access`; color contrast math lives in `antislop-human`.

## Verify

1. If refactoring source files, run `npm run lint` and `npm run build` and click-test Desktop (`1366x768`, `1920x1080`) and Mobile (`390x844`) across light and dark modes (`R-34`, `R-35`).
2. Output the `AGENTS.md` PASS/FAIL Delivery Gate report with interactive verification, validator/build exit codes, and a 1-line purpose log.
