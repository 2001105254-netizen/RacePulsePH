# Spacing and layout standard

Treat every numeric rule as either a project policy, vendor recommendation or accessibility criterion. Do not claim that Google prescribes a universal card padding, grid ratio, whitespace percentage or zero-scroll page. No screen is exempt from inspection; legitimate reading space is not a defect.

## Provenance

Verified on 2026-11-13; recheck browser support when applying new platform features.

| Source | Apply | Verify |
| --- | --- | --- |
| `AGENTS.md` and `.agents/rules/frontend.md` | Authored spacing uses the existing 4/8px rhythm, Tailwind v4 tokens, four type roles, two weights, semantic OKLCH themes and motion rules | Read current files and inspect source tokens plus computed styles |
| `.agents/skills/racepulse-responsive-ui/references/layout.md` | Readable operational workspaces, existing fonts, semantic colors, reachable persistent actions and scrollable landscape/zoom views | Inspect each real host screen in both themes |
| `.agents/skills/modern-web-guidance/guides/css/css-layout.md` | Use intrinsic sizing, content-appropriate flex/grid, shrinkable children and intentional scroll containers | Confirm no overflow masking and no reordered keyboard flow |
| `.agents/skills/modern-web-guidance/guides/css/responsive-design.md` | Account for changing mobile viewport, media geometry and zoomable typography | Measure changing viewport and long-content behavior |
| `.agents/skills/modern-web-guidance/guides/visual-design/improve-text-layout-and-legibility.md` | Apply wrapping by text role; inspect empty areas caused by balanced text inside boxes | Inspect headings and paragraphs at all widths |
| [Google responsive design](https://web.dev/articles/responsive-web-design-basics) | Let content determine layout changes; keep required content reachable | Resize continuously and test immediately around actual breakpoints |
| [Google accessible tap targets](https://web.dev/articles/accessible-tap-targets) | Prefer about 48 CSS px touch targets with about 8px separation | Measure actual hit areas and nearest competing target distance |
| [WCAG 2.2 reflow, 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Preserve information and functionality at 320 CSS px width | Check page reflow and intentionally two-dimensional content separately |
| [WCAG text spacing, 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) | Survive user overrides of line/paragraph/letter/word spacing | Test 1.5 line height, 2em paragraph spacing, 0.12em letter and 0.16em word spacing together |
| [WCAG target size minimum, 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Distinguish the AA 24px minimum and its defined exceptions from stronger product targets | Record the applicable criterion; never label 48px a WCAG AA requirement |

## Project spacing policy

First map existing tokens in `src/index.css` and `src/access-ui.css`. Reuse them where they express the intended relationships. These defaults operationalize this project's 4px rhythm; they are product choices, not Google or ISO requirements.

| Relationship | Default baseline | Functional reason and verification |
| --- | --- | --- |
| Phone page gutter | 16px each side | Protect text and controls from the screen edge; measure the usable content boundary |
| Tablet / desktop gutter | 24px / 32px | Separate content from navigation without stranding a narrow workspace; measure shell plus child padding together |
| Panel padding | 16px phone, 24px larger layouts | Give labels and controls breathing room; inspect nested padding and every edge |
| Related controls | 8px or 12px gap | Preserve association and distinct hit areas; measure edge-to-edge distance |
| Field groups | 16px gap | Separate fields and their messages; inspect multiline labels and validation |
| Sections | 24px phone, 32px larger layouts | Make task boundaries clear; compare adjacent and repeated sections |
| Label to field/help | 4px or 8px | Keep instructions attached to the right field; inspect long help and error text |
| Standalone touch controls | At least 44px hit area; prefer 48px for primary/coarse-pointer actions | Meet existing project guidance and stronger Google recommendation; inspect bounds, occlusion and overlap |

Use another existing 4px-multiple token only when a documented task relationship supports it. Record the selector, token, measured value and one-line reason. A reason cannot waive clipping, obscured actions, missing content or inaccessible targets. Auto margins, fractional track geometry, safe-area insets and user text overrides are not authored pixel spacing tokens; classify and inspect them rather than rounding them blindly.

## Mandatory inspection rubric

| Inspect | Fail when | Evidence and correction direction |
| --- | --- | --- |
| Total inset | Shell + page + card padding squeezes working content | Measure the full chain; assign each inset one responsibility |
| Vertical gaps | Fixed/min heights, empty grid tracks or stacked margins strand useful controls | Measure the void and inspect content flow; use content-based sizing |
| Dense toolbars | Labels collide, actions wrap incoherently or touch targets compete | Record rows, widths and targets; regroup or reflow controls |
| Grid occupancy | Empty tracks or equal-height rows create unexplained voids | Compare sparse/dense data and the final row; fit actual content |
| Width balance | Operational content is constrained without purpose, or prose becomes difficult to scan | Relate width to the task; preserve readable prose and compact authentication forms |
| Dialog geometry | Nested scrolling, offscreen close/save, cropped content or lost focus | Test short viewport, text overrides, keyboard and focus return |
| Sticky/fixed regions | Headers, bottom navigation, safe areas or software keyboard obscure content/focus | Measure visible viewport and last-item clearance; test scrolled positions |
| Text and numbers | Long names, currency, bibs, dates or errors overflow or lose meaning | Seed bounded stress data; wrap or reveal complete values accessibly |
| Scroll behavior | An overflow fix hides content or forces unnecessary two-axis page scrolling | Measure root and each scroll container; keep valid table/map scrolling contained |
| States | Loading, empty, disabled or failure UI collapses, shifts or conceals recovery | Exercise the actual state and inspect complete recovery interaction |
| Theme and affordance | Boundaries, disabled state, focus or text disappear in either theme | Measure contrast and inspect active/focus/disabled states |

Flag source patterns as investigation candidates, not automatic defects: `h-screen`, large `min-h-*`, nested `p-*`, `space-y-*` plus margins, `justify-between` on tall containers, `auto-fill`, arbitrary spacing, fixed widths, nonshrinking flex children, clipped overflow and stacked fixed bars. Confirm the rendered impact before changing code.

Preserve useful negative space, reading width and touch comfort. Never chase an invented whitespace ratio, force all pages into one viewport, remove needed scrolling or copy a fixed console split to unrelated screens.
