# ADR-002: Security Boundaries, Token Verification & Supply-Chain Audit Exemptions

- **Status:** Accepted
- **Date:** 2026-11-23
- **Owners:** RacePulsePH Engineering

## Context
RacePulsePH handles runner PII, online PayMongo payments, transactional authentication codes, offline RFID bridge ingestion, and browser spreadsheet imports. Supply-chain and static security gates (`scripts/security-audit.cjs`) must fail closed on unsafe client boundaries, leaked development hooks, or unapproved dependency advisories.

## Decision
1. **Strict Server Trust Boundaries & Fail-Closed Auth:**
   - Every Firebase ID token verified in Cloud Functions or `server.ts` passes `checkRevoked = true`.
   - Online PayMongo Checkout and webhook verification (`functions/payments-service.js`) run exclusively on server secrets, enforce 300s webhook replay timestamps and live/test secret mode parity, persist in centavos/minor units, and isolate per-registration lock docs against concurrent double-checkout (`409` + stale recovery).
   - Development E2E profile helpers (`racepulse_e2e_profile`, `e2e-`) are strictly compiled behind `import.meta.env.DEV` and verified absent from built `dist/` bundles by `scripts/security-audit.cjs --dist`.
2. **Supply-Chain Hardening:**
   - Removed unused `@google/genai` and vulnerable `xlsx` (SheetJS); replaced with `read-excel-file/universal` (`src/lib/spreadsheet.ts`) and a literal-preserving RFC-4180 CSV parser (preventing bib date-coercion such as `12-20-01`) with strict `stripUnsafeKeys` prototype filtering.
   - `APPROVED_HIGH_ROOT_PACKAGES` retains an explicit documented entry only for `@grpc/grpc-js` (dev-emulator transitive dependency in `@firebase/rules-unit-testing`), never application runtime packages.
3. **Database & Storage Enforcement:**
   - Server-only coordination docs (`bibClaimLocks`, `accountRateLimits`, `accountChallenges`, `accountResetGrants`, `routeAudit`, `routeJobs`) reject direct client mutations; TTL `fieldOverrides` reclaim expired security artifacts.
   - Runner self-registration bib increments (`bibCounters`) require atomic same-transaction `runners/{uid}_{raceId}` creation (`existsAfter`).

## Consequences & Revisit Triggers
- Legacy `.xls` BIFF binary files are rejected with clear guidance to export `.xlsx` or `.csv`.
- **Revisit trigger:** Whenever `@firebase/rules-unit-testing` upgrades past the vulnerable `@grpc/grpc-js` range, remove `@grpc/grpc-js` from `APPROVED_HIGH_ROOT_PACKAGES` in `scripts/security-audit.cjs`.
