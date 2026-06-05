-- supabase/tests/production_readiness.test.sql
-- Persona checks for the production-readiness hardening:
--   D — create_invite is OWNERS ONLY (editor rejected, owner ok).
--   C — the dropped household_invites_redeemer_update policy: a non-owner can
--       no longer UPDATE an open invite row.
--   I — delete_household refuses personal households, allows shared ones,
--       and rejects non-owners.
--   E — save_recipe drops tags that are not in the household allowed_tags
--       whitelist and normalises (lower/trim) the rest.
--   H — add_follow verifies the caller owns the passed follower household.
--   J — update_recipe raises recipe_edit_conflict on a stale token.
--
-- Personas:
--   O = ...0000000000a1  (owner of shared household PH1)
--   M = ...0000000000a2  (editor of PH1)
--   X = ...0000000000a3  (owner of shared household PH2; unrelated to PH1)
-- Households:
--   PH1 = shared (O owner, M editor)
--   PH2 = shared (X owner)
--   PP  = personal household owned by O (is_personal = true)

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','pr-o@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','pr-m@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','pr-x@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1','Persona O'),
  ('00000000-0000-0000-0000-0000000000a2','Persona M'),
  ('00000000-0000-0000-0000-0000000000a3','Persona X')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id, is_personal, allowed_tags) values
  ('eeeeeeee-0000-0000-0000-000000000001','PR Shared 1',
   '00000000-0000-0000-0000-0000000000a1', false, array['main','dessert']::text[]),
  ('eeeeeeee-0000-0000-0000-000000000002','PR Shared 2',
   '00000000-0000-0000-0000-0000000000a3', false, array['main']::text[]),
  ('eeeeeeee-0000-0000-0000-0000000000e1','PR Personal O',
   '00000000-0000-0000-0000-0000000000a1', true, array['main']::text[])
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1','owner'),
  ('eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a2','editor'),
  ('eeeeeeee-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a3','owner'),
  ('eeeeeeee-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000a1','owner')
on conflict do nothing;

-- A follow code created by X for PH2, redeemable as a follow by another owner.
insert into app.household_follow_codes (code, household_id, created_by) values
  ('f_ABCDEFGH2345','eeeeeeee-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a3')
on conflict do nothing;

-- An open invite on PH1 that the redeemer-update probe will try to retarget.
insert into app.household_invites (code, household_id, created_by) values
  ('OPENINVT','eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

-- A recipe in PH1 for the update_recipe concurrency check.
insert into app.recipes (id, household_id, created_by, title, source_type,
                         source_language, canonical_unit_system, servings) values
  ('ffffffff-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1',
   'PR Recipe','manual','en','metric',2)
on conflict (id) do nothing;

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

-- create_invite as a persona; returns 'ok' or the error message.
create or replace function pg_temp.call_create_invite_as(
  p_persona uuid, p_household uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.create_invite(p_household);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- delete_household as a persona; returns 'ok' or the error message.
create or replace function pg_temp.call_delete_household_as(
  p_persona uuid, p_household uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.delete_household(p_household);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- add_follow as a persona; returns 'ok' or the error message.
create or replace function pg_temp.call_add_follow_as(
  p_persona uuid, p_code text, p_follower uuid
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.add_follow(p_code, p_follower);
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

-- Direct UPDATE of an open invite's household_id as a persona; returns the
-- affected row count (RLS should now block this -> 0).
create or replace function pg_temp.retarget_invite_as(
  p_persona uuid, p_code text, p_new_household uuid
) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  update app.household_invites
     set household_id = p_new_household
   where code = p_code;
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- save_recipe as a persona with the given tags; returns the new recipe id.
create or replace function pg_temp.save_with_tags_as(
  p_persona uuid, p_household uuid, p_tags jsonb
) returns uuid language plpgsql as $$
declare new_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  select app.save_recipe(p_household, jsonb_build_object(
    'title', 'Tag whitelist probe',
    'description', null,
    'source_type', 'manual',
    'source_url', null,
    'source_language', 'en',
    'canonical_unit_system', 'metric',
    'servings', 2,
    'total_time_min', null,
    'hero_image_path', null,
    'tags', p_tags,
    'ingredients', '[]'::jsonb,
    'steps', '[]'::jsonb
  )) into new_id;
  perform set_config('role', 'postgres', true);
  return new_id;
end;
$$;

-- update_recipe as a persona with an explicit expected_updated_at token.
create or replace function pg_temp.call_update_recipe_as(
  p_persona uuid, p_recipe uuid, p_expected timestamptz
) returns text language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_persona::text, 'role', 'authenticated')::text, true);
  begin
    perform app.update_recipe(
      p_recipe,
      jsonb_build_object(
        'title', 'Updated title',
        'description', null,
        'source_type', 'manual',
        'source_url', null,
        'source_language', 'en',
        'canonical_unit_system', 'metric',
        'servings', 2,
        'total_time_min', null,
        'hero_image_path', null,
        'tags', '[]'::jsonb,
        'ingredients', '[]'::jsonb,
        'steps', '[]'::jsonb
      ),
      p_expected
    );
    perform set_config('role', 'postgres', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'postgres', true);
    return SQLERRM;
  end;
end;
$$;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- D. Editor M cannot create an invite for PH1.
select pg_temp.check_as(
  'editor cannot create_invite',
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  pg_temp.call_create_invite_as(
    '00000000-0000-0000-0000-0000000000a2'::uuid,
    'eeeeeeee-0000-0000-0000-000000000001'::uuid
  ) = 'not_household_owner');

-- D. Owner O can create an invite for PH1.
select pg_temp.check_as(
  'owner can create_invite',
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  pg_temp.call_create_invite_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'eeeeeeee-0000-0000-0000-000000000001'::uuid
  ) = 'ok');

-- C. Unrelated persona X cannot retarget the open invite via direct UPDATE.
select pg_temp.check_as(
  'redeemer-update policy dropped: retarget denied',
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  pg_temp.retarget_invite_as(
    '00000000-0000-0000-0000-0000000000a3'::uuid,
    'OPENINVT',
    'eeeeeeee-0000-0000-0000-000000000002'::uuid
  ) = 0);

-- I. Owner O cannot delete their personal household.
select pg_temp.check_as(
  'delete_household refuses personal household',
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  pg_temp.call_delete_household_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'eeeeeeee-0000-0000-0000-0000000000e1'::uuid
  ) = 'cannot_delete_personal_household');

-- I. Editor M cannot delete the shared household.
select pg_temp.check_as(
  'delete_household rejects non-owner',
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  pg_temp.call_delete_household_as(
    '00000000-0000-0000-0000-0000000000a2'::uuid,
    'eeeeeeee-0000-0000-0000-000000000001'::uuid
  ) = 'not_household_owner');

-- E. save_recipe in PH1 (allowed_tags = main,dessert) keeps only whitelisted,
--    normalised tags. Input: ['Main', ' dessert ', 'spicy'] -> {main,dessert}.
do $$
declare rid uuid;
begin
  rid := pg_temp.save_with_tags_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'eeeeeeee-0000-0000-0000-000000000001'::uuid,
    '["Main"," dessert ","spicy"]'::jsonb
  );
  insert into _t_results(label, ok)
  select 'save_recipe keeps only whitelisted tags',
    (select array_agg(tag order by tag) from app.recipe_tags where recipe_id = rid)
      = array['dessert','main']::text[];
end $$;

-- H. add_follow rejects a follower household the caller does not own. O tries
--    to follow PH2 (X's) but passes PH2 itself as follower -> not owner.
select pg_temp.check_as(
  'add_follow rejects non-owned follower household',
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'f_ABCDEFGH2345',
    'eeeeeeee-0000-0000-0000-000000000002'::uuid
  ) = 'not_household_owner');

-- H. add_follow succeeds when O follows PH2 under their owned PH1.
select pg_temp.check_as(
  'add_follow succeeds for owned follower household',
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  pg_temp.call_add_follow_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'f_ABCDEFGH2345',
    'eeeeeeee-0000-0000-0000-000000000001'::uuid
  ) = 'ok');

-- I. Owner X can delete their shared household PH2. Runs after the add_follow
--    checks because deleting PH2 cascades its follow code away.
select pg_temp.check_as(
  'delete_household allows shared household for owner',
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  pg_temp.call_delete_household_as(
    '00000000-0000-0000-0000-0000000000a3'::uuid,
    'eeeeeeee-0000-0000-0000-000000000002'::uuid
  ) = 'ok');

-- J. update_recipe with a stale expected_updated_at raises recipe_edit_conflict.
select pg_temp.check_as(
  'update_recipe rejects stale token',
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  pg_temp.call_update_recipe_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'ffffffff-0000-0000-0000-000000000001'::uuid,
    'epoch'::timestamptz
  ) = 'recipe_edit_conflict');

-- J. update_recipe with the matching token succeeds.
do $$
declare cur timestamptz; res text;
begin
  select updated_at into cur from app.recipes
   where id = 'ffffffff-0000-0000-0000-000000000001';
  res := pg_temp.call_update_recipe_as(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    'ffffffff-0000-0000-0000-000000000001'::uuid,
    cur
  );
  insert into _t_results(label, ok)
    values ('update_recipe accepts matching token', res = 'ok');
end $$;

-- Output the TAP rows.
select label, ok from _t_results order by label;
