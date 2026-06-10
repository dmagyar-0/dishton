-- supabase/tests/security_hardening.test.sql
-- Persona checks for the 2026-06-10 security hardening migration:
--   1 — household_members_self_insert: an outsider can no longer insert
--       themselves as OWNER of someone else's household (the takeover hole);
--       the legitimate create-household bootstrap still works.
--   2 — import_jobs: INSERT requires membership of the target household;
--       household_id is frozen on UPDATE.
--   3 — households_owner_delete: personal households cannot be deleted via a
--       direct table DELETE; shared ones still can.
--   4 — filter_household_tags: direct EXECUTE revoked from authenticated.
--   5 — recipe_chat_sessions.recipe_id: ON DELETE SET NULL.
--   6 — hero_image_path guard in save_recipe / update_recipe.
--   7 — app_refund_ai_budget: service_role only.
--   8 — reap_stuck_imports deletes terminal rows older than 30 days.
--
-- Personas:
--   O = ...0000000000b1  (owner of shared SH1; owns personal SPP)
--   M = ...0000000000b2  (editor of SH1)
--   X = ...0000000000b3  (owner of shared SH2; outsider to SH1)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','sh-o@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','sh-m@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b3',
   'authenticated','authenticated','sh-x@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b1','Persona SH O'),
  ('00000000-0000-0000-0000-0000000000b2','Persona SH M'),
  ('00000000-0000-0000-0000-0000000000b3','Persona SH X')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id, is_personal, allowed_tags) values
  ('dddddddd-0000-0000-0000-000000000001','SH Shared 1',
   '00000000-0000-0000-0000-0000000000b1', false, array['main']::text[]),
  ('dddddddd-0000-0000-0000-000000000002','SH Shared 2',
   '00000000-0000-0000-0000-0000000000b3', false, array['main']::text[]),
  ('dddddddd-0000-0000-0000-0000000000e1','SH Personal O',
   '00000000-0000-0000-0000-0000000000b1', true, array['main']::text[]),
  ('dddddddd-0000-0000-0000-0000000000e2','SH Throwaway O',
   '00000000-0000-0000-0000-0000000000b1', false, array['main']::text[])
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1','owner'),
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b2','editor'),
  ('dddddddd-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000b3','owner'),
  ('dddddddd-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000b1','owner'),
  ('dddddddd-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-0000000000b1','owner')
on conflict do nothing;

-- A recipe in SH1 with a legacy hero path inside X's storage folder (simulates
-- a pre-guard row whose hero was uploaded by a since-departed member).
insert into app.recipes (id, household_id, created_by, title, source_type,
                         source_language, canonical_unit_system, servings,
                         hero_image_path) values
  ('cccccccc-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'SH Legacy Hero','manual','en','metric',2,
   '00000000-0000-0000-0000-0000000000b3/legacy.jpg'),
  ('cccccccc-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'SH Chat Target','manual','en','metric',2, null)
on conflict (id) do nothing;

-- A chat session pointing at the second recipe (FK behaviour check).
insert into app.recipe_chat_sessions
  (id, household_id, created_by, anthropic_session_id, status, recipe_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'sesn_sh_test_1','saved',
   'cccccccc-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- An ancient terminal import job for O (retention check).
insert into app.import_jobs
  (id, profile_id, household_id, kind, status, payload, created_at, completed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'dddddddd-0000-0000-0000-000000000001',
   'url','done','{}'::jsonb,
   now() - interval '40 days', now() - interval '35 days')
on conflict (id) do nothing;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

-- Insert a household_members row as a persona; returns affected row count,
-- or -1 when the statement raised (RLS violations raise on INSERT).
create or replace function pg_temp.insert_member_as(
  p_persona uuid, p_household uuid, p_role text
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    insert into app.household_members (household_id, profile_id, role)
      values (p_household, p_persona, p_role);
    get diagnostics n = row_count;
    perform set_config('role', 'postgres', true);
    return n;
  exception when others then
    perform set_config('role', 'postgres', true);
    return -1;
  end;
end;
$$;

-- Create a (shared) household as a persona, returning its id; mirrors the
-- onboarding bootstrap INSERT ... RETURNING.
create or replace function pg_temp.create_household_as(
  p_persona uuid, p_name text
) returns uuid language plpgsql as $$
declare new_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  insert into app.households (name, owner_profile_id)
    values (p_name, p_persona)
    returning id into new_id;
  perform set_config('role', 'postgres', true);
  return new_id;
end;
$$;

-- Insert an import job as a persona; returns row count or -1 on error.
create or replace function pg_temp.insert_import_job_as(
  p_persona uuid, p_household uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    insert into app.import_jobs (profile_id, household_id, kind, status)
      values (p_persona, p_household, 'url', 'running');
    get diagnostics n = row_count;
    perform set_config('role', 'postgres', true);
    return n;
  exception when others then
    perform set_config('role', 'postgres', true);
    return -1;
  end;
end;
$$;

-- Move one of the persona's own import jobs to another household; returns
-- 'ok', or the error message (the freeze trigger should raise).
create or replace function pg_temp.retarget_import_job_as(
  p_persona uuid, p_to_household uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    update app.import_jobs
       set household_id = p_to_household
     where profile_id = p_persona;
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Direct DELETE of a household as a persona; returns affected row count.
create or replace function pg_temp.delete_household_direct_as(
  p_persona uuid, p_household uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  delete from app.households where id = p_household;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- save_recipe with an explicit hero path; returns 'ok' or the error message.
create or replace function pg_temp.save_with_hero_as(
  p_persona uuid, p_household uuid, p_hero text
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.save_recipe(p_household, jsonb_build_object(
      'title', 'Hero guard probe',
      'description', null,
      'source_type', 'manual',
      'source_url', null,
      'source_language', 'en',
      'canonical_unit_system', 'metric',
      'servings', 2,
      'total_time_min', null,
      'hero_image_path', p_hero,
      'tags', '[]'::jsonb,
      'ingredients', '[]'::jsonb,
      'steps', '[]'::jsonb
    ));
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- update_recipe overriding only the hero path (token skipped with null);
-- returns 'ok' or the error message.
create or replace function pg_temp.update_hero_as(
  p_persona uuid, p_recipe uuid, p_hero text
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.update_recipe(p_recipe, jsonb_build_object(
      'title', 'Hero guard probe (update)',
      'description', null,
      'source_type', 'manual',
      'source_url', null,
      'source_language', 'en',
      'canonical_unit_system', 'metric',
      'servings', 2,
      'total_time_min', null,
      'hero_image_path', p_hero,
      'tags', '[]'::jsonb,
      'ingredients', '[]'::jsonb,
      'steps', '[]'::jsonb
    ), null);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Call an arbitrary zero-result function as a persona, returning 'ok' or the
-- error message. Used for the EXECUTE-revocation probes.
create or replace function pg_temp.probe_filter_tags_as(
  p_persona uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.filter_household_tags(
      'dddddddd-0000-0000-0000-000000000002'::uuid, '["main"]'::jsonb);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

create or replace function pg_temp.probe_refund_global_as(
  p_persona uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform public.app_refund_ai_budget(100);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Run reap_stuck_imports as a persona; returns the reaped count or -1.
create or replace function pg_temp.reap_as(p_persona uuid)
returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    select app.reap_stuck_imports() into n;
    perform set_config('role', 'postgres', true);
    return n;
  exception when others then
    perform set_config('role', 'postgres', true);
    return -1;
  end;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. Outsider X cannot insert themselves as owner of SH1 (the takeover hole).
insert into _t_results(label, ok)
select 'outsider cannot self-insert as owner of foreign household',
       pg_temp.insert_member_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         'owner') = -1;

-- 1. Nor as editor.
insert into _t_results(label, ok)
select 'outsider cannot self-insert as editor of foreign household',
       pg_temp.insert_member_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         'editor') = -1;

-- 1. The create-household bootstrap still works end to end.
do $$
declare hh uuid; n int;
begin
  hh := pg_temp.create_household_as(
    '00000000-0000-0000-0000-0000000000b3'::uuid, 'SH Bootstrap');
  n := pg_temp.insert_member_as(
    '00000000-0000-0000-0000-0000000000b3'::uuid, hh, 'owner');
  insert into _t_results(label, ok)
    values ('household creator can bootstrap their owner row', n = 1);
end $$;

-- 2. Import job inserts are membership-checked.
insert into _t_results(label, ok)
select 'import job cannot target a foreign household',
       pg_temp.insert_import_job_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid) = -1;

insert into _t_results(label, ok)
select 'import job into own household succeeds',
       pg_temp.insert_import_job_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid,
         'dddddddd-0000-0000-0000-000000000002'::uuid) = 1;

-- 2. household_id is frozen after insert.
insert into _t_results(label, ok)
select 'import job household_id is immutable',
       pg_temp.retarget_import_job_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid)
       = 'import_jobs_identity_immutable';

-- 3. Personal household survives a direct DELETE; throwaway shared one does not.
insert into _t_results(label, ok)
select 'personal household cannot be deleted directly',
       pg_temp.delete_household_direct_as(
         '00000000-0000-0000-0000-0000000000b1'::uuid,
         'dddddddd-0000-0000-0000-0000000000e1'::uuid) = 0;

insert into _t_results(label, ok)
select 'shared household can still be deleted by its owner',
       pg_temp.delete_household_direct_as(
         '00000000-0000-0000-0000-0000000000b1'::uuid,
         'dddddddd-0000-0000-0000-0000000000e2'::uuid) = 1;

-- 4. filter_household_tags is not directly callable.
insert into _t_results(label, ok)
select 'filter_household_tags EXECUTE revoked from authenticated',
       pg_temp.probe_filter_tags_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid)
       ilike '%permission denied%';

-- 6. Hero guard: foreign-folder paths are rejected on save.
insert into _t_results(label, ok)
select 'save_recipe rejects foreign-folder hero path',
       pg_temp.save_with_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         '00000000-0000-0000-0000-0000000000b1/steal.jpg')
       = 'invalid_hero_image_path';

insert into _t_results(label, ok)
select 'save_recipe accepts own-folder hero path',
       pg_temp.save_with_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         '00000000-0000-0000-0000-0000000000b2/mine.jpg') = 'ok';

insert into _t_results(label, ok)
select 'save_recipe accepts remote http(s) hero',
       pg_temp.save_with_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         'https://example.com/hero.jpg') = 'ok';

insert into _t_results(label, ok)
select 'save_recipe accepts null hero',
       pg_temp.save_with_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'dddddddd-0000-0000-0000-000000000001'::uuid,
         null) = 'ok';

-- 6. update_recipe round-trips an unchanged legacy path but rejects a new
--    foreign-folder one.
insert into _t_results(label, ok)
select 'update_recipe keeps an unchanged legacy hero path',
       pg_temp.update_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'cccccccc-0000-0000-0000-000000000001'::uuid,
         '00000000-0000-0000-0000-0000000000b3/legacy.jpg') = 'ok';

insert into _t_results(label, ok)
select 'update_recipe rejects a new foreign-folder hero path',
       pg_temp.update_hero_as(
         '00000000-0000-0000-0000-0000000000b2'::uuid,
         'cccccccc-0000-0000-0000-000000000001'::uuid,
         '00000000-0000-0000-0000-0000000000b3/other.jpg')
       = 'invalid_hero_image_path';

-- 5. Deleting a recipe nulls the chat session's recipe_id instead of failing.
do $$
declare hero text; rid uuid;
begin
  delete from app.recipes where id = 'cccccccc-0000-0000-0000-000000000002';
  select recipe_id into rid from app.recipe_chat_sessions
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  insert into _t_results(label, ok)
    values ('chat session survives recipe delete with recipe_id nulled',
            rid is null);
end $$;

-- 7. Global budget refund is service_role-only.
insert into _t_results(label, ok)
select 'app_refund_ai_budget denied to authenticated',
       pg_temp.probe_refund_global_as(
         '00000000-0000-0000-0000-0000000000b3'::uuid)
       ilike '%permission denied%';

-- 8. Retention: the 40-day-old terminal job is deleted by the owner's reap.
do $$
declare n int; remaining int;
begin
  n := pg_temp.reap_as('00000000-0000-0000-0000-0000000000b1'::uuid);
  select count(*) into remaining from app.import_jobs
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into _t_results(label, ok)
    values ('reap_stuck_imports deletes terminal rows older than 30 days',
            n >= 1 and remaining = 0);
end $$;

-- Output the TAP rows.
select label, ok from _t_results order by label;
