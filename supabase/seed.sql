-- supabase/seed.sql
-- Local-only seed data per docs/04-data-model.md and docs/15-roadmap-and-flags.md.
-- Loaded by `supabase db reset` after migrations.
--
-- Note: inserting directly into auth.users requires service-role context. We
-- include the minimal columns plus a stub bcrypt password so the local stack
-- can exchange them for sessions.

set search_path = public;

------------------------------------------------------------------------------
-- Detach the handle_new_user trigger temporarily so we can insert profiles
-- with explicit display names rather than the email-prefix default.
------------------------------------------------------------------------------

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'alice@example.test',
   crypt('test1234', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'bob@example.test',
   crypt('test1234', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'carol@example.test',
   crypt('test1234', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-000000000001','Alice'),
  ('00000000-0000-0000-0000-000000000002','Bob'),
  ('00000000-0000-0000-0000-000000000003','Carol')
on conflict (id) do nothing;

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
   'manual','it','metric',12,1440)
on conflict (id) do nothing;

insert into app.recipe_ingredients (recipe_id, position, raw_text, quantity, unit, ingredient_name) values
  ('33333333-3333-3333-3333-333333333333',0,'500 g cherry tomatoes',500,'g','cherry tomatoes'),
  ('33333333-3333-3333-3333-333333333333',1,'1 sheet puff pastry',1,'count','puff pastry'),
  ('33333333-3333-3333-3333-333333333333',2,'2 tbsp olive oil',2,'tbsp','olive oil'),
  ('44444444-4444-4444-4444-444444444444',0,'10 lemons',10,'count','lemons'),
  ('44444444-4444-4444-4444-444444444444',1,'1 l vodka',1,'l','vodka'),
  ('44444444-4444-4444-4444-444444444444',2,'700 g sugar',700,'g','sugar')
on conflict do nothing;

insert into app.recipe_steps (recipe_id, position, body, duration_min) values
  ('33333333-3333-3333-3333-333333333333',0,'Heat oven to 200C.',5),
  ('33333333-3333-3333-3333-333333333333',1,'Caramelise tomatoes in a skillet.',15),
  ('33333333-3333-3333-3333-333333333333',2,'Top with pastry and bake 25 minutes.',25),
  ('44444444-4444-4444-4444-444444444444',0,'Peel lemon zest, avoid pith.',20),
  ('44444444-4444-4444-4444-444444444444',1,'Steep zest in vodka 24 hours.',1440),
  ('44444444-4444-4444-4444-444444444444',2,'Add sugar syrup and bottle.',30)
on conflict do nothing;

insert into app.recipe_tags (recipe_id, tag) values
  ('33333333-3333-3333-3333-333333333333','tomato'),
  ('33333333-3333-3333-3333-333333333333','pastry'),
  ('33333333-3333-3333-3333-333333333333','vegetarian'),
  ('44444444-4444-4444-4444-444444444444','lemon'),
  ('44444444-4444-4444-4444-444444444444','liqueur'),
  ('44444444-4444-4444-4444-444444444444','italian')
on conflict do nothing;

------------------------------------------------------------------------------
-- Feature flags per docs/15-roadmap-and-flags.md.
-- Local defaults: follows_enabled=true, public_household_pages=false.
------------------------------------------------------------------------------

insert into app.feature_flags (key, enabled, rollout_percent) values
  ('follows_enabled',         true,  100),
  ('public_household_pages',  false, 0)
on conflict (key) do update set
  enabled         = excluded.enabled,
  rollout_percent = excluded.rollout_percent,
  updated_at      = now();
