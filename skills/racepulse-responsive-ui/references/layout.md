# Layout and verification contract

- Complex editors use the viewport, with `100dvh` and a `100vh` fallback, `min-height: 0` on flex/grid scroll containers, and `minmax(0,1fr)` for flexible columns.
- Fixed overlays must escape transformed, animated and backdrop-filter ancestors. Reuse `DialogSurface`, which portals a native modal dialog to `document.body`. Do not nest a fixed drawer inside a glass panel.
- Use semantic surface, border and text variables from `src/index.css`; preserve both themes. Retain Inter, Space Grotesk and the existing icon family.
- Body and form text should normally be 16px; supporting labels may be smaller without becoming the primary instruction. Controls are at least 44px in target size; primary form actions normally use 48px or more. Switches may be smaller visually when their enclosing label supplies the touch target.
- Use clear section headings and one primary action. Show saved/unsaved state and review before applying access changes. Cancellation keeps edits unless the user explicitly discards them.
- Reflow columns on small screens; wrap long names/emails. Never shrink the whole desktop UI to fit a phone. Preserve operational features and reachable actions.
- Keep safe-area padding around persistent actions. Make short landscape views and 200% zoom usable through scrolling; avoid double fixed headers consuming all content height.

## Verification

Use `tests/fixtures/access-ui.html` for a synthetic component preview during local development. This fixture is not an entry in the production build. Check desktop (1440x900 or larger), tablet (768x1024), phone (390x844), narrow phone (320x568), and landscape (844x390). Include light and dark themes, long identity text, keyboard navigation, visible focus, and reduced motion.

Measure the viewport workspace and footer; check for unintended document/content horizontal overflow. A deliberately scrolling navigation bar is acceptable. Verify every section remains reachable and the save footer does not cover scrolling fields. Run `npm run lint`, `npm run build`, and the relevant interaction/draft tests after changes.
