-- 20260607130000_household_merge_clears_is_personal.sql
-- Bug: "still solo after someone joined". app.redeem_invite's merge path
-- moves a solo redeemer into the inviter's household and deletes the
-- redeemer's personal household, but never cleared is_personal on the target.
-- The result is an inconsistent row — a household flagged is_personal = true
-- that nonetheless has two members. Every "are you solo?" check in the SPA
-- (settings page, recipe list, app shell nav) keys off is_personal, so the
-- inviter kept seeing the solo "This space is yours" UI after their guest
-- joined; the member-count guard on the settings page only papered over it
-- when the live count happened to be fresh, which it isn't on the inviter's
-- client (no realtime, refetchOnWindowFocus is off).
--
-- Fix: a personal household stops being a personal space the moment a second
-- member joins it. Clear the flag in redeem_invite once the target is
-- multi-member, and backfill any households already left in the bad state.
--
-- Body otherwise mirrors 20260605120400_redeem_invite_no_tag_union.sql; the
-- only change is the trailing is_personal update. Forward-only.

set search_path = public;

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
    -- recipe_ingredients/steps/tags follow via FK. We intentionally do NOT
    -- touch the target household's allowed_tags (finding G): a joining
    -- non-owner must not be able to rewrite the target's tag whitelist.
    update app.recipes
       set household_id = target_hh
     where household_id = src_hh;

    -- Add the caller to the target before removing their personal
    -- household, so they never have zero memberships even briefly.
    insert into app.household_members (household_id, profile_id, role)
    values (target_hh, auth.uid(), 'editor')
    on conflict do nothing;

    -- Drop the now-empty personal household. household_members has
    -- on delete cascade, so the caller's old membership row is cleaned up.
    delete from app.households where id = src_hh;
  else
    -- Legacy non-merge path: caller is already sharing, or is redeeming
    -- their own household's invite. Just add the membership row.
    insert into app.household_members (household_id, profile_id, role)
    values (target_hh, auth.uid(), 'editor')
    on conflict do nothing;
  end if;

  -- A personal household stops being a solo space the moment a second member
  -- joins it. Clearing the flag here keeps the SPA's "are you solo?" checks
  -- correct without leaning on a live member count that goes stale on the
  -- inviter's client. Guarded on the member count so the non-merge paths that
  -- add nobody new (e.g. redeeming your own invite) leave the flag intact.
  update app.households h
     set is_personal = false
   where h.id = target_hh
     and h.is_personal
     and (
       select count(*) from app.household_members m
       where m.household_id = target_hh
     ) > 1;

  return target_hh;
end;
$$;

revoke all on function app.redeem_invite(text) from public, anon;
grant execute on function app.redeem_invite(text) to authenticated;

-- One-time repair for households merged before this migration shipped: a row
-- still flagged personal while holding more than one member is exactly the
-- inconsistent state the change above prevents from here on.
update app.households h
   set is_personal = false
 where h.is_personal
   and (
     select count(*) from app.household_members m
     where m.household_id = h.id
   ) > 1;
