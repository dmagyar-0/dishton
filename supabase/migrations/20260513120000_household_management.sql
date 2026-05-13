-- 20260513120000_household_management.sql
-- Member management RPCs: leave_household, transfer_ownership.
--
-- leave_household is SECURITY DEFINER because editors lack a self-delete RLS
-- policy on household_members, and the "last owner cannot leave" invariant
-- cannot be checked safely inside an RLS predicate (recursion risk).
--
-- transfer_ownership is a convenience that performs the swap atomically so
-- the leave-as-last-owner UI flow doesn't have to do two round trips.

set search_path = public;

------------------------------------------------------------------------------
-- app.leave_household(p_household uuid)
-- Caller removes themselves from a household. Refuses if the caller is the
-- only owner; the UI must prompt for transfer or household deletion first.
------------------------------------------------------------------------------

create or replace function app.leave_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
  my_role text;
  owner_count int;
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
end;
$$;

revoke all on function app.leave_household(uuid) from public, anon;
grant execute on function app.leave_household(uuid) to authenticated;

------------------------------------------------------------------------------
-- app.transfer_ownership(p_household uuid, p_new_owner uuid)
-- Promotes another member to owner and demotes the caller to editor in a
-- single transaction. Also keeps households.owner_profile_id consistent.
------------------------------------------------------------------------------

create or replace function app.transfer_ownership(p_household uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
  target_role text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_new_owner = auth.uid() then
    raise exception 'cannot_transfer_to_self';
  end if;

  if not exists (
    select 1 from app.household_members
    where household_id = p_household
      and profile_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'not_household_owner';
  end if;

  select role into target_role
  from app.household_members
  where household_id = p_household
    and profile_id = p_new_owner;

  if target_role is null then
    raise exception 'target_not_a_member';
  end if;

  update app.household_members
     set role = 'owner'
   where household_id = p_household
     and profile_id = p_new_owner;

  update app.household_members
     set role = 'editor'
   where household_id = p_household
     and profile_id = auth.uid();

  update app.households
     set owner_profile_id = p_new_owner
   where id = p_household;
end;
$$;

revoke all on function app.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function app.transfer_ownership(uuid, uuid) to authenticated;
