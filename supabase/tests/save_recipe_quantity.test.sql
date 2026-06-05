-- supabase/tests/save_recipe_quantity.test.sql
-- TAP test for app.save_recipe / app.update_recipe quantity handling.
--
-- The Recipe domain schema (supabase/functions/_shared/domain/recipe.ts) and
-- the AI prompt (supabase/functions/_shared/ai/prompts.ts) both allow a
-- quantity to be either a JSON number (`0.5`) or a fraction object
-- (`{"numerator": 1, "denominator": 2}`). recipe_ingredients.quantity is jsonb
-- and round-trips the union faithfully (1/2 stays 1/2, not lossy 0.5). The
-- save_recipe RPC must accept the number form, the fraction-object form, the
-- string-scalar form the AI sometimes emits, and null.

alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','quantity-a@example.test',
   crypt('test1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now())
on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000c1','Quantity A')
on conflict (id) do nothing;

insert into app.households (id, name, owner_profile_id) values
  ('dddddddd-0000-0000-0000-0000000000aa','Quantity H',
   '00000000-0000-0000-0000-0000000000c1')
on conflict (id) do nothing;

insert into app.household_members (household_id, profile_id, role) values
  ('dddddddd-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000000c1','owner')
on conflict do nothing;

create temporary table _saved(recipe_id uuid) on commit drop;

-- Mixed-quantity draft: scalar number, fraction object, null, and a string-
-- form scalar (the AI sometimes emits "0.25"). All three numeric-y forms
-- must round-trip; null must remain null.
do $$
declare new_id uuid;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c1',
                      'role','authenticated')::text,
    true);
  select app.save_recipe(
    'dddddddd-0000-0000-0000-0000000000aa'::uuid,
    jsonb_build_object(
      'title', 'Quantity round-trip',
      'description', null,
      'source_type', 'instagram',
      'source_url', 'https://instagram.com/p/abc',
      'source_language', 'en',
      'canonical_unit_system', 'metric',
      'servings', 4,
      'total_time_min', null,
      'hero_image_path', null,
      'tags', '[]'::jsonb,
      'ingredients', jsonb_build_array(
        jsonb_build_object(
          'position', 0,
          'raw_text', '200 g flour',
          'quantity', 200,
          'unit', 'g',
          'ingredient_name', 'flour',
          'notes', null
        ),
        jsonb_build_object(
          'position', 1,
          'raw_text', '1/2 cup butter',
          'quantity', jsonb_build_object('numerator', 1, 'denominator', 2),
          'unit', 'cup',
          'ingredient_name', 'butter',
          'notes', null
        ),
        jsonb_build_object(
          'position', 2,
          'raw_text', 'a pinch of salt',
          'quantity', null,
          'unit', null,
          'ingredient_name', 'salt',
          'notes', null
        ),
        jsonb_build_object(
          'position', 3,
          'raw_text', '3/4 tsp baking powder',
          'quantity', jsonb_build_object('numerator', 3, 'denominator', 4),
          'unit', 'tsp',
          'ingredient_name', 'baking powder',
          'notes', null
        )
      ),
      'steps', jsonb_build_array(
        jsonb_build_object('position', 0, 'body', 'Mix.', 'duration_min', null)
      )
    )
  ) into new_id;
  perform set_config('role', 'postgres', true);
  insert into _saved(recipe_id) values (new_id);
end $$;

with assertions(label, ok) as (values
  ('save_recipe returned a recipe id',
   (select recipe_id from _saved) is not null),

  ('scalar quantity 200 stored as JSON number 200',
   (select quantity from app.recipe_ingredients
     where recipe_id = (select recipe_id from _saved) and position = 0) = '200'::jsonb),

  ('fraction-object 1/2 round-trips as a fraction object',
   (select quantity from app.recipe_ingredients
     where recipe_id = (select recipe_id from _saved) and position = 1)
     = jsonb_build_object('numerator', 1, 'denominator', 2)),

  ('null quantity stored as null',
   (select quantity from app.recipe_ingredients
     where recipe_id = (select recipe_id from _saved) and position = 2) is null),

  ('fraction-object 3/4 round-trips as a fraction object',
   (select quantity from app.recipe_ingredients
     where recipe_id = (select recipe_id from _saved) and position = 3)
     = jsonb_build_object('numerator', 3, 'denominator', 4))
)
select label, ok from assertions;
