-- Regression test for the bug seen on prod 2026-05-24:
--   ERROR: update or delete on table "households" violates foreign key
--   constraint "import_jobs_household_id_fkey" on table "import_jobs"
--
-- A solo redeemer who has any import_jobs in their personal household used
-- to fail `app.redeem_invite` because the personal household delete at the
-- end of the merge path violated the NO-ACTION FK on import_jobs. Fixed in
-- 20260524130000_import_jobs_cascade.sql by switching the FK to
-- ON DELETE CASCADE.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','rij-owner@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','rij-guest@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1','Inviter'),
  ('00000000-0000-0000-0000-0000000000a2','Guest')
on conflict (id) do nothing;

-- Inviter's household (NOT personal — they want to share it).
insert into app.households (id, name, owner_profile_id, is_personal) values
  ('eeeeeeee-0000-0000-0000-000000000001','Inviter Home',
   '00000000-0000-0000-0000-0000000000a1', false)
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1','owner')
on conflict do nothing;

-- Guest's personal household (this is what gets deleted during merge).
insert into app.households (id, name, owner_profile_id, is_personal) values
  ('eeeeeeee-0000-0000-0000-000000000002','My Recipes',
   '00000000-0000-0000-0000-0000000000a2', true)
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a2','owner')
on conflict do nothing;

-- The actual repro condition: guest has an import_jobs row tied to their
-- personal household. Before the fix this row blocks the household delete.
insert into app.import_jobs (id, profile_id, household_id, kind, status) values
  ('eeeeeeee-aaaa-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a2',
   'eeeeeeee-0000-0000-0000-000000000002',
   'url', 'done')
on conflict (id) do nothing;

-- Inviter creates an invite for their household. Insert directly — the RLS
-- on household_invites permits this for the household owner, but we run as
-- postgres here for fixture brevity.
-- Code must satisfy household_invites_code_check (base32, A-Z2-7, length 8).
insert into app.household_invites (code, household_id, created_by, expires_at) values
  ('TESTCODE', 'eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1', now() + interval '1 day')
on conflict (code) do nothing;

create temporary table _t_results(label text, ok boolean) on commit drop;

-- Drive redeem as the guest persona, capturing any error.
do $$
declare
  msg text;
  resulting_hh uuid;
  guest uuid := '00000000-0000-0000-0000-0000000000a2';
  guest_personal uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  inviter_hh uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  membership_count int;
  personal_still_there int;
  job_still_there int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', guest::text, 'role', 'authenticated')::text, true);
  begin
    resulting_hh := app.redeem_invite('TESTCODE');
    msg := 'ok';
  exception when others then
    msg := SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  insert into _t_results(label, ok)
    values ('redeem_invite succeeds for solo user with prior import_jobs',
            msg = 'ok' and resulting_hh = inviter_hh);

  -- Guest is now a member of the inviter's household and nothing else.
  select count(*) into membership_count
  from app.household_members where profile_id = guest;
  insert into _t_results(label, ok)
    values ('guest has exactly one membership after redeem',
            membership_count = 1);

  -- Personal household was removed (this is the line that used to fail).
  select count(*) into personal_still_there
  from app.households where id = guest_personal;
  insert into _t_results(label, ok)
    values ('personal household deleted after merge',
            personal_still_there = 0);

  -- The old import_jobs row was cascaded away with the household.
  select count(*) into job_still_there
  from app.import_jobs
  where id = 'eeeeeeee-aaaa-0000-0000-000000000001';
  insert into _t_results(label, ok)
    values ('orphaned import_jobs row cascade-deleted',
            job_still_there = 0);
end;
$$;

-- Belt-and-suspenders: with the cascade in place, deleting a household
-- directly should also clean its import_jobs.
do $$
declare
  hh uuid := 'eeeeeeee-0000-0000-0000-000000000003';
  job_count int;
begin
  insert into app.households (id, name, owner_profile_id, is_personal)
    values (hh, 'Direct Delete', '00000000-0000-0000-0000-0000000000a1', false);
  insert into app.household_members (household_id, profile_id, role)
    values (hh, '00000000-0000-0000-0000-0000000000a1', 'owner');
  insert into app.import_jobs (profile_id, household_id, kind, status)
    values ('00000000-0000-0000-0000-0000000000a1', hh, 'url', 'queued');

  delete from app.households where id = hh;

  select count(*) into job_count
  from app.import_jobs where household_id = hh;
  insert into _t_results(label, ok)
    values ('direct household delete cascades to import_jobs',
            job_count = 0);
end;
$$;

select label, ok from _t_results order by label;
