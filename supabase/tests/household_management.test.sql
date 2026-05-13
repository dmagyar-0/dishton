-- supabase/tests/household_management.test.sql
-- Persona checks for the leave_household + transfer_ownership RPCs and the
-- "editors cannot delete other members" RLS invariant.
--
-- Personas in this test:
--   A = 00000000-0000-0000-0000-00000000000a  (sole owner of H1)
--   B = 00000000-0000-0000-0000-00000000000b  (editor of H1)
--   C = 00000000-0000-0000-0000-00000000000c  (sole owner of H2)
--   E = 00000000-0000-0000-0000-00000000000e  (second owner of H3, used to test
--                                              "owner leaving when not last" + transfer)
--   F = 00000000-0000-0000-0000-00000000000f  (editor of H3)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000a',
   'authenticated','authenticated','hm-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000b',
   'authenticated','authenticated','hm-b@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000c',
   'authenticated','authenticated','hm-c@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000e',
   'authenticated','authenticated','hm-e@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-00000000000f',
   'authenticated','authenticated','hm-f@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a','Persona A'),
  ('00000000-0000-0000-0000-00000000000b','Persona B'),
  ('00000000-0000-0000-0000-00000000000c','Persona C'),
  ('00000000-0000-0000-0000-00000000000e','Persona E'),
  ('00000000-0000-0000-0000-00000000000f','Persona F')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('dddddddd-0000-0000-0000-000000000001','HM H1',
   '00000000-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-000000000002','HM H2',
   '00000000-0000-0000-0000-00000000000c'),
  ('dddddddd-0000-0000-0000-000000000003','HM H3',
   '00000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000a','owner'),
  ('dddddddd-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000000b','editor'),
  ('dddddddd-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-00000000000c','owner'),
  -- H3 starts with two owners (A and E) plus editor F
  ('dddddddd-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-00000000000a','owner'),
  ('dddddddd-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-00000000000e','owner'),
  ('dddddddd-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-00000000000f','editor')
on conflict do nothing;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _t_results(label text, ok boolean) on commit drop;

create or replace function pg_temp.check_as(
  p_label text, p_persona uuid, p_check boolean
) returns void language plpgsql as $$
begin
  insert into _t_results(label, ok) values (p_label, coalesce(p_check, false));
end;
$$;

-- Call leave_household as a persona; return the SQLSTATE-text/error-message or
-- the literal 'ok' if it succeeded.
create or replace function pg_temp.call_leave_as(
  p_persona uuid, p_household uuid
) returns text language plpgsql as $$
declare msg text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  begin
    perform app.leave_household(p_household);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Call transfer_ownership as a persona.
create or replace function pg_temp.call_transfer_as(
  p_persona uuid, p_household uuid, p_new_owner uuid
) returns text language plpgsql as $$
declare msg text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  begin
    perform app.transfer_ownership(p_household, p_new_owner);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- DELETE another member's row as a persona; return the affected row count.
create or replace function pg_temp.delete_member_as(
  p_persona uuid, p_household uuid, p_target uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text,
    true);
  delete from app.household_members
   where household_id = p_household
     and profile_id = p_target;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- Count members in a household (as the postgres role, after the call).
create or replace function pg_temp.members_count(p_household uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  select count(*) into n from app.household_members where household_id = p_household;
  return n;
end;
$$;

create or replace function pg_temp.role_of(p_household uuid, p_profile uuid)
returns text language plpgsql as $$
declare r text;
begin
  select role into r from app.household_members
   where household_id = p_household and profile_id = p_profile;
  return r;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. Editor B can leave H1.
select pg_temp.check_as(
  'B (editor) can leave H1',
  '00000000-0000-0000-0000-00000000000b'::uuid,
  pg_temp.call_leave_as(
    '00000000-0000-0000-0000-00000000000b'::uuid,
    'dddddddd-0000-0000-0000-000000000001'::uuid
  ) = 'ok');

-- 1b. After B leaves, H1 has only A.
select pg_temp.check_as(
  'H1 has one member after B leaves',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.members_count('dddddddd-0000-0000-0000-000000000001'::uuid) = 1);

-- 2. A (sole remaining owner of H1) cannot leave.
select pg_temp.check_as(
  'A (sole owner) blocked from leaving H1',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.call_leave_as(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'dddddddd-0000-0000-0000-000000000001'::uuid
  ) = 'last_owner');

-- 3. Unrelated persona attempting to leave a household they aren't in.
select pg_temp.check_as(
  'C cannot leave H1 (not a member)',
  '00000000-0000-0000-0000-00000000000c'::uuid,
  pg_temp.call_leave_as(
    '00000000-0000-0000-0000-00000000000c'::uuid,
    'dddddddd-0000-0000-0000-000000000001'::uuid
  ) = 'not_a_member');

-- 4. transfer_ownership: A transfers H3 to F (editor → owner).
select pg_temp.check_as(
  'A transfers H3 ownership to F',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.call_transfer_as(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000f'::uuid
  ) = 'ok');

-- 4b. After transfer, F is owner.
select pg_temp.check_as(
  'F is owner of H3 after transfer',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.role_of(
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000f'::uuid
  ) = 'owner');

-- 4c. A is now editor of H3.
select pg_temp.check_as(
  'A is editor of H3 after transfer',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.role_of(
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000a'::uuid
  ) = 'editor');

-- 5. Editor F (now-owner of H3) cannot transfer to a non-member.
select pg_temp.check_as(
  'transfer to non-member rejected',
  '00000000-0000-0000-0000-00000000000f'::uuid,
  pg_temp.call_transfer_as(
    '00000000-0000-0000-0000-00000000000f'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000c'::uuid
  ) = 'target_not_a_member');

-- 6. Non-owner cannot call transfer_ownership.
select pg_temp.check_as(
  'editor cannot transfer ownership',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.call_transfer_as(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000e'::uuid
  ) = 'not_household_owner');

-- 7. cannot transfer to self.
select pg_temp.check_as(
  'cannot transfer to self',
  '00000000-0000-0000-0000-00000000000f'::uuid,
  pg_temp.call_transfer_as(
    '00000000-0000-0000-0000-00000000000f'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000f'::uuid
  ) = 'cannot_transfer_to_self');

-- 8. Now that H3 has F (owner) and E (owner), F can leave because they are
--    not the sole owner.
select pg_temp.check_as(
  'F (one of two owners) can leave H3',
  '00000000-0000-0000-0000-00000000000f'::uuid,
  pg_temp.call_leave_as(
    '00000000-0000-0000-0000-00000000000f'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid
  ) = 'ok');

-- 9. RLS guards on direct DELETE of household_members:
--    A (currently editor of H3) cannot delete E's owner row.
select pg_temp.check_as(
  'editor cannot remove other members',
  '00000000-0000-0000-0000-00000000000a'::uuid,
  pg_temp.delete_member_as(
    '00000000-0000-0000-0000-00000000000a'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000e'::uuid
  ) = 0);

-- 10. Owner E can remove member A (now editor of H3) via direct delete.
select pg_temp.check_as(
  'owner can remove a member',
  '00000000-0000-0000-0000-00000000000e'::uuid,
  pg_temp.delete_member_as(
    '00000000-0000-0000-0000-00000000000e'::uuid,
    'dddddddd-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-00000000000a'::uuid
  ) = 1);

-- 11. unauthenticated leave (no jwt sub) → not_authenticated.
do $$
declare msg text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated')::text, true);
  begin
    perform app.leave_household('dddddddd-0000-0000-0000-000000000001'::uuid);
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);
  insert into _t_results(label, ok)
    values ('unauthenticated leave rejected', msg = 'not_authenticated');
end;
$$;

-- Output the TAP rows.
select label, ok from _t_results order by label;
