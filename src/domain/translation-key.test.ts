import { describe, expect, it } from 'vitest';
import type { Recipe } from './recipe';
import { buildTranslationCacheKey, stableStringify } from './translation-key';

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    const a = { b: 1, a: { y: 2, x: 1 } };
    const b = { a: { x: 1, y: 2 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
  it('preserves array order', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('a')).toBe('"a"');
    expect(stableStringify(1)).toBe('1');
    expect(stableStringify(true)).toBe('true');
  });
});

const recipe: Recipe = {
  title: 'X',
  description: null,
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 1,
  total_time_min: null,
  hero_image_path: null,
  tags: [],
  ingredients: [],
  steps: [],
};

describe('buildTranslationCacheKey', () => {
  it('produces a deterministic hex hash', () => {
    const a = buildTranslationCacheKey(recipe, 'de');
    const b = buildTranslationCacheKey(recipe, 'de');
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('includes the language in the key', () => {
    const a = buildTranslationCacheKey(recipe, 'de');
    const b = buildTranslationCacheKey(recipe, 'fr');
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.key).not.toBe(b.key);
  });
  it('changes the hash when content changes', () => {
    const a = buildTranslationCacheKey(recipe, 'de');
    const b = buildTranslationCacheKey({ ...recipe, title: 'Y' }, 'de');
    expect(a.sourceHash).not.toBe(b.sourceHash);
  });
});
