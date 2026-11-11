---
name: racepulse-launch-seo
description: Audit and maintain RacePulsePH public discoverability, route metadata, Open Graph cards, favicons, robots.txt, sitemap.xml and image alt text. Use when changing public routes, index.html, public assets or share previews.
---

# RacePulse launch SEO and discoverability

Keep public entry points discoverable and accurately previewed when athletes or organizers share links. This skill covers `index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/manifest.webmanifest` and `src/components/PublicInfoPages.tsx`.

Load with: `antislop`, `antislop-human`, `antislop-ui`. Rules upheld: `C-1`, `C-2`, `C-5`, `R-02`, `R-24`, `R-26`, `R-35`, `R-36`, `R-38`, `R-39`. Detail: [checklist and verification](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Render `PublicNotFoundView` in `src/components/PublicInfoPages.tsx` for unknown paths with working recovery actions | Prevents dead ends when a shared race URL is mistyped | Navigating to an unknown path renders the 404 card and both recovery buttons navigate cleanly |
| Keep `title` and `meta[name="description"]` accurate in `index.html` and update `document.title` per public view | Gives search results and browser tabs distinct context per screen | Inspect `index.html` head tags and verify `document.title` updates across public views |
| Maintain Open Graph (`og:title`, `og:description`, `og:image`, `og:image:alt`) and Twitter card tags in `index.html` | Chat and social links need a real preview image and summary | Confirm `/assets/hero-runners.webp` exists under `public/assets/` and matches `index.html` |
| Keep the icon set (`192x192`, `512x512`, `apple-touch-icon`) and `public/manifest.webmanifest` in sync | Broken icon paths cause 404 requests on every page load | Confirm every `href` and `src` in `index.html` and `public/manifest.webmanifest` exists in `public/assets/` |
| Keep `public/robots.txt` allowing `/` and disallowing `/api/` with a valid `Sitemap:` URL | Prevents crawlers from indexing local or API paths while exposing public pages | Inspect `public/robots.txt` and verify it is copied into `dist/robots.txt` on `npm run build` |
| List only real, publicly reachable canonical routes in `public/sitemap.xml` | Listing private dashboards or dead routes wastes crawl budget | Compare `<loc>` entries in `public/sitemap.xml` against the public routes handled in `src/App.tsx` |
| Supply meaningful `alt` text on informative images and `alt=""` or `aria-hidden="true"` on decorative elements | Screen readers need real descriptions for posters, logos and QR codes (R-39) | Grep `<img` across `src/` and confirm every element carries an appropriate `alt` attribute |

## Stack mapping

- Firebase Hosting serves `dist/` (`firebase.json`) with a SPA rewrite to `/index.html`. Static crawlers that do not execute JavaScript see `index.html` unless prerendering or a hosting function is added.
- Never put em dashes (U+2014) or unverified claims inside meta descriptions or Open Graph titles (`R-02`, `R-36`).

## Not covered

- Legal copy and consent banners belong to `racepulse-launch-trust-legal`.
- Viewport layout and CTA placement belong to `racepulse-launch-ux-states` and `racepulse-responsive-ui`.

## Verify

1. Run `npm run build` and confirm `dist/index.html`, `dist/robots.txt`, `dist/sitemap.xml` and `dist/manifest.webmanifest` exist.
2. Deliver the PASS/FAIL report with interactive route checks, command exit codes and a 1-line purpose log.
