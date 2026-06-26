// The single SPA Supabase client. Every other module imports `supabase`
// from here.
//
// `Database` types ship from `supabase gen types typescript --local --schema app`
// after the migrations are live. Until then we keep the client untyped so
// callers can use the real schema shape without being blocked by stale stubs.

import { processLock } from '@supabase/auth-js';
import { createClient } from '@supabase/supabase-js';
import { createTimeoutFetch } from './timeout-fetch';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing — running in stub mode',
  );
}

export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'anon', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // PKCE: email links and OAuth callbacks land with a single-use `?code=`
    // that is exchanged server-side, instead of the implicit flow's
    // `#access_token=...&refresh_token=...` fragment. Bearer tokens in the
    // URL leak into anything that records location.href (Sentry transactions,
    // history sync) and enable login-CSRF via a crafted fragment link.
    flowType: 'pkce',
    // Serialize token access with an in-memory lock instead of the browser
    // default (`navigatorLock`, the Web Locks API). When Android Chrome freezes
    // a long-backgrounded PWA tab, a Web Lock held by that frozen page context
    // can be left stranded: on resume every `auth.getSession()` — which
    // supabase-js runs before *every* PostgREST request to attach the bearer
    // token — blocks on a lock it can never re-acquire, so search/settings/etc.
    // hang until a full reload spawns a fresh page (and a fresh lock). An
    // in-memory promise-chain lock lives entirely in this page's JS and is
    // released the instant its holder settles, so a freeze can't strand it.
    // Trade-off: it doesn't coordinate token refresh across tabs, which is fine
    // for a single-tab mobile PWA (Supabase's refresh-token reuse interval
    // tolerates the rare concurrent refresh).
    lock: processLock,
  },
  db: { schema: 'app' },
  realtime: {
    // Keep the Realtime socket alive across mobile backgrounding. A
    // backgrounded tab's main-thread timers are throttled (to once a minute
    // after ~5 min hidden), so the client misses its heartbeat window, the
    // server assumes it is gone, and the WebSocket is dropped *silently* — no
    // error fires, events just stop. Running the heartbeat in a Web Worker
    // keeps it ticking off the throttled main thread. Gated on Worker support
    // so jsdom (component/unit tests) and SSR — where `window.Worker` is
    // undefined and realtime-js would throw "Web Worker is not supported" at
    // client construction — fall back to a main-thread heartbeat. With no
    // `workerUrl`, realtime-js builds the worker from an inline same-origin
    // blob (needs `worker-src blob:` in the CSP; see vercel.json).
    // See Supabase's "silent disconnections in backgrounded applications" guide.
    worker: typeof Worker !== 'undefined',
    // Belt and suspenders: if the socket still drops (iOS suspends background
    // JS entirely, so even a worker stops), reconnect the moment a heartbeat
    // reports the gap, rather than leaving the app on a dead socket until the
    // user manually reloads. session-recovery.ts also forces this on resume.
    heartbeatCallback: (status) => {
      if (status === 'disconnected' || status === 'timeout') {
        supabase.realtime.connect();
      }
    },
  },
  // Bound every Supabase HTTP request with a timeout. Without it, a request
  // fired on a dead socket — classically a token refresh the moment a mobile
  // browser resumes the PWA after backgrounding — hangs until the OS TCP
  // timeout, holding the auth lock and freezing the app until a manual reload.
  // See timeout-fetch.ts.
  global: { fetch: createTimeoutFetch() },
});
