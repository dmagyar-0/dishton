-- 20260614120000_household_primary_tags.sql
-- Per-household list of "main" tags shown first on the Home page. These are a
-- subset of allowed_tags that the household promotes to a top-level, two-level
-- tag filter on Home. Owners can toggle which allowed tags are "main" from the
-- household settings Tags tab.
--
-- The default expression seeds existing rows on column add and keeps new
-- households' starting list aligned with DEFAULT_PRIMARY_TAGS in
-- src/domain/default-tags.ts. Both must stay in sync; the TS constant is what
-- the "Reset to defaults" UI writes, so divergence would surprise users.
--
-- Forward-only.

set search_path = public;

alter table app.households
  add column primary_tags text[] not null default array[
    'main',
    'side',
    'dessert',
    'breakfast',
    'snack',
    'drink'
  ]::text[];

-- Reuse the IMMUTABLE helper defined in the allowed_tags migration so the
-- per-element shape (lowercase letters, digits, spaces, hyphens; 1-40 chars;
-- must start with [a-z0-9]; <=200 entries) matches what the SPA enforces.
alter table app.households
  add constraint households_primary_tags_shape
    check (app.is_valid_household_tags(primary_tags));
