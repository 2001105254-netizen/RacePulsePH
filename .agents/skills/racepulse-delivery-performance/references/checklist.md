# Delivery, caching, latency and cost checklist

Harvested from the backend concepts list (items 2, 48 to 50, 88 to 94, 97, 99: Caching, CDN, Edge Caching, Cache Invalidation, Cost Optimization, Cold Starts, Serverless Limits, Latency, Throughput, P99 Latency, Tail Latency, DNS, HTTP/2 and HTTP/3) and paired with `antislop-ui`.

## 1. Caching, CDN and cache invalidation (items 2, 48 to 50)

- **Static assets (`dist/`):** Vite hashes compiled JS and CSS filenames in `dist/assets/`, making cache invalidation automatic on every `firebase deploy --only hosting`.
- **Service worker (`public/sw.js`):** check `public/sw.js` whenever changing asset caching or offline shell behavior so stale HTML shells do not trap users on old bundles.
- **API responses (`functions/`):** sensitive endpoints (`functions/auth-api.js`) set `Cache-Control: no-store`. Never cache personalized payment status or verification responses at the CDN edge.

## 2. Cold starts, serverless limits and tail latency (items 89 to 94)

- **Regional placement:** all Functions (`paymentsApi`, `accountApi`, `raceBibClaimApi`, `accessApi`) deploy to `asia-southeast1` to minimize network latency for users in the Philippines.
- **Cold-start discipline:**
  - Keep `functions/package.json` dependencies lean (`firebase-admin`, `firebase-functions`, `nodemailer`).
  - Reuse the module-scoped `admin.initializeApp()` and `db = admin.firestore()` instances across warm invocations (`functions/index.js` lines 15 to 18).
- **Concurrency and payload limits (`functions/auth-api.js` lines 16, 20):** set `maxInstances: 10` and reject payloads larger than `8192` bytes to protect downstream SMTP quotas and keep tail latency predictable.

## 3. Cost optimization and Firestore read discipline (item 88)

- **Filter and rank in memory:** `src/lib/liveRankings.ts` (`finishScanOrder`) and `src/components/LiveRankingsScreen.tsx` filter distances, divisions and search terms against the active snapshot in memory rather than issuing a new Firestore query on every keystroke.
- **Single-query bib lookup (`functions/race-bib-claim-api.js`):** scopes by `where('raceId', '==', raceId)` once per preview/claim request.
- **Avoid fabricated latency numbers:** per `R-36` and `C-5`, never publish P99 latency or accuracy figures in the UI or docs unless measured and reproducible from repo benchmarks.
