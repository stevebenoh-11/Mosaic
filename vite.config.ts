import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import path from 'node:path';

// NOTE: web builds use the default absolute base ('/'). A relative base breaks
// SPA deep links (/b/<id> resolves assets to /b/assets/* → blank page). The
// Electron build needs relative paths for file:// and passes --base=./ on the
// CLI instead (see electron:* scripts).
//
// `--mode native` (Capacitor APK) ships a SELF-DESTROYING service worker: the
// assets are already bundled in the app, so a precaching SW adds no value and
// only risks serving a STALE cached bundle inside the WebView after an app
// update. The self-destroying SW also unregisters any precaching SW a previous
// install left behind and clears its caches, so updates always load fresh.
export default defineConfig(({ mode }) => {
  const native = mode === 'native';

  const pwaOptions: Partial<VitePWAOptions> = native
    ? { selfDestroying: true, registerType: 'autoUpdate' }
    : {
        registerType: 'autoUpdate',
        devOptions: { enabled: true },
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Mosaic — visual thinking workspace',
          short_name: 'Mosaic',
          description:
            'A local-first visual workspace: boards, notes, images and ideas — synced through your own Google Drive.',
          theme_color: '#F5F4F0',
          background_color: '#F5F4F0',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: '/index.html',
        },
      };

  return {
    plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
