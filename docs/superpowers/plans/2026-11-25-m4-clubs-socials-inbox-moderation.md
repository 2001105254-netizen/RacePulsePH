# Implementation Plan: Milestone 4 - Modular Club Studio, Socials Discover/Following, Route Snaps, TikTok Inbox/Streaks & Play Store UGC Moderation

**Branch:** `feat/runner-ecosystem` (continuing from Milestone 3 `38e491e`)
**Spec:** [2026-11-24-runner-ecosystem-design.md](file:///c:/Users/patri/Desktop/Holy%20folder/RacePulsePH/RacePulsePH/docs/superpowers/specs/2026-11-24-runner-ecosystem-design.md)
**Status:** Active

---

## Architecture Overview

Milestone 4 transforms RacePulsePH into a full Philippine running community platform with modular Admin-curated clubs, social feeds, course-pinned photo/video snaps, TikTok-style Inbox & Streaks, and Play Store UGC safety:

1. **Task 1: Pure M4 Domain Engines & Shared Client Validators (`functions/club-engine.js`, `functions/social-engine.js`, `src/lib/{clubs,social,inbox}/`):**
   - **Club Engine:** Validates club IDs/slugs, branding (`name`, `description`, `city`, `schedule`, hex theme colors), `joinPolicy` (`open`, `approval`, `invite_only`), 8 toggleable modules (`chat`, `leaderboard`, `events`, `badges`, `routeLibrary`, `announcements`, `memberSpotlight`, `customTheme`), PayMongo-ready billing metadata (`billingTier`, `subscriptionStatus`, `billingProvider`), `captainUids` (`<= 25`), `linkedBadgeIds` (`<= 50`), `club-assets/` HTTPS Storage URL & raster-only bounds, meetups, announcements, spotlights, club requests, and verified club leaderboard ranking.
   - **Social, Route Snaps, Moderation & Streak Engine:** Validates `socialPosts` (`public`, `friends`, `close_friends`, text `<= 1000` chars, up to 4 raster photos `<= 8 MB` each OR 1 playable video `<= 30 MB` / `<= 60 s` MP4/WebM), enforces public-only reposts, performs Haversine `<= 100 m` auto-link matching to published courses (`functions/run-math.js`), validates comments (`<= 500`), UGC report reasons, canonical DM thread IDs (`dm_{minUid}_{maxUid}`), Club chat IDs (`club_{clubId}`), chat media/share cards, and PHT (UTC+8) Daily Friend Chat Streaks with automatic rest-day grace freezes (+1 per 7 consecutive dual-active days, cap 2).

2. **Task 2a & 2b: Backend Services, Purge, Storage Rules, CSP & Firestore Rules (`functions/`, `storage.rules`, `firebase.json`, `firestore.indexes.json`, `firestore.rules`):**
   - **Task 2a (`functions/club-service.js`, `social-service.js`, `inbox-service.js`):** Server-enforced routes behind `communityApi` (RBAC, App Check, rate limiting, idempotency, cursor pagination), revocable signed URLs / Storage SDK access for `friends`/`close_friends` media, extended `purgeAndAnonymizeUserAccount` in `functions/auth-api.js`, `club-assets/` + `social-media/` + `chat-media/` in `storage.rules`, `media-src` in `firebase.json`, and composite indexes in `firestore.indexes.json`.
   - **Task 2b (Mandatory `firestore-rules-author` subagent):** Author `scripts/firestore-base.rules` -> `npm run generate:access` -> `firestore.rules` + `tests/access-rules.test.cjs` covering all M4 collections (`clubs`, `clubMembers`, `clubRequests`, `clubMeetups`, `socialPosts`, `socialComments`, `socialKudos`, `routeSnaps`, `closeFriendEdges`, `userBlocks`, `contentReports`, `conversations`, `friendStreaks`, `activityNotifications`, `userPushTokens`).

3. **Task 3: Admin Operations (`ClubStudioPanel.tsx`, `ModerationQueuePanel.tsx`, `AdminDashboard.tsx`):**
   - Modular Club Studio (`clubs.view`/`clubs.manage`) with live club preview, module toggles, PayMongo billing metadata preparation, captain delegation, and club request review queue.
   - Play Store UGC Moderation Queue (`moderation.manage`) for inspecting `contentReports`, removing violating content, or warning/suspending accounts. Both tabs strictly excluded from `organizer` and `runner`.

4. **Task 4: Runner Clubs, Socials Feed, Close Friends & Route Snaps (`src/components/runner/`, `src/components/routes/`):**
   - `RunnerClubsPanel.tsx` inside `Explore -> Clubs` (browse/join clubs, switch `primaryClubId`, view club modules/leaderboards/meetups/announcements, or submit `clubRequests` / contact admin).
   - `RunnerSocialFeedPanel.tsx` + `SocialPostComposerDialog.tsx` + `PublicRunnerProfileDialog.tsx` inside `Home` (`Discover` & `Following` cursor-paginated feeds, photo/video compression/validation, direct/quote reposts on `public` posts, kudos, comments, report & block actions).
   - `RunnerFriendsPanel.tsx` Close Friends & Block management, plus `RouteMapCanvas.tsx` / `RouteExplorerPage.tsx` `Show Snaps` HUD toggle (`Off` | `Public` | `Friends` | `Close Friends`).

5. **Task 5: TikTok-Style Inbox & Streaks (`RunnerInboxPanel.tsx`, `InboxThreadView.tsx`, `RunnerDashboard.tsx`):**
   - Active friends & PHT daily chat streak rail (`streakDays`, grace freezes), grouped Friend Requests, opt-in Message Requests (`allowMessageRequests`), Activity Notifications, Race Invites, 1-on-1 DMs and Club Chats (`club_{clubId}`) with text, share cards, and photos (`<= 8 MB`, `chat-media/`), plus captain message moderation.

6. **Task 6: Playwright Visual Audit, WCAG AA Contrast, Hygiene & Final Build Verification:**
   - Headless Playwright Desktop (`1440x900`) and Mobile (`390x844`) Light/Dark audit with direct `read_file` screenshot inspection, `antislop-human` `contrast-check.py`, `antislop-code` comment hygiene, fresh `lint`, `npm test`, `verify:rbac`, `security:check`, `build`, `android:sync`, Gradle `:app:compileDebugJavaWithJavac`, and hand-back for Milestone 4 whole-branch audit + Milestone 5 planning.
