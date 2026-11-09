---
name: racepulse-access
description: Implement or review RacePulsePH role presets, individual overrides, race scope, access history, and permission enforcement. Use for this repository's access-control work.
---

# RacePulse access control

Read `references/implementation.md` before changes. In the RacePulsePH checkout, read `docs/access-control-plan.md` and `docs/access-control-progress.md`; resolve these against the repository root, not the installed skill directory.

Only actual Super Admins manage access. Feature overrides cannot grant access administration. Treat an explicit false override as a denial even for an Admin. Preserve personal record ownership, organizer approval and assigned-race boundaries.

Never activate access editing based on UI completion alone. Map each capability to cloud rules, Storage, Functions, local server and background/offline paths. Keep `accessSystem/rollout.enforcementReady` false or absent until these paths have matching enforcement and integration tests pass.

Role changes require trusted transactions, revision checks, idempotent requests and append-only history. Preserve at least one active Super Admin. Do not expose privileged credentials to the browser or bundle Firebase Admin in frontend code.

Use the related `racepulse-access-validation` skill for validation and rollout. A development task does not authorize unrelated account promotions or production changes.
