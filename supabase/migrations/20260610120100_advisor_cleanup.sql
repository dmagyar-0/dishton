-- 20260610120100_advisor_cleanup.sql
-- Supabase advisor cleanup (2026-06-10 audit). Forward-only. Three groups:
--
--   1. auth_rls_initplan — policies calling auth.uid() directly re-evaluate it
--      per row; wrapping in (select auth.uid()) lets the planner treat it as
--      an InitPlan evaluated once. Recreates the flagged policies verbatim
--      apart from the wrap. (household_members_self_insert and the import_jobs
--      policies were already rewritten in 20260610120000.)
--   2. function_search_path_mutable — pin search_path on the six helper /
--      trigger functions the advisor flags. ALTER ... SET is enough; bodies
--      are unchanged.
--   3. unindexed_foreign_keys — covering indexes for the FKs the advisor
--      lists; import_jobs(household_id|recipe_id) also serve the ON DELETE
--      CASCADE / SET NULL scans from household and recipe deletion.
--
-- Deliberately NOT addressed here:
--   * multiple_permissive_policies on read+write policy pairs (e.g.
--     recipes_member_or_follower_read + recipes_member_write). These reflect
--     the intended read-vs-write split; collapsing them would couple unrelated
--     rules for a micro-win. The chat/import policies that were genuinely
--     redundant were split per action in 20260610120000.
--   * unused_index hints — the project is young; recipes_search_gin backs FTS
--     and the others back hot paths that simply have little traffic yet.

set search_path = app, public;

------------------------------------------------------------------------------
-- 1. InitPlan wraps.
------------------------------------------------------------------------------

drop policy if exists profiles_self_read on app.profiles;
create policy profiles_self_read on app.profiles
  for select using (id = (select auth.uid()));

drop policy if exists profiles_self_insert on app.profiles;
create policy profiles_self_insert on app.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists profiles_self_update on app.profiles;
create policy profiles_self_update on app.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists profiles_co_member_read on app.profiles;
create policy profiles_co_member_read on app.profiles
  for select using (
    exists (
      select 1
      from app.household_members me
      join app.household_members other
        on other.household_id = me.household_id
      where me.profile_id = (select auth.uid())
        and other.profile_id = app.profiles.id
    )
  );

drop policy if exists household_members_self_read on app.household_members;
create policy household_members_self_read on app.household_members
  for select using (profile_id = (select auth.uid()));

drop policy if exists households_owner_read on app.households;
create policy households_owner_read on app.households
  for select using (owner_profile_id = (select auth.uid()));

drop policy if exists households_authenticated_insert on app.households;
create policy households_authenticated_insert on app.households
  for insert to authenticated
  with check (
    owner_profile_id = (select auth.uid())
    and is_personal = false
  );

drop policy if exists household_invites_owner_insert on app.household_invites;
create policy household_invites_owner_insert on app.household_invites
  for insert with check (
    app.is_household_owner(household_id)
    and created_by = (select auth.uid())
  );

------------------------------------------------------------------------------
-- 2. search_path pins.
------------------------------------------------------------------------------

alter function app.set_updated_at() set search_path = app, public;
alter function app.recipes_search_refresh() set search_path = app, public;
alter function app.recipes_touch_for_search() set search_path = app, public;
alter function app.normalize_quantity(jsonb) set search_path = app, public;
alter function app.quantity_jsonb_to_numeric(jsonb) set search_path = app, public;
alter function app.is_valid_household_tags(text[]) set search_path = app, public;

------------------------------------------------------------------------------
-- 3. FK covering indexes.
------------------------------------------------------------------------------

create index if not exists import_jobs_household_idx
  on app.import_jobs (household_id);
create index if not exists import_jobs_recipe_idx
  on app.import_jobs (recipe_id) where recipe_id is not null;
create index if not exists recipe_chat_sessions_created_by_idx
  on app.recipe_chat_sessions (created_by);
create index if not exists recipe_chat_sessions_recipe_idx
  on app.recipe_chat_sessions (recipe_id) where recipe_id is not null;
create index if not exists recipes_created_by_idx
  on app.recipes (created_by);
create index if not exists household_invites_created_by_idx
  on app.household_invites (created_by);
create index if not exists household_invites_redeemed_by_idx
  on app.household_invites (redeemed_by) where redeemed_by is not null;
create index if not exists household_follow_codes_created_by_idx
  on app.household_follow_codes (created_by);
