# Socials Workspace & Mode Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Facebook-style `Socials` workspace directly to RacePulsePH's existing `Workspace mode` segmented switcher (`Operations | My participation | Socials` for admins, organizers, and super admins; `My participation | Socials` for runners), enable `personal.*` defaults on the `admin` role preset, and hydrate safe GPS run summaries and live-checked quoted repost previews in `communityApi`.

**Architecture:** Promote `AuthorizedWorkspace` from 2 modes (`operations | personal`) to 3 RBAC-gated modes (`operations | personal | socials`) managed by a pure state module (`src/lib/workspaceModes.ts`). Extend the existing `WorkspaceSwitchProps` in `DesktopSidebar` and `WorkspaceShell` across desktop, tablet rail, and mobile segmented bar, add a lazy-loaded Facebook-style `SocialsDashboard` reusing an upgraded `RunnerSocialFeedPanel` and `SocialPostComposerDialog`, de-duplicate social posts out of `RunnerHomePanel`, and hydrate owner-verified `attachedRunSummary` and privacy-checked `repostPreview` in `functions/social-service.js`.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS v4, Lucide React, Firebase Auth / Firestore / Storage / Cloud Functions v2 (Node 22), Node built-in test runner + `tsx`, Playwright (visual/interactive verification).

**Spec:** `docs/superpowers/specs/2026-11-26-socials-workspace-design.md`

---

## Global Constraints

- **RBAC parity:** `functions/access-policy.js`, `scripts/build-access-rules.cjs`, `firestore.rules`, `src/lib/access-presets.json`, `functions/rbac/*`, and `storage.rules` must stay strictly synchronized.
- **Firestore rules specialist gate:** Any edit or regeneration of `firestore.rules` MUST be reviewed/authored via the `firestore-rules-author` subagent before committing or deploying.
- **Telemetry compatibility:** `TelemetryWorkspace` remains `'personal' | 'operations'`; heartbeats while in `'socials'` map to `'personal'`.
- **UI craftsmanship (`AGENTS.md`):** Zero em dashes (`—`) in UI microcopy; zero fabricated stats or dummy social posts in production; `min-h-11` (44px) touch targets; 4/8px spacing multiples; WCAG AA contrast in light and dark modes; full keyboard navigation (`Tab`, `Enter`, `Space`, `Escape`, arrow keys on tablists).
- **Security & data integrity:** Owner-verify `attachedRunId` inside Firestore transactions (no cross-user IDOR); never leak raw GPS track coordinates or deleted/moderated/blocked source posts; run `npm run verify:rbac`, `npm test`, `npm run build`, and `node scripts/security-audit.cjs --dist`.

## Review Focus

1. **Cross-user `attachedRunId` IDOR and private track leak:** Passing another runner's `recordedRuns` ID when creating a post must fail with `403`/`404`, and attaching an owned `private` run to a `public` post must emit only scalar metrics (`attachedRunSummary`) with zero `trackPoints` or `trackStoragePath` (pinned in Task 2).
2. **Deleted, moderated, or blocked source post leaking via reposts:** If a reposted source post is later deleted, hidden by moderation, or its author is blocked by/blocking the viewer, `/social/feed` must redact `repostPreview` to `{ unavailable: true }` instead of returning stale snapshot text/media (pinned in Task 2).
3. **Admin `personal.*` parity across Firestore, Storage, overrides, and suspension:** A standard `admin` with no `userAccess` doc (or legacy doc without `personal.*`) must pass Firestore and Storage personal checks (`run-tracks`, `social-media`), while explicit `overrides: { 'personal.social': false }` or `status: 'suspended'` must still deny (pinned in Task 1).
4. **Deep-link precedence and partial-permission accounts:** `?payment=...` and `?register=<raceId>` must always open `'personal'`; a `personal.social`-only account must see only `'socials'` (no 2-way switcher to an empty `My participation`); disabling `personal.social` via override must still allow `My participation -> Home` (pinned in Task 3).
5. **Active GPS run guard and 360px-390px 3-segment switcher fit:** Switching workspaces while `isRecordingRun === true` must run the `"Leave active run?"` confirmation and abort unmount if canceled; the 3-way mobile pill bar must have zero horizontal overflow (`scrollWidth <= innerWidth`) and `>= 44px` tap targets on `390x844` (pinned in Tasks 4, 7, and 8).

---

## File Structure Map

| File | Action | Responsibility |
| :--- | :--- | :--- |
| `functions/access-policy.js` | Modify | Enable `personal.*` defaults for `role === 'admin'` |
| `scripts/build-access-rules.cjs` | Modify | Sync `presetForRole` for `admin` in generated `firestore.rules` |
| `firestore.rules` | Regenerate via `firestore-rules-author` | Generated Firestore RBAC rules matching updated `admin` preset |
| `src/lib/access-presets.json` | Regenerate | Browser preset bundle synced from `functions/access-policy.js` |
| `functions/rbac/*` | Regenerate | Synced RBAC Cloud Function deployment folder |
| `storage.rules` | Modify | Include `'admin'` in `canPersonalWithRole` fallback |
| `functions/social-service.js` | Modify | Owner-verified `attachedRunSummary` + live-redacted `repostPreview` hydration |
| `src/lib/social/types.ts` | Modify | Add `AttachedRunSummary` and `RepostPreview` interfaces to `SocialPostRecord` |
| `src/lib/social/feedHelpers.ts` | Modify | Add `formatSocialPostTimestamp`, collect unsigned `repostPreview` thumbnails |
| `src/lib/clubs/e2eFixtures.ts` | Modify | Include realistic `attachedRunSummary` and `repostPreview` in DEV E2E starter posts |
| `src/lib/workspaceModes.ts` | Create | Pure 3-mode state machine, RBAC resolver, deep-link defaults, presence mapping |
| `src/lib/runnerShell.ts` | Modify | Decouple `home` tab gating from `personal.social` |
| `src/components/DesktopSidebar.tsx` | Modify | Extend `WorkspaceSwitchProps` to 3 dynamic modes (`operations | personal | socials`) |
| `src/components/WorkspaceShell.tsx` | Modify | Extend mobile segmented bar (2-col / 3-col) & tablet rail + `hideWorkspaceSwitch` prop |
| `src/components/runner/SocialPostComposerDialog.tsx` | Modify | Add `initialAction?: 'default' | 'media' | 'run' | 'location'` quick-focus support |
| `src/components/runner/RunnerSocialFeedPanel.tsx` | Modify | Facebook-style post cards: `More` menu, embedded run card, nested repost card, collage media, 3-col action bar, comment bubbles, `refreshNonce` |
| `src/components/SocialsDashboard.tsx` | Create | Dedicated Facebook-style Socials workspace with top composer card, Discover/Following tabs, desktop right rail, and personal deep-link handoff |
| `src/components/AuthorizedWorkspace.tsx` | Modify | 3-mode workspace switching, deep-link intent handoff, async `beforeSwitchGuard`, presence mapping |
| `src/components/RunnerDashboard.tsx` | Modify | Accept `initialPersonalIntent`, `onOpenSocials`, `registerBeforeSwitchGuard`, pass `hideWorkspaceSwitch` |
| `src/components/runner/RunnerHomePanel.tsx` | Modify | Remove duplicate inline social feed & composer; add `"Open Socials"` CTA when permitted |
| `tests/workspace-modes.test.ts` | Create | Unit tests for `src/lib/workspaceModes.ts` |
| `package.json` | Modify | Register `tests/workspace-modes.test.ts` in `npm test` |

---

### Task 1: Enable `personal.*` on Admin RBAC Preset & Sync Rules

**Files:**
- Modify: `functions/access-policy.js:19-24`
- Modify: `scripts/build-access-rules.cjs:27-31`
- Modify: `storage.rules:161-165`
- Regenerate: `firestore.rules` (via `firestore-rules-author` subagent), `src/lib/access-presets.json`, `functions/rbac/*`
- Test: `tests/access-policy.test.cjs:106-114`, `tests/access-rules.test.cjs:615-622`, `tests/storage-access.test.cjs:85-99,170-192`

**Interfaces:**
- Produces: `policy.defaults('admin')` returns `true` for every `personal.*` key while keeping `highlights.playlist: false` and `bibs.studio: false`; `storage.rules` `canPersonalWithRole` includes `'admin'` in its default fallback; `firestore.rules` `presetForRole` mirrors `functions/access-policy.js`.

- [ ] **Step 1: Write the failing RBAC tests first (RED)**

Update `tests/access-policy.test.cjs` around lines 106-114 to assert `defaults('admin')[key] === true` for all `personal.*` keys (including `personal.record`, `personal.social`, `personal.clubs`, `personal.inbox`), while preserving `defaults('admin')['highlights.playlist'] === false`, `defaults('admin')['bibs.studio'] === false`, explicit deny overrides (`overrides: { 'personal.social': false }`), and suspension (`status: 'suspended'`).

Update `tests/access-rules.test.cjs` around lines 615-622 to assert `admin_legacy` succeeds on `personal.record`, `personal.social`, `personal.clubs`, `personal.inbox`, and add an `admin_social_denied` case with `overrides: { 'personal.social': false }` that fails `_rbacProbe/personal.social`.

Update `tests/storage-access.test.cjs` lines 88 and 187 so default `track_admin` and `social_admin` (`role: 'admin'`) succeed uploading to their own `run-tracks/{uid}` and `social-media/{uid}` paths, and add an explicit `admin` with `overrides: { 'personal.social': false }` that fails `social-media` upload (and confirm `social_admin` still cannot read another user's private `social-media` file).

- [ ] **Step 2: Run unit policy test to verify RED**

Run: `node --test tests/access-policy.test.cjs`
Expected: FAIL on `admin should default personal.record to true` (currently `false`).

- [ ] **Step 3: Update `functions/access-policy.js`, `scripts/build-access-rules.cjs`, and `storage.rules`**

1. In `functions/access-policy.js:21`, remove `!key.startsWith('personal.') && ` from the `role === 'admin'` branch so it reads:
   `(role === 'admin' && key !== 'highlights.playlist' && key !== 'bibs.studio')`
2. In `scripts/build-access-rules.cjs:28`, remove `!action.matches('personal[.].*') && ` from `presetForRole` so it reads:
   `return role == 'superadmin' || (role == 'admin' && action != 'highlights.playlist' && action != 'bibs.studio')`
3. In `storage.rules:162`, update `canPersonalWithRole` fallback to:
   `let fallback = role in ['runner', 'organizer', 'admin', 'superadmin'];`

- [ ] **Step 4: Regenerate `src/lib/access-presets.json`, `functions/rbac/*`, and update `firestore.rules` via `firestore-rules-author`**

Run `npm run generate:access` to update `src/lib/access-presets.json` and `firestore.rules`, then delegate the `firestore.rules` diff review/authoring to the `firestore-rules-author` subagent (mandatory per workspace rules) and run `node scripts/build-access-deploy.cjs` to sync `functions/rbac/`.

- [ ] **Step 5: Run full RBAC verification (GREEN)**

Run: `node --test tests/access-policy.test.cjs && npm run verify:rbac`
Expected: Exit code `0`, all 49+ Firestore & Storage emulator security tests pass, `RBAC verification passed.`

- [ ] **Step 6: Commit Task 1**

```bash
git add functions/access-policy.js functions/rbac/ scripts/build-access-rules.cjs src/lib/access-presets.json firestore.rules storage.rules tests/access-policy.test.cjs tests/access-rules.test.cjs tests/storage-access.test.cjs output/rbac-verification.json
git commit -m "feat(rbac): enable personal and social presets for admin role"
```

---

### Task 2: Hydrate Safe GPS Run Summaries & Live-Redacted Repost Previews in `communityApi`

**Files:**
- Modify: `src/lib/social/types.ts:1-60`
- Modify: `src/lib/social/feedHelpers.ts:1-66`
- Modify: `functions/social-service.js:240-445,788-875`
- Modify: `src/lib/clubs/e2eFixtures.ts` (dev starter social posts + `createDevSocialPostFixture`)
- Test: `tests/community-social-inbox.test.cjs`, `tests/m4-runner-social-clubs.test.ts`

**Interfaces:**
- Produces in `src/lib/social/types.ts`:
  - `AttachedRunSummary`: `{ runId: string; title: string; distanceM: number; movingTimeMs: number; avgPaceSecPerKm: number | null; elevationGainM: number; activityKind?: string; startedAt?: string }`
  - `RepostPreview`: `{ postId: string; uid: string; authorDisplayName: string; authorUsername?: string; authorPhotoURL?: string; text: string; createdAt: string; mediaType: SocialMediaType; firstMediaThumbnailPath?: string; firstMediaThumbnailUrl?: string; attachedRunSummary?: AttachedRunSummary | null; unavailable?: boolean }`
  - Optional `attachedRunSummary?: AttachedRunSummary | null` and `repostPreview?: RepostPreview | null` on `SocialPostRecord`.
- Produces in `src/lib/social/feedHelpers.ts`:
  - `formatSocialPostTimestamp(iso: string, nowMs?: number): string`
  - Updated `collectUnsignedMediaPaths(posts, snaps)` also collecting unsigned `post.repostPreview?.firstMediaThumbnailPath`.

- [ ] **Step 1: Write failing backend & helper tests (RED)**

In `tests/community-social-inbox.test.cjs`, add tests asserting:
1. Creating a post with `attachedRunId` owned by `actorUid` stores scalar-only `attachedRunSummary` (`runId`, `title`, `distanceM`, `movingTimeMs`, `avgPaceSecPerKm`, `elevationGainM`, `startedAt`) with ZERO `trackPoints`, `trackStoragePath`, or `previewPolyline` fields, even when the run's `privacy === 'private'`.
2. Creating a post with another user's `attachedRunId` (IDOR) or a deleted/missing run fails with `403` or `404`.
3. Reposting a public post stores `repostPreview` (author name/handle, text snippet, `mediaType`, first thumbnail path/url, `attachedRunSummary`) and returns it on `/social/feed`.
4. When a reposted source post is subsequently deleted (`deletedAt`), hidden by moderation (`hiddenByModeration: true`), or its author blocks/is blocked by the viewer, `/social/feed` redacts `repostPreview` to `{ postId, unavailable: true }` (zero original text or media URL).
5. Legacy feed posts with `attachedRunId` or `repostOfPostId` (missing stored summary/preview) are hydrated on `/social/feed` read.

In `tests/m4-runner-social-clubs.test.ts`, add tests asserting:
1. `formatSocialPostTimestamp` outputs `"Just now"` (<60s), `"14m"`, `"3h"`, `"2d"`, and formatted short date (`"Nov 26"` / `"2025-11-26"`) for older timestamps, and safely handles invalid strings.
2. `collectUnsignedMediaPaths` includes `post.repostPreview.firstMediaThumbnailPath` when `firstMediaThumbnailUrl` is empty and skips it when `unavailable` or already has a URL.

- [ ] **Step 2: Run targeted tests to verify RED**

Run: `node --test tests/community-social-inbox.test.cjs && npx tsx --test tests/m4-runner-social-clubs.test.ts`
Expected: FAIL on missing `attachedRunSummary` / `repostPreview` / `formatSocialPostTimestamp`.

- [ ] **Step 3: Implement types & helpers in `src/lib/social/types.ts` and `src/lib/social/feedHelpers.ts`**

1. Export `AttachedRunSummary` and `RepostPreview` in `src/lib/social/types.ts` and add optional `attachedRunSummary?: AttachedRunSummary | null` and `repostPreview?: RepostPreview | null` to `SocialPostRecord`.
2. Implement `formatSocialPostTimestamp(iso: string, nowMs = Date.now()): string` in `src/lib/social/feedHelpers.ts` (UTC-safe relative formatting: `<60s -> "Just now"`, `<60m -> "${m}m"`, `<24h -> "${h}h"`, `<7d -> "${d}d"`, else `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })`).
3. Update `collectUnsignedMediaPaths` in `src/lib/social/feedHelpers.ts` to also push `post.repostPreview.firstMediaThumbnailPath` when `!post.repostPreview.unavailable && !post.repostPreview.firstMediaThumbnailUrl`.

- [ ] **Step 4: Implement run summary verification and live-checked repost hydration in `functions/social-service.js`**

1. Add pure helpers `buildSafeRunSummary(run)` (extracts only `runId`, `title`, finite `distanceM`, `movingTimeMs`, `avgPaceSecPerKm`, `elevationGainM`, `activityKind`, `startedAt`) and `buildSafeRepostPreview(sourcePost)` (extracts `postId`, `uid`, `authorDisplayName`, `authorUsername`, `authorPhotoURL`, `text.slice(0, 280)`, `createdAt`, `mediaType`, first image thumbnail path/url with `url` blanked if non-public, and `attachedRunSummary`).
2. In `executeCreatePost`:
   - If `validated.attachedRunId`, include `db.doc(\`recordedRuns/${validated.attachedRunId}\`)` in the transaction reads; fail `404` if missing or `deletedAt`, fail `403` if `run.uid !== actorUid`; attach `attachedRunSummary: buildSafeRunSummary(run)`.
   - If `sourcePost` exists, attach `repostPreview: buildSafeRepostPreview(sourcePost)` on `storedPost`.
3. In `/social/feed` (after slicing `page`):
   - Collect unique `repostOfPostId` values and legacy `attachedRunId` values (only for posts on `page` missing `attachedRunSummary`), fetch them via batched doc reads (compatible with both real Firestore `db.getAll` and mock test `db.doc(...).get()`).
   - For each post with `repostOfPostId`: if live source doc is missing or `!canViewerReadPost(liveSource, actorUid, graph)`, set `repostPreview: { postId: p.repostOfPostId, unavailable: true }`; otherwise set `repostPreview: buildSafeRepostPreview(liveSource)`.
   - For each legacy post with `attachedRunId` and no `attachedRunSummary`: if live run exists, `!run.deletedAt`, and `run.uid === p.uid`, attach `attachedRunSummary: buildSafeRunSummary(run)`.
4. Update `src/lib/clubs/e2eFixtures.ts` starter social posts so one starter post includes a realistic `attachedRunSummary` (e.g. `10.05 km` Roxas Blvd run) and `createDevSocialPostFixture` preserves `attachedRunSummary` and `repostPreview` for DEV/Playwright verification.

- [ ] **Step 5: Run tests to verify GREEN**

Run: `node --test tests/community-social-inbox.test.cjs && npx tsx --test tests/m4-runner-social-clubs.test.ts`
Expected: PASS (0 failures).

- [ ] **Step 6: Commit Task 2**

```bash
git add functions/social-service.js src/lib/social/types.ts src/lib/social/feedHelpers.ts src/lib/clubs/e2eFixtures.ts tests/community-social-inbox.test.cjs tests/m4-runner-social-clubs.test.ts
git commit -m "feat(social): hydrate verified GPS run summaries and privacy-checked repost previews"
```

---

### Task 3: Workspace Mode State Machine & Runner Home Tab Decoupling

**Files:**
- Create: `src/lib/workspaceModes.ts`
- Modify: `src/lib/runnerShell.ts:69-87`
- Create: `tests/workspace-modes.test.ts`
- Modify: `tests/runner-shell.test.ts:101-145`
- Modify: `package.json:21` (add `tests/workspace-modes.test.ts` to `test` script)

**Interfaces:**
- Produces in `src/lib/workspaceModes.ts`:
  - `export type WorkspaceMode = 'operations' | 'personal' | 'socials';`
  - `export const WORKSPACE_MODE_ORDER: readonly WorkspaceMode[] = ['operations', 'personal', 'socials'];`
  - `export const WORKSPACE_MODE_META: Record<WorkspaceMode, { label: string; shortLabel: string; railLabel: string; compactLabel: string; ariaLabel: string }>`
  - `export interface PersonalNavigationIntent { tab: RunnerTab; exploreSection?: ExploreSection; exploreFilter?: ExploreRacesFilter; raceId?: string; youSection?: YouSection; dmTargetUid?: string; nonce: number }`
  - `export function hasNonSocialPersonalCapability(can: (action: string) => boolean): boolean`
  - `export function resolveAvailableWorkspaceModes(flags: { operations: boolean; personal: boolean; socials: boolean }): WorkspaceMode[]`
  - `export function resolveDefaultWorkspaceMode(input: { available: readonly WorkspaceMode[]; hasRaceDeepLink: boolean; hasPaymentReturn: boolean }): WorkspaceMode | null`
  - `export function resolveEffectiveWorkspaceMode(selected: WorkspaceMode, available: readonly WorkspaceMode[]): WorkspaceMode | null`
  - `export function resolveWorkspacePresenceMode(mode: WorkspaceMode): TelemetryWorkspace`
  - `export function resolveWorkspaceDirection(available: readonly WorkspaceMode[], from: WorkspaceMode, to: WorkspaceMode): NavDirection`

- [ ] **Step 1: Write failing unit tests in `tests/workspace-modes.test.ts` and update `tests/runner-shell.test.ts` (RED)**

In `tests/workspace-modes.test.ts`, assert:
1. `hasNonSocialPersonalCapability` returns `false` when only `personal.social` is true, and `true` when any other `PERSONAL_CAPABILITY_KEYS` entry is true.
2. `resolveAvailableWorkspaceModes` returns `['operations', 'personal', 'socials']` for admins/organizers/superadmins, `['personal', 'socials']` for runners, `['socials']` for `personal.social`-only accounts, `['operations']` for operations-only accounts, and `[]` when suspended.
3. `resolveDefaultWorkspaceMode` returns `'personal'` when `hasRaceDeepLink` or `hasPaymentReturn` is true (even when `'operations'` is available), `'operations'` otherwise when available, `'personal'` otherwise for runners, `'socials'` when only `'socials'` is available, and `null` when empty.
4. `resolveEffectiveWorkspaceMode` keeps `selected` when still in `available`, and falls back deterministically when a live RBAC update removes `selected`.
5. `resolveWorkspacePresenceMode('socials') === 'personal'`, `resolveWorkspacePresenceMode('personal') === 'personal'`, `resolveWorkspacePresenceMode('operations') === 'operations'`.
6. `resolveWorkspaceDirection` returns `'forward'` when moving right in `available` and `'back'` when moving left.

In `tests/runner-shell.test.ts`, update lines 101-145 to assert that removing `personal.social` (while keeping `personal.register`/`results`/`record`/`friends`/`clubs`) STILL includes `'home'` in `resolveAllowedRunnerTabs` and resolves default tab `'home'` (and a `personal.engraving`-only account without `home` signals resolves `['you']`).

- [ ] **Step 2: Run tests to verify RED**

Run: `npx tsx --test tests/workspace-modes.test.ts tests/runner-shell.test.ts`
Expected: FAIL (`Cannot find module '../src/lib/workspaceModes'` and `home` tab assertion).

- [ ] **Step 3: Implement `src/lib/workspaceModes.ts`, update `src/lib/runnerShell.ts`, and register test in `package.json`**

1. Create `src/lib/workspaceModes.ts` implementing all exported types, `WORKSPACE_MODE_META` (`Operations` / `Ops`, `My participation` / `Participation` / `Run`, `Socials` / `Social`), and pure resolvers.
2. Update `src/lib/runnerShell.ts:71` so `home: () => can('personal.social') || can('personal.register') || can('personal.results') || can('personal.record') || can('personal.friends') || can('personal.clubs')`.
3. Add `tests/workspace-modes.test.ts` to the `test` script in `package.json`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npx tsx --test tests/workspace-modes.test.ts tests/runner-shell.test.ts`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/workspaceModes.ts src/lib/runnerShell.ts tests/workspace-modes.test.ts tests/runner-shell.test.ts package.json
git commit -m "feat(workspace): add 3-mode workspace resolver and decouple Home tab from personal.social"
```

---

### Task 4: Upgrade `Workspace mode` Switcher in `DesktopSidebar` & `WorkspaceShell`

**Files:**
- Modify: `src/components/DesktopSidebar.tsx:1-25,180-225`
- Modify: `src/components/WorkspaceShell.tsx:1-45,100-145,230-285`

**Interfaces:**
- Consumes: `WorkspaceMode`, `WORKSPACE_MODE_META` from `src/lib/workspaceModes.ts`.
- Produces:
  - `export interface WorkspaceSwitchProps { current: WorkspaceMode; available: readonly WorkspaceMode[]; onSelect: (next: WorkspaceMode) => void; }`
  - `hideWorkspaceSwitch?: boolean` prop on `WorkspaceShellProps`.

- [ ] **Step 1: Update `WorkspaceSwitchProps` and sidebar switcher in `src/components/DesktopSidebar.tsx`**

1. Import `Newspaper` (or `Rss`) from `lucide-react` and `WORKSPACE_MODE_META, type WorkspaceMode` from `../lib/workspaceModes`.
2. Update `WorkspaceSwitchProps` to `{ current: WorkspaceMode; available: readonly WorkspaceMode[]; onSelect: (next: WorkspaceMode) => void }`.
3. Render the `role="group" aria-label="Workspace mode"` container whenever `workspaceSwitch && workspaceSwitch.available.length >= 2`, mapping over `workspaceSwitch.available` with matching icons (`SlidersHorizontal` for `operations`, `User` for `personal`, `Newspaper` for `socials`), `aria-pressed={workspaceSwitch.current === mode}`, `aria-label={meta.ariaLabel}`, and collapsed `meta.shortLabel` (`Ops`, `Runner`, `Social`) vs expanded `meta.label` (`Operations`, `My participation`, `Socials`).

- [ ] **Step 2: Update tablet rail and mobile segmented pill bar in `src/components/WorkspaceShell.tsx`**

1. Add optional `hideWorkspaceSwitch?: boolean` (default `false`) to `WorkspaceShellProps`.
2. In the medium tablet rail (`showMediumRail`, lines 105-140), render when `workspaceSwitch && workspaceSwitch.available.length >= 2 && !hideWorkspaceSwitch`, mapping over `workspaceSwitch.available` with `meta.railLabel` (`Ops`, `Run`, `Socials`).
3. In the mobile segmented pill bar (lines 233-278, the exact bar from the user's screenshot), render when `workspaceSwitch && workspaceSwitch.available.length >= 2 && !hideWorkspaceSwitch`:
   - Dynamic columns: `workspaceSwitch.available.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'`.
   - When 3 modes render, use `px-1.5` and responsive label for `'personal'` (`<span className="hidden min-[400px]:inline">My participation</span><span className="min-[400px]:hidden">Participation</span>`) with `truncate` and `min-h-11` (`44px`) so 3 pills never wrap to two lines or overflow `360px` to `390px` viewports, while keeping `aria-label={meta.ariaLabel}`.
   - Preserve the exact rounded border, surface card background, and `bg-red-700 text-white` active pill styling.

- [ ] **Step 3: Keep `available` temporarily optional for intermediate commit safety**

Keep `available?: readonly WorkspaceMode[]` defaulting to `['operations', 'personal']` in `WorkspaceSwitchProps` during Task 4 so `AuthorizedWorkspace.tsx` compiles cleanly before Task 7 wires the 3-mode prop (Task 7 tightens `available` to required).

- [ ] **Step 4: Run lint to verify Task 4 compiles cleanly**

Run: `npm run lint`
Expected: Exit code `0`.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/components/DesktopSidebar.tsx src/components/WorkspaceShell.tsx
git commit -m "feat(ui): support 3-mode Workspace mode switcher across mobile, rail, and sidebar"
```

---

### Task 5: Upgrade `RunnerSocialFeedPanel` & `SocialPostComposerDialog` to Facebook-Style Feed UX

**Files:**
- Modify: `src/components/runner/SocialPostComposerDialog.tsx:30-165`
- Modify: `src/components/runner/RunnerSocialFeedPanel.tsx:1-892`

**Interfaces:**
- Consumes: `AttachedRunSummary`, `RepostPreview` from `src/lib/social/types.ts`; `formatSocialPostTimestamp`, `collectUnsignedMediaPaths` from `src/lib/social/feedHelpers.ts`; `formatDuration`, `formatPace` from `src/lib/runs/runLiveHelpers.ts`.
- Produces:
  - `SocialPostComposerDialogProps`: adds optional `initialAction?: 'default' | 'media' | 'run' | 'location'`.
  - `RunnerSocialFeedPanelProps`: adds optional `refreshNonce?: number`, `onQuickCompose?: (action?: 'default' | 'media' | 'run' | 'location') => void`.

- [ ] **Step 1: Add `initialAction` support to `SocialPostComposerDialog.tsx`**

1. Add `initialAction?: 'default' | 'media' | 'run' | 'location'` to `SocialPostComposerDialogProps`.
2. Add refs for the media picker row (`mediaSectionRef`) and run selector (`runSelectRef`).
3. Inside the `open` transition `useEffect`:
   - If `initialAction === 'location'`, pre-enable `setPinLocation(true)`.
   - If `initialAction === 'run'`, focus/scroll to `runSelectRef` after mount when `recordedRuns.length > 0`.
   - If `initialAction === 'media'`, focus/scroll to `mediaSectionRef` cleanly (never call programmatic `.click()` on hidden file inputs).
4. Ensure DEV `e2e-*` post creation attaches `attachedRunSummary` (derived from the selected `recordedRuns` entry) so Playwright tests render the rich run card immediately after posting!

- [ ] **Step 2: Upgrade `RunnerSocialFeedPanel.tsx` into Facebook-style feed cards**

1. Accept `refreshNonce = 0` and include it in the feed-fetch `useEffect` dependency array so the parent's Refresh button triggers a clean re-fetch.
2. Add `openMenuPostId` state with outside-pointerdown + `Escape` close handler for each card's accessible **`More` (`MoreHorizontal`) menu** (`min-h-11 min-w-11`, `aria-haspopup="menu"`, `aria-expanded`) holding `Delete Post` (for self) or `Report Post` + `Block Runner` (for others). Remove the cluttered inline `Delete` / `Report` / `Block` buttons from the footer row.
3. Update the author header to display `formatSocialPostTimestamp(post.createdAt)` and a concise visibility badge (`Public`, `Friends`, `Close Friends`).
4. Add an **Embedded GPS Run Summary Card** when `post.attachedRunSummary` is present: crisp bordered telemetry inset showing run title, distance (`(distanceM / 1000).toFixed(2) km`), moving time (`formatDuration`), avg pace (`formatPace`), and elevation gain (`+${Math.round(elevationGainM)}m`).
5. Add a **Nested Quoted Repost Card** when `post.repostOfPostId` is present:
   - If `post.repostPreview && !post.repostPreview.unavailable`: bordered inset card showing original author name (`button` opening `onOpenAuthorProfile(repostPreview.uid)`), relative time, quoted text, optional thumbnail (`repostPreview.firstMediaThumbnailUrl || signedUrls[repostPreview.firstMediaThumbnailPath]`), and nested run stats line if present.
   - Otherwise: neutral muted card `"Original post is no longer available."`.
6. Upgrade the media gallery layout for `1` (full-width `max-h-[460px]`), `2` (`grid-cols-2`), `3` (1 full-width top + 2 bottom), and `4` (`grid-cols-2` 2x2) photos plus full-width `bg-black` video player (`controls`, `playsInline`).
7. Add the Facebook-style **Engagement Summary Row** (`{kudosCount} Kudos` on left; clickable `{commentsCount} Comments` and `{repostsCount} Reposts` on right) above a full-width evenly split **Action Bar** (`grid-cols-3`, or `grid-cols-2` when `!allowRepost`): `Kudos`, `Comment` (also focuses that post's comment input), and `Repost`, all `min-h-11`.
8. Upgrade the expandable comments drawer to Facebook-style rounded comment bubbles (`rounded-2xl bg-[var(--surface-inset)] px-3 py-2`) beside author avatar initials, with the viewer's avatar beside a rounded-full reply input at the bottom.
9. Update DEV `e2e-*` repost creation to also attach `repostPreview` so reposting renders a nested card immediately in E2E verification.

- [ ] **Step 3: Run lint and social tests**

Run: `npm run lint && npx tsx --test tests/m4-runner-social-clubs.test.ts tests/m4-client-validators.test.ts`
Expected: Exit code `0`, all tests pass.

- [ ] **Step 4: Commit Task 5**

```bash
git add src/components/runner/RunnerSocialFeedPanel.tsx src/components/runner/SocialPostComposerDialog.tsx
git commit -m "feat(social): redesign feed cards and composer triggers in Facebook feed layout"
```

---

### Task 6: Create Dedicated Facebook-Style `SocialsDashboard` Workspace

**Files:**
- Create: `src/components/SocialsDashboard.tsx`

**Interfaces:**
- Consumes: `WorkspaceShell`, `WorkspaceSwitchProps`, `PersonalNavigationIntent`, `RunnerSocialFeedPanel`, `SocialPostComposerDialog`, `PublicRunnerProfileDialog`, `AccountPrivacyModal`, `useAccess`, `useWorkspaceHeader`, `useRunnerViewport`, `useNetworkSyncStatus`, `subscribeSharedRaces`, `subscribeMyRecordedRuns`, `subscribeBadgeCatalog`, `subscribeUserBadges`, `sortHomeDiscoverRaces`, `formatFeeRangePH`, `philippineTodayStr`, `sortedRaceDistances`.
- Produces:
  - `export interface SocialsDashboardProps { profile: UserProfile; workspaceSwitch?: WorkspaceSwitchProps; pendingApprovalNotice?: boolean; onOpenPersonalTarget?: (intent: Omit<PersonalNavigationIntent, 'nonce'>) => void; }`
  - `export default function SocialsDashboard(props: SocialsDashboardProps)`

- [ ] **Step 1: Implement `src/components/SocialsDashboard.tsx`**

Build a focused, clean workspace component (~350-450 lines):
1. Subscriptions (matching `RunnerDashboard` DEV `e2e-*` parity): `subscribeSharedRaces`, `subscribeMyRecordedRuns(profile.uid)`, `subscribeBadgeCatalog`, `subscribeUserBadges(profile.uid)`.
2. State: `feedMode: 'discover' | 'following'`, `refreshNonce`, `composerState: { open: boolean; action: 'default' | 'media' | 'run' | 'location' }`, `latestCreatedPost`, `profileTargetUid`, `blockedUids`, `showProfile`.
3. `WorkspaceShell` configuration: `spaceTitle="Socials"`, `navLabel="Socials navigation"`, `mobileBreakpoint="md600"`, `bottomNavVariant="docked"`, `compactGutters`, `maxWidthClass="max-w-6xl"`, `workspaceSwitch`, `pendingApprovalNotice`, `onOpenProfile={() => setShowProfile(true)}`.
4. Navigation items (`items`):
   - `discover` (`Compass`, active when `feedMode === 'discover'`)
   - `following` (`Users`, active when `feedMode === 'following'`)
   - `compose` (`PlusCircle`, label `New Post`, shortLabel `Post`, `emphasis: 'primary-record'`, opens composer)
   - Conditional `record` (`Navigation`, only when `can('personal.record') && onOpenPersonalTarget`, jumps to `{ tab: 'record' }`)
   - Conditional `inbox` (`Inbox`, only when `can('personal.inbox') && onOpenPersonalTarget`, jumps to `{ tab: 'inbox' }`)
5. Global header portals (`useWorkspaceHeader`):
   - Desktop left: divider + `Socials` title + active feed label (`Discover` / `Following`).
   - Desktop right: `New Post` primary button (`min-h-11`).
   - Mobile left: divider + `Socials` title + active feed label.
   - Mobile right: profile avatar button (`min-w-[44px] min-h-[44px]`).
6. Layout body (`xl:grid xl:grid-cols-[minmax(0,680px)_320px] xl:justify-center xl:gap-6` on wide desktop; `max-w-[680px] mx-auto` below `xl`):
   - **Center Column:**
     - **Facebook-style Top Composer Card:** User avatar (`40px`) + full-width rounded-full button `"Share a run, photo, or race update, {firstName}..."` + subtle divider + 3 quick triggers (`Photo / Video`, `Attach Run`, `Location Pin`, all `min-h-11`) opening `SocialPostComposerDialog` with `initialAction`.
     - **Feed Switcher Bar:** Accessible `role="tablist"` (`Discover` | `Following`) with arrow-key / `Home` / `End` keyboard navigation + `Refresh` button (`min-h-11 min-w-11`, `aria-label="Refresh feed"`).
     - **`RunnerSocialFeedPanel`:** Wired with `mode={feedMode}`, `refreshNonce`, `incomingNewPost`, `blockedAuthorUids`, `onOpenAuthorProfile`, `onOpenExploreRace` (calls `onOpenPersonalTarget({ tab: 'explore', exploreSection: 'races', exploreFilter: 'open', raceId })`), `onBlockedUser`.
   - **Right Context Rail (`hidden xl:flex xl:flex-col xl:gap-4 self-start sticky top-4`):**
     - **Your Runner Card:** Avatar, display name, club name (if set), quick buttons to `Record Run` (if `can('personal.record')`) and `Find Friends` (if `can('personal.friends')`).
     - **Open Philippine Races Card:** Top 3 open/upcoming races from `sortHomeDiscoverRaces(races, todayStr)` with date, distances, fee range, and `"View"` button jumping to `My participation -> Explore` for that race.
7. Modals: `SocialPostComposerDialog` (switches to `following` if non-public post created), `PublicRunnerProfileDialog` (with `onStartDm` jumping to `{ tab: 'inbox', dmTargetUid }`), and `AccountPrivacyModal`.

- [ ] **Step 2: Run lint to verify compilation**

Run: `npm run lint`
Expected: Exit code `0`.

- [ ] **Step 3: Commit Task 6**

```bash
git add src/components/SocialsDashboard.tsx
git commit -m "feat(social): add dedicated Facebook-style SocialsDashboard workspace"
```

---

### Task 7: Wire `AuthorizedWorkspace`, `RunnerDashboard` Active-Run Guard & Deep Links, and De-Duplicate `RunnerHomePanel`

**Files:**
- Modify: `src/components/DesktopSidebar.tsx:10-14` (tighten `available: readonly WorkspaceMode[]` required)
- Modify: `src/components/AuthorizedWorkspace.tsx:1-72`
- Modify: `src/components/RunnerDashboard.tsx:110-165,200-235,355-415,1740-1765,1970-2000`
- Modify: `src/components/runner/RunnerHomePanel.tsx:1-165,425-772`

**Interfaces:**
- Consumes: `src/lib/workspaceModes.ts`, `SocialsDashboard`, `RunnerDashboard`, `AdminDashboard`, `WorkspaceSwitchProps`.
- Produces: Full 3-mode runtime switching (`operations | personal | socials`) with deep-link handoff, active GPS run confirmation guard, immersive mobile switcher hiding, and clean non-duplicated `RunnerHomePanel`.

- [ ] **Step 1: Update `AuthorizedWorkspace.tsx` for 3 modes, deep links, and async switch guard**

1. Lazy-load `SocialsDashboard` (`const SocialsDashboard = lazy(() => import('./SocialsDashboard'))`).
2. Compute capability booleans:
   - `operations`: existing operational capability check.
   - `personal`: `hasNonSocialPersonalCapability(access.can)`.
   - `socials`: `access.can('personal.social')`.
3. Resolve `availableModes = resolveAvailableWorkspaceModes({ operations, personal, socials })`.
4. Read `hasPaymentReturn` from `window.location.search` (`payment` param) and pass `{ available: availableModes, hasRaceDeepLink: Boolean(raceId), hasPaymentReturn }` into `resolveDefaultWorkspaceMode` for initial state.
5. Also add a `useEffect` so if a new `raceId` arrives while in `'socials'` or `'operations'` and `'personal'` is available, it switches cleanly to `'personal'`.
6. Maintain `beforeSwitchGuardRef = useRef<(() => Promise<boolean>) | null>(null)` and `registerBeforeSwitchGuard(fn)` so `selectWorkspace(next)` awaits `beforeSwitchGuardRef.current()` before switching away (with a simple in-flight lock so double-clicks cannot race).
7. Maintain `personalIntent: PersonalNavigationIntent | null` and `openPersonalTarget(intent)` (switches to `'personal'` and sets `{ ...intent, nonce: ++seq }`).
8. Build `workspaceSwitch: WorkspaceSwitchProps | undefined = availableModes.length >= 2 ? { current: workspace, available: availableModes, onSelect: selectWorkspace } : undefined`.
9. Pass `resolveWorkspacePresenceMode(workspace)` into `usePresenceHeartbeat(...)`.
10. Render `AdminDashboard` (`workspace === 'operations'`), `SocialsDashboard` (`workspace === 'socials'`), or `RunnerDashboard` (`workspace === 'personal'`).

- [ ] **Step 2: Wire `RunnerDashboard.tsx` for `initialPersonalIntent`, `onOpenSocials`, active-run guard, and `hideWorkspaceSwitch`**

1. Extend `RunnerDashboardProps` with optional `initialPersonalIntent?: PersonalNavigationIntent | null`, `onPersonalIntentHandled?: () => void`, `onOpenSocials?: () => void`, and `registerBeforeSwitchGuard?: (guard: (() => Promise<boolean>) | null) => void`.
2. Register the active-run guard in `useEffect` whenever mounted: if `isRecordingRunRef.current && tabRef.current === 'record'`, invoke the exact `"Leave active run?"` `confirm(...)` dialog and return the boolean; clean up to `null` on unmount.
3. Add a `useEffect` consuming `initialPersonalIntent`: applies target `tab`, `exploreSection`, `exploreRacesFilter`, `pendingDeepLinkRaceId`, `youSection`, or `dmTargetUid` (starting DM via existing inbox handler), then calls `onPersonalIntentHandled?.()`.
4. Pass `hideWorkspaceSwitch={isCompact && (mobileCanvasActive || eventsInFormFlow || imeOpen)}` to `WorkspaceShell`.
5. Pass `onOpenSocials` to `RunnerHomePanel`.

- [ ] **Step 3: De-duplicate social posts out of `RunnerHomePanel.tsx`**

1. Remove `RunnerSocialFeedPanel`, `SocialPostComposerDialog`, `PublicRunnerProfileDialog`, and their unused state/imports (`composerOpen`, `latestCreatedPost`, `profileTargetUid`, `blockedUids`) from `RunnerHomePanel.tsx`.
2. Add optional `onOpenSocials?: () => void` to `RunnerHomePanelProps`.
3. In the `Community and race feed` section header on `RunnerHomePanel.tsx`, replace the `"New Post"` button with a clean `"Open Socials"` button (rendered when `canSocial && onOpenSocials`) that switches straight to the dedicated `Socials` workspace, while keeping `Discover` (Open Races + Record a GPS Run card) and `Following` (Friend Race Activity) intact and clutter-free.
4. Tighten `WorkspaceSwitchProps.available` in `DesktopSidebar.tsx` to required (`available: readonly WorkspaceMode[]`).

- [ ] **Step 4: Run lint, full test suite, build, and security audit**

Run: `npm run lint && npm test && npm run build && node scripts/security-audit.cjs --dist`
Expected: Exit code `0`, all CJS and TS tests pass, build succeeds, `PASS: Security audit clean`.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/components/DesktopSidebar.tsx src/components/AuthorizedWorkspace.tsx src/components/RunnerDashboard.tsx src/components/runner/RunnerHomePanel.tsx
git commit -m "feat(workspace): wire 3-mode Socials switching, active-run guard, and clean Runner Home"
```

---

### Task 8: Deploy Backend/Rules & Run Mandatory Playwright Visual + Interactive Verification

**Files:**
- Scratch verification script (conversation scratch dir, never committed): `verify-socials-workspace.mjs`
- Screenshots (conversation scratch dir, inspected via `read_file`): desktop (`1440x900`, `1280x800`) and mobile (`390x844`) in light and dark modes for both runner and admin sessions.

**Interfaces:**
- Consumes: Live deployed `firestore:rules`, `storage:rules`, `functions:rbac:accessApi`, `functions:default:communityApi`, and local dev server (`npm run dev` on `http://localhost:3000`).

- [ ] **Step 1: Run `npm run verify:rbac` to validate all emulator rules against the final source tree**

Run: `npm run verify:rbac`
Expected: Exit code `0`, `RBAC verification passed.`

- [ ] **Step 2: Deploy updated rules and Cloud Functions to `racepulseph`**

Deploy `firestore:rules`, `storage:rules`, `functions:rbac:accessApi`, and `functions:default:communityApi` (using `$env:NODE_OPTIONS = "--dns-result-order=ipv4first"` and temporary `functions/.env.racepulseph` cleaned up in `finally`).
Verify live `communityApi/social/feed` OPTIONS (204 + prod CORS) and POST (401 unauthenticated) and `accessApi/presence/heartbeat` POST (401 unauthenticated) via `curl.exe`.

- [ ] **Step 3: Run headless Playwright visual & interactive verification**

Start the local dev server (`npm run dev` or reuse running port 3000) and run a Playwright script in the conversation scratch directory verifying:
1. **Runner session (`e2e-runner`, role `runner`)** at `390x844` (light + dark) and `1440x900` / `1280x800` (light + dark):
   - Mobile shows 2-segment pill switcher: `My participation` | `Socials` (`scrollWidth <= innerWidth`, zero clipped labels, tap targets `>= 44px`).
   - Clicking `Socials` opens the Facebook-style feed with top composer card, `Discover` | `Following` tabs, embedded GPS run summary card, media gallery, 3-column `Kudos | Comment | Repost` bar, and `More` menu.
   - Interactive checks: toggle Kudos, expand comments + post a reply, click `Photo / Video` / `Location Pin` composer triggers, create a post, open `More` menu (`Delete` / `Report` / `Block`), repost a public post and verify nested repost card renders, click `My participation` and confirm `RunnerHomePanel` shows no duplicate social feed and offers `"Open Socials"`.
2. **Admin session (`e2e-admin`, role `admin`)** at `390x844` (light + dark) and `1440x900` (light + dark):
   - Mobile shows 3-segment pill switcher: `Operations` | `My participation` / `Participation` | `Socials` (`scrollWidth <= innerWidth`, single-line pills, `>= 44px` height, zero overflow).
   - Desktop sidebar shows all 3 modes (`Operations`, `My participation`, `Socials`).
   - Interactive clicks across `Operations` -> `My participation` -> `Socials` succeed with zero console errors or page errors.
3. Inspect EVERY captured screenshot directly via `read_file` to confirm visual polish, balanced grid occupancy, zero wasted voids, and readable contrast in both light and dark modes.

- [ ] **Step 4: Final diff hygiene & completion gate**

Run `antislop-code` check on changed files, confirm `git status` is clean of untracked scratch/temp files, and report full PASS/FAIL verification table + Purpose Log.
