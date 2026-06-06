// Server-side executors for the agent's custom tools. The webhook calls these
// with a service-role client bound to the session's household_id (RLS is
// bypassed by service role, so every query is explicitly filtered by household).
// present_draft validation reuses the frozen Recipe Zod schema.

import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import type { AppClient } from '../auth.ts';

export type DraftValidation =
  | { ok: true; recipe: RecipeType }
  | { ok: false; errors: string[] };

export function validateDraft(input: unknown): DraftValidation {
  const parsed = Recipe.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join('.')}: ${i.message}`);
    return { ok: false, errors };
  }
  const r = parsed.data;
  return {
    ok: true,
    recipe: {
      ...r,
      ingredients: r.ingredients.map((ing, i) => ({ ...ing, position: i })),
      steps: r.steps.map((s, i) => ({ ...s, position: i })),
    },
  };
}

// Compact taste summary — titles, tags, key ingredient names, units, language.
export async function listMyRecipes(
  client: AppClient,
  householdId: string,
  opts: { query?: string; limit?: number },
): Promise<unknown> {
  const limit = Math.min(opts.limit ?? 50, 100);
  let q = client
    .from('recipes')
    .select(
      'id, title, canonical_unit_system, source_language, recipe_tags(tag), recipe_ingredients(ingredient_name)',
    )
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.query) q = q.ilike('title', `%${opts.query}%`);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    canonical_unit_system: string;
    source_language: string;
    recipe_tags: { tag: string }[];
    recipe_ingredients: { ingredient_name: string | null }[];
  }>;
  return {
    count: rows.length,
    recipes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      unit_system: r.canonical_unit_system,
      language: r.source_language,
      tags: r.recipe_tags.map((t) => t.tag),
      key_ingredients: r.recipe_ingredients
        .map((i) => i.ingredient_name)
        .filter((n): n is string => !!n)
        .slice(0, 12),
    })),
  };
}

export async function getRecipe(
  client: AppClient,
  householdId: string,
  recipeId: string,
): Promise<unknown> {
  const [r, ings, steps, tags] = await Promise.all([
    client.from('recipes').select('*').eq('id', recipeId).eq('household_id', householdId).single(),
    client.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('position'),
    client.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('position'),
    client.from('recipe_tags').select('tag').eq('recipe_id', recipeId),
  ]);
  if (r.error) throw r.error;
  return {
    recipe: r.data,
    ingredients: ings.data ?? [],
    steps: steps.data ?? [],
    tags: ((tags.data ?? []) as { tag: string }[]).map((t) => t.tag),
  };
}
