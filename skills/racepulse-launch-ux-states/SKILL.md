---
name: racepulse-launch-ux-states
description: Audit RacePulsePH above-the-fold primary actions, mobile breakpoints, sticky action bars, loading states, inline form error states and post-submission confirmation views. Use when building or reviewing public pages, registration flows or payment returns.
---

# RacePulse launch UX and state completeness

Ensure every public and registration flow presents a clear primary action, holds up across phone and desktop viewports, and covers loading, validation error and completion states without losing user input.

Load with: `antislop`, `antislop-layoutmobile`, `antislop-human`, `racepulse-feedback`, `racepulse-responsive-ui`. Rules upheld: `C-1`, `C-2`, `C-4`, `R-02`, `R-03`, `R-15`, `R-26`, `R-27`, `R-35`. Detail: [checklist and verification](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Place the primary action (race lookup, bib search or event registration) above the fold without eyebrow pill banners | Runners opening RacePulsePH on race morning need immediate access to results or registration (R-15) | Inspect `src/components/PublicRaceLanding.tsx` and `src/components/PublicLiveRaceHub.tsx` at `375x812` and `1440x900` |
| Verify layout reflow across phone (`375px`), tablet (`768px`) and desktop (`1280px+`) with `min-h-11` touch targets | Prevents horizontal scrollbars and cramped tap targets on mobile browsers (R-03) | Resize viewport across breakpoints and check `src/components/BottomNav.tsx` and workspace headers |
| Keep sticky mobile navigation or action bars compact and non-overlapping with form inputs and footers | Fixed bars that cover submit buttons block completion on small screens | Inspect `src/components/BottomNav.tsx` and persistent workspace footers in `src/components/AccessWorkspace.tsx` |
| Render explicit loading states (`src/components/RunningLoader.tsx` or disabled button spinners) during async fetches and submits | Prevents double submissions and blank screens while Firestore or Functions respond (R-27) | Trigger initial load, race filtering and checkout creation and confirm visible loading feedback |
| Show field-level or form-adjacent error messages and preserve draft values when validation or network calls fail | Clearing a runner's form on error forces re-entry on mobile keyboards (R-27) | Submit invalid registration or engraving data and confirm the error message appears and inputs stay populated |
| Render a clear post-action confirmation state or return view for registrations, PayMongo returns (`?payment=pay_...`) and engraving orders | Users need verifiable confirmation of their bib, pending webhook status or order queue state | Test free registration, `?payment=` return handling in `src/lib/payments.ts` and order submission in `src/components/CustomerForm.tsx` |

## Stack mapping

- Loading indicator: `src/components/RunningLoader.tsx` and the inline shell status in `index.html`.
- Feedback and confirmations: `src/components/ui/FeedbackProvider.tsx` and `src/components/ui/DialogSurface.tsx` (`racepulse-feedback`).
- Responsive operational shells: `src/components/AccessWorkspace.tsx` and `src/access-ui.css` (`racepulse-responsive-ui`).

## Not covered

- Color contrast math and keyboard focus rings belong to `antislop-human`.
- SEO meta tags and `PublicNotFoundView` belong to `racepulse-launch-seo`.

## Verify

1. Run `npm run lint` and `npm run build`.
2. Test empty, loading, error and completion states across `375px` and `1280px` viewports and output the PASS/FAIL report with a purpose log.
