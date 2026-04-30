import { units } from './graph';

export function convert(qty: number, from: string, to: string): number {
  if (from === to) return qty;
  const a = units[from];
  const b = units[to];
  if (!a || !b) {
    throw new Error(`unknown unit: ${from} or ${to}`);
  }
  if (a.dimension !== b.dimension) {
    throw new Error(`incompatible: ${from} (${a.dimension}) -> ${to} (${b.dimension})`);
  }
  if (a.dimension === 'temperature') {
    if (from === 'C' && to === 'F') return (qty * 9) / 5 + 32;
    if (from === 'F' && to === 'C') return ((qty - 32) * 5) / 9;
    return qty;
  }
  return (qty * a.toCanonical) / b.toCanonical;
}

/**
 * Pick a target unit for display given an ingredient's canonical value.
 * Heuristics from doc 06: prefer the smallest unit that keeps the value in
 * the readable [0.1, 999] range, falling back to the next larger unit.
 */
export function pickDisplayUnit(
  fromUnit: string,
  qty: number,
  preferred: 'metric' | 'imperial',
): string {
  const def = units[fromUnit];
  if (!def) return fromUnit;
  const dim = def.dimension;
  const canonicalValue = qty * def.toCanonical;

  if (dim === 'mass') {
    if (preferred === 'metric') {
      return canonicalValue >= 1000 ? 'kg' : 'g';
    }
    if (canonicalValue >= 453.592) return 'lb';
    return 'oz';
  }
  if (dim === 'volume') {
    if (preferred === 'metric') {
      if (canonicalValue >= 1000) return 'l';
      return 'ml';
    }
    if (canonicalValue < 5) return 'tsp';
    if (canonicalValue < 15) return 'tsp';
    if (canonicalValue < 60) return 'tbsp';
    if (canonicalValue < 240) return 'fl_oz';
    if (canonicalValue < 1000) return 'cup_us';
    return 'quart_us';
  }
  if (dim === 'temperature') {
    return preferred === 'imperial' ? 'F' : 'C';
  }
  if (dim === 'time') {
    return canonicalValue >= 90 ? 'h' : 'min';
  }
  if (dim === 'length') {
    if (preferred === 'imperial') return 'inch';
    if (canonicalValue >= 1000) return 'm';
    if (canonicalValue >= 10) return 'cm';
    return 'mm';
  }
  return fromUnit;
}
