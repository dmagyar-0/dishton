-- 20260605120600_delete_household.sql
-- Finding I — there was no guard against deleting a personal household, which
-- would orphan the user (no household to land on -> redirect loop). Add a
-- SECURITY DEFINER app.delete_household RPC that verifies the caller owns the
-- household, REFUSES to delete personal households, then deletes. The owner
-- DELETE table policy stays in place, but this RPC is the supported path.
--
-- Forward-only.

set search_path = public;

create or replace function app.delete_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
  is_personal_hh boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not app.is_household_owner(p_household) then
    raise exception 'not_household_owner';
  end if;

  select is_personal into is_personal_hh
  from app.households
  where id = p_household;

  if is_personal_hh is null then
    raise exception 'household_not_found';
  end if;

  if is_personal_hh then
    raise exception 'cannot_delete_personal_household';
  end if;

  -- recipes / members / invites / follow_codes / follows cascade via FK.
  delete from app.households where id = p_household;
end;
$$;

revoke all on function app.delete_household(uuid) from public, anon;
grant execute on function app.delete_household(uuid) to authenticated;
