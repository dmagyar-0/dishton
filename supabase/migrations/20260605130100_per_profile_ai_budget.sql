-- 20260605130100_per_profile_ai_budget.sql
-- Per-profile AI token budget, enforced IN ADDITION to the global token bucket
-- (app.ai_rate_budget / public.app_reserve_ai_budget).
--
-- The global bucket protects our Anthropic spend in aggregate but lets a single
-- user burn the entire window, starving everyone else and running up cost on
-- one account. This adds a per-profile sliding-ish window (fixed 60s window,
-- reset on first call after expiry) so no one profile can reserve more than
-- `budget_per_minute` tokens/minute. The Edge Function reserves the per-profile
-- budget FIRST (cheap, scoped) and only then the global bucket.

set search_path = public;

------------------------------------------------------------------------------
-- app.ai_profile_budget (one row per profile; service_role only)
------------------------------------------------------------------------------

create table app.ai_profile_budget (
  profile_id uuid primary key references app.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  tokens_used bigint not null default 0,
  budget_per_minute bigint not null default 20000
);

alter table app.ai_profile_budget enable row level security;
-- No anon/authenticated policies. Service role bypasses RLS; the reserve RPC
-- is SECURITY DEFINER and is the only supported writer.

------------------------------------------------------------------------------
-- public.app_reserve_profile_ai_budget(p_profile uuid, p_tokens bigint)
--   returns boolean
-- Mirrors public.app_reserve_ai_budget but scoped to a single profile. Lives in
-- `public` because the Edge Function reaches RPCs through the PostgREST surface,
-- which does not search the `app` schema.
------------------------------------------------------------------------------

create or replace function public.app_reserve_profile_ai_budget(p_profile uuid, p_tokens bigint)
returns boolean
language plpgsql
security definer
set search_path = app, public
as $$
declare row app.ai_profile_budget%rowtype;
begin
  -- Upsert-then-lock: ensure a row exists, then take it FOR UPDATE so
  -- concurrent reservations for the same profile serialize.
  insert into app.ai_profile_budget (profile_id)
    values (p_profile)
    on conflict (profile_id) do nothing;

  select * into row from app.ai_profile_budget
    where profile_id = p_profile for update;

  if row.window_started_at < now() - interval '60 seconds' then
    update app.ai_profile_budget
       set window_started_at = now(), tokens_used = 0
     where profile_id = p_profile;
    row.tokens_used = 0;
  end if;

  if row.tokens_used + p_tokens > row.budget_per_minute then
    return false;
  end if;

  update app.ai_profile_budget
     set tokens_used = tokens_used + p_tokens
   where profile_id = p_profile;
  return true;
end;
$$;

revoke all on function public.app_reserve_profile_ai_budget(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.app_reserve_profile_ai_budget(uuid, bigint) to service_role;
