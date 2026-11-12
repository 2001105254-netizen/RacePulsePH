# Launch trust and legal checklist

Harvested from the 20-item launch checklist (items 15 to 19) and aligned with `AGENTS.md` (`C-5`, `R-02`, `R-18`, `R-36`).

## 1. Privacy policy page (item 15)

- **Implementation:** `PublicLegalPage` (`doc="privacy"`) in `src/components/PublicInfoPages.tsx`.
- **Must accurately cover:**
  - Account and runner registration data: name, username, email, role, distance category, bib assignment, team members and emergency contact details (`functions/index.js`, `src/lib/raceRegistration.ts`).
  - Public timing and finisher records: published leaderboards, checkpoint split times, bib numbers and certificate downloads, plus how to request corrections or removal (`events@racepulseph.com`).
  - Authentication and device storage: Firebase Authentication, Cloud Firestore and the `racepulse_theme` key in `localStorage`.

## 2. Terms of use page (item 16)

- **Implementation:** `PublicLegalPage` (`doc="terms"`) in `src/components/PublicInfoPages.tsx`.
- **Must accurately cover:**
  - Account and role responsibility, including organizer approval before publishing races.
  - Provisional live splits versus official reviewed results (`docs/finish-precision.md`).
  - Prohibition on forged scan logs, athlete impersonation or scraping restricted endpoints.

## 3. Cookie banner and storage honesty (item 17)

- **Current state:** RacePulsePH stores only essential session state, `racepulse_theme` and operator offline queues (`racepulse_pending_chip_reads_v2:*`), with zero ad trackers.
- **Rule:** do not add a decorative cookie banner when no non-essential cookies or trackers exist (`C-1` Intentionality). If non-essential cookies or third-party analytics are added later, implement an accessible consent control that blocks the script until accepted and update section 3 of `PublicLegalPage`.

## 4. Analytics installation and privacy alignment (item 18)

- Before installing Firebase Analytics, Plausible or any other telemetry script:
  1. Update the Privacy Policy in `src/components/PublicInfoPages.tsx` so it no longer claims zero third-party analytics.
  2. Respect user consent and avoid sending runner PII (full names, emergency phone numbers, email addresses) in analytics event payloads.

## 5. Real contact address (item 19)

- Keep `mailto:events@racepulseph.com` clickable with a minimum `44px` touch target (`min-h-11`) on `PublicLegalPage` and `PublicNotFoundView`.
- Never replace the support address with `example.com`, `#` or a dead contact form (`R-26`, `R-38`).
