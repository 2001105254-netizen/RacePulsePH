# Adaptive Form Factors, 120fps Rendering, and Stability (Steps 2 to 4)

Patterns for choosing minimal layout primitives, adapting across phones/foldables/tablets, eliminating frame drops and crashes, and auditing font-scale resilience. Verify AndroidX Material 3 Adaptive (`currentWindowAdaptiveInfo`, `ListDetailPaneScaffold`) package artifacts against current Android Developers docs (`C-5`, `R-36`).

## Step 2: Select the Optimal Layout Primitive

Choose the lightest primitive that expresses the spatial rules to avoid multi-pass measurement overhead:

| Layout Goal | Jetpack Compose Primitive | XML View Primitive | Performance Rule |
| --- | --- | --- | --- |
| Simple vertical or horizontal stack | `Column` / `Row` | `LinearLayout` (avoid nested weights) | Prefer `Arrangement.spacedBy(8.dp)` over extra `Spacer` nodes. |
| Overlapping badges or scrims | `Box` | `FrameLayout` | Keep child count small; position via `Alignment`. |
| 2D relative anchors, barriers, chains, aspect ratios | `ConstraintLayout` (`constraintlayout-compose`) | `ConstraintLayout` | Flatten 4+ nested containers into one 1-level solver pass. |
| Responsive wrapping chips or tags | `FlowRow` / `FlowColumn` | `FlexboxLayout` / `ChipGroup` | Set `maxItemsInEachRow` when grid alignment must stay uniform. |
| Large or virtualized lists and grids | `LazyColumn` / `LazyVerticalStaggeredGrid` | `RecyclerView` with `ListAdapter` | Always define stable `key` and `contentType`. |

## Step 3: Build Adaptive Layouts for All Form Factors

Avoid hardcoded pixel widths and portrait-only assumptions. Drive layout transitions from `currentWindowAdaptiveInfo()` and `WindowWidthSizeClass`:

- **Compact (`< 600dp`, Portrait Phones):** Single-pane flow, bottom `NavigationBar`, full-width cards.
- **Medium (`600dp` to `840dp`, Foldables / Small Tablets):** Two-column `LazyVerticalGrid` or list-detail split with side `NavigationRail`.
- **Expanded (`> 840dp`, Tablets / Desktop Mode):** Canonical `ListDetailPaneScaffold` or `SupportingPaneScaffold` paired with a persistent navigation drawer and bounded readable line widths (`Modifier.widthIn(max = 840.dp)`).

## Step 4: Guarantee Smooth Rendering & Zero Layout Thrashing

### 1. Defer State Reads to Layout and Draw Phases

Avoid reading rapidly mutating scroll or animation values inside composition:

- **Avoid:** `Modifier.offset(y = scrollOffset.dp)` (forces recomposition on every scroll frame).
- **Prefer:** `Modifier.offset { IntOffset(x = 0, y = scrollOffsetProvider()) }` or `Modifier.graphicsLayer { translationY = scrollOffsetProvider() }` (runs strictly in layout/draw phases, skipping recomposition).

### 2. Prevent Nested Scroll Crashes

Never nest an unbounded `LazyColumn` inside a `Column` with `Modifier.verticalScroll(...)`; that throws `java.lang.IllegalStateException: Vertically scrollable component was measured with an infinity maximum height constraint`. Instead, flatten outer headers and footers into `item { Header() }` blocks inside a single `LazyColumn`.

### 3. Avoid `IntrinsicSize` Inside Lazy Lists

`IntrinsicSize.Min` and `IntrinsicSize.Max` force double measurement passes on children. Inside scrolling lists or complex rows, align dynamic sibling heights with explicit size bounds or `ConstraintLayout` barriers instead.

### 4. Accessibility & 200% Font Scaling Resilience

- Size typography in `sp` and structural spacing/bounds in `dp`.
- Never trap text containers in rigid fixed heights (`Modifier.height(48.dp)`); use `Modifier.heightIn(min = 48.dp)` so 200% system font scaling expands containers cleanly without vertical clipping.
- Keep native interactive controls at least `48.dp x 48.dp` (paired with `>= 44x44px` web tap targets via `antislop-layoutmobile` for RacePulsePH Capacitor WebView screens).

## Verification Checklist

Audit every native or hybrid Android layout change against these five gates before delivery (`R-35`):

- **Insets Check:** Full-bleed backgrounds extend behind status and navigation bars while interactive controls stay inside `safeDrawing` bounds in both portrait and landscape.
- **Keyboard (IME) Check:** Focusing a bottom input field slides the control cleanly above the software keyboard via `.imePadding()` and `adjustResize`.
- **List Stability Check:** Every `LazyColumn` / `LazyGrid` `items(...)` call specifies unique `key` and `contentType` lambdas (or `DiffUtil` / `ListAdapter` in XML `RecyclerView`).
- **Touch Target & Scaling Check:** All native buttons/icons meet `>= 48.dp x 48.dp` and text containers grow cleanly via `heightIn(min = 48.dp)` under 200% font scale without clipping.
- **Hierarchy Depth Check:** Multi-axis alignments are flattened with `ConstraintLayout` chains/barriers rather than 4+ nested `Row`/`Column` or weighted `LinearLayout` layers.
