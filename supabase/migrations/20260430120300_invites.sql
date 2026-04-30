-- 20260430120300_invites.sql
-- Invite + follow-code RPCs: redeem_invite, create_invite, add_follow,
-- create_follow_code, plus the household_follow_codes table.
-- Defined by docs/05-auth-and-households.md.

set search_path = public;

------------------------------------------------------------------------------
-- household_follow_codes
-- Mirrors household_invites but for cross-household follows. 12-char base32,
-- 30-day expiry, single-use (deleted on redeem).
------------------------------------------------------------------------------

create table app.household_follow_codes (
  code text primary key check (code ~ '^f_[A-Z2-7]{12}$'),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);
create index household_follow_codes_household_idx
  on app.household_follow_codes (household_id);

alter table app.household_follow_codes enable row level security;

create policy follow_codes_member_read on app.household_follow_codes
  for select using (app.is_household_member(household_id));

create policy follow_codes_owner_write on app.household_follow_codes
  for all using (app.is_household_owner(household_id))
  with check (app.is_household_owner(household_id));

grant select, insert, update, delete on app.household_follow_codes to authenticated;

------------------------------------------------------------------------------
-- app.redeem_invite(p_code text) returns uuid
-- Atomic redeem - flips the invite row and inserts a household_members row.
------------------------------------------------------------------------------

create or replace function app.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare hh uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update app.household_invites
     set redeemed_by = auth.uid(), redeemed_at = now()
   where code = p_code
     and redeemed_at is null
     and expires_at > now()
   returning household_id into hh;

  if hh is null then
    raise exception 'invalid_or_expired_invite';
  end if;

  insert into app.household_members (household_id, profile_id, role)
  values (hh, auth.uid(), 'editor')
  on conflict do nothing;

  return hh;
end;
$$;

revoke all on function app.redeem_invite(text) from public, anon;
grant execute on function app.redeem_invite(text) to authenticated;

------------------------------------------------------------------------------
-- app.create_invite(p_household uuid) returns text
------------------------------------------------------------------------------

-- 8-char base32 (RFC 4648 alphabet without 0/1) generated from random bytes.
-- Postgres' built-in `encode()` does not support base32, so we map 5-bit
-- groups manually. We pull more bytes than strictly required (8) to make
-- collision-after-truncation negligible.
create or replace function app.gen_base32(p_len int)
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  bytes bytea := gen_random_bytes(greatest(p_len, 16));
  acc bigint := 0;
  bits int := 0;
  out text := '';
  i int := 0;
  b int;
begin
  while length(out) < p_len loop
    if bits < 5 then
      if i >= length(bytes) then
        bytes := bytes || gen_random_bytes(8);
      end if;
      b := get_byte(bytes, i);
      i := i + 1;
      acc := (acc << 8) | b;
      bits := bits + 8;
    end if;
    out := out || substr(alphabet, ((acc >> (bits - 5)) & 31)::int + 1, 1);
    bits := bits - 5;
    acc := acc & ((1::bigint << bits) - 1);
  end loop;
  return out;
end;
$$;

create or replace function app.create_invite(p_household uuid)
returns text
language plpgsql
security definer
set search_path = app, public
as $$
declare c text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not app.is_household_member(p_household) then
    raise exception 'not_household_member';
  end if;

  c := app.gen_base32(8);

  insert into app.household_invites (code, household_id, created_by)
  values (c, p_household, auth.uid());

  return c;
end;
$$;

revoke all on function app.create_invite(uuid) from public, anon;
grant execute on function app.create_invite(uuid) to authenticated;

------------------------------------------------------------------------------
-- app.create_follow_code(p_household uuid) returns text
-- Owner-only. Produces a `f_<base32-12>` code redeemable by another household
-- via app.add_follow.
------------------------------------------------------------------------------

create or replace function app.create_follow_code(p_household uuid)
returns text
language plpgsql
security definer
set search_path = app, public
as $$
declare c text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from app.household_members hm
    where hm.household_id = p_household
      and hm.profile_id = auth.uid()
      and hm.role = 'owner'
  ) then
    raise exception 'not_household_owner';
  end if;

  c := 'f_' || app.gen_base32(12);

  insert into app.household_follow_codes (code, household_id, created_by)
  values (c, p_household, auth.uid());

  return c;
end;
$$;

revoke all on function app.create_follow_code(uuid) from public, anon;
grant execute on function app.create_follow_code(uuid) to authenticated;

------------------------------------------------------------------------------
-- app.add_follow(p_code text) returns uuid
-- The caller must be an owner of some household; that household becomes the
-- follower. Returns the followed household_id. The code is single-use.
------------------------------------------------------------------------------

create or replace function app.add_follow(p_code text)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare
  followed_id uuid;
  follower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select household_id into followed_id
  from app.household_follow_codes
  where code = p_code
    and expires_at > now();

  if followed_id is null then
    raise exception 'invalid_or_expired_follow_code';
  end if;

  -- Pick the caller's owned household. We require that the caller owns
  -- exactly one household for this RPC; if they own several the SPA must
  -- pass-through a context (future RPC variant).
  select hm.household_id into follower_id
  from app.household_members hm
  where hm.profile_id = auth.uid()
    and hm.role = 'owner'
  order by hm.joined_at asc
  limit 1;

  if follower_id is null then
    raise exception 'no_owned_household';
  end if;
  if follower_id = followed_id then
    raise exception 'cannot_follow_self';
  end if;

  insert into app.follows (follower_household_id, followed_household_id)
  values (follower_id, followed_id)
  on conflict do nothing;

  delete from app.household_follow_codes where code = p_code;

  return followed_id;
end;
$$;

revoke all on function app.add_follow(text) from public, anon;
grant execute on function app.add_follow(text) to authenticated;
