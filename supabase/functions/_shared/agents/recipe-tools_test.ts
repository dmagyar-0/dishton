import { assert, assertEquals } from 'jsr:@std/assert';
import { formatTasteSummary, validateDraft } from './recipe-tools.ts';

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

Deno.test('formatTasteSummary renders one compact line per recipe', () => {
  const out = formatTasteSummary({
    count: 2,
    recipes: [
      {
        id: 'r1',
        title: 'Lentil Soup',
        unit_system: 'metric',
        language: 'en',
        tags: ['soup', 'vegetarian'],
        key_ingredients: ['lentils', 'carrot', 'cumin'],
      },
      { id: 'r2', title: 'Toast', unit_system: 'imperial', language: 'en', tags: [], key_ingredients: [] },
    ],
  });
  assertEquals(
    out,
    "The household's existing recipes (2, newest first):\n" +
      '- Lentil Soup [soup, vegetarian] (metric, en): lentils, carrot, cumin\n' +
      '- Toast (imperial, en)\n\n',
  );
});

Deno.test('formatTasteSummary says so when the household has no recipes', () => {
  assertEquals(formatTasteSummary({ count: 0, recipes: [] }), "The household's existing recipes: none yet.\n\n");
});
