# Android Native Ergonomics, Build Hardening, and Gotchas (Steps 5 to 6)

Reference guide for native Android UX polish, WebView performance, Gradle release hardening, and RacePulsePH shell verification.

## Step 5: Handle Android Native Ergonomics

Make the WebView behave cleanly alongside Android hardware buttons, gesture bars, and touch interactions:

### 1. Hardware Back Button (`@capacitor/app`)

Install `@capacitor/app` and register a listener so hardware back presses navigate browser history cleanly before exiting the app (or close open dialogs/overlays first in single-page apps):

```ts
import { App } from '@capacitor/app';

App.addListener('backButton', ({ canGoBack }) => {
  if (canGoBack) {
    window.history.back();
  } else {
    App.exitApp();
  }
});
```

When using client-side state navigation rather than URL routes (as in parts of RacePulsePH), intercept open modals or tabs before falling back to `canGoBack` / `App.exitApp()`.

### 2. Safe Area Insets and Edge-to-Edge Display

If enabling edge-to-edge display (`StatusBar.overlaysWebView: true` or Android API 35+ edge-to-edge enforcement), include `viewport-fit=cover` in the viewport `<meta>` tag in `index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Pad fixed headers, bottom docks, modals, and toasts with CSS `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, and `env(safe-area-inset-right)`.

*RacePulsePH note:* `src/access-ui.css`, `src/components/BottomNav.tsx`, and `src/components/RunningLoader.css` already consume `env(safe-area-inset-*)`; `index.html` currently uses `width=device-width, initial-scale=1.0` without `viewport-fit=cover`, so add `viewport-fit=cover` before enabling translucent/overlay status bars.

### 3. Disable Browser Touch Artifacts Safely

Apply global WebView ergonomics while keeping form controls selectable and accessible (`R-25`, `R-26`):

```css
* {
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

input,
textarea,
[contenteditable='true'] {
  user-select: text;
}

html,
body {
  overscroll-behavior-y: none;
}
```

## Step 6: Optimize Android Performance and Gradle Build

Apply runtime and build-time hardening inside `src/` and `android/`:

1. **Hardware Acceleration:** Verify `android:hardwareAccelerated="true"` is declared on the `<application>` tag inside `android/app/src/main/AndroidManifest.xml` (do not assume implicit defaults when customizing activities or WebViews).
2. **Lazy Load Plugins and Heavy Routes:** Use dynamic `import()` for secondary screens, scanner/camera views (`html5-qrcode`), and export generators (`jspdf`, `xlsx`) plus `rollupOptions.output.manualChunks` in `vite.config.ts` so the initial WebView script graph stays small.
3. **Enable R8 / ProGuard and Resource Shrinking:** Configure `buildTypes.release` inside `android/app/build.gradle`:

```groovy
buildTypes {
    release {
        minifyEnabled true
        shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

*RacePulsePH note:* `android/app/build.gradle` currently sets `minifyEnabled false` with `proguard-android.txt`. When enabling `minifyEnabled true` and `shrinkResources true` for a Google Play release, audit reflection rules for Capacitor plugins and test the generated release `.aab` on a physical device or emulator before distribution.

### Build and Verification Commands

- Sync web assets into Android: `npm run build && npx cap sync android` (`npm run android:sync`)
- Debug on a connected device with live reload: `npx cap run android -l --external`
- Assemble release App Bundle (macOS/Linux): `cd android && ./gradlew bundleRelease`
- Assemble release App Bundle (Windows): `cd android && .\gradlew.bat bundleRelease`

## Gotchas

- **Never commit live-reload `server.url` in `capacitor.config.ts`:** A committed LAN IP causes installed production APKs/AABs to show a blank white screen offline. Guard dev server config strictly behind `process.env.NODE_ENV === 'development'`.
- **Avoid Base64 for large media:** Returning high-resolution photos or video as Base64 strings across the Capacitor bridge exhausts WebView memory and freezes the Android UI thread. Always choose `CameraResultType.Uri` and resolve paths with `Capacitor.convertFileSrc(uri)`.
- **Always run `npx cap sync android` after plugin changes:** Installing a plugin via `npm` alone leaves Gradle unaware of its native Kotlin/Java implementation, throwing `PluginNotImplemented` at runtime.
- **Keep signing secrets out of Git:** Pass `KEYSTORE_PATH` and `KEYSTORE_ALIAS` (plus passwords) via environment variables or untracked CI secrets, never committed into `capacitor.config.ts` or `android/app/build.gradle`.

