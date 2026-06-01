// Scoring (Q2: gold-diff + LLM judge). This module is the automated half:
// strict Zod schema validation, plus a gold-answer diff for cases that ship a
// gold. The LLM-judge half is done interactively (the report leaves TBD
// placeholders), exactly as in round 1.
//
// The gold diff is deliberately simple and transparent: term-presence matching
// (every word of a gold term must appear somewhere in the output's ingredient
// text). It reports recall of expected ingredients, "bleed" (forbidden
// ingredients that belong to ANOTHER variant/column — the key Stage-3 signal),
// and step coverage. It is informational, not a hard pass/fail.

import { z } from 'zod';
import { Recipe } from '../../src/domain/recipe.ts';

export type RecipeData = z.infer<typeof Recipe>;

export type SchemaResult =
  | { ok: true; recipe: RecipeData }
  | { ok: false; error: string };

export function validateSchema(raw: string): SchemaResult {
  let parsed: unknown;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `parse: ${(e as Error).message.slice(0, 80)}` };
  }
  const safe = Recipe.safeParse(parsed);
  if (!safe.success) {
    const issue = safe.error.issues[0];
    return {
      ok: false,
      error: `schema: ${issue?.path.join('.') ?? ''} (${issue?.code ?? '?'})`,
    };
  }
  return { ok: true, recipe: safe.data };
}

export type Gold = {
  title: string;
  titleExpect?: string; // substring the output title should contain (e.g. "sweet potato")
  verify?: string;
  minSteps: number;
  sections: string[];
  expect: string[]; // ingredient terms that SHOULD appear (this variant)
  forbidden: string[]; // ingredient terms from OTHER variants — appearing = bleed
};

export type GoldDiff = {
  recall: number;
  matched: string[];
  missing: string[];
  bleed: string[];
  titleOk: boolean;
  ingredientCount: number;
  stepCount: number;
  stepOk: boolean;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function ingredientTexts(r: RecipeData): string[] {
  return r.ingredients.map((i) =>
    norm(`${i.raw_text} ${i.ingredient_name ?? ''} ${i.notes ?? ''} ${i.section ?? ''}`)
  );
}

// A term is present if SOME SINGLE ingredient contains all its words. Matching
// per-ingredient (not against the concatenated list) tolerates "veg" ⊂
// "vegetable" while avoiding cross-ingredient false positives — e.g. "black
// bean" must NOT match a recipe that merely has "black pepper" in one row and
// "green beans" in another.
function termPresent(texts: string[], term: string): boolean {
  const words = norm(term).split(' ').filter(Boolean);
  return words.length > 0 && texts.some((t) => words.every((w) => t.includes(w)));
}

export function goldDiff(r: RecipeData, gold: Gold): GoldDiff {
  const texts = ingredientTexts(r);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const term of gold.expect) {
    (termPresent(texts, term) ? matched : missing).push(term);
  }
  const bleed = gold.forbidden.filter((term) => termPresent(texts, term));
  const titleOk = gold.titleExpect ? norm(r.title).includes(norm(gold.titleExpect)) : true;
  return {
    recall: gold.expect.length ? matched.length / gold.expect.length : 1,
    matched,
    missing,
    bleed,
    titleOk,
    ingredientCount: r.ingredients.length,
    stepCount: r.steps.length,
    stepOk: r.steps.length >= gold.minSteps,
  };
}

export async function loadGold(path: string): Promise<Gold> {
  return JSON.parse(await Deno.readTextFile(path)) as Gold;
}
