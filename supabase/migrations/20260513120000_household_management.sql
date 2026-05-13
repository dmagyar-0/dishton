-- 20260513120000_household_management.sql
-- Member management RPCs: leave_household, transfer_ownership.
--
-- leave_household is SECURITY DEFINER because editors lack a self-delete RLS
-- policy on household_members, and the "last owner cannot leave" invariant
-- cannot be checked safely inside an RLS predicate (recursion risk).
--
-- transfer_ownership is a convenience that performs the swap atomically so
-- the leave-as-last-owner UI flow doesn't have to do two round trips.
--
-- This migration also hardens app.gen_base32 to schema-qualify
-- pgcrypto.gen_random_bytes. In a hosted Supabase project pgcrypto lives in
-- the `extensions` schema, which is not on the search_path of the
-- security-definer functions that wrap it; the original definition would
-- raise `function gen_random_bytes(integer) does not exist` at runtime.

set search_path = public;

------------------------------------------------------------------------------
-- Allow household members to read each other's profile rows. Without this,
-- queries that join `household_members` to `profiles!inner` drop co-members
-- because RLS would only expose `id = auth.uid()`. We exclusively expose the
-- display_name and avatar_url columns via SELECT, since the rest of
-- profiles (locale, language, preferences) remain private.
------------------------------------------------------------------------------

drop policy if exists profiles_co_member_read on app.profiles;
create policy profiles_co_member_read on app.profiles
  for select using (
    exists (
      select 1
      from app.household_members me
      join app.household_members other
        on other.household_id = me.household_id
      where me.profile_id = auth.uid()
        and other.profile_id = app.profiles.id
    )
  );

------------------------------------------------------------------------------
-- Patch app.gen_base32 to resolve gen_random_bytes regardless of where
-- pgcrypto was installed (public vs extensions). Identical body to
-- 20260430120300_invites.sql apart from the qualified call.
------------------------------------------------------------------------------

create or replace function app.gen_base32(p_len int)
returns text
language plpgsql
set search_path = app, public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bytes bytea := gen_random_bytes(greatest(p_len, 16));
  acc bigint := 0;
  bits int := 0;
  out text := '';
  i int := 0;
  b int;
begin
  while length(out) < p_len loop
    if bits < 5 then
      if i >= length(bytes) then
        bytes := bytes || gen_random_bytes(8);
      end if;
      b := get_byte(bytes, i);
      i := i + 1;
      acc := (acc << 8) | b;
      bits := bits + 8;
    end if;
    out := out || substr(alphabet, ((acc >> (bits - 5)) & 31)::int + 1, 1);
    bits := bits - 5;
    acc := acc & ((1::bigint << bits) - 1);
  end loop;
  return out;
end;
$$;

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
