# Access control implementation plan

Status: proposal only. Based on repository review on 2026-10-28. No permission or production changes are part of this document.

## Intended experience

Only actual Super Admins may open the Access tab, edit role presets for a user, set individual overrides, change operational race scope, approve organizer operations, and inspect access history. Access management cannot be granted through an ordinary permission override.

The normal workflow is: find user -> choose role preset -> choose race scope -> optionally customize -> review changes -> save. Switching a role updates the role and its matching preset together. Customization does not change the role label. Display "Organizer · Customized" with the number of overrides.

Keep four built-in, versioned presets initially. No shared preset editor or bulk access changes in the first release. Preset updates require an explicit versioned migration, not an implicit expansion for every existing user.

## Findings from the current code

| Area | Current behavior | Required change |
| --- | --- | --- |
| App.tsx | Role exclusively selects one of three dashboards; unapproved organizer is blocked at app level | Separate account readiness, operational approval, effective permissions, and workspace navigation |
| AdminDashboard.tsx | isSuperAdmin exposes account buttons; account approval/removal writes directly from browser | Access service must own privileged mutations and append history atomically |
| User profile rules | Self-update restrictions protect role/approved but do not whitelist all changed fields | Explicitly reject self-edits to access, status, version and audit fields; protect separate access documents |
| firestore.rules isStaff | Admins have broad access to race, runner and timing writes | Replace blanket operational bypasses with action + scope checks |
| races documents | Race setup replaces the document using setDoc; settings, money, teams, artwork, and operational state share one record | Use patches for field groups; validate affected keys; prevent stale settings forms overwriting starts/completion/live settings |
| Race ownership | createdBy and organizerIds control organizer access; queries are role-based | Preserve ownership as provenance; use explicit operational assignments independent of the user's role |
| runners documents | Registration, chip, kit and payment information share a record; current update authorization is broad | Authorize field groups separately and keep payment state transitions validated |
| chipReads | Creates and updates share one rule; deletes require Super Admin even where UI offers undo | Distinguish append, correction and void/undo; validate actor, race, immutable identity and race lifecycle |
| TimingConsole.tsx | Opening timing triggers automatic liveResults publication | Separate read-only viewing from publication; gate background effects, not just buttons |
| Finish race | One batch updates race completion/registration and publishes results | Treat as a single authorized finish command; do not require unrelated settings permission |
| Orders | Any signed-in user can list/create/update engraving orders | Separate own-order access from queue operation; validate owner and status transitions |
| Engraving scope | EngravingOrder has optional ownerUid but no canonical raceId; LAN serialization drops ownerUid | Persist ownership; add optional raceId and an explicit legacy/unassigned queue policy before offering race-scoped engraving |
| Engraving price | price_per_medal is browser localStorage, used locally | Label this as a local estimate setting; do not present it as centrally enforced pricing |
| server.ts | LAN orders, chip reads, reset and RFID endpoints have no user permission middleware | Authenticate browser routes and enforce operations/scope before claiming RBAC is complete |
| RFID bridge | Raw bridge input is not a user action and lacks race/user binding | Give the bridge a separate device credential and station/race assignment; never embed a user's token in bridge configuration |
| dualSync.ts | Listeners/pollers bind once with empty dependency arrays and blend cloud/LAN | Rebind on user, query and permission changes; discard stale source data on revocation or scope changes |
| offlineScanQueue.ts | Global localStorage queue; flush iterates all races; first rejected item blocks later records | Partition by actor/race; retain rejected records for review; stop forbidden replay without blocking unrelated permitted scans |
| functions/index.js | Checkout requires verified identity, not a user feature permission; webhook writes with Admin SDK | Check new checkout permission, but settle already accepted payments independently and exactly once |
| storage.rules | Uploads require verified uploader ownership only | Check relevant race/artwork/bib permission and scope; reconcile legacy account eligibility with the chosen authentication policy |
| Public data | Race and liveResults documents are publicly readable | Disabling an internal view cannot make already-public data private; distinguish public browsing from private operational access |
| Export control | Reports are generated client-side from already downloaded data | Export toggle governs built-in downloads, not extraction of data already readable; stronger restriction needs reduced server responses |
| Bootstrap | Owner-email claim code remains in App/AuthGate/rules | Keep bootstrap as a one-time setup path; a completed bootstrap must not trap an intentionally changed owner role at the claim screen |
| Tests | Account and timing unit tests exist, but no permission-matrix/rules coverage was found in reviewed tests | Add emulator rules tests and command/API tests, including LAN and offline denial paths |

## Permission model

Authorization evaluates: authenticated identity + account eligibility + role/preset + explicit override + operational approval + resource scope + action-specific business conditions.

Explicit false overrides beat preset defaults. Missing permission keys are denied. A role does not bypass an explicit operational denial. Access administration is a protected Super Admin authority, not an ordinary configurable feature. Protected Super Admin access controls are displayed as locked capabilities.

Organizers still need operational approval. A toggle cannot bypass approval. Personal runner functions may remain usable while organizer approval is pending; update the current app-level gate accordingly.

Super Admin promotion/demotion is a separate reviewed operation. Reject self-demotion in version one and preserve at least one active Super Admin using a transactionally maintained authority registry. Role/status updates and registry maintenance must all use the same trusted service. Bootstrap must initialize that registry once.

Proposed records:

- users/{uid}: existing display profile, role and compatible approved field.
- userAccess/{uid}: schemaVersion, presetVersion, explicit boolean overrides, operational raceScope, accountStatus, revision, updatedBy and server updatedAt.
- raceAssignments/{raceId}/members/{uid}: explicit non-owner operational assignments, maintained by the access/team service. Existing organizerIds remain a compatibility/query projection during migration.
- accessHistory/{changeId}: target UID, actor UID, server time, before/after access values, revision, reason, request ID and restore-source ID when applicable.
- accessSystem/authority: active Super Admin membership/count used to serialize authority changes.

Browser writes to userAccess, authority and accessHistory are denied. Users can read their own effective access record. Only Super Admins can list/manage access or read full history. Access history stores permission changes, not medical/payment/profile snapshots.

Use one declarative permission catalog to produce frontend and backend preset definitions plus static rule fixtures. Firestore/Storage rules still need platform-specific implementation; verify parity through shared matrix fixtures rather than claiming TypeScript runs inside rules.

## Permission catalog structure

Use stable action identifiers, with group headings for the UI. Initial groups:

- Events: private operational view, create, details edit, category/checkpoint edit, registration settings, artwork, bib design, team assignment and delete.
- Roster: view, manual add, import, registration edit, chip assign, bib change, kit claim, on-site slots and removal.
- Money: revenue view, payment-settings edit, manual-payment confirmation and exceptional payment repair. PayMongo settlement is a trusted service operation.
- Timing: reads view, scan append, manual entry, correction/void, wave start, start-time correction/reset, finish and reopen.
- Results: private results view, automatic live publication, official final publication, Live Hub settings, public visibility and report/download actions.
- Engraving: own request create/view/cancel; queue view; queue registration; status update; export/LightBurn; backup import/export; delete; purge. Local price estimate is a local preference rather than a security boundary.
- Runner: personal registration, new checkout, own payment status, own bib/results/certificate downloads and personal profile editing.
- Social: friend search/request/respond/remove, activity sharing and race invitations, retaining mutual consent.
- Administration: directories, organizer operational approval, app-account removal, role/access administration and audit view. Destructive authority and role/access management remain protected Super Admin operations initially.

Each catalog entry includes dependencies, default by role, scope kind, affected fields/command, frontend locations, cloud/rules/LAN enforcement, and tests. Do not add a toggle until the relevant enforcement paths are mapped.

## Scope and user interface

Operational scopes: owned + assigned, selected races, all races. Personal records always use owner UID; friendship records retain mutual-consent checks. Global engraving queue access is separate until canonical race linkage is available.

Creating a race is an explicit global capability; the new race automatically becomes an owned accessible event. Removing assignment does not delete a race, registration, or historical recordedBy values. Changing role does not silently remove ownership.

Access panel sections: Summary, Permissions, Race access, History. Preset and race scope appear first; feature groups collapse by default. Search and "Only overrides" avoid a wall of switches. Show effective on/off, inherited/custom origin and dependency explanations. Changing preset offers a clear reset-overrides choice and previews its effect; never silently retain incompatible overrides.

For cross-role grants, show an Operations workspace and a My participation workspace where permitted. Build navigation from effective feature availability, not role alone. Access remains visible only to Super Admins. Never crowd every allowed feature into one bottom bar; workspace navigation can use short labels and a More destination on narrow screens.

Directories can link to Access for Super Admins, but do not create a second role editor. Existing approval actions must call the same audited service.

Save sends expected revision and an idempotency key. A server transaction revalidates the actor, target, dependencies and scope, rejects stale edits, updates the profile/access/registry as needed, and writes history. A conflict preserves the draft and asks the operator to review newer changes. Restoring history uses the same validation against the current schema and produces a new audit event.

## Write-path changes

Prefer Firestore rules for high-frequency scoped scan appends and reads. Use trusted command endpoints for access changes and sensitive compound actions. Avoid routing every RFID scan through a slow management API.

Race settings use field-group patches. A permission to update artwork cannot change prices, team, starts or completedAt. Scope is checked against the existing resource as well as the proposed resource so moving a document to an authorized race cannot bypass checks.

Finish/reopen commands enforce lifecycle transitions and protect finalized results. Live publication needs a deterministic designated publisher or trusted publishing path so a viewer cannot publish stale results merely by opening a screen.

Bib counters require the corresponding registration/add-slot capability with validated counter transitions. They must not remain writable by every signed-in account.

Own-registration edits cannot set kitClaimed, chipId, manual paid state, or official timing. Preserve server-only paid metadata and webhook signatures. Existing payments may settle after registration/new-checkout permission is revoked; prevent new checkouts, do not silently orphan successful payments.

## Live updates and offline operation

Listen to the current user's access record. A revision change recomputes navigation, closes unauthorized screens, stops scanners/publication, tears down listeners/pollers and clears no-longer-authorized in-memory source data. Server authorization remains authoritative for each mutation.

Access administration requires connectivity. Cloud revocation cannot instantly reach a disconnected station. Version one must state that limitation explicitly. Design offline station authorization as a short-lived, server-signed race/action grant with expiry and restricted write paths, or disable LAN writes when fresh authorization is unavailable; choose before rollout based on race-day needs.

Use a separately paired, narrowly scoped device identity for raw RFID ingestion. Offline scans retain original actor, race, timestamp and unique ID. Revoked/expired scans are preserved as review-required records, not silently discarded or relabeled as another operator. Do not auto-submit one user's queued work after another user signs in.

Exports and previously cached/downloaded data cannot be recalled by toggling a permission off. Distinguish revoking future access from deleting old copies.

## Migration and rollout

1. Produce the action/enforcement inventory, preset matrix and regression fixtures. Inventory existing roles, approval flags, ownerless orders and assignments without changing production records.
2. Add protected access records, registry and audited command service with dry-run/idempotent migration. Initialize the four presets from intended supported behavior, not accidental broad database permissions. Document deliberate restrictions such as runner queue access.
3. Refactor permission evaluation, operational queries, write patches and high-risk background effects. Add matching cloud, Storage and LAN checks. Existing UI bugs such as organizer undo denied by rules must be resolved by explicit preset decisions.
4. Migrate existing accounts/assignments; retain compatibility projections with explicit schema versions. Never silently grant a Runner account administrative powers through missing-field defaults.
5. Add Access UI and capability-driven workspace navigation once enforcement exists.
6. Verify in emulators/staging, then deploy in a compatibility-safe order. Gate the new UI until required functions, rules and migrations are ready. Rules must not switch to requiring missing access documents before backfill.
7. Retire role-only operational bypasses, duplicate editor paths and temporary migration fallback. Keep a known Super Admin recovery procedure and a rollback that does not erase audit history or newly recorded race data.

## Acceptance criteria

- Non-Super Admin cannot open Access, call its endpoints, alter access fields through profile updates, or forge history.
- Every action is tested across four presets, explicit allow/deny, pending approval, personal/assigned/unassigned/all-race scopes and existing/new resource IDs.
- A disabled action is rejected through UI, direct Firestore, HTTP/LAN and Storage paths as applicable.
- Concurrent access edits conflict safely; duplicate saves are idempotent; authority changes preserve an active Super Admin.
- Revocation while timing/engraving is open stops future authorized operations and prevents background publication/replay.
- Read-only timing does not write results. Finishing publishes once, and stale clients cannot overwrite completed results.
- Runners cannot read others' private records or change payment/kit/chip/official fields.
- Personal engraving tracking still works without global queue access; legacy ownership is handled explicitly.
- Checkouts enforce new permission; authorized in-flight payments still settle once through validated webhooks.
- Offline account switching does not replay another actor's scans; one rejected race does not block other permitted queues.
- Sign-in, password reset, registration, payment, live rankings, reports and organizer collaboration remain functional.
- Six-tab Super Admin navigation and cross-role grants work on narrow/mobile layouts without truncating critical actions.

## Decisions recommended before implementation

1. Keep the four presets fixed initially; only Super Admin edits individual access.
2. Permit pending organizers to use personal Runner functions, while organizer operations remain approval-gated.
3. Keep account/race destructive tools and role/access administration protected Super Admin functions initially.
4. Keep global engraving scope explicit until orders have reliable race association.
5. Include LAN authorization in scope; agree on offline grant lifetime and behavior before field deployment.
6. Keep public event browsing public. Internal toggles cannot make public race documents private.

No code, tests, production permissions or accounts were changed while writing this plan.
