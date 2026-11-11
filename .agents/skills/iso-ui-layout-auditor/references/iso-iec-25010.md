# ISO/IEC 25010: System and Software Quality Models (SQuaRE)

## Standard Identity & Scope

- **Designation:** ISO/IEC 25010 (Systems and software engineering, Systems and software Quality Requirements and Evaluation (SQuaRE), System and software quality models).
- **Scope:** Software product quality model encompassing functional suitability, performance efficiency, compatibility, interaction capability (usability), reliability, security, maintainability, and flexibility.

## Core Principles Audited by This Skill

1. **Functional suitability & completeness:** Every visible control, filter, search box, shortcut, and form submission must execute a real domain workflow; zero placeholder links or dead UI (`C-2`, `R-26`).
2. **Interaction capability (usability & operability):** Interfaces must support appropriateness recognizability, learnability, operability, user error protection, user engagement, and inclusivity/accessibility across keyboard, pointer, and touch (`R-32`, `R-39`).
3. **Reliability & state resilience:** Operational screens must handle empty datasets, slow/loading fetches, network partitions, and error recoveries gracefully (`R-27`), preserving queued actions and user drafts.
4. **Performance efficiency:** Maintain responsive UI transitions under `300ms` using GPU-composited properties (`transform`, `opacity`) only, and avoid layout thrashing during live list/leaderboard updates (`AGENTS.md`).
5. **Maintainability & theme parity:** Use shared semantic tokens (`--surface-page`, `--surface-card`, `--border-default`, `--text-primary`) and shared primitives (`WorkspaceShell`, `DialogSurface`, `FeedbackProvider`) so both light and dark modes hold up consistently (`R-34`).

## Desktop Console Criteria (`1080p` / `1366x768`, `100vh`)

- **Complete UI state coverage:** Audit the master list (`64%`) and control dock (`36%`) for explicit loading, empty-search, zero-data, and API-error states (`R-27`).
- **Theme parity:** Verify readability and contrast across both light and dark themes (`R-34`, `R-25`).
- **Token-driven styling:** Reject duplicated custom modal overlays or arbitrary hardcoded hex colors that break theme parity.

## Mobile Field-Staff Criteria (`390x844`, `100dvh`)

- **Field reliability indicators:** Surface offline queue status and sync errors compactly inside the `48px` sticky bar badge/drawer without crashing or clearing the screen when connectivity fluctuates.
- **Single-column responsiveness without feature loss:** Every desktop operator capability (search, filter, inspect, assign, reset with guard) remains reachable on mobile via bottom sheets and sticky controls (`racepulse-responsive-ui`, `C-4`).

## React & Tailwind Audit Patterns

```tsx
// Explicit loading, error, and empty states inside the master list pane (R-27)
{loading ? (
  <div role="status" className="p-6 text-sm text-[var(--text-secondary)]">Loading participant roster...</div>
) : error ? (
  <div role="alert" className="m-4 p-4 rounded-lg border border-red-600/40 bg-red-500/10 text-sm">
    <p className="font-semibold">Unable to load roster</p>
    <p className="mt-1 text-xs">{error}</p>
  </div>
) : filteredRows.length === 0 ? (
  <div className="p-6 text-sm text-[var(--text-secondary)]">No matching participants. Adjust search or active filters.</div>
) : (
  <RosterList rows={filteredRows} />
)}
```

## Inspection Evidence

- Exercise empty, loading, error, and populated states in both Desktop (`1366x768` / `1920x1080`) and Mobile (`390x844`) views (`R-27`).
- Click through every interactive control and report element-by-element results (`R-35`).
- Verify `npm run lint` and `npm run build` exit `0` when source code changes are part of the refactor.
