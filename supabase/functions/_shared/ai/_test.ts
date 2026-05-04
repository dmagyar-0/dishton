// Parity test: RECIPE_JSON_SHAPE must mention every Recipe field. Run via
//   pnpm test:edge
// (which wraps `deno test -A supabase/functions`).

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { Recipe } from '../domain/recipe.ts';
import { RECIPE_JSON_SHAPE, structuringFromImage } from './prompts.ts';

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
      },
    ],
    steps: [{ position: 0, body: 'Preheat.', duration_min: 5 }],
  };
  const out = Recipe.safeParse(sample);
  assert(out.success, JSON.stringify(out));
  if (out.success) assertEquals(out.data.title, 'Tomato Tarte Tatin');
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
