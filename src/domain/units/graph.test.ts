import { describe, expect, it } from 'vitest';
import { CANONICAL, isKnownUnit, units, unitsForDimension, unitsForSystem } from './graph';

describe('graph', () => {
  it('exposes a CANONICAL key per dimension', () => {
    expect(CANONICAL.mass).toBe('g');
    expect(CANONICAL.volume).toBe('ml');
    expect(CANONICAL.count).toBe('count');
    expect(CANONICAL.length).toBe('mm');
    expect(CANONICAL.temperature).toBe('C');
    expect(CANONICAL.time).toBe('min');
  });
  it('marks the canonical unit with toCanonical=1', () => {
    for (const [dim, key] of Object.entries(CANONICAL)) {
      expect(units[key]?.toCanonical, `${dim}=${key}`).toBe(1);
    }
  });
  it('isKnownUnit for known + unknown', () => {
    expect(isKnownUnit('g')).toBe(true);
    expect(isKnownUnit('cup_us')).toBe(true);
    expect(isKnownUnit('zonk')).toBe(false);
  });
  it('unitsForDimension returns all members', () => {
    const mass = unitsForDimension('mass').map((u) => u.key);
    expect(mass).toContain('g');
    expect(mass).toContain('kg');
    expect(mass).toContain('lb');
  });
  it('unitsForSystem filters out the wrong system', () => {
    const metric = unitsForSystem('mass', 'metric').map((u) => u.key);
    expect(metric).toContain('g');
    expect(metric).not.toContain('lb');
    const imperial = unitsForSystem('volume', 'imperial').map((u) => u.key);
    expect(imperial).toContain('cup_us');
    expect(imperial).not.toContain('cup_metric');
  });
});
