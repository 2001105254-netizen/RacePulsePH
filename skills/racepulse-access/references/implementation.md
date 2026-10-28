# Implementation map

- `functions/access-policy.js`: version-one role and permission catalog; frontend imports only this pure module.
- `functions/access-api.js`: trusted history/save HTTP endpoints; save remains guarded by the rollout readiness record.
- `scripts/build-access-deploy.cjs`: generates `functions/rbac`, the independent Node 22 `rbac` codebase. Deploy it with `firebase deploy --only functions:rbac`; this intentionally avoids payment-secret dependencies in the default codebase.
- `src/components/AccessPanel.tsx`: Super Admin directory/editor with draft review and explicit rollout status.
- `src/components/AdminDashboard.tsx`: actual role guard for the Access destination.
- `firestore.rules`: denies browser access writes and direct history writes; current legacy operational bypasses still require migration.
- `docs/access-control-plan.md`: inventory of required enforcement, migration and offline work.

Authorization is implemented across Firestore, Storage, Functions and the local server. Confirm deployment status in `docs/access-control-progress.md`; source completion alone does not prove activation.

`userAccess.permissions` is a materialized, backend-only effective permission map. Only `access-service` and the management migration may produce it. The frontend uses the generated preset bundle; `tests/access-policy.test.cjs` checks parity. New accounts obtain their baseline through `/session` before the workspace becomes ready.

Edit rule behavior in `scripts/build-access-rules.cjs`, then run `npm run generate:access`. The base rules file supplies existing schema and consent validators; it is never deployed directly. Generated compound-write helpers cache permission maps and changed fields to stay within Firestore's evaluation budget. Run emulator tests for permitted multi-field writes as well as denial cases.

Operational assignments remain canonical in `races.createdBy` and `races.organizerIds`; do not introduce a second assignment collection without a synchronization design. Selected/all-race overrides are held in userAccess. Ownership is preserved when roles change.

LAN browser routes call the current authenticated `/session` service on each request and fail closed if authorization is unavailable. Offline scans remain partitioned by actor/race in the browser until acknowledged. The raw hardware bridge uses a separate `BridgeKey`; the server requires `RACEPULSE_BRIDGE_KEY` and `RACEPULSE_BRIDGE_RACE_ID`. Never use a user login token as a device key.

Keep mutations disabled until verification passes and deployment is confirmed. Never solve permission failures by adding a broad role bypass. Unknown permissions default to deny. Exports govern the built-in download workflow; they cannot recall information already read or downloaded. Engraving operations use an explicit global queue; legacy orders have no trustworthy race association and must not be guessed from names or bib numbers.

Read-only timing must not publish results. Race settings use field-group patches. Preserve these boundaries when extending the UI. Offline queued reads retain original operator identity and must not replay under another account. Protected timing/race deletions must still respect operational race scope; platform access management is global Super Admin authority.
