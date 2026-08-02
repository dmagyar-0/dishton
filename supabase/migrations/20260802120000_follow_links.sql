-- 20260802120000_follow_links.sql
-- Shareable follow links. Defined by
-- docs/superpowers/specs/2026-08-02-shareable-follow-links-design.md.
--
-- Two changes, both forward-only:
--
-- 1. app.add_follow(p_code, p_follower_household) becomes multi-use: the
--    trailing `delete from app.household_follow_codes` is removed so a code
--    survives redemption and can be reused by other households until the
--    owner revokes it or it expires (unchanged 30-day default). This is a
--    deliberate loosening from single-use — see the spec's "Decisions"
--    section for the tradeoff and its mitigations (owner revoke, expiry,
--    the expiry countdown already rendered on the code card).
--
--    The signature is unchanged, so there is no `drop function` and no
--    PostgREST overload churn.
--
-- 2. app.peek_follow_code(p_code) is new: an anon-callable read that lets the
--    /f/<code> landing page name the household to a visitor before they sign
--    up or log in. See its own comment below for the exposure analysis.

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

  return followed_id;
end;
$$;

revoke all on function app.add_follow(text, uuid) from public, anon;
grant execute on function app.add_follow(text, uuid) to authenticated;

------------------------------------------------------------------------------
-- app.peek_follow_code(p_code text) returns jsonb
-- Anon-callable name lookup for a live follow code, so the /f/<code> landing
-- page can tell a signed-out visitor whose household they're about to follow
-- before asking them to sign up or log in. Returns null for anything that
-- isn't a live code — unknown, expired, or revoked (the row is gone) — so
-- callers cannot distinguish those cases from one another.
--
-- Exposure analysis: this leaks one household name to a party who already
-- holds a 60-bit secret (12-char base32). That same secret independently
-- grants full follow access via app.add_follow, so this RPC discloses
-- strictly less than the code itself already does. Enumerating the code
-- space is not practical. Unlike public_recipe_shares this exposes no recipe
-- content, so there's no kill-switch feature flag here.
------------------------------------------------------------------------------

create or replace function app.peek_follow_code(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object('household_id', h.id, 'household_name', h.name)
    into result
  from app.household_follow_codes c
  join app.households h on h.id = c.household_id
  where c.code = p_code
    and c.expires_at > now();

  return result;
end;
$$;

revoke all on function app.peek_follow_code(text) from public;
grant execute on function app.peek_follow_code(text)
  to anon, authenticated, service_role;
