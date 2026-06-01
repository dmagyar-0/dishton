import { assert, assertEquals } from '@std/assert';
import { type Gold, goldDiff, validateSchema } from './score.ts';

const validRecipe = {
  title: 'T',
  description: null,
  source_type: 'photo',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 6,
  total_time_min: null,
  hero_image_path: null,
  tags: [],
  ingredients: [
    {
      position: 0,
      raw_text: '1 medium leek',
      quantity: 1,
      unit: 'count',
      ingredient_name: 'leek',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: 'base veg',
    },
    {
      position: 1,
      raw_text: '100g green beans',
      quantity: 100,
      unit: 'g',
      ingredient_name: 'green beans',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: 'core veg',
    },
  ],
  steps: Array.from({ length: 10 }, (_, i) => ({ position: i, body: `step ${i}`, duration_min: null })),
};

const gold: Gold = {
  title: 'SP',
  minSteps: 10,
  sections: [],
  expect: ['leek', 'green beans', 'veg stock'],
  forbidden: ['fine bean', 'onion'],
};

Deno.test('validateSchema accepts a valid recipe', () => {
  const r = validateSchema(JSON.stringify(validRecipe));
  assert(r.ok);
});

Deno.test('validateSchema strips ```json fences and reports schema errors', () => {
  const bad = { ...validRecipe, servings: 0 }; // violates min(1)
  const r = validateSchema('```json\n' + JSON.stringify(bad) + '\n```');
  assert(!r.ok);
  assert(r.error.startsWith('schema'));
});

Deno.test('goldDiff: recall + term-subset matching, no false bleed', () => {
  const parsed = validateSchema(JSON.stringify(validRecipe));
  assert(parsed.ok);
  const g = goldDiff(parsed.recipe, gold);
  assertEquals([...g.matched].sort(), ['green beans', 'leek']);
  assertEquals(g.missing, ['veg stock']);
  // "fine bean" must NOT match "green beans"; "onion" is absent
  assertEquals(g.bleed, []);
  assertEquals(g.stepOk, true);
});

Deno.test('goldDiff: no cross-ingredient false bleed (black pepper + green beans ≠ black bean)', () => {
  const r = {
    ...validRecipe,
    ingredients: [
      {
        position: 0,
        raw_text: 'salt and freshly ground black pepper',
        quantity: null,
        unit: null,
        ingredient_name: 'black pepper',
        notes: null,
        scalable: false,
        non_scalable_qty: 'to_taste',
        section: null,
      },
      {
        position: 1,
        raw_text: '100g green beans',
        quantity: 100,
        unit: 'g',
        ingredient_name: 'green beans',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
    ],
  };
  const parsed = validateSchema(JSON.stringify(r));
  assert(parsed.ok);
  const g = goldDiff(parsed.recipe, { ...gold, forbidden: ['black bean'] });
  assertEquals(g.bleed, []); // "black" and "bean" live in different rows
});

Deno.test('goldDiff: detects bleed + matches veg→vegetable', () => {
  const r = {
    ...validRecipe,
    ingredients: [
      {
        position: 0,
        raw_text: '2 onions',
        quantity: 2,
        unit: 'count',
        ingredient_name: 'onion',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
      {
        position: 1,
        raw_text: '500ml vegetable stock',
        quantity: 500,
        unit: 'ml',
        ingredient_name: 'vegetable stock',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
    ],
  };
  const parsed = validateSchema(JSON.stringify(r));
  assert(parsed.ok);
  const g = goldDiff(parsed.recipe, gold);
  assert(g.bleed.includes('onion'));
  assert(g.matched.includes('veg stock')); // "veg"⊂"vegetable", "stock" present
});
