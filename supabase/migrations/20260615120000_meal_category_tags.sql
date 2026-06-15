-- 20260615120000_meal_category_tags.sql
-- Adopt the meal-category vocabulary that the Home page's category tiles +
-- "Customize Home" sheet are built on. The category tiles are a pictogram
-- re-skin of the existing per-household tag filter: a recipe belongs to a
-- category when it carries that tag, and the household's `allowed_tags` is the
-- "all possible categories" library while `primary_tags` is the set that leads
-- Home (the personalized, capped-at-5-incl-"All" selection).
--
-- This migration:
--   1. Repoints the column DEFAULTs for new households to the meal-category
--      library (must stay in sync with src/domain/default-tags.ts).
--   2. Rewrites EVERY existing household to the same library + Home set, per the
--      product decision to standardise all kitchens on the new vocabulary.
--   3. Drops any recipe tag that is no longer part of the vocabulary, so recipes
--      only carry tags that still exist as categories (e.g. the retired
--      'main', 'side', 'chicken', 'beef', 'pork', 'drink', 'tomato', …). The
--      recipe_tags delete fires the FTS refresh trigger, keeping search in sync.
--
-- Forward-only. The data rewrite is intentionally destructive to any custom
-- per-household tags; that is the agreed behaviour for this changeover.

set search_path = public;

-- 1. New defaults for freshly-created households. Keep aligned with
--    DEFAULT_HOUSEHOLD_TAGS / DEFAULT_PRIMARY_TAGS in src/domain/default-tags.ts.
alter table app.households
  alter column allowed_tags set default array[
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'dessert',
    'soup',
    'salad',
    'vegetarian',
    'vegan',
    'meat',
    'fish',
    'quick',
    'drinks',
    'baby'
  ]::text[];

alter table app.households
  alter column primary_tags set default array[
    'breakfast',
    'lunch',
    'dinner',
    'dessert'
  ]::text[];

-- 2. Bring every existing household onto the new vocabulary + Home set.
update app.households
  set allowed_tags = array[
        'breakfast',
        'lunch',
        'dinner',
        'snack',
        'dessert',
        'soup',
        'salad',
        'vegetarian',
        'vegan',
        'meat',
        'fish',
        'quick',
        'drinks',
        'baby'
      ]::text[],
      primary_tags = array[
        'breakfast',
        'lunch',
        'dinner',
        'dessert'
      ]::text[];

-- 3. Remove recipe tags that are no longer in the vocabulary. After step 2 all
--    households share the same library, so a single global filter is correct.
delete from app.recipe_tags
  where tag <> all (array[
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'dessert',
    'soup',
    'salad',
    'vegetarian',
    'vegan',
    'meat',
    'fish',
    'quick',
    'drinks',
    'baby'
  ]::text[]);
