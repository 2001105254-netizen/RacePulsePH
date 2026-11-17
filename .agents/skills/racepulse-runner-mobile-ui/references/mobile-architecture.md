# Runner Mobile UI Spatial & Ergonomic Blueprint

Architectural specification for RacePulsePH mobile and foldable runner workflows, derived from `runner-mobile-ui-agent` spatial laws, `antislop-layoutmobile`, `android-layout-specialist`, and `modern-web-guidance`.

## 1. Five Spatial & Ergonomic Laws

1. **Zero UI Slop**: Never nest padded cards inside padded cards (`glass-panel` inside `glass-panel` or `rounded-2xl` inside `rounded-2xl`), stack equal-weight KPI grids on phones, or keep decorative headers taller than `56px`. Use `1px` hairline dividers (`divide-y` / `divide-x`), subtle surface contrast (`--surface-card` vs `--surface-page`), and `12px-16px` root gutters (`px-3` / `px-4`).
2. **Above-the-Fold Density**: On `375x667`, `375x812`, and `390x844` phones, at least `78%` of initial viewport height must present actionable runner data (telemetry summary, active status, primary CTA, and 3-4+ queue items visible without scrolling).
3. **One-Handed Biomechanics**: Keep high-frequency actions (Scan QR, Register, Open Pass, Show Bib QR, Accept/Decline, Filter, Switch Tab) inside the bottom 35% thumb arc. Never place primary workflow actions in top corners. Convert all centered dialogs into bottom-anchored sheets (`items-end sm:items-center`).
4. **Jitter-Free Telemetry**: Apply `tabular-nums` (`font-mono tabular-nums`) on all counters, timers, distances, bibs, and PHP currency totals. Use `100dvh` (`min-h-dvh` / `h-dvh`) and `env(safe-area-inset-*)` tokens (`--rp-safe-top`, `--rp-safe-bottom`) so system bars and keyboards never clip controls.
5. **Complete State Coverage**: Account for Active Execution, Queue Triage, Zero-CLS Skeleton Loading, Non-blocking Offline/Sync Banner, Soft-Keyboard (IME) Reflow, Compact Empty/Error States, and `600px+` Split-Pane Foldable Breakpoints.

## 2. Five Runner Screen Scenarios

### Scenario A: Active Run / Live Execution Mode (My Pass & Course Canvas)
- **Upper Canvas (60-70% viewport)**: Interactive 2D/3D course map when a published route or GPX is present (`EventCourseRunnerPanel` / `RouteMapCanvas`), or a full-bleed live Checkpoint Progress & Timing Canvas showing active split progression and quick Bib QR trigger.
- **Floating Top Status Pill**: Positioned at `top: max(12px, var(--rp-safe-top))` with Back navigation (`>= 44x44px`), `#BibNumber · Distance`, and current run status (`Race Day`, `Upcoming`, or `Rank #X · Finish Time`).
- **3-Detent Bottom Sheet**:
  - **Peek (`20%` height)**: Current checkpoint/step status, key `tabular-nums` split or time, and primary thumb-zone CTA (`Show Checkpoint QR`, `Download E-Certificate`, or `Engrave Medal`).
  - **Half (`50%` height)**: Live checkpoint split timeline (`divide-y` hairline rows) plus Bib QR card and quick pass actions.
  - **Expanded (`90%` height)**: Full manifest including complete checkpoint splits, interactive course elevation/analytics, Digital Race Bib preview & download, and finisher certificate export.

### Scenario B: Task Queue & Triage Feed (Open Events, All Races, My Passes, Friends)
- **Header & Filter Rail**: Compact `48px` sub-header paired with a sticky `40px` segmented filter rail (`All`, `Upcoming`, `Completed`, or `All Open`, `Available`, `Joined`) and inline/collapsible search input.
- **3-Point Row Anatomy (`divide-y`, `px-3 py-2.5`, `~64px` row height)**:
  - **Left**: Event/pass identifier (`date` or `#bib`) + concise title (`font-semibold text-sm truncate`), with middot-separated metadata line (`5K · 10K · 21K · 4 splits`).
  - **Right**: Bold `tabular-nums` metric (fee range, bib `#`, distance count, or finish time) stacked cleanly with a compact status pill (`Reg Open`, `Joined`, `Race Day`, `Finished`).

### Scenario C: Modals & Secondary Flows
- Route all Runner overlays through `DialogSurface` with `variant="sheet"` (`items-end sm:items-center`), anchoring sheets flush to the bottom edge on `< 640px` phones with `padding-bottom: max(12px, var(--rp-safe-bottom))`, a subtle drag indicator, and thumb-reachable footer actions (`Cancel`, `Confirm`, `Close`), while preserving centered modals on `>= 640px` screens.
- Covered flows: Bib Claim confirmation, QR Scanner, Account & Profile settings (with decorative cover collapsed on `< 640px`), Delete Account alertdialog, Race Reminders drawer, Poster/Kit lightbox, and Engraving QR/Cancel dialogs.

### Scenario D: Edge & Environmental States
- **Zero-CLS Skeletons**: Skeleton rows match exact `64px` height and 3-point flex distribution of populated rows.
- **Non-Blocking Offline / Sync Banner**: `28px` (`h-7`) persistent status bar at the top edge when offline (`!navigator.onLine`) or syncing, keeping cached passes and splits interactive.
- **Compact Empty & Error States**: Actionable inline states with `min-h-[44px]` recovery buttons (`Reset filters`, `Browse Open Events`, `Scan Bib QR`).
- **IME / Software Keyboard Reflow**: Listen to `visualViewport` height drops (`> 140px`) and mobile text-input focus to hide `BottomNav` and floating bottom bars automatically while the keyboard is open, plus `scroll-padding-bottom` on scroll regions so focused fields stay visible.

### Scenario E: Foldable & Landscape Adaptation (`>= 600px`)
- **Compact (`< 600px`)**: Single-pane flow with `56px + env(safe-area-inset-bottom)` bottom navigation bar (`BottomNav`) and 3-detent active inspector sheet.
- **Medium / Foldable / Landscape (`600px-1023px`)**: Automatic transition to a `64px` vertical `NavigationRail` on the left plus a two-pane split view (`clamp(240px, 42%, 340px)` / `340px` left queue + flexible `minmax(0, 1fr)` right active-run canvas) inside `100dvh` (`h-dvh overflow-hidden`) with one vertical scroll region per pane.
- **Expanded (`>= 1024px`)**: Persistent collapsible `DesktopSidebar` + two-pane split workspace + top `.brand-nav` controls.
