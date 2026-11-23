# Design Specification: RacePulsePH Runner Ecosystem, Native GPS Run Tracker, Badge Studio, Modular Clubs, Socials/Inbox & Superadmin Telemetry

**Date:** 2026-11-24  
**Status:** Approved  
**Author:** RacePulsePH Engineering  
**Implementation Branch:** `feat/runner-ecosystem`

---

## 1. Intent, Why & Research Foundations
Reframe the RacePulsePH Runner Portal into a familiar, high-retention Philippine running community platform that balances:
- **Zero-friction familiarity:** Strava + TikTok 5-tab navigation muscle memory so new runners immediately know where everything lives (`Home`, `Explore`, `Record`, `Inbox`, `You`).
- **Thrill of exploration:** Unified Races (Open Events + Catalog), Routes, and Clubs discovery alongside Strava-grade GPS trail recording from the user's starting point.
- **Social connection:** Public discovery feed + following feed, route-pinned photo/video snaps with tiered privacy (`Public`, `Friends Only`, `Close Friends`), 1-on-1 DMs, Message Requests, Club Chats, and friend discovery.
- **Meaningful recognition:** Highly customizable Admin/Superadmin Badge Studio (`Common`, `Rare`, `Special`, `Epic`, `Legendary`, `Alamat`) with an achievement toast above the bottom nav and an XP/progression ledger ready for upcoming Leveling.
- **Operational visibility:** Superadmin RBAC System Telemetry inside `AccessPanel` monitoring active users, media/data sizing, API RED/p95 health, and scaling headroom.

### Verified Scientific Foundations
- **Retention Psychology (Self-Determination Theory, Deci & Ryan; digital health studies in *Frontiers* & *JMIR*; Loss Aversion, Kahneman & Tversky):**
  - Satisfies *Relatedness* (friends, clubs, chats, kudos, reposts), *Competence* (mastery badges, pace/elevation splits, personal bests), and *Autonomy* (flexible goals, opt-in privacy, no intrusive popups).
  - Prevents streak-break abandonment ("what-the-hell effect") via automatic **Rest-Day / Grace Freezes** on Weekly Run Streaks and Friend Chat Streaks.
  - Uses **Endowed Progress** (auto-granted Welcome Badge starting the Starter Trail at `1/4` complete) and **S-Curve notification restraint** (max 1 toast visible at a time, suppressed over modals and live run HUD).
- **Calorie Science (Minetti et al., 2002; Herrmann et al., 2024):**
  - Combines **Minetti et al. (2002)** (*Journal of Applied Physiology*) grade-adjusted net energy cost curves ($i \in [-0.45, +0.45]$) with **Herrmann et al. (2024)** (*2024 Adult Compendium of Physical Activities*) resting 1-MET baseline and flat-ground speed calibration:
  - Running net cost ($v \ge 1.8\ \text{m/s}$):
    $$C_r(i) = 155.4 i^5 - 30.4 i^4 - 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6 \quad (\text{J}\cdot\text{kg}^{-1}\cdot\text{m}^{-1})$$
  - Walking/hiking net cost ($v < 1.8\ \text{m/s}$):
    $$C_w(i) = 280.5 i^5 - 58.7 i^4 - 76.8 i^3 + 51.9 i^2 + 19.6 i + 2.5 \quad (\text{J}\cdot\text{kg}^{-1}\cdot\text{m}^{-1})$$
  - Gross expenditure per track segment:
    $$\text{kcal} = \frac{C(i) \cdot m_{\text{kg}} \cdot \Delta d_m}{4184} + 1.05 \cdot m_{\text{kg}} \cdot \Delta t_{\text{hr}}$$
  - Uses optional `weightKg` from `You -> Profile` (`25..250 kg`; clearly disclosed `65 kg` reference fallback if unset) with an in-app study citation popover.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals (5 Shippable Milestones)
- **M1 — Runner 5-Tab Shell, Merged `Explore`, `You` Hub & Onboarding:**
  - Strictly 5 buttons in the Runner bottom nav (`Home`, `Explore`, `Record`, `Inbox`, `You`) mirrored in medium rail (`600-1023 px`) and desktop sidebar (`>= 1024 px`).
  - `Explore` merges `Races` (combining Open Events + Race Catalog), `Routes`, and `Clubs` (with `Request a Club / Contact Admin`).
  - `You` consolidates Athlete `Overview`, `My Passes`, `Friends & Close Friends`, `Medal Engraving`, and `Profile & Settings` (including optional `weightKg`, `heightCm`, `allowMessageRequests`).
  - Non-blocking `Starter Trail` (`1/4` Welcome complete) + contextual `popover="manual"` first-visit hints on `Explore` and `Record`.
  - Foundation RBAC permission keys (`badges.*`, `clubs.*`, `moderation.manage`, `personal.{record,social,clubs,inbox}`) generated cleanly into `firestore.rules`.
- **M2 — High-Precision GPS `Record` Tracker:**
  - Supports both **Free Run** and **Race / Course Follow** modes starting from live GNSS coordinates.
  - Custom Capacitor 8 Android Foreground Service (`RunTrackingPlugin.java` + `RunTrackingForegroundService.java`) using `FusedLocationProviderClient` (1 Hz, `PRIORITY_HIGH_ACCURACY`, `FOREGROUND_SERVICE_LOCATION`, `PARTIAL_WAKE_LOCK`) so screen-off pocket runs stay locked.
  - Web high-accuracy `watchPosition` + Screen Wake Lock + honest signal indicators (`High <=15m`, `Good <=35m`, `Canopy <=65m`) + desktop Wi-Fi advisory.
  - Speed-adaptive Kalman smoothing, spike/jitter clamping, 30 m DEM elevation correction, Minetti/Herrmann 2024 calorie engine, per-km splits, IndexedDB crash recovery, optional 200 m on-device home privacy trim, GPX export, and server-verified `recordedRuns` persistence via `communityApi`.
- **M3 — Admin/Superadmin Badge Studio & Achievement Engine:**
  - Restricted strictly to Admin & Superadmin (`badges.view`, `badges.manage`, `badges.grant`; explicitly excluded from `organizer` and `runner`).
  - Customizable artwork (Storage upload or 16+ vector emblems), 9 border designs + dual custom colors, 7 GPU-safe animation effects (honoring `prefers-reduced-motion`), tiers (`Common`, `Rare`, `Special`, `Epic`, `Legendary`, `Alamat`, customizable), `xpReward` for future Leveling, optional `activeFrom`/`activeUntil`, `hiddenUntilEarned`.
  - Declarative rule builder (`welcome`, `profile_complete`, `race_joined`, `race_finished`, `run_count`, `run_single_distance_km`, `run_total_distance_km`, `run_total_elevation_m`, `run_time_window`, `regions_explored`, `club_joined`, `friends_count`, `social_posts_count`, `kudos_received`, `run_streak_weeks`, `inbox_streak_days`, `manual_grant`).
  - Server-verified Cloud Function unlocks (`userBadges/{uid}_{badgeId}`) + idempotent `xpEvents` + `athleteProgression/{uid}` foundation + retroactive evaluator.
  - `popover="manual"` achievement unlock toast anchored directly above the 5-button bottom nav (suppressed over modals and active live run HUD).
- **M4 — Modular Club Studio, Socials, Route Snaps, TikTok Inbox/Streaks & UGC Moderation:**
  - **Club Studio (`clubs.view`, `clubs.manage`):** Admin/Superadmin creates & customizes clubs (`logo`, `cover`, theme colors, `joinPolicy`, delegated `captainUids`, linked badges, PayMongo-ready `billingTier`/`subscriptionStatus`/`billingProvider` fields) with toggleable modules (`chat`, `leaderboard`, `events`, `badges`, `routeLibrary`, `announcements`, `memberSpotlight`, `customTheme`). Multi-club membership supported via `clubMembers/{clubId}_{uid}` + `primaryClubId` (keeping legacy free-text `runClub` as read-only fallback). Runners submit `clubRequests` / contact admin to create a club.
  - **Socials (`Home`):** `Discover` (public community) + `Following` (friends & clubs) cursor-paginated feed; up to 4 compressed photos (`<= 8 MB` each) or 1 client-validated short video (`<= 60 s / <= 30 MB`, MP4/WebM); public direct & quote Reposts; Kudos & Comments; attach earned Milestone Badge, Club, Entered Race, and optional GPS Location.
  - **Route Snaps & Privacy:** Snaps with location pin appear on the run route and auto-link within 100 m to published official courses in `Explore`. Map HUD `Show Snaps` toggle (`Off` | `Public` | `Friends` | `Close Friends`). Private `friends` / `close_friends` media served via **revocable** authenticated Storage SDK / 15-min signed URLs (never permanent `getDownloadURL()` tokens). Close Friends managed via `closeFriendEdges/{ownerUid}_{friendUid}`.
  - **TikTok-Style Inbox & Streaks:** Top active friends & chat streaks rail; grouped Friend Requests, Message Requests, Activity, and Race Invites rows; 1-on-1 DMs (`dm_{minUid}_{maxUid}`) + Club Chats (`club_{clubId}`) with text, RacePulse share cards, and optional photos (`<= 8 MB`, `chat-media/`). Dual PHT (UTC+8) Weekly Run Streak & Daily Friend Chat Streak with freeze valves.
  - **Play Store UGC Compliance:** In-app `Report`, `Block` (`userBlocks`), Admin/Superadmin Moderation Queue (`contentReports`, `moderation.manage`), Captain chat moderation, and full `purgeAndAnonymizeUserAccount` updates in `functions/auth-api.js`.
- **M5 — Superadmin RBAC System Telemetry:**
  - Integrated inside `AccessPanel.tsx` via `Access & Roles` | `System Telemetry` tabs, strictly `isSuperAdmin()`.
  - Zero-write-tax observability: 15-min anonymized `activePresence/{sessionHash}` heartbeats (20-min Firestore TTL, zero PII), GCS Eventarc triggers (`onObjectFinalized`/`onObjectDeleted`) maintaining `systemTelemetry/storageSummary`, Cloud Monitoring API (`@google-cloud/monitoring` with graceful dev fallback) for Storage egress & cross-function RED/p95 metrics, sharded daily rollups (`day_{YYYY-MM-DD}_s{0..9}`), 60 s cached `/telemetry` endpoint on `accessApi`, and live ADR scaling-trigger gauges (`OK`, `Watch >= 70%`, `Scale >= 90%`).

### Non-Goals (Explicitly Deferred)
- Automated PayMongo per-club checkout UI (schema fields provisioned in M4; activates after PayMongo approval).
- Full Leveling UI / season passes (XP ledger & progression docs provisioned in M3).
- Lock-screen FCM background push notifications (`userPushTokens` schema provisioned in M4; native/web FCM ships in M4b).
- Manual/external GPX file imports counting toward badges/leaderboards.
- Live audio/video calling or paid third-party GPS/chat/video SaaS vendors.

### Anti-Goals
- Screen-off Android GPS stalling during locked pocket runs.
- Client-forged badges, XP, streaks, or distance totals.
- Leaking `Friends Only` or `Close Friends` snaps, private media URLs, or home coordinates.
- > 5 bottom nav buttons or `< 44 px` touch targets.
- Superadmin telemetry running full-collection scans on view.
- Em dashes (`—`), fabricated stats, dead controls, or eyebrow pill banners above headings.

---

## 3. Requirements & Non-Functional SLOs
- **Availability:** 99.9% for Runner Portal, Socials, Inbox, Badges, Clubs, and Telemetry; 99.95% on-device GPS run durability via local IndexedDB/native spooling.
- **Latency:** `p95 <= 300 ms` for cursor-paginated feeds, inbox threads, and explore views; `p95 <= 600 ms` for run completion, badge sync, club/post writes; 60 fps (`<= 16.6 ms`) live MapLibre trail updates via `GeoJSONSource.setData()`.
- **Consistency:** **CP (ACID transactions + deterministic unique IDs)** for badge awards (`userBadges/{uid}_{badgeId}`), XP events (`xpEvents/{id}`), club memberships (`clubMembers/{clubId}_{uid}`), and streaks; **AP (bounded staleness)** for kudos/repost counters, route snap discovery, and 60 s cached Superadmin telemetry.
- **UI & Accessibility Compliance (`AGENTS.md` + `modern-web-guidance`):**
  - 4 typography sizes (`Hero`, `H2`, `Body`, `Caption`), 2 weights (`Regular`, `Semibold`).
  - Every margin, padding, and gap evenly divisible by 4 or 8 px; 60/30/10 OKLCH palette.
  - Transitions `< 300 ms` animating `transform`/`opacity` only, honoring `prefers-reduced-motion`.
  - WCAG AA / APCA contrast across Light and Dark modes; `aria-current="page"` paired with non-color `>= 3:1` active indicator; strictly one `<h1>` per active DOM breakpoint.

---

## 4. Load Estimate (Growth Baseline: 5,000 DAU / 25,000 MAU)
1. **Average RPS:** 5,000 DAU x 60 req/day = 300,000 req/day = **~3.5 avg RPS**.
2. **Peak RPS (Sunday 6:00-9:00 AM PH Race Morning, 10x burst):** **~35-60 peak RPS** (~45 read RPS, ~15 write RPS). ~500 concurrent GPS runs buffer 100% locally (**0 live server RPS**), flushing upon finish (~0.14 write RPS). Easily served by `asia-southeast1` Functions v2 (`maxInstances: 20, concurrency: 80` = 1,600 concurrent slots).
3. **Storage Growth (1-Year):**
   - Firestore: ~5.3 GB raw (~13 GB with 2.5x index/replication overhead across runs, posts, messages, badges, telemetry).
   - Cloud Storage: ~60K photo posts (~72 GB) + ~15K short videos (~180 GB) + ~180K raw GPS tracks (~27 GB) + chat/badge/club assets (~12 GB) = **~291 GB/year**.
4. **Network Bandwidth:**
   - Ingress: ~0.80 GB/day (~0.07 Mbps avg, ~2 Mbps peak).
   - Egress: ~2.3 TB/year (**~190 GB/month avg**, ~35-45 Mbps peak with immutable CDN headers on public assets). Video egress is the first true bottleneck.

---

## 5. Build Approaches & ADR-003
- **Selected Approach (Approach 1): Phased Modular Monolith on Existing Firebase (`asia-southeast1`) + Custom Capacitor 8 Android Foreground GPS Service.**
  - Vertical domain modules under `src/lib/{runs,badges,clubs,social,inbox,telemetry}/` and `src/components/runner/`, paired with modular Express v2 Cloud Functions (`communityApi`, `badges-service`, `rbac/telemetry-service`) and ~250 lines of Android Java (`RunTrackingPlugin.java` + `RunTrackingForegroundService.java`).
- **Rejected Approach 2 (Commercial SDKs: Transistorsoft + Stream Chat + Mux):** Adds Android SDK licensing and 3 recurring SaaS bills before PayMongo club revenue launches.
- **Rejected Approach 3 (Web-First Prototype):** Stalls GPS on screen lock, allows client-forged badges, and causes schema rework for private video and clubs.

### ADR-003: Modular Firebase Monolith + Native Foreground GPS
- **Status:** Accepted
- **Context:** RacePulsePH needs zero fixed SaaS burn prior to PayMongo club billing while maintaining anti-cheat integrity, sub-5m outdoor Android GPS reliability, revocable private media, and live scaling observability.
- **Decision:** Build on the existing Firebase (`asia-southeast1`) + Vite/React 19 + Capacitor 8 monolith with custom native Android location service and GCP Monitoring / Eventarc telemetry.
- **Revisit Triggers (Monitored in M5 Telemetry):**
  1. Monthly Storage video egress **>= 500 GB/month** -> migrate video delivery/transcoding to Cloudflare Stream or R2.
  2. Sustained write RPS **>= 300 RPS** or Functions `p95 >= 800 ms` -> increase `minInstances` / evaluate dedicated realtime layer.
  3. Chat messages **> 5M documents** -> enable cold archival TTL policy.
  4. Active DAU **> 25,000** -> add BigQuery Firebase export alongside live gauges.

---

## 6. Key Engineering Decisions (Locked In)
1. **Feed Discovery & Public Cards:** `Home` uses `Discover` (public community) + `Following` (friends & clubs); tapping a public runner opens `publicProfiles/{uid}` (zero private email/medical/payment fields).
2. **Play Store UGC Compliance:** In-app `Report`, `Block` (`userBlocks`), and Admin/Superadmin Moderation Queue (`contentReports`, `moderation.manage`).
3. **Revocable Private Media & Safe Reposts:** `Friends Only` and `Close Friends` media use authenticated Storage SDK reads / 15-min signed URLs via `communityApi` (never permanent `getDownloadURL()` tokens). Reposts are permitted on `Public` posts only.
4. **Home Privacy Trim (200 m):** Trims first and last 200 m **on-device** from uploaded polylines when enabled (full distance/splits preserved) so raw home coordinates never leave the device.
5. **Server Anti-Cheat & `race_finished` Rules:** `communityApi` validates track distance, pace plausibility, and Minetti/Herrmann calories server-side; `race_finished` awards only from finalized official `races/{raceId}.completedAt` + `liveResults` (excluding DQ/review-flagged entries) + `runnerClaims`.
6. **Delegated Club Captains & Multi-Club Rules:** Runners can join multiple clubs with one `primaryClubId` (keeping legacy free-text `runClub` read-only fallback). Admin-assigned Captains manage member approvals/removals, club announcements, member spotlights, chat moderation, and curated club meetups; Admins manage club creation, billing, module toggles, and deletion.
7. **Granular `personal.*` RBAC Keys:** `personal.record`, `personal.social`, `personal.clubs`, `personal.inbox` alongside `badges.{view,manage,grant}`, `clubs.{view,manage}`, `moderation.manage`. `organizer` explicitly excludes `badges.*`, `clubs.*`, `moderation.*`.
8. **Client-Validated Short Videos + Chat Photos:** Videos validate `<= 60 s / <= 30 MB` and browser playability before upload; Inbox DMs & Club chats support text, RacePulse share cards, and photos (`<= 8 MB`, private `chat-media/`), plus opt-in rate-limited Message Requests (`allowMessageRequests`).
9. **Geographic Exploration (`regions_explored`):** Counts the 3 Philippine island groups from `philippinesMapTiles.ts` (`Luzon`, `Visayas`, `Mindanao`) plus distinct published course provinces/regions.

---

## 7. Data, Rules & Platform Verification Summary
- **New / Extended Firestore Collections:** `publicProfiles`, `recordedRuns`, `badges`, `userBadges`, `xpEvents`, `athleteProgression`, `clubs`, `clubMembers`, `clubRequests`, `clubMeetups`, `socialPosts`, `socialComments`, `socialKudos`, `routeSnaps`, `closeFriendEdges`, `userBlocks`, `contentReports`, `conversations`, `friendStreaks`, `activityNotifications`, `userPushTokens`, `activePresence` (20-min TTL), `systemTelemetry`.
- **Profile Extensions (`users/{uid}`):** `weightKg` (`25..250`), `heightCm` (`80..250`), `onboardingSteps` (`<= 10`), `primaryClubId` (valid ID), `allowMessageRequests` (`boolean`).
- **Cloud Storage Prefixes (`storage.rules`):** `social-media/` (images `<= 8 MB`, videos `<= 30 MB`), `chat-media/` (`<= 8 MB`, participant-gated), `run-tracks/` (JSON `<= 5 MB`), `badge-assets/` (`<= 2 MB`, `badges.manage`), `club-assets/` (`<= 8 MB`, `clubs.manage`).
- **CSP (`firebase.json`):** Add `media-src 'self' blob: https://firebasestorage.googleapis.com https://*.firebasestorage.app`.
- **Android Manifest & Plugin (`MainActivity.java`):** Register `RunTrackingPlugin.class` before `super.onCreate()`; declare `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.
- **Modern Web Guidance:** `popover="manual"` + conditional `@oddbird/popover-polyfill` + `ariaNotify()`/live-region fallback + separate `transition-behavior: allow-discrete` for achievement toast & onboarding hints; `aria-current="page"` + non-color `>= 3:1` active nav indicator.
