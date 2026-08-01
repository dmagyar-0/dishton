-- supabase/tests/product_metrics.test.sql
-- TAP tests for 20260801120000_product_metrics.sql: app_admins/is_app_admin,
-- analytics_events RLS, and the six admin-only app.metrics_* RPCs.
--
-- The runner wraps the file in BEGIN/ROLLBACK so the fixtures vanish.
--
-- Personas:
--   N   = 00000000-0000-0000-0000-0000000000f1  (ordinary authenticated user)
--   ADM = 00000000-0000-0000-0000-0000000000f2  (seeded into app.app_admins)
--   OTH = 00000000-0000-0000-0000-0000000000f3  (insert-target for the
--                                                 cross-profile RLS probe)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000f1',
   'authenticated','authenticated','pm-n@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000f2',
   'authenticated','authenticated','pm-adm@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000f3',
   'authenticated','authenticated','pm-oth@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000f1','PM Normal'),
  ('00000000-0000-0000-0000-0000000000f2','PM Admin'),
  ('00000000-0000-0000-0000-0000000000f3','PM Other')
on conflict (id) do nothing;

insert into app.app_admins (profile_id) values
  ('00000000-0000-0000-0000-0000000000f2')
on conflict (profile_id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('eeeeeeee-0000-0000-0000-0000000000f1','PM Household',
   '00000000-0000-0000-0000-0000000000f1')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('eeeeeeee-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000f1','owner')
on conflict do nothing;

-- A stuck import (queued/running, older than the 15-minute threshold) for
-- metrics_stuck_imports to surface.
insert into app.import_jobs (id, profile_id, household_id, kind, status, created_at) values
  ('ffffffff-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000f1',
   'eeeeeeee-0000-0000-0000-0000000000f1',
   'url','running', now() - interval '20 minutes')
on conflict (id) do nothing;

-- ai_usage: one call against a priced model, one against a model with no
-- ai_model_prices row at all (must surface as unpriced, not be dropped).
insert into app.ai_usage
  (occurred_at, function, lane, model, profile_id, household_id,
   tokens_in, tokens_out, cache_read, cache_write, ok) values
  (now(), 'import-url', 'text', 'claude-sonnet-5',
   '00000000-0000-0000-0000-0000000000f1',
   'eeeeeeee-0000-0000-0000-0000000000f1',
   1000, 1000, 0, 0, true),
  (now(), 'import-photo', 'vision', 'pm-test-unpriced-model',
   '00000000-0000-0000-0000-0000000000f1',
   'eeeeeeee-0000-0000-0000-0000000000f1',
   1000, 1000, 0, 0, true);

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_as(
  p_label text, p_persona uuid, p_check boolean
) returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

-- Calls a metrics RPC (via a caller-supplied query string over dblink-free
-- dynamic SQL) as a persona; returns 'ok:<row count>' or SQLERRM. Kept as a
-- single dynamic-SQL helper so all six zero/one-arg metrics_* RPCs can share
-- it without one wrapper function apiece.
create or replace function pg_temp.call_metrics_as(
  p_persona uuid, p_sql text
) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    execute 'select count(*) from (' || p_sql || ') s' into n;
    perform set_config('role', 'postgres', true);
    return 'ok:' || n::text;
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Reads (usd, unpriced_calls) for one model out of metrics_ai_cost as a
-- persona; returns a deterministic 'usd=...|unpriced=...' string.
create or replace function pg_temp.ai_cost_row_as(
  p_persona uuid, p_from date, p_to date, p_model text
) returns text language plpgsql as $$
declare v_usd numeric; v_unpriced bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  select usd, unpriced_calls into v_usd, v_unpriced
    from app.metrics_ai_cost(p_from, p_to)
   where model = p_model;
  perform set_config('role', 'postgres', true);
  return format('usd=%s|unpriced=%s', round(coalesce(v_usd, -1), 4), coalesce(v_unpriced, -1));
end;
$$;

-- app.is_app_admin() as a persona.
create or replace function pg_temp.is_admin_as(p_persona uuid)
returns boolean language plpgsql as $$
declare b boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  select app.is_app_admin() into b;
  perform set_config('role', 'postgres', true);
  return b;
end;
$$;

-- Inserts an analytics_events row as a persona with an arbitrary target
-- profile_id; returns the inserted row count as text or SQLERRM.
create or replace function pg_temp.insert_event_as(
  p_persona uuid, p_target_profile uuid
) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    insert into app.analytics_events (profile_id, session_id, event)
      values (p_target_profile, gen_random_uuid(), 'app_open');
    get diagnostics n = row_count;
    perform set_config('role', 'postgres', true);
    return n::text;
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- SELECT count(*) against a table as a persona; returns the count as text or
-- SQLERRM (expected: permission denied -- authenticated has no SELECT grant
-- on either table).
create or replace function pg_temp.select_count_as(p_persona uuid, p_table text)
returns text language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    execute 'select count(*) from app.' || p_table into n;
    perform set_config('role', 'postgres', true);
    return n::text;
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

do $$
declare
  n uuid := '00000000-0000-0000-0000-0000000000f1';
  adm uuid := '00000000-0000-0000-0000-0000000000f2';
  oth uuid := '00000000-0000-0000-0000-0000000000f3';
  p_from date := current_date - 1;
  p_to date := current_date + 1;
begin

  -- is_app_admin() itself.
  perform pg_temp.check_as('is_app_admin true for admin', adm, pg_temp.is_admin_as(adm));
  perform pg_temp.check_as('is_app_admin false for non-admin', n, not pg_temp.is_admin_as(n));

  -- Every metrics RPC: non-admin gets not_app_admin, admin succeeds.
  perform pg_temp.check_as('metrics_active_users denies non-admin', n,
    pg_temp.call_metrics_as(n,
      format('select * from app.metrics_active_users(%L, %L)', p_from, p_to))
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_active_users allows admin', adm,
    pg_temp.call_metrics_as(adm,
      format('select * from app.metrics_active_users(%L, %L)', p_from, p_to))
    like 'ok:%');

  perform pg_temp.check_as('metrics_app_opens denies non-admin', n,
    pg_temp.call_metrics_as(n,
      format('select * from app.metrics_app_opens(%L, %L)', p_from, p_to))
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_app_opens allows admin', adm,
    pg_temp.call_metrics_as(adm,
      format('select * from app.metrics_app_opens(%L, %L)', p_from, p_to))
    like 'ok:%');

  perform pg_temp.check_as('metrics_imports denies non-admin', n,
    pg_temp.call_metrics_as(n,
      format('select * from app.metrics_imports(%L, %L)', p_from, p_to))
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_imports allows admin', adm,
    pg_temp.call_metrics_as(adm,
      format('select * from app.metrics_imports(%L, %L)', p_from, p_to))
    like 'ok:%');

  perform pg_temp.check_as('metrics_ai_cost denies non-admin', n,
    pg_temp.call_metrics_as(n,
      format('select * from app.metrics_ai_cost(%L, %L)', p_from, p_to))
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_ai_cost allows admin and returns rows', adm,
    pg_temp.call_metrics_as(adm,
      format('select * from app.metrics_ai_cost(%L, %L)', p_from, p_to))
    = 'ok:2');

  perform pg_temp.check_as('metrics_edge_failures denies non-admin', n,
    pg_temp.call_metrics_as(n,
      format('select * from app.metrics_edge_failures(%L, %L)', p_from, p_to))
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_edge_failures allows admin', adm,
    pg_temp.call_metrics_as(adm,
      format('select * from app.metrics_edge_failures(%L, %L)', p_from, p_to))
    like 'ok:%');

  perform pg_temp.check_as('metrics_stuck_imports denies non-admin', n,
    pg_temp.call_metrics_as(n, 'select * from app.metrics_stuck_imports()')
    = 'not_app_admin');
  perform pg_temp.check_as('metrics_stuck_imports allows admin and returns the stuck row', adm,
    pg_temp.call_metrics_as(adm, 'select * from app.metrics_stuck_imports()')
    = 'ok:1');

  -- metrics_ai_cost pricing correctness: a priced model computes usd and
  -- carries unpriced_calls=0; a model with no ai_model_prices row costs $0
  -- but is counted (not dropped) via unpriced_calls=1.
  perform pg_temp.check_as('metrics_ai_cost prices a known model correctly', adm,
    pg_temp.ai_cost_row_as(adm, p_from, p_to, 'claude-sonnet-5')
    = 'usd=0.0180|unpriced=0');
  perform pg_temp.check_as('metrics_ai_cost surfaces an unpriced model at $0, counted', adm,
    pg_temp.ai_cost_row_as(adm, p_from, p_to, 'pm-test-unpriced-model')
    = 'usd=0.0000|unpriced=1');

  -- analytics_events RLS: insert only, own profile_id only.
  perform pg_temp.check_as('cannot insert analytics_events for another profile', n,
    pg_temp.insert_event_as(n, oth) ilike '%row-level security%');
  perform pg_temp.check_as('can insert analytics_events for own profile', n,
    pg_temp.insert_event_as(n, n) = '1');

  -- No SELECT surface at all on analytics_events or ai_usage for authenticated.
  perform pg_temp.check_as('authenticated SELECT on analytics_events is denied', n,
    pg_temp.select_count_as(n, 'analytics_events') ilike '%permission denied%');
  perform pg_temp.check_as('authenticated SELECT on ai_usage is denied', n,
    pg_temp.select_count_as(n, 'ai_usage') ilike '%permission denied%');
end $$;

-- Output the TAP rows.
select label, ok from _t_results order by label;
