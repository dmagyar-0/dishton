-- 20260605120400_redeem_invite_no_tag_union.sql
-- Finding G (MEDIUM) — the merge path in app.redeem_invite unioned the
-- redeemer's personal allowed_tags into the TARGET household's allowed_tags.
-- A joining non-owner could therefore rewrite the target household's tag
-- whitelist (the owner-only surface). Per the locked decision we leave the
-- target household's allowed_tags untouched; the redeemer's recipes still move
-- across, and any tags on those recipes that are off the target's whitelist
-- simply stay as recipe_tags rows (they are not re-validated on move).
--
-- Body otherwise mirrors 20260524120000_personal_households.sql; only the
-- allowed_tags union block is removed.
--
-- Forward-only.

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

  return target_hh;
end;
$$;

revoke all on function app.redeem_invite(text) from public, anon;
grant execute on function app.redeem_invite(text) to authenticated;
