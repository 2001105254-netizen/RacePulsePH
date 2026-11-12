# Launch SEO and discoverability checklist

 harvested from the 20-item launch checklist (items 1 and 3 to 9) and mapped to the RacePulsePH Vite and Firebase Hosting stack.

## 1. Custom 404 view (item 1)

- **Component:** `PublicNotFoundView` in `src/components/PublicInfoPages.tsx`.
- **Requirements:**
  - Show the requested `pathname` in monospace so the runner or organizer can spot a typo.
  - Provide a primary button back to the race directory (`onGoHome`) and a secondary button to sign in (`onGoLogin`), plus the support `mailto:events@racepulseph.com` link.
  - Note that `firebase.json` rewrites `**` to `/index.html` with HTTP 200 for client routing. Do not claim a server-level HTTP 404 status code unless a hosting function or static 404 route is configured.

## 2. Meta title and description per view (items 3 and 4)

- **Default shell:** `index.html` defines the baseline `<title>` and `<meta name="description">`.
- **Copy rules:**
  - Describe real product capabilities: finding Philippine road and trail races, live bib and split lookup, and finisher certificates.
  - Never include fabricated statistics, unverified accuracy claims (`R-36`) or em dashes (`R-02`).

## 3. Open Graph and social cards (item 5)

- **Tags in `index.html`:** `og:type`, `og:site_name`, `og:title`, `og:description`, `og:image`, `og:image:alt`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`.
- **Asset check:** `public/assets/hero-runners.webp` must exist and stay under a reasonable file size so link unfurlers do not time out.

## 4. Favicon and web manifest set (item 6)

- **Files:**
  - `public/assets/racepulse-mark-192.png`
  - `public/assets/racepulse-mark.png`
  - `public/manifest.webmanifest`
- **Check:** every icon path referenced in `index.html` and `public/manifest.webmanifest` must exist on disk and copy cleanly into `dist/` during `npm run build`.

## 5. `robots.txt` and `sitemap.xml` (items 7 and 8)

- **`public/robots.txt`:** allows `/` and disallows `/api/` so on-site LAN endpoints and API routes are never indexed.
- **`public/sitemap.xml`:** lists canonical public URLs (`/`, `/login`, `/register`, `/privacy`, `/terms`). When adding a new public route in `src/App.tsx`, update `public/sitemap.xml` in the same change.

## 6. Image alt text (item 9)

- **Informative images:** race posters, finisher certificate previews, QR codes and brand marks that act as links must have concise, descriptive `alt` text (`R-39`).
- **Decorative graphics:** dividers such as `.track-ticks-rule` must carry `aria-hidden="true"` or `alt=""`.
