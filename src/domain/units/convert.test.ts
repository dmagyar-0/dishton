import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convert, pickDisplayUnit } from './convert';
import { CANONICAL, units, unitsForDimension } from './graph';

describe('convert', () => {
  it('identity returns the same value for every unit', () => {
    for (const key of Object.keys(units)) {
      expect(convert(42, key, key)).toBe(42);
    }
  });
  it('converts mass between g/kg/oz/lb', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(500, 'g', 'kg')).toBe(0.5);
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 2);
    expect(convert(28.3495, 'g', 'oz')).toBeCloseTo(1, 4);
  });
  it('converts volume between ml/l/tsp/tbsp/cup_us/fl_oz', () => {
    expect(convert(1, 'l', 'ml')).toBe(1000);
    expect(convert(15, 'ml', 'tbsp')).toBeCloseTo(1, 4);
    expect(convert(5, 'ml', 'tsp')).toBeCloseTo(1, 4);
    expect(convert(240, 'ml', 'cup_us')).toBeCloseTo(1, 4);
    expect(convert(1, 'cup_metric', 'ml')).toBe(250);
    expect(convert(1, 'fl_oz', 'ml')).toBeCloseTo(29.5735, 3);
  });
  it('converts temperature C <-> F', () => {
    expect(convert(0, 'C', 'F')).toBe(32);
    expect(convert(100, 'C', 'F')).toBeCloseTo(212, 5);
    expect(convert(32, 'F', 'C')).toBe(0);
    expect(convert(212, 'F', 'C')).toBeCloseTo(100, 5);
  });
  it('rejects incompatible dimensions', () => {
    expect(() => convert(1, 'g', 'ml')).toThrow(/incompatible/);
    expect(() => convert(1, 'min', 'g')).toThrow(/incompatible/);
  });
  it('rejects unknown units', () => {
    expect(() => convert(1, 'g', 'zonk')).toThrow(/unknown/);
    expect(() => convert(1, 'zonk', 'g')).toThrow(/unknown/);
  });
  it('converts cup_us <-> mass using water-density (1 g/ml)', () => {
    expect(convert(1, 'cup_us', 'g')).toBe(240);
    expect(convert(0.5, 'cup_us', 'g')).toBe(120);
    expect(convert(5, 'cup_us', 'kg')).toBeCloseTo(1.2, 4);
    expect(convert(240, 'g', 'cup_us')).toBe(1);
  });
  it('converts cup_metric <-> mass using water-density (1 g/ml)', () => {
    expect(convert(1, 'cup_metric', 'g')).toBe(250);
    expect(convert(4, 'cup_metric', 'kg')).toBe(1);
    expect(convert(500, 'g', 'cup_metric')).toBe(2);
  });
  it('still rejects unrelated volume <-> mass conversions (only cups allowed)', () => {
    expect(() => convert(1, 'ml', 'g')).toThrow(/incompatible/);
    expect(() => convert(1, 'tsp', 'g')).toThrow(/incompatible/);
    expect(() => convert(1, 'tbsp', 'g')).toThrow(/incompatible/);
    expect(() => convert(1, 'l', 'kg')).toThrow(/incompatible/);
  });

  it('property: convert(qty, A, A) === qty', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(...Object.keys(units)),
        (qty, key) => {
          expect(convert(qty, key, key)).toBe(qty);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: convert(convert(qty, A, B), B, A) ~= qty for non-temperature units', () => {
    const dims = ['mass', 'volume', 'length', 'time'] as const;
    for (const dim of dims) {
      const list = unitsForDimension(dim).map((u) => u.key);
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true }),
          fc.constantFrom(...list),
          fc.constantFrom(...list),
          (qty, a, b) => {
            const round = convert(convert(qty, a, b), b, a);
            expect(round).toBeCloseTo(qty, 6);
          },
        ),
        { numRuns: 100 },
      );
    }
  });

  it('property: convert(0, A, B) === 0 (or 32 for C->F)', () => {
    const dims = ['mass', 'volume', 'length', 'time'] as const;
    for (const dim of dims) {
      const list = unitsForDimension(dim).map((u) => u.key);
      for (const a of list) {
        for (const b of list) {
          expect(convert(0, a, b)).toBe(0);
        }
      }
    }
    expect(convert(0, 'C', 'F')).toBe(32);
    expect(convert(0, 'C', 'C')).toBe(0);
  });

  it('property: monotonic for non-temperature dimensions', () => {
    const list = unitsForDimension('mass').map((u) => u.key);
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(...list),
        fc.constantFrom(...list),
        (a, b, from, to) => {
          if (a === b) return;
          const ca = convert(a, from, to);
          const cb = convert(b, from, to);
          expect(Math.sign(a - b)).toBe(Math.sign(ca - cb));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('pickDisplayUnit', () => {
  it('mass metric prefers g below 1kg, kg at or above', () => {
    expect(pickDisplayUnit('g', 999, 'metric')).toBe('g');
    expect(pickDisplayUnit('g', 1000, 'metric')).toBe('kg');
  });
  it('mass imperial prefers oz below 1 lb, lb above', () => {
    expect(pickDisplayUnit('g', 100, 'imperial')).toBe('oz');
    expect(pickDisplayUnit('g', 500, 'imperial')).toBe('lb');
  });
  it('volume metric prefers ml below 1l', () => {
    expect(pickDisplayUnit('ml', 250, 'metric')).toBe('ml');
    expect(pickDisplayUnit('ml', 1500, 'metric')).toBe('l');
  });
  it('volume metric keeps tsp and tbsp as-is', () => {
    expect(pickDisplayUnit('tsp', 1, 'metric')).toBe('tsp');
    expect(pickDisplayUnit('tsp', 3, 'metric')).toBe('tsp');
    expect(pickDisplayUnit('tbsp', 1, 'metric')).toBe('tbsp');
    expect(pickDisplayUnit('tbsp', 2, 'metric')).toBe('tbsp');
  });
  it('volume metric converts cups to g/kg via water-density', () => {
    expect(pickDisplayUnit('cup_us', 0.5, 'metric')).toBe('g');
    expect(pickDisplayUnit('cup_us', 1, 'metric')).toBe('g');
    expect(pickDisplayUnit('cup_us', 5, 'metric')).toBe('kg');
    expect(pickDisplayUnit('cup_metric', 1, 'metric')).toBe('g');
    expect(pickDisplayUnit('cup_metric', 5, 'metric')).toBe('kg');
  });
  it('volume imperial picks tsp/tbsp/fl_oz/cup branches', () => {
    expect(pickDisplayUnit('ml', 4, 'imperial')).toBe('tsp');
    expect(pickDisplayUnit('ml', 30, 'imperial')).toBe('tbsp');
    expect(pickDisplayUnit('ml', 100, 'imperial')).toBe('fl_oz');
    expect(pickDisplayUnit('ml', 500, 'imperial')).toBe('cup_us');
  });
  it('temperature respects preferred system', () => {
    expect(pickDisplayUnit('C', 180, 'imperial')).toBe('F');
    expect(pickDisplayUnit('F', 350, 'metric')).toBe('C');
  });
  it('unknown unit returned as-is', () => {
    expect(pickDisplayUnit('zonk', 1, 'metric')).toBe('zonk');
  });
  it('time picks h above 90 minutes, min below', () => {
    expect(pickDisplayUnit('min', 30, 'metric')).toBe('min');
    expect(pickDisplayUnit('min', 120, 'metric')).toBe('h');
  });
  it('length metric picks mm/cm/m by magnitude', () => {
    expect(pickDisplayUnit('mm', 5, 'metric')).toBe('mm');
    expect(pickDisplayUnit('mm', 50, 'metric')).toBe('cm');
    expect(pickDisplayUnit('mm', 5000, 'metric')).toBe('m');
  });
  it('length imperial picks inches', () => {
    expect(pickDisplayUnit('mm', 100, 'imperial')).toBe('inch');
  });
  it('volume imperial intermediate ranges', () => {
    expect(pickDisplayUnit('ml', 2, 'imperial')).toBe('tsp');
    expect(pickDisplayUnit('ml', 1500, 'imperial')).toBe('quart_us');
  });
});

it('CANONICAL keys are present in units map', () => {
  for (const key of Object.values(CANONICAL)) {
    expect(units[key]).toBeDefined();
  }
});
