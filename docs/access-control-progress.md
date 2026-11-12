# RBAC rollout status

The web, cloud and local-server access-control rollout is deployed and access editing is activated. Existing account roles were preserved; 157 access records and a two-member active Super Admin registry were initialized.

## Implemented

- Super Admin-only Access destination, searchable role/customized/pending/suspended directory, role presets, readable permission labels, dependency-aware overrides, race selection, organizer approval, account status, draft review, revision conflicts and keyboard-accessible editor.
- Effective-permission workspaces for Operations and My participation; race lists use owned/assigned, selected or all-race scope independently of role.
- Backend-only materialized permissions. New accounts initialize a baseline through the authenticated session endpoint. Direct profile-role/access/history writes are denied.
- Transactional, idempotent access changes; actor checks inside the transaction; self-demotion and last-Super-Admin protection; append-only history and audited restoration.
- Removal suspends app access while preserving historical race and audit data. Removed profiles are excluded from operational directories; restoration can reactivate them.
- Firestore field-group enforcement and race-setting patches; Storage permission/scope checks; protected race deletions remain scoped even for Super Admins.
- Timing scan identity validation, completion locks, read-only publication guards, original-actor queue partitioning, retained rejected scans and authenticated local endpoints.
- Local API reads filter records by ownership/scope. Mutations check current cloud authorization. Unavailable authorization fails closed instead of providing anonymous fallback.
- Separate raw RFID device credential and race binding. Station configuration preserves its bridge key.
- Independent Node 22 `rbac` function codebase; existing account/email service remains unchanged. Access-history index deployed.
- Validated reusable skill folders and `output/racepulse-access-skills.zip`.

## Verification and deployment evidence

`output/rbac-verification.json` records the checks, timestamp and source hash. The verification command includes type checking, production build, policy/account/timing regression tests, real local HTTP route tests, Firestore rules, Storage rules, and transaction/concurrency tests in an isolated demo project.

Final verification passed 66 tests. Both skills passed their validator. The hosted HTML references the exact verified bundle, and both the hosted and local app return 200.

A live temporary Runner fixture verified sign-in, preset delivery, protected API rejection, own-profile access and direct privilege-escalation denial. The fixture Auth user, profile and access record were removed afterwards. No real user roles were changed during rollout.

The Access function, Firestore/Storage rules, index and Hosting release were deployed to racepulseph. The verified localhost:3000 server was restarted with existing data files preserved. Anonymous local orders and cloud Access requests return 401; the local app returns 200.

The owner explicitly approved the required `roles/firebaserules.firestoreServiceAgent` grant for Firebase Storage's managed service account. That binding was applied and verified with all other IAM bindings preserved, allowing Storage rules to read the permission/race records they evaluate.

## Deliberate boundaries

- Online payments are deferred at the user's request. No payments function is currently deployed; its source includes permission checks for a later PayMongo setup. No payment credentials were created or replaced.
- Offline captures remain queued until current cloud authorization can be checked. A disconnected station cannot receive instantaneous revocation. Previously downloaded data cannot be recalled.
- Export permissions govern built-in export actions, not copying data already authorized for reading. Public race/result data remains public.
- Engraving is an explicitly global operational queue. Legacy ownerless orders are visible only to queue operators; ownership/race association is not guessed from names or bibs.
- The raw hardware bridge requires pairing before use. Set a unique shared key in server environment `RACEPULSE_BRIDGE_KEY` and station `BridgeKey`, and bind the server with `RACEPULSE_BRIDGE_RACE_ID`. Do not commit the key. Vendor DLLs are absent in this checkout, so physical reader execution and a station binary build were not verified.

See `rbac-operations.md` for maintenance and rollout commands. The earlier plan is design context; this document records the implemented decisions.
