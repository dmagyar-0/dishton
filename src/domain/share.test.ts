import { describe, expect, it } from 'vitest';
import { sharePath, shareSummary } from './share.ts';

describe('sharePath', () => {
  it('builds the public route path from a token', () => {
    expect(sharePath('abc123')).toBe('/r/abc123');
  });
});

describe('shareSummary', () => {
  it('prefers the recipe description when present', () => {
    expect(
      shareSummary({
        description: 'A savoury upside-down pastry.',
        servings: 4,
        total_time_min: 55,
        ingredientCount: 3,
      }),
    ).toBe('A savoury upside-down pastry.');
  });

  it('truncates long descriptions to 160 chars on a word boundary with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const out = shareSummary({
      description: long,
      servings: 4,
      total_time_min: null,
      ingredientCount: 1,
    });
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('falls back to a facts line without a description', () => {
    expect(
      shareSummary({ description: null, servings: 4, total_time_min: 55, ingredientCount: 9 }),
    ).toBe('4 servings · 55 min · 9 ingredients');
  });

  it('singularises and omits missing time', () => {
    expect(
      shareSummary({ description: '', servings: 1, total_time_min: null, ingredientCount: 1 }),
    ).toBe('1 serving · 1 ingredient');
  });

  it('omits a zero-minute time', () => {
    expect(
      shareSummary({ description: null, servings: 2, total_time_min: 0, ingredientCount: 2 }),
    ).toBe('2 servings · 2 ingredients');
  });
});
