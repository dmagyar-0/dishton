// Bridges AI output to the canonical Recipe schema. The model is forced to
// call the `extract_recipe` tool, so the parsed JSON arrives as structured
// data; we no longer parse free-form text or retry on JSON errors.

import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import { aiChat, type AiCallOpts, type AiResult } from './client.ts';
import { EXTRACT_RECIPE_TOOL } from './tool-schema.ts';

export type ValidationResult =
  | { ok: true; recipe: RecipeType; usage: AiResult['usage']; model: string; raw: string }
  | { ok: false; reason: 'parse' | 'schema' | 'rate_limit' | 'upstream'; raw: string };

// The recipe view renders steps as `position + 1`, so positions must be
// 0-indexed and contiguous. The model sometimes returns 1-based positions
// (or gaps) despite the prompt; re-index by array order so storage is always
// canonical regardless of what the model emitted.
export function normalizePositions(recipe: RecipeType): RecipeType {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ing, i) => ({ ...ing, position: i })),
    steps: recipe.steps.map((step, i) => ({ ...step, position: i })),
  };
}

export async function callAndValidate(opts: AiCallOpts): Promise<ValidationResult> {
  const result = await aiChat({
    ...opts,
    tools: [EXTRACT_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_RECIPE_TOOL.name },
  });

  if (result.tool_input === undefined) {
    // Forced tool_choice should make this branch effectively unreachable, but
    // if Anthropic ever returns a text-only response (e.g. tool-call failure),
    // surface it as a parse error rather than crashing.
    return {
      ok: false,
      reason: 'parse',
      raw: result.content,
    };
  }

  const safe = Recipe.safeParse(result.tool_input);
  const raw = JSON.stringify(result.tool_input);
  if (!safe.success) {
    return { ok: false, reason: 'schema', raw };
  }
  return {
    ok: true,
    recipe: normalizePositions(safe.data),
    usage: result.usage,
    model: result.model,
    raw,
  };
}
