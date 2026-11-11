---
name: racepulse-launch-trust-legal
description: Verify RacePulsePH privacy policy, terms of use, browser storage disclosure, analytics consent gating and real support contact links. Use when editing public legal views, footer links, registration disclosures or tracking scripts.
---

# RacePulse launch trust and legal

Keep public legal disclosures, browser storage statements and support contact channels accurate and reachable from every public and authenticated screen. This skill covers `src/components/PublicInfoPages.tsx`, `src/components/PublicRaceLanding.tsx` and `index.html`.

Load with: `antislop`, `antislop-copywriting`. Rules upheld: `C-2`, `C-5`, `R-02`, `R-18`, `R-24`, `R-26`, `R-35`, `R-36`, `R-38`. Detail: [checklist and verification](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Keep `/privacy` and `/terms` reachable via `PublicLegalPage` in `src/components/PublicInfoPages.tsx` and linked from public footers and auth screens | Runners and organizers must be able to read data handling and event rules before registering | Click the Privacy Policy and Terms of Use links from the landing view and switch between them |
| Match privacy prose to the actual fields collected in `src/lib/raceRegistration.ts` and `functions/index.js` | Legal disclosures must reflect real data collection without boilerplate filler (C-5) | Compare `PublicLegalPage` sections against `registrationFromRequest` in `functions/index.js` |
| Disclose exact local storage keys (`racepulse_theme`, offline scan queues) and add a consent banner before any non-essential cookies or analytics load | RacePulsePH currently uses essential storage only; adding trackers without consent breaks the stated policy | Grep `localStorage` and third-party scripts across `src/` and `index.html` and compare with `PublicLegalPage` |
| Gate any analytics script behind explicit user opt-in if analytics are introduced | The current privacy policy states that no advertising trackers or behavioral profiles run | Confirm `index.html` and `src/` load no unapproved analytics scripts, or verify consent gating before firing |
| Keep a real, working support contact (`mailto:events@racepulseph.com`) visible on legal, 404 and public pages | Athletes need a real channel to request timing corrections or data removal (R-26) | Inspect `PublicLegalPage` and `PublicNotFoundView` in `src/components/PublicInfoPages.tsx` for valid `mailto:` links |
| Never add fake compliance seals, unverified security certifications or fabricated organizer testimonials | Violates `R-18` and `R-36` and misleads runners paying registration fees | Grep public components for badge claims and confirm every statement is backed by repo evidence |

## Stack mapping

- `src/components/PublicInfoPages.tsx` renders both `/privacy` and `/terms` inside `PublicLegalPage`.
- `functions/auth-api.js` uses `events@racepulseph.com` as the default `SMTP_USER` sender address, matching the support address shown in the UI.

## Not covered

- Payment webhook signature verification and Firestore rules belong to `racepulse-security-prelaunch` and `racepulse-access`.
- Meta tags and sitemaps belong to `racepulse-launch-seo`.

## Verify

1. Run `npm run lint` and `npm run build` to confirm legal and public views compile cleanly.
2. Click through `/privacy`, `/terms`, the switch button and the back button, then report PASS/FAIL with a purpose log.
