import { assert, assertEquals } from 'jsr:@std/assert';
import { validateDraft } from './recipe-tools.ts';

const VALID = {
  title: 'Test Soup',
  description: null,
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 30,
  hero_image_path: null,
  tags: ['soup'],
  ingredients: [
    {
      position: 5,
      raw_text: '1 onion',
      quantity: 1,
      unit: null,
      ingredient_name: 'onion',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
  ],
  steps: [{ position: 2, body: 'Chop and simmer.', duration_min: 30 }],
};

Deno.test('validateDraft accepts a valid recipe and renumbers positions', () => {
  const res = validateDraft(VALID);
  assert(res.ok, JSON.stringify(res));
  if (res.ok) {
    assertEquals(res.recipe.ingredients[0]!.position, 0);
    assertEquals(res.recipe.steps[0]!.position, 0);
  }
});

Deno.test('validateDraft reports errors for an invalid recipe', () => {
  const res = validateDraft({ ...VALID, title: '' });
  assert(!res.ok);
  if (!res.ok) assert(res.errors.length > 0);
});
