-- supabase/tests/search_and_tags.test.sql
-- Persona checks for the search/tags RPCs (app.search_recipes,
-- app.popular_tags). Mirrors the style of rls.test.sql: a fixture is inserted
-- as the postgres role, then each assertion runs the RPC under the
-- `authenticated` role with a forged jwt sub so RLS applies exactly as it does
-- for the SPA. The whole file runs inside a transaction the runner rolls back.
--
-- Personas:
--   A = ...0a  (member, household S1 — owns recipes)
--   B = ...0b  (member, household S2 — S1 follows S2)
--   D = ...0d  (unrelated; no membership, no follow)
--
-- S1 follows S2 (one-way), so A can search across S1 + S2 but B/D cannot reach
-- S1.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000a',
   'authenticated','authenticated','search-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000b',
   'authenticated','authenticated','search-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000d',
   'authenticated','authenticated','search-d@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a','Search A'),
  ('00000000-0000-0000-0000-00000000000b','Search B'),
  ('00000000-0000-0000-0000-00000000000d','Search D')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('dddddddd-0000-0000-0000-000000000001','Search S1',
   '00000000-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000002','Search S2',
   '00000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a','owner'),
  ('dddddddd-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000b','owner')
on conflict do nothing;

-- S1 follows S2 (one-way).
insert into app.follows (follower_household_id, followed_household_id) values
  ('dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000002')
on conflict do nothing;

-- Recipes. The FTS tsvector is maintained by triggers, so inserting rows is
-- enough; the search column is populated automatically.
--   S1: "Tomato Basil Soup"  (tag: soup; ingredient: tomato)
--   S2: "Roasted Garlic Bread" (tag: bread; ingredient: garlic)
insert into app.recipes (id, household_id, created_by, title, source_type,
                          source_language, canonical_unit_system, servings) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a',
   'Tomato Basil Soup','manual','en','metric',4),
  ('eeeeeeee-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000b',
   'Roasted Garlic Bread','manual','en','metric',6)
on conflict (id) do nothing;

insert into app.recipe_tags (recipe_id, tag) values
  ('eeeeeeee-0000-0000-0000-000000000001','soup'),
  ('eeeeeeee-0000-0000-0000-000000000001','vegetarian'),
  ('eeeeeeee-0000-0000-0000-000000000002','bread'),
  ('eeeeeeee-0000-0000-0000-000000000002','vegetarian')
on conflict do nothing;

insert into app.recipe_ingredients (recipe_id, position, raw_text, ingredient_name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 0, '2 ripe tomatoes', 'tomato'),
  ('eeeeeeee-0000-0000-0000-000000000001', 1, 'fresh basil leaves', 'basil'),
  ('eeeeeeee-0000-0000-0000-000000000002', 0, '4 cloves garlic', 'garlic')
on conflict do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_as(
  p_label text, p_check boolean
) returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

-- Run app.search_recipes as a persona and return the row count.
create or replace function pg_temp.search_count(
  p_persona uuid, p_q text, p_households uuid[]
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select count(*) into n from app.search_recipes(p_q, p_households);
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- True if app.search_recipes returns the given recipe id for this persona.
create or replace function pg_temp.search_has(
  p_persona uuid, p_q text, p_households uuid[], p_recipe uuid
) returns boolean language plpgsql as $$
declare found boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select exists(
    select 1 from app.search_recipes(p_q, p_households) where id = p_recipe
  ) into found;
  perform set_config('role', 'postgres', true);
  return found;
end;
$$;

-- Number of popular_tags rows for this persona/scope.
create or replace function pg_temp.tags_count(
  p_persona uuid, p_households uuid[], p_limit int
) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select count(*) into n from app.popular_tags(p_households, p_limit);
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- True if popular_tags is ordered by descending count then ascending tag.
create or replace function pg_temp.tags_ordered(
  p_persona uuid, p_households uuid[]
) returns boolean language plpgsql as $$
declare ordered boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  -- Compare the natural RPC order against an explicit ORDER BY of the same set.
  select array_agg(tag) = (
    select array_agg(tag order by n desc, tag asc)
    from app.popular_tags(p_households, 24)
  )
  into ordered
  from app.popular_tags(p_households, 24);
  perform set_config('role', 'postgres', true);
  return ordered;
end;
$$;

-- The top tag (most used across S1 + S2) should be "vegetarian" (count 2).
create or replace function pg_temp.tags_top(
  p_persona uuid, p_households uuid[]
) returns text language plpgsql as $$
declare top text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  select tag into top from app.popular_tags(p_households, 24) limit 1;
  perform set_config('role', 'postgres', true);
  return top;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- Find by title.
select pg_temp.check_as(
  'A finds S1 recipe by title',
  pg_temp.search_has(
    '00000000-0000-0000-0000-00000000000a'::uuid, 'tomato',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[],
    'eeeeeeee-0000-0000-0000-000000000001'::uuid));

-- Find by tag (the tag is weighted into the tsvector).
select pg_temp.check_as(
  'A finds S1 recipe by tag',
  pg_temp.search_has(
    '00000000-0000-0000-0000-00000000000a'::uuid, 'soup',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[],
    'eeeeeeee-0000-0000-0000-000000000001'::uuid));

-- Find by ingredient name.
select pg_temp.check_as(
  'A finds S1 recipe by ingredient',
  pg_temp.search_has(
    '00000000-0000-0000-0000-00000000000a'::uuid, 'basil',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[],
    'eeeeeeee-0000-0000-0000-000000000001'::uuid));

-- Follower scoping: A follows S2, so A finds S2's recipe.
select pg_temp.check_as(
  'A finds followed S2 recipe by title',
  pg_temp.search_has(
    '00000000-0000-0000-0000-00000000000a'::uuid, 'garlic',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[],
    'eeeeeeee-0000-0000-0000-000000000002'::uuid));

-- One-way follow: B does NOT follow S1, so even if B asks for S1 in scope,
-- RLS strips it and the S1 recipe is not returned.
select pg_temp.check_as(
  'B cannot reach S1 recipe via search (RLS strips)',
  pg_temp.search_count(
    '00000000-0000-0000-0000-00000000000b'::uuid, 'tomato',
    array['dddddddd-0000-0000-0000-000000000001']::uuid[]) = 0);

-- Unrelated persona D sees nothing even with both households in scope.
select pg_temp.check_as(
  'D cannot reach any recipe via search',
  pg_temp.search_count(
    '00000000-0000-0000-0000-00000000000d'::uuid, 'tomato',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[]) = 0);

-- Special-character / punctuation query must not error and returns no spurious
-- matches. websearch_to_tsquery tolerates stray punctuation safely.
select pg_temp.check_as(
  'special-character query is handled safely',
  pg_temp.search_count(
    '00000000-0000-0000-0000-00000000000a'::uuid, ':*&|!()<>"" ''',
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[]) = 0);

-- popular_tags honours p_limit.
select pg_temp.check_as(
  'popular_tags respects p_limit',
  pg_temp.tags_count(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[], 2) = 2);

-- popular_tags ordering: count desc, then tag asc.
select pg_temp.check_as(
  'popular_tags is ordered by count desc then tag asc',
  pg_temp.tags_ordered(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[]));

-- Top tag across S1 + S2 is "vegetarian" (used by both recipes).
select pg_temp.check_as(
  'popular_tags top entry is the most-used tag',
  pg_temp.tags_top(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    array['dddddddd-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000002']::uuid[]) = 'vegetarian');

select label, ok from _t_results order by label;
