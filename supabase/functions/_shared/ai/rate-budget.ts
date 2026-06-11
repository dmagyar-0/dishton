// Token-bucket rate budget gate. Reserves tokens atomically against two
// buckets: a per-profile window (public.app_reserve_profile_ai_budget) and the
// global window (public.app_reserve_ai_budget). The per-profile bucket is
// reserved first so one user can't burn the whole global window; the global
// bucket caps our aggregate Anthropic spend. On either denial the Edge Function
// returns HTTP 429 with `retry_after`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../env.ts';

// Typed <any, 'public'> like _shared/auth.ts so the public-schema RPC calls
// (app_reserve_ai_budget, etc.) type-check; the default generic resolves their
// args to `undefined`.
let _admin: ReturnType<typeof createClient<any, 'public'>> | null = null;
function admin() {
  if (_admin === null) {
    _admin = createClient<any, 'public'>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export type BudgetReason = 'ok' | 'rate_limit';

// Release both reservations after a model call that never produced work
// (thrown error or an `upstream` failure). Best-effort: a refund failure must
// not mask the original error, and both windows self-heal within 60s anyway.
export async function refundBudgets(profileId: string, tokens: number): Promise<void> {
  try {
    await admin().rpc('app_refund_profile_ai_budget', {
      p_profile: profileId,
      p_tokens: tokens,
    });
    await admin().rpc('app_refund_ai_budget', { p_tokens: tokens });
  } catch {
    /* window self-heals */
  }
}

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
  if (reserved.data === false) {
    // Global window is saturated. Release the per-profile reservation we just
    // took so a user isn't charged for a call that won't happen (best-effort;
    // the budget self-heals each window even if this refund fails).
    const refund = await admin().rpc('app_refund_profile_ai_budget', {
      p_profile: profileId,
      p_tokens: estimatedTokens,
    });
    if (refund.error) throw refund.error;
    return { status: 'rate_limit' };
  }

  try {
    const value = await fn();
    return { status: 'ok', value };
  } catch (e) {
    // The reserved tokens were never spent — the call threw before Anthropic
    // produced anything. Hand them back so transient failures don't wedge the
    // user out of their per-minute window.
    await refundBudgets(profileId, estimatedTokens);
    throw e;
  }
}
