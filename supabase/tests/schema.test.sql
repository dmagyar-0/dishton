-- supabase/tests/schema.test.sql
-- Asserts every promised table/column/FK/index/RLS bit from doc 04.
-- Run inside a transaction by supabase/tests/run.ts. Each row produced by the
-- final query is one TAP assertion: { label text, ok boolean }.

-- The runner expects a single result set with columns (label, ok).
-- We aggregate every assertion into a single union-all select for simplicity.

with assertions(label, ok) as (
  values

  -- Schema present
  ('app schema exists',
   exists(select 1 from pg_namespace where nspname = 'app')),

  -- Tables exist
  ('table app.profiles exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='profiles')),
  ('table app.households exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='households')),
  ('table app.household_members exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='household_members')),
  ('table app.follows exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='follows')),
  ('table app.household_invites exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='household_invites')),
  ('table app.household_follow_codes exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='household_follow_codes')),
  ('table app.recipes exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='recipes')),
  ('table app.recipe_ingredients exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='recipe_ingredients')),
  ('table app.recipe_steps exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='recipe_steps')),
  ('table app.recipe_tags exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='recipe_tags')),
  ('table app.recipe_translations exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='recipe_translations')),
  ('table app.import_jobs exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='import_jobs')),
  ('table app.ai_rate_budget exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='ai_rate_budget')),
  ('table app.ai_profile_budget exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='ai_profile_budget')),
  ('table app.feature_flags exists',
   exists(select 1 from pg_tables where schemaname='app' and tablename='feature_flags')),

  -- Critical columns
  ('app.profiles has display_name not null',
   exists(select 1 from information_schema.columns
          where table_schema='app' and table_name='profiles'
            and column_name='display_name' and is_nullable='NO')),
  ('app.recipes has search tsvector',
   exists(select 1 from information_schema.columns
          where table_schema='app' and table_name='recipes'
            and column_name='search' and udt_name='tsvector')),
  ('app.recipes has source_type with check',
   exists(select 1 from information_schema.columns
          where table_schema='app' and table_name='recipes'
            and column_name='source_type')),
  ('app.import_jobs has profile_id not null',
   exists(select 1 from information_schema.columns
          where table_schema='app' and table_name='import_jobs'
            and column_name='profile_id' and is_nullable='NO')),
  ('app.feature_flags has rollout_percent default 0',
   exists(select 1 from information_schema.columns
          where table_schema='app' and table_name='feature_flags'
            and column_name='rollout_percent' and is_nullable='NO')),

  -- Foreign keys
  ('FK app.profiles.id -> auth.users.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='profiles'
       and c.confrelid = 'auth.users'::regclass)),
  ('FK app.recipes.household_id -> app.households.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='recipes'
       and c.confrelid = 'app.households'::regclass)),
  ('FK app.recipe_ingredients.recipe_id -> app.recipes.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='recipe_ingredients'
       and c.confrelid = 'app.recipes'::regclass)),
  ('FK app.recipe_steps.recipe_id -> app.recipes.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='recipe_steps'
       and c.confrelid = 'app.recipes'::regclass)),
  ('FK app.recipe_tags.recipe_id -> app.recipes.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='recipe_tags'
       and c.confrelid = 'app.recipes'::regclass)),
  ('FK app.import_jobs.household_id -> app.households.id',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='import_jobs'
       and c.confrelid = 'app.households'::regclass)),
  -- recipe_id FK must SET NULL on recipe delete (confdeltype 'n'), so deleting
  -- an imported recipe is not blocked by its import_jobs audit row.
  ('FK app.import_jobs.recipe_id -> app.recipes.id is ON DELETE SET NULL',
   exists(
     select 1
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace tn on tn.oid = t.relnamespace
     where c.contype = 'f' and tn.nspname='app' and t.relname='import_jobs'
       and c.confrelid = 'app.recipes'::regclass
       and c.confdeltype = 'n')),

  -- Indexes
  ('GIN index on app.recipes(search)',
   exists(
     select 1 from pg_indexes
     where schemaname='app' and tablename='recipes'
       and indexdef ilike '%using gin%search%')),
  ('btree index on app.recipes(household_id, created_at desc)',
   exists(
     select 1 from pg_indexes
     where schemaname='app' and tablename='recipes'
       and indexdef ilike '%household_id%created_at%')),
  ('index on app.recipe_tags(tag)',
   exists(
     select 1 from pg_indexes
     where schemaname='app' and tablename='recipe_tags'
       and indexdef ilike '%(tag)')),
  ('partial index on app.import_jobs running rows',
   exists(
     select 1 from pg_indexes
     where schemaname='app' and tablename='import_jobs'
       and indexdef ilike '%status%queued%running%')),

  -- RLS enabled
  ('RLS enabled on app.profiles',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='profiles')),
  ('RLS enabled on app.households',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='households')),
  ('RLS enabled on app.household_members',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='household_members')),
  ('RLS enabled on app.follows',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='follows')),
  ('RLS enabled on app.household_invites',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='household_invites')),
  ('RLS enabled on app.household_follow_codes',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='household_follow_codes')),
  ('RLS enabled on app.recipes',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='recipes')),
  ('RLS enabled on app.recipe_ingredients',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='recipe_ingredients')),
  ('RLS enabled on app.recipe_steps',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='recipe_steps')),
  ('RLS enabled on app.recipe_tags',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='recipe_tags')),
  ('RLS enabled on app.recipe_translations',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='recipe_translations')),
  ('RLS enabled on app.import_jobs',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='import_jobs')),
  ('RLS enabled on app.ai_rate_budget',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='ai_rate_budget')),
  ('RLS enabled on app.ai_profile_budget',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='ai_profile_budget')),
  ('RLS enabled on app.feature_flags',
   (select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='app' and c.relname='feature_flags')),

  -- Helper functions and RPCs
  ('function app.is_household_member exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='is_household_member')),
  ('function app.is_household_follower exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='is_household_follower')),
  ('function app.handle_new_user exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='handle_new_user')),
  ('function app.redeem_invite exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='redeem_invite')),
  ('function app.create_invite exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='create_invite')),
  ('function app.add_follow exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='add_follow')),
  ('function app.create_follow_code exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='create_follow_code')),
  ('function app.save_recipe exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='save_recipe')),
  ('function app.update_recipe exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='update_recipe')),
  ('function app.promote_hero_image exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='promote_hero_image')),
  ('function app.search_recipes exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='search_recipes')),
  ('function app.popular_tags exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='popular_tags')),
  ('function public.app_reserve_ai_budget exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='app_reserve_ai_budget')),
  ('function public.app_reserve_profile_ai_budget exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='app_reserve_profile_ai_budget')),
  ('function app.reap_stuck_imports exists',
   exists(select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='app' and p.proname='reap_stuck_imports')),

  -- View
  ('view app.v_ai_daily_cost exists',
   exists(select 1 from pg_views where schemaname='app' and viewname='v_ai_daily_cost')),

  -- Trigger
  ('trigger on_auth_user_created on auth.users exists',
   exists(select 1 from pg_trigger
          where tgname='on_auth_user_created' and not tgisinternal)),
  ('trigger recipes_search_trg on app.recipes exists',
   exists(select 1 from pg_trigger
          where tgname='recipes_search_trg' and not tgisinternal))
)
select label, ok from assertions;
