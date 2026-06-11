-- supabase/tests/recipe_shares.test.sql
-- RLS + RPC coverage for public recipe share links (recipe_shares table,
-- get_public_recipe RPC, shared-hero storage branch). Pattern mirrors
-- rls.test.sql: fixtures, pg_temp persona helpers via set_config('role', ...),
-- a _t_results temp table emitted as the final SELECT, transaction rollback.
--
-- Personas:
--   A = 00000000-0000-0000-0000-0000000000aa  (owner, household S1)
--   B = 00000000-0000-0000-0000-0000000000bb  (editor, household S1)
--   D = 00000000-0000-0000-0000-0000000000dd  (unrelated)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000aa',
   'authenticated','authenticated','share-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000bb',
   'authenticated','authenticated','share-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000dd',
   'authenticated','authenticated','share-d@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000aa','Share A'),
  ('00000000-0000-0000-0000-0000000000bb','Share B'),
  ('00000000-0000-0000-0000-0000000000dd','Share D')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('aaaaaaaa-0000-0000-0000-000000000011','Share H1',
   '00000000-0000-0000-0000-0000000000aa'),
  ('aaaaaaaa-0000-0000-0000-000000000022','Share H2',
   '00000000-0000-0000-0000-0000000000dd')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000bb','editor'),
  ('aaaaaaaa-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-0000000000dd','owner')
on conflict do nothing;

insert into app.recipes (id, household_id, created_by, title, description,
                         source_type, source_language, canonical_unit_system,
                         servings, total_time_min, hero_image_path) values
  ('bbbbbbbb-0000-0000-0000-000000000011',
   'aaaaaaaa-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa',
   'Shared Tarte','Best eaten warm.','manual','en','metric',4,55,
   '00000000-0000-0000-0000-0000000000aa/shared-hero.jpg')
on conflict (id) do nothing;

insert into app.recipe_ingredients (recipe_id, position, raw_text, quantity, unit, ingredient_name, section) values
  ('bbbbbbbb-0000-0000-0000-000000000011',0,'500 g tomatoes','500'::jsonb,'g','tomatoes',null),
  ('bbbbbbbb-0000-0000-0000-000000000011',1,'1 sheet pastry','1'::jsonb,'count','pastry',null)
on conflict do nothing;

insert into app.recipe_steps (recipe_id, position, body, duration_min) values
  ('bbbbbbbb-0000-0000-0000-000000000011',0,'Bake it.',25)
on conflict do nothing;

insert into app.recipe_tags (recipe_id, tag) values
  ('bbbbbbbb-0000-0000-0000-000000000011','tomato')
on conflict do nothing;

-- Hero object in the private bucket. The stub schema leaves RLS off on
-- storage.objects; the real stack has it on already (and postgres can't ALTER
-- the storage-owned table there), so enable it only when needed.
insert into storage.buckets (id, name, public)
  values ('recipe-images','recipe-images', false)
on conflict (id) do nothing;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    execute 'alter table storage.objects enable row level security';
  end if;
end $$;

insert into storage.objects (bucket_id, name)
  values ('recipe-images','00000000-0000-0000-0000-0000000000aa/shared-hero.jpg');

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

-- Run an insert into recipe_shares as a persona; returns rows inserted.
create or replace function pg_temp.q_as_insert_share(
  p_persona uuid, p_recipe uuid, p_token text
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  begin
    insert into app.recipe_shares (recipe_id, token, created_by)
      values (p_recipe, p_token, p_persona);
    get diagnostics n = row_count;
  exception when others then
    n := 0;
  end;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_share_count(
  p_persona uuid, p_recipe uuid
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select count(*) into n from app.recipe_shares where recipe_id = p_recipe;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

create or replace function pg_temp.q_as_delete_share(
  p_persona uuid, p_recipe uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  delete from app.recipe_shares where recipe_id = p_recipe;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- True when selecting recipe_shares as the anon role raises
-- insufficient_privilege (no grant at all for anon).
create or replace function pg_temp.q_anon_shares_denied()
returns boolean language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from app.recipe_shares;
    perform set_config('role', 'postgres', true);
    return false;
  exception when insufficient_privilege then
    perform set_config('role', 'postgres', true);
    return true;
  end;
end;
$$;

create or replace function pg_temp.q_anon_get_public(p_token text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select app.get_public_recipe(p_token) into result;
  perform set_config('role', 'postgres', true);
  return result;
end;
$$;

create or replace function pg_temp.q_anon_hero_count(p_name text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from storage.objects where name = p_name;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. Editor B can create a share for an S1 recipe.
select pg_temp.check_ok(
  'editor B can insert a share',
  pg_temp.q_as_insert_share(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000011'::uuid,
    'feedfeedfeedfeedfeedfeedfeedfeed') = 1);

-- 2. Member A can read the share row.
select pg_temp.check_ok(
  'member A can read the share token',
  pg_temp.q_as_share_count(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000011'::uuid) = 1);

-- 3. Unrelated D sees nothing.
select pg_temp.check_ok(
  'unrelated D sees no share rows',
  pg_temp.q_as_share_count(
    '00000000-0000-0000-0000-0000000000dd'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000011'::uuid) = 0);

-- 4. The anon role has no table access at all.
select pg_temp.check_ok(
  'anon role cannot select recipe_shares',
  pg_temp.q_anon_shares_denied());

-- 5. Anon RPC returns the whitelisted payload for a live token.
select pg_temp.check_ok(
  'anon get_public_recipe returns the payload',
  (select p->'recipe'->>'title' = 'Shared Tarte'
      and p->>'household_name' = 'Share H1'
      and jsonb_array_length(p->'recipe'->'ingredients') = 2
      and jsonb_array_length(p->'recipe'->'steps') = 1
      and p->'recipe'->'tags' = '["tomato"]'::jsonb
   from pg_temp.q_anon_get_public('feedfeedfeedfeedfeedfeedfeedfeed') as p));

-- 6. The payload leaks no identifiers.
select pg_temp.check_ok(
  'payload exposes no ids',
  (select not (p->'recipe' ?| array['id','household_id','created_by'])
      and not (p ? 'recipe_id')
   from pg_temp.q_anon_get_public('feedfeedfeedfeedfeedfeedfeedfeed') as p));

-- 7. Unknown tokens resolve to null.
select pg_temp.check_ok(
  'unknown token returns null',
  pg_temp.q_anon_get_public('0000000000000000000000000000dead') is null);

-- 8. Anon can read the hero object while the share is live.
select pg_temp.check_ok(
  'anon reads shared hero object',
  pg_temp.q_anon_hero_count('00000000-0000-0000-0000-0000000000aa/shared-hero.jpg') = 1);

-- 9. Kill switch: flag off -> RPC null (rollback restores the flag).
update app.feature_flags set enabled = false where key = 'public_recipe_shares';
select pg_temp.check_ok(
  'flag off returns null',
  pg_temp.q_anon_get_public('feedfeedfeedfeedfeedfeedfeedfeed') is null);
update app.feature_flags set enabled = true where key = 'public_recipe_shares';

-- 10. Unrelated D cannot revoke; editor B can.
select pg_temp.check_ok(
  'unrelated D cannot delete the share',
  pg_temp.q_as_delete_share(
    '00000000-0000-0000-0000-0000000000dd'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000011'::uuid) = 0);

select pg_temp.check_ok(
  'editor B can delete the share',
  pg_temp.q_as_delete_share(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000011'::uuid) = 1);

-- 11. Revocation kills the token and the hero read.
select pg_temp.check_ok(
  'revoked token returns null',
  pg_temp.q_anon_get_public('feedfeedfeedfeedfeedfeedfeedfeed') is null);

select pg_temp.check_ok(
  'anon hero read dies with the share',
  pg_temp.q_anon_hero_count('00000000-0000-0000-0000-0000000000aa/shared-hero.jpg') = 0);

select label, ok from _t_results order by label;
