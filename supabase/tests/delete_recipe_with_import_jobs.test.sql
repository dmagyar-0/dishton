-- Regression test for the bug seen on prod 2026-06-06:
--   ERROR: update or delete on table "recipes" violates foreign key
--   constraint "import_jobs_recipe_id_fkey" on table "import_jobs"
--
-- Every recipe created from an import keeps an app.import_jobs row pointing at
-- it via recipe_id. That FK was created ON DELETE NO ACTION (the column in
-- 20260430120200_imports.sql carried no ON DELETE clause), so deleting an
-- imported recipe through the SPA's `delete from app.recipes` path
-- (useDeleteRecipe) was rejected by the FK. Fixed by switching the FK to
-- ON DELETE SET NULL: import_jobs is an audit log of import attempts, so the
-- job row is kept and only its dangling recipe pointer is nulled.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','del-owner@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000d1','Deleter')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id, is_personal) values
  ('dddddddd-0000-0000-0000-000000000001','Delete Home',
   '00000000-0000-0000-0000-0000000000d1', false)
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000d1','owner')
on conflict do nothing;

-- A recipe that was created from an import.
insert into app.recipes
  (id, household_id, created_by, title, source_type, canonical_unit_system, servings)
values
  ('dddddddd-1111-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000d1',
   'Imported Dish', 'url', 'metric', 4)
on conflict (id) do nothing;

-- A child row, to prove the cascade path still works after the FK change.
insert into app.recipe_ingredients (recipe_id, position, raw_text) values
  ('dddddddd-1111-0000-0000-000000000001', 0, '2 cups flour')
on conflict do nothing;

-- The repro condition: an import_jobs row pinned to that recipe. Before the
-- fix this row blocks the recipe delete with a NO-ACTION FK violation.
insert into app.import_jobs (id, profile_id, household_id, kind, status, recipe_id)
values
  ('dddddddd-aaaa-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000d1',
   'dddddddd-0000-0000-0000-000000000001',
   'url', 'done',
   'dddddddd-1111-0000-0000-000000000001')
on conflict (id) do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

-- Delete the recipe as the authenticated household owner -- the exact path the
-- SPA takes (RLS recipes_member_write allows it; the FK used to block it).
do $$
declare
  owner          uuid := '00000000-0000-0000-0000-0000000000d1';
  rec            uuid := 'dddddddd-1111-0000-0000-000000000001';
  job            uuid := 'dddddddd-aaaa-0000-0000-000000000001';
  msg            text;
  recipe_left    int;
  ing_left       int;
  job_left       int;
  job_recipe_id  uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner::text, 'role', 'authenticated')::text, true);
  begin
    delete from app.recipes where id = rec;
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  insert into _t_results(label, ok)
    values ('delete of imported recipe succeeds (was FK-blocked)', msg = 'ok');

  select count(*) into recipe_left from app.recipes where id = rec;
  insert into _t_results(label, ok)
    values ('recipe row removed', recipe_left = 0);

  select count(*) into ing_left
  from app.recipe_ingredients where recipe_id = rec;
  insert into _t_results(label, ok)
    values ('recipe_ingredients cascade-deleted', ing_left = 0);

  -- import_jobs is an audit log: the row survives, its recipe pointer nulls.
  select count(*) into job_left from app.import_jobs where id = job;
  insert into _t_results(label, ok)
    values ('import_jobs row preserved (not cascade-deleted)', job_left = 1);

  select recipe_id into job_recipe_id from app.import_jobs where id = job;
  insert into _t_results(label, ok)
    values ('import_jobs.recipe_id nulled out', job_recipe_id is null);
end;
$$;

select label, ok from _t_results order by label;
