# Edge-to-Edge WindowInsets (Android 15/16+ Compose, XML, and WebView)

Targeting Android SDK 35+ (Android 15 and 16) enables edge-to-edge drawing automatically and turns `setStatusBarColor` and `setNavigationBarColor` into no-ops. Never wrap the entire screen in a global inset padding modifier; route insets by component role instead.

Verify Kotlin/Jetpack Compose and AndroidX helper signatures against current Android Developers documentation (`C-5`, `R-36`). Reference walkthrough cited in user brief: Android Developers edge-to-edge Compose + XML patterns.

## Role-Based Inset Routing

- **Full-Bleed Backgrounds:** Render surfaces, maps, and wallpapers edge-to-edge with zero inset padding so they extend cleanly behind translucent system bars.
- **Interactive Controls & App Bars:** Keep headers, buttons, and FABs clear of status bars, navigation bars, and display cutouts (`WindowInsets.safeDrawing`).
- **Scrolling Containers:** Allow lists to scroll behind translucent navigation/gesture bars while padding internal content so the final list item clears the gesture pill safely.

## 1. Jetpack Compose Implementation Pattern

Call `enableEdgeToEdge()` in `ComponentActivity.onCreate()`, configure `android:windowSoftInputMode="adjustResize"` in `AndroidManifest.xml`, and structure screens using `Scaffold`:

```kotlin
@Composable
fun ProductionScreen(
    items: ImmutableList<ItemUiModel>,
    onActionClick: () -> Unit
) {
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = { Text("Dashboard") },
                windowInsets = WindowInsets.statusBars.union(WindowInsets.displayCutout)
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onActionClick) {
                Icon(Icons.Default.Add, contentDescription = "Add")
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .consumeWindowInsets(innerPadding)
                .imePadding(),
            contentPadding = innerPadding
        ) {
            items(
                items = items,
                key = { it.id },
                contentType = { it.type }
            ) { item ->
                ItemRow(item)
            }
        }
    }
}
```

## 2. XML Views (`ConstraintLayout` + `RecyclerView`) Pattern

Avoid relying on bare `android:fitsSystemWindows="true"` on complex View roots. Capture initial XML padding once and update padding inside `ViewCompat.setOnApplyWindowInsetsListener`:

```kotlin
val initialPadding = Rect(
    recyclerView.paddingLeft,
    recyclerView.paddingTop,
    recyclerView.paddingRight,
    recyclerView.paddingBottom
)
recyclerView.clipToPadding = false

ViewCompat.setOnApplyWindowInsetsListener(recyclerView) { view, windowInsets ->
    val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    view.updatePadding(
        left = initialPadding.left + bars.left,
        right = initialPadding.right + bars.right,
        bottom = initialPadding.bottom + bars.bottom
    )
    windowInsets
}
```

## 3. Capacitor / WebView Edge-to-Edge Pattern

Ensure `viewport-fit=cover` is present on the viewport meta tag in `index.html`, then pad headers and scrollable content per element rather than padding `<body>` globally:

```css
.app-header {
  padding-top: max(12px, env(safe-area-inset-top));
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}

.scroll-list {
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
}
```

## Edge-to-Edge Gotchas & RacePulsePH Context

- **Double-Applying Scaffold Insets:** Passing `Modifier.padding(innerPadding)` to a child that also sets `.systemBarsPadding()` creates large empty gaps at the top and bottom. Always call `.consumeWindowInsets(innerPadding)` or apply `innerPadding` once via `contentPadding`.
- **Android 15/16 `statusBarColor` Trap:** `window.statusBarColor` and XML `android:statusBarColor` are ignored on API 35+. Draw a background `Box` or `TopAppBar` under the status bar area and switch light/dark system icon contrast with `WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars`.
- **RacePulsePH Shell Check:** `android/variables.gradle` sets `targetSdkVersion = 36` and `android/app/src/main/res/layout/activity_main.xml` wraps a single `WebView` in `CoordinatorLayout`. In `index.html`, confirm `viewport-fit=cover` is added alongside `env(safe-area-inset-*)` styles in `src/access-ui.css`, `src/components/BottomNav.tsx`, and `src/components/RunningLoader.css` before enabling translucent system bar overlays.
