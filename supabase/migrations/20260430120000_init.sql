-- 20260430120000_init.sql
-- Schema, helpers, profiles, households, household_members, follows.
-- Forward-only. Defined by docs/04-data-model.md and docs/05-auth-and-households.md.

set search_path = public;

create extension if not exists "pgcrypto";

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

------------------------------------------------------------------------------
-- set_updated_at helper. The membership/follower helpers are defined further
-- down, after the tables they reference exist; `language sql` functions
-- resolve names at creation time, not at call time, so the order matters.
------------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

------------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
------------------------------------------------------------------------------

create table app.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  avatar_url text,
  locale text not null default 'en'
    check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  preferred_unit_system text not null default 'metric'
    check (preferred_unit_system in ('metric','imperial')),
  preferred_language text not null default 'en'
    check (preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated before update on app.profiles
  for each row execute function app.set_updated_at();

------------------------------------------------------------------------------
-- households
------------------------------------------------------------------------------

create table app.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  owner_profile_id uuid not null references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger households_set_updated before update on app.households
  for each row execute function app.set_updated_at();

create table app.household_members (
  household_id uuid not null references app.households(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  joined_at timestamptz not null default now(),
  primary key (household_id, profile_id)
);
create index household_members_profile_idx on app.household_members (profile_id);

------------------------------------------------------------------------------
-- follows (one-way: follower household sees followed household read-only)
------------------------------------------------------------------------------

create table app.follows (
  follower_household_id uuid not null references app.households(id) on delete cascade,
  followed_household_id uuid not null references app.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_household_id, followed_household_id),
  check (follower_household_id <> followed_household_id)
);
create index follows_followed_idx on app.follows (followed_household_id);

------------------------------------------------------------------------------
-- Membership / follower helpers. Defined after the tables they reference
-- because `language sql` resolves identifiers at creation time.
------------------------------------------------------------------------------

-- language plpgsql (not sql) to prevent inlining; inlining defeats SECURITY
-- DEFINER and re-triggers the parent table's RLS policies, causing infinite
-- recursion when the helper itself queries household_members.
create or replace function app.is_household_member(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.household_members
    where household_id = h and profile_id = auth.uid()
  ) into result;
  return result;
end;
$$;

create or replace function app.is_household_follower(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1
    from app.follows f
    join app.household_members hm
      on hm.household_id = f.follower_household_id
     and hm.profile_id = auth.uid()
    where f.followed_household_id = h
  ) into result;
  return result;
end;
$$;

-- Helper used by RLS policies that need to know if the caller is an owner of
-- a given household. Same recursion concern as is_household_member.
create or replace function app.is_household_owner(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.household_members
    where household_id = h
      and profile_id = auth.uid()
      and role = 'owner'
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------
-- handle_new_user trigger - inserts an app.profiles row whenever
-- auth.users gains a row. Per docs/05-auth-and-households.md.
------------------------------------------------------------------------------

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  insert into app.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

------------------------------------------------------------------------------
-- Row Level Security
------------------------------------------------------------------------------

alter table app.profiles          enable row level security;
alter table app.households        enable row level security;
alter table app.household_members enable row level security;
alter table app.follows           enable row level security;

-- profiles: each user owns exactly their own row.
create policy profiles_self_read on app.profiles
  for select using (id = auth.uid());

create policy profiles_self_insert on app.profiles
  for insert with check (id = auth.uid());

create policy profiles_self_update on app.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- households: members and followers can read; only owners can update / delete;
-- creation is allowed for any authenticated user (they will set themselves
-- as the owner row, then add a household_members row in the same transaction
-- via the create-household client call).
create policy households_member_read on app.households
  for select using (
    app.is_household_member(id) or app.is_household_follower(id)
  );

create policy households_owner_write on app.households
  for update using (app.is_household_owner(id))
  with check (app.is_household_owner(id));

create policy households_owner_delete on app.households
  for delete using (app.is_household_owner(id));

create policy households_authenticated_insert on app.households
  for insert to authenticated
  with check (owner_profile_id = auth.uid());

-- household_members: each user can see their own membership rows and
-- co-members; owners can write (add/remove/role-change).
create policy household_members_self_read on app.household_members
  for select using (profile_id = auth.uid());

create policy household_members_co_read on app.household_members
  for select using (app.is_household_member(household_id));

create policy household_members_owner_write on app.household_members
  for all using (app.is_household_owner(household_id))
  with check (app.is_household_owner(household_id));

-- A user inserting themselves into a household they just created must succeed
-- before the owner-write policy can match (since no owner row yet exists).
-- This bootstraps the very first row.
create policy household_members_self_insert on app.household_members
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (
      role = 'owner'
      or app.is_household_owner(household_id)
    )
  );

-- follows: any member of either side can read; only owners of the follower
-- household can write.
create policy follows_member_read on app.follows
  for select using (
    app.is_household_member(follower_household_id)
    or app.is_household_member(followed_household_id)
  );

create policy follows_owner_write on app.follows
  for all using (app.is_household_owner(follower_household_id))
  with check (app.is_household_owner(follower_household_id));

------------------------------------------------------------------------------
-- Schema-level grants. RLS still applies but PostgREST/clients need table
-- grants to even attempt a query.
------------------------------------------------------------------------------

grant select, insert, update, delete on app.profiles          to authenticated;
grant select, insert, update, delete on app.households        to authenticated;
grant select, insert, update, delete on app.household_members to authenticated;
grant select, insert, update, delete on app.follows           to authenticated;

grant select on app.profiles, app.households, app.household_members, app.follows
  to anon;
