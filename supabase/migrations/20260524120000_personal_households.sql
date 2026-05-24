-- 20260524120000_personal_households.sql
-- Solo-by-default households. Every signed-in user owns exactly one
-- personal household; when they redeem an invite while solo, their
-- recipes and allowed_tags are moved into the target household and the
-- personal household is removed. When they leave a shared household,
-- recipes they authored move with them into a fresh personal household.
--
-- Forward-only. See plan at /root/.claude/plans/i-would-like-to-glittery-clock.md.

set search_path = public;

------------------------------------------------------------------------------
-- households.is_personal flag + uniqueness.
-- The partial unique index guarantees that a profile owns at most one
-- personal household — the merge/leave RPCs below rely on that to
-- look up "the caller's personal household" with a single-row query.
------------------------------------------------------------------------------

alter table app.households
  add column is_personal boolean not null default false;

create unique index households_one_personal_per_owner_idx
  on app.households (owner_profile_id)
  where is_personal;

------------------------------------------------------------------------------
-- Replace app.handle_new_user() so new signups land with their personal
-- household + owner membership already in place. SECURITY DEFINER, so this
-- bypasses RLS and works even though the new auth.users row hasn't yet
-- produced a session.
------------------------------------------------------------------------------

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  hh uuid;
begin
  insert into app.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'user')
  )
  on conflict (id) do nothing;

  insert into app.households (name, owner_profile_id, is_personal)
  values ('My Recipes', new.id, true)
  on conflict do nothing
  returning id into hh;

  if hh is not null then
    insert into app.household_members (household_id, profile_id, role)
    values (hh, new.id, 'owner')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

------------------------------------------------------------------------------
-- Backfill: any existing profile without a personal household gets one.
-- In production this should be a no-op because the legacy onboarding gate
-- forced every profile into at least one household, but the seed/test DBs
-- can have orphans.
------------------------------------------------------------------------------

insert into app.households (name, owner_profile_id, is_personal)
select 'My Recipes', p.id, true
from app.profiles p
where not exists (
  select 1 from app.households h
  where h.owner_profile_id = p.id and h.is_personal
);

insert into app.household_members (household_id, profile_id, role)
select h.id, h.owner_profile_id, 'owner'
from app.households h
where h.is_personal
  and not exists (
    select 1 from app.household_members hm
    where hm.household_id = h.id and hm.profile_id = h.owner_profile_id
  );

------------------------------------------------------------------------------
-- Replace app.redeem_invite. When the caller is in exactly one household
-- AND that household is their personal one, the redeem also moves all of
-- their recipes into the target household and unions allowed_tags.
-- Otherwise it falls back to the legacy "just add a member" behaviour.
------------------------------------------------------------------------------

create or replace function app.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  target_hh uuid;
  src_hh uuid;
  src_member_count int;
  caller_membership_count int;
  merged_tags text[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update app.household_invites
     set redeemed_by = auth.uid(), redeemed_at = now()
   where code = p_code
     and redeemed_at is null
     and expires_at > now()
   returning household_id into target_hh;

  if target_hh is null then
    raise exception 'invalid_or_expired_invite';
  end if;

  -- Look up the caller's personal household and how many memberships
  -- they currently hold; we only merge when both signals say "solo".
  select h.id, (
    select count(*)::int from app.household_members hm
    where hm.household_id = h.id
  )
  into src_hh, src_member_count
  from app.households h
  where h.owner_profile_id = auth.uid()
    and h.is_personal
  limit 1;

  select count(*)::int into caller_membership_count
  from app.household_members
  where profile_id = auth.uid();

  -- Merge path: caller is solo, target is a different household.
  if src_hh is not null
     and src_hh <> target_hh
     and src_member_count = 1
     and caller_membership_count = 1
  then
    -- Move every recipe from the personal household to the target.
    -- recipe_ingredients/steps/tags follow via FK.
    update app.recipes
       set household_id = target_hh
     where household_id = src_hh;

    -- Union the allowed_tags lists (dedupe, clip at 200). The constraint
    -- check on the column will reject mis-shaped tags; both source and
    -- target already satisfy it, so the union does too.
    select array(
      select t from (
        select distinct unnest(target.allowed_tags || src.allowed_tags) as t
      ) u
      limit 200
    )
    into merged_tags
    from app.households target,
         app.households src
    where target.id = target_hh
      and src.id = src_hh;

    update app.households
       set allowed_tags = merged_tags
     where id = target_hh;

    -- Add the caller to the target before removing their personal
    -- household, so they never have zero memberships even briefly.
    insert into app.household_members (household_id, profile_id, role)
    values (target_hh, auth.uid(), 'editor')
    on conflict do nothing;

    -- Drop the now-empty personal household. The owner_profile_id FK is
    -- not on-delete-cascade for households, but household_members has
    -- on delete cascade, so the caller's old membership row is cleaned
    -- up automatically.
    delete from app.households where id = src_hh;
  else
    -- Legacy non-merge path: caller is already sharing, or is redeeming
    -- their own household's invite. Just add the membership row.
    insert into app.household_members (household_id, profile_id, role)
    values (target_hh, auth.uid(), 'editor')
    on conflict do nothing;
  end if;

  return target_hh;
end;
$$;

revoke all on function app.redeem_invite(text) from public, anon;
grant execute on function app.redeem_invite(text) to authenticated;

------------------------------------------------------------------------------
-- app.leave_household_with_recipes(p_household uuid) returns uuid
-- Caller leaves p_household and takes the recipes they authored with them
-- into a fresh personal household. Honours the last-owner rule from
-- app.leave_household. Returns the destination personal household id so
-- the SPA can route there directly.
------------------------------------------------------------------------------

create or replace function app.leave_household_with_recipes(p_household uuid)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  my_role text;
  owner_count int;
  dest_hh uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select role into my_role
  from app.household_members
  where household_id = p_household
    and profile_id = auth.uid();

  if my_role is null then
    raise exception 'not_a_member';
  end if;

  if my_role = 'owner' then
    select count(*) into owner_count
    from app.household_members
    where household_id = p_household
      and role = 'owner';

    if owner_count <= 1 then
      raise exception 'last_owner';
    end if;
  end if;

  -- Resolve-or-create the caller's personal household. After a merge the
  -- personal household was deleted, so it usually doesn't exist; but if
  -- the caller already has one (e.g. they joined a household without
  -- merging) the partial unique index would block a fresh insert.
  select id into dest_hh
  from app.households
  where owner_profile_id = auth.uid()
    and is_personal
  limit 1;

  if dest_hh is null then
    insert into app.households (name, owner_profile_id, is_personal)
    values ('My Recipes', auth.uid(), true)
    returning id into dest_hh;

    insert into app.household_members (household_id, profile_id, role)
    values (dest_hh, auth.uid(), 'owner')
    on conflict do nothing;
  end if;

  -- Move authored recipes into the personal household before leaving so
  -- they don't get cascade-deleted with the (still-shared) source.
  update app.recipes
     set household_id = dest_hh
   where household_id = p_household
     and created_by = auth.uid();

  delete from app.household_members
  where household_id = p_household
    and profile_id = auth.uid();

  return dest_hh;
end;
$$;

revoke all on function app.leave_household_with_recipes(uuid) from public, anon;
grant execute on function app.leave_household_with_recipes(uuid) to authenticated;
