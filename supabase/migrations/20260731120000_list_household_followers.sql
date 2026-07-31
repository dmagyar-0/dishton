-- 20260731120000_list_household_followers.sql
-- Let a household see who follows it, without widening households row access.
--
-- The /households screen has a "Followers" card, but the data to fill it was
-- unreachable. `households_member_read` grants SELECT on a household row to
-- its members and to `app.is_household_follower(id)` — i.e. the households you
-- follow. Nothing covers the reverse direction, so the households that follow
-- *you* stay invisible.
--
-- The SPA read followers with a PostgREST embed:
--
--   from('follows')
--     .select('follower_household_id, created_at,
--              households!follows_follower_household_id_fkey(id, name)')
--     .eq('followed_household_id', <mine>)
--
-- The `follows` row itself is readable (`follows_member_read` covers members of
-- either side), but the embedded household is not, and a non-`!inner` embed
-- that RLS filters out comes back as `households: null` rather than dropping
-- the row. The client then read `household.name` off null, which threw during
-- render and tripped the root error boundary — "Something went wrong." — taking
-- the whole page down, including the "generate follow code" button. Sharing a
-- household became impossible the moment somebody followed it.
--
-- Fix: a SECURITY DEFINER reader that joins the follower household inside the
-- definer boundary and returns only its id, name, and follow date. A blanket
-- SELECT policy would have worked too, but would also hand the followed
-- household every other column of the follower's row (owner_profile_id, tag
-- lists). Followers opted into being seen by name, not into that.
--
-- Membership is enforced in the WHERE clause rather than raised as an
-- exception: a non-member simply sees no followers, matching the empty state
-- the UI already renders.

set search_path = public;

create or replace function app.list_household_followers(p_household uuid)
returns table (follower_household_id uuid, name text, created_at timestamptz)
language sql
stable
security definer
set search_path = app, public
as $$
  select f.follower_household_id, h.name, f.created_at
  from app.follows f
  join app.households h on h.id = f.follower_household_id
  where f.followed_household_id = p_household
    and exists (
      select 1
      from app.household_members hm
      where hm.household_id = p_household
        and hm.profile_id = (select auth.uid())
    )
  order by f.created_at desc;
$$;

-- SECURITY DEFINER SQL functions are never inlined by the planner, so the
-- membership check above cannot be optimised out of the definer boundary.
revoke all on function app.list_household_followers(uuid) from public, anon;
grant execute on function app.list_household_followers(uuid) to authenticated;
