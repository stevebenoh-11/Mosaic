import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mosaic.app',
  appName: 'Mosaic',
  webDir: 'dist',
  android: {
    // Allow IndexedDB / blobs to persist normally in the WebView.
    allowMixedContent: false,
  },
};

export default config;
