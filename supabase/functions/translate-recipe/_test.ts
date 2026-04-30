// Tests for translate-recipe.

import { assert, assertEquals } from 'jsr:@std/assert';
import { Recipe } from '../_shared/domain/recipe.ts';
import { buildTranslationCacheKey } from '../_shared/domain/translation-key.ts';

const recipe = Recipe.parse({
  title: 'Tomato Tarte Tatin',
  description: null,
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 55,
  hero_image_path: null,
  tags: [],
  ingredients: [],
  steps: [],
});

Deno.test('cache key: identical recipe + language returns identical hash', () => {
  const a = buildTranslationCacheKey(recipe, 'de');
  const b = buildTranslationCacheKey(recipe, 'de');
  assertEquals(a.sourceHash, b.sourceHash);
});

Deno.test('cache key: same recipe different language gives different key', () => {
  const a = buildTranslationCacheKey(recipe, 'de');
  const b = buildTranslationCacheKey(recipe, 'fr');
  assertEquals(a.sourceHash, b.sourceHash);
  assert(a.key !== b.key);
});
