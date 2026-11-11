# Launch UX and state completeness checklist

Harvested from the 20-item launch checklist (items 2 and 10 to 14) and integrated with `racepulse-feedback`, `racepulse-responsive-ui`, `antislop-layoutmobile` and `antislop-human`.

## 1. CTA above the fold (item 2)

- **Rule alignment:** `AGENTS.md` strictly forbids eyebrow capsule badges above headlines (`• PHILIPPINE RACE TIMING`, `Beta`, `New`). Start directly with the functional headline and primary action (`R-15`).
- **Files:** `src/components/PublicRaceLanding.tsx`, `src/components/PublicLiveRaceHub.tsx`, `src/components/PublicRaceResults.tsx`.
- **Check:** at `375x812` (mobile) and `1440x900` (desktop), the primary race search or registration trigger is visible without scrolling.

## 2. Mobile breakpoints and sticky mobile bars (items 10 and 11)

- **Breakpoints:** follow Tailwind mobile-first utilities (`sm:`, `md:`, `lg:`) with spacing divisible by 4 or 8 (`AGENTS.md`).
- **Touch targets:** interactive controls use `min-h-11` (`44px`) so runners and timing operators can tap accurately outdoors.
- **Sticky bars:** `src/components/BottomNav.tsx` and sticky workspace footers (`src/components/AccessWorkspace.tsx`) must leave enough bottom padding (`pb-24` or equivalent) on the scrolling container so the last card or button is never hidden behind the bar.

## 3. Loading states (item 12)

- **Boot shell:** `index.html` includes a `<div role="status">` shell (`Starting RacePulsePH`) that renders before the JS bundle executes.
- **In-app loader:** `src/components/RunningLoader.tsx` (`docs/running-loader.md`) provides the sprite-based runner animation, honoring `@media (prefers-reduced-motion: reduce)`.
- **Submit buttons:** disable or guard in-flight form submissions so clicking twice cannot fire duplicate `createCheckout` or registration requests.

## 4. Form error states (item 13)

- **Inline visibility:** errors that require user correction stay visible beside the relevant form (`racepulse-feedback`), while transient outcomes use notifications.
- **Draft preservation:** never reset form state when `createCheckout`, `raceBibClaimApi` or `accountApi` returns a `4xx` or `5xx` response.

## 5. Thank-you and completion states (item 14)

- **Paid registration return (`?payment=pay_...`):** as documented in `docs/PAYMONGO_SETUP.md`, returning from PayMongo Checkout is not payment proof until the signed `checkout_session.payment.paid` webhook completes. The return state must clearly distinguish `pending` webhook processing from a confirmed `paid` registration with a bib number (`functions/index.js`, `src/lib/payments.ts`).
- **Free registration and QR bib claim:** show the assigned bib number, category and link to **My Races** immediately upon completion (`src/lib/raceRegistration.ts`, `src/lib/raceBibClaim.ts`).
- **Engraving order submission:** `src/components/CustomerForm.tsx` confirms the queued order without native `window.alert` prompts (`racepulse-feedback`).
