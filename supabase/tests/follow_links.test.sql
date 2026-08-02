-- supabase/tests/follow_links.test.sql
-- Coverage for shareable follow links (multi-use app.add_follow,
-- app.peek_follow_code) per
-- docs/superpowers/specs/2026-08-02-shareable-follow-links-design.md.
-- Pattern mirrors household_management.test.sql / recipe_shares.test.sql:
-- fixtures, pg_temp persona helpers via set_config('role', ...), a
-- _t_results temp table emitted as the final SELECT, transaction rollback.
--
-- Topology:
--   A = owner of H1 (source household, holds the follow codes)
--   B = owner of H2 (first follower)
--   C = owner of H3 (second follower — proves the code is multi-use)
--   E = editor (not owner) of H2 — proves redeeming still requires ownership

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000aa',
   'authenticated','authenticated','flink-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000bb',
   'authenticated','authenticated','flink-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000cc',
   'authenticated','authenticated','flink-c@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000ee',
   'authenticated','authenticated','flink-e@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000aa','Flink A'),
  ('00000000-0000-0000-0000-0000000000bb','Flink B'),
  ('00000000-0000-0000-0000-0000000000cc','Flink C'),
  ('00000000-0000-0000-0000-0000000000ee','Flink E')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('eeeeeeee-0000-0000-0000-000000000011','Flink H1',
   '00000000-0000-0000-0000-0000000000aa'),
  ('eeeeeeee-0000-0000-0000-000000000022','Flink H2',
   '00000000-0000-0000-0000-0000000000bb'),
  ('eeeeeeee-0000-0000-0000-000000000033','Flink H3',
   '00000000-0000-0000-0000-0000000000cc')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa','owner'),
  ('eeeeeeee-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-0000000000bb','owner'),
  ('eeeeeeee-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-0000000000ee','editor'),
  ('eeeeeeee-0000-0000-0000-000000000033',
   '00000000-0000-0000-0000-0000000000cc','owner')
on conflict do nothing;

-- A live code and an already-expired code, both on H1.
insert into app.household_follow_codes (code, household_id, created_by, expires_at) values
  ('f_LIVECODEAAAA','eeeeeeee-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa', now() + interval '30 days'),
  ('f_EXPIREDAAAAA','eeeeeeee-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa', now() - interval '1 hour')
on conflict (code) do nothing;

-- A third code that is then immediately revoked (deleted) — indistinguishable
-- from "unknown" by design, per the spec.
insert into app.household_follow_codes (code, household_id, created_by, expires_at) values
  ('f_REVOKEDAAAAA','eeeeeeee-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-0000000000aa', now() + interval '30 days')
on conflict (code) do nothing;
delete from app.household_follow_codes where code = 'f_REVOKEDAAAAA';

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_ok(p_label text, p_check boolean)
returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

-- Call add_follow as a persona; returns 'ok:<followed_id>' on success or the
-- raised exception message (e.g. 'invalid_or_expired_follow_code').
create or replace function pg_temp.call_add_follow_as(
  p_persona uuid, p_code text, p_follower uuid
) returns text language plpgsql as $$
declare followed uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  begin
    select app.add_follow(p_code, p_follower) into followed;
    perform set_config('role', 'postgres', true);
    return 'ok:' || followed::text;
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

create or replace function pg_temp.q_anon_peek(p_code text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select app.peek_follow_code(p_code) into result;
  perform set_config('role', 'postgres', true);
  return result;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. peek_follow_code names the household for a live code.
select pg_temp.check_ok(
  'peek returns the household for a live code',
  (select p->>'household_id' = 'eeeeeeee-0000-0000-0000-000000000011'
      and p->>'household_name' = 'Flink H1'
   from pg_temp.q_anon_peek('f_LIVECODEAAAA') as p));

-- 2. peek_follow_code returns null for an unknown code.
select pg_temp.check_ok(
  'peek returns null for an unknown code',
  pg_temp.q_anon_peek('f_UNKNOWNAAAA') is null);

-- 3. peek_follow_code returns null for an expired code.
select pg_temp.check_ok(
  'peek returns null for an expired code',
  pg_temp.q_anon_peek('f_EXPIREDAAAAA') is null);

-- 4. peek_follow_code returns null for a revoked code.
select pg_temp.check_ok(
  'peek returns null for a revoked code',
  pg_temp.q_anon_peek('f_REVOKEDAAAAA') is null);

-- 5. Editor E (not owner) of H2 cannot redeem — not_household_owner.
select pg_temp.check_ok(
  'non-owner redeem raises not_household_owner',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000ee'::uuid,
    'f_LIVECODEAAAA',
    'eeeeeeee-0000-0000-0000-000000000022'::uuid) = 'not_household_owner');

-- 6. Owner A cannot follow their own household with their own code.
select pg_temp.check_ok(
  'self-follow raises cannot_follow_self',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000aa'::uuid,
    'f_LIVECODEAAAA',
    'eeeeeeee-0000-0000-0000-000000000011'::uuid) = 'cannot_follow_self');

-- 7. An expired code raises invalid_or_expired_follow_code.
select pg_temp.check_ok(
  'expired code raises invalid_or_expired_follow_code',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'f_EXPIREDAAAAA',
    'eeeeeeee-0000-0000-0000-000000000022'::uuid) = 'invalid_or_expired_follow_code');

-- 8. A revoked code raises invalid_or_expired_follow_code (indistinguishable
--    from unknown, same as peek).
select pg_temp.check_ok(
  'revoked code raises invalid_or_expired_follow_code',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'f_REVOKEDAAAAA',
    'eeeeeeee-0000-0000-0000-000000000022'::uuid) = 'invalid_or_expired_follow_code');

-- 9. Owner B of H2 redeems the live code successfully.
select pg_temp.check_ok(
  'B redeems the live code',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'f_LIVECODEAAAA',
    'eeeeeeee-0000-0000-0000-000000000022'::uuid) =
      'ok:eeeeeeee-0000-0000-0000-000000000011');

select pg_temp.check_ok(
  'H2 now follows H1',
  exists (
    select 1 from app.follows
    where follower_household_id = 'eeeeeeee-0000-0000-0000-000000000022'
      and followed_household_id = 'eeeeeeee-0000-0000-0000-000000000011'));

-- 10. THE key multi-use assertion: the code row still exists after
--     redemption — the old single-use behaviour deleted it here.
select pg_temp.check_ok(
  'the code survives redemption',
  exists (select 1 from app.household_follow_codes where code = 'f_LIVECODEAAAA'));

-- 11. Owner C of H3 redeems the SAME code successfully — a second household
--     can follow via the still-live code.
select pg_temp.check_ok(
  'C redeems the same code',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000cc'::uuid,
    'f_LIVECODEAAAA',
    'eeeeeeee-0000-0000-0000-000000000033'::uuid) =
      'ok:eeeeeeee-0000-0000-0000-000000000011');

select pg_temp.check_ok(
  'H3 now follows H1 too',
  exists (
    select 1 from app.follows
    where follower_household_id = 'eeeeeeee-0000-0000-0000-000000000033'
      and followed_household_id = 'eeeeeeee-0000-0000-0000-000000000011'));

-- 12. Redeeming again with an already-established follow is a no-op, not an
--     error (on conflict do nothing) — B redeems a second time.
select pg_temp.check_ok(
  'redeeming twice is a no-op, not an error',
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000bb'::uuid,
    'f_LIVECODEAAAA',
    'eeeeeeee-0000-0000-0000-000000000022'::uuid) =
      'ok:eeeeeeee-0000-0000-0000-000000000011');

select label, ok from _t_results order by label;
