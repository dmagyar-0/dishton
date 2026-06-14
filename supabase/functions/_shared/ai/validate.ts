// Bridges AI output to the canonical Recipe schema. The model is forced to
// call the `extract_recipe` tool, so the parsed JSON arrives as structured
// data; we no longer parse free-form text or retry on JSON errors.
//
// When the forced tool call returns a well-formed object that nonetheless
// fails Recipe.safeParse, we make ONE bounded repair turn: replay the prompt,
// show the model the draft it produced plus the exact Zod errors, and force a
// corrected tool call. This recovers drafts that would otherwise drop straight
// to needs_review. The loop is capped at a single extra request so the call
// stays deterministic and budget-bounded (one ai_call's worth of headroom).

import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import { type AiCallOpts, type AiResult, aiChat, isUpstreamError } from './client.ts';
import { translateExtractedRecipe } from './prompts.ts';
import { EXTRACT_RECIPE_TOOL } from './tool-schema.ts';

export type ValidationResult =
  | { ok: true; recipe: RecipeType; usage: AiResult['usage']; model: string; raw: string }
  | { ok: false; reason: 'parse' | 'schema' | 'empty' | 'rate_limit' | 'upstream'; raw: string };

// Force the model to answer through the tool, every call.
const TOOL_FIELDS = {
  tools: [EXTRACT_RECIPE_TOOL],
  tool_choice: { type: 'tool', name: EXTRACT_RECIPE_TOOL.name },
} satisfies Pick<AiCallOpts, 'tools' | 'tool_choice'>;

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

// Drop any URL the model produced that isn't plain http(s). Scraped pages and
// IG captions are untrusted input; a prompt-injected page could coax the model
// into emitting a `javascript:` / `data:` / `file:` URL in source_url or
// hero_image_path. hero_image_path is later fetched and displayed, so a bad
// scheme there is the dangerous one. We null out anything that isn't http(s).
function safeHttpUrl(value: string | null): string | null {
  if (value === null) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? value : null;
}

export function sanitizeModelUrls(recipe: RecipeType): RecipeType {
  return {
    ...recipe,
    source_url: safeHttpUrl(recipe.source_url),
    hero_image_path: safeHttpUrl(recipe.hero_image_path),
  };
}

type Interpreted =
  | { ok: true; recipe: RecipeType; raw: string }
  | { ok: false; reason: 'parse'; raw: string }
  | { ok: false; reason: 'empty'; raw: string }
  | { ok: false; reason: 'schema'; raw: string; errors: string };

// Turn a raw aiChat result into a parsed outcome. `parse` means the model
// didn't invoke the tool at all (no candidate to repair); `schema` means it
// returned an object that failed Recipe.safeParse (repairable — carries the
// Zod errors to feed back).
function interpret(result: AiResult): Interpreted {
  if (result.tool_input === undefined) {
    // Forced tool_choice should make this branch effectively unreachable, but
    // if Anthropic ever returns a text-only response (e.g. tool-call failure),
    // surface it as a parse error rather than crashing.
    return { ok: false, reason: 'parse', raw: result.content };
  }
  const raw = JSON.stringify(result.tool_input);
  const safe = Recipe.safeParse(result.tool_input);
  if (!safe.success) {
    const errors = safe.error.issues
      .slice(0, 20)
      .map((iss) => `- ${iss.path.length ? iss.path.join('.') : '(root)'}: ${iss.message}`)
      .join('\n');
    return { ok: false, reason: 'schema', raw, errors };
  }
  // A schema-valid but content-less draft (no ingredients AND no steps) is not
  // a usable recipe — the model emits one when the source has nothing to
  // extract (e.g. an Instagram reel whose caption carries no recipe). Reject it
  // here so the importer surfaces it instead of saving a blank recipe and
  // reporting success. Like 'parse', there is nothing for a repair turn to work
  // from, so callers surface it immediately rather than spending another call.
  if (safe.data.ingredients.length === 0 && safe.data.steps.length === 0) {
    return { ok: false, reason: 'empty', raw };
  }
  // Strip non-http(s) URLs the model may have been coaxed into emitting before
  // the draft is persisted or displayed.
  return { ok: true, recipe: sanitizeModelUrls(normalizePositions(safe.data)), raw };
}

function repairInstruction(errors: string): string {
  return `The recipe you extracted failed schema validation with these problems:

${errors}

Call the extract_recipe tool again with a corrected recipe. Fix only the fields named above; keep every other field identical to what you returned. Make sure each required field is present and every value matches the types and enums in the tool schema.`;
}

function sumUsage(a: AiResult['usage'], b: AiResult['usage']): AiResult['usage'] {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: (a.cache_read ?? 0) + (b.cache_read ?? 0) || undefined,
    cache_write: (a.cache_write ?? 0) + (b.cache_write ?? 0) || undefined,
  };
}

export async function callAndValidate(opts: AiCallOpts): Promise<ValidationResult> {
  let first: AiResult;
  try {
    first = await aiChat({ ...opts, ...TOOL_FIELDS });
  } catch (err) {
    // Anthropic API errors, connection failures, and timeouts/aborts are not a
    // bad recipe — they're a transient upstream problem. Surface them as a
    // typed 'upstream' reason so the worker writes a retriable error and the
    // SPA shows "importer busy" rather than "couldn't parse this page".
    if (isUpstreamError(err)) return { ok: false, reason: 'upstream', raw: '' };
    throw err;
  }
  const firstParsed = interpret(first);
  if (firstParsed.ok) {
    return {
      ok: true,
      recipe: firstParsed.recipe,
      usage: first.usage,
      model: first.model,
      raw: firstParsed.raw,
    };
  }

  // A missing tool call ('parse') or a content-less draft ('empty') has nothing
  // for a repair turn to work from, so surface either immediately.
  if (firstParsed.reason === 'parse' || firstParsed.reason === 'empty') {
    return { ok: false, reason: firstParsed.reason, raw: firstParsed.raw };
  }

  // One bounded repair turn. Replay the original prompt, show the model the
  // draft it produced (as a prior assistant turn so roles still alternate)
  // and the exact Zod errors, then force another tool call.
  let repair: AiResult;
  try {
    repair = await aiChat({
      ...opts,
      ...TOOL_FIELDS,
      messages: [
        ...opts.messages,
        { role: 'assistant', content: firstParsed.raw },
        { role: 'user', content: repairInstruction(firstParsed.errors) },
      ],
    });
  } catch (err) {
    if (isUpstreamError(err)) return { ok: false, reason: 'upstream', raw: '' };
    throw err;
  }
  const usage = sumUsage(first.usage, repair.usage);
  const repairParsed = interpret(repair);
  if (repairParsed.ok) {
    return {
      ok: true,
      recipe: repairParsed.recipe,
      usage,
      model: repair.model,
      raw: repairParsed.raw,
    };
  }
  return { ok: false, reason: repairParsed.reason, raw: repairParsed.raw };
}

// Base subtag of a BCP-47 code ("hu", "de" from "de-DE"); null for empty input.
function baseLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split('-')[0];
  return base || null;
}

// Structure a recipe, then translate it into the importer's language when the
// extracted source differs. The structuring step preserves the source language
// (reliable extraction + accurate source_language); a dedicated tool-mode
// translation pass then rewrites the human-readable fields. The inline
// "translate as you parse" directive was unreliable — extraction models
// transcribe verbatim — so we split the two concerns.
//
// On a translation failure we fall back to the (valid) untranslated recipe:
// storing the recipe in the source language beats failing the whole import.
export async function callValidateThenTranslate(
  structuring: AiCallOpts,
  targetLanguage: string | undefined,
): Promise<ValidationResult> {
  const structured = await callAndValidate(structuring);
  if (!structured.ok) return structured;

  const target = baseLang(targetLanguage);
  if (!targetLanguage || !target || baseLang(structured.recipe.source_language) === target) {
    return structured;
  }

  // Translation is text-only even when the structuring step used the vision
  // lane (photo imports), so run the translate pass on the cheaper text lane.
  const translated = await callAndValidate({
    lane: 'text',
    estimatedTokens: structuring.estimatedTokens,
    messages: translateExtractedRecipe({ recipe: structured.recipe, targetLanguage }),
  });
  if (!translated.ok) return structured;

  return {
    ok: true,
    recipe: translated.recipe,
    usage: sumUsage(structured.usage, translated.usage),
    model: translated.model,
    raw: translated.raw,
  };
}
