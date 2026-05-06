// Typed prompt templates. The Recipe shape is described inline so the model
// sees the exact field schema — most reliable structured-output pattern.
//
// `RECIPE_JSON_SHAPE` is asserted by a parity test (see _test.ts) to mention
// every field in the Zod Recipe schema; that test catches the case of a new
// Recipe field being added but not advertised to the model.

import type { AiMessage } from './client.ts';
import type { ScrapedRecipe } from '../scrape/recipe-jsonld.ts';

// HTML feed cap. Sized to fit ~20K input tokens at Haiku 4.5 prices, which
// covers every recipe page we've sampled after lightStripHtml runs.
const HTML_MAX_CHARS = 80_000;

export const RECIPE_JSON_SHAPE = `
The JSON object MUST match this TypeScript type exactly:

{
  "title": string,
  "description": string | null,
  "source_type": "url"|"instagram"|"photo"|"manual",
  "source_url": string | null,
  "source_language": string,
  "canonical_unit_system": "metric"|"imperial",
  "servings": number,
  "total_time_min": number | null,
  "tags": string[],
  "hero_image_path": string | null,
  "ingredients": [
    {
      "position": number,
      "raw_text": string,
      "quantity": number | { "numerator": int, "denominator": int } | null,
      "unit": string | null,
      "ingredient_name": string | null,
      "notes": string | null,
      "scalable": boolean,
      "non_scalable_qty": "to_taste"|"pinch"|"dash"|"splash"|"handful"|"optional"|null,
      "section": string | null
    }
  ],
  "steps": [
    { "position": number, "body": string, "duration_min": number | null }
  ]
}

Rules:
- Output ONLY a single JSON object. No prose, no code fences, no commentary.
- If a quantity is ambiguous (e.g. "a pinch"), set quantity=null and
  non_scalable_qty to the matching token; scalable=false.
- "cup" defaults to "cup_us" (240 ml). For European-language sources, use
  "cup_metric" (250 ml).
- Canonical unit keys: g, kg, oz, lb, ml, l, tsp, tbsp, cup_us, cup_metric,
  fl_oz, count, C, F, min, h.
- Translate non-English unit words to canonical keys: Hungarian ek/tk/mk →
  tbsp/tsp/quarter-tsp (set quantity=0.25, unit=tsp for mk); German EL/TL →
  tbsp/tsp; French "c. à s."/"c. à c." → tbsp/tsp; Italian
  cucchiaio/cucchiaino → tbsp/tsp; Spanish cucharada/cucharadita → tbsp/tsp.
  Piece-words (Hungarian: db, fej, gerezd, csokor, szelet, adag; German:
  Stück; French: pièce, gousse, botte) → unit="count".
- "tags" must come from terms actually present in the source (page chrome,
  category tags, recipe-card keywords). Do NOT invent tags from the title
  or your own knowledge. Empty array if none are found.
- "hero_image_path" stores a remote image URL when available; null if none.
- Split each logical action into its own step. A "preheat oven … bake 30
  min … cool" sequence is three steps, not one.
- "position" is 0-indexed and contiguous: the first ingredient/step is 0,
  the second is 1, and so on.
- If the source groups ingredients under sub-headings (e.g. "For the meat",
  "For the side", "For the sauce", "Streusel", "Glaze"), set "section" to
  that heading verbatim and apply it to every ingredient that belongs to
  it. The heading itself must NOT appear as its own ingredient row. If the
  source is a single flat list, set "section" to null on every ingredient.
`.trim();

// Language handling for the structuring step. When `targetLanguage` is set
// (the importer's profile preferred_language), the model translates the
// human-readable strings as it parses, so the recipe lands in the user's
// language without a second round-trip through translate-recipe. The list of
// translatable fields is kept in sync with `translatePrompt` below.
export function languageDirective(targetLanguage: string | undefined): string {
  if (!targetLanguage) {
    return 'Preserve the source language verbatim; do NOT translate. Set source_language to the BCP-47 code of the source.';
  }
  return `Translate the human-readable strings into ${targetLanguage}: title, description, ingredient.raw_text, ingredient.ingredient_name, ingredient.notes, ingredient.section, step.body, tags. Do NOT translate quantity, unit, position, source_type, source_url, servings, total_time_min, scalable, non_scalable_qty, canonical_unit_system. Set source_language to "${targetLanguage}".`;
}

function compactScraped(s: ScrapedRecipe): Record<string, unknown> {
  // Drop null fields and empty arrays so the model isn't told an empty list
  // is the "primary source of truth". On sites where Recipe JSON-LD is
  // present but recipeIngredient/recipeInstructions are empty (we've seen
  // this in production on streetkitchen.hu), this keeps the useful hint
  // fields (name, image, yield, total_time_min, keywords) visible while
  // not actively misleading the model about the ingredient list.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function formatScraped(s: ScrapedRecipe): string {
  const compact = compactScraped(s);
  if (Object.keys(compact).length === 0) return '';
  return `Hint — schema.org JSON-LD found on the page (a starting point; the HTML below is the ground truth, especially for ingredients and instructions):
"""
${JSON.stringify(compact, null, 2)}
"""

`;
}

export function structuringFromHtml(args: {
  html: string;
  sourceUrl: string;
  hint?: string;
  scraped?: ScrapedRecipe | null;
  targetLanguage?: string;
}): AiMessage[] {
  const html = args.html.length > HTML_MAX_CHARS
    ? args.html.slice(0, HTML_MAX_CHARS)
    : args.html;
  return [
    {
      role: 'system',
      content: `You convert recipe HTML into a strict JSON object. ${RECIPE_JSON_SHAPE}\n${languageDirective(args.targetLanguage)}`,
    },
    {
      role: 'user',
      content: `Source URL: ${args.sourceUrl}
${args.hint ? `Hint: ${args.hint}\n` : ''}${args.scraped ? formatScraped(args.scraped) : ''}
HTML (lightly stripped — scripts, styles, head, svg, iframes, comments removed; structure preserved):
"""
${html}
"""`,
    },
  ];
}

export function structuringFromCaption(args: {
  caption: string;
  sourceUrl: string;
  targetLanguage?: string;
}): AiMessage[] {
  return [
    {
      role: 'system',
      content: `You convert an Instagram recipe caption into strict JSON. ${RECIPE_JSON_SHAPE}\n${languageDirective(args.targetLanguage)}`,
    },
    {
      role: 'user',
      content: `Source URL: ${args.sourceUrl}
Caption:
"""
${args.caption}
"""

If the caption contains hashtags or emojis, ignore them. If servings or
total_time_min are not stated, set them to null and 1 respectively.`,
    },
  ];
}

export function structuringFromImage(args: {
  imageUrl: string;
  comment?: string;
  targetLanguage?: string;
}): AiMessage[] {
  const note = args.comment?.trim();
  const baseInstruction =
    'Extract the recipe in this image. If parts are unreadable, set them to null. Do not invent ingredients.';
  const userText = note
    ? `${baseInstruction}

The user attached this note. Apply it ONLY if it is clearly relevant to the recipe shown in the image; otherwise ignore it completely. Do not let the note invent or override anything not visible in the image.

User note:
"""
${note}
"""`
    : baseInstruction;
  return [
    {
      role: 'system',
      content:
        `You read recipes from photographs (handwriting, cookbook scans, screenshots) and output strict JSON. ${RECIPE_JSON_SHAPE}\n${languageDirective(args.targetLanguage)}`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image', source: { type: 'url', url: args.imageUrl } },
      ],
    },
  ];
}

export function translatePrompt(args: {
  recipeJson: string;
  targetLanguage: string;
}): AiMessage[] {
  return [
    {
      role: 'system',
      content: `You translate a Dishton Recipe JSON into ${args.targetLanguage}. Only translate human-readable strings: title, description, ingredient.raw_text, ingredient.ingredient_name, ingredient.notes, ingredient.section, step.body, tags. Do NOT change quantity, unit, position, source_type, source_url, source_language, servings, total_time_min, scalable, non_scalable_qty, canonical_unit_system. Preserve the JSON shape exactly. Output ONLY the JSON object.`,
    },
    { role: 'user', content: args.recipeJson },
  ];
}
