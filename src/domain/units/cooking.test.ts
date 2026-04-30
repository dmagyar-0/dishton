import { describe, expect, it } from 'vitest';
import { resolveUnitToken, stickOfButterToGrams } from './cooking';

describe('resolveUnitToken', () => {
  it('resolves common english tokens', () => {
    expect(resolveUnitToken('g')).toBe('g');
    expect(resolveUnitToken('grams')).toBe('g');
    expect(resolveUnitToken('Kg')).toBe('kg');
    expect(resolveUnitToken('TSP')).toBe('tsp');
    expect(resolveUnitToken('tablespoons')).toBe('tbsp');
    expect(resolveUnitToken('fl oz')).toBe('fl_oz');
    expect(resolveUnitToken('°c')).toBe('C');
    expect(resolveUnitToken('hours')).toBe('h');
  });
  it('cup defaults to cup_us for English source', () => {
    expect(resolveUnitToken('cup', 'en')).toBe('cup_us');
    expect(resolveUnitToken('cups', 'en-US')).toBe('cup_us');
    expect(resolveUnitToken('cup', undefined)).toBe('cup_us');
  });
  it('cup resolves to cup_metric for European-language source', () => {
    expect(resolveUnitToken('cup', 'de')).toBe('cup_metric');
    expect(resolveUnitToken('tasse', 'fr')).toBe('cup_metric');
    expect(resolveUnitToken('kop', 'nl')).toBe('cup_metric');
    expect(resolveUnitToken('kopjes', 'nl')).toBe('cup_metric');
  });
  it('returns null for unknown tokens and empty input', () => {
    expect(resolveUnitToken('zonk')).toBeNull();
    expect(resolveUnitToken('')).toBeNull();
    expect(resolveUnitToken('  ')).toBeNull();
  });
});

describe('stickOfButterToGrams', () => {
  it('1 stick = 113 g', () => {
    expect(stickOfButterToGrams(1)).toEqual({ qty: 113, unit: 'g' });
    expect(stickOfButterToGrams(2)).toEqual({ qty: 226, unit: 'g' });
    expect(stickOfButterToGrams(0)).toEqual({ qty: 0, unit: 'g' });
  });
});
