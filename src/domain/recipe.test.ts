import { describe, expect, it } from 'vitest';
import { Ingredient, NonScalableQty, Quantity, Recipe, Step, UnitSystem } from './recipe';

describe('Quantity', () => {
  it('accepts a finite number', () => {
    expect(Quantity.parse(1.5)).toBe(1.5);
    expect(Quantity.parse(0)).toBe(0);
  });
  it('accepts a fraction object', () => {
    expect(Quantity.parse({ numerator: 1, denominator: 2 })).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });
  it('rejects non-finite numbers', () => {
    expect(() => Quantity.parse(Number.NaN)).toThrow();
    expect(() => Quantity.parse(Number.POSITIVE_INFINITY)).toThrow();
  });
  it('rejects denominator zero', () => {
    expect(() => Quantity.parse({ numerator: 1, denominator: 0 })).toThrow();
  });
  it('rejects negative numerator', () => {
    expect(() => Quantity.parse({ numerator: -1, denominator: 2 })).toThrow();
  });
});

describe('UnitSystem', () => {
  it('accepts metric and imperial', () => {
    expect(UnitSystem.parse('metric')).toBe('metric');
    expect(UnitSystem.parse('imperial')).toBe('imperial');
  });
  it('rejects unknown', () => {
    expect(() => UnitSystem.parse('us')).toThrow();
  });
});

describe('NonScalableQty', () => {
  it('accepts every member', () => {
    for (const v of ['to_taste', 'pinch', 'dash', 'splash', 'handful', 'optional'] as const) {
      expect(NonScalableQty.parse(v)).toBe(v);
    }
  });
});

describe('Ingredient', () => {
  const base = {
    position: 0,
    raw_text: '200 g flour',
    quantity: 200,
    unit: 'g',
    ingredient_name: 'flour',
    notes: null,
  };
  it('parses a complete record with defaults', () => {
    const out = Ingredient.parse(base);
    expect(out.scalable).toBe(true);
    expect(out.non_scalable_qty).toBeNull();
  });
  it('rejects empty raw_text', () => {
    expect(() => Ingredient.parse({ ...base, raw_text: '' })).toThrow();
  });
  it('accepts non_scalable_qty', () => {
    const out = Ingredient.parse({
      ...base,
      quantity: null,
      unit: null,
      ingredient_name: 'salt',
      raw_text: 'salt to taste',
      scalable: false,
      non_scalable_qty: 'to_taste',
    });
    expect(out.scalable).toBe(false);
    expect(out.non_scalable_qty).toBe('to_taste');
  });
});

describe('Step', () => {
  it('parses a step', () => {
    const out = Step.parse({ position: 1, body: 'Mix.', duration_min: 5 });
    expect(out.duration_min).toBe(5);
  });
  it('rejects negative duration', () => {
    expect(() => Step.parse({ position: 0, body: 'mix', duration_min: -1 })).toThrow();
  });
});

const sampleRecipe = {
  title: 'Tomato Tarte Tatin',
  description: 'A savoury take.',
  source_type: 'manual' as const,
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric' as const,
  servings: 4,
  total_time_min: 55,
  hero_image_path: null,
  tags: ['vegetarian', 'french'],
  ingredients: [
    {
      position: 0,
      raw_text: '500 g tomatoes',
      quantity: 500,
      unit: 'g',
      ingredient_name: 'tomatoes',
      notes: null,
    },
  ],
  steps: [{ position: 0, body: 'Preheat oven.', duration_min: 5 }],
};

describe('Recipe', () => {
  it('parses a complete recipe', () => {
    const out = Recipe.parse(sampleRecipe);
    expect(out.title).toBe('Tomato Tarte Tatin');
    expect(out.ingredients).toHaveLength(1);
    expect(out.steps).toHaveLength(1);
  });
  it('round-trips through JSON', () => {
    const parsed = Recipe.parse(sampleRecipe);
    const round = Recipe.parse(JSON.parse(JSON.stringify(parsed)));
    expect(round).toEqual(parsed);
  });
  it('rejects servings out of range', () => {
    expect(() => Recipe.parse({ ...sampleRecipe, servings: 0 })).toThrow();
    expect(() => Recipe.parse({ ...sampleRecipe, servings: 9999 })).toThrow();
  });
  it('rejects too-long tag', () => {
    expect(() => Recipe.parse({ ...sampleRecipe, tags: ['x'.repeat(41)] })).toThrow();
  });
  it('rejects malformed source_url', () => {
    expect(() =>
      Recipe.parse({ ...sampleRecipe, source_url: 'not-a-url', source_type: 'url' }),
    ).toThrow();
  });
  it('accepts a valid source_url', () => {
    const out = Recipe.parse({
      ...sampleRecipe,
      source_type: 'url',
      source_url: 'https://example.test/x',
    });
    expect(out.source_url).toBe('https://example.test/x');
  });
  it('rejects unknown source_language form', () => {
    expect(() => Recipe.parse({ ...sampleRecipe, source_language: 'english' })).toThrow();
  });
  it('default tags is an empty array when omitted', () => {
    const { tags, ...rest } = sampleRecipe;
    void tags;
    const out = Recipe.parse(rest);
    expect(out.tags).toEqual([]);
  });
});
