-- 20260430121100_household_owner_select.sql
-- Allow a household's owner to SELECT their own household.
--
-- Without this policy, the onboarding flow fails on the very first
-- household a user creates. The SPA at src/routes/onboarding/index.tsx
-- runs:
--
--   supabase.from('households')
--     .insert({ name, owner_profile_id: auth.user.id })
--     .select('id')
--     .single();
--
-- which translates to `INSERT ... RETURNING id`. PostgreSQL then evaluates
-- BOTH the INSERT WITH CHECK and the SELECT USING policies against the new
-- row. The existing `households_member_read` policy only grants SELECT to
-- members and followers, but the user is not yet a member of the household
-- they just created (the `app.household_members` row is inserted in the
-- next statement). RETURNING therefore fails with the same generic message
-- as a real WITH CHECK violation:
--
--   "new row violates row-level security policy for table 'households'"
--
-- Adding a separate permissive SELECT policy keyed off `owner_profile_id =
-- auth.uid()` lets the bootstrap RETURNING succeed without widening
-- visibility for anyone else.

set search_path = public;

create policy households_owner_read on app.households
  for select using (owner_profile_id = auth.uid());
