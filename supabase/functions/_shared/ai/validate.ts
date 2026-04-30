// Bridges NIM output to the canonical Recipe schema, with one re-prompt on
// JSON parse failure. Schema failures do not retry — they hit needs_review.

import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import { nimChat, type NimCallOpts, type NimResult } from './client.ts';

export type ValidationResult =
  | { ok: true; recipe: RecipeType; usage: NimResult['usage']; raw: string }
  | { ok: false; reason: 'parse' | 'schema' | 'rate_limit' | 'upstream'; raw: string };

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

export async function callAndValidate(opts: NimCallOpts): Promise<ValidationResult> {
  const first = await nimChat(opts);
  let parsed = tryParseJson(first.content);
  let raw = first.content;
  let usage = { ...first.usage };

  if (!parsed.ok) {
    const retry = await nimChat({
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
  return { ok: true, recipe: safe.data, usage, raw };
}
