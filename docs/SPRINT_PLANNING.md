# RacePulsePH — Product & Sprint Planning Guide

**Product:** RacePulsePH  
**Live PWA:** https://racepulseph.web.app  
**Stack:** React + TypeScript + Vite, Firebase Authentication, Cloud Firestore, Firebase Hosting  
**Suggested cadence:** 2-week sprints

## 1. Product purpose

RacePulsePH is a race-management PWA for organizers, race-day operators, runners, and the Super Admin. It supports the full runner journey: discover a race, register, claim kit, check in, record race timing, view official results, and download race assets.

The product should make race-day work fast on a phone while giving organizers enough control to set up events and review registrations before race day.

## 2. User roles

| Role | Main responsibility | Access |
| --- | --- | --- |
| Guest | Browse upcoming races | Public landing page, public live results |
| Runner | Register and track own races | Race pass, status timeline, results, bib, certificate, profile |
| Organizer | Create and operate owned races | Race setup, registrations, reports, chip assignment, timing, live broadcast |
| Admin | Operational oversight | Admin dashboards and staff-level race access |
| Super Admin | Governance and account control | Approve organizers; delete races and app accounts |

Organizer accounts begin as pending and must be approved by the Super Admin before they can operate races.

## 3. Current feature inventory

### Public and authentication

- Public landing page with upcoming race list and registration CTA
- Sign up, log in, Google sign-in, password reveal, and password reset flow
- Opening RacePulsePH splash animation
- PWA installation support and responsive mobile-first interface
- Light/dark theme support

### Runner experience

- Multi-step race registration with confirmation page
- Choose a distance, gender, age, and shirt size
- Standard shirt sizes plus **Other** custom input (for example 2XS or 6XL)
- Unique bib assignment per race and distance
- My Races list and individual race pass
- Visible race-status timeline: Registered → Kit claimed → Checked in → Started → Finished → Official result
- Digital race bib preview/download using organizer-uploaded bib artwork
- Personalized bib number/name position, size, color, and font configuration
- Runner profile: photo, emergency contact, shirt size, medical notes, and profile updates
- Race inclusion/kit-design image preview with full-screen viewer
- Digital finisher certificate
- Personal timing splits, official time, and rank when available
- Reminders/notifications center

### Organizer and race setup

- Create, edit, and manage races
- Multiple race distances with independent prices
- Registration open/close controls
- Checkpoint setup: check-in, start, intermediate, and finish
- Per-distance/wave start times (for example, 10K starts before 5K)
- Intermediate checkpoint cutoff configuration
- Age-category configuration
- Race poster, inclusion/kit design, route map, and livestream link
- Custom race-bib template and visual layout editor
- Runner roster and registration management
- PDF runner report with distance and shirt-size inventory
- Timing-chip and race-bib assignment tools

### Race-day and live timing

- Check-in, start, intermediate, and finish scan/record workflow
- Large operator controls for mobile race-day use
- Manual bib input and QR scanner support
- Success feedback and duplicate-scan warning
- Offline/weak-internet scan queue with later sync
- Official results calculation, rankings, and presentation view
- Public live race hub and organizer-controlled live leaderboard

### Administration and engraving

- Super Admin organizer approval flow
- Super Admin account and race deletion controls
- Medal engraving order workflow, report, and LightBurn variable-text export support

## 4. Primary user flows

### A. Runner registration

1. Guest opens the public race list.
2. Guest selects a race and taps **Register**.
3. Guest signs up/logs in as a Runner.
4. Runner completes the registration steps and selects a distance and shirt size.
5. System creates the race registration and assigns a bib number.
6. Runner sees confirmation, race pass, and later their bib/kit/status updates.

**Acceptance criteria**

- One runner can register for multiple races.
- Duplicate registration for the same runner and race is prevented.
- Bib numbers are unique within their race and distance.
- Runner can see the selected shirt size on their registration.

### B. Organizer race setup

1. Organizer creates a race with date, distances, and checkpoints.
2. Organizer configures registration dates, waves, age categories, and inclusions.
3. Optional: upload poster, shirt/medal image, route map, livestream, and blank race-bib design.
4. Organizer opens registration and monitors the roster/report.
5. Organizer assigns chips and manages race-day timing.

**Acceptance criteria**

- An organizer can edit only races they created.
- Public users can browse open races only through the app experience.
- All optional images/links can be omitted without blocking race creation.

### C. Race-day timing

1. Operator opens the race timing console and selects the correct race/checkpoint.
2. At kit collection, operator records **Kit claimed**.
3. At race venue, operator records **Check-in**.
4. Start each distance/wave at its actual start time.
5. Record intermediate checkpoint scans when applicable.
6. Record finish scans.
7. System calculates elapsed official time, ranking, and public leaderboard.

**Acceptance criteria**

- A duplicate checkpoint scan warns the operator and does not silently create bad timing data.
- Weak/offline scans remain queued locally and can sync when connection returns.
- A 10K and 5K can have separate wave start times.
- Raw checkpoint scans stay private; public pages show only publishable results.

## 5. Core data model

| Collection / entity | Purpose |
| --- | --- |
| `users` | Account profile, role, approval status, and runner personal settings |
| `races` | Race configuration, distances, checkpoints, media, live broadcast, and bib template |
| `runners` | One race registration per `{uid}_{raceId}` with bib, distance, shirt size, chip, and kit claim |
| `chipReads` | Race-day checkpoint scans and timestamps |
| `bibCounters` | Transactional bib-number counters per race/distance |
| `liveResults` | Public-safe race leaderboard and official result feed |
| `orders` | Medal engraving orders |
| `removedAccounts` | Super Admin deletion tombstones to stop deleted profiles being recreated |

## 6. Suggested product backlog

These are not all bugs. They are the recommended next work items after the current feature set.

### High priority — reliability before a live race

- **Real race dry-run mode:** Seed a test race, 20–50 mock runners, and simulate check-in/start/finish on two phones.
- **Timing audit screen:** Show a clear scan history per runner with correction notes, edit/revoke controls, and who performed each action.
- **Race lock/finalization:** Organizer confirms results as final so accidental later scans do not alter official rankings.
- **Report accuracy:** Ensure all shirt sizes, including custom sizes such as 4XL–6XL and 2XS, appear as separate counts in the PDF inventory summary.
- **Backup/export:** CSV export of runners, chip assignments, scans, and final results.
- **Error states:** Clear user messages for Firebase permission, offline queue sync failure, duplicate bib, and failed image upload.

### Medium priority — usability and organizer operations

- **Bulk runner import:** CSV import with validation and a downloadable template.
- **Bulk bib/chip assignment:** Paste/import a list instead of assigning one runner at a time.
- **Race staff accounts:** Optional checkpoint/operator role limited to a selected race or station.
- **Registration payment status:** Pending, paid, waived, refunded, plus payment reference field.
- **Participant communications:** Send email/SMS-ready announcement lists, race reminders, and finish notifications.
- **Race templates:** Reuse a previous race setup, checkpoints, distances, and inclusion settings.
- **Results filters:** Age group, gender, distance, and category awards.

### Future / hardware roadmap

- **RFID reader bridge:** Integrate a compatible RFID timing reader so chip reads can arrive automatically instead of manual tapping/scanning.
- **Hardware health dashboard:** Reader connection, last read, battery/network, and station identity.
- **Multiple timing mats:** Associate a scanner/device with a checkpoint and record automatic race timing.
- **Advanced live tracker:** Map positions only if a reliable GPS/race-tracking source is available.

## 7. Recommended sprint plan

### Sprint 1 — Race-day confidence (2 weeks)

**Goal:** Run a small live event with trustworthy manual timing.

- Build timing audit/correction history.
- Add result finalization and re-open controls.
- Improve error and offline-sync states.
- Fix PDF inventory summary for every standard/custom shirt size.
- Create a dry-run checklist and test data routine.

**Definition of done:** A mock 5K + 10K event can be timed end-to-end on mobile; operator can spot and resolve an incorrect scan; results can be locked and exported.

### Sprint 2 — Registration operations (2 weeks)

**Goal:** Reduce organizer admin work before race day.

- Add CSV runner import/export.
- Add bulk bib/chip assignment.
- Add registration payment status and filters.
- Improve roster search, filter, and print layout.

**Definition of done:** An organizer can import 100 runners, assign bib/chip data in bulk, filter unpaid runners, and download a clean roster.

### Sprint 3 — Better runner communication (2 weeks)

**Goal:** Make runners self-service and informed.

- Improve reminder templates (registration, kit claim, race day, results).
- Add downloadable/print-friendly race pass and event instructions.
- Add result filters and shareable official-result link.
- Add race FAQs/contact details configured by organizer.

**Definition of done:** A runner can find all essential race information and result details without asking the organizer directly.

### Sprint 4 — Staffing and scale (2 weeks)

**Goal:** Support multiple people operating a larger event safely.

- Add race-scoped operator/staff role.
- Add checkpoint/device assignment.
- Add activity log for important changes.
- Add organizer race templates/duplicate race setup.

**Definition of done:** Multiple stations can work on one race without granting broad organizer/admin access.

### Sprint 5 — Hardware automation discovery (spike, 1–2 weeks)

**Goal:** Validate real RFID timing integration before committing to production work.

- Select target RFID reader/vendor and document its data format/API.
- Prototype one reader → local bridge → RacePulsePH scan flow.
- Measure latency, duplicate-read behavior, offline behavior, and recovery.
- Decide whether the next sprint builds the full production integration.

**Definition of done:** A decision document exists with a working proof of concept or a clear reason to continue with manual/QR timing.

## 8. Ticket format for every sprint

Use this format in GitHub Projects, Trello, or Notion:

```text
Title: [Role] can [action] so that [outcome]

Problem:
Why this matters and which race-day/user pain it solves.

Scope:
- Included:
- Not included:

Acceptance criteria:
- Given ... when ... then ...
- Given ... when ... then ...

Test cases:
- Happy path
- Invalid input / permission failure
- Offline or weak-internet behavior (if applicable)

Dependencies / risks:
- Firebase rules, device permission, hardware vendor, or migration concern
```

Example:

```text
Title: Organizer can finalize a race's official results

Acceptance criteria:
- Organizer can finalize only a race they own.
- Finalized results show a clear Official status to runners and public viewers.
- New scans are blocked until the organizer re-opens the race.
- Super Admin can still inspect the race.
```

## 9. Quality checklist before closing a ticket

- [ ] Works on a narrow mobile screen and desktop.
- [ ] Runner, organizer, admin, and Super Admin permissions were considered.
- [ ] Empty/loading/error states are present.
- [ ] Existing race data without newly added fields still works.
- [ ] Firestore rules allow the intended action and block unauthorized actions.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Manual smoke test completed on the live-style flow.
- [ ] Feature is committed, pushed, and deployed only after verification.

## 10. Release process

1. Create a branch for a sprint ticket, for example `feat/result-finalization`.
2. Implement and test locally with `npm run lint` and `npm run build`.
3. Review Firestore rule changes carefully when data access changes.
4. Test the runner and organizer flows using separate accounts.
5. Commit with a clear message, push to GitHub, then deploy Firebase Hosting.
6. Perform a final mobile PWA smoke test after deployment.

## 11. Important technical notes

- The app is a client-side PWA. Sensitive actions must remain protected by Firestore rules, not only hidden in the UI.
- Full Firebase Authentication user deletion requires a trusted Admin backend; the current app uses a Firestore tombstone to prevent profile recreation.
- Automatic timing requires a hardware/reader integration. The current scan/tap workflow is the correct dependable fallback until a real RFID bridge is tested.
- Race media is currently stored as optimized client-side data URLs. Large uploads should remain constrained to protect Firestore document size and loading speed.

---

**Recommended next ticket:** Start Sprint 1 with **Timing audit + result finalization**. It delivers the biggest safety improvement before using RacePulsePH for a real event.
