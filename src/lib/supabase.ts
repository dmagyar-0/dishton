// The single SPA Supabase client. Every other module imports `supabase`
// from here.
//
// `Database` types ship from `supabase gen types typescript --local --schema app`
// after the migrations are live. Until then we keep the client untyped so
// callers can use the real schema shape without being blocked by stale stubs.

import { createClient } from '@supabase/supabase-js';

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
  },
  db: { schema: 'app' },
});
