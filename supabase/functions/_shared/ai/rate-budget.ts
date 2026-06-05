// Token-bucket rate budget gate. Reserves tokens atomically against two
// buckets: a per-profile window (public.app_reserve_profile_ai_budget) and the
// global window (public.app_reserve_ai_budget). The per-profile bucket is
// reserved first so one user can't burn the whole global window; the global
// bucket caps our aggregate Anthropic spend. On either denial the Edge Function
// returns HTTP 429 with `retry_after`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../env.ts';

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (_admin === null) {
    _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export type BudgetReason = 'ok' | 'rate_limit';

export async function withRateBudget<T>(
  profileId: string,
  estimatedTokens: number,
  fn: () => Promise<T>,
): Promise<{ status: BudgetReason; value?: T }> {
  // Per-profile gate first: cheap, scoped, and stops a single user from
  // monopolizing the global window.
  const perProfile = await admin().rpc('app_reserve_profile_ai_budget', {
    p_profile: profileId,
    p_tokens: estimatedTokens,
  });
  if (perProfile.error) throw perProfile.error;
  if (perProfile.data === false) return { status: 'rate_limit' };

  const reserved = await admin().rpc('app_reserve_ai_budget', { p_tokens: estimatedTokens });
  if (reserved.error) throw reserved.error;
  if (reserved.data === false) return { status: 'rate_limit' };

  const value = await fn();
  return { status: 'ok', value };
}
