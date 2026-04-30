-- supabase/tests/rls.test.sql
-- RLS persona checks. Each subtest impersonates a profile inside a plpgsql
-- block (SET LOCAL ROLE so it doesn't leak), runs a query under
-- `authenticated`, and stores the result in a temp table. The runner wraps
-- the whole file in a transaction and rolls back, so the inserted fixtures
-- vanish.
--
-- Personas:
--   A = 00000000-0000-0000-0000-00000000000a  (member, household H1)
--   B = 00000000-0000-0000-0000-00000000000b  (member, household H1)
--   C = 00000000-0000-0000-0000-00000000000c  (member, household H2)
--                                              H1 follows H2
--   D = 00000000-0000-0000-0000-00000000000d  (unrelated)

------------------------------------------------------------------------------
-- Fixture: auth.users + profiles + households + members + follow + recipes.
-- We disable the on_auth_user_created trigger so we can set our own profile
-- display names rather than the email-prefix default.
------------------------------------------------------------------------------

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000a',
   'authenticated','authenticated','rls-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000b',
   'authenticated','authenticated','rls-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000c',
   'authenticated','authenticated','rls-c@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000d',
   'authenticated','authenticated','rls-d@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a','Persona A'),
  ('00000000-0000-0000-0000-00000000000b','Persona B'),
  ('00000000-0000-0000-0000-00000000000c','Persona C'),
  ('00000000-0000-0000-0000-00000000000d','Persona D')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','RLS H1',
   '00000000-0000-0000-0000-00000000000a'),
  ('aaaaaaaa-0000-0000-0000-000000000002','RLS H2',
   '00000000-0000-0000-0000-00000000000c')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000b','editor'),
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000c','owner')
on conflict do nothing;

insert into app.follows (follower_household_id, followed_household_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002')
on conflict do nothing;

-- One recipe per household
insert into app.recipes (id, household_id, created_by, title, source_type,
                          source_language, canonical_unit_system, servings) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a',
   'H1 Recipe','manual','en','metric',2),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000c',
   'H2 Recipe','manual','en','metric',2)
on conflict (id) do nothing;

-- An import_job for persona A
insert into app.import_jobs (id, profile_id, household_id, kind, status) values
  ('cccccccc-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'url','done')
on conflict (id) do nothing;

------------------------------------------------------------------------------
-- Results table; populated by per-persona DO blocks below. The temp table is
-- created as the postgres role; subsequent DO blocks that SET LOCAL ROLE will
-- not be able to write to it directly. Instead each DO block returns its
-- check value via a temporary GUC and the postgres-role caller inserts.
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

-- Tiny helper that runs a single check as the named persona and inserts a
-- (label, ok) pair into _t_results. Defined as plpgsql so SET LOCAL ROLE
-- scopes to the function call.
create or replace function pg_temp.check_as(
  p_label text, p_persona uuid, p_check boolean
) returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

-- Run a query as a persona and return its boolean result. We use a
-- SECURITY INVOKER plpgsql function with SET LOCAL inside the function body
-- to switch role for the duration of the inner query only.
create or replace function pg_temp.q_as_recipes_count(
  p_persona uuid, p_recipe uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select count(*) into n from app.recipes where id = p_recipe;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_update_recipe(
  p_persona uuid, p_recipe uuid, p_new_title text
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  update app.recipes set title = p_new_title where id = p_recipe;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_import_jobs_count(
  p_persona uuid, p_job uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select count(*) into n from app.import_jobs where id = p_job;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

select pg_temp.check_as(
  'A sees H1 recipe',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
  ) = 1);

select pg_temp.check_as(
  'A sees H2 recipe via follow',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid
  ) = 1);

select pg_temp.check_as(
  'A can UPDATE H1 recipe',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.q_as_update_recipe(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'edit by A'
  ) = 1);

select pg_temp.check_as(
  'A cannot UPDATE H2 recipe',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.q_as_update_recipe(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
    'hacked'
  ) = 0);

select pg_temp.check_as(
  'D cannot see H1 recipe',
  '00000000-0000-0000-0000-00000000000d'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000d'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
  ) = 0);

select pg_temp.check_as(
  'D cannot see H2 recipe',
  '00000000-0000-0000-0000-00000000000d'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000d'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid
  ) = 0);

select pg_temp.check_as(
  'D cannot UPDATE H1 recipe',
  '00000000-0000-0000-0000-00000000000d'::uuid,
  pg_temp.q_as_update_recipe(
    '00000000-0000-0000-0000-00000000000d'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
    'd-hack'
  ) = 0);

select pg_temp.check_as(
  'B cannot see A import_jobs',
  '00000000-0000-0000-0000-00000000000b'::uuid,
  pg_temp.q_as_import_jobs_count(
    '00000000-0000-0000-0000-00000000000b'::uuid,
    'cccccccc-0000-0000-0000-000000000001'::uuid
  ) = 0);

select pg_temp.check_as(
  'A sees own import_jobs',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.q_as_import_jobs_count(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'cccccccc-0000-0000-0000-000000000001'::uuid
  ) = 1);

select pg_temp.check_as(
  'C cannot see H1 recipe (one-way follow)',
  '00000000-0000-0000-0000-00000000000c'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000c'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
  ) = 0);

select pg_temp.check_as(
  'C sees own H2 recipe',
  '00000000-0000-0000-0000-00000000000c'::uuid,
  pg_temp.q_as_recipes_count(
    '00000000-0000-0000-0000-00000000000c'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid
  ) = 1);

-- Output the TAP rows.
select label, ok from _t_results order by label;
