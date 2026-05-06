-- 20260506120000_recipe_ingredient_section.sql
-- Adds an optional `section` heading to recipe_ingredients so imports can
-- preserve groupings like "For the meat" / "For the side" and the recipe
-- view can render each group under its heading.

set search_path = public;

alter table app.recipe_ingredients
  add column section text
    check (section is null or length(section) between 1 and 200);

------------------------------------------------------------------------------
-- Re-define save_recipe / update_recipe to round-trip the new column.
-- Bodies otherwise mirror 20260430120500_save_recipe.sql.
------------------------------------------------------------------------------

create or replace function app.save_recipe(p_household uuid, p_draft jsonb)
returns uuid
language plpgsql
security definer
set search_path = app, public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not app.is_household_member(p_household) then
    raise exception 'not_household_member';
  end if;

  insert into app.recipes (
    household_id, created_by, title, description, source_type, source_url,
    source_language, canonical_unit_system, servings, total_time_min,
    hero_image_path
  ) values (
    p_household,
    auth.uid(),
    p_draft->>'title',
    p_draft->>'description',
    p_draft->>'source_type',
    p_draft->>'source_url',
    coalesce(p_draft->>'source_language', 'en'),
    p_draft->>'canonical_unit_system',
    (p_draft->>'servings')::int,
    nullif(p_draft->>'total_time_min', '')::int,
    p_draft->>'hero_image_path'
  )
  returning id into new_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    new_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    nullif(i.value->>'quantity', '')::numeric,
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    new_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select new_id, t::text
  from jsonb_array_elements_text(coalesce(p_draft->'tags', '[]'::jsonb)) as t
  on conflict do nothing;

  return new_id;
end;
$$;

revoke all on function app.save_recipe(uuid, jsonb) from public, anon;
grant execute on function app.save_recipe(uuid, jsonb) to authenticated;

create or replace function app.update_recipe(p_id uuid, p_draft jsonb)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare hh uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select household_id into hh from app.recipes where id = p_id;
  if hh is null then
    raise exception 'recipe_not_found';
  end if;
  if not exists (
    select 1 from app.household_members hm
    where hm.household_id = hh
      and hm.profile_id = auth.uid()
      and hm.role in ('owner','editor')
  ) then
    raise exception 'not_household_editor';
  end if;

  update app.recipes set
    title                 = p_draft->>'title',
    description           = p_draft->>'description',
    source_type           = p_draft->>'source_type',
    source_url            = p_draft->>'source_url',
    source_language       = coalesce(p_draft->>'source_language', source_language),
    canonical_unit_system = p_draft->>'canonical_unit_system',
    servings              = (p_draft->>'servings')::int,
    total_time_min        = nullif(p_draft->>'total_time_min', '')::int,
    hero_image_path       = p_draft->>'hero_image_path'
  where id = p_id;

  delete from app.recipe_ingredients where recipe_id = p_id;
  delete from app.recipe_steps       where recipe_id = p_id;
  delete from app.recipe_tags        where recipe_id = p_id;
  delete from app.recipe_translations where recipe_id = p_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes, section)
  select
    p_id,
    (i.value->>'position')::int,
    i.value->>'raw_text',
    nullif(i.value->>'quantity', '')::numeric,
    i.value->>'unit',
    i.value->>'ingredient_name',
    i.value->>'notes',
    nullif(i.value->>'section', '')
  from jsonb_array_elements(coalesce(p_draft->'ingredients', '[]'::jsonb)) as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select
    p_id,
    (s.value->>'position')::int,
    s.value->>'body',
    nullif(s.value->>'duration_min', '')::int
  from jsonb_array_elements(coalesce(p_draft->'steps', '[]'::jsonb)) as s;

  insert into app.recipe_tags (recipe_id, tag)
  select p_id, t::text
  from jsonb_array_elements_text(coalesce(p_draft->'tags', '[]'::jsonb)) as t
  on conflict do nothing;
end;
$$;

revoke all on function app.update_recipe(uuid, jsonb) from public, anon;
grant execute on function app.update_recipe(uuid, jsonb) to authenticated;
