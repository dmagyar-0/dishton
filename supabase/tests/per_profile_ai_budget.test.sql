-- supabase/tests/per_profile_ai_budget.test.sql
-- TAP test for public.app_reserve_profile_ai_budget(profile, tokens).
--
-- The runner wraps the file in BEGIN/ROLLBACK so fixtures vanish. We seed one
-- profile, then exercise the per-profile token window:
--   * a reservation within budget succeeds and accrues tokens
--   * a reservation that would exceed budget_per_minute is denied
--   * a different profile has an independent budget
--   * after the window expires, the counter resets and reservations succeed

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','budget-c1@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','budget-c2@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000c1','Budget C1'),
  ('00000000-0000-0000-0000-0000000000c2','Budget C2')
on conflict (id) do nothing;

-- Pin a small per-minute budget for C1 so we can hit the cap deterministically.
-- (The row is upserted lazily by the RPC; insert it explicitly to set the cap.)
insert into app.ai_profile_budget (profile_id, budget_per_minute)
  values ('00000000-0000-0000-0000-0000000000c1', 1000)
on conflict (profile_id) do update set budget_per_minute = excluded.budget_per_minute;

create temporary table _t(
  first_ok boolean,
  second_ok boolean,
  other_ok boolean,
  reset_ok boolean
) on commit drop;

do $$
declare r1 boolean; r2 boolean; ro boolean; rr boolean;
begin
  -- 600 of 1000 — succeeds.
  select public.app_reserve_profile_ai_budget(
    '00000000-0000-0000-0000-0000000000c1', 600) into r1;
  -- another 600 would exceed 1000 — denied.
  select public.app_reserve_profile_ai_budget(
    '00000000-0000-0000-0000-0000000000c1', 600) into r2;
  -- a different profile is independent (default 20000 budget) — succeeds.
  select public.app_reserve_profile_ai_budget(
    '00000000-0000-0000-0000-0000000000c2', 600) into ro;
  -- expire C1's window, then a 600 reservation succeeds again (counter reset).
  update app.ai_profile_budget
     set window_started_at = now() - interval '120 seconds'
   where profile_id = '00000000-0000-0000-0000-0000000000c1';
  select public.app_reserve_profile_ai_budget(
    '00000000-0000-0000-0000-0000000000c1', 600) into rr;
  insert into _t(first_ok, second_ok, other_ok, reset_ok) values (r1, r2, ro, rr);
end $$;

with assertions(label, ok) as (values
  ('first reservation within budget succeeds', (select first_ok from _t)),
  ('over-budget reservation is denied', (select second_ok from _t) = false),
  ('other profile has an independent budget', (select other_ok from _t)),
  ('window reset re-allows reservations', (select reset_ok from _t)),
  ('C1 tokens_used reflects only the post-reset reservation',
   (select tokens_used from app.ai_profile_budget
     where profile_id = '00000000-0000-0000-0000-0000000000c1') = 600)
)
select label, ok from assertions;
