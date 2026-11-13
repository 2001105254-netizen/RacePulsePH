# RacePulsePH production release checklist

Prepared: November 13, 2026 (Asia/Manila).

Scope: Android distribution through Google Play, with the Firebase backend, web interface, and race-day timing dependencies used by the released features. This is a release checklist, not approval to publish or confirmation that the application has passed every gate.

The supplied Play Console screenshot shows **Internal testing**, not Production. Complete internal testing first, then any required closed testing and production-access approval.

## Release record

| Field | Value to record |
| --- | --- |
| Release owner and test owner | Assign before testing |
| Candidate commit | Record the exact Git commit after reviewing outstanding changes |
| Package ID | `com.racepulseph.app`, observed in Capacitor and Android configuration |
| Current source version | `1.0.7`, Android `versionCode 8`; confirm again after the final commit |
| SDK configuration | Minimum API 24, compile API 36, target API 36 |
| Signed upload artifact | Expected script output: `release/android/RacePulsePH.aab`; not built or verified by this checklist task |
| Artifact checksum | Record SHA-256 of the exact uploaded AAB |
| Backend release and environment | Record Firebase project, deployed Functions/rules versions, and rollout flags |
| Test evidence | Record device/Android version, tester, date, result, logs, and issue links |
| Decision | HOLD until all applicable gates have evidence |

Use each unchecked box as **not yet verified**. Mark PASS only after collecting evidence for the exact candidate. Mark FAIL for a failed check, and N/A only with a written reason and release-owner agreement. Any new build or relevant backend change invalidates affected evidence.

## 1. Confirm the launch scope

- [ ] **S01:** Decide which runner, organizer, operator, and admin features are included in this release. Hide unavailable actions and remove unsupported promises from screenshots and descriptions.
- [ ] **S02:** Confirm payment scope. `docs/access-control-progress.md` records online payments as deferred and the payment function as not deployed at the time of that report. Recheck current deployment before enabling checkout. A payment-free launch must disable online checkout without preventing supported registration workflows.
- [ ] **S03:** Confirm RFID scope. The same report records missing vendor DLLs and unverified physical-reader/station-binary testing. If timing is advertised for this release, complete the hardware acceptance test in section 4.
- [ ] **S04:** Review existing modified and untracked files, including package manifests, Android Firebase configuration, and store assets. Include only intended release changes. Do not discard unrelated work.
- [ ] **S05:** Assign people responsible for release approval, payment reconciliation if enabled, support requests, and launch monitoring.

## 2. Build and Android integrity

- [ ] **B01:** Pin the candidate commit and install from committed lockfiles in a clean build environment. Record Node, Java, Android SDK, and Gradle versions; CI currently selects Node 22.
- [ ] **B02:** Run `npm run version:check`. Confirm the candidate version is synchronized across all versioned project artifacts and its Android version code is valid for the intended Play track. New uploads need an unused, increasing version code; a tested existing bundle can be promoted between tracks.
- [ ] **B03:** Run the command gates below with exit code `0`. Review warnings and preserve the logs with the candidate identity.
- [ ] **B04:** Generate a signed release using `npm run release:android -- --require-signed`. Verify the AAB signature and checksum, and retain the mapping/debug-symbol artifacts appropriate to the bundle. Do not upload a debug or unsigned build.
- [ ] **B05:** Configure Play App Signing and protect the upload keystore and recovery information. Confirm the upload key matches the Play Console record. Do not store signing passwords or private keys in source control.
- [ ] **B06:** Verify the final bundle uses `com.racepulseph.app`, release settings, and production endpoints. Ensure the merged Capacitor configuration has no development server URL and the installed app works without a developer computer.
- [ ] **B07:** Confirm target API requirements in Play Console at upload time. Google currently requires API 36 for new phone-app submissions and updates from August 31, 2026; the source configuration targets 36. Source configuration alone does not prove the uploaded bundle passes validation. [1]
- [ ] **B08:** Check Play's bundle/device validation, supported architectures, native dependencies, and 16 KB memory-page compatibility where applicable. Test the release-generated installation on a compatible emulator/device. [8]
- [ ] **B09:** Review merged permissions and backup/data-extraction behavior. Request camera access only when scanning needs it, handle refusal, and confirm devices without a camera can use the remaining app.
- [ ] **B10:** Inspect packaged web assets for accidentally included credentials, local data, server-only files, source maps, and developer artifacts. Review release dependencies and resolve exploitable security findings before approval.

### Command gates to execute on the final candidate

Run from the repository root. Stop on failure. These are local validation/build commands; they do not authorize deployment. Run generators in a reviewed checkout because they update generated files.

| Command | Required evidence |
| --- | --- |
| `npm run generate:access` | Generated Firestore and both Functions policy modules match source inputs |
| `git diff --exit-code -- firestore.rules functions/access-policy.js functions/rbac/access-policy.js` | Exit `0` after approved generated changes are committed; investigate all drift |
| `npm run version:check` | Exit `0`, matching version and Android code |
| `npm run lint` | Exit `0`; this script runs TypeScript checking, not a complete UI/copy audit |
| `npm run build` | Exit `0` for web and LAN server build; reviewed warnings |
| `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs` | Exit `0` |
| `node --test tests/release-version.test.cjs` | Passing versioning regression tests |
| `npm run verify:rbac` | Passing policy, account, timing, local HTTP, Firestore, Storage, and concurrency checks; fresh `output/rbac-verification.json` matching source hash |
| `npm run release:android -- --require-signed` | Exit `0`, signed APK/AAB verification and SHA-256 output |

`verify:rbac` needs the required Java/Firebase CLI environment and uses a demo emulator project. Its type/build steps overlap the standalone commands. Existing historical reports do not establish that the final candidate passed.

## 3. Accounts, privacy, and backend access

- [ ] **A01:** Install through the Play test link and test email registration, verification, sign-in, password reset, sign-out, session expiry, and account switching. Confirm verification and reset emails arrive and their links open correctly on Android.
- [ ] **A02:** Test Google sign-in on the **Play-installed** app. Verify the release OAuth configuration and Play app-signing certificate fingerprints are registered where required. A debug APK sign-in test is insufficient.
- [ ] **A03:** Verify runner, organizer, operator, and Super Admin access with approved test accounts. Attempt cross-race reads/writes, direct API/Firestore requests, privilege changes, unauthorized exports, and revoked/suspended access. Protected operations must be rejected server-side.
- [ ] **A04:** Test Firestore and Storage rules plus both Functions codebases against the candidate. Verify deployed rules, required indexes, and API versions before relying on new frontend behavior. Recheck the access rollout flag and verification hash; do not toggle it using this checklist alone.
- [ ] **A05:** Publish a working privacy-policy webpage linked from the app and listing. Review its actual data inventory, operator/contact details, processors, retention, public race results, optional emergency/medical fields, and deletion behavior. Verify it opens without login. [2]
- [ ] **A06:** Complete Data safety based on actual app, WebView, Firebase, and third-party SDK behavior. Assess names/contact data, user IDs, race entries, photos/uploads, payment data if enabled, diagnostics, and optional sensitive fields. Do not declare that the app collects no data merely because Firebase handles storage. [3]
- [ ] **A07:** Test the in-app account-deletion path and a public web resource for requesting account/data deletion. Verify the backend result with a disposable test account, including profile, uploads, registrations, indexes, sessions, and clearly disclosed retained records. Deleting a login alone is insufficient. [4]
- [ ] **A08:** Review terms, event cancellation/refund instructions, consent for public results, minor participation if supported, and support contact details against actual operations. Confirm advertised privacy/security claims have evidence.
- [ ] **A09:** Verify production configuration supplies only intended client-side values. Keep service-account keys, payment secrets, bridge credentials, and email-provider secrets server-side. Check logs and error messages do not disclose sensitive data.

## 4. RacePulsePH acceptance tests

Use isolated fixtures and approved test accounts. Record expected and actual results for each case. Avoid real payments, destructive account changes, and real race records during routine tests.

| ID | Test | Pass condition |
| --- | --- | --- |
| F01 | Browse/search races, open details, empty results, closed/cancelled events | Accurate details and clear availability; no broken route or registration action |
| F02 | Register an eligible runner, invalid form, duplicate submission, full/closed registration | Valid entry persists once; invalid/duplicate requests do not create extra entries |
| F03 | Bib allocation and QR display/scan, duplicate bib/chip assignment | Unique valid mapping; invalid or duplicate assignment rejected; camera refusal handled |
| F04 | Organizer creation/editing and operator scope | Authorized changes persist and unauthorized race access is denied |
| F05 | Supported manual-payment verification | Only authorized staff can approve; unverified entries remain pending; audit trail preserved |
| F06 | Online payment, only if enabled | Approved provider test flow covers paid, cancelled, failed, delayed, duplicate, and invalid-signature webhooks; no paid status or bib from redirect alone |
| F07 | Price/amount/currency tampering and retry, only if payments enabled | Server validates expected charge and registration; duplicate requests never duplicate entry/payment processing |
| F08 | Refund/cancellation handling for supported payment methods | Correct state, user instructions, accounting record, and support path |
| F09 | Physical RFID station with actual reader, bib/tag, and production-equivalent configuration | Start/checkpoint/finish times and ordering match an independent reference within a tolerance defined before testing; no invented accuracy claim |
| F10 | Duplicate/out-of-order reads, station restart, invalid tag, wrong race | Deterministic results, no duplicate finisher, and visible rejected events |
| F11 | Network loss and reconnect while scanning | Queued scans survive restart as designed and replay once under current authorization; revoked/wrong-user queues cannot upload |
| F12 | Live results and broadcast on multiple devices | Consistent order/status, clear reconnect/stale state, no private fields exposed |
| F13 | Certificate, bib, or supported export/download | Correct names/results/layout, working Android save/share path, authorization enforced |
| F14 | Reminders, unsubscribe, friend/social or engraving flows if included | Every visible control works, correct audience/ownership, opt-out honored, no duplicate actions |
| F15 | Logout/account switch after offline or interrupted work | Previous user's private records/drafts cannot appear in the new session |
| F16 | Slow network, offline start, permission denial, server errors | Understandable recovery, no endless loader, no lost confirmed registration, no retry storm |

If a flow is excluded, mark N/A with the reason and verify the released UI and listing do not promise it. Test fixtures do not establish physical-reader correctness or real payment settlement.

## 5. UI, accessibility, and device proof

- [ ] **U01:** After the final UI edit, run headless Playwright against the candidate dev server. Capture **1440x900**, **1280x800**, and **390x844**, each in **light and dark** modes. Keep all six captures per inspected route/state in conversation scratch.
- [ ] **U02:** Open and inspect every capture directly. Record `scrollWidth <= innerWidth`, no horizontal overflow, overlap/clipping or wasted blank voids, readable content, balanced layout, and no browser console errors. A successful screenshot command is not a visual pass.
- [ ] **U03:** Keep an element-by-element Playwright click-through log: navigation, search/reset, forms, dialogs, close/back, validation/retry, policy links, and downloads. Include precondition, action, expected result, actual result, and evidence.
- [ ] **U04:** Test keyboard navigation, focus visibility/trapping/restoration, accessible labels, screen-reader announcements, text scaling, contrast, touch targets, and reduced-motion behavior.
- [ ] **U05:** On real Android devices test cold start, background/resume, process restart, system Back, keyboard resize, status/navigation insets, rotation, low memory, slow connectivity, and the oldest supported and current supported Android versions.
- [ ] **U06:** Audit UI copy and visual tokens against project rules: four type sizes/two weights, 4/8 px spacing rhythm, OKLCH palette, short transform/opacity transitions, no em dashes, invented metrics, nonfunctional controls, or eyebrow pill banners.
- [ ] **U07:** Record a one-line functional reason for each major layout, color, and accent choice. Check screenshots match real released functionality and contain no private user data.

Browser tests complement native-device tests; they do not validate Google Play signing, native OAuth, camera behavior, or app lifecycle on their own.

## 6. Google Play listing and review

- [ ] **P01:** Complete developer identity/contact verification and any device/account verification requested in the Console. Resolve dashboard setup and policy blockers.
- [ ] **P02:** Supply accurate listing text: app name up to 30 characters, short description up to 80, full description up to 4,000. Describe only shipped features. [5]
- [ ] **P03:** Supply a 512x512 PNG icon, 1024x500 feature graphic, and at least two compliant screenshots showing the actual app. Check current asset rules for supported form factors and image formats. [6]
- [ ] **P04:** Complete privacy-policy URL, Data safety, ads declaration, target audience, content rating, and every applicable App content questionnaire. Check whether the shipped features trigger additional health, financial, permission, or other declarations. [2][3]
- [ ] **P05:** Provide reviewer access instructions and working accounts for restricted functionality. Explain OTP/verification steps and make required review access usable without contacting you. Supply credentials privately in Play Console, never in this file. [2]
- [ ] **P06:** Choose supported countries/regions, category, pricing, and a monitored support email. Confirm listing links work on a signed-out device.
- [ ] **P07:** Upload the signed candidate to internal testing, distribute the opt-in link to selected testers, and install through Google Play. Review automated pre-launch/device reports where available and resolve crashes, ANRs, accessibility issues, and security warnings.
- [ ] **P08:** If the personal developer account was created **after November 13, 2023**, run a **closed test with at least 12 testers continuously opted in for 14 days**, gather real feedback, and apply for production access. Internal testing does not substitute for this gate. Confirm applicability in your account; account type/date were not inspected. [7]
- [ ] **P09:** Promote the exact tested bundle when possible. If code, native configuration, or relevant backend behavior changes, rerun affected checks and identify the replacement candidate.
- [ ] **P10:** Review all errors/warnings and the Publishing overview, confirm production-access approval when required, and obtain release-owner sign-off before submission/public rollout.

### Fields in the supplied internal-testing screen

| Field | What to enter |
| --- | --- |
| App bundles | Verified signed `release/android/RacePulsePH.aab`; use Add from library only for the intended previously uploaded bundle |
| Release name | Suggested internal identifier: `1.0.7 (8) - Internal test 1`; replace version/code if they change |
| Release notes | Keep the `<en-US>` and `</en-US>` tags and describe the tested build's actual scope/changes. Avoid claiming unverified fixes or live payments. |
| Preview and confirm | Resolve blocking errors, review included bundle/version and tester settings, then proceed with the authorized test release |

This screen creates a testing release. Public distribution is handled through the Production track after its prerequisites are satisfied. [7][9]

## 7. Launch and recovery

- [ ] **L01:** Back up applicable race/account data and configuration, test restoration in an isolated environment, and name the recovery operator. A backup without a restore check is incomplete evidence.
- [ ] **L02:** Record required backend deployment order and keep compatibility with existing app versions and timing stations. Preserve current access controls; release rollback must not reopen unauthorized access.
- [ ] **L03:** Define launch checks and stop conditions before publishing: sign-in failure, broken registration, incorrect timing/ranking, unauthorized access, or payment integrity failure blocks release or triggers incident response.
- [ ] **L04:** Plan distribution correctly. A **first production release has no percentage rollout option** and reaches eligible users in selected countries/regions after publication. Use test tracks before that launch; staged percentages apply to later updates. [9][10]
- [ ] **L05:** Monitor Android vitals, backend failures, registration completion, email delivery, timing synchronization, support reports, and payment reconciliation if enabled. Assign coverage immediately after launch and for the first real race.
- [ ] **L06:** Rehearse recovery: pause the affected race feature/checkout where supported, halt a staged update if applicable, restore compatible backend/Hosting behavior, and prepare a corrected Android bundle with a higher version code. Halting or unpublishing does not remove an installed bad version.
- [ ] **L07:** Retain the commit, AAB checksum, validation logs, tester feedback, deployed backend versions, release notes, and sign-off. Do not schedule a major unproven change immediately before race day.

## Release decision and evidence audit

**Production evidence gate: FAIL (incomplete evidence), release decision: HOLD.** This means release readiness has not been demonstrated, not that all unrun tests failed. All applicable checklist gates require evidence for the final candidate, with no unresolved critical/high-severity defects affecting shipped flows.

| Check performed while preparing this document | Result |
| --- | --- |
| Repository identity/configuration inspection | PASS: Capacitor/Android package ID and source versions observed; min/compile/target SDK values recorded |
| `npm run version:check` | PASS, exit `0`: version `1.0.7`, versionCode `8` synchronized |
| `npm run lint` | PASS, exit `0` |
| `npm run build` | PASS, exit `0`: web and LAN server compile |
| Repository skill-library validation | PASS, exit `0`: 36 checks, 0 failures, 0 warnings |
| Playwright visual/click-through proof | NOT RUN: documentation-only task with no UI changes; required before release, no UI PASS asserted |
| Signed AAB, emulator access tests, real Android/RFID/payment tests | NOT RUN in this task |
| Live Console/backend/production eligibility | NOT VERIFIED; screenshot and repository evidence only |

Purpose log for this artifact: order checks from scope to build, test, review, and recovery so release dependencies are explicit; use unchecked boxes to prevent untested work appearing approved; use evidence tables to separate observed settings from release claims. No app layout, color, or visual accent changes were made.

## Official references

Requirements checked on November 13, 2026. Recheck Console notices and these sources at release time.

1. [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-GB_ALL)
2. [Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en-en)
3. [Data safety declarations](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
4. [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
5. [Create and set up an app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
6. [Store preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
7. [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
8. [Android 16 KB page-size support](https://developer.android.com/guide/practices/page-sizes)
9. [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en)
10. [Staged updates](https://support.google.com/googleplay/android-developer/answer/6346149?hl=en-UM)
