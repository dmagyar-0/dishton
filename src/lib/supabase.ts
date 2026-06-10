// The single SPA Supabase client. Every other module imports `supabase`
// from here.
//
// `Database` types ship from `supabase gen types typescript --local --schema app`
// after the migrations are live. Until then we keep the client untyped so
// callers can use the real schema shape without being blocked by stale stubs.

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
  },
  db: { schema: 'app' },
  // Bound every Supabase HTTP request with a timeout. Without it, a request
  // fired on a dead socket — classically a token refresh the moment a mobile
  // browser resumes the PWA after backgrounding — hangs until the OS TCP
  // timeout, holding the auth lock and freezing the app until a manual reload.
  // See timeout-fetch.ts.
  global: { fetch: createTimeoutFetch() },
});
