import path from 'node:path';
import tailwind from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
    }),
    react(),
    tailwind(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a waiting SW stays waiting until the user
      // clicks "Refresh" in the toast (ServiceWorkerUpdateToast → updateSW(true)).
      // 'autoUpdate' would skipWaiting on its own and race that toast UX.
      registerType: 'prompt',
      injectRegister: 'auto',
      manifestFilename: 'manifest.webmanifest',
      manifest: false,
      includeAssets: ['offline.html', 'icons/*.png', 'icons/source.svg', 'paper-grain.svg'],
      workbox: {
        // Serve the SPA shell for every navigation. Workbox's `navigateFallback`
        // handler is unconditional — it always returns the precached entry of
        // the URL passed in — so pointing it at `/offline.html` would strand the
        // user on the offline page on every refresh, even when online. The SPA
        // itself surfaces offline state when API calls fail; `/offline.html`
        // remains precached via `includeAssets` as a static asset.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
              sameOrigin && url.pathname.endsWith('.html'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'html' },
          },
          {
            urlPattern: ({ url }) =>
              url.host.endsWith('supabase.co') && url.pathname.startsWith('/storage/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'recipe-images',
              // Signed URLs rotate hourly (storage.ts re-mints after 55 min)
              // and the token is part of the cache key, so entries are dead
              // weight beyond the hour. Short retention also bounds how long
              // a private photo outlives its signed URL on a shared device.
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.host.endsWith('supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 4,
              // No backgroundSync here: Workbox runtime routes only queue GETs
              // (it never replayed mutations), and the queue persisted whole
              // requests — Authorization headers included — in IndexedDB for
              // up to a day. clearUserScopedCaches still drops any legacy
              // queue DB left by older service workers.
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.host.endsWith('supabase.co') && url.pathname.startsWith('/functions/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) =>
              url.host.endsWith('fonts.googleapis.com') ||
              url.host.endsWith('fonts.gstatic.com') ||
              url.host.endsWith('api.fontshare.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  // 'hidden' emits .map files (so the deploy step can upload them to Sentry)
  // but omits the //# sourceMappingURL comment, so the maps are never
  // referenced from — or served to — the browser. The deploy workflow strips
  // the .map files from the Vercel artifact after uploading them to Sentry.
  build: { sourcemap: 'hidden' },
});
