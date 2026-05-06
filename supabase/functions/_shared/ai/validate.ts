// Bridges AI output to the canonical Recipe schema, with one re-prompt on
// JSON parse failure. Schema failures do not retry — they hit needs_review.

import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import { aiChat, type AiCallOpts, type AiResult } from './client.ts';

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

function tryParseJson(text: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  try {
    const cleaned = text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function callAndValidate(opts: AiCallOpts): Promise<ValidationResult> {
  const first = await aiChat(opts);
  let parsed = tryParseJson(first.content);
  let raw = first.content;
  let usage: AiResult['usage'] = { ...first.usage };
  const model = first.model;

  if (!parsed.ok) {
    const retry = await aiChat({
      ...opts,
      messages: [
        ...opts.messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: `Your previous response was not valid JSON: ${parsed.error}.
Return ONLY a single JSON object that matches the schema. No commentary.`,
        },
      ],
    });
    raw = retry.content;
    usage = {
      input: usage.input + retry.usage.input,
      output: usage.output + retry.usage.output,
      cache_read: (usage.cache_read ?? 0) + (retry.usage.cache_read ?? 0) || undefined,
      cache_write: (usage.cache_write ?? 0) + (retry.usage.cache_write ?? 0) || undefined,
    };
    parsed = tryParseJson(retry.content);
    if (!parsed.ok) {
      return { ok: false, reason: 'parse', raw };
    }
  }

  const safe = Recipe.safeParse(parsed.value);
  if (!safe.success) {
    return { ok: false, reason: 'schema', raw: JSON.stringify(parsed.value) };
  }
  return { ok: true, recipe: normalizePositions(safe.data), usage, model, raw };
}
