-- 20260605120500_add_follow_household_param.sql
-- Finding H (HIGH) — app.add_follow picked the caller's earliest-owned
-- household arbitrarily (order by joined_at limit 1) as the follower. With
-- personal households every user owns at least one, so a follow could land
-- under the wrong household. Take an explicit p_follower_household and verify
-- the caller OWNS it before creating the follow.
--
-- Contract change: app.add_follow now takes (p_code text, p_follower_household
-- uuid). The 1-arg overload is dropped so PostgREST resolves the new form.
--
-- Forward-only.

set search_path = public;

create or replace function app.add_follow(p_code text, p_follower_household uuid)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  followed_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not app.is_household_owner(p_follower_household) then
    raise exception 'not_household_owner';
  end if;

  select household_id into followed_id
  from app.household_follow_codes
  where code = p_code
    and expires_at > now();

  if followed_id is null then
    raise exception 'invalid_or_expired_follow_code';
  end if;

  if p_follower_household = followed_id then
    raise exception 'cannot_follow_self';
  end if;

  insert into app.follows (follower_household_id, followed_household_id)
  values (p_follower_household, followed_id)
  on conflict do nothing;

  delete from app.household_follow_codes where code = p_code;

  return followed_id;
end;
$$;

-- Drop the prior 1-arg signature so the new 2-arg form is the only overload.
drop function if exists app.add_follow(text);

revoke all on function app.add_follow(text, uuid) from public, anon;
grant execute on function app.add_follow(text, uuid) to authenticated;
