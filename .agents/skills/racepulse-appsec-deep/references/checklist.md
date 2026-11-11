# Application and protocol security checklist

Harvested from the backend concepts list (items 67 to 80: Secrets Management, IAM, OAuth, JWT Rotation, TLS, Encryption at Rest, Encryption in Transit, WAF, DDoS Protection, CORS, CSRF, SQL Injection, XSS, SSRF) and mapped to RacePulsePH.

## 1. Secrets management and least privilege (items 67 and 68)

- **Function-scoped secrets:**
  - `paymentsApi` (`functions/index.js`) binds only `[paymongoSecretKey, paymongoWebhookSecret]`.
  - `accountApi` (`functions/auth-api.js`) binds only `[smtpPassword, codeSecret]`.
- **Log hygiene:** never log request bodies, verification codes, passwords, Bearer tokens or raw SMTP error objects (`functions/auth-api.js` line 57, `functions/account-security.js` line 74).

## 2. OAuth, Firebase ID tokens and revocation (items 69 and 70)

- Firebase Authentication rotates signing keys automatically and issues 1-hour JWT ID tokens.
- Always pass `true` as the second argument to `admin.auth().verifyIdToken(token, true)` so revoked sessions and disabled users are rejected immediately.
- When `resetPassword` completes in `functions/account-security.js`, call `auth.revokeRefreshTokens(uid)` so existing sessions on other devices must re-authenticate.

## 3. TLS, encryption at rest and encryption in transit (items 71 to 73)

- **In transit:** all cloud traffic uses HTTPS (`racepulseph.com`, `racepulseph.web.app`, `cloudfunctions.net`, `api.paymongo.com`) or implicit TLS (`smtp.gmail.com:465` with `secure: true`).
- **At rest:** Firestore and Cloud Storage encrypt documents and objects at rest automatically. One-time verification codes and reset tokens are stored only as HMAC-SHA256 hashes (`codeHash`, `accountResetGrants/${hash(resetToken)}`).

## 4. Edge protection and resource caps (items 74 and 75)

- Cap concurrent instances on sensitive endpoints (`maxInstances: 10` in `functions/auth-api.js`) and reject oversized payloads (`(request.rawBody?.length || 0) > 8192`).
- Enforce Firestore-backed IP and per-account rate limits in `functions/account-security.js`.

## 5. CORS and CSRF (items 76 and 77)

- **Cloud Functions CORS:** allow only explicit origins (`https://racepulseph.com`, `https://www.racepulseph.com`, `https://racepulseph.web.app`, `https://racepulseph.firebaseapp.com`, `capacitor://localhost` and local dev ports) and set `Vary: Origin`.
- **LAN server CORS (`server.ts`):** allows `*` on the local race-day network so operator tablets on another subnet can reach the Timing Station, while every `/api` route requires either a verified Firebase Bearer token (`lanPolicy.authorize`) or the 32+ character `X-RacePulse-Bridge-Key`.
- **CSRF avoidance:** because no endpoint uses ambient cookies for authentication, cross-site form posts cannot forge authenticated actions.

## 6. Injection, XSS and SSRF (items 78 to 80)

- **NoSQL / path injection:** validate IDs (`raceId`, `paymentId`, `challengeId`) with strict regular expressions before constructing `db.doc(...)` paths.
- **XSS:** keep React JSX auto-escaping intact and escape user names in `functions/account-email.js`.
- **SSRF:** outbound `fetch` calls in `functions/index.js` and `server.ts` must only call fixed origins (`https://api.paymongo.com/v2/checkout_sessions` and the configured `accessApi` URL), never a URL read from `req.body` or `req.query`.
