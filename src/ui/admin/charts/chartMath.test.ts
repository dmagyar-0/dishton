import { describe, expect, it } from 'vitest';
import { niceMax, sparseIndices, yTicks } from './chartMath';

describe('niceMax', () => {
  it('rounds up to a nice 1/2/5 x 10^n ceiling', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(1)).toBe(1);
  });

  it('guards zero/negative/NaN so downstream division never sees 0', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
  });
});

describe('yTicks', () => {
  // Every case is checked against the same contract: strictly ascending,
  // evenly spaced (constant step between consecutive ticks), starts at 0,
  // and reaches at least `max` -- so a chart's topmost gridline is never
  // short of the tallest bar/point it needs to cover.
  function expectWellFormedTicks(max: number, ticks: number[]) {
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBe(0);
    const last = ticks[ticks.length - 1] as number;
    expect(last).toBeGreaterThanOrEqual(max);

    const step = (ticks[1] as number) - (ticks[0] as number);
    expect(step).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      const prev = ticks[i - 1] as number;
      const cur = ticks[i] as number;
      expect(cur).toBeGreaterThan(prev);
      expect(cur - prev).toBeCloseTo(step, 9);
    }
  }

  it.each([0, 1, 2, 3, 7, 10, 3500, 0.42])(
    'produces evenly spaced, evenly valued ticks from 0 for max=%s',
    (max) => {
      expectWellFormedTicks(max, yTicks(max));
    },
  );

  it('fixes the historical bug: yTicks(3) no longer skips a value between unevenly spaced ticks', () => {
    // Previously: [0, 1, 3, 4, 5] -- gridlines at 0/20/60/80/100% of the axis
    // height labelled 0,1,3,4,5, i.e. evenly SPACED but not evenly VALUED.
    expect(yTicks(3)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('never exceeds ~5 ticks for small integer maxima', () => {
    for (const max of [1, 2, 3, 7]) {
      expect(yTicks(max).length).toBeLessThanOrEqual(6);
    }
  });

  it('keeps the top tick equal to niceMax(max), matching the scale chart components derive independently', () => {
    for (const max of [0, 1, 3, 7, 3500, 0.42]) {
      const ticks = yTicks(max);
      expect(ticks[ticks.length - 1]).toBe(niceMax(max));
    }
  });

  it('never divides by zero for a brand-new install with zero events', () => {
    const ticks = yTicks(0);
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('sparseIndices', () => {
  it('returns every index when there are fewer than the label cap', () => {
    expect(sparseIndices(3, 6)).toEqual([0, 1, 2]);
  });

  it('always includes the first and last index when thinning', () => {
    const indices = sparseIndices(90, 6);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(89);
    expect(indices.length).toBeLessThanOrEqual(6);
  });

  it('returns an empty array for zero length', () => {
    expect(sparseIndices(0, 6)).toEqual([]);
  });
});
