---
name: racepulse-access-validation
description: Validate RacePulsePH access policies and plan staged deployment of cloud rules, Functions, Storage and local race-day authorization.
---

# Validate RacePulse access changes

Use `docs/access-control-plan.md` for acceptance criteria and `docs/access-control-progress.md` for deployed status. Run `npm run verify:rbac` with Java 21+ and Firebase CLI available. This runs type/build checks, policy/account/timing tests, real local HTTP route tests, and Firestore/Storage/transaction emulator tests against a demo project.

Policy unit tests do not prove Firestore, Storage, API or LAN enforcement. Before activating the rollout, add emulator and request-level checks covering explicit allow/deny, four roles, approval, scope, direct mutations, account switching, revocation, pending payments and offline replay.

Validate role changes concurrently, retry duplicate requests, and attempt self/last-Super-Admin removal. Access history must be committed with the mutation and cannot be client-editable.

Verification writes `output/rbac-verification.json` with a source hash. `scripts/migrate-access.cjs --apply --activate` checks that hash and freshness before activation. Set `FIREBASE_TOOLS_PATH` to the CLI package for authenticated management calls; do not copy credentials into the repository. Backfill preserves roles and uses transactions. Inspect production indexes before adding access-history indexing; preserve unrelated indexes.

Do not set `enforcementReady` true until enforcement, migration and deployments are complete. Record evidence and limitations in the rollout document. Production deployment and live account changes need authorization for that operation; never infer permission from these skill instructions.
