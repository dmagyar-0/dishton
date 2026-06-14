import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatDisplayQuantity,
  formatExactFraction,
  formatFraction,
  isFractionFriendlyUnit,
  niceFraction,
  niceQuantity,
  shouldHideFraction,
  snap,
} from './fractions';

describe('snap', () => {
  it('snaps to step', () => {
    expect(snap(1.49, 0.5)).toBe(1.5);
    expect(snap(1.74, 0.5)).toBe(1.5);
    expect(snap(1.76, 0.5)).toBe(2);
  });
  it('rejects non-positive step', () => {
    expect(() => snap(1, 0)).toThrow();
    expect(() => snap(1, -1)).toThrow();
  });
});

describe('niceFraction', () => {
  it('default denom is 8', () => {
    const f = niceFraction(0.5);
    expect(f).toEqual({ whole: 0, numerator: 1, denominator: 2 });
  });
  it('handles negative input', () => {
    const f = niceFraction(-1.5, 8);
    expect(formatFraction(f)).toContain('1/2');
    expect(f.whole).toBeLessThanOrEqual(0);
  });
  it('formats a negative mixed number with the sign on the whole part', () => {
    expect(formatFraction(niceFraction(-1.5, 8))).toBe('-1 1/2');
    expect(formatFraction(niceFraction(-0.5, 8))).toBe('-1/2');
    expect(formatFraction(niceFraction(-2, 8))).toBe('-2');
  });
  it('returns whole when no remainder', () => {
    const f = niceFraction(2, 8);
    expect(f).toEqual({ whole: 2, numerator: 0, denominator: 8 });
    expect(formatFraction(f)).toBe('2');
  });
  it('reduces 4/8 -> 1/2', () => {
    const f = niceFraction(0.5, 8);
    expect(f.numerator).toBe(1);
    expect(f.denominator).toBe(2);
    expect(formatFraction(f)).toBe('1/2');
  });
  it('reduces 2/8 -> 1/4', () => {
    const f = niceFraction(0.25, 8);
    expect(f.numerator).toBe(1);
    expect(f.denominator).toBe(4);
  });
  it('renders 5/8 unreduced', () => {
    const f = niceFraction(0.625, 8);
    expect(f).toEqual({ whole: 0, numerator: 5, denominator: 8 });
    expect(formatFraction(f)).toBe('5/8');
  });
  it('renders mixed numbers', () => {
    const f = niceFraction(1.25, 8);
    expect(f).toEqual({ whole: 1, numerator: 1, denominator: 4 });
    expect(formatFraction(f)).toBe('1 1/4');
  });
});

describe('niceQuantity', () => {
  it('snaps tsp/tbsp/cup to 1/8 grid', () => {
    expect(niceQuantity(1.13, 'tsp')).toBeCloseTo(1.125, 5);
    expect(niceQuantity(1.5, 'cup_us')).toBe(1.5);
  });
  it('snaps oz/lb to 1/8 grid', () => {
    expect(niceQuantity(1.13, 'oz')).toBeCloseTo(1.125, 5);
    expect(niceQuantity(2.2, 'lb')).toBeCloseTo(2.25, 5);
  });
  it('snaps small ml to 5', () => {
    expect(niceQuantity(7, 'ml')).toBe(5);
    expect(niceQuantity(8, 'ml')).toBe(10);
  });
  it('snaps mid ml to 25', () => {
    expect(niceQuantity(287, 'ml')).toBe(275);
    expect(niceQuantity(288, 'ml')).toBe(300);
  });
  it('snaps large ml to 50', () => {
    expect(niceQuantity(1234, 'ml')).toBe(1250);
  });
  it('snaps g to 5/25/50 by magnitude', () => {
    expect(niceQuantity(7, 'g')).toBe(5);
    expect(niceQuantity(287, 'g')).toBe(275);
    expect(niceQuantity(1234, 'g')).toBe(1250);
  });
  it('snaps temperatures to 5', () => {
    expect(niceQuantity(177, 'C')).toBe(175);
    expect(niceQuantity(178, 'C')).toBe(180);
    expect(niceQuantity(351, 'F')).toBe(350);
  });
  it('snaps time min >= 5 to nearest 5', () => {
    expect(niceQuantity(7, 'min')).toBe(5);
    expect(niceQuantity(13, 'min')).toBe(15);
    expect(niceQuantity(2.4, 'min')).toBe(2);
  });
  it('rounds count >= 1 to integer', () => {
    expect(niceQuantity(2.4, 'count')).toBe(2);
    expect(niceQuantity(0.5, 'count')).toBe(0.5);
  });
  it('passes through unknown units', () => {
    expect(niceQuantity(2.7, 'zonk')).toBe(2.7);
  });
  it('snaps kg to 0.05', () => {
    expect(niceQuantity(1.13, 'kg')).toBeCloseTo(1.15, 5);
  });
  it('snaps l to 0.05', () => {
    expect(niceQuantity(1.23, 'l')).toBeCloseTo(1.25, 5);
  });
  it('snaps h to 0.25', () => {
    expect(niceQuantity(1.1, 'h')).toBeCloseTo(1, 5);
    expect(niceQuantity(1.13, 'h')).toBeCloseTo(1.25, 5);
  });
  it('handles negative values via niceFraction', () => {
    expect(niceQuantity(-0.5, 'tbsp')).toBe(-0.5);
  });
  it('handles null unit', () => {
    expect(niceQuantity(2.4, null)).toBe(2);
    expect(niceQuantity(0.55, undefined)).toBeCloseTo(0.6, 5);
  });
  it('passes through non-finite', () => {
    expect(niceQuantity(Number.NaN, 'g')).toBeNaN();
  });
});

describe('shouldHideFraction', () => {
  it('hides at >= 10', () => {
    expect(shouldHideFraction(10)).toBe(true);
    expect(shouldHideFraction(11.5)).toBe(true);
  });
  it('shows below 10', () => {
    expect(shouldHideFraction(9.99)).toBe(false);
    expect(shouldHideFraction(0)).toBe(false);
  });
});

describe('isFractionFriendlyUnit', () => {
  it('treats cooking-volume + imperial mass + count as fraction friendly', () => {
    for (const u of ['tsp', 'tbsp', 'cup_us', 'cup_metric', 'oz', 'lb', 'count']) {
      expect(isFractionFriendlyUnit(u)).toBe(true);
    }
  });
  it('treats metric mass/volume + null as decimal', () => {
    for (const u of ['g', 'kg', 'ml', 'l', 'C', null, undefined]) {
      expect(isFractionFriendlyUnit(u)).toBe(false);
    }
  });
});

describe('formatExactFraction', () => {
  it('renders simple fractions verbatim, including non-eighths', () => {
    expect(formatExactFraction(1, 2)).toBe('1/2');
    expect(formatExactFraction(1, 3)).toBe('1/3');
    expect(formatExactFraction(2, 3)).toBe('2/3');
    expect(formatExactFraction(5, 8)).toBe('5/8');
    expect(formatExactFraction(7, 16)).toBe('7/16');
  });
  it('renders mixed numbers and whole numbers', () => {
    expect(formatExactFraction(7, 3)).toBe('2 1/3');
    expect(formatExactFraction(3, 2)).toBe('1 1/2');
    expect(formatExactFraction(6, 3)).toBe('2');
    expect(formatExactFraction(3, 1)).toBe('3');
  });
  it('reduces before rendering', () => {
    expect(formatExactFraction(2, 4)).toBe('1/2');
    expect(formatExactFraction(4, 2)).toBe('2');
  });
});

describe('formatDisplayQuantity', () => {
  const dec = (v: number) => String(Number(v.toFixed(2)));

  it('renders fractions for fraction-friendly units', () => {
    expect(formatDisplayQuantity(1.5, 'cup_us', dec)).toBe('1 1/2');
    expect(formatDisplayQuantity(0.125, 'tsp', dec)).toBe('1/8');
    expect(formatDisplayQuantity(0.25, 'count', dec)).toBe('1/4');
  });
  it('renders decimals for non-fraction-friendly units', () => {
    expect(formatDisplayQuantity(1.5, 'g', dec)).toBe('1.5');
    expect(formatDisplayQuantity(200, 'ml', dec)).toBe('200');
  });
  it('honors an exact stored fraction for any unit, including non-eighths', () => {
    expect(formatDisplayQuantity({ numerator: 1, denominator: 3 }, 'cup_us', dec)).toBe('1/3');
    expect(formatDisplayQuantity({ numerator: 5, denominator: 8 }, 'g', dec)).toBe('5/8');
    expect(formatDisplayQuantity({ numerator: 2, denominator: 3 }, null, dec)).toBe('2/3');
    expect(formatDisplayQuantity({ numerator: 7, denominator: 3 }, 'tbsp', dec)).toBe('2 1/3');
  });
  it('drops fractions for large fraction-friendly values (>= 10)', () => {
    expect(formatDisplayQuantity(12.5, 'cup_us', dec)).toBe('12.5');
    expect(formatDisplayQuantity(10, 'oz', dec)).toBe('10');
  });
  it('passes through non-finite values', () => {
    expect(formatDisplayQuantity(Number.NaN, 'cup_us', dec)).toBe('NaN');
  });
});

describe('property: niceFraction(value, denom) reconstructs to within 1/denom', () => {
  it('is bounded', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(2, 4, 8),
        (v, denom) => {
          const f = niceFraction(v, denom as 2 | 4 | 8);
          const reconstructed = f.whole + f.numerator / f.denominator;
          expect(Math.abs(reconstructed - v)).toBeLessThanOrEqual(1 / (denom as number) + 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });
});
