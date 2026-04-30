# 11 — PWA and Offline

## Purpose

Make Dishton installable, useful in the kitchen without flaky Wi-Fi, and
resilient to brief outages of the SPA host. This doc covers the manifest, the
Vite PWA plugin configuration, the per-resource caching strategies, the
background-sync queue for edits, the screen Wake Lock used in cooking mode,
the install-prompt UX, and the offline fallback.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decision: web-only, mobile-first
  PWA.
- [01-architecture.md](./01-architecture.md) — Vercel hosting, Supabase API.
- [02-tech-stack.md](./02-tech-stack.md) — `vite-plugin-pwa@^0.20`.
- [09-recipe-views.md](./09-recipe-views.md) — cooking mode integration.

## Manifest

```json
{
  "name": "Dishton",
  "short_name": "Dishton",
  "description": "Your household's recipe pantry.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5efe3",
  "theme_color": "#2a1a2c",
  "lang": "en",
  "scope": "/",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-monochrome.png", "sizes": "512x512",
      "type": "image/png", "purpose": "monochrome" }
  ],
  "categories": ["food", "lifestyle", "productivity"]
}
```

Lives at `/home/user/dishton/public/manifest.webmanifest`. Linked from
`index.html` via `<link rel="manifest" href="/manifest.webmanifest">`.

Icons are produced from a single `src` SVG via the
`@vite-pwa/assets-generator` step in CI (see
[13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md)). Source SVG
lives at `public/icons/source.svg`. The mark is the dish-with-spoon glyph
rendered in `--color-aubergine` over `--color-paper`.

## Vite PWA plugin

`vite.config.ts` excerpt:

```ts
import { VitePWA } from 'vite-plugin-pwa';

VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  manifestFilename: 'manifest.webmanifest',
  manifest: false, // we ship our own static file
  workbox: {
    navigateFallback: '/offline.html',
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: ({ url }) =>
          url.origin === self.location.origin && url.pathname.endsWith('.html'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'html' },
      },
      {
        urlPattern: ({ url }) =>
          url.host.endsWith('supabase.co') && url.pathname.startsWith('/storage/'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'recipe-images',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
          backgroundSync: {
            name: 'supabase-rest-sync',
            options: { maxRetentionTime: 24 * 60 },
          },
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
        },
      },
      {
        urlPattern: ({ url }) =>
          url.host.endsWith('supabase.co') && url.pathname.startsWith('/functions/'),
        handler: 'NetworkOnly', // imports require network; do not cache
      },
      {
        urlPattern: ({ url }) =>
          url.host.endsWith('fonts.googleapis.com') ||
          url.host.endsWith('fonts.gstatic.com') ||
          url.host.endsWith('api.fontshare.com'),
        handler: 'CacheFirst',
        options: { cacheName: 'fonts',
          expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
      },
    ],
  },
})
```

Per-resource cache strategy summary:

| Resource | Strategy | Notes |
|---|---|---|
| App shell (HTML) | StaleWhileRevalidate | Instant load, refresh in background. |
| JS / CSS / fonts | CacheFirst (precache + Workbox) | Hashed by Vite build. |
| Recipe images (Supabase Storage) | CacheFirst, 30 days, 200 entries | Cookbook-style browse offline works. |
| Supabase REST GET (SELECT) | NetworkFirst + 4 s timeout | Falls back to last-good. |
| Supabase REST POST/PATCH/DELETE | NetworkFirst with BackgroundSync queue | Edits queue up to 24h. |
| Edge Functions (`/functions/*`) | NetworkOnly | AI calls cannot be cached. |

## Background-sync queue for edits

When a user edits a recipe offline, the SPA fires the regular Supabase
mutation. The plugin's `backgroundSync` interceptor queues the request. When
online again, Workbox replays in order. The SPA shows a toast:

- Online → "Saved."
- Offline → "Saved offline. We'll sync when you're back."
- Sync replay success → "Pending changes synced."
- Replay failure (e.g. RLS denied because someone else changed it) → modal:
  "We couldn't sync your edit. Please review."

Imports do **not** queue; they require a live Edge Function call (the
"NetworkOnly" rule above). The Import button is disabled when offline.

## Offline fallback

`/offline.html` is a hand-written, design-system-styled static page that
appears when navigation fails entirely (e.g. cache miss + offline). It says:

> You're offline.
>
> The recipes you've already opened are still here — head back and pick one
> up. New imports will be available again when you reconnect.

Plus a "Try again" button that reloads.

## Wake Lock

Used by Cooking mode (see [09-recipe-views.md](./09-recipe-views.md)).

```ts
// src/lib/wake-lock.ts
let sentinel: WakeLockSentinel | null = null;

export async function acquireWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    document.addEventListener('visibilitychange', reacquire);
    return true;
  } catch { return false; }
}

export function releaseWakeLock() {
  document.removeEventListener('visibilitychange', reacquire);
  sentinel?.release(); sentinel = null;
}

async function reacquire() {
  if (document.visibilityState === 'visible' && !sentinel) {
    try { sentinel = await navigator.wakeLock.request('screen'); } catch {}
  }
}
```

Cooking mode calls `acquireWakeLock` on enter, `releaseWakeLock` on exit and
when the user exits the recipe page (router unmount). Browsers without Wake
Lock (Safari < 16.4) silently fall through.

## Install prompt UX

- Listen for `beforeinstallprompt`; stash the event in a Zustand slot.
- A small "Add to Home Screen" chip appears in the profile menu after the
  user has visited at least 3 recipes (heuristic for "engaged user"). Click
  fires the stashed event's `prompt()` and clears the slot regardless of
  outcome.
- iOS doesn't fire that event; we render a one-time tooltip on the first
  recipe view: "Tap Share, then Add to Home Screen." Dismissed forever via
  `localStorage`.

## Service-worker update flow

`registerType: 'autoUpdate'` triggers an in-place update on every navigation
when a new service worker is detected. The SPA additionally subscribes via
`useRegisterSW({ onNeedRefresh })` and shows a low-key toast: "A new version
is ready. Refresh to update." Click → `updateSW(true)`.

## Files this doc governs

- `/home/user/dishton/public/manifest.webmanifest`
- `/home/user/dishton/public/icons/*`
- `/home/user/dishton/public/offline.html`
- `/home/user/dishton/vite.config.ts` (PWA section)
- `/home/user/dishton/src/lib/wake-lock.ts`
- `/home/user/dishton/src/lib/sw-update-toast.tsx`
- `/home/user/dishton/src/lib/install-prompt.ts`

## Acceptance criteria

- [ ] Lighthouse PWA audit reports installable + offline-ready (run as part
      of CI on the production build).
- [ ] Recipe images previously viewed render offline.
- [ ] An edit while offline appears in the next online session as a synced
      row in `app.recipes` with `updated_at` close to the actual edit time.
- [ ] Imports are disabled offline; the button has a tooltip explaining why.
- [ ] Cooking mode acquires Wake Lock on supported browsers and releases it
      on exit, on `visibilitychange` to hidden, and on route change.
- [ ] The "Add to Home Screen" chip appears only after the user has opened
      ≥ 3 recipes.
- [ ] An updated SW shows a refresh toast within 30 s of deploy.
- [ ] No emojis anywhere in this doc or governed code.

## Verification

```bash
test -f docs/11-pwa-and-offline.md
grep -q "## Purpose"                docs/11-pwa-and-offline.md
grep -q "## Files this doc governs" docs/11-pwa-and-offline.md
grep -q "## Acceptance criteria"    docs/11-pwa-and-offline.md
grep -q "## Verification"           docs/11-pwa-and-offline.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/11-pwa-and-offline.md
for s in manifest.webmanifest VitePWA "navigator.wakeLock" backgroundSync \
         offline.html beforeinstallprompt StaleWhileRevalidate CacheFirst \
         NetworkFirst NetworkOnly; do
  grep -q "$s" docs/11-pwa-and-offline.md || echo "missing: $s"
done
```

After implementation:

```bash
pnpm build
pnpm preview &  # serve the production bundle
npx lighthouse http://localhost:4173 --only-categories=pwa,performance --chrome-flags="--headless"
```
