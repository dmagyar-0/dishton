import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Recipe } from './recipe';
import { quantityIsEmpty, quantityToNumber, scale, scaleToServings } from './scale';

const base: Recipe = {
  title: 'Test',
  description: null,
  source_type: 'manual',
  source_url: null,
  source_language: 'en',
  canonical_unit_system: 'metric',
  servings: 4,
  total_time_min: 30,
  hero_image_path: null,
  tags: [],
  ingredients: [
    {
      position: 0,
      raw_text: '200 g flour',
      quantity: 200,
      unit: 'g',
      ingredient_name: 'flour',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
    {
      position: 1,
      raw_text: 'salt to taste',
      quantity: null,
      unit: null,
      ingredient_name: 'salt',
      notes: null,
      scalable: false,
      non_scalable_qty: 'to_taste',
      section: null,
    },
    {
      position: 2,
      raw_text: '1 cup milk',
      quantity: 1,
      unit: 'cup_us',
      ingredient_name: 'milk',
      notes: null,
      scalable: true,
      non_scalable_qty: null,
      section: null,
    },
  ],
  steps: [{ position: 0, body: 'Mix.', duration_min: null }],
};

describe('quantityToNumber', () => {
  it('returns the numeric value as-is', () => {
    expect(quantityToNumber(2)).toBe(2);
  });
  it('reduces fraction object to a number', () => {
    expect(quantityToNumber({ numerator: 3, denominator: 4 })).toBe(0.75);
  });
});

describe('quantityIsEmpty', () => {
  it('treats null/undefined as empty', () => {
    expect(quantityIsEmpty(null)).toBe(true);
    expect(quantityIsEmpty(undefined)).toBe(true);
  });
  it('treats 0 and 0/n as empty', () => {
    expect(quantityIsEmpty(0)).toBe(true);
    expect(quantityIsEmpty({ numerator: 0, denominator: 4 })).toBe(true);
  });
  it('treats real amounts as non-empty', () => {
    expect(quantityIsEmpty(1.5)).toBe(false);
    expect(quantityIsEmpty({ numerator: 1, denominator: 3 })).toBe(false);
  });
});

describe('scale', () => {
  it('factor=1 returns deep-equal recipe', () => {
    const out = scale(base, 1);
    expect(out).toEqual(base);
  });
  it('integer factor scales scalable ingredients', () => {
    const out = scale(base, 2);
    expect(out.servings).toBe(8);
    expect(out.ingredients[0]?.quantity).toBe(400);
    expect(out.ingredients[2]?.quantity).toBe(2);
  });
  it('non-scalable ingredients are preserved', () => {
    const out = scale(base, 3);
    expect(out.ingredients[1]?.quantity).toBeNull();
    expect(out.ingredients[1]?.non_scalable_qty).toBe('to_taste');
  });
  it('rejects non-positive factor', () => {
    expect(() => scale(base, 0)).toThrow();
    expect(() => scale(base, -1)).toThrow();
    expect(() => scale(base, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => scale(base, Number.NaN)).toThrow();
  });
  it('rounds servings to >= 1', () => {
    const out = scale(base, 0.1);
    expect(out.servings).toBe(1);
  });
  it('snaps tiny fractional results via niceQuantity (cup_us 1/8 grid)', () => {
    const out = scale(base, 1.5);
    expect(out.ingredients[2]?.quantity).toBe(1.5);
  });
});

describe('scaleToServings', () => {
  it('scales to target servings', () => {
    const out = scaleToServings(base, 8);
    expect(out.servings).toBe(8);
    expect(out.ingredients[0]?.quantity).toBe(400);
  });
  it('rejects non-positive target', () => {
    expect(() => scaleToServings(base, 0)).toThrow();
    expect(() => scaleToServings(base, -2)).toThrow();
  });
});

describe('property: scale(scale(r, k), 1/k) ~= r per ingredient', () => {
  it('within unit snap step', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 4, noNaN: true, noDefaultInfinity: true }), (k) => {
        const a = scale(base, k);
        const b = scale(a, 1 / k);
        // For mass in grams the snap step is at most 50; allow generous tolerance.
        const flour = b.ingredients[0]?.quantity;
        expect(typeof flour).toBe('number');
        if (typeof flour === 'number') {
          expect(Math.abs(flour - 200)).toBeLessThanOrEqual(50);
        }
      }),
      { numRuns: 50 },
    );
  });
});
