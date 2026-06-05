-- 20260605120200_households_insert_personal_guard.sql
-- Finding B (CRITICAL) — households_authenticated_insert only constrained
-- owner_profile_id = auth.uid(), so any authenticated user could INSERT a row
-- with is_personal = true and spoof a personal household (which the merge /
-- leave RPCs treat specially and the partial unique index assumes is created
-- only via the SECURITY DEFINER signup trigger). Tighten the WITH CHECK so
-- direct inserts can only create non-personal (shared) households; personal
-- households are created exclusively by app.handle_new_user /
-- app.leave_household_with_recipes, which run as definer and bypass RLS.
--
-- Forward-only.

set search_path = public;

drop policy if exists households_authenticated_insert on app.households;
create policy households_authenticated_insert on app.households
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and is_personal = false
  );
