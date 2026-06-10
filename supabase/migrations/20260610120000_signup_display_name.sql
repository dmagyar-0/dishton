-- 20260610120000_signup_display_name.sql
-- Fix: app.handle_new_user() now respects the display_name supplied in
-- raw_user_meta_data at signup time (supabase.auth.signUp options.data).
-- Previously the function always fell back to the email local-part, so a
-- user who signed up as "Visual Tester" would see "claude-test-12345" on
-- their profile.
--
-- display_name preference order:
--   1. raw_user_meta_data->>'display_name'  (trimmed; empty/whitespace = absent)
--   2. email local-part (split_part(email,'@',1))
--   3. literal 'user'
-- Capped at 80 chars to satisfy the check(length between 1 and 80) constraint.
--
-- Forward-only.

set search_path = public;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  hh uuid;
begin
  insert into app.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(split_part(new.email, '@', 1), ''),
        'user'
      ),
      80
    )
  )
  on conflict (id) do nothing;

  insert into app.households (name, owner_profile_id, is_personal)
  values ('My Recipes', new.id, true)
  on conflict do nothing
  returning id into hh;

  if hh is not null then
    insert into app.household_members (household_id, profile_id, role)
    values (hh, new.id, 'owner')
    on conflict do nothing;
  end if;

  return new;
end;
$$;
