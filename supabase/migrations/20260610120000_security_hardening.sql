-- 20260610120000_security_hardening.sql
-- Fixes from the 2026-06-10 security audit. Forward-only.
--
--   1. CRITICAL — household_members_self_insert allowed any authenticated user
--      to insert themselves as OWNER of ANY household: the bootstrap branch
--      (role = 'owner') carried no check that the caller actually created the
--      target household, and household ids are visible in URLs and to
--      followers. New helper app.is_household_creator ties the branch to
--      households whose owner_profile_id is the caller.
--   2. import_jobs accepted an arbitrary household_id (cost-view poisoning via
--      app.v_ai_daily_cost_for_household, which aggregates by household_id).
--      INSERT now requires membership; a trigger freezes household_id /
--      profile_id on UPDATE so the check cannot be bypassed post-insert. The
--      membership check deliberately does NOT apply to UPDATE: reap_stuck_imports
--      runs as invoker, and a user who left a household must still be able to
--      reap their own stuck rows.
--   3. households_owner_delete allowed a direct DELETE of a personal household,
--      bypassing the app.delete_household guard and orphaning the account.
--   4. filter_household_tags (SECURITY DEFINER) was directly callable by any
--      authenticated user with any household id — a cross-household
--      tag-whitelist probe. Only the definer RPCs need it; direct EXECUTE is
--      revoked (the RPCs run as the function owner and retain access).
--   5. recipe_chat_sessions.recipe_id was ON DELETE NO ACTION, so deleting a
--      recipe saved from chat failed with an FK violation (same class of bug
--      fixed for import_jobs in 20260606120000). Now ON DELETE SET NULL.
--      The for-all write policies on recipe_chat_* are split per action so
--      INSERT pins created_by and SELECT is not evaluated twice per row.
--   6. hero_image_path flowed verbatim from client/model input into the column
--      the recipe_images_read storage policy keys on, letting an editor
--      "mount" any object name into their read scope and mint a signed URL for
--      it. save_recipe / update_recipe / promote_hero_image now require the
--      path to be null, a remote http(s) URL, unchanged from the current row,
--      or inside the caller's own storage folder.
--   7. public.app_refund_ai_budget — global-bucket refund counterpart to
--      app_refund_profile_ai_budget so Edge Functions can release reservations
--      when the model call never happened.
--   8. reap_stuck_imports also deletes terminal import_jobs older than 30 days
--      (the table previously grew without bound).
--   9. recipe_chat_sessions.agent_cycles — counter for webhook-side metering
--      of Managed-Agent cycles (enforced in recipe-chat-webhook).

set search_path = app, public;

------------------------------------------------------------------------------
-- 1. Household takeover fix
------------------------------------------------------------------------------

-- language plpgsql (not sql) to prevent inlining, mirroring is_household_member:
-- inlining defeats SECURITY DEFINER and re-triggers households RLS.
create or replace function app.is_household_creator(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.households
    where id = h and owner_profile_id = auth.uid()
  ) into result;
  return result;
end;
$$;

drop policy if exists household_members_self_insert on app.household_members;
create policy household_members_self_insert on app.household_members
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      -- Bootstrap: the very first owner row, allowed only for the household
      -- the caller just created (owner_profile_id = auth.uid()).
      (role = 'owner' and app.is_household_creator(household_id))
      -- Subsequent self-inserts require an existing owner row (unreachable in
      -- practice — owners go through household_members_owner_write — kept for
      -- parity with the original policy's intent).
      or app.is_household_owner(household_id)
    )
  );

------------------------------------------------------------------------------
-- 2. import_jobs: membership-checked INSERT, frozen identity on UPDATE.
--    Split per action (also clears the duplicate-SELECT-policy lint).
------------------------------------------------------------------------------

drop policy if exists import_jobs_self on app.import_jobs;

create policy import_jobs_select on app.import_jobs
  for select using (profile_id = (select auth.uid()));

create policy import_jobs_insert on app.import_jobs
  for insert with check (
    profile_id = (select auth.uid())
    and app.is_household_member(household_id)
  );

create policy import_jobs_update on app.import_jobs
  for update using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy import_jobs_delete on app.import_jobs
  for delete using (profile_id = (select auth.uid()));

create or replace function app.import_jobs_freeze_identity()
returns trigger
language plpgsql
set search_path = app, public
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.profile_id is distinct from old.profile_id then
    raise exception 'import_jobs_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists import_jobs_freeze_identity on app.import_jobs;
create trigger import_jobs_freeze_identity
  before update on app.import_jobs
  for each row execute function app.import_jobs_freeze_identity();

------------------------------------------------------------------------------
-- 3. Personal households cannot be deleted via direct table DELETE.
------------------------------------------------------------------------------

drop policy if exists households_owner_delete on app.households;
create policy households_owner_delete on app.households
  for delete using (app.is_household_owner(id) and is_personal = false);

------------------------------------------------------------------------------
-- 4. filter_household_tags: no direct calls.
------------------------------------------------------------------------------

-- Functions get EXECUTE for PUBLIC by default, so the revoke must cover
-- public as well or authenticated keeps access through it.
revoke all on function app.filter_household_tags(uuid, jsonb)
  from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. recipe_chat: FK behaviour + per-action policies + agent_cycles.
------------------------------------------------------------------------------

alter table app.recipe_chat_sessions
  drop constraint recipe_chat_sessions_recipe_id_fkey;
alter table app.recipe_chat_sessions
  add constraint recipe_chat_sessions_recipe_id_fkey
    foreign key (recipe_id) references app.recipes(id) on delete set null;

alter table app.recipe_chat_sessions
  add column agent_cycles integer not null default 0;

drop policy if exists recipe_chat_sessions_write on app.recipe_chat_sessions;
create policy recipe_chat_sessions_insert on app.recipe_chat_sessions
  for insert to authenticated
  with check (
    app.is_household_editor(household_id)
    and created_by = (select auth.uid())
  );
create policy recipe_chat_sessions_update on app.recipe_chat_sessions
  for update to authenticated
  using (app.is_household_editor(household_id))
  with check (app.is_household_editor(household_id));
create policy recipe_chat_sessions_delete on app.recipe_chat_sessions
  for delete to authenticated
  using (app.is_household_editor(household_id));

drop policy if exists recipe_chat_messages_write on app.recipe_chat_messages;
create policy recipe_chat_messages_insert on app.recipe_chat_messages
  for insert to authenticated
  with check (app.is_chat_session_editor(chat_session_id));
create policy recipe_chat_messages_update on app.recipe_chat_messages
  for update to authenticated
  using (app.is_chat_session_editor(chat_session_id))
  with check (app.is_chat_session_editor(chat_session_id));
create policy recipe_chat_messages_delete on app.recipe_chat_messages
  for delete to authenticated
  using (app.is_chat_session_editor(chat_session_id));

------------------------------------------------------------------------------
-- 6. hero_image_path guard.
------------------------------------------------------------------------------

-- A hero path is safe when it is absent, a remote http(s) URL (rendered
-- directly, never signed), unchanged from the row's current value (so a
-- co-editor's save round-trips another member's upload), or an object inside
-- the caller's own storage folder. Anything else would let the caller point
-- the recipe at a storage object they do not own and read it through the
-- recipe-linked branch of the recipe_images_read storage policy.
create or replace function app.is_safe_hero_image_path(p_path text, p_current text default null)
returns boolean
language sql stable
set search_path = app, public
as $$
  select p_path is null
      or p_path ~ '^https?://'
      or (p_current is not null and p_path = p_current)
      or p_path like auth.uid()::text || '/%';
$$;

-- save_recipe: identical to 20260605120000 plus the hero guard.
create or replace function app.save_recipe(p_household uuid, p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not app.is_household_editor(p_household) then
    raise exception 'not_household_editor';
  end if;
  if not app.is_safe_hero_image_path(p_draft->>'hero_image_path') then
    raise exception 'invalid_hero_image_path';
  end if;

  insert into app.recipes (
    household_id, created_by, title, description, source_type, source_url,
    source_language, canonical_unit_system, servings, total_time_min,
    hero_image_path
  ) values (
    p_household,
    auth.uid(),
    p_draft->>'title',
    p_draft->>'description',
    p_draft->>'source_type',
    p_draft->>'source_url',
    coalesce(p_draft->>'source_language', 'en'),
    p_draft->>'canonical_unit_system',
    (p_draft->>'servings')::int,
    nullif(p_draft->>'total_time_min', '')::int,
    p_draft->>'hero_image_path'
  )
  returning id into new_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    new_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    app.normalize_quantity(i.value->'quantity'),
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    new_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select new_id, t
  from unnest(app.filter_household_tags(p_household, p_draft->'tags')) as t
  on conflict do nothing;

  return new_id;
end;
$$;

revoke all on function app.save_recipe(uuid, jsonb) from public, anon;
grant execute on function app.save_recipe(uuid, jsonb) to authenticated;

-- update_recipe: identical to 20260605120000 plus the hero guard (current row
-- value threaded so an unchanged foreign-folder path still round-trips).
create or replace function app.update_recipe(
  p_id uuid,
  p_draft jsonb,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
  hh uuid;
  current_updated_at timestamptz;
  current_hero text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select household_id, updated_at, hero_image_path
    into hh, current_updated_at, current_hero
  from app.recipes where id = p_id;
  if hh is null then
    raise exception 'recipe_not_found';
  end if;
  if not app.is_household_editor(hh) then
    raise exception 'not_household_editor';
  end if;
  if not app.is_safe_hero_image_path(p_draft->>'hero_image_path', current_hero) then
    raise exception 'invalid_hero_image_path';
  end if;

  if p_expected_updated_at is not null
     and current_updated_at is distinct from p_expected_updated_at then
    raise exception 'recipe_edit_conflict'
      using errcode = 'P0001';
  end if;

  update app.recipes set
    title                 = p_draft->>'title',
    description           = p_draft->>'description',
    source_type           = p_draft->>'source_type',
    source_url            = p_draft->>'source_url',
    source_language       = coalesce(p_draft->>'source_language', source_language),
    canonical_unit_system = p_draft->>'canonical_unit_system',
    servings              = (p_draft->>'servings')::int,
    total_time_min        = nullif(p_draft->>'total_time_min', '')::int,
    hero_image_path       = p_draft->>'hero_image_path',
    updated_at            = now()
  where id = p_id;

  delete from app.recipe_ingredients where recipe_id = p_id;
  delete from app.recipe_steps       where recipe_id = p_id;
  delete from app.recipe_tags        where recipe_id = p_id;
  delete from app.recipe_translations where recipe_id = p_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    p_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    app.normalize_quantity(i.value->'quantity'),
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    p_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select p_id, t
  from unnest(app.filter_household_tags(hh, p_draft->'tags')) as t
  on conflict do nothing;
end;
$$;

revoke all on function app.update_recipe(uuid, jsonb, timestamptz) from public, anon;
grant execute on function app.update_recipe(uuid, jsonb, timestamptz) to authenticated;

-- promote_hero_image: promoted paths are always the caller's own uploads, so
-- require the own-folder prefix outright (no http / unchanged branches).
create or replace function app.promote_hero_image(p_recipe uuid, p_import_path text)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare hh uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_import_path is null
     or p_import_path not like auth.uid()::text || '/%' then
    raise exception 'invalid_hero_image_path';
  end if;

  select household_id into hh from app.recipes where id = p_recipe;
  if hh is null then
    raise exception 'recipe_not_found';
  end if;
  if not exists (
    select 1 from app.household_members hm
    where hm.household_id = hh
      and hm.profile_id = auth.uid()
      and hm.role in ('owner','editor')
  ) then
    raise exception 'not_household_editor';
  end if;

  update app.recipes
     set hero_image_path = p_import_path
   where id = p_recipe;
end;
$$;

revoke all on function app.promote_hero_image(uuid, text) from public, anon;
grant execute on function app.promote_hero_image(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 7. Global-bucket refund (mirrors app_refund_profile_ai_budget).
------------------------------------------------------------------------------

create or replace function public.app_refund_ai_budget(p_tokens bigint)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
  update app.ai_rate_budget
     set tokens_used = greatest(0, tokens_used - p_tokens)
   where window_started_at >= now() - interval '60 seconds';
end;
$$;

revoke all on function public.app_refund_ai_budget(bigint)
  from public, anon, authenticated;
grant execute on function public.app_refund_ai_budget(bigint) to service_role;

------------------------------------------------------------------------------
-- 8. import_jobs retention: terminal rows older than 30 days are deleted by
--    the reaper (runs as invoker, so each caller cleans their own rows; the
--    service role can run it for a global sweep).
------------------------------------------------------------------------------

create or replace function app.reap_stuck_imports()
returns int
language plpgsql
set search_path = app, public
as $$
declare n int;
declare d int;
begin
  update app.import_jobs
     set status = 'failed',
         error = case when status = 'awaiting_save' then 'abandoned' else 'timeout' end,
         completed_at = now()
   where (status = 'running' and created_at < now() - interval '10 minutes')
      or (status = 'awaiting_save' and created_at < now() - interval '30 minutes');
  get diagnostics n = row_count;

  delete from app.import_jobs
   where status in ('done', 'failed', 'needs_review')
     and coalesce(completed_at, created_at) < now() - interval '30 days';
  get diagnostics d = row_count;

  return n + d;
end $$;

revoke all on function app.reap_stuck_imports() from public, anon;
grant execute on function app.reap_stuck_imports() to authenticated, service_role;
