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
  it('produces deduped, ascending ticks from 0 to the nice max', () => {
    expect(yTicks(9)).toEqual([0, 3, 5, 8, 10]);
  });

  it('dedupes when the range is too small to fill every step', () => {
    const ticks = yTicks(0);
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
