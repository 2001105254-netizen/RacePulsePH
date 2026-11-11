# Migration Workflow and Plugin Mapping (Steps 1 to 4)

Reference specification for evaluating React Native or React projects, configuring Vite + Capacitor, and replacing native dependencies. Verify plugin API signatures and version compatibility against current Capacitor vendor documentation before modifying native configs (`C-5`, `R-36`).

## Architectural Decision Matrix

Clarify intent before editing source files:

1. **Direct React Native Android Release:** React Native already renders native `android.view.*` views. If the goal is simply producing an APK or AAB from an existing React Native repo, Capacitor adds unnecessary WebView indirection; use `npx expo run:android` or `cd android && ./gradlew bundleRelease` directly.
2. **Path A: React Native Web Adapter (Fastest Migration):** Keep existing `<View>`, `<Text>`, and `StyleSheet` components by aliasing `react-native` to `react-native-web` in Vite, then wrap `dist/` with Capacitor Android.
3. **Path B: Pure Web / UI Refactor (Best Long-Term Efficiency):** Replace React Native primitives with semantic HTML/CSS (Tailwind CSS or `@ionic/react`), remove `react-native-web` adapter overhead, and migrate UI views following `antislop`, `.impeccable.md`, and `racepulse-responsive-ui` (`R-37`).

## Step 1: Audit the Existing Codebase

Inspect `package.json` and group every `react-native-*`, `@react-native-*`, and native SDK dependency:

- **UI and Layout:** `react-native-safe-area-context`, `react-native-gesture-handler`, `@react-navigation/*`.
- **Device APIs:** Camera, Geolocation, AsyncStorage, Biometrics, Push Notifications, FileSystem, Share.
- **Unconvertible Native SDKs:** Custom C++ or JSI TurboModules without web/Capacitor equivalents require writing a custom Kotlin Capacitor plugin under `android/app/src/main/java/`.

*RacePulsePH baseline:* `package.json` (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`) already runs React 19 + Vite 6 + Tailwind v4 without React Native primitives, placing this repository on Path B natively.

## Step 2: Configure the Web Bundler (Vite)

Capacitor loads compiled web assets (`index.html`, JS, CSS) from `webDir` (`dist`).

### Path A (`react-native-web`) Configuration

Install `vite`, `@vitejs/plugin-react`, `react-dom`, and `react-native-web`, then configure `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
    extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js'],
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: 'esbuild',
  },
});
```

### Verification Check

Run `npm run build` and confirm `dist/index.html` and compiled bundle assets exist with exit code `0`.

*RacePulsePH note:* `vite.config.ts` already configures `@tailwindcss/vite`, `@vitejs/plugin-react`, `@` path aliasing, and `rollupOptions.output.manualChunks` for `vendor-firebase`, `vendor-xlsx`, `vendor-pdf`, `vendor-canvas`, `vendor-qr`, `vendor-ui`, and `vendor-react`.

## Step 3: Initialize Capacitor and Android Target

For greenfield projects, install Capacitor packages and scaffold the Android platform:

```bash
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap init
npx cap add android
```

Define a typed `capacitor.config.ts` at the repository root (illustrative plugin options below; verify defaults and plugin keys against current Capacitor vendor docs per `R-36`):

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.company.appname',
  appName: 'AppName',
  webDir: 'dist',
  android: {
    buildOptions: {
      keystorePath: process.env.KEYSTORE_PATH,
      keystoreAlias: process.env.KEYSTORE_ALIAS,
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500, // Illustrative value; tune to real WebView ready signal and verify against current @capacitor/splash-screen docs.
      launchAutoHide: true,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
};

export default config;
```

*RacePulsePH baseline:* `capacitor.config.ts` configures `appId: 'com.racepulseph.app'`, `appName: 'RacePulsePH'`, `webDir: 'dist'`, and `android.allowMixedContent: false` to keep Firebase traffic strictly HTTPS. Never relax `allowMixedContent` without an explicit ADR.

## Step 4: Replace React Native Modules with Capacitor Plugins

Swap React Native native libraries using this direct mapping (verify permissions and Android API behavior against current `@capacitor/*` vendor docs, `R-36`):

| React Native Package | Capacitor Equivalent | Key Implementation Note |
| --- | --- | --- |
| `@react-native-async-storage/async-storage` | `@capacitor/preferences` | Batch JSON payloads into single bridge calls to minimize IPC overhead. |
| `react-native-vision-camera` / `react-native-image-picker` | `@capacitor/camera` | Always use `CameraResultType.Uri` instead of Base64 to prevent Android `OutOfMemoryError` crashes. |
| `react-native-fs` | `@capacitor/filesystem` | Configure scoped storage paths and Android 13+ (API 33+, verify current docs) media permissions carefully. |
| `@react-native-community/geolocation` | `@capacitor/geolocation` | Check and request runtime location permissions before calling `getCurrentPosition()`. |
| `@react-native-firebase/messaging` | `@capacitor/push-notifications` | Place `google-services.json` inside `android/app/` (already checked dynamically by `android/app/build.gradle`). |
| `react-native-share` | `@capacitor/share` | Check `Share.canShare()` before invoking native Android share sheets. |
| `react-native-haptic-feedback` | `@capacitor/haptics` | Direct drop-in for impact and notification vibrations. |

After installing, upgrading, or removing any Capacitor plugin, always run:

```bash
npx cap sync android
```

This updates `android/app/capacitor.build.gradle` and `android/capacitor.settings.gradle` so Gradle registers every Kotlin/Java bridge class.

