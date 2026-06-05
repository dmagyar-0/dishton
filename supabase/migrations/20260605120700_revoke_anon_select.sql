-- 20260605120700_revoke_anon_select.sql
-- Finding K (LOW) — anon was granted SELECT on profiles, households,
-- household_members, follows, recipes + recipe child tables, and
-- recipe_translations. RLS already denies anon any rows (every read policy is
-- keyed on auth.uid()), and the public_household_pages surface is feature-
-- flagged off / a v2 concern, so these grants are needless attack surface.
-- Revoke them; authenticated keeps its grants.
--
-- Forward-only.

set search_path = public;

revoke select on
  app.profiles,
  app.households,
  app.household_members,
  app.follows
from anon;

revoke select on
  app.recipes,
  app.recipe_ingredients,
  app.recipe_steps,
  app.recipe_tags
from anon;

revoke select on app.recipe_translations from anon;
