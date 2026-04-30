-- 20260430120700_feature_flags.sql
-- app.feature_flags table per docs/15-roadmap-and-flags.md.

set search_path = public;

create table app.feature_flags (
  key text primary key,
  enabled bool not null default false,
  rollout_percent int not null default 0
    check (rollout_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
create trigger feature_flags_set_updated before update on app.feature_flags
  for each row execute function app.set_updated_at();

alter table app.feature_flags enable row level security;

-- Read: any authenticated user. Anon is blocked because the flags table can
-- contain pre-launch experiments we do not want crawlers/log-aggregators to
-- enumerate.
create policy feature_flags_authenticated_read on app.feature_flags
  for select to authenticated using (true);

-- Write: service_role only. Service role bypasses RLS, so omitting any
-- write policy denies writes to anon/authenticated.

grant select on app.feature_flags to authenticated;
grant insert, update, delete on app.feature_flags to service_role;
