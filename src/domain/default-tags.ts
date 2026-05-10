// Curated default tag list seeded into every new household. Owners can edit
// it from the household settings page. This array must stay in sync with the
// default expression in supabase/migrations/20260510120100_household_allowed_tags.sql
// — the SQL default only seeds new rows, so the canonical source for the
// "Reset to defaults" UI is this constant.

export const DEFAULT_HOUSEHOLD_TAGS: readonly string[] = [
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
  'potato',
] as const;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]{0,39}$/;
export const TAG_MAX_COUNT = 200;

export function normalizeTag(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!TAG_PATTERN.test(s)) return null;
  return s;
}
