---
name: racepulse-security-prelaunch
description: Run the 20-point RacePulsePH pre-launch security audit across secrets, Firebase rules, Functions auth, input validation, Storage uploads, response trimming and dependencies. Use before deploying Functions, Firestore or Storage rules, or public releases.
---

# RacePulse pre-launch security sweep

Translate the 20-point pre-launch security checklist into concrete checks for Firebase Auth, Firestore, Cloud Storage, Cloud Functions (`functions/`) and the on-site LAN server (`server.ts`). This skill audits security posture and never relaxes `racepulse-access`.

Load with: `racepulse-access`, `racepulse-access-validation`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-33`, `R-35`, `R-36`. Detail: [20-point mapping and evidence](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Keep server secrets (`PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `SMTP_APP_PASSWORD`, `AUTH_CODE_SECRET`, `RACEPULSE_BRIDGE_KEY`) out of `src/` and Git | Any key in `VITE_*` or committed files is public to every browser user | Confirm `firebase.json` ignores `.secret*` and `.env*` and grep `src/` for secret key names |
| Use only the public Firebase web config in `src/firebase.ts` and enforce access in `firestore.rules` and `storage.rules` | Firebase web `apiKey` identifies the project; security depends on rules, not hiding `firebase.ts` | Run `npm run generate:access` and `npm run verify:rbac` to test rules against the emulator |
| Verify Bearer ID tokens with `admin.auth().verifyIdToken(token, true)` and check `accessPolicy.can(...)` in every Function and LAN route | Client UI checks can be bypassed with direct HTTP requests | Inspect `requireUser` in `functions/index.js`, `requireRunner` in `functions/race-bib-claim-api.js` and `/api` middleware in `server.ts` |
| Lock sensitive fields (`role`, `approved`, `paymentStatus`, `bibNumber`, `accessHistory`) against client tampering in `firestore.rules` | Prevents privilege escalation or fake paid registrations from the browser console | Inspect `scripts/firestore-base.rules`, `firestore.rules` and `functions/index.js` |
| Enforce rate limits and constant-time comparisons on verification codes, password resets, webhooks and bridge keys | Blocks brute-force attacks on 6-digit codes and timing attacks on HMAC signatures | Inspect `rateLimit` and `crypto.timingSafeEqual` in `functions/account-security.js`, `functions/index.js` and `server.ts` |
| Validate and bound all request payloads (`safeText`, numeric bounds, regex IDs, 8 KB limit on `accountApi`) and escape user content | Rejects malformed or oversized inputs and prevents stored XSS in runner or team names | Inspect `registrationFromRequest` in `functions/index.js`, `readPayload` in `functions/race-bib-claim-api.js` and `functions/auth-api.js` |
| Restrict Storage uploads by owner UID, role capability, MIME type and byte size (`2 MB` fonts, `8 MB` images) | Stops unauthorized file hosting or oversized uploads in Cloud Storage | Inspect `storage.rules` lines 30 to 41 |
| Return minimal projections from APIs (`publicPayment`, `safeRunner`) so emergency contacts, RFID data and payment internals never leak | Prevents accidental PII disclosure when a runner claims a bib or checks payment status | Inspect `publicPayment` in `functions/index.js` and `safeRunner` in `functions/race-bib-claim-api.js` |
| Audit npm dependencies in root and `functions/` before release | Catches known vulnerabilities in transitive packages | Run `npm audit --omit=dev` at root and `npm --prefix functions audit --omit=dev` |

## Stack mapping

- Row-level security in Supabase/SQL maps to `firestore.rules`, `storage.rules` and `functions/access-policy.js`.
- Password hashing and session token signing are handled by Firebase Authentication; custom email verification and password reset codes are HMAC-SHA256 hashed in `functions/account-security.js`.

## Not covered

- Role preset design and rollout activation belong to `racepulse-access` and `racepulse-access-validation`.
- Deep protocol and CORS/CSRF/SSRF reviews belong to `racepulse-appsec-deep`.

## Verify

1. Run `npm run lint` and `npm run verify:rbac` (when Java 21+ and Firebase CLI are present) or inspect the rule and Function files directly.
2. Output the PASS/FAIL report covering all 20 items with concrete file and line evidence.
