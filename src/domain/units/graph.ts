import type { UnitSystem } from '../recipe';

export type Dimension = 'mass' | 'volume' | 'count' | 'length' | 'temperature' | 'time';

export type UnitDef = {
  key: string;
  dimension: Dimension;
  toCanonical: number;
  symbol: { en: string; de?: string; fr?: string; it?: string; es?: string };
  system: UnitSystem | 'both';
};

export const CANONICAL: Record<Dimension, string> = {
  mass: 'g',
  volume: 'ml',
  count: 'count',
  length: 'mm',
  temperature: 'C',
  time: 'min',
};

const defs: UnitDef[] = [
  // mass
  { key: 'g', dimension: 'mass', toCanonical: 1, symbol: { en: 'g' }, system: 'both' },
  { key: 'kg', dimension: 'mass', toCanonical: 1000, symbol: { en: 'kg' }, system: 'both' },
  { key: 'oz', dimension: 'mass', toCanonical: 28.3495, symbol: { en: 'oz' }, system: 'imperial' },
  { key: 'lb', dimension: 'mass', toCanonical: 453.592, symbol: { en: 'lb' }, system: 'imperial' },
  { key: 'mg', dimension: 'mass', toCanonical: 0.001, symbol: { en: 'mg' }, system: 'metric' },

  // volume
  { key: 'ml', dimension: 'volume', toCanonical: 1, symbol: { en: 'ml' }, system: 'both' },
  { key: 'l', dimension: 'volume', toCanonical: 1000, symbol: { en: 'l' }, system: 'both' },
  { key: 'tsp', dimension: 'volume', toCanonical: 5, symbol: { en: 'tsp' }, system: 'both' },
  { key: 'tbsp', dimension: 'volume', toCanonical: 15, symbol: { en: 'tbsp' }, system: 'both' },
  {
    key: 'cup_us',
    dimension: 'volume',
    toCanonical: 240,
    symbol: { en: 'cup' },
    system: 'imperial',
  },
  {
    key: 'cup_metric',
    dimension: 'volume',
    toCanonical: 250,
    symbol: { en: 'cup' },
    system: 'metric',
  },
  {
    key: 'fl_oz',
    dimension: 'volume',
    toCanonical: 29.5735,
    symbol: { en: 'fl oz' },
    system: 'imperial',
  },
  {
    key: 'pint_us',
    dimension: 'volume',
    toCanonical: 473.176,
    symbol: { en: 'pt' },
    system: 'imperial',
  },
  {
    key: 'quart_us',
    dimension: 'volume',
    toCanonical: 946.353,
    symbol: { en: 'qt' },
    system: 'imperial',
  },

  // count
  { key: 'count', dimension: 'count', toCanonical: 1, symbol: { en: '×' }, system: 'both' },

  // length
  { key: 'mm', dimension: 'length', toCanonical: 1, symbol: { en: 'mm' }, system: 'metric' },
  { key: 'cm', dimension: 'length', toCanonical: 10, symbol: { en: 'cm' }, system: 'metric' },
  { key: 'm', dimension: 'length', toCanonical: 1000, symbol: { en: 'm' }, system: 'metric' },
  { key: 'inch', dimension: 'length', toCanonical: 25.4, symbol: { en: 'in' }, system: 'imperial' },

  // temperature
  { key: 'C', dimension: 'temperature', toCanonical: 1, symbol: { en: '°C' }, system: 'metric' },
  {
    key: 'F',
    dimension: 'temperature',
    toCanonical: 1,
    symbol: { en: '°F' },
    system: 'imperial',
  },

  // time
  { key: 'min', dimension: 'time', toCanonical: 1, symbol: { en: 'min' }, system: 'both' },
  { key: 'h', dimension: 'time', toCanonical: 60, symbol: { en: 'h' }, system: 'both' },
  { key: 's', dimension: 'time', toCanonical: 1 / 60, symbol: { en: 's' }, system: 'both' },
];

export const units: Record<string, UnitDef> = Object.fromEntries(defs.map((d) => [d.key, d]));

export function isKnownUnit(key: string): boolean {
  return Object.hasOwn(units, key);
}

export function unitsForDimension(dim: Dimension): UnitDef[] {
  return defs.filter((d) => d.dimension === dim);
}

export function unitsForSystem(dim: Dimension, system: UnitSystem): UnitDef[] {
  return unitsForDimension(dim).filter((d) => d.system === 'both' || d.system === system);
}
