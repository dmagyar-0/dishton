import { describe, expect, it } from 'vitest';
import { formatNumber, formatQuantity, formatUnit } from './format';

describe('formatUnit', () => {
  it('returns the english symbol by default', () => {
    expect(formatUnit('g')).toBe('g');
    expect(formatUnit('cup_us')).toBe('cup');
    expect(formatUnit('fl_oz')).toBe('fl oz');
  });
  it('falls back to english for missing locale entries', () => {
    expect(formatUnit('kg', 'fr')).toBe('kg');
  });
  it('returns the key for unknown units', () => {
    expect(formatUnit('zonk')).toBe('zonk');
  });
});

describe('formatNumber', () => {
  it('drops trailing zeros', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(2)).toBe('2');
  });
  it('preserves integer values', () => {
    expect(formatNumber(100)).toBe('100');
  });
  it('passes through non-finite', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN');
  });
});

describe('formatQuantity', () => {
  it('joins value and unit', () => {
    expect(formatQuantity(200, 'g')).toBe('200 g');
    expect(formatQuantity(1.5, 'tbsp')).toBe('1.5 tbsp');
  });
});
