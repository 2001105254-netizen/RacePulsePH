# RacePulsePH bot protection implementation plan

Prepared November 16, 2026. Planning only. No production settings changed.

## 1. Objective and decisions

Reduce automated account creation, email abuse, scraping, expensive downloads and unauthorized mutations while preserving public race discovery, live results, Android access and race timing.

Public pages can still be read by sophisticated automation. Success means measurable reduction in abusive actions and cost, with low legitimate-user rejection. Authentication and authorization remain mandatory for private data.

Recommended sequence is Firebase App Check, server authorization and distributed action limits, selective human challenges, then optional Cloudflare edge filtering. Treat Cloudflare as conditional on domain ownership and a tested proxy configuration. Use reCAPTCHA Enterprise for web App Check. Introduce Turnstile only on actions that need an additional human challenge.

## 2. Repository evidence and unknowns

| Inspected source | Finding | Consequence |
| --- | --- | --- |
| src/firebase.ts | Firebase initializes Firestore, Storage and Auth; email signup uses createUserWithEmailAndPassword directly | Initialize App Check before dependent Firebase clients; a signup-form challenge alone cannot cover direct Auth requests |
| src/firebase.ts | Capacitor and native social login are present | Validate the actual Android SDK request path before selecting attestation integration |
| functions/index.js | paymentsApi uses onRequest; PayMongo webhook verifies a signature | Custom HTTP handlers need explicit App Check verification; preserve provider webhook authentication |
| functions/index.js | Exports accountApi, raceBibClaimApi and routeApi | Inventory their delegated handlers before setting action limits |
| server.ts | LAN order, chip-read and RFID endpoints; bridge-key CORS header | Timing devices need their own credential and rate policy |
| server.ts | 64 KB JSON body limit and scoped CORS | Retain payload limits; verify authentication independently of CORS |
| firebase.json | Hosting configuration exists | Inspect all rewrites, CSP and public hostnames during implementation |

This is a targeted source review. Deployed App Check enforcement, Cloudflare subscriptions, current traffic, security-rule coverage and existing protections inside every delegated handler remain unverified. The route API now exists in the repository; earlier route progress notes may be stale.

## 3. Threat and control matrix

| Surface | Abuse | Primary controls | Legitimate traffic to preserve |
| --- | --- | --- | --- |
| Public races/results | Bulk scraping, read amplification | Bounded public projections, cache, pagination, request budgets | Search engines, shared links, race-day viewers |
| Signup/login | Fake accounts, credential attacks | Auth-supported protection, App Check where supported, action limits | Google sign-in, verified users, recovery |
| Verification/reset emails | Email flooding, cost amplification | Destination cooldown, hashed destination quotas, generic responses | Account recovery and delayed email retries |
| Registration/bib claim | Duplicate claims and slot hoarding | Verified identity, transaction rules, idempotency, per-account budgets | Legitimate repeat submissions |
| Checkout | Session flooding | Server validation, per-account pending-session limits | Retried checkout and payment reconciliation |
| PayMongo webhook | Forged events, replay | Provider signature, event idempotency, bounded payloads | Provider retries |
| Route import/photos | CPU, storage and bandwidth abuse | Role checks, file/job quotas, validation, processing limits | Authorized organizers |
| Timing bridge | Forged reads, burst overload | Scoped device credentials, replay protection, bounded queues | Offline recovery and race-start bursts |
| Admin operations | Automated privileged misuse | Server permissions, recent authentication for sensitive actions, audit | Authorized staff |

## 4. Request architecture

Browser Firebase SDK requests carry App Check tokens to supported Firebase services. Firebase Authentication establishes user identity. Security Rules authorize document and object access.

Browser requests to custom HTTP APIs carry an ID token where login is required and X-Firebase-AppCheck. The server verifies each required token, checks action permissions, enforces rate budgets and validates payloads before side effects.

For an action requiring Turnstile, verify its response on the server before committing that action. Validate success, expected hostname and action. Store secrets in managed server secrets. Never place the secret in a VITE variable.

Provider webhooks and timing devices use explicit dedicated authentication paths. Exempt only exact handlers from browser attestation. Preserve signature verification, authorization and abuse controls on those paths.

## 5. Implementation inventory

Enumerate every deployed function, Hosting rewrite, direct Firebase read/write, HTTP action and storage download path. Record method, caller, authentication, authorization, idempotency, existing limit, cost and owner.

Include custom domains, web.app, firebaseapp.com, direct cloudfunctions.net URLs, preview deployments, Android origins and bridge addresses. A custom-domain edge rule does not cover direct Firebase service URLs. Long-lived public Storage download URLs also require review because tokenized asset sharing may permit access outside the intended application flow.

Deliver an endpoint table before enforcement. Every mutation must have an explicit policy.

## 6. Firebase App Check

1. Register each production and staging app and its intended domains.
2. Configure the web reCAPTCHA Enterprise provider and initialize App Check once before Firebase service use. Enable automatic refresh.
3. Add required CSP script, frame and connection origins from provider documentation, using narrowly scoped allowances.
4. Introduce development-only debug configuration. Register debug tokens as secrets for approved development/CI environments. Keep them out of production bundles and logs.
5. Attach tokens through a shared HTTP client for custom endpoints. Add the header to applicable CORS allowlists.
6. Verify tokens in custom HTTP middleware with the Admin SDK. Existing onRequest functions need this explicitly. Use enforceAppCheck on actual callable functions where applicable.
7. Monitor token validity per platform and service before enabling enforcement.
8. Enforce one service or endpoint group at a time after its acceptance checks pass.

Check current Firebase Authentication support, project prerequisites and SDK compatibility before promising coverage for each Auth method. UI verification must have server/provider enforcement that covers direct calls.

App Check token replay protection is optional and should be assessed for high-value mutations. Confirm SDK support and token-verifier IAM requirements. Account separately for latency and retries. Transaction idempotency remains necessary.

## 7. Capacitor and Android

Determine whether each call uses the JavaScript Firebase SDK or a native SDK. Installing native Play Integrity alone does not establish that WebView JavaScript requests receive valid attestation.

Prototype a supported native provider/bridge or supported custom-provider integration and prove token acceptance for the actual request path. Test Play-distributed releases, intended sideload distribution, signing certificates, emulators, Google sign-in, app resume and token refresh.

Keep Android enforcement in observation until release builds pass. If older versions lack support, ship a compatible update and communicate a minimum version before enforcement. Never ship a universal production debug token.

## 8. Distributed rate limiting

Implement a reusable server limiter with atomic counters and TTL. Use a store appropriate to expected volume. Firestore transactions are a possible small-volume starting point; a managed Redis-compatible store should be evaluated for high concurrency. Avoid instance-local counters as the authoritative production limit.

Key budgets by action and authenticated UID, with privacy-preserving destination keys for email actions. Use IP as an additional signal. Trust forwarded IP headers only from verified infrastructure and configure proxy handling explicitly.

Suggested initial values below are hypotheses for staging calibration.

| Action | Initial budget | Handling |
| --- | --- | --- |
| Send verification/reset email | 1 per 60 seconds and 5 per hour per destination | Generic response, server cooldown |
| Failed custom login attempts | 10 per 15 minutes per account signal; broader network threshold | Progressive challenge; avoid attacker-triggered permanent lockout |
| Registration/bib mutation | 10 per minute per UID | Return existing result for identical idempotency key |
| Checkout creation | 5 per 10 minutes per UID | Reuse valid pending checkout |
| Route processing | 3 concurrent jobs and 10 submissions per hour per organizer | Queue or reject with retry guidance |
| Photo uploads | Set count and byte budgets from actual race media requirements | Validate before accepting expensive processing |
| Public reads | Baseline first | Prefer cache and bounded query size before strict IP rejection |
| Timing ingest | Measure device peak and offline replay volume | Separate burst-aware device policy |

Return structured 429 responses with Retry-After for HTTP limits. Apply validation and limits before email sends, payment-session creation and image/GPX processing.

Require idempotency keys for costly mutations, bind them to actor/action/payload digest, and store outcome transactionally. Define reservations and reconciliation for side effects crossing external services.

## 9. Human challenge workflow

Use managed Turnstile on custom email/recovery or checkout flows when risk or quotas justify it. Turnstile responses expire after five minutes and are single-use. Refresh expired responses and support keyboard/screen-reader interaction.

Server verification must precede the protected action. Reject invalid, missing, expired, reused and wrong-host/action responses. On verification-service failure, return a recoverable error for protected mutations. Preserve form input and provide a retry.

For a lost network response after successful action, retrieve the stored idempotent outcome. Do not require a previously consumed challenge token to authorize a second side effect.

Never assume a challenge added to an Auth form protects direct Firebase Auth endpoints. Resolve provider-level protection or route the sensitive operation through an enforceable server design.

## 10. Cloudflare integration

Confirm domain and DNS control, current hosting topology and plan features. Test in staging before proxy changes. Firebase Hosting certificate provisioning/renewal, auth redirects and custom-domain behavior must remain working.

Apply managed bot challenges to suspicious browser page requests. For JSON APIs, return compatible errors and use application-level challenge handling instead of unexpectedly sending HTML challenge pages to fetch clients.

Keep exact payment webhook and authenticated timing-device routes compatible with their clients. Allow verified search crawlers where public race discovery is desired. robots.txt expresses crawl preferences and is not an authorization control.

Test direct Firebase hostnames and function URLs. Document residual edge bypass and enforce backend controls independently. If the requirement becomes complete origin isolation, evaluate a supported gateway/hosting architecture as a separate migration.

## 11. Rules, privacy and public data

Review Firestore and Storage rules against runner, organizer, admin, anonymous and cross-organizer access. Enforce ownership, field allowlists and immutable server-owned payment/timing fields.

Publish only intended race/result data. Avoid returning private runner contacts to public clients. Bound result query size and downloads. Audit default public asset URLs.

Log action, outcome, reason, platform, policy version and correlation ID. Exclude passwords, ID/App Check/challenge tokens and full request bodies. Use keyed hashes for destination identifiers. Set an explicit retention period and access controls. Update privacy notices for selected verification providers before rollout.

## 12. Availability and race-day handling

Preserve public browsing through cache and useful retry states when verification providers fail. Define fail-closed behavior for sensitive mutations and controlled degraded handling for public reads.

Timing ingest must retain local buffering, stable event IDs, deduplication and replay after connectivity returns. Test queues at expected race peaks. Tune limits from measurements and freeze protection changes during active events unless responding to an incident.

Separate switches should control each enforcement layer. A rollback disables the newly problematic policy while preserving authentication, permissions, payment signature validation and idempotency.

## 13. Proposed file changes

| File or area | Planned change |
| --- | --- |
| src/firebase.ts | Early App Check initialization and platform selection |
| Shared API client, existing location to confirm | Token headers, one bounded refresh retry, structured errors |
| functions shared security module | Token verification, action limits and challenge validation |
| functions/auth-api.js | Email/recovery limits and enforceable challenge integration |
| functions/race-bib-claim-api.js | Claim budget, ownership and idempotency review |
| functions/route-api.js | Import/media quotas and processing concurrency |
| functions/index.js | Browser-payment protections and exact webhook separation |
| server.ts | Device policy, header allowlists and bridge-specific limits |
| scripts/firestore-base.rules and generator | Source-controlled permission changes if required |
| storage.rules | Upload/read authorization review |
| firebase.json | Provider CSP allowances and rewrite verification |
| Android project | Provider integration only after request-path prototype |
| Tests and operations documentation | Regression coverage, rollout and rollback instructions |

Reuse existing protection helpers after inspecting delegated handlers. Avoid duplicate verification layers with conflicting error behavior.

## 14. Verification matrix

Required tests include valid/expired/missing App Check tokens, valid token with unauthorized UID, cross-organizer requests, direct API calls bypassing the UI, wrong challenge action/host, replayed challenge, retries after partial success, limiter races across instances, IPv4/IPv6 and shared-network users.

Test password and Google login, signup, email verification, recovery, checkout, signed webhook retries, bib claims, route uploads, public results and timing ingestion. Verify Android release builds and old-client behavior.

Load tests should use staging and stubbed external side effects. Define expected peak requests and concurrent viewers from organizer estimates before selecting volumes. Record latency, false rejections, datastore cost and queue growth.

For any UI change, run the project-required Playwright desktop 1440x900 and 1280x800 plus mobile 390x844 matrix in light/dark themes. Inspect every screenshot, keyboard behavior, accessible errors, overlap, overflow and console errors. Record element-by-element interactions.

Run TypeScript, production build, relevant unit/integration and Security Rules tests. Record exit codes. A blocked test stays unverified.

## 15. Rollout and acceptance

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| A | Endpoint inventory and baseline dashboard | Every sensitive action has an owner and policy |
| B | Web and Android attestation prototypes | Valid production-like clients obtain accepted tokens |
| C | Backend verification and limiter in observation | No side effects occur before required validation; metrics available |
| D | Staging enforcement and challenges | Abuse tests rejected; legitimate journeys pass |
| E | Updated clients and production observation | Representative mobile, desktop and shared-network traffic measured |
| F | Incremental enforcement | Each service passes its own gate and rollback rehearsal |
| G | Optional Cloudflare rollout | Proxy/certificate/auth and direct-origin tests documented |
| H | Race-day rehearsal and operational handover | Support can diagnose blocks and restore service safely |

Proposed operational targets are zero authorization bypasses in the test suite, zero duplicate paid registrations from replay tests and less than 0.5% confirmed legitimate rejection in a representative sample. Treat these as acceptance targets, not measured results. Agree latency/cost budgets after baseline collection.

## 16. Cost and effort

Budget for reCAPTCHA assessments, Cloudflare plan capabilities, function executions, limiter datastore operations, logs and storage processing. App Check token refresh generates reCAPTCHA assessments; estimate usage from active sessions and refresh frequency rather than counting only page views. Confirm current billing tier and free allowance in the project before enabling paid usage.

Turnstile has a free plan with published limits. Cloudflare bot features vary by plan. Set budget alerts and application quotas; alerts alone do not cap spend.

Planning estimate is 8 to 15 engineering days for inventory, web/backend integration, Android compatibility, tests and rollout preparation, plus several days of representative observation. Native bridge work or hosting migration can extend this. This estimate requires validation after endpoint inventory.

## 17. Decisions needed during implementation

- Confirm the production domain, DNS owner and Cloudflare plan.
- Confirm whether Android APKs are Play-distributed, sideloaded or both.
- Confirm anticipated race-day viewers, timing device rates and email volumes.
- Choose public crawler policy and acceptable scraping exposure.
- Approve provider spending only if implementation requires a paid subscription.

Read-only inspection and code preparation can proceed before these decisions. Production enforcement requires tested client compatibility and concrete rollback configuration.

## 18. Primary references

Reviewed November 16, 2026.

- Firebase App Check overview https://firebase.google.com/docs/app-check
- Web provider and assessment billing https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- Enforcement https://firebase.google.com/docs/app-check/enable-enforcement
- Custom backend verification https://firebase.google.com/docs/app-check/custom-resource-backend
- Callable enforcement and replay protection https://firebase.google.com/docs/app-check/cloud-functions
- Android Play Integrity https://firebase.google.com/docs/app-check/android/play-integrity-provider
- Web debug provider https://firebase.google.com/docs/app-check/web/debug-provider
- Turnstile server validation https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Turnstile plans https://developers.cloudflare.com/turnstile/plans/
- Cloudflare proxy scope https://developers.cloudflare.com/dns/proxy-status/
- Firebase custom domains https://firebase.google.com/docs/hosting/custom-domain
- Cloudflare rate-limit guidance https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/

## 19. Planning audit

Document scope covers architecture, existing-source findings, platform compatibility, endpoint policies, costs, rollout, rollback and acceptance tests. Implementation and deployed configuration are unverified. Visual and runtime gates apply when changes are implemented. This document does not certify current production protection.
