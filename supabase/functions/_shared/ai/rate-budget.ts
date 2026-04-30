// Token-bucket rate budget gate. Reserves tokens atomically via
// public.app_reserve_ai_budget. On rate_limit, the Edge Function returns
// HTTP 429 with `retry_after`.

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
  estimatedTokens: number,
  fn: () => Promise<T>,
): Promise<{ status: BudgetReason; value?: T }> {
  const reserved = await admin().rpc('app_reserve_ai_budget', { p_tokens: estimatedTokens });
  if (reserved.error) throw reserved.error;
  if (reserved.data === false) return { status: 'rate_limit' };
  const value = await fn();
  return { status: 'ok', value };
}
