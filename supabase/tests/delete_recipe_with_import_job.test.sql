-- Regression test for the bug seen on prod 2026-05-26:
--   ERROR: update or delete on table "recipes" violates foreign key
--   constraint "import_jobs_recipe_id_fkey" on table "import_jobs"
--
-- Every successful import patches the matching app.import_jobs row with the
-- new recipe id (see src/lib/imports/ActiveImportsProvider.tsx). The original
-- FK had no ON DELETE action, so the back-pointer pinned the recipe forever.
-- Fixed in 20260526120000_import_jobs_recipe_set_null.sql by switching the
-- FK to ON DELETE SET NULL -- preserving the import-job audit row but
-- dropping the back-pointer.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','drwij-owner@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b1','Owner')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id, is_personal) values
  ('dddddddd-0000-0000-0000-000000000001','Owner Home',
   '00000000-0000-0000-0000-0000000000b1', false)
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1','owner')
on conflict do nothing;

insert into app.recipes (id, household_id, created_by, title,
                         source_type, canonical_unit_system, servings) values
  ('dddddddd-0000-0000-0000-0000000000aa',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'Imported recipe', 'url', 'metric', 4)
on conflict (id) do nothing;

-- Repro condition: an import_jobs row pointing at the recipe, as
-- ActiveImportsProvider writes on a successful import.
insert into app.import_jobs (id, profile_id, household_id, kind, status,
                             recipe_id) values
  ('dddddddd-aaaa-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1',
   'dddddddd-0000-0000-0000-000000000001',
   'url', 'done',
   'dddddddd-0000-0000-0000-0000000000aa')
on conflict (id) do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

do $$
declare
  owner uuid := '00000000-0000-0000-0000-0000000000b1';
  recipe uuid := 'dddddddd-0000-0000-0000-0000000000aa';
  job uuid := 'dddddddd-aaaa-0000-0000-000000000001';
  msg text;
  recipe_left int;
  job_left int;
  job_recipe_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner::text, 'role', 'authenticated')::text, true);
  begin
    delete from app.recipes where id = recipe;
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  insert into _t_results(label, ok)
    values ('owner can delete an imported recipe',
            msg = 'ok');

  select count(*) into recipe_left
  from app.recipes where id = recipe;
  insert into _t_results(label, ok)
    values ('recipe row is gone after delete',
            recipe_left = 0);

  -- The import_jobs audit row survives the recipe delete.
  select count(*) into job_left
  from app.import_jobs where id = job;
  insert into _t_results(label, ok)
    values ('import_jobs row preserved after recipe delete',
            job_left = 1);

  -- Back-pointer was nulled out.
  select recipe_id into job_recipe_id
  from app.import_jobs where id = job;
  insert into _t_results(label, ok)
    values ('import_jobs.recipe_id set to null after recipe delete',
            job_recipe_id is null);
end;
$$;

select label, ok from _t_results order by label;
