# RacePulsePH Socials Workspace & Mode Switcher Design

**Date:** 2026-11-26
**Status:** Ready for User Approval (post-builder review)
**Scope:** Dedicated Facebook-style `Socials` workspace added directly to the existing `Workspace mode` segmented switcher across mobile, tablet, and desktop; Admin RBAC preset updated to include personal and social access; `communityApi` hydrated with safe GPS run summaries and quoted repost previews.

---

## 1. Intent and Why

RacePulsePH already has a live social backend (`communityApi`: Discover and Following feeds, text/photo/video posts, attached GPS runs, badges, races, clubs, Route Snaps, kudos, comments, reposts, close friends, blocks, and moderation reports) and working UI components (`RunnerSocialFeedPanel`, `SocialPostComposerDialog`, `PublicRunnerProfileDialog`).

Today, that social experience is buried halfway down `RunnerHomePanel` underneath Starter Trail, Race Week pass, Latest Run, and stat tiles. Meanwhile, the top-level `Workspace mode` segmented control (`Operations` | `My participation`) only renders for accounts with both operational and personal access, leaving runners with no dedicated top-level entry point for social activity and requiring staff to click into `My participation` and scroll past dashboard cards to reach the feed.

Adding **`Socials`** directly to the existing `Workspace mode` switcher gives every runner and admin one-tap access to a focused, Facebook-style social feed while keeping `My participation` and `Operations` clean and uncluttered.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Add `Socials` directly to the existing `Workspace mode` switcher in `WorkspaceShell` (mobile top segmented pill bar and tablet rail) and `DesktopSidebar` (desktop left panel).
- Enable `personal.*` defaults on the `admin` role preset (matching `organizer` and `superadmin`) so standard `admin` accounts also receive the full 3-way switcher (`Operations` | `My participation` | `Socials`), while preserving `highlights.playlist: false` and `bibs.studio: false` and respecting per-user overrides and suspension.
- Show the switcher to all signed-in users who have at least two authorized modes:
  - **Runners** (`personal` + `socials`): `My participation` | `Socials`
  - **Admins, approved Organizers, Super Admins** (`operations` + `personal` + `socials`): `Operations` | `My participation` | `Socials`
  - Accounts with explicit overrides removing one or more modes only see the modes authorized by RBAC.
- Build a dedicated `SocialsDashboard` modeled after a Facebook feed:
  - Top-of-feed `"Share a run, photo, or race update..."` composer prompt card with quick `Photo / Video`, `Attach Run`, and `Location Pin` shortcuts.
  - Clear `Discover` and `Following` feed tabs with manual refresh.
  - Upgraded Facebook-style post cards in `RunnerSocialFeedPanel`: clean author header with overflow `More` menu (`Delete`, `Report`, `Block`), rich embedded GPS run summary card, nested quoted repost card (with live moderation/delete/block privacy checks), edge-to-edge media layout (single image, 2-up grid, 3-4 photo collage, video player), engagement summary line, full-width `Kudos | Comment | Repost` action row, and Facebook-style comment bubbles.
  - Wide-desktop (`>=1280px`) right context rail displaying real live RacePulsePH shortcuts and open Philippine races (zero fabricated stats or dummy widgets).
- Hydrate safe `attachedRunSummary` (metrics + title only, zero raw GPS track coordinates, owner-verified to prevent IDOR) and `repostPreview` (live-checked against deletion, moderation hiding, and user blocks) inside `functions/social-service.js` (`communityApi`).
- Remove the duplicate inline social feed and composer from `RunnerHomePanel` so `My participation -> Home` stays focused on Starter Trail, Race Week pass, Latest Run, stats, Open Races, and Friend Race Activity (with a clean `"Open Socials"` button when permitted).
- Protect live GPS run recording (`isRecordingRun`) and immersive mobile chrome (`mobileCanvasActive`, `eventsInFormFlow`, `imeOpen`) when switching workspaces.

### Non-Goals
- No changes to the persistent charcoal global navbar (`App.tsx`) or the portaled desktop headers of `TimingConsole`, `OperatorDashboard`, `MyRaceEventsPanel`, `LiveBroadcastPanel`, or `RunnerDashboard`.
- No public/unauthenticated social browsing (remains gated behind signed-in verified accounts with `personal.social`).
- No full-screen vertical video swipe player (user requested a Facebook-style feed).
- No standalone DM/Inbox rewrite inside `Socials` (DMs continue routing cleanly to `RunnerDashboard`'s existing `Inbox` tab).

### Anti-Goals (Failure Conditions)
- Horizontal overflow, wrapped/clipped text, or sub-44px touch targets on the 3-segment mobile switcher at `360px` to `390px` viewport widths.
- Silently killing an active GPS run when a runner taps `Socials` or `Operations`.
- Leaking raw GPS coordinates from private runs, allowing cross-user `attachedRunId` attachment (IDOR), or leaking deleted/moderated/blocked posts through cached `repostPreview` snapshots.
- Duplicate `Workspace mode` switchers rendered simultaneously on the same screen.
- Breaking PayMongo return handling (`?payment=...`) or race registration deep links (`?register=<raceId>`).
- Breaking `accessApi/presence/heartbeat` validation by sending an unsupported `workspace: 'socials'` enum value.
- Introducing fabricated stats, fake social posts in production, em dashes (`—`) in UI copy, or non-functional buttons.

---

## 3. Constraints

- **RBAC Enforcement & Rules Authoring:**
  - `functions/access-policy.js` is the single source of truth for role presets. Updating `admin` defaults to include `personal.*` requires regenerating `src/lib/access-presets.json` and syncing `functions/rbac/` (`npm run generate:access` / `scripts/build-access-deploy.cjs`), delegating any `firestore.rules` updates through the `firestore-rules-author` specialist, passing `npm run verify:rbac` (including Firestore and Storage emulator tests), and deploying updated `firestore:rules` and `functions:rbac:accessApi`.
  - Mode availability is derived strictly from `useAccess()`:
    - `operations`: `access.authority || ['race.view','race.create','routes.view','bibs.studio','timing.view','roster.view','engraving.view','users.view','hub.manage','hub.publish','highlights.view'].some(access.can)`
    - `personal`: `hasNonSocialPersonalCapability(access.can)` (any personal capability other than `personal.social`)
    - `socials`: `access.can('personal.social')`
- **Telemetry Compatibility:** `TelemetryWorkspace` in `src/lib/telemetry/types.ts` and `functions/rbac/access-service.js` accepts `'personal' | 'operations'`. Heartbeats emitted while in `'socials'` map to `'personal'`.
- **Responsive Breakpoints:** Must pass visual and interactive checks at desktop (`1440x900`, `1280x800`), tablet/foldable (`768x1024`), and phone (`390x844`) in both light and dark modes.
- **Design System & Accessibility:** Follow `AGENTS.md`: 4/8px spacing multiples, 4-size / 2-weight typography scale, WCAG AA contrast in light and dark modes, `min-h-11` (`44px`) touch targets, full keyboard navigation (`Tab`, `Enter`, `Space`, `Escape`, arrow keys on feed tabs), `aria-pressed` / `aria-expanded` / `aria-haspopup`, and zero em dashes in UI copy.

---

## 4. Approaches Considered

1. **Single-Row Global Charcoal Topbar Switcher (Rejected):** Placing `Socials | My participation | Operations` in `App.tsx`'s global charcoal header would collide with wide portaled controls (`LiveClock`, search inputs, 5-way Explore filters) in 5 existing panels.
2. **Two-Tier Global Charcoal Header (Rejected):** Adding a permanent second bar inside `<header>` in `App.tsx` would consume ~44px of vertical viewport height across dense 100vh consoles (`TimingConsole`, `RouteStudioPanel`) and mobile views.
3. **Nesting Socials Inside `RunnerDashboard` (Rejected):** Forces staff in `Operations` to click into `My participation` first before reaching `Socials`.
4. **Extend the Existing `Workspace mode` Switcher in `WorkspaceShell` and `DesktopSidebar` (Selected by User):** The user pointed directly to the existing rounded segmented pill bar (`Operations | My participation`) in `WorkspaceShell` and asked to add `Socials` onto that section. Extending `WorkspaceSwitchProps` to 3 modes (`operations | personal | socials`) reuses the exact component and visual hierarchy across phone, tablet rail, and desktop sidebar with zero collision against operational headers.

---

## 5. Detailed Architecture & Component Design

### 5.1. Admin RBAC Preset Update (`functions/access-policy.js` & Generated Artifacts)

- Update `defaults(role)` in `functions/access-policy.js`:
  - Change `(role === 'admin' && !key.startsWith('personal.') && key !== 'highlights.playlist' && key !== 'bibs.studio')` to `(role === 'admin' && key !== 'highlights.playlist' && key !== 'bibs.studio')`.
- Regenerate `src/lib/access-presets.json` and `firestore.rules` (using `scripts/build-access-rules.cjs` and reviewing/authoring any `firestore.rules` diff via `firestore-rules-author`), and sync `functions/rbac/` (`scripts/build-access-deploy.cjs`).
- Update `tests/access-policy.test.cjs` so the `admin` role default assertion matches `true` for `personal.*` keys (while still asserting explicit per-user overrides and suspension disable them cleanly).
- Deploy updated `firestore:rules` and `functions:rbac:accessApi` after `npm run verify:rbac` passes.

### 5.2. Workspace Mode State Machine (`src/lib/workspaceModes.ts`) & Runner Shell Decoupling (`src/lib/runnerShell.ts`)

Create a pure, unit-tested module `src/lib/workspaceModes.ts`:

- `export type WorkspaceMode = 'operations' | 'personal' | 'socials';`
- `WORKSPACE_MODE_ORDER: readonly WorkspaceMode[] = ['operations', 'personal', 'socials'];`
  - **Builder Call (Order):** Keeps the user's existing `Operations | My participation` left-to-right order from their screenshot and appends `Socials` directly onto it (`Operations | My participation | Socials` for admins/organizers/superadmin; `My participation | Socials` for runners). Easy to reorder if preferred.
- `hasNonSocialPersonalCapability(can)`: Checks all keys in `PERSONAL_CAPABILITY_KEYS` except `'personal.social'`. Ensures a `personal.social`-only account only sees `Socials` rather than a redundant switcher into an empty `My participation`.
- `resolveAvailableWorkspaceModes({ operations, personal, socials }): WorkspaceMode[]`
- `resolveDefaultWorkspaceMode({ available, hasRaceDeepLink, hasPaymentReturn }): WorkspaceMode | null`:
  - `(hasRaceDeepLink || hasPaymentReturn)` and `'personal'` available -> `'personal'`.
  - Else `'operations'` if available -> `'operations'`.
  - Else `'personal'` if available -> `'personal'` (**Builder Call**: preserves runner onboarding and deep links on open while keeping `Socials` one tap away at the top).
  - Else `available[0] ?? null`.
- `resolveEffectiveWorkspaceMode(selected, available): WorkspaceMode | null`
- `resolveWorkspacePresenceMode(mode): TelemetryWorkspace`: Maps `'operations' -> 'operations'` and `'personal' | 'socials' -> 'personal'`.
- `resolveWorkspaceDirection(available, from, to): NavDirection`: Index-based `'forward'` / `'back'`.
- **Decoupling `My participation -> Home` (`src/lib/runnerShell.ts`):**
  - **Builder Call:** Since social posts move out of `RunnerHomePanel`, update `resolveAllowedRunnerTabs`'s `home` check from `can('personal.social')` to `can('personal.social') || can('personal.register') || can('personal.results') || can('personal.record') || can('personal.friends') || can('personal.clubs')` so a runner whose `personal.social` is disabled via override still retains their `Home` dashboard (Starter Trail, Race Week pass, Latest Run, Open Races). Update `tests/runner-shell.test.ts` to cover this explicitly.

### 5.3. Cross-Workspace Deep Links & Active Run Guard (`AuthorizedWorkspace.tsx` & `RunnerDashboard.tsx`)

- **Personal Navigation Intent:** `AuthorizedWorkspace` manages a one-shot `PersonalNavigationIntent` (`tab`, `exploreSection`, `exploreFilter`, `raceId`, `youSection`, `dmTargetUid`, `nonce`) passed from `SocialsDashboard` to `RunnerDashboard` when tapping a linked race, runner DM button, `Record Run`, `Find Friends`, or `Inbox`.
- **Payment & Registration Deep Links:** `AuthorizedWorkspace` checks `hasPaymentParam` (`URLSearchParams('payment')`) and `Boolean(raceId)` on mount so PayMongo returns and `?register=<raceId>` always open in `'personal'`.
- **Active GPS Run Protection (Builder Call):**
  - `AuthorizedWorkspace` passes `registerBeforeSwitchGuard(fn)` to `RunnerDashboard`.
  - When `isRecordingRun === true`, attempting to switch from `'personal'` to `'socials'` or `'operations'` runs `RunnerDashboard`'s existing `"Leave active run?"` confirmation dialog first and cancels the switch if the user chooses to stay, preventing silent GPS loss.
- **Immersive Mobile Chrome Protection (Builder Call):**
  - `WorkspaceShell` accepts `hideWorkspaceSwitch?: boolean`.
  - `RunnerDashboard` sets `hideWorkspaceSwitch={isCompact && (mobileCanvasActive || eventsInFormFlow || imeOpen)}` so full-screen route/recording canvases and mobile form keyboards keep maximum vertical space.

### 5.4. Upgraded `Workspace mode` Switcher (`DesktopSidebar.tsx` & `WorkspaceShell.tsx`)

Update `WorkspaceSwitchProps` in `src/components/DesktopSidebar.tsx`:

```ts
export interface WorkspaceSwitchProps {
  current: WorkspaceMode;
  available: readonly WorkspaceMode[];
  onSelect: (next: WorkspaceMode) => void;
}
```

Render whenever `workspaceSwitch && workspaceSwitch.available.length >= 2`:

1. **Mobile Segmented Pill Bar (`WorkspaceShell.tsx`, lines 233-278):**
   - Exact rounded container and active red-700 pill from the user's screenshot.
   - Dynamic grid: `available.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'`.
   - At 3-up on narrow screens (`<400px`), renders responsive compact text (`Participation` below `400px`, `My participation` at `>=400px`, full `aria-label="My participation workspace"`) with `min-h-11` (`44px`) and `truncate` so 3 pills never wrap or clip at `360px` to `390px`.
2. **Tablet Navigation Rail (`WorkspaceShell.tsx`, lines 105-140):**
   - Compact stacked icon + label buttons (`Ops`, `Run`, `Socials`) for each mode in `available`.
3. **Desktop Left Sidebar (`DesktopSidebar.tsx`, lines 181-222):**
   - Stacked full buttons (`Operations`, `My participation`, `Socials`; collapsed `Ops`, `Runner`, `Social`) in `role="group" aria-label="Workspace mode"`.
   - **Builder Call:** Follows RacePulsePH's existing responsive contract where the horizontal pill bar appears at the top on mobile and lives inside the left sidebar on desktop (zero duplicate switchers).

### 5.5. Backend Hydration for GPS Run Summaries & Quoted Reposts (`functions/social-service.js` & `src/lib/social/types.ts`)

Extend `SocialPostRecord` with two optional, strictly sanitized fields:

```ts
export interface AttachedRunSummary {
  runId: string;
  title: string;
  distanceM: number;
  movingTimeMs: number;
  avgPaceSecPerKm: number | null;
  elevationGainM: number;
  activityKind?: string;
  startedAt?: string;
}

export interface RepostPreview {
  postId: string;
  uid: string;
  authorDisplayName: string;
  authorUsername?: string;
  authorPhotoURL?: string;
  text: string;
  createdAt: string;
  mediaType: SocialMediaType;
  firstMediaThumbnailPath?: string;
  firstMediaThumbnailUrl?: string;
  attachedRunSummary?: AttachedRunSummary | null;
  unavailable?: boolean;
}
```

Backend rules in `functions/social-service.js`:
1. **Attached GPS Run Verification & Denormalization (`executeCreatePost`):**
   - If `validated.attachedRunId` is provided, read `recordedRuns/${validated.attachedRunId}` inside the post creation transaction.
   - Verify the doc exists, `!run.deletedAt`, and `run.uid === actorUid` (reject with `403`/`404` otherwise, preventing cross-user run IDOR).
   - Store sanitized `attachedRunSummary` (scalar metrics + title + timestamp only; never embed raw GPS track arrays or storage track paths).
2. **Quoted Repost Snapshot & Live Privacy Enforcement:**
   - Inside `executeCreatePost`, when `sourcePost` passes `validatePostRepostPermission` and block checks, store a sanitized `repostPreview` on `storedPost`.
   - Inside `/social/feed` read, batch-read (`db.getAll`) all unique `repostOfPostId` documents and any legacy `attachedRunId` documents missing `attachedRunSummary` on the returned page (capped at `<= 30` posts per page):
     - For reposts: verify `canViewerReadPost(liveSourcePost, actorUid, graph)`. If the original post was deleted, hidden by moderation, or its author is now blocked by/blocking the viewer, replace `repostPreview` with `{ unavailable: true }` so deleted or blocked content can never leak through a repost.
     - For legacy posts with `attachedRunId` and no stored `attachedRunSummary`: hydrate `attachedRunSummary` only if the run exists, `!run.deletedAt`, and `run.uid === post.uid`.
   - Ensure `collectUnsignedMediaPaths` in `src/lib/social/feedHelpers.ts` also collects `post.repostPreview?.firstMediaThumbnailPath` when unsigned so media thumbnails on reposted cards sign cleanly.
3. Add unit tests in `tests/community-social-inbox.test.cjs` covering run ownership checks (IDOR rejection), scalar-only run summaries, repost preview hydration, and deleted/blocked/moderated source post redaction. Deploy updated `functions:default:communityApi`.

### 5.6. Dedicated Facebook-Style `SocialsDashboard` (`src/components/SocialsDashboard.tsx`)

Lazy-loaded from `AuthorizedWorkspace.tsx`:
- **Shell:** `WorkspaceShell` (`spaceTitle="Socials"`, `navLabel="Socials navigation"`, `mobileBreakpoint="md600"`, `bottomNavVariant="docked"`, `compactGutters`, `maxWidthClass="max-w-6xl"`, `workspaceSwitch`, `pendingApprovalNotice`, `onOpenProfile={() => setShowProfile(true)}`).
- **Workspace Navigation Items (`DesktopSidebar` / Tablet Rail / `BottomNav`):**
  1. `Discover` (public community feed)
  2. `Following` (friends & close friends feed)
  3. `New Post` (`emphasis: 'primary-record'`, opens `SocialPostComposerDialog`)
  4. `Record` (shown when `can('personal.record')`, switches to `My participation -> Record`)
  5. `Inbox` (shown when `can('personal.inbox')`, switches to `My participation -> Inbox`)
- **Top Header Portals (`useWorkspaceHeader`):** Desktop left (`Socials` + active feed), desktop right (`New Post` button), mobile left (`Socials` + active feed), mobile right (profile avatar).
- **Facebook Feed Layout:**
  - Desktop `>=1280px`: `xl:grid xl:grid-cols-[minmax(0,680px)_320px] xl:justify-center xl:gap-6`.
  - Mobile / Tablet `<1280px`: centered single column `max-w-[680px] mx-auto`.
  - **Top Composer Prompt Card:** Avatar + full-width pill button `"Share a run, photo, or race update, {firstName}..."` + divider + 3 quick triggers (`Photo / Video`, `Attach Run`, `Location Pin`) opening `SocialPostComposerDialog` with `initialAction`.
  - **Feed Tabs & Refresh Bar:** Accessible `Discover` | `Following` tablist (arrow keys + `Home`/`End`) + `Refresh` button (`min-h-11 min-w-11`).
  - **Live Feed Stream:** `RunnerSocialFeedPanel` with `refreshNonce`, instant prepend of newly created posts, `PublicRunnerProfileDialog`, and `AccountPrivacyModal`.
  - **Wide Desktop Right Rail (`hidden xl:flex`):** Live RacePulsePH context only:
    - Runner snapshot card (avatar, name, primary club if set, `Record Run` and `Find Friends` quick jumps).
    - Up to 3 open/upcoming Philippine races from `subscribeSharedRaces` with `"View Race"` jumping to `My participation -> Explore`.
- **Subscriptions:** `subscribeSharedRaces`, `subscribeMyRecordedRuns(profile.uid)`, `subscribeBadgeCatalog`, `subscribeUserBadges(profile.uid)` (with DEV `e2e-*` fixture parity).

### 5.7. Facebook-Style Post Cards (`RunnerSocialFeedPanel.tsx`) & Composer (`SocialPostComposerDialog.tsx`)

- **Post Card Header:** 40px clickable avatar + author name + `@username · relative time · visibility` + `Repost` badge + accessible **`More` (`MoreHorizontal`) menu** (`min-h-11 min-w-11`, `aria-haspopup="menu"`, `aria-expanded`, closes on outside click and `Escape`) containing `Delete Post` (for self) or `Report Post` and `Block Runner` (for others).
- **Embedded Attached Run Card:** When `post.attachedRunSummary` is present, render a crisp RacePulsePH telemetry card inside the post showing run title, distance (`km`), moving time, avg pace (`/km`), and elevation gain (`+m`).
- **Nested Quoted Repost Card:** When `post.repostOfPostId` is present, render a bordered nested card showing the original author, timestamp, text snippet, optional thumbnail, and attached run summary, OR a neutral `"Original post is no longer available."` placeholder when `repostPreview.unavailable` is true.
- **Media Gallery:** Full-width single photo (`max-h-[460px] object-cover`), 2-up side-by-side grid, 3-photo hero + 2-up collage, 4-photo 2x2 grid, or full-width `bg-black` video player (`controls`, `playsInline`).
- **Engagement Summary & Facebook Action Bar:** Subtle counts row above divider (`12 Kudos` | `4 Comments · 2 Reposts`) + full-width `grid-cols-3` (or `grid-cols-2` for private non-repostable posts) action bar (`Kudos`, `Comment`, `Repost`, all `min-h-11`).
- **Facebook-Style Comments:** Avatar initial circle beside rounded pill bubbles (`rounded-2xl bg-[var(--surface-inset)] px-3 py-2`) + avatar-prefixed reply input.
- **Composer `initialAction`:** `SocialPostComposerDialog` accepts `initialAction?: 'default' | 'media' | 'run' | 'location'` to pre-toggle location pin or focus run/media controls when launched from the quick triggers.
- **De-duplicating `RunnerHomePanel.tsx`:** Remove the buried `RunnerSocialFeedPanel`, `SocialPostComposerDialog`, and `PublicRunnerProfileDialog` from `RunnerHomePanel.tsx` and add a clean `"Open Socials"` button (rendered when `canSocial && onOpenSocials`) so `My participation -> Home` stays focused on race readiness.

---

## 6. What Is Left to the Builder

- Exact `lucide-react` icons for `Socials`, composer quick buttons, and the `More` menu.
- Exact micro-spacing tokens within the 4/8px grid and existing CSS custom properties.
- Exact relative timestamp helper formatting (`formatSocialPostTimestamp` in `src/lib/social/feedHelpers.ts`).
- Exact Playwright visual verification script details in the conversation scratch directory.

---

## 7. Verification & Deployment Plan

1. **TDD Unit Tests (RED -> GREEN):**
   - `tests/workspace-modes.test.ts`: All RBAC mode resolution, deep-link precedence (`?register=`, `?payment=`), fallback, presence mapping, and slide direction cases.
   - `tests/access-policy.test.cjs`: Updated `admin` preset defaults (`personal.*: true`), override/suspension preservation.
   - `tests/runner-shell.test.ts`: Decoupled `Home` tab gating when `personal.social` is disabled via override.
   - `tests/community-social-inbox.test.cjs`: `attachedRunSummary` creation, cross-user `attachedRunId` IDOR denial (`403`/`404`), scalar-only payload check, `repostPreview` hydration, and deleted/moderated/blocked source redaction.
   - `tests/m4-runner-social-clubs.test.ts`: `formatSocialPostTimestamp` and `repostPreview.firstMediaThumbnailPath` signing collection.
2. **Automated Quality & Security Gates:**
   - `npm run verify:rbac` (includes `lint`, `build`, LAN HTTP tests, and Firestore + Storage emulator tests)
   - `npm test`
   - `node scripts/security-audit.cjs --dist`
3. **Firebase Deployment:**
   - Deploy `firestore:rules` (reviewed via `firestore-rules-author`), `functions:rbac:accessApi`, and `functions:default:communityApi` to `racepulseph`, and verify live responses via `curl.exe`.
4. **Mandatory Playwright Visual & Interactive Verification:**
   - Run headless Playwright against `http://localhost:3000` with DEV `e2e-*` runner AND admin sessions at `1440x900`, `1280x800`, and `390x844` in light and dark modes.
   - Inspect every screenshot via `read_file` to verify 2-way runner switcher, 3-way admin switcher, zero horizontal overflow/clipping, Facebook-style composer + post cards (including embedded run summary and nested repost card), `More` menu actions, comments, active-run switch guard, and clean `My participation -> Home`.
