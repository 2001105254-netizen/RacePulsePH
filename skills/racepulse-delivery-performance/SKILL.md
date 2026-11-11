---
name: racepulse-delivery-performance
description: Optimize RacePulsePH caching, CDN headers, asset budgets, Cloud Functions cold starts, serverless concurrency limits and Firestore read cost during live race rankings. Use when changing Vite build config, static assets, firebase.json, Functions options or live leaderboard queries.
---

# RacePulse delivery, latency and cost optimization

Keep RacePulsePH fast on mobile data at race venues while controlling Cloud Functions cold starts and Firestore read amplification. Covers `firebase.json`, `index.html`, `public/sw.js`, `functions/` and `src/components/LiveRankingsScreen.tsx`.

Load with: `antislop`, `antislop-ui`. Rules upheld: `C-1`, `C-4`, `C-5`, `R-02`, `R-19`, `R-35`, `R-36`, `R-40`. Detail: [caching, latency and cost checklist](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Set `Cache-Control: no-store` on dynamic auth and account responses (`functions/auth-api.js`) while letting Firebase Hosting CDN cache fingerprinted Vite bundles in `dist/assets/` | Prevents shared proxies or browsers from caching sensitive account challenges while keeping static bundles fast | Inspect `functions/auth-api.js` line 18 and `npm run build` hashed output in `dist/assets/` |
| Keep all Cloud Functions pinned to `region: 'asia-southeast1'` with bounded `maxInstances` | Co-locating Functions near Philippine runners lowers round-trip latency and caps runaway billing | Inspect `onRequest` options in `functions/index.js`, `functions/auth-api.js`, `functions/race-bib-claim-api.js` and `functions/access-api.js` |
| Keep top-level Function imports minimal and initialize `admin.initializeApp()` once per instance | Heavy module graphs slow down serverless cold starts during registration spikes | Inspect top-level `require` statements in `functions/*.js` |
| Serve large visual assets as WebP (`public/assets/hero-runners.webp`, `src/assets/runner-sprite.webp`) and preconnect font origins in `index.html` | Reduces Largest Contentful Paint (LCP) on 4G connections at race start lines (R-40) | Inspect `index.html` lines 21 to 41 and asset formats in `public/assets/` and `src/assets/` |
| Compute finisher rankings and consecutive-entry splits in memory from already-subscribed race documents (`src/lib/liveRankings.ts`, `src/lib/entrySequence.ts`) | Avoids firing extra Firestore reads on every clock tick or category filter change | Inspect `src/lib/liveRankings.ts` and `src/components/LiveRankingsScreen.tsx` |
| Animate only `transform` and `opacity` under `300ms` and honor `@media (prefers-reduced-motion: reduce)` | Prevents layout thrashing and battery drain on phones watching live rankings (`AGENTS.md`) | Inspect transitions in `src/components/` and `src/components/RunningLoader.css` |

## Stack mapping

- CDN and HTTP/2 or HTTP/3 delivery are provided by Firebase Hosting in front of `dist/`.
- Core Web Vitals (LCP, INP, CLS) baselines live in `.agents/skills/antislop-ui/references/CORE-WEB-VITALS.md`.

## Not covered

- Real-time listener selection (`onSnapshot` vs LAN polling) belongs to `racepulse-realtime-delivery`.

## Verify

1. Run `npm run build` and inspect bundle sizes and asset warnings emitted by Vite.
2. Output the PASS/FAIL report with build output, region/cache evidence and a purpose log.
