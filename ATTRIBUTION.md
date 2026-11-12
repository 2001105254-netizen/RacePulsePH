# Media, Icon, Typography & SDK Attribution Manifest

This document audits every image, motion sprite, inline SVG, icon set, font family, and uploaded media source rendered by **RacePulsePH** to maintain commercial licensing clarity and asset provenance.

---

## 1. Local & Static Visual Assets (`public/assets/` and `src/assets/`)

| Asset Path | Component / Route | Usage | Source & License Status | Action / Verification Required |
| :--- | :--- | :--- | :--- | :--- |
| `/src/assets/runner-sprite.webp` | [`RunningLoader.tsx`](src/components/RunningLoader.tsx), [`runner-motion.ts`](src/assets/runner-motion.ts) | Animated horizontal stride silhouette shown inside loading backdrops (`alt=""`, `aria-hidden="true"`). | **Derived from CMU Graphics Lab Motion Capture Database** (`Subject 09`, `Trial 01` — running capture). Funded by **NSF EIA-0196217** (`mocap.cs.cmu.edu`). Commercial use permitted with attribution notice below. | Compliant with mandatory NSF EIA-0196217 attribution retained in this manifest and [src/assets/RUNNER-MOTION.md](src/assets/RUNNER-MOTION.md). |
| `/public/assets/hero-runners.webp` | [`PublicRaceLanding.tsx`](src/components/PublicRaceLanding.tsx), `index.html` (`<link rel="preload">`) | Public hero backdrop texture behind headline (`alt=""`, `aria-hidden="true"`). | **UNVERIFIED COMMERCIAL LICENSE** — Local binary asset checked into repository without an external photographer release, stock invoice, or Unsplash/Pexels/Adobe Stock receipt. | **Action Required**: Attach original photo copyright ownership proof or paid commercial stock license ID before public commercial promotion, or replace with company-owned race photography. |
| `/public/assets/racepulse-mark-192.png` | `App.tsx`, `AuthGate.tsx`, `AccountSecurity.tsx`, `public/manifest.webmanifest` | Brand app icon & navigation emblem. | Proprietary brand mark created for RacePulsePH. | Owner confirmation recommended that final mark artwork was authored in-house or assigned under contractor IP transfer. |
| `/public/assets/racepulse-mark.png` | `public/manifest.webmanifest`, `index.html` | App icon / Apple touch icon & shortcut icon (`512x512`). | Proprietary brand mark derived from the RacePulsePH mark above. | Same as `racepulse-mark-192.png`. |
| `/public/assets/racepulse-logo.png` | `index.html` (`og:image`, `twitter:image`) | Open Graph and social card preview image. | Proprietary brand composite for RacePulsePH social shares. | Owner confirmation recommended; verify zero third-party unlicensed photography embedded inside composite. |
| `/public/assets/racepulse-icon.png` | `public/assets/` | Source brand icon asset. | Proprietary brand icon for RacePulsePH. | Owner confirmation recommended. |

---

## 2. Mandatory Third-Party Attribution Notices

### CMU Graphics Lab Motion Capture Database (`runner-sprite.webp`)
> The data used in this project was obtained from `mocap.cs.cmu.edu`.
> The database was created with funding from NSF EIA-0196217.

---

## 3. Inline SVGs & Icon Libraries

| Icon / SVG Source | License | Usage in RacePulsePH |
| :--- | :--- | :--- |
| **Lucide React** (`lucide-react`) | ISC License (Free for commercial use, attribution optional; notice documented here) | UI control icons across public directory, legal views, forms, modals, and timing consoles (`aria-hidden="true"`). |
| **Google "G" Mark** (`GoogleIcon` in [`AuthGate.tsx`](src/components/AuthGate.tsx)) | Google Brand Guidelines (`sign-in` button usage) | Strictly used for the Firebase Google Sign-In button (`aria-hidden="true"`). Never altered or used as standalone brand identity. |
| **QRCodeSVG** (`qrcode.react`) | ISC License (Free for commercial use) | Dynamically renders deterministic event registration QR codes, race bib QR tickets, and offline laser-engraving sync QR payloads (`SXPv2` / `RXPv2`). |

---

## 4. Typography & Web Fonts

| Font Family | Source | License |
| :--- | :--- | :--- |
| **Inter**, **Space Grotesk**, **JetBrains Mono** | Loaded from `fonts.googleapis.com` in [`index.html`](index.html) (`preconnect` + stylesheet) | SIL Open Font License (OFL) 1.1 (Free for commercial web & print usage). |

---

## 5. Organizer-Supplied & User-Uploaded Media (Runtime Data URLs / Firebase Storage)

- `race.posterImage` (race hero posters displayed on public landing and race selection cards)
- `race.inclusionImage` (shirt / finisher kit design previews)
- `race.manualPaymentQrImage` (GCash / bank QR transfer previews displayed during manual checkout)
- `race.bibTemplateImage` & `runnerProfile.photoURL` (printable bib backgrounds & optional runner profile avatars)

Organizers warrant under [Terms of Service](/terms-of-service) that any event artwork, sponsor logo, kit mockup, or custom bib font (`raceBibCustomFont`) uploaded to RacePulsePH carries the necessary commercial distribution and print rights.

