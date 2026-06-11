// The scale+convert display pipeline shared by the household recipe detail
// page and the public share page. Pure mapping over domain functions.

import type { Quantity, Recipe } from '@/domain';
import {
  convert,
  niceQuantity,
  pickDisplayUnit,
  quantityIsEmpty,
  quantityToNumber,
} from '@/domain';

export type DisplayableIngredientRow = {
  position: number;
  raw_text: string;
  quantity: Quantity | null;
  unit: string | null;
  ingredient_name: string | null;
  notes: string | null;
  section: string | null;
};

export type DisplayableStepRow = { position: number; body: string; duration_min: number | null };

export type DisplayableRecipe = {
  recipe: {
    title: string;
    description: string | null;
    source_type: Recipe['source_type'];
    source_url: string | null;
    source_language: string;
    canonical_unit_system: 'metric' | 'imperial';
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
  };
  ingredients: DisplayableIngredientRow[];
  steps: DisplayableStepRow[];
  tags: string[];
};

// Build a domain Recipe from loaded rows so we can run the tested scale()
// pipeline (which snaps via niceQuantity in the stored unit) before the
// display-side unit conversion. scalable persistence is deferred (the DB has
// no such column), so every ingredient is treated as scalable — matching
// current behaviour.
export function toDomainRecipe(full: DisplayableRecipe): Recipe {
  return {
    title: full.recipe.title,
    description: full.recipe.description,
    source_type: full.recipe.source_type,
    source_url: full.recipe.source_url,
    source_language: full.recipe.source_language,
    canonical_unit_system: full.recipe.canonical_unit_system,
    servings: full.recipe.servings,
    total_time_min: full.recipe.total_time_min,
    hero_image_path: full.recipe.hero_image_path,
    tags: full.tags,
    ingredients: full.ingredients.map((ing) => ({
      position: ing.position,
      raw_text: ing.raw_text,
      quantity: ing.quantity,
      unit: ing.unit,
      ingredient_name: ing.ingredient_name,
      notes: ing.notes,
      scalable: true,
      non_scalable_qty: null,
      section: ing.section,
    })),
    steps: full.steps.map((s) => ({
      position: s.position,
      body: s.body,
      duration_min: s.duration_min,
    })),
  };
}

// Resolve the quantity + unit a row should display: scale via the domain
// pipeline, then convert to the preferred display unit. Stored fractions
// round-trip unchanged when neither scaling nor conversion changes the value.
export function resolveDisplay(
  source: { quantity: Quantity | null; unit: string | null },
  scaledQty: Quantity | null,
  displayUnits: 'metric' | 'imperial',
): { displayQuantity: Quantity | null; displayUnit: string | null } {
  if (quantityIsEmpty(scaledQty) || !source.unit) {
    return { displayQuantity: null, displayUnit: null };
  }
  // scaledQty is non-empty here.
  const scaledNumber = quantityToNumber(scaledQty as Quantity);
  const target = pickDisplayUnit(source.unit, scaledNumber, displayUnits);
  if (target === source.unit) {
    // No conversion: prefer the value the scale pipeline produced, which keeps
    // a stored exact fraction (e.g. 1/3) faithful when the factor is 1.
    return { displayQuantity: scaledQty, displayUnit: source.unit };
  }
  try {
    const converted = convert(scaledNumber, source.unit, target);
    return { displayQuantity: niceQuantity(converted, target), displayUnit: target };
  } catch {
    return { displayQuantity: scaledQty, displayUnit: source.unit };
  }
}
