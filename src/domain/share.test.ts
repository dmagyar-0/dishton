import { describe, expect, it } from 'vitest';
import {
  type ShareIngredient,
  type ShareRecipe,
  ingredientLine,
  isoDuration,
  recipeJsonLd,
  sharePath,
  shareSummary,
} from './share.ts';

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

const potatoes: ShareIngredient = {
  raw_text: '800g waxy potatoes',
  ingredient_name: 'waxy potatoes',
  quantity: 800,
  unit: 'g',
  notes: null,
};
const eggs: ShareIngredient = {
  raw_text: null,
  ingredient_name: 'eggs',
  quantity: 6,
  unit: null,
  notes: 'hard-boiled',
};
const sampleRecipe: ShareRecipe = {
  title: 'Rakott Krumpli',
  description: 'Hungarian layered potato casserole.',
  servings: 4,
  total_time_min: 80,
  source_url: 'https://example.com/rakott',
  source_language: 'en',
  tags: ['hungarian', 'comfort'],
  ingredients: [potatoes, eggs],
  steps: [
    { body: 'Boil the potatoes.', position: 0 },
    { body: 'Layer and bake.', position: 1 },
  ],
};

describe('ingredientLine', () => {
  it('prefers the raw imported line', () => {
    expect(ingredientLine(potatoes)).toBe('800g waxy potatoes');
  });
  it('composes qty/unit/name with notes in parens when there is no raw_text', () => {
    expect(ingredientLine(eggs)).toBe('6 eggs (hard-boiled)');
  });
  it('drops a missing quantity and unit', () => {
    expect(
      ingredientLine({
        raw_text: null,
        ingredient_name: 'salt',
        quantity: null,
        unit: null,
        notes: null,
      }),
    ).toBe('salt');
  });
  it('includes the unit when composing from structured fields', () => {
    expect(
      ingredientLine({
        raw_text: null,
        ingredient_name: 'milk',
        quantity: 200,
        unit: 'ml',
        notes: null,
      }),
    ).toBe('200 ml milk');
  });
});

describe('isoDuration', () => {
  it('formats minutes as an ISO-8601 duration', () => {
    expect(isoDuration(80)).toBe('PT80M');
  });
  it('returns null for null or non-positive input', () => {
    expect(isoDuration(null)).toBeNull();
    expect(isoDuration(0)).toBeNull();
  });
});

describe('recipeJsonLd', () => {
  const opts = {
    url: 'https://app.example/r/tok123',
    imageUrl: 'https://fns.example/og.png',
    householdName: 'My Recipes',
  };
  it('maps the recipe into a Schema.org Recipe object', () => {
    const ld = recipeJsonLd(sampleRecipe, opts);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld.url).toBe('https://app.example/r/tok123');
    expect(ld.image).toEqual(['https://fns.example/og.png']);
    expect(ld['@type']).toBe('Recipe');
    expect(ld.name).toBe('Rakott Krumpli');
    expect(ld.recipeYield).toBe('4');
    expect(ld.totalTime).toBe('PT80M');
    expect(ld.inLanguage).toBe('en');
    expect(ld.keywords).toBe('hungarian, comfort');
    expect(ld.recipeIngredient).toEqual(['800g waxy potatoes', '6 eggs (hard-boiled)']);
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Boil the potatoes.' },
      { '@type': 'HowToStep', text: 'Layer and bake.' },
    ]);
    expect(ld.author).toEqual({ '@type': 'Organization', name: 'My Recipes' });
  });
  it('omits totalTime, keywords, and description when absent', () => {
    const ld = recipeJsonLd(
      { ...sampleRecipe, description: null, total_time_min: null, tags: [] },
      opts,
    );
    expect(ld.totalTime).toBeUndefined();
    expect(ld.keywords).toBeUndefined();
    expect(ld.description).toBeUndefined();
  });
});
