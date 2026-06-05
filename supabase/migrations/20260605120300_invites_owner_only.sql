-- 20260605120300_invites_owner_only.sql
-- Finding C (HIGH) + Finding D (owner-only invites).
--
--   * C — household_invites_redeemer_update let any authenticated user UPDATE
--     an open invite row (including its household_id), so an attacker could
--     retarget a pending invite at a household they control. The supported
--     redeem path is the SECURITY DEFINER app.redeem_invite RPC, which does not
--     need this policy. Drop it; direct UPDATEs on household_invites are now
--     denied to anon/authenticated entirely.
--   * D — invite creation is OWNERS ONLY. Both the table INSERT policy and the
--     app.create_invite RPC previously allowed any household member. Gate them
--     on app.is_household_owner.
--
-- Forward-only.

set search_path = public;

------------------------------------------------------------------------------
-- C — remove the redeemer self-service UPDATE policy.
------------------------------------------------------------------------------

drop policy if exists household_invites_redeemer_update on app.household_invites;

------------------------------------------------------------------------------
-- D — owner-only INSERT policy.
------------------------------------------------------------------------------

drop policy if exists household_invites_member_insert on app.household_invites;
create policy household_invites_owner_insert on app.household_invites
  for insert with check (
    app.is_household_owner(household_id)
    and created_by = auth.uid()
  );

------------------------------------------------------------------------------
-- D — owner-gate the create_invite RPC. Body otherwise mirrors
-- 20260430120300_invites.sql.
------------------------------------------------------------------------------

create or replace function app.create_invite(p_household uuid)
returns text
language plpgsql
security definer
set search_path = app, public
as $$
declare c text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not app.is_household_owner(p_household) then
    raise exception 'not_household_owner';
  end if;

  c := app.gen_base32(8);

  insert into app.household_invites (code, household_id, created_by)
  values (c, p_household, auth.uid());

  return c;
end;
$$;

revoke all on function app.create_invite(uuid) from public, anon;
grant execute on function app.create_invite(uuid) to authenticated;
