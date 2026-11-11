import type { CapacitorConfig } from '@capacitor/cli';

const devServerUrl =
  process.env.NODE_ENV === 'development' ? process.env.CAPACITOR_DEV_SERVER_URL?.trim() : undefined;

const config: CapacitorConfig = {
  appId: 'com.racepulseph.app',
  appName: 'RacePulsePH',
  webDir: 'dist',
  ...(devServerUrl
    ? {
        server: {
          url: devServerUrl,
          cleartext: devServerUrl.startsWith('http://'),
        },
      }
    : {}),
  android: {
    // Keeps the app's Firebase traffic on HTTPS while the UI is bundled locally.
    allowMixedContent: false,
    buildOptions: {
      keystorePath: process.env.KEYSTORE_PATH,
      keystorePassword: process.env.KEYSTORE_PASSWORD,
      keystoreAlias: process.env.KEYSTORE_ALIAS,
      keystoreAliasPassword: process.env.KEYSTORE_ALIAS_PASSWORD,
      releaseType: 'AAB',
      signingType: 'apksigner',
    },
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
