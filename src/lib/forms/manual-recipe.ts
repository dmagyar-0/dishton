import { normaliseBcp47 } from '@/domain';
import type { Ingredient, Recipe, Step } from '@/domain/recipe';

function blankIngredient(position: number): Ingredient {
  return {
    position,
    raw_text: '',
    quantity: null,
    unit: null,
    ingredient_name: null,
    notes: null,
    scalable: true,
    non_scalable_qty: null,
    section: null,
  };
}

function blankStep(position: number): Step {
  return { position, body: '', duration_min: null };
}

// A schema-shaped blank recipe for hand entry. `source_type` is fixed to
// 'manual'; `source_language` is derived from the active UI locale (normalised
// to the DB-accepted BCP-47 form, falling back to 'en'). Seeds one empty
// ingredient and one empty step so the structure is visible — the user can
// delete either row.
export function blankManualRecipe(locale: string): Recipe {
  return {
    title: '',
    description: null,
    source_type: 'manual',
    source_url: null,
    source_language: normaliseBcp47(locale) ?? 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: null,
    hero_image_path: null,
    tags: [],
    ingredients: [blankIngredient(0)],
    steps: [blankStep(0)],
  };
}
