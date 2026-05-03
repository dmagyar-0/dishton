-- supabase/tests/imports_reaper.test.sql
-- TAP test for app.reap_stuck_imports().
--
-- The runner wraps the file in BEGIN/ROLLBACK so the fixtures vanish.
-- We seed two profiles, four import_jobs rows in different states/ages, then
-- call the reaper as the first profile and assert that:
--   * stale-running rows owned by the caller flip to failed/timeout
--   * fresh-running rows are untouched
--   * already-terminal rows are untouched
--   * other profiles' stale-running rows are NOT reaped (RLS scopes the call)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','reap-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','reap-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1','Reap A'),
  ('00000000-0000-0000-0000-0000000000b2','Reap B')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('cccccccc-0000-0000-0000-0000000000aa','Reap H',
   '00000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('cccccccc-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000000a1','owner'),
  ('cccccccc-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000000b2','editor')
on conflict do nothing;

-- Four jobs with explicit created_at:
--   J1 = A, running, 5 min old      -> should be reaped
--   J2 = A, running, 1 min old      -> should be left alone
--   J3 = A, done,    5 min old      -> should be left alone
--   J4 = B, running, 5 min old      -> RLS hides from A's reaper
insert into app.import_jobs (id, profile_id, household_id, kind, status, created_at) values
  ('11111111-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1',
   'cccccccc-0000-0000-0000-0000000000aa',
   'manual','running', now() - interval '5 minutes'),
  ('11111111-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a1',
   'cccccccc-0000-0000-0000-0000000000aa',
   'manual','running', now() - interval '1 minute'),
  ('11111111-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-0000000000a1',
   'cccccccc-0000-0000-0000-0000000000aa',
   'manual','done',    now() - interval '5 minutes'),
  ('11111111-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-0000000000b2',
   'cccccccc-0000-0000-0000-0000000000aa',
   'manual','running', now() - interval '5 minutes')
on conflict (id) do nothing;

create temporary table _t_state(reaped_count int) on commit drop;

-- Run the reaper as profile A.
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1',
                      'role','authenticated')::text,
    true);
  select app.reap_stuck_imports() into n;
  perform set_config('role', 'postgres', true);
  insert into _t_state(reaped_count) values (n);
end $$;

with assertions(label, ok) as (values
  ('reap_stuck_imports returns 1 (only A''s stale running row)',
   (select reaped_count from _t_state) = 1),

  ('J1 (A, stale running) is now failed',
   (select status from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000001') = 'failed'),
  ('J1 carries error=timeout',
   (select error from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000001') = 'timeout'),
  ('J1 has completed_at set',
   (select completed_at is not null from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000001')),

  ('J2 (A, fresh running) still running',
   (select status from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000002') = 'running'),
  ('J2 has no error',
   (select error from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000002') is null),

  ('J3 (A, done) is unchanged',
   (select status from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000003') = 'done'),

  ('J4 (B, stale running) is NOT reaped by A',
   (select status from app.import_jobs
     where id = '11111111-0000-0000-0000-000000000004') = 'running')
)
select label, ok from assertions;
