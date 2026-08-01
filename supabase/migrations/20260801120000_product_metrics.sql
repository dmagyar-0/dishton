-- 20260801120000_product_metrics.sql
-- Phase 1 of first-party product observability (see the product-metrics plan
-- referenced from docs/14-observability.md): app_admins + is_app_admin(),
-- analytics_events (client telemetry), ai_usage (per-call AI accounting),
-- ai_model_prices (pricing as data), a retention reaper, and the six
-- admin-only app.metrics_* RPCs. Edge Function wiring, SPA instrumentation and
-- the /admin/metrics route are later phases; this migration only touches the
-- database.

set search_path = app, public;

------------------------------------------------------------------------------
-- app_admins: hand-seeded allowlist. Global metrics span households, so the
-- existing household-owner gating (app.is_household_owner) is insufficient --
-- this is a new, minimal admin concept.
--
-- No anon/authenticated policies at all -- service_role only, seeded by hand.
-- is_app_admin() is SECURITY DEFINER so a caller can check their own status
-- without needing SELECT on the table.
------------------------------------------------------------------------------

create table app.app_admins (
  profile_id uuid primary key references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app.app_admins enable row level security;
-- No anon/authenticated policies and no grants -- is_app_admin() runs as the
-- function owner (SECURITY DEFINER) and reads the table directly.

create or replace function app.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (select 1 from app.app_admins where profile_id = auth.uid());
$$;

revoke all on function app.is_app_admin() from public, anon;
grant execute on function app.is_app_admin() to authenticated;

-- To promote a user to admin, run by hand against the target project (never
-- hardcode a UUID or email in an executable migration):
--
-- insert into app.app_admins (profile_id)
-- select id from auth.users where email = 'someone@example.com'
-- on conflict (profile_id) do nothing;

------------------------------------------------------------------------------
-- analytics_events: append-only client telemetry, written directly by the
-- SPA (authenticated INSERT only). Reads go exclusively through the
-- metrics_* admin RPCs below -- there is deliberately no SELECT policy.
------------------------------------------------------------------------------

create table app.analytics_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  profile_id uuid references app.profiles(id) on delete set null,
  household_id uuid references app.households(id) on delete set null,
  session_id uuid not null, -- client-generated, per browser session
  event text not null check (event in (
    'app_open', 'app_resume', 'import_started', 'import_succeeded', 'import_failed',
    'edge_call', 'recipe_viewed', 'search_performed', 'signup_completed'
  )),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2048),
  release_sha text,
  display_mode text check (display_mode in ('standalone', 'browser')),
  created_at timestamptz not null default now()
);
create index analytics_events_occurred_idx on app.analytics_events (occurred_at desc);
create index analytics_events_event_occurred_idx on app.analytics_events (event, occurred_at desc);
create index analytics_events_profile_occurred_idx
  on app.analytics_events (profile_id, occurred_at desc);

alter table app.analytics_events enable row level security;

create policy analytics_events_insert_own on app.analytics_events
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- INSERT only. No select/update/delete policy or grant -- reads happen
-- exclusively through the admin-gated metrics_* RPCs.
grant insert on app.analytics_events to authenticated;

------------------------------------------------------------------------------
-- ai_usage: one row per Anthropic call, written by Edge Functions with the
-- service-role client. Supersedes reading tokens out of import_jobs.payload
-- (overwritten on save; doesn't exist at all for translate/chat calls).
--
-- RLS enabled, no policies at all -- service_role bypasses RLS and is the
-- only writer; reads happen exclusively through metrics_ai_cost below.
------------------------------------------------------------------------------

create table app.ai_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  function text not null, -- 'import-url' | 'import-photo' | 'translate-recipe' | ...
  lane text not null check (lane in ('text', 'vision')),
  model text not null,
  profile_id uuid references app.profiles(id) on delete set null,
  household_id uuid references app.households(id) on delete set null,
  request_id uuid,
  import_job_id uuid references app.import_jobs(id) on delete set null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cache_read bigint not null default 0,
  cache_write bigint not null default 0,
  latency_ms integer,
  ok boolean not null default true,
  reason text
);
create index ai_usage_occurred_idx on app.ai_usage (occurred_at desc);

alter table app.ai_usage enable row level security;
-- No anon/authenticated policies. Direct service-role writes need an
-- explicit table grant (RLS bypass alone doesn't confer table privileges --
-- see 20260607123645_grant_service_role_app_agent_tables.sql).
grant insert on app.ai_usage to service_role;

------------------------------------------------------------------------------
-- ai_model_prices: pricing as data, not code, so a price change is a row.
-- No policies and no grants at all -- metrics_ai_cost is SECURITY DEFINER and
-- reads the table itself; nobody else needs to.
------------------------------------------------------------------------------

create table app.ai_model_prices (
  model text not null,
  effective_from date not null default '2026-01-01',
  input_usd_per_mtok numeric(10, 4) not null,
  output_usd_per_mtok numeric(10, 4) not null,
  cache_read_usd_per_mtok numeric(10, 4) not null,
  cache_write_usd_per_mtok numeric(10, 4) not null,
  primary key (model, effective_from)
);

alter table app.ai_model_prices enable row level security;
-- No anon/authenticated/service_role policies or grants -- see comment above.

-- Anthropic list prices; cache read = 0.1x input, 5-minute cache write =
-- 1.25x input. A model with no row here contributes $0 and is surfaced as
-- unpriced_calls by metrics_ai_cost rather than silently costing nothing.
insert into app.ai_model_prices
  (model, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok)
values
  ('claude-haiku-4-5', 1.0000, 5.0000, 0.1000, 1.2500),
  ('claude-sonnet-4-6', 3.0000, 15.0000, 0.3000, 3.7500),
  ('claude-opus-5', 5.0000, 25.0000, 0.5000, 6.2500),
  ('claude-sonnet-5', 3.0000, 15.0000, 0.3000, 3.7500)
on conflict (model, effective_from) do nothing;

------------------------------------------------------------------------------
-- Retention reaper. Mirrors the pattern in
-- 20260605130000_reaper_awaiting_save.sql, except analytics_events/ai_usage
-- have no authenticated write policies at all, so (unlike
-- app.reap_stuck_imports) this must run SECURITY DEFINER and is service_role
-- only -- there is no self-scoped "reap my own rows" caller here.
------------------------------------------------------------------------------

create or replace function app.reap_analytics_events()
returns int
language plpgsql
security definer
set search_path = app, public
as $$
declare n_events int;
declare n_usage int;
begin
  delete from app.analytics_events
   where occurred_at < now() - interval '180 days';
  get diagnostics n_events = row_count;

  delete from app.ai_usage
   where occurred_at < now() - interval '400 days';
  get diagnostics n_usage = row_count;

  return n_events + n_usage;
end $$;

revoke all on function app.reap_analytics_events() from public, anon, authenticated;
grant execute on function app.reap_analytics_events() to service_role;

------------------------------------------------------------------------------
-- Admin-only metrics RPCs. Every one is SECURITY DEFINER (they read across
-- all households/profiles, which RLS alone would never allow) and every one
-- checks app.is_app_admin() FIRST, before any query. Revoked from
-- public/anon, granted to authenticated (the admin route calls these with
-- the signed-in admin's own JWT).
------------------------------------------------------------------------------

-- Daily distinct-profile activity plus rolling 7/30-day windows anchored on
-- each day in [p_from, p_to]. Any analytics_events row counts as "active".
create or replace function app.metrics_active_users(p_from date, p_to date)
returns table(day date, dau bigint, wau_rolling bigint, mau_rolling bigint)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      d::date as day,
      (select count(distinct e.profile_id) from app.analytics_events e
        where e.profile_id is not null
          and e.occurred_at::date = d::date)::bigint as dau,
      (select count(distinct e.profile_id) from app.analytics_events e
        where e.profile_id is not null
          and e.occurred_at::date between d::date - 6 and d::date)::bigint as wau_rolling,
      (select count(distinct e.profile_id) from app.analytics_events e
        where e.profile_id is not null
          and e.occurred_at::date between d::date - 29 and d::date)::bigint as mau_rolling
    from generate_series(p_from, p_to, interval '1 day') as d
    order by d;
end;
$$;

revoke all on function app.metrics_active_users(date, date) from public, anon;
grant execute on function app.metrics_active_users(date, date) to authenticated;

-- Daily app_open / app_resume counts, standalone-display-mode share, and
-- unique client sessions.
create or replace function app.metrics_app_opens(p_from date, p_to date)
returns table(day date, opens bigint, resumes bigint, standalone_opens bigint, unique_sessions bigint)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      e.occurred_at::date as day,
      count(*) filter (where e.event = 'app_open')::bigint as opens,
      count(*) filter (where e.event = 'app_resume')::bigint as resumes,
      count(*) filter (
        where e.event = 'app_open' and e.display_mode = 'standalone'
      )::bigint as standalone_opens,
      count(distinct e.session_id)::bigint as unique_sessions
    from app.analytics_events e
    where e.event in ('app_open', 'app_resume')
      and e.occurred_at::date between p_from and p_to
    group by 1
    order by 1;
end;
$$;

revoke all on function app.metrics_app_opens(date, date) from public, anon;
grant execute on function app.metrics_app_opens(date, date) to authenticated;

-- Daily import funnel by kind, restricted to jobs that have reached a
-- terminal status (done/failed/needs_review -- see
-- 20260525000000_import_jobs_background.sql). In-flight rows show up in
-- metrics_stuck_imports instead once they're old enough to be suspicious.
-- Latency is measured completed_at - created_at.
create or replace function app.metrics_imports(p_from date, p_to date)
returns table(
  day date,
  kind text,
  started bigint,
  succeeded bigint,
  failed bigint,
  p50_ms numeric,
  p95_ms numeric
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      j.created_at::date as day,
      j.kind,
      count(*)::bigint as started,
      count(*) filter (where j.status = 'done')::bigint as succeeded,
      count(*) filter (where j.status in ('failed', 'needs_review'))::bigint as failed,
      (percentile_cont(0.5) within group (
        order by extract(epoch from (j.completed_at - j.created_at)) * 1000
      ))::numeric as p50_ms,
      (percentile_cont(0.95) within group (
        order by extract(epoch from (j.completed_at - j.created_at)) * 1000
      ))::numeric as p95_ms
    from app.import_jobs j
    where j.status in ('done', 'failed', 'needs_review')
      and j.created_at::date between p_from and p_to
    group by 1, 2
    order by 1, 2;
end;
$$;

revoke all on function app.metrics_imports(date, date) from public, anon;
grant execute on function app.metrics_imports(date, date) to authenticated;

-- Daily AI spend by function/model. Joins each ai_usage row to the newest
-- ai_model_prices row for that model with effective_from <= occurred_at::date
-- via a LEFT JOIN LATERAL, so a model with no matching price row still
-- appears in the result set (usd = 0, counted in unpriced_calls) instead of
-- being dropped or silently costing nothing.
create or replace function app.metrics_ai_cost(p_from date, p_to date)
returns table(
  day date,
  function text,
  model text,
  calls bigint,
  tokens_in bigint,
  tokens_out bigint,
  cache_read bigint,
  cache_write bigint,
  usd numeric,
  unpriced_calls bigint
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      u.occurred_at::date as day,
      u.function,
      u.model,
      count(*)::bigint as calls,
      coalesce(sum(u.tokens_in), 0)::bigint as tokens_in,
      coalesce(sum(u.tokens_out), 0)::bigint as tokens_out,
      coalesce(sum(u.cache_read), 0)::bigint as cache_read,
      coalesce(sum(u.cache_write), 0)::bigint as cache_write,
      coalesce(sum(
        case when p.model is null then 0
        else (u.tokens_in   * p.input_usd_per_mtok
            + u.tokens_out  * p.output_usd_per_mtok
            + u.cache_read  * p.cache_read_usd_per_mtok
            + u.cache_write * p.cache_write_usd_per_mtok) / 1000000.0
        end
      ), 0)::numeric as usd,
      count(*) filter (where p.model is null)::bigint as unpriced_calls
    from app.ai_usage u
    left join lateral (
      select mp.model, mp.input_usd_per_mtok, mp.output_usd_per_mtok,
             mp.cache_read_usd_per_mtok, mp.cache_write_usd_per_mtok
      from app.ai_model_prices mp
      where mp.model = u.model
        and mp.effective_from <= u.occurred_at::date
      order by mp.effective_from desc
      limit 1
    ) p on true
    where u.occurred_at::date between p_from and p_to
    group by 1, 2, 3
    order by 1, 2, 3;
end;
$$;

revoke all on function app.metrics_ai_cost(date, date) from public, anon;
grant execute on function app.metrics_ai_cost(date, date) to authenticated;

-- Daily edge-call outcomes, keyed on the client-reported fn/outcome props of
-- the 'edge_call' analytics_events event (see src/lib/invoke-function.ts,
-- phase 2b). This is the client-side half of "the SPA fired a request and
-- the Edge Function never answered"; metrics_stuck_imports is the server half.
create or replace function app.metrics_edge_failures(p_from date, p_to date)
returns table(day date, fn text, outcome text, calls bigint, p95_ms numeric)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      e.occurred_at::date as day,
      e.props->>'fn' as fn,
      e.props->>'outcome' as outcome,
      count(*)::bigint as calls,
      (percentile_cont(0.95) within group (
        order by (e.props->>'ms')::numeric
      ) filter (where e.props ? 'ms'))::numeric as p95_ms
    from app.analytics_events e
    where e.event = 'edge_call'
      and e.occurred_at::date between p_from and p_to
    group by 1, 2, 3
    order by 1, 2, 3;
end;
$$;

revoke all on function app.metrics_edge_failures(date, date) from public, anon;
grant execute on function app.metrics_edge_failures(date, date) to authenticated;

-- Import jobs that have been queued/running for longer than any legitimate
-- worker budget should take (see app.reap_stuck_imports' 5/10-minute
-- thresholds) -- the server-side signal that a job is stuck, independent of
-- whether the SPA that kicked it off is even still listening.
create or replace function app.metrics_stuck_imports()
returns table(
  id uuid,
  profile_id uuid,
  household_id uuid,
  kind text,
  status text,
  created_at timestamptz,
  age_minutes numeric
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      j.id,
      j.profile_id,
      j.household_id,
      j.kind,
      j.status,
      j.created_at,
      round(extract(epoch from (now() - j.created_at)) / 60, 1) as age_minutes
    from app.import_jobs j
    where j.status in ('queued', 'running')
      and j.created_at < now() - interval '15 minutes'
    order by j.created_at asc;
end;
$$;

revoke all on function app.metrics_stuck_imports() from public, anon;
grant execute on function app.metrics_stuck_imports() to authenticated;
