# Directional Transitions, Component Staggers, and Shared Elements

Architecture and implementation reference for 60/120fps route transitions, physics curves, block-level mount staggers, and shared element morphs in React, Capacitor, and Android WebViews.

## Curated GitHub OSS Benchmarks

Reference implementations for each motion layer (verify package APIs and versions against current vendor docs before installing packages not already in `package.json`, `C-5`, `R-36`):

| Category | GitHub Reference | Architectural Pattern |
| --- | --- | --- |
| Orchestration & shared layout | `motiondivision/motion` | Spring-physics route transitions, `AnimatePresence mode="popLayout"`, `LazyMotion`, and FLIP `layoutId` morphing |
| Mobile sheet & gesture physics | `emilkowalski/vaul`, `sonner` | Critically damped spring curves, velocity-aware swipe dismissal, and scale-down background stacking |
| Micro-interactions & shimmers | `magicuidesign/magicui`, `ui-layouts` | GPU-composited border beams, staggered block reveals, and masked shimmer sweeps |
| Cross-platform / RN motion | `nandorojo/moti`, `react-native-reanimated` | Declarative worklet-driven animations running off the main JS thread for React Native targets |
| SVG skeleton loaders | `danilowoz/react-content-loader` | Geometry-matched SVG `<clipPath>` + `<linearGradient>` shimmer masks (`translateX`) |
| Vector graphics & state machines | `airbnb/lottie-web`, `rive-app/rive-react` | Lightweight interactive vector animations for empty states, onboarding, and pull-to-refresh |

## Step 1: Enforce the 120fps Compositor Rule

Android WebViews (Capacitor) and mobile GPUs drop frames when animations trigger layout or paint invalidations.

1. **Animate compositor properties only:** Restrict keyframes and transitions to `transform` (`translate3d`, `scale`, `rotate`) and `opacity`. Never animate `top`, `left`, `width`, `height`, `margin`, `padding`, or dynamic `filter: blur()` / `backdrop-filter`.
2. **Respect UI frame budgets (`frontend.md`):** Keep standard UI state transitions strictly under `300ms` (`150ms` to `240ms`), and make high-frequency controls (tabs, dropdowns, search inputs) respond immediately with zero entrance delay.
3. **Prefer spring physics or calibrated deceleration curves:** Use Material 3 / Emil Kowalski spring parameters (`stiffness: 380, damping: 32` to `34, mass: 0.8`) or decelerating curves (`[0.32, 0.72, 0, 1]` and `cubic-bezier(0.22, 1, 0.36, 1)`, exposed as `--ease-out-quint` in `src/index.css`).
4. **Promote layers cleanly:** Apply `will-change: transform, opacity` (`will-change-transform`) only on active transitioning containers, and set `backface-visibility: hidden` on sliding wrappers when font subpixel flickering appears on Android WebViews.
5. **State the UX purpose (`R-19`, `R-31`):** Every transition must serve orientation, feedback, or continuity and align with the declared `antislop` `MOTION` dial. Never stack Fade Up, Float, Scale, and Bounce on every element simultaneously.

## Step 2: Directional Page Transitions (Push / Pop Navigation)

Route switches in mobile and Capacitor apps must reflect navigation direction: forward pushes slide the incoming view from the trailing edge (`+25%` X) while subtly scaling/parallaxing the outgoing view (`-15%` X); pressing the Android hardware back button reverses both directions.

### Reference Pattern (`motion/react` / `LazyMotion`)

In RacePulsePH (`package.json` uses `motion` v12+), import `AnimatePresence` and `m` from `motion/react` under the root `<LazyMotion features={domMax}>` in `src/App.tsx` (or `motion` from `framer-motion` in standalone projects without `LazyMotion`):

```tsx
import { type ReactNode } from 'react';
import { AnimatePresence, m, type Variants } from 'motion/react';

export type NavDirection = 'forward' | 'back';

const pageVariants: Variants = {
  initial: (direction: NavDirection) => ({
    x: direction === 'forward' ? '25%' : '-15%',
    opacity: 0,
    scale: direction === 'forward' ? 0.98 : 0.96,
  }),
  animate: {
    x: '0%',
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 380,
      damping: 34,
      mass: 0.8,
      staggerChildren: 0.05,
    },
  },
  exit: (direction: NavDirection) => ({
    x: direction === 'forward' ? '-15%' : '25%',
    opacity: 0,
    scale: 0.96,
    transition: {
      duration: 0.18,
      ease: [0.32, 0.72, 0, 1],
    },
  }),
};

export function AnimatedRouteOutlet({
  routeKey,
  direction = 'forward',
  children,
}: {
  routeKey: string;
  direction?: NavDirection;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <m.main
          key={routeKey}
          custom={direction}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="h-full w-full will-change-transform [backface-visibility:hidden]"
        >
          {children}
        </m.main>
      </AnimatePresence>
    </div>
  );
}
```

### Driving Direction in Capacitor & RacePulsePH

- **Router-based apps (`react-router-dom`):** Pass `location.pathname` as `routeKey` and toggle `direction` to `'back'` inside `POP` navigation events or `@capacitor/app` `backButton` callbacks.
- **RacePulsePH history + state navigation (`src/App.tsx`, `src/lib/capacitorAndroid.ts`):**
  - Forward calls (`navigateGuest`, workspace sub-tab push) set `direction = 'forward'` before updating state.
  - Browser `popstate` listeners and `subscribeAndroidBackButton` (`@capacitor/app`) set `direction = 'back'` before popping the view or dispatching `racepulse:back`.
  - Keep modal/dialog dismissal in `DialogSurface` (`src/components/ui/DialogSurface.tsx`) on the LIFO `useAndroidBackHandler` stack so hardware back closes dialogs before popping the underlying route.

## Step 3: Staggered Component Mounts & Shared Element Morphs

### Block-Level Staggers (3 to 4 Logical Blocks)

Group screen content into 3 to 4 visual sections (Header, Hero Card, Action Row, List Container) instead of staggering 30+ independent DOM nodes:

```tsx
export const itemFadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
};

export function cappedStaggerDelay(index: number): number {
  return Math.min(index * 0.04, 0.28);
}
```

Cap per-item delays to the first 6 to 8 visible viewport items (`0.28s` max) so items farther down a long race roster or results list remain immediately visible during fast flings.

### Shared Element Transitions (`layoutId` & View Transitions API)

1. **`motion` FLIP (`layoutId`):**
   - Wrap related shared elements inside `<LayoutGroup id="...">` so parallel instances (such as multiple tab bars, as in `src/components/ui/tabs.tsx`) never collide on the same `layoutId`.
   - Use deterministic keys like `layoutId={`card-container-${item.id}`}` on both the source card and detail header.
   - Lock explicit `width`/`height` or Tailwind `aspect-*` utilities on thumbnails and media containers inside morphing wrappers (`R-40`) so asynchronous image decoding never snaps FLIP bounds mid-flight.
2. **Browser View Transitions API:**
   - Guard `document.startViewTransition` behind feature detection and `(prefers-reduced-motion: reduce)` checks.
   - Assign distinct `view-transition-name` values per visible card and keep `::view-transition-old(*)` / `::view-transition-new(*)` durations under `300ms` (`frontend.md`). Verify current WebView support against Android Chromium / vendor docs before relying on cross-document transitions (`R-36`).

## Transition Gotchas

- **`mode="wait"` vs `mode="popLayout"`:** `mode="wait"` keeps the user looking at the outgoing page until exit finishes before mounting the next route. Use `mode="popLayout"` for spatial slide transitions so exit detaches cleanly while entrance begins on the next frame.
- **Portals and `transform` ancestors:** A `position: fixed` modal placed inside an element with an active `transform` or `will-change: transform` clips to the transformed container. Render dialogs and sheets via top-layer `<dialog>` or `createPortal(..., document.body)` as done in `src/components/ui/DialogSurface.tsx`.
- **Static `backdrop-filter`:** Never animate blur values on Android WebViews. Keep `backdrop-filter` static on at most 1 to 2 focal surfaces (`R-10`), and drop it if scrolling underneath lags on target hardware.

