-- 20260510120100_household_allowed_tags.sql
-- Per-household whitelist of recipe tags. The AI structuring prompt is
-- restricted to picking tags from this list, and the manual TagPicker only
-- offers chips from this list. Owners can add/remove tags from the household
-- settings page.
--
-- The default expression seeds existing rows on column add and keeps new
-- households' starting list aligned with src/domain/default-tags.ts. Both
-- must stay in sync; the TS constant is what the "Reset to defaults" UI
-- writes, so divergence would surprise users.
--
-- Forward-only.

set search_path = public;

alter table app.households
  add column allowed_tags text[] not null default array[
    'main',
    'side',
    'dessert',
    'breakfast',
    'snack',
    'drink',
    'vegetarian',
    'vegan',
    'chicken',
    'beef',
    'fish',
    'pork',
    'mushroom',
    'cauliflower',
    'potato'
  ]::text[];

-- Validate each element with the same shape the SPA uses (lowercase letters,
-- digits, spaces, hyphens; 1-40 chars; must start with [a-z0-9]). The 200-cap
-- guards against runaway lists and mirrors TAG_MAX_COUNT in default-tags.ts.
--
-- PostgreSQL forbids subqueries (including unnest-driven NOT EXISTS) directly
-- inside CHECK expressions, so the per-element regex test lives in an
-- IMMUTABLE helper that the constraint calls.
create or replace function app.is_valid_household_tags(tags text[])
returns boolean
language sql
immutable
as $$
  select cardinality(tags) <= 200
    and not exists (
      select 1
      from unnest(tags) as t(tag)
      where t.tag !~ '^[a-z0-9][a-z0-9 -]{0,39}$'
    );
$$;

alter table app.households
  add constraint households_allowed_tags_shape
    check (app.is_valid_household_tags(allowed_tags));
