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
  // Bound every Supabase HTTP request with a timeout. Without it, a request
  // fired on a dead socket — classically a token refresh the moment a mobile
  // browser resumes the PWA after backgrounding — hangs until the OS TCP
  // timeout, holding the auth lock and freezing the app until a manual reload.
  // See timeout-fetch.ts.
  global: { fetch: createTimeoutFetch() },
});
