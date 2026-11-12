# Shimmer Skeletons, Vector Motion, and Accessibility Safeguards

Implementation guide for geometry-accurate loading skeletons, vector state machines, and low-end Android / reduced-motion guardrails.

## Step 4: Content-Aware Shimmer Skeletons & Vector Graphics

Every data-driven screen requires Loading, Empty, and Error states (`R-27`). Pair non-blocking route transitions with skeletons that mirror real component geometry, then crossfade cleanly into loaded data.

### 1. GPU-Composited Shimmer Skeleton (CSS + Tailwind)

Animate a pseudo-layer with `transform: translateX(...)` rather than shifting `background-position`, so the sweep runs on the GPU compositor without per-frame repainting:

```tsx
export function CardSkeletonLoader() {
  return (
    <div
      role="status"
      aria-label="Loading content"
      className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4"
    >
      <div
        aria-hidden="true"
        className="rp-shimmer-sweep pointer-events-none absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-black/5 dark:via-white/10 to-transparent motion-reduce:animate-none"
      />
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-[var(--surface-inset)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded-md bg-[var(--surface-inset)]" />
          <div className="h-3 w-1/3 rounded-md bg-[var(--surface-inset)]" />
        </div>
      </div>
      <div className="mt-4 h-24 w-full rounded-xl bg-[var(--surface-inset)]" />
    </div>
  );
}
```

Define the keyframe once in `src/index.css` (plus reduced-motion override for custom CSS classes):

```css
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rp-shimmer-sweep {
    animation: none;
  }
}
```

Match skeleton container dimensions (`min-h-*`, `aspect-*`, spacing multiples of `4px`/`8px`) to the hydrated card so resolving data produces zero cumulative layout shift (`R-40`).

### 2. Geometry-Accurate SVG Masks (`danilowoz/react-content-loader`)

For irregular data layouts (avatar stacks, split-time tables, charts), match exact SVG `<rect>` and `<circle>` coordinates inside a `<clipPath>` mask with a translating `<linearGradient>`:

- Verify current `react-content-loader` props (`speed`, `viewBox`, `uniqueKey`) against vendor docs before installing (`R-36`).
- Always supply a deterministic `uniqueKey` in SSR/hydration or concurrent React lists so `<clipPath>` IDs never collide across rows.
- Pause or omit shimmer gradients when `prefers-reduced-motion: reduce` is active.

### 3. Vector State Machines (`lottie-web` & `rive-react`) and Sprite Loaders

Use interactive vectors only when they serve an authentic product state (empty states, pull-to-refresh, startup timing gate) and only after confirming new visual assets with the user (`R-23`).

- **Confirm before generating assets (`R-23`):** Never ship unconfirmed placeholder illustrations, Lottie files, or Rive state machines disguised as final artwork.
- **Keep initial WebView bundles lean:** Neither `lottie-web` nor `@rive-app/react-canvas` is installed in RacePulsePH (`package.json`). If adding either library, dynamic-import its wrapper with `React.lazy()` and `Suspense` so public landing visitors and first paint stay light (`racepulse-delivery-performance`; verify current bundle size and Canvas/WebGL renderer guidance against vendor docs, `R-36`).
- **Prefer lightweight native/compositor assets when sufficient:** RacePulsePH's `src/components/RunningLoader.tsx` (`src/assets/RUNNER-MOTION.md`) renders a pre-baked `74,006`-byte 8x4 sprite atlas (`src/assets/runner-sprite.webp`) driven by Web Animations `steps(1, end)` `transform: translate(...)` and a single `requestAnimationFrame` visible-time clock, avoiding external runtime decoders.
- **Bound long-running loops (`R-39`):** Pause vector or sprite loops automatically on `document.hidden` (`visibilitychange`), provide a pause control or settle to a static frame when any non-status animation exceeds 5 seconds, and offer a recovery action if network loading stalls (as `RunningLoader.tsx` does after 10 seconds or on error).

## Step 5: Accessibility & Low-End Android Safeguards

1. **Root `<MotionConfig reducedMotion="user">`:** Wrap the top-level React tree (`src/App.tsx` line 426) in `<MotionConfig reducedMotion="user">` so `m.*` spatial animations (`x`, `y`, `scale`, `rotate`) automatically simplify to opacity/instant updates when Android "Remove animations" or OS reduced-motion is turned on.
2. **CSS `@media (prefers-reduced-motion: reduce)`:** Disable CSS keyframes (`@keyframes shimmer`, `panelEnter`, `errorNudge`) and non-essential transitions inside `@media (prefers-reduced-motion: reduce)` (`src/index.css`, `src/components/RunningLoader.css`, `src/access-ui.css`), plus Tailwind `motion-safe:` / `motion-reduce:` modifiers on tactile press scales.
3. **Cap stagger count:** Limit staggered item delays to the first 6 to 8 viewport items (`Math.min(index * 0.04, 0.28)`). Never stagger rows 9+ at zero opacity, because fast Android scroll flings leave newly scrolled items invisible.
4. **Prevent touch & scroll contention:** Disable accidental highlight flashes (`-webkit-tap-highlight-color: transparent`) and browser pull-to-refresh bounce (`overscroll-behavior-y: none`) cleanly alongside `capacitor-android-architect` ergonomics without blocking vertical scroll momentum.

## Motion Verification Checklist

Audit every animated route, modal, skeleton, and vector component before delivery (`R-35`):

- **Compositor-Only Audit:** Confirm all keyframes and `motion` variants animate only `transform` (`x`, `y`, `scale`, `rotate`) and `opacity`, with static `backdrop-filter` (`R-10`).
- **Frame Budget Audit:** Confirm non-looping UI transitions complete under `300ms` (`frontend.md`) and high-frequency tabs/inputs respond immediately.
- **Push/Pop Direction Audit:** Navigate forward and trigger Android hardware back (`subscribeAndroidBackButton` / browser Back) to verify reversed transition direction and clean modal dismissal (`DialogSurface`).
- **Skeleton & CLS Audit:** Throttle network or toggle loading state to verify geometry-matched skeleton bounds (`R-27`), fixed image `aspect-ratio` (`R-40`), and zero layout jump on hydration.
- **Reduced Motion Audit:** Toggle OS "Reduce motion" / Android "Remove animations" and verify spatial slides, staggers, and shimmers stop cleanly (`R-39`) while all functional states remain accessible.
- **Purpose Log (`R-31`, `R-19`):** Record a 1-line functional reason for every animated component in the `AGENTS.md` Delivery Gate report.
