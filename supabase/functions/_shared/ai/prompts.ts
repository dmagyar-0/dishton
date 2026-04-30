// Typed prompt templates. The Recipe shape is described inline so the model
// sees the exact field schema — most reliable structured-output pattern on
// open-weight models.
//
// `RECIPE_JSON_SHAPE` is asserted by a parity test (see _test.ts) to mention
// every field in the Zod Recipe schema; that test catches the case of a new
// Recipe field being added but not advertised to the model.

import type { NimMessage } from './client.ts';

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
      "non_scalable_qty": "to_taste"|"pinch"|"dash"|"splash"|"handful"|"optional"|null
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
- Preserve the source language verbatim; do NOT translate.
- Canonical unit keys: g, kg, oz, lb, ml, l, tsp, tbsp, cup_us, cup_metric,
  fl_oz, count, C, F, min, h.
`.trim();

export function structuringFromHtml(args: {
  html: string;
  sourceUrl: string;
  hint?: string;
}): NimMessage[] {
  return [
    {
      role: 'system',
      content: `You convert recipe HTML into a strict JSON object. ${RECIPE_JSON_SHAPE}`,
    },
    {
      role: 'user',
      content: `Source URL: ${args.sourceUrl}
${args.hint ? `Hint: ${args.hint}\n` : ''}
HTML (already cleaned by Readability):
"""
${args.html}
"""`,
    },
  ];
}

export function structuringFromCaption(args: {
  caption: string;
  sourceUrl: string;
}): NimMessage[] {
  return [
    {
      role: 'system',
      content: `You convert an Instagram recipe caption into strict JSON. ${RECIPE_JSON_SHAPE}`,
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

export function structuringFromImage(args: { imageUrl: string }): NimMessage[] {
  return [
    {
      role: 'system',
      content:
        `You read recipes from photographs (handwriting, cookbook scans, screenshots) and output strict JSON. ${RECIPE_JSON_SHAPE}`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the recipe in this image. If parts are unreadable, set them to null. Do not invent ingredients.',
        },
        { type: 'image_url', image_url: { url: args.imageUrl } },
      ],
    },
  ];
}

export function translatePrompt(args: {
  recipeJson: string;
  targetLanguage: string;
}): NimMessage[] {
  return [
    {
      role: 'system',
      content: `You translate a Dishton Recipe JSON into ${args.targetLanguage}. Only translate human-readable strings: title, description, ingredient.raw_text, ingredient.ingredient_name, ingredient.notes, step.body, tags. Do NOT change quantity, unit, position, source_type, source_url, source_language, servings, total_time_min, scalable, non_scalable_qty, canonical_unit_system. Preserve the JSON shape exactly. Output ONLY the JSON object.`,
    },
    { role: 'user', content: args.recipeJson },
  ];
}
