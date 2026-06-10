-- supabase/tests/signup_display_name.test.sql
-- Verifies that app.handle_new_user() picks up display_name from
-- raw_user_meta_data at signup and falls back to the email local-part when
-- no metadata is provided.
--
-- Personas:
--   W = 00000000-0000-0000-0000-0000000000a1  (signs up with display_name metadata)
--   X = 00000000-0000-0000-0000-0000000000a2  (signs up without display_name metadata)
--   Y = 00000000-0000-0000-0000-0000000000a3  (signs up with whitespace-only display_name)

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

create temporary table _dn_results(label text, ok boolean) on commit drop;

------------------------------------------------------------------------------
-- Fixture: insert auth.users with the trigger ENABLED so handle_new_user fires.
-- W has a display_name in metadata; X has empty metadata; Y has a whitespace
-- display_name that should be treated as absent.
------------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  -- W: supplies "Visual Tester" → profile display_name should be "Visual Tester"
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','visual.tester@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Visual Tester"}'::jsonb,
   now(), now()),
  -- X: no display_name → falls back to email local-part "fallback-user"
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','fallback-user@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{}'::jsonb,
   now(), now()),
  -- Y: whitespace-only display_name → treated as absent, falls back to "whitespace-test"
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','whitespace-test@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"   "}'::jsonb,
   now(), now())
on conflict (id) do nothing;

------------------------------------------------------------------------------
-- Assertions
------------------------------------------------------------------------------

-- 1. W signed up with display_name metadata → profile is "Visual Tester"
insert into _dn_results(label, ok)
select 'signup with display_name metadata uses metadata value',
       display_name = 'Visual Tester'
from app.profiles
where id = '00000000-0000-0000-0000-0000000000a1';

-- 2. X signed up without display_name → falls back to email local-part
insert into _dn_results(label, ok)
select 'signup without display_name falls back to email local-part',
       display_name = 'fallback-user'
from app.profiles
where id = '00000000-0000-0000-0000-0000000000a2';

-- 3. Y signed up with whitespace-only display_name → treated as absent,
--    falls back to email local-part
insert into _dn_results(label, ok)
select 'signup with whitespace-only display_name falls back to email local-part',
       display_name = 'whitespace-test'
from app.profiles
where id = '00000000-0000-0000-0000-0000000000a3';

-- 4. W's personal household was also created by the trigger
insert into _dn_results(label, ok)
select 'trigger also creates personal household for metadata-signup user',
       count(*) = 1
from app.households
where owner_profile_id = '00000000-0000-0000-0000-0000000000a1'
  and is_personal;

-- Output the TAP rows.
select label, ok from _dn_results order by label;
