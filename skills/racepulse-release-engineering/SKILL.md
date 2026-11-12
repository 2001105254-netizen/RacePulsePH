---
name: racepulse-release-engineering
description: Manage RacePulsePH build pipelines, generated Firestore rules, rollout flags, staged deployments, rollbacks, versioning and dependency lockfiles. Use when preparing releases, editing firebase.json, running deploy scripts or updating dependencies.
---

# RacePulse release engineering and staged rollout

Ship changes safely across Firebase Hosting, Cloud Functions (`default` and `rbac` codebases), Firestore and Storage rules, the Android Capacitor shell (`android/`) and the Windows Timing Station (`rfid-station/`).

Load with: `racepulse-access-validation`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-33`, `R-35`, `R-36`. Detail: [release, flag and rollback checklist](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Run `npm run generate:access` whenever `src/lib/access-presets.json` or `scripts/firestore-base.rules` changes | Keeps `firestore.rules`, `functions/access-policy.js` and `functions/rbac/access-policy.js` synchronized from one source of truth | Run `node scripts/build-access-rules.cjs` and verify zero uncommitted drift in generated files |
| Gate access enforcement activation behind `accessSystem/rollout.enforcementReady` and a fresh `output/rbac-verification.json` hash | Prevents premature activation before rules, Functions, Storage and LAN paths are verified together | Inspect `scripts/verification-hash.cjs`, `scripts/verify-rbac.cjs` and `scripts/migrate-access.cjs` |
| Deploy backend rules and Functions before or alongside the frontend bundle that relies on them (`scripts/build-access-deploy.cjs`) | Prevents a live browser bundle from calling missing Functions or hitting stale rules during rollout | Inspect `scripts/build-access-deploy.cjs` and `docs/PAYMONGO_SETUP.md` deploy order |
| Preserve backward compatibility in HTTP and bridge payloads (`server.ts`, `src/lib/preciseTime.ts`, `src/lib/offlineScanQueue.ts`) | Existing Timing Station binaries and browser queues may send legacy event shapes after an upgrade | Confirm `server.ts` accepts legacy bridge messages and `formatRaceTime` normalizes legacy time strings |
| Keep `package-lock.json` and `functions/package-lock.json` committed and aligned across Node 22 runtimes (`firebase.json`) | Prevents dependency drift ("dependency hell") between local builds and Cloud Functions `nodejs22` | Inspect `firebase.json` lines 5 and 14 and check lockfiles in root and `functions/` |
| Document and rehearse rollback paths for `accessSystem/rollout`, Hosting releases and `scripts/migrate-access.cjs` | Operators need an immediate recovery command if a pre-race deployment regressions occurs | Inspect rollback steps in `docs/rbac-operations.md` and `docs/access-control-plan.md` |

## Stack mapping

- Infrastructure as Code in this repository consists of `firebase.json` (Hosting, Functions `default` and `rbac` codebases, Firestore, Storage, emulators), `firestore.indexes.json`, `storage.rules` and `scripts/build-access-rules.cjs`.
- Feature flags include `accessSystem/rollout.enforcementReady` (global rollout flag) and per-race `registrationOpen` and `onlinePaymentEnabled` (`functions/index.js` line 154).

## Not covered

- Access policy design belongs to `racepulse-access`.

## Verify

1. Run `npm run lint`, `npm run build` and `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs`.
2. Output the PASS/FAIL report with exit codes for each build and verification command.
