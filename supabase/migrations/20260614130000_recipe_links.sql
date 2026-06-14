-- 20260614130000_recipe_links.sql
-- "Save to pantry" links. A household references a recipe owned by a household
-- it follows. The link is LIVE: reads resolve the current original, so edits to
-- the source recipe always show through. Removing a follow or deleting the
-- original removes the link (FK cascade). Defined by
-- docs/superpowers/specs/2026-06-14-followed-recipe-pantry-links-design.md.

set search_path = public;

------------------------------------------------------------------------------
-- Helper. Whether p_recipe belongs to household h. SECURITY DEFINER so the
-- insert WITH CHECK below can compare the recipe's owner without re-triggering
-- recipes RLS (same recursion concern as the other app.is_* helpers).
------------------------------------------------------------------------------

create or replace function app.is_recipe_in_household(p_recipe uuid, h uuid)
returns boolean
language plpgsql stable security definer
set search_path = app, public
as $$
declare result boolean;
begin
  select exists (
    select 1 from app.recipes where id = p_recipe and household_id = h
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------
-- recipe_links
------------------------------------------------------------------------------

create table app.recipe_links (
  household_id uuid not null references app.households(id) on delete cascade,
  recipe_id    uuid not null references app.recipes(id) on delete cascade,
  created_by   uuid not null references app.profiles(id),
  created_at   timestamptz not null default now(),
  primary key (household_id, recipe_id)
);
create index recipe_links_household_idx on app.recipe_links (household_id);
create index recipe_links_recipe_idx on app.recipe_links (recipe_id);

alter table app.recipe_links enable row level security;

-- Read: members and followers of the saving (pantry) household. The link is
-- only useful alongside the original; the home query inner-joins to recipes, so
-- a row whose original isn't visible to the reader simply drops out.
create policy recipe_links_read on app.recipe_links
  for select using (
    app.is_household_member(household_id)
    or app.is_household_follower(household_id)
  );

-- Insert: the caller saves into a household they edit, the recipe must be
-- visible to them (i.e. it lives in a household they follow), and it must not
-- already belong to the saving household (no self-links).
create policy recipe_links_insert on app.recipe_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and app.is_household_editor(household_id)
    and app.is_recipe_visible(recipe_id)
    and not app.is_recipe_in_household(recipe_id, household_id)
  );

-- Delete: editors of the saving household remove their own pantry link.
create policy recipe_links_delete on app.recipe_links
  for delete using (app.is_household_editor(household_id));

-- No UPDATE policy: a link is either present or removed and re-added.
grant select, insert, delete on app.recipe_links to authenticated;
