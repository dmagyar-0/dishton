-- 20260430120200_imports.sql
-- household_invites + import_jobs + ai_rate_budget + app_reserve_ai_budget RPC.
-- Defined by docs/04-data-model.md and docs/07-ai-integration.md.

set search_path = public;

------------------------------------------------------------------------------
-- household_invites (single-use, 7-day expiry, base32-8 codes)
------------------------------------------------------------------------------

create table app.household_invites (
  code text primary key check (code ~ '^[A-Z2-7]{8}$'),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references app.profiles(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index household_invites_open_idx
  on app.household_invites (household_id) where redeemed_at is null;

alter table app.household_invites enable row level security;

create policy household_invites_member_read on app.household_invites
  for select using (app.is_household_member(household_id));

create policy household_invites_member_insert on app.household_invites
  for insert with check (
    app.is_household_member(household_id)
    and created_by = auth.uid()
  );

-- Any authenticated user may flip an invite from un-redeemed to redeemed.
-- The redeem RPC is the supported path; this policy allows direct redeems
-- only when the invite is still valid.
create policy household_invites_redeemer_update on app.household_invites
  for update to authenticated using (
    redeemed_at is null and expires_at > now()
  ) with check (
    redeemed_by = auth.uid() and redeemed_at is not null
  );

create policy household_invites_owner_delete on app.household_invites
  for delete using (app.is_household_owner(household_id));

grant select, insert, update, delete on app.household_invites to authenticated;

------------------------------------------------------------------------------
-- import_jobs (one row per import attempt; visible only to its creator)
------------------------------------------------------------------------------

create table app.import_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id),
  household_id uuid not null references app.households(id),
  kind text not null check (kind in ('url','instagram','photo','manual')),
  status text not null
    check (status in ('queued','running','needs_review','done','failed')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  recipe_id uuid references app.recipes(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index import_jobs_profile_created_idx
  on app.import_jobs (profile_id, created_at desc);
create index import_jobs_running_idx
  on app.import_jobs (status) where status in ('queued','running');

alter table app.import_jobs enable row level security;

create policy import_jobs_self on app.import_jobs
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update, delete on app.import_jobs to authenticated;

------------------------------------------------------------------------------
-- ai_rate_budget (single-row token bucket; service_role only)
------------------------------------------------------------------------------

create table app.ai_rate_budget (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default now(),
  tokens_used bigint not null default 0,
  budget_per_minute bigint not null default 60000
);
insert into app.ai_rate_budget default values on conflict do nothing;

alter table app.ai_rate_budget enable row level security;
-- No anon/authenticated policies. Service role bypasses RLS.

------------------------------------------------------------------------------
-- public.app_reserve_ai_budget(p_tokens bigint) returns boolean
-- Per docs/07-ai-integration.md. Lives in the `public` schema because the
-- Edge Function calls it through the PostgREST `rpc` surface, which does not
-- search the `app` schema for RPCs.
------------------------------------------------------------------------------

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
       set window_started_at = now(), tokens_used = 0;
    row.tokens_used = 0;
  end if;
  if row.tokens_used + p_tokens > row.budget_per_minute then
    return false;
  end if;
  update app.ai_rate_budget set tokens_used = tokens_used + p_tokens;
  return true;
end;
$$;

revoke all on function public.app_reserve_ai_budget(bigint) from public, anon, authenticated;
grant execute on function public.app_reserve_ai_budget(bigint) to service_role;
