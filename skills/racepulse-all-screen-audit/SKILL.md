---
name: racepulse-all-screen-audit
description: Audit every RacePulsePH screen, page, role, tab, overlay and reachable UI state for cramped spacing, wasted space and responsive layout defects. Use when checking all screens, fixing awkward spacing, reviewing overall UI quality or requiring a strict release layout gate with no skipped screens.
---

# RacePulse all-screen audit

Require complete, source-backed coverage. A clean landing page, a reused component, a green build or a high Lighthouse score cannot establish app-wide quality. Missing evidence fails the gate.

## Load the project and Google web guidance

1. Locate the RacePulsePH root. Read `AGENTS.md`, `.agents/rules/frontend.md`, `.impeccable.md` and any applicable nested instructions. Preserve the existing design direction.
2. Load `antislop`, `antislop-layoutmobile`, `antislop-human` and `racepulse-responsive-ui` from `.agents/skills`. Reuse the resolved antislop mode and the user's authorized scope. Audit-only requests authorize inspection; requests to fix authorize direct source edits and regression checks.
3. Read `.agents/skills/modern-web-guidance/SKILL.md`. Search first for each relevant capability: `responsive page layout`, `space touch targets`, `responsive data table`, `accessible modal dialog`. Retrieve matching IDs, including broader CSS and accessibility guidance. Follow required browser fallbacks. Do not invent guide IDs or run a legacy modernization scan for a spacing audit.
4. If the online runner is unavailable, record the failure, search/read the bundled guides and verify applicable advice against official Google web.dev and W3C sources. Record exact paths, URLs and access dates. Do not claim an online command succeeded. Read [spacing standards](references/spacing-standard.md) before measuring.

Own exhaustive coverage and evidence. Delegate detailed styling principles to the existing skills. Do not impose the operator-console blueprint from `iso-ui-layout-auditor` on every page or claim ISO certification.

## Discover every surface before changing layout

1. Read [coverage and evidence contract](references/coverage-contract.md). Build a frozen inventory from source traversal AND runtime navigation; URL crawling alone misses this app's state-driven workspaces.
2. Start at `src/App.tsx`, `src/components/AuthorizedWorkspace.tsx`, `src/components/AdminDashboard.tsx`, `src/components/RunnerDashboard.tsx`, `src/components/DesktopSidebar.tsx`, `src/components/BottomNav.tsx` and `src/lib/access.tsx`. Follow all imports, conditions, navigation handlers and permissions until no undisposed UI candidates remain. Rediscover on every run; this seed list is not the screen list.
3. Inventory public/auth/legal/error pages, deep links and aliases, personal and operations workspaces, every permission-dependent view, tab, wizard step, menu, dialog, sheet, expanded row and confirmation. Include nested scroll regions, sticky controls, toasts and banners in their actual host screens.
4. Enumerate all reachable distinct render states: populated, empty, loading, success, failure, validation, disabled, unauthorized, suspended/pending, offline/reconnecting, long text and dense data wherever the implementation exposes them. Record evidence for absent states; missing required handling is a finding, not permission to skip.
5. Derive roles and permission combinations from current source. Use seeded local fixtures, emulators or authorized test sessions. Never weaken authentication, grant real roles, submit payments or send notifications to obtain screenshots. A blocked screen remains in the inventory and fails completion.
6. Give each surface a stable ID, exact source location, role, state, entry recipe and control inventory. Reconcile source candidates with observed navigation. Expand the inventory whenever a new surface appears; never delete rows to improve the result.

## Inspect the complete matrix

Use headless Playwright against the running dev server. Run all required profiles for every surface, including shared-component callers. Add breakpoint boundary and platform profiles from the coverage contract. Never select representative pages as substitutes.

| Check | Functional reason | Required evidence |
| --- | --- | --- |
| Gutters, padding, gaps and section rhythm | Separate related tasks without crowding or excess travel | Computed styles, bounding boxes, token mapping and screenshot observations |
| Content width and grid occupancy | Give the actual data usable space | Track widths, item count, wrap behavior and last-row screenshots |
| Header, toolbar and action clearance | Keep actions visible without covering content | Measurements at top, middle and bottom scroll positions |
| Reading and control density | Keep labels, values and actions legible and selectable | Long-text, dense-data, text-resize and tap-target measurements |
| Responsive reflow | Preserve every task across widths and orientations | All profiles, breakpoint boundaries and horizontal overflow assertions |
| Dialogs, menus and sheets | Keep focus, context and dismissal available | Open/close, Escape, focus return, scrolling and keyboard tests |
| Theme, contrast and motion | Preserve readability and stability | Both themes, measured contrast, reduced-motion and transition evidence |
| Every interactive control | Establish real observable behavior | Per-control actions, expected/actual outcomes and trace/log references |

Capture viewport and full-page screenshots after deterministic readiness checks and after the final UI edit. Scroll and capture every independently scrolling container. Open every image directly with `read_file` when image-capable, otherwise `view_image` or the available image viewer. Never substitute filenames, thumbnails, a contact sheet alone or DOM metrics for full-resolution inspection.

Measure `document.documentElement.scrollWidth <= window.innerWidth`; also inspect body, children and intentional scroll regions. Detect obscured hit areas, cropped focus rings, clipped text and sticky collisions. Geometric overlap heuristics produce candidates for direct inspection, not automatic proof.

## Diagnose and repair within the authorized scope

For each finding record surface/profile, source selector/file/line, measured and intended geometry, severity, screenshot, functional impact and the smallest appropriate correction. Keep deliberate reading gutters; remove unexplained voids and accidental nested padding. Do not equate maximum density with quality.

Fix shared tokens or shells before local compensation when evidence identifies them as the cause. Edit source directly. Do not use source-replacement scripts, global CSS patches, hidden overflow, shrinking fonts, removed actions, fabricated content or blanket `100vh` locks to make screenshots pass. Recheck every affected caller after shared changes and rerun the full final matrix when done.

Preserve access enforcement, real data, branding and product behavior. Keep all confirmed defects open until verified; a low severity does not waive the completion gate. Stop only dependent checks when blocked and continue all independent coverage.

## Enforce and report

Run the bundled read-only evidence gate with absolute manifest paths:

```text
node <skill-directory>/scripts/validate-audit.cjs <inventory.json> <evidence.json>
```

Exit `0` means the evidence contract passes, `1` means incomplete coverage or a failed check, `2` means malformed input or usage. This validates supplied evidence, not the truth of an inventory or visual quality; perform the source reconciliation and image inspection yourself.

After UI edits run `npm run lint`, `npm run build` and applicable existing interaction tests. Record command, working directory, revision, output and actual exit code. Never replace the browser gate with build success. For skill-authoring-only work, validate the skill and its gate; do not claim the application was audited.

Deliver the AGENTS.md PASS/FAIL report with: discovered/required/executed/passed/failed/blocked counts; complete per-surface matrix; findings and remaining blockers; element-by-element interaction record; screenshot locations and inspection record; CLI/AST exit codes; and a one-line purpose log for every major layout, color and accent choice. Include Google guidance provenance. An unfinished audit is **FAIL (incomplete)**, never a qualified PASS.

Require 100% of the frozen inventory and matrix, zero pending or skipped rows, zero unresolved defects, zero unexpected runtime/console errors, and all required checks passing before claiming completion. Report limitations honestly even when they prevent completion.
