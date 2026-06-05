-- 20260605130200_refund_profile_ai_budget.sql
-- Refund counterpart to public.app_reserve_profile_ai_budget.
--
-- withRateBudget reserves the per-profile budget FIRST, then the global bucket.
-- If the global bucket denies, the per-profile tokens were already reserved for
-- a model call that never happens — repeatedly hitting a saturated global
-- window would burn a user's per-profile budget and wedge them out of imports.
-- This lets the Edge Function release the per-profile reservation on a global
-- denial. Clamped at zero and scoped to the current window so a late refund
-- after a window reset cannot drive tokens_used negative.
--
-- Forward-only.

set search_path = public;

create or replace function public.app_refund_profile_ai_budget(p_profile uuid, p_tokens bigint)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
  update app.ai_profile_budget
     set tokens_used = greatest(0, tokens_used - p_tokens)
   where profile_id = p_profile
     and window_started_at >= now() - interval '60 seconds';
end;
$$;

revoke all on function public.app_refund_profile_ai_budget(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.app_refund_profile_ai_budget(uuid, bigint) to service_role;
