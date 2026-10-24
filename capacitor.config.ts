import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.racepulseph.app',
  appName: 'RacePulsePH',
  webDir: 'dist',
  android: {
    // Keeps the app's Firebase traffic on HTTPS while the UI is bundled locally.
    allowMixedContent: false,
  },
};

export default config;
