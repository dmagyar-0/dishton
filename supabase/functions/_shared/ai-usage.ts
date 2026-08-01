// Per-call Anthropic usage telemetry, written to app.ai_usage by Edge
// Functions with a true service-role client. Additive to the existing
// logAiCall() stdout line (Better Stack still consumes that) — this is the
// queryable counterpart the /admin/metrics dashboard reads from.
//
// Telemetry must never fail an import: recordAiUsage() swallows every error
// internally (network, auth, schema) and never throws. Call sites should not
// `await` it in a way that delays the HTTP response — in the import functions
// the AI call already runs inside the detached `work()` function, so calling
// it there is already off the request path.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { AppClient } from './auth.ts';
import { env } from './env.ts';
import { log } from './log.ts';

export type AiUsageRow = {
  function: string;
  lane: 'text' | 'vision';
  // Model id, or '(unknown)' when the model call itself failed before a model
  // responded — the `model` column is NOT NULL.
  model: string;
  profile_id: string | null;
  household_id: string | null;
  request_id: string | null;
  import_job_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  latency_ms: number | null;
  ok: boolean;
  reason: string | null;
};

let _admin: AppClient | null = null;

// Lazily-created true service-role client (no forwarded caller JWT).
// app.ai_usage has RLS enabled with no policies at all — only service_role
// can write to it, so the caller-scoped client from resolveCaller() (which
// forwards the JWT and runs as `authenticated`) cannot be used here.
export function aiUsageAdminClient(): AppClient {
  if (_admin === null) {
    _admin = createClient<any, 'app'>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      // autoRefreshToken defaults to true, which starts a background
      // setInterval to refresh the session token. A service-role key is not a
      // user session and never needs refreshing, so that timer is pure waste
      // inside a short-lived Edge Function isolate (and it leaks past test
      // completion under Deno's leak detector). Keep this false.
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'app' },
    });
  }
  return _admin;
}

// Insert one ai_usage row. MUST NOT THROW under any circumstance — telemetry
// is best-effort and must never fail (or slow down) an import, a translation,
// or a chat turn. Any failure is swallowed after an optional 'warn' log line.
export async function recordAiUsage(admin: AppClient, row: AiUsageRow): Promise<void> {
  try {
    const { error } = await admin.from('ai_usage').insert(row);
    if (error) {
      log({
        request_id: row.request_id ?? '(none)',
        profile_id: row.profile_id,
        household_id: row.household_id,
        function: row.function,
        event: 'ai_usage.record.failure',
        level: 'warn',
        error: { name: 'ai_usage_insert_failed', message: error.message },
      });
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    log({
      request_id: row.request_id ?? '(none)',
      profile_id: row.profile_id,
      household_id: row.household_id,
      function: row.function,
      event: 'ai_usage.record.failure',
      level: 'warn',
      error: { name: e?.name ?? 'unknown', message: e?.message ?? String(err) },
    });
  }
}
