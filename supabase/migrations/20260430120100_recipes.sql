-- 20260430120100_recipes.sql
-- recipes, recipe_ingredients, recipe_steps, recipe_tags + FTS triggers + RLS.
-- Defined by docs/04-data-model.md.

set search_path = public;

------------------------------------------------------------------------------
-- recipes
------------------------------------------------------------------------------

create table app.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  title text not null check (length(title) between 1 and 200),
  description text,
  source_type text not null
    check (source_type in ('url','instagram','photo','manual')),
  source_url text,
  source_language text not null default 'en'
    check (source_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  canonical_unit_system text not null
    check (canonical_unit_system in ('metric','imperial')),
  servings integer not null check (servings between 1 and 200),
  total_time_min integer check (total_time_min >= 0),
  hero_image_path text,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_household_idx on app.recipes (household_id);
create index recipes_household_created_idx
  on app.recipes (household_id, created_at desc);
create index recipes_search_gin on app.recipes using gin (search);
create trigger recipes_set_updated before update on app.recipes
  for each row execute function app.set_updated_at();

create table app.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  position integer not null,
  raw_text text not null,
  quantity numeric,
  unit text,
  ingredient_name text,
  notes text,
  unique (recipe_id, position)
);
create index recipe_ingredients_recipe_idx on app.recipe_ingredients (recipe_id);

create table app.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  position integer not null,
  body text not null,
  duration_min integer check (duration_min >= 0),
  unique (recipe_id, position)
);
create index recipe_steps_recipe_idx on app.recipe_steps (recipe_id);

create table app.recipe_tags (
  recipe_id uuid not null references app.recipes(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 40),
  primary key (recipe_id, tag)
);
create index recipe_tags_tag_idx on app.recipe_tags (tag);

------------------------------------------------------------------------------
-- FTS triggers. The BEFORE trigger writes the tsvector, the AFTER triggers
-- on child tables touch the parent so the BEFORE trigger re-runs.
------------------------------------------------------------------------------

create or replace function app.recipes_search_refresh() returns trigger
language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple',
        coalesce(
          (select string_agg(tag, ' ')
             from app.recipe_tags where recipe_id = new.id),
          '')), 'B')
    || setweight(to_tsvector('simple',
        coalesce(
          (select string_agg(coalesce(ingredient_name, raw_text), ' ')
             from app.recipe_ingredients where recipe_id = new.id),
          '')), 'C');
  return new;
end;
$$;

create trigger recipes_search_trg
  before insert or update on app.recipes
  for each row execute function app.recipes_search_refresh();

create or replace function app.recipes_touch_for_search() returns trigger
language plpgsql as $$
begin
  -- Updating updated_at fires the BEFORE UPDATE trigger which recomputes the
  -- tsvector from the current child rows. coalesce handles DELETE rows.
  update app.recipes set updated_at = now()
  where id = coalesce(new.recipe_id, old.recipe_id);
  return null;
end;
$$;

create trigger recipe_ingredients_touch
  after insert or update or delete on app.recipe_ingredients
  for each row execute function app.recipes_touch_for_search();

create trigger recipe_tags_touch
  after insert or update or delete on app.recipe_tags
  for each row execute function app.recipes_touch_for_search();

------------------------------------------------------------------------------
-- Helpers used below. Recipe-scoped writes need to know whether the caller is
-- a household editor for the recipe's household; we wrap that in security
-- definer to avoid recursive RLS evaluation through household_members.
------------------------------------------------------------------------------

create or replace function app.is_recipe_editor(p_recipe uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1
    from app.recipes r
    join app.household_members hm on hm.household_id = r.household_id
    where r.id = p_recipe
      and hm.profile_id = auth.uid()
      and hm.role in ('owner','editor')
  ) into result;
  return result;
end;
$$;

create or replace function app.is_recipe_visible(p_recipe uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare hh uuid;
begin
  select household_id into hh from app.recipes where id = p_recipe;
  if hh is null then return false; end if;
  return app.is_household_member(hh) or app.is_household_follower(hh);
end;
$$;

create or replace function app.is_household_editor(h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.household_members
    where household_id = h
      and profile_id = auth.uid()
      and role in ('owner','editor')
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------

alter table app.recipes            enable row level security;
alter table app.recipe_ingredients enable row level security;
alter table app.recipe_steps       enable row level security;
alter table app.recipe_tags        enable row level security;

create policy recipes_member_or_follower_read on app.recipes
  for select using (
    app.is_household_member(household_id)
    or app.is_household_follower(household_id)
  );

create policy recipes_member_write on app.recipes
  for all using (app.is_household_editor(household_id))
  with check (app.is_household_editor(household_id));

-- Recipe child tables: read for member-or-follower of the parent recipe;
-- write for member with role owner/editor.
create policy recipe_ingredients_read on app.recipe_ingredients
  for select using (app.is_recipe_visible(recipe_id));

create policy recipe_ingredients_write on app.recipe_ingredients
  for all using (app.is_recipe_editor(recipe_id))
  with check (app.is_recipe_editor(recipe_id));

create policy recipe_steps_read on app.recipe_steps
  for select using (app.is_recipe_visible(recipe_id));

create policy recipe_steps_write on app.recipe_steps
  for all using (app.is_recipe_editor(recipe_id))
  with check (app.is_recipe_editor(recipe_id));

create policy recipe_tags_read on app.recipe_tags
  for select using (app.is_recipe_visible(recipe_id));

create policy recipe_tags_write on app.recipe_tags
  for all using (app.is_recipe_editor(recipe_id))
  with check (app.is_recipe_editor(recipe_id));

------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------

grant select, insert, update, delete on
  app.recipes,
  app.recipe_ingredients,
  app.recipe_steps,
  app.recipe_tags
to authenticated;

grant select on
  app.recipes,
  app.recipe_ingredients,
  app.recipe_steps,
  app.recipe_tags
to anon;
