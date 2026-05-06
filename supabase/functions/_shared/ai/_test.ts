// Parity test: RECIPE_JSON_SHAPE must mention every Recipe field. Run via
//   pnpm test:edge
// (which wraps `deno test -A supabase/functions`).

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import {
  RECIPE_JSON_SHAPE,
  languageDirective,
  structuringFromCaption,
  structuringFromHtml,
  structuringFromImage,
} from './prompts.ts';
import { normalizePositions } from './validate.ts';

const RECIPE_FIELDS = [
  'title',
  'description',
  'source_type',
  'source_url',
  'source_language',
  'canonical_unit_system',
  'servings',
  'total_time_min',
  'hero_image_path',
  'tags',
  'ingredients',
  'steps',
  'position',
  'raw_text',
  'quantity',
  'unit',
  'ingredient_name',
  'notes',
  'scalable',
  'non_scalable_qty',
  'section',
  'duration_min',
  'body',
] as const;

Deno.test('RECIPE_JSON_SHAPE mentions every Recipe field', () => {
  for (const f of RECIPE_FIELDS) {
    assertStringIncludes(RECIPE_JSON_SHAPE, `"${f}"`, `missing field: ${f}`);
  }
});

Deno.test('Recipe.parse accepts a sample structuring response', () => {
  const sample = {
    title: 'Tomato Tarte Tatin',
    description: 'A savoury take.',
    source_type: 'url',
    source_url: 'https://example.test/recipe',
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: 55,
    hero_image_path: null,
    tags: ['savoury'],
    ingredients: [
      {
        position: 0,
        raw_text: '500 g tomatoes',
        quantity: 500,
        unit: 'g',
        ingredient_name: 'tomatoes',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: 'For the filling',
      },
    ],
    steps: [{ position: 0, body: 'Preheat.', duration_min: 5 }],
  };
  const out = Recipe.safeParse(sample);
  assert(out.success, JSON.stringify(out));
  if (out.success) {
    assertEquals(out.data.title, 'Tomato Tarte Tatin');
    assertEquals(out.data.ingredients[0].section, 'For the filling');
  }
});

function getUserText(messages: ReturnType<typeof structuringFromImage>): string {
  const user = messages.find((m) => m.role === 'user');
  assert(user, 'expected a user message');
  const content = user.content;
  assert(Array.isArray(content), 'expected user content to be an array');
  const textPart = content.find((c) => c.type === 'text');
  assert(textPart && textPart.type === 'text', 'expected a text part');
  return textPart.text;
}

Deno.test('structuringFromImage without comment matches the original instruction', () => {
  const messages = structuringFromImage({ imageUrl: 'https://example.test/x.jpg' });
  const text = getUserText(messages);
  assertEquals(
    text,
    'Extract the recipe in this image. If parts are unreadable, set them to null. Do not invent ingredients.',
  );
});

Deno.test('structuringFromImage with comment appends a fenced user note', () => {
  const messages = structuringFromImage({
    imageUrl: 'https://example.test/x.jpg',
    comment: 'the title is in Italian',
  });
  const text = getUserText(messages);
  assertStringIncludes(text, 'User note:');
  assertStringIncludes(text, '"""\nthe title is in Italian\n"""');
  assertStringIncludes(text, 'Apply it ONLY if it is clearly relevant');
});

Deno.test('structuringFromImage with whitespace-only comment behaves as if absent', () => {
  const messages = structuringFromImage({
    imageUrl: 'https://example.test/x.jpg',
    comment: '   \n  ',
  });
  const text = getUserText(messages);
  assertEquals(
    text,
    'Extract the recipe in this image. If parts are unreadable, set them to null. Do not invent ingredients.',
  );
});

function systemContent(messages: { role: string; content: unknown }[]): string {
  const sys = messages.find((m) => m.role === 'system');
  assert(sys, 'expected a system message');
  assert(typeof sys.content === 'string', 'expected string system content');
  return sys.content;
}

Deno.test('languageDirective without target preserves source language', () => {
  const directive = languageDirective(undefined);
  assertStringIncludes(directive, 'Preserve the source language verbatim');
  assertStringIncludes(directive, 'do NOT translate');
});

Deno.test('languageDirective with target asks for translation', () => {
  const directive = languageDirective('de');
  assertStringIncludes(directive, 'Translate the human-readable strings into de');
  assertStringIncludes(directive, 'title, description, ingredient.raw_text');
  assertStringIncludes(directive, 'Set source_language to "de"');
});

Deno.test('structuringFromHtml threads targetLanguage into the system message', () => {
  const messages = structuringFromHtml({
    html: '<html></html>',
    sourceUrl: 'https://example.test/r',
    targetLanguage: 'fr',
  });
  assertStringIncludes(systemContent(messages), 'Translate the human-readable strings into fr');
});

Deno.test('structuringFromCaption threads targetLanguage into the system message', () => {
  const messages = structuringFromCaption({
    caption: 'recipe',
    sourceUrl: 'https://example.test/p',
    targetLanguage: 'es',
  });
  assertStringIncludes(systemContent(messages), 'Translate the human-readable strings into es');
});

Deno.test('structuringFromImage threads targetLanguage into the system message', () => {
  const messages = structuringFromImage({
    imageUrl: 'https://example.test/x.jpg',
    targetLanguage: 'hu',
  });
  assertStringIncludes(systemContent(messages), 'Translate the human-readable strings into hu');
});

Deno.test('structuringFromHtml without targetLanguage keeps the preserve directive', () => {
  const messages = structuringFromHtml({
    html: '<html></html>',
    sourceUrl: 'https://example.test/r',
  });
  assertStringIncludes(systemContent(messages), 'Preserve the source language verbatim');
});

// normalizePositions: post-Zod fix-up that re-indexes ingredients[].position
// and steps[].position to 0-based contiguous, by array order. The recipe view
// renders steps as `position + 1`, so 1-based positions from the model would
// produce "Step 2, Step 3, ..." without this normalization.

function baseRecipe(): RecipeType {
  return {
    title: 'Sample',
    description: null,
    source_type: 'url',
    source_url: 'https://example.test/r',
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: null,
    hero_image_path: null,
    tags: [],
    ingredients: [],
    steps: [],
  };
}

function ing(position: number, name: string) {
  return {
    position,
    raw_text: name,
    quantity: null,
    unit: null,
    ingredient_name: name,
    notes: null,
    scalable: true,
    non_scalable_qty: null,
    section: null,
  };
}

function step(position: number, body: string) {
  return { position, body, duration_min: null };
}

Deno.test('normalizePositions rebases 1-based step positions to 0-based', () => {
  const out = normalizePositions({
    ...baseRecipe(),
    steps: [step(1, 'first'), step(2, 'second'), step(3, 'third')],
  });
  assertEquals(out.steps.map((s) => s.position), [0, 1, 2]);
  assertEquals(out.steps.map((s) => s.body), ['first', 'second', 'third']);
});

Deno.test('normalizePositions rebases 1-based ingredient positions to 0-based', () => {
  const out = normalizePositions({
    ...baseRecipe(),
    ingredients: [ing(1, 'flour'), ing(2, 'water'), ing(3, 'salt')],
  });
  assertEquals(out.ingredients.map((i) => i.position), [0, 1, 2]);
});

Deno.test('normalizePositions leaves already-correct 0-based positions unchanged', () => {
  const out = normalizePositions({
    ...baseRecipe(),
    ingredients: [ing(0, 'a'), ing(1, 'b')],
    steps: [step(0, 'mix'), step(1, 'bake')],
  });
  assertEquals(out.ingredients.map((i) => i.position), [0, 1]);
  assertEquals(out.steps.map((s) => s.position), [0, 1]);
});

Deno.test('normalizePositions reindexes positions with gaps using array order', () => {
  const out = normalizePositions({
    ...baseRecipe(),
    steps: [step(0, 'a'), step(2, 'b'), step(5, 'c')],
  });
  assertEquals(out.steps.map((s) => s.position), [0, 1, 2]);
  assertEquals(out.steps.map((s) => s.body), ['a', 'b', 'c']);
});

Deno.test('normalizePositions handles empty arrays', () => {
  const out = normalizePositions(baseRecipe());
  assertEquals(out.ingredients, []);
  assertEquals(out.steps, []);
});

Deno.test('normalizePositions preserves non-position step fields', () => {
  const out = normalizePositions({
    ...baseRecipe(),
    steps: [
      { position: 7, body: 'preheat', duration_min: 5 },
      { position: 8, body: 'bake', duration_min: 30 },
    ],
  });
  assertEquals(out.steps, [
    { position: 0, body: 'preheat', duration_min: 5 },
    { position: 1, body: 'bake', duration_min: 30 },
  ]);
});
