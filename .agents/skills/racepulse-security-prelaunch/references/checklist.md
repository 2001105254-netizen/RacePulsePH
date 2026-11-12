# 20-point pre-launch security checklist mapped to RacePulsePH

Harvested from the 20-item pre-launch security list (`millee.md`) and translated to the RacePulsePH Firebase, Express LAN and PayMongo stack.

| # | Source item | RacePulsePH implementation and verification |
| --- | --- | --- |
| 1 | Hide API keys | PayMongo (`PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`) and SMTP/auth secrets (`SMTP_APP_PASSWORD`, `AUTH_CODE_SECRET`) use `defineSecret` in `functions/index.js` and `functions/auth-api.js`. Never place secrets in `src/` or `VITE_*` variables. |
| 2 | Purge Git secrets | `.gitignore` and `firebase.json` ignore `.secret*` and `.env*`. Keep `functions/.secret.local` untracked (`git status --ignored`). Never commit service account JSONs or `.env` files. |
| 3 | Use public DB key | `src/firebase.ts` holds only the public Firebase web configuration. Privileged `firebase-admin` runs only inside `functions/` and local administrative scripts. |
| 4 | Enable row-level security | Enforced via `firestore.rules` (generated from `scripts/firestore-base.rules` and `scripts/build-access-rules.cjs`) and `storage.rules`. |
| 5 | Encrypt sensitive data | Verification and reset codes are stored as HMAC-SHA256 digests (`codeHash`) in `functions/account-security.js`. Firestore and Storage encrypt data at rest automatically. |
| 6 | Enforce server-side auth | `requireUser` (`functions/index.js`), `requireRunner` (`functions/race-bib-claim-api.js`), `functions/access-api.js` and `/api` middleware (`server.ts`) verify Firebase ID tokens with `checkRevoked = true`. |
| 7 | Lock record access | `firestore.rules`, `functions/access-policy.js` and `functions/lan-policy.js` scope reads and writes by UID, role, approval status and `allowedRaceIds`. |
| 8 | Block field tampering | `firestore.rules` blocks client writes to `payments`, `pendingRegistrations`, `bibCounters`, `accessHistory`, `userAccess` and paid runner fields (`docs/PAYMONGO_SETUP.md`). |
| 9 | Secure session cookies | RacePulsePH uses short-lived Firebase Auth Bearer ID tokens verified with `verifyIdToken(token, true)` rather than browser session cookies. `functions/auth-api.js` sets `Cache-Control: no-store`. |
| 10 | Hash passwords | Firebase Authentication hashes user passwords; `functions/account-security.js` enforces password length (`8` to `128` chars) on reset and updates via `auth.updateUser`. |
| 11 | Rate limit login | `functions/account-security.js` enforces per-IP limits (`60` requests/hour in `accountRateLimits`) and per-email cooldowns (`60s` cooldown, `5` sends/hour, `5` code attempts in `accountChallenges`). |
| 12 | Add bot protection | Rate limits in `functions/account-security.js` and authenticated endpoints (`requireUser`, `requireRunner`) block unauthenticated abuse. Do not add CAPTCHA challenges (`AGENTS.md` guidelines). |
| 13 | Parameterize queries | Firestore SDK queries (`where('raceId', '==', raceId)`) and document refs (`db.doc(...)`) are structured objects, preventing query-string injection; validate path segments (`^[A-Za-z0-9_-]{1,64}$`) so callers cannot traverse collections. |
| 14 | Validate all input | `registrationFromRequest` (`functions/index.js`), `readPayload` (`functions/race-bib-claim-api.js`) and `normalizeEmail` (`functions/account-security.js`) enforce type, length and enum constraints. |
| 15 | Escape user content | React escapes JSX text nodes by default, and `functions/account-email.js` escapes HTML entities in email templates. Avoid `dangerouslySetInnerHTML`. |
| 16 | Restrict file uploads | `storage.rules` restricts `/race-bib-fonts/{ownerUid}/{file}` to `< 2 MB` with `can('race.bibs')` and `/race-assets/{ownerUid}/{raceId}/{file}` to `image/*` `< 8 MB` with scoped permissions. |
| 17 | Trim API responses | `publicPayment` (`functions/index.js`) and `safeRunner` (`functions/race-bib-claim-api.js`) strip emergency contact phone numbers, payment internals and RFID metadata from responses. |
| 18 | Add security headers | Set explicit `Cache-Control: no-store` and strict CORS origin allowlists on Functions (`functions/index.js`, `functions/auth-api.js`, `functions/race-bib-claim-api.js`), and review `firebase.json` hosting headers when changing static asset rules. |
| 19 | Force HTTPS | Firebase Hosting and `cloudfunctions.net` enforce HTTPS in production. Only the local on-site LAN server (`server.ts`) and localhost dev servers use HTTP on the local network. |
| 20 | Scan dependencies | Run `npm audit --omit=dev` in the repository root and `npm --prefix functions audit --omit=dev` before shipping. |
