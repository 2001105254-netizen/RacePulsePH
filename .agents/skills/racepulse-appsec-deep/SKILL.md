---
name: racepulse-appsec-deep
description: Review RacePulsePH application and protocol security across secrets rotation, IAM, token revocation, TLS, CORS allowlists, CSRF avoidance, XSS/HTML escaping and SSRF prevention. Use when adding or modifying Cloud Functions, LAN endpoints, outbound fetches or email templates.
---

# RacePulse application security deep review

Apply protocol and application security controls to Cloud Functions (`functions/`), the LAN server (`server.ts`) and browser components (`src/`). Complements `racepulse-security-prelaunch` and `racepulse-access`.

Load with: `racepulse-access`, `racepulse-security-prelaunch`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-33`, `R-35`, `R-36`. Detail: [protocol and vulnerability checks](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Bind only the secrets a Function actually reads in `onRequest({ secrets: [...] })` | Limits blast radius so a payment function never loads SMTP credentials and vice versa | Compare `secrets` arrays in `functions/index.js` and `functions/auth-api.js` |
| Pass `checkRevoked = true` into `admin.auth().verifyIdToken(token, true)` on every authenticated endpoint | Immediately rejects tokens from disabled accounts or post-password-reset sessions | Inspect `verifyIdToken` calls in `functions/index.js`, `functions/auth-api.js`, `functions/race-bib-claim-api.js` and `functions/access-api.js` |
| Enforce explicit origin allowlists (`allowedOrigins` + `Vary: Origin`) on Cloud Functions CORS responses | Blocks arbitrary third-party origins from reading authenticated Function responses | Inspect `setCors` in `functions/index.js` and `functions/race-bib-claim-api.js` and `cors` in `functions/auth-api.js` |
| Authenticate state-changing requests with `Authorization: Bearer` headers or HMAC signatures (`paymongo-signature`, `X-RacePulse-Bridge-Key`) instead of ambient cookies | Eliminates cross-site request forgery (CSRF) on POST, PATCH and DELETE routes | Confirm no endpoint relies on automatic browser cookie credentials |
| Compare secrets, reset codes, webhook HMACs and bridge keys with `crypto.timingSafeEqual` after length checks | Prevents byte-by-byte timing side-channel leaks | Inspect `verifyWebhookSignature` (`functions/index.js`), `checkCode` (`functions/account-security.js`) and `/api/rfid-events` (`server.ts`) |
| Escape all user-supplied values in HTML email templates (`functions/account-email.js`) and never pass untrusted strings to `dangerouslySetInnerHTML` | Prevents XSS in transactional emails and browser views | Inspect `functions/account-email.js` and grep `dangerouslySetInnerHTML` in `src/` |
| Hardcode outbound hosts (`api.paymongo.com`, `smtp.gmail.com`, fixed `accessApi` endpoint) and never `fetch` a caller-supplied URL | Prevents server-side request forgery (SSRF) from Cloud Functions or `server.ts` | Grep `fetch(` across `functions/` and `server.ts` and confirm every target URL is fixed by server config |

## Stack mapping

- TLS and encryption in transit: enforced by Firebase Hosting, `cloudfunctions.net`, `https://api.paymongo.com` and `smtp.gmail.com` (`port: 465, secure: true` in `functions/auth-api.js`).
- WAF and DDoS protection: managed at the Google Cloud / Firebase edge; reinforced at the application layer by `maxInstances: 10` (`functions/auth-api.js`), `8192` byte body caps and `accountRateLimits`.

## Not covered

- Role definitions and capability matrices belong to `racepulse-access`.

## Verify

1. Run `node --test` on security tests or `npm run verify:rbac` to confirm token, CORS and policy checks pass.
2. Deliver the PASS/FAIL report with file and line citations and a 1-line purpose log.
