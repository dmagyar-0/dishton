-- 20260502120000_fix_app_reserve_ai_budget.sql
-- Re-deploy public.app_reserve_ai_budget with `where true` on the two UPDATEs.
--
-- The earlier migration 20260430120200_imports.sql was edited in-place in
-- commit 88b5371 to add `where true`, but Supabase tracks migrations by
-- filename so `supabase db push` skipped re-applying it on environments where
-- the original (broken) version had already been applied. The deployed
-- function therefore still threw "UPDATE requires a WHERE clause" at the
-- first call inside `withRateBudget`, which surfaces to the SPA as a 1.2s
-- HTTP 500 with `{"error":"internal"}`.
--
-- This migration replaces the function body. CREATE OR REPLACE FUNCTION is
-- idempotent; safe to run on databases that already have the corrected body.

set search_path = public;

create or replace function public.app_reserve_ai_budget(p_tokens bigint)
returns boolean
language plpgsql
security definer
set search_path = app, public
as $$
declare row app.ai_rate_budget%rowtype;
begin
  select * into row from app.ai_rate_budget for update;
  if row.window_started_at < now() - interval '60 seconds' then
    update app.ai_rate_budget
       set window_started_at = now(), tokens_used = 0
     where true;
    row.tokens_used = 0;
  end if;
  if row.tokens_used + p_tokens > row.budget_per_minute then
    return false;
  end if;
  update app.ai_rate_budget set tokens_used = tokens_used + p_tokens where true;
  return true;
end;
$$;
