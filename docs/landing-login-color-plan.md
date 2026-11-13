# RacePulsePH landing and login color implementation plan

Status: Proposed, planning only. No UI changes implemented.

## One idea: Finish-Line Radiance

Bring back RacePulsePH's bright red and coral gradients as concentrated light around the existing runners and track artwork. A warm highlight fades through coral into system red, making the hero feel like runners crossing an illuminated finish line. Carry a softer version into login so the two pages feel connected.

The magical quality comes from luminous color and depth within the existing composition. The visual identity stays athletic, welcoming and precise.

## Scope and layout lock

- Change the public landing page and login mode only.
- Preserve all current grids, spacing, dimensions, typography, line breaks, radii, image positions, responsive breakpoints, section order and controls.
- Preserve the logo, runner artwork, copy, navigation, authentication and race data behavior.
- Keep signup, profile completion, authenticated workspaces, race detail/results screens and shared navigation outside the visual changes. Check them for style leakage where components are shared.
- Treat the current working files as the layout baseline. They contain uncommitted modernization work; do not restore older components from Git.

## Palette continuity

Source evidence: `src/index.css` still contains `.hero-banner-glow`, `.ambient-glow`, `.hero-finish-tape`, `.auth-glow` and `.auth-beam`. The same gradient family exists at Git HEAD `4cc8da8`. These styles establish the palette reference; the current page CSS establishes the layout reference.

| Existing color | Proposed role |
| --- | --- |
| System red `#FF3B30` | Main glow color and concentrated athletic energy |
| Coral `#FF6259` | Bright transition and track highlights |
| Warm light `#FFE8E1` | Small luminous center fading into coral |
| Charcoal `#141416` | Dark structural anchor and continuity with the system |
| Deep reds `#B01E16` and `#CC251C` | Readable action fills beneath light button labels |

Convert the reference colors into OKLCH tokens for implementation. Keep decorative glow tokens separate from text, button and semantic status tokens. Retain the existing light canvas and dark charcoal surfaces. Concentrate saturation around the hero; follow the project's 60/30/10 neutral, structural and accent balance.

## Visual treatment

| Area | Planned treatment | Functional purpose |
| --- | --- | --- |
| Landing hero runners | Replace the flat `.landing-track` fill with a red/coral gradient and one warm radial highlight behind the existing runner group. Fade the light at the existing bounds. | Makes the race imagery the visual focal point without moving content. |
| Existing track lines | Recolor the current curves with stronger coral highlights, preserving their shapes and stroke widths. | Connects the light treatment to running lanes and the finish line. |
| Hero headline | Keep text solid and readable; apply the red-to-coral gradient to the existing underline only. | Emphasizes “finish line” while keeping every letter legible. |
| Landing actions and lower content | Keep surfaces calm; use accessible deep red action fills and restrained coral accents. | Preserves the hierarchy from discovery to race selection. |
| Login welcome area | Echo the hero's gradient at lower intensity behind the existing track illustration. | Creates continuity from landing to sign-in without competing with the form. |
| Login form | Retain its opaque surface; refine existing accent and border colors only. Keep Google branding and error styling intact. | Protects form readability and recognizable account actions. |

Light mode uses a bright coral glow fading into the current warm neutral background. Dark mode uses the same hues with stronger luminous contrast against charcoal. On mobile, fit the color treatment inside the current artwork bounds; preserve login's existing hidden track illustration.

Use static CSS gradients and existing decorative layers. No new continuous animation, particles, generated imagery, canvas or dependency is needed. Preserve existing motion; any affected transitions must stay below 300ms, use only opacity/transform and honor reduced motion. Decorative layers must not intercept pointer events or cover focus indicators.

Design direction: energy 3, existing composition/rhythm retained, existing motion retained. The color focal point carries the increased intensity.

## Implementation sequence

1. **Record the current baseline.** Capture screenshots and element bounding boxes before editing. Freeze fonts, assets, viewport and race fixtures so color comparisons do not confuse content changes with layout changes.
2. **Add scoped color tokens.** Declare reusable namespaced color tokens with Tailwind v4 `@theme`. Apply theme-specific values only under `.public-landing` and an explicit login-mode marker. Do not override global red, surface or shared button tokens.
3. **Apply the landing treatment.** Edit `src/components/public-landing.css`. Reuse `.landing-track`, its spans and the headline underline. Add only paint-only pseudo-elements if required, with no document-flow effects. Keep the existing runner asset unchanged.
4. **Apply the login treatment.** Edit `src/components/auth-gate.css`. Add a `data-auth-mode={mode}` marker to the existing `.auth-layout` in `src/components/AuthGate.tsx` so rules target login explicitly. Do not recolor the shared `AuthStage` or signup through broad selectors. If the existing SVG track needs a gradient, add scoped SVG definitions without changing path geometry.
5. **Verify and report.** Run the gates below, correct color or scope failures, and capture fresh evidence after the final UI edit. Report existing unrelated defects separately; do not silently expand the layout scope.

Expected implementation files: the two page CSS files and the minimal login selector/SVG hooks in `AuthGate.tsx`. `PublicRaceLanding.tsx` should need no structural change. `App.tsx`, global theme values, shared UI primitives and backend code remain outside the change.

## Acceptance gates for implementation

| Gate | Required evidence for PASS |
| --- | --- |
| Visual matrix | Headless Playwright captures of both pages at 1440x900, 1280x800 and 390x844, each in light and dark mode: 12 baseline and 12 final screenshots, plus affected states. Save in conversation scratch and inspect every image directly. |
| Layout preservation | Compare baseline/final bounds for headings, artwork, actions, lookup, catalog and login controls with the same content. No changes to size, position or line wrapping beyond subpixel rounding. Confirm `scrollWidth <= innerWidth`, no overlap/clipping, balanced occupancy and no newly introduced blank space. |
| Contrast | Measure actual rendered text, controls, focus rings and all affected states. Require 4.5:1 normal text, 3:1 qualifying large text and 3:1 essential non-text indicators. Sample the worst composited gradient position; record APCA readings separately. |
| Landing interactions | Record individual checks for Browse races scrolling, Create account navigation, bib lookup, search/clear, status tabs, distance filters and available race actions. Verify header theme/navigation controls still work. Use controlled local fixtures for data-dependent states. |
| Login interactions | Record username/email entry, password visibility, blank/invalid validation, submit/loading/error states, forgot-password handling, Google initiation/cancel/error and mode switching. Use mocks/emulators for network effects; do not send live reset emails or create real accounts. Mark provider success blocked unless tested. |
| Resilience and scope | Keyboard navigation, visible focus, reduced motion, 200% zoom, mobile input use, loading/empty/error states and zero console/page errors. Compare signup/profile completion and representative shared surfaces for unintended color changes. |
| CLI and source guards | Run `npm run lint`, `npm run build` and `git diff --check`, reporting each exit code. Check the implementation diff/AST for changes to layout properties, global tokens, copy and behavior. A missing guard or blocked check cannot receive PASS. |

Keep the element-by-element interaction log and purpose table with the implementation report. Mark each executed check PASS or FAIL, and keep untested/blocked checks visible. UI approval requires completed visual and interaction evidence.

## Planning-stage audit

| Check | Result |
| --- | --- |
| One concept, two-page scope, layout lock and file targets | PASS: explicitly documented and grounded in current source |
| Existing palette continuity | PASS: red/coral/warm-light gradient references found in source and Git HEAD |
| Proposed button-label pairing | PASS: `#FFFAFA` on `#B01E16` measures 6.67:1; on `#CC251C` measures 5.28:1. Node contrast calculation exit 0. These are solid-color checks, not proof of the future rendered UI. |
| Initial Python contrast command | FAIL: the Windows Python alias could not start, exit 1. The same calculation completed through the Node fallback above. |
| Final visual, interaction, build and AST gates | NOT RUN: this deliverable is an implementation plan. No UI implementation PASS is claimed. |

