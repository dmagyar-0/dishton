import { describe, expect, it } from 'vitest';
import { formatQuantityForInput, parseQuantityInput } from './quantity-parse';

describe('parseQuantityInput', () => {
  it('returns null for an empty string', () => {
    expect(parseQuantityInput('')).toEqual({ ok: true, value: null });
    expect(parseQuantityInput('   ')).toEqual({ ok: true, value: null });
  });

  it('parses a decimal', () => {
    expect(parseQuantityInput('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(parseQuantityInput('0')).toEqual({ ok: true, value: 0 });
    expect(parseQuantityInput(' 250 ')).toEqual({ ok: true, value: 250 });
  });

  it('parses a decimal written with a comma separator', () => {
    expect(parseQuantityInput('0,5')).toEqual({ ok: true, value: 0.5 });
    expect(parseQuantityInput('1,5')).toEqual({ ok: true, value: 1.5 });
    expect(parseQuantityInput(' 12,75 ')).toEqual({ ok: true, value: 12.75 });
  });

  it('parses a simple fraction', () => {
    expect(parseQuantityInput('1/2')).toEqual({
      ok: true,
      value: { numerator: 1, denominator: 2 },
    });
    expect(parseQuantityInput('3/4')).toEqual({
      ok: true,
      value: { numerator: 3, denominator: 4 },
    });
  });

  it('parses a mixed fraction', () => {
    expect(parseQuantityInput('1 1/2')).toEqual({
      ok: true,
      value: { numerator: 3, denominator: 2 },
    });
    expect(parseQuantityInput('2 3/4')).toEqual({
      ok: true,
      value: { numerator: 11, denominator: 4 },
    });
  });

  it('rejects garbage', () => {
    expect(parseQuantityInput('abc')).toEqual({ ok: false, error: 'invalid' });
    expect(parseQuantityInput('1.2.3')).toEqual({ ok: false, error: 'invalid' });
    expect(parseQuantityInput('1,2,3')).toEqual({ ok: false, error: 'invalid' });
    expect(parseQuantityInput('1/0')).toEqual({ ok: false, error: 'invalid' });
    expect(parseQuantityInput('-1')).toEqual({ ok: false, error: 'invalid' });
    expect(parseQuantityInput('1/')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('formatQuantityForInput', () => {
  it('returns empty string for null', () => {
    expect(formatQuantityForInput(null)).toBe('');
  });

  it('formats integers as plain numbers', () => {
    expect(formatQuantityForInput(2)).toBe('2');
    expect(formatQuantityForInput(250)).toBe('250');
  });

  it('formats fraction objects with denominator 1 as integers', () => {
    expect(formatQuantityForInput({ numerator: 3, denominator: 1 })).toBe('3');
  });

  it('formats small decimals as mixed fractions', () => {
    expect(formatQuantityForInput(0.5)).toBe('1/2');
    expect(formatQuantityForInput(1.5)).toBe('1 1/2');
  });

  it('keeps large decimals as plain numbers', () => {
    expect(formatQuantityForInput(12.5)).toBe('12.5');
  });

  it('formats stored fraction objects', () => {
    expect(formatQuantityForInput({ numerator: 1, denominator: 2 })).toBe('1/2');
    expect(formatQuantityForInput({ numerator: 3, denominator: 2 })).toBe('1 1/2');
  });

  it('round-trips via parseQuantityInput', () => {
    const cases = [null, 0, 2, 1.5, { numerator: 3, denominator: 4 }] as const;
    for (const q of cases) {
      const parsed = parseQuantityInput(formatQuantityForInput(q));
      expect(parsed.ok).toBe(true);
    }
  });
});
