-- 20260914130000_leave_household_keeps_a_home.sql
-- app.leave_household must not strand the caller with no household.
--
-- app.redeem_invite's merge path DELETES the caller's personal household
-- (20260605120400) once their recipes have moved into the target. So a user who
-- joined by merging holds exactly one membership. app.leave_household
-- (20260513120000) then just deleted that row, leaving them with ZERO
-- households: the root route resolves nothing and dumps them on /onboarding
-- with their account intact but no way back to a recipe list.
--
-- app.leave_household_with_recipes already handles this -- its "resolve-or-
-- create the caller's personal household" step exists precisely because "after
-- a merge the personal household was deleted". This brings the plain leave path
-- to the same invariant the rest of the app assumes (see the comment in
-- src/routes/index.tsx: "Every signed-in profile has a personal household").
--
-- Only creates one when the caller would otherwise have none: someone leaving
-- one of several households keeps landing on the households they still belong
-- to, with no surprise empty household appearing.
--
-- Returns the personal household id when one was resolved or created (null
-- otherwise) so the SPA can route straight there instead of bouncing through
-- the root. The signature changes from `returns void`, so the old one is
-- dropped first rather than left as an ambiguous overload.

set search_path = public;

drop function if exists app.leave_household(uuid);

create or replace function app.leave_household(p_household uuid)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  my_role text;
  owner_count int;
  remaining int;
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

  delete from app.household_members
  where household_id = p_household
    and profile_id = auth.uid();

  select count(*)::int into remaining
  from app.household_members
  where profile_id = auth.uid();

  if remaining > 0 then
    return null;
  end if;

  -- Resolve before insert: a caller who still owns a personal household would
  -- otherwise trip the partial unique index (same reasoning as
  -- app.leave_household_with_recipes).
  select id into dest_hh
  from app.households
  where owner_profile_id = auth.uid()
    and is_personal
  limit 1;

  if dest_hh is null then
    insert into app.households (name, owner_profile_id, is_personal)
    values ('My Recipes', auth.uid(), true)
    returning id into dest_hh;
  end if;

  insert into app.household_members (household_id, profile_id, role)
  values (dest_hh, auth.uid(), 'owner')
  on conflict do nothing;

  return dest_hh;
end;
$$;

revoke all on function app.leave_household(uuid) from public, anon;
grant execute on function app.leave_household(uuid) to authenticated;
