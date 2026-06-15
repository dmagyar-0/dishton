// Pictograms + labels for the Home meal-category tiles. Categories ARE recipe
// tags (see src/domain/default-tags.ts); this module just decorates known tag
// ids with a lucide pictogram and a title-cased label. Custom household tags
// without a dedicated glyph fall back to a generic tag icon, so the tiles work
// for any allowed tag — not only the curated default library.

import {
  Baby,
  Cookie,
  CupSoda,
  Drumstick,
  Fish,
  LayoutGrid,
  Leaf,
  type LucideIcon,
  Moon,
  Popcorn,
  Salad,
  Soup,
  Sprout,
  Sunrise,
  Tag,
  Utensils,
  Zap,
} from 'lucide-react';

// Sentinel id for the always-present "All" tile that clears the category
// filter. It is NOT a real stored tag (kept out of allowed_tags / primary_tags).
export const ALL_CATEGORY = 'all';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  breakfast: Sunrise,
  lunch: Utensils,
  dinner: Moon,
  snack: Popcorn,
  dessert: Cookie,
  soup: Soup,
  salad: Salad,
  vegetarian: Leaf,
  vegan: Sprout,
  meat: Drumstick,
  fish: Fish,
  quick: Zap,
  drinks: CupSoda,
  baby: Baby,
};

/** The lucide pictogram for a category tag, or a generic tag icon as fallback. */
export function categoryIcon(tag: string): LucideIcon {
  return CATEGORY_ICONS[tag] ?? Tag;
}

/**
 * Display label for a category tile. Tags are stored lowercase; tiles show them
 * title-cased (first letter of each space/hyphen-separated word). Custom tags
 * like `gluten-free` still render cleanly.
 */
export function categoryLabel(tag: string): string {
  return tag.replace(
    /(^|[\s-])([a-z])/g,
    (_match, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
}
