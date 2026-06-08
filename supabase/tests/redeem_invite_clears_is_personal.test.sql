-- Regression test for the "still solo after someone joined" bug.
--
-- app.redeem_invite's merge path moves a solo redeemer into the inviter's
-- household but historically left the target household's is_personal flag set.
-- A personal household with two members is an inconsistent state: every
-- "are you solo?" check in the SPA keys off is_personal, so the inviter kept
-- seeing the solo "This space is yours" settings UI after their guest joined.
--
-- Fixed by clearing is_personal on the target once it has more than one
-- member. These tests pin both halves of that rule: clear when the merge
-- makes the household multi-member, leave it alone when no new member joins.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','cip-inviter@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','cip-guest@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b3',
   'authenticated','authenticated','cip-solo@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000b1','Inviter'),
  ('00000000-0000-0000-0000-0000000000b2','Guest'),
  ('00000000-0000-0000-0000-0000000000b3','Solo')
on conflict (id) do nothing;

-- Inviter's PERSONAL household — this mirrors the real bug: an inviter who
-- shares their auto-created "My Recipes" space rather than a named household.
insert into app.households (id, name, owner_profile_id, is_personal) values
  ('cccccccc-0000-0000-0000-000000000001','My Recipes',
   '00000000-0000-0000-0000-0000000000b1', true)
on conflict (id) do nothing;
insert into app.household_members (household_id, profile_id, role) values
  ('cccccccc-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1','owner')
on conflict do nothing;

-- Guest's personal household (deleted during the merge).
insert into app.households (id, name, owner_profile_id, is_personal) values
  ('cccccccc-0000-0000-0000-000000000002','My Recipes',
   '00000000-0000-0000-0000-0000000000b2', true)
on conflict (id) do nothing;
insert into app.household_members (household_id, profile_id, role) values
  ('cccccccc-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000b2','owner')
on conflict do nothing;

-- Solo persona's personal household — never joined by anyone. Used for the
-- self-redeem guard below.
insert into app.households (id, name, owner_profile_id, is_personal) values
  ('cccccccc-0000-0000-0000-000000000003','My Recipes',
   '00000000-0000-0000-0000-0000000000b3', true)
on conflict (id) do nothing;
insert into app.household_members (household_id, profile_id, role) values
  ('cccccccc-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-0000000000b3','owner')
on conflict do nothing;

-- Invites (direct insert as postgres for fixture brevity; codes are base32).
insert into app.household_invites (code, household_id, created_by, expires_at) values
  ('MERGECOD', 'cccccccc-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1', now() + interval '1 day'),
  ('SELFCODE', 'cccccccc-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-0000000000b3', now() + interval '1 day')
on conflict (code) do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

-- Scenario 1: solo guest merges into the inviter's personal household.
do $$
declare
  msg text;
  resulting_hh uuid;
  guest uuid := '00000000-0000-0000-0000-0000000000b2';
  target_hh uuid := 'cccccccc-0000-0000-0000-000000000001';
  guest_personal uuid := 'cccccccc-0000-0000-0000-000000000002';
  target_is_personal boolean;
  target_members int;
  guest_personal_left int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', guest::text, 'role', 'authenticated')::text, true);
  begin
    resulting_hh := app.redeem_invite('MERGECOD');
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  insert into _t_results(label, ok)
    values ('merge redeem succeeds and returns the target household',
            msg = 'ok' and resulting_hh = target_hh);

  -- THE FIX: a household with a second member is no longer a personal space.
  select is_personal into target_is_personal
  from app.households where id = target_hh;
  insert into _t_results(label, ok)
    values ('target household is no longer is_personal after merge',
            target_is_personal = false);

  select count(*) into target_members
  from app.household_members where household_id = target_hh;
  insert into _t_results(label, ok)
    values ('target household has both members after merge',
            target_members = 2);

  select count(*) into guest_personal_left
  from app.households where id = guest_personal;
  insert into _t_results(label, ok)
    values ('guest personal household removed by merge',
            guest_personal_left = 0);
end;
$$;

-- Scenario 2 (guard): redeeming an invite that adds no new member must NOT
-- clear is_personal. The solo persona redeems their own household's invite;
-- the on-conflict-do-nothing insert is a no-op, so they stay a 1-member
-- personal space.
do $$
declare
  msg text;
  solo uuid := '00000000-0000-0000-0000-0000000000b3';
  solo_hh uuid := 'cccccccc-0000-0000-0000-000000000003';
  still_personal boolean;
  member_count int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', solo::text, 'role', 'authenticated')::text, true);
  begin
    perform app.redeem_invite('SELFCODE');
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  select is_personal, (
    select count(*) from app.household_members where household_id = solo_hh
  ) into still_personal, member_count
  from app.households where id = solo_hh;

  insert into _t_results(label, ok)
    values ('self-redeem leaves a one-member personal household personal',
            still_personal = true and member_count = 1);
end;
$$;

select label, ok from _t_results order by label;
