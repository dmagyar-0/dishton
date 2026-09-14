-- 20260914150000_admin_list_users.sql
-- Admin-only RPC exposing each user's email alongside their profile, for a
-- new Users section on the /admin/metrics dashboard.
--
-- app.profiles deliberately has no email column (see the RLS policies in
-- 20260430120000_init.sql / 20260610120100_advisor_cleanup.sql: a user can
-- read their own profile and co-members' profiles, never email), and
-- auth.users is never exposed to PostgREST directly (20260605120700
-- revoked anon SELECT project-wide). This mirrors the app.metrics_* pattern
-- instead: a SECURITY DEFINER function, gated on app.is_app_admin(), that
-- reads auth.users as the function owner rather than as the calling role.

set search_path = app, public;

create or replace function app.list_app_users()
returns table(
  profile_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
begin
  if not app.is_app_admin() then
    raise exception 'not_app_admin';
  end if;

  return query
    select
      p.id as profile_id,
      u.email::text,
      p.display_name,
      p.created_at,
      u.last_sign_in_at
    from app.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke all on function app.list_app_users() from public, anon;
grant execute on function app.list_app_users() to authenticated;
