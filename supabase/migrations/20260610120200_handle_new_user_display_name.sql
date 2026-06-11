-- 20260610120200_handle_new_user_display_name.sql
-- Caught during visual validation of the security-hardening branch: the
-- signup form sends the chosen name as auth metadata
-- (`options.data.display_name`, src/routes/auth/signup.tsx), but
-- app.handle_new_user always derived display_name from the email local-part —
-- every new profile showed e.g. "claude-test-1781…" until manually edited.
-- Prefer the metadata, clamped to the profiles check constraint (1..80 chars),
-- with the local-part as fallback. Body otherwise identical to
-- 20260524120000_personal_households.sql. Forward-only.

set search_path = app, public;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  hh uuid;
begin
  insert into app.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data->>'display_name'), 80), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'user'
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
