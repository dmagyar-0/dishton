-- supabase/tests/recipe_links.test.sql
-- RLS coverage for "save to pantry" links (recipe_links table). Pattern mirrors
-- recipe_shares.test.sql: fixtures, pg_temp persona helpers via
-- set_config('role', ...), a _t_results temp table emitted as the final SELECT,
-- transaction rollback.
--
-- Topology:
--   H1 = source household (owner A), holds recipe R1.
--   H2 = pantry household (owner B), FOLLOWS H1. Holds its own recipe R2.
--   H3 = unrelated household (owner D), does NOT follow H1.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000aa',
   'authenticated','authenticated','link-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000bb',
   'authenticated','authenticated','link-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000dd',
   'authenticated','authenticated','link-d@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000aa','Link A'),
  ('00000000-0000-0000-0000-0000000000bb','Link B'),
  ('00000000-0000-0000-0000-0000000000dd','Link D')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('cccccccc-0000-0000-0000-000000000011','Source H1',
   '00000000-0000-0000-0000-0000000000aa'),
  ('cccccccc-0000-0000-0000-000000000022','Pantry H2',
   '00000000-0000-0000-0000-0000000000bb'),
  ('cccccccc-0000-0000-0000-000000000033','Other H3',
   '00000000-0000-0000-0000-0000000000dd')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('cccccccc-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa','owner'),
  ('cccccccc-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-0000000000bb','owner'),
  ('cccccccc-0000-0000-0000-000000000033',
   '00000000-0000-0000-0000-0000000000dd','owner')
on conflict do nothing;

-- H2 follows H1 (one-way). H3 follows nobody.
insert into app.follows (follower_household_id, followed_household_id) values
  ('cccccccc-0000-0000-0000-000000000022','cccccccc-0000-0000-0000-000000000011')
on conflict do nothing;

-- R1 lives in the source household H1; R2 is H2's own recipe.
insert into app.recipes (id, household_id, created_by, title, source_type,
                         source_language, canonical_unit_system, servings) values
  ('dddddddd-0000-0000-0000-000000000011',
   'cccccccc-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa',
   'Source Stew','manual','en','metric',4),
  ('dddddddd-0000-0000-0000-000000000022',
   'cccccccc-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-0000000000bb',
   'My Own Soup','manual','en','metric',4)
on conflict (id) do nothing;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_ok(p_label text, p_check boolean)
returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

create or replace function pg_temp.q_as_insert_link(
  p_persona uuid, p_household uuid, p_recipe uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    insert into app.recipe_links (household_id, recipe_id, created_by)
      values (p_household, p_recipe, p_persona);
    get diagnostics n = row_count;
  exception when others then
    n := 0;
  end;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_link_count(
  p_persona uuid, p_household uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  select count(*) into n from app.recipe_links where household_id = p_household;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_delete_link(
  p_persona uuid, p_household uuid, p_recipe uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  delete from app.recipe_links
    where household_id = p_household and recipe_id = p_recipe;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. Owner B of the following household can link the followed recipe R1.
select pg_temp.check_ok(
  'B can link a followed recipe into their pantry',
  pg_temp.q_as_insert_link(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid,
    'dddddddd-0000-0000-0000-000000000011'::uuid) = 1);

-- 2. Member B can read their pantry link.
select pg_temp.check_ok(
  'B can read their pantry link',
  pg_temp.q_as_link_count(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid) = 1);

-- 3. Unrelated D (not a member/follower of H2) sees no link rows for H2.
select pg_temp.check_ok(
  'unrelated D cannot read H2 links',
  pg_temp.q_as_link_count(
    '00000000-0000-0000-0000-0000000000dd'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid) = 0);

-- 4. D cannot link R1 (D does not follow H1, so it is not visible to them).
select pg_temp.check_ok(
  'D cannot link a recipe they do not follow',
  pg_temp.q_as_insert_link(
    '00000000-0000-0000-0000-0000000000dd'::uuid,
    'cccccccc-0000-0000-0000-000000000033'::uuid,
    'dddddddd-0000-0000-0000-000000000011'::uuid) = 0);

-- 5. B cannot link into a household they do not edit (H3).
select pg_temp.check_ok(
  'B cannot link into a household they do not edit',
  pg_temp.q_as_insert_link(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'cccccccc-0000-0000-0000-000000000033'::uuid,
    'dddddddd-0000-0000-0000-000000000011'::uuid) = 0);

-- 6. Self-link is rejected: B cannot link H2's own recipe into H2.
select pg_temp.check_ok(
  'self-link of an own recipe is rejected',
  pg_temp.q_as_insert_link(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid,
    'dddddddd-0000-0000-0000-000000000022'::uuid) = 0);

-- 7. Deleting the original recipe cascades the link away.
delete from app.recipes where id = 'dddddddd-0000-0000-0000-000000000011';
select pg_temp.check_ok(
  'deleting the original removes the link (cascade)',
  (select count(*) = 0 from app.recipe_links
     where recipe_id = 'dddddddd-0000-0000-0000-000000000011'));

-- Re-create R1 + the link so the delete-permission assertions have a row.
insert into app.recipes (id, household_id, created_by, title, source_type,
                         source_language, canonical_unit_system, servings) values
  ('dddddddd-0000-0000-0000-000000000011',
   'cccccccc-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa',
   'Source Stew','manual','en','metric',4);
insert into app.recipe_links (household_id, recipe_id, created_by) values
  ('cccccccc-0000-0000-0000-000000000022',
   'dddddddd-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000bb');

-- 8. Unrelated D cannot remove B's link; editor B can.
select pg_temp.check_ok(
  'unrelated D cannot remove the link',
  pg_temp.q_as_delete_link(
    '00000000-0000-0000-0000-0000000000dd'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid,
    'dddddddd-0000-0000-0000-000000000011'::uuid) = 0);

select pg_temp.check_ok(
  'editor B can remove the link',
  pg_temp.q_as_delete_link(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'cccccccc-0000-0000-0000-000000000022'::uuid,
    'dddddddd-0000-0000-0000-000000000011'::uuid) = 1);

select label, ok from _t_results order by label;
