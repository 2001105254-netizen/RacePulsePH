# Implementation Plan: Milestone 3 — Admin/Superadmin Badge Studio, Achievement Engine & XP/Leveling Foundation

**Branch:** `feat/runner-ecosystem` (continuing from Milestone 2 `17d5208`)
**Spec:** [2026-11-24-runner-ecosystem-design.md](file:///c:/Users/patri/Desktop/Holy%20folder/RacePulsePH/RacePulsePH/docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md)
**Status:** Active

---

## Architecture Overview

Milestone 3 delivers the Admin/Superadmin Badge Studio, server-verified achievement engine, integer XP/leveling foundation, Runner Trophy Case (`You -> Badges`), and accessible `popover="manual"` unlock notifications:

1. **Pure Badge Rule Engine, XP Math & Visual Presets (`functions/badge-engine.js`, `src/lib/badges/`):**
   - Canonical tiers (`common`, `rare`, `special`, `epic`, `legendary`, `alamat`), 8 categories, 9 CSS border styles, 7 GPU-safe animation effects (disabled under `prefers-reduced-motion: reduce`), 18 curated vector emblems, and all 17 declarative rule types (`welcome`, `profile_complete`, `race_joined`, `race_finished`, `run_count`, `run_single_distance_km`, `run_total_distance_km`, `run_total_elevation_m`, `run_time_window`, `regions_explored`, `club_joined`, `friends_count`, `social_posts_count`, `kudos_received`, `run_streak_weeks`, `inbox_streak_days`, `manual_grant`).
   - Strictly integer XP math (`computeLevelFromXp` via `xpForLevel(L) = 100 * (L - 1) * L / 2`, `computeRunCompletionXp` for verified runs only), PHT (UTC+8) weekly streak evaluation with 1 Rest-Day/Grace Freeze earned per 4 consecutive active weeks, and `8` Philippine starter pack definitions.
   - `race_finished` awards strictly from finalized `races.completedAt` + `liveResults.officialResults` matched via `runners`/`runnerClaims` bibs, excluding `disqualified || finishReviewRequired`.

2. **Server Endpoints, Run XP Hook, Purge & Rules (`functions/`, `storage.rules`, `firestore.rules`, `firestore.indexes.json`):**
   - `functions/badge-service.js`: `POST /badges/save`, `/badges/seed-defaults`, `/badges/archive`, `/badges/delete` (including best-effort `badge-assets/` cleanup), `/badges/grant` (`badges.grant`), `/badges/evaluate-retroactive` (cursor-paginated batches `<= 50`), `/badges/sync-my`, and `/badges/ack-seen`.
   - `functions/community-service.js` & `functions/community-api.js`: Integrate badge routes with exact RBAC (`badges.manage`/`badges.grant` for admin routes; active non-suspended user for `sync-my`/`ack-seen`), and award verified run completion XP + auto-unlocked badges inside `/runs/complete` atomically under idempotency.
   - `functions/auth-api.js`: Extend `purgeAndAnonymizeUserAccount` to purge `userBadges`, `xpEvents`, and `athleteProgression/{uid}`.
   - `storage.rules`: `canBadge(action)` + `badge-assets/{ownerUid}/{badgeId}/{file}` (`admin`/`superadmin` only, raster `< 2 MB`, zero SVG uploads).
   - `firestore.rules` (authored via `firestore-rules-author`): Signed-in non-removed reads & server-only writes across `badges`, `userBadges`, `xpEvents`, and `athleteProgression`.

3. **Admin Badge Studio & Runner Trophy Case UI (`src/components/`, `src/styles/badges.css`, `src/index.css`):**
   - `BadgeArtwork.tsx` & `src/styles/badges.css`: GPU-only (`transform`/`opacity`) crests, 18 pure SVG emblems (zero raw HTML), uploaded raster artwork, and `hiddenUntilEarned` silhouette states.
   - `BadgeStudioPanel.tsx` wired into `AdminDashboard.tsx` (`badges` tab gated on `can('badges.view')`, hidden from `organizer`).
   - `RunnerBadgesPanel.tsx`, `RunnerYouHubPanel.tsx` (`You -> Badges` + `Badges & Level` overview card), `AchievementUnlockToast.tsx` (`popover="manual"` + `ariaNotify()`/live-region fallback + `animate-to-from-top-layer` top-layer CSS, suppressed on modals/live GPS HUD), and `RunnerDashboard.tsx` wiring.

---

## Task Checklist & Verification Gates

- **Task 0:** Persist M3 plan + initialize `m3-progress.md` + `update_steps`.
- **Task 1:** Pure badge rule engine, XP math, starter pack & frontend presets + `tests/badge-engine.test.cjs` & `tests/badge-presets.test.ts` -> `npm run lint && npm test && npm run security:check` + `m1-reviewer` (`Model: "inherit"`).
- **Task 2:** `functions/badge-service.js`, `communityApi` wiring, `auth-api.js` purge, `storage.rules`, `firestore.indexes.json`, `firestore.rules` via `firestore-rules-author` + `tests/community-badges.test.cjs` / rules / purge tests -> `npm run lint && npm test && npm run verify:rbac && npm run security:check` + `m1-reviewer`.
- **Task 3:** `badges.css`, `BadgeArtwork.tsx`, `src/lib/badges/client.ts`, `BadgeStudioPanel.tsx`, `AdminDashboard.tsx` -> `npm run lint && npm test && npm run security:check && npm run build` + `m1-reviewer`.
- **Task 4:** `runnerShell.ts`, `AchievementUnlockToast.tsx` (+ top-layer CSS in `src/index.css`), `RunnerBadgesPanel.tsx`, `RunnerYouHubPanel.tsx`, `RunnerDashboard.tsx` -> `npm run lint && npm test && npm run security:check && npm run build` + `m1-reviewer`.
- **Task 5:** Playwright Desktop (`1440x900`) & Mobile (`390x844`) Light/Dark audit (`m3-visual-audit.mjs` + `read_file` on all screenshots), `antislop-human` `contrast-check.py`, `antislop-code`, whole-branch M3 review (`17d5208..HEAD`), final post-commit verification suite + `android:sync` + Gradle `:app:compileDebugJavaWithJavac`, close M3, and hand back for M4 planning (do NOT emit `<!-- GOAL_COMPLETE -->`).
