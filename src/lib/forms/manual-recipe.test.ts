import { Recipe } from '@/domain/recipe';
import { describe, expect, it } from 'vitest';
import { blankManualRecipe } from './manual-recipe';

describe('blankManualRecipe', () => {
  it('produces a manual-source blank with one ingredient and one step', () => {
    const r = blankManualRecipe('en');
    expect(r.source_type).toBe('manual');
    expect(r.title).toBe('');
    expect(r.servings).toBe(4);
    expect(r.canonical_unit_system).toBe('metric');
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0]?.raw_text).toBe('');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]?.body).toBe('');
  });

  it('derives source_language from the locale and falls back to en', () => {
    expect(blankManualRecipe('de').source_language).toBe('de');
    expect(blankManualRecipe('').source_language).toBe('en');
  });

  it('parses against the Recipe schema once title and rows are filled', () => {
    const base = blankManualRecipe('en');
    const filled = {
      ...base,
      title: 'Test recipe',
      ingredients: base.ingredients.map((i) => ({ ...i, raw_text: '2 eggs' })),
      steps: base.steps.map((s) => ({ ...s, body: 'Mix everything.' })),
    };
    expect(() => Recipe.parse(filled)).not.toThrow();
  });
});
