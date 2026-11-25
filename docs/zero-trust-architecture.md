# RacePulsePH Zero Trust Architecture (CISA ZTMM v2.0 Alignment)

This document maps RacePulsePH security controls across the five CISA Zero Trust Maturity Model v2.0 pillars and three cross-cutting capabilities, tied directly to implemented source files and automated verification gates.

## 1. Pillar Mapping

| CISA ZTMM Pillar | Implemented Controls | Primary Enforcement Files |
| :--- | :--- | :--- |
| **Identity** | Firebase ID token verification with revocation checking (`verifyIdToken(token, true)`); automatic `auth.revokeRefreshTokens(uid)` on account removal, suspension, or admin demotion; recent-auth (`auth_time <= 900s`) step-up check on destructive `/account/delete` plus forced token refresh in client; `accessRemoved` enforcement; HMAC-SHA256 verification and reset codes with constant-time comparison. | `functions/access-api.js`, `functions/access-service.js`, `functions/auth-api.js`, `functions/account-security.js`, `functions/request-guard.js`, `src/lib/accountSecurity.ts` |
| **Devices** | Firebase App Check attestation (`X-Firebase-AppCheck`) with replay consumption support (`RACEPULSE_APP_CHECK_MODE` / `RACEPULSE_ZERO_TRUST_STRICT`); Cloudflare Turnstile (`TURNSTILE_SECRET_KEY`, `RACEPULSE_TURNSTILE_MODE`) and human form timing/honeypot checks; Android `allowBackup="false"`, `network_security_config.xml` denying cleartext by default, and release shrinking/minification. | `functions/request-guard.js`, `src/lib/botProtection.ts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/network_security_config.xml`, `android/app/build.gradle` |
| **Networks** | Explicit CORS origin allowlists across all Cloud Functions (`getDefaultAllowedOrigins`) with `403` rejection on disallowed origins (`OPTIONS` and non-webhook mutations); strict HSTS, CSP, `X-Frame-Options: DENY`, `Permissions-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-XSS-Protection: 0` across Firebase Hosting, Cloud Functions, and the LAN server; SSRF-safe `validateTrustedEndpointUrl` check on `RACEPULSE_ACCESS_API_URL` before forwarding Bearer tokens. | `firebase.json`, `functions/request-guard.js`, `functions/payments-service.js`, `functions/race-bib-claim-api.js`, `functions/auth-api.js`, `server.ts` |
| **Applications & Workloads** | Default-deny authorization on LAN hub routes (`functions/lan-policy.js`); HMAC-SHA256 signed RFID bridge ingestion (`X-RacePulse-Bridge-Timestamp`, `X-RacePulse-Bridge-Nonce`, `X-RacePulse-Bridge-Signature`) with +/-300s timestamp window and bounded nonce replay cache; recursive prototype-pollution sanitization and depth caps (`stripPrototypePollution`); two-tier (in-memory + Firestore transaction) rate limiting and per-UID concurrency slots; PayMongo webhook HMAC verification + atomic `bibCounters` transactions + idempotency collections. | `functions/lan-policy.js`, `server.ts`, `rfid-bridge/RfidBridgeService.cs`, `functions/request-guard.js`, `functions/payments-service.js`, `functions/community-service.js`, `functions/route-service.js` |
| **Data** | Least-privilege Firestore and Cloud Storage security rules generated from `functions/access-policy.js`; backend-only locking on sensitive collections (`payments`, `pendingRegistrations`, `accountChallenges`, `accountResetGrants`, `accountRateLimits`, `bibClaimLocks`, `routeIdempotency`, `communityIdempotency`, `activePresence`, `accessHistory`); minimal API projections (`publicPayment`, `safeRunner`); PII purge and accounting anonymization on account deletion. | `scripts/build-access-rules.cjs`, `firestore.rules`, `storage.rules`, `functions/payments-service.js`, `functions/race-bib-claim-api.js`, `functions/auth-api.js` |

## 2. Cross-Cutting Capabilities

- **Visibility and Analytics**: Correlation IDs (`X-Request-Id`) propagated and returned by Cloud Functions and `server.ts`; structured JSON security decision logs (`logSecurityEvent`) with hashed actor IDs and zero tokens, headers, emails, or bodies; sharded operational telemetry (`functions/telemetry-service.js`).
- **Automation and Orchestration**: GitHub Actions CI/CD (`ci-cd-release.yml`, `codeql.yml`) running repository secret scanning, Gitleaks, `npm audit`, Firestore/Storage emulator RBAC suites, TypeScript checks, build artifact checks, and CodeQL SAST.
- **Governance (Policy as Code)**: Deterministic rules and config verification in `scripts/security-audit.cjs` (`scanZeroTrustPolicies`), enforcing RBAC sync (`functions/rbac/` parity), wildcard allow bans in `firestore.rules` and `storage.rules`, default-deny LAN GET authorization, HTTP security headers, and endpoint validation.

## 3. Production Strictness Rollout Flags

| Environment Variable | Default | Strict Zero Trust Value | Effect |
| :--- | :--- | :--- | :--- |
| `RACEPULSE_ZERO_TRUST_STRICT` | unset (`false`) | `true` | Sets default `verifyAppCheckRequest` mode to `enforce` across Cloud Functions when `RACEPULSE_APP_CHECK_MODE` is unset. |
| `RACEPULSE_APP_CHECK_MODE` | `monitor` | `enforce` | Rejects requests missing a valid `X-Firebase-AppCheck` token (per-endpoint override, e.g. `/session` keeps `monitor` for server-to-server LAN hub calls). |
| `RACEPULSE_TURNSTILE_MODE` | `monitor` (when secret set) | `enforce` | Requires valid single-use Cloudflare Turnstile token on checkout, password reset request, and username resolution. |
| `RACEPULSE_BRIDGE_REQUIRE_HMAC` | unset (`false`) | `true` | Rejects legacy static `X-RacePulse-Bridge-Key` headers on `POST /api/rfid-events`, requiring HMAC-SHA256 timestamp + nonce + signature headers. |
| `RACEPULSE_ALLOW_LOCALHOST_CORS` | unset (`false`) | unset (`false`) | Keeps `http://localhost:*` origins disabled in production Cloud Functions. |

## 4. Short Architecture Decision Record (ADR)

- **Decision**: Implement HMAC-SHA256 timestamp+nonce authentication in `rfid-bridge/RfidBridgeService.cs` and `server.ts` alongside opt-in strict enforcement (`RACEPULSE_BRIDGE_REQUIRE_HMAC=true`), and preserve `RACEPULSE_ZERO_TRUST_STRICT` / `RACEPULSE_APP_CHECK_MODE` phased enforcement.
- **Trade-offs**: Maintaining a temporary compatibility fallback for static `X-RacePulse-Bridge-Key` prevents breaking already-installed Windows Timing Station binaries mid-event while allowing immediate enforcement via `RACEPULSE_BRIDGE_REQUIRE_HMAC=true` once stations are rebuilt.
- **Known Upstream Dependency Notes**: `scripts/security-audit.cjs` continues to explicitly track `@grpc/grpc-js` (browser-only `firebase` client transitive dependency, not executed in Node server runtime) and `functions/` has 7 moderate advisories under `uuid < 11.1.1` inside `firebase-admin` (resolving requires a major `firebase-admin` upgrade).
- **Revisit Trigger**: Enable `RACEPULSE_BRIDGE_REQUIRE_HMAC=true` as the default once all deployed Windows Timing Station executables include the HMAC bridge build, and evaluate `firebase` / `firebase-admin` major releases during the next release cycle.
