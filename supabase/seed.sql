-- supabase/seed.sql
-- Local-only seed data per docs/04-data-model.md and docs/15-roadmap-and-flags.md.
-- Loaded by `supabase db reset` after migrations.
--
-- Note: inserting directly into auth.users requires service-role context. We
-- include the minimal columns plus a stub bcrypt password so the local stack
-- can exchange them for sessions.

set search_path = public, extensions;

------------------------------------------------------------------------------
-- The handle_new_user trigger fires on auth.users insert and creates a
-- profile with the email-prefix as display_name. We can't disable the
-- trigger from the postgres role (auth.users is owned by
-- supabase_auth_admin), so we let it run and then upsert below.
------------------------------------------------------------------------------

-- GoTrue v2.188+ rejects NULL on the *_token / *_change columns ("Database
-- error querying schema" on sign-in). Seed them as empty strings so a fresh
-- `supabase db reset` produces sign-in-ready test users.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new,
  email_change, email_change_token_current, phone_change,
  phone_change_token, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'alice@example.test',
   extensions.crypt('test1234', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'bob@example.test',
   extensions.crypt('test1234', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'carol@example.test',
   extensions.crypt('test1234', extensions.gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(),
   '', '', '', '', '', '', '', '')
on conflict (id) do update set
  confirmation_token = excluded.confirmation_token,
  recovery_token = excluded.recovery_token,
  email_change_token_new = excluded.email_change_token_new,
  email_change = excluded.email_change,
  email_change_token_current = excluded.email_change_token_current,
  phone_change = excluded.phone_change,
  phone_change_token = excluded.phone_change_token,
  reauthentication_token = excluded.reauthentication_token;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-000000000001','Alice'),
  ('00000000-0000-0000-0000-000000000002','Bob'),
  ('00000000-0000-0000-0000-000000000003','Carol')
on conflict (id) do update set display_name = excluded.display_name;

insert into app.households (id, name, owner_profile_id) values
  ('11111111-1111-1111-1111-111111111111','The Pantry',
   '00000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222','Carol''s Kitchen',
   '00000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001','owner'),
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000002','editor'),
  ('22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000003','owner')
on conflict do nothing;

insert into app.follows (follower_household_id, followed_household_id, created_at) values
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   now())
on conflict do nothing;

insert into app.recipes (
  id, household_id, created_by, title, description, source_type,
  source_language, canonical_unit_system, servings, total_time_min
) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Tomato Tarte Tatin',
   'A savoury upside-down pastry with caramelised tomatoes.',
   'manual','en','metric',4,55),
  ('44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000003',
   'Limoncello',
   'Lemon liqueur, infused for 24 hours.',
   'manual','it','metric',12,1440),
  -- A spread of meal categories in The Pantry so the Home category tiles
  -- (All · Breakfast · Lunch · Dinner · Dessert) each filter to real recipes.
  ('55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Cardamom Morning Buns',
   'Laminated buns rolled with crushed cardamom sugar.',
   'url','en','metric',12,180),
  ('66666666-6666-6666-6666-666666666666',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Green Shakshuka',
   'Eggs poached in a bright tangle of spinach, leek, and herbs.',
   'manual','en','metric',3,30),
  ('77777777-7777-7777-7777-777777777777',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Charred Broccoli, Anchovy Crumbs',
   'Broccoli pushed to the edge of burnt, with garlicky crumbs.',
   'manual','en','metric',4,25),
  ('88888888-8888-8888-8888-888888888888',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Slow-Braised Short Rib Ragù',
   'Beef short rib coaxed into a dark, glossy ragù over three hours.',
   'url','en','metric',6,210),
  ('99999999-9999-9999-9999-999999999999',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Brown Butter Chocolate Chunk Cookies',
   'Nutty brown butter, two chocolates, and a long cold rest.',
   'manual','en','metric',18,45),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Ribollita',
   'The thrifty Tuscan bread soup — cavolo nero, beans, and bread.',
   'url','it','metric',6,80),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'Pistachio & Rose Semolina Cake',
   'A syrup-soaked semolina cake, scented with rose water.',
   'url','en','metric',10,60)
on conflict (id) do nothing;

-- quantity is jsonb (the domain `number | {numerator,denominator}` union), so
-- numeric values are written as JSON numbers.
insert into app.recipe_ingredients (recipe_id, position, raw_text, quantity, unit, ingredient_name) values
  ('33333333-3333-3333-3333-333333333333',0,'500 g cherry tomatoes','500'::jsonb,'g','cherry tomatoes'),
  ('33333333-3333-3333-3333-333333333333',1,'1 sheet puff pastry','1'::jsonb,'count','puff pastry'),
  ('33333333-3333-3333-3333-333333333333',2,'2 tbsp olive oil','2'::jsonb,'tbsp','olive oil'),
  ('44444444-4444-4444-4444-444444444444',0,'10 lemons','10'::jsonb,'count','lemons'),
  ('44444444-4444-4444-4444-444444444444',1,'1 l vodka','1'::jsonb,'l','vodka'),
  ('44444444-4444-4444-4444-444444444444',2,'700 g sugar','700'::jsonb,'g','sugar')
on conflict do nothing;

insert into app.recipe_steps (recipe_id, position, body, duration_min) values
  ('33333333-3333-3333-3333-333333333333',0,'Heat oven to 200C.',5),
  ('33333333-3333-3333-3333-333333333333',1,'Caramelise tomatoes in a skillet.',15),
  ('33333333-3333-3333-3333-333333333333',2,'Top with pastry and bake 25 minutes.',25),
  ('44444444-4444-4444-4444-444444444444',0,'Peel lemon zest, avoid pith.',20),
  ('44444444-4444-4444-4444-444444444444',1,'Steep zest in vodka 24 hours.',1440),
  ('44444444-4444-4444-4444-444444444444',2,'Add sugar syrup and bottle.',30)
on conflict do nothing;

-- Tags use the meal-category vocabulary (see src/domain/default-tags.ts) so
-- they line up with the household's allowed_tags and the Home category tiles.
insert into app.recipe_tags (recipe_id, tag) values
  ('33333333-3333-3333-3333-333333333333','dinner'),
  ('33333333-3333-3333-3333-333333333333','vegetarian'),
  ('44444444-4444-4444-4444-444444444444','drinks'),
  ('55555555-5555-5555-5555-555555555555','breakfast'),
  ('66666666-6666-6666-6666-666666666666','breakfast'),
  ('66666666-6666-6666-6666-666666666666','vegetarian'),
  ('77777777-7777-7777-7777-777777777777','lunch'),
  ('77777777-7777-7777-7777-777777777777','quick'),
  ('88888888-8888-8888-8888-888888888888','dinner'),
  ('88888888-8888-8888-8888-888888888888','meat'),
  ('99999999-9999-9999-9999-999999999999','dessert'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','lunch'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','soup'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','vegetarian'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dessert')
on conflict do nothing;

-- Deterministic public share for the Tomato Tarte Tatin so local visual
-- validation and E2E can hit /r/<token> without UI setup.
insert into app.recipe_shares (recipe_id, token, created_by) values
  ('33333333-3333-3333-3333-333333333333',
   'a1b2c3d4e5f60718293a4b5c6d7e8f90',
   '00000000-0000-0000-0000-000000000001')
on conflict (recipe_id) do nothing;

------------------------------------------------------------------------------
-- Feature flags per docs/15-roadmap-and-flags.md.
-- Local defaults: follows_enabled=true, public_household_pages=false.
------------------------------------------------------------------------------

insert into app.feature_flags (key, enabled, rollout_percent) values
  ('follows_enabled',         true,  100),
  ('public_household_pages',  false, 0),
  ('public_recipe_shares',    true,  100)
on conflict (key) do update set
  enabled         = excluded.enabled,
  rollout_percent = excluded.rollout_percent,
  updated_at      = now();
