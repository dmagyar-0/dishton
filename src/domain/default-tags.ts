// Curated default tag list seeded into every new household — the "all possible
// categories" library behind the Home category tiles and the "Customize Home"
// sheet. Owners can edit it from the household settings page. This array must
// stay in sync with the default expression in
// supabase/migrations/20260615120000_meal_category_tags.sql — the SQL default
// only seeds new rows, so the canonical source for the "Reset to defaults" UI
// is this constant. The order here is the order the categories appear in the
// Customize library grid.
export const DEFAULT_HOUSEHOLD_TAGS: readonly string[] = [
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
  'baby',
] as const;

// Default subset of tags promoted to "main" (primary) tags — the meal
// categories that lead the Home screen (rendered as icon tiles after the
// always-present "All" tile). Must stay in sync with the default expression in
// supabase/migrations/20260615120000_meal_category_tags.sql — the SQL default
// only seeds new rows, so this constant is the canonical source for the
// "Reset to defaults" UI. Kept within MAX_HOME_CATEGORIES (incl. "All").
export const DEFAULT_PRIMARY_TAGS: readonly string[] = [
  'breakfast',
  'lunch',
  'dinner',
  'dessert',
] as const;

// Maximum number of category tiles shown on Home, counting the always-present,
// non-stored "All" tile. The stored primary_tags may therefore fill at most
// MAX_HOME_CATEGORIES - 1 slots; the Customize sheet enforces this cap.
export const MAX_HOME_CATEGORIES = 5;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]{0,39}$/;
export const TAG_MAX_COUNT = 200;

export function normalizeTag(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!TAG_PATTERN.test(s)) return null;
  return s;
}
