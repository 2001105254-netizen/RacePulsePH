# Coverage and evidence contract

## Scope and denominator

Define a surface as one distinct reachable route or state-rendered view, role/permission context, data state and overlay/tab/wizard configuration. Distinct paths/aliases need entry verification even when they render the same component. Check shared components in every host context. Do not enumerate infinite data values: enumerate all source-backed branches and use deterministic normal, empty, long and dense fixtures for each data shape. Never describe that finite matrix as proof for every possible device or input.

Trace conditions through source, not only import names. Include rendered disabled and unauthorized controls; verify their non-action and explanation. Record logically unreachable combinations with the source condition that proves them unreachable in the discovery log. They are not screens. Missing credentials, hardware, data or a browser are blockers, not evidence of unreachability. Never remove blocked surfaces from coverage.

Keep an inventory JSON separate from results. Freeze it before execution, record its SHA-256 in the evidence, and review additions/removals against the discovery log. If scope expands, retain prior IDs and rerun affected profiles. The validator cannot discover omitted screens; source-to-runtime reconciliation is mandatory human/agent review.

## Required profiles

For every surface run these six viewports in BOTH light and dark themes (12 default cases):

| Profile prefix | CSS viewport | Purpose |
| --- | --- | --- |
| desktop-wide | 1440x900 | Verify wide workspace occupancy |
| desktop | 1280x800 | Verify constrained desktop layout |
| tablet | 768x1024 | Verify intermediate reflow |
| phone | 390x844 | Verify normal phone usability |
| narrow | 320x568 | Verify narrow and short reflow |
| landscape | 844x390 | Verify short-height controls and scrolling |

Profile IDs are `<prefix>-<theme>`; `variant` is `default`.

Also run `text-spacing`, `text-resize-200` and `reduced-motion` variants at phone (390x844) and desktop (1280x800), in BOTH themes (12 more cases). IDs are `<prefix>-<theme>-<variant>`. These 24 profiles are a floor. Text-resize must actually double effective text size without losing controls, not change only deviceScaleFactor. Record the measured pre/post font sizes and method. Keep user zoom enabled; verify real browser zoom/reflow separately where the runtime supports it.

Add `extraProfiles` for every actual responsive breakpoint at minus/plus 1 CSS px, container-query boundaries, additional supported browser engines and relevant Android/WebView safe-area/keyboard configurations. Review the source to identify them. A browser screenshot is not evidence of native keyboard or Android window-inset behavior. Record unavailable native checks as blockers. Add real 200%/400% browser zoom profiles where supported; do not call a narrow viewport a performed browser zoom test.

## Inventory JSON

Store artifacts in conversation scratch; keep the final report with the project when appropriate. Resolve artifact references relative to the evidence JSON. Use separate capture sets for each run and never commit session tokens, private account data or browser storage state.

```json
{
  "schemaVersion": 1,
  "sourceRevision": "commit-and-worktree-diff-sha256",
  "discovery": {
    "reconciled": true,
    "log": "discovery.md",
    "sources": ["src/App.tsx", "src/components/AuthorizedWorkspace.tsx"],
    "extraProfileReview": "breakpoints-and-platforms.md"
  },
  "extraProfiles": [],
  "surfaces": [{
    "id": "guest-login-default",
    "source": "src/App.tsx:75",
    "entry": "Open /login with a signed-out local test session",
    "role": "guest",
    "state": "default",
    "purpose": "Authenticate a returning runner",
    "controls": [{"id": "submit", "action": "Submit valid local fixture", "expected": "Show the signed-in workspace"}]
  }]
}
```

This is schema illustration only, not a completed inventory. Use current source locations. Add extra profiles with `id`, `width`, `height`, `theme` and `variant`. The discovery log lists source candidates, source fingerprints, condition/role coverage, runtime observations and absent-state dispositions. The profile review lists all examined breakpoints and supported platforms, even when no extras are required.

## Evidence JSON

```json
{
  "schemaVersion": 1,
  "inventorySha256": "sha256-of-exact-inventory-file-bytes",
  "sourceRevision": "same-as-inventory",
  "runId": "2026-11-13-local-audit",
  "capturedAt": "2026-11-13T12:00:00Z",
  "commands": [
    {"name": "lint", "exitCode": 0, "log": "lint.log"},
    {"name": "build", "exitCode": 0, "log": "build.log"}
  ],
  "findings": [],
  "blockers": [],
  "purposeLog": "purpose.md",
  "guidanceLog": "guidance.md",
  "cases": [{
    "surfaceId": "guest-login-default",
    "profileId": "phone-light",
    "status": "PASS",
    "observed": {"width": 390, "height": 844, "theme": "light", "variant": "default", "url": "http://localhost:3000/login"},
    "screenshots": [
      {"path": "login-phone-light-viewport.png", "kind": "viewport", "inspected": true},
      {"path": "login-phone-light-full.png", "kind": "full-page", "inspected": true}
    ],
    "measurements": "login-phone-light-measurements.json",
    "interactionLog": "login-phone-light-interactions.json",
    "consoleLog": "login-phone-light-console.json",
    "consoleErrors": [],
    "pageErrors": [],
    "geometry": {"innerWidth": 390, "scrollWidth": 390},
    "checks": {"spacing": true, "layout": true, "clipping": true, "overlap": true, "keyboard": true, "focus": true, "touchTargets": true, "contrast": true, "content": true, "theme": true, "motion": true},
    "controls": [{"id": "submit", "status": "PASS", "actual": "Observed signed-in local workspace", "evidence": "login-phone-light-interactions.json"}]
  }]
}
```

Add all remaining cases. `FAIL`, `BLOCKED` and `PENDING` are recordable statuses but never pass. Set truthful booleans only after measurement and direct inspection; do not fill the schema with optimistic defaults. Add `container` screenshots for nested scrollers at top/middle/bottom; mark every screenshot inspected individually. Each required case must have its own image paths, viewport evidence and complete-page evidence. Use PNG captures. The validator checks PNG signatures and viewport dimensions, not image semantics.

Measurements must identify selectors, bounding rectangles, computed padding/margins/gaps, hit areas, root overflow, scroll extents, sticky clearances, text metrics, contrast ratios, actual theme and variant application. Include each spacing finding's observed value, intended token and functional reason. A report boolean does not replace the measurement file.

Set the RacePulse theme via `racepulse_theme` localStorage and verify the root `dark` class and actual styles; OS emulation alone does not override a saved app theme. Capture console and page errors from before navigation through all interactions. Stub errors through local fixtures without concealing real exceptions. Wait for route-specific content and fonts, not an arbitrary timeout or `networkidle` on realtime subscriptions.

Exercise every control with pointer/touch and keyboard where applicable, including cancel/reopen, validation, filtering, clearing, navigation back/forward, focus restoration and disabled non-actions. Record expected/actual effects, locators and trace/log evidence. For destructive actions use safe local fixtures. Include controls revealed by scroll and overlays; add newly revealed surfaces to the inventory.

## Verdict and limitations

The validator checks the declared inventory cross product, required files, status, commands, reported geometry/checks and control coverage. It cannot certify source completeness, screenshot inspection, fixture authenticity, executed interactions, standards compliance or the truth of reported metrics. Review those raw artifacts directly and run the actual browser tests. Never use the validator's PASS alone as the app verdict.

Require findings to be `resolved` with a verification artifact; any open finding or blocker fails completion. Report exact per-surface counts and missing rows even on partial runs. A blocked native/authenticated screen must remain visible in the report. Rerun after the last source change; bind both inventory and evidence to the final revision plus working-tree fingerprint.
